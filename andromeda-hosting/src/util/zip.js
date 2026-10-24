'use strict';
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const archiver = require('archiver');

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

// Iterate entries; handler(entry, zip) may return a promise. Return false to stop early.
async function eachEntry(file, handler) {
  const zip = await openZip(file);
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      zip.close();
      err ? reject(err) : resolve();
    };
    zip.on('error', finish);
    zip.on('end', () => finish());
    zip.on('entry', async (entry) => {
      try {
        const cont = await handler(entry, zip);
        if (cont === false) return finish();
        zip.readEntry();
      } catch (err) {
        finish(err);
      }
    });
    zip.readEntry();
  });
}

function readStream(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s))));
}

async function listZip(file) {
  const names = [];
  await eachEntry(file, (e) => {
    names.push(e.fileName);
  });
  return names;
}

// Returns the single top-level folder every entry lives in, or '' if there isn't one.
function commonRoot(names) {
  let root = null;
  for (const n of names) {
    const idx = n.indexOf('/');
    if (idx === -1) return ''; // a file at the top level
    const top = n.slice(0, idx + 1);
    if (root === null) root = top;
    else if (root !== top) return '';
  }
  return root || '';
}

// Read one entry (matched by exact name or predicate) into a Buffer. Returns null if absent.
async function readEntry(file, match) {
  const test = typeof match === 'function' ? match : (n) => n === match;
  let result = null;
  await eachEntry(file, async (entry, zip) => {
    if (entry.fileName.endsWith('/') || !test(entry.fileName)) return true;
    const stream = await readStream(zip, entry);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    result = { name: entry.fileName, data: Buffer.concat(chunks) };
    return false;
  });
  return result;
}

/**
 * Extract a zip into dest.
 * opts.stripRoot: true to drop a single shared top-level folder, or a string prefix to strip.
 * opts.subdir: only extract entries under this prefix (after stripping), removing the prefix.
 * opts.filter(relPath) -> boolean: skip entries returning false.
 * opts.onProgress(done, total)
 */
async function extractZip(file, dest, opts = {}) {
  const names = await listZip(file);
  let strip = '';
  if (opts.stripRoot === true) strip = commonRoot(names);
  else if (typeof opts.stripRoot === 'string') strip = opts.stripRoot;
  const subdir = opts.subdir ? opts.subdir.replace(/\/?$/, '/') : '';
  const destRoot = path.resolve(dest);
  fs.mkdirSync(destRoot, { recursive: true });
  const total = names.length;
  let count = 0;
  const written = [];
  await eachEntry(file, async (entry, zip) => {
    count++;
    let name = entry.fileName;
    if (strip && name.startsWith(strip)) name = name.slice(strip.length);
    if (subdir) {
      if (!name.startsWith(subdir)) return true;
      name = name.slice(subdir.length);
    }
    if (!name || (opts.filter && !opts.filter(name))) return true;
    const target = path.resolve(destRoot, name);
    if (target !== destRoot && !target.startsWith(destRoot + path.sep)) return true; // zip-slip guard
    if (name.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const stream = await readStream(zip, entry);
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(target);
        stream.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        stream.pipe(out);
      });
      written.push(name);
    }
    if (opts.onProgress && (count % 25 === 0 || count === total)) opts.onProgress(count, total);
    return true;
  });
  return written;
}

/**
 * Zip a directory. opts.ignore: glob patterns relative to srcDir. opts.onProgress(processedBytes, totalBytes)
 */
function createZip(srcDir, outFile, opts = {}) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  return new Promise((resolve, reject) => {
    const tmp = outFile + '.part';
    const out = fs.createWriteStream(tmp);
    const archive = archiver('zip', { zlib: { level: opts.level ?? 5 } });
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });
    archive.on('error', reject);
    out.on('error', reject);
    out.on('close', () => {
      fs.renameSync(tmp, outFile);
      resolve(archive.pointer());
    });
    if (opts.onProgress) archive.on('progress', (p) => opts.onProgress(p.fs.processedBytes, p.fs.totalBytes));
    archive.pipe(out);
    for (const pattern of opts.globs || ['**/*']) archive.glob(pattern, { cwd: srcDir, dot: true, ignore: opts.ignore || [] });
    archive.finalize();
  });
}

// Stream a zip of a directory straight into a writable stream (for downloads).
function streamZip(srcDir, writable, ignore = [], level = 3) {
  const archive = archiver('zip', { zlib: { level } });
  archive.on('warning', () => {});
  archive.on('error', (err) => writable.destroy(err));
  archive.pipe(writable);
  archive.glob('**/*', { cwd: srcDir, dot: true, ignore });
  archive.finalize();
}

module.exports = { listZip, readEntry, extractZip, createZip, streamZip, commonRoot };
