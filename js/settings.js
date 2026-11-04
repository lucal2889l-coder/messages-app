// Settings screens + group management + "new" dialogs + quick switcher.
import { $, $$, esc, fmtSize, sha256Hex, resizeImage } from './util.js';
import { api, uploadFile, mediaUrl } from './api.js';
import {
  state, prefs, savePrefs, actions, applyAppearance, THEMES, avatarHtml, nameHtml, badgesHtml, chatIconHtml, bannerStyle,
  STATUS_LABEL, chatName, getUser, statusOf
} from './store.js';
import { toast, openModal, confirmDialog, registerLayer, memberPickerHtml, wireMemberPicker, profileCardHtml, emojiPicker } from './ui.js';
import {
  notifPermission, requestNotifPermission, showDesktopNotification, playSound, avatarIconFor, unlockAudio,
  pushSupported, disablePush, pushDeviceId
} from './notify.js';
import { micConstraints, leaveCall } from './voice.js';
import { becomeAdmin, stepDown, openAdminPanel } from './admin.js';

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
export async function uploadImageFile(file, { maxDim = 320, aspect = 1 } = {}) {
  if (!file) return null;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Please pick a PNG, JPG, GIF or WebP image.');
  let blob = file;
  let name = file.name || 'image';
  if (!(file.type === 'image/gif' && file.size < 4 * 1024 * 1024)) {
    blob = await resizeImage(file, maxDim, 0.88, aspect);
    name = name.replace(/\.[^.]+$/, '') + '.jpg';
  }
  const up = uploadFile(blob, { name });
  const f = await up.promise;
  return f.url;
}

// ---------------------------------------------------------------------------
// Generic full-screen settings frame
// ---------------------------------------------------------------------------
export function openFullscreen({ nav, initial, render, title }) {
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
    inner.onclick = null;
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
    { id: 'customize', label: 'Customize ✨' },
    { header: 'App Settings' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'voice', label: 'Voice' },
    { id: 'keybinds', label: 'Keybinds' },
    { id: 'about', label: 'About' },
    { header: 'Server' },
    { id: 'admin', label: 'Admin' },
    { sep: true },
    { id: 'logout', label: 'Log Out', danger: true, action: () => logout() }
  ];
  return openFullscreen({ nav, initial: section || 'account', title: 'User settings', render: renderSettings });
}

async function logout() {
  const ok = await confirmDialog({
    title: 'Log out',
    html: `<p style="margin:0">${state.me.hasPassword ? 'Are you sure you want to log out?' : "You haven't set a password yet, so you won't be able to get back into this account. Set one in My Account first."}</p>`,
    confirm: 'Log Out',
    danger: true
  });
  if (!ok) return;
  leaveCall({ silent: true });
  await disablePush();
  await api('POST', '/api/auth/logout', {}, { quiet: true }).catch(() => {});
  try { localStorage.removeItem('auth_token'); } catch (e) {}
  location.hash = '';
  location.reload();
}

// Accounts from before logins existed have no username or password yet.
export function openClaimDialog() {
  const m = openModal(`
    <div class="modal-head"><h2>Secure your account</h2><p>Messages has real logins now. Pick a username and password so you can get back into this account from any device.</p></div>
    <form id="cl-form">
      <div class="modal-body">
        <div class="field"><label class="label" for="cl-user">Username</label><input class="input" id="cl-user" maxlength="24" autocomplete="username" autofocus></div>
        <div class="field"><label class="label" for="cl-pw">Password</label><input class="input" id="cl-pw" type="password" autocomplete="new-password"></div>
        <div class="field"><label class="label" for="cl-pw2">Confirm password</label><input class="input" id="cl-pw2" type="password" autocomplete="new-password"></div>
        <div class="error" id="cl-err"></div>
      </div>
      <div class="modal-foot"><button class="btn ghost" type="button" data-close>Later</button><button class="btn" type="submit">Save</button></div>
    </form>`);
  $('#cl-form', m.el).onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#cl-err', m.el);
    const password = $('#cl-pw', m.el).value;
    if (password !== $('#cl-pw2', m.el).value) { err.textContent = "Passwords don't match."; return; }
    try {
      const res = await api('POST', '/api/me/credentials', { username: $('#cl-user', m.el).value.trim(), password });
      actions.setMe(res.user);
      m.close();
      toast('Account secured 🔐', 'ok');
    } catch (ex) { err.textContent = ex.message; }
  };
}

function renderSettings(id, root, frame) {
  const me = state.me;
  if (id === 'account') {
    root.innerHTML = `
      <h2>My Account</h2>
      <div class="account-card">
        <div class="banner" style="${esc(bannerStyle(me))}"></div>
        <div class="row">${avatarHtml(me, 80, { status: true })}<div class="n">${nameHtml(me)}${badgesHtml(me)}</div><button class="btn sm" data-go="profile">Edit User Profile</button></div>
        <div class="inner">
          <div class="kv"><div><div class="k">Display name</div><div class="v">${esc(me.name)}</div></div><button class="btn secondary sm" data-go="profile">Edit</button></div>
          <div class="kv"><div><div class="k">Username</div><div class="v">${esc(me.username || 'Not set yet')}</div></div><button class="btn secondary sm" data-act="${me.hasPassword ? 'username' : 'claim'}">${me.hasPassword ? 'Change' : 'Set up'}</button></div>
          <div class="kv"><div><div class="k">Status</div><div class="v">${esc(STATUS_LABEL[me.status] || 'Online')}</div></div><button class="btn secondary sm" data-act="status">Change</button></div>
          <div class="kv"><div><div class="k">Member since</div><div class="v">${esc(new Date(me.createdAt || Date.now()).toLocaleDateString())}</div></div></div>
        </div>
      </div>
      ${me.hasPassword ? `<h3>Password</h3>
      <form id="pw-form" class="pw-form">
        <div class="field"><label class="label" for="pw-cur">Current password</label><input class="input" id="pw-cur" type="password" autocomplete="current-password"></div>
        <div class="field"><label class="label" for="pw-new">New password</label><input class="input" id="pw-new" type="password" autocomplete="new-password"></div>
        <div class="field"><label class="label" for="pw-new2">Confirm new password</label><input class="input" id="pw-new2" type="password" autocomplete="new-password"></div>
        <div class="error" id="pw-err"></div>
        <button class="btn sm" type="submit">Change Password</button>
      </form>` : ''}
      <div class="divider"></div>
      <h3>Devices</h3>
      <div class="hint" style="margin:0 0 10px">Lost a device or used a shared computer? This signs out everywhere except here.</div>
      <button class="btn secondary sm" data-act="others">Log Out Other Devices</button>
      <div class="divider"></div>
      <h3>Log out</h3>
      <div class="hint" style="margin:0 0 10px">Signs this browser out. You'll need your username and password to get back in.</div>
      <button class="btn outline-danger sm" data-act="logout">Log Out</button>`;
    const pwForm = $('#pw-form', root);
    if (pwForm) pwForm.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#pw-err', root);
      const password = $('#pw-new', root).value;
      if (password !== $('#pw-new2', root).value) { err.textContent = "Passwords don't match."; return; }
      try {
        await api('POST', '/api/me/credentials', { currentPassword: $('#pw-cur', root).value, password });
        toast('Password changed. Other devices were signed out.', 'ok');
        frame.redraw();
      } catch (ex) { err.textContent = ex.message; }
    };
    root.onclick = async (e) => {
      const b = e.target.closest('[data-go],[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (b.dataset.go) frame.show(b.dataset.go);
      else if (act === 'logout') logout();
      else if (act === 'status') actions.openStatusMenu(b, () => frame.redraw());
      else if (act === 'claim') openClaimDialog();
      else if (act === 'username') changeUsername(frame);
      else if (act === 'others') {
        try { await api('POST', '/api/me/logout-others', {}); toast('Other devices were signed out', 'ok'); } catch (ex) { toast(ex.message, 'error'); }
      }
    };
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
      $('#pe-prev', root).innerHTML = profileCardHtml(u, { preview: true });
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

  if (id === 'customize') { renderCustomize(root, frame); return; }
  if (id === 'voice') { renderVoiceSettings(root, frame); return; }
  if (id === 'admin') {
    root.innerHTML = me.isAdmin ? `
      <h2>Admin</h2>
      <div class="perm-box ok"><div class="pi">🛡️</div><div class="pt"><b>You're an admin</b>You can set the server status, manage people and groups, and make invites.</div><button class="btn sm" id="ad-open">Open Admin Panel</button></div>
      <button class="btn ghost sm" id="ad-resign">Step down</button>` : `
      <h2>Admin</h2>
      <div class="perm-box"><div class="pi">🛡️</div><div class="pt"><b>Become an admin</b>Admins can set the server status, set other people's status, kick people and manage the server. You'll need the admin code.</div><button class="btn sm" id="ad-claim">Become Admin</button></div>`;
    if (me.isAdmin) {
      $('#ad-open', root).onclick = () => openAdminPanel();
      $('#ad-resign', root).onclick = () => stepDown(() => frame.redraw());
    } else {
      $('#ad-claim', root).onclick = () => becomeAdmin(() => frame.redraw());
    }
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
      ? `<div class="perm-box ok"><div class="pi">✅</div><div class="pt"><b>Desktop notifications are allowed</b>New messages pop up on Windows (or macOS / Linux), even with every Messages tab closed.</div></div>`
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
      ${pushSupported() ? toggleRow('nt-push', 'Notify me when Messages is closed', 'Keeps working with every tab closed, as long as your browser is running. In Chrome, also turn on <i>Settings → System → Continue running background apps</i> to get them with every window closed.', prefs.pushEnabled && prefs.desktop && perm === 'granted') : ''}
      ${toggleRow('nt-mentions', 'Only DMs and @mentions', 'Group messages only notify you when someone @mentions you or replies to you.', prefs.mentionsOnly)}
      ${toggleRow('nt-preview', 'Show message text', "Include the message in the notification. Turn off if people can see your screen.", prefs.notifPreview)}
      ${toggleRow('nt-sounds', 'Notification sounds', 'Play a short sound for new messages.', prefs.sounds, '<button class="btn ghost xs" id="nt-play" style="padding:0;margin-top:4px">▶ Play sound</button>')}
      ${toggleRow('nt-badge', 'Unread badge on the tab', 'Show the unread count in the browser tab title and icon.', prefs.titleBadge)}
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn secondary sm" id="nt-test">Send a test notification</button>${pushSupported() ? '<button class="btn secondary sm" id="nt-test-push">Test with the tab closed</button>' : ''}</div>
      <h3>Muted chats</h3>
      <div id="nt-muted"></div>
      <div class="hint" style="margin-top:16px">Your status matters too: <b>Do Not Disturb</b> silences notifications just like the mute switch.</div>`;
    const drawMuted = () => {
      const muted = Object.keys(prefs.mutedChats || {}).map((id) => state.chats.get(id)).filter(Boolean);
      $('#nt-muted', root).innerHTML = muted.length
        ? muted.map((c) => `<div class="chan-row">${chatIconHtml(c, 28)}<span class="n">${esc(chatName(c))}</span><button class="btn secondary xs" data-unmute="${esc(c.id)}">Unmute</button></div>`).join('')
        : '<div class="hint" style="margin:0">Nothing muted. Use the 🔔 button at the top of any chat to mute it.</div>';
    };
    drawMuted();
    root.onclick = (e) => {
      const b = e.target.closest('[data-unmute]');
      if (b) { delete prefs.mutedChats[b.dataset.unmute]; savePrefs(); drawMuted(); actions.refreshAll(); }
    };
    const allow = $('#nt-allow', root);
    if (allow) allow.onclick = async () => {
      const p = await requestNotifPermission();
      if (p === 'granted') { prefs.desktop = true; savePrefs(); actions.setupPush(); toast('Desktop notifications are on 🎉', 'ok'); }
      actions.refreshChrome();
      frame.redraw();
    };
    const pushToggle = $('#nt-push', root);
    if (pushToggle) pushToggle.onchange = async (e) => {
      if (e.target.checked && notifPermission() !== 'granted') {
        const p = await requestNotifPermission();
        if (p !== 'granted') { toast('Allow notifications first — see above.', 'error'); frame.redraw(); return; }
        prefs.desktop = true;
      }
      prefs.pushEnabled = e.target.checked;
      savePrefs();
      if (e.target.checked) await actions.setupPush(); else await disablePush();
      frame.redraw();
    };
    $('#nt-mute', root).onchange = (e) => { actions.setMuteAll(e.target.checked); frame.redraw(); };
    $('#nt-desktop', root).onchange = async (e) => {
      if (e.target.checked && notifPermission() !== 'granted') {
        const p = await requestNotifPermission();
        if (p !== 'granted') { e.target.checked = false; toast(p === 'denied' ? 'Your browser is blocking notifications — see above for how to allow them.' : 'Notifications were not enabled.', 'error'); frame.redraw(); return; }
      }
      prefs.desktop = e.target.checked;
      savePrefs();
      if (e.target.checked) await actions.setupPush(); else await disablePush();
      actions.refreshChrome();
      frame.redraw();
    };
    $('#nt-mentions', root).onchange = (e) => { prefs.mentionsOnly = e.target.checked; savePrefs(); };
    $('#nt-preview', root).onchange = (e) => { prefs.notifPreview = e.target.checked; savePrefs(); };
    $('#nt-sounds', root).onchange = (e) => { prefs.sounds = e.target.checked; savePrefs(); };
    $('#nt-play', root).onclick = (e) => { e.preventDefault(); unlockAudio(); playSound('message'); };
    $('#nt-badge', root).onchange = (e) => { prefs.titleBadge = e.target.checked; savePrefs(); actions.refreshChrome(); };
    const pushTest = $('#nt-test-push', root);
    if (pushTest) pushTest.onclick = async () => {
      await actions.setupPush();
      const id = pushDeviceId();
      if (!id) { toast('Turn on "Notify me when Messages is closed" first.', 'error'); return; }
      try {
        await api('POST', '/api/push/test', { id });
        toast('Close this tab now. A notification should appear in 10 seconds.', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    };
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
      ['Delete a message without confirming', 'Shift + click 🗑️'],
      ['Mute / unmute in a call', 'Ctrl+Shift+M']
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
      <p>Messages — a private chat app with groups, channels, DMs, voice calls, file & project sharing, and desktop notifications.</p>
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

function changeUsername(frame) {
  const m = openModal(`
    <div class="modal-head"><h2>Change your username</h2><p>You'll use it to log in.</p></div>
    <form id="un-form">
      <div class="modal-body">
        <div class="field"><label class="label" for="un-new">New username</label><input class="input" id="un-new" maxlength="24" value="${esc(state.me.username || '')}" autocomplete="username" autofocus></div>
        <div class="field"><label class="label" for="un-pw">Current password</label><input class="input" id="un-pw" type="password" autocomplete="current-password"></div>
        <div class="error" id="un-err"></div>
      </div>
      <div class="modal-foot"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn" type="submit">Save</button></div>
    </form>`);
  $('#un-form', m.el).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api('POST', '/api/me/credentials', { username: $('#un-new', m.el).value.trim(), currentPassword: $('#un-pw', m.el).value });
      actions.setMe(res.user);
      m.close();
      toast('Username changed', 'ok');
      frame.redraw();
    } catch (ex) { $('#un-err', m.el).textContent = ex.message; }
  };
}

// ---------------------------------------------------------------------------
// Customize: the Nitro-style look of your profile. Free for everyone here.
// ---------------------------------------------------------------------------
const NAME_FX = [['none', 'None'], ['glow', 'Glow'], ['shimmer', 'Shimmer'], ['rainbow', 'Rainbow'], ['pulse', 'Pulse']];
const NAME_FONTS = [['default', 'Default'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['mono', 'Mono'], ['hand', 'Handwritten']];
const RINGS = [['none', 'None'], ['neon', 'Neon'], ['pulse', 'Pulse'], ['gold', 'Gold'], ['fire', 'Fire'], ['ice', 'Ice'], ['rainbow', 'Rainbow'], ['orbit', 'Orbit']];

function colorField(key, label, value, fallback) {
  return `<div class="color-field"><span class="cf-label">${esc(label)}</span>
    <input type="color" data-color="${key}" value="${esc(value || fallback)}" aria-label="${esc(label)}">
    <button class="btn ghost xs" data-clear="${key}" ${value ? '' : 'disabled'}>Clear</button></div>`;
}

function renderCustomize(root, frame) {
  const me = state.me;
  const draft = Object.assign({}, me.look || {});
  const chips = (key, options) => `<div class="chip-row">${options.map(([v, l]) => `<button class="chip ${(draft[key] || 'none') === v || (key === 'nameFont' && (draft[key] || 'default') === v) ? 'on' : ''}" data-chip="${key}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
  const draw = () => {
    root.innerHTML = `
      <h2>Customize ✨</h2>
      <div class="hint" style="margin:0 0 16px">Everyone sees these on your name, picture and profile.</div>
      <div class="cz-layout">
        <div class="pe-form">
          <label class="label">Name color</label>
          <div class="color-fields">${colorField('nameColor', 'Color', draft.nameColor, '#ff7ad9')}${colorField('nameColor2', 'Fade to', draft.nameColor2, '#7a9bff')}</div>
          <label class="label">Name effect</label>${chips('nameFx', NAME_FX)}
          <label class="label">Name font</label>${chips('nameFont', NAME_FONTS)}
          <label class="label">Profile picture ring</label>${chips('ring', RINGS)}
          <div class="color-fields">${colorField('ringColor', 'Ring color', draft.ringColor, '#00e5ff')}</div>
          <label class="label">Flair</label>
          <div class="flair-row"><button class="btn secondary sm" id="cz-flair">${draft.flair ? esc(draft.flair) + ' Change' : 'Pick an emoji'}</button>${draft.flair ? '<button class="btn ghost xs" id="cz-flair-rm">Remove</button>' : ''}<span class="hint" style="margin:0">Shown after your name.</span></div>
          <label class="label">Profile banner</label>
          <div class="flair-row"><button class="btn secondary sm" id="cz-banner">${draft.banner ? 'Change Image' : 'Upload Image'}</button>${draft.banner ? '<button class="btn ghost xs" id="cz-banner-rm">Remove</button>' : ''}<span class="hint" style="margin:0">Animated GIFs work.</span></div>
          <div class="color-fields">${colorField('bannerColor2', 'Banner fade', draft.bannerColor2, '#eb459e')}</div>
          <label class="label">Profile theme</label>
          <div class="color-fields">${colorField('themeA', 'Top', draft.themeA, '#2b1f4f')}${colorField('themeB', 'Bottom', draft.themeB, '#0e1a33')}</div>
          <div class="error" id="cz-err"></div>
          <div style="display:flex;gap:8px;margin-top:6px"><button class="btn" id="cz-save">Save Changes</button><button class="btn ghost" id="cz-reset">Reset Everything</button></div>
        </div>
        <div class="cz-preview"><label class="label">Preview</label>
          <div class="cz-sample">${avatarHtml(Object.assign({}, me, { look: draft }), 40)}<div><div class="msg-head"><span class="msg-author">${nameHtml(Object.assign({}, me, { look: draft }))}${badgesHtml(Object.assign({}, me, { look: draft }))}</span></div><div>Looking good!</div></div></div>
          <div class="popover profile-pop" style="position:relative;animation:none">${profileCardHtml(Object.assign({}, me, { look: draft }), { preview: true })}</div>
        </div>
      </div>`;
    wire();
  };
  const wire = () => {
    $$('[data-chip]', root).forEach((b) => b.onclick = () => { draft[b.dataset.chip] = b.dataset.v; draw(); });
    $$('[data-color]', root).forEach((i) => {
      i.onchange = () => { draft[i.dataset.color] = i.value; draw(); };
    });
    $$('[data-clear]', root).forEach((b) => b.onclick = () => { draft[b.dataset.clear] = null; draw(); });
    $('#cz-flair', root).onclick = (e) => emojiPicker(e.currentTarget, (em) => { draft.flair = em; draw(); }, { placement: 'right-start' });
    const flairRm = $('#cz-flair-rm', root);
    if (flairRm) flairRm.onclick = () => { draft.flair = ''; draw(); };
    $('#cz-banner', root).onclick = async (e) => {
      const btn = e.currentTarget;
      const file = await pickImage();
      if (!file) return;
      btn.disabled = true;
      btn.textContent = 'Uploading…';
      try {
        draft.banner = await uploadImageFile(file, { maxDim: 960, aspect: 3 });
        draw();
      } catch (err) {
        $('#cz-err', root).textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Upload Image';
      }
    };
    const bannerRm = $('#cz-banner-rm', root);
    if (bannerRm) bannerRm.onclick = () => { draft.banner = null; draw(); };
    $('#cz-reset', root).onclick = () => { Object.keys(draft).forEach((k) => delete draft[k]); draw(); };
    $('#cz-save', root).onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        const res = await api('PATCH', '/api/me', { look: draft });
        actions.setMe(res.user);
        toast('Looking good ✨', 'ok');
        frame.redraw();
      } catch (err) { $('#cz-err', root).textContent = err.message; }
    };
  };
  draw();
}

// ---------------------------------------------------------------------------
// Voice settings: pick devices and check the mic works
// ---------------------------------------------------------------------------
function renderVoiceSettings(root, frame) {
  root.innerHTML = `
    <h2>Voice</h2>
    <div class="field"><label class="label" for="vc-mic">Microphone</label><select class="input" id="vc-mic"></select></div>
    <div class="field" id="vc-out-wrap"><label class="label" for="vc-out">Speakers</label><select class="input" id="vc-out"></select></div>
    <h3>Mic test</h3>
    <div class="hint" style="margin:0 0 10px">Talk and watch the bar. Nobody else can hear this.</div>
    <div class="mic-test"><button class="btn secondary sm" id="vc-test">Start Test</button><div class="mic-meter"><i id="vc-level"></i></div></div>
    <div class="error" id="vc-err"></div>
    <h3>Processing</h3>
    ${toggleRow('vc-echo', 'Echo cancellation', 'Stops people hearing themselves through your speakers.', prefs.echoCancellation)}
    ${toggleRow('vc-noise', 'Noise suppression', 'Cuts background noise like fans and typing.', prefs.noiseSuppression)}
    <div class="hint" style="margin-top:12px">Changes apply the next time you join a call.</div>`;
  const micSel = $('#vc-mic', root);
  const outSel = $('#vc-out', root);
  const fill = async () => {
    let devices = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (e) {}
    const opts = (kind, current, fallback) => [`<option value="">${esc(fallback)}</option>`].concat(
      devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default')
        .map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === current ? 'selected' : ''}>${esc(d.label || `${kind === 'audioinput' ? 'Microphone' : 'Speakers'} ${i + 1}`)}</option>`)
    ).join('');
    micSel.innerHTML = opts('audioinput', prefs.micId, 'Default microphone');
    outSel.innerHTML = opts('audiooutput', prefs.speakerId, 'Default speakers');
    $('#vc-out-wrap', root).classList.toggle('hidden', !('setSinkId' in HTMLMediaElement.prototype));
  };
  fill();
  micSel.onchange = () => { prefs.micId = micSel.value; savePrefs(); };
  outSel.onchange = () => { prefs.speakerId = outSel.value; savePrefs(); };
  $('#vc-echo', root).onchange = (e) => { prefs.echoCancellation = e.target.checked; savePrefs(); };
  $('#vc-noise', root).onchange = (e) => { prefs.noiseSuppression = e.target.checked; savePrefs(); };

  let test = null;
  const stop = () => {
    if (!test) return;
    cancelAnimationFrame(test.raf);
    test.stream.getTracks().forEach((t) => t.stop());
    test.ctx.close();
    test = null;
    $('#vc-test', root).textContent = 'Start Test';
    $('#vc-level', root).style.width = '0';
  };
  $('#vc-test', root).onclick = async () => {
    if (test) { stop(); return; }
    $('#vc-err', root).textContent = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia(micConstraints(prefs.micId));
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      test = { stream, ctx, raf: 0 };
      $('#vc-test', root).textContent = 'Stop Test';
      fill();
      const loop = () => {
        if (!test || !root.isConnected || !$('#vc-level', root)) { stop(); return; }
        analyser.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((n, v) => n + v * v, 0) / buf.length);
        $('#vc-level', root).style.width = Math.min(100, rms * 500) + '%';
        test.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      $('#vc-err', root).textContent = "Couldn't open your microphone. Check the browser's permission for this site.";
    }
  };
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
      <label class="label">Invite people</label>
      <div class="hint" style="margin:0 0 8px">Only people in the group can see it. Anyone in it can invite more people later.</div>
      <div id="cg-members">${memberPickerHtml(selected)}</div>
      <div class="setting-row" style="padding-bottom:0"><div><div class="t">Password lock</div><div class="d">Ask for a password before the group's messages can be read.</div></div><label class="switch"><input type="checkbox" id="cg-lock"><span></span></label></div>
      <div id="cg-pw" class="hidden" style="margin-top:10px"><input class="input" type="password" id="cg-pw1" placeholder="Password (min 4 characters)" maxlength="60" style="margin-bottom:8px"><input class="input" type="password" id="cg-pw2" placeholder="Confirm password" maxlength="60"></div>
      <div class="error" id="cg-err"></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Back</button><button class="btn" id="cg-create">Create</button></div>`);
  const el = m.el;
  wireMemberPicker($('#cg-members', el), selected);
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
    const body = { type: 'group', name, description: $('#cg-desc', el).value, icon, memberIds: Array.from(selected) };
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
  const users = Array.from(state.users.values()).filter((u) => u.id !== state.me.id && !u.banned)
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
      : `<div class="side-empty">${users.length ? 'Nobody matches that name.' : 'Nobody else has joined yet. Ask an admin for an invite to send your friends!'}</div>`;
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
    { id: 'members', label: 'Members' },
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
    root.innerHTML = `<h2>Members</h2>
      ${isPrivate
        ? '<div class="hint" style="margin:0 0 12px">Only the people ticked here (and you) can see this group. Untick someone to remove them.</div>'
        : `<div class="perm-box"><div class="pi">🌍</div><div class="pt"><b>This group is open to everyone</b>It was made before groups became invite-only. Tick who should stay, then save to make it invite-only. This can't be undone.</div></div>`}
      <div id="gs-members" style="margin-top:12px"><label class="label">Members</label>${memberPickerHtml(selected)}</div>
      <div class="error" id="gs-err"></div>
      <button class="btn" id="gs-save" style="margin-top:8px">Save Changes</button>`;
    wireMemberPicker($('#gs-members', root), selected);
    $('#gs-save', root).onclick = async () => {
      try {
        const res = await api('PATCH', `/api/chats/${chat.id}`, { private: true, memberIds: Array.from(selected) });
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
      <div class="modal-body"><p style="margin:0">🌍 <b>${esc(chat.name)}</b> is open to everyone with an account, so there's no need to invite anyone here. Just send them the link:</p>
      <div class="secret" style="margin-top:12px">${esc(location.origin + location.pathname)}</div></div>
      <div class="modal-foot"><button class="btn" data-close>Done</button></div>`);
    return;
  }
  const selected = new Set();
  const m = openModal(`<div class="modal-head"><h2>Invite people to ${esc(chat.name)}</h2><button class="icon-btn close" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">${memberPickerHtml(selected, { exclude: chat.memberIds })}<div class="error" id="iv-err"></div></div>
    <div class="modal-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="iv-save">Invite</button></div>`);
  wireMemberPicker(m.el, selected);
  $('#iv-save', m.el).onclick = async () => {
    try {
      const res = await api('POST', `/api/chats/${chat.id}/members`, { userIds: Array.from(selected) });
      actions.upsertChat(res.chat);
      m.close();
      toast(`Invited ${selected.size} ${selected.size === 1 ? 'person' : 'people'}`, 'ok');
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
    state.users.forEach((u) => { if (u.id !== state.me.id && !u.banned) out.push({ kind: 'user', id: u.id, label: u.name, sub: 'Person', html: avatarHtml(u, 28, { status: true }) }); });
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

