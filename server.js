'use strict';

/*
 * Messages — backend
 *
 * One Node process serves:
 *   - a small JSON REST API (/api/*) for users, chats, channels, messages
 *   - file uploads (/api/upload) and downloads (/files/:id/:name)
 *   - a WebSocket (/ws) that pushes live events (new messages, typing,
 *     presence, reactions, edits ...) to every connected browser
 *   - the static frontend itself (index.html, css/, js/, gifs/)
 *
 * Everything is persisted to a single JSON file (DATA_DIR/data.json) plus an
 * uploads folder (DATA_DIR/uploads). Writes are debounced and atomic
 * (write to a temp file, then rename) so a crash mid-write can't corrupt it.
 *
 * Access model:
 *   - SITE_KEY gates the whole app (shared key, same as before).
 *   - Each person additionally gets a personal login token when they first
 *     pick a name. The server uses that token to know who is who, so people
 *     can't post as someone else, and so private groups / DMs are only ever
 *     sent to their members.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SITE_KEY = process.env.SITE_KEY || '123456789';
const PORT = process.env.PORT || 3000;
// Point DATA_DIR at a persistent volume (e.g. /data on Coolify/Docker) so
// chats survive restarts. Defaults to the app folder.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 50) * 1024 * 1024;
const API_VERSION = 2;

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
  pageSize: 50
};

if (SITE_KEY === '123456789') {
  console.warn('[warn] SITE_KEY is not set — using the insecure default key. Set SITE_KEY in your environment.');
}

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

function isValidGif(v) {
  if (typeof v !== 'string' || v.length > 2000) return false;
  return /^https:\/\/raw\.githubusercontent\.com\/[^\s"'<>]+$/.test(v) ||
         /^\/gifs\/[^/?#"'<>\\]+\.gif$/i.test(v);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function emptyDb() {
  return { version: API_VERSION, users: {}, chats: {}, messages: {}, files: {} };
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
  if (parsed && parsed.version === API_VERSION) {
    const d = Object.assign(emptyDb(), parsed);
    return d;
  }
  // v1 -> v2
  const backup = path.join(DATA_DIR, 'data.v1-backup.json');
  try { fs.writeFileSync(backup, raw); } catch (e) {}
  console.log('[migrate] Upgraded data.json from the old format (backup saved to data.v1-backup.json).');
  return migrateV1(parsed || {});
}

const db = loadDb();
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

// token hash -> user id
const tokenIndex = new Map();
Object.values(db.users).forEach((u) => { if (u.tokenHash) tokenIndex.set(u.tokenHash, u.id); });

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
    lastSeen: u.lastSeen || 0
  };
}

function canSeeChat(userId, chat) {
  if (!chat) return false;
  if (Array.isArray(chat.memberIds)) return chat.memberIds.includes(userId);
  return true; // open group: everyone with the site key
}

function canManageChat(userId, chat) {
  if (chat.type === 'dm') return false;
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Site-Key, Authorization, X-File-Name, X-Chat-Pass');
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

function requireKey(req, res, next) {
  const key = req.get('X-Site-Key') || '';
  if (!safeEqual(key, SITE_KEY)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function userFromToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const id = tokenIndex.get(sha256(token));
  return id ? db.users[id] : null;
}

function requireUser(req, res, next) {
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = userFromToken(token);
  if (!user) return res.status(401).json({ error: 'bad-token' });
  req.user = user;
  next();
}

const authed = [requireKey, requireUser];

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
app.get('/api/health', (req, res) => {
  res.json({ ok: true, api: API_VERSION, maxUploadBytes: MAX_UPLOAD_BYTES });
});

app.post('/api/auth', rateLimit('auth', 15, 60000), (req, res) => {
  const key = req.body && req.body.key;
  if (typeof key === 'string' && safeEqual(key, SITE_KEY)) return res.json({ ok: true, api: API_VERSION });
  return res.status(401).json({ ok: false });
});

app.post('/api/users/register', rateLimit('register', 10, 60000), requireKey, (req, res) => {
  const body = req.body || {};
  const name = cleanOneLine(body.name, LIMITS.name);
  if (!name) return res.status(400).json({ error: 'Please pick a name.' });
  const avatar = body.avatar === undefined ? null : body.avatar;
  if (avatar !== null && !isValidImageRef(avatar)) return res.status(400).json({ error: 'That profile picture is not valid.' });

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  let user = null;

  // Old app versions stored a random id in the browser; let that browser claim
  // its existing identity (once) so its old messages stay "theirs".
  if (isValidId(body.claimId)) {
    const existing = db.users[body.claimId];
    if (existing && !existing.tokenHash) {
      user = existing;
      user.name = name;
      if (avatar) user.avatar = avatar;
    } else if (!existing) {
      user = { id: body.claimId };
    }
  }
  if (!user) user = { id: newId() };

  Object.assign(user, {
    name,
    avatar: user.avatar || avatar || null,
    bio: user.bio || '',
    customStatus: user.customStatus || '',
    status: user.status || 'online',
    accent: user.accent || null,
    createdAt: user.createdAt || now(),
    lastSeen: now(),
    tokenHash,
    reads: user.reads || {}
  });
  db.users[user.id] = user;
  tokenIndex.set(tokenHash, user.id);
  scheduleSave();
  broadcast({ type: 'user:update', user: publicUser(user) });
  res.json({ token, user: meView(user) });
});

function meView(u) {
  return Object.assign(publicUser(u), { status: u.status || 'online', reads: u.reads || {} });
}

app.get('/api/me', authed, (req, res) => res.json({ user: meView(req.user) }));

app.patch('/api/me', authed, (req, res) => {
  const u = req.user;
  const b = req.body || {};
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
    if (!['online', 'idle', 'dnd', 'invisible'].includes(b.status)) return res.status(400).json({ error: 'Unknown status.' });
    u.status = b.status;
  }
  scheduleSave();
  broadcast({ type: 'user:update', user: publicUser(u) });
  broadcastPresence();
  res.json({ user: meView(u) });
});

app.get('/api/users', authed, (req, res) => {
  res.json({ users: Object.values(db.users).map(publicUser) });
});

// Everything the client needs to start, in one round trip.
app.get('/api/bootstrap', authed, (req, res) => {
  res.json({
    api: API_VERSION,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    me: meView(req.user),
    users: Object.values(db.users).map(publicUser),
    chats: visibleChatsFor(req.user).map((c) => chatViewFor(c, req.user)),
    online: presenceList()
  });
});

// ---------------------------------------------------------------------------
// Chats + channels
// ---------------------------------------------------------------------------
function emitChatUpsert(chat, previouslyVisibleTo) {
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
    memberIds: b.private ? cleanMemberIds(b.memberIds, me.id) : null,
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
    const makePrivate = b.private !== undefined ? !!b.private : Array.isArray(chat.memberIds);
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
app.get('/api/gifs', (req, res) => {
  fs.readdir(path.join(__dirname, 'gifs'), (err, files) => {
    if (err) return res.json({ gifs: [] });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      gifs: files.filter((f) => /\.gif$/i.test(f)).sort().map((f) => ({ name: f, url: '/gifs/' + encodeURIComponent(f) }))
    });
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------------------------------------------------------------------------
// Static frontend (only the public bits — never data.json, uploads, or code)
// ---------------------------------------------------------------------------
const staticOpts = { maxAge: '1h', dotfiles: 'ignore', index: false };
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
const clients = new Map(); // ws -> { userId, idle, unlocked:Set<chatId> }

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

let presenceTimer = null;
function broadcastPresence() {
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    broadcast({ type: 'presence', online: presenceList() });
  }, 150);
}

wss.on('connection', (ws) => {
  const meta = { userId: null, idle: false, unlocked: new Set() };
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
      if (typeof msg.key !== 'string' || !safeEqual(msg.key, SITE_KEY)) return ws.close(4001, 'unauthorized');
      const user = userFromToken(msg.token);
      if (!user) return ws.close(4002, 'bad-token');
      clearTimeout(authTimeout);
      meta.userId = user.id;
      meta.idle = !!msg.idle;
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
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    const uid = meta.userId;
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
});
