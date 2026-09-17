# Messages

A simple private chat app. The frontend (`index.html`) runs on GitHub Pages; the backend (`server.js`) runs on Render and handles storage, real-time updates, and access control.

## Features

- Group chats and direct messages, optionally password-locked
- Photos, GIFs (picked from this repo's `/gifs` folder), replies, and emoji reactions
- Typing indicators and online presence
- Unread badges + browser tab/favicon alerts
- 10 color themes (Settings → Theme)
- Protected by a shared access key

## Setup

1. **Backend (Render):** deploy this repo as a Render web service (`npm install` / `npm start`). Set an environment variable `SITE_KEY` to whatever access key you want — if unset, it defaults to `123456789`.
2. **Frontend (GitHub Pages):** enable Pages on this repo (Settings → Pages → Deploy from branch → `main` / root). In `index.html`, set `SERVER_ORIGIN` near the top of the script to your Render URL.
3. **GIFs:** add `.gif` files to a `gifs/` folder in this repo — they'll show up automatically in the GIF picker.

## Notes

- Render's free plan has no persistent disk, so chat data is wiped on redeploy/restart.
- The access key is enforced server-side, but it's a single shared key with no rate-limiting — enough to keep out casual visitors, not a determined attacker.
