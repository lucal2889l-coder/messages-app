// Messages server
// A small self-hosted chat server: REST API for chats/messages,
// WebSocket for real-time push, bcrypt-hashed passwords for locked
// chats (verified server-side, never sent to the client), and a
// flat JSON file for storage.

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// DATA_DIR lets you point storage at a mounted persistent disk
// (e.g. /var/data on Render). Falls back to the app folder locally.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PORT = process.env.PORT || 3000;

// Make sure the data directory exists before we try to write to it.
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error('Could not create data directory:', DATA_DIR, e.message);
}

// ---------------- Storage (flat JSON file) ----------------
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.chats) parsed.chats = [];
    if (!parsed.messages) parsed.messages = {};
    return parsed;
  } catch (e) {
    return { chats: [], messages: {} };
  }
}
let db = loadData();

let saveScheduled = false;
function saveData() {
  if (saveScheduled) return;
  saveScheduled = true;
  setImmediate(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), (err) => {
      if (err) console.error('Failed to save data:', err);
      saveScheduled = false;
    });
  });
}

function genId() {
  return crypto.randomUUID();
}

// ---------------- Unlock tokens (in-memory) ----------------
// A locked chat's password is checked once via /unlock; the caller
// then gets a short-lived token that proves they've unlocked that
// specific chat, used for subsequent reads/writes to it.
const unlockTokens = new Map(); // token -> { chatId, expiresAt }
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function issueUnlockToken(chatId) {
  const token = crypto.randomBytes(24).toString('hex');
  unlockTokens.set(token, { chatId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}
function isTokenValidForChat(token, chatId) {
  const entry = unlockTokens.get(token);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    unlockTokens.delete(token);
    return false;
  }
  return entry.chatId === chatId;
}
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of unlockTokens) {
    if (entry.expiresAt < now) unlockTokens.delete(token);
  }
}, 1000 * 60 * 30);

// Very light rate limiting on password attempts per chat, per IP.
const unlockAttempts = new Map(); // key `${ip}:${chatId}` -> {count, resetAt}
function tooManyAttempts(ip, chatId) {
  const key = ip + ':' + chatId;
  const now = Date.now();
  const entry = unlockAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    unlockAttempts.set(key, { count: 1, resetAt: now + 60000 });
    return false;
  }
  entry.count++;
  return entry.count > 8; // 8 attempts per minute per chat/IP
}

// ---------------- App ----------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function publicChat(chat) {
  const { passwordHash, ...rest } = chat;
  return rest;
}

app.get('/api/chats', (req, res) => {
  const list = db.chats.map(publicChat).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  res.json(list);
});

app.post('/api/chats', async (req, res) => {
  const { title, password } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title required' });
  const locked = !!password;
  let passwordHash = null;
  if (locked) {
    if (String(password).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    passwordHash = await bcrypt.hash(String(password), 10);
  }
  const chat = {
    id: genId(),
    title: String(title).trim().slice(0, 60),
    locked,
    passwordHash,
    createdAt: Date.now(),
    lastMessage: '',
    lastSenderName: '',
    lastSenderId: null,
    lastMessageAt: Date.now(),
  };
  db.chats.unshift(chat);
  db.messages[chat.id] = [];
  saveData();

  let unlockToken = null;
  if (locked) unlockToken = issueUnlockToken(chat.id); // creator starts unlocked

  broadcast({ type: 'chat_created', chat: publicChat(chat) });
  res.json({ chat: publicChat(chat), unlockToken });
});

app.post('/api/chats/:id/unlock', async (req, res) => {
  const chat = db.chats.find((c) => c.id === req.params.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  if (!chat.locked) return res.json({ ok: true, unlockToken: null });

  const ip = req.ip || 'unknown';
  if (tooManyAttempts(ip, chat.id)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts, try again in a minute.' });
  }

  const { password } = req.body || {};
  const match = await bcrypt.compare(String(password || ''), chat.passwordHash);
  if (!match) return res.status(401).json({ ok: false, error: 'Incorrect password' });

  const unlockToken = issueUnlockToken(chat.id);
  res.json({ ok: true, unlockToken });
});

function requireUnlock(req, res, chat) {
  if (!chat.locked) return true;
  const token = req.headers['x-unlock-token'];
  if (token && isTokenValidForChat(token, chat.id)) return true;
  res.status(401).json({ error: 'This chat is locked.' });
  return false;
}

app.get('/api/chats/:id/messages', (req, res) => {
  const chat = db.chats.find((c) => c.id === req.params.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  if (!requireUnlock(req, res, chat)) return;
  res.json(db.messages[chat.id] || []);
});

app.post('/api/chats/:id/messages', (req, res) => {
  const chat = db.chats.find((c) => c.id === req.params.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  if (!requireUnlock(req, res, chat)) return;

  const { senderId, senderName, text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Message text required' });
  if (!senderId || !senderName) return res.status(400).json({ error: 'Missing sender info' });

  const msg = {
    id: genId(),
    senderId: String(senderId),
    senderName: String(senderName).slice(0, 30),
    text: String(text).slice(0, 4000),
    ts: Date.now(),
  };
  if (!db.messages[chat.id]) db.messages[chat.id] = [];
  db.messages[chat.id].push(msg);

  chat.lastMessage = msg.text;
  chat.lastSenderName = msg.senderName;
  chat.lastSenderId = msg.senderId;
  chat.lastMessageAt = msg.ts;
  saveData();

  broadcast({ type: 'message', chatId: chat.id, message: msg });
  broadcast({ type: 'chat_updated', chat: publicChat(chat) });
  res.json(msg);
});

app.patch('/api/chats/:id', async (req, res) => {
  const chat = db.chats.find((c) => c.id === req.params.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  if (!requireUnlock(req, res, chat)) return;

  const { title, locked, newPassword } = req.body || {};
  if (title !== undefined) {
    if (!String(title).trim()) return res.status(400).json({ error: 'Title required' });
    chat.title = String(title).trim().slice(0, 60);
  }

  let newUnlockToken = null;
  if (locked === true && !chat.locked) {
    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    chat.passwordHash = await bcrypt.hash(String(newPassword), 10);
    chat.locked = true;
    newUnlockToken = issueUnlockToken(chat.id);
  } else if (locked === false) {
    chat.locked = false;
    chat.passwordHash = null;
  }

  saveData();
  broadcast({ type: 'chat_updated', chat: publicChat(chat) });
  res.json({ chat: publicChat(chat), unlockToken: newUnlockToken });
});

app.delete('/api/chats/:id', (req, res) => {
  const chat = db.chats.find((c) => c.id === req.params.id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  if (!requireUnlock(req, res, chat)) return;

  db.chats = db.chats.filter((c) => c.id !== chat.id);
  delete db.messages[chat.id];
  saveData();

  broadcast({ type: 'chat_deleted', chatId: chat.id });
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, chats: db.chats.length }));

// ---------------- Server + WebSocket ----------------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello' }));
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`Messages server running on http://localhost:${PORT}`);
});
