export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function genId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const COLORS = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#7289da'];
export function colorFor(seed) {
  let h = 0;
  const s = String(seed || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(parts[0])[0] + Array.from(parts[1])[0]).toUpperCase();
}

export function fmtSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

export const prefs24h = { value: false };

export function timeOnly(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !prefs24h.value });
}

export function msgTimestamp(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today at ' + timeOnly(ts);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday at ' + timeOnly(ts);
  return d.toLocaleDateString() + ' ' + timeOnly(ts);
}

export function fullDate(ts) {
  return new Date(ts).toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: !prefs24h.value });
}

export function dayDivider(ts) {
  return new Date(ts).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
}

export function shortTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeOnly(ts);
  if (now - d < 6 * 86400000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ago(ts) {
  if (!ts) return 'a while ago';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) {}
    ta.remove();
    return ok;
  }
}

// Resize an image file to a JPEG/PNG data blob (used for avatars + icons).
export function resizeImage(file, maxDim = 256, quality = 0.88, aspect = 1) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Crop from the centre to the wanted shape: square for avatars and icons,
      // wide for profile banners.
      const srcW = Math.min(img.naturalWidth, img.naturalHeight * aspect);
      const srcH = srcW / aspect;
      const sx = (img.naturalWidth - srcW) / 2;
      const sy = (img.naturalHeight - srcH) / 2;
      const outW = Math.round(Math.min(maxDim, srcW));
      const outH = Math.round(outW / aspect);
      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, outW, outH);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality);
    };
    img.src = url;
  });
}

export function fileKind(type, name) {
  const n = (name || '').toLowerCase();
  if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(type)) return 'image';
  if (/^video\/(mp4|webm|ogg|quicktime)$/.test(type)) return 'video';
  if (/^audio\//.test(type)) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  if (/\.(zip)$/.test(n) || type === 'application/zip' || type === 'application/x-zip-compressed') return 'zip';
  if (/\.(rar|7z|tar|gz|tgz|bz2|xz)$/.test(n)) return 'archive';
  if (isTextFile(name, type)) return 'code';
  return 'file';
}

const TEXT_EXT = /\.(txt|md|markdown|js|mjs|cjs|jsx|ts|tsx|json|jsonc|html?|css|scss|sass|less|py|rb|php|java|kt|kts|c|h|cc|cpp|hpp|cs|go|rs|swift|m|sh|bash|zsh|ps1|bat|cmd|yml|yaml|toml|ini|cfg|conf|env|xml|svg|csv|tsv|log|sql|lua|r|dart|vue|svelte|astro|gradle|properties|gitignore|dockerfile|makefile|mk|tex|rst|asm|s|pl|ex|exs|erl|hs|clj|scala|groovy|vb|fs|zig|nim|glsl|hlsl|wgsl|mcfunction|lock)$/i;
export function isTextFile(name, type) {
  const n = (name || '').toLowerCase();
  if (TEXT_EXT.test(n)) return true;
  if (/^(readme|license|makefile|dockerfile|procfile|gemfile|\.gitignore|\.env)/i.test(n.split('/').pop())) return true;
  return /^text\//.test(type || '') || /json|xml|javascript/.test(type || '');
}

export function langFromName(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function fileIcon(kind) {
  return { image: '🖼️', video: '🎞️', audio: '🎵', pdf: '📕', zip: '📦', archive: '🗜️', code: '📄', file: '📎' }[kind] || '📎';
}
