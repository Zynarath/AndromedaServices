'use strict';
const express = require('express');
const os = require('os');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const auth = require('../auth');
const cf = require('../services/curseforge');
const loaders = require('../services/loaders');
const java = require('../services/java');
const ddns = require('../services/ddns');
const discord = require('../services/discord');
const procstats = require('../util/procstats');
const { HttpError } = require('../util/misc');

const router = express.Router();
router.use(['/system', '/settings', '/curseforge', '/minecraft'], auth.requireAuth);

function disk(p) {
  try {
    const s = fs.statfsSync(p);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

router.get('/system', (_req, res) => {
  res.json({
    hostname: os.hostname(),
    platform: process.platform,
    cpuModel: (os.cpus()[0] || {}).model || '',
    cores: os.cpus().length,
    cpu: procstats.systemCpu(),
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    uptime: os.uptime(),
    disk: disk(config.serversDir),
    node: process.version,
    panelPort: config.port,
    lanAddresses: Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address),
    java: java.listInstalled().map((j) => j.major),
  });
});

router.get('/system/public-ip', auth.requireAdmin, async (_req, res) => {
  res.json({ ip: await ddns.publicIp() });
});

router.get('/settings', auth.requireAdmin, (_req, res) => {
  const s = db.data.settings;
  res.json({
    panelName: s.panelName,
    publicAddress: s.publicAddress,
    curseforgeKeySet: !!s.curseforgeApiKey,
    dataDir: config.dataDir,
    serversDir: config.serversDir,
    backupsDir: config.backupsDir,
    ddns: ddns.publicStatus(),
    discord: discord.publicSettings(),
  });
});

router.put('/settings', auth.requireAdmin, (req, res) => {
  const b = req.body || {};
  const s = db.data.settings;
  if (b.panelName !== undefined) s.panelName = String(b.panelName).trim().slice(0, 40) || 'Andromeda Hosting';
  if (b.publicAddress !== undefined) s.publicAddress = String(b.publicAddress).trim().slice(0, 120);
  if (b.curseforgeApiKey !== undefined && b.curseforgeApiKey !== '') s.curseforgeApiKey = String(b.curseforgeApiKey).trim();
  if (b.clearCurseforgeKey) s.curseforgeApiKey = '';
  if (b.discord) {
    const cur = db.data.settings.discord || {};
    const d = { ...cur };
    const x = b.discord;
    if (x.token) {
      d.token = String(x.token).trim().replace(/^Bot\s+/i, '');
      if (d.token !== cur.token) Object.assign(d, { guildId: '', updatesChannelId: '', categoryId: '' });
    }
    if (x.clearToken) Object.assign(d, { token: '', enabled: false });
    for (const k of ['guildId', 'updatesChannelId', 'categoryId']) if (x[k] !== undefined) d[k] = /^\d{0,25}$/.test(String(x[k])) ? String(x[k]) : '';
    for (const k of ['enabled', 'perServerChannels', 'playerEvents', 'backupEvents', 'includePassword']) if (x[k] !== undefined) d[k] = !!x[k];
    if (d.enabled && (!d.token || !d.guildId || !d.updatesChannelId)) throw new HttpError(400, 'Connect the bot and pick your Discord server and Server Updates channel before turning notifications on');
    s.discord = d;
    // Create the per-server channels right away so they show up when notifications are turned on.
    if (d.enabled && !cur.enabled) discord.syncChannels().catch(() => {});
  }
  if (b.ddns) {
    const d = { ...(s.ddns || {}) };
    if (b.ddns.hostnames !== undefined) d.hostnames = ddns.cleanHostnames(b.ddns.hostnames);
    if (b.ddns.token) d.token = String(b.ddns.token).trim();
    if (b.ddns.clearToken) d.token = '';
    if (b.ddns.enabled !== undefined) d.enabled = !!b.ddns.enabled;
    if (d.enabled && (!d.token || !(d.hostnames || []).length)) throw new HttpError(400, 'Dynamic DNS needs a Cloudflare API token and at least one hostname');
    s.ddns = d;
    ddns.reset();
    db.saveNow();
    ddns.start();
  }
  db.save();
  res.json({ ok: true });
});

router.post('/settings/ddns/run', auth.requireAdmin, async (_req, res) => {
  await ddns.runOnce({ force: true });
  res.json(ddns.publicStatus());
});

// ---- self-update ----
const updater = require('../services/updater');
router.get('/settings/updates', auth.requireAdmin, async (_req, res) => res.json(await updater.status()));
router.post('/settings/updates/check', auth.requireAdmin, async (_req, res) => res.json(await updater.check()));
router.post('/settings/updates/apply', auth.requireAdmin, async (_req, res) => res.json(await updater.apply({ reason: 'Update now' })));
router.put('/settings/updates', auth.requireAdmin, async (req, res) => {
  updater.setAuto(req.body && req.body.auto);
  res.json(await updater.status());
});

router.get('/settings/discord', auth.requireAdmin, async (_req, res) => {
  res.json(await discord.overview());
});

router.post('/settings/discord/test', auth.requireAdmin, async (_req, res) => {
  await discord.test();
  res.json({ ok: true });
});

router.post('/settings/discord/sync', auth.requireAdmin, async (_req, res) => {
  res.json(await discord.syncChannels());
});

// ---- CurseForge browsing ----
router.get('/curseforge/search', async (req, res) => {
  const type = req.query.type;
  const q = { query: req.query.q, index: Number(req.query.index) || 0, pageSize: 20 };
  if (type === 'modpack') Object.assign(q, { gameId: cf.GAME_MINECRAFT, classId: cf.CLASS_MODPACK });
  else if (type === 'mcmod') Object.assign(q, { gameId: cf.GAME_MINECRAFT, classId: cf.CLASS_MC_MOD, gameVersion: req.query.gameVersion, loader: req.query.loader });
  else if (type === 'asa') Object.assign(q, { gameId: cf.GAME_ARK_ASCENDED });
  else throw new HttpError(400, 'Unknown search type');
  res.json(await cf.search(q));
});

router.get('/curseforge/mods/:modId/files', async (req, res) => {
  const files = await cf.getFiles(Number(req.params.modId), { pageSize: 50, gameVersion: req.query.gameVersion, loader: req.query.loader });
  res.json({ files: files.filter((f) => !f.isServerPack).map(cf.slimFile) });
});

// ---- Minecraft versions ----
router.get('/minecraft/versions', async (req, res) => {
  res.json({ versions: await loaders.listMcVersions(req.query.snapshots === '1') });
});

router.get('/minecraft/loaders/:loader', async (req, res) => {
  if (!req.query.mc) throw new HttpError(400, 'mc is required');
  res.json({ versions: (await loaders.listLoaderVersions(req.params.loader, String(req.query.mc))).slice(0, 80) });
});

module.exports = router;
