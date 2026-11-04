// Where the backend lives. The frontend is normally served from GitHub Pages,
// so it talks to the self-hosted server by its full URL. When the page is
// served by the backend itself (or on localhost while developing) it just
// uses the same origin.
const CONFIGURED_SERVER = 'https://messages.zdstudios.network';

const sameOrigin =
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ||
  location.origin === CONFIGURED_SERVER;

export const SERVER_ORIGIN = sameOrigin ? location.origin : CONFIGURED_SERVER;
export const WS_URL = SERVER_ORIGIN.replace(/^http/, 'ws') + '/ws';
export const GIF_REPO_API = 'https://api.github.com/repos/lucal2889l-coder/messages-app/contents/gifs';
export const API_VERSION = 3;
export const MAX_TEXT = 4000;
export const MAX_ATTACHMENTS = 10;
