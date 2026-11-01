# Messages

A private, Discord-style chat app. The frontend (`index.html` + `css/` + `js/`) runs on GitHub Pages; the backend (`server.js`) handles accounts, storage, file uploads, real-time updates and access control. The live deployment is self-hosted (Docker/Coolify) with a persistent volume, so chat data survives restarts and redeploys.

## Features

**Layout & feel**
- Discord-style layout: group icons down the left, channels / DMs next to them, the chat in the middle, and a member list or profile on the right
- 10 themes (Dark, Light, Midnight, Ocean, Forest, Sunset, Solarized, Lavender, Rose, Mono), a custom accent colour, font scaling, cozy/compact modes, 24-hour time, reduced motion
- Works on phones (slide-out navigation) and can be installed as an app (PWA manifest)

**Groups & DMs**
- Groups with a **picture**, description and multiple **#channels** (with topics)
- Groups can be **open to everyone** or **private** (only the people you pick can see them — enforced by the server)
- Optional **password lock** per group (the server only sends the messages to people who've entered it)
- **Direct messages with anyone**, online or offline, from the People page or by clicking someone's name
- Member list with online/idle/do-not-disturb/offline status, owner 👑, custom statuses
- Profiles: picture, banner colour, "About me", custom status, last seen, private groups in common
- Quick switcher (**Ctrl+K**) to jump to any person or channel

**Messages**
- Markdown: **bold**, *italic*, __underline__, ~~strike~~, `code`, code blocks with syntax highlighting, quotes, headings, lists, `||spoilers||`
- @mentions with autocomplete (and `@everyone`), `:emoji:` shortcodes with autocomplete, a full emoji picker
- Replies (with jump-to-original), emoji reactions, edit (↑ to edit your last message), delete, **pins**
- Link previews for YouTube and images
- Search messages (`from:name`, `has:file`, `has:image`, `has:link`) in a chat or everywhere
- Typing indicators, "Seen" in DMs, unread counts, mention badges, a red "NEW" line, drafts are saved per chat
- Slash commands: `/shrug`, `/tableflip`, `/unflip`, `/lenny`, `/me`, `/spoiler`, `/roll`, `/flip`
- Right-click any message for more options; Shift+click 🗑️ to delete without confirming

**Files & projects**
- Upload any file (drag & drop, paste, or the **+** button) — up to 10 per message, 50 MB each by default
- Images show inline (click to enlarge), videos and audio play inline, PDFs open in a new tab
- **Upload a whole project folder** — it's zipped in the browser (skipping `node_modules` / `.git`) and anyone can **browse the files inside any .zip** and preview the code right in the chat
- Code / text files get a syntax-highlighted preview
- GIF picker (from this repo's `/gifs` folder)

**Notifications**
- Desktop notifications that show up as **Windows** (or macOS/Linux) notifications. A banner asks you to click **Enable**; your browser then asks you to **Allow**
- Clicking a notification brings the app forward on the right chat
- **Mute all notifications** toggle — in *Settings → Notifications* and the 🔔 button next to your name (or **Ctrl+Shift+D**)
- Per-chat mute (🔔 at the top of any chat), "only DMs and @mentions" mode, sounds on/off, hide message text, Do Not Disturb status
- Unread count in the tab title and icon

Notifications work while Messages is open somewhere — any tab, in the background or minimised. They can't arrive once every tab is closed.

## Setup

1. **Backend (self-hosted / Docker / Coolify):** `npm install` / `npm start` (Node 20+). Environment variables:
   - `SITE_KEY` — the shared access key. If unset it defaults to the insecure `123456789`; always set your own.
   - `DATA_DIR` — a writable directory for `data.json` and `uploads/`. Point it at a mounted persistent volume (e.g. `/data`) so chats and files survive restarts/redeploys. Defaults to the app folder.
   - `MAX_UPLOAD_MB` — maximum size per uploaded file, default `50`. (If you run behind a reverse proxy with its own body-size limit, raise that too.)
   - `PORT` — defaults to `3000`.
2. **Frontend (GitHub Pages):** enable Pages on this repo (Settings → Pages → Deploy from branch → `main` / root). The backend URL is set in `js/config.js` (`CONFIGURED_SERVER`). The backend also serves the frontend itself, so opening the backend URL directly works too.
3. **GIFs:** add `.gif` files to the `gifs/` folder — they appear in the GIF picker automatically.

> **Upgrading from the old version:** deploy the new backend *and* frontend together; the new frontend needs the new API. On first start the server converts the old `data.json` automatically (the original is kept as `data.v1-backup.json`). People who used the old app are upgraded automatically the next time they open it, and keep their name, picture, old messages and chats.

## Accounts & security notes

- The **access key** gates the whole app (checked on every request, with rate-limited login attempts).
- When you pick a name you get a personal **login code**, stored in your browser. It's what proves who you are, so nobody can post as you. To use the same account on another device, copy it from *Settings → My Account* and choose "Use a login code" there.
- Private groups and DMs are only ever sent to their members. Locked groups are only sent to people who've entered the password. This keeps casual eyes out; it isn't end-to-end encryption, and whoever runs the server can read everything.
- Uploaded files get long random URLs (like Discord attachments). Anyone who has a file's link can open it. Uploads are never run as web pages on the server (they're sandboxed or downloaded instead).
