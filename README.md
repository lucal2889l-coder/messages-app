# Messages

A simple private chat app. The frontend (`index.html`) runs on GitHub Pages; the backend (`server.js`) handles storage, real-time updates, and access control. The live deployment runs self-hosted (Docker/Coolify) with a persistent volume, so chat data survives restarts and redeploys.

## Features

- Group chats and direct messages, optionally password-locked
- Photos, GIFs (picked from this repo's `/gifs` folder), replies, and emoji reactions
- Typing indicators and online presence
- Unread badges + browser tab/favicon alerts
- 10 color themes (Settings → Theme)
- Protected by a shared access key

## Setup

1. **Backend (self-hosted / Docker / Coolify):** `npm install` / `npm start`, or build from source with any Node 20+ buildpack (no Dockerfile needed — Nixpacks auto-detects it from `package.json`). Environment variables:
   - `SITE_KEY` — the shared access key. If unset, it defaults to the insecure `123456789`; always set your own.
   - `DATA_DIR` — a writable directory for `data.json` to live in. Point this at a mounted persistent volume (e.g. `/data`) so chat data survives container restarts/redeploys. Defaults to the app folder if unset.
   - `PORT` — defaults to `3000`.
2. **Frontend (GitHub Pages):** enable Pages on this repo (Settings → Pages → Deploy from branch → `main` / root). In `index.html`, set `SERVER_ORIGIN` near the top of the script to your backend's URL.
3. **GIFs:** add `.gif` files to a `gifs/` folder in this repo — they'll show up automatically in the GIF picker.

## Notes

- The access key is enforced server-side, but it's a single shared key with no rate-limiting — enough to keep out casual visitors, not a determined attacker.
