// Desktop notifications (Windows / macOS toasts via the browser), sounds,
// and the tab title / favicon unread badge.
import { colorFor, initials } from './util.js';
import { api, mediaUrl } from './api.js';
import { SERVER_ORIGIN } from './config.js';

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    return await navigator.serviceWorker.register('./sw.js');
  } catch (e) {
    return null;
  }
}

export const notifSupported = () => 'Notification' in window;
export const notifPermission = () => (notifSupported() ? Notification.permission : 'unsupported');

export async function requestNotifPermission() {
  if (!notifSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch (e) {
    // very old Safari uses the callback form
    return new Promise((resolve) => Notification.requestPermission(resolve));
  }
}

// ---- Push: lets the browser show notifications with every tab closed ----
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;

function keyBytes(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameKey(buffer, bytes) {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
}

async function swReady() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))]);
  return reg && reg.pushManager ? reg : null;
}

// Subscribes this browser (once) and tells the server. Returns the device id.
export async function syncPush(publicKey, pushPrefs) {
  if (!pushSupported() || notifPermission() !== 'granted' || !publicKey) return null;
  const reg = await swReady();
  if (!reg) return null;
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const res = await api('POST', '/api/push/subscribe', { subscription: sub.toJSON(), origin: SERVER_ORIGIN, prefs: pushPrefs });
  try { localStorage.setItem('push_id', res.id); } catch (e) {}
  return res.id;
}

export function pushDeviceId() {
  try { return localStorage.getItem('push_id'); } catch (e) { return null; }
}

export async function updatePushPrefs(pushPrefs) {
  const id = pushDeviceId();
  if (id) await api('PATCH', `/api/push/${id}`, { prefs: pushPrefs }, { quiet: true });
}

export async function disablePush() {
  const id = pushDeviceId();
  try { localStorage.removeItem('push_id'); } catch (e) {}
  if (id) await api('DELETE', `/api/push/${id}`, undefined, { quiet: true }).catch(() => {});
  if (!pushSupported()) return;
  const reg = await swReady();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe().catch(() => {});
}

const iconCache = new Map();
export function avatarIconFor(user) {
  const src = user && mediaUrl(user.avatar);
  if (src) return src;
  const key = user ? user.id + '|' + user.name : '?';
  if (iconCache.has(key)) return iconCache.get(key);
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = colorFor(user ? user.id : '?');
    ctx.beginPath(); ctx.arc(64, 64, 64, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '600 52px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initials(user ? user.name : '?'), 64, 68);
    const url = c.toDataURL('image/png');
    iconCache.set(key, url);
    return url;
  } catch (e) {
    return undefined;
  }
}

// Show a system notification. Prefers the service worker (better Windows
// integration + clicking it focuses the tab); falls back to `new Notification`.
export async function showDesktopNotification({ title, body, icon, tag, hash, onClick, sticky = false }) {
  if (notifPermission() !== 'granted') return false;
  const opts = { body, icon, tag, renotify: !!tag, silent: true, requireInteraction: sticky, data: { hash: hash || '' } };
  try {
    // Wait (briefly) for the service worker to be active — showNotification
    // throws on a registration that hasn't finished installing.
    const reg = navigator.serviceWorker && window.isSecureContext
      ? await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 1500))])
      : null;
    if (reg && reg.active && reg.showNotification) {
      await reg.showNotification(title, opts);
      return true;
    }
  } catch (e) {}
  try {
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); if (onClick) onClick(); n.close(); };
    return true;
  } catch (e) {
    return false;
  }
}

// ---- Sounds (synthesised, no audio files needed) ----
let audioCtx = null;
export function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}

export function playSound(kind = 'message') {
  try {
    if (!audioCtx) unlockAudio();
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const notes = {
      mention: [784, 1047, 1319],
      test: [660, 880],
      join: [523, 784],
      leave: [784, 523],
      ring: [659, 784, 659, 784]
    }[kind] || [880, 1175];
    notes.forEach((freq, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      const start = t + i * 0.09;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      o.connect(g).connect(audioCtx.destination);
      o.start(start);
      o.stop(start + 0.25);
    });
  } catch (e) {}
}

let ringTimer = null;
export function startRing() {
  if (ringTimer) return;
  playSound('ring');
  ringTimer = setInterval(() => playSound('ring'), 2600);
}
export function stopRing() {
  clearInterval(ringTimer);
  ringTimer = null;
}

// ---- Tab badge ----
let lastBadge = null;
export function setTabBadge(count, mention, accent) {
  const key = count + '|' + mention + '|' + accent;
  if (key === lastBadge) return;
  lastBadge = key;
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = accent || '#5865f2';
    roundRect(ctx, 2, 2, 60, 60, 18); ctx.fill();
    // speech bubble
    ctx.fillStyle = '#fff';
    roundRect(ctx, 13, 15, 38, 27, 9); ctx.fill();
    ctx.beginPath(); ctx.moveTo(20, 40); ctx.lineTo(18, 50); ctx.lineTo(30, 41); ctx.fill();
    if (count > 0) {
      ctx.fillStyle = mention ? '#f23f43' : '#f23f43';
      ctx.beginPath(); ctx.arc(46, 46, 17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(count > 9 ? '9+' : String(count), 46, 47);
    }
    link.type = 'image/png';
    link.href = c.toDataURL('image/png');
  } catch (e) {}
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
