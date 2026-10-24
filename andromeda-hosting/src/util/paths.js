'use strict';
const fs = require('fs');
const path = require('path');
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

function relTo(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {}
      }
    }
  }
  return total;
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

module.exports = { safeResolve, relTo, dirSize, findFiles };
