'use strict';
// Routes for the file share.
//  - publicRouter (/share): the page friends open, plus its API. No panel login: access is by IP.
//  - adminRouter (/api/share/admin...): settings, trusted IPs and activity for panel admins.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const config = require('../config');
const auth = require('../auth');
const share = require('../services/fileshare');
const access = require('../util/netaccess');
const { safeResolve, relTo } = require('../util/paths');
const { streamZip } = require('../util/zip');
const { HttpError } = require('../util/misc');

const publicRouter = express.Router();

publicRouter.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.sendFile(path.join(config.root, 'public', 'share.html'));
});

publicRouter.get('/api/whoami', (req, res) => {
  const s = share.settings();
  const c = share.check(req);
  if (s.enabled && !c.canDownload) share.recordDenied(req, c.ip);
  res.json({ enabled: s.enabled && !!s.folder, title: s.title, ip: c.ip, canDownload: c.canDownload, canUpload: c.canUpload });
});

// Everything below needs at least download access.
publicRouter.use('/api', (req, _res, next) => {
  const c = share.check(req);
  if (!c.canDownload) {
    share.recordDenied(req, c.ip);
    return next(new HttpError(403, `Your IP address (${c.ip}) isn't on the allowed list. Send it to the server owner.`));
  }
  req.share = c;
  next();
});

function needUpload(req, _res, next) {
  if (!req.share.canUpload) return next(new HttpError(403, 'Uploading and changing files only works from the host PC'));
  // Block other websites in your browser from driving these endpoints (they can't set this header).
  if (req.headers['x-requested-with'] !== 'AndromedaHosting') return next(new HttpError(403, 'Missing request header'));
  next();
}

const cleanName = (name) => {
  const n = String(name || '').trim();
  if (!n || n === '.' || n === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(n)) throw new HttpError(400, `Invalid name "${n}"`);
  return n;
};

publicRouter.get('/api/list', (req, res) => {
  const base = share.root();
  const dir = safeResolve(base, req.query.path);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(404, 'Folder not found');
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && !e.name.endsWith('.uploading'))
    .map((e) => {
      let st = null;
      try {
        st = fs.statSync(path.join(dir, e.name));
      } catch {}
      return { name: e.name, dir: st ? st.isDirectory() : e.isDirectory(), size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 };
    })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
  res.json({ path: relTo(base, dir) === '.' ? '' : relTo(base, dir), entries, canUpload: req.share.canUpload });
});

publicRouter.get('/api/download', (req, res) => {
  const base = share.root();
  const target = safeResolve(base, req.query.path);
  if (!fs.existsSync(target)) throw new HttpError(404, 'Not found');
  const rel = relTo(base, target);
  const entry = { ip: req.share.ip, who: req.share.who, path: rel === '.' ? '(everything)' : rel };
  if (fs.statSync(target).isDirectory()) {
    // Folders stream as an uncompressed zip: fast, and game files barely compress anyway.
    const name = (rel === '.' ? 'share' : path.basename(target)) + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
    share.recordDownload({ ...entry, folder: true });
    return streamZip(target, res, ['**/*.uploading'], 0);
  }
  // Supports resuming (HTTP Range), which matters for multi-GB files.
  if (!req.headers.range) share.recordDownload({ ...entry, size: fs.statSync(target).size });
  res.download(target, path.basename(target), { dotfiles: 'allow' });
});

publicRouter.put('/api/upload', needUpload, async (req, res) => {
  const base = share.root();
  const dir = safeResolve(base, req.query.path);
  const parts = String(req.query.name || '').replace(/\\/g, '/').split('/').filter(Boolean).map(cleanName);
  if (!parts.length) throw new HttpError(400, 'Missing file name');
  const target = safeResolve(base, path.posix.join(relTo(base, dir), ...parts));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.uploading';
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  res.json({ ok: true });
});

publicRouter.post('/api/mkdir', express.json(), needUpload, (req, res) => {
  const base = share.root();
  fs.mkdirSync(safeResolve(base, path.posix.join(String(req.body.path || ''), cleanName(req.body.name))), { recursive: true });
  res.json({ ok: true });
});

publicRouter.post('/api/rename', express.json(), needUpload, (req, res) => {
  const base = share.root();
  const from = safeResolve(base, req.body.from);
  const to = safeResolve(base, path.posix.join(path.posix.dirname(String(req.body.from).replace(/\\/g, '/')), cleanName(req.body.name)));
  if (from === path.resolve(base)) throw new HttpError(400, "Can't rename the shared folder itself");
  if (fs.existsSync(to)) throw new HttpError(400, 'Something with that name already exists');
  fs.renameSync(from, to);
  res.json({ ok: true });
});

publicRouter.post('/api/delete', express.json(), needUpload, (req, res) => {
  const base = share.root();
  for (const p of Array.isArray(req.body.paths) ? req.body.paths : []) {
    const abs = safeResolve(base, p);
    if (abs === path.resolve(base)) throw new HttpError(400, "Can't delete the shared folder itself");
    fs.rmSync(abs, { recursive: true, force: true });
  }
  res.json({ ok: true });
});

// ---- admin (panel) ----
const adminRouter = express.Router();
adminRouter.use('/share/admin', auth.requireAuth, auth.requireAdmin);

adminRouter.get('/share/admin', (req, res) => {
  const s = share.settings();
  res.json({ ...s, you: share.check(req), denied: share.denied, downloads: share.downloads.slice(0, 50), panelPort: config.port });
});

adminRouter.put('/share/admin', (req, res) => {
  res.json(share.update(req.body || {}));
});

adminRouter.post('/share/admin/trusted', (req, res) => {
  share.addTrusted(req.body.rule, req.body.label);
  res.json({ ok: true });
});

adminRouter.delete('/share/admin/trusted', (req, res) => {
  share.removeTrusted(String(req.query.rule || ''));
  res.json({ ok: true });
});

module.exports = { publicRouter, adminRouter };
