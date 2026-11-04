// Admin mode: the "Become Admin" prompt, the admin panel, and the per-person
// controls (status, role, timeout, kick, ban, password reset).
import { $, $$, esc, ago, copyText, fmtSize } from './util.js';
import { api } from './api.js';
import { state, actions, avatarHtml, nameHtml, badgesHtml, STATUS_LABEL, SERVER_STATUS, statusOf } from './store.js';
import { toast, openModal, confirmDialog, promptDialog } from './ui.js';
import { openFullscreen } from './settings.js';

export function becomeAdmin(after) {
  const m = openModal(`
    <div class="modal-head"><h2>Become an admin</h2><p>Enter the admin code from whoever runs this server.</p><button class="icon-btn close" data-close aria-label="Close">✕</button></div>
    <form id="ba-form">
      <div class="modal-body"><div class="field"><label class="label" for="ba-code">Admin code</label><input class="input" id="ba-code" type="password" autocomplete="off" autofocus></div><div class="error" id="ba-err"></div></div>
      <div class="modal-foot"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn" type="submit">Become Admin</button></div>
    </form>`);
  $('#ba-form', m.el).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api('POST', '/api/admin/claim', { code: $('#ba-code', m.el).value });
      actions.setMe(res.user);
      m.close();
      toast("You're an admin now 🛡️", 'ok');
      if (after) after();
    } catch (err) {
      $('#ba-err', m.el).textContent = err.message;
      $('#ba-code', m.el).select();
    }
  };
}

export async function stepDown(after) {
  const ok = await confirmDialog({ title: 'Step down as admin', body: "You'll need the admin code to become one again.", confirm: 'Step Down', danger: true });
  if (!ok) return;
  try {
    const res = await api('POST', '/api/admin/resign');
    actions.setMe(res.user);
    if (after) after();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export function openAdminPanel(section) {
  const nav = [
    { header: 'Admin' },
    { id: 'overview', label: 'Overview' },
    { id: 'server', label: 'Server Status' },
    { id: 'people', label: 'People' },
    { id: 'groups', label: 'Groups' },
    { id: 'audit', label: 'Audit Log' }
  ];
  return openFullscreen({ nav, initial: section || 'overview', title: 'Admin panel', render: renderSection });
}

async function renderSection(id, root, frame) {
  root.innerHTML = '<div class="empty-state">Loading…</div>';
  let data;
  try {
    data = await api('GET', '/api/admin/overview');
  } catch (e) {
    root.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    return;
  }
  const sections = { overview: drawOverview, server: drawServer, people: drawPeople, groups: drawGroups, audit: drawAudit };
  sections[id](root, data, frame);
}

function stat(label, value) {
  return `<div class="stat"><div class="stat-v">${esc(String(value))}</div><div class="stat-l">${esc(label)}</div></div>`;
}

function drawOverview(root, d, frame) {
  const s = SERVER_STATUS[d.server.status];
  root.innerHTML = `<h2>Overview</h2>
    <button class="admin-status" id="ad-status"><span class="big">${s.icon}</span><span><b>${esc(s.label)}</b><span class="sub">${esc(d.server.message || s.hint)}</span></span><span class="go">Change ›</span></button>
    <div class="stat-grid">
      ${stat('People', d.stats.users)}${stat('Online now', d.stats.online)}${stat('Groups', d.stats.groups)}
      ${stat('Messages', d.stats.messages.toLocaleString())}${stat('Files', d.stats.files)}${stat('Storage', fmtSize(d.stats.storageBytes))}
      ${stat('Calls now', d.stats.calls)}${stat('Devices with push', d.stats.pushDevices)}
    </div>
    <h3>Setup</h3>
    <div class="check-row ${d.voice.relay ? 'ok' : ''}"><b>${d.voice.relay ? '✅' : '⚠️'} Voice relay (TURN)</b><span>${d.voice.relay ? 'Set up, so calls work on strict networks.' : 'Not set up. Calls work on most home networks, but can fail on school or office Wi-Fi. See the README.'}</span></div>
    <div class="check-row ${d.email.configured ? 'ok' : ''}"><b>${d.email.configured ? '✅' : '⚠️'} Email</b><span>${d.email.configured ? 'Set up, so sign-up codes get emailed.' : "Not set up. Sign-up codes go to the server log instead of people's inboxes. See the README."}</span>${d.email.configured ? '<button class="btn secondary xs" id="ad-mail">Send a test email</button>' : ''}</div>`;
  $('#ad-status', root).onclick = () => frame.show('server');
  const mail = $('#ad-mail', root);
  if (mail) mail.onclick = async () => {
    const to = await promptDialog({ title: 'Send a test email', label: 'Send it to', confirm: 'Send' });
    if (!to) return;
    try {
      await api('POST', '/api/admin/test-email', { to });
      toast(`Test email sent to ${to}`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };
}

function drawServer(root, d, frame) {
  const current = d.server;
  root.innerHTML = `<h2>Server Status</h2>
    ${Object.keys(SERVER_STATUS).map((k) => {
      const s = SERVER_STATUS[k];
      return `<label class="radio-card ${current.status === k ? 'selected' : ''}"><input type="radio" name="ad-st" value="${k}" ${current.status === k ? 'checked' : ''}><div><div class="t">${s.icon} ${esc(s.label)}</div><div class="d">${esc(s.hint)}</div></div></label>`;
    }).join('')}
    <div class="field" style="margin-top:14px"><label class="label" for="ad-msg">Message shown to everyone</label><textarea class="textarea" id="ad-msg" maxlength="300" placeholder="Back in 10 minutes!">${esc(current.message || '')}</textarea></div>
    <div class="setting-row"><div><div class="t">Allow new accounts</div><div class="d">Turn off to stop anyone new signing up.</div></div><label class="switch"><input type="checkbox" id="ad-signups" ${current.signupsOpen ? 'checked' : ''}><span></span></label></div>
    <div class="error" id="ad-err"></div>
    <button class="btn" id="ad-save" style="margin-top:8px">Update Status</button>`;
  $$('input[name=ad-st]', root).forEach((r) => r.onchange = () => {
    $$('.radio-card', root).forEach((c) => c.classList.toggle('selected', c.querySelector('input').checked));
  });
  $('#ad-save', root).onclick = async () => {
    try {
      await api('PATCH', '/api/admin/server', {
        status: root.querySelector('input[name=ad-st]:checked').value,
        message: $('#ad-msg', root).value,
        signupsOpen: $('#ad-signups', root).checked
      });
      toast('Server status updated', 'ok');
      frame.redraw();
    } catch (e) { $('#ad-err', root).textContent = e.message; }
  };
}

function statusLine(u) {
  if (u.bannedInfo) return `🚫 Banned${u.bannedInfo.reason ? ': ' + u.bannedInfo.reason : ''}`;
  if (u.timeoutUntil > Date.now()) return `⏳ Timed out until ${new Date(u.timeoutUntil).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`;
  return `${STATUS_LABEL[statusOf(u.id)] || 'Offline'}${u.customStatus ? ' · ' + u.customStatus : ''}`;
}

function drawPeople(root, d, frame) {
  root.innerHTML = `<h2>People <span class="count-sub">${d.users.length}</span></h2>
    <input class="input" id="ad-q" placeholder="Search people" autocomplete="off">
    <div id="ad-list" style="margin-top:12px"></div>`;
  const list = $('#ad-list', root);
  const draw = () => {
    const q = $('#ad-q', root).value.trim().toLowerCase();
    const users = d.users
      .filter((u) => !q || u.name.toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q) || (u.email || '').includes(q))
      .sort((a, b) => (b.role === 'admin') - (a.role === 'admin') || a.name.localeCompare(b.name));
    list.innerHTML = users.map((u) => `
      <div class="admin-row ${u.bannedInfo ? 'dim' : ''}" data-u="${esc(u.id)}">${avatarHtml(u, 36, { status: true })}
        <div class="ar-meta"><div class="ar-n">${nameHtml(u)}${badgesHtml(u)}</div><div class="ar-s">${esc(u.username ? '@' + u.username : 'no login yet')} · ${esc(statusLine(u))}</div></div>
        <button class="btn secondary sm">Manage</button></div>`).join('') || '<div class="side-empty">Nobody matches that.</div>';
  };
  draw();
  $('#ad-q', root).oninput = draw;
  list.onclick = (e) => {
    const row = e.target.closest('[data-u]');
    if (row) openAdminUser(row.dataset.u, () => frame.redraw());
  };
}

function drawGroups(root, d, frame) {
  const owner = (id) => (id && (state.users.get(id) || {}).name) || 'nobody';
  root.innerHTML = `<h2>Groups <span class="count-sub">${d.groups.length}</span></h2>
    <div class="hint" style="margin:0 0 12px">You can edit any group you can see. Private group messages stay private to their members.</div>
    ${d.groups.map((g) => `
      <div class="admin-row"><div class="ar-meta">
        <div class="ar-n">${g.private ? '🔐' : '🌍'} ${g.locked ? '🔒 ' : ''}${esc(g.name)}</div>
        <div class="ar-s">${g.members === null ? 'Everyone' : g.members + ' member' + (g.members === 1 ? '' : 's')} · ${g.channels} channel${g.channels === 1 ? '' : 's'} · ${g.messages.toLocaleString()} message${g.messages === 1 ? '' : 's'} · owner: ${esc(owner(g.ownerId))}</div>
      </div><button class="btn outline-danger sm" data-del="${esc(g.id)}">Delete</button></div>`).join('') || '<div class="side-empty">No groups yet.</div>'}`;
  root.onclick = async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const g = d.groups.find((x) => x.id === b.dataset.del);
    const ok = await confirmDialog({ title: `Delete '${g.name}'`, body: `This deletes the group and all ${g.messages.toLocaleString()} messages in it, for everyone. This can't be undone.`, confirm: 'Delete Group', danger: true });
    if (!ok) return;
    try {
      await api('DELETE', `/api/admin/chats/${g.id}`);
      toast('Group deleted');
      frame.redraw();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function drawAudit(root, d) {
  root.innerHTML = `<h2>Audit Log</h2>
    <div class="hint" style="margin:0 0 12px">Everything admins have done, newest first.</div>
    ${d.audit.map((a) => `<div class="audit-row"><b>${esc(a.actorName)}</b> ${esc(a.action)}${a.detail ? ` <span class="ad">${esc(a.detail)}</span>` : ''}<span class="at">${esc(ago(a.ts))}</span></div>`).join('') || '<div class="side-empty">Nothing yet.</div>'}`;
}

// ---------------------------------------------------------------------------
// One person
// ---------------------------------------------------------------------------
export async function openAdminUser(userId, onChange) {
  let data;
  try {
    data = await api('GET', '/api/admin/overview');
  } catch (e) { toast(e.message, 'error'); return; }
  let u = data.users.find((x) => x.id === userId);
  if (!u) { toast('That person no longer exists.', 'error'); return; }
  const isMe = u.id === state.me.id;
  const statuses = ['online', 'idle', 'dnd', 'invisible'];
  const timeouts = [[0, 'No timeout'], [5, '5 minutes'], [60, '1 hour'], [1440, '1 day'], [10080, '1 week']];
  const m = openModal(`
    <div class="modal-head"><h2>Manage ${esc(u.name)}</h2><p>${esc(u.username ? '@' + u.username : 'No login yet')}${u.email ? ' · ' + esc(u.email) : ''} · ${u.sessions} signed-in device${u.sessions === 1 ? '' : 's'}</p><button class="icon-btn close" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">
      <label class="label">Status</label>
      <div class="status-pick">${statuses.map((s) => `<label class="status-opt"><input type="radio" name="au-st" value="${s}" ${u.status === s ? 'checked' : ''}><span class="status-ico s-${s}"></span>${esc(STATUS_LABEL[s])}</label>`).join('')}</div>
      <div class="field" style="margin-top:12px"><label class="label" for="au-cs">Custom status</label><input class="input" id="au-cs" maxlength="80" value="${esc(u.customStatus || '')}" placeholder="What's up?"></div>
      <label class="check-line"><input type="checkbox" id="au-lock" ${u.statusLocked ? 'checked' : ''}> Lock it, so they can't change it back</label>
      <div class="field"><label class="label" for="au-name">Display name</label><input class="input" id="au-name" maxlength="32" value="${esc(u.name)}"></div>
      <div class="field"><label class="label" for="au-tag">Tag</label>
        <div class="tag-row"><input class="input" id="au-tag" maxlength="24" placeholder="Moderator, VIP…" value="${esc((u.tag && u.tag.text) || '')}"><input type="color" id="au-tag-c" value="${esc((u.tag && u.tag.color) || '#5865f2')}" title="Tag color"></div></div>
      ${isMe ? '' : `<div class="field"><label class="label" for="au-to">Timeout (can't post)</label><select class="input" id="au-to">${timeouts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>`}
      <div class="error" id="au-err"></div>
      <button class="btn" id="au-save">Save Changes</button>
      <div class="divider-sm"></div>
      <div class="au-actions">
        <button class="btn secondary sm" id="au-pw">Reset Password</button>
        ${isMe ? '' : `<button class="btn secondary sm" id="au-role">${u.role === 'admin' ? 'Remove Admin' : 'Make Admin'}</button>
        <button class="btn outline-danger sm" id="au-kick">Kick</button>
        <button class="btn outline-danger sm" id="au-ban">${u.bannedInfo ? 'Unban' : 'Ban'}</button>
        <button class="btn outline-danger sm" id="au-del">Delete Account</button>`}
      </div>
    </div>`, { className: 'wide' });
  const el = m.el;
  const done = (msg) => {
    if (msg) toast(msg, 'ok');
    m.close();
    if (onChange) onChange();
  };
  const fail = (e) => { $('#au-err', el).textContent = e.message; };
  $('#au-save', el).onclick = async () => {
    const body = {
      status: el.querySelector('input[name=au-st]:checked').value,
      customStatus: $('#au-cs', el).value,
      statusLocked: $('#au-lock', el).checked,
      name: $('#au-name', el).value,
      tag: { text: $('#au-tag', el).value, color: $('#au-tag-c', el).value }
    };
    const to = $('#au-to', el);
    if (to) {
      const mins = Number(to.value);
      if (mins || u.timeoutUntil > Date.now()) body.timeoutMinutes = mins;
    }
    try {
      await api('PATCH', `/api/admin/users/${u.id}`, body);
      done('Saved');
    } catch (e) { fail(e); }
  };
  $('#au-pw', el).onclick = async () => {
    let username;
    if (!u.username) {
      username = await promptDialog({ title: 'Give them a username', label: 'Username', confirm: 'Continue' });
      if (!username) return;
    } else {
      const ok = await confirmDialog({ title: `Reset ${u.name}'s password`, body: 'This makes a new password and signs them out everywhere.', confirm: 'Reset Password', danger: true });
      if (!ok) return;
    }
    try {
      const res = await api('POST', `/api/admin/users/${u.id}/reset-password`, { username });
      m.close();
      if (onChange) onChange();
      showNewPassword(res.username, res.password);
    } catch (e) { fail(e); }
  };
  if (isMe) return;
  $('#au-role', el).onclick = async () => {
    try {
      await api('PATCH', `/api/admin/users/${u.id}`, { role: u.role === 'admin' ? 'member' : 'admin' });
      done(u.role === 'admin' ? 'Admin removed' : `${u.name} is now an admin`);
    } catch (e) { fail(e); }
  };
  $('#au-kick', el).onclick = async () => {
    const reason = await promptDialog({ title: `Kick ${u.name}`, body: 'Signs them out everywhere. They can log back in.', label: 'Reason (they will see this)', confirm: 'Kick', danger: true, optional: true });
    if (reason === null) return;
    try {
      await api('POST', `/api/admin/users/${u.id}/kick`, { reason });
      done(`Kicked ${u.name}`);
    } catch (e) { fail(e); }
  };
  $('#au-ban', el).onclick = async () => {
    if (u.bannedInfo) {
      try {
        await api('POST', `/api/admin/users/${u.id}/unban`);
        done(`Unbanned ${u.name}`);
      } catch (e) { fail(e); }
      return;
    }
    const reason = await promptDialog({ title: `Ban ${u.name}`, body: "Signs them out and stops them logging in until you unban them.", label: 'Reason (they will see this)', confirm: 'Ban', danger: true, optional: true });
    if (reason === null) return;
    try {
      await api('POST', `/api/admin/users/${u.id}/ban`, { reason });
      done(`Banned ${u.name}`);
    } catch (e) { fail(e); }
  };
  $('#au-del', el).onclick = async () => {
    const ok = await confirmDialog({ title: `Delete ${u.name}'s account`, body: "Their login and profile are gone for good. Their messages stay, shown as Unknown. This can't be undone.", confirm: 'Delete Account', danger: true });
    if (!ok) return;
    try {
      await api('DELETE', `/api/admin/users/${u.id}`);
      done('Account deleted');
    } catch (e) { fail(e); }
  };
}

function showNewPassword(username, password) {
  const m = openModal(`
    <div class="modal-head"><h2>New password</h2><p>Send these to them. You won't see this password again.</p></div>
    <div class="modal-body">
      <label class="label">Username</label><div class="secret">${esc(username)}</div>
      <label class="label" style="margin-top:10px">Password</label><div class="secret">${esc(password)}</div>
    </div>
    <div class="modal-foot"><button class="btn secondary" id="np-copy">Copy Both</button><button class="btn" data-close>Done</button></div>`);
  $('#np-copy', m.el).onclick = async () => { if (await copyText(`Username: ${username}\nPassword: ${password}`)) toast('Copied', 'ok'); };
}
