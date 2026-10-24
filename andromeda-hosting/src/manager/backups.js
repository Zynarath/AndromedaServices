'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createZip, extractZip, listZip } = require('../util/zip');
const { HttpError } = require('../util/misc');

function dirFor(server) {
  return path.join(config.backupsDir, server.id);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function list(server) {
  const dir = dirFor(server);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.zip') && !f.startsWith('_'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      const m = /^[\d-]+_[\d-]+_(.+)\.zip$/.exec(f);
      return { name: f, size: st.size, createdAt: st.mtimeMs, reason: m ? m[1].replace(/-/g, ' ') : '' };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function resolveBackup(server, name) {
  if (!/^[\w.-]+\.zip$/.test(name)) throw new HttpError(400, 'Invalid backup name');
  const file = path.join(dirFor(server), name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Backup not found');
  return file;
}

async function create(instance, { reason = 'manual', log }) {
  const server = instance.server;
  const game = instance.game;
  let { root, ignore } = game.backupConfig(server);
  const name = `${stamp()}_${String(reason).replace(/[^\w]+/g, '-').slice(0, 30)}.zip`;
  const out = path.join(dirFor(server), name);
  let staging = null;
  if (game.prepareBackup) {
    // Games whose saves live in a database write a dump into a staging folder first.
    staging = path.join(dirFor(server), '_staging');
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
      await game.prepareBackup(instance, staging, log);
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw err;
    }
    root = staging;
  }
  if (!fs.existsSync(root)) throw new Error('Nothing to back up yet (server files not found)');
  const running = !!instance.child && instance.status === 'running';
  if (running && game.beforeBackup) {
    log.info('Saving the world before backing up...');
    await game.beforeBackup(instance).catch((e) => log.warn(`Pre-backup save failed: ${e.message}`));
  }
  try {
    log.info(`Creating backup ${name}...`);
    const bytes = await createZip(root, out, {
      ignore,
      onProgress: (done, total) => log.progress(total ? (done / total) * 100 : null, `${(done / 1048576).toFixed(0)} MB`),
    });
    log.info(`Backup written (${(bytes / 1048576).toFixed(1)} MB).`);
  } finally {
    if (running && game.afterBackup) await game.afterBackup(instance).catch(() => {});
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
  }
  prune(server);
  return name;
}

function prune(server) {
  const keep = Math.max(1, Number(server.backupKeep) || 10);
  const all = list(server);
  for (const b of all.slice(keep)) fs.rmSync(path.join(dirFor(server), b.name), { force: true });
}

async function restore(instance, name, log) {
  const server = instance.server;
  if (instance.child) throw new HttpError(409, 'Stop the server before restoring a backup');
  const file = resolveBackup(server, name);
  if (instance.game.restoreBackup) {
    const tmp = path.join(dirFor(server), '_restore');
    fs.rmSync(tmp, { recursive: true, force: true });
    try {
      await extractZip(file, tmp);
      await instance.game.restoreBackup(instance, tmp, log);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    log.info('Restore complete.');
    return;
  }
  const { root } = instance.game.backupConfig(server);
  const tops = new Set((await listZip(file)).map((n) => n.split('/')[0]).filter(Boolean));
  log.info(`Restoring ${name}: replacing ${[...tops].join(', ')}`);
  for (const t of tops) fs.rmSync(path.join(root, t), { recursive: true, force: true });
  await extractZip(file, root, { onProgress: (d, t) => log.progress((d / t) * 100, `${d}/${t} files`) });
  log.info('Restore complete.');
}

function remove(server, name) {
  fs.rmSync(resolveBackup(server, name), { force: true });
}

module.exports = { list, create, restore, remove, resolveBackup, dirFor };
