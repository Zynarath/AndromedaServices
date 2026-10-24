'use strict';
const fs = require('fs');
const path = require('path');
const Ini = require('../util/ini');
const Rcon = require('../util/rcon');
const steamcmd = require('../services/steamcmd');
const { HttpError, randomPassword } = require('../util/misc');
const { splitArgs } = require('./minecraft');

const EDITIONS = {
  asa: {
    label: 'ARK: Survival Ascended',
    appId: 2430930,
    exe: { win32: 'ShooterGame/Binaries/Win64/ArkAscendedServer.exe' },
    maps: ['TheIsland_WP', 'ScorchedEarth_WP', 'TheCenter_WP', 'Aberration_WP', 'Extinction_WP', 'Ragnarok_WP', 'Valguero_WP', 'Astraeos_WP', 'LostColony_WP'],
  },
  ase: {
    label: 'ARK: Survival Evolved',
    appId: 376030,
    exe: { win32: 'ShooterGame/Binaries/Win64/ShooterGameServer.exe', linux: 'ShooterGame/Binaries/Linux/ShooterGameServer' },
    maps: ['TheIsland', 'TheCenter', 'ScorchedEarth_P', 'Ragnarok', 'Aberration_P', 'Extinction', 'Valguero_P', 'Genesis', 'Gen2', 'CrystalIsles', 'LostIsland', 'Fjordur'],
  },
};

// Settings stored on the server record and written into the INI files before every start,
// so ARK can't overwrite them when it saves its config on shutdown.
const FIELDS = [
  { key: 'SessionName', file: 'gus', section: 'SessionSettings', label: 'Server name (shown in server list)', type: 'text', group: 'General' },
  { key: 'ServerPassword', file: 'gus', section: 'ServerSettings', label: 'Join password (blank = public)', type: 'text', group: 'General' },
  { key: 'ServerAdminPassword', file: 'gus', section: 'ServerSettings', label: 'Admin password (also used by the panel for RCON)', type: 'text', group: 'General' },
  { key: 'MessageOfTheDay', file: 'gus', section: 'MessageOfTheDay', iniKey: 'Message', label: 'Message of the day', type: 'text', group: 'General' },
  { key: 'ServerPVE', file: 'gus', section: 'ServerSettings', label: 'PvE mode', type: 'bool', group: 'Rules' },
  { key: 'AllowThirdPersonPlayer', file: 'gus', section: 'ServerSettings', label: 'Allow third person', type: 'bool', group: 'Rules' },
  { key: 'ServerCrosshair', file: 'gus', section: 'ServerSettings', label: 'Crosshair', type: 'bool', group: 'Rules' },
  { key: 'ShowMapPlayerLocation', file: 'gus', section: 'ServerSettings', label: 'Show player on map', type: 'bool', group: 'Rules' },
  { key: 'AllowFlyerCarryPvE', file: 'gus', section: 'ServerSettings', label: 'Flyers can carry in PvE', type: 'bool', group: 'Rules' },
  { key: 'AlwaysAllowStructurePickup', file: 'gus', section: 'ServerSettings', label: 'Always allow structure pickup', type: 'bool', group: 'Rules' },
  { key: 'DisableStructureDecayPvE', file: 'gus', section: 'ServerSettings', label: 'Disable structure decay (PvE)', type: 'bool', group: 'Rules' },
  { key: 'bAllowUnlimitedRespecs', file: 'game', section: '/script/shootergame.shootergamemode', label: 'Unlimited mindwipes', type: 'bool', group: 'Rules' },
  { key: 'DifficultyOffset', file: 'gus', section: 'ServerSettings', label: 'Difficulty offset (0–1)', type: 'number', step: 0.1, group: 'Rates' },
  { key: 'OverrideOfficialDifficulty', file: 'gus', section: 'ServerSettings', label: 'Override difficulty (5 = max wild level 150)', type: 'number', step: 0.5, group: 'Rates' },
  { key: 'XPMultiplier', file: 'gus', section: 'ServerSettings', label: 'XP multiplier', type: 'number', step: 0.5, group: 'Rates' },
  { key: 'TamingSpeedMultiplier', file: 'gus', section: 'ServerSettings', label: 'Taming speed', type: 'number', step: 0.5, group: 'Rates' },
  { key: 'HarvestAmountMultiplier', file: 'gus', section: 'ServerSettings', label: 'Harvest amount', type: 'number', step: 0.5, group: 'Rates' },
  { key: 'ItemStackSizeMultiplier', file: 'gus', section: 'ServerSettings', label: 'Stack size multiplier', type: 'number', step: 1, group: 'Rates' },
  { key: 'ResourcesRespawnPeriodMultiplier', file: 'gus', section: 'ServerSettings', label: 'Resource respawn period (lower = faster)', type: 'number', step: 0.1, group: 'Rates' },
  { key: 'DayCycleSpeedScale', file: 'gus', section: 'ServerSettings', label: 'Day cycle speed', type: 'number', step: 0.1, group: 'Rates' },
  { key: 'PlayerDamageMultiplier', file: 'gus', section: 'ServerSettings', label: 'Player damage', type: 'number', step: 0.1, group: 'Rates' },
  { key: 'DinoDamageMultiplier', file: 'gus', section: 'ServerSettings', label: 'Dino damage', type: 'number', step: 0.1, group: 'Rates' },
  { key: 'StructureDamageMultiplier', file: 'gus', section: 'ServerSettings', label: 'Structure damage', type: 'number', step: 0.1, group: 'Rates' },
  { key: 'MatingIntervalMultiplier', file: 'game', section: '/script/shootergame.shootergamemode', label: 'Mating interval (lower = faster)', type: 'number', step: 0.1, group: 'Breeding' },
  { key: 'EggHatchSpeedMultiplier', file: 'game', section: '/script/shootergame.shootergamemode', label: 'Egg hatch speed', type: 'number', step: 1, group: 'Breeding' },
  { key: 'BabyMatureSpeedMultiplier', file: 'game', section: '/script/shootergame.shootergamemode', label: 'Baby mature speed', type: 'number', step: 1, group: 'Breeding' },
  { key: 'BabyCuddleIntervalMultiplier', file: 'game', section: '/script/shootergame.shootergamemode', label: 'Imprint interval (lower = more often)', type: 'number', step: 0.1, group: 'Breeding' },
  { key: 'MaxTamedDinos', file: 'gus', section: 'ServerSettings', label: 'Max tamed dinos', type: 'number', group: 'Limits' },
  { key: 'MaxPersonalTamedDinos', file: 'gus', section: 'ServerSettings', label: 'Max tamed dinos per tribe', type: 'number', group: 'Limits' },
  { key: 'AutoSavePeriodMinutes', file: 'gus', section: 'ServerSettings', label: 'Autosave every (minutes)', type: 'number', group: 'Limits' },
  { key: 'KickIdlePlayersPeriod', file: 'gus', section: 'ServerSettings', label: 'Kick idle players after (seconds)', type: 'number', group: 'Limits' },
];

const LAUNCH_FIELDS = [
  { key: 'launch.map', label: 'Map', type: 'select-custom', group: 'Launch' },
  { key: 'launch.maxPlayers', label: 'Max players', type: 'number', group: 'Launch' },
  { key: 'launch.port', label: 'Game port (UDP)', type: 'number', group: 'Launch' },
  { key: 'launch.queryPort', label: 'Query port (UDP, ARK: SE only)', type: 'number', group: 'Launch' },
  { key: 'launch.rconPort', label: 'RCON port (TCP, local only)', type: 'number', group: 'Launch' },
  { key: 'launch.battleye', label: 'BattlEye anti-cheat', type: 'bool', group: 'Launch' },
  { key: 'launch.pcOnly', label: 'PC players only (disable crossplay)', type: 'bool', group: 'Launch', hint: 'ARK: Survival Ascended only' },
  { key: 'launch.clusterId', label: 'Cluster ID (servers with the same ID allow transfers)', type: 'text', group: 'Launch' },
  { key: 'launch.showConsole', label: 'Open ARK console window (-log)', type: 'bool', group: 'Launch' },
  { key: 'launch.extraArgs', label: 'Extra command-line arguments', type: 'text', group: 'Launch', admin: true, hint: 'Admin only — e.g. -ForceAllowCaveFlyers -NoTransferFromFiltering' },
];

function edition(server) {
  return EDITIONS[server.ark.edition] || EDITIONS.asa;
}
function configDir(server) {
  const platformDir = process.platform === 'win32' ? 'WindowsServer' : 'LinuxServer';
  return path.join(server.dir, 'ShooterGame', 'Saved', 'Config', platformDir);
}
function iniPath(server, which) {
  return path.join(configDir(server), which === 'game' ? 'Game.ini' : 'GameUserSettings.ini');
}
function loadIni(server, which) {
  const p = iniPath(server, which);
  return new Ini(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
}
function iniValue(field, v) {
  if (field.type === 'bool') return v ? 'True' : 'False';
  return v;
}

const rconClients = new Map();
async function rcon(server, command) {
  const key = server.id;
  let client = rconClients.get(key);
  if (!client || client.port !== server.ark.rconPort || client.password !== server.ark.settings.ServerAdminPassword) {
    if (client) client.close();
    client = new Rcon('127.0.0.1', server.ark.rconPort, server.ark.settings.ServerAdminPassword, { timeout: 6000 });
    rconClients.set(key, client);
  }
  try {
    return await client.send(command);
  } catch (err) {
    client.close();
    throw err;
  }
}

const ark = {
  id: 'ark',
  name: 'ARK',
  consoleMode: 'rcon',
  stopTimeoutMs: 180000,
  EDITIONS,

  defaults(input) {
    const a = input.ark || {};
    const ed = EDITIONS[a.edition] ? a.edition : 'asa';
    return {
      edition: ed,
      map: a.map || EDITIONS[ed].maps[0],
      maxPlayers: Number(a.maxPlayers) || 20,
      port: Number(a.port) || 7777,
      queryPort: Number(a.queryPort) || 27015,
      rconPort: Number(a.rconPort) || 27020,
      battleye: false,
      pcOnly: false,
      clusterId: '',
      showConsole: false,
      extraArgs: '',
      mods: (Array.isArray(a.mods) ? a.mods : String(a.mods || '').split(','))
        .map((s) => String(s).trim())
        .filter((s) => /^\d+$/.test(s)),
      settings: {
        SessionName: a.sessionName || input.name,
        ServerPassword: a.serverPassword || '',
        ServerAdminPassword: a.adminPassword || randomPassword(14),
      },
    };
  },

  ports(server) {
    const a = server.ark;
    const ports = [
      { port: a.port, proto: 'UDP', label: 'Game', forward: true },
      { port: a.port + 1, proto: 'UDP', label: 'Game (raw)', forward: a.edition === 'ase' },
      { port: a.rconPort, proto: 'TCP', label: 'RCON (keep closed)', forward: false },
    ];
    if (a.edition === 'ase') ports.splice(2, 0, { port: a.queryPort, proto: 'UDP', label: 'Steam query', forward: true });
    return ports.filter((p) => p.forward || p.label.startsWith('RCON'));
  },

  connectAddress(server, host) {
    return `${host}:${server.ark.port}`;
  },

  exePath(server) {
    const rel = edition(server).exe[process.platform];
    return rel ? path.join(server.dir, rel) : null;
  },

  async install(server, log, opts = {}) {
    const ed = edition(server);
    if (!ed.exe[process.platform]) {
      throw new Error(`${ed.label} dedicated server only runs on Windows. Run Andromeda Hosting on your Windows PC to host it.`);
    }
    log.info(`${opts.isUpdate ? 'Updating' : 'Installing'} ${ed.label} dedicated server via SteamCMD (app ${ed.appId}).`);
    if (!opts.isUpdate) log.info('First install downloads roughly 10–15 GB, so this can take a while.');
    await steamcmd.appUpdate(ed.appId, server.dir, { validate: !!opts.validate, log });
    this.applyIni(server);
    log.info(`${ed.label} is installed.`);
  },

  applyIni(server) {
    fs.mkdirSync(configDir(server), { recursive: true });
    const gus = loadIni(server, 'gus');
    const game = loadIni(server, 'game');
    const s = server.ark.settings;
    for (const f of FIELDS) {
      if (!(f.key in s)) continue;
      (f.file === 'game' ? game : gus).set(f.section, f.iniKey || f.key, iniValue(f, s[f.key]));
    }
    // RCON must be on for the panel console, player list and graceful shutdown.
    gus.set('ServerSettings', 'RCONEnabled', 'True');
    gus.set('ServerSettings', 'RCONPort', server.ark.rconPort);
    gus.set('SessionSettings', 'Port', server.ark.port);
    if (server.ark.edition === 'ase') gus.set('SessionSettings', 'QueryPort', server.ark.queryPort);
    fs.writeFileSync(iniPath(server, 'gus'), gus.toString());
    fs.writeFileSync(iniPath(server, 'game'), game.toString());
  },

  async buildLaunch(server) {
    const a = server.ark;
    const exe = this.exePath(server);
    if (!exe) throw new HttpError(400, `${edition(server).label} servers only run on Windows.`);
    if (!fs.existsSync(exe)) throw new HttpError(400, 'Server files are missing. Use "Update / Validate" to (re)install.');
    this.applyIni(server);
    let url = `${a.map}?listen?Port=${a.port}?RCONEnabled=True?RCONPort=${a.rconPort}`;
    const args = [];
    if (a.edition === 'ase') {
      url += `?QueryPort=${a.queryPort}?MaxPlayers=${a.maxPlayers}`;
      if (a.mods.length) url += `?GameModIds=${a.mods.join(',')}`;
      args.push(url, '-server');
      if (a.mods.length) args.push('-automanagedmods');
    } else {
      args.push(url, `-WinLiveMaxPlayers=${a.maxPlayers}`);
      if (a.mods.length) args.push(`-mods=${a.mods.join(',')}`);
      if (a.pcOnly) args.push('-ServerPlatform=PC');
    }
    if (!a.battleye) args.push('-NoBattlEye');
    if (a.clusterId) {
      const clusterDir = path.join(path.dirname(server.dir), '_ark_clusters');
      fs.mkdirSync(clusterDir, { recursive: true });
      args.push(`-clusterid=${a.clusterId}`, `-ClusterDirOverride=${clusterDir}`);
    }
    if (a.showConsole) args.push('-log');
    args.push('-servergamelog');
    args.push(...splitArgs(a.extraArgs));
    return {
      command: exe,
      args,
      cwd: path.dirname(exe),
      logFile: path.join(server.dir, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'),
    };
  },

  // ARK has no stdin console. The server counts as up once RCON answers.
  async probeReady(server) {
    await rcon(server, 'ListPlayers');
    return true;
  },

  async stop(instance) {
    const server = instance.server;
    try {
      await rcon(server, 'SaveWorld');
      instance.appendConsole('[panel] World saved, shutting down...');
      await new Promise((r) => setTimeout(r, 3000));
      await rcon(server, 'DoExit').catch(() => {});
    } catch (err) {
      instance.appendConsole(`[panel] RCON unavailable (${err.message}); stopping the process.`);
      instance.kill();
    }
  },

  async sendCommand(instance, command) {
    const out = await rcon(instance.server, command.replace(/^\//, ''));
    instance.appendConsole(`[rcon] ${(out || '').trim() || '(no response)'}`);
    return out;
  },

  broadcastCommand(msg) {
    return `ServerChat ${msg}`;
  },

  async beforeBackup(instance) {
    await rcon(instance.server, 'SaveWorld').catch(() => {});
    await new Promise((r) => setTimeout(r, 5000));
  },

  async query(server) {
    const out = await rcon(server, 'ListPlayers');
    const players = [];
    for (const line of String(out || '').split(/\r?\n/)) {
      const m = /^\s*\d+\.\s*([^,]+),/.exec(line);
      if (m) players.push(m[1].trim());
    }
    return { online: players.length, max: server.ark.maxPlayers, players };
  },

  backupConfig(server) {
    return { root: path.join(server.dir, 'ShooterGame', 'Saved'), ignore: ['Logs/**', 'Crashes/**'] };
  },

  closeRcon(server) {
    const c = rconClients.get(server.id);
    if (c) c.close();
    rconClients.delete(server.id);
  },

  settingsSchema(server) {
    const groups = new Map();
    for (const f of [...LAUNCH_FIELDS, ...FIELDS]) {
      if (!groups.has(f.group)) groups.set(f.group, []);
      const field = { key: f.file ? 'ini.' + f.key : f.key, label: f.label, type: f.type, step: f.step, hint: f.hint, admin: f.admin };
      if (f.key === 'launch.map') field.options = edition(server).maps;
      groups.get(f.group).push(field);
    }
    return {
      note: 'These values are written into GameUserSettings.ini / Game.ini every time the server starts. Other INI settings can be edited in the Files tab.',
      sections: [...groups].map(([title, fields]) => ({ title, fields })),
    };
  },

  readSettings(server) {
    const a = server.ark;
    const out = {};
    for (const k of ['map', 'maxPlayers', 'port', 'queryPort', 'rconPort', 'battleye', 'pcOnly', 'clusterId', 'showConsole', 'extraArgs']) out['launch.' + k] = a[k];
    const gus = loadIni(server, 'gus');
    const game = loadIni(server, 'game');
    for (const f of FIELDS) {
      let v = a.settings[f.key];
      if (v === undefined) v = (f.file === 'game' ? game : gus).get(f.section, f.iniKey || f.key);
      if (f.type === 'bool') v = v === true || String(v).toLowerCase() === 'true';
      out['ini.' + f.key] = v ?? '';
    }
    return out;
  },

  writeSettings(server, values, opts = {}) {
    const a = server.ark;
    for (const [k, v] of Object.entries(values)) {
      if (k.startsWith('launch.')) {
        const key = k.slice(7);
        if (['maxPlayers', 'port', 'queryPort', 'rconPort'].includes(key)) a[key] = Number(v) || a[key];
        else if (['battleye', 'pcOnly', 'showConsole'].includes(key)) a[key] = !!v;
        else if (['map', 'clusterId'].includes(key)) a[key] = String(v || '').trim();
        // extraArgs becomes the server's command line, so admin only.
        else if (key === 'extraArgs' && opts.admin) a[key] = String(v || '').trim();
      } else if (k.startsWith('ini.')) {
        const f = FIELDS.find((x) => x.key === k.slice(4));
        if (!f) continue;
        if (v === '' || v === null || v === undefined) delete a.settings[f.key];
        else a.settings[f.key] = f.type === 'bool' ? !!v : f.type === 'number' ? Number(v) : String(v);
      }
    }
    if (!a.settings.ServerAdminPassword) a.settings.ServerAdminPassword = randomPassword(14);
    if (!a.map) a.map = edition(server).maps[0];
    return { restartRequired: true };
  },
};

module.exports = ark;
