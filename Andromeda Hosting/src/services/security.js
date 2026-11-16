'use strict';
// Who is connecting to the panel, and who is trying things they shouldn't: a running record of
// sign-ins, failed sign-ins, lock-outs, probes for files that scanners look for, refused requests,
// and players joining game servers. Kept in memory, saved to <dataDir>/security.json, and summarised
// into <dataDir>/security-status.json for Andromeda Services (the Windows app) to show.
// Nothing here blocks anyone: sign-in attempts are already limited in auth.js. This is the record.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { clientIp, isLocalNetwork, isThisPc } = require('../util/netaccess');

const FILE = path.join(config.dataDir, 'security.json');
const STATUS_FILE = path.join(config.dataDir, 'security-status.json');
const MAX_EVENTS = 2000;
const MAX_CLIENTS = 500;
const HOUR = 3600e3;
const DAY = 24 * HOUR;

// What each kind of event is called and how much it matters:
//   info    ordinary (someone signed in, a player joined)
//   warn    worth a look (a wrong password, a request that wasn't allowed)
//   threat  someone trying to get in or looking for a way in
const KINDS = {
  signin: ['Signed in', 'info'],
  signout: ['Signed out', 'info'],
  joined: ['Player joined', 'info'],
  left: ['Player left', 'info'],
  'signin-failed': ['Failed sign-in', 'warn'],
  '2fa-failed': ['Wrong 2FA code', 'warn'],
  forbidden: ['Not allowed', 'warn'],
  'locked-out': ['Locked out after repeated failed sign-ins', 'threat'],
  probe: ['Probe for a known weak spot', 'threat'],
  forged: ['Forged request refused', 'threat'],
  socket: ['Live connection refused', 'threat'],
};

// Addresses nobody using the panel asks for: scanners request them on every site they find, hoping
// for a leaked secret, an admin page or a known hole.
const PROBE = /(^|\/)\.(env|git|aws|ssh|svn|hg|DS_Store|htaccess|htpasswd|vscode|idea)(\/|$|\?|\.)|wp-(login|admin|content|includes|json)|xmlrpc\.php|phpmyadmin|\/(pma|adminer|mysql|myadmin)(\/|$)|\.(php|asp|aspx|jsp|cgi)(\?|$|\/)|cgi-bin|\/vendor\/phpunit|\/actuator|\/boaform|\/HNAP1|\/owa\/|\/autodiscover|\.\.[\\/]|%2e%2e|%252e|etc\/passwd|win\.ini|\/manager\/html|\/solr\/|\/jenkins|\/telescope|\/_ignition|eval-stdin|\/shell(\?|$|\/)|\/config\.json|\/backup\.(zip|sql|tar)/i;

let events = [];
const clients = new Map(); // ip -> { ip, first, last, requests, failures, threats, country, ua, user, local }
let hours = new Map(); // start of the hour -> { requests, warns, threats }
let dirty = false;
let lastStatus = '';
let nextId = 1;

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    events = Array.isArray(saved.events) ? saved.events.slice(-MAX_EVENTS) : [];
    for (const c of saved.clients || []) if (c && c.ip) clients.set(c.ip, c);
    hours = new Map((saved.hours || []).filter((h) => Array.isArray(h) && h.length === 2));
    nextId = events.reduce((n, e) => Math.max(n, (e.id || 0) + 1), 1);
  } catch {
    /* first run, or an unreadable file: start empty */
  }
}

function hourOf(t) {
  const start = Math.floor(t / HOUR) * HOUR;
  let h = hours.get(start);
  if (!h) {
    h = { requests: 0, warns: 0, threats: 0 };
    hours.set(start, h);
    for (const k of hours.keys()) if (k < start - 2 * DAY) hours.delete(k);
  }
  return h;
}

// The address a request really comes from, and what else is known about it.
function who(req) {
  const ip = clientIp(req) || 'unknown';
  const country = isLocalNetwork(req) ? '' : String(req.headers['cf-ipcountry'] || '').toUpperCase().slice(0, 2);
  return { ip, country: /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : '', local: isThisPc(req) ? 'this PC' : isLocalNetwork(req) ? 'home network' : '', ua: String(req.headers['user-agent'] || '').slice(0, 160) };
}

function touch(w, now) {
  let c = clients.get(w.ip);
  if (!c) {
    if (clients.size >= MAX_CLIENTS) {
      // Make room by forgetting whoever was seen longest ago.
      let oldest = null;
      for (const x of clients.values()) if (!oldest || x.last < oldest.last) oldest = x;
      clients.delete(oldest.ip);
    }
    c = { ip: w.ip, first: now, last: now, requests: 0, failures: 0, threats: 0, country: w.country, ua: w.ua, user: '', local: w.local };
    clients.set(w.ip, c);
  }
  c.last = now;
  if (w.country) c.country = w.country;
  if (w.ua) c.ua = w.ua;
  c.local = w.local;
  return c;
}

// Adds an event. req may be null for things that aren't a request (a player joining a game server).
// The same thing from the same address within a minute is counted on the one entry, not listed again.
function record(kind, req, { user = '', detail = '', where = 'Andromeda Hosting', now = Date.now() } = {}) {
  if (!KINDS[kind]) return null;
  const severity = KINDS[kind][1];
  const w = req ? who(req) : { ip: '', country: '', local: '', ua: '' };
  const h = hourOf(now);
  if (severity === 'warn') h.warns++;
  if (severity === 'threat') h.threats++;
  if (req) {
    const c = touch(w, now);
    if (kind === 'signin-failed' || kind === '2fa-failed') c.failures++;
    if (severity === 'threat') c.threats++;
    if (kind === 'signin' && user) c.user = user;
  }
  dirty = true;
  const last = events.length ? events[events.length - 1] : null;
  if (last && last.kind === kind && last.ip === w.ip && last.detail === detail && last.user === user && now - last.t < 60e3) {
    last.count = (last.count || 1) + 1;
    last.t = now;
    return last;
  }
  const e = { id: nextId++, t: now, kind, severity, ip: w.ip, country: w.country, local: w.local, user: String(user || '').slice(0, 64), where, detail: String(detail || '').slice(0, 200) };
  events.push(e);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return e;
}

// Every request passes through here: counted for its address, and noted when it is a probe or was
// refused. Mounted before everything else in index.js.
function watch(req, res, next) {
  const now = Date.now();
  const w = who(req);
  touch(w, now).requests++;
  hourOf(now).requests++;
  dirty = true;
  const url = String(req.originalUrl || req.url || '');
  let probe = PROBE.test(url);
  if (!probe) {
    try {
      probe = PROBE.test(decodeURIComponent(url));
    } catch {
      probe = true; // an address that can't even be decoded is not from a browser
    }
  }
  if (probe) record('probe', req, { detail: `${req.method} ${url.slice(0, 120)}` });
  res.on('finish', () => {
    if (probe || !url.startsWith('/api/')) return;
    if (res.statusCode === 429) record('locked-out', req, { detail: 'Too many failed sign-ins: locked out for 15 minutes' });
    else if (res.statusCode === 403 && res.locals.forged) record('forged', req, { detail: `${req.method} ${url.split('?')[0].slice(0, 100)} without the panel's request header` });
    else if (res.statusCode === 403 && req.user) record('forbidden', req, { user: req.user.username, detail: `${req.method} ${url.split('?')[0].slice(0, 100)}` });
  });
  next();
}

// Players joining and leaving a game server, from two player lists a few seconds apart.
function players(serverName, before, after, now = Date.now()) {
  const name = (p) => String(p).replace(/\s*\(\d+\)$/, ''); // "Arthas (80)": the level is not part of who it is
  const was = new Set((before || []).map(name));
  const is = new Set((after || []).map(name));
  for (const p of is) if (!was.has(p)) record('joined', null, { user: p, where: serverName, detail: `${p} joined ${serverName}`, now });
  for (const p of was) if (!is.has(p)) record('left', null, { user: p, where: serverName, detail: `${p} left ${serverName}`, now });
}

// The last 24 hours in numbers, hour by hour, and how things look overall.
function summary(now = Date.now()) {
  const since = now - DAY;
  const recent = events.filter((e) => e.t >= since);
  const count = (...kinds) => recent.filter((e) => kinds.includes(e.kind)).reduce((n, e) => n + (e.count || 1), 0);
  const seen = [...clients.values()].filter((c) => c.last >= since);
  const hourly = [];
  const thisHour = Math.floor(now / HOUR) * HOUR;
  for (let t = thisHour - 23 * HOUR; t <= thisHour; t += HOUR) hourly.push({ t, ...(hours.get(t) || { requests: 0, warns: 0, threats: 0 }) });
  const threats = count('locked-out', 'probe', 'forged', 'socket');
  const failed = count('signin-failed', '2fa-failed');
  const lastHour = recent.filter((e) => e.t >= now - HOUR && e.severity === 'threat').reduce((n, e) => n + (e.count || 1), 0);
  return {
    since,
    requests: hourly.reduce((n, h) => n + h.requests, 0),
    addresses: seen.length,
    outside: seen.filter((c) => !c.local).length,
    signins: count('signin'),
    failed,
    lockouts: new Set(recent.filter((e) => e.kind === 'locked-out').map((e) => e.ip)).size, // addresses locked out, however often they kept trying
    probes: count('probe'),
    refused: count('forged', 'socket', 'forbidden'),
    threats,
    players: count('joined'),
    // quiet: nothing to see; watch: failed sign-ins or a few probes; alert: someone was locked out or is hammering away
    level: recent.some((e) => e.kind === 'locked-out') || lastHour >= 20 ? 'alert' : threats + failed > 0 ? 'watch' : 'quiet',
    hourly,
  };
}

// Who is signed in to the panel right now.
function sessions() {
  const db = require('../db');
  const names = new Map(db.data.users.map((u) => [u.id, u]));
  return db.data.sessions
    .filter((s) => names.has(s.userId))
    .map((s) => ({ user: names.get(s.userId).username, role: names.get(s.userId).role, ip: String(s.ip || '').replace(/^::ffff:/i, ''), ua: s.ua || '', since: s.createdAt, last: s.lastSeen }))
    .sort((a, b) => b.last - a.last);
}

// Everything the Security pages show. limit: how many events and addresses to include.
function overview({ limit = 200, now = Date.now() } = {}) {
  const label = (e) => ({ ...e, title: KINDS[e.kind][0] });
  const list = [...clients.values()].sort((a, b) => b.threats + b.failures - (a.threats + a.failures) || b.last - a.last);
  return {
    summary: summary(now),
    events: events.slice(-limit).reverse().map(label),
    threats: events.filter((e) => e.severity !== 'info').slice(-limit).reverse().map(label),
    addresses: list.slice(0, limit),
    sessions: sessions(),
  };
}

function save() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify({ events, clients: [...clients.values()], hours: [...hours] }));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch {
    /* disk full or locked: the record lives on in memory */
  }
}

// A smaller copy for the Windows app, rewritten when something changed.
function writeStatus() {
  try {
    const o = overview({ limit: 80 });
    const text = JSON.stringify({ ...o, events: o.events.slice(0, 80), addresses: o.addresses.slice(0, 40) });
    const same = text.replace(/"t":\d+/g, '') === lastStatus;
    lastStatus = text.replace(/"t":\d+/g, '');
    if (same && fs.existsSync(STATUS_FILE) && Date.now() - fs.statSync(STATUS_FILE).mtimeMs < 20000) return;
    fs.writeFileSync(STATUS_FILE + '.tmp', text);
    fs.renameSync(STATUS_FILE + '.tmp', STATUS_FILE);
  } catch {
    /* the app just shows what it had */
  }
}

function start() {
  load();
  setInterval(save, 30000).unref();
  setInterval(writeStatus, 5000).unref();
  writeStatus();
}

function reset() {
  events = [];
  clients.clear();
  hours = new Map();
  nextId = 1;
  dirty = true;
}

module.exports = { watch, record, players, summary, overview, sessions, start, save, reset, KINDS, PROBE, FILE, STATUS_FILE };
