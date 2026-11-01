// Messages — main app: boot, navigation, rendering, composer, live updates.
import {
  $, $$, esc, genId, sha256Hex, debounce, copyText, fmtSize, msgTimestamp, timeOnly, fullDate, dayDivider,
  ago, fileKind, fileIcon
} from './util.js';
import { api, session, hooks, checkKey, uploadFile, mediaUrl, ApiError } from './api.js';
import { WS_URL, API_VERSION, MAX_TEXT, MAX_ATTACHMENTS } from './config.js';
import {
  state, actions, prefs, savePrefs, applyAppearance, getUser, userName, statusOf, STATUS_LABEL, dmOther,
  chatName, findChannel, canManage, chatMembers, isChatMuted, chatUnread, isLockedForMe, avatarHtml
} from './store.js';
import { renderMarkdown, extractEmbeds, plainText } from './markdown.js';
import { replaceShortcodes, searchEmoji, isEmojiOnly } from './emoji.js';
import {
  toast, openModal, confirmDialog, openPopover, openMenu, closeTop, hasOpenLayer, lightbox, emojiPicker, gifPicker,
  profilePopout, profileCardHtml, openCodeViewer, openZipViewer
} from './ui.js';
import {
  openSettings, openCreateGroup, openNewDM, openGroupSettings, openChannelEditor, openInvite, openQuickSwitcher
} from './settings.js';
import {
  registerServiceWorker, notifPermission, notifSupported, requestNotifPermission, showDesktopNotification,
  playSound, unlockAudio, setTabBadge, avatarIconFor
} from './notify.js';
import { createZip } from './zip.js';

// ---------------------------------------------------------------------------
// Icons (inline SVG so they follow the theme colour)
// ---------------------------------------------------------------------------
const PATHS = {
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z',
  gear: 'M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7 7 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.84a.5.5 0 0 0-.49.42l-.36 2.54a7 7 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.48a.5.5 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.38 1.05.7 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.84a.5.5 0 0 0 .49-.42l.36-2.54a7 7 0 0 0 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  pin: 'M16 3a1 1 0 0 1 .7 1.7L15 6.4v4.2l2.7 2.7a1 1 0 0 1-.7 1.7h-4v6l-1 1-1-1v-6H7a1 1 0 0 1-.7-1.7L9 10.6V6.4L7.3 4.7A1 1 0 0 1 8 3h8z',
  people: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4zm8 0c-.3 0-.7 0-1.1.1A4.2 4.2 0 0 1 17 17v2h7v-2c0-2.7-5.3-4-8-4z',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  edit: 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-3.5 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 17.5A5.5 5.5 0 0 1 6.9 14h10.2a5.5 5.5 0 0 1-5.1 3.5z',
  more: 'M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
  send: 'M2.5 20.5l19-8.5-19-8.5L2.5 10l13 2-13 2z',
  download: 'M5 20h14v-2H5v2zm7-18v10.2l-3.6-3.6L7 10l5 5 5-5-1.4-1.4-3.6 3.6V2h-2z',
  chevron: 'M7 10l5 5 5-5z',
  logo: 'M7 4h10a5 5 0 0 1 5 5v4a5 5 0 0 1-5 5h-5l-5 4v-4.1A5 5 0 0 1 2 13V9a5 5 0 0 1 5-5zm1 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z'
};
function icon(name, size = 20) {
  if (name === 'bellOff') {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${PATHS.bell}"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
}

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const isMobile = () => window.innerWidth <= 720;

// ---------------------------------------------------------------------------
// Boot / access key / account
// ---------------------------------------------------------------------------
function showScreen(id) {
  ['boot-screen', 'gate-screen', 'onboard-screen'].forEach((s) => $('#' + s).classList.toggle('hidden', s !== id));
  $('#app').classList.toggle('hidden', id !== 'app');
}

function bootMessage(msg, { retry = false, spinner = false } = {}) {
  $('#boot-msg').textContent = msg;
  $('#boot-spinner').classList.toggle('hidden', !spinner);
  $('#boot-actions').innerHTML = retry ? '<button class="btn" id="boot-retry">Try again</button>' : '';
  if (retry) $('#boot-retry').onclick = () => boot();
  showScreen('boot-screen');
}

let authFailing = false;
hooks.onUnauthorized = (err) => {
  if (authFailing) return;
  authFailing = true;
  if (err && err.data && err.data.error === 'bad-token') {
    LS.del('auth_token');
    toast('You were signed out. Sign back in with your login code, or create a new account.', 'error');
  } else {
    LS.del('site_key');
    toast('The access key has changed — please enter the new one.', 'error');
  }
  setTimeout(() => location.reload(), 1600);
};

async function boot() {
  applyAppearance();
  bootMessage('Starting Messages…', { spinner: true });
  registerServiceWorker();
  const key = LS.get('site_key');
  if (!key) return showGate();
  const r = await checkKey(key);
  if (!r.ok) {
    if (r.offline) return bootMessage("Can't reach the server right now. It might be restarting — try again in a moment.", { retry: true });
    LS.del('site_key');
    return showGate(r.error);
  }
  if ((r.api || 1) < API_VERSION) {
    return bootMessage('The server is running an older version of Messages. Redeploy the backend so it matches this page, then try again.', { retry: true });
  }
  session.key = key;
  const token = LS.get('auth_token');
  if (!token) return showOnboarding();
  session.token = token;
  startApp();
}

function showGate(err) {
  showScreen('gate-screen');
  const input = $('#gate-key');
  input.value = '';
  $('#gate-error').textContent = err || '';
  setTimeout(() => input.focus(), 50);
  $('#gate-form').onsubmit = async (e) => {
    e.preventDefault();
    const val = input.value;
    if (!val) return;
    const btn = $('#gate-submit');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    const r = await checkKey(val);
    btn.disabled = false;
    btn.textContent = 'Continue';
    if (!r.ok) {
      $('#gate-error').textContent = r.error;
      input.select();
      return;
    }
    LS.set('site_key', val);
    boot();
  };
}

let triedLegacy = false;
async function showOnboarding(mode = 'new') {
  // People coming from the old version of the app have a profile saved in
  // this browser — upgrade them automatically and keep their identity.
  let legacy = null;
  try { legacy = JSON.parse(LS.get('profile') || 'null'); } catch (e) {}
  if (legacy && legacy.id && legacy.name && mode === 'new' && !triedLegacy) {
    triedLegacy = true;
    bootMessage('Upgrading your account…', { spinner: true });
    try {
      const body = { name: String(legacy.name).slice(0, 32), claimId: legacy.id };
      if (typeof legacy.avatar === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(legacy.avatar) && legacy.avatar.length < 390000) body.avatar = legacy.avatar;
      const res = await api('POST', '/api/users/register', body, { quiet: true });
      LS.set('auth_token', res.token);
      LS.del('profile');
      session.token = res.token;
      toast(`Welcome back, ${res.user.name}! Messages just got a big upgrade ✨`, 'ok');
      return startApp();
    } catch (e) { /* fall back to the normal screen */ }
  }

  showScreen('onboard-screen');
  const form = $('#onboard-form');
  if (mode === 'code') {
    form.innerHTML = `
      <img class="auth-logo" src="icon.svg" alt="">
      <h1>Sign in with a login code</h1>
      <p>Find it in <b>Settings → My Account</b> on a device where you're already signed in.</p>
      <div class="field"><label class="label" for="ob-code">Login code</label><input class="input" id="ob-code" autocomplete="off" spellcheck="false"></div>
      <div class="error" id="ob-err"></div>
      <button class="btn block" type="submit" id="ob-go">Sign In</button>
      <div class="auth-alt"><button type="button" id="ob-switch">← Create a new account instead</button></div>`;
    setTimeout(() => $('#ob-code').focus(), 50);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const code = $('#ob-code').value.trim();
      if (!code) return;
      session.token = code;
      try {
        await api('GET', '/api/me', undefined, { quiet: true });
        LS.set('auth_token', code);
        startApp();
      } catch (err) {
        session.token = null;
        $('#ob-err').textContent = err.status === 401 ? "That login code isn't valid." : err.message;
      }
    };
  } else {
    form.innerHTML = `
      <img class="auth-logo" src="icon.svg" alt="">
      <h1>Welcome to Messages!</h1>
      <p>Pick a display name — it's how everyone will see you. You can add a profile picture right after.</p>
      <div class="field"><label class="label" for="ob-name">Display name <span class="req">*</span></label><input class="input" id="ob-name" maxlength="32" autocomplete="nickname"></div>
      <div class="error" id="ob-err"></div>
      <button class="btn block" type="submit" id="ob-go">Continue</button>
      <div class="auth-alt">Already have an account? <button type="button" id="ob-switch">Use a login code</button></div>`;
    setTimeout(() => $('#ob-name').focus(), 50);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#ob-name').value.trim();
      if (!name) { $('#ob-err').textContent = 'Please enter a name.'; return; }
      $('#ob-go').disabled = true;
      try {
        const res = await api('POST', '/api/users/register', { name }, { quiet: true });
        LS.set('auth_token', res.token);
        session.token = res.token;
        await startApp();
        setTimeout(() => toast('Tip: click your name in the bottom-left to set a picture and status.'), 1200);
      } catch (err) {
        $('#ob-err').textContent = err.message;
        $('#ob-go').disabled = false;
      }
    };
  }
  $('#ob-switch').onclick = () => showOnboarding(mode === 'code' ? 'new' : 'code');
}

async function startApp() {
  bootMessage('Loading your chats…', { spinner: true });
  let data;
  try {
    data = await api('GET', '/api/bootstrap');
  } catch (e) {
    if (e.status === 401) return;
    return bootMessage(e.message || 'Something went wrong.', { retry: true });
  }
  ingestBootstrap(data);
  restoreUnlocks();
  showScreen('app');
  connectWS();
  if (!routeFromHash(location.hash, false)) {
    const last = prefs.lastView;
    if (last && last.type === 'chat' && state.chats.has(last.chatId)) openChat(last.chatId, last.channelId, { push: false });
    else goHome({ push: false });
  }
  if (isMobile() && state.view.type === 'home') document.body.classList.add('nav-open');
  refreshNotifBanner();
}

// ---------------------------------------------------------------------------
// Data ingest
// ---------------------------------------------------------------------------
function ingestBootstrap(data) {
  state.me = data.me;
  state.reads = Object.assign({}, data.me.reads || {});
  if (data.maxUploadBytes) state.maxUploadBytes = data.maxUploadBytes;
  state.users = new Map((data.users || []).map((u) => [u.id, u]));
  state.chats = new Map();
  (data.chats || []).forEach(ingestChat);
  state.online = new Map((data.online || []).map((o) => [o.id, o.status]));
}

function ingestChat(c) {
  state.chats.set(c.id, c);
  c.channels.forEach((ch) => {
    if (typeof ch.unread === 'number') state.unread.set(ch.id, { count: ch.unread, mentions: ch.mentions || 0 });
    if (ch.lastRead && !(state.reads[ch.id] > ch.lastRead)) state.reads[ch.id] = ch.lastRead;
  });
  if (c.reads) state.dmReads.set(c.id, Object.assign(state.dmReads.get(c.id) || {}, c.reads));
}

function upsertChat(c) {
  const prev = state.chats.get(c.id);
  const wasLocked = prev ? isLockedForMe(prev) : null;
  ingestChat(c);
  const v = state.view;
  if (v.type === 'chat' && v.chatId === c.id) {
    if (!c.channels.find((ch) => ch.id === v.channelId)) {
      openChat(c.id, c.channels[0].id, { push: false });
      return;
    }
    if (wasLocked !== isLockedForMe(c)) { renderChrome(); renderCenter(); return; }
  }
  if (state.suppressReadFor !== v.channelId && v.type === 'chat' && v.chatId === c.id) markReadSoon();
  renderChrome();
}

function removeChat(chatId) {
  const chat = state.chats.get(chatId);
  state.chats.delete(chatId);
  if (chat) chat.channels.forEach((ch) => { state.messages.delete(ch.id); state.unread.delete(ch.id); });
  if (state.view.type === 'chat' && state.view.chatId === chatId) {
    toast(`${chat ? chatName(chat) : 'That chat'} is no longer available.`);
    goHome({ push: false });
  } else {
    renderChrome();
  }
}

function setMe(user) {
  state.me = Object.assign({}, state.me, user, { reads: state.me.reads });
  const pub = Object.assign({}, state.users.get(user.id) || {}, user);
  delete pub.reads;
  state.users.set(user.id, pub);
  refreshAll();
}

function restoreUnlocks() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('unlocked') || '{}');
    Object.keys(saved).forEach((k) => state.unlocked.set(k, saved[k]));
  } catch (e) {}
}

function rememberUnlock(chatId, hash) {
  state.unlocked.set(chatId, hash);
  try { sessionStorage.setItem('unlocked', JSON.stringify(Object.fromEntries(state.unlocked))); } catch (e) {}
  wsSend({ type: 'unlock', chatId, passwordHash: hash });
}

function forgetUnlock(chatId) {
  state.unlocked.delete(chatId);
  try { sessionStorage.setItem('unlocked', JSON.stringify(Object.fromEntries(state.unlocked))); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Navigation + routing
// ---------------------------------------------------------------------------
function setRoute(path, push) {
  const hash = '#' + path;
  if (location.hash === hash) return;
  if (push) history.pushState(null, '', hash);
  else history.replaceState(null, '', hash);
}

function routeFromHash(hash, push) {
  const m = /^#\/c\/([\w-]+)(?:\/([\w-]+))?(?:\/([\w-]+))?/.exec(hash || '');
  if (m && state.chats.has(m[1])) {
    openChat(m[1], m[2], { jumpTo: m[3], push });
    return true;
  }
  if (/^#\/home/.test(hash || '')) { goHome({ push }); return true; }
  return false;
}
window.addEventListener('popstate', () => { if (state.me) routeFromHash(location.hash, false); });

function leaveCurrentChannel() {
  const v = state.view;
  if (v.type === 'chat') {
    const input = $('#c-input');
    if (input) saveDraftNow(v.channelId, input.value);
    stopTyping();
  }
  state.pending.forEach((p) => { if (p.status === 'uploading' && p.abort) p.abort(); if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
  state.pending = [];
  state.replyTo = null;
  state.editingId = null;
  state.suppressReadFor = null;
  state.newMarkerTs = null;
  closeAutocomplete();
}

function goHome({ push = true } = {}) {
  leaveCurrentChannel();
  state.view = { type: 'home' };
  prefs.lastView = state.view;
  savePrefs();
  if (state.rightPanel === 'search') { state.rightPanel = null; state.search = null; }
  setRoute('/home', push);
  renderChrome();
  renderCenter();
}

async function openChat(chatId, channelId, { jumpTo, push = true } = {}) {
  const chat = state.chats.get(chatId);
  if (!chat) { toast("That chat doesn't exist anymore.", 'error'); return; }
  if (!channelId || !chat.channels.find((c) => c.id === channelId)) {
    const last = prefs.lastChannel[chatId];
    channelId = last && chat.channels.find((c) => c.id === last) ? last : chat.channels[0].id;
  }
  const same = state.view.type === 'chat' && state.view.channelId === channelId;
  if (!same) leaveCurrentChannel();
  if (chat.type === 'dm' && prefs.hiddenDMs[chatId]) delete prefs.hiddenDMs[chatId];
  state.view = { type: 'chat', chatId, channelId };
  prefs.lastChannel[chatId] = channelId;
  prefs.lastView = state.view;
  savePrefs();
  if (!same && state.rightPanel === 'search' && state.search && state.search.scope === 'chat' && state.search.chatId !== chatId) {
    state.rightPanel = null;
    state.search = null;
  }
  setRoute(`/c/${chatId}/${channelId}`, push && !same);
  document.body.classList.remove('nav-open');
  renderChrome();
  if (same && jumpTo) { jumpToMessage(jumpTo); return; }
  if (same && !jumpTo) return;
  await renderCenter({ jumpTo });
}

async function openDM(userId) {
  if (state.me && userId === state.me.id) { openSettings('profile'); return; }
  const existing = Array.from(state.chats.values()).find((c) => c.type === 'dm' && c.memberIds && c.memberIds.includes(userId) && c.memberIds.includes(state.me.id));
  if (existing) return openChat(existing.id);
  try {
    const res = await api('POST', '/api/chats', { type: 'dm', userId });
    ingestChat(res.chat);
    openChat(res.chat.id);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function currentChat() {
  const v = state.view;
  if (v.type !== 'chat') return {};
  const chat = state.chats.get(v.chatId);
  const channel = chat && chat.channels.find((c) => c.id === v.channelId);
  return { chat, channel };
}

// Expose for other modules
Object.assign(actions, {
  openChat, openDM, goHome, openSettings, setMe, upsertChat, removeChat, rememberUnlock, refreshAll,
  refreshChrome: () => { renderUserPanel(); updateBadges(); refreshNotifBanner(); },
  setMuteAll, openStatusMenu
});

// ---------------------------------------------------------------------------
// Chrome: rail, sidebar, user panel, header, right panel
// ---------------------------------------------------------------------------
function renderChrome() {
  renderRail();
  renderSidebar();
  renderUserPanel();
  renderHeader();
  renderRightPanel();
  updateBadges();
}

function refreshAll() {
  renderChrome();
  if (state.view.type === 'chat' && $('#msg-list')) rerenderMessagesKeepScroll();
  else if (state.view.type === 'home') drawPeople();
}

function activeGroupId() {
  const v = state.view;
  if (v.type !== 'chat') return null;
  const c = state.chats.get(v.chatId);
  return c && c.type === 'group' ? c.id : null;
}

function sortedGroups() {
  return Array.from(state.chats.values()).filter((c) => c.type === 'group').sort((a, b) => a.createdAt - b.createdAt);
}

function sortedDMs() {
  return Array.from(state.chats.values()).filter((c) => c.type === 'dm')
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
}

function renderRail() {
  const rail = $('#rail');
  const activeGroup = activeGroupId();
  let dmMentions = 0;
  const unreadDMs = [];
  sortedDMs().forEach((c) => {
    const u = chatUnread(c);
    if (u.count && !isChatMuted(c.id)) { dmMentions += u.count; unreadDMs.push({ c, u }); }
  });
  let html = `<div class="rail-item ${!activeGroup ? 'active' : ''}"><span class="rail-pill"></span>
    <button class="rail-btn home" data-nav="home" data-tip="Direct Messages" data-tip-pos="right-center" aria-label="Home">${icon('logo', 28)}</button>
    ${dmMentions ? `<span class="rail-badge">${dmMentions > 99 ? '99+' : dmMentions}</span>` : ''}</div>`;
  unreadDMs.slice(0, 5).forEach(({ c, u }) => {
    const o = dmOther(c);
    html += `<div class="rail-item rail-dm"><span class="rail-pill"></span><button class="rail-btn" data-nav="chat" data-id="${esc(c.id)}" data-tip="${esc(o ? o.name : 'DM')}" data-tip-pos="right-center">${avatarHtml(o, 48)}</button><span class="rail-badge">${u.count > 99 ? '99+' : u.count}</span></div>`;
  });
  html += '<div class="rail-sep"></div>';
  sortedGroups().forEach((c) => {
    const u = chatUnread(c);
    const muted = isChatMuted(c.id);
    const src = mediaUrl(c.icon);
    html += `<div class="rail-item ${c.id === activeGroup ? 'active' : ''} ${u.count && !muted ? 'unread' : ''}"><span class="rail-pill"></span>
      <button class="rail-btn" data-nav="chat" data-id="${esc(c.id)}" data-tip="${esc(c.name)}" data-tip-pos="right-center" style="${src ? '' : ''}">${src ? `<img src="${esc(src)}" alt="">` : esc(initialsFor(c.name))}</button>
      ${u.mentions && !muted ? `<span class="rail-badge">${u.mentions > 99 ? '99+' : u.mentions}</span>` : ''}</div>`;
  });
  html += `<div class="rail-item"><button class="rail-btn add" data-nav="new-group" data-tip="Create a group" data-tip-pos="right-center" aria-label="Create a group">+</button></div>`;
  rail.innerHTML = html;
}

function initialsFor(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.slice(0, 3).map((w) => Array.from(w)[0]).join('') : Array.from(words[0] || '?').slice(0, 2).join('');
}

$('#rail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]');
  if (!b) return;
  if (b.dataset.nav === 'home') {
    goHome();
  } else if (b.dataset.nav === 'chat') {
    openChat(b.dataset.id);
  } else if (b.dataset.nav === 'new-group') openCreateGroup();
});
$('#rail').addEventListener('contextmenu', (e) => {
  const b = e.target.closest('[data-nav=chat]');
  if (!b) return;
  e.preventDefault();
  const chat = state.chats.get(b.dataset.id);
  if (chat) chatContextMenu(chat, { x: e.clientX, y: e.clientY });
});

function chatContextMenu(chat, anchor) {
  const muted = isChatMuted(chat.id);
  const items = [
    { label: 'Mark As Read', icon: '✅', onClick: () => markChatRead(chat) },
    { label: muted ? 'Unmute' : 'Mute', icon: muted ? '🔔' : '🔕', onClick: () => toggleChatMute(chat.id) }
  ];
  if (chat.type === 'dm') {
    const o = dmOther(chat);
    items.push({ label: 'Profile', icon: '👤', onClick: () => o && profilePopout(anchor, o.id, 'right-start') });
    items.push({ sep: true }, { label: 'Close DM', icon: '✕', onClick: () => closeDM(chat.id) });
  } else {
    items.push({ label: 'Invite People', icon: '➕', onClick: () => openInvite(chat.id) });
    if (canManage(chat)) items.push({ label: 'Group Settings', icon: '⚙️', onClick: () => openGroupSettings(chat.id) });
    if (Array.isArray(chat.memberIds)) items.push({ sep: true }, { label: 'Leave Group', icon: '🚪', danger: true, onClick: () => leaveGroup(chat) });
  }
  openMenu(anchor, items, { placement: 'right-start' });
}

function renderSidebar() {
  const header = $('#sidebar-header');
  const body = $('#sidebar-body');
  const gid = activeGroupId();
  if (!gid) {
    header.className = '';
    header.innerHTML = `<button class="search-fake" id="find-btn">Find or start a conversation</button>`;
    $('#find-btn').onclick = openQuickSwitcher;
    const hidden = prefs.hiddenDMs || {};
    const dms = sortedDMs().filter((c) => !(hidden[c.id] && hidden[c.id] >= (c.lastMessageAt || 0)));
    let html = `<div class="side-item ${state.view.type === 'home' ? 'active' : ''}" data-home><span class="big-ico">${icon('people', 22)}</span><span class="name">People</span></div>`;
    html += `<div class="side-section"><span>Direct Messages</span><button data-new-dm data-tip="Create DM" aria-label="New DM">+</button></div>`;
    if (!dms.length) {
      html += `<div class="side-empty">No conversations yet.<br><a href="#" data-new-dm>Message someone</a> to get started!</div>`;
    }
    dms.forEach((c) => {
      const o = dmOther(c);
      const u = chatUnread(c);
      const ch = c.channels[0];
      const active = state.view.type === 'chat' && state.view.chatId === c.id;
      let sub = o && o.customStatus ? o.customStatus : '';
      if (!sub && ch.lastMessage && ch.lastMessage.preview) {
        sub = (ch.lastMessage.senderId === state.me.id ? 'You: ' : '') + plainText(ch.lastMessage.preview, userName);
      }
      html += `<div class="side-item ${active ? 'active' : ''} ${u.count ? 'unread' : ''} ${isChatMuted(c.id) ? 'muted-chat' : ''}" data-chat="${esc(c.id)}">
        ${avatarHtml(o, 32, { status: true })}
        <div style="flex:1;min-width:0"><span class="name">${esc(o ? o.name : 'Unknown')}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>
        ${u.count && !isChatMuted(c.id) ? `<span class="badge">${u.count > 99 ? '99+' : u.count}</span>` : ''}
        <span class="item-actions"><button data-close-dm="${esc(c.id)}" data-tip="Close DM" aria-label="Close DM">✕</button></span>
      </div>`;
    });
    body.innerHTML = html;
    return;
  }

  const chat = state.chats.get(gid);
  header.className = 'clickable';
  header.innerHTML = `<span class="title">${chat.locked ? '🔒 ' : ''}${esc(chat.name)}</span>${icon('chevron', 18)}`;
  header.onclick = () => groupMenu(chat, header);
  const manage = canManage(chat);
  let html = '';
  if (chat.description) html += `<div class="group-about">${esc(chat.description)}</div>`;
  html += `<div class="side-section"><span>Text Channels</span>${manage ? '<button data-new-channel data-tip="Create Channel" aria-label="Create channel">+</button>' : ''}</div>`;
  chat.channels.forEach((ch) => {
    const u = state.unread.get(ch.id) || { count: 0, mentions: 0 };
    const active = state.view.channelId === ch.id;
    const muted = isChatMuted(chat.id);
    html += `<div class="side-item ${active ? 'active' : ''} ${u.count && !muted ? 'unread' : ''}" data-chat="${esc(chat.id)}" data-channel="${esc(ch.id)}" ${ch.topic ? `title="${esc(ch.topic)}"` : ''}>
      <span class="hash">#</span><span class="name">${esc(ch.name)}</span>
      ${u.mentions && !muted ? `<span class="badge">${u.mentions}</span>` : ''}
      ${manage ? `<span class="item-actions"><button data-edit-channel="${esc(ch.id)}" data-tip="Edit Channel" aria-label="Edit channel">⚙</button></span>` : ''}
    </div>`;
  });
  const members = chatMembers(chat);
  html += `<div class="side-section"><span>${Array.isArray(chat.memberIds) ? '🔐 Private' : '🌍 Open to everyone'} · ${members.length}</span></div>`;
  body.innerHTML = html;
}

$('#sidebar-body').addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-new-dm]')) { e.preventDefault(); openNewDM(); return; }
  const cd = t.closest('[data-close-dm]');
  if (cd) { e.stopPropagation(); closeDM(cd.dataset.closeDm); return; }
  if (t.closest('[data-new-channel]')) { const c = state.chats.get(activeGroupId()); if (c) openChannelEditor(c, null); return; }
  const ec = t.closest('[data-edit-channel]');
  if (ec) {
    e.stopPropagation();
    const c = state.chats.get(activeGroupId());
    if (c) openChannelEditor(c, c.channels.find((x) => x.id === ec.dataset.editChannel));
    return;
  }
  if (t.closest('[data-home]')) { goHome(); return; }
  const row = t.closest('[data-chat]');
  if (row) openChat(row.dataset.chat, row.dataset.channel);
});
$('#sidebar-body').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('[data-chat]');
  if (!row) return;
  const chat = state.chats.get(row.dataset.chat);
  if (!chat) return;
  e.preventDefault();
  chatContextMenu(chat, { x: e.clientX, y: e.clientY });
});

function groupMenu(chat, anchor) {
  const manage = canManage(chat);
  const muted = isChatMuted(chat.id);
  const items = [{ label: 'Invite People', icon: '➕', onClick: () => openInvite(chat.id) }];
  if (manage) {
    items.push({ label: 'Group Settings', icon: '⚙️', onClick: () => openGroupSettings(chat.id) });
    items.push({ label: 'Create Channel', icon: '#', onClick: () => openChannelEditor(chat, null) });
  }
  items.push({ sep: true });
  items.push({ label: muted ? 'Unmute Group' : 'Mute Group', sub: muted ? 'Notifications are off' : 'Stop notifications from this group', icon: muted ? '🔔' : '🔕', onClick: () => toggleChatMute(chat.id) });
  items.push({ label: 'Mark As Read', icon: '✅', onClick: () => markChatRead(chat) });
  items.push({ label: 'Copy Link', icon: '🔗', onClick: async () => { if (await copyText(location.origin + location.pathname + `#/c/${chat.id}`)) toast('Link copied', 'ok'); } });
  if (Array.isArray(chat.memberIds) || (manage && chat.ownerId)) items.push({ sep: true });
  if (Array.isArray(chat.memberIds)) items.push({ label: 'Leave Group', icon: '🚪', danger: true, onClick: () => leaveGroup(chat) });
  if (manage && chat.ownerId) items.push({ label: 'Delete Group', icon: '🗑️', danger: true, onClick: () => openGroupSettings(chat.id, 'overview') && null });
  const pop = openMenu(anchor, items, { placement: 'bottom-center' });
  pop.el.style.width = Math.max(220, anchor.offsetWidth - 16) + 'px';
  pop.reposition();
}

async function leaveGroup(chat) {
  const ok = await confirmDialog({ title: `Leave '${chat.name}'`, body: "You won't be able to see it again unless someone adds you back.", confirm: 'Leave Group', danger: true });
  if (!ok) return;
  try {
    await api('POST', `/api/chats/${chat.id}/leave`);
    removeChat(chat.id);
  } catch (e) { toast(e.message, 'error'); }
}

function closeDM(chatId) {
  prefs.hiddenDMs[chatId] = Date.now();
  savePrefs();
  if (state.view.type === 'chat' && state.view.chatId === chatId) goHome();
  else renderSidebar();
}

function toggleChatMute(chatId) {
  if (prefs.mutedChats[chatId]) delete prefs.mutedChats[chatId];
  else prefs.mutedChats[chatId] = true;
  savePrefs();
  const chat = state.chats.get(chatId);
  toast(prefs.mutedChats[chatId] ? `🔕 Muted ${chatName(chat)}` : `🔔 Unmuted ${chatName(chat)}`);
  renderChrome();
}

function markChatRead(chat) {
  chat.channels.forEach((ch) => {
    const u = state.unread.get(ch.id);
    if (u && (u.count || u.mentions)) {
      state.unread.set(ch.id, { count: 0, mentions: 0 });
      api('POST', `/api/channels/${ch.id}/read`, {}).catch(() => {});
    }
  });
  renderChrome();
}

function setMuteAll(on) {
  prefs.muteAll = !!on;
  savePrefs();
  renderUserPanel();
  toast(on ? '🔕 All notifications muted' : '🔔 Notifications are back on');
}

function renderUserPanel() {
  const me = state.me;
  if (!me) return;
  const st = statusOf(me.id);
  $('#user-panel').innerHTML = `
    <div class="me-card" id="me-card" data-tip="Set status">${avatarHtml(me, 32, { status: true })}
      <div class="meta"><div class="n">${esc(me.name)}</div><div class="s">${esc(me.customStatus || STATUS_LABEL[st] || 'Online')}</div></div></div>
    <button class="icon-btn ${prefs.muteAll ? 'danger-on' : ''}" id="mute-btn" data-tip="${prefs.muteAll ? 'Unmute notifications' : 'Mute all notifications'}" aria-label="Toggle notifications">${icon(prefs.muteAll ? 'bellOff' : 'bell')}</button>
    <button class="icon-btn" id="settings-btn" data-tip="User Settings" aria-label="Settings">${icon('gear')}</button>`;
  $('#me-card').onclick = (e) => openStatusMenu(e.currentTarget);
  $('#mute-btn').onclick = () => setMuteAll(!prefs.muteAll);
  $('#settings-btn').onclick = () => openSettings();
}

function openStatusMenu(anchor, after) {
  const opt = (s, d) => ({
    label: STATUS_LABEL[s], sub: d, icon: `<span class="status-ico s-${s}"></span>`,
    onClick: () => setStatus(s).then(() => after && after())
  });
  openMenu(anchor, [
    opt('online', ''),
    opt('idle', ''),
    opt('dnd', 'You will not get desktop notifications'),
    opt('invisible', "You'll appear offline, but still have full access"),
    { sep: true },
    { label: state.me.customStatus ? 'Edit Custom Status' : 'Set a Custom Status', icon: '💬', onClick: customStatusDialog },
    { label: 'Edit Profile', icon: '✏️', onClick: () => openSettings('profile') }
  ], { placement: 'top-start' });
}

async function setStatus(s) {
  try {
    const res = await api('PATCH', '/api/me', { status: s });
    setMe(res.user);
  } catch (e) { toast(e.message, 'error'); }
}

function customStatusDialog() {
  const m = openModal(`
    <div class="modal-head"><h2>Set a custom status</h2><button class="icon-btn close" data-close aria-label="Close">✕</button></div>
    <div class="modal-body"><label class="label">What's cookin', ${esc(state.me.name)}?</label>
      <input class="input" id="cs-text" maxlength="80" placeholder="Support has arrived!" value="${esc(state.me.customStatus || '')}"></div>
    <div class="modal-foot"><button class="btn ghost left" id="cs-clear">Clear</button><button class="btn ghost" data-close>Cancel</button><button class="btn" id="cs-save">Save</button></div>`);
  const save = async (text) => {
    try {
      const res = await api('PATCH', '/api/me', { customStatus: text });
      setMe(res.user);
      m.close();
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#cs-save', m.el).onclick = () => save($('#cs-text', m.el).value);
  $('#cs-clear', m.el).onclick = () => save('');
  $('#cs-text', m.el).onkeydown = (e) => { if (e.key === 'Enter') save(e.target.value); };
}

function renderHeader() {
  const h = $('#main-header');
  const v = state.view;
  const menuBtn = `<button class="icon-btn" id="menu-btn" aria-label="Open navigation">${icon('menu', 22)}</button>`;
  const searchVal = state.search ? esc(state.search.query) : '';
  if (v.type === 'home') {
    h.innerHTML = `${menuBtn}<div class="h-title">${icon('people', 22)} People</div><div class="h-divider"></div>
      <div class="tabs"><button class="tab ${state.homeTab === 'online' ? 'active' : ''}" data-tab="online">Online</button>
      <button class="tab ${state.homeTab === 'all' ? 'active' : ''}" data-tab="all">All</button>
      <button class="tab cta" data-act="new-dm">New Message</button></div><div class="h-spacer"></div>
      <div class="h-actions"><input class="h-search" id="h-search" placeholder="Search all messages" value="${searchVal}"></div>`;
  } else {
    const { chat, channel } = currentChat();
    if (!chat) return;
    const muted = isChatMuted(chat.id);
    let title;
    let topic;
    if (chat.type === 'dm') {
      const o = dmOther(chat);
      title = `<span class="at">@</span>${esc(o ? o.name : 'Unknown')} <span class="status-ico s-${statusOf(o && o.id)}" id="h-status"></span>`;
      topic = o && o.customStatus ? esc(o.customStatus) : '';
    } else {
      title = `<span class="hash">#</span>${esc(channel.name)}`;
      topic = channel.topic ? esc(channel.topic) : '';
    }
    const rightOn = state.rightPanel === 'search' ? false : prefs.memberList;
    h.innerHTML = `${menuBtn}<div class="h-title">${title}</div>${topic ? `<div class="h-divider"></div><div class="h-topic" title="${topic}">${topic}</div>` : '<div class="h-spacer"></div>'}
      <div class="h-actions">
        <button class="icon-btn ${muted ? 'danger-on' : ''}" data-act="mute-chat" data-tip="${muted ? 'Unmute' : 'Mute'} ${chat.type === 'dm' ? 'conversation' : 'group'}" data-tip-pos="bottom-center">${icon(muted ? 'bellOff' : 'bell')}</button>
        <button class="icon-btn" data-act="pins" data-tip="Pinned Messages" data-tip-pos="bottom-center">${icon('pin')}</button>
        <button class="icon-btn ${rightOn ? 'on' : ''}" data-act="toggle-right" data-tip="${chat.type === 'dm' ? 'User Profile' : 'Member List'}" data-tip-pos="bottom-center">${icon(chat.type === 'dm' ? 'person' : 'people')}</button>
        <input class="h-search" id="h-search" placeholder="Search" value="${searchVal}">
      </div>`;
  }
  $('#menu-btn').onclick = () => document.body.classList.add('nav-open');
  const s = $('#h-search');
  s.onkeydown = (e) => {
    if (e.key === 'Enter' && s.value.trim().length >= 2) runSearch(s.value.trim());
    if (e.key === 'Escape') { s.value = ''; s.blur(); }
  };
}

$('#main-header').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { state.homeTab = tab.dataset.tab; renderHeader(); drawPeople(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { chat } = currentChat();
  if (b.dataset.act === 'new-dm') openNewDM();
  else if (b.dataset.act === 'mute-chat' && chat) toggleChatMute(chat.id);
  else if (b.dataset.act === 'pins') openPins(b);
  else if (b.dataset.act === 'toggle-right') {
    if (state.rightPanel === 'search') { state.rightPanel = null; state.search = null; prefs.memberList = true; }
    else if (window.innerWidth <= 900) { state.rightForced = !state.rightForced; prefs.memberList = true; }
    else prefs.memberList = !prefs.memberList;
    savePrefs();
    renderHeader();
    renderRightPanel();
  }
});
$('#nav-scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

function renderRightPanel() {
  const rp = $('#right-panel');
  const v = state.view;
  let mode = state.rightPanel === 'search' ? 'search' : null;
  const { chat } = currentChat();
  if (!mode && v.type === 'chat' && chat && (prefs.memberList || state.rightForced)) mode = chat.type === 'dm' ? 'profile' : 'members';
  if (!mode) { rp.classList.add('hidden'); rp.innerHTML = ''; return; }
  rp.classList.remove('hidden');
  rp.classList.toggle('wide', mode === 'search');
  rp.classList.toggle('forced', mode === 'search' || !!state.rightForced);

  if (mode === 'members') {
    const members = chatMembers(chat);
    const on = [];
    const off = [];
    members.forEach((u) => { (['offline', 'invisible'].includes(statusOf(u.id)) ? off : on).push(u); });
    const byName = (a, b) => a.name.localeCompare(b.name);
    const row = (u, offline) => `<div class="member ${offline ? 'offline' : ''}" data-user="${esc(u.id)}">${avatarHtml(u, 32, { status: true })}
      <div class="meta"><div class="n">${esc(u.name)}${chat.ownerId === u.id ? '<span class="crown" title="Group owner">👑</span>' : ''}</div>${u.customStatus ? `<div class="s">${esc(u.customStatus)}</div>` : ''}</div></div>`;
    rp.innerHTML = `<div class="members">
      <div class="side-section"><span>Online — ${on.length}</span></div>${on.sort(byName).map((u) => row(u, false)).join('')}
      ${off.length ? `<div class="side-section"><span>Offline — ${off.length}</span></div>${off.sort(byName).map((u) => row(u, true)).join('')}` : ''}
    </div>`;
  } else if (mode === 'profile') {
    const o = dmOther(chat);
    rp.innerHTML = o ? `<div class="profile-panel">${profileCardHtml(o, { wide: true })}</div>` : '';
    const pa = rp.querySelector('.pp-actions');
    if (pa) pa.remove();
  } else if (mode === 'search') {
    const s = state.search || {};
    const scopeBtns = v.type === 'chat'
      ? `<div style="display:flex;gap:6px;padding:0 4px 8px"><button class="btn xs ${s.scope === 'chat' ? '' : 'secondary'}" data-scope="chat">This chat</button><button class="btn xs ${s.scope === 'all' ? '' : 'secondary'}" data-scope="all">Everywhere</button></div>` : '';
    let body;
    if (s.loading) body = '<div class="empty-state">Searching…</div>';
    else if (s.error) body = `<div class="empty-state">${esc(s.error)}</div>`;
    else if (!s.results || !s.results.length) body = `<div class="empty-state"><div class="art">🔎</div><h3>No results</h3>Try different words. You can also use <b>from:name</b>, <b>has:file</b>, <b>has:image</b> or <b>has:link</b>.</div>`;
    else {
      body = s.results.map((r) => {
        const c = state.chats.get(r.chatId);
        const ch = c && c.channels.find((x) => x.id === r.channelId);
        const where = c ? (c.type === 'dm' ? '@' + chatName(c) : `${c.name} › #${ch ? ch.name : '?'}`) : '';
        return `<div class="result" data-chat="${esc(r.chatId)}" data-channel="${esc(r.channelId)}" data-msg="${esc(r.message.id)}"><div class="where">${esc(where)}</div>${messageHtml(r.message, null, { head: true, noTools: true })}</div>`;
      }).join('');
    }
    rp.innerHTML = `<div class="search-results">
      <div class="hdr"><span>${s.loading ? 'Searching' : `${(s.results || []).length}${s.total > (s.results || []).length ? '+' : ''} result${(s.results || []).length === 1 ? '' : 's'}`} for “${esc(s.query || '')}”</span><button class="icon-btn" data-close-search aria-label="Close search">✕</button></div>
      ${scopeBtns}${body}</div>`;
    highlightTerms(rp, s.query);
  }
}

function highlightTerms(root, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter((t) => t.length > 1 && !t.includes(':'));
  if (!terms.length) return;
  root.querySelectorAll('.result .msg-content').forEach((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      const lower = n.nodeValue.toLowerCase();
      const t = terms.find((x) => lower.includes(x));
      if (!t) return;
      const i = lower.indexOf(t);
      const mark = document.createElement('mark');
      const mid = n.splitText(i);
      mid.splitText(t.length);
      mark.textContent = mid.nodeValue;
      mid.replaceWith(mark);
    });
  });
}

$('#right-panel').addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-close-search]')) { state.rightPanel = null; state.search = null; state.rightForced = false; renderHeader(); renderRightPanel(); return; }
  const sc = t.closest('[data-scope]');
  if (sc) { runSearch(state.search.query, sc.dataset.scope); return; }
  const res = t.closest('.result');
  if (res) {
    if (window.innerWidth <= 900) { state.rightPanel = null; state.rightForced = false; }
    openChat(res.dataset.chat, res.dataset.channel, { jumpTo: res.dataset.msg });
    return;
  }
  const u = t.closest('.member[data-user]');
  if (u) { profilePopout(u, u.dataset.user, 'left-start'); }
});

async function runSearch(query, scope) {
  const v = state.view;
  scope = scope || (state.search && state.search.query === query && state.search.scope) || (v.type === 'chat' ? 'chat' : 'all');
  const chatId = scope === 'chat' && v.type === 'chat' ? v.chatId : null;
  state.rightPanel = 'search';
  state.search = { query, scope, chatId, loading: true };
  renderHeader();
  renderRightPanel();
  try {
    const qs = new URLSearchParams({ q: query });
    if (chatId) qs.set('chatId', chatId);
    const res = await api('GET', '/api/search?' + qs, undefined, { chatPass: chatId ? state.unlocked.get(chatId) : undefined });
    if (state.search && state.search.query === query) Object.assign(state.search, { loading: false, results: res.results, total: res.total });
  } catch (e) {
    if (state.search) Object.assign(state.search, { loading: false, error: e.message });
  }
  renderRightPanel();
}

// ---------------------------------------------------------------------------
// Center: home (people) or chat
// ---------------------------------------------------------------------------
async function renderCenter(opts = {}) {
  const center = $('#center');
  if (state.view.type === 'home') {
    center.innerHTML = `<div class="people"><div class="search-row"><input class="input" id="people-q" placeholder="Search people" autocomplete="off"></div>
      <div class="count" id="people-count"></div><div class="scroller thin" id="people-list" style="flex:1;min-height:0"></div></div>`;
    $('#people-q').oninput = drawPeople;
    drawPeople();
    return;
  }
  await renderChannel(opts);
}

function drawPeople() {
  const list = $('#people-list');
  if (!list) return;
  const q = ($('#people-q') || {}).value ? $('#people-q').value.trim().toLowerCase() : '';
  let users = Array.from(state.users.values()).filter((u) => u.id !== state.me.id);
  const isOn = (u) => !['offline', 'invisible'].includes(statusOf(u.id));
  if (state.homeTab === 'online') users = users.filter(isOn);
  if (q) users = users.filter((u) => u.name.toLowerCase().includes(q));
  users.sort((a, b) => (isOn(b) - isOn(a)) || a.name.localeCompare(b.name));
  $('#people-count').textContent = `${state.homeTab === 'online' ? 'Online' : 'All people'} — ${users.length}`;
  if (!users.length) {
    list.innerHTML = state.homeTab === 'online' && !q
      ? `<div class="empty-state"><div class="art">🌙</div><h3>It's quiet in here…</h3>Nobody else is online right now. Check the <a href="#" data-all>All</a> tab — you can message people even when they're offline.</div>`
      : `<div class="empty-state"><div class="art">🔍</div><h3>No one found</h3>${state.users.size <= 1 ? 'Nobody else has joined yet. Share the site and the access key with your friends!' : 'Try a different name.'}</div>`;
    const a = list.querySelector('[data-all]');
    if (a) a.onclick = (e) => { e.preventDefault(); state.homeTab = 'all'; renderHeader(); drawPeople(); };
    return;
  }
  list.innerHTML = users.map((u) => {
    const st = statusOf(u.id);
    const sub = u.customStatus || (st === 'offline' ? (u.lastSeen ? 'Last seen ' + ago(u.lastSeen) : 'Offline') : STATUS_LABEL[st]);
    return `<div class="person" data-user="${esc(u.id)}">${avatarHtml(u, 36, { status: true })}
      <div style="min-width:0"><div class="n">${esc(u.name)}</div><div class="s">${esc(sub)}</div></div>
      <div class="acts"><button class="round-btn" data-dm="${esc(u.id)}" data-tip="Message">💬</button><button class="round-btn" data-prof="${esc(u.id)}" data-tip="Profile">${icon('more', 18)}</button></div></div>`;
  }).join('');
}

$('#center').addEventListener('click', (e) => {
  if (state.view.type !== 'home') return;
  const dm = e.target.closest('[data-dm]');
  if (dm) { openDM(dm.dataset.dm); return; }
  const pr = e.target.closest('[data-prof]');
  if (pr) { profilePopout(pr, pr.dataset.prof, 'left-start'); return; }
  const row = e.target.closest('.person');
  if (row) openDM(row.dataset.user);
});

// ---------------------------------------------------------------------------
// Channel view
// ---------------------------------------------------------------------------
const drafts = (() => { try { return JSON.parse(LS.get('drafts') || '{}'); } catch (e) { return {}; } })();
const saveDrafts = debounce(() => LS.set('drafts', JSON.stringify(drafts)), 500);
function saveDraftNow(channelId, text) {
  if (text && text.trim()) drafts[channelId] = text; else delete drafts[channelId];
  saveDrafts();
}

function renderLockScreen(chat) {
  $('#center').innerHTML = `<div class="lock-screen"><form class="lock-card" id="lock-form">
    <div class="ico">🔒</div><h2>${esc(chat.name)}</h2>
    <p>This group is password-protected. Enter the password to read and send messages.</p>
    <input class="input" type="password" id="lk-pw" placeholder="Password" autocomplete="off">
    <div class="error" id="lk-err"></div>
    <button class="btn block" style="margin-top:10px">Unlock</button></form></div>`;
  setTimeout(() => { const i = $('#lk-pw'); if (i) i.focus(); }, 30);
  $('#lock-form').onsubmit = async (e) => {
    e.preventDefault();
    const pw = $('#lk-pw').value;
    if (!pw) return;
    const hash = await sha256Hex(pw);
    try {
      await api('POST', `/api/chats/${chat.id}/unlock`, { passwordHash: hash });
      rememberUnlock(chat.id, hash);
      renderChrome();
      renderChannel({});
    } catch (err) {
      $('#lk-err').textContent = err.message;
      $('#lk-pw').select();
    }
  };
}

async function loadMessages(channelId, params = {}) {
  const found = findChannel(channelId);
  const qs = new URLSearchParams(params);
  try {
    return await api('GET', `/api/channels/${channelId}/messages?${qs}`, undefined, { chatPass: found ? state.unlocked.get(found.chat.id) : undefined });
  } catch (e) {
    if (e.status === 403 && found) {
      forgetUnlock(found.chat.id);
      if (state.view.channelId === channelId) renderLockScreen(found.chat);
    }
    throw e;
  }
}

function curCache() {
  return state.view.type === 'chat' ? state.messages.get(state.view.channelId) : null;
}

async function renderChannel({ jumpTo } = {}) {
  const { chat, channel } = currentChat();
  if (!chat) return;
  if (isLockedForMe(chat)) { renderLockScreen(chat); return; }
  const channelId = channel.id;
  const placeholder = chat.type === 'dm' ? `Message @${chatName(chat)}` : `Message #${channel.name}`;
  $('#center').innerHTML = `
    <div id="messages-wrap" style="position:relative;flex:1;min-height:0;display:flex;flex-direction:column">
      <div id="messages" class="scroller"><div id="msg-list"><div class="load-more">Loading messages…</div></div></div>
      <div id="unread-bar" class="hidden"></div>
      <div id="jump-bar" class="hidden"></div>
    </div>
    <div id="composer-wrap">
      <div class="composer-box">
        <div id="reply-slot"></div>
        <div id="tray-slot"></div>
        <div class="composer">
          <button class="c-btn c-plus" id="c-plus" data-tip="Upload files or a project folder" aria-label="Upload">+</button>
          <textarea id="c-input" rows="1" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></textarea>
          <span class="c-count hidden" id="c-count"></span>
          <button class="c-btn gif-btn" id="c-gif" data-tip="Send a GIF" aria-label="GIF">GIF</button>
          <button class="c-btn" id="c-emoji" data-tip="Emoji" aria-label="Emoji">😊</button>
          <button class="c-btn send-btn" id="c-send" data-tip="Send" aria-label="Send">${icon('send', 22)}</button>
        </div>
      </div>
      <div id="ac" class="autocomplete hidden"></div>
    </div>
    <div id="typing"></div>`;
  wireComposer(channelId);
  wireMessageList();

  const unread = state.unread.get(channelId);
  state.newMarkerTs = unread && unread.count > 0 ? (state.reads[channelId] || 0) : null;

  let cache = state.messages.get(channelId);
  try {
    if (jumpTo && !(cache && cache.list.some((m) => m.id === jumpTo))) {
      const r = await loadMessages(channelId, { around: jumpTo });
      cache = setCache(channelId, r);
    } else if (!cache || cache.hasMoreAfter || cache.stale) {
      const r = await loadMessages(channelId, {});
      cache = setCache(channelId, r, cache);
    }
  } catch (e) {
    if (state.view.channelId === channelId && $('#msg-list') && e.status !== 403) {
      $('#msg-list').innerHTML = `<div class="empty-state"><div class="art">⚠️</div><h3>Couldn't load messages</h3>${esc(e.message)}<br><br><button class="btn sm" id="retry-load">Try again</button></div>`;
      $('#retry-load').onclick = () => renderChannel({ jumpTo });
    }
    return;
  }
  if (state.view.channelId !== channelId || !$('#msg-list')) return;
  renderMessageList();
  if (jumpTo) {
    scrollToMessage(jumpTo);
  } else {
    const div = $('#new-divider');
    const sc = $('#messages');
    if (div && div.offsetTop > sc.clientHeight * 0.6) sc.scrollTop = div.offsetTop - 80;
    else scrollToBottom();
  }
  updateScrollState();
  renderTyping();
  markReadSoon();
  if (!isMobile()) $('#c-input').focus();
}

function setCache(channelId, r, old) {
  const keep = old ? old.list.filter((m) => m.pending || m.failed) : [];
  const ids = new Set(r.messages.map((m) => m.id));
  const cache = {
    list: r.messages.concat(r.hasMoreAfter ? [] : keep.filter((m) => !ids.has(m.id))),
    hasMoreBefore: r.hasMoreBefore,
    hasMoreAfter: r.hasMoreAfter
  };
  state.messages.set(channelId, cache);
  return cache;
}

function introHtml(chat, channel) {
  if (chat.type === 'dm') {
    const o = dmOther(chat);
    return `<div class="channel-intro"><div class="big" style="width:80px;height:80px;background:none">${avatarHtml(o, 80)}</div>
      <h2>${esc(o ? o.name : 'Unknown')}</h2><p>This is the beginning of your direct message history with <b>@${esc(o ? o.name : 'them')}</b>.</p></div>`;
  }
  const first = chat.channels[0].id === channel.id;
  return `<div class="channel-intro"><div class="big">${first && mediaUrl(chat.icon) ? `<img src="${esc(mediaUrl(chat.icon))}" alt="">` : '#'}</div>
    <h2>Welcome to #${esc(channel.name)}!</h2><p>This is the start of the #${esc(channel.name)} channel${first ? ` in <b>${esc(chat.name)}</b>` : ''}.${channel.topic ? ' ' + esc(channel.topic) : ''}</p></div>`;
}

const GROUP_MS = 7 * 60 * 1000;
function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }
function isContinuation(prev, m) {
  return !!(prev && prev.senderId === m.senderId && m.ts - prev.ts < GROUP_MS && !m.replyTo &&
    prev.type !== 'system' && m.type !== 'system' && sameDay(prev.ts, m.ts));
}

function renderMessageList() {
  const cache = curCache();
  const el = $('#msg-list');
  if (!cache || !el) return;
  const { chat, channel } = currentChat();
  let html = cache.hasMoreBefore ? '<div class="load-more" id="load-more">Loading older messages…</div>' : introHtml(chat, channel);
  let prev = null;
  let markerPlaced = false;
  for (const m of cache.list) {
    let forceHead = false;
    if (!prev || !sameDay(prev.ts, m.ts)) {
      html += `<div class="day-divider"><span>${esc(dayDivider(m.ts))}</span></div>`;
      forceHead = true;
    }
    if (state.newMarkerTs !== null && !markerPlaced && m.ts > state.newMarkerTs && m.senderId !== state.me.id && m.type !== 'system') {
      html += '<div class="new-divider" id="new-divider"><span>New</span></div>';
      markerPlaced = true;
      forceHead = true;
    }
    html += messageHtml(m, prev, forceHead ? { head: true } : {});
    prev = m;
  }
  el.innerHTML = html;
  renderSeen();
}

function rerenderMessagesKeepScroll() {
  const sc = $('#messages');
  if (!sc) return;
  const atBottom = isAtBottom();
  const top = sc.scrollTop;
  renderMessageList();
  if (atBottom) scrollToBottom(); else sc.scrollTop = top;
}

function md(text) {
  return renderMarkdown(text, { userName, meId: state.me.id });
}

function attUrl(a) {
  if (a.localUrl && /^blob:/.test(a.localUrl)) return a.localUrl;
  return mediaUrl(a.url);
}

function attachmentsHtml(m) {
  const parts = [];
  if (m.image) {
    const u = mediaUrl(m.image);
    if (u) parts.push(`<img class="legacy-img" src="${esc(u)}" alt="Photo" data-lightbox>`);
  }
  if (m.gif) {
    const u = mediaUrl(m.gif);
    if (u) parts.push(`<img class="gif-img" src="${esc(u)}" alt="GIF" loading="lazy" data-lightbox>`);
  }
  const atts = m.attachments || [];
  const imgs = atts.filter((a) => fileKind(a.type, a.name) === 'image');
  if (imgs.length) {
    const cols = imgs.length === 1 ? 1 : (imgs.length === 2 || imgs.length === 4) ? 2 : 3;
    parts.push(`<div class="img-grid ${imgs.length === 1 ? 'single' : 'multi'}" style="--cols:${cols}">${imgs.map((a) => {
      const u = attUrl(a);
      return `<a class="att-img" href="${esc(u)}" target="_blank" rel="noopener" data-att="${esc(a.id)}"><img src="${esc(u)}" alt="${esc(a.name)}" loading="lazy"></a>`;
    }).join('')}</div>`);
  }
  atts.filter((a) => fileKind(a.type, a.name) !== 'image').forEach((a) => {
    const kind = fileKind(a.type, a.name);
    const u = attUrl(a);
    if (kind === 'video' && u) {
      parts.push(`<video class="att-video" src="${esc(u)}" controls preload="metadata"></video>`);
      return;
    }
    let extra = '';
    if (!m.pending) {
      if (kind === 'zip') extra = `<button class="btn secondary xs" data-zip="${esc(a.id)}">Browse files</button>`;
      else if (kind === 'code') extra = `<button class="btn secondary xs" data-code="${esc(a.id)}">Preview</button>`;
      else if (kind === 'pdf') extra = `<a class="btn secondary xs" href="${esc(u)}" target="_blank" rel="noopener">Open</a>`;
    }
    parts.push(`<div class="file-card ${kind === 'audio' ? 'audio' : ''}">
      <div class="fi">${fileIcon(kind)}</div>
      <div class="fmeta"><a class="fname" href="${esc(u)}" target="_blank" rel="noopener" data-dl="${esc(a.id)}">${esc(a.name)}</a>
        <div class="fsize">${esc(fmtSize(a.size))}${kind === 'zip' ? ' · zip archive' : ''}</div></div>
      <div class="factions">${extra}${m.pending ? '' : `<button class="icon-btn" data-dl="${esc(a.id)}" data-tip="Download" aria-label="Download">${icon('download')}</button>`}</div>
      ${kind === 'audio' && u ? `<audio src="${esc(u)}" controls preload="none"></audio>` : ''}
    </div>`);
  });
  return parts.length ? `<div class="attachments">${parts.join('')}</div>` : '';
}

function embedsHtml(m) {
  if (!prefs.embeds || !m.text || m.pending) return '';
  return extractEmbeds(m.text).map((e) => {
    if (e.type === 'youtube') {
      return `<div class="embed"><div class="e-title">YouTube</div><div class="yt" data-yt="${esc(e.id)}"><img src="https://i.ytimg.com/vi/${esc(e.id)}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"></div></div>`;
    }
    if (e.type === 'image') return `<img class="embed-img" src="${esc(e.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-lightbox>`;
    return '';
  }).join('');
}

function quickEmojis(n = 3) {
  const base = (prefs.recentEmoji || []).concat(['👍', '❤️', '😂', '😮', '😢', '🔥']);
  return Array.from(new Set(base)).slice(0, n);
}

function reactionsHtml(m) {
  const r = m.reactions || {};
  const keys = Object.keys(r).filter((k) => r[k] && r[k].length);
  if (!keys.length) return '';
  return `<div class="reactions">${keys.map((emoji) => {
    const ids = r[emoji];
    const mine = ids.includes(state.me.id);
    const names = ids.map((id) => (id === state.me.id ? 'You' : userName(id) || 'Someone'));
    const who = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} other${names.length - 3 === 1 ? '' : 's'}` : names.join(', ').replace(/, ([^,]*)$/, ' and $1');
    return `<button class="reaction ${mine ? 'mine' : ''}" data-react="${esc(emoji)}" data-tip="${esc(who + ' reacted with ' + emoji)}">${emoji}<b>${ids.length}</b></button>`;
  }).join('')}<button class="reaction add" data-act="react" data-tip="Add Reaction" aria-label="Add reaction">${icon('smile', 16)}</button></div>`;
}

function replyCtxHtml(r) {
  const u = r.senderId ? getUser(r.senderId) : null;
  const name = u ? u.name : (r.senderName || 'Unknown');
  const text = plainText(r.text || '', userName);
  return `<div class="reply-ctx" data-jump="${esc(r.id)}">${avatarHtml(u || { id: name, name }, 16)}<b>@${esc(name)}</b><span class="rt">${esc(text || 'Click to see attachment')}</span></div>`;
}

function messageHtml(m, prev, opts = {}) {
  if (m.type === 'system') {
    return `<div class="msg system" data-id="${esc(m.id)}"><div class="gutter">${m.text.includes('pinned') ? '📌' : m.text.includes('left') ? '🚪' : '✨'}</div>
      <div class="body"><div class="msg-content">${md(m.text)} <span class="msg-time" title="${esc(fullDate(m.ts))}">${esc(msgTimestamp(m.ts))}</span></div></div></div>`;
  }
  const user = getUser(m.senderId) || { id: m.senderId || '?', name: m.senderName || 'Unknown' };
  const head = opts.head !== undefined ? opts.head : !isContinuation(prev, m);
  const mine = m.senderId === state.me.id;
  const mentioned = !mine && !m.pending && ((m.mentions && m.mentions.includes(state.me.id)) || m.mentionsEveryone);
  const cls = ['msg', head && 'head', mentioned && 'mentioned', m.pending && 'pending', m.failed && 'failed', m.replyTo && head && 'has-reply'].filter(Boolean).join(' ');
  const gutter = head ? avatarHtml(user, 40) : `<span class="hover-time" title="${esc(fullDate(m.ts))}">${esc(timeOnly(m.ts))}</span>`;
  let body = '';
  if (m.replyTo && head) body += replyCtxHtml(m.replyTo);
  if (head) {
    body += `<div class="msg-head"><span class="msg-author" data-user="${esc(user.id)}">${esc(user.name)}</span><span class="msg-time" title="${esc(fullDate(m.ts))}">${esc(msgTimestamp(m.ts))}</span></div>`;
  }
  if (state.editingId === m.id && !opts.noTools) {
    body += `<div class="edit-box"><textarea rows="1" aria-label="Edit message"></textarea><div class="hint">escape to <a href="#" data-act="cancel-edit">cancel</a> • enter to <a href="#" data-act="save-edit">save</a></div></div>`;
  } else if (m.text) {
    const jumbo = isEmojiOnly(m.text) ? ' jumbo' : '';
    body += `<div class="msg-content${jumbo}">${md(m.text)}${m.editedAt ? `<span class="edited" title="${esc(fullDate(m.editedAt))}">(edited)</span>` : ''}</div>`;
  }
  body += attachmentsHtml(m);
  if (!opts.noTools) body += embedsHtml(m);
  body += reactionsHtml(m);
  if (m.failed) body += `<div class="hint" style="color:var(--danger)">${esc(m.error || "Couldn't send.")} <a href="#" data-act="retry">Retry</a> · <a href="#" data-act="discard">Delete</a></div>`;
  let tools = '';
  if (!opts.noTools && !m.pending && !m.failed) {
    const { chat } = currentChat();
    tools = `<div class="msg-tools">${quickEmojis(3).map((e) => `<button data-quick="${esc(e)}" data-tip="React with ${esc(e)}">${e}</button>`).join('')}<div class="sep"></div>
      <button data-act="react" data-tip="Add Reaction" aria-label="Add reaction">${icon('smile')}</button>
      <button data-act="reply" data-tip="Reply" aria-label="Reply">${icon('reply')}</button>
      ${mine ? `<button data-act="edit" data-tip="Edit" aria-label="Edit">${icon('edit')}</button>` : ''}
      ${mine || canManage(chat) ? `<button data-act="delete" class="danger" data-tip="Delete (Shift = no confirm)" aria-label="Delete">${icon('trash')}</button>` : ''}
      <button data-act="more" data-tip="More" aria-label="More">${icon('more')}</button></div>`;
  }
  return `<div class="${cls}" data-id="${esc(m.id)}"><div class="gutter">${gutter}</div><div class="body">${body}</div>${tools}</div>`;
}

function renderSeen() {
  const el = $('#msg-list');
  if (!el) return;
  const old = $('#seen-line');
  if (old) old.remove();
  const { chat } = currentChat();
  const cache = curCache();
  if (!chat || chat.type !== 'dm' || !cache || !cache.list.length || cache.hasMoreAfter) return;
  const last = cache.list[cache.list.length - 1];
  if (last.senderId !== state.me.id || last.pending) return;
  const o = dmOther(chat);
  const reads = state.dmReads.get(chat.id) || {};
  const ts = o && reads[o.id];
  if (ts && ts >= last.ts) el.insertAdjacentHTML('beforeend', `<div class="seen" id="seen-line">Seen ${esc(timeOnly(ts))}</div>`);
}

function findMsg(id) {
  const cache = curCache();
  return cache ? cache.list.find((m) => m.id === id) : null;
}

function msgNode(id) {
  return $(`#msg-list .msg[data-id="${CSS.escape(id)}"]`);
}

function appendMessage(m) {
  const el = $('#msg-list');
  const cache = curCache();
  if (!el || !cache) return;
  const idx = cache.list.indexOf(m);
  const prev = idx > 0 ? cache.list[idx - 1] : null;
  const wasBottom = isAtBottom();
  const seen = $('#seen-line');
  if (seen) seen.remove();
  let html = '';
  let head = undefined;
  if (!prev || !sameDay(prev.ts, m.ts)) { html += `<div class="day-divider"><span>${esc(dayDivider(m.ts))}</span></div>`; head = true; }
  html += messageHtml(m, prev, head ? { head } : {});
  el.insertAdjacentHTML('beforeend', html);
  renderSeen();
  if (wasBottom || m.senderId === state.me.id) scrollToBottom();
  else showJumpBar(true);
}

function replaceMessage(m, oldId) {
  const node = msgNode(oldId || m.id);
  if (!node) return;
  if (state.editingId === m.id && !oldId) return;
  const cache = curCache();
  const idx = cache ? cache.list.findIndex((x) => x.id === m.id) : -1;
  const prev = idx > 0 ? cache.list[idx - 1] : null;
  const wasBottom = isAtBottom();
  node.outerHTML = messageHtml(m, prev, { head: node.classList.contains('head') });
  if (wasBottom) scrollToBottom();
}

// ---------------------------------------------------------------------------
// Scrolling, loading older/newer, read state
// ---------------------------------------------------------------------------
function isAtBottom() {
  const sc = $('#messages');
  if (!sc) return true;
  return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 60;
}

function scrollToBottom() {
  const sc = $('#messages');
  if (sc) sc.scrollTop = sc.scrollHeight;
  state.stickBottom = true;
}

function scrollToMessage(id) {
  const node = msgNode(id);
  const sc = $('#messages');
  if (!node || !sc) return false;
  sc.scrollTop = node.offsetTop - sc.clientHeight / 3;
  node.classList.remove('highlight');
  void node.offsetWidth;
  node.classList.add('highlight');
  return true;
}

async function jumpToMessage(id) {
  if (scrollToMessage(id)) return;
  const v = state.view;
  try {
    const r = await loadMessages(v.channelId, { around: id });
    if (state.view.channelId !== v.channelId) return;
    setCache(v.channelId, r);
    renderMessageList();
    if (!scrollToMessage(id)) toast("That message couldn't be found — it may have been deleted.");
    updateScrollState();
  } catch (e) {
    toast(e.status === 404 ? 'That message was deleted.' : e.message, 'error');
  }
}

let loadingOlder = false;
async function loadOlder() {
  const cache = curCache();
  const v = state.view;
  if (loadingOlder || !cache || !cache.hasMoreBefore || !cache.list.length) return;
  loadingOlder = true;
  try {
    const r = await loadMessages(v.channelId, { before: cache.list[0].id });
    if (state.view.channelId !== v.channelId) return;
    cache.list = r.messages.concat(cache.list);
    cache.hasMoreBefore = r.hasMoreBefore;
    const sc = $('#messages');
    const oldH = sc.scrollHeight;
    const oldTop = sc.scrollTop;
    renderMessageList();
    sc.scrollTop = sc.scrollHeight - oldH + oldTop;
  } catch (e) {
    /* try again on next scroll */
  } finally {
    loadingOlder = false;
  }
}

let loadingNewer = false;
async function loadNewer() {
  const cache = curCache();
  const v = state.view;
  if (loadingNewer || !cache || !cache.hasMoreAfter) return;
  loadingNewer = true;
  try {
    const r = await loadMessages(v.channelId, { after: cache.list[cache.list.length - 1].id });
    if (state.view.channelId !== v.channelId) return;
    cache.list = cache.list.concat(r.messages);
    cache.hasMoreAfter = r.hasMoreAfter;
    rerenderMessagesKeepScroll();
    updateScrollState();
    if (!cache.hasMoreAfter) markReadSoon();
  } catch (e) {
    /* ignore */
  } finally {
    loadingNewer = false;
  }
}

async function jumpToPresent() {
  const cache = curCache();
  const v = state.view;
  if (cache && cache.hasMoreAfter) {
    try {
      const r = await loadMessages(v.channelId, {});
      if (state.view.channelId !== v.channelId) return;
      setCache(v.channelId, r);
      renderMessageList();
    } catch (e) { toast(e.message, 'error'); return; }
  }
  scrollToBottom();
  updateScrollState();
  markReadSoon();
}

function showJumpBar(newMessages) {
  const bar = $('#jump-bar');
  if (!bar) return;
  const cache = curCache();
  if (isAtBottom() && !(cache && cache.hasMoreAfter)) { bar.classList.add('hidden'); return; }
  bar.innerHTML = newMessages ? '<span>New messages below</span><span>Jump to present ↓</span>' : "<span>You're viewing older messages</span><span>Jump to present ↓</span>";
  bar.classList.remove('hidden');
}

function updateScrollState() {
  const sc = $('#messages');
  if (!sc) return;
  const cache = curCache();
  state.stickBottom = isAtBottom();
  const bar = $('#jump-bar');
  if (bar) {
    if (state.stickBottom && !(cache && cache.hasMoreAfter)) bar.classList.add('hidden');
    else if (cache && (cache.hasMoreAfter || sc.scrollHeight - sc.scrollTop - sc.clientHeight > 1200)) showJumpBar(bar.textContent.startsWith('New'));
  }
  const ub = $('#unread-bar');
  const div = $('#new-divider');
  if (ub) {
    if (div && div.offsetTop < sc.scrollTop) {
      const u = state.unread.get(state.view.channelId);
      const count = $$('#msg-list .msg').filter((n) => n.offsetTop > div.offsetTop).length;
      ub.innerHTML = `<span>${count || (u && u.count) || ''} new message${count === 1 ? '' : 's'} since ${esc(timeOnly(state.newMarkerTs || Date.now()))}</span><span>Jump ↑</span>`;
      ub.classList.remove('hidden');
    } else {
      ub.classList.add('hidden');
    }
  }
}

function wireMessageList() {
  const sc = $('#messages');
  sc.addEventListener('scroll', () => {
    if (sc.scrollTop < 400) loadOlder();
    const cache = curCache();
    if (cache && cache.hasMoreAfter && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 400) loadNewer();
    updateScrollState();
    if (state.stickBottom) markReadSoon();
  }, { passive: true });
  // keep pinned to the bottom while images/videos finish loading
  sc.addEventListener('load', () => { if (state.stickBottom) scrollToBottom(); }, true);
  sc.addEventListener('loadedmetadata', () => { if (state.stickBottom) scrollToBottom(); }, true);
  $('#jump-bar').onclick = jumpToPresent;
  $('#unread-bar').onclick = () => {
    const div = $('#new-divider');
    if (div) sc.scrollTop = div.offsetTop - 80;
  };
  const list = $('#msg-list');
  list.addEventListener('click', onMessageClick);
  list.addEventListener('contextmenu', onMessageContext);
}

function markRead() {
  const v = state.view;
  if (v.type !== 'chat' || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  if (state.suppressReadFor === v.channelId) return;
  const cache = state.messages.get(v.channelId);
  if (!cache || cache.hasMoreAfter) return;
  const last = cache.list.filter((m) => !m.pending && !m.failed).pop();
  const ts = last ? last.ts : 0;
  const u = state.unread.get(v.channelId);
  const had = !!(u && (u.count || u.mentions));
  state.unread.set(v.channelId, { count: 0, mentions: 0 });
  if (had) { renderRail(); renderSidebar(); updateBadges(); }
  if (!ts || ((state.reads[v.channelId] || 0) >= ts && !had)) return;
  state.reads[v.channelId] = ts;
  api('POST', `/api/channels/${v.channelId}/read`, { ts }).catch(() => {});
}
const markReadSoon = debounce(markRead, 350);
window.addEventListener('focus', () => { markReadSoon(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') markReadSoon(); });

// ---------------------------------------------------------------------------
// Message interactions
// ---------------------------------------------------------------------------
async function onMessageClick(e) {
  const t = e.target;
  const msgEl = t.closest('.msg');
  const m = msgEl ? findMsg(msgEl.dataset.id) : null;

  const userEl = t.closest('.msg-author, .gutter .av, .mention[data-user], .reply-ctx .av');
  if (userEl && userEl.dataset.user) { e.stopPropagation(); profilePopout(userEl, userEl.dataset.user, 'right-start'); return; }
  const act = t.closest('[data-act]');
  const actName = act && act.dataset.act;
  if (actName) e.preventDefault();
  if (t.closest('.reply-ctx')) { jumpToMessage(t.closest('.reply-ctx').dataset.jump); return; }
  if (!m) return;
  const quick = t.closest('[data-quick]');
  if (quick) { toggleReaction(m, quick.dataset.quick); return; }
  const react = t.closest('[data-react]');
  if (react) { toggleReaction(m, react.dataset.react); return; }
  if (actName === 'react') {
    msgEl.classList.add('menu-open');
    const pop = emojiPicker(act, (em) => toggleReaction(m, em), { placement: 'left-start' });
    const close = pop.close;
    pop.close = () => { msgEl.classList.remove('menu-open'); close(); };
    return;
  }
  if (actName === 'reply') { startReply(m); return; }
  if (actName === 'edit') { startEdit(m.id); return; }
  if (actName === 'delete') { deleteMessage(m, e.shiftKey); return; }
  if (actName === 'more') { messageMenu(m, act); return; }
  if (actName === 'save-edit') { saveEdit(); return; }
  if (actName === 'cancel-edit') { cancelEdit(); return; }
  if (actName === 'retry') { retrySend(m); return; }
  if (actName === 'discard') { discardFailed(m); return; }
  const zip = t.closest('[data-zip]');
  if (zip) { const a = (m.attachments || []).find((x) => x.id === zip.dataset.zip); if (a) openZipViewer(a); return; }
  const code = t.closest('[data-code]');
  if (code) { const a = (m.attachments || []).find((x) => x.id === code.dataset.code); if (a) openCodeViewer(a); return; }
  const dl = t.closest('[data-dl]');
  if (dl) {
    e.preventDefault();
    const a = (m.attachments || []).find((x) => x.id === dl.dataset.dl);
    if (a) downloadAttachment(a);
    return;
  }
  const att = t.closest('.att-img');
  if (att) {
    e.preventDefault();
    const a = (m.attachments || []).find((x) => x.id === att.dataset.att);
    lightbox(attUrl(a), { name: a.name });
    return;
  }
  const lb = t.closest('[data-lightbox]');
  if (lb) { lightbox(lb.getAttribute('src')); return; }
  const yt = t.closest('[data-yt]');
  if (yt) {
    yt.outerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${esc(yt.dataset.yt)}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="YouTube video"></iframe>`;
  }
}

async function downloadAttachment(a) {
  const url = attUrl(a);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = a.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 5000);
  } catch (e) {
    window.open(url, '_blank', 'noopener');
  }
}

function onMessageContext(e) {
  const msgEl = e.target.closest('.msg');
  if (!msgEl || msgEl.classList.contains('pending') || msgEl.classList.contains('system')) return;
  if (e.target.closest('a, img, video, textarea')) return; // keep the browser's own menu for links/media
  const m = findMsg(msgEl.dataset.id);
  if (!m) return;
  e.preventDefault();
  messageMenu(m, { x: e.clientX, y: e.clientY });
}

function messageMenu(m, anchor) {
  const { chat } = currentChat();
  const mine = m.senderId === state.me.id;
  const el = msgNode(m.id);
  if (el) el.classList.add('menu-open');
  const items = [
    { quick: quickEmojis(4), onQuick: (em) => toggleReaction(m, em) },
    { label: 'Add Reaction', icon: '😀', onClick: () => emojiPicker(anchor, (em) => toggleReaction(m, em), { placement: 'left-start' }) },
    { label: 'Reply', icon: '↩️', onClick: () => startReply(m) }
  ];
  if (mine) items.push({ label: 'Edit Message', icon: '✏️', onClick: () => startEdit(m.id) });
  items.push({ label: m.pinned ? 'Unpin Message' : 'Pin Message', icon: '📌', onClick: () => togglePin(m) });
  if (m.text) items.push({ label: 'Copy Text', icon: '📋', onClick: async () => { if (await copyText(plainText(m.text, userName))) toast('Copied', 'ok'); } });
  items.push({ label: 'Copy Message Link', icon: '🔗', onClick: async () => { if (await copyText(`${location.origin}${location.pathname}#/c/${chat.id}/${m.channelId}/${m.id}`)) toast('Link copied', 'ok'); } });
  if (!mine) items.push({ label: 'Mark Unread', icon: '🔵', onClick: () => markUnreadFrom(m) });
  if (!mine) items.push({ label: `Message ${userName(m.senderId) || 'them'}`, icon: '💬', onClick: () => openDM(m.senderId) });
  if (mine || canManage(chat)) items.push({ sep: true }, { label: 'Delete Message', icon: '🗑️', danger: true, onClick: (ev) => deleteMessage(m, ev && ev.shiftKey) });
  openMenu(anchor, items, { placement: anchor instanceof Element ? 'left-start' : 'right-start', onClose: () => { const n = msgNode(m.id); if (n) n.classList.remove('menu-open'); } });
}

function chatPass() {
  const { chat } = currentChat();
  return chat ? state.unlocked.get(chat.id) : undefined;
}

async function toggleReaction(m, emoji) {
  try {
    const res = await api('POST', `/api/channels/${m.channelId}/messages/${m.id}/reactions`, { emoji }, { chatPass: chatPass() });
    onMessageUpdate(res.message);
  } catch (e) { toast(e.message, 'error'); }
}

async function togglePin(m) {
  try {
    const res = await api('POST', `/api/channels/${m.channelId}/messages/${m.id}/pin`, {}, { chatPass: chatPass() });
    onMessageUpdate(res.message);
    toast(res.message.pinned ? '📌 Pinned' : 'Unpinned', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteMessage(m, skipConfirm) {
  if (!skipConfirm) {
    const ok = await confirmDialog({
      title: 'Delete Message',
      body: 'Are you sure you want to delete this message?',
      html: `<div class="quote-msg">${messageHtml(m, null, { head: true, noTools: true })}</div><div class="hint">Tip: hold <b>Shift</b> when clicking 🗑️ to delete without this check.</div>`,
      confirm: 'Delete',
      danger: true
    });
    if (!ok) return;
  }
  try {
    await api('DELETE', `/api/channels/${m.channelId}/messages/${m.id}`, undefined, { chatPass: chatPass() });
    onMessageDelete({ channelId: m.channelId, id: m.id });
  } catch (e) { toast(e.message, 'error'); }
}

function markUnreadFrom(m) {
  const v = state.view;
  const cache = curCache();
  const ts = m.ts - 1;
  const after = cache.list.filter((x) => x.ts > ts && x.senderId !== state.me.id && x.type !== 'system');
  const { chat } = currentChat();
  const mentions = after.filter((x) => chat.type === 'dm' || (x.mentions && x.mentions.includes(state.me.id)) || x.mentionsEveryone).length;
  state.unread.set(v.channelId, { count: after.length, mentions });
  state.reads[v.channelId] = ts;
  state.suppressReadFor = v.channelId;
  api('POST', `/api/channels/${v.channelId}/read`, { ts, force: true }).catch(() => {});
  renderRail();
  renderSidebar();
  updateBadges();
  toast('Marked as unread');
}

async function openPins(btn) {
  const v = state.view;
  const pop = openPopover(btn, `<div class="ph">${icon('pin')} Pinned Messages</div><div class="pb scroller thin"><div class="empty-state">Loading…</div></div>`, { className: 'pins-pop', placement: 'bottom-end' });
  const body = pop.el.querySelector('.pb');
  const draw = async () => {
    try {
      const r = await api('GET', `/api/channels/${v.channelId}/pins`, undefined, { chatPass: chatPass() });
      body.innerHTML = r.messages.length
        ? r.messages.map((m) => `<div class="pin-item" data-id="${esc(m.id)}"><div class="pa"><button class="btn secondary xs" data-jump="${esc(m.id)}">Jump</button><button class="icon-btn" data-unpin="${esc(m.id)}" data-tip="Unpin" aria-label="Unpin">✕</button></div>${messageHtml(m, null, { head: true, noTools: true })}</div>`).join('')
        : '<div class="empty-state"><div class="art">📌</div><h3>No pins yet</h3>Right-click a message (or use ⋯) and choose <b>Pin Message</b> to keep it here.</div>';
      body._msgs = r.messages;
    } catch (e) {
      body.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    }
  };
  await draw();
  body.addEventListener('click', async (e) => {
    const j = e.target.closest('[data-jump]');
    if (j) { pop.close(); jumpToMessage(j.dataset.jump); return; }
    const u = e.target.closest('[data-unpin]');
    if (u) {
      const m = (body._msgs || []).find((x) => x.id === u.dataset.unpin);
      if (m) { await togglePin(m); draw(); }
    }
  });
}

// ---------------------------------------------------------------------------
// Replies + editing
// ---------------------------------------------------------------------------
function startReply(m) {
  state.replyTo = { id: m.id, senderId: m.senderId, ping: m.senderId !== state.me.id };
  renderReplyBar();
  const i = $('#c-input');
  if (i) i.focus();
}

function renderReplyBar() {
  const slot = $('#reply-slot');
  if (!slot) return;
  const r = state.replyTo;
  if (!r) { slot.innerHTML = ''; return; }
  const name = userName(r.senderId) || 'someone';
  slot.innerHTML = `<div class="reply-bar"><span class="grow">Replying to <b>${esc(name)}</b></span>
    ${r.senderId !== state.me.id ? `<button class="ping ${r.ping ? '' : 'off'}" id="reply-ping" data-tip="${r.ping ? 'They will be pinged — click to turn off' : 'They will not be pinged'}">@${r.ping ? 'ON' : 'OFF'}</button>` : ''}
    <button class="x" id="reply-x" aria-label="Cancel reply">✕</button></div>`;
  const p = $('#reply-ping');
  if (p) p.onclick = () => { r.ping = !r.ping; renderReplyBar(); };
  $('#reply-x').onclick = () => { state.replyTo = null; renderReplyBar(); };
}

function decodeMentions(text) {
  return String(text || '').replace(/<@([\w-]{1,64})>/g, (m, id) => '@' + (userName(id) || 'unknown'));
}

// People picked from the @-autocomplete win; otherwise, if two people share a
// name, prefer whoever is online / was seen most recently.
const mentionPicks = new Map(); // lower-case name -> user id
function encodeMentions(text, chat) {
  const isOn = (u) => !['offline', 'invisible'].includes(statusOf(u.id));
  const members = chatMembers(chat).slice().sort((a, b) =>
    (b.name.length - a.name.length) ||
    ((mentionPicks.get(b.name.toLowerCase()) === b.id) - (mentionPicks.get(a.name.toLowerCase()) === a.id)) ||
    (isOn(b) - isOn(a)) || ((b.lastSeen || 0) - (a.lastSeen || 0)));
  let out = text;
  members.forEach((u) => {
    const re = new RegExp('(^|[^\\w<])@' + u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'gi');
    out = out.replace(re, (m, pre) => `${pre}<@${u.id}>`);
  });
  return out;
}

function startEdit(id) {
  const m = findMsg(id);
  if (!m || m.senderId !== state.me.id) return;
  if (state.editingId && state.editingId !== id) cancelEdit();
  state.editingId = id;
  const node = msgNode(id);
  if (!node) return;
  const cache = curCache();
  const idx = cache.list.indexOf(m);
  node.outerHTML = messageHtml(m, cache.list[idx - 1], { head: node.classList.contains('head') });
  const ta = $(`#msg-list .msg[data-id="${CSS.escape(id)}"] .edit-box textarea`);
  ta.value = decodeMentions(m.text);
  const size = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.5) + 'px'; };
  size();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('input', size);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
  });
}

function cancelEdit() {
  const id = state.editingId;
  state.editingId = null;
  const m = id && findMsg(id);
  if (m) replaceMessage(m);
  const i = $('#c-input');
  if (i) i.focus();
}

async function saveEdit() {
  const id = state.editingId;
  const m = findMsg(id);
  const ta = $(`#msg-list .msg[data-id="${CSS.escape(id)}"] .edit-box textarea`);
  if (!m || !ta) return cancelEdit();
  const { chat } = currentChat();
  const text = encodeMentions(replaceShortcodes(ta.value.trim()), chat);
  if (text === m.text) return cancelEdit();
  if (!text && !(m.attachments && m.attachments.length) && !m.gif && !m.image) {
    state.editingId = null;
    replaceMessage(m);
    return deleteMessage(m, false);
  }
  if (text.length > MAX_TEXT) { toast(`Messages can be up to ${MAX_TEXT} characters.`, 'error'); return; }
  try {
    const res = await api('PATCH', `/api/channels/${m.channelId}/messages/${m.id}`, { text }, { chatPass: chatPass() });
    state.editingId = null;
    onMessageUpdate(res.message);
    const i = $('#c-input');
    if (i) i.focus();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------
const COMMANDS = [
  { name: 'shrug', desc: 'Appends ¯\\_(ツ)_/¯ to your message', run: (t) => (t + ' ¯\\\\\\_(ツ)\\_/¯').trim() },
  { name: 'tableflip', desc: 'Appends (╯°□°)╯︵ ┻━┻', run: (t) => (t + ' (╯°□°)╯︵ ┻━┻').trim() },
  { name: 'unflip', desc: 'Appends ┬─┬ノ( º _ ºノ)', run: (t) => (t + ' ┬─┬ノ( º _ ºノ)').trim() },
  { name: 'lenny', desc: 'Appends ( ͡° ͜ʖ ͡°)', run: (t) => (t + ' ( ͡° ͜ʖ ͡°)').trim() },
  { name: 'me', desc: 'Displays text as an action', usage: '<action>', run: (t) => (t ? `*${t}*` : null) },
  { name: 'spoiler', desc: 'Hides your message as a spoiler', usage: '<text>', run: (t) => (t ? `||${t}||` : null) },
  { name: 'roll', desc: 'Roll a dice (default 6 sides)', usage: '[sides]', run: (t) => { const n = Math.max(2, Math.min(1000, parseInt(t, 10) || 6)); return `🎲 rolled a **${1 + Math.floor(Math.random() * n)}** (d${n})`; } },
  { name: 'flip', desc: 'Flip a coin', run: () => `🪙 flipped a coin: **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**` }
];

function wireComposer(channelId) {
  const input = $('#c-input');
  input.value = drafts[channelId] || '';
  autosize();
  updateSendState();
  renderReplyBar();
  renderTray();

  input.addEventListener('input', () => {
    autosize();
    updateSendState();
    drafts[channelId] = input.value;
    if (!input.value.trim()) delete drafts[channelId];
    saveDrafts();
    if (input.value.trim()) sendTyping(); else stopTyping();
    updateAutocomplete();
  });
  input.addEventListener('keydown', onComposerKey);
  input.addEventListener('click', updateAutocomplete);
  input.addEventListener('blur', () => setTimeout(closeAutocomplete, 150));
  input.addEventListener('paste', (e) => {
    const files = Array.from(e.clipboardData && e.clipboardData.files || []);
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  $('#c-send').onclick = sendMessage;
  $('#c-emoji').onclick = (e) => emojiPicker(e.currentTarget, (em) => insertAtCursor(em), { placement: 'top-end' });
  $('#c-gif').onclick = (e) => gifPicker(e.currentTarget, (url) => sendGif(url));
  $('#c-plus').onclick = (e) => openMenu(e.currentTarget, [
    { label: 'Upload a File', sub: `Photos, videos, documents… up to ${fmtSize(state.maxUploadBytes)}`, icon: '📄', onClick: () => $('#file-input').click() },
    { label: 'Upload a Folder', sub: "Zips a whole project so people can browse it", icon: '📁', onClick: () => $('#folder-input').click() },
    { label: 'Send a GIF', icon: '🎞️', onClick: () => gifPicker($('#c-gif'), (url) => sendGif(url)) }
  ], { placement: 'top-start' });
}

function autosize() {
  const i = $('#c-input');
  if (!i) return;
  i.style.height = 'auto';
  i.style.height = Math.min(i.scrollHeight, window.innerHeight * 0.5) + 'px';
}

function updateSendState() {
  const i = $('#c-input');
  const b = $('#c-send');
  if (!i || !b) return;
  const len = i.value.length;
  b.disabled = !i.value.trim() && !state.pending.length;
  const c = $('#c-count');
  if (len > MAX_TEXT - 300) {
    c.classList.remove('hidden');
    c.textContent = MAX_TEXT - len;
    c.classList.toggle('over', len > MAX_TEXT);
  } else c.classList.add('hidden');
}

function insertAtCursor(text) {
  const i = $('#c-input');
  if (!i) return;
  const s = i.selectionStart ?? i.value.length;
  const e2 = i.selectionEnd ?? i.value.length;
  i.value = i.value.slice(0, s) + text + i.value.slice(e2);
  i.focus();
  i.setSelectionRange(s + text.length, s + text.length);
  i.dispatchEvent(new Event('input'));
}

function onComposerKey(e) {
  const ac = $('#ac');
  if (ac && !ac.classList.contains('hidden') && acState.items.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      acState.sel = (acState.sel + (e.key === 'ArrowDown' ? 1 : -1) + acState.items.length) % acState.items.length;
      drawAutocomplete();
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      applyAutocomplete(acState.items[acState.sel]);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAutocomplete(); return; }
  }
  const i = e.currentTarget;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    if (prefs.sendOnEnter || e.ctrlKey || e.metaKey) { e.preventDefault(); sendMessage(); }
    return;
  }
  if (e.key === 'ArrowUp' && !i.value) {
    const cache = curCache();
    const mine = cache && cache.list.slice().reverse().find((m) => m.senderId === state.me.id && !m.pending && !m.failed && m.type !== 'system');
    if (mine) { e.preventDefault(); startEdit(mine.id); }
    return;
  }
  if (e.key === 'Escape') {
    if (state.replyTo) { e.preventDefault(); e.stopPropagation(); state.replyTo = null; renderReplyBar(); }
  }
}

// --- autocomplete (@mentions, :emoji:, /commands) ---
const acState = { items: [], sel: 0, start: 0, end: 0, kind: null };

function closeAutocomplete() {
  const ac = $('#ac');
  if (ac) ac.classList.add('hidden');
  acState.items = [];
}

function updateAutocomplete() {
  const i = $('#c-input');
  if (!i) return;
  const pos = i.selectionStart;
  const before = i.value.slice(0, pos);
  const { chat } = currentChat();
  let m;
  let items = [];
  let kind = null;
  let start = pos;
  if ((m = /(^|\s)@([^\s@]{0,32})$/.exec(before))) {
    kind = 'mention';
    const q = m[2].toLowerCase();
    start = pos - m[2].length - 1;
    items = chatMembers(chat).filter((u) => u.id !== state.me.id && u.name.toLowerCase().includes(q))
      .sort((a, b) => (b.name.toLowerCase().startsWith(q)) - (a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((u) => ({ insert: '@' + u.name + ' ', userId: u.id, name: u.name, html: `${avatarHtml(u, 24, { status: true })}<span class="main">${esc(u.name)}</span><span class="aux">${esc(u.customStatus || '')}</span>` }));
    if (chat.type === 'group' && 'everyone'.startsWith(q)) items.push({ insert: '@everyone ', html: '<span class="em">📣</span><span class="main">@everyone</span><span class="aux">Notify everyone in the group</span>' });
  } else if ((m = /(^|\s):([a-z0-9_+-]{2,30})$/i.exec(before))) {
    kind = 'emoji';
    start = pos - m[2].length - 1;
    items = searchEmoji(m[2], 8).map((em) => ({ insert: em.char + ' ', html: `<span class="em">${em.char}</span><span class="main">:${esc(em.name)}:</span>` }));
  } else if ((m = /^\/(\w*)$/.exec(before))) {
    kind = 'command';
    start = 0;
    items = COMMANDS.filter((c) => c.name.startsWith(m[1].toLowerCase()))
      .map((c) => ({ insert: '/' + c.name + ' ', html: `<span class="main">/${esc(c.name)} ${c.usage ? `<span style="color:var(--muted);font-weight:400">${esc(c.usage)}</span>` : ''}</span><span class="aux">${esc(c.desc)}</span>` }));
  }
  if (!kind || !items.length) { closeAutocomplete(); return; }
  Object.assign(acState, { items, sel: 0, start, end: pos, kind });
  drawAutocomplete();
}

function drawAutocomplete() {
  const ac = $('#ac');
  const title = { mention: 'Members', emoji: 'Emoji matching', command: 'Commands' }[acState.kind];
  ac.innerHTML = `<div class="ac-title">${title}</div>` + acState.items.map((it, n) => `<div class="ac-item ${n === acState.sel ? 'sel' : ''}" data-n="${n}">${it.html}</div>`).join('');
  ac.classList.remove('hidden');
  ac.onmousedown = (e) => {
    const r = e.target.closest('[data-n]');
    if (r) { e.preventDefault(); applyAutocomplete(acState.items[+r.dataset.n]); }
  };
}

function applyAutocomplete(item) {
  const i = $('#c-input');
  if (!item || !i) return;
  if (item.userId) mentionPicks.set(item.name.toLowerCase(), item.userId);
  i.value = i.value.slice(0, acState.start) + item.insert + i.value.slice(acState.end);
  const p = acState.start + item.insert.length;
  i.setSelectionRange(p, p);
  closeAutocomplete();
  i.focus();
  i.dispatchEvent(new Event('input'));
}

// --- sending ---
async function sendMessage() {
  const v = state.view;
  const { chat } = currentChat();
  const input = $('#c-input');
  if (v.type !== 'chat' || !input || !chat) return;
  let text = input.value.trim();
  const cmd = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text);
  if (cmd) {
    const c = COMMANDS.find((x) => x.name === cmd[1].toLowerCase());
    if (c) {
      const out = c.run((cmd[2] || '').trim());
      if (out == null) { toast(`Usage: /${c.name} ${c.usage || ''}`); return; }
      text = out;
    }
  }
  text = encodeMentions(replaceShortcodes(text), chat);
  mentionPicks.clear();
  const files = state.pending.slice();
  if (!text && !files.length) return;
  if (text.length > MAX_TEXT) { toast(`Messages can be up to ${MAX_TEXT} characters — that one is ${text.length}.`, 'error'); return; }
  if (files.some((f) => f.status === 'error')) { toast('One of your files failed to upload — remove it first.', 'error'); return; }

  input.value = '';
  delete drafts[v.channelId];
  saveDrafts();
  autosize();
  closeAutocomplete();
  const reply = state.replyTo;
  state.replyTo = null;
  renderReplyBar();
  state.pending = [];
  renderTray();
  updateSendState();
  stopTyping();

  const body = { text, replyToId: reply ? reply.id : undefined, pingReply: reply ? reply.ping : undefined };
  const optimistic = {
    id: genId(), channelId: v.channelId, senderId: state.me.id, text,
    attachments: files.map((f) => ({ id: f.localId, name: f.name, size: f.size, type: f.type, localUrl: f.previewUrl, url: null })),
    replyTo: reply ? { id: reply.id, senderId: reply.senderId, text: (findMsg(reply.id) || {}).text || '' } : null,
    reactions: {}, mentions: [], ts: Date.now(), pending: true, files
  };
  await postMessage(v.channelId, body, optimistic);
}

async function sendGif(url) {
  const v = state.view;
  if (v.type !== 'chat') return;
  const reply = state.replyTo;
  state.replyTo = null;
  renderReplyBar();
  const body = { text: '', gif: url, replyToId: reply ? reply.id : undefined, pingReply: reply ? reply.ping : undefined };
  const optimistic = { id: genId(), channelId: v.channelId, senderId: state.me.id, text: '', gif: url, attachments: [], replyTo: reply ? { id: reply.id, senderId: reply.senderId, text: '' } : null, reactions: {}, mentions: [], ts: Date.now(), pending: true, files: [] };
  await postMessage(v.channelId, body, optimistic);
}

async function postMessage(channelId, body, optimistic) {
  const nonce = optimistic.id;
  body.nonce = nonce;
  let cache = state.messages.get(channelId);
  if (cache && cache.hasMoreAfter && state.view.channelId === channelId) {
    await jumpToPresent();
    cache = state.messages.get(channelId);
  }
  if (cache) {
    cache.list.push(optimistic);
    if (state.view.channelId === channelId) appendMessage(optimistic);
  }
  optimistic.body = body;
  try {
    const ids = [];
    for (const f of optimistic.files || []) ids.push((await f.promise).id);
    if (ids.length) body.attachmentIds = ids;
    const found = findChannel(channelId);
    const res = await api('POST', `/api/channels/${channelId}/messages`, body, { chatPass: found ? state.unlocked.get(found.chat.id) : undefined });
    reconcile(channelId, nonce, res.message);
  } catch (e) {
    optimistic.pending = false;
    optimistic.failed = true;
    optimistic.error = e.message;
    if (state.view.channelId === channelId) replaceMessage(optimistic);
    toast(e.message, 'error');
  }
}

function reconcile(channelId, nonce, real) {
  const cache = state.messages.get(channelId);
  if (!cache) return;
  const iN = cache.list.findIndex((m) => m.id === nonce);
  const iR = cache.list.findIndex((m) => m.id === real.id);
  if (iN === -1) return;
  const opt = cache.list[iN];
  (opt.files || []).forEach((f) => { if (f.previewUrl) setTimeout(() => URL.revokeObjectURL(f.previewUrl), 4000); });
  if (iR === -1) {
    cache.list[iN] = real;
    if (state.view.channelId === channelId) { replaceMessage(real, nonce); renderSeen(); }
  } else {
    cache.list.splice(iN, 1);
    const n = msgNode(nonce);
    if (n) n.remove();
  }
  const found = findChannel(channelId);
  if (found) {
    found.channel.lastMessage = { id: real.id, senderId: real.senderId, ts: real.ts, preview: real.text || (real.attachments && real.attachments.length ? '📎 Attachment' : '🎞️ GIF') };
    found.chat.lastMessageAt = real.ts;
    state.reads[channelId] = Math.max(state.reads[channelId] || 0, real.ts);
    if (found.chat.type === 'dm') renderSidebar();
  }
}

function retrySend(m) {
  const cache = curCache();
  const i = cache.list.indexOf(m);
  if (i !== -1) cache.list.splice(i, 1);
  const n = msgNode(m.id);
  if (n) n.remove();
  const fresh = Object.assign({}, m, { id: genId(), pending: true, failed: false, error: null, ts: Date.now() });
  postMessage(m.channelId, Object.assign({}, m.body), fresh);
}

function discardFailed(m) {
  const cache = curCache();
  const i = cache.list.indexOf(m);
  if (i !== -1) cache.list.splice(i, 1);
  const n = msgNode(m.id);
  if (n) n.remove();
}

// --- attachments ---
const TYPE_BY_EXT = { zip: 'application/zip', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', txt: 'text/plain', md: 'text/plain', json: 'application/json', csv: 'text/csv' };
function guessType(file) {
  if (file.type) return file.type;
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1];
  return (ext && TYPE_BY_EXT[ext.toLowerCase()]) || 'application/octet-stream';
}

function addFiles(list) {
  if (state.view.type !== 'chat') return;
  const { chat } = currentChat();
  if (isLockedForMe(chat)) return;
  for (const file of list) {
    if (state.pending.length >= MAX_ATTACHMENTS) { toast(`You can attach up to ${MAX_ATTACHMENTS} files at once.`, 'error'); break; }
    if (file.size > state.maxUploadBytes) { toast(`${file.name} is too big — the limit is ${fmtSize(state.maxUploadBytes)}.`, 'error'); continue; }
    if (!file.size) { toast(`${file.name} is empty (or is a folder — use + → Upload a Folder).`, 'error'); continue; }
    const type = guessType(file);
    const p = {
      localId: genId(), file, name: file.name || 'file', size: file.size, type, progress: 0, status: 'uploading',
      previewUrl: /^image\/(png|jpeg|gif|webp)$/.test(type) ? URL.createObjectURL(file) : null
    };
    const blob = file.type === type ? file : new Blob([file], { type });
    const up = uploadFile(blob, { name: p.name, onProgress: (f) => { p.progress = f; updateTrayItem(p); } });
    p.abort = up.abort;
    p.promise = up.promise.then((r) => { p.status = 'done'; p.result = r; updateTrayItem(p); updateSendState(); return r; },
      (err) => { p.status = 'error'; p.error = err.message; updateTrayItem(p); if (err.status !== -1) toast(`${p.name}: ${err.message}`, 'error'); throw err; });
    p.promise.catch(() => {});
    state.pending.push(p);
  }
  renderTray();
  updateSendState();
  const i = $('#c-input');
  if (i) i.focus();
}

function renderTray() {
  const slot = $('#tray-slot');
  if (!slot) return;
  if (!state.pending.length) { slot.innerHTML = ''; return; }
  slot.innerHTML = `<div class="attach-tray scroller thin">${state.pending.map((p) => `
    <div class="tray-item ${p.status}" data-local="${esc(p.localId)}">
      <div class="prev">${p.previewUrl ? `<img src="${esc(p.previewUrl)}" alt="">` : fileIcon(fileKind(p.type, p.name))}</div>
      <div class="prog"><i style="width:${Math.round(p.progress * 100)}%"></i></div>
      <div class="tname" title="${esc(p.name)}">${esc(p.name)}</div>
      <div class="tsize">${esc(fmtSize(p.size))}<span class="tstat">${p.status === 'error' ? ' · failed' : p.status === 'uploading' ? ' · ' + Math.round(p.progress * 100) + '%' : ' · ready'}</span></div>
      <button class="rm" data-rm="${esc(p.localId)}" data-tip="Remove" aria-label="Remove">🗑</button>
    </div>`).join('')}</div>`;
  slot.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
    const i = state.pending.findIndex((p) => p.localId === b.dataset.rm);
    if (i === -1) return;
    const [p] = state.pending.splice(i, 1);
    if (p.status === 'uploading' && p.abort) p.abort();
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    renderTray();
    updateSendState();
  });
}

function updateTrayItem(p) {
  const el = $(`#tray-slot [data-local="${CSS.escape(p.localId)}"]`);
  if (!el) return;
  el.className = 'tray-item ' + p.status;
  el.querySelector('.prog i').style.width = Math.round(p.progress * 100) + '%';
  el.querySelector('.tstat').textContent = p.status === 'error' ? ' · failed' : p.status === 'uploading' ? ' · ' + Math.round(p.progress * 100) + '%' : ' · ready';
}

$('#file-input').addEventListener('change', (e) => {
  addFiles(Array.from(e.target.files || []));
  e.target.value = '';
});
$('#folder-input').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  const root = (files[0].webkitRelativePath || 'project').split('/')[0] || 'project';
  await zipAndAttach(files.map((f) => ({ path: f.webkitRelativePath || f.name, file: f })), root);
});

async function zipAndAttach(entries, rootName) {
  const total = entries.reduce((n, x) => n + x.file.size, 0);
  if (total > state.maxUploadBytes * 3) { toast(`That folder is ${fmtSize(total)} — too big to upload.`, 'error'); return; }
  toast(`📦 Zipping ${rootName}…`);
  try {
    const { blob, count, skipped } = await createZip(entries);
    if (!count) { toast('That folder is empty.', 'error'); return; }
    if (blob.size > state.maxUploadBytes) { toast(`${rootName}.zip is ${fmtSize(blob.size)} — the limit is ${fmtSize(state.maxUploadBytes)}.`, 'error'); return; }
    addFiles([new File([blob], rootName + '.zip', { type: 'application/zip' })]);
    toast(`📦 ${rootName}.zip ready — ${count} file${count === 1 ? '' : 's'}${skipped ? ` (skipped ${skipped} from node_modules/.git etc.)` : ''}`, 'ok');
  } catch (err) {
    toast("Couldn't zip that folder: " + err.message, 'error');
  }
}

// Drag & drop (files and whole folders)
let dragDepth = 0;
function dragHasFiles(e) { return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'); }
function canDrop() {
  if (state.view.type !== 'chat') return false;
  const { chat } = currentChat();
  return chat && !isLockedForMe(chat) && !hasOpenLayer();
}
document.addEventListener('dragenter', (e) => {
  if (!dragHasFiles(e) || !canDrop()) return;
  e.preventDefault();
  dragDepth++;
  if (!$('#drop-overlay')) {
    const { chat, channel } = currentChat();
    const where = chat.type === 'dm' ? '@' + chatName(chat) : '#' + channel.name;
    document.body.insertAdjacentHTML('beforeend', `<div id="drop-overlay"><div class="box"><div class="inner"><div class="ico">📂</div><h3>Upload to ${esc(where)}</h3><p>Drop files or a whole project folder.</p></div></div></div>`);
  }
});
document.addEventListener('dragover', (e) => { if (dragHasFiles(e) && canDrop()) e.preventDefault(); });
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) { const o = $('#drop-overlay'); if (o) o.remove(); }
});
document.addEventListener('drop', async (e) => {
  const o = $('#drop-overlay');
  if (o) o.remove();
  dragDepth = 0;
  if (!dragHasFiles(e) || !canDrop()) return;
  e.preventDefault();
  const items = Array.from(e.dataTransfer.items || []);
  const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  const dirs = entries.filter((en) => en.isDirectory);
  if (dirs.length) {
    for (const d of dirs) {
      const files = await collectDir(d, d.name);
      await zipAndAttach(files, d.name);
    }
    const loose = Array.from(e.dataTransfer.files || []).filter((f, i) => entries[i] && entries[i].isFile);
    if (loose.length) addFiles(loose);
  } else {
    addFiles(Array.from(e.dataTransfer.files || []));
  }
});

function collectDir(dirEntry, prefix) {
  return new Promise((resolve) => {
    const out = [];
    const reader = dirEntry.createReader();
    const readAll = () => reader.readEntries(async (batch) => {
      if (!batch.length) return resolve(out);
      for (const en of batch) {
        if (/^(node_modules|\.git)$/.test(en.name)) continue;
        if (en.isFile) {
          const file = await new Promise((res) => en.file(res, () => res(null)));
          if (file) out.push({ path: prefix + '/' + en.name, file });
        } else if (en.isDirectory) {
          out.push(...(await collectDir(en, prefix + '/' + en.name)));
        }
      }
      readAll();
    }, () => resolve(out));
    readAll();
  });
}

// --- typing indicator ---
let lastTypingSent = 0;
function sendTyping() {
  const v = state.view;
  if (v.type !== 'chat' || Date.now() - lastTypingSent < 3500) return;
  lastTypingSent = Date.now();
  wsSend({ type: 'typing', channelId: v.channelId });
}
function stopTyping() { lastTypingSent = 0; }

function handleTyping({ channelId, userId }) {
  if (!state.typing.has(channelId)) state.typing.set(channelId, new Map());
  const map = state.typing.get(channelId);
  clearTimeout(map.get(userId));
  map.set(userId, setTimeout(() => { map.delete(userId); if (state.view.channelId === channelId) renderTyping(); }, 7000));
  if (state.view.channelId === channelId) renderTyping();
}

function clearTyping(channelId, userId) {
  const map = state.typing.get(channelId);
  if (map && map.has(userId)) {
    clearTimeout(map.get(userId));
    map.delete(userId);
    if (state.view.channelId === channelId) renderTyping();
  }
}

function renderTyping() {
  const el = $('#typing');
  if (!el) return;
  const map = state.typing.get(state.view.channelId);
  const names = map ? Array.from(map.keys()).map((id) => userName(id) || 'Someone') : [];
  if (!names.length) { el.innerHTML = ''; return; }
  let label;
  if (names.length === 1) label = `<b>${esc(names[0])}</b> is typing…`;
  else if (names.length === 2) label = `<b>${esc(names[0])}</b> and <b>${esc(names[1])}</b> are typing…`;
  else if (names.length === 3) label = `<b>${esc(names[0])}</b>, <b>${esc(names[1])}</b> and <b>${esc(names[2])}</b> are typing…`;
  else label = 'Several people are typing…';
  el.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span>${label}</span>`;
}

// ---------------------------------------------------------------------------
// WebSocket (live updates)
// ---------------------------------------------------------------------------
let ws = null;
let wsRetry = 1000;
let wsTimer = null;
let everConnected = false;
let connBannerTimer = null;

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN && state.connected) {
    try { ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}

function connectWS() {
  clearTimeout(wsTimer);
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleWs();
    return;
  }
  const sock = ws;
  sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', key: session.key, token: session.token, idle: isIdle }));
  sock.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    handleWs(msg);
  };
  sock.onclose = (e) => {
    if (sock !== ws) return;
    state.connected = false;
    scheduleConnBanner();
    renderUserPanel();
    if (e.code === 4001 || e.code === 4002) {
      hooks.onUnauthorized(new ApiError(401, '', { error: e.code === 4002 ? 'bad-token' : 'unauthorized' }));
      return;
    }
    scheduleWs();
  };
  sock.onerror = () => {};
}

function scheduleWs() {
  clearTimeout(wsTimer);
  wsTimer = setTimeout(connectWS, wsRetry);
  wsRetry = Math.min(wsRetry * 1.7, 20000);
}

function scheduleConnBanner() {
  clearTimeout(connBannerTimer);
  connBannerTimer = setTimeout(() => {
    if (state.connected || $('#conn-banner')) return;
    $('#main').insertAdjacentHTML('afterbegin', '<div id="conn-banner">Connection lost — reconnecting… (messages you send will still try to go through)</div>');
  }, 2500);
}

// Retry immediately when the network comes back or the tab wakes up.
window.addEventListener('online', () => { if (!state.connected && state.me) { wsRetry = 1000; connectWS(); } });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me && !state.connected && (!ws || ws.readyState > 1)) { wsRetry = 1000; connectWS(); }
});

async function handleWs(msg) {
  switch (msg.type) {
    case 'ready': {
      state.connected = true;
      wsRetry = 1000;
      clearTimeout(connBannerTimer);
      const b = $('#conn-banner');
      if (b) b.remove();
      state.online = new Map((msg.online || []).map((o) => [o.id, o.status]));
      state.unlocked.forEach((hash, chatId) => wsSend({ type: 'unlock', chatId, passwordHash: hash }));
      if (everConnected) await resync();
      everConnected = true;
      onPresenceChanged();
      break;
    }
    case 'presence':
      state.online = new Map((msg.online || []).map((o) => [o.id, o.status]));
      onPresenceChanged();
      break;
    case 'user:update': {
      const u = msg.user;
      const prev = state.users.get(u.id);
      state.users.set(u.id, u);
      if (state.me && u.id === state.me.id) state.me = Object.assign({}, state.me, u);
      if (!prev || prev.name !== u.name || prev.avatar !== u.avatar) refreshAll();
      else onPresenceChanged();
      break;
    }
    case 'chat:upsert':
      upsertChat(msg.chat);
      break;
    case 'chat:remove':
      removeChat(msg.chatId);
      break;
    case 'message:new':
      onMessageNew(msg);
      break;
    case 'message:update':
      if (!msg.message.locked) onMessageUpdate(msg.message);
      break;
    case 'message:delete':
      onMessageDelete(msg);
      break;
    case 'typing':
      handleTyping(msg);
      break;
    case 'read':
      onRead(msg);
      break;
    default:
  }
}

async function resync() {
  try {
    const data = await api('GET', '/api/bootstrap');
    ingestBootstrap(data);
  } catch (e) {
    return;
  }
  // Messages may have been missed while offline: drop caches and reload the open channel.
  const v = state.view;
  state.messages.forEach((c, id) => { if (id !== v.channelId) state.messages.delete(id); });
  if (v.type === 'chat' && !state.chats.has(v.chatId)) { goHome({ push: false }); return; }
  renderChrome();
  if (v.type === 'chat' && $('#msg-list')) {
    const cache = state.messages.get(v.channelId);
    try {
      const r = await loadMessages(v.channelId, {});
      if (state.view.channelId !== v.channelId) return;
      const atBottom = isAtBottom();
      setCache(v.channelId, r, cache);
      if (atBottom || !cache) { renderMessageList(); scrollToBottom(); } else rerenderMessagesKeepScroll();
      markReadSoon();
    } catch (e) { /* ignore */ }
  } else if (v.type === 'home') drawPeople();
}

function onPresenceChanged() {
  renderRail();
  renderSidebar();
  renderUserPanel();
  const hs = $('#h-status');
  const { chat } = currentChat();
  if (hs && chat && chat.type === 'dm') { const o = dmOther(chat); hs.className = 'status-ico s-' + statusOf(o && o.id); }
  if (state.rightPanel !== 'search') renderRightPanel();
  if (state.view.type === 'home') drawPeople();
}

function previewText(m) {
  if (m.text) return plainText(m.text, userName).slice(0, 180);
  const a = (m.attachments || [])[0];
  if (a) {
    const k = fileKind(a.type, a.name);
    return k === 'image' ? '📷 Sent a photo' : k === 'video' ? '🎞️ Sent a video' : k === 'zip' ? `📦 Shared ${a.name}` : `📎 Sent ${a.name}`;
  }
  if (m.gif) return '🎞️ Sent a GIF';
  return 'New message';
}

function onMessageNew({ message: m, nonce }) {
  const found = findChannel(m.channelId);
  if (!found) return;
  const { chat, channel } = found;
  const viewingChannel = state.view.type === 'chat' && state.view.channelId === m.channelId;

  if (!m.locked) {
    const cache = state.messages.get(m.channelId);
    if (cache) {
      if (nonce && cache.list.some((x) => x.id === nonce)) {
        reconcile(m.channelId, nonce, m);
      } else if (!cache.list.some((x) => x.id === m.id) && !cache.hasMoreAfter) {
        cache.list.push(m);
        if (viewingChannel && $('#msg-list')) appendMessage(m);
      }
    }
  }
  channel.lastMessage = { id: m.id, senderId: m.senderId, ts: m.ts, preview: m.locked ? '' : previewText(m) };
  if (m.type !== 'system') chat.lastMessageAt = m.ts;

  if (m.senderId === state.me.id) {
    state.reads[m.channelId] = Math.max(state.reads[m.channelId] || 0, m.ts);
    state.unread.set(m.channelId, { count: 0, mentions: 0 });
    renderRail();
    renderSidebar();
    updateBadges();
    return;
  }
  clearTyping(m.channelId, m.senderId);
  if (m.type === 'system') { renderSidebar(); return; }
  if (chat.type === 'dm' && prefs.hiddenDMs[chat.id]) { delete prefs.hiddenDMs[chat.id]; savePrefs(); }

  const focused = document.visibilityState === 'visible' && document.hasFocus();
  const viewing = viewingChannel && focused;
  const mention = chat.type === 'dm' || (m.mentions || []).includes(state.me.id) || !!m.mentionsEveryone;
  if (viewing && state.stickBottom && state.suppressReadFor !== m.channelId) {
    markReadSoon();
  } else {
    const u = state.unread.get(m.channelId) || { count: 0, mentions: 0 };
    state.unread.set(m.channelId, { count: u.count + 1, mentions: u.mentions + (mention ? 1 : 0) });
    if (viewingChannel && state.newMarkerTs === null) state.newMarkerTs = state.reads[m.channelId] || m.ts - 1;
  }
  renderRail();
  renderSidebar();
  updateBadges();
  maybeNotify(chat, channel, m, mention, viewing);
}

let lastSoundAt = 0;
function maybeNotify(chat, channel, m, mention, viewing) {
  if (viewing) return;
  if (prefs.muteAll) return;
  if (state.me.status === 'dnd') return;
  if (isChatMuted(chat.id)) return;
  if (prefs.mentionsOnly && !mention) return;
  if (prefs.sounds && Date.now() - lastSoundAt > 1200) {
    lastSoundAt = Date.now();
    playSound(mention ? 'mention' : 'message');
  }
  if (prefs.desktop && notifPermission() === 'granted') {
    const sender = getUser(m.senderId) || { id: m.senderId, name: 'Someone' };
    const title = chat.type === 'dm' ? sender.name : `${sender.name} (#${channel.name}, ${chat.name})`;
    const body = m.locked ? '🔒 New message in a locked group' : (prefs.notifPreview ? previewText(m) : 'Sent you a message');
    showDesktopNotification({
      title,
      body,
      icon: avatarIconFor(sender),
      tag: m.channelId,
      hash: `#/c/${chat.id}/${m.channelId}`,
      onClick: () => openChat(chat.id, m.channelId)
    });
  }
}

function onMessageUpdate(m) {
  const cache = state.messages.get(m.channelId);
  if (!cache) return;
  const i = cache.list.findIndex((x) => x.id === m.id);
  if (i === -1) return;
  cache.list[i] = m;
  if (state.view.channelId === m.channelId) replaceMessage(m);
}

function onMessageDelete({ channelId, id }) {
  const cache = state.messages.get(channelId);
  if (cache) {
    const i = cache.list.findIndex((x) => x.id === id);
    if (i !== -1) cache.list.splice(i, 1);
  }
  if (state.editingId === id) state.editingId = null;
  if (state.view.channelId === channelId && msgNode(id)) rerenderMessagesKeepScroll();
}

function onRead({ chatId, channelId, userId, ts }) {
  if (userId === state.me.id) {
    state.reads[channelId] = Math.max(state.reads[channelId] || 0, ts);
    const found = findChannel(channelId);
    const last = found && found.channel.lastMessage;
    if (!last || last.ts <= ts) {
      state.unread.set(channelId, { count: 0, mentions: 0 });
      renderRail();
      renderSidebar();
      updateBadges();
    }
    return;
  }
  const r = state.dmReads.get(chatId) || {};
  r[userId] = Math.max(r[userId] || 0, ts);
  state.dmReads.set(chatId, r);
  if (state.view.type === 'chat' && state.view.chatId === chatId) renderSeen();
}

// ---------------------------------------------------------------------------
// Badges, title, notification banner
// ---------------------------------------------------------------------------
function updateBadges() {
  let total = 0;
  let anyMention = false;
  state.chats.forEach((c) => {
    if (isChatMuted(c.id)) return;
    const u = chatUnread(c);
    if (c.type === 'dm') total += u.count;
    else total += u.mentions;
    if (u.mentions) anyMention = true;
  });
  const v = state.view;
  let title = 'People';
  if (v.type === 'chat') {
    const { chat, channel } = currentChat();
    if (chat) title = chat.type === 'dm' ? '@' + chatName(chat) : `#${channel.name} | ${chat.name}`;
  }
  const shown = prefs.titleBadge ? total : 0;
  document.title = (shown ? `(${shown}) ` : '') + title + ' — Messages';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  setTabBadge(shown, anyMention, accent);
  try {
    if ('setAppBadge' in navigator) { if (shown) navigator.setAppBadge(shown); else navigator.clearAppBadge(); }
  } catch (e) {}
}

function refreshNotifBanner() {
  const b = $('#notif-banner');
  if (!b) return;
  const perm = notifPermission();
  if (notifSupported() && perm === 'default' && !prefs.notifBannerDismissed && state.me) {
    b.className = '';
    b.innerHTML = `<span>🔔 Want a pop-up on your computer when someone messages you?</span><button class="btn" id="nb-enable">Enable desktop notifications</button><button class="x" id="nb-x" aria-label="Dismiss">✕</button>`;
    $('#nb-enable').onclick = async () => {
      unlockAudio();
      const p = await requestNotifPermission();
      if (p === 'granted') {
        prefs.desktop = true;
        savePrefs();
        showDesktopNotification({ title: 'Messages', body: "You're all set! You'll get notified about new messages. Mute them any time from the 🔔 button.", icon: avatarIconFor(state.me), tag: 'welcome' });
        toast('🔔 Desktop notifications are on', 'ok');
      } else if (p === 'denied') {
        toast('Notifications were blocked. You can allow them from the 🔒 icon in the address bar.', 'error');
      }
      refreshNotifBanner();
    };
    $('#nb-x').onclick = () => { prefs.notifBannerDismissed = true; savePrefs(); refreshNotifBanner(); };
  } else {
    b.className = 'hidden';
    b.innerHTML = '';
  }
}

// ---------------------------------------------------------------------------
// Idle detection (shows you as "Idle" after 10 minutes away)
// ---------------------------------------------------------------------------
let lastActivity = Date.now();
let isIdle = false;
function onActivity() {
  lastActivity = Date.now();
  if (isIdle) { isIdle = false; wsSend({ type: 'idle', idle: false }); }
}
['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel'].forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
window.addEventListener('mousedown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
setInterval(() => {
  if (!isIdle && Date.now() - lastActivity > 10 * 60 * 1000) { isIdle = true; wsSend({ type: 'idle', idle: true }); }
}, 30000);

// Clicking a desktop notification (handled by the service worker) opens the chat.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'open' && e.data.hash && state.me) routeFromHash(e.data.hash, true);
  });
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
function isEditable(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function moveChannel(dir) {
  const rows = $$('#sidebar-body [data-chat]');
  if (!rows.length) return;
  const v = state.view;
  let i = rows.findIndex((r) => r.dataset.chat === v.chatId && (!r.dataset.channel || r.dataset.channel === v.channelId));
  i = i === -1 ? (dir > 0 ? 0 : rows.length - 1) : (i + dir + rows.length) % rows.length;
  openChat(rows[i].dataset.chat, rows[i].dataset.channel);
}

document.addEventListener('keydown', (e) => {
  if (!state.me || $('#app').classList.contains('hidden')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if (closeTop()) { e.preventDefault(); return; }
    if (document.body.classList.contains('nav-open')) { document.body.classList.remove('nav-open'); return; }
    if (state.editingId) { cancelEdit(); return; }
    if (state.replyTo) { state.replyTo = null; renderReplyBar(); return; }
    if (state.view.type === 'chat' && !isEditable(document.activeElement) || (document.activeElement && document.activeElement.id === 'c-input')) {
      state.suppressReadFor = null;
      jumpToPresent();
    }
    return;
  }
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openQuickSwitcher(); return; }
  if (mod && e.key === ',') { e.preventDefault(); openSettings(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'u') { e.preventDefault(); if (state.view.type === 'chat') $('#file-input').click(); return; }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); setMuteAll(!prefs.muteAll); return; }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveChannel(e.key === 'ArrowUp' ? -1 : 1); return; }
  if (!mod && !e.altKey && e.key.length === 1 && !hasOpenLayer() && !isEditable(document.activeElement)) {
    const ci = $('#c-input');
    if (ci) ci.focus();
  }
});

window.addEventListener('resize', debounce(() => { if (state.me) renderRightPanel(); }, 150));
window.addEventListener('beforeunload', () => {
  const v = state.view;
  const i = $('#c-input');
  if (v.type === 'chat' && i) { saveDraftNow(v.channelId, i.value); LS.set('drafts', JSON.stringify(drafts)); }
});

boot();
