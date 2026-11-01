import { SERVER_ORIGIN } from './config.js';

export const session = { key: null, token: null };

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data || null;
  }
}

// Called on 401s so the app can send people back to the right screen.
export const hooks = { onUnauthorized: null };

export async function api(method, path, body, opts = {}) {
  const headers = { 'X-Site-Key': session.key || '' };
  if (session.token) headers.Authorization = 'Bearer ' + session.token;
  if (opts.chatPass) headers['X-Chat-Pass'] = opts.chatPass;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(SERVER_ORIGIN + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new ApiError(0, "Can't reach the server — check your connection.");
  }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new ApiError(res.status, (data && data.error) || `Request failed (${res.status}).`, data);
    if (res.status === 401 && hooks.onUnauthorized && !opts.quiet) hooks.onUnauthorized(err);
    throw err;
  }
  return data;
}

export async function checkKey(key) {
  try {
    const res = await fetch(SERVER_ORIGIN + '/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    if (res.status === 429) return { ok: false, error: 'Too many attempts — wait a minute and try again.' };
    if (!res.ok) return { ok: false, error: 'Incorrect key.' };
    const data = await res.json().catch(() => ({}));
    return { ok: true, api: data.api || 1 };
  } catch (e) {
    return { ok: false, error: "Can't reach the server right now — try again in a moment.", offline: true };
  }
}

// Upload one file with progress. Returns { promise, abort }.
export function uploadFile(file, { onProgress, name } = {}) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', SERVER_ORIGIN + '/api/upload');
    xhr.setRequestHeader('X-Site-Key', session.key || '');
    xhr.setRequestHeader('Authorization', 'Bearer ' + (session.token || ''));
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(name || file.name || 'file'));
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300 && data && data.file) resolve(data.file);
      else reject(new ApiError(xhr.status, (data && data.error) || 'Upload failed.'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed — check your connection.'));
    xhr.onabort = () => reject(new ApiError(-1, 'Upload cancelled.'));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

// Turn a stored reference (server path, legacy data URL, GitHub GIF) into a
// URL that's safe to drop into src/href. Anything else becomes ''.
export function mediaUrl(ref) {
  if (typeof ref !== 'string') return '';
  if (/^\/(files|gifs)\/[^"'<>\\\s]+$/.test(ref)) return SERVER_ORIGIN + ref;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(ref)) return ref;
  if (/^https:\/\/raw\.githubusercontent\.com\/[^"'<>\\\s]+$/.test(ref)) return ref;
  return '';
}
