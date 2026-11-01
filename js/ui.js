// Reusable UI pieces: toasts, modals, popovers, menus, tooltips, pickers,
// lightbox, profile cards, code + zip viewers.
import { $, $$, esc, fmtSize, copyText, ago, langFromName, isTextFile, fileKind, fileIcon } from './util.js';
import { CATEGORIES, CATEGORY_ICONS, searchEmoji, EMOJI_LIST } from './emoji.js';
import { mediaUrl } from './api.js';
import { SERVER_ORIGIN, GIF_REPO_API } from './config.js';
import { state, prefs, savePrefs, actions, avatarHtml, statusOf, STATUS_LABEL, bannerColor, getUser, chatName } from './store.js';
import { renderMarkdown, codeBlockHtml } from './markdown.js';
import { parseZip, readZipEntry, buildTree } from './zip.js';

// ---------------- Toasts ----------------
export function toast(msg, type = '') {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 3600);
  setTimeout(() => el.remove(), 4000);
}

// ---------------- Layer stack (Esc closes the top-most thing) ----------------
const stack = [];
export function closeTop() {
  const top = stack[stack.length - 1];
  if (top) { top.close(); return true; }
  return false;
}
export function hasOpenLayer() { return stack.length > 0; }
export function closeAllPopovers() {
  stack.filter((s) => s.kind === 'popover').forEach((s) => s.close());
}

// ---------------- Modals ----------------
export function openModal(html, { className = '', onClose, dismissable = true } = {}) {
  const root = $('#modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true">${html}</div>`;
  root.appendChild(backdrop);
  const modal = backdrop.firstElementChild;
  const entry = {
    kind: 'modal',
    el: modal,
    close() {
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      backdrop.remove();
      if (onClose) onClose();
    }
  };
  stack.push(entry);
  if (dismissable) {
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) entry.close(); });
  }
  modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => entry.close()));
  // Focus right away so fast typists don't lose keystrokes to whatever had focus.
  const f = modal.querySelector('[autofocus]') || modal.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea');
  if (f) f.focus();
  return entry;
}

export function confirmDialog({ title, body = '', html = '', confirm = 'Confirm', danger = false, cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal(`
      <div class="modal-head"><h2>${esc(title)}</h2></div>
      <div class="modal-body">${body ? `<p style="margin:0;color:var(--text)">${esc(body)}</p>` : ''}${html}</div>
      <div class="modal-foot">
        <button class="btn ghost" data-act="no">${esc(cancel)}</button>
        <button class="btn ${danger ? 'danger' : ''}" data-act="yes" autofocus>${esc(confirm)}</button>
      </div>`, { onClose: () => { if (!done) resolve(false); } });
    m.el.querySelector('[data-act=no]').onclick = () => { done = true; m.close(); resolve(false); };
    m.el.querySelector('[data-act=yes]').onclick = () => { done = true; m.close(); resolve(true); };
    setTimeout(() => m.el.querySelector('[data-act=yes]').focus(), 40);
  });
}

// ---------------- Popovers / menus ----------------
export function openPopover(anchor, html, { className = '', placement = 'bottom-start', onClose, offset = 6 } = {}) {
  closeAllPopovers();
  const layer = $('#layer');
  const el = document.createElement('div');
  el.className = 'popover ' + className;
  el.innerHTML = html;
  el.style.visibility = 'hidden';
  layer.appendChild(el);
  position(el, anchor, placement, offset);
  el.style.visibility = '';
  const onDown = (e) => {
    if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) entry.close();
  };
  const onResize = () => entry.close();
  const entry = {
    kind: 'popover',
    el,
    close() {
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('resize', onResize);
      el.remove();
      if (onClose) onClose();
    },
    reposition() { position(el, anchor, placement, offset); }
  };
  stack.push(entry);
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', onResize);
  }, 0);
  return entry;
}

function position(el, anchor, placement, offset) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = anchor instanceof Element ? anchor.getBoundingClientRect()
    : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x;
  let y;
  const [side, align] = placement.split('-');
  if (side === 'bottom' || side === 'top') {
    x = align === 'end' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left;
    y = side === 'bottom' ? r.bottom + offset : r.top - h - offset;
    if (side === 'bottom' && y + h > vh - 8 && r.top - h - offset > 8) y = r.top - h - offset;
    if (side === 'top' && y < 8 && r.bottom + offset + h < vh - 8) y = r.bottom + offset;
  } else {
    y = align === 'end' ? r.bottom - h : align === 'center' ? r.top + r.height / 2 - h / 2 : r.top;
    x = side === 'right' ? r.right + offset : r.left - w - offset;
    if (side === 'right' && x + w > vw - 8) x = r.left - w - offset;
    if (side === 'left' && x < 8) x = r.right + offset;
  }
  x = Math.max(8, Math.min(x, vw - w - 8));
  y = Math.max(8, Math.min(y, vh - h - 8));
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

// items: [{ label, icon, sub, danger, onClick, sep, quick:[emoji] }]
export function openMenu(anchor, items, opts = {}) {
  const html = items.map((it, i) => {
    if (it.sep) return '<div class="menu-sep"></div>';
    if (it.quick) return `<div class="menu-quick">${it.quick.map((q) => `<button data-q="${esc(q)}" title="React with ${esc(q)}">${q}</button>`).join('')}</div>`;
    return `<button class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}"><span>${esc(it.label)}${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</span>${it.icon ? `<span class="mi">${it.icon}</span>` : ''}</button>`;
  }).join('');
  const pop = openPopover(anchor, `<div class="menu">${html}</div>`, Object.assign({ placement: 'bottom-start' }, opts));
  pop.el.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]');
    if (q) {
      const it = items.find((x) => x.quick);
      pop.close();
      if (it && it.onQuick) it.onQuick(q.dataset.q);
      return;
    }
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const it = items[+b.dataset.i];
    pop.close();
    if (it && it.onClick) it.onClick(e);
  });
  return pop;
}

// ---------------- Tooltips (any element with data-tip) ----------------
let tipEl = null;
let tipFor = null;
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (t === tipFor) return;
  if (tipEl) { tipEl.remove(); tipEl = null; }
  tipFor = t;
  if (!t || !t.dataset.tip) return;
  tipEl = document.createElement('div');
  tipEl.className = 'tooltip';
  tipEl.textContent = t.dataset.tip;
  document.body.appendChild(tipEl);
  position(tipEl, t, t.dataset.tipPos || 'top-center', 8);
});
document.addEventListener('mousedown', () => { if (tipEl) { tipEl.remove(); tipEl = null; tipFor = null; } }, true);

// ---------------- Lightbox ----------------
export function lightbox(src, { name, href, video } = {}) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `
    <button class="lb-close" aria-label="Close">✕</button>
    ${video ? `<video src="${esc(src)}" controls autoplay></video>` : `<img src="${esc(src)}" alt="">`}
    <div class="lb-bar">${name ? `<span>${esc(name)}</span>` : ''}<a href="${esc(href || src)}" target="_blank" rel="noopener">Open original ↗</a></div>`;
  document.body.appendChild(el);
  const entry = { kind: 'modal', close() { const i = stack.indexOf(entry); if (i !== -1) stack.splice(i, 1); el.remove(); } };
  stack.push(entry);
  el.addEventListener('click', (e) => { if (e.target === el || e.target.classList.contains('lb-close') || e.target.tagName === 'IMG') entry.close(); });
}

// ---------------- Emoji picker ----------------
export function rememberEmoji(ch) {
  prefs.recentEmoji = [ch].concat((prefs.recentEmoji || []).filter((x) => x !== ch)).slice(0, 24);
  savePrefs();
}

export function emojiPicker(anchor, onPick, { placement = 'top-end', keepOpen = false } = {}) {
  const cats = Object.keys(CATEGORIES);
  const recent = (prefs.recentEmoji || []).map((c) => EMOJI_LIST.find((e) => e.char === c) || { char: c, name: '' });
  const allCats = (recent.length ? ['Recent'] : []).concat(cats);
  const section = (cat, list) => `<div class="ep-cat-title" data-cat="${esc(cat)}">${esc(cat)}</div><div class="ep-row">${list.map((e) => `<button data-e="${esc(e.char)}" data-n="${esc(e.name)}">${e.char}</button>`).join('')}</div>`;
  const fullGrid = () => allCats.map((c) => section(c === 'Recent' ? 'Frequently used' : c, c === 'Recent' ? recent : CATEGORIES[c])).join('');
  const pop = openPopover(anchor, `
    <div class="ep-top"><input class="input" placeholder="Find the perfect emoji" autocomplete="off"></div>
    <div class="ep-main">
      <div class="ep-cats">${allCats.map((c) => `<button data-c="${esc(c)}" title="${esc(c)}">${CATEGORY_ICONS[c]}</button>`).join('')}</div>
      <div class="ep-grid scroller thin">${fullGrid()}</div>
    </div>
    <div class="ep-foot"><span class="big">😀</span><span class="nm">Pick an emoji</span></div>`, { className: 'emoji-picker', placement });
  const el = pop.el;
  const input = el.querySelector('input');
  const grid = el.querySelector('.ep-grid');
  setTimeout(() => input.focus(), 20);
  input.addEventListener('input', () => {
    const q = input.value.trim();
    grid.innerHTML = q ? (searchEmoji(q, 120).length ? section('Results', searchEmoji(q, 120)) : '<div class="empty-state" style="padding:30px 0">No emoji found 😢</div>') : fullGrid();
    grid.scrollTop = 0;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = grid.querySelector('[data-e]');
      if (first) first.click();
    }
  });
  el.querySelector('.ep-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    input.value = '';
    grid.innerHTML = fullGrid();
    const title = b.dataset.c === 'Recent' ? 'Frequently used' : b.dataset.c;
    const t = grid.querySelector(`[data-cat="${CSS.escape(title)}"]`);
    if (t) grid.scrollTop = t.offsetTop - grid.offsetTop;
  });
  grid.addEventListener('mouseover', (e) => {
    const b = e.target.closest('[data-e]');
    if (!b) return;
    el.querySelector('.ep-foot .big').textContent = b.dataset.e;
    el.querySelector('.ep-foot .nm').textContent = b.dataset.n ? ':' + b.dataset.n + ':' : '';
  });
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-e]');
    if (!b) return;
    rememberEmoji(b.dataset.e);
    onPick(b.dataset.e);
    if (!(keepOpen || e.shiftKey)) pop.close();
  });
  return pop;
}

// ---------------- GIF picker ----------------
let gifCache = null;
async function loadGifs() {
  if (gifCache) return gifCache;
  try {
    const res = await fetch(SERVER_ORIGIN + '/api/gifs');
    if (res.ok) {
      const data = await res.json();
      if (data.gifs && data.gifs.length) return (gifCache = data.gifs);
    }
  } catch (e) {}
  try {
    const res = await fetch(GIF_REPO_API);
    const data = await res.json();
    gifCache = (Array.isArray(data) ? data : [])
      .filter((f) => f && f.type === 'file' && /\.gif$/i.test(f.name) && typeof f.download_url === 'string')
      .map((f) => ({ name: f.name, url: f.download_url }));
  } catch (e) {
    gifCache = [];
  }
  return gifCache;
}

export function gifPicker(anchor, onPick) {
  const pop = openPopover(anchor, `
    <div class="gp-top"><input class="input" placeholder="Search GIFs" autocomplete="off"></div>
    <div class="gif-grid scroller thin"><div class="empty">Loading GIFs…</div></div>`, { className: 'gif-picker', placement: 'top-end' });
  const grid = pop.el.querySelector('.gif-grid');
  const input = pop.el.querySelector('input');
  let all = [];
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const list = all.filter((g) => !q || g.name.toLowerCase().includes(q));
    grid.innerHTML = list.length
      ? list.map((g) => `<button data-url="${esc(g.url)}" title="${esc(g.name.replace(/\.gif$/i, ''))}"><img src="${esc(mediaUrl(g.url))}" loading="lazy" alt=""></button>`).join('')
      : `<div class="empty">${all.length ? 'No GIFs match that.' : "No GIFs yet — add .gif files to the repo's /gifs folder."}</div>`;
  };
  loadGifs().then((g) => { all = g; if (pop.el.isConnected) render(); });
  input.addEventListener('input', render);
  setTimeout(() => input.focus(), 20);
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-url]');
    if (!b) return;
    pop.close();
    onPick(b.dataset.url);
  });
  return pop;
}

// ---------------- Profile popout ----------------
export function profileCardHtml(user, { wide = false } = {}) {
  const st = statusOf(user.id);
  const isMe = state.me && user.id === state.me.id;
  const mutual = !isMe ? Array.from(state.chats.values()).filter((c) => c.type === 'group' && Array.isArray(c.memberIds) && c.memberIds.includes(user.id)) : [];
  return `
    <div class="profile-banner" style="background:${esc(bannerColor(user))}">
      <div class="pav">${avatarHtml(user, wide ? 80 : 80, { status: true })}</div>
    </div>
    <div class="profile-body">
      <div class="profile-name">${esc(user.name)}</div>
      <div class="profile-sub">${esc(st === 'offline' && user.lastSeen ? 'Last seen ' + ago(user.lastSeen) : STATUS_LABEL[st] || 'Offline')}</div>
      ${user.customStatus ? `<div style="margin-top:8px;color:var(--text);font-size:14px">${esc(user.customStatus)}</div>` : ''}
      ${user.bio ? `<div class="profile-card"><h4>About me</h4><div class="t">${renderMarkdown(user.bio, { userName: (id) => (getUser(id) || {}).name })}</div></div>` : ''}
      <div class="profile-card"><h4>Member since</h4><div class="t">${user.createdAt ? new Date(user.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : 'The early days'}</div></div>
      ${mutual.length ? `<div class="profile-card"><h4>Private groups together — ${mutual.length}</h4><div class="t">${mutual.map((c) => esc(chatName(c))).join(', ')}</div></div>` : ''}
      <div class="pp-actions">
        ${isMe ? '<button class="btn sm block" data-pp="edit">Edit profile</button>' : `<button class="btn sm block" data-pp="dm">💬 Send message</button>`}
      </div>
    </div>`;
}

export function profilePopout(anchor, userId, placement = 'right-start') {
  const user = getUser(userId);
  if (!user) return null;
  const pop = openPopover(anchor, profileCardHtml(user), { className: 'profile-pop', placement, offset: 10 });
  pop.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pp]');
    if (!b) return;
    pop.close();
    if (b.dataset.pp === 'dm') actions.openDM(userId);
    if (b.dataset.pp === 'edit') actions.openSettings('profile');
  });
  return pop;
}

// ---------------- Code + zip viewers ----------------
async function fetchBuffer(url, maxBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download the file.');
  const len = Number(res.headers.get('Content-Length'));
  if (maxBytes && len && len > maxBytes) throw new Error(`That file is too big to preview (${fmtSize(len)}).`);
  return res.arrayBuffer();
}

function decodeText(bytes) {
  // Heuristic binary check: lots of NUL bytes → not text.
  const sample = bytes.subarray(0, Math.min(bytes.length, 4000));
  let nul = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) nul++;
  if (nul > 2) return null;
  return new TextDecoder('utf-8').decode(bytes);
}

export async function openCodeViewer(att) {
  const url = mediaUrl(att.url);
  const m = openModal(`
    <div class="modal-head"><h2>📄 ${esc(att.name)}</h2><p>${esc(fmtSize(att.size))}</p><button class="icon-btn close" data-close aria-label="Close">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column"><div class="viewer"><div class="pane"><div class="empty-state">Loading…</div></div></div></div>
    <div class="modal-foot"><button class="btn secondary" data-act="copy">Copy</button><a class="btn" href="${esc(url)}" download="${esc(att.name)}">Download</a></div>`, { className: 'xwide' });
  const pane = m.el.querySelector('.pane');
  let text = '';
  try {
    const buf = await fetchBuffer(url, 2 * 1024 * 1024);
    text = decodeText(new Uint8Array(buf));
    if (text === null) throw new Error("This file doesn't look like text.");
    pane.innerHTML = codeBlockHtml(text, langFromName(att.name), { numbered: true });
  } catch (e) {
    pane.innerHTML = `<div class="empty-state"><div class="art">😕</div>${esc(e.message)}</div>`;
  }
  m.el.querySelector('[data-act=copy]').onclick = async () => { if (text && await copyText(text)) toast('Copied to clipboard', 'ok'); };
}

export async function openZipViewer(att) {
  const url = mediaUrl(att.url);
  const m = openModal(`
    <div class="modal-head"><h2>📦 ${esc(att.name)}</h2><p class="viewer-stats">Opening…</p><button class="icon-btn close" data-close aria-label="Close">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;padding-bottom:0"><div class="viewer"><div class="tree scroller thin"></div><div class="pane"><div class="empty-state"><div class="art">📦</div>Pick a file on the left to preview it.</div></div></div></div>
    <div class="modal-foot"><a class="btn" href="${esc(url)}" download="${esc(att.name)}">Download .zip</a></div>`, { className: 'xwide' });
  const tree = m.el.querySelector('.tree');
  const pane = m.el.querySelector('.pane');
  const stats = m.el.querySelector('.viewer-stats');
  let buf;
  let entries;
  try {
    buf = await fetchBuffer(url, 200 * 1024 * 1024);
    entries = parseZip(buf);
  } catch (e) {
    tree.innerHTML = '';
    pane.innerHTML = `<div class="empty-state"><div class="art">😕</div>${esc(e.message)}</div>`;
    stats.textContent = '';
    return;
  }
  const files = entries.filter((e) => !e.dir);
  const total = files.reduce((n, f) => n + f.size, 0);
  stats.textContent = `${files.length} file${files.length === 1 ? '' : 's'} · ${fmtSize(total)} uncompressed`;
  const root = buildTree(entries);
  const byName = new Map(files.map((f) => [f.name, f]));
  const renderNode = (node, depth) => {
    const dirs = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
    const fl = node.files.slice().sort((a, b) => a.base.localeCompare(b.base));
    return dirs.map((d) => `<details ${depth < 2 ? 'open' : ''}><summary>📁 ${esc(d.name)}</summary><div class="kids">${renderNode(d, depth + 1)}</div></details>`).join('') +
      fl.map((f) => `<div class="tf" data-f="${esc(f.name)}" title="${esc(f.name)}"><span>${fileIcon(fileKind('', f.base))} ${esc(f.base)}</span><span class="sz">${fmtSize(f.size)}</span></div>`).join('');
  };
  tree.innerHTML = renderNode(root, 0) || '<div class="empty-state">This zip is empty.</div>';
  let objectUrl = null;
  tree.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-f]');
    if (!row) return;
    $$('.tf.sel', tree).forEach((x) => x.classList.remove('sel'));
    row.classList.add('sel');
    const entry = byName.get(row.dataset.f);
    pane.innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      if (entry.size > 5 * 1024 * 1024) throw new Error(`Too big to preview (${fmtSize(entry.size)}). Download the zip to open it.`);
      const bytes = await readZipEntry(buf, entry);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const kind = fileKind('', entry.name);
      const ext = langFromName(entry.name);
      const dl = () => { objectUrl = URL.createObjectURL(new Blob([bytes])); return objectUrl; };
      if (/^(png|jpe?g|gif|webp|bmp|ico|avif)$/.test(ext)) {
        pane.innerHTML = `<img src="${dl()}" alt="">`;
      } else if (isTextFile(entry.name) || kind === 'code' || entry.size < 200000) {
        const text = decodeText(bytes);
        if (text === null) throw new Error('No preview for this kind of file.');
        pane.innerHTML = codeBlockHtml(text, ext, { numbered: true });
      } else {
        throw new Error('No preview for this kind of file.');
      }
    } catch (err) {
      pane.innerHTML = `<div class="empty-state"><div class="art">🗂️</div>${esc(err.message)}</div>`;
    }
  });
}

// ---------------- Member / user picker (used in group create + settings) ----------------
export function memberPickerHtml(selected, { excludeMe = true } = {}) {
  const users = Array.from(state.users.values())
    .filter((u) => !(excludeMe && state.me && u.id === state.me.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return `<input class="input" data-picker-search placeholder="Search people" autocomplete="off">
    <div class="picker-list scroller thin">${users.map((u) => `
      <label class="pick-row" data-name="${esc(u.name.toLowerCase())}">
        ${avatarHtml(u, 32, { status: true })}<span class="n">${esc(u.name)}</span>
        <input type="checkbox" value="${esc(u.id)}" ${selected.has(u.id) ? 'checked' : ''}>
      </label>`).join('') || '<div class="side-empty">Nobody else has joined yet.</div>'}</div>`;
}

export function wireMemberPicker(root, selected) {
  const search = root.querySelector('[data-picker-search]');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      $$('.pick-row', root).forEach((r) => { r.style.display = !q || r.dataset.name.includes(q) ? '' : 'none'; });
    });
  }
  $$('.pick-row input', root).forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
  }));
}

// Spoiler + code copy (anywhere in the document)
document.addEventListener('click', async (e) => {
  const sp = e.target.closest('.spoiler');
  if (sp && !sp.classList.contains('revealed')) { sp.classList.add('revealed'); e.stopPropagation(); return; }
  const cc = e.target.closest('.code-copy');
  if (cc) {
    const code = cc.closest('.codeblock').querySelector('code');
    if (await copyText(code.textContent)) {
      cc.textContent = 'Copied!';
      setTimeout(() => { cc.textContent = 'Copy'; }, 1400);
    }
  }
});

// Register a custom full-screen layer so Esc / closeTop() can close it.
export function registerLayer(closeFn) {
  const entry = {
    kind: 'modal',
    close() {
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      closeFn();
    }
  };
  stack.push(entry);
  return entry;
}
