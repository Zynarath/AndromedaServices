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

// server.properties keys with vanilla's defaults (minecraft.wiki/w/Server.properties). `since` marks keys
// older servers don't have; they ignore them, so writing one is harmless. server-port is set by the panel.
const P = (key, label, type, def, group, extra) => ({ key, label, type, def, group, ...extra });
const PROPERTY_FIELDS = [
  P('motd', 'Message of the day (MOTD)', 'text', 'A Minecraft Server', 'General'),
  P('max-players', 'Max players', 'number', '20', 'General'),
  P('enable-status', 'Show in the server list (answer pings)', 'bool', 'true', 'General'),
  P('hide-online-players', 'Hide the online player list', 'bool', 'false', 'General'),
  P('resource-pack', 'Resource pack URL', 'text', '', 'General', { hint: 'Direct download link to a .zip' }),
  P('resource-pack-sha1', 'Resource pack SHA-1', 'text', '', 'General'),
  P('require-resource-pack', 'Require the resource pack', 'bool', 'false', 'General'),
  P('resource-pack-prompt', 'Resource pack prompt text', 'text', '', 'General'),
  P('bug-report-link', 'Bug report link', 'text', '', 'General', { since: '1.21' }),

  P('difficulty', 'Difficulty', 'select', 'easy', 'Gameplay', { options: ['peaceful', 'easy', 'normal', 'hard'] }),
  P('gamemode', 'Default game mode', 'select', 'survival', 'Gameplay', { options: ['survival', 'creative', 'adventure', 'spectator'] }),
  P('force-gamemode', 'Force the default game mode on join', 'bool', 'false', 'Gameplay'),
  P('hardcore', 'Hardcore', 'bool', 'false', 'Gameplay'),
  P('pvp', 'PvP', 'bool', 'true', 'Gameplay'),
  P('allow-flight', 'Allow flight (recommended for modded)', 'bool', 'false', 'Gameplay', { hint: 'Off kicks players the server thinks are flying — jetpacks and some mods trip it' }),
  P('spawn-monsters', 'Spawn monsters', 'bool', 'true', 'Gameplay'),
  P('spawn-animals', 'Spawn animals', 'bool', 'true', 'Gameplay', { hint: 'Up to 1.21.1' }),
  P('spawn-npcs', 'Spawn villagers', 'bool', 'true', 'Gameplay', { hint: 'Up to 1.21.1' }),
  P('allow-nether', 'Allow the Nether', 'bool', 'true', 'Gameplay'),
  P('generate-structures', 'Generate structures (villages, temples…)', 'bool', 'true', 'Gameplay'),
  P('enable-command-block', 'Enable command blocks', 'bool', 'false', 'Gameplay'),
  P('spawn-protection', 'Spawn protection radius', 'number', '16', 'Gameplay', { hint: '0 = off. Ops can always build' }),
  P('max-world-size', 'World border radius (blocks)', 'number', '29999984', 'Gameplay'),

  P('online-mode', 'Online mode (verify accounts with Mojang)', 'bool', 'true', 'Access'),
  P('white-list', 'Whitelist enabled', 'bool', 'false', 'Access'),
  P('enforce-whitelist', 'Kick players not on whitelist', 'bool', 'false', 'Access'),
  P('player-idle-timeout', 'Idle kick (minutes, 0 = off)', 'number', '0', 'Access'),
  P('op-permission-level', 'Operator permission level', 'select', '4', 'Access', { options: [{ value: '1', label: '1 — bypass spawn protection' }, { value: '2', label: '2 — + cheat commands, command blocks' }, { value: '3', label: '3 — + kick, ban, op' }, { value: '4', label: '4 — everything incl. stop' }] }),
  P('function-permission-level', 'Function permission level', 'select', '2', 'Access', { options: ['1', '2', '3', '4'] }),
  P('broadcast-console-to-ops', 'Show console command output to ops', 'bool', 'true', 'Access'),
  P('enforce-secure-profile', 'Require signed chat (secure profiles)', 'bool', 'true', 'Access', { hint: '1.19+. Off lets players with chat reporting disabled join' }),
  P('prevent-proxy-connections', 'Block players connecting through a VPN/proxy', 'bool', 'false', 'Access'),
  P('log-ips', 'Log player IP addresses', 'bool', 'true', 'Access', { since: '1.20.2' }),
  P('accepts-transfers', 'Accept transfers from other servers', 'bool', 'false', 'Access', { since: '1.20.5' }),
  P('enable-query', 'Enable GameSpy4 query', 'bool', 'false', 'Access'),
  P('query.port', 'Query port (UDP)', 'number', '25565', 'Access'),

  P('level-name', 'World folder name', 'text', 'world', 'World'),
  P('level-seed', 'World seed', 'text', '', 'World', { hint: 'Only used when a new world is generated' }),
  P('level-type', 'World type', 'text', 'minecraft:normal', 'World', { hint: 'minecraft:normal, minecraft:flat, minecraft:large_biomes, minecraft:amplified (some modpacks use their own)' }),
  P('generator-settings', 'Generator settings (JSON)', 'text', '{}', 'World', { hint: 'For flat or custom world types' }),

  P('view-distance', 'View distance (chunks)', 'number', '10', 'Performance'),
  P('simulation-distance', 'Simulation distance (chunks)', 'number', '10', 'Performance'),
  P('entity-broadcast-range-percentage', 'Entity render distance (%)', 'number', '100', 'Performance', { hint: 'Lower = entities appear closer, less network traffic' }),
  P('max-tick-time', 'Watchdog max tick time (ms, -1 = off)', 'number', '60000', 'Performance', { hint: '-1 stops long modpack world loads from being killed as "crashed"' }),
  P('pause-when-empty-seconds', 'Pause when empty after (seconds)', 'number', '60', 'Performance', { since: '1.21.2', hint: 'Stops ticking the world when nobody is online. Negative = never' }),
  P('sync-chunk-writes', 'Sync chunk writes', 'bool', 'true', 'Performance', { hint: 'Off is faster but riskier on a crash' }),
  P('network-compression-threshold', 'Network compression threshold (bytes)', 'number', '256', 'Performance', { hint: '-1 = off. Higher uses less CPU, more bandwidth' }),
  P('region-file-compression', 'Region file compression', 'select', 'deflate', 'Performance', { since: '1.20.5', options: ['deflate', 'lz4', 'none'] }),
  P('max-chained-neighbor-updates', 'Max chained block updates', 'number', '1000000', 'Performance'),
  P('rate-limit', 'Kick after packets per second (0 = off)', 'number', '0', 'Performance'),
  P('use-native-transport', 'Use native networking (Linux)', 'bool', 'true', 'Performance'),
  P('enable-jmx-monitoring', 'Enable JMX monitoring', 'bool', 'false', 'Performance'),
].map((f) => (f.since ? { ...f, hint: [f.hint, `Minecraft ${f.since}+`].filter(Boolean).join('. ') } : f));

// Vanilla defaults, used when a key is missing so the form never shows (and saves) a wrong value.
const PROPERTY_DEFAULTS = Object.fromEntries(PROPERTY_FIELDS.map((f) => [f.key, f.def]));

// Game rules live in the world, not a file, so the panel sends "/gamerule <rule> <value>" once the
// server is ready. Only rules you change are sent; the rest keep the world's own values.
// Names as used up to Minecraft 1.21.10 (the versions modpacks run on).
const G = (key, label, type, def, group) => ({ key, label, type, def, group });
const GAMERULES = [
  G('keepInventory', 'Keep inventory on death', 'bool', false, 'Game rules: players'),
  G('naturalRegeneration', 'Health regenerates from food', 'bool', true, 'Game rules: players'),
  G('doImmediateRespawn', 'Respawn instantly (skip death screen)', 'bool', false, 'Game rules: players'),
  G('playersSleepingPercentage', 'Players that must sleep to skip the night (%)', 'number', 100, 'Game rules: players'),
  G('spawnRadius', 'Spawn radius (blocks)', 'number', 10, 'Game rules: players'),
  G('fallDamage', 'Fall damage', 'bool', true, 'Game rules: players'),
  G('fireDamage', 'Fire damage', 'bool', true, 'Game rules: players'),
  G('drowningDamage', 'Drowning damage', 'bool', true, 'Game rules: players'),
  G('freezeDamage', 'Freeze damage', 'bool', true, 'Game rules: players'),
  G('showDeathMessages', 'Death messages in chat', 'bool', true, 'Game rules: players'),
  G('announceAdvancements', 'Announce advancements in chat', 'bool', true, 'Game rules: players'),
  G('disableElytraMovementCheck', 'Disable elytra speed check', 'bool', false, 'Game rules: players'),
  G('doLimitedCrafting', 'Only unlocked recipes can be crafted', 'bool', false, 'Game rules: players'),
  G('reducedDebugInfo', 'Reduced F3 debug screen', 'bool', false, 'Game rules: players'),
  G('spectatorsGenerateChunks', 'Spectators generate chunks', 'bool', true, 'Game rules: players'),
  G('doDaylightCycle', 'Day/night cycle', 'bool', true, 'Game rules: world'),
  G('doWeatherCycle', 'Weather changes', 'bool', true, 'Game rules: world'),
  G('doFireTick', 'Fire spreads', 'bool', true, 'Game rules: world'),
  G('randomTickSpeed', 'Random tick speed (crop growth etc.)', 'number', 3, 'Game rules: world'),
  G('mobGriefing', 'Mob griefing (creepers, endermen…)', 'bool', true, 'Game rules: world'),
  G('doTileDrops', 'Blocks drop items', 'bool', true, 'Game rules: world'),
  G('doMobSpawning', 'Mobs spawn naturally', 'bool', true, 'Game rules: mobs'),
  G('doInsomnia', 'Phantoms spawn', 'bool', true, 'Game rules: mobs'),
  G('doPatrolSpawning', 'Pillager patrols spawn', 'bool', true, 'Game rules: mobs'),
  G('doTraderSpawning', 'Wandering traders spawn', 'bool', true, 'Game rules: mobs'),
  G('doWardenSpawning', 'Wardens spawn', 'bool', true, 'Game rules: mobs'),
  G('doMobLoot', 'Mobs drop loot', 'bool', true, 'Game rules: mobs'),
  G('doEntityDrops', 'Minecarts/boats/frames drop items', 'bool', true, 'Game rules: mobs'),
  G('maxEntityCramming', 'Max entities in one space', 'number', 24, 'Game rules: mobs'),
  G('forgiveDeadPlayers', 'Angry mobs forgive dead players', 'bool', true, 'Game rules: mobs'),
  G('universalAnger', 'Angry mobs attack everyone nearby', 'bool', false, 'Game rules: mobs'),
  G('commandBlockOutput', 'Command blocks print to chat', 'bool', true, 'Game rules: commands'),
  G('sendCommandFeedback', 'Show command feedback in chat', 'bool', true, 'Game rules: commands'),
  G('logAdminCommands', 'Log op commands to the console', 'bool', true, 'Game rules: commands'),
];

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
    args.push(`-Xms${Math.min(mc.memoryMb, mc.minMemoryMb || 2048)}M`, `-Xmx${mc.memoryMb}M`);
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
            { key: 'panel.minMemoryMb', label: 'Starting memory (MB)', type: 'number', min: 512, step: 512, hint: 'Blank = 2048 or the max, whichever is lower. Setting it equal to Memory avoids heap resizing.' },
            { key: 'panel.port', label: 'Port', type: 'number' },
            { key: 'panel.aikarFlags', label: "Use Aikar's GC flags", type: 'bool' },
            { key: 'panel.jvmArgs', label: 'Extra JVM arguments', type: 'text', admin: true, hint: 'Admin only — goes on the Java command line.' },
            { key: 'panel.javaMajor', label: 'Java version', type: 'select', options: ['8', '11', '17', '21', '25'], hint: 'Picked automatically from the Minecraft version. Downloaded on demand.' },
          ],
        },
        ...groupFields(PROPERTY_FIELDS).map((sec) => ({ ...sec, collapsed: !['General', 'Gameplay'].includes(sec.title) })),
        {
          title: 'Operators',
          collapsed: true,
          fields: [
            { key: 'panel.ops', label: 'Operators (Minecraft names, one per line)', type: 'textarea', admin: true, hint: 'Admin only. Opped each time the server starts; names you remove are de-opped.' },
          ],
        },
        ...groupFields(GAMERULES.map((g) => gameruleField(g))).map((sec) => ({ ...sec, collapsed: true })),
      ],
      note: 'server.properties values are written straight away; game rules are sent with /gamerule when the server starts. Leave a game rule on "World default" to keep what the world already has.',
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
      'panel.minMemoryMb': server.mc.minMemoryMb || '',
      'panel.ops': (server.mc.ops || []).join('\n'),
    };
    for (const g of GAMERULES) {
      const v = (server.mc.gamerules || {})[g.key];
      out['gamerule.' + g.key] = v === undefined || v === null ? '' : String(v);
    }
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
    if ('panel.minMemoryMb' in values) {
      const n = Number(values['panel.minMemoryMb']);
      mc.minMemoryMb = values['panel.minMemoryMb'] === '' || !Number.isFinite(n) ? null : Math.max(256, Math.round(n));
    }
    // Ops get every command up to the op permission level, so only an admin may hand them out.
    if ('panel.ops' in values && opts.admin) mc.ops = cleanNames(values['panel.ops']);
    const rules = { ...(mc.gamerules || {}) };
    for (const g of GAMERULES) {
      const k = 'gamerule.' + g.key;
      if (!(k in values)) continue;
      const v = values[k];
      if (v === '' || v === null || v === undefined) delete rules[g.key];
      else if (g.type === 'bool') rules[g.key] = v === true || v === 'true';
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 1000000) throw new HttpError(400, `${g.label}: enter a whole number from 0 up`);
        rules[g.key] = n;
      }
    }
    mc.gamerules = rules;
    const props = readProps(server);
    for (const f of PROPERTY_FIELDS) {
      if (!(f.key in values)) continue;
      const v = values[f.key];
      if (f.type === 'select' && !f.options.some((o) => String(typeof o === 'object' ? o.value : o) === String(v))) continue;
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
  const mc = server.mc;
  let changed = false;
  const pending = mc.pendingWhitelist || [];
  if (pending.length) {
    for (const n of pending) instance.writeStdin(`whitelist add ${n}`);
    instance.appendConsole(`[panel] Added ${pending.length} player(s) to the whitelist: ${pending.join(', ')}`);
    mc.pendingWhitelist = [];
    changed = true;
  }
  // Operators: op everyone listed; de-op names removed since the last start.
  const ops = mc.ops || [];
  const removed = (mc.opsApplied || []).filter((n) => !ops.some((o) => o.toLowerCase() === n.toLowerCase()));
  for (const n of removed) instance.writeStdin(`deop ${n}`);
  for (const n of ops) instance.writeStdin(`op ${n}`);
  if (ops.length || removed.length) {
    instance.appendConsole(`[panel] Operators: ${ops.join(', ') || '(none)'}${removed.length ? ` — removed ${removed.join(', ')}` : ''}`);
    mc.opsApplied = [...ops];
    changed = true;
  }
  // Game rules the panel sets (names and values come from the panel's own list).
  const rules = Object.entries(mc.gamerules || {}).filter(([k]) => GAMERULES.some((g) => g.key === k));
  for (const [k, v] of rules) instance.writeStdin(`gamerule ${k} ${v}`);
  if (rules.length) instance.appendConsole(`[panel] Applied ${rules.length} game rule(s): ${rules.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  return changed;
};

// Game rules: booleans get "World default / On / Off", numbers are blank for the world's value.
function gameruleField(g) {
  const field = { key: 'gamerule.' + g.key, label: g.label, type: g.type, group: g.group, tip: `/gamerule ${g.key}` };
  if (g.type === 'bool') {
    field.type = 'select';
    field.options = [{ value: '', label: `World default (${g.def ? 'on' : 'off'})` }, { value: 'true', label: 'On' }, { value: 'false', label: 'Off' }];
  } else {
    field.def = g.def;
    field.hint = 'Blank = world default';
  }
  return field;
}

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
