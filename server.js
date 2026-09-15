const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// JSONBin.io config — set these in your environment (Render dashboard,
// or $env:JSONBIN_API_KEY / $env:JSONBIN_BIN_ID locally for testing).
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b';
const persistenceEnabled = Boolean(JSONBIN_API_KEY && JSONBIN_BIN_ID);

let store = {};

async function loadStore() {
  if (!persistenceEnabled) {
    console.warn(
      'JSONBIN_API_KEY / JSONBIN_BIN_ID not set — running with in-memory ' +
      'storage only. Data will not persist across restarts.'
    );
    return;
  }
  try {
    const res = await fetch(`${JSONBIN_BASE}/${JSONBIN_BIN_ID}/latest?meta=false`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    store = data && typeof data === 'object' ? data : {};
    console.log('Loaded store from JSONBin.');
  } catch (err) {
    console.error('Could not load store from JSONBin, starting empty:', err.message);
    store = {};
  }
}

async function saveStore() {
  if (!persistenceEnabled) return;
  try {
    const res = await fetch(`${JSONBIN_BASE}/${JSONBIN_BIN_ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY
      },
      body: JSON.stringify(store)
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error('Could not save store to JSONBin:', err.message);
  }
}

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

app.put('/api/data/:key', async (req, res) => {
  const key = req.params.key;
  const value = req.body ? req.body.value : undefined;
  store[key] = value;
  await saveStore();
  res.json({ key, value });
});

app.delete('/api/data/:key', async (req, res) => {
  const key = req.params.key;
  const existed = key in store;
  delete store[key];
  await saveStore();
  if (!existed) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json({ key, deleted: true });
});

app.use(express.static(__dirname));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

loadStore().then(() => {
  app.listen(PORT, () => {
    console.log(`Messages server listening on port ${PORT}`);
  });
});
