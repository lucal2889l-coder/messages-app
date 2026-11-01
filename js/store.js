// Shared app state + small view helpers used by every UI module.
import { esc, colorFor, initials, prefs24h } from './util.js';
import { mediaUrl } from './api.js';

export const state = {
  me: null,
  users: new Map(),      // id -> public user
  chats: new Map(),      // id -> chat (with channels)
  online: new Map(),     // userId -> 'online' | 'idle' | 'dnd'
  unread: new Map(),     // channelId -> { count, mentions }
  reads: {},             // channelId -> ts (mine)
  dmReads: new Map(),    // chatId -> { userId: ts }
  messages: new Map(),   // channelId -> { list, hasMoreBefore, hasMoreAfter }
  typing: new Map(),     // channelId -> Map(userId -> timeoutId)
  unlocked: new Map(),   // chatId -> passwordHash (this tab only)
  view: { type: 'home' },
  homeTab: 'online',
  rightPanel: null,      // null | 'members' | 'profile' | 'search'
  search: null,          // { query, results, loading }
  replyTo: null,         // { id, senderId, ping }
  editingId: null,
  pending: [],           // attachments waiting to be sent
  maxUploadBytes: 50 * 1024 * 1024,
  connected: false
};

// Filled in by app.js so other modules can trigger navigation etc. without
// circular imports.
export const actions = {};

// ---------------- Preferences (this browser only) ----------------
const PREF_DEFAULTS = {
  theme: null,
  accent: null,
  fontSize: 15,
  compact: false,
  use24h: false,
  reduceMotion: false,
  embeds: true,
  desktop: true,         // show desktop notifications (if the browser allows)
  muteAll: false,        // the big "silence everything" switch
  mentionsOnly: false,
  notifPreview: true,
  sounds: true,
  titleBadge: true,
  mutedChats: {},        // chatId -> true
  hiddenDMs: {},         // chatId -> ts hidden at
  lastChannel: {},       // chatId -> channelId
  recentEmoji: [],
  notifBannerDismissed: false,
  memberList: true,
  sendOnEnter: true
};

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('prefs') || '{}') || {}; } catch (e) {}
  const merged = Object.assign({}, PREF_DEFAULTS, p);
  if (!merged.theme) {
    // carry over the theme picked in the old version of the app
    try { merged.theme = localStorage.getItem('theme') || 'dark'; } catch (e) { merged.theme = 'dark'; }
  }
  return merged;
}

export const prefs = loadPrefs();
prefs24h.value = !!prefs.use24h;

export function savePrefs() {
  try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch (e) {}
  prefs24h.value = !!prefs.use24h;
}

export function applyAppearance() {
  const root = document.documentElement;
  root.setAttribute('data-theme', prefs.theme || 'dark');
  if (prefs.accent) root.style.setProperty('--accent', prefs.accent);
  else root.style.removeProperty('--accent');
  root.style.setProperty('--fs', (prefs.fontSize || 15) + 'px');
  document.body.classList.toggle('compact', !!prefs.compact);
  document.body.classList.toggle('reduce-motion', !!prefs.reduceMotion);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--rail').trim() || '#1e1f22');
}

export const THEMES = [
  { slug: 'dark', name: 'Dark', c: ['#1e1f22', '#2b2d31', '#313338', '#5865f2'] },
  { slug: 'light', name: 'Light', c: ['#e3e5e8', '#f2f3f5', '#ffffff', '#5865f2'] },
  { slug: 'midnight', name: 'Midnight', c: ['#000000', '#0b0b0d', '#000000', '#6d78ff'] },
  { slug: 'ocean', name: 'Ocean', c: ['#071d26', '#0c2833', '#10313d', '#14b8c4'] },
  { slug: 'forest', name: 'Forest', c: ['#121a14', '#19241b', '#1e2b20', '#3fa65a'] },
  { slug: 'sunset', name: 'Sunset', c: ['#1f1316', '#2a1a1d', '#331f22', '#ff6b3d'] },
  { slug: 'solarized', name: 'Solarized', c: ['#00212b', '#002b36', '#073642', '#268bd2'] },
  { slug: 'lavender', name: 'Lavender', c: ['#e9e3f8', '#f3effc', '#fbfaff', '#7c3aed'] },
  { slug: 'rose', name: 'Rose', c: ['#f7e1e8', '#fcedf2', '#fff8fa', '#e0447b'] },
  { slug: 'mono', name: 'Mono', c: ['#e6e6e6', '#f0f0f0', '#ffffff', '#222222'] }
];

// ---------------- Lookups ----------------
export function getUser(id) {
  return state.users.get(id) || null;
}

export function userName(id) {
  const u = state.users.get(id);
  return u ? u.name : null;
}

export function statusOf(id) {
  if (!id) return 'offline';
  if (state.me && id === state.me.id) {
    if (!state.connected) return 'offline';
    return state.me.status === 'invisible' ? 'invisible' : (state.online.get(id) || state.me.status || 'online');
  }
  return state.online.get(id) || 'offline';
}

export const STATUS_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible', offline: 'Offline' };

export function dmOther(chat) {
  if (!chat || chat.type !== 'dm' || !state.me) return null;
  const otherId = (chat.memberIds || []).find((id) => id !== state.me.id) || null;
  return otherId ? (state.users.get(otherId) || { id: otherId, name: chat.name || 'Unknown' }) : null;
}

export function chatName(chat) {
  if (!chat) return '';
  if (chat.type === 'dm') {
    const o = dmOther(chat);
    return o ? o.name : (chat.name || 'Direct Message');
  }
  return chat.name;
}

export function channelOf(chatId, channelId) {
  const chat = state.chats.get(chatId);
  return chat ? chat.channels.find((c) => c.id === channelId) || null : null;
}

export function findChannel(channelId) {
  for (const chat of state.chats.values()) {
    const ch = chat.channels.find((c) => c.id === channelId);
    if (ch) return { chat, channel: ch };
  }
  return null;
}

export function canManage(chat) {
  if (!chat || chat.type === 'dm' || !state.me) return false;
  if (!chat.ownerId) return true;
  return chat.ownerId === state.me.id;
}

export function chatMembers(chat) {
  if (!chat) return [];
  if (Array.isArray(chat.memberIds)) return chat.memberIds.map((id) => state.users.get(id)).filter(Boolean);
  return Array.from(state.users.values());
}

export function isChatMuted(chatId) {
  return !!prefs.mutedChats[chatId];
}

export function chatUnread(chat) {
  let count = 0;
  let mentions = 0;
  chat.channels.forEach((ch) => {
    const u = state.unread.get(ch.id);
    if (u) { count += u.count; mentions += u.mentions; }
  });
  return { count, mentions };
}

export function isLockedForMe(chat) {
  return !!(chat && chat.locked && !state.unlocked.has(chat.id));
}

// ---------------- HTML helpers ----------------
export function avatarHtml(user, size = 40, opts = {}) {
  const name = user ? user.name : '?';
  const src = user ? mediaUrl(user.avatar) : '';
  const inner = src
    ? `<img src="${esc(src)}" alt="" loading="lazy" draggable="false">`
    : `<span class="av-fallback" style="background:${colorFor(user ? user.id : name)}">${esc(initials(name))}</span>`;
  const dot = opts.status ? `<i class="status-dot s-${statusOf(user && user.id)}"></i>` : '';
  return `<span class="av" style="--av:${size}px"${user ? ` data-user="${esc(user.id)}"` : ''}>${inner}${dot}</span>`;
}

export function chatIconHtml(chat, size = 48) {
  if (chat.type === 'dm') return avatarHtml(dmOther(chat), size, { status: true });
  const src = mediaUrl(chat.icon);
  const inner = src ? `<img src="${esc(src)}" alt="" draggable="false">` : esc(initials(chat.name));
  return `<span class="group-icon" style="--gi:${size}px;${src ? '' : `background:${colorFor(chat.id)};color:#fff;`}">${inner}</span>`;
}

export function bannerColor(user) {
  return (user && user.accent) || colorFor(user ? user.id : '?');
}

export function displayTime24() { return !!prefs.use24h; }
