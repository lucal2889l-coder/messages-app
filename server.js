const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
app.use(express.json());

// Allow the GitHub Pages frontend (a different origin) to call this API.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', (err) => {
    console.error('WebSocket client error:', err.message);
  });
  ws.send(JSON.stringify({ type: 'hello' }));
});

wss.on('error', (err) => {
  console.error('WebSocket server error:', err.message);
});

// Drop dead connections (helps behind proxies like Render's).
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);
wss.on('close', () => clearInterval(heartbeatInterval));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

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
