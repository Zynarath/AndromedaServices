'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const auth = require('../auth');
const manager = require('../manager/manager');
const { safeResolve, relTo } = require('../util/paths');
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

function cleanName(name) {
  const n = String(name || '').trim();
  if (!n || n === '.' || n === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(n)) throw new HttpError(400, `Invalid file name "${n}"`);
  return n;
}

// Files a non-admin must not create or overwrite through the file manager: native executables,
// scripts, and launch-argument files that the panel or the OS could later run as the host account.
// (.jar stays allowed because mods are .jar; that is the mods workflow, gated by its own permission.)
const BLOCKED_EXT = /\.(exe|dll|so|dylib|bat|cmd|com|scr|msi|ps1|psm1|vbs|vbe|wsf|jse|hta|cpl|sh|bash)$/i;
const BLOCKED_NAME = /^user_jvm_args\.txt$/i;
function blockedForNonAdmin(name) {
  return BLOCKED_EXT.test(name) || BLOCKED_NAME.test(name);
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
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(404, 'Folder not found');
  const entries = fs.readdirSync(dir, { withFileTypes: true }).map((e) => {
    let st = null;
    try {
      st = fs.statSync(path.join(dir, e.name));
    } catch {}
    return { name: e.name, dir: st ? st.isDirectory() : e.isDirectory(), size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 };
  });
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  res.json({ path: relTo(root, dir), entries });
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
  const dir = safeResolve(root, req.query.path);
  const rel = String(req.query.name || '').replace(/\\/g, '/');
  // Allow "folder/sub/file.txt" from folder uploads, but validate every segment.
  const parts = rel.split('/').filter(Boolean).map(cleanName);
  if (!parts.length) throw new HttpError(400, 'Missing file name');
  const target = safeResolve(root, path.posix.join(relTo(root, dir), ...parts));
  guardWrite(target, admin);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.uploading';
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
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
