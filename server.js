const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 10000;

app.use(express.json({ limit: "2mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `);
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

app.get("/api/data/:key", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT value FROM app_data WHERE key = $1",
      [req.params.key]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ key: req.params.key, value: result.rows[0].value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database read failed" });
  }
});

app.put("/api/data/:key", async (req, res) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(req.body, "value")) {
      return res.status(400).json({ error: "Missing value" });
    }
    const result = await pool.query(
      `INSERT INTO app_data (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value
       RETURNING value`,
      [req.params.key, JSON.stringify(req.body.value)]
    );
    res.json({ key: req.params.key, value: result.rows[0].value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database write failed" });
  }
});

app.delete("/api/data/:key", async (req, res) => {
  try {
    await pool.query("DELETE FROM app_data WHERE key = $1", [req.params.key]);
    res.json({ key: req.params.key, deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database delete failed" });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Messages server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
