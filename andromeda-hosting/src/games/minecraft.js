'use strict';
const fs = require('fs');
const path = require('path');
const Properties = require('../util/properties');
const { mcPing } = require('../util/mcping');
const { ensureJava, javaMajorFor } = require('../services/java');
const loaders = require('../services/loaders');
const modpack = require('../services/modpack');
const cf = require('../services/curseforge');
const { downloadFile } = require('../util/download');
const { HttpError } = require('../util/misc');

// Well-known G1GC tuning for Minecraft servers (Aikar's flags).
const AIKAR_FLAGS = [
  '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch', '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1',
];

const PROPERTY_FIELDS = [
  { key: 'motd', label: 'Message of the day (MOTD)', type: 'text', group: 'General' },
  { key: 'max-players', label: 'Max players', type: 'number', group: 'General' },
  { key: 'difficulty', label: 'Difficulty', type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'], group: 'Gameplay' },
  { key: 'gamemode', label: 'Default game mode', type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'], group: 'Gameplay' },
  { key: 'hardcore', label: 'Hardcore', type: 'bool', group: 'Gameplay' },
  { key: 'pvp', label: 'PvP', type: 'bool', group: 'Gameplay' },
  { key: 'allow-flight', label: 'Allow flight (recommended for modded)', type: 'bool', group: 'Gameplay' },
  { key: 'spawn-monsters', label: 'Spawn monsters', type: 'bool', group: 'Gameplay' },
  { key: 'allow-nether', label: 'Allow Nether', type: 'bool', group: 'Gameplay' },
  { key: 'enable-command-block', label: 'Enable command blocks', type: 'bool', group: 'Gameplay' },
  { key: 'spawn-protection', label: 'Spawn protection radius', type: 'number', group: 'Gameplay' },
  { key: 'online-mode', label: 'Online mode (verify accounts with Mojang)', type: 'bool', group: 'Access' },
  { key: 'white-list', label: 'Whitelist enabled', type: 'bool', group: 'Access' },
  { key: 'enforce-whitelist', label: 'Kick players not on whitelist', type: 'bool', group: 'Access' },
  { key: 'player-idle-timeout', label: 'Idle kick (minutes, 0 = off)', type: 'number', group: 'Access' },
  { key: 'level-name', label: 'World folder name', type: 'text', group: 'World' },
  { key: 'level-seed', label: 'World seed', type: 'text', group: 'World' },
  { key: 'level-type', label: 'World type', type: 'text', group: 'World', hint: 'minecraft:normal, minecraft:flat, minecraft:large_biomes, minecraft:amplified (some modpacks use their own)' },
  { key: 'view-distance', label: 'View distance (chunks)', type: 'number', group: 'Performance' },
  { key: 'simulation-distance', label: 'Simulation distance (chunks)', type: 'number', group: 'Performance' },
  { key: 'max-tick-time', label: 'Watchdog max tick time (ms, -1 = off)', type: 'number', group: 'Performance' },
  { key: 'sync-chunk-writes', label: 'Sync chunk writes', type: 'bool', group: 'Performance' },
];

// Vanilla defaults, used when a key is missing so the form never shows (and saves) a wrong value.
const PROPERTY_DEFAULTS = {
  motd: 'A Minecraft Server', 'max-players': '20', difficulty: 'easy', gamemode: 'survival', hardcore: 'false', pvp: 'true',
  'allow-flight': 'false', 'spawn-monsters': 'true', 'allow-nether': 'true', 'enable-command-block': 'false', 'spawn-protection': '16',
  'online-mode': 'true', 'white-list': 'false', 'enforce-whitelist': 'false', 'player-idle-timeout': '0', 'level-name': 'world',
  'level-seed': '', 'level-type': 'minecraft:normal', 'view-distance': '10', 'simulation-distance': '10', 'max-tick-time': '60000',
  'sync-chunk-writes': 'true',
};

function propsPath(server) {
  return path.join(server.dir, 'server.properties');
}
function readProps(server) {
  const p = propsPath(server);
  return new Properties(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
}
function writeProps(server, props) {
  fs.writeFileSync(propsPath(server), props.toString());
}

function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(str || ''))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

const minecraft = {
  id: 'minecraft',
  name: 'Minecraft',
  consoleMode: 'stdin',
  stopTimeoutMs: 90000,

  defaults(input) {
    const mc = input.mc || {};
    return {
      source: mc.source === 'curseforge' ? 'curseforge' : 'custom',
      mcVersion: mc.mcVersion || null,
      loader: mc.loader || 'vanilla',
      loaderVersion: mc.loaderVersion || null,
      javaMajor: null,
      memoryMb: Math.max(1024, Number(mc.memoryMb) || 6144),
      port: Number(mc.port) || 25565,
      jvmArgs: '',
      aikarFlags: true,
      curseforge: mc.source === 'curseforge' ? { modId: Number(mc.modId), fileId: Number(mc.fileId) } : null,
      motd: mc.motd || input.name,
      maxPlayers: Number(mc.maxPlayers) || 10,
      // Friends-only by default: whitelist on, names added once the server first runs.
      whitelistDefault: mc.whitelist !== false,
      pendingWhitelist: cleanNames(mc.whitelistNames),
    };
  },

  ports(server) {
    return [{ port: server.mc.port, proto: 'TCP', label: 'Game', forward: true }];
  },

  connectAddress(server, host) {
    return server.mc.port === 25565 ? host : `${host}:${server.mc.port}`;
  },

  prepareProperties(server) {
    const props = readProps(server);
    props.set('server-port', server.mc.port);
    if (props.get('motd') === undefined) props.set('motd', server.mc.motd || server.name);
    if (props.get('max-players') === undefined) props.set('max-players', server.mc.maxPlayers || 10);
    if (props.get('allow-flight') === undefined && server.mc.loader !== 'vanilla') props.set('allow-flight', 'true');
    if (server.mc.whitelistDefault && props.get('white-list') === undefined) {
      props.set('white-list', 'true');
      props.set('enforce-whitelist', 'true');
    }
    writeProps(server, props);
  },

  async install(server, log, opts = {}) {
    const mc = server.mc;
    fs.mkdirSync(server.dir, { recursive: true });
    if (mc.source === 'curseforge') {
      const r = await modpack.installModpack({ dir: server.dir, modId: mc.curseforge.modId, fileId: mc.curseforge.fileId, isUpdate: !!opts.isUpdate, log });
      Object.assign(mc, { mcVersion: r.mcVersion, loader: r.loader, loaderVersion: r.loaderVersion, javaMajor: r.javaMajor });
      Object.assign(mc.curseforge, { packName: r.packName, versionName: r.versionName, manual: r.manual, installedAt: new Date().toISOString() });
    } else {
      if (!mc.mcVersion) mc.mcVersion = (await loaders.listMcVersions())[0];
      mc.javaMajor = await javaMajorFor(mc.mcVersion);
      const java = await ensureJava(mc.javaMajor, log);
      if (opts.isUpdate) loaders.cleanLoader(server.dir);
      log.info(`Installing ${mc.loader} server for Minecraft ${mc.mcVersion}...`);
      const v = await loaders.installLoader(server.dir, { mcVersion: mc.mcVersion, loader: mc.loader, loaderVersion: mc.loaderVersion, java, log });
      if (v) mc.loaderVersion = v;
    }
    if (server.eulaAccepted) fs.writeFileSync(path.join(server.dir, 'eula.txt'), `# Accepted via Andromeda Hosting on ${new Date().toISOString()}\neula=true\n`);
    this.prepareProperties(server);
    if (!loaders.detectLaunch(server.dir)) throw new Error('Install finished but no server jar was found');
    log.info('Minecraft server installed.');
  },

  async buildLaunch(server) {
    const mc = server.mc;
    const launch = loaders.detectLaunch(server.dir);
    if (!launch) throw new HttpError(400, 'No server jar found. Reinstall the server or upload one via Files.');
    const java = await ensureJava(mc.javaMajor || (await javaMajorFor(mc.mcVersion)));
    this.prepareProperties(server);
    if (server.eulaAccepted && !fs.existsSync(path.join(server.dir, 'eula.txt'))) fs.writeFileSync(path.join(server.dir, 'eula.txt'), 'eula=true\n');
    const args = [];
    const modern = (mc.javaMajor || 17) >= 9;
    if (modern && fs.existsSync(path.join(server.dir, 'user_jvm_args.txt'))) args.push('@user_jvm_args.txt');
    args.push(`-Xms${Math.min(mc.memoryMb, 2048)}M`, `-Xmx${mc.memoryMb}M`);
    if (mc.aikarFlags) args.push(...AIKAR_FLAGS);
    args.push(...splitArgs(mc.jvmArgs));
    if (launch.kind === 'argsfile') args.push('@' + launch.file);
    else args.push('-jar', launch.file);
    args.push('nogui');
    return { command: java, args, cwd: server.dir };
  },

  readyPattern: /\bDone \([\d.,]+m?s\)! For help/,

  stop(instance) {
    instance.writeStdin('stop');
  },

  async sendCommand(instance, command) {
    instance.writeStdin(command.replace(/^\//, ''));
  },

  broadcastCommand(msg) {
    return `say ${msg}`;
  },

  async beforeBackup(instance) {
    instance.writeStdin('save-off');
    instance.writeStdin('save-all flush');
    await new Promise((r) => setTimeout(r, 5000));
  },
  async afterBackup(instance) {
    instance.writeStdin('save-on');
  },

  async query(server) {
    const r = await mcPing('127.0.0.1', server.mc.port, 3000);
    return { online: r.online, max: r.max, players: r.sample, version: r.version };
  },

  backupConfig(server) {
    return { root: server.dir, ignore: ['libraries/**', 'logs/**', 'crash-reports/**', '.cache/**', '**/session.lock', 'cache/**', '*.jar.part'] };
  },

  settingsSchema(server) {
    return {
      sections: [
        {
          title: 'Server',
          fields: [
            { key: 'panel.memoryMb', label: 'Memory (MB)', type: 'number', min: 1024, step: 512, hint: 'Modded packs usually want 6144–12288 MB.' },
            { key: 'panel.port', label: 'Port', type: 'number' },
            { key: 'panel.aikarFlags', label: "Use Aikar's GC flags", type: 'bool' },
            { key: 'panel.jvmArgs', label: 'Extra JVM arguments', type: 'text', admin: true, hint: 'Admin only — goes on the Java command line.' },
            { key: 'panel.javaMajor', label: 'Java version', type: 'select', options: ['8', '11', '17', '21', '25'], hint: 'Picked automatically from the Minecraft version. Downloaded on demand.' },
          ],
        },
        ...groupFields(PROPERTY_FIELDS),
      ],
    };
  },

  readSettings(server) {
    const props = readProps(server).toObject();
    const out = {
      'panel.memoryMb': server.mc.memoryMb,
      'panel.port': server.mc.port,
      'panel.aikarFlags': !!server.mc.aikarFlags,
      'panel.jvmArgs': server.mc.jvmArgs || '',
      'panel.javaMajor': String(server.mc.javaMajor || ''),
    };
    for (const f of PROPERTY_FIELDS) {
      const v = props[f.key] ?? PROPERTY_DEFAULTS[f.key];
      out[f.key] = f.type === 'bool' ? v === 'true' : v ?? '';
    }
    return out;
  },

  writeSettings(server, values, opts = {}) {
    const mc = server.mc;
    if ('panel.memoryMb' in values) mc.memoryMb = Math.max(512, Number(values['panel.memoryMb']) || mc.memoryMb);
    if ('panel.port' in values) mc.port = Number(values['panel.port']) || mc.port;
    if ('panel.aikarFlags' in values) mc.aikarFlags = !!values['panel.aikarFlags'];
    // Extra JVM arguments land on the java command line (-javaagent, -XX:OnOutOfMemoryError=…,
    // a replacement -jar, @argfiles), so only an admin may set them.
    if ('panel.jvmArgs' in values && opts.admin) mc.jvmArgs = String(values['panel.jvmArgs'] || '');
    if ('panel.javaMajor' in values && values['panel.javaMajor']) mc.javaMajor = Number(values['panel.javaMajor']);
    const props = readProps(server);
    for (const f of PROPERTY_FIELDS) {
      if (!(f.key in values)) continue;
      const v = values[f.key];
      props.set(f.key, f.type === 'bool' ? (v ? 'true' : 'false') : v);
    }
    props.set('server-port', mc.port);
    writeProps(server, props);
    return { restartRequired: true };
  },

  // ---- Individual mods (mods/ folder) ----
  listMods(server) {
    const dir = path.join(server.dir, 'mods');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => /\.jar(\.disabled)?$/i.test(f))
      .map((f) => ({ file: f, enabled: !f.endsWith('.disabled'), size: fs.statSync(path.join(dir, f)).size }))
      .sort((a, b) => a.file.localeCompare(b.file));
  },

  async addCurseForgeMod(server, modId, fileId, log) {
    const mc = server.mc;
    let file;
    if (fileId) file = await cf.getFile(modId, fileId);
    else {
      const loader = mc.loader === 'vanilla' ? undefined : mc.loader;
      const files = await cf.getFiles(modId, { gameVersion: mc.mcVersion, loader });
      file = files.find((f) => f.releaseType === 1) || files[0];
    }
    if (!file) throw new HttpError(404, `No file of this mod matches Minecraft ${mc.mcVersion} / ${mc.loader}`);
    const url = file.downloadUrl || (await cf.downloadUrl(modId, file.id));
    if (!url) throw new HttpError(400, 'The author of this mod does not allow downloads through third-party apps. Download it on curseforge.com and upload it in the Files tab.');
    const dest = path.join(server.dir, 'mods', path.basename(file.fileName));
    await downloadFile(url, dest);
    log && log.info(`Added mod ${file.fileName}`);
    return { file: file.fileName };
  },
};

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
function splitNames(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,;\n]+/);
  return list.map((n) => String(n).trim()).filter(Boolean);
}
function cleanNames(input) {
  return [...new Set(splitNames(input).filter((n) => NAME_RE.test(n)))];
}

// ---- whitelist (Minecraft's equivalent of a server password) ----
function whitelistFile(server) {
  return path.join(server.dir, 'whitelist.json');
}
function readWhitelist(server) {
  try {
    return JSON.parse(fs.readFileSync(whitelistFile(server), 'utf8')).map((e) => e.name).filter(Boolean);
  } catch {
    return [];
  }
}
minecraft.NAME_RE = NAME_RE;
minecraft.cleanNames = cleanNames;
minecraft.splitNames = splitNames;
minecraft.whitelist = function (server) {
  const props = readProps(server);
  return {
    enabled: (props.get('white-list') ?? 'false') === 'true',
    players: readWhitelist(server).sort((a, b) => a.localeCompare(b)),
    pending: server.mc.pendingWhitelist || [],
  };
};
minecraft.whitelistAdd = function (server, instance, name) {
  if (!NAME_RE.test(name)) throw new HttpError(400, 'Minecraft usernames are 3–16 letters, numbers or underscores');
  if (instance.child && instance.status === 'running') {
    instance.writeStdin(`whitelist add ${name}`);
    return { applied: true };
  }
  // Offline: the server looks up the player's UUID itself when it next starts.
  server.mc.pendingWhitelist = [...new Set([...(server.mc.pendingWhitelist || []), name])];
  return { applied: false };
};
minecraft.whitelistRemove = function (server, instance, name) {
  server.mc.pendingWhitelist = (server.mc.pendingWhitelist || []).filter((n) => n.toLowerCase() !== name.toLowerCase());
  if (instance.child && instance.status === 'running') {
    instance.writeStdin(`whitelist remove ${name}`);
    return;
  }
  const file = whitelistFile(server);
  if (fs.existsSync(file)) {
    const list = JSON.parse(fs.readFileSync(file, 'utf8')).filter((e) => String(e.name).toLowerCase() !== name.toLowerCase());
    fs.writeFileSync(file, JSON.stringify(list, null, 2));
  }
};
minecraft.setWhitelistEnabled = function (server, instance, enabled) {
  const props = readProps(server);
  props.set('white-list', enabled ? 'true' : 'false');
  props.set('enforce-whitelist', enabled ? 'true' : 'false');
  writeProps(server, props);
  if (instance.child && instance.status === 'running') instance.writeStdin(`whitelist ${enabled ? 'on' : 'off'}`);
};
// Called when the server reports it's ready.
minecraft.onReady = function (server, instance) {
  const pending = server.mc.pendingWhitelist || [];
  if (!pending.length) return false;
  for (const n of pending) instance.writeStdin(`whitelist add ${n}`);
  instance.appendConsole(`[panel] Added ${pending.length} player(s) to the whitelist: ${pending.join(', ')}`);
  server.mc.pendingWhitelist = [];
  return true;
};

function groupFields(fields) {
  const groups = new Map();
  for (const f of fields) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }
  return [...groups].map(([title, fs]) => ({ title, fields: fs }));
}

module.exports = minecraft;
module.exports.splitArgs = splitArgs;
