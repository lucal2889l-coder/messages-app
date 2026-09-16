const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

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
});

app.use(express.static(__dirname));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Messages server listening on port ${PORT}`);
});
