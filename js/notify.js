// Desktop notifications (Windows / macOS toasts via the browser), sounds,
// and the tab title / favicon unread badge.
import { colorFor, initials } from './util.js';
import { mediaUrl } from './api.js';


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
export async function showDesktopNotification({ title, body, icon, tag, hash, onClick }) {
  if (notifPermission() !== 'granted') return false;
  const opts = { body, icon, tag, renotify: !!tag, silent: true, data: { hash: hash || '' } };
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
    const notes = kind === 'mention' ? [784, 1047, 1319] : kind === 'test' ? [660, 880] : [880, 1175];
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
