'use strict';
// HTML building for the WotLK website. Every value put into a page through html`` is escaped
// unless it was made with raw() (markup this code built itself), so database text can't inject
// markup or scripts.

class Raw {
  constructor(s) {
    this.s = String(s);
  }
  toString() {
    return this.s;
  }
}

const raw = (s) => new Raw(s);

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

// Old news posts are stored as HTML. Keep their simple formatting but rebuild every tag from a short
// list, so nothing else (scripts, event handlers, styles, iframes) survives.
const KEEP = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'span', 'div', 'center', 'font', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'small', 'hr', 'a', 'img']);
const VOID = new Set(['br', 'hr', 'img']);
// http(s) links, or relative links with no scheme at all (so no javascript:, data: ...).
const safeUrl = (u) => /^https?:\/\/[^\s"'<>]+$/i.test(u) || /^(\/(?!\/)|\.{0,2}\/?[\w-])[^\s:"'<>]*$/.test(u);

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').replace(/&amp;/g, '&').trim() : null;
}

function sanitize(input) {
  const src = String(input || '').replace(/<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  let out = '';
  let last = 0;
  const re = /<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi;
  let m;
  const text = (t) => t.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  while ((m = re.exec(src))) {
    out += text(src.slice(last, m.index));
    last = re.lastIndex;
    const closing = !!m[1];
    const name = m[2].toLowerCase();
    if (!KEEP.has(name)) continue;
    if (closing) {
      if (!VOID.has(name)) out += `</${name}>`;
      continue;
    }
    if (name === 'a') {
      const href = attr(m[0], 'href');
      out += href && safeUrl(href) ? `<a href="${esc(href)}" rel="noopener noreferrer nofollow">` : '<a>';
    } else if (name === 'img') {
      const s = attr(m[0], 'src');
      if (s && safeUrl(s)) out += `<img src="${esc(s)}" alt="">`;
    } else out += `<${name}>`;
  }
  return out + text(src.slice(last));
}

// Plain text typed on the site's admin page -> the HTML stored for a news post.
function textToHtml(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((p) => '<p>' + esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>') + '</p>')
    .join('');
}

// Old rows may hold "&amp;" etc. already; show the characters, not the codes.
function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&(lt|gt|quot|#39|apos|nbsp);/g, (_m, e) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' })[e])
    .replace(/&amp;/g, '&');
}

module.exports = { html, raw, esc, sanitize, textToHtml, decodeEntities, Raw };
