'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const auth = require('../auth');
const manager = require('../manager/manager');
const { safeResolve, relTo, cleanName, receiveUpload, listFolder, blockedForNonAdmin } = require('../util/paths');
const { extractZip, streamZip } = require('../util/zip');
const { HttpError } = require('../util/misc');

const router = express.Router();
const MAX_EDIT = 5 * 1024 * 1024;

function ctx(req) {
  const inst = manager.get(req.params.id);
  if (!auth.can(req.user, inst.server, 'files')) throw new HttpError(403, "You don't have file access on this server");
  fs.mkdirSync(inst.server.dir, { recursive: true });
  return { inst, root: inst.server.dir, admin: req.user.role === 'admin' };
}

function guardWrite(abs, admin) {
  if (admin) return;
  const name = path.basename(abs);
  if (blockedForNonAdmin(name)) throw new HttpError(403, `Only an admin can create or change "${name}" (it could run code on the host).`);
}

router.use('/servers/:id/files', auth.requireAuth);

router.get('/servers/:id/files', (req, res) => {
  const { root } = ctx(req);
  const dir = safeResolve(root, req.query.path);
  res.json({ path: relTo(root, dir), entries: listFolder(dir) });
});

router.get('/servers/:id/files/read', (req, res) => {
  const { root } = ctx(req);
  const file = safeResolve(root, req.query.path);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'File not found');
  if (fs.statSync(file).size > MAX_EDIT) throw new HttpError(400, 'File is too large to edit in the browser — download it instead');
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8000).includes(0)) throw new HttpError(400, 'This looks like a binary file — download it instead');
  res.json({ content: buf.toString('utf8') });
});

router.put('/servers/:id/files/write', (req, res) => {
  const { inst, root, admin } = ctx(req);
  const file = safeResolve(root, req.query.path);
  guardWrite(file, admin);
  if (typeof req.body.content !== 'string') throw new HttpError(400, 'Missing content');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, req.body.content);
  inst.appendConsole(`[files] ${req.user.username} edited ${relTo(root, file)}`);
  res.json({ ok: true });
});

router.post('/servers/:id/files/mkdir', (req, res) => {
  const { root } = ctx(req);
  const dir = safeResolve(root, path.posix.join(String(req.body.path || ''), cleanName(req.body.name)));
  fs.mkdirSync(dir, { recursive: true });
  res.json({ ok: true });
});

router.post('/servers/:id/files/rename', (req, res) => {
  const { root, admin } = ctx(req);
  const from = safeResolve(root, req.body.from);
  const to = safeResolve(root, path.posix.join(path.posix.dirname(String(req.body.from).replace(/\\/g, '/')), cleanName(req.body.name)));
  guardWrite(to, admin); // can't rename something into an executable name
  if (from === path.resolve(root)) throw new HttpError(400, "Can't rename the server folder");
  if (fs.existsSync(to)) throw new HttpError(400, 'Something with that name already exists');
  fs.renameSync(from, to);
  res.json({ ok: true });
});

router.post('/servers/:id/files/delete', (req, res) => {
  const { inst, root } = ctx(req);
  const paths = Array.isArray(req.body.paths) ? req.body.paths : [];
  for (const p of paths) {
    const abs = safeResolve(root, p);
    if (abs === path.resolve(root)) throw new HttpError(400, "Can't delete the server folder itself");
    fs.rmSync(abs, { recursive: true, force: true });
  }
  inst.appendConsole(`[files] ${req.user.username} deleted ${paths.join(', ')}`);
  res.json({ ok: true });
});

// Raw upload: PUT body is the file contents.
router.put('/servers/:id/files/upload', async (req, res) => {
  const { inst, root, admin } = ctx(req);
  const target = await receiveUpload(req, root, req.query.path, req.query.name, (t) => guardWrite(t, admin));
  inst.appendConsole(`[files] ${req.user.username} uploaded ${relTo(root, target)}`);
  res.json({ ok: true });
});

router.get('/servers/:id/files/download', (req, res) => {
  const { root } = ctx(req);
  const target = safeResolve(root, req.query.path);
  if (!fs.existsSync(target)) throw new HttpError(404, 'Not found');
  if (fs.statSync(target).isDirectory()) {
    const name = (path.basename(target) || 'server') + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
    streamZip(target, res, ['**/session.lock']);
  } else {
    res.download(target);
  }
});

router.post('/servers/:id/files/extract', async (req, res) => {
  const { inst, root, admin } = ctx(req);
  const file = safeResolve(root, req.body.path);
  if (!/\.zip$/i.test(file) || !fs.existsSync(file)) throw new HttpError(400, 'Only .zip files can be extracted');
  const dest = path.dirname(file);
  // A non-admin can't smuggle an executable past guardWrite inside a zip.
  const filter = admin ? undefined : (rel) => !blockedForNonAdmin(path.basename(rel));
  const written = await extractZip(file, dest, { filter });
  inst.appendConsole(`[files] ${req.user.username} extracted ${relTo(root, file)} (${written.length} files)`);
  res.json({ ok: true, files: written.length });
});

module.exports = router;
