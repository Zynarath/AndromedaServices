'use strict';
// Rust dedicated server (SteamCMD app 258550), optionally modded with uMod (Oxide).
// Everything is set on the command line; the world and the server's own users.cfg/bans live in
// server/<identity>. The console, player list and clean shutdown use Rust's WebRCON, which the
// panel keeps on this PC only.
// uMod plugins are single .cs files in oxide/plugins; Oxide compiles and (re)loads them while the
// server runs, so adding, updating or removing a plugin needs no restart. Switched-off plugins wait
// in oxide/plugins.disabled. Their settings are JSON files in oxide/config (and their chat messages
// in oxide/lang/en), edited in the panel with readable names.
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const steamcmd = require('../services/steamcmd');
const umod = require('../services/umod');
const fields = require('../util/fields');
const modconfig = require('../util/modconfig');
const { HttpError, randomPassword, splitArgs } = require('../util/misc');

// Rust's WebRCON: JSON messages over a WebSocket at ws://host:port/<password>. One short-lived
// connection per command keeps it simple and survives server restarts.
const webrcon = (() => {
  let nextId = 1000;

  function command(host, port, password, cmd, { timeout = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      const id = (nextId = nextId >= 1e9 ? 1000 : nextId + 1);
      let ws;
      try {
        ws = new WebSocket(`ws://${host}:${port}/${encodeURIComponent(password)}`, { handshakeTimeout: timeout });
      } catch (err) {
        return reject(err);
      }
      let done = false;
      const finish = (err, val) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          ws.terminate();
        } catch {}
        err ? reject(err) : resolve(val);
      };
      const timer = setTimeout(() => finish(new Error('Rust RCON did not answer')), timeout);
      ws.on('open', () => ws.send(JSON.stringify({ Identifier: id, Message: cmd, Name: 'Andromeda' })));
      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }
        if (msg.Identifier === id) finish(null, String(msg.Message ?? ''));
      });
      ws.on('unexpected-response', (_req, res) => finish(new Error(res.statusCode === 401 || res.statusCode === 403 ? 'Rust rejected the RCON password' : `Rust RCON answered HTTP ${res.statusCode}`)));
      ws.on('error', (err) => finish(err));
      ws.on('close', () => finish(new Error('Rust RCON closed the connection')));
    });
  }

  // "playerlist" answers with a JSON array of { SteamID, DisplayName, Ping, ... }.
  function parsePlayers(out) {
    try {
      const list = JSON.parse(out);
      if (Array.isArray(list)) return list.map((p) => String(p.DisplayName || p.SteamID || '?'));
    } catch {}
    return [];
  }
  return { command, parsePlayers };
})();

const APP_ID = 258550;
const EXE = { win32: 'RustDedicated.exe', linux: 'RustDedicated' };
const IDENTITY_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAPS = [
  ['Procedural Map', 'Procedural map (from the seed and size below)'],
  ['Barren', 'Barren (procedural, few monuments)'],
  ['HapisIsland', 'Hapis Island'],
  ['CraftingIsland', 'Crafting Island (tiny test map)'],
  ['SavasIsland', 'Savas Island'],
  ['SavasIsland_koth', 'Savas Island (King of the Hill)'],
  ['custom', 'Custom map (from a URL)'],
];

const GROUPS = ['Server', 'Map', 'Gameplay', 'uMod', 'Ports', 'Advanced'];
const FIELDS = [
  { name: 'hostname', label: 'Name in the server list', type: 'text', group: 'Server', maxLength: 128, required: true },
  { name: 'description', label: 'Description', type: 'textarea', group: 'Server', maxLength: 1000, hint: 'Shown when players look at the server in the browser.' },
  { name: 'url', label: 'Website', type: 'text', group: 'Server', maxLength: 300, pattern: /^https?:\/\/\S+$/, patternHint: 'a http(s):// address' },
  { name: 'headerImage', label: 'Header image URL', type: 'text', group: 'Server', maxLength: 300, pattern: /^https?:\/\/\S+$/, patternHint: 'a http(s):// address', hint: '512 × 256 picture shown above the description.' },
  { name: 'maxPlayers', label: 'Max players', type: 'number', group: 'Server', min: 1, max: 500, def: 50 },
  { name: 'level', label: 'Map', type: 'select', group: 'Map', def: 'Procedural Map', options: MAPS },
  { name: 'seed', label: 'Map seed', type: 'number', group: 'Map', min: 1, max: 2147483647, def: 1337, hint: 'A different seed makes a different map (players start over on it).' },
  { name: 'worldSize', label: 'Map size', type: 'number', group: 'Map', min: 1000, max: 6000, def: 3500, hint: '3000–4500 suits most servers. Bigger maps use more memory and take longer to generate.' },
  { name: 'levelUrl', label: 'Custom map URL', type: 'text', group: 'Map', maxLength: 500, pattern: /^https?:\/\/\S+\.map(\?\S*)?$/i, patternHint: 'a http(s):// link to a .map file', hint: 'Only with "Custom map". Players download it from this address when they join.' },
  { name: 'pve', label: 'PvE (players can\'t hurt each other)', type: 'bool', group: 'Gameplay', def: false },
  { name: 'saveInterval', label: 'Save the world every (seconds)', type: 'number', group: 'Gameplay', min: 60, max: 3600, def: 300, hint: 'The panel also saves on every stop and before backups.' },
  { name: 'oxide', label: 'Use uMod (Oxide) plugins', type: 'bool', group: 'uMod', def: true, hint: 'Installed with the server and again after every game update. Turn off for a vanilla server (Reinstall then removes uMod).' },
  { name: 'port', label: 'Game port (UDP)', type: 'number', group: 'Ports', min: 1024, max: 65535, def: 28015, required: true },
  { name: 'queryPort', label: 'Query port (UDP, server browser)', type: 'number', group: 'Ports', min: 1024, max: 65535, def: 28017, required: true },
  { name: 'rconPort', label: 'RCON port (TCP, this PC only)', type: 'number', group: 'Ports', min: 1024, max: 65535, def: 28016, required: true, hint: 'The panel\'s console uses it. Never forward it.' },
  { name: 'appPort', label: 'Rust+ companion app port (TCP, 0 = off)', type: 'number', group: 'Ports', min: 0, max: 65535, def: 28082 },
  { name: 'identity', label: 'Save folder name', type: 'text', group: 'Advanced', admin: true, maxLength: 40, def: 'andromeda', required: true, pattern: IDENTITY_RE, patternHint: 'letters, numbers, - and _', hint: 'Admin only. The world, users.cfg and bans are in server/<this name>. A new name starts a fresh server.' },
  { name: 'rconPassword', label: 'RCON password', type: 'text', group: 'Advanced', admin: true, maxLength: 64, required: true, pattern: /^[A-Za-z0-9_\-!@#$%^*.]{8,64}$/, patternHint: '8+ letters, numbers or -_!@#$%^*.', hint: 'Admin only. RCON only listens on this PC.' },
  { name: 'branch', label: 'Game version', type: 'select', group: 'Advanced', admin: true, def: '', options: [['', 'Release (default)'], ['staging', 'Staging (test branch)']], hint: 'Admin only. Applies on the next update; players need the same branch. uMod is made for Release.' },
  { name: 'extraArgs', label: 'Extra command-line arguments', type: 'text', group: 'Advanced', admin: true, maxLength: 1000, hint: 'Admin only. e.g. +decay.scale 0.5 +server.tags "monthly,vanilla"' },
];

const rs = (server) => server.rust;
const exePath = (server) => (EXE[process.platform] ? path.join(server.dir, EXE[process.platform]) : null);
const saveDir = (server) => path.join(server.dir, 'server', rs(server).identity || 'andromeda');
const oxideDir = (server) => path.join(server.dir, 'oxide');
const pluginsDir = (server) => path.join(oxideDir(server), 'plugins');
const disabledDir = (server) => path.join(oxideDir(server), 'plugins.disabled');
const hasOxide = (server) => fs.existsSync(path.join(server.dir, 'RustDedicated_Data', 'Managed', 'Oxide.Rust.dll'));

const rcon = (server, cmd, opts) => webrcon.command('127.0.0.1', rs(server).rconPort, rs(server).rconPassword, cmd, opts);

function checkPorts(s) {
  const ports = [s.port, s.queryPort, s.rconPort, s.appPort].filter(Boolean);
  if (new Set(ports).size !== ports.length) throw new HttpError(400, 'The game, query, RCON and Rust+ ports must all be different');
  if (s.level === 'custom' && !s.levelUrl) throw new HttpError(400, 'Enter the custom map\'s URL (Map → Custom map URL)');
}

// ---- plugins ----
function pluginName(name) {
  const n = String(name || '').replace(/\.cs$/i, '');
  if (!umod.NAME_RE.test(n)) throw new HttpError(400, 'Invalid plugin name');
  return n;
}

function readPlugin(file) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(st.size, 64 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return { info: umod.parseInfo(buf.toString('utf8')), size: st.size, mtime: st.mtimeMs };
  } catch {
    return null;
  }
}

function listPluginsIn(server, dir, enabled) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => /\.cs$/i.test(f));
  } catch {}
  return names.map((f) => {
    const name = f.replace(/\.cs$/i, '');
    const r = readPlugin(path.join(dir, f)) || {};
    const info = r.info || {};
    return {
      name,
      title: info.title || modconfig.humanize(name),
      author: info.author || '',
      version: info.version || '',
      description: info.description || '',
      enabled,
      size: r.size || 0,
      updatedAt: r.mtime || null,
      hasConfig: fs.existsSync(path.join(oxideDir(server), 'config', `${name}.json`)),
    };
  });
}

// Config files the panel edits: oxide/config/<Plugin>.json and oxide/lang/en/<Plugin>.json.
function configFiles(server) {
  const out = [];
  for (const [rel, label] of [['config', 'Settings'], ['lang/en', 'Messages (English)']]) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(oxideDir(server), ...rel.split('/'))).filter((f) => /\.json$/i.test(f));
    } catch {}
    for (const f of names) {
      const plugin = f.replace(/\.json$/i, '');
      if (umod.NAME_RE.test(plugin)) out.push({ file: `${rel}/${f}`, plugin, label });
    }
  }
  return out;
}

function configPath(server, file) {
  // Only files the scan lists: no other paths can be read or written this way.
  const c = configFiles(server).find((x) => x.file === file);
  if (!c) throw new HttpError(404, 'Config file not found');
  return { ...c, full: path.join(oxideDir(server), ...file.split('/')) };
}

function copyIfExists(from, to, filter) {
  if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true, filter });
}

const rust = {
  id: 'rust',
  name: 'Rust',
  consoleMode: 'rcon',
  stopTimeoutMs: 120000,
  readyPattern: /Server startup complete/,
  FIELDS,
  webrcon,

  defaults(input) {
    const v = input.rust || {};
    return fields.defaults(FIELDS, {
      ...v,
      hostname: v.hostname || input.name,
      seed: v.seed || Math.floor(Math.random() * 2147483646) + 1,
      oxide: v.oxide ?? v.source !== 'vanilla',
      identity: v.identity && IDENTITY_RE.test(v.identity) ? v.identity : 'andromeda',
      rconPassword: v.rconPassword || randomPassword(16),
    });
  },

  ports(server) {
    const s = rs(server);
    const out = [
      { port: s.port, proto: 'UDP', label: 'Game', forward: true },
      { port: s.queryPort, proto: 'UDP', label: 'Server browser', forward: true },
      { port: s.rconPort, proto: 'TCP', label: 'RCON (keep closed)', forward: false },
    ];
    if (s.appPort) out.push({ port: s.appPort, proto: 'TCP', label: 'Rust+ app', forward: true });
    return out;
  },

  connectAddress(server, host) {
    return `${host}:${rs(server).port}`;
  },

  describe(server) {
    const s = rs(server);
    const map = s.level === 'custom' ? 'Custom map' : s.level === 'Procedural Map' || s.level === 'Barren' ? `${s.level === 'Barren' ? 'Barren' : 'Procedural'} ${s.worldSize}` : (MAPS.find((m) => m[0] === s.level) || [, s.level])[1];
    return { game: s.oxide ? 'Rust (uMod)' : 'Rust', detail: `${map} · ${s.maxPlayers} players` };
  },

  async install(server, log, opts = {}) {
    if (!EXE[process.platform]) throw new Error('The Rust dedicated server runs on Windows and Linux.');
    const s = rs(server);
    log.info(`${opts.isUpdate ? 'Updating' : 'Installing'} the Rust dedicated server via SteamCMD (app ${APP_ID}${s.branch ? `, branch ${s.branch}` : ''}).`);
    if (!opts.isUpdate) log.info('The first install downloads about 10 GB.');
    // A game update replaces the files uMod patches, so a vanilla server gets validated back to
    // stock and a modded one gets uMod again right after.
    const validate = !!opts.validate || (!s.oxide && hasOxide(server));
    await steamcmd.appUpdate(APP_ID, server.dir, { validate, log, extra: s.branch ? ['-beta', s.branch] : [] });
    if (s.oxide) {
      s.oxideVersion = await umod.installOxide(server.dir, log);
      s.oxideInstalledAt = Date.now();
    } else s.oxideVersion = null;
    fs.mkdirSync(saveDir(server), { recursive: true });
    log.info(`Rust is installed${s.oxide ? ' with uMod' : ''}.`);
  },

  // Only uMod, without updating the game (e.g. a new Oxide build for the current Rust version).
  async installOxide(server, log) {
    if (!fs.existsSync(exePath(server) || '')) throw new HttpError(400, 'Install the server first');
    rs(server).oxideVersion = await umod.installOxide(server.dir, log);
    rs(server).oxideInstalledAt = Date.now();
  },

  async buildLaunch(server) {
    const s = rs(server);
    const exe = exePath(server);
    if (!exe) throw new HttpError(400, 'Rust servers run on Windows and Linux.');
    if (!fs.existsSync(exe)) throw new HttpError(400, 'Server files are missing. Use Reinstall in Settings.');
    checkPorts(s);
    if (s.oxide && !hasOxide(server)) throw new HttpError(400, 'uMod is turned on but not installed. Use "Install uMod" in the Mods tab, or Reinstall.');
    fs.mkdirSync(saveDir(server), { recursive: true });
    const logFile = path.join(server.dir, 'logs', 'andromeda-server.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const args = [
      '-batchmode', '-nographics',
      '-logfile', logFile,
      '+server.ip', '0.0.0.0',
      '+server.port', String(s.port),
      '+server.queryport', String(s.queryPort),
      '+server.identity', s.identity,
      '+server.hostname', s.hostname,
      '+server.maxplayers', String(s.maxPlayers),
      '+server.saveinterval', String(s.saveInterval || 300),
      '+server.pve', s.pve ? 'true' : 'false',
      '+rcon.ip', '127.0.0.1',
      '+rcon.port', String(s.rconPort),
      '+rcon.password', s.rconPassword,
      '+rcon.web', '1',
      '+app.port', s.appPort ? String(s.appPort) : '-1',
    ];
    if (s.level === 'custom') args.push('+server.levelurl', s.levelUrl);
    else args.push('+server.level', s.level, '+server.seed', String(s.seed), '+server.worldsize', String(s.worldSize));
    if (s.description) args.push('+server.description', s.description.replace(/\n/g, '\\n'));
    if (s.url) args.push('+server.url', s.url);
    if (s.headerImage) args.push('+server.headerimage', s.headerImage);
    args.push(...splitArgs(s.extraArgs));
    const env = {};
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [server.dir, path.join(server.dir, 'RustDedicated_Data', 'Plugins', 'x86_64'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    return { command: exe, args, cwd: server.dir, env, logFile };
  },

  // A second sign of life in case the log line changes between versions.
  async probeReady(server) {
    const out = await rcon(server, 'serverinfo');
    if (!/"Hostname"/.test(out)) throw new Error('not ready yet');
    return true;
  },

  async stop(instance) {
    try {
      await rcon(instance.server, 'server.save', { timeout: 60000 });
      instance.appendConsole('[panel] World saved, shutting down...');
      await rcon(instance.server, 'quit', { timeout: 5000 }).catch(() => {}); // the connection drops as it quits
    } catch (err) {
      instance.appendConsole(`[panel] RCON unavailable (${err.message}); stopping the process.`);
      instance.kill();
    }
  },

  async sendCommand(instance, command) {
    const out = await rcon(instance.server, command.replace(/^\//, ''));
    instance.appendConsole(`[rcon] ${out.trim() || '(no response)'}`);
    return out;
  },

  broadcastCommand(msg) {
    return `say "${String(msg).replace(/"/g, "'")}"`;
  },

  async beforeBackup(instance) {
    await rcon(instance.server, 'server.save', { timeout: 60000 }).catch(() => {});
  },

  async query(server) {
    const players = webrcon.parsePlayers(await rcon(server, 'playerlist'));
    return { online: players.length, max: rs(server).maxPlayers || 50, players };
  },

  // The world (server/<identity>) and everything uMod keeps (plugins, their settings and data).
  // The game itself comes back with Reinstall.
  backupConfig(server) {
    return { root: server.dir, ignore: [] };
  },

  async prepareBackup(_instance, staging) {
    const server = _instance.server;
    copyIfExists(saveDir(server), path.join(staging, 'server', rs(server).identity));
    copyIfExists(oxideDir(server), path.join(staging, 'oxide'), (src) => !src.startsWith(path.join(oxideDir(server), 'logs')));
  },

  async restoreBackup(instance, from, log) {
    const server = instance.server;
    for (const top of ['server', 'oxide']) {
      const src = path.join(from, top);
      if (!fs.existsSync(src)) continue;
      if (top === 'server') {
        for (const id of fs.readdirSync(src)) {
          if (!IDENTITY_RE.test(id)) continue;
          log.info(`Restoring the world in server/${id}`);
          fs.rmSync(path.join(server.dir, 'server', id), { recursive: true, force: true });
          fs.cpSync(path.join(src, id), path.join(server.dir, 'server', id), { recursive: true });
        }
      } else {
        log.info('Restoring uMod plugins, their settings and data');
        for (const sub of fs.readdirSync(src)) {
          if (sub === 'logs') continue;
          fs.rmSync(path.join(oxideDir(server), sub), { recursive: true, force: true });
          fs.cpSync(path.join(src, sub), path.join(oxideDir(server), sub), { recursive: true });
        }
      }
    }
  },

  settingsSchema() {
    return {
      note: 'Rust reads these from its command line, so changes apply on the next (re)start. The world is kept in server/<save folder name>. Plugins and their settings are in the Mods and Mod configuration tabs.',
      sections: fields.schema('rust', FIELDS, GROUPS, { collapsed: ['Ports', 'Advanced'] }),
    };
  },

  readSettings(server) {
    return fields.read('rust', FIELDS, rs(server));
  },

  writeSettings(server, values, opts = {}) {
    const changes = fields.parse('rust', FIELDS, values, opts);
    checkPorts({ ...rs(server), ...changes });
    Object.assign(rs(server), changes);
    return { restartRequired: true };
  },

  // ---- uMod plugins ----
  listPlugins(server) {
    return [...listPluginsIn(server, pluginsDir(server), true), ...listPluginsIn(server, disabledDir(server), false)].sort((a, b) => a.title.localeCompare(b.title));
  },

  oxideStatus(server) {
    return { enabled: !!rs(server).oxide, installed: hasOxide(server), version: rs(server).oxideVersion || null, installedAt: rs(server).oxideInstalledAt || null };
  },

  // Write a plugin's source. Oxide notices the new file and (re)loads it within a few seconds.
  installPlugin(server, name, source) {
    const n = pluginName(name);
    const info = umod.checkSource(source, n);
    fs.mkdirSync(pluginsDir(server), { recursive: true });
    fs.rmSync(path.join(disabledDir(server), `${n}.cs`), { force: true });
    fs.writeFileSync(path.join(pluginsDir(server), `${n}.cs`), source);
    return { name: n, title: info.title, version: info.version };
  },

  setPluginEnabled(server, name, enabled) {
    const n = pluginName(name);
    const from = path.join(enabled ? disabledDir(server) : pluginsDir(server), `${n}.cs`);
    const to = path.join(enabled ? pluginsDir(server) : disabledDir(server), `${n}.cs`);
    if (!fs.existsSync(from)) {
      if (fs.existsSync(to)) return;
      throw new HttpError(404, 'Plugin not found');
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  },

  // Its settings and data stay unless `purge`, so putting it back later keeps them.
  removePlugin(server, name, { purge = false } = {}) {
    const n = pluginName(name);
    let found = false;
    for (const dir of [pluginsDir(server), disabledDir(server)]) {
      const p = path.join(dir, `${n}.cs`);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { force: true });
        found = true;
      }
    }
    if (!found) throw new HttpError(404, 'Plugin not found');
    if (purge) {
      for (const rel of [['config', `${n}.json`], ['lang', 'en', `${n}.json`], ['data', `${n}.json`], ['data', n]]) fs.rmSync(path.join(oxideDir(server), ...rel), { recursive: true, force: true });
    }
  },

  // ---- plugin configuration (Mod configuration tab) ----
  async listModConfigs(server) {
    const plugins = new Map(rust.listPlugins(server).map((p) => [p.name, p]));
    const groups = new Map();
    for (const c of configFiles(server)) {
      const p = plugins.get(c.plugin);
      const g = groups.get(c.plugin) || { id: c.plugin, name: p ? p.title : modconfig.humanize(c.plugin), modId: null, url: null, image: null, installed: !!p, enabled: p ? p.enabled : false, files: [] };
      g.files.push({ file: c.file, label: c.label, format: 'json' });
      groups.set(c.plugin, g);
    }
    for (const g of groups.values()) g.files.sort((a, b) => (a.label === 'Settings' ? -1 : b.label === 'Settings' ? 1 : 0));
    const noConfig = [...plugins.values()].filter((p) => !groups.has(p.name)).map((p) => p.title);
    return {
      kind: 'plugins',
      note: 'Settings of your uMod plugins, with readable names (hover a setting to see its name in the file). Plugins write their settings the first time they load, so start the server once after adding one. While the server runs, saving reloads the plugin so changes apply at once.',
      mods: [...groups.values()].sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name)),
      hidden: noConfig,
    };
  },

  readModConfig(server, file) {
    const c = configPath(server, file);
    const text = fs.readFileSync(c.full, 'utf8');
    const d = modconfig.describe(file, text, { normalize: true });
    return { file, format: d.format, where: c.label, raw: text, fields: d.fields && d.fields.map(({ line, start, raw, path: p, ...f }) => f) };
  },

  writeModConfig(server, file, { values, raw }) {
    const c = configPath(server, file);
    if (typeof raw === 'string') {
      try {
        JSON.parse(raw.replace(/^﻿/, ''));
      } catch (err) {
        throw new HttpError(400, `Not valid JSON, so the plugin couldn't read it: ${err.message}`);
      }
      fs.writeFileSync(c.full, raw);
      return { changed: 1 };
    }
    let r;
    try {
      r = modconfig.apply(file, fs.readFileSync(c.full, 'utf8'), values || {}, { normalize: true });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    if (r.changed) fs.writeFileSync(c.full, r.text);
    return { changed: r.changed };
  },

  // A running server picks up new settings by reloading just that plugin.
  async modConfigChanged(instance, file) {
    const c = configPath(instance.server, file);
    if (!fs.existsSync(path.join(pluginsDir(instance.server), `${c.plugin}.cs`))) return { reloaded: false };
    await rcon(instance.server, `oxide.reload ${c.plugin}`);
    instance.appendConsole(`[mods] Reloaded ${c.plugin} with its new settings`);
    return { reloaded: true };
  },
};

module.exports = rust;
