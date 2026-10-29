'use strict';
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { HttpError } = require('./misc');

// Resolve a user-supplied relative path inside root, refusing anything that escapes it
// (including via symlinks/junctions that point outside the server folder).
function safeResolve(root, rel = '') {
  const cleaned = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(root, cleaned);
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new HttpError(400, 'Path is outside the server folder');
  }
  // Check the deepest existing ancestor's real path as well.
  let probe = target;
  while (!fs.existsSync(probe) && probe !== rootResolved) probe = path.dirname(probe);
  if (fs.existsSync(probe)) {
    const real = fs.realpathSync(probe);
    const realRoot = fs.realpathSync(rootResolved);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new HttpError(400, 'Path is outside the server folder');
    }
  }
  return target;
}

// One file or folder name from a user: no path separators, reserved characters, "." or "..".
function cleanName(name) {
  const n = String(name || '').trim();
  if (!n || n === '.' || n === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(n)) throw new HttpError(400, `Invalid name "${n}"`);
  return n;
}

// Save an upload (the request body) as `name` in folder `dir` (relative to root). The name may
// include folders from a folder upload ("sub/file.txt"); every part is checked. check(target) can
// refuse before anything is written. The data goes to <file>.uploading first, so a broken upload
// never leaves half a file under the real name. Resolves to the saved file's path.
async function receiveUpload(req, root, dir, name, check) {
  const at = safeResolve(root, dir);
  const parts = String(name || '').replace(/\\/g, '/').split('/').filter(Boolean).map(cleanName);
  if (!parts.length) throw new HttpError(400, 'Missing file name');
  const target = safeResolve(root, path.posix.join(relTo(root, at), ...parts));
  if (check) check(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.uploading';
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return target;
}

// A folder's contents for a file browser, folders first, names in natural order ("map2" before
// "map10"). skip(name) hides entries. Missing folders are a 404.
function listFolder(dir, skip = () => false) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(404, 'Folder not found');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !skip(e.name))
    .map((e) => {
      let st = null;
      try {
        st = fs.statSync(path.join(dir, e.name));
      } catch {}
      return { name: e.name, dir: st ? st.isDirectory() : e.isDirectory(), size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 };
    })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
}

function relTo(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}


// Recursively find files whose relative path matches a predicate (bounded depth).
function findFiles(root, predicate, maxDepth = 8) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (predicate(relTo(root, p), e.name)) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

// Files a non-admin must not create or overwrite: native executables, scripts, and launch-argument
// files that the panel or the OS could later run as the host account.
// (.jar stays allowed because mods are .jar; that is the mods workflow, gated by its own permission.)
const BLOCKED_EXT = /\.(exe|dll|so|dylib|bat|cmd|com|scr|msi|ps1|psm1|vbs|vbe|wsf|jse|hta|cpl|sh|bash)$/i;
const BLOCKED_NAME = /^user_jvm_args\.txt$/i;
function blockedForNonAdmin(name) {
  return BLOCKED_EXT.test(name) || BLOCKED_NAME.test(name);
}

module.exports = { safeResolve, relTo, cleanName, receiveUpload, listFolder, findFiles, blockedForNonAdmin };
