const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
app.use(express.json({ limit: '5mb' })); // messages can now carry resized images

// The real access key lives only here on the server — never shipped to
// the client. Override it via Render's dashboard (Environment tab) any
// time without touching code.
const SITE_KEY = process.env.SITE_KEY || '123456789';

// Allow the GitHub Pages frontend (a different origin) to call this API.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Site-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 3000;
// No disk is attached on Render's free plan, so this file lives in the
// app folder and gets wiped on every deploy/restart/idle-spindown.
const DATA_FILE = path.join(__dirname, 'data.json');

function loadStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

let store = loadStore();

// One HTTP server carries both the Express app and the WebSocket server,
// since Render only exposes a single port.
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Tracks which connected sockets belong to which identified user, purely
// in memory, so we can show a live "who's online" list. Never persisted.
const clients = new Map(); // ws -> { id, name }

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
      } catch (e) {
        // ignore a single bad client, don't let it affect the others
      }
    }
  });
}

function broadcastPresence() {
  const online = Array.from(clients.values()).map((c) => ({ id: c.id, name: c.name }));
  broadcast({ type: 'presence', online });
}

wss.on('connection', (ws, req) => {
  // The browser WebSocket API can't set custom headers, so the key is
  // passed as a query param on the handshake URL instead.
  let key = '';
  try {
    const url = new URL(req.url, 'http://localhost');
    key = url.searchParams.get('key') || '';
  } catch (e) {}
  if (key !== SITE_KEY) {
    ws.close(4001, 'unauthorized');
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', (err) => {
    console.error('WebSocket client error:', err.message);
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'identify' && typeof msg.id === 'string' && typeof msg.name === 'string') {
      clients.set(ws, { id: msg.id.slice(0, 200), name: msg.name.slice(0, 60) });
      broadcastPresence();
      return;
    }

    // Ephemeral typing relay — never persisted, only forwarded live.
    if (
      msg.type === 'typing' &&
      typeof msg.chatId === 'string' &&
      typeof msg.senderId === 'string' &&
      typeof msg.senderName === 'string'
    ) {
      broadcast({
        type: 'typing',
        chatId: msg.chatId.slice(0, 200),
        senderId: msg.senderId.slice(0, 200),
        senderName: msg.senderName.slice(0, 60)
      });
    }
  });

  ws.on('close', () => {
    if (clients.has(ws)) {
      clients.delete(ws);
      broadcastPresence();
    }
  });

  ws.send(JSON.stringify({ type: 'hello', online: Array.from(clients.values()) }));
});

wss.on('error', (err) => {
  console.error('WebSocket server error:', err.message);
});

// Drop dead connections (helps behind proxies like Render's).
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      if (clients.has(ws)) {
        clients.delete(ws);
        broadcastPresence();
      }
      return ws.terminate();
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);
wss.on('close', () => clearInterval(heartbeatInterval));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Lets the client PROVE it knows the key without the server ever having
// to hand the key back out. Public on purpose — this is a login check,
// not a protected resource.
app.post('/api/auth', (req, res) => {
  const key = req.body && req.body.key;
  if (typeof key === 'string' && key === SITE_KEY) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false });
});

// Everything under /api/data requires the key on every request.
function requireSiteKey(req, res, next) {
  const key = req.header('X-Site-Key');
  if (key !== SITE_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
app.use('/api/data', requireSiteKey);

app.get('/api/data/:key', (req, res) => {
  const key = req.params.key;
  if (!(key in store)) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json({ key, value: store[key] });
});

app.put('/api/data/:key', (req, res) => {
  const key = req.params.key;
  const value = req.body ? req.body.value : undefined;
  store[key] = value;
  saveStore(store);
  res.json({ key, value });
  broadcast({ type: 'update', key, value });
});

app.delete('/api/data/:key', (req, res) => {
  const key = req.params.key;
  const existed = key in store;
  delete store[key];
  saveStore(store);
  if (!existed) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json({ key, deleted: true });
  broadcast({ type: 'delete', key });
});

app.use(express.static(__dirname));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Messages server listening on port ${PORT}`);
});
