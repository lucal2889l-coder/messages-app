// Tiny ZIP reader/writer — enough to upload a whole project folder as one
// .zip and to browse/preview any uploaded .zip right in the chat.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const SKIP_DIRS = /(^|\/)(node_modules|\.git|\.svn|\.hg|__pycache__|\.next|\.cache|\.DS_Store)(\/|$)/;

// files: [{ path, file }]  ->  Blob (stored, uncompressed — fast and simple)
export async function createZip(files, { onProgress, skipJunk = true } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const list = skipJunk ? files.filter((f) => !SKIP_DIRS.test(f.path)) : files;
  for (let i = 0; i < list.length; i++) {
    const { path, file } = list[i];
    const data = new Uint8Array(await file.arrayBuffer());
    const name = enc.encode(path);
    const crc = crc32(data);
    const { time, date } = dosDateTime(new Date(file.lastModified || Date.now()));

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, 0, true);      // stored
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(lh.buffer, name, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);

    offset += 30 + name.length + data.length;
    if (onProgress) onProgress((i + 1) / list.length);
  }
  const cdSize = central.reduce((n, b) => n + (b.byteLength !== undefined ? b.byteLength : b.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, list.length, true);
  end.setUint16(10, list.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return { blob: new Blob([...chunks, ...central, end.buffer], { type: 'application/zip' }), count: list.length, skipped: files.length - list.length };
}

export function parseZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("This doesn't look like a valid .zip file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder('utf-8');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, size, compSize, method, encrypted: !!(flags & 1), localOffset, dir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export async function readZipEntry(buffer, entry) {
  const view = new DataView(buffer);
  if (entry.encrypted) throw new Error('This file is password-protected.');
  const nameLen = view.getUint16(entry.localOffset + 26, true);
  const extraLen = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const raw = new Uint8Array(buffer, start, entry.compSize);
  if (entry.method === 0) return raw.slice();
  if (entry.method === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Your browser can’t decompress this file.');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('Unsupported compression method.');
}

// Turn flat entries into a nested tree for display.
export function buildTree(entries) {
  const root = { name: '', children: new Map(), files: [] };
  entries.forEach((e) => {
    const parts = e.name.split('/').filter(Boolean);
    let node = root;
    const last = e.dir ? parts.length : parts.length - 1;
    for (let i = 0; i < last; i++) {
      if (!node.children.has(parts[i])) node.children.set(parts[i], { name: parts[i], children: new Map(), files: [] });
      node = node.children.get(parts[i]);
    }
    if (!e.dir) node.files.push(Object.assign({ base: parts[parts.length - 1] }, e));
  });
  return root;
}
