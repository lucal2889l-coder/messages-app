'use strict';

/*
 * Messages — backend
 *
 * One Node process serves:
 *   - a small JSON REST API (/api/*) for users, chats, channels, messages
 *   - file uploads (/api/upload) and downloads (/files/:id/:name)
 *   - a WebSocket (/ws) that pushes live events (new messages, typing,
 *     presence, reactions, edits ...) to every connected browser, and relays
 *     WebRTC signalling for voice calls
 *   - Web Push, so notifications still arrive after every tab is closed
 *   - the static frontend itself (index.html, css/, js/, gifs/)
 *
 * Everything is persisted to a single JSON file (DATA_DIR/data.json) plus an
 * uploads folder (DATA_DIR/uploads). Writes are debounced and atomic
 * (write to a temp file, then rename) so a crash mid-write can't corrupt it.
 *
 * Access model:
 *   - People log in with a username + password. Passwords are scrypt-hashed.
 *   - Creating an account needs a token: an invite made in the admin panel,
 *     SIGNUP_TOKEN (falls back to the old SITE_KEY), or ADMIN_CODE itself.
 *   - Each login gets its own session token, so one device can be signed out
 *     without touching the others. Sessions are what kick / ban revoke.
 *   - ADMIN_CODE turns an account into an admin from Settings -> Admin.
 *   - Private groups and DMs are only ever sent to their members.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const webpush = require('web-push');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const LEGACY_DEFAULT_KEY = '123456789';
const SIGNUP_TOKEN = process.env.SIGNUP_TOKEN ||
  (process.env.SITE_KEY && process.env.SITE_KEY !== LEGACY_DEFAULT_KEY ? process.env.SITE_KEY : '');
const PORT = process.env.PORT || 3000;
// Point DATA_DIR at a persistent volume (e.g. /data on Coolify/Docker) so
// chats survive restarts. Defaults to the app folder.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 50) * 1024 * 1024;
const API_VERSION = 3;
const DB_VERSION = 3;
const MAX_CALL_PEERS = 8; // calls are peer-to-peer, so each person uploads to everyone else

const LIMITS = {
  name: 32,
  chatName: 60,
  channelName: 40,
  topic: 300,
  description: 300,
  bio: 300,
  customStatus: 80,
  text: 4000,
  attachments: 10,
  fileName: 180,
  pageSize: 50,
  username: 24,
  password: 200,
  reason: 200,
  tag: 24,
  serverMessage: 300,
  inviteNote: 60
};

const USER_STATUSES = ['online', 'idle', 'dnd', 'invisible'];
const SERVER_STATUSES = ['online', 'announcement', 'degraded', 'readonly', 'maintenance'];
const LOOK_OPTIONS = {
  nameFx: ['none', 'glow', 'shimmer', 'rainbow', 'pulse'],
  nameFont: ['default', 'serif', 'mono', 'rounded', 'hand'],
  ring: ['none', 'neon', 'gold', 'fire', 'ice', 'rainbow', 'orbit', 'pulse']
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newId = () => crypto.randomUUID();
const now = () => Date.now();

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cleanStr(v, max) {
  if (typeof v !== 'string') return '';
  // strip control chars except newlines/tabs
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function cleanOneLine(v, max) {
  return cleanStr(v, max).replace(/\s+/g, ' ');
}

function isValidId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

const FILE_PATH_RE = /^\/files\/[a-f0-9]{32}\/[^/?#"'<>\\]{1,200}$/;
const DATA_IMG_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;
function isValidImageRef(v) {
  if (v === null) return true;
  if (typeof v !== 'string') return false;
  if (FILE_PATH_RE.test(v)) {
    const id = v.split('/')[2];
    return !!(db.files[id] && /^image\/(png|jpeg|gif|webp)$/.test(db.files[id].type));
  }
  return v.length < 400000 && DATA_IMG_RE.test(v); // legacy inline avatars
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
const hexOrNull = (v) => (typeof v === 'string' && HEX_RE.test(v) ? v : null);
const pick = (v, allowed) => (allowed.includes(v) ? v : allowed[0]);

// The Nitro-style look of a profile. Everything is whitelisted here so a client
// can never inject its own CSS into other people's browsers.
function cleanLook(v) {
  const l = v && typeof v === 'object' ? v : {};
  const flair = typeof l.flair === 'string' && /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f]{1,16}$/u.test(l.flair) ? l.flair : '';
  return {
    nameColor: hexOrNull(l.nameColor),
    nameColor2: hexOrNull(l.nameColor2),
    nameFx: pick(l.nameFx, LOOK_OPTIONS.nameFx),
    nameFont: pick(l.nameFont, LOOK_OPTIONS.nameFont),
    ring: pick(l.ring, LOOK_OPTIONS.ring),
    ringColor: hexOrNull(l.ringColor),
    banner: l.banner && isValidImageRef(l.banner) ? l.banner : null,
    bannerColor2: hexOrNull(l.bannerColor2),
    themeA: hexOrNull(l.themeA),
    themeB: hexOrNull(l.themeB),
    flair
  };
}

function cleanTag(v) {
  if (!v || typeof v !== 'object') return null;
  const text = cleanOneLine(v.text, LIMITS.tag);
  return text ? { text, color: hexOrNull(v.color) } : null;
}

function isValidGif(v) {
  if (typeof v !== 'string' || v.length > 2000) return false;
  return /^https:\/\/raw\.githubusercontent\.com\/[^\s"'<>]+$/.test(v) ||
         /^\/gifs\/[^/?#"'<>\\]+\.gif$/i.test(v);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function emptyDb() {
  return { version: DB_VERSION, users: {}, chats: {}, messages: {}, files: {}, settings: {}, invites: {}, push: {}, audit: [] };
}

// The original app stored everything as loose keys:
//   chats -> [ ... ], messages:<chatId> -> [ ... ], profiles:<userId> -> {...}
// Convert that into the structured v2 layout, keeping every id so old
// messages still line up with the people who sent them.
function migrateV1(old) {
  const d = emptyDb();
  const t = now();
  const ensureUser = (id, name, avatar) => {
    if (!isValidId(id)) return;
    if (!d.users[id]) {
      d.users[id] = {
        id,
        name: cleanOneLine(name || 'Someone', LIMITS.name) || 'Someone',
        avatar: null,
        bio: '',
        customStatus: '',
        status: 'online',
        accent: null,
        createdAt: t,
        lastSeen: 0,
        tokenHash: null,
        reads: {}
      };
    }
    if (typeof avatar === 'string' && DATA_IMG_RE.test(avatar) && avatar.length < 400000) {
      d.users[id].avatar = avatar;
    }
  };

  Object.keys(old).forEach((k) => {
    if (k.indexOf('profiles:') === 0 && old[k] && typeof old[k] === 'object') {
      ensureUser(old[k].id || k.slice(9), old[k].name, old[k].avatar);
    }
  });

  const chats = Array.isArray(old.chats) ? old.chats : [];
  chats.forEach((c) => {
    if (!c || !isValidId(c.id)) return;
    const isRealDm = !!(c.isDM && Array.isArray(c.participantIds) && c.participantIds.length >= 2);
    d.chats[c.id] = {
      id: c.id,
      type: isRealDm ? 'dm' : 'group',
      name: cleanOneLine(c.title || 'Chat', LIMITS.chatName) || 'Chat',
      icon: null,
      description: '',
      ownerId: null, // legacy chats have no owner, so any member can manage them
      memberIds: isRealDm ? c.participantIds.filter(isValidId).slice(0, 2) : null,
      channels: [{ id: c.id, name: isRealDm ? 'dm' : 'general', topic: '', createdAt: c.createdAt || t }],
      locked: !!(c.locked && c.passwordHash),
      passwordHash: c.locked && typeof c.passwordHash === 'string' ? c.passwordHash : null,
      createdAt: c.createdAt || t,
      lastMessageAt: c.lastMessageAt || c.createdAt || t
    };
    const msgs = Array.isArray(old['messages:' + c.id]) ? old['messages:' + c.id] : [];
    d.messages[c.id] = msgs.filter((m) => m && isValidId(m.id)).map((m) => {
      ensureUser(m.senderId, m.senderName);
      return {
        id: m.id,
        channelId: c.id,
        senderId: m.senderId,
        text: typeof m.text === 'string' ? m.text : '',
        attachments: [],
        gif: isValidGif(m.gif) ? m.gif : null,
        image: typeof m.image === 'string' && DATA_IMG_RE.test(m.image) ? m.image : null,
        replyTo: m.replyTo && isValidId(m.replyTo.id)
          ? { id: m.replyTo.id, senderId: null, senderName: cleanOneLine(m.replyTo.senderName || '', 60), text: cleanStr(m.replyTo.text || '', 120) }
          : null,
        reactions: m.reactions && typeof m.reactions === 'object' ? m.reactions : {},
        mentions: [],
        ts: Number(m.ts) || t,
        editedAt: null,
        pinned: false
      };
    });
    (c.participantIds || []).forEach((uid) => ensureUser(uid, 'Someone'));
  });
  return d;
}

function loadDb() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf8');
  } catch (e) {
    return emptyDb();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const bad = DATA_FILE + '.corrupt-' + now();
    fs.copyFileSync(DATA_FILE, bad);
    console.error('[error] data.json was unreadable; copied it to', bad, 'and started fresh.');
    return emptyDb();
  }
  if (parsed && (parsed.version === DB_VERSION || parsed.version === 2)) {
    if (parsed.version === 2) {
      try { fs.writeFileSync(path.join(DATA_DIR, 'data.v2-backup.json'), raw); } catch (e) {}
      console.log('[migrate] Upgraded data.json to accounts (backup saved to data.v2-backup.json).');
    }
    return Object.assign(emptyDb(), parsed, { version: DB_VERSION });
  }
  // v1 -> v3
  const backup = path.join(DATA_DIR, 'data.v1-backup.json');
  try { fs.writeFileSync(backup, raw); } catch (e) {}
  console.log('[migrate] Upgraded data.json from the old format (backup saved to data.v1-backup.json).');
  return migrateV1(parsed || {});
}

const db = loadDb();

// Fill in fields added since a user / the database was first written. Existing
// people keep working with their old browser token, which becomes their first
// session, until they pick a username and password.
function normalizeUser(u) {
  if (!Array.isArray(u.sessions)) {
    u.sessions = u.tokenHash ? [{ hash: u.tokenHash, createdAt: u.createdAt || now() }] : [];
  }
  delete u.tokenHash;
  u.username = u.username || null;
  u.passwordHash = u.passwordHash || null;
  u.role = u.role === 'admin' ? 'admin' : 'member';
  u.look = cleanLook(u.look);
  u.tag = u.tag || null;
  u.statusLocked = !!u.statusLocked;
  u.banned = u.banned || null; // { reason, by, at }
  u.timeoutUntil = u.timeoutUntil || 0;
}

Object.values(db.users).forEach(normalizeUser);
db.settings = db.settings || {};
db.settings.server = Object.assign({ status: 'online', message: '', updatedAt: 0, signupsOpen: true }, db.settings.server);

const ADMIN_CODE = process.env.ADMIN_CODE || db.settings.generatedAdminCode || crypto.randomBytes(9).toString('base64url');
if (process.env.ADMIN_CODE) {
  delete db.settings.generatedAdminCode;
} else {
  db.settings.generatedAdminCode = ADMIN_CODE;
  console.warn(`[admin] ADMIN_CODE is not set. Using a generated code: ${ADMIN_CODE}`);
}

// Web Push needs a key pair. Generated once and kept with the data, so existing
// browser subscriptions survive redeploys.
const vapid = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  : (db.settings.vapid = db.settings.vapid || webpush.generateVAPIDKeys());
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://messages.zdstudios.network', vapid.publicKey, vapid.privateKey);

let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = DATA_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('[error] failed to save data:', e.message);
  }
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, 300);
}
saveNow(); // persist migrations / create the file

function shutdown() {
  saveNow();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// token hash -> user id, lower-case username -> user id
const tokenIndex = new Map();
const usernameIndex = new Map();
Object.values(db.users).forEach((u) => {
  u.sessions.forEach((s) => tokenIndex.set(s.hash, u.id));
  if (u.username) usernameIndex.set(u.username.toLowerCase(), u.id);
});

function startSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = sha256(token);
  user.sessions.push({ hash, createdAt: now() });
  while (user.sessions.length > 20) tokenIndex.delete(user.sessions.shift().hash);
  tokenIndex.set(hash, user.id);
  return token;
}

function revokeSessions(user, keepHash) {
  user.sessions = user.sessions.filter((s) => {
    if (s.hash === keepHash) return true;
    tokenIndex.delete(s.hash);
    return false;
  });
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1 };
function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
const DUMMY_HASH = `scrypt$${crypto.randomBytes(16).toString('base64')}$${crypto.randomBytes(64).toString('base64')}`;
async function verifyPassword(password, stored) {
  const [, salt, key] = String(stored).split('$');
  if (!salt || !key) return false;
  const actual = await scrypt(password, Buffer.from(salt, 'base64'));
  const expected = Buffer.from(key, 'base64');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const USERNAME_RE = /^[a-z0-9_.-]{3,24}$/i;
function usernameError(username, forUser) {
  if (!USERNAME_RE.test(username)) return 'Usernames are 3-24 letters, numbers, dots, dashes or underscores.';
  const owner = usernameIndex.get(username.toLowerCase());
  if (owner && owner !== (forUser && forUser.id)) return 'That username is taken.';
  return null;
}
function passwordError(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters for your password.';
  if (password.length > LIMITS.password) return 'That password is too long.';
  return null;
}
function setUsername(user, username) {
  if (user.username) usernameIndex.delete(user.username.toLowerCase());
  user.username = username;
  usernameIndex.set(username.toLowerCase(), user.id);
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------
function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    avatar: u.avatar || null,
    bio: u.bio || '',
    customStatus: u.customStatus || '',
    accent: u.accent || null,
    createdAt: u.createdAt || 0,
    lastSeen: u.lastSeen || 0,
    username: u.username || null,
    role: u.role || 'member',
    look: u.look || {},
    tag: u.tag || null,
    banned: !!u.banned
  };
}

const isAdmin = (u) => !!(u && u.role === 'admin');

function canSeeChat(userId, chat) {
  if (!chat) return false;
  if (Array.isArray(chat.memberIds)) return chat.memberIds.includes(userId);
  return true; // open group from before groups became invite-only
}

function canManageChat(userId, chat) {
  if (chat.type === 'dm') return false;
  if (isAdmin(db.users[userId])) return true;
  if (!chat.ownerId) return canSeeChat(userId, chat); // legacy / ownerless
  return chat.ownerId === userId;
}

function findChannel(channelId) {
  for (const chat of Object.values(db.chats)) {
    const ch = chat.channels.find((c) => c.id === channelId);
    if (ch) return { chat, channel: ch };
  }
  return null;
}

function lastMessageOf(channelId) {
  const list = db.messages[channelId];
  if (!list || !list.length) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type !== 'system') return list[i];
  }
  return list[list.length - 1];
}

function previewOf(m) {
  if (!m) return '';
  if (m.type === 'system') return m.text;
  if (m.text) return m.text.slice(0, 140);
  if (m.attachments && m.attachments.length) {
    const a = m.attachments[0];
    if (/^image\//.test(a.type)) return '📷 Photo';
    if (/^video\//.test(a.type)) return '🎞️ Video';
    if (/^audio\//.test(a.type)) return '🎵 Audio';
    return '📎 ' + a.name;
  }
  if (m.gif) return '🎞️ GIF';
  if (m.image) return '📷 Photo';
  return '';
}

// Base view of a chat (same for everyone who can see it).
function chatView(chat) {
  return {
    id: chat.id,
    type: chat.type,
    name: chat.name,
    icon: chat.icon || null,
    description: chat.description || '',
    ownerId: chat.ownerId || null,
    memberIds: Array.isArray(chat.memberIds) ? chat.memberIds.slice() : null,
    locked: !!chat.locked,
    createdAt: chat.createdAt,
    lastMessageAt: chat.lastMessageAt || chat.createdAt,
    channels: chat.channels.map((ch) => {
      const last = lastMessageOf(ch.id);
      return {
        id: ch.id,
        name: ch.name,
        topic: ch.topic || '',
        createdAt: ch.createdAt,
        lastMessage: last && !chat.locked
          ? { id: last.id, senderId: last.senderId, ts: last.ts, preview: previewOf(last) }
          : (last ? { id: last.id, senderId: last.senderId, ts: last.ts, preview: '' } : null)
      };
    })
  };
}

// Per-user extras: unread + mention counts per channel.
function chatViewFor(chat, user) {
  const v = chatView(chat);
  const reads = user.reads || {};
  v.channels.forEach((ch) => {
    const lastRead = reads[ch.id] || user.createdAt || 0;
    const list = db.messages[ch.id] || [];
    let unread = 0;
    let mentions = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.ts <= lastRead) break;
      if (m.senderId === user.id || m.type === 'system') continue;
      unread++;
      if (chat.type === 'dm' || (m.mentions && m.mentions.includes(user.id)) || m.mentionsEveryone) mentions++;
    }
    ch.unread = unread;
    ch.mentions = mentions;
    ch.lastRead = lastRead;
  });
  // Other members' read positions (powers "Seen" in DMs)
  if (chat.type === 'dm' && Array.isArray(chat.memberIds)) {
    v.reads = {};
    chat.memberIds.forEach((uid) => {
      const u = db.users[uid];
      if (u && u.reads) v.reads[uid] = u.reads[chat.channels[0].id] || 0;
    });
  }
  return v;
}

function visibleChatsFor(user) {
  return Object.values(db.chats).filter((c) => canSeeChat(user.id, c));
}

function extractMentions(text, chat) {
  const ids = new Set();
  const re = /<@([A-Za-z0-9_-]{1,64})>/g;
  let m;
  while ((m = re.exec(text))) {
    if (db.users[m[1]] && canSeeChat(m[1], chat)) ids.add(m[1]);
  }
  return Array.from(ids);
}

function systemMessage(chat, channelId, text, actorId) {
  const msg = {
    id: newId(),
    channelId,
    type: 'system',
    senderId: actorId,
    text,
    attachments: [],
    reactions: {},
    mentions: [],
    ts: now(),
    editedAt: null,
    pinned: false
  };
  (db.messages[channelId] = db.messages[channelId] || []).push(msg);
  emitToChat(chat, { type: 'message:new', chatId: chat.id, message: msg }, { type: 'message:new', chatId: chat.id, message: redact(msg) });
  return msg;
}

function redact(m) {
  return { id: m.id, channelId: m.channelId, senderId: m.senderId, ts: m.ts, type: m.type, mentions: m.mentions || [], mentionsEveryone: !!m.mentionsEveryone, locked: true };
}

// ---------------------------------------------------------------------------
// App + middleware
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
app.disable('x-powered-by');

// CORS — the frontend is usually hosted elsewhere (GitHub Pages).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, PATCH, DELETE, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name, X-Chat-Pass');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Very small in-memory rate limiter (per IP + bucket).
const rateBuckets = new Map();
function rateLimit(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = bucket + '|' + req.ip;
    const t = now();
    let b = rateBuckets.get(key);
    if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; rateBuckets.set(key, b); }
    b.n++;
    if (b.n > max) {
      res.setHeader('Retry-After', Math.ceil((b.reset - t) / 1000));
      return res.status(429).json({ error: 'Too many attempts — wait a minute and try again.' });
    }
    next();
  };
}
setInterval(() => {
  const t = now();
  rateBuckets.forEach((b, k) => { if (b.reset < t) rateBuckets.delete(k); });
}, 60000).unref();

function userFromToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const id = tokenIndex.get(sha256(token));
  return id ? db.users[id] : null;
}

function requireUser(req, res, next) {
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = userFromToken(token);
  if (!user || user.banned) return res.status(401).json({ error: 'bad-token' });
  req.user = user;
  req.sessionHash = sha256(token);
  next();
}

// During maintenance only admins get through (the client shows a holding screen).
function requireOpen(req, res, next) {
  const s = db.settings.server;
  if (s.status === 'maintenance' && !isAdmin(req.user)) {
    return res.status(503).json({ error: s.message || 'Messages is down for maintenance.', maintenance: true });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only.' });
  next();
}

const authed = [requireUser, requireOpen];
const adminOnly = [requireUser, requireAdmin];

// Timeouts and read-only mode both stop someone posting. Returns the reason, or null.
function postBlock(user) {
  if (isAdmin(user)) return null;
  if (db.settings.server.status === 'readonly') return db.settings.server.message || 'Messages is in read-only mode right now.';
  if (user.timeoutUntil > now()) return `You're timed out until ${new Date(user.timeoutUntil).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC.`;
  return null;
}

function getChatFor(req, res) {
  const chat = db.chats[req.params.chatId];
  if (!chat || !canSeeChat(req.user.id, chat)) {
    res.status(404).json({ error: 'Chat not found.' });
    return null;
  }
  return chat;
}

function chatPassOk(req, chat) {
  if (!chat.locked) return true;
  const pass = req.get('X-Chat-Pass') || '';
  return !!chat.passwordHash && safeEqual(pass, chat.passwordHash);
}

function getChannelFor(req, res, opts) {
  const found = findChannel(req.params.channelId);
  if (!found || !canSeeChat(req.user.id, found.chat)) {
    res.status(404).json({ error: 'Channel not found.' });
    return null;
  }
  if (!(opts && opts.skipLock) && !chatPassOk(req, found.chat)) {
    res.status(403).json({ error: 'locked' });
    return null;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Uploads (registered before the JSON body parser so raw bodies stay raw)
// ---------------------------------------------------------------------------
app.post('/api/upload', rateLimit('upload', 120, 60000), authed, (req, res) => {
  const blocked = postBlock(req.user);
  if (blocked) return res.status(403).json({ error: blocked });
  let name = 'file';
  try { name = decodeURIComponent(req.get('X-File-Name') || 'file'); } catch (e) {}
  name = path.basename(name).replace(/[\u0000-\u001F\u007F/\\?#"'<>%*:|]/g, '_').trim().slice(0, LIMITS.fileName) || 'file';
  let type = (req.get('Content-Type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) type = 'application/octet-stream';

  const declared = Number(req.get('Content-Length'));
  if (declared && declared > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: `That file is too big (max ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB).` });
  }

  const id = crypto.randomBytes(16).toString('hex');
  const dest = path.join(UPLOAD_DIR, id);
  const out = fs.createWriteStream(dest);
  let size = 0;
  let aborted = false;

  const fail = (status, msg) => {
    if (aborted) return;
    aborted = true;
    out.destroy();
    fs.unlink(dest, () => {});
    if (!res.headersSent) res.status(status).json({ error: msg });
  };

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) {
      fail(413, `That file is too big (max ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB).`);
      req.unpipe(out);
      req.resume();
    }
  });
  req.on('aborted', () => fail(400, 'Upload cancelled.'));
  out.on('error', () => fail(500, 'Could not save the file.'));
  out.on('finish', () => {
    if (aborted) return;
    if (size === 0) return fail(400, 'That file is empty.');
    const file = { id, name, size, type, uploaderId: req.user.id, createdAt: now() };
    db.files[id] = file;
    scheduleSave();
    res.json({ file: fileView(file) });
  });
  req.pipe(out);
});

function fileView(f) {
  return { id: f.id, name: f.name, size: f.size, type: f.type, url: '/files/' + f.id + '/' + encodeURIComponent(f.name) };
}

const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|mp3|ogg|wav|x-wav|wave|webm|mp4|aac|flac|x-m4a)|application\/pdf)$/;

app.get('/files/:id{/:name}', (req, res) => {
  const f = db.files[req.params.id];
  if (!f || !/^[a-f0-9]{32}$/.test(f.id)) return res.status(404).send('Not found');
  const inline = INLINE_TYPES.test(f.type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (f.type !== 'application/pdf') {
    // Never let an uploaded file run script on this origin.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  }
  res.setHeader('Content-Type', inline ? f.type : 'application/octet-stream');
  res.setHeader('Content-Disposition', (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(f.name));
  res.sendFile(path.join(UPLOAD_DIR, f.id), (err) => {
    if (err && !res.headersSent) res.status(404).send('Not found');
  });
});

app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------------------
// Auth + users
// ---------------------------------------------------------------------------
function serverView() {
  const { status, message, updatedAt, signupsOpen } = db.settings.server;
  return { status, message, updatedAt, signupsOpen };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, api: API_VERSION, maxUploadBytes: MAX_UPLOAD_BYTES, server: serverView() });
});

// Failed logins per username, on top of the per-IP limit, so one account can't
// be guessed at from many addresses.
const loginFails = new Map();
const LOGIN_FAIL_MAX = 10;
const LOGIN_FAIL_WINDOW = 15 * 60 * 1000;
function loginLocked(name) {
  const f = loginFails.get(name);
  if (!f || f.until < now()) { loginFails.delete(name); return false; }
  return f.count >= LOGIN_FAIL_MAX;
}
function noteLoginFail(name) {
  const f = loginFails.get(name);
  if (!f || f.until < now()) loginFails.set(name, { count: 1, until: now() + LOGIN_FAIL_WINDOW });
  else f.count++;
}

function findInvite(code) {
  return Object.values(db.invites).find((i) => safeEqual(i.code, code) && i.used < i.uses) || null;
}

function validSignupToken(token) {
  if (typeof token !== 'string' || !token) return false;
  return safeEqual(token, ADMIN_CODE) || (!!SIGNUP_TOKEN && safeEqual(token, SIGNUP_TOKEN)) || !!findInvite(token);
}

app.post('/api/auth/signup', rateLimit('signup', 10, 60000), async (req, res) => {
  const b = req.body || {};
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  if (!validSignupToken(token)) return res.status(403).json({ error: "That token isn't valid. Ask an admin for one." });
  if (!db.settings.server.signupsOpen && !safeEqual(token, ADMIN_CODE)) {
    return res.status(403).json({ error: 'New accounts are switched off right now.' });
  }
  const username = cleanOneLine(b.username, LIMITS.username + 1);
  const name = cleanOneLine(b.name, LIMITS.name) || username;
  const uErr = usernameError(username);
  if (uErr) return res.status(400).json({ error: uErr });
  const pErr = passwordError(b.password);
  if (pErr) return res.status(400).json({ error: pErr });
  const passwordHash = await hashPassword(b.password);
  // The hash takes a moment; check the username and invite again in case someone got there first.
  if (usernameIndex.has(username.toLowerCase())) return res.status(400).json({ error: 'That username is taken.' });
  const invite = findInvite(token);
  if (!validSignupToken(token)) return res.status(403).json({ error: "That token isn't valid. Ask an admin for one." });

  // Browsers from the very first version of the app stored a random id; let them
  // claim it (once) so their old messages stay theirs.
  let user = null;
  if (isValidId(b.claimId) && db.users[b.claimId] && !db.users[b.claimId].passwordHash && !db.users[b.claimId].sessions.length) {
    user = db.users[b.claimId];
    user.name = name;
  }
  if (!user) {
    user = { id: isValidId(b.claimId) && !db.users[b.claimId] ? b.claimId : newId(), name, avatar: null, bio: '', customStatus: '', status: 'online', accent: null, createdAt: now(), reads: {} };
    normalizeUser(user);
    db.users[user.id] = user;
  }
  setUsername(user, username);
  user.passwordHash = passwordHash;
  user.lastSeen = now();
  if (invite) invite.used++;
  const sessionToken = startSession(user);
  scheduleSave();
  broadcast({ type: 'user:update', user: publicUser(user) });
  res.json({ token: sessionToken, user: meView(user) });
});

app.post('/api/auth/login', rateLimit('login', 20, 60000), async (req, res) => {
  const b = req.body || {};
  const key = cleanOneLine(b.username, LIMITS.username + 1).toLowerCase();
  const bad = () => res.status(401).json({ error: 'Wrong username or password.' });
  if (!key || typeof b.password !== 'string' || b.password.length > LIMITS.password) return bad();
  if (loginLocked(key)) return res.status(429).json({ error: 'Too many failed attempts on this account. Try again in 15 minutes.' });
  const user = db.users[usernameIndex.get(key)];
  const ok = await verifyPassword(b.password, (user && user.passwordHash) || DUMMY_HASH);
  if (!user || !ok) { noteLoginFail(key); return bad(); }
  loginFails.delete(key);
  if (user.banned) {
    return res.status(403).json({ error: `This account is banned${user.banned.reason ? ': ' + user.banned.reason : '.'}`, banned: true });
  }
  const token = startSession(user);
  scheduleSave();
  res.json({ token, user: meView(user) });
});

app.post('/api/auth/logout', requireUser, (req, res) => {
  req.user.sessions = req.user.sessions.filter((s) => s.hash !== req.sessionHash);
  tokenIndex.delete(req.sessionHash);
  scheduleSave();
  res.json({ ok: true });
});

function meView(u) {
  return Object.assign(publicUser(u), {
    status: u.status || 'online',
    reads: u.reads || {},
    hasPassword: !!u.passwordHash,
    isAdmin: isAdmin(u),
    statusLocked: !!u.statusLocked,
    timeoutUntil: u.timeoutUntil || 0
  });
}

// Tell someone's own browsers that their account changed (an admin did something to it).
function notifyMe(u) {
  const data = JSON.stringify({ type: 'me', user: meView(u) });
  clients.forEach((meta, ws) => { if (meta.userId === u.id) send(ws, data); });
}

app.get('/api/me', authed, (req, res) => res.json({ user: meView(req.user) }));

app.patch('/api/me', authed, (req, res) => {
  const u = req.user;
  const b = req.body || {};
  if (u.statusLocked && (b.status !== undefined || b.customStatus !== undefined) && !isAdmin(u)) {
    const unchanged = (b.status === undefined || b.status === u.status) && (b.customStatus === undefined || cleanOneLine(b.customStatus, LIMITS.customStatus) === u.customStatus);
    if (!unchanged) return res.status(403).json({ error: 'An admin has locked your status.' });
  }
  if (b.name !== undefined) {
    const name = cleanOneLine(b.name, LIMITS.name);
    if (!name) return res.status(400).json({ error: 'Name cannot be empty.' });
    u.name = name;
  }
  if (b.avatar !== undefined) {
    if (!isValidImageRef(b.avatar)) return res.status(400).json({ error: 'That profile picture is not valid.' });
    u.avatar = b.avatar;
  }
  if (b.bio !== undefined) u.bio = cleanStr(b.bio, LIMITS.bio);
  if (b.customStatus !== undefined) u.customStatus = cleanOneLine(b.customStatus, LIMITS.customStatus);
  if (b.accent !== undefined) u.accent = typeof b.accent === 'string' && /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : null;
  if (b.status !== undefined) {
    if (!USER_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status.' });
    u.status = b.status;
  }
  if (b.look !== undefined) {
    if (b.look && b.look.banner && !isValidImageRef(b.look.banner)) return res.status(400).json({ error: 'That banner image is not valid.' });
    u.look = cleanLook(b.look);
  }
  scheduleSave();
  broadcast({ type: 'user:update', user: publicUser(u) });
  broadcastPresence();
  res.json({ user: meView(u) });
});

// Set or change username + password. Old accounts have no password yet, so they
// can claim one with just their session; after that the current password is needed.
app.post('/api/me/credentials', rateLimit('credentials', 10, 60000), authed, async (req, res) => {
  const u = req.user;
  const b = req.body || {};
  if (u.passwordHash && !(typeof b.currentPassword === 'string' && await verifyPassword(b.currentPassword, u.passwordHash))) {
    return res.status(403).json({ error: 'Your current password is wrong.' });
  }
  const username = b.username === undefined ? null : cleanOneLine(b.username, LIMITS.username + 1);
  if (username !== null && username !== u.username) {
    const err = usernameError(username, u);
    if (err) return res.status(400).json({ error: err });
  }
  if (!u.username && username === null) return res.status(400).json({ error: 'Pick a username.' });
  if (b.password !== undefined || !u.passwordHash) {
    const err = passwordError(b.password);
    if (err) return res.status(400).json({ error: err });
    u.passwordHash = await hashPassword(b.password);
    revokeSessions(u, req.sessionHash); // a new password signs out every other device
  }
  if (username !== null && username !== u.username) {
    if (usernameError(username, u)) return res.status(400).json({ error: 'That username is taken.' });
    setUsername(u, username);
  }
  scheduleSave();
  broadcast({ type: 'user:update', user: publicUser(u) });
  res.json({ user: meView(u) });
});

app.post('/api/me/logout-others', authed, (req, res) => {
  revokeSessions(req.user, req.sessionHash);
  scheduleSave();
  res.json({ ok: true });
});

app.get('/api/users', authed, (req, res) => {
  res.json({ users: Object.values(db.users).map(publicUser) });
});

// Everything the client needs to start, in one round trip.
app.get('/api/bootstrap', requireUser, (req, res) => {
  res.json({
    api: API_VERSION,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    me: meView(req.user),
    users: Object.values(db.users).map(publicUser),
    chats: visibleChatsFor(req.user).map((c) => chatViewFor(c, req.user)),
    online: presenceList(),
    server: serverView(),
    calls: Array.from(calls.values()).filter((c) => { const f = findChannel(c.channelId); return f && canSeeChat(req.user.id, f.chat); }).map(callView),
    pushKey: vapid.publicKey
  });
});

// ---------------------------------------------------------------------------
// Chats + channels
// ---------------------------------------------------------------------------
function emitChatUpsert(chat, previouslyVisibleTo) {
  pruneCalls(chat);
  clients.forEach((meta, ws) => {
    if (!meta.userId) return;
    const user = db.users[meta.userId];
    if (!user) return;
    if (canSeeChat(user.id, chat)) {
      send(ws, { type: 'chat:upsert', chat: chatViewFor(chat, user) });
    } else if (previouslyVisibleTo && previouslyVisibleTo.has(user.id)) {
      send(ws, { type: 'chat:remove', chatId: chat.id });
    }
  });
}

function visibleUserSet(chat) {
  const s = new Set();
  Object.keys(db.users).forEach((uid) => { if (canSeeChat(uid, chat)) s.add(uid); });
  return s;
}

function cleanMemberIds(list, mustInclude) {
  if (!Array.isArray(list)) return null;
  const ids = new Set(list.filter((id) => isValidId(id) && db.users[id]));
  ids.add(mustInclude);
  return Array.from(ids).slice(0, 500);
}

app.post('/api/chats', authed, (req, res) => {
  const b = req.body || {};
  const me = req.user;

  if (b.type === 'dm') {
    const other = db.users[b.userId];
    if (!other) return res.status(404).json({ error: 'That person does not exist.' });
    if (other.id === me.id) return res.status(400).json({ error: "You can't DM yourself." });
    const existing = Object.values(db.chats).find((c) => c.type === 'dm' && c.memberIds &&
      c.memberIds.length === 2 && c.memberIds.includes(me.id) && c.memberIds.includes(other.id));
    if (existing) return res.json({ chat: chatViewFor(existing, me) });
    const id = newId();
    const chat = {
      id, type: 'dm', name: '', icon: null, description: '', ownerId: null,
      memberIds: [me.id, other.id],
      channels: [{ id, name: 'dm', topic: '', createdAt: now() }],
      locked: false, passwordHash: null, createdAt: now(), lastMessageAt: now()
    };
    db.chats[id] = chat;
    db.messages[id] = [];
    scheduleSave();
    emitChatUpsert(chat);
    return res.json({ chat: chatViewFor(chat, me) });
  }

  const name = cleanOneLine(b.name, LIMITS.chatName);
  if (!name) return res.status(400).json({ error: 'Give the group a name.' });
  if (b.icon !== undefined && b.icon !== null && !isValidImageRef(b.icon)) return res.status(400).json({ error: 'That group picture is not valid.' });
  const locked = !!b.locked;
  if (locked && !(typeof b.passwordHash === 'string' && /^[a-f0-9]{64}$/.test(b.passwordHash))) {
    return res.status(400).json({ error: 'A password is required to lock the group.' });
  }
  const id = newId();
  const chat = {
    id,
    type: 'group',
    name,
    icon: b.icon || null,
    description: cleanStr(b.description, LIMITS.description),
    ownerId: me.id,
    memberIds: cleanMemberIds(b.memberIds, me.id) || [me.id], // invite-only
    channels: [{ id, name: 'general', topic: '', createdAt: now() }],
    locked,
    passwordHash: locked ? b.passwordHash : null,
    createdAt: now(),
    lastMessageAt: now()
  };
  db.chats[id] = chat;
  db.messages[id] = [];
  systemMessage(chat, id, `${me.name} created the group.`, me.id);
  scheduleSave();
  emitChatUpsert(chat);
  res.json({ chat: chatViewFor(chat, me) });
});

app.patch('/api/chats/:chatId', authed, (req, res) => {
  const chat = getChatFor(req, res);
  if (!chat) return;
  const me = req.user;
  const b = req.body || {};
  if (!canManageChat(me.id, chat)) return res.status(403).json({ error: 'Only the group owner can change that.' });
  const before = visibleUserSet(chat);
  const notes = [];

  if (b.name !== undefined) {
    const name = cleanOneLine(b.name, LIMITS.chatName);
    if (!name) return res.status(400).json({ error: 'Name cannot be empty.' });
    if (name !== chat.name) notes.push(`${me.name} renamed the group to **${name}**.`);
    chat.name = name;
  }
  if (b.icon !== undefined) {
    if (!isValidImageRef(b.icon)) return res.status(400).json({ error: 'That group picture is not valid.' });
    if (b.icon !== chat.icon) notes.push(`${me.name} changed the group picture.`);
    chat.icon = b.icon;
  }
  if (b.description !== undefined) chat.description = cleanStr(b.description, LIMITS.description);
  if (b.locked !== undefined) {
    if (b.locked) {
      if (typeof b.passwordHash === 'string' && /^[a-f0-9]{64}$/.test(b.passwordHash)) {
        chat.passwordHash = b.passwordHash;
      } else if (!chat.passwordHash) {
        return res.status(400).json({ error: 'A password is required to lock the group.' });
      }
      chat.locked = true;
    } else {
      if (chat.locked && !chatPassOk(req, chat)) return res.status(403).json({ error: 'Unlock the group first.' });
      chat.locked = false;
      chat.passwordHash = null;
    }
  }
  if (b.private !== undefined || b.memberIds !== undefined) {
    // Older open groups can become invite-only, but nothing goes the other way.
    const makePrivate = Array.isArray(chat.memberIds) || !!b.private;
    if (makePrivate) {
      const prev = new Set(chat.memberIds || []);
      chat.memberIds = cleanMemberIds(b.memberIds !== undefined ? b.memberIds : (chat.memberIds || []), me.id);
      if (chat.ownerId && !chat.memberIds.includes(chat.ownerId)) chat.memberIds.push(chat.ownerId);
      const added = chat.memberIds.filter((id) => !prev.has(id) && id !== me.id && prev.size);
      if (added.length && added.length <= 5) {
        notes.push(`${me.name} added ${added.map((id) => `<@${id}>`).join(', ')} to the group.`);
      }
    } else {
      chat.memberIds = null;
    }
  }
  scheduleSave();
  emitChatUpsert(chat, before);
  notes.forEach((n) => systemMessage(chat, chat.channels[0].id, n, me.id));
  res.json({ chat: chatViewFor(chat, me) });
});

// Anyone in a group can invite people to it. Removing people stays with the owner.
app.post('/api/chats/:chatId/members', rateLimit('invite', 60, 60000), authed, (req, res) => {
  const chat = getChatFor(req, res);
  if (!chat) return;
  if (chat.type !== 'group' || !Array.isArray(chat.memberIds)) return res.status(400).json({ error: 'This group is open to everyone already.' });
  const ids = Array.isArray(req.body && req.body.userIds) ? req.body.userIds : [];
  const added = ids.filter((id) => isValidId(id) && db.users[id] && !db.users[id].banned && !chat.memberIds.includes(id)).slice(0, 100);
  if (!added.length) return res.status(400).json({ error: 'Pick someone to invite.' });
  const before = visibleUserSet(chat);
  chat.memberIds = Array.from(new Set(chat.memberIds.concat(added))).slice(0, 500);
  scheduleSave();
  emitChatUpsert(chat, before);
  const names = added.slice(0, 5).map((id) => `<@${id}>`).join(', ');
  const more = added.length > 5 ? ` and ${added.length - 5} more` : '';
  systemMessage(chat, chat.channels[0].id, `${req.user.name} added ${names}${more} to the group.`, req.user.id);
  res.json({ chat: chatViewFor(chat, req.user) });
});

app.post('/api/chats/:chatId/leave', authed, (req, res) => {
  const chat = getChatFor(req, res);
  if (!chat) return;
  if (chat.type === 'dm' || !Array.isArray(chat.memberIds)) return res.status(400).json({ error: 'You can only leave private groups.' });
  const before = visibleUserSet(chat);
  chat.memberIds = chat.memberIds.filter((id) => id !== req.user.id);
  if (chat.ownerId === req.user.id) chat.ownerId = chat.memberIds[0] || null;
  if (chat.memberIds.length === 0) {
    deleteChat(chat);
  } else {
    systemMessage(chat, chat.channels[0].id, `${req.user.name} left the group.`, req.user.id);
    scheduleSave();
    emitChatUpsert(chat, before);
  }
  res.json({ ok: true });
});

function deleteChat(chat) {
  const before = visibleUserSet(chat);
  chat.channels.forEach((ch) => { delete db.messages[ch.id]; });
  delete db.chats[chat.id];
  pruneCalls(chat);
  scheduleSave();
  clients.forEach((meta, ws) => {
    if (meta.userId && before.has(meta.userId)) send(ws, { type: 'chat:remove', chatId: chat.id });
  });
}

app.delete('/api/chats/:chatId', authed, (req, res) => {
  const chat = getChatFor(req, res);
  if (!chat) return;
  if (chat.type === 'dm') return res.status(400).json({ error: "DMs can't be deleted — close them instead." });
  if (!canManageChat(req.user.id, chat)) return res.status(403).json({ error: 'Only the group owner can delete it.' });
  deleteChat(chat);
  res.json({ ok: true });
});

// Verify a locked chat's password (the hash itself is never sent to clients).
app.post('/api/chats/:chatId/unlock', rateLimit('unlock', 20, 60000), authed, (req, res) => {
  const chat = getChatFor(req, res);
  if (!chat) return;
  const hash = req.body && req.body.passwordHash;
  if (!chat.locked) return res.json({ ok: true });
  if (typeof hash === 'string' && chat.passwordHash && safeEqual(hash, chat.passwordHash)) return res.json({ ok: true });
  res.status(403).json({ error: 'Incorrect password.' });
});

function cleanChannelName(v) {
  return cleanOneLine(v, LIMITS.channelName).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_\-À-￿]/g, '').replace(/-+/g, '-');
}

app.post('/api/chats/:chatId/channels', authed, (req, res) => {
  const chat = getChatFor(req, res);
  if (!chat) return;
  if (!canManageChat(req.user.id, chat)) return res.status(403).json({ error: 'Only the group owner can add channels.' });
  if (chat.channels.length >= 50) return res.status(400).json({ error: 'That group already has a lot of channels.' });
  const name = cleanChannelName(req.body && req.body.name);
  if (!name) return res.status(400).json({ error: 'Give the channel a name.' });
  const ch = { id: newId(), name, topic: cleanOneLine(req.body.topic, LIMITS.topic), createdAt: now() };
  chat.channels.push(ch);
  db.messages[ch.id] = [];
  scheduleSave();
  emitChatUpsert(chat);
  res.json({ chat: chatViewFor(chat, req.user), channel: ch });
});

app.patch('/api/chats/:chatId/channels/:channelId', authed, (req, res) => {
  const chat = getChatFor(req, res);
  if (!chat) return;
  if (!canManageChat(req.user.id, chat)) return res.status(403).json({ error: 'Only the group owner can edit channels.' });
  const ch = chat.channels.find((c) => c.id === req.params.channelId);
  if (!ch) return res.status(404).json({ error: 'Channel not found.' });
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = cleanChannelName(b.name);
    if (!name) return res.status(400).json({ error: 'Channel name cannot be empty.' });
    ch.name = name;
  }
  if (b.topic !== undefined) ch.topic = cleanOneLine(b.topic, LIMITS.topic);
  scheduleSave();
  emitChatUpsert(chat);
  res.json({ chat: chatViewFor(chat, req.user) });
});

app.delete('/api/chats/:chatId/channels/:channelId', authed, (req, res) => {
  const chat = getChatFor(req, res);
  if (!chat) return;
  if (!canManageChat(req.user.id, chat)) return res.status(403).json({ error: 'Only the group owner can delete channels.' });
  if (chat.channels.length <= 1) return res.status(400).json({ error: "A group needs at least one channel." });
  const idx = chat.channels.findIndex((c) => c.id === req.params.channelId);
  if (idx === -1) return res.status(404).json({ error: 'Channel not found.' });
  const [removed] = chat.channels.splice(idx, 1);
  delete db.messages[removed.id];
  scheduleSave();
  emitChatUpsert(chat);
  res.json({ chat: chatViewFor(chat, req.user) });
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
app.get('/api/channels/:channelId/messages', authed, (req, res) => {
  const found = getChannelFor(req, res);
  if (!found) return;
  const list = db.messages[found.channel.id] || [];
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || LIMITS.pageSize));
  let start;
  let end;
  const idxOf = (id) => list.findIndex((m) => m.id === id);
  if (req.query.around) {
    const i = idxOf(req.query.around);
    if (i === -1) return res.status(404).json({ error: 'Message not found.' });
    start = Math.max(0, i - Math.floor(limit / 2));
    end = Math.min(list.length, start + limit);
  } else if (req.query.before) {
    const i = idxOf(req.query.before);
    end = i === -1 ? list.length : i;
    start = Math.max(0, end - limit);
  } else if (req.query.after) {
    const i = idxOf(req.query.after);
    start = i === -1 ? Math.max(0, list.length - limit) : i + 1;
    end = Math.min(list.length, start + limit);
  } else {
    end = list.length;
    start = Math.max(0, end - limit);
  }
  res.json({
    messages: list.slice(start, end),
    hasMoreBefore: start > 0,
    hasMoreAfter: end < list.length
  });
});

app.get('/api/channels/:channelId/pins', authed, (req, res) => {
  const found = getChannelFor(req, res);
  if (!found) return;
  const list = (db.messages[found.channel.id] || []).filter((m) => m.pinned);
  res.json({ messages: list.slice().reverse() });
});

app.post('/api/channels/:channelId/messages', rateLimit('send', 120, 60000), authed, (req, res) => {
  const found = getChannelFor(req, res);
  if (!found) return;
  const { chat, channel } = found;
  const me = req.user;
  const blocked = postBlock(me);
  if (blocked) return res.status(403).json({ error: blocked });
  const b = req.body || {};

  const text = cleanStr(b.text, LIMITS.text);
  const attachments = [];
  if (Array.isArray(b.attachmentIds)) {
    for (const fid of b.attachmentIds.slice(0, LIMITS.attachments)) {
      const f = typeof fid === 'string' && db.files[fid];
      if (!f || f.uploaderId !== me.id) return res.status(400).json({ error: 'An attachment could not be found — try uploading it again.' });
      attachments.push(fileView(f));
    }
  }
  const gif = b.gif ? (isValidGif(b.gif) ? b.gif : null) : null;
  if (!text && !attachments.length && !gif) return res.status(400).json({ error: 'Message is empty.' });

  let replyTo = null;
  if (b.replyToId) {
    const target = (db.messages[channel.id] || []).find((m) => m.id === b.replyToId);
    if (target) {
      replyTo = { id: target.id, senderId: target.senderId, text: (previewOf(target) || '').slice(0, 120) };
    }
  }

  const msg = {
    id: newId(),
    channelId: channel.id,
    senderId: me.id,
    text,
    attachments,
    gif,
    replyTo,
    reactions: {},
    mentions: extractMentions(text, chat),
    mentionsEveryone: chat.type === 'group' && /(^|\s)@everyone\b/.test(text),
    ts: now(),
    editedAt: null,
    pinned: false
  };
  // Replying pings the original author, like Discord.
  if (replyTo && replyTo.senderId && replyTo.senderId !== me.id && !msg.mentions.includes(replyTo.senderId) && b.pingReply !== false) {
    msg.mentions.push(replyTo.senderId);
  }

  (db.messages[channel.id] = db.messages[channel.id] || []).push(msg);
  chat.lastMessageAt = msg.ts;
  me.reads = me.reads || {};
  me.reads[channel.id] = msg.ts;
  scheduleSave();

  const nonce = typeof b.nonce === 'string' ? b.nonce.slice(0, 64) : undefined;
  emitToChat(chat,
    { type: 'message:new', chatId: chat.id, message: msg, nonce },
    { type: 'message:new', chatId: chat.id, message: redact(msg), nonce });
  pushMessage(chat, channel, msg);
  res.json({ message: msg, nonce });
});

function findMessage(req, res) {
  const found = getChannelFor(req, res);
  if (!found) return null;
  const list = db.messages[found.channel.id] || [];
  const idx = list.findIndex((m) => m.id === req.params.messageId);
  if (idx === -1) {
    res.status(404).json({ error: 'Message not found.' });
    return null;
  }
  return Object.assign(found, { list, idx, msg: list[idx] });
}

app.patch('/api/channels/:channelId/messages/:messageId', authed, (req, res) => {
  const f = findMessage(req, res);
  if (!f) return;
  if (f.msg.senderId !== req.user.id || f.msg.type === 'system') return res.status(403).json({ error: 'You can only edit your own messages.' });
  const blocked = postBlock(req.user);
  if (blocked) return res.status(403).json({ error: blocked });
  const text = cleanStr(req.body && req.body.text, LIMITS.text);
  if (!text && !(f.msg.attachments && f.msg.attachments.length) && !f.msg.gif && !f.msg.image) {
    return res.status(400).json({ error: 'Message is empty.' });
  }
  f.msg.text = text;
  f.msg.editedAt = now();
  f.msg.mentions = extractMentions(text, f.chat);
  f.msg.mentionsEveryone = f.chat.type === 'group' && /(^|\s)@everyone\b/.test(text);
  scheduleSave();
  emitToChat(f.chat, { type: 'message:update', chatId: f.chat.id, message: f.msg });
  res.json({ message: f.msg });
});

app.delete('/api/channels/:channelId/messages/:messageId', authed, (req, res) => {
  const f = findMessage(req, res);
  if (!f) return;
  const mine = f.msg.senderId === req.user.id;
  if (!mine && !canManageChat(req.user.id, f.chat)) return res.status(403).json({ error: "You can't delete that message." });
  f.list.splice(f.idx, 1);
  scheduleSave();
  emitToChat(f.chat, { type: 'message:delete', chatId: f.chat.id, channelId: f.channel.id, id: f.msg.id });
  res.json({ ok: true });
});

app.post('/api/channels/:channelId/messages/:messageId/reactions', authed, (req, res) => {
  const f = findMessage(req, res);
  if (!f) return;
  const blocked = postBlock(req.user);
  if (blocked) return res.status(403).json({ error: blocked });
  const emoji = typeof req.body.emoji === 'string' ? req.body.emoji.trim() : '';
  if (!emoji || emoji.length > 32 || /[<>"'&\s]/.test(emoji)) return res.status(400).json({ error: 'Bad emoji.' });
  const r = f.msg.reactions = f.msg.reactions || {};
  if (!r[emoji] && Object.keys(r).length >= 20) return res.status(400).json({ error: 'Too many different reactions on that message.' });
  const arr = r[emoji] || [];
  const i = arr.indexOf(req.user.id);
  if (i === -1) arr.push(req.user.id); else arr.splice(i, 1);
  if (arr.length) r[emoji] = arr; else delete r[emoji];
  scheduleSave();
  emitToChat(f.chat, { type: 'message:update', chatId: f.chat.id, message: f.msg });
  res.json({ message: f.msg });
});

app.post('/api/channels/:channelId/messages/:messageId/pin', authed, (req, res) => {
  const f = findMessage(req, res);
  if (!f) return;
  if (f.msg.type === 'system') return res.status(400).json({ error: "System messages can't be pinned." });
  f.msg.pinned = !f.msg.pinned;
  scheduleSave();
  emitToChat(f.chat, { type: 'message:update', chatId: f.chat.id, message: f.msg });
  if (f.msg.pinned) systemMessage(f.chat, f.channel.id, `${req.user.name} pinned a message to this channel.`, req.user.id);
  res.json({ message: f.msg });
});

app.post('/api/channels/:channelId/read', authed, (req, res) => {
  const found = getChannelFor(req, res, { skipLock: true });
  if (!found) return;
  const list = db.messages[found.channel.id] || [];
  const last = list.length ? list[list.length - 1].ts : now();
  let ts = Number(req.body && req.body.ts) || last;
  ts = Math.min(ts, Math.max(last, 0) || now());
  const u = req.user;
  u.reads = u.reads || {};
  if ((u.reads[found.channel.id] || 0) >= ts && !(req.body && req.body.force)) return res.json({ ok: true });
  u.reads[found.channel.id] = ts;
  scheduleSave();
  // Tell the reader's other devices + (in DMs) the other person for "Seen".
  emitToChat(found.chat, { type: 'read', chatId: found.chat.id, channelId: found.channel.id, userId: u.id, ts });
  res.json({ ok: true });
});

app.get('/api/search', authed, (req, res) => {
  const q = cleanOneLine(req.query.q, 200).toLowerCase();
  if (q.length < 2) return res.json({ results: [] });
  const chatFilter = req.query.chatId;
  const pass = req.get('X-Chat-Pass') || '';
  const results = [];
  const terms = q.split(' ').filter(Boolean);
  let fromUser = null;
  const fromMatch = q.match(/(?:^|\s)from:(\S+)/);
  if (fromMatch) {
    const needle = fromMatch[1];
    fromUser = Object.values(db.users).find((u) => u.name.toLowerCase().replace(/\s+/g, '') === needle || u.name.toLowerCase().startsWith(needle));
  }
  const textTerms = terms.filter((t) => !t.startsWith('from:') && t !== 'has:file' && t !== 'has:image' && t !== 'has:link');
  const wantFile = terms.includes('has:file');
  const wantImage = terms.includes('has:image');
  const wantLink = terms.includes('has:link');

  for (const chat of visibleChatsFor(req.user)) {
    if (chatFilter && chat.id !== chatFilter) continue;
    if (chat.locked && !(chatFilter === chat.id && chat.passwordHash && safeEqual(pass, chat.passwordHash))) continue;
    for (const ch of chat.channels) {
      const list = db.messages[ch.id] || [];
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m.type === 'system') continue;
        if (fromMatch && (!fromUser || m.senderId !== fromUser.id)) continue;
        const hay = ((m.text || '') + ' ' + (m.attachments || []).map((a) => a.name).join(' ')).toLowerCase();
        if (textTerms.length && !textTerms.every((t) => hay.includes(t))) continue;
        if (wantFile && !(m.attachments && m.attachments.length)) continue;
        if (wantImage && !((m.attachments || []).some((a) => /^image\//.test(a.type)) || m.image || m.gif)) continue;
        if (wantLink && !/https?:\/\//.test(m.text || '')) continue;
        if (!textTerms.length && !fromMatch && !wantFile && !wantImage && !wantLink) continue;
        results.push({ chatId: chat.id, channelId: ch.id, message: m });
        if (results.length >= 100) break;
      }
      if (results.length >= 100) break;
    }
    if (results.length >= 100) break;
  }
  results.sort((a, b) => b.message.ts - a.message.ts);
  res.json({ results: results.slice(0, 50), total: results.length });
});

// GIFs bundled with the repo (served from /gifs). Avoids GitHub API rate limits.
// Width and height come from the GIF header, so the client can reserve the right
// space before the image arrives instead of the chat jumping when it loads.
function gifSize(file) {
  const fd = fs.openSync(path.join(__dirname, 'gifs', file), 'r');
  try {
    const head = Buffer.alloc(10);
    fs.readSync(fd, head, 0, 10, 0);
    return { w: head.readUInt16LE(6), h: head.readUInt16LE(8) };
  } finally {
    fs.closeSync(fd);
  }
}

let gifList = null;
function loadGifList() {
  if (gifList) return gifList;
  let files = [];
  try { files = fs.readdirSync(path.join(__dirname, 'gifs')); } catch (e) {}
  gifList = files.filter((f) => /\.gif$/i.test(f)).sort().map((f) => {
    const size = gifSize(f);
    return { name: f, url: '/gifs/' + encodeURIComponent(f), w: size.w, h: size.h };
  });
  return gifList;
}

app.get('/api/gifs', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ gifs: loadGifList() });
});

// ---------------------------------------------------------------------------
// Web Push (notifications with every tab closed)
// ---------------------------------------------------------------------------
function cleanPushPrefs(p) {
  const v = p && typeof p === 'object' ? p : {};
  const muted = {};
  Object.keys(v.mutedChats && typeof v.mutedChats === 'object' ? v.mutedChats : {}).slice(0, 500).forEach((id) => { if (isValidId(id)) muted[id] = true; });
  return { muteAll: !!v.muteAll, mentionsOnly: !!v.mentionsOnly, preview: v.preview !== false, mutedChats: muted };
}

app.post('/api/push/subscribe', authed, (req, res) => {
  const b = req.body || {};
  const sub = b.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000 ||
      !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') {
    return res.status(400).json({ error: 'That push subscription is not valid.' });
  }
  const id = sha256(sub.endpoint);
  db.push[id] = {
    userId: req.user.id,
    sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh.slice(0, 200), auth: sub.keys.auth.slice(0, 100) } },
    origin: typeof b.origin === 'string' && /^https?:\/\/[^\s"'<>]{1,200}$/.test(b.origin) ? b.origin : '',
    prefs: cleanPushPrefs(b.prefs),
    createdAt: now()
  };
  scheduleSave();
  res.json({ id });
});

app.patch('/api/push/:id', authed, (req, res) => {
  const s = db.push[req.params.id];
  if (!s || s.userId !== req.user.id) return res.status(404).json({ error: 'Not subscribed.' });
  s.prefs = cleanPushPrefs(req.body && req.body.prefs);
  scheduleSave();
  res.json({ ok: true });
});

app.delete('/api/push/:id', requireUser, (req, res) => {
  const s = db.push[req.params.id];
  if (s && s.userId === req.user.id) { delete db.push[req.params.id]; scheduleSave(); }
  res.json({ ok: true });
});

// Lets someone check closed-tab notifications really reach their browser: it
// waits long enough for them to close the tab first.
app.post('/api/push/test', rateLimit('push-test', 6, 60000), authed, (req, res) => {
  const id = typeof (req.body && req.body.id) === 'string' ? req.body.id : '';
  const s = db.push[id];
  if (!s || s.userId !== req.user.id) return res.status(404).json({ error: 'This browser is not subscribed yet.' });
  setTimeout(() => {
    if (db.push[id]) sendPush(id, db.push[id], { title: 'Messages', body: 'Closed-tab notifications are working! 🎉', tag: 'push-test' }, 'high');
  }, 10000);
  res.json({ ok: true });
});

function sendPush(id, s, payload, urgency) {
  webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 86400, urgency: urgency || 'normal', timeout: 10000 }).catch((err) => {
    if (err && (err.statusCode === 404 || err.statusCode === 410)) { delete db.push[id]; scheduleSave(); }
    else console.warn('[push] delivery failed:', err && (err.statusCode || err.message));
  });
}

// A device only gets a push if it has no open tab: open tabs notify on their own.
function liveDevices() {
  const ids = new Set();
  clients.forEach((m) => { if (m.pushId) ids.add(m.pushId); });
  return ids;
}

function pushIcon(user, s) {
  return user && user.avatar && user.avatar.startsWith('/files/') && s.origin ? s.origin + user.avatar : undefined;
}

function plainPreview(text) {
  return String(text || '')
    .replace(/<@([A-Za-z0-9_-]{1,64})>/g, (m, id) => '@' + ((db.users[id] || {}).name || 'someone'))
    .replace(/\|\|[\s\S]*?\|\|/g, '[spoiler]')
    .replace(/[*_~`]/g, '')
    .slice(0, 180);
}

function pushMessage(chat, channel, msg) {
  const ids = Object.keys(db.push);
  if (!ids.length) return;
  const sender = db.users[msg.senderId];
  const live = liveDevices();
  ids.forEach((id) => {
    const s = db.push[id];
    const u = db.users[s.userId];
    if (!u || u.id === msg.senderId || live.has(id) || !canSeeChat(u.id, chat) || u.status === 'dnd') return;
    const p = s.prefs || {};
    const mention = chat.type === 'dm' || (msg.mentions || []).includes(u.id) || !!msg.mentionsEveryone;
    if (p.muteAll || (p.mutedChats || {})[chat.id] || (p.mentionsOnly && !mention)) return;
    const name = sender ? sender.name : 'Someone';
    let body = 'Sent you a message';
    if (chat.locked) body = '🔒 New message in a locked group';
    else if (p.preview !== false) body = plainPreview(previewOf(msg)) || 'Sent an attachment';
    sendPush(id, s, {
      title: chat.type === 'dm' ? name : `${name} (#${channel.name}, ${chat.name})`,
      body,
      icon: pushIcon(sender, s),
      tag: channel.id,
      hash: `#/c/${chat.id}/${channel.id}`
    }, mention ? 'high' : 'normal');
  });
}

function pushCall(chat, channel, caller) {
  const live = liveDevices();
  Object.keys(db.push).forEach((id) => {
    const s = db.push[id];
    const u = db.users[s.userId];
    if (!u || u.id === caller.id || live.has(id) || !canSeeChat(u.id, chat) || u.status === 'dnd') return;
    const p = s.prefs || {};
    if (p.muteAll || (p.mutedChats || {})[chat.id] || (chat.type !== 'dm' && p.mentionsOnly)) return;
    sendPush(id, s, {
      title: chat.type === 'dm' ? `📞 ${caller.name} is calling you` : `📞 ${caller.name} started a call`,
      body: chat.type === 'dm' ? 'Click to open the chat and join' : `#${channel.name} in ${chat.name}`,
      icon: pushIcon(caller, s),
      tag: 'call-' + channel.id,
      hash: `#/c/${chat.id}/${channel.id}`,
      sticky: true
    }, 'high');
  });
}

// ---------------------------------------------------------------------------
// Voice: ICE servers for WebRTC. The audio goes directly between browsers, and
// falls back to the TURN relay when a network blocks that.
// ---------------------------------------------------------------------------
app.get('/api/voice/config', authed, (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const urls = (process.env.TURN_URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
  if (urls.length && process.env.TURN_SECRET) {
    // Short-lived credentials, the coturn "use-auth-secret" scheme.
    const username = `${Math.floor(now() / 1000) + 12 * 3600}:${req.user.id}`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    iceServers.push({ urls, username, credential });
  } else if (urls.length && process.env.TURN_USERNAME) {
    iceServers.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL || '' });
  }
  res.json({ iceServers, maxPeers: MAX_CALL_PEERS, relay: urls.length > 0 });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
function audit(actor, action, detail) {
  db.audit.push({ id: newId(), ts: now(), actorId: actor.id, actorName: actor.name, action, detail: String(detail || '').slice(0, 200) });
  if (db.audit.length > 300) db.audit.splice(0, db.audit.length - 300);
  scheduleSave();
}

function adminUserView(u) {
  return Object.assign(publicUser(u), {
    status: u.status || 'online',
    statusLocked: !!u.statusLocked,
    timeoutUntil: u.timeoutUntil || 0,
    bannedInfo: u.banned || null,
    sessions: u.sessions.length,
    hasPassword: !!u.passwordHash,
    pushDevices: Object.values(db.push).filter((s) => s.userId === u.id).length
  });
}

function storageBytes() {
  return Object.values(db.files).reduce((n, f) => n + (f.size || 0), 0);
}

app.post('/api/admin/claim', rateLimit('admin-claim', 6, 60000), authed, (req, res) => {
  const code = req.body && req.body.code;
  if (typeof code !== 'string' || !safeEqual(code.trim(), ADMIN_CODE)) {
    return res.status(403).json({ error: "That admin code isn't right." });
  }
  req.user.role = 'admin';
  audit(req.user, 'became an admin');
  broadcast({ type: 'user:update', user: publicUser(req.user) });
  res.json({ user: meView(req.user) });
});

app.post('/api/admin/resign', adminOnly, (req, res) => {
  req.user.role = 'member';
  audit(req.user, 'stepped down as admin');
  broadcast({ type: 'user:update', user: publicUser(req.user) });
  res.json({ user: meView(req.user) });
});

app.get('/api/admin/overview', adminOnly, (req, res) => {
  const groups = Object.values(db.chats).filter((c) => c.type === 'group').map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon || null,
    ownerId: c.ownerId || null,
    private: Array.isArray(c.memberIds),
    members: Array.isArray(c.memberIds) ? c.memberIds.length : null,
    locked: !!c.locked,
    channels: c.channels.length,
    messages: c.channels.reduce((n, ch) => n + (db.messages[ch.id] || []).length, 0),
    lastMessageAt: c.lastMessageAt || c.createdAt
  }));
  res.json({
    server: serverView(),
    users: Object.values(db.users).map(adminUserView),
    groups,
    invites: Object.values(db.invites).sort((a, b) => b.createdAt - a.createdAt),
    audit: db.audit.slice().reverse(),
    stats: {
      users: Object.keys(db.users).length,
      online: presenceList().length,
      groups: groups.length,
      messages: Object.values(db.messages).reduce((n, l) => n + l.length, 0),
      files: Object.keys(db.files).length,
      storageBytes: storageBytes(),
      calls: calls.size,
      pushDevices: Object.keys(db.push).length
    },
    voice: { relay: !!process.env.TURN_URLS },
    signupTokenSet: !!SIGNUP_TOKEN
  });
});

app.patch('/api/admin/server', adminOnly, (req, res) => {
  const b = req.body || {};
  const s = db.settings.server;
  if (b.status !== undefined) {
    if (!SERVER_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown server status.' });
    s.status = b.status;
  }
  if (b.message !== undefined) s.message = cleanStr(b.message, LIMITS.serverMessage);
  if (b.signupsOpen !== undefined) s.signupsOpen = !!b.signupsOpen;
  s.updatedAt = now();
  audit(req.user, 'set the server status', `${s.status}${s.message ? ': ' + s.message : ''}${s.signupsOpen ? '' : ' (signups off)'}`);
  broadcast({ type: 'server:update', server: serverView() });
  res.json({ server: serverView() });
});

function adminTarget(req, res) {
  const u = db.users[req.params.userId];
  if (!u) { res.status(404).json({ error: 'That person no longer exists.' }); return null; }
  return u;
}

function targetOther(req, res) {
  const u = adminTarget(req, res);
  if (u && u.id === req.user.id) { res.status(400).json({ error: "You can't do that to yourself." }); return null; }
  return u;
}

function dropSockets(user, reason, banned) {
  const data = JSON.stringify({ type: 'kicked', reason: reason || '', banned: !!banned });
  clients.forEach((meta, ws) => {
    if (meta.userId !== user.id) return;
    send(ws, data);
    ws.close(4003, 'kicked');
  });
}

app.patch('/api/admin/users/:userId', adminOnly, (req, res) => {
  const u = adminTarget(req, res);
  if (!u) return;
  const b = req.body || {};
  const notes = [];
  if (b.status !== undefined) {
    if (!USER_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status.' });
    u.status = b.status;
    notes.push('status: ' + b.status);
  }
  if (b.customStatus !== undefined) {
    u.customStatus = cleanOneLine(b.customStatus, LIMITS.customStatus);
    notes.push(`custom status: "${u.customStatus}"`);
  }
  if (b.statusLocked !== undefined) { u.statusLocked = !!b.statusLocked; notes.push(u.statusLocked ? 'status locked' : 'status unlocked'); }
  if (b.name !== undefined) {
    const name = cleanOneLine(b.name, LIMITS.name);
    if (!name) return res.status(400).json({ error: 'Name cannot be empty.' });
    u.name = name;
    notes.push('name: ' + name);
  }
  if (b.tag !== undefined) { u.tag = cleanTag(b.tag); notes.push(u.tag ? 'tag: ' + u.tag.text : 'tag removed'); }
  if (b.role !== undefined) {
    if (u.id === req.user.id) return res.status(400).json({ error: "Use 'Step down' to change your own role." });
    u.role = b.role === 'admin' ? 'admin' : 'member';
    notes.push(u.role === 'admin' ? 'made admin' : 'removed admin');
  }
  if (b.timeoutMinutes !== undefined) {
    if (u.id === req.user.id) return res.status(400).json({ error: "You can't time yourself out." });
    const mins = Math.max(0, Math.min(60 * 24 * 28, Number(b.timeoutMinutes) || 0));
    u.timeoutUntil = mins ? now() + mins * 60000 : 0;
    notes.push(mins ? `timed out for ${mins} min` : 'timeout removed');
  }
  audit(req.user, `updated ${u.name}`, notes.join(', '));
  broadcast({ type: 'user:update', user: publicUser(u) });
  broadcastPresence();
  notifyMe(u);
  res.json({ user: adminUserView(u) });
});

app.post('/api/admin/users/:userId/kick', adminOnly, (req, res) => {
  const u = targetOther(req, res);
  if (!u) return;
  const reason = cleanOneLine(req.body && req.body.reason, LIMITS.reason);
  revokeSessions(u);
  scheduleSave();
  dropSockets(u, reason, false);
  audit(req.user, `kicked ${u.name}`, reason);
  res.json({ user: adminUserView(u) });
});

app.post('/api/admin/users/:userId/ban', adminOnly, (req, res) => {
  const u = targetOther(req, res);
  if (!u) return;
  const reason = cleanOneLine(req.body && req.body.reason, LIMITS.reason);
  u.banned = { reason, by: req.user.id, at: now() };
  revokeSessions(u);
  scheduleSave();
  dropSockets(u, reason, true);
  audit(req.user, `banned ${u.name}`, reason);
  broadcast({ type: 'user:update', user: publicUser(u) });
  res.json({ user: adminUserView(u) });
});

app.post('/api/admin/users/:userId/unban', adminOnly, (req, res) => {
  const u = adminTarget(req, res);
  if (!u) return;
  u.banned = null;
  audit(req.user, `unbanned ${u.name}`);
  broadcast({ type: 'user:update', user: publicUser(u) });
  res.json({ user: adminUserView(u) });
});

// No email in this app, so a forgotten password is fixed by an admin. Also how an
// old account that lost its browser token gets a login again.
app.post('/api/admin/users/:userId/reset-password', adminOnly, async (req, res) => {
  const u = adminTarget(req, res);
  if (!u) return;
  const username = cleanOneLine(req.body && req.body.username, LIMITS.username + 1);
  if (!u.username && !username) return res.status(400).json({ error: 'Give this account a username first.' });
  if (username && username !== u.username) {
    const err = usernameError(username, u);
    if (err) return res.status(400).json({ error: err });
  }
  const password = crypto.randomBytes(9).toString('base64url');
  u.passwordHash = await hashPassword(password);
  if (username && username !== u.username) setUsername(u, username);
  revokeSessions(u, u.id === req.user.id ? req.sessionHash : null);
  scheduleSave();
  if (u.id !== req.user.id) dropSockets(u, 'An admin reset your password.', false);
  audit(req.user, `reset the password of ${u.name}`);
  res.json({ user: adminUserView(u), username: u.username, password });
});

app.delete('/api/admin/users/:userId', adminOnly, (req, res) => {
  const u = targetOther(req, res);
  if (!u) return;
  revokeSessions(u);
  dropSockets(u, 'Your account was deleted.', true);
  if (u.username) usernameIndex.delete(u.username.toLowerCase());
  Object.keys(db.push).forEach((id) => { if (db.push[id].userId === u.id) delete db.push[id]; });
  Object.values(db.chats).forEach((c) => {
    if (c.type === 'group' && Array.isArray(c.memberIds) && c.memberIds.includes(u.id)) {
      c.memberIds = c.memberIds.filter((id) => id !== u.id);
    }
    if (c.ownerId === u.id) c.ownerId = Array.isArray(c.memberIds) ? c.memberIds[0] || null : null;
  });
  delete db.users[u.id];
  scheduleSave();
  audit(req.user, `deleted the account of ${u.name}`);
  broadcast({ type: 'user:remove', userId: u.id });
  res.json({ ok: true });
});

app.delete('/api/admin/chats/:chatId', adminOnly, (req, res) => {
  const chat = db.chats[req.params.chatId];
  if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'Group not found.' });
  audit(req.user, `deleted the group ${chat.name}`);
  deleteChat(chat);
  res.json({ ok: true });
});

app.post('/api/admin/invites', adminOnly, (req, res) => {
  const b = req.body || {};
  const invite = {
    id: newId(),
    code: crypto.randomBytes(6).toString('hex'),
    note: cleanOneLine(b.note, LIMITS.inviteNote),
    uses: Math.max(1, Math.min(500, Math.floor(Number(b.uses)) || 1)),
    used: 0,
    createdBy: req.user.name,
    createdAt: now()
  };
  db.invites[invite.id] = invite;
  audit(req.user, 'made an invite', invite.note);
  res.json({ invite });
});

app.delete('/api/admin/invites/:id', adminOnly, (req, res) => {
  if (db.invites[req.params.id]) { delete db.invites[req.params.id]; audit(req.user, 'revoked an invite'); }
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------------------------------------------------------------------------
// Static frontend (only the public bits — never data.json, uploads, or code)
// ---------------------------------------------------------------------------
const staticOpts = { maxAge: 0, dotfiles: 'ignore', index: false };
app.use('/css', express.static(path.join(__dirname, 'css'), staticOpts));
app.use('/js', express.static(path.join(__dirname, 'js'), staticOpts));
app.use('/gifs', express.static(path.join(__dirname, 'gifs'), { maxAge: '7d', dotfiles: 'ignore', index: false }));
['sw.js', 'icon.svg', 'manifest.webmanifest'].forEach((f) => {
  app.get('/' + f, (req, res) => res.sendFile(path.join(__dirname, f)));
});
app.use((req, res) => {
  if (req.method !== 'GET') return res.status(404).end();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------------------------------------------------------------------------
// WebSocket: live events
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const clients = new Map(); // ws -> { userId, idle, unlocked:Set<chatId>, pushId, peerId, callId }

function send(ws, msg) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) {}
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  clients.forEach((meta, ws) => { if (meta.userId) send(ws, data); });
}

// Send to everyone who can see the chat. Locked chats only get the full
// payload on sockets that have proven the password; others get `redacted`.
function emitToChat(chat, payload, redacted) {
  const full = JSON.stringify(payload);
  const red = redacted ? JSON.stringify(redacted) : null;
  clients.forEach((meta, ws) => {
    if (!meta.userId || !canSeeChat(meta.userId, chat)) return;
    if (chat.locked && !meta.unlocked.has(chat.id)) {
      if (red) send(ws, red);
      return;
    }
    send(ws, full);
  });
}

function presenceList() {
  const byUser = new Map();
  clients.forEach((meta) => {
    if (!meta.userId) return;
    const prev = byUser.get(meta.userId);
    byUser.set(meta.userId, prev === undefined ? meta.idle : (prev && meta.idle));
  });
  const out = [];
  byUser.forEach((allIdle, uid) => {
    const u = db.users[uid];
    if (!u || u.status === 'invisible') return;
    let status = u.status || 'online';
    if (status === 'online' && allIdle) status = 'idle';
    out.push({ id: uid, status });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Voice calls. One call per channel; the server only introduces the browsers
// and passes their WebRTC signalling around. Audio never touches this server.
// ---------------------------------------------------------------------------
const calls = new Map(); // channelId -> { channelId, chatId, startedAt, startedBy, peers: Map<peerId, peer> }

function callView(call) {
  return {
    channelId: call.channelId,
    chatId: call.chatId,
    startedAt: call.startedAt,
    startedBy: call.startedBy,
    peers: Array.from(call.peers.values()).map((p) => ({ peerId: p.peerId, userId: p.userId, muted: p.muted, deafened: p.deafened }))
  };
}

function emitCall(call) {
  const found = findChannel(call.channelId);
  if (!found) return;
  const data = JSON.stringify(call.peers.size ? { type: 'call:update', call: callView(call) } : { type: 'call:end', channelId: call.channelId });
  clients.forEach((meta, ws) => { if (meta.userId && canSeeChat(meta.userId, found.chat)) send(ws, data); });
}

function leaveCall(ws, meta) {
  const call = meta.callId && calls.get(meta.callId);
  meta.callId = null;
  if (!call) return;
  call.peers.delete(meta.peerId);
  if (!call.peers.size) calls.delete(call.channelId);
  emitCall(call);
}

function joinCall(ws, meta, user, channelId) {
  const found = findChannel(channelId);
  if (!found || !canSeeChat(user.id, found.chat)) return send(ws, { type: 'call:error', error: "You can't join that call." });
  const { chat, channel } = found;
  if (chat.locked && !meta.unlocked.has(chat.id)) return send(ws, { type: 'call:error', error: 'Unlock the group first.' });
  if (meta.callId) leaveCall(ws, meta);
  let call = calls.get(channelId);
  const starting = !call;
  // Joining from a second tab or device moves you there.
  if (call) {
    call.peers.forEach((p) => {
      if (p.userId === user.id) {
        send(p.ws, { type: 'call:moved' });
        leaveCall(p.ws, clients.get(p.ws));
      }
    });
    call = calls.get(channelId);
  }
  if (!call) {
    call = { channelId, chatId: chat.id, startedAt: now(), startedBy: user.id, peers: new Map() };
    calls.set(channelId, call);
  }
  if (call.peers.size >= MAX_CALL_PEERS) return send(ws, { type: 'call:error', error: `That call is full (${MAX_CALL_PEERS} people max).` });
  const existing = callView(call).peers;
  meta.peerId = newId();
  meta.callId = channelId;
  call.peers.set(meta.peerId, { peerId: meta.peerId, userId: user.id, ws, muted: false, deafened: false });
  send(ws, { type: 'call:joined', channelId, chatId: chat.id, peerId: meta.peerId, peers: existing });
  emitCall(call);
  if (starting) {
    systemMessage(chat, channelId, `${user.name} started a voice call.`, user.id);
    const ring = JSON.stringify({ type: 'call:ring', channelId, chatId: chat.id, fromId: user.id });
    clients.forEach((m2, ws2) => { if (m2.userId && m2.userId !== user.id && canSeeChat(m2.userId, chat)) send(ws2, ring); });
    pushCall(chat, channel, user);
    scheduleSave();
  }
}

// Someone removed from a private group shouldn't stay on its call.
function pruneCalls(chat) {
  calls.forEach((call) => {
    if (call.chatId !== chat.id) return;
    call.peers.forEach((p) => {
      if (canSeeChat(p.userId, chat) && db.chats[chat.id]) return;
      send(p.ws, { type: 'call:removed' });
      leaveCall(p.ws, clients.get(p.ws));
    });
  });
}

let presenceTimer = null;
function broadcastPresence() {
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    broadcast({ type: 'presence', online: presenceList() });
  }, 150);
}

wss.on('connection', (ws) => {
  const meta = { userId: null, idle: false, unlocked: new Set(), pushId: null, peerId: null, callId: null };
  clients.set(ws, meta);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});

  const authTimeout = setTimeout(() => { if (!meta.userId) ws.close(4001, 'unauthorized'); }, 10000);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'auth') {
      const user = userFromToken(msg.token);
      if (!user || user.banned) return ws.close(4002, 'bad-token');
      clearTimeout(authTimeout);
      meta.userId = user.id;
      meta.idle = !!msg.idle;
      if (typeof msg.pushId === 'string' && /^[a-f0-9]{64}$/.test(msg.pushId)) meta.pushId = msg.pushId;
      send(ws, { type: 'ready', online: presenceList() });
      broadcastPresence();
      return;
    }
    if (!meta.userId) return;
    const user = db.users[meta.userId];
    if (!user) return;

    if (msg.type === 'typing' && typeof msg.channelId === 'string') {
      const found = findChannel(msg.channelId);
      if (!found || !canSeeChat(user.id, found.chat)) return;
      const payload = JSON.stringify({ type: 'typing', chatId: found.chat.id, channelId: msg.channelId, userId: user.id });
      clients.forEach((m2, ws2) => {
        if (ws2 !== ws && m2.userId && m2.userId !== user.id && canSeeChat(m2.userId, found.chat)) send(ws2, payload);
      });
    } else if (msg.type === 'idle') {
      meta.idle = !!msg.idle;
      broadcastPresence();
    } else if (msg.type === 'unlock' && typeof msg.chatId === 'string') {
      const chat = db.chats[msg.chatId];
      if (chat && canSeeChat(user.id, chat) && chat.locked && chat.passwordHash &&
          typeof msg.passwordHash === 'string' && safeEqual(msg.passwordHash, chat.passwordHash)) {
        meta.unlocked.add(chat.id);
      }
    } else if (msg.type === 'push-id') {
      meta.pushId = typeof msg.id === 'string' && /^[a-f0-9]{64}$/.test(msg.id) ? msg.id : null;
    } else if (msg.type === 'call:join' && typeof msg.channelId === 'string') {
      joinCall(ws, meta, user, msg.channelId);
    } else if (msg.type === 'call:leave') {
      leaveCall(ws, meta);
    } else if (msg.type === 'call:state') {
      const call = calls.get(meta.callId);
      const peer = call && call.peers.get(meta.peerId);
      if (peer) {
        peer.muted = !!msg.muted;
        peer.deafened = !!msg.deafened;
        emitCall(call);
      }
    } else if (msg.type === 'call:signal' && typeof msg.to === 'string') {
      // Only relays between two people in the same call.
      const call = calls.get(meta.callId);
      const target = call && call.peers.get(msg.to);
      if (target) send(target.ws, { type: 'call:signal', from: meta.peerId, userId: user.id, data: msg.data });
    } else if (msg.type === 'call:decline' && typeof msg.channelId === 'string') {
      const call = calls.get(msg.channelId);
      if (call && findChannel(msg.channelId) && canSeeChat(user.id, findChannel(msg.channelId).chat)) {
        call.peers.forEach((p) => send(p.ws, { type: 'call:declined', channelId: msg.channelId, userId: user.id }));
        clients.forEach((m2, ws2) => {
          if (ws2 !== ws && m2.userId === user.id) send(ws2, { type: 'call:stop-ring', channelId: msg.channelId });
        });
      }
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    const uid = meta.userId;
    leaveCall(ws, meta);
    clients.delete(ws);
    if (uid) {
      const stillOnline = Array.from(clients.values()).some((m) => m.userId === uid);
      if (!stillOnline && db.users[uid]) {
        db.users[uid].lastSeen = now();
        scheduleSave();
      }
      broadcastPresence();
    }
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Messages server listening on port ${PORT} (data: ${DATA_FILE})`);
  if (!SIGNUP_TOKEN) console.warn('[admin] SIGNUP_TOKEN is not set. New accounts need ADMIN_CODE or an invite from the admin panel.');
});
