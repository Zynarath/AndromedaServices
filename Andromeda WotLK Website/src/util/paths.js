'use strict';
// findFiles from Andromeda Hosting (src/util/paths.js).
const fs = require('fs');
const path = require('path');

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

module.exports = { findFiles };
