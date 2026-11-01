// Discord-flavoured markdown -> safe HTML.
// Everything is escaped first; formatting is applied to the escaped text, and
// anything that must not be touched again (code, links, mentions) is parked in
// placeholder "slots" and restored at the end.
import { esc } from './util.js';
import { SHORTCODES } from './emoji.js';

const KEYWORDS = new Set((
  'abstract and as async await break case catch class const continue def default del delete do elif else enum export extends ' +
  'false final finally fn for from func function go if impl import in instanceof interface is lambda let loop match mod mut ' +
  'new nil none not null or package pass private protected pub public raise return self static struct super switch this throw ' +
  'throws trait true try type typeof undefined unsafe use using var void where while with yield None True False elseif end local then ' +
  'int float double char bool boolean string str long short byte unsigned signed auto extern register volatile sizeof template typename ' +
  'namespace virtual override readonly val object when fun internal echo foreach print println require include goto SELECT FROM WHERE ' +
  'INSERT INTO UPDATE DELETE CREATE TABLE AND OR NOT NULL JOIN LEFT RIGHT ON GROUP BY ORDER LIMIT VALUES SET AS'
).split(' '));

const HASH_COMMENT = /^(py|python|sh|bash|zsh|shell|console|rb|ruby|yml|yaml|toml|r|pl|perl|ps1|powershell|dockerfile|makefile|conf|ini|env|gitignore|cmake|nim|ex|exs|coffee|properties)$/;
const DASH_COMMENT = /^(sql|lua|hs|haskell|elm|ada|vhdl)$/;
const MARKUP = /^(html?|xml|svg|vue|svelte|astro|jsx|tsx|php)$/;

export function highlight(code, lang) {
  lang = (lang || '').toLowerCase();
  if (code.length > 150000) return esc(code);
  const parts = ['(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*' +
    (HASH_COMMENT.test(lang) ? '|#[^\\n]*' : '') +
    (DASH_COMMENT.test(lang) ? '|--[^\\n]*' : '') +
    (MARKUP.test(lang) ? '|<!--[\\s\\S]*?-->' : '') + ')'];
  parts.push('("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)');
  parts.push('\\b(0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b');
  parts.push('\\b([A-Za-z_][\\w]*)\\b');
  if (MARKUP.test(lang)) parts.push('(<\\/?[A-Za-z][\\w:-]*)');
  const re = new RegExp(parts.join('|'), 'g');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) out += '<span class="tk-c">' + esc(m[1]) + '</span>';
    else if (m[2] !== undefined) out += '<span class="tk-s">' + esc(m[2]) + '</span>';
    else if (m[3] !== undefined) out += '<span class="tk-n">' + esc(m[3]) + '</span>';
    else if (m[4] !== undefined) {
      const w = m[4];
      if (KEYWORDS.has(w)) out += '<span class="tk-k">' + w + '</span>';
      else if (code[re.lastIndex] === '(') out += '<span class="tk-f">' + w + '</span>';
      else if (/^[A-Z][a-z]/.test(w)) out += '<span class="tk-t">' + w + '</span>';
      else out += w;
    } else if (m[5] !== undefined) out += '<span class="tk-k">' + esc(m[5]) + '</span>';
    if (m[0] === '') re.lastIndex++;
  }
  out += esc(code.slice(last));
  return out;
}

export function codeBlockHtml(code, lang, opts = {}) {
  const lines = code.split('\n').length;
  return `<pre class="codeblock${opts.numbered ? ' numbered' : ''}"><div class="code-head"><span>${esc(lang || 'code')}${opts.numbered ? ` · ${lines} line${lines === 1 ? '' : 's'}` : ''}</span><button class="code-copy" type="button">Copy</button></div><code>${highlight(code, lang)}</code></pre>`;
}

function inline(t) {
  return t
    .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" title="Click to reveal">$1</span>')
    .replace(/\*\*\*(?!\s)(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?!\s)(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?!\s)(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*\w])\*(?![\s*])(.+?)(?<![\s*])\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?![\s_])(.+?)(?<![\s_])_(?![\w])/g, '$1<em>$2</em>')
    .replace(/~~(?!\s)(.+?)~~/g, '<s>$1</s>')
    .replace(/:([a-z0-9_+-]{2,40}):/g, (m, name) => SHORTCODES.get(name) || m);
}

export function renderMarkdown(src, ctx = {}) {
  const slots = [];
  const slot = (html) => '\u0000' + (slots.push(html) - 1) + '\u0000';
  let s = String(src || '').replace(/\u0000/g, '');

  // fenced code blocks
  const blockSlots = new Set();
  s = s.replace(/```(?:([\w+#.-]{1,20})\n)?([\s\S]*?)```/g, (m, lang, code) => {
    const mark = slot(codeBlockHtml(code.replace(/^\n+|\n+$/g, ''), lang || ''));
    blockSlots.add(mark);
    return mark;
  });
  // inline code
  s = s.replace(/`([^`\n]+)`/g, (m, code) => slot('<code class="inline">' + esc(code) + '</code>'));

  s = esc(s);

  // masked links [label](https://...)
  s = s.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) =>
    slot(`<a href="${url}" target="_blank" rel="noopener noreferrer" title="${url}">${label}</a>`));
  // bare links
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g, (m, pre, url) =>
    pre + slot(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  // mentions
  s = s.replace(/&lt;@([A-Za-z0-9_-]{1,64})&gt;/g, (m, id) => {
    const name = ctx.userName ? ctx.userName(id) : null;
    return slot(`<span class="mention${id === ctx.meId ? ' me' : ''}" data-user="${esc(id)}">@${esc(name || 'unknown')}</span>`);
  });
  s = s.replace(/(^|\s)@(everyone|here)\b/g, (m, pre, w) => pre + slot(`<span class="mention">@${w}</span>`));

  // block-level structure
  const lines = s.split('\n');
  const out = [];
  let buf = [];
  const flush = () => { if (buf.length) { out.push(inline(buf.join('\n'))); buf = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let mm;
    if (blockSlots.has(line.trim())) {
      flush();
      out.push(line.trim());
    } else if (/^&gt; ?/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^&gt; ?/.test(lines[i])) { q.push(lines[i].replace(/^&gt; ?/, '')); i++; }
      i--;
      out.push('<blockquote>' + inline(q.join('\n')) + '</blockquote>');
    } else if ((mm = /^(#{1,3}) (.+)$/.exec(line))) {
      flush();
      out.push(`<div class="md-h${mm[1].length}">${inline(mm[2])}</div>`);
    } else if ((mm = /^-# (.+)$/.exec(line))) {
      flush();
      out.push(`<div class="md-sub">${inline(mm[1])}</div>`);
    } else if (/^\s*[-*•] .+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*[-*•] .+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•] /, '')); i++; }
      i--;
      out.push('<ul>' + items.map((x) => '<li>' + inline(x) + '</li>').join('') + '</ul>');
    } else if (/^\s*\d{1,3}[.)] .+/.test(line)) {
      flush();
      const items = [];
      const startNum = parseInt(line, 10) || 1;
      while (i < lines.length && /^\s*\d{1,3}[.)] .+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d{1,3}[.)] /, '')); i++; }
      i--;
      out.push(`<ol start="${startNum}">` + items.map((x) => '<li>' + inline(x) + '</li>').join('') + '</ol>');
    } else {
      buf.push(line);
    }
  }
  flush();
  let html = out.join('');
  for (let pass = 0; pass < 3 && html.indexOf('\u0000') !== -1; pass++) {
    html = html.replace(/\u0000(\d+)\u0000/g, (m, n) => slots[+n] || '');
  }
  return html;
}

// Pull out things worth embedding below a message (YouTube, direct images).
export function extractEmbeds(text) {
  const clean = String(text || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '').replace(/\|\|[\s\S]*?\|\|/g, '');
  const urls = clean.match(/https:\/\/[^\s<>"'`]+/g) || [];
  const embeds = [];
  const seen = new Set();
  for (let url of urls) {
    url = url.replace(/[.,:;!?)\]]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    let m;
    if ((m = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url))) {
      embeds.push({ type: 'youtube', id: m[1], url });
    } else if (/^https:\/\/[^\s?#]+\.(png|jpe?g|gif|webp)(\?[^\s#]*)?$/i.test(url)) {
      embeds.push({ type: 'image', url });
    } else if ((m = /^https:\/\/(?:www\.)?tenor\.com\/view\/[\w-]+-(\d+)$/.exec(url))) {
      embeds.push({ type: 'link', url });
    }
    if (embeds.length >= 3) break;
  }
  return embeds.filter((e) => e.type !== 'link');
}

// Plain-text version (for notifications / previews): resolve mentions, strip markup.
export function plainText(src, userName) {
  return String(src || '')
    .replace(/<@([A-Za-z0-9_-]{1,64})>/g, (m, id) => '@' + ((userName && userName(id)) || 'unknown'))
    .replace(/```(?:[\w+#.-]+\n)?([\s\S]*?)```/g, '$1')
    .replace(/\|\|[\s\S]*?\|\|/g, '▒▒▒▒')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/:([a-z0-9_+-]{2,40}):/g, (m, name) => SHORTCODES.get(name) || m);
}
