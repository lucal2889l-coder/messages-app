// Voice calls. Every channel and DM can have one call. Audio goes straight
// between browsers over WebRTC (each person connects to every other person);
// the server only introduces them, over the existing WebSocket.
import { $, $$, esc } from './util.js';
import { api } from './api.js';
import {
  state, prefs, actions, avatarHtml, getUser, userName, chatName, findChannel, isChatMuted, isLockedForMe, dmOther
} from './store.js';
import { toast, openModal } from './ui.js';
import { playSound, startRing, stopRing, showDesktopNotification, notifPermission, avatarIconFor } from './notify.js';

const SPEAKING_LEVEL = 0.018;
const SPEAKING_HOLD_MS = 350;
const NO_ANSWER_MS = 45000;
const RING_MS = 30000;
const MAX_ICE_RESTARTS = 3;

const call = {
  channelId: null,
  chatId: null,
  peerId: null,
  joining: false,
  stream: null,
  config: null,
  peers: new Map(),  // peerId -> { pc, userId, initiator, pendingIce, queue, restarts }
  audio: new Map(),  // peerId -> <audio>
  muted: false,
  deafened: false,
  mutedBeforeDeafen: false,
  ctx: null,
  meters: new Map(), // userId -> { analyser, buf, lastLoud }
  meterTimer: null,
  noAnswerTimer: null
};

let send = () => {};
let incoming = null; // { channelId, modal, timer }

export function initVoice(sendFn) { send = sendFn; }
export const inCall = () => !!call.channelId;
export const inCallHere = (channelId) => call.channelId === channelId;

// ---------------------------------------------------------------------------
// Microphone
// ---------------------------------------------------------------------------
export function micConstraints(deviceId) {
  return {
    audio: {
      deviceId: deviceId ? { ideal: deviceId } : undefined,
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
      autoGainControl: true
    }
  };
}

async function openMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Voice calls need the site to be on HTTPS.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia(micConstraints(prefs.micId));
  } catch (e) {
    if (e.name === 'NotFoundError' || e.name === 'NotReadableError' || e.name === 'OverconstrainedError') {
      toast("No microphone available, so you've joined listen-only.", 'error');
      return null;
    }
    throw new Error('Microphone access is blocked. Allow it from the icon at the left of the address bar, then try again.');
  }
}

// ---------------------------------------------------------------------------
// Joining + leaving
// ---------------------------------------------------------------------------
export async function joinCall(channelId) {
  if (call.joining || call.channelId === channelId) return;
  if (!state.connected) { toast("You're offline right now.", 'error'); return; }
  clearIncoming();
  if (call.channelId) leaveCall();
  call.joining = true;
  renderCallUi();
  try {
    call.config = await api('GET', '/api/voice/config');
    call.stream = await openMic();
  } catch (e) {
    call.joining = false;
    renderCallUi();
    toast(e.message, 'error');
    return;
  }
  call.muted = !call.stream;
  call.deafened = false;
  send({ type: 'call:join', channelId });
}

export function leaveCall({ silent = false } = {}) {
  if (!call.channelId && !call.joining) return;
  if (call.channelId) send({ type: 'call:leave' });
  if (!silent) playSound('leave');
  teardown();
  renderCallUi();
}

function teardownPeers() {
  call.peers.forEach((_, id) => dropPeer(id));
}

function teardown() {
  teardownPeers();
  stopMeters();
  clearTimeout(call.noAnswerTimer);
  if (call.stream) call.stream.getTracks().forEach((t) => t.stop());
  Object.assign(call, { channelId: null, chatId: null, peerId: null, joining: false, stream: null, muted: false, deafened: false });
}

function signal(to, data) {
  send({ type: 'call:signal', to, data });
}

// ---------------------------------------------------------------------------
// Peer connections. Whoever joins later makes the offers, so two people never
// offer to each other at the same moment.
// ---------------------------------------------------------------------------
function makePeer(peerId, userId, initiator) {
  const pc = new RTCPeerConnection({ iceServers: call.config.iceServers });
  const peer = { pc, userId, initiator, pendingIce: [], queue: Promise.resolve(), restarts: 0 };
  call.peers.set(peerId, peer);
  if (call.stream) call.stream.getAudioTracks().forEach((t) => pc.addTrack(t, call.stream));
  else if (initiator) pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.onicecandidate = (e) => { if (e.candidate) signal(peerId, { ice: e.candidate }); };
  pc.ontrack = (e) => attachAudio(peerId, userId, e.streams[0] || new MediaStream([e.track]));
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') peer.restarts = 0;
    if (pc.connectionState === 'failed') onPeerFailed(peerId, peer);
    renderPanel();
    renderBanner();
  };
  return peer;
}

async function sendOffer(peerId, peer, options) {
  await peer.pc.setLocalDescription(await peer.pc.createOffer(options));
  signal(peerId, { sdp: peer.pc.localDescription });
}

function onPeerFailed(peerId, peer) {
  if (peer.restarts < MAX_ICE_RESTARTS) {
    peer.restarts++;
    if (peer.initiator) sendOffer(peerId, peer, { iceRestart: true }).catch(() => {});
    return;
  }
  toast(`Couldn't connect to ${userName(peer.userId) || 'someone'}. Their network may be blocking calls.`, 'error');
}

function dropPeer(peerId) {
  const peer = call.peers.get(peerId);
  if (peer) {
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    call.peers.delete(peerId);
    call.meters.delete(peer.userId);
  }
  const audio = call.audio.get(peerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    call.audio.delete(peerId);
  }
}

function attachAudio(peerId, userId, stream) {
  let audio = call.audio.get(peerId);
  if (!audio) {
    audio = document.createElement('audio');
    audio.autoplay = true;
    $('#audio-sink').appendChild(audio);
    call.audio.set(peerId, audio);
    if (prefs.speakerId && audio.setSinkId) audio.setSinkId(prefs.speakerId).catch(() => {});
  }
  audio.muted = call.deafened;
  audio.srcObject = stream;
  audio.play().catch(() => {});
  watchLevel(userId, stream);
}

function onSignal({ from, userId, data }) {
  if (!call.channelId || !data) return;
  const peer = call.peers.get(from) || makePeer(from, userId, false);
  // Each step depends on the last finishing, and signals can arrive faster than that.
  peer.queue = peer.queue.then(() => applySignal(from, peer, data)).catch((e) => console.warn('[voice] signal failed', e));
}

async function applySignal(peerId, peer, data) {
  const { pc } = peer;
  if (data.ice) {
    if (pc.remoteDescription) await pc.addIceCandidate(data.ice);
    else peer.pendingIce.push(data.ice);
    return;
  }
  if (!data.sdp) return;
  await pc.setRemoteDescription(data.sdp);
  for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c);
  if (data.sdp.type === 'offer') {
    await pc.setLocalDescription(await pc.createAnswer());
    signal(peerId, { sdp: pc.localDescription });
  }
}

// ---------------------------------------------------------------------------
// Who's speaking
// ---------------------------------------------------------------------------
function audioContext() {
  if (!call.ctx) call.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (call.ctx.state === 'suspended') call.ctx.resume().catch(() => {});
  return call.ctx;
}

function watchLevel(userId, stream) {
  try {
    const ctx = audioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    call.meters.set(userId, { analyser, buf: new Float32Array(analyser.fftSize), lastLoud: 0 });
  } catch (e) { return; }
  if (!call.meterTimer) call.meterTimer = setInterval(tickMeters, 120);
}

function tickMeters() {
  const t = Date.now();
  call.meters.forEach((m, userId) => {
    m.analyser.getFloatTimeDomainData(m.buf);
    const rms = Math.sqrt(m.buf.reduce((n, v) => n + v * v, 0) / m.buf.length);
    if (rms > SPEAKING_LEVEL) m.lastLoud = t;
    const silenced = userId === state.me.id && call.muted;
    const speaking = !silenced && t - m.lastLoud < SPEAKING_HOLD_MS;
    $$(`[data-voice-user="${CSS.escape(userId)}"]`).forEach((el) => el.classList.toggle('speaking', speaking));
  });
}

function stopMeters() {
  clearInterval(call.meterTimer);
  call.meterTimer = null;
  call.meters.clear();
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function applyMute() {
  if (call.stream) call.stream.getAudioTracks().forEach((t) => { t.enabled = !call.muted; });
  send({ type: 'call:state', muted: call.muted, deafened: call.deafened });
  renderCallUi();
}

export function toggleMute() {
  if (!call.stream) { toast("You don't have a microphone connected.", 'error'); return; }
  call.muted = !call.muted;
  if (!call.muted && call.deafened) setDeafened(false);
  applyMute();
}

function setDeafened(on) {
  call.deafened = on;
  call.audio.forEach((a) => { a.muted = on; });
}

export function toggleDeafen() {
  if (!call.deafened) {
    call.mutedBeforeDeafen = call.muted;
    call.muted = true;
    setDeafened(true);
  } else {
    setDeafened(false);
    call.muted = call.mutedBeforeDeafen || !call.stream;
  }
  applyMute();
}

// ---------------------------------------------------------------------------
// Incoming calls
// ---------------------------------------------------------------------------
function clearIncoming() {
  if (!incoming) return;
  const { modal, timer } = incoming;
  incoming = null;
  clearTimeout(timer);
  stopRing();
  if (modal) modal.close();
}

function showIncoming(chat, channelId, fromId) {
  const caller = getUser(fromId);
  const modal = openModal(`
    <div class="call-card">
      ${avatarHtml(caller, 96)}
      <h2>${esc(caller ? caller.name : 'Someone')}</h2>
      <p>is calling you…</p>
      <div class="call-actions">
        <button class="call-round decline" data-act="decline" aria-label="Decline" data-tip="Decline">${PHONE_DOWN}</button>
        <button class="call-round accept" data-act="accept" aria-label="Accept" data-tip="Accept">${PHONE}</button>
      </div>
    </div>`, { className: 'call-modal', dismissable: false, onClose: () => { incoming = null; stopRing(); } });
  incoming = { channelId, modal, timer: setTimeout(clearIncoming, RING_MS) };
  startRing();
  modal.el.querySelector('[data-act=accept]').onclick = () => {
    clearIncoming();
    actions.openChat(chat.id, channelId);
    joinCall(channelId);
  };
  modal.el.querySelector('[data-act=decline]').onclick = () => {
    send({ type: 'call:decline', channelId });
    clearIncoming();
  };
}

function onRing({ channelId, chatId, fromId }) {
  const chat = state.chats.get(chatId);
  const found = findChannel(channelId);
  if (!chat || !found || isChatMuted(chatId) || prefs.muteAll || state.me.status === 'dnd') return;
  const caller = getUser(fromId);
  const name = caller ? caller.name : 'Someone';
  if (chat.type === 'dm' && !call.channelId) showIncoming(chat, channelId, fromId);
  else toast(`📞 ${name} started a call in ${chat.type === 'dm' ? 'your DM' : '#' + found.channel.name}`);
  const focused = document.visibilityState === 'visible' && document.hasFocus();
  if (!focused && prefs.desktop && notifPermission() === 'granted') {
    showDesktopNotification({
      title: chat.type === 'dm' ? `📞 ${name} is calling you` : `📞 ${name} started a call`,
      body: chat.type === 'dm' ? 'Click to open the chat and join' : `#${found.channel.name} in ${chat.name}`,
      icon: avatarIconFor(caller),
      tag: 'call-' + channelId,
      hash: `#/c/${chatId}/${channelId}`,
      sticky: true,
      onClick: () => actions.openChat(chatId, channelId)
    });
  }
}

// ---------------------------------------------------------------------------
// Live events from the server
// ---------------------------------------------------------------------------
export function handleCallEvent(msg) {
  switch (msg.type) {
    case 'call:joined': {
      if (!call.joining && !call.channelId) { send({ type: 'call:leave' }); return; }
      call.joining = false;
      call.channelId = msg.channelId;
      call.chatId = msg.chatId;
      call.peerId = msg.peerId;
      if (call.stream) watchLevel(state.me.id, call.stream);
      msg.peers.forEach((p) => {
        const peer = makePeer(p.peerId, p.userId, true);
        sendOffer(p.peerId, peer).catch((e) => console.warn('[voice] offer failed', e));
      });
      send({ type: 'call:state', muted: call.muted, deafened: call.deafened });
      playSound('join');
      const chat = state.chats.get(msg.chatId);
      clearTimeout(call.noAnswerTimer);
      if (chat && chat.type === 'dm' && !msg.peers.length) {
        call.noAnswerTimer = setTimeout(() => {
          if (call.channelId === msg.channelId && !call.peers.size) {
            toast('No answer.');
            leaveCall();
          }
        }, NO_ANSWER_MS);
      }
      renderCallUi();
      break;
    }
    case 'call:update': {
      state.calls.set(msg.call.channelId, msg.call);
      if (msg.call.channelId === call.channelId) {
        const live = new Set(msg.call.peers.map((p) => p.peerId));
        Array.from(call.peers.keys()).forEach((id) => { if (!live.has(id)) dropPeer(id); });
      }
      renderCallUi();
      break;
    }
    case 'call:end':
      state.calls.delete(msg.channelId);
      if (incoming && incoming.channelId === msg.channelId) clearIncoming();
      renderCallUi();
      break;
    case 'call:signal':
      onSignal(msg);
      break;
    case 'call:ring':
      onRing(msg);
      break;
    case 'call:declined':
      if (msg.channelId === call.channelId && !call.peers.size) {
        toast(`${userName(msg.userId) || 'They'} declined the call.`);
        leaveCall();
      }
      break;
    case 'call:stop-ring':
      if (incoming && incoming.channelId === msg.channelId) clearIncoming();
      break;
    case 'call:moved':
      toast('This call moved to another tab or device.');
      leaveCall({ silent: true });
      break;
    case 'call:removed':
      toast('You were removed from that call.');
      leaveCall({ silent: true });
      break;
    case 'call:error':
      if (call.stream) call.stream.getTracks().forEach((t) => t.stop());
      teardown();
      renderCallUi();
      toast(msg.error, 'error');
      break;
    default:
  }
}

// The server drops people from calls when their socket goes, so rejoin after a reconnect.
export function onVoiceReconnect() {
  if (!call.channelId) return;
  const channelId = call.channelId;
  teardownPeers();
  call.joining = true;
  call.channelId = null;
  send({ type: 'call:join', channelId });
}

export function ingestCalls(list) {
  state.calls = new Map((list || []).map((c) => [c.channelId, c]));
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const MIC = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4zm7-4h-2a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z"/></svg>';
const MIC_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4zm7-4h-2a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z"/><path d="M4 3l16 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const HEADSET = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a7 7 0 0 1 14 0h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z"/></svg>';
const HEADSET_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a7 7 0 0 1 14 0h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z"/><path d="M4 3l16 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
export const PHONE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11 11 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11 11 0 0 0 .6 3.6 1 1 0 0 1-.25 1z"/></svg>';
const PHONE_DOWN = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 9c-1.6 0-3.1.25-4.5.7v3.1c0 .4-.2.7-.6.9-1 .5-1.9 1.1-2.7 1.8a1 1 0 0 1-1.4 0L.3 12.9a1 1 0 0 1 0-1.4A17 17 0 0 1 12 7a17 17 0 0 1 11.7 4.5 1 1 0 0 1 0 1.4l-2.5 2.5a1 1 0 0 1-1.4 0 11 11 0 0 0-2.7-1.8.9.9 0 0 1-.6-.9V9.7A15 15 0 0 0 12 9z"/></svg>';

function whereLabel() {
  const chat = state.chats.get(call.chatId);
  if (!chat) return '';
  if (chat.type === 'dm') return '@' + chatName(chat);
  const ch = chat.channels.find((c) => c.id === call.channelId);
  return `#${ch ? ch.name : 'call'} / ${chat.name}`;
}

function peerConnecting(peerId) {
  const peer = call.peers.get(peerId);
  return !!peer && peer.pc.connectionState !== 'connected';
}

function personHtml(p, size) {
  const user = getUser(p.userId) || { id: p.userId, name: 'Someone' };
  const off = p.deafened ? ' deafened' : p.muted ? ' muted' : '';
  const wait = peerConnecting(p.peerId) ? ' connecting' : '';
  return `<span class="voice-person${off}${wait}" data-voice-user="${esc(p.userId)}" data-tip="${esc(user.name)}${p.deafened ? ' (deafened)' : p.muted ? ' (muted)' : ''}">${avatarHtml(user, size)}<i class="vp-flag"></i></span>`;
}

function renderPeople() {
  const live = call.channelId && state.calls.get(call.channelId);
  const el = $('#vp-people');
  if (el && live) el.innerHTML = live.peers.map((p) => personHtml(p, 28)).join('');
}

function renderPanel() {
  const panel = $('#voice-panel');
  if (!panel) return;
  if (!call.channelId && !call.joining) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  const anyPending = Array.from(call.peers.values()).some((p) => p.pc.connectionState !== 'connected');
  const status = call.joining ? 'Connecting…' : anyPending ? 'Connecting…' : call.peers.size ? 'Voice Connected' : 'Waiting for others…';
  panel.innerHTML = `
    <div class="vp-top">
      <button class="vp-where" id="vp-open" data-tip="Go to this call"><span class="vp-state ${call.peers.size && !anyPending ? 'ok' : ''}">${esc(status)}</span><span class="vp-name">${esc(whereLabel())}</span></button>
      <button class="icon-btn vp-leave" id="vp-leave" data-tip="Leave call" aria-label="Leave call">${PHONE_DOWN}</button>
    </div>
    <div class="vp-people" id="vp-people"></div>
    <div class="vp-btns">
      <button class="vp-btn ${call.muted ? 'off' : ''}" id="vp-mute" aria-label="${call.muted ? 'Unmute' : 'Mute'}" data-tip="${call.muted ? 'Unmute' : 'Mute'}">${call.muted ? MIC_OFF : MIC}</button>
      <button class="vp-btn ${call.deafened ? 'off' : ''}" id="vp-deafen" aria-label="${call.deafened ? 'Undeafen' : 'Deafen'}" data-tip="${call.deafened ? 'Undeafen' : 'Deafen'}">${call.deafened ? HEADSET_OFF : HEADSET}</button>
    </div>`;
  renderPeople();
  $('#vp-mute').onclick = toggleMute;
  $('#vp-deafen').onclick = toggleDeafen;
  $('#vp-leave').onclick = () => leaveCall();
  $('#vp-open').onclick = () => { if (call.chatId) actions.openChat(call.chatId, call.channelId); };
}

// The strip at the top of a channel when there's a call going on in it.
function renderBanner() {
  const el = $('#call-banner');
  if (!el) return;
  const live = state.calls.get(el.dataset.channel);
  const mine = call.channelId === el.dataset.channel;
  if (!live || !live.peers.length) {
    el.className = 'hidden';
    el.innerHTML = '';
    return;
  }
  el.className = '';
  const n = live.peers.length;
  el.innerHTML = `<span class="cb-ico">${PHONE}</span><span class="cb-who">${live.peers.slice(0, 6).map((p) => personHtml(p, 24)).join('')}</span>
    <span class="cb-text">${mine ? "You're in this call" : `${n} ${n === 1 ? 'person' : 'people'} in a call`}</span>
    <button class="btn sm ${mine ? 'danger' : 'success'}" id="cb-btn">${mine ? 'Leave' : 'Join Call'}</button>`;
  $('#cb-btn').onclick = () => { if (mine) leaveCall(); else joinCall(el.dataset.channel); };
}

export function renderCallUi() {
  renderPanel();
  renderBanner();
  if (actions.onCallsChanged) actions.onCallsChanged();
}

export function callButtonState(chat, channel) {
  if (isLockedForMe(chat)) return null;
  const mine = call.channelId === channel.id;
  const live = state.calls.get(channel.id);
  return { mine, live: !!live, tip: mine ? 'Leave call' : live ? 'Join call' : chat.type === 'dm' ? `Call ${(dmOther(chat) || {}).name || 'them'}` : 'Start a voice call' };
}

export function callCount(channelId) {
  const live = state.calls.get(channelId);
  return live ? live.peers.length : 0;
}

export function toggleCall(channelId) {
  if (call.channelId === channelId) leaveCall();
  else joinCall(channelId);
}
