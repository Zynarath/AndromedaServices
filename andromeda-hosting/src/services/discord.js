'use strict';
// Discord integration: a bot posts server news to a "Server Updates" channel and keeps one
// text channel per game server (named after the server), where that server's events go.
// Uses only Discord's REST API, so no extra dependencies or always-on gateway connection.
const db = require('../db');
const logger = require('../util/log');
const { sleep, HttpError } = require('../util/misc');
const { games } = require('../games');

const log = logger('discord');
const API = () => process.env.ANDROMEDA_DISCORD_API || 'https://discord.com/api/v10';
// View Channels + Send Messages + Embed Links + Manage Channels
const BOT_PERMISSIONS = 1024 + 2048 + 16384 + 16;
const COLORS = { ok: 0x3fc97a, off: 0x7d889b, bad: 0xf2555a, info: 0x5aa9ff, warn: 0xf2b543 };

const state = { error: null, lastPost: null, bot: null };
let manager = null;

function settings() {
  const d = db.data.settings.discord || {};
  return {
    enabled: !!d.enabled,
    token: d.token || '',
    guildId: d.guildId || '',
    updatesChannelId: d.updatesChannelId || '',
    categoryId: d.categoryId || '',
    perServerChannels: d.perServerChannels !== false,
    playerEvents: d.playerEvents !== false,
    backupEvents: d.backupEvents !== false,
    includePassword: !!d.includePassword,
  };
}

// ---- REST with rate-limit handling, one request at a time ----
let chain = Promise.resolve();
function call(method, path, body, token = settings().token) {
  const run = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(API() + path, {
        method,
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'Andromeda Hosting (https://github.com, 1.0)' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        const j = await res.json().catch(() => ({}));
        await sleep(Math.min(30, Number(j.retry_after) || 1) * 1000 + 100);
        continue;
      }
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const reason = res.status === 401 ? 'the bot token is invalid' : res.status === 403 ? 'the bot is missing a permission (it needs View Channels, Send Messages, Embed Links and Manage Channels)' : (json && json.message) || `HTTP ${res.status}`;
        const err = new Error(`Discord: ${reason}`);
        err.status = res.status;
        throw err;
      }
      return json;
    }
    throw new Error('Discord: rate limited, try again later');
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

// Discord text channel names are lowercase with dashes: "Ark SE Server 1" -> "ark-se-server-1"
function channelName(name) {
  return (
    String(name)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'game-server'
  );
}

// ---- setup helpers used by the settings page ----
async function botInfo(token) {
  const me = await call('GET', '/users/@me', null, token);
  let appId = me.id;
  try {
    appId = (await call('GET', '/oauth2/applications/@me', null, token)).id || me.id;
  } catch {}
  return { id: me.id, name: me.username, appId, inviteUrl: `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${BOT_PERMISSIONS}` };
}

async function overview() {
  const s = settings();
  const out = { ...publicSettings(), bot: null, guilds: [], channels: [], categories: [] };
  if (!s.token) return out;
  try {
    out.bot = await botInfo(s.token);
    state.bot = out.bot;
    out.guilds = (await call('GET', '/users/@me/guilds')).map((g) => ({ id: g.id, name: g.name }));
    const guildId = s.guildId || (out.guilds.length === 1 ? out.guilds[0].id : '');
    if (guildId) {
      const chans = await call('GET', `/guilds/${guildId}/channels`);
      out.channels = chans.filter((c) => c.type === 0).sort((a, b) => a.position - b.position).map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id }));
      out.categories = chans.filter((c) => c.type === 4).sort((a, b) => a.position - b.position).map((c) => ({ id: c.id, name: c.name }));
      out.guildId = guildId;
      if (!out.updatesChannelId) {
        const guess = out.channels.find((c) => /server-?updates?/.test(c.name.replace(/[^a-z-]/g, '')));
        if (guess) out.suggestedUpdatesChannelId = guess.id;
      }
    }
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

function publicSettings() {
  const s = settings();
  const { token, ...rest } = s;
  return { ...rest, tokenSet: !!token, lastError: state.error, lastPost: state.lastPost };
}

// ---- per-server channels ----
async function ensureChannel(server) {
  const s = settings();
  if (!s.enabled || !s.perServerChannels || !s.guildId) return null;
  server.discord = server.discord || {};
  const want = channelName(server.name);
  if (server.discord.channelId) {
    try {
      const ch = await call('GET', `/channels/${server.discord.channelId}`);
      if (ch.name !== want) await call('PATCH', `/channels/${ch.id}`, { name: want });
      return ch.id;
    } catch (err) {
      if (err.status !== 404) throw err;
      server.discord.channelId = null; // deleted in Discord: make a new one
    }
  }
  // Reuse an existing channel with the same name (e.g. after reinstalling the panel).
  const chans = await call('GET', `/guilds/${s.guildId}/channels`);
  let ch = chans.find((c) => c.type === 0 && c.name === want);
  if (!ch) {
    let parent = s.categoryId || null;
    if (!parent && s.updatesChannelId) parent = (chans.find((c) => c.id === s.updatesChannelId) || {}).parent_id || null;
    ch = await call('POST', `/guilds/${s.guildId}/channels`, { name: want, type: 0, parent_id: parent, topic: `${describe(server)} — updates from Andromeda Hosting` });
    log.info(`Created Discord channel #${want} for ${server.name}`);
  }
  server.discord.channelId = ch.id;
  db.save();
  return ch.id;
}

function describe(server) {
  if (server.ark) return games.ark.EDITIONS[server.ark.edition].label + ' · ' + server.ark.map;
  if (server.wow) return `WoW: Wrath of the Lich King · realm ${server.wow.realmName || server.name}`;
  if (server.cod) {
    const t = games.cod.TITLES[server.cod.title];
    return `${t.label} · ${(t.gametypes.find((g) => g[0] === server.cod.gametype) || [])[1] || server.cod.gametype}`;
  }
  if (server.mc && server.mc.source === 'curseforge') return `${server.mc.curseforge?.packName || 'Modpack'} · Minecraft ${server.mc.mcVersion || ''}`;
  if (server.mc) return `Minecraft ${server.mc.mcVersion || ''} ${server.mc.loader || ''}`;
  return server.game;
}

function address(server) {
  const host = db.data.settings.publicAddress;
  return host ? games[server.game].connectAddress(server, host) : null;
}

/**
 * Post an event. where: 'server' (its own channel), 'updates' (Server Updates) or 'both'.
 */
async function post(server, { title, description, color = 'info', fields = [], where = 'both' }) {
  const s = settings();
  if (!s.enabled || !s.token) return;
  const embed = {
    title,
    description,
    color: COLORS[color] || COLORS.info,
    fields: fields.filter((f) => f && f.value).map((f) => ({ name: f.name, value: String(f.value).slice(0, 1000), inline: f.inline !== false })),
    timestamp: new Date().toISOString(),
    footer: { text: server ? describe(server) : 'Andromeda Hosting' },
  };
  const targets = new Set();
  if ((where === 'updates' || where === 'both') && s.updatesChannelId) targets.add(s.updatesChannelId);
  if ((where === 'server' || where === 'both') && server && s.perServerChannels) {
    try {
      const id = await ensureChannel(server);
      if (id) targets.add(id);
    } catch (err) {
      state.error = err.message;
      log.warn(`Could not prepare a channel for ${server.name}: ${err.message}`);
    }
  }
  for (const channelId of targets) {
    try {
      await call('POST', `/channels/${channelId}/messages`, { embeds: [embed], allowed_mentions: { parse: [] } });
      state.lastPost = Date.now();
      state.error = null;
    } catch (err) {
      state.error = err.message;
      log.warn(err.message);
    }
  }
}

// ---- turning panel events into messages ----
const lastStatus = new Map();
const lastPlayers = new Map();

function onStatus(id, status) {
  const inst = manager.instances.get(id);
  if (!inst) return;
  const server = inst.server;
  const prev = lastStatus.get(id);
  lastStatus.set(id, status);
  if (status === 'running') {
    const fields = [{ name: 'Join', value: address(server) ? `\`${address(server)}\`` : null }];
    if (server.ark) {
      fields.push({ name: 'Map', value: server.ark.map });
      if (server.ark.settings.ServerPassword) fields.push({ name: 'Password', value: s().includePassword ? `||${server.ark.settings.ServerPassword}||` : 'Required (ask in the group)' });
      if (server.ark.mods.length) fields.push({ name: 'Mods', value: String(server.ark.mods.length) });
    }
    if (server.cod) {
      const t = games.cod.TITLES[server.cod.title];
      fields.push({ name: 'Mode', value: (t.gametypes.find((g) => g[0] === server.cod.gametype) || [])[1] || server.cod.gametype });
      fields.push({ name: 'XP', value: `${server.cod.xpScale}x${t.weaponXp ? ` · weapon ${server.cod.weaponXpScale}x` : ''}` });
      if (server.cod.bots.enabled) fields.push({ name: 'Bots', value: `fill to ${server.cod.bots.fill}` });
      if (server.cod.password) fields.push({ name: 'Password', value: s().includePassword ? `||${server.cod.password}||` : 'Required (ask in the group)' });
    }
    if (server.wow) {
      fields.push({ name: 'Realmlist', value: `\`set realmlist ${server.wow.address || db.data.settings.publicAddress || '127.0.0.1'}\`` });
      fields[0].value = null; // the "Join" host:port doesn't apply to WoW
    }
    if (server.mc) fields.push({ name: 'Version', value: `${server.mc.mcVersion || ''} ${server.mc.loader !== 'vanilla' ? server.mc.loader : ''}`.trim() });
    post(server, { title: `🟢 ${server.name} is online`, color: 'ok', fields });
  } else if (status === 'stopped' && prev && prev !== 'stopped' && prev !== 'installing') {
    post(server, { title: `⚫ ${server.name} is offline`, color: 'off' });
  } else if (status === 'crashed') {
    post(server, {
      title: `🔴 ${server.name} crashed`,
      description: server.autoRestart ? 'Auto-restart is on — trying again in 10 seconds.' : 'Auto-restart is off. Start it from the panel.',
      color: 'bad',
    });
  }
}

function onJob(id, job) {
  if (job.status === 'running') return;
  const inst = manager.instances.get(id);
  if (!inst || inst.__lastJobPosted === job.id + job.status) return;
  inst.__lastJobPosted = job.id + job.status;
  const server = inst.server;
  const failed = job.status === 'failed';
  if (job.type === 'backup') {
    if (failed) post(server, { title: `⚠️ Backup failed: ${server.name}`, description: job.error, color: 'warn' });
    else if (s().backupEvents) post(server, { title: `💾 Backup saved`, description: job.label, color: 'info', where: 'server' });
    return;
  }
  if (!['install', 'update', 'restore'].includes(job.type)) return;
  const what = job.type === 'install' ? job.label : job.type === 'restore' ? 'Backup restore' : job.label;
  let description = failed ? job.error : undefined;
  if (!failed && server.mc && server.mc.curseforge && job.type !== 'restore') description = `${server.mc.curseforge.packName || ''} ${server.mc.curseforge.versionName || ''}`.trim();
  post(server, { title: `${failed ? '❌' : '✅'} ${what} ${failed ? 'failed' : 'finished'}: ${server.name}`, description, color: failed ? 'bad' : 'ok' });
}

function onPlayers(id, players) {
  const inst = manager.instances.get(id);
  if (!inst || !players || !Array.isArray(players.players)) return;
  const now = new Set(players.players);
  const before = lastPlayers.get(id);
  lastPlayers.set(id, now);
  if (!before || !s().playerEvents) return; // first sample after start: don't announce everyone
  const joined = [...now].filter((p) => !before.has(p));
  const left = [...before].filter((p) => !now.has(p));
  if (!joined.length && !left.length) return;
  const lines = [...joined.map((p) => `➕ **${p}** joined`), ...left.map((p) => `➖ **${p}** left`)];
  post(inst.server, { title: `${players.online}/${players.max} players online`, description: lines.join('\n'), color: 'info', where: 'server' });
}

const s = settings;

// Daily-ish check for new CurseForge modpack versions.
async function checkModpackUpdates() {
  if (!settings().enabled) return;
  const cf = require('./curseforge');
  if (!cf.hasKey()) return;
  for (const inst of manager.instances.values()) {
    const mc = inst.server.mc;
    if (!mc || mc.source !== 'curseforge' || !inst.server.installed) continue;
    try {
      const files = await cf.getFiles(mc.curseforge.modId, { pageSize: 10 });
      const latest = files.find((f) => f.releaseType === 1 && !f.isServerPack);
      if (!latest || latest.id === mc.curseforge.fileId || latest.id === mc.curseforge.notifiedFileId) continue;
      mc.curseforge.notifiedFileId = latest.id;
      db.save();
      post(inst.server, {
        title: `⬆️ Modpack update available: ${inst.server.name}`,
        description: `**${latest.displayName}** is out (installed: ${mc.curseforge.versionName || mc.curseforge.fileId}). Update it from the server's Mods tab in the panel.`,
        color: 'warn',
      });
    } catch {}
  }
}

async function syncChannels() {
  const s0 = settings();
  if (!s0.enabled || !s0.perServerChannels) return { synced: 0 };
  let n = 0;
  for (const inst of manager.instances.values()) {
    await ensureChannel(inst.server);
    n++;
  }
  return { synced: n };
}

async function test() {
  const st = settings();
  if (!st.token) throw new HttpError(400, 'Add the bot token first');
  if (!st.updatesChannelId) throw new HttpError(400, 'Pick the Server Updates channel first');
  await call('POST', `/channels/${st.updatesChannelId}/messages`, {
    embeds: [{ title: '👋 Andromeda Hosting is connected', description: `Server news will show up here. Each game server also gets its own channel.`, color: COLORS.ok, timestamp: new Date().toISOString() }],
  });
  state.lastPost = Date.now();
  state.error = null;
}

function init(mgr) {
  manager = mgr;
  for (const inst of manager.instances.values()) lastStatus.set(inst.server.id, inst.status);
  manager.on('status', (id, st) => {
    if (st !== 'running') lastPlayers.delete(id);
    onStatus(id, st);
  });
  manager.on('job', onJob);
  manager.on('players', onPlayers);
  manager.on('created', (id) => {
    const inst = manager.instances.get(id);
    if (!inst) return;
    lastStatus.set(id, inst.status);
    post(inst.server, { title: `🆕 New server: ${inst.server.name}`, description: `${describe(inst.server)} — installing now.`, color: 'info' });
  });
  manager.on('renamed', (id) => {
    const inst = manager.instances.get(id);
    if (inst && settings().enabled) ensureChannel(inst.server).catch((e) => log.warn(e.message));
  });
  manager.on('removed', (id, server) => {
    lastStatus.delete(id);
    if (server) post(null, { title: `🗑️ ${server.name} was deleted`, description: server.discord && server.discord.channelId ? `Its channel <#${server.discord.channelId}> was kept for history.` : undefined, color: 'off', where: 'updates' });
  });
  setTimeout(() => checkModpackUpdates(), 60e3).unref();
  setInterval(() => checkModpackUpdates(), 6 * 3600e3).unref();
}

module.exports = { init, post, overview, publicSettings, syncChannels, test, channelName, ensureChannel, settings, BOT_PERMISSIONS };
