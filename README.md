# Messages

A private, Discord-style chat app. The frontend (`index.html` + `css/` + `js/`) runs on GitHub Pages; the backend (`server.js`) handles accounts, storage, file uploads, real-time updates and access control. The live deployment is self-hosted (Docker/Coolify) with a persistent volume, so chat data survives restarts and redeploys.

## Features

**Layout & feel**
- Discord-style layout: group icons down the left, channels / DMs next to them, the chat in the middle, and a member list or profile on the right
- 10 themes (Dark, Light, Midnight, Ocean, Forest, Sunset, Solarized, Lavender, Rose, Mono), a custom accent colour, font scaling, cozy/compact modes, 24-hour time, reduced motion
- Works on phones (slide-out navigation) and can be installed as an app (PWA manifest)

**Groups & DMs**
- Groups with a **picture**, description and multiple **#channels** (with topics)
- Groups are **invite-only**, like Discord: nobody can see one until they're added. Anyone in a group can invite people; the owner can remove them
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
- GIF picker (from this repo's `/gifs` folder). GIFs hold their exact space while loading, so the chat never jumps

**Voice calls**
- Call anyone from a DM (it rings them) or start a call in any channel, up to 8 people
- Mute, deafen, speaking indicators, microphone + speaker choice and a mic test in *Settings → Voice*
- Rejoins by itself after a dropped connection

**Customize** (*Settings → Customize*, free for everyone)
- Name color or gradient, name effects (glow, shimmer, rainbow, pulse), name fonts
- Animated profile picture rings, emoji flair, banner image or gradient, profile theme colors

**Admin** (*Settings → Admin → Become Admin*, needs the admin code)
- Set the server status: all clear, announcement, having problems, read-only or maintenance
- Set anyone's status (and lock it), rename them, give them a tag, make or remove admins
- Time out, kick, ban or delete accounts, reset passwords
- Make invites, delete groups, turn signups off, and see an audit log of what admins did

**Notifications**
- Desktop notifications that show up as **Windows** (or macOS/Linux) notifications. A banner asks you to click **Enable**; your browser then asks you to **Allow**
- Clicking a notification brings the app forward on the right chat
- **Mute all notifications** toggle — in *Settings → Notifications* and the 🔔 button next to your name (or **Ctrl+Shift+D**)
- Per-chat mute (🔔 at the top of any chat), "only DMs and @mentions" mode, sounds on/off, hide message text, Do Not Disturb status
- Unread count in the tab title and icon

- **Closed-tab notifications:** they keep arriving with every Messages tab closed, using Web Push. *Settings → Notifications → Test with the tab closed* checks it works

The browser itself has to be running to receive them. With every Chrome window closed, that needs Chrome's *Continue running background apps* setting (*Settings → System*) turned on; otherwise they arrive the next time Chrome opens. On iPhone, Messages has to be added to the Home Screen first.

## Setup

1. **Backend (self-hosted / Docker / Coolify):** `npm install` / `npm start` (Node 20+). Environment variables:
   - `ADMIN_CODE` — turns an account into an admin from *Settings → Admin*. If unset, one is generated and printed in the server log on every start.
   - `SIGNUP_TOKEN` — lets people create accounts. Falls back to the old `SITE_KEY` if that's set. New accounts can also use an invite from the admin panel, or `ADMIN_CODE`.
   - `DATA_DIR` — a writable directory for `data.json` and `uploads/`. Point it at a mounted persistent volume (e.g. `/data`) so chats and files survive restarts/redeploys. Defaults to the app folder.
   - `MAX_UPLOAD_MB` — maximum size per uploaded file, default `50`. (If you run behind a reverse proxy with its own body-size limit, raise that too.)
   - `PORT` — defaults to `3000`.
   - `TURN_URLS`, `TURN_SECRET` — the voice relay, see below. `TURN_USERNAME` + `TURN_CREDENTIAL` also work, for a hosted TURN service.
   - `VAPID_SUBJECT` — optional contact for the push services, a `mailto:` or `https:` URL. The push keys themselves are generated once and kept in `data.json`, so **keep `DATA_DIR` persistent or everyone has to re-enable notifications**. `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` override them.
2. **Frontend (GitHub Pages):** enable Pages on this repo (Settings → Pages → Deploy from branch → `main` / root). The backend URL is set in `js/config.js` (`CONFIGURED_SERVER`). The backend also serves the frontend itself, so opening the backend URL directly works too.
3. **GIFs:** add `.gif` files to the `gifs/` folder — they appear in the GIF picker automatically.

> **Upgrading:** deploy the new backend *and* frontend together; the new frontend needs the new API. On first start the server converts the old `data.json` automatically and keeps a backup (`data.v2-backup.json`). Nobody loses anything: people stay signed in on the browser they already use, and are asked to pick a username and password. Anyone who lost that browser needs an admin to use *Reset Password*, which can set a username too. Groups that were already open to everyone stay open until their owner makes them invite-only in *Group Settings → Members*.

## Voice calls on Coolify

Calls work with no extra setup on most home networks. The audio goes straight between browsers using WebRTC, and the server only introduces them over the existing WebSocket, so nothing extra is needed in the app's Coolify service. The site must be on HTTPS for browsers to allow the microphone.

Some networks, often school, college and office Wi-Fi, block direct connections. For those, run a TURN relay, which passes the audio through your server. Traefik can't proxy it, so it runs as its own service with its own ports. On the Coolify server, as a Docker Compose resource:

```yaml
services:
  coturn:
    image: coturn/coturn:latest
    network_mode: host
    restart: unless-stopped
    command:
      - --use-auth-secret
      - --static-auth-secret=CHANGE_ME_LONG_RANDOM_STRING
      - --realm=messages.example.com
      - --listening-port=3478
      - --min-port=49160
      - --max-port=49200
      - --no-cli
      - --no-tls
      - --no-dtls
```

Open `3478` (TCP and UDP) and `49160-49200` (UDP) in the server's firewall, then set these on the Messages app and redeploy:

```
TURN_URLS=turn:YOUR_SERVER_IP:3478?transport=udp,turn:YOUR_SERVER_IP:3478?transport=tcp
TURN_SECRET=CHANGE_ME_LONG_RANDOM_STRING
```

The admin panel's *Overview* shows whether a relay is set up. Calls are capped at 8 people, because each person sends their audio to everyone else directly; larger calls would need a media server.

## Accounts & security notes

- People log in with a **username and password**. Passwords are hashed with scrypt, and login attempts are rate-limited per address and per account. There's no email, so a forgotten password is reset by an admin.
- **Creating an account needs a token.** Give people an invite or `SIGNUP_TOKEN`. `ADMIN_CODE` also works, but don't hand it out: anyone who has it can make themselves an admin.
- Groups and DMs are only ever sent to their members, and that includes admins, who can see a group's name but not read it unless they're in it. Locked groups are only sent to people who've entered the password. This keeps casual eyes out; it isn't end-to-end encryption, and whoever runs the server can read everything in `data.json`. Voice call audio is encrypted between browsers and never touches the server (a TURN relay passes it along encrypted).
- Uploaded files get long random URLs (like Discord attachments). Anyone who has a file's link can open it. Uploads are never run as web pages on the server (they're sandboxed or downloaded instead).
