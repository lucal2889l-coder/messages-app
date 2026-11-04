// GIF catalog + the box a GIF sits in. Knowing each GIF's size up front lets the
// box take its final shape straight away, so nothing in the chat moves when the
// image arrives; a shimmer fills the box until it does.
import { esc } from './util.js';
import { mediaUrl } from './api.js';
import { SERVER_ORIGIN, GIF_REPO_API } from './config.js';

const MAX_SIZE = 300;
const FALLBACK = { w: 240, h: 180 };
const sizes = new Map(); // file name -> { w, h }
let catalog = null;

function fileName(url) {
  try { return decodeURIComponent(String(url).split('?')[0].split('/').pop()); } catch (e) { return String(url); }
}

export async function loadGifs() {
  if (catalog) return catalog;
  try {
    const res = await fetch(SERVER_ORIGIN + '/api/gifs');
    if (res.ok) {
      const data = await res.json();
      if (data.gifs && data.gifs.length) {
        data.gifs.forEach((g) => sizes.set(g.name, { w: g.w, h: g.h }));
        return (catalog = data.gifs);
      }
    }
  } catch (e) {}
  try {
    const res = await fetch(GIF_REPO_API);
    const data = await res.json();
    catalog = (Array.isArray(data) ? data : [])
      .filter((f) => f && f.type === 'file' && /\.gif$/i.test(f.name) && typeof f.download_url === 'string')
      .map((f) => ({ name: f.name, url: f.download_url }));
  } catch (e) {
    catalog = [];
  }
  return catalog;
}

function displaySize(ref) {
  const s = sizes.get(fileName(ref));
  if (!s || !s.w || !s.h) return null;
  const scale = Math.min(1, MAX_SIZE / s.w, MAX_SIZE / s.h);
  return { w: Math.max(1, Math.round(s.w * scale)), h: Math.max(1, Math.round(s.h * scale)) };
}

// `key` identifies the message, so a re-render can keep the already-loaded image.
export function gifBoxHtml(ref, key) {
  const src = mediaUrl(ref);
  if (!src) return '';
  const size = displaySize(ref);
  const { w, h } = size || FALLBACK;
  return `<span class="gif-box" data-gif-key="${esc(key)}" style="width:${w}px;aspect-ratio:${w} / ${h}"><img class="gif-img" src="${esc(src)}" alt="GIF" loading="lazy" decoding="async" data-lightbox></span>`;
}

function mark(e, cls) {
  const img = e.target;
  if (!img || img.tagName !== 'IMG') return;
  const box = img.closest('.gif-box, .gif-tile');
  if (box) box.classList.add(cls);
}
document.addEventListener('load', (e) => mark(e, 'ready'), true);
document.addEventListener('error', (e) => mark(e, 'failed'), true);
