// Small rendering helpers: escaped templates, toasts, modals, formatters.

export class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const flat = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(flat).join('') : v === false || v == null ? '' : esc(v));

// Tagged template: interpolations are escaped unless wrapped in raw() / nested html``.
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += flat(values[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) handler(e, el);
  });
}

export function toast(message, kind = 'info', ms = 4500) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

export function modal({ title, body, actions = [], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = html`
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal-head"><h3>${title}</h3><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="modal-body">${body}</div>
        ${actions.length ? html`<div class="modal-foot">${actions.map((a, i) => html`<button class="btn ${a.kind || ''}" data-action="${i}">${a.label}</button>`)}</div>` : ''}
      </div>`.s;
    const close = (val) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => e.key === 'Escape' && close(null);
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', (e) => e.target === wrap && close(null));
    $('[data-close]', wrap).onclick = () => close(null);
    $$('[data-action]', wrap).forEach((b) => {
      b.onclick = async () => {
        const a = actions[Number(b.dataset.action)];
        if (!a.onClick) return close(a.value ?? true);
        b.disabled = true;
        try {
          const r = await a.onClick(wrap);
          if (r !== false) close(r ?? true);
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          b.disabled = false;
        }
      };
    });
    document.body.appendChild(wrap);
    if (onOpen) onOpen(wrap, close);
    const first = $('input, select, textarea', wrap);
    if (first) first.focus();
  });
}

export function confirmBox(title, message, { danger = false, confirm = 'Confirm' } = {}) {
  return modal({
    title,
    body: html`<p>${message}</p>`,
    actions: [{ label: 'Cancel', value: false }, { label: confirm, kind: danger ? 'btn-danger' : 'btn-primary', value: true }],
  }).then((v) => v === true);
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i && n < 100 ? 1 : 0)} ${u[i]}`;
}

export function fmtAgo(t) {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export function fmtDate(t) {
  return t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

export const STATUS = {
  running: { label: 'Online', cls: 'ok' },
  starting: { label: 'Starting', cls: 'warn' },
  stopping: { label: 'Stopping', cls: 'warn' },
  installing: { label: 'Installing', cls: 'info' },
  crashed: { label: 'Crashed', cls: 'bad' },
  stopped: { label: 'Offline', cls: 'off' },
};

export function statusPill(status) {
  const s = STATUS[status] || STATUS.stopped;
  return html`<span class="pill pill-${s.cls}"><span class="dot"></span>${s.label}</span>`;
}

// Inline icons (Lucide-style strokes).
const ICONS = {
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  skull: '<circle cx="9" cy="11" r="1.5"/><circle cx="15" cy="11" r="1.5"/><path d="M12 2a8 8 0 0 0-5 14.3V20h10v-3.7A8 8 0 0 0 12 2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
  download: '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  memory: '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 17v3M10 17v3M14 17v3M18 17v3M6 11h2M11 11h2M16 11h2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  zip: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M10 6h1M10 9h1M10 12h1M9 15h3v3H9z"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
export function icon(name, cls = '') {
  return raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);
}

// Single-series sparkline with a hover readout. values: numbers; max: y-axis top.
export function sparkline(values, { max = 100, height = 56, fmt = (v) => v.toFixed(0) } = {}) {
  const w = 300;
  const n = values.length;
  if (n < 2) return html`<div class="spark-empty">Waiting for data…</div>`;
  const top = Math.max(max, ...values) || 1;
  const pts = values.map((v, i) => [(i / (n - 1)) * w, height - 3 - (v / top) * (height - 8)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const area = `${line}L${w},${height}L0,${height}Z`;
  const data = esc(JSON.stringify(values.map((v) => fmt(v))));
  return raw(`<div class="spark" data-points="${data}">
    <svg viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img" aria-label="Last ${n} samples">
      <path class="spark-area" d="${area}"/><path class="spark-line" d="${line}" vector-effect="non-scaling-stroke"/>
    </svg><div class="spark-tip" hidden></div><div class="spark-cursor" hidden></div></div>`);
}

export function bindSparkHover(root) {
  on(root, 'mousemove', '.spark', (e, el) => {
    const pts = JSON.parse(el.dataset.points || '[]');
    if (!pts.length) return;
    const r = el.getBoundingClientRect();
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1))));
    const tip = el.querySelector('.spark-tip');
    const cur = el.querySelector('.spark-cursor');
    const x = (i / (pts.length - 1)) * r.width;
    const secsAgo = (pts.length - 1 - i) * 3;
    tip.hidden = cur.hidden = false;
    tip.textContent = `${pts[i]} · ${secsAgo ? secsAgo + 's ago' : 'now'}`;
    tip.style.left = `${Math.min(Math.max(x, 40), r.width - 40)}px`;
    cur.style.left = `${x}px`;
  });
  root.addEventListener('mouseout', (e) => {
    const el = e.target.closest && e.target.closest('.spark');
    if (el && !el.contains(e.relatedTarget)) el.querySelectorAll('.spark-tip,.spark-cursor').forEach((x) => (x.hidden = true));
  });
}

export function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied to clipboard', 'ok', 1800), () => toast(text));
}

export function artLabel(server) {
  if (server.ark) return 'ARK';
  if (server.cod) return server.cod.short;
  if (server.wow) return 'WoW';
  return 'MC';
}

export function gameArt(server) {
  const t = server.template || '';
  if (t.startsWith('ark')) return 'ark';
  if (t.startsWith('cod')) return 'cod';
  if (t.startsWith('wow')) return 'wow';
  if (server.mc && server.mc.source === 'curseforge') return 'mc-cf';
  return 'mc';
}
