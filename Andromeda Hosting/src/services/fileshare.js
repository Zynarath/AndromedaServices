'use strict';
// File share: one folder on this PC that friends can download from (only from IPs you trust)
// and that only you can upload to (only from this PC, or optionally your home network).
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const db = require('../db');
const logger = require('../util/log');
const access = require('../util/netaccess');
const { HttpError } = require('../util/misc');

const log = logger('share');
const events = new EventEmitter();
const denied = []; // recent refused visitors, newest first
const downloads = []; // recent downloads, newest first

function settings() {
  const s = db.data.settings.fileShare || {};
  return {
    enabled: !!s.enabled,
    folder: s.folder || '',
    port: Number(s.port) || null,
    lanAccess: !!s.lanAccess,
    title: s.title || 'File share',
    trusted: Array.isArray(s.trusted) ? s.trusted : [],
  };
}

function update(patch) {
  const cur = settings();
  const next = { ...cur };
  if (patch.folder !== undefined) {
    const folder = String(patch.folder || '').trim();
    if (folder) {
      if (!path.isAbsolute(folder)) throw new HttpError(400, 'Use a full folder path, e.g. D:\\Share');
      const resolved = path.resolve(folder);
      if (path.parse(resolved).root === resolved) throw new HttpError(400, "Pick a folder, not a whole drive — that would share everything on it");
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new HttpError(400, `Folder not found: ${resolved}`);
      next.folder = resolved;
    } else next.folder = '';
  }
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  if (patch.lanAccess !== undefined) next.lanAccess = !!patch.lanAccess;
  if (patch.title !== undefined) next.title = String(patch.title).trim().slice(0, 60) || 'File share';
  if (patch.port !== undefined) {
    const p = patch.port === '' || patch.port === null ? null : Number(patch.port);
    if (p !== null && !(p >= 1024 && p <= 65535)) throw new HttpError(400, 'Port must be between 1024 and 65535');
    next.port = p;
  }
  if (next.enabled && !next.folder) throw new HttpError(400, 'Choose the folder to share first');
  db.data.settings.fileShare = next;
  db.save();
  events.emit('changed', next, cur);
  return next;
}

function addTrusted(rule, label) {
  rule = String(rule || '').trim();
  if (!access.validRule(rule)) throw new HttpError(400, `"${rule}" isn't an IP address (like 203.0.113.7) or range (like 203.0.113.0/24)`);
  const s = settings();
  const list = s.trusted.filter((t) => t.rule !== rule);
  list.push({ rule, label: String(label || '').trim().slice(0, 40), addedAt: Date.now() });
  db.data.settings.fileShare = { ...s, trusted: list };
  db.save();
  for (let i = denied.length - 1; i >= 0; i--) if (access.ipMatches(denied[i].ip, rule)) denied.splice(i, 1);
  log.info(`Trusted ${rule}${label ? ` (${label})` : ''}`);
}

function removeTrusted(rule) {
  const s = settings();
  db.data.settings.fileShare = { ...s, trusted: s.trusted.filter((t) => t.rule !== rule) };
  db.save();
}

// What this request may do.
function check(req) {
  const s = settings();
  const ip = access.clientIp(req);
  const canUpload = access.isThisPc(req) || (s.lanAccess && access.isLocalNetwork(req));
  const match = s.trusted.find((t) => access.ipMatches(ip, t.rule));
  return { ip, canUpload, canDownload: canUpload || !!match, who: canUpload ? 'you' : match ? match.label || match.rule : null };
}

function recordDenied(req, ip) {
  const existing = denied.find((d) => d.ip === ip);
  if (existing) {
    existing.at = Date.now();
    existing.count++;
  } else {
    denied.unshift({ ip, at: Date.now(), count: 1, ua: String(req.headers['user-agent'] || '').slice(0, 120) });
    if (denied.length > 30) denied.pop();
    log.warn(`Refused file share visitor ${ip}`);
  }
}

function recordDownload(entry) {
  downloads.unshift({ ...entry, at: Date.now() });
  if (downloads.length > 200) downloads.pop();
  log.info(`${entry.who} (${entry.ip}) downloaded ${entry.path}`);
}

function root() {
  const s = settings();
  if (!s.enabled || !s.folder) throw new HttpError(404, 'File sharing is turned off');
  if (!fs.existsSync(s.folder)) throw new HttpError(500, 'The shared folder no longer exists on the host PC');
  return s.folder;
}

module.exports = { settings, update, addTrusted, removeTrusted, check, recordDenied, recordDownload, root, denied, downloads, events };
