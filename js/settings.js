// Settings screens + group management + "new" dialogs + quick switcher.
import { $, $$, esc, fmtSize, sha256Hex, copyText, resizeImage } from './util.js';
import { api, session, uploadFile, mediaUrl } from './api.js';
import {
  state, prefs, savePrefs, actions, applyAppearance, THEMES, avatarHtml, chatIconHtml, bannerColor,
  STATUS_LABEL, chatName, getUser, statusOf
} from './store.js';
import { toast, openModal, confirmDialog, registerLayer, memberPickerHtml, wireMemberPicker, profileCardHtml } from './ui.js';
import { notifPermission, requestNotifPermission, showDesktopNotification, playSound, avatarIconFor, unlockAudio } from './notify.js';

// ---------------------------------------------------------------------------
// Image picking (avatars + group icons)
// ---------------------------------------------------------------------------
export function pickImage() {
  return new Promise((resolve) => {
    const input = $('#image-input');
    input.value = '';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

// Resize (or keep animated GIFs as-is) and upload; returns the server path.
export async function uploadImageFile(file) {
  if (!file) return null;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Please pick a PNG, JPG, GIF or WebP image.');
  let blob = file;
  let name = file.name || 'image';
  if (!(file.type === 'image/gif' && file.size < 4 * 1024 * 1024)) {
    blob = await resizeImage(file, 320, 0.88);
    name = name.replace(/\.[^.]+$/, '') + '.jpg';
  }
  const up = uploadFile(blob, { name });
  const f = await up.promise;
  return f.url;
}

// ---------------------------------------------------------------------------
// Generic full-screen settings frame
// ---------------------------------------------------------------------------
function openFullscreen({ nav, initial, render, title }) {
  const el = document.createElement('div');
  el.className = 'settings';
  el.innerHTML = `
    <div class="s-side scroller thin"><nav class="s-nav" aria-label="${esc(title || 'Settings')}"></nav></div>
    <div class="s-content scroller"><div class="s-inner"></div>
      <div class="s-close-wrap"><button class="s-close" aria-label="Close">✕</button><div class="s-close-label">ESC</div></div>
    </div>`;
  document.body.appendChild(el);
  const layer = registerLayer(() => el.remove());
  const navEl = el.querySelector('.s-nav');
  const inner = el.querySelector('.s-inner');
  let current = initial || nav.find((n) => n.id).id;
  const drawNav = () => {
    navEl.innerHTML = nav.map((n) => {
      if (n.header) return `<h5>${esc(n.header)}</h5>`;
      if (n.sep) return '<div class="sep"></div>';
      return `<button data-id="${esc(n.id)}" class="${n.id === current ? 'on' : ''} ${n.danger ? 'danger' : ''}">${esc(n.label)}</button>`;
    }).join('');
  };
  const show = (id) => {
    const item = nav.find((n) => n.id === id);
    if (item && item.action) { item.action(); return; }
    current = id;
    drawNav();
    inner.innerHTML = '';
    el.querySelector('.s-content').scrollTop = 0;
    render(id, inner, api2);
  };
  const api2 = { close: () => layer.close(), show, redraw: () => show(current) };
  navEl.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) show(b.dataset.id); });
  el.querySelector('.s-close').onclick = () => layer.close();
  show(current);
  return api2;
}

function toggleRow(id, title, desc, checked, extra = '') {
  return `<div class="setting-row"><div><div class="t">${esc(title)}</div>${desc ? `<div class="d">${desc}</div>` : ''}${extra}</div>
    <label class="switch"><input type="checkbox" id="${esc(id)}" ${checked ? 'checked' : ''}><span></span></label></div>`;
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------
export function openSettings(section) {
  const nav = [
    { header: 'User Settings' },
    { id: 'account', label: 'My Account' },
    { id: 'profile', label: 'Profile' },
    { header: 'App Settings' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'keybinds', label: 'Keybinds' },
    { id: 'about', label: 'About' },
    { sep: true },
    { id: 'logout', label: 'Log Out', danger: true, action: () => logout() }
  ];
  return openFullscreen({ nav, initial: section || 'account', title: 'User settings', render: renderSettings });
}

async function logout() {
  const ok = await confirmDialog({
    title: 'Log out',
    html: '<p style="margin:0">Are you sure you want to log out? <b>Copy your login code first</b> (My Account) if you want to get back into this same account later.</p>',
    confirm: 'Log Out',
    danger: true
  });
  if (!ok) return;
  try { localStorage.removeItem('auth_token'); localStorage.removeItem('site_key'); } catch (e) {}
  location.hash = '';
  location.reload();
}

function renderSettings(id, root, frame) {
  const me = state.me;
  if (id === 'account') {
    root.innerHTML = `
      <h2>My Account</h2>
      <div class="account-card">
        <div class="banner" style="background:${esc(bannerColor(me))}"></div>
        <div class="row">${avatarHtml(me, 80, { status: true })}<div class="n">${esc(me.name)}</div><button class="btn sm" data-go="profile">Edit User Profile</button></div>
        <div class="inner">
          <div class="kv"><div><div class="k">Display name</div><div class="v">${esc(me.name)}</div></div><button class="btn secondary sm" data-go="profile">Edit</button></div>
          <div class="kv"><div><div class="k">Status</div><div class="v">${esc(STATUS_LABEL[me.status] || 'Online')}</div></div><button class="btn secondary sm" data-act="status">Change</button></div>
          <div class="kv"><div><div class="k">Member since</div><div class="v">${esc(new Date(me.createdAt || Date.now()).toLocaleDateString())}</div></div></div>
        </div>
      </div>
      <h3>Login code</h3>
      <div class="hint" style="margin:0 0 10px">Your login code is how this browser proves it's you. Use it to sign in to the <b>same account</b> on another device or browser. Anyone with it can post as you — keep it secret.</div>
      <div class="secret" id="login-code">••••••••••••••••••••••••••••••••••••••••</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn secondary sm" data-act="reveal">Show</button>
        <button class="btn sm" data-act="copy">Copy login code</button>
      </div>
      <div class="divider"></div>
      <h3>Log out</h3>
      <div class="hint" style="margin:0 0 10px">Signs this browser out. You'll need the access key and your login code to get back into this account.</div>
      <button class="btn outline-danger sm" data-act="logout">Log Out</button>`;
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-go],[data-act]');
      if (!b) return;
      if (b.dataset.go) frame.show(b.dataset.go);
      else if (b.dataset.act === 'reveal') { $('#login-code', root).textContent = session.token; b.remove(); }
      else if (b.dataset.act === 'copy') { if (await copyText(session.token)) toast('Login code copied — keep it somewhere safe.', 'ok'); }
      else if (b.dataset.act === 'logout') logout();
      else if (b.dataset.act === 'status') actions.openStatusMenu(b, () => frame.redraw());
    });
    return;
  }

  if (id === 'profile') {
    const draft = { name: me.name, avatar: me.avatar, bio: me.bio || '', customStatus: me.customStatus || '', accent: me.accent || null };
    const presets = ['#5865f2', '#eb459e', '#ed4245', '#faa61a', '#fee75c', '#57f287', '#1abc9c', '#3498db', '#9b59b6', '#2c2f33'];
    root.innerHTML = `
      <h2>Profile</h2>
      <div class="profile-edit">
        <div class="pe-form">
          <div class="field"><label class="label">Display name</label><input class="input" id="pe-name" maxlength="32" value="${esc(draft.name)}"></div>
          <div class="field"><label class="label">Avatar</label>
            <div style="display:flex;gap:8px"><button class="btn sm" id="pe-av">Change Avatar</button><button class="btn ghost sm" id="pe-av-rm">Remove Avatar</button></div>
            <div class="hint">Square images look best. Animated GIFs work too.</div></div>
          <div class="field"><label class="label">Banner color</label>
            <div class="color-row">${presets.map((c) => `<button class="color-swatch ${draft.accent === c ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
              <input type="color" id="pe-color" value="${esc(draft.accent || '#5865f2')}" title="Custom color"><button class="btn ghost xs" id="pe-color-rm">Default</button></div></div>
          <div class="field"><label class="label">Custom status</label><input class="input" id="pe-status" maxlength="80" placeholder="What's up?" value="${esc(draft.customStatus)}"></div>
          <div class="field"><label class="label">About me <span class="char-count" id="pe-bio-count"></span></label>
            <textarea class="textarea" id="pe-bio" maxlength="300" placeholder="Tell people a bit about yourself. Markdown works!">${esc(draft.bio)}</textarea></div>
          <div class="error" id="pe-err"></div>
          <div style="display:flex;gap:8px"><button class="btn" id="pe-save">Save Changes</button><button class="btn ghost" id="pe-reset">Reset</button></div>
        </div>
        <div class="pe-preview"><label class="label">Preview</label><div class="popover profile-pop" id="pe-prev" style="position:relative;animation:none"></div></div>
      </div>`;
    const prev = () => {
      const u = Object.assign({}, me, draft, { name: draft.name || me.name });
      $('#pe-prev', root).innerHTML = profileCardHtml(u).replace(/<div class="pp-actions">[\s\S]*?<\/div>\s*<\/div>\s*$/, '</div>');
      $('#pe-bio-count', root).textContent = (300 - draft.bio.length) + ' left';
    };
    prev();
    $('#pe-name', root).oninput = (e) => { draft.name = e.target.value; prev(); };
    $('#pe-status', root).oninput = (e) => { draft.customStatus = e.target.value; prev(); };
    $('#pe-bio', root).oninput = (e) => { draft.bio = e.target.value; prev(); };
    $('#pe-color', root).oninput = (e) => { draft.accent = e.target.value; $$('.color-swatch', root).forEach((s) => s.classList.remove('on')); prev(); };
    $('#pe-color-rm', root).onclick = () => { draft.accent = null; $$('.color-swatch', root).forEach((s) => s.classList.remove('on')); prev(); };
    $$('.color-swatch', root).forEach((s) => s.onclick = () => {
      draft.accent = s.dataset.c;
      $$('.color-swatch', root).forEach((x) => x.classList.toggle('on', x === s));
      prev();
    });
    $('#pe-av', root).onclick = async (e) => {
      const btn = e.currentTarget;
      const file = await pickImage();
      if (!file) return;
      btn.disabled = true; btn.textContent = 'Uploading…';
      try { draft.avatar = await uploadImageFile(file); prev(); }
      catch (err) { $('#pe-err', root).textContent = err.message; }
      btn.disabled = false; btn.textContent = 'Change Avatar';
    };
    $('#pe-av-rm', root).onclick = () => { draft.avatar = null; prev(); };
    $('#pe-reset', root).onclick = () => frame.redraw();
    $('#pe-save', root).onclick = async (e) => {
      const btn = e.currentTarget;
      if (!draft.name.trim()) { $('#pe-err', root).textContent = 'Display name cannot be empty.'; return; }
      btn.disabled = true;
      try {
        const res = await api('PATCH', '/api/me', draft);
        actions.setMe(res.user);
        toast('Profile saved', 'ok');
        frame.redraw();
      } catch (err) {
        $('#pe-err', root).textContent = err.message;
        btn.disabled = false;
      }
    };
    return;
  }

  if (id === 'appearance') {
    root.innerHTML = `
      <h2>Appearance</h2>
      <label class="label">Theme</label>
      <div class="theme-grid">${THEMES.map((t) => `
        <button class="theme-card ${prefs.theme === t.slug ? 'on' : ''}" data-theme="${t.slug}">
          <div class="tp"><div class="a" style="background:${t.c[0]}"></div><div class="b" style="background:${t.c[1]}"></div>
          <div class="c" style="background:${t.c[2]}"><i style="background:${t.c[3]};width:70%"></i><i style="background:${t.c[1]};width:90%"></i><i style="background:${t.c[1]};width:55%"></i></div></div>
          <div class="tn">${esc(t.name)}</div></button>`).join('')}</div>
      <h3>Accent color</h3>
      <div class="color-row"><input type="color" id="ap-accent" value="${esc(prefs.accent || '#5865f2')}"><button class="btn secondary sm" id="ap-accent-reset">Use theme default</button></div>
      <h3>Chat font scaling</h3>
      <div class="range-row"><span style="font-size:12px">A</span><input type="range" id="ap-fs" min="12" max="20" step="1" value="${prefs.fontSize || 15}"><span style="font-size:20px">A</span><span id="ap-fs-v" style="width:40px;text-align:right">${prefs.fontSize || 15}px</span></div>
      <h3>Message display</h3>
      <label class="radio-card ${!prefs.compact ? 'selected' : ''}"><input type="radio" name="disp" value="cozy" ${!prefs.compact ? 'checked' : ''}><div><div class="t">Cozy</div><div class="d">Modern, beautiful, and easy on your eyes.</div></div></label>
      <label class="radio-card ${prefs.compact ? 'selected' : ''}"><input type="radio" name="disp" value="compact" ${prefs.compact ? 'checked' : ''}><div><div class="t">Compact</div><div class="d">Fit more messages on screen at one time.</div></div></label>
      <h3>Other</h3>
      ${toggleRow('ap-24h', 'Use 24-hour time', 'Show times like 18:30 instead of 6:30 PM.', prefs.use24h)}
      ${toggleRow('ap-embeds', 'Show link previews', 'Embed YouTube videos and images from links posted in chat.', prefs.embeds)}
      ${toggleRow('ap-enter', 'Send with Enter', 'When off, use Ctrl+Enter to send and Enter for a new line.', prefs.sendOnEnter)}
      ${toggleRow('ap-motion', 'Reduce motion', 'Turn off animations.', prefs.reduceMotion)}`;
    const apply = () => { savePrefs(); applyAppearance(); actions.refreshAll(); };
    $$('.theme-card', root).forEach((c) => c.onclick = () => {
      prefs.theme = c.dataset.theme;
      try { localStorage.setItem('theme', prefs.theme); } catch (e) {}
      $$('.theme-card', root).forEach((x) => x.classList.toggle('on', x === c));
      apply();
    });
    $('#ap-accent', root).oninput = (e) => { prefs.accent = e.target.value; savePrefs(); applyAppearance(); };
    $('#ap-accent', root).onchange = apply;
    $('#ap-accent-reset', root).onclick = () => { prefs.accent = null; apply(); };
    $('#ap-fs', root).oninput = (e) => { prefs.fontSize = +e.target.value; $('#ap-fs-v', root).textContent = prefs.fontSize + 'px'; savePrefs(); applyAppearance(); };
    $$('input[name=disp]', root).forEach((r) => r.onchange = () => {
      prefs.compact = r.value === 'compact';
      $$('.radio-card', root).forEach((c) => c.classList.toggle('selected', c.contains(r) ? r.checked : !r.checked));
      apply();
    });
    $('#ap-24h', root).onchange = (e) => { prefs.use24h = e.target.checked; apply(); };
    $('#ap-embeds', root).onchange = (e) => { prefs.embeds = e.target.checked; apply(); };
    $('#ap-enter', root).onchange = (e) => { prefs.sendOnEnter = e.target.checked; savePrefs(); };
    $('#ap-motion', root).onchange = (e) => { prefs.reduceMotion = e.target.checked; apply(); };
    return;
  }

  if (id === 'notifications') {
    const perm = notifPermission();
    const permBox = perm === 'granted'
      ? `<div class="perm-box ok"><div class="pi">✅</div><div class="pt"><b>Desktop notifications are allowed</b>New messages pop up on Windows (or macOS / Linux) while Messages is open in a tab — even if it's minimised or in the background.</div></div>`
      : perm === 'denied'
        ? `<div class="perm-box bad"><div class="pi">🚫</div><div class="pt"><b>Your browser is blocking notifications</b>Click the 🔒 / ⓘ icon at the left of the address bar, set <i>Notifications</i> to <i>Allow</i>, then reload the page.</div></div>`
        : perm === 'unsupported'
          ? `<div class="perm-box bad"><div class="pi">🤷</div><div class="pt"><b>This browser doesn't support notifications</b>Try Chrome, Edge or Firefox on a computer.</div></div>`
          : `<div class="perm-box"><div class="pi">🔔</div><div class="pt"><b>Turn on desktop notifications</b>Get a pop-up on your computer when someone messages you.</div><button class="btn sm" id="nt-allow">Enable</button></div>`;
    root.innerHTML = `
      <h2>Notifications</h2>
      ${permBox}
      <div class="mute-hero ${prefs.muteAll ? 'on' : ''}" id="nt-hero">
        <div class="mh-ico">${prefs.muteAll ? '🔕' : '🔔'}</div>
        <div style="flex:1"><div class="t">Mute all notifications</div><div class="d">Silences every pop-up and sound from this app until you switch it back off. Unread badges still update.</div></div>
        <label class="switch"><input type="checkbox" id="nt-mute" ${prefs.muteAll ? 'checked' : ''}><span></span></label>
      </div>
      ${toggleRow('nt-desktop', 'Enable desktop notifications', 'Show a system notification for new messages.', prefs.desktop && perm === 'granted')}
      ${toggleRow('nt-mentions', 'Only DMs and @mentions', 'Group messages only notify you when someone @mentions you or replies to you.', prefs.mentionsOnly)}
      ${toggleRow('nt-preview', 'Show message text', "Include the message in the notification. Turn off if people can see your screen.", prefs.notifPreview)}
      ${toggleRow('nt-sounds', 'Notification sounds', 'Play a short sound for new messages.', prefs.sounds, '<button class="btn ghost xs" id="nt-play" style="padding:0;margin-top:4px">▶ Play sound</button>')}
      ${toggleRow('nt-badge', 'Unread badge on the tab', 'Show the unread count in the browser tab title and icon.', prefs.titleBadge)}
      <div style="margin-top:16px"><button class="btn secondary sm" id="nt-test">Send a test notification</button></div>
      <h3>Muted chats</h3>
      <div id="nt-muted"></div>
      <div class="hint" style="margin-top:16px">Your status matters too: <b>Do Not Disturb</b> silences notifications just like the mute switch. Notifications appear while Messages is open somewhere (any tab, background or minimised).</div>`;
    const drawMuted = () => {
      const muted = Object.keys(prefs.mutedChats || {}).map((id) => state.chats.get(id)).filter(Boolean);
      $('#nt-muted', root).innerHTML = muted.length
        ? muted.map((c) => `<div class="chan-row">${chatIconHtml(c, 28)}<span class="n">${esc(chatName(c))}</span><button class="btn secondary xs" data-unmute="${esc(c.id)}">Unmute</button></div>`).join('')
        : '<div class="hint" style="margin:0">Nothing muted. Use the 🔔 button at the top of any chat to mute it.</div>';
    };
    drawMuted();
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-unmute]');
      if (b) { delete prefs.mutedChats[b.dataset.unmute]; savePrefs(); drawMuted(); actions.refreshAll(); }
    });
    const allow = $('#nt-allow', root);
    if (allow) allow.onclick = async () => {
      const p = await requestNotifPermission();
      if (p === 'granted') { prefs.desktop = true; savePrefs(); toast('Desktop notifications are on 🎉', 'ok'); }
      actions.refreshChrome();
      frame.redraw();
    };
    $('#nt-mute', root).onchange = (e) => { actions.setMuteAll(e.target.checked); frame.redraw(); };
    $('#nt-desktop', root).onchange = async (e) => {
      if (e.target.checked && notifPermission() !== 'granted') {
        const p = await requestNotifPermission();
        if (p !== 'granted') { e.target.checked = false; toast(p === 'denied' ? 'Your browser is blocking notifications — see above for how to allow them.' : 'Notifications were not enabled.', 'error'); frame.redraw(); return; }
      }
      prefs.desktop = e.target.checked; savePrefs(); actions.refreshChrome(); frame.redraw();
    };
    $('#nt-mentions', root).onchange = (e) => { prefs.mentionsOnly = e.target.checked; savePrefs(); };
    $('#nt-preview', root).onchange = (e) => { prefs.notifPreview = e.target.checked; savePrefs(); };
    $('#nt-sounds', root).onchange = (e) => { prefs.sounds = e.target.checked; savePrefs(); };
    $('#nt-play', root).onclick = (e) => { e.preventDefault(); unlockAudio(); playSound('message'); };
    $('#nt-badge', root).onchange = (e) => { prefs.titleBadge = e.target.checked; savePrefs(); actions.refreshChrome(); };
    $('#nt-test', root).onclick = async () => {
      unlockAudio();
      if (prefs.sounds) playSound('test');
      if (notifPermission() !== 'granted') {
        const p = await requestNotifPermission();
        if (p !== 'granted') { toast("Desktop notifications aren't allowed in this browser yet.", 'error'); frame.redraw(); return; }
        frame.redraw();
      }
      const ok = await showDesktopNotification({
        title: 'Messages',
        body: prefs.muteAll ? 'Test notification (note: "Mute all" is on, so real ones are silenced).' : 'Notifications are working! 🎉',
        icon: avatarIconFor(state.me),
        tag: 'test'
      });
      if (!ok) toast("Couldn't show a notification — check your system's notification settings.", 'error');
    };
    return;
  }

  if (id === 'keybinds') {
    const k = (s) => s.split('+').map((x) => `<span class="kbd">${esc(x)}</span>`).join(' + ');
    const rows = [
      ['Quick switcher — jump to any chat or person', 'Ctrl+K'],
      ['Previous / next channel', 'Alt+↑ / Alt+↓'],
      ['Send message', 'Enter'],
      ['New line', 'Shift+Enter'],
      ['Edit your last message', '↑ (in an empty box)'],
      ['Cancel reply / edit, close popups', 'Esc'],
      ['Mark channel read & jump to newest', 'Esc (with nothing open)'],
      ['Open settings', 'Ctrl+,'],
      ['Upload a file', 'Ctrl+Shift+U'],
      ['Toggle mute all notifications', 'Ctrl+Shift+D'],
      ['Delete a message without confirming', 'Shift + click 🗑️']
    ];
    root.innerHTML = `<h2>Keybinds</h2><table class="keys-table">${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${k(r[1])}</td></tr>`).join('')}</table>
      <h3>Formatting</h3>
      <table class="keys-table">
        <tr><td><b>Bold</b></td><td><span class="kbd">**text**</span></td></tr>
        <tr><td><i>Italic</i></td><td><span class="kbd">*text*</span></td></tr>
        <tr><td><u>Underline</u></td><td><span class="kbd">__text__</span></td></tr>
        <tr><td><s>Strikethrough</s></td><td><span class="kbd">~~text~~</span></td></tr>
        <tr><td>Spoiler</td><td><span class="kbd">||text||</span></td></tr>
        <tr><td>Inline code</td><td><span class="kbd">\`code\`</span></td></tr>
        <tr><td>Code block (with highlighting)</td><td><span class="kbd">\`\`\`js …\`\`\`</span></td></tr>
        <tr><td>Quote</td><td><span class="kbd">&gt; text</span></td></tr>
        <tr><td>Heading</td><td><span class="kbd"># Title</span></td></tr>
        <tr><td>Emoji</td><td><span class="kbd">:fire:</span></td></tr>
        <tr><td>Mention</td><td><span class="kbd">@name</span></td></tr>
      </table>
      <h3>Slash commands</h3>
      <table class="keys-table">
        <tr><td>/shrug, /tableflip, /unflip, /lenny</td><td>Classic faces</td></tr>
        <tr><td>/me <i>does a thing</i></td><td>Italic action</td></tr>
        <tr><td>/spoiler <i>text</i></td><td>Hide text as a spoiler</td></tr>
        <tr><td>/roll [sides]</td><td>Roll a dice</td></tr>
        <tr><td>/flip</td><td>Flip a coin</td></tr>
      </table>`;
    return;
  }

  if (id === 'about') {
    root.innerHTML = `<h2>About</h2>
      <p>Messages — a private chat app with groups, channels, DMs, file & project sharing, and desktop notifications.</p>
      <div class="hint">Server: ${esc(location.hostname)} · Max upload size: ${esc(fmtSize(state.maxUploadBytes))}</div>
      <h3>Tips</h3>
      <ul style="line-height:1.7;color:var(--text)">
        <li>Drag & drop files anywhere, or paste images straight into the message box.</li>
        <li>Upload a whole project folder with <b>+ → Upload a folder</b> — it's zipped for you, and anyone can browse the files right in the chat.</li>
        <li>Right-click a message for more options. Hover a message to react, reply or edit.</li>
        <li>Click someone's name or picture to see their profile and DM them.</li>
      </ul>`;
  }
}

// ---------------------------------------------------------------------------
// Create group
// ---------------------------------------------------------------------------
export function openCreateGroup() {
  const selected = new Set();
  let icon = null;
  const m = openModal(`
    <div class="modal-head center"><h2>Create a group</h2><p>Give your group a personality with a name and a picture. You can always change these later.</p>
      <button class="icon-btn close" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">
      <button class="upload-circle" id="cg-icon" type="button"><span class="cam">📷</span>Upload<span class="plus">+</span></button>
      <div class="field"><label class="label">Group name <span class="req">*</span></label><input class="input" id="cg-name" maxlength="60" value="${esc((state.me.name || 'My') + "'s group")}" autofocus></div>
      <div class="field"><label class="label">Description</label><input class="input" id="cg-desc" maxlength="300" placeholder="What's this group about?"></div>
      <label class="label">Who can see it?</label>
      <label class="radio-card selected"><input type="radio" name="cg-priv" value="open" checked><div><div class="t">🌍 Everyone</div><div class="d">Anyone with the access key can see and join in.</div></div></label>
      <label class="radio-card"><input type="radio" name="cg-priv" value="private"><div><div class="t">🔐 Only people I pick</div><div class="d">Private — hidden from everyone else.</div></div></label>
      <div id="cg-members" class="hidden" style="margin-top:8px">${memberPickerHtml(selected)}</div>
      <div class="setting-row" style="padding-bottom:0"><div><div class="t">Password lock</div><div class="d">Ask for a password before the group's messages can be read.</div></div><label class="switch"><input type="checkbox" id="cg-lock"><span></span></label></div>
      <div id="cg-pw" class="hidden" style="margin-top:10px"><input class="input" type="password" id="cg-pw1" placeholder="Password (min 4 characters)" maxlength="60" style="margin-bottom:8px"><input class="input" type="password" id="cg-pw2" placeholder="Confirm password" maxlength="60"></div>
      <div class="error" id="cg-err"></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Back</button><button class="btn" id="cg-create">Create</button></div>`);
  const el = m.el;
  wireMemberPicker($('#cg-members', el), selected);
  $$('input[name=cg-priv]', el).forEach((r) => r.onchange = () => {
    $$('.radio-card', el).forEach((c) => c.classList.toggle('selected', c.querySelector('input').checked));
    $('#cg-members', el).classList.toggle('hidden', r.value !== 'private' || !r.checked);
  });
  $('#cg-lock', el).onchange = (e) => $('#cg-pw', el).classList.toggle('hidden', !e.target.checked);
  $('#cg-icon', el).onclick = async () => {
    const file = await pickImage();
    if (!file) return;
    const btn = $('#cg-icon', el);
    btn.innerHTML = '<span class="cam">⏳</span>Uploading';
    try {
      icon = await uploadImageFile(file);
      btn.innerHTML = `<img src="${esc(mediaUrl(icon))}" alt=""><span class="plus">✎</span>`;
    } catch (err) {
      btn.innerHTML = '<span class="cam">📷</span>Upload<span class="plus">+</span>';
      $('#cg-err', el).textContent = err.message;
    }
  };
  $('#cg-create', el).onclick = async (e) => {
    const err = $('#cg-err', el);
    const name = $('#cg-name', el).value.trim();
    if (!name) { err.textContent = 'Give the group a name.'; return; }
    const isPrivate = el.querySelector('input[name=cg-priv]:checked').value === 'private';
    const body = { type: 'group', name, description: $('#cg-desc', el).value, icon, private: isPrivate, memberIds: Array.from(selected) };
    if ($('#cg-lock', el).checked) {
      const p1 = $('#cg-pw1', el).value;
      if (p1.length < 4) { err.textContent = 'Password must be at least 4 characters.'; return; }
      if (p1 !== $('#cg-pw2', el).value) { err.textContent = "Passwords don't match."; return; }
      body.locked = true;
      body.passwordHash = await sha256Hex(p1);
    }
    e.currentTarget.disabled = true;
    try {
      const res = await api('POST', '/api/chats', body);
      if (body.locked) actions.rememberUnlock(res.chat.id, body.passwordHash);
      actions.upsertChat(res.chat);
      m.close();
      actions.openChat(res.chat.id);
      toast(`Created ${name} 🎉`, 'ok');
    } catch (ex) {
      err.textContent = ex.message;
      e.currentTarget.disabled = false;
    }
  };
}

// ---------------------------------------------------------------------------
// New DM (pick a person)
// ---------------------------------------------------------------------------
export function openNewDM() {
  const users = Array.from(state.users.values()).filter((u) => u.id !== state.me.id)
    .sort((a, b) => (statusOf(a.id) === 'offline') - (statusOf(b.id) === 'offline') || a.name.localeCompare(b.name));
  const m = openModal(`
    <div class="modal-head"><h2>Start a conversation</h2><p>Message anyone — they'll get it even if they're offline right now.</p><button class="icon-btn close" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">
      <input class="input" id="nd-q" placeholder="Type a name" autocomplete="off" autofocus>
      <div class="picker-list scroller thin" id="nd-list" style="max-height:340px"></div>
    </div>`);
  const draw = () => {
    const q = $('#nd-q', m.el).value.trim().toLowerCase();
    const list = users.filter((u) => !q || u.name.toLowerCase().includes(q));
    $('#nd-list', m.el).innerHTML = list.length ? list.map((u) => `
      <div class="pick-row" data-u="${esc(u.id)}">${avatarHtml(u, 32, { status: true })}<span class="n">${esc(u.name)}<span style="display:block;font-size:12px;color:var(--muted);font-weight:400">${esc(u.customStatus || STATUS_LABEL[statusOf(u.id)])}</span></span><span class="btn sm">Message</span></div>`).join('')
      : `<div class="side-empty">${users.length ? 'Nobody matches that name.' : "Nobody else has joined yet — share the link and access key with your friends!"}</div>`;
  };
  draw();
  $('#nd-q', m.el).oninput = draw;
  $('#nd-q', m.el).onkeydown = (e) => { if (e.key === 'Enter') { const f = $('[data-u]', m.el); if (f) f.click(); } };
  $('#nd-list', m.el).onclick = (e) => {
    const r = e.target.closest('[data-u]');
    if (!r) return;
    m.close();
    actions.openDM(r.dataset.u);
  };
}

// ---------------------------------------------------------------------------
// Create / edit channel
// ---------------------------------------------------------------------------
export function openChannelEditor(chat, channel) {
  const editing = !!channel;
  const m = openModal(`
    <div class="modal-head"><h2>${editing ? 'Edit channel' : 'Create channel'}</h2>${editing ? '' : `<p>in ${esc(chat.name)}</p>`}<button class="icon-btn close" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">
      <div class="field"><label class="label">Channel name</label>
        <div style="position:relative"><span style="position:absolute;left:10px;top:8px;font-size:18px;color:var(--muted)">#</span>
        <input class="input" id="ch-name" maxlength="40" style="padding-left:28px" placeholder="new-channel" value="${esc(editing ? channel.name : '')}" autofocus></div></div>
      <div class="field"><label class="label">Topic</label><input class="input" id="ch-topic" maxlength="300" placeholder="Let everyone know what this channel is for" value="${esc(editing ? channel.topic || '' : '')}"></div>
      <div class="error" id="ch-err"></div>
    </div>
    <div class="modal-foot">${editing && chat.channels.length > 1 ? '<button class="btn outline-danger sm left" id="ch-del">Delete channel</button>' : ''}<button class="btn ghost" data-close>Cancel</button><button class="btn" id="ch-save">${editing ? 'Save' : 'Create Channel'}</button></div>`);
  const nameIn = $('#ch-name', m.el);
  nameIn.oninput = () => { nameIn.value = nameIn.value.toLowerCase().replace(/\s/g, '-'); };
  const save = async () => {
    const body = { name: nameIn.value, topic: $('#ch-topic', m.el).value };
    try {
      const res = editing
        ? await api('PATCH', `/api/chats/${chat.id}/channels/${channel.id}`, body)
        : await api('POST', `/api/chats/${chat.id}/channels`, body);
      actions.upsertChat(res.chat);
      m.close();
      if (!editing && res.channel) actions.openChat(chat.id, res.channel.id);
    } catch (e) {
      $('#ch-err', m.el).textContent = e.message;
    }
  };
  $('#ch-save', m.el).onclick = save;
  nameIn.onkeydown = (e) => { if (e.key === 'Enter') save(); };
  const del = $('#ch-del', m.el);
  if (del) del.onclick = async () => {
    m.close();
    const ok = await confirmDialog({ title: 'Delete channel', body: `Delete #${channel.name}? All of its messages will be gone for good.`, confirm: 'Delete Channel', danger: true });
    if (!ok) return;
    try {
      const res = await api('DELETE', `/api/chats/${chat.id}/channels/${channel.id}`);
      actions.upsertChat(res.chat);
    } catch (e) { toast(e.message, 'error'); }
  };
}

// ---------------------------------------------------------------------------
// Group settings
// ---------------------------------------------------------------------------
export function openGroupSettings(chatId, section) {
  const chat0 = state.chats.get(chatId);
  if (!chat0) return;
  const nav = [
    { header: chat0.name },
    { id: 'overview', label: 'Overview' },
    { id: 'channels', label: 'Channels' },
    { id: 'members', label: 'Members & Privacy' },
    { id: 'security', label: 'Password Lock' },
    { sep: true },
    { id: 'delete', label: 'Delete Group', danger: true, action: () => deleteGroup(chatId, frame) }
  ];
  const frame = openFullscreen({ nav, initial: section || 'overview', title: 'Group settings', render: (id, root) => renderGroupSettings(chatId, id, root) });
  return frame;
}

async function deleteGroup(chatId, frame) {
  const chat = state.chats.get(chatId);
  if (!chat) return;
  const ok = await confirmDialog({ title: `Delete '${chat.name}'`, body: 'This deletes the group, all its channels and every message in it, for everyone. This cannot be undone.', confirm: 'Delete Group', danger: true });
  if (!ok) return;
  try {
    await api('DELETE', `/api/chats/${chatId}`);
    actions.removeChat(chatId);
    if (frame) frame.close();
    toast('Group deleted');
  } catch (e) { toast(e.message, 'error'); }
}

function renderGroupSettings(chatId, id, root) {
  const chat = state.chats.get(chatId);
  if (!chat) { root.innerHTML = '<h2>This group no longer exists.</h2>'; return; }
  const owner = chat.ownerId ? getUser(chat.ownerId) : null;
  if (id === 'overview') {
    let icon = chat.icon;
    root.innerHTML = `<h2>Group Overview</h2>
      <div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap">
        <div style="text-align:center"><button class="upload-circle" id="gs-icon" type="button" style="width:100px;height:100px;margin:0 0 8px">${icon ? `<img src="${esc(mediaUrl(icon))}" alt="">` : `<span class="cam">📷</span>Upload`}<span class="plus">✎</span></button>
          <button class="btn ghost xs" id="gs-icon-rm">Remove</button></div>
        <div style="flex:1;min-width:240px">
          <div class="field"><label class="label">Group name</label><input class="input" id="gs-name" maxlength="60" value="${esc(chat.name)}"></div>
          <div class="field"><label class="label">Description</label><textarea class="textarea" id="gs-desc" maxlength="300">${esc(chat.description || '')}</textarea></div>
        </div>
      </div>
      <div class="hint">Owner: ${owner ? esc(owner.name) : 'nobody (anyone in the group can manage it)'} · Created ${esc(new Date(chat.createdAt).toLocaleDateString())}</div>
      <div class="error" id="gs-err"></div>
      <button class="btn" id="gs-save" style="margin-top:8px">Save Changes</button>`;
    $('#gs-icon', root).onclick = async () => {
      const file = await pickImage();
      if (!file) return;
      try {
        icon = await uploadImageFile(file);
        $('#gs-icon', root).innerHTML = `<img src="${esc(mediaUrl(icon))}" alt=""><span class="plus">✎</span>`;
      } catch (e) { $('#gs-err', root).textContent = e.message; }
    };
    $('#gs-icon-rm', root).onclick = () => { icon = null; $('#gs-icon', root).innerHTML = '<span class="cam">📷</span>Upload<span class="plus">✎</span>'; };
    $('#gs-save', root).onclick = async () => {
      try {
        const res = await api('PATCH', `/api/chats/${chat.id}`, { name: $('#gs-name', root).value, description: $('#gs-desc', root).value, icon }, { chatPass: state.unlocked.get(chat.id) });
        actions.upsertChat(res.chat);
        toast('Saved', 'ok');
      } catch (e) { $('#gs-err', root).textContent = e.message; }
    };
    return;
  }
  if (id === 'channels') {
    root.innerHTML = `<h2>Channels</h2><div class="hint" style="margin:0 0 14px">Split conversations into topics, like #general, #memes or #homework.</div>
      ${chat.channels.map((c) => `<div class="chan-row"><span class="hash">#</span><div style="flex:1;min-width:0"><div class="n">${esc(c.name)}</div>${c.topic ? `<div class="tp">${esc(c.topic)}</div>` : ''}</div><button class="btn secondary xs" data-edit="${esc(c.id)}">Edit</button></div>`).join('')}
      <button class="btn sm" id="gs-addch" style="margin-top:8px">+ Create Channel</button>`;
    root.onclick = (e) => {
      const b = e.target.closest('[data-edit]');
      if (b) openChannelEditor(chat, chat.channels.find((c) => c.id === b.dataset.edit));
      if (e.target.id === 'gs-addch') openChannelEditor(chat, null);
    };
    return;
  }
  if (id === 'members') {
    const isPrivate = Array.isArray(chat.memberIds);
    const selected = new Set((chat.memberIds || []).filter((x) => x !== state.me.id));
    root.innerHTML = `<h2>Members & Privacy</h2>
      <label class="radio-card ${!isPrivate ? 'selected' : ''}"><input type="radio" name="gs-priv" value="open" ${!isPrivate ? 'checked' : ''}><div><div class="t">🌍 Everyone</div><div class="d">Anyone with the access key can see this group.</div></div></label>
      <label class="radio-card ${isPrivate ? 'selected' : ''}"><input type="radio" name="gs-priv" value="private" ${isPrivate ? 'checked' : ''}><div><div class="t">🔐 Only members</div><div class="d">Only the people ticked below (and you) can see it.</div></div></label>
      <div id="gs-members" class="${isPrivate ? '' : 'hidden'}" style="margin-top:12px"><label class="label">Members</label>${memberPickerHtml(selected)}</div>
      <div class="error" id="gs-err"></div>
      <button class="btn" id="gs-save" style="margin-top:8px">Save Changes</button>`;
    wireMemberPicker($('#gs-members', root), selected);
    $$('input[name=gs-priv]', root).forEach((r) => r.onchange = () => {
      $$('.radio-card', root).forEach((c) => c.classList.toggle('selected', c.querySelector('input').checked));
      $('#gs-members', root).classList.toggle('hidden', !(r.value === 'private' && r.checked));
    });
    $('#gs-save', root).onclick = async () => {
      const priv = root.querySelector('input[name=gs-priv]:checked').value === 'private';
      try {
        const res = await api('PATCH', `/api/chats/${chat.id}`, { private: priv, memberIds: Array.from(selected) });
        actions.upsertChat(res.chat);
        toast('Saved', 'ok');
      } catch (e) { $('#gs-err', root).textContent = e.message; }
    };
    return;
  }
  if (id === 'security') {
    root.innerHTML = `<h2>Password Lock</h2>
      <div class="hint" style="margin:0 0 16px">When locked, the group's messages are only sent to people who type the password (once per browser tab). It keeps casual eyes out — it's not end-to-end encryption.</div>
      ${chat.locked ? '<div class="perm-box ok"><div class="pi">🔒</div><div class="pt"><b>This group is locked</b>Set a new password below, or remove the lock.</div></div>' : ''}
      <div class="field"><label class="label">${chat.locked ? 'New password' : 'Password'}</label><input class="input" type="password" id="gs-pw1" maxlength="60"></div>
      <div class="field"><label class="label">Confirm password</label><input class="input" type="password" id="gs-pw2" maxlength="60"></div>
      <div class="error" id="gs-err"></div>
      <div style="display:flex;gap:8px"><button class="btn" id="gs-lock">${chat.locked ? 'Change Password' : 'Lock Group'}</button>${chat.locked ? '<button class="btn outline-danger" id="gs-unlock">Remove Lock</button>' : ''}</div>`;
    $('#gs-lock', root).onclick = async () => {
      const p1 = $('#gs-pw1', root).value;
      if (p1.length < 4) { $('#gs-err', root).textContent = 'Password must be at least 4 characters.'; return; }
      if (p1 !== $('#gs-pw2', root).value) { $('#gs-err', root).textContent = "Passwords don't match."; return; }
      const hash = await sha256Hex(p1);
      try {
        const res = await api('PATCH', `/api/chats/${chat.id}`, { locked: true, passwordHash: hash }, { chatPass: state.unlocked.get(chat.id) });
        actions.rememberUnlock(chat.id, hash);
        actions.upsertChat(res.chat);
        toast('Group locked 🔒', 'ok');
        renderGroupSettings(chatId, 'security', root);
      } catch (e) { $('#gs-err', root).textContent = e.message; }
    };
    const un = $('#gs-unlock', root);
    if (un) un.onclick = async () => {
      try {
        const res = await api('PATCH', `/api/chats/${chat.id}`, { locked: false }, { chatPass: state.unlocked.get(chat.id) });
        actions.upsertChat(res.chat);
        toast('Lock removed', 'ok');
        renderGroupSettings(chatId, 'security', root);
      } catch (e) { $('#gs-err', root).textContent = e.message; }
    };
  }
}

// ---------------------------------------------------------------------------
// Invite people (private groups) — quick member picker
// ---------------------------------------------------------------------------
export function openInvite(chatId) {
  const chat = state.chats.get(chatId);
  if (!chat) return;
  if (!Array.isArray(chat.memberIds)) {
    openModal(`<div class="modal-head"><h2>Invite people</h2><button class="icon-btn close" data-close aria-label="Close">✕</button></div>
      <div class="modal-body"><p style="margin:0">🌍 <b>${esc(chat.name)}</b> is open to everyone with the access key, so there's no need to invite anyone — just send them the link:</p>
      <div class="secret" style="margin-top:12px">${esc(location.origin + location.pathname)}</div></div>
      <div class="modal-foot"><button class="btn" data-close>Done</button></div>`);
    return;
  }
  const selected = new Set(chat.memberIds.filter((x) => x !== state.me.id));
  const m = openModal(`<div class="modal-head"><h2>Invite people to ${esc(chat.name)}</h2><button class="icon-btn close" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">${memberPickerHtml(selected)}<div class="error" id="iv-err"></div></div>
    <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="iv-save">Save</button></div>`);
  wireMemberPicker(m.el, selected);
  $('#iv-save', m.el).onclick = async () => {
    try {
      const res = await api('PATCH', `/api/chats/${chat.id}`, { private: true, memberIds: Array.from(selected) });
      actions.upsertChat(res.chat);
      m.close();
      toast('Members updated', 'ok');
    } catch (e) { $('#iv-err', m.el).textContent = e.message; }
  };
}

// ---------------------------------------------------------------------------
// Quick switcher (Ctrl+K)
// ---------------------------------------------------------------------------
export function openQuickSwitcher() {
  const m = openModal(`
    <div class="modal-body" style="padding:20px">
      <div style="font-weight:700;color:var(--strong);margin-bottom:10px">Where do you want to go?</div>
      <input class="input" id="qs-q" placeholder="Search for chats, channels or people" autocomplete="off" style="font-size:17px;padding:14px" autofocus>
      <div class="picker-list scroller thin" id="qs-list" style="max-height:340px;margin-top:10px"></div>
      <div class="hint">Tip: start with <b>@</b> for people, <b>#</b> for channels. ↑ ↓ to move, Enter to go.</div>
    </div>`);
  let sel = 0;
  let items = [];
  const build = () => {
    const out = [];
    state.users.forEach((u) => { if (u.id !== state.me.id) out.push({ kind: 'user', id: u.id, label: u.name, sub: 'Person', html: avatarHtml(u, 28, { status: true }) }); });
    state.chats.forEach((c) => {
      if (c.type === 'group') {
        c.channels.forEach((ch) => out.push({ kind: 'channel', chatId: c.id, id: ch.id, label: ch.name, sub: c.name, html: '<span style="width:28px;text-align:center;font-size:20px;color:var(--muted)">#</span>' }));
      }
    });
    return out;
  };
  const all = build();
  const draw = () => {
    let q = $('#qs-q', m.el).value.trim().toLowerCase();
    let filter = null;
    if (q.startsWith('@')) { filter = 'user'; q = q.slice(1); }
    else if (q.startsWith('#')) { filter = 'channel'; q = q.slice(1); }
    items = all.filter((i) => (!filter || i.kind === filter) && (!q || i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q)));
    items.sort((a, b) => (b.label.toLowerCase().startsWith(q)) - (a.label.toLowerCase().startsWith(q)));
    items = items.slice(0, 40);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    $('#qs-list', m.el).innerHTML = items.map((i, n) => `<div class="pick-row ${n === sel ? 'sel' : ''}" data-n="${n}" style="${n === sel ? 'background:var(--active)' : ''}">${i.html}<span class="n">${esc(i.label)}</span><span style="color:var(--muted);font-size:12.5px">${esc(i.sub)}</span></div>`).join('') || '<div class="side-empty">No matches.</div>';
  };
  const go = (i) => {
    if (!i) return;
    m.close();
    if (i.kind === 'user') actions.openDM(i.id);
    else actions.openChat(i.chatId, i.id);
  };
  draw();
  const input = $('#qs-q', m.el);
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') go(items[sel]);
  };
  $('#qs-list', m.el).onclick = (e) => { const r = e.target.closest('[data-n]'); if (r) go(items[+r.dataset.n]); };
}

