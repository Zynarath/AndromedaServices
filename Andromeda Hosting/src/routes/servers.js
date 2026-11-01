'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const auth = require('../auth');
const manager = require('../manager/manager');
const backups = require('../manager/backups');
const scheduler = require('../manager/scheduler');
const { games, templates, CONFIG_KEY } = require('../games');
const cf = require('../services/curseforge');
const mapImages = require('../services/mapimages');
const covers = require('../services/covers');
const ddns = require('../services/ddns');
const ficsit = require('../services/ficsit');
const { pipeline } = require('stream/promises');
const modinfo = require('../services/modinfo');
const umod = require('../services/umod');
const { HttpError, randomId } = require('../util/misc');
const { parseCpuList, PRIORITIES, CORES } = require('../util/procstats');

const router = express.Router();
router.use(auth.requireAuth);

function load(req, perm = 'view') {
  const inst = manager.get(req.params.id);
  if (!auth.can(req.user, inst.server, 'view')) throw new HttpError(404, 'Server not found');
  if (perm !== 'view' && !auth.can(req.user, inst.server, perm)) throw new HttpError(403, `You don't have the "${auth.PERM_LABELS[perm] || perm}" permission on this server`);
  return inst;
}

function publicHost() {
  return ddns.publicAddress();
}

function view(inst, user, full = false) {
  const s = inst.server;
  const game = games[s.game];
  const perms = auth.permsFor(user, s);
  const out = {
    id: s.id,
    name: s.name,
    game: s.game,
    template: s.template,
    installed: !!s.installed,
    createdAt: s.createdAt,
    autoStart: !!s.autoStart,
    autoRestart: !!s.autoRestart,
    lastInstallError: s.lastInstallError || null,
    cover: covers.info(s),
    summary: game.describe(s),
    perms,
    runtime: inst.toJSON(),
    ports: game.ports(s),
    connect: publicHost() ? game.connectAddress(s, publicHost()) : null,
  };
  if (s.mc) {
    out.mc = {
      source: s.mc.source,
      mcVersion: s.mc.mcVersion,
      loader: s.mc.loader,
      loaderVersion: s.mc.loaderVersion,
      memoryMb: s.mc.memoryMb,
      port: s.mc.port,
      javaMajor: s.mc.javaMajor,
      curseforge: s.mc.curseforge,
    };
  }
  if (s.ark) {
    out.ark = { edition: s.ark.edition, editionLabel: games.ark.EDITIONS[s.ark.edition].label, map: s.ark.map, maxPlayers: s.ark.maxPlayers, port: s.ark.port, mods: s.ark.mods, clusterId: s.ark.clusterId, hasPassword: !!s.ark.settings.ServerPassword };
    if (perms.includes('settings') || perms.includes('admin')) out.ark.joinPassword = s.ark.settings.ServerPassword || '';
  }
  if (s.cod) {
    const t = games.cod.TITLES[s.cod.title];
    out.cod = {
      title: s.cod.title, label: t.label, short: t.short, gametype: s.cod.gametype, gametypeLabel: (t.gametypes.find((g) => g[0] === s.cod.gametype) || [])[1] || s.cod.gametype,
      maps: s.cod.maps.length, port: s.cod.port, bots: s.cod.bots, botsVersion: s.cod.botsVersion, xpScale: s.cod.xpScale, weaponXp: t.weaponXp, weaponXpScale: s.cod.weaponXpScale,
      pluto: !!t.pluto, hasPassword: !!s.cod.password, hasKey: !!s.cod.plutoKey, botsAvailable: !!t.botRepo, engine: t.exes ? t.short : null,
    };
    if (perms.includes('settings') || perms.includes('admin')) out.cod.joinPassword = s.cod.password || '';
  }
  if (s.sf) {
    out.sf = { serverName: s.sf.serverName, port: s.sf.port, maxPlayers: s.sf.maxPlayers, mods: s.sf.mods.length, modsDirty: !!s.sf.modsDirty, hasPassword: !!s.sf.clientPassword };
    if (perms.includes('settings') || perms.includes('admin')) out.sf.joinPassword = s.sf.clientPassword || '';
    if (perms.includes('admin')) out.sf.adminPassword = s.sf.adminPassword;
  }
  if (s.sdtd) {
    const world = s.sdtd.gameWorld === 'RWG' ? `Random world${s.sdtd.worldSize ? ' ' + s.sdtd.worldSize : ''}` : s.sdtd.gameWorld;
    out.sdtd = { serverName: s.sdtd.serverName, world, gameName: s.sdtd.gameName, port: s.sdtd.port, maxPlayers: s.sdtd.maxPlayers, eac: s.sdtd.eac !== false, hasPassword: !!s.sdtd.password };
    if (perms.includes('settings') || perms.includes('admin')) out.sdtd.joinPassword = s.sdtd.password || '';
  }
  if (s.vh) {
    out.vh = { serverName: s.vh.serverName, worldName: s.vh.worldName, port: s.vh.port, crossplay: !!s.vh.crossplay, public: !!s.vh.public, preset: s.vh.preset || '' };
    if (perms.includes('settings') || perms.includes('admin')) out.vh.joinPassword = s.vh.password || '';
  }
  if (s.rust) {
    out.rust = { hostname: s.rust.hostname, level: s.rust.level, worldSize: s.rust.worldSize, seed: s.rust.seed, maxPlayers: s.rust.maxPlayers, port: s.rust.port, pve: !!s.rust.pve, oxide: !!s.rust.oxide, oxideVersion: s.rust.oxideVersion || null, appPort: s.rust.appPort };
  }
  if (s.wow) {
    out.wow = { realmName: s.wow.realmName, address: s.wow.address || ddns.publicAddress(), manageDb: !!s.wow.manageDb };
    if (perms.includes('admin')) out.wow.root = s.wow.root;
  }
  if (full) {
    Object.assign(out, {
      dir: user.role === 'admin' ? s.dir : undefined,
      tuning: s.tuning || { affinity: '', priority: 'normal' },
      backupKeep: s.backupKeep,
      backupBeforeUpdate: s.backupBeforeUpdate !== false,
      statsHistory: inst.statsHistory,
      cores: CORES,
    });
    if (user.role === 'admin') {
      out.access = Object.entries(s.access || {}).map(([userId, p]) => ({ userId, perms: p }));
    }
  }
  return out;
}

router.get('/templates', (_req, res) => {
  res.json({
    templates: templates.map((t) => {
      const key = covers.templateKey(t);
      const cover = key && covers.defaultInfo(key);
      return { ...t, supported: t.platforms.includes(process.platform), cover: cover ? cover.url : null };
    }),
    curseforgeKey: cf.hasKey(),
    platform: process.platform,
  });
});

// A game's default cover picture, for the Create page (downloaded once, then cached).
router.get('/covers/:key', async (req, res) => {
  const img = await covers.getDefault(String(req.params.key));
  if (!img) return res.status(404).set('Cache-Control', 'no-store').json({ error: 'No cover picture' });
  // Versioned addresses never change; the plain one is re-checked now and then.
  res.set('Cache-Control', req.query.v ? 'private, max-age=604800' : 'private, max-age=3600');
  res.type(img.type).sendFile(img.file);
});

router.get('/servers', (req, res) => {
  const list = [...manager.instances.values()].filter((i) => auth.can(req.user, i.server, 'view')).map((i) => view(i, req.user));
  res.json({ servers: list });
});

router.get('/servers/suggest-ports', auth.requireAdmin, async (req, res) => {
  const game = ['ark', 'cod', 'satisfactory', 'sdtd', 'valheim', 'rust'].includes(req.query.game) ? req.query.game : 'minecraft';
  res.json(await manager.suggestPorts(game, req.query.title));
});

router.post('/servers', auth.requireAdmin, async (req, res) => {
  const inst = await manager.create(req.body || {}, req.user);
  res.json({ server: view(inst, req.user) });
});

router.get('/servers/:id', (req, res) => {
  res.json({ server: view(load(req), req.user, true) });
});

router.patch('/servers/:id', (req, res) => {
  const inst = load(req, 'settings');
  const s = inst.server;
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name || name.length > 48) throw new HttpError(400, 'Name must be 1–48 characters');
    if (s.name !== name) {
      s.name = name;
      manager.emit('renamed', s.id);
    }
  }
  if (b.autoStart !== undefined) s.autoStart = !!b.autoStart;
  if (b.autoRestart !== undefined) s.autoRestart = !!b.autoRestart;
  if (b.backupKeep !== undefined) s.backupKeep = Math.max(1, Math.min(200, Number(b.backupKeep) || 10));
  if (b.backupBeforeUpdate !== undefined) s.backupBeforeUpdate = !!b.backupBeforeUpdate;
  if (b.tuning) {
    const affinity = String(b.tuning.affinity || '').trim();
    if (affinity && !parseCpuList(affinity).length) throw new HttpError(400, `CPU list "${affinity}" doesn't match any of this PC's ${CORES} logical CPUs`);
    const priority = PRIORITIES[b.tuning.priority] ? b.tuning.priority : 'normal';
    s.tuning = { affinity, priority };
  }
  db.save();
  res.json({ server: view(inst, req.user, true) });
});

// ---- cover picture ----
// The server's own picture, or the game's default (downloaded once, then cached).
router.get('/servers/:id/cover', async (req, res) => {
  const img = await covers.get(load(req).server);
  if (!img) return res.status(404).set('Cache-Control', 'no-store').json({ error: 'No cover picture' });
  res.set('Cache-Control', 'private, max-age=604800');
  res.type(img.type).sendFile(img.file);
});

// PUT body is the picture itself.
router.put('/servers/:id/cover', express.raw({ type: () => true, limit: covers.MAX_UPLOAD + 1024 }), (req, res) => {
  const inst = load(req, 'settings');
  covers.setCustom(inst.server, Buffer.isBuffer(req.body) ? req.body : null);
  db.save();
  res.json({ server: view(inst, req.user, true) });
});

router.delete('/servers/:id/cover', (req, res) => {
  const inst = load(req, 'settings');
  covers.removeCustom(inst.server);
  db.save();
  res.json({ server: view(inst, req.user, true) });
});

router.delete('/servers/:id', auth.requireAdmin, async (req, res) => {
  load(req);
  await manager.remove(req.params.id, { deleteFiles: req.query.keepFiles !== '1' });
  res.json({ ok: true });
});

// ---- power & console ----
router.post('/servers/:id/power', async (req, res) => {
  const inst = load(req, 'control');
  const action = req.body && req.body.action;
  if (action === 'start') await inst.start();
  else if (action === 'stop') inst.stop().catch(() => {});
  else if (action === 'restart') inst.restart().catch((e) => inst.appendConsole(`[panel] Restart failed: ${e.message}`));
  else if (action === 'kill') inst.kill();
  else throw new HttpError(400, 'Unknown action');
  res.json({ ok: true, status: inst.status });
});

router.get('/servers/:id/console', (req, res) => {
  const inst = load(req, 'console');
  res.json({ lines: inst.console.slice(-1000) });
});

router.post('/servers/:id/command', async (req, res) => {
  const inst = load(req, 'console');
  const command = String((req.body && req.body.command) || '').trim();
  if (!command) throw new HttpError(400, 'Empty command');
  if (command.length > 2000) throw new HttpError(400, 'Command is too long');
  const out = await inst.sendCommand(command);
  res.json({ ok: true, output: typeof out === 'string' ? out : null });
});

// ---- game settings ----
router.get('/servers/:id/settings', (req, res) => {
  const inst = load(req, 'settings');
  res.json({ schema: inst.game.settingsSchema(inst.server), values: inst.game.readSettings(inst.server, { admin: req.user.role === 'admin' }) });
});

router.put('/servers/:id/settings', (req, res) => {
  const inst = load(req, 'settings');
  const key = CONFIG_KEY[inst.server.game];
  const before = JSON.stringify(inst.server[key]);
  // Some fields put text onto the process command line or pick which executable to run, so a
  // "settings" friend changing them could run code as the host. Those are admin-only.
  const result = inst.game.writeSettings(inst.server, (req.body && req.body.values) || {}, { admin: req.user.role === 'admin' });
  try {
    manager.checkPortConflicts(inst.server);
  } catch (err) {
    inst.server[key] = JSON.parse(before);
    throw err;
  }
  // Write the game's config files now, unless the server is running and would overwrite them.
  let warning = null;
  if (inst.game.saveFiles && !inst.child) {
    try {
      inst.game.saveFiles(inst.server);
    } catch (err) {
      warning = `Saved in the panel, but the config files couldn't be written yet (${err.message}). They are written on the next start.`;
    }
  }
  db.save();
  res.json({ ok: true, warning, restartRequired: !!(result.restartRequired && inst.child), values: inst.game.readSettings(inst.server, { admin: req.user.role === 'admin' }) });
});

// ---- mod configuration (ARK mod INI sections, Minecraft mod config files) ----
function modConfigGame(inst) {
  if (!inst.game.listModConfigs) throw new HttpError(404, 'This server has no mod configuration');
  return inst;
}

router.get('/servers/:id/mod-config', async (req, res) => {
  const inst = modConfigGame(load(req, 'settings'));
  res.json({ ...(await inst.game.listModConfigs(inst.server, { refresh: req.query.refresh === '1' })), running: !!inst.child, canRaw: auth.can(req.user, inst.server, 'files') });
});

// A mod's Workshop/CurseForge picture, for mods in this server's list (downloaded once, then cached).
router.get('/servers/:id/mod-image/:modId', async (req, res) => {
  const inst = load(req);
  if (!inst.server.ark || !inst.server.ark.mods.includes(req.params.modId)) throw new HttpError(404, 'Unknown mod');
  const img = await modinfo.getModImage(req.params.modId, inst.server.ark.edition).catch(() => null);
  if (!img) throw new HttpError(404, 'No picture for this mod');
  res.set('Cache-Control', 'private, max-age=604800');
  res.type(img.type).sendFile(img.file);
});

router.get('/servers/:id/mod-config/file', async (req, res) => {
  const inst = modConfigGame(load(req, 'settings'));
  const out = await inst.game.readModConfig(inst.server, String(req.query.file || ''));
  // The raw text is the whole file, so it needs the same permission as the Files tab.
  if (!auth.can(req.user, inst.server, 'files')) delete out.raw;
  res.json(out);
});

router.put('/servers/:id/mod-config/file', async (req, res) => {
  const inst = modConfigGame(load(req, 'settings'));
  const body = req.body || {};
  if (typeof body.raw === 'string' && !auth.can(req.user, inst.server, 'files')) throw new HttpError(403, 'Editing the raw file needs the Files permission');
  const r = await inst.game.writeModConfig(inst.server, String(body.file || ''), { values: body.values, raw: body.raw, writeAll: !!body.writeAll }, { running: !!inst.child });
  inst.appendConsole(`[mod config] ${req.user.username} changed ${r.changed} setting(s) in ${body.file}`);
  // Games that can apply new settings while running (Rust's uMod reloads just that plugin).
  let applied = false;
  if (r.changed && inst.child && inst.game.modConfigChanged) {
    try {
      applied = (await inst.game.modConfigChanged(inst, String(body.file))).reloaded;
    } catch (err) {
      inst.appendConsole(`[mod config] Couldn't reload it now (${err.message}); it applies on the next restart.`);
    }
  }
  res.json({ ok: true, ...r, applied, restartRequired: !!inst.child && !applied });
});

// Map preview for the CoD map picker (looked up on the CoD wiki once, then cached).
router.get('/servers/:id/map-image/:map', (req, res) => {
  const inst = load(req);
  const t = inst.server.game === 'cod' && games.cod.TITLES[inst.server.cod.title];
  const m = t && t.maps.find((x) => x[0] === req.params.map);
  if (!m) throw new HttpError(404, 'Unknown map');
  const img = mapImages.peek(inst.server.cod.title, m[0], t.wikiGame, m[1]);
  // Not cached (yet): answer at once; the page shows the map's name and asks again shortly.
  if (!img) return res.status(404).set('Retry-After', '5').json({ error: 'No preview yet' });
  res.set('Cache-Control', 'private, max-age=604800');
  res.type(img.type).sendFile(img.file);
});

// ---- install / update ----
router.post('/servers/:id/reinstall', auth.requireAdmin, async (req, res) => {
  const inst = load(req);
  manager.install(inst.server.id, { validate: true }).catch(() => {});
  res.json({ ok: true });
});

router.post('/servers/:id/update', async (req, res) => {
  const inst = load(req, 'mods');
  const r = await manager.update(inst.server.id, req.body || {});
  res.json({ ok: true, upToDate: !!r.upToDate });
});

router.get('/servers/:id/modpack/versions', async (req, res) => {
  const inst = load(req, 'mods');
  const mc = inst.server.mc;
  if (!mc || mc.source !== 'curseforge') throw new HttpError(400, 'Not a CurseForge modpack server');
  const files = await cf.getFiles(mc.curseforge.modId, { pageSize: 50 });
  res.json({ current: mc.curseforge.fileId, files: files.filter((f) => !f.isServerPack).map(cf.slimFile) });
});

// ---- Minecraft mods folder ----
function modFile(inst, name) {
  if (!/^[^/\\]+\.jar(\.disabled)?$/i.test(name)) throw new HttpError(400, 'Invalid mod file');
  const p = path.join(inst.server.dir, 'mods', name);
  if (!fs.existsSync(p)) throw new HttpError(404, 'Mod not found');
  return p;
}

router.get('/servers/:id/mods', (req, res) => {
  const inst = load(req, 'mods');
  if (inst.server.game === 'minecraft') return res.json({ mods: inst.game.listMods(inst.server) });
  if (inst.server.game !== 'ark') return res.json({ mods: [] });
  res.json({ mods: inst.server.ark.mods.map((id) => ({ id })) });
});

router.post('/servers/:id/mods', async (req, res) => {
  const inst = load(req, 'mods');
  if (inst.server.game !== 'minecraft') throw new HttpError(400, 'Use the ARK mod list instead');
  const r = await inst.game.addCurseForgeMod(inst.server, Number(req.body.modId), req.body.fileId ? Number(req.body.fileId) : null);
  inst.appendConsole(`[mods] ${req.user.username} added ${r.file}`);
  res.json({ ok: true, ...r });
});

router.patch('/servers/:id/mods/:file', (req, res) => {
  const inst = load(req, 'mods');
  const p = modFile(inst, req.params.file);
  const enabled = !!req.body.enabled;
  const target = enabled ? p.replace(/\.disabled$/i, '') : p.endsWith('.disabled') ? p : p + '.disabled';
  if (target !== p) fs.renameSync(p, target);
  res.json({ ok: true });
});

router.delete('/servers/:id/mods/:file', (req, res) => {
  const inst = load(req, 'mods');
  fs.rmSync(modFile(inst, req.params.file), { force: true });
  inst.appendConsole(`[mods] ${req.user.username} removed ${req.params.file}`);
  res.json({ ok: true });
});

// ---- ARK mod list ----
router.get('/servers/:id/ark-mods', async (req, res) => {
  const inst = load(req, 'mods');
  const ids = inst.server.ark.mods;
  let details = [];
  if (cf.hasKey() && ids.length && inst.server.ark.edition === 'asa') {
    try {
      details = (await cf.getMods(ids)).map(cf.slimMod);
    } catch {}
  } else if (ids.length && inst.server.ark.edition !== 'asa') {
    // Steam Workshop: name, picture (served through the panel) and page link.
    details = (await modinfo.getModInfo(ids, { edition: 'ase', refresh: req.query.refresh === '1' }))
      .filter((d) => d.found)
      .map((d) => ({ id: Number(d.id), name: d.name, logo: d.imageUrl ? `/api/servers/${inst.server.id}/mod-image/${d.id}` : null, url: d.url }));
  }
  res.json({ mods: ids.map((id) => details.find((d) => String(d.id) === id) || { id: Number(id), name: null }) });
});

router.put('/servers/:id/ark-mods', (req, res) => {
  const inst = load(req, 'mods');
  const list = (Array.isArray(req.body.mods) ? req.body.mods : []).map((x) => String(x).trim()).filter((x) => /^\d+$/.test(x));
  inst.server.ark.mods = [...new Set(list)];
  db.save();
  inst.appendConsole(`[mods] ${req.user.username} set the mod list: ${inst.server.ark.mods.join(', ') || '(none)'}`);
  res.json({ ok: true, mods: inst.server.ark.mods, restartRequired: !!inst.child });
});

// ---- Satisfactory mods (ficsit.app) ----
function sfInst(req) {
  const inst = load(req, 'mods');
  if (!inst.server.sf) throw new HttpError(400, 'Not a Satisfactory server');
  return inst;
}

router.get('/servers/:id/sf-mods', async (req, res) => {
  const inst = sfInst(req);
  const s = inst.server.sf;
  const installed = s.modsInstalled || {};
  const want = new Set(s.mods.map((m) => m.ref));
  const describe = async (ref) => {
    try {
      return ficsit.slim(await ficsit.getMod(ref));
    } catch {
      return { ref, name: ref, summary: '', logo: null, url: `https://ficsit.app/mod/${encodeURIComponent(ref)}` };
    }
  };
  const mods = await Promise.all(s.mods.map(async (m) => ({ ...(await describe(m.ref)), pinned: m.version || null, installed: installed[m.ref] || null })));
  const deps = await Promise.all(Object.keys(installed).filter((r) => !want.has(r)).map(async (r) => ({ ...(await describe(r)), installed: installed[r] })));
  res.json({ mods, deps, dirty: !!s.modsDirty, gameBuild: ficsit.gameBuild(inst.server.dir), remote: s.modsRemote || [], running: !!inst.child, target: ficsit.serverTarget() });
});

router.get('/servers/:id/sf-mods/search', async (req, res) => {
  sfInst(req);
  res.json(await ficsit.search(req.query.q, { offset: Number(req.query.offset) || 0 }));
});

router.post('/servers/:id/sf-mods', async (req, res) => {
  const inst = sfInst(req);
  const ref = String((req.body && req.body.ref) || '');
  if (!ficsit.REF_RE.test(ref)) throw new HttpError(400, 'Invalid mod reference');
  const mod = await ficsit.getMod(ref, { refresh: true });
  const target = ficsit.serverTarget();
  if (!mod.versions.some((v) => (v.targets || []).some((t) => t.targetName === target))) throw new HttpError(400, `${mod.name} doesn't run on dedicated servers (no ${target} build)`);
  const s = inst.server.sf;
  if (!s.mods.some((m) => m.ref === mod.mod_reference)) s.mods.push({ ref: mod.mod_reference });
  s.modsDirty = true;
  db.save();
  inst.appendConsole(`[mods] ${req.user.username} added ${mod.name}`);
  res.json({ ok: true, restartRequired: !!inst.child });
});

router.delete('/servers/:id/sf-mods/:ref', (req, res) => {
  const inst = sfInst(req);
  const s = inst.server.sf;
  const before = s.mods.length;
  s.mods = s.mods.filter((m) => m.ref !== req.params.ref);
  if (s.mods.length === before) throw new HttpError(404, 'Mod not in the list');
  s.modsDirty = true;
  db.save();
  inst.appendConsole(`[mods] ${req.user.username} removed ${req.params.ref}`);
  res.json({ ok: true, restartRequired: !!inst.child });
});

// Install / update now (instead of on the next start). The server has to be stopped.
router.post('/servers/:id/sf-mods/sync', async (req, res) => {
  const inst = sfInst(req);
  if (inst.child) throw new HttpError(409, 'Stop the server first (or just restart it: mods are installed on start)');
  inst.server.sf.modsDirty = true;
  inst.runJob('mods', 'Install mods', async (log) => {
    await inst.game.syncMods(inst.server, log);
    db.save();
  }).catch(() => db.save());
  res.json({ ok: true });
});

// ---- 7 Days to Die mods (folders in Mods/) ----
function sdtdInst(req) {
  const inst = load(req, 'mods');
  if (!inst.server.sdtd) throw new HttpError(400, 'Not a 7 Days to Die server');
  return inst;
}

router.get('/servers/:id/sdtd-mods', (req, res) => {
  const inst = sdtdInst(req);
  res.json({ mods: inst.game.listMods(inst.server), eac: inst.server.sdtd.eac !== false, running: !!inst.child });
});

// PUT body is a .zip with one or more mod folders.
router.put('/servers/:id/sdtd-mods/upload', async (req, res) => {
  const inst = sdtdInst(req);
  const tmp = path.join(inst.server.dir, `.mod-upload-${Date.now()}.zip`);
  fs.mkdirSync(inst.server.dir, { recursive: true });
  try {
    let size = 0;
    const limit = 2 * 1024 * 1024 * 1024;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) req.destroy(new HttpError(413, 'Mod archives can be at most 2 GB'));
    });
    await pipeline(req, fs.createWriteStream(tmp));
    const installed = await inst.game.installModZip(inst.server, tmp, { admin: req.user.role === 'admin' });
    inst.appendConsole(`[mods] ${req.user.username} installed ${installed.join(', ')}`);
    res.json({ ok: true, installed, restartRequired: !!inst.child });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

router.patch('/servers/:id/sdtd-mods/:folder', (req, res) => {
  const inst = sdtdInst(req);
  inst.game.setModEnabled(inst.server, req.params.folder, !!(req.body && req.body.enabled));
  inst.appendConsole(`[mods] ${req.user.username} turned ${req.body && req.body.enabled ? 'on' : 'off'} ${req.params.folder}`);
  res.json({ ok: true, restartRequired: !!inst.child });
});

router.delete('/servers/:id/sdtd-mods/:folder', (req, res) => {
  const inst = sdtdInst(req);
  inst.game.removeMod(inst.server, req.params.folder);
  inst.appendConsole(`[mods] ${req.user.username} removed ${req.params.folder}`);
  res.json({ ok: true, restartRequired: !!inst.child });
});

// ---- Rust uMod plugins (oxide/plugins) ----
function rustInst(req) {
  const inst = load(req, 'mods');
  if (!inst.server.rust) throw new HttpError(400, 'Not a Rust server');
  return inst;
}

// Installed plugins, with the newest version on uMod when it can be looked up.
router.get('/servers/:id/rust-plugins', async (req, res) => {
  const inst = rustInst(req);
  const plugins = inst.game.listPlugins(inst.server);
  const latest = await umod.latestVersions(plugins.map((p) => p.name));
  res.json({
    plugins: plugins.map((p) => {
      const u = latest[p.name];
      return { ...p, umod: u ? { version: u.version, url: u.url, logo: u.logo } : null, update: !!(u && u.version && p.version && umod.compareVersions(u.version, p.version) > 0) };
    }),
    oxide: inst.game.oxideStatus(inst.server),
    running: !!inst.child,
    canUpload: req.user.role === 'admin',
  });
});

router.get('/servers/:id/rust-plugins/search', async (req, res) => {
  rustInst(req);
  res.json(await umod.search(String(req.query.q || ''), { page: req.query.page, sort: String(req.query.sort || 'downloads'), pages: 3 }));
});

// Install or update plugins from uMod by name. Oxide loads them by itself, even while running.
router.post('/servers/:id/rust-plugins', async (req, res) => {
  const inst = rustInst(req);
  const names = (Array.isArray(req.body && req.body.names) ? req.body.names : [req.body && req.body.name]).map((n) => String(n || '')).filter(Boolean).slice(0, 25);
  if (!names.length) throw new HttpError(400, 'Which plugin?');
  if (!inst.server.rust.oxide) throw new HttpError(400, 'Turn on uMod in Settings → uMod first');
  const installed = [];
  const failed = [];
  for (const name of names) {
    try {
      const r = inst.game.installPlugin(inst.server, name, await umod.downloadPlugin(name));
      installed.push(r);
      inst.appendConsole(`[mods] ${req.user.username} installed ${r.title} ${r.version} from uMod`);
    } catch (err) {
      failed.push({ name, error: err.message });
    }
  }
  if (!installed.length) throw new HttpError(400, failed.map((f) => `${f.name}: ${f.error}`).join('; '));
  res.json({ ok: true, installed, failed, live: !!inst.child });
});

// A .cs plugin from somewhere else. It is code that runs on this PC, so admins only.
router.put('/servers/:id/rust-plugins/upload/:name', auth.requireAdmin, async (req, res) => {
  const inst = rustInst(req);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 4 * 1024 * 1024) throw new HttpError(413, 'Plugins can be at most 4 MB');
    chunks.push(c);
  }
  const r = inst.game.installPlugin(inst.server, req.params.name, Buffer.concat(chunks).toString('utf8'));
  inst.appendConsole(`[mods] ${req.user.username} uploaded ${r.title} ${r.version}`);
  res.json({ ok: true, ...r, live: !!inst.child });
});

router.patch('/servers/:id/rust-plugins/:name', (req, res) => {
  const inst = rustInst(req);
  const enabled = !!(req.body && req.body.enabled);
  inst.game.setPluginEnabled(inst.server, req.params.name, enabled);
  inst.appendConsole(`[mods] ${req.user.username} turned ${enabled ? 'on' : 'off'} ${req.params.name}`);
  res.json({ ok: true, live: !!inst.child });
});

router.delete('/servers/:id/rust-plugins/:name', (req, res) => {
  const inst = rustInst(req);
  const purge = req.query.purge === '1';
  inst.game.removePlugin(inst.server, req.params.name, { purge });
  inst.appendConsole(`[mods] ${req.user.username} removed ${req.params.name}${purge ? ' with its settings and data' : ''}`);
  res.json({ ok: true, live: !!inst.child });
});

// Install (or update) uMod itself without updating the game.
router.post('/servers/:id/rust-plugins/oxide', (req, res) => {
  const inst = rustInst(req);
  if (inst.child) throw new HttpError(409, "Stop the server first: uMod replaces some of the game's files");
  if (!inst.server.rust.oxide) throw new HttpError(400, 'Turn on uMod in Settings → uMod first');
  inst.runJob('mods', 'Install uMod', async (log) => {
    await inst.game.installOxide(inst.server, log);
    db.save();
  }).catch(() => db.save());
  res.json({ ok: true });
});

// ---- backups ----
router.get('/servers/:id/backups', (req, res) => {
  const inst = load(req, 'backups');
  res.json({ backups: backups.list(inst.server), keep: inst.server.backupKeep || 10 });
});

router.post('/servers/:id/backups', async (req, res) => {
  const inst = load(req, 'backups');
  manager.backup(inst.server.id, { reason: (req.body && req.body.note) || 'manual' }).catch(() => {});
  res.json({ ok: true });
});

router.post('/servers/:id/backups/:name/restore', async (req, res) => {
  const inst = load(req, 'backups');
  backups.resolveBackup(inst.server, req.params.name);
  if (inst.child) throw new HttpError(409, 'Stop the server before restoring a backup');
  manager.restore(inst.server.id, req.params.name).catch(() => {});
  res.json({ ok: true });
});

router.get('/servers/:id/backups/:name/download', (req, res) => {
  const inst = load(req, 'backups');
  res.download(backups.resolveBackup(inst.server, req.params.name));
});

router.delete('/servers/:id/backups/:name', (req, res) => {
  const inst = load(req, 'backups');
  backups.remove(inst.server, req.params.name);
  res.json({ ok: true });
});

// ---- schedules ----
const ACTIONS = ['restart', 'start', 'stop', 'backup', 'command', 'update'];
// A schedule runs a privileged action on a timer, so the creator must actually hold the matching
// permission — otherwise "schedules" alone would let a friend send console commands or power the
// server, which the console/control permissions are meant to gate.
const ACTION_PERM = { restart: 'control', start: 'control', stop: 'control', backup: 'backups', command: 'console', update: 'mods' };
function cleanSchedule(b, existing, req, inst) {
  const s = { ...existing };
  s.name = String(b.name ?? s.name ?? '').slice(0, 60);
  s.enabled = b.enabled !== undefined ? !!b.enabled : s.enabled ?? true;
  s.action = ACTIONS.includes(b.action) ? b.action : s.action;
  if (!s.action) throw new HttpError(400, 'Pick an action');
  if (!auth.can(req.user, inst.server, ACTION_PERM[s.action])) {
    throw new HttpError(403, `This action also needs the "${auth.PERM_LABELS[ACTION_PERM[s.action]]}" permission.`);
  }
  s.createdBy = existing.createdBy || req.user.id;
  s.type = b.type === 'interval' ? 'interval' : 'daily';
  if (s.type === 'interval') s.everyMinutes = Math.max(5, Number(b.everyMinutes) || 60);
  else {
    if (!/^\d{1,2}:\d{2}$/.test(b.time || '')) throw new HttpError(400, 'Time must look like 04:30');
    s.time = b.time;
    s.days = Array.isArray(b.days) ? b.days.map(Number).filter((d) => d >= 0 && d <= 6) : [];
  }
  s.payload = s.action === 'command' ? String(b.payload || '').slice(0, 500) : '';
  s.warnMinutes = Math.max(0, Math.min(60, Number(b.warnMinutes) || 0));
  return s;
}
const withNext = (s) => ({ ...s, nextRun: s.enabled ? scheduler.nextRun(s) : null });

router.get('/servers/:id/schedules', (req, res) => {
  const inst = load(req, 'schedules');
  res.json({ schedules: (inst.server.schedules || []).map(withNext) });
});

router.post('/servers/:id/schedules', (req, res) => {
  const inst = load(req, 'schedules');
  const s = cleanSchedule(req.body || {}, { id: randomId(4), createdAt: Date.now() }, req, inst);
  inst.server.schedules = [...(inst.server.schedules || []), s];
  db.save();
  res.json({ schedule: withNext(s) });
});

router.put('/servers/:id/schedules/:sid', (req, res) => {
  const inst = load(req, 'schedules');
  const idx = (inst.server.schedules || []).findIndex((x) => x.id === req.params.sid);
  if (idx === -1) throw new HttpError(404, 'Schedule not found');
  inst.server.schedules[idx] = cleanSchedule(req.body || {}, inst.server.schedules[idx], req, inst);
  db.save();
  res.json({ schedule: withNext(inst.server.schedules[idx]) });
});

router.delete('/servers/:id/schedules/:sid', (req, res) => {
  const inst = load(req, 'schedules');
  inst.server.schedules = (inst.server.schedules || []).filter((x) => x.id !== req.params.sid);
  db.save();
  res.json({ ok: true });
});

// ---- Minecraft whitelist ----
function mcOnly(inst) {
  if (inst.server.game !== 'minecraft') throw new HttpError(400, 'Only Minecraft servers have a whitelist');
  return inst;
}

router.get('/servers/:id/whitelist', (req, res) => {
  const inst = mcOnly(load(req, 'settings'));
  res.json({ ...inst.game.whitelist(inst.server), running: inst.status === 'running', online: inst.players ? inst.players.players : [] });
});

router.post('/servers/:id/whitelist', (req, res) => {
  const inst = mcOnly(load(req, 'settings'));
  const raw = inst.game.splitNames(req.body && req.body.names);
  const bad = raw.filter((n) => !inst.game.NAME_RE.test(n));
  if (bad.length) throw new HttpError(400, `Not valid Minecraft usernames: ${bad.join(', ')} (3–16 letters, numbers or underscores, separate names with commas)`);
  const names = inst.game.cleanNames(raw);
  if (!names.length) throw new HttpError(400, 'Enter at least one Minecraft username');
  let applied = true;
  for (const n of names) applied = inst.game.whitelistAdd(inst.server, inst, n).applied && applied;
  db.save();
  inst.appendConsole(`[players] ${req.user.username} whitelisted ${names.join(', ')}${applied ? '' : ' (applied on next start)'}`);
  res.json({ ok: true, applied });
});

router.delete('/servers/:id/whitelist/:name', (req, res) => {
  const inst = mcOnly(load(req, 'settings'));
  if (!inst.game.NAME_RE.test(req.params.name)) throw new HttpError(400, 'Invalid name');
  inst.game.whitelistRemove(inst.server, inst, req.params.name);
  db.save();
  inst.appendConsole(`[players] ${req.user.username} removed ${req.params.name} from the whitelist`);
  res.json({ ok: true });
});

router.put('/servers/:id/whitelist/enabled', (req, res) => {
  const inst = mcOnly(load(req, 'settings'));
  inst.game.setWhitelistEnabled(inst.server, inst, !!(req.body && req.body.enabled));
  res.json({ ok: true });
});

// ---- WoW: folder detection & game accounts ----
router.get('/wow/detect', auth.requireAdmin, (req, res) => {
  const d = games.wow.detect(req.query.path);
  res.json({ layout: d.layout, root: d.root, found: d.found, problems: d.problems, dataDir: d.dataDir, confDir: d.confDir });
});

function wowOnly(inst) {
  if (inst.server.game !== 'wow') throw new HttpError(400, 'Not a WoW server');
  return inst;
}
function wowRunning(inst) {
  if (!inst.child || inst.status !== 'running') throw new HttpError(409, 'Start the server first — accounts are managed through its console');
}
const gm = (v) => {
  const n = Number(v);
  if (!(n >= 0 && n <= 3)) throw new HttpError(400, 'GM level must be 0 (player) to 3 (admin)');
  return n;
};

router.get('/servers/:id/wow/diagnose', async (req, res) => {
  const inst = wowOnly(load(req, 'settings'));
  res.json({ checks: await inst.game.diagnose(inst.server, inst) });
});

router.get('/servers/:id/wow/accounts', async (req, res) => {
  const inst = wowOnly(load(req, 'settings'));
  try {
    res.json({ accounts: await inst.game.listAccounts(inst.server), running: inst.status === 'running' });
  } catch (err) {
    res.json({ accounts: [], dbOffline: true, error: err.message, running: inst.status === 'running' });
  }
});

router.post('/servers/:id/wow/accounts', async (req, res) => {
  const inst = wowOnly(load(req, 'settings'));
  const { username, password } = req.body || {};
  const level = gm(req.body.gmlevel || 0);
  if (!games.wow.NAME_RE.test(username || '')) throw new HttpError(400, 'Account names are 3–16 letters or numbers');
  if (!games.wow.PASS_RE.test(password || '')) throw new HttpError(400, 'Passwords are 4–16 characters, no spaces or quotes (a WoW client limit)');
  wowRunning(inst);
  if (await inst.game.accountExists(inst.server, username)) throw new HttpError(400, 'That account name is taken');
  // Expansion 2 = Wrath of the Lich King (without it the account is limited to vanilla content).
  inst.writeStdin(`account create ${username} ${password} 2`);
  if (level > 0) {
    await new Promise((r) => setTimeout(r, 1500));
    inst.writeStdin(`account set gmlevel ${username} ${level}`);
  }
  inst.appendConsole(`[accounts] ${req.user.username} created game account ${username.toUpperCase()}${level ? ` (GM level ${level})` : ''}`);
  res.json({ ok: true });
});

router.post('/servers/:id/wow/accounts/:name/password', async (req, res) => {
  const inst = wowOnly(load(req, 'settings'));
  const name = req.params.name;
  if (!games.wow.NAME_RE.test(name)) throw new HttpError(400, 'Invalid account');
  if (!games.wow.PASS_RE.test(req.body.password || '')) throw new HttpError(400, 'Passwords are 4–16 characters, no spaces or quotes');
  wowRunning(inst);
  inst.writeStdin(`account set password ${name} ${req.body.password} ${req.body.password}`);
  inst.appendConsole(`[accounts] ${req.user.username} changed the password of ${name.toUpperCase()}`);
  res.json({ ok: true });
});

router.post('/servers/:id/wow/accounts/:name/gmlevel', async (req, res) => {
  const inst = wowOnly(load(req, 'settings'));
  if (!games.wow.NAME_RE.test(req.params.name)) throw new HttpError(400, 'Invalid account');
  const level = gm(req.body.gmlevel);
  wowRunning(inst);
  inst.writeStdin(`account set gmlevel ${req.params.name} ${level}`);
  inst.appendConsole(`[accounts] ${req.user.username} set ${req.params.name.toUpperCase()} to GM level ${level}`);
  res.json({ ok: true });
});

router.delete('/servers/:id/wow/accounts/:name', async (req, res) => {
  const inst = wowOnly(load(req, 'settings'));
  if (!games.wow.NAME_RE.test(req.params.name)) throw new HttpError(400, 'Invalid account');
  wowRunning(inst);
  inst.writeStdin(`account delete ${req.params.name}`);
  inst.appendConsole(`[accounts] ${req.user.username} deleted game account ${req.params.name.toUpperCase()}`);
  res.json({ ok: true });
});

// ---- per-server user access (admin) ----
router.put('/servers/:id/access', auth.requireAdmin, (req, res) => {
  const inst = load(req);
  const { userId, perms } = req.body || {};
  const user = db.data.users.find((u) => u.id === userId);
  if (!user) throw new HttpError(404, 'User not found');
  inst.server.access = inst.server.access || {};
  const clean = (Array.isArray(perms) ? perms : []).filter((p) => auth.PERMS.includes(p));
  if (req.body.remove) delete inst.server.access[userId];
  else inst.server.access[userId] = clean;
  db.save();
  res.json({ ok: true });
});

module.exports = router;
