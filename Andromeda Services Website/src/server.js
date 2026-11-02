'use strict';
// The Andromeda Services marketing site: static pages from public/, a launch waitlist that saves
// to data/waitlist.json, and a waitlist view at /admin that only opens on this PC.
// No packages: Node's own http module is enough for a site this size.
const fs = require('fs');
const path = require('path');
const http = require('http');

const PUBLIC = path.join(__dirname, '..', 'public');

// The games people can tick on the waitlist form (same ids as the form in public/index.html).
const GAMES = {
  'ark-sa': 'ARK: Survival Ascended',
  'ark-se': 'ARK: Survival Evolved',
  minecraft: 'Minecraft',
  cod: 'Call of Duty',
  satisfactory: 'Satisfactory',
  sdtd: '7 Days to Die',
  valheim: 'Valheim',
  rust: 'Rust',
  wow: 'WoW: Wrath of the Lich King',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "style-src-attr 'unsafe-inline'", // per-card colours and meter widths; attribute styles can't run script
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "script-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

const EMAIL_RE = /^[^\s@<>"']{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const MAX_BODY = 8 * 1024;
const RATE = { windowMs: 10 * 60 * 1000, max: 5 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

// Same rule as the panel: on this PC, and not relayed by a proxy or tunnel running on this PC.
function isThisPc(req) {
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const loopback = ip === '127.0.0.1' || ip === '::1';
  const relayed = ['x-forwarded-for', 'forwarded', 'cf-connecting-ip', 'cf-ray', 'x-real-ip'].some((h) => req.headers[h]);
  return loopback && !relayed;
}

function createSite({ dataDir }) {
  const file = path.join(dataDir, 'waitlist.json');
  const hits = new Map(); // ip -> timestamps of recent sign-ups

  function readList() {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  function writeList(list) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, file);
  }

  function limited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
    if (recent.length >= RATE.max) return true;
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.clear(); // never grows without bound
    return false;
  }

  function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
    res.end(body);
  }
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const tooLarge = () => Object.assign(new Error('too large'), { status: 413 });
      if (Number(req.headers['content-length']) > MAX_BODY) return reject(tooLarge());
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          req.pause(); // stop reading; the connection is closed after the answer is sent
          reject(tooLarge());
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function joinWaitlist(req, res) {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Send JSON.' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      if (err.status === 413) {
        res.setHeader('Connection', 'close');
        res.on('finish', () => req.destroy());
        return json(res, 413, { error: 'That is too long.' });
      }
      return json(res, 400, { error: 'Something went wrong. Try again.' });
    }
    if (!body || typeof body !== 'object') return json(res, 400, { error: 'Something went wrong. Try again.' });
    // Bots fill in the hidden "website" field; people never see it. Pretend it worked.
    if (body.website) return json(res, 200, { ok: true });
    const email = clean(body.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Enter a valid email address.', field: 'email' });
    const ip = String(req.socket.remoteAddress || '');
    if (limited(ip)) return json(res, 429, { error: 'Too many sign-ups from here. Try again in a few minutes.' });
    const entry = {
      email,
      name: clean(body.name, 80),
      games: [...new Set(Array.isArray(body.games) ? body.games.filter((g) => Object.hasOwn(GAMES, g)) : [])],
      players: clean(body.players, 20),
      note: clean(body.note, 1000),
      at: new Date().toISOString(),
    };
    const list = readList();
    const i = list.findIndex((e) => e.email === email);
    if (i >= 0) list[i] = { ...entry, first: list[i].first || list[i].at };
    else list.push(entry);
    writeList(list);
    return json(res, 200, { ok: true, again: i >= 0 });
  }

  function adminPage(res) {
    const list = readList().slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const tally = Object.entries(GAMES)
      .map(([id, name]) => [name, list.filter((e) => (e.games || []).includes(id)).length])
      .filter(([, n]) => n)
      .sort((a, b) => b[1] - a[1]);
    const rows = list
      .map((e) => `<tr><td>${esc(e.email)}</td><td>${esc(e.name)}</td><td>${esc((e.games || []).map((g) => GAMES[g] || g).join(', '))}</td><td>${esc(e.players)}</td><td>${esc(e.note)}</td><td class="nowrap">${esc(String(e.at).slice(0, 16).replace('T', ' '))}</td></tr>`)
      .join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Waitlist · Andromeda</title><link rel="icon" href="/img/andromeda-services-icon.svg"><link rel="stylesheet" href="/css/site.css"></head>
<body class="admin"><main class="wrap">
<a class="brand" href="/"><img src="/img/andromeda-services-logo.svg" alt="Andromeda Services" width="180" height="40"></a>
<h1>Waitlist <span class="muted">${list.length}</span></h1>
<p class="muted">Only this PC can open this page. Saved in <code>${esc(file)}</code>. <a href="/admin/waitlist.csv">Download as CSV</a></p>
${tally.length ? `<ul class="tally">${tally.map(([n, c]) => `<li><b>${c}</b> ${esc(n)}</li>`).join('')}</ul>` : ''}
${list.length ? `<div class="table-wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Games</th><th>Players</th><th>Note</th><th>Joined (UTC)</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>No one has joined yet.</p>'}
</main></body></html>`;
    send(res, 200, html, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
  }

  function adminCsv(res) {
    // A leading = + - @ would run as a formula in Excel, so those cells get a ' in front.
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [['email', 'name', 'games', 'players', 'note', 'joined'].join(',')];
    for (const e of readList()) lines.push([e.email, e.name, (e.games || []).map((g) => GAMES[g] || g).join('; '), e.players, e.note, e.at].map(cell).join(','));
    send(res, 200, '﻿' + lines.join('\r\n') + '\r\n', 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="andromeda-waitlist.csv"', 'Cache-Control': 'no-store' });
  }

  function serveStatic(req, res, pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (rel.includes('\0')) return send(res, 400, 'Bad request');
    if (rel.endsWith('/')) rel += 'index.html';
    const full = path.join(PUBLIC, path.normalize(rel));
    if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) return notFound(res);
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) return notFound(res);
      const type = TYPES[path.extname(full).toLowerCase()];
      if (!type) return notFound(res);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(full).pipe(res);
    });
  }

  function notFound(res) {
    const page = path.join(PUBLIC, '404.html');
    fs.readFile(page, (err, buf) => send(res, 404, err ? 'Not found' : buf, err ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8'));
  }

  return http.createServer(async (req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return send(res, 400, 'Bad request');
    }
    try {
      if (pathname === '/api/waitlist') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
        return await joinWaitlist(req, res);
      }
      if (pathname === '/admin' || pathname.startsWith('/admin/')) {
        if (!isThisPc(req)) return notFound(res);
        if (pathname === '/admin' || pathname === '/admin/') return adminPage(res);
        if (pathname === '/admin/waitlist.csv') return adminCsv(res);
        return notFound(res);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', undefined, { Allow: 'GET, HEAD' });
      return serveStatic(req, res, pathname);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong on our side.' });
    }
  });
}

module.exports = { createSite, GAMES, isThisPc };
