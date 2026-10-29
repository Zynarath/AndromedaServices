'use strict';
// 7 Days to Die dedicated server (SteamCMD app 294420).
// Settings go into a config file the panel writes before every start (serverconfig.andromeda.xml),
// built from the game's own serverconfig.xml so new properties keep their defaults and game updates
// can't overwrite the panel's values. Worlds, saves and serveradmin.xml live in this server's own
// UserData folder. The console, player list and clean shutdown use the game's telnet port, which
// only listens on this PC.
// Mods are folders with a ModInfo.xml in Mods/; switched-off mods wait in Mods.disabled/.
const fs = require('fs');
const path = require('path');
const net = require('net');
const steamcmd = require('../services/steamcmd');
const fields = require('../util/fields');
const { extractZip } = require('../util/zip');
const { findFiles, blockedForNonAdmin } = require('../util/paths');
const { HttpError, randomPassword, splitArgs } = require('../util/misc');

// 7 Days to Die's telnet console: log in with the password, send one command, collect what the
// server prints back until it goes quiet. One short-lived connection per command keeps it simple
// and survives server restarts.
const telnet = (() => {
  const IAC = 255;

  // Drop telnet negotiation bytes (IAC sequences); 7DTD sends a few right after connecting.
  function stripTelnet(buf) {
    const out = [];
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== IAC) {
        out.push(buf[i]);
        continue;
      }
      const cmd = buf[i + 1];
      if (cmd === IAC) {
        out.push(IAC);
        i++;
      } else if (cmd >= 251 && cmd <= 254) i += 2; // WILL/WONT/DO/DONT <option>
      else if (cmd === 250) {
        const end = buf.indexOf(240, i); // SB ... SE
        i = end < 0 ? buf.length : end;
      } else i++;
    }
    return Buffer.from(out).toString('utf8');
  }

  function command(host, port, password, cmd, { timeout = 8000, quietMs = 700 } = {}) {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host, port });
      let text = '';
      let stage = 'login';
      let quiet = null;
      let sentAt = 0;
      const finish = (err) => {
        clearTimeout(timer);
        clearTimeout(quiet);
        sock.destroy();
        if (err) return reject(err);
        resolve(text.slice(sentAt).replace(/\r/g, ''));
      };
      const timer = setTimeout(() => (stage === 'sent' ? finish() : finish(new Error('7 Days to Die telnet did not answer'))), timeout);
      const send = () => {
        stage = 'sent';
        sentAt = text.length;
        sock.write(cmd + '\r\n');
        quiet = setTimeout(() => finish(), quietMs * 3);
      };
      sock.on('error', (err) => finish(err));
      sock.on('close', () => (stage === 'sent' ? finish() : finish(new Error('7 Days to Die telnet closed the connection'))));
      sock.on('data', (chunk) => {
        text += stripTelnet(chunk);
        if (stage === 'login') {
          if (/password incorrect|wrong password/i.test(text)) return finish(new Error('7 Days to Die rejected the telnet password'));
          if (/enter password/i.test(text)) {
            stage = 'auth';
            sock.write(password + '\r\n');
          } else if (/Press 'help'|Logon successful|\*\*\* Connected/i.test(text)) send(); // no password needed
        } else if (stage === 'auth') {
          if (/password incorrect|wrong password/i.test(text)) return finish(new Error('7 Days to Die rejected the telnet password'));
          if (/Logon successful/i.test(text)) send();
        } else {
          clearTimeout(quiet);
          quiet = setTimeout(() => finish(), quietMs);
        }
      });
    });
  }

  // "lp" (listplayers) output: "0. id=171, Name, pos=(...), ..." lines, then "Total of N in the game".
  function parsePlayers(out) {
    const players = [];
    for (const line of String(out).split('\n')) {
      const m = /^\s*\d+\.\s*id=\d+,\s*([^,]+),/.exec(line);
      if (m) players.push(m[1].trim());
    }
    const total = /Total of (\d+) in the game/.exec(out);
    return { online: total ? Number(total[1]) : players.length, players };
  }
  return { command, parsePlayers, stripTelnet };
})();

const APP_ID = 294420;
const EXE = { win32: '7DaysToDieServer.exe', linux: '7DaysToDieServer.x86_64' };
const CONFIG_FILE = 'serverconfig.andromeda.xml';
const BUILTIN_MOD = /^0_TFP_/i; // shipped with the game (e.g. 0_TFP_Harmony); other mods depend on it

const blankOpt = [['', 'Game default']];
const GROUPS = ['Server', 'World', 'Difficulty', 'Zombies', 'Day & night', 'Loot & death', 'Multiplayer', 'Land claims', 'Advanced'];
// `prop` is the serverconfig.xml property. Blank values aren't written, so the game's default applies.
const FIELDS = [
  { name: 'serverName', prop: 'ServerName', label: 'Name in the server list', type: 'text', group: 'Server', maxLength: 64, required: true },
  { name: 'description', prop: 'ServerDescription', label: 'Description', type: 'text', group: 'Server', maxLength: 200 },
  { name: 'password', prop: 'ServerPassword', label: 'Join password (blank = anyone can join)', type: 'text', group: 'Server', maxLength: 64 },
  { name: 'visibility', prop: 'ServerVisibility', label: 'Server list', type: 'select', group: 'Server', def: '2', options: [['2', 'Public'], ['1', 'Friends only'], ['0', 'Not listed']] },
  { name: 'maxPlayers', prop: 'ServerMaxPlayerCount', label: 'Max players', type: 'number', group: 'Server', min: 1, max: 64, def: 8 },
  { name: 'port', prop: 'ServerPort', label: 'Port (TCP + UDP, uses the next 2 UDP ports too)', type: 'number', group: 'Server', min: 1024, max: 65530, def: 26900, required: true },
  { name: 'crossplay', prop: 'ServerAllowCrossplay', label: 'Crossplay (console players)', type: 'bool', group: 'Server', def: false, hint: 'Crossplay servers must keep EAC on and use the default player limit (8).' },
  { name: 'gameWorld', prop: 'GameWorld', label: 'World', type: 'select-custom', group: 'World', def: 'Navezgane', options: [['Navezgane', 'Navezgane'], ['RWG', 'RWG (random world)']], hint: '"RWG" generates a world from the seed and size below. Or type the name of a world in UserData/GeneratedWorlds.' },
  { name: 'seed', prop: 'WorldGenSeed', label: 'Random world seed', type: 'text', group: 'World', maxLength: 64, hint: 'Only used with RWG.' },
  { name: 'worldSize', prop: 'WorldGenSize', label: 'Random world size', type: 'select', group: 'World', def: '', options: [...blankOpt, ['6144', '6144'], ['8192', '8192'], ['10240', '10240']], hint: 'Only used with RWG. Bigger worlds take longer to generate on the first start.' },
  { name: 'gameName', prop: 'GameName', label: 'Save name', type: 'text', group: 'World', maxLength: 64, pattern: /^[\w\- ]+$/, patternHint: 'letters, numbers, spaces, - and _', required: true, hint: 'A new name starts a new save; the old one is kept.' },
  { name: 'difficulty', prop: 'GameDifficulty', label: 'Difficulty', type: 'select', group: 'Difficulty', def: '', options: [...blankOpt, ['0', 'Scavenger'], ['1', 'Adventurer'], ['2', 'Nomad'], ['3', 'Warrior'], ['4', 'Survivalist'], ['5', 'Insane']] },
  { name: 'xp', prop: 'XPMultiplier', label: 'XP multiplier (%)', type: 'number', group: 'Difficulty', min: 0, max: 10000, hint: '100 = normal' },
  { name: 'blockDamagePlayer', prop: 'BlockDamagePlayer', label: 'Block damage by players (%)', type: 'number', group: 'Difficulty', min: 0, max: 10000 },
  { name: 'blockDamageAI', prop: 'BlockDamageAI', label: 'Block damage by zombies (%)', type: 'number', group: 'Difficulty', min: 0, max: 10000 },
  { name: 'blockDamageAIBM', prop: 'BlockDamageAIBM', label: 'Block damage by zombies on blood moons (%)', type: 'number', group: 'Difficulty', min: 0, max: 10000 },
  { name: 'buildCreate', prop: 'BuildCreate', label: 'Creative mode (build without resources)', type: 'bool', group: 'Difficulty', def: false },
  { name: 'enemySpawn', prop: 'EnemySpawnMode', label: 'Zombies and enemies spawn', type: 'bool', group: 'Zombies', def: true },
  { name: 'enemyDifficulty', prop: 'EnemyDifficulty', label: 'Zombie type', type: 'select', group: 'Zombies', def: '', options: [...blankOpt, ['0', 'Normal'], ['1', 'Feral']] },
  ...[['zombieMove', 'ZombieMove', 'Zombie speed (day)'], ['zombieMoveNight', 'ZombieMoveNight', 'Zombie speed (night)'], ['zombieFeralMove', 'ZombieFeralMove', 'Feral zombie speed'], ['zombieBMMove', 'ZombieBMMove', 'Zombie speed on blood moons']].map(([name, prop, label]) => ({
    name, prop, label, type: 'select', group: 'Zombies', def: '', options: [...blankOpt, ['0', 'Walk'], ['1', 'Jog'], ['2', 'Run'], ['3', 'Sprint'], ['4', 'Nightmare']],
  })),
  { name: 'bmFrequency', prop: 'BloodMoonFrequency', label: 'Blood moon every (days, 0 = never)', type: 'number', group: 'Zombies', min: 0, max: 1000 },
  { name: 'bmRange', prop: 'BloodMoonRange', label: 'Blood moon day varies by (days)', type: 'number', group: 'Zombies', min: 0, max: 1000 },
  { name: 'bmEnemies', prop: 'BloodMoonEnemyCount', label: 'Blood moon zombies per player', type: 'number', group: 'Zombies', min: 0, max: 64 },
  { name: 'maxZombies', prop: 'MaxSpawnedZombies', label: 'Max zombies on the map', type: 'number', group: 'Zombies', min: 0, max: 1000, hint: 'Higher costs a lot of CPU.' },
  { name: 'maxAnimals', prop: 'MaxSpawnedAnimals', label: 'Max animals on the map', type: 'number', group: 'Zombies', min: 0, max: 1000 },
  { name: 'dayLength', prop: 'DayNightLength', label: 'Length of a day (real minutes)', type: 'number', group: 'Day & night', min: 10, max: 1440 },
  { name: 'daylight', prop: 'DayLightLength', label: 'Hours of daylight (in-game)', type: 'number', group: 'Day & night', min: 0, max: 24 },
  { name: 'lootAbundance', prop: 'LootAbundance', label: 'Loot abundance (%)', type: 'number', group: 'Loot & death', min: 0, max: 10000 },
  { name: 'lootRespawn', prop: 'LootRespawnDays', label: 'Loot respawns after (days)', type: 'number', group: 'Loot & death', min: -1, max: 1000 },
  { name: 'airdrop', prop: 'AirDropFrequency', label: 'Air drop every (in-game hours, 0 = never)', type: 'number', group: 'Loot & death', min: 0, max: 10000 },
  { name: 'airdropMarker', prop: 'AirDropMarker', label: 'Show air drops on the map', type: 'bool', group: 'Loot & death', def: true },
  { name: 'dropOnDeath', prop: 'DropOnDeath', label: 'On death, drop', type: 'select', group: 'Loot & death', def: '', options: [...blankOpt, ['0', 'Nothing'], ['1', 'Everything'], ['2', 'Toolbelt only'], ['3', 'Backpack only'], ['4', 'Delete everything']] },
  { name: 'dropOnQuit', prop: 'DropOnQuit', label: 'On leaving, drop', type: 'select', group: 'Loot & death', def: '', options: [...blankOpt, ['0', 'Nothing'], ['1', 'Everything'], ['2', 'Toolbelt only'], ['3', 'Backpack only']] },
  { name: 'pvp', prop: 'PlayerKillingMode', label: 'Player killing', type: 'select', group: 'Multiplayer', def: '', options: [...blankOpt, ['0', 'No killing'], ['1', 'Allies only'], ['2', 'Strangers only'], ['3', 'Everyone']] },
  { name: 'partyRange', prop: 'PartySharedKillRange', label: 'Party shares XP within (metres)', type: 'number', group: 'Multiplayer', min: 0, max: 100000 },
  { name: 'claimCount', prop: 'LandClaimCount', label: 'Land claims per player', type: 'number', group: 'Land claims', min: 0, max: 100 },
  { name: 'claimSize', prop: 'LandClaimSize', label: 'Land claim size (blocks)', type: 'number', group: 'Land claims', min: 1, max: 1000 },
  { name: 'claimDeadZone', prop: 'LandClaimDeadZone', label: 'Space between claims (blocks)', type: 'number', group: 'Land claims', min: 0, max: 1000 },
  { name: 'claimExpiry', prop: 'LandClaimExpiryTime', label: 'Claims expire after offline for (days)', type: 'number', group: 'Land claims', min: 0, max: 10000 },
  { name: 'eac', prop: 'EACEnabled', label: 'Easy Anti-Cheat', type: 'bool', group: 'Advanced', def: true, hint: 'Mods with their own code (.dll) need this off, and so does every player\'s game.' },
  { name: 'telnetPort', label: 'Telnet port (TCP, this PC only)', type: 'number', group: 'Advanced', min: 1024, max: 65535, def: 8081, required: true, hint: 'The panel\'s console uses it. Never forward it.' },
  { name: 'branch', label: 'Game version', type: 'select', group: 'Advanced', admin: true, def: '', options: [['', 'Stable (default)'], ['latest_experimental', 'Latest experimental']], hint: 'Admin only. Applies on the next update; players need the same version.' },
  { name: 'extraProps', label: 'Extra serverconfig.xml properties', type: 'textarea', group: 'Advanced', admin: true, pattern: /^(\s*[A-Za-z][\w]*\s*=[^\n]*\n?)*$/, patternHint: 'one Name=value per line', hint: 'Admin only. One Name=value per line, e.g. BedrollDeadZoneSize=15. Wins over the fields above.' },
  { name: 'extraArgs', label: 'Extra command-line arguments', type: 'text', group: 'Advanced', admin: true, maxLength: 500, hint: 'Admin only.' },
];
// Kept by the panel: every server's saves stay in its own folder, and telnet stays on this PC.
const FORCED = ['UserDataFolder', 'TelnetEnabled', 'TelnetPort', 'TelnetPassword', 'TelnetFailedLoginLimit', 'WebDashboardEnabled'];

const sd = (server) => server.sdtd;
const userData = (server) => path.join(server.dir, 'UserData');
const modsDir = (server) => path.join(server.dir, 'Mods');
const disabledDir = (server) => path.join(server.dir, 'Mods.disabled');
const exePath = (server) => (EXE[process.platform] ? path.join(server.dir, EXE[process.platform]) : null);

const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnesc = (v) => String(v).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Properties from serverconfig.xml, comments ignored, in file order.
function parseProps(xml) {
  const out = new Map();
  const text = String(xml || '').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of text.matchAll(/<property\s+name="([^"]+)"\s+value="([^"]*)"\s*\/?>/g)) out.set(m[1], xmlUnesc(m[2]));
  return out;
}

function parseExtraProps(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*([A-Za-z]\w*)\s*=(.*)$/.exec(line);
    if (m && !FORCED.includes(m[1])) out.push([m[1], m[2].trim()]);
  }
  return out;
}

function propValue(f, v) {
  if (f.type === 'bool') return v ? 'true' : 'false';
  return String(v);
}

function buildConfig(server) {
  const s = sd(server);
  let base = new Map();
  try {
    base = parseProps(fs.readFileSync(path.join(server.dir, 'serverconfig.xml'), 'utf8'));
  } catch {}
  const props = new Map(base);
  for (const f of FIELDS) {
    if (!f.prop) continue;
    const v = s[f.name];
    if (v === null || v === undefined || v === '') continue;
    props.set(f.prop, propValue(f, v));
  }
  for (const [k, v] of parseExtraProps(s.extraProps)) props.set(k, v);
  props.set('UserDataFolder', userData(server));
  props.set('TelnetEnabled', 'true');
  props.set('TelnetPort', String(s.telnetPort));
  props.set('TelnetPassword', ''); // no password = the game only listens on this PC (127.0.0.1)
  props.set('WebDashboardEnabled', 'false');
  const lines = [
    '<?xml version="1.0"?>',
    `<!-- Written by Andromeda Hosting for "${xmlEsc(server.name).replace(/--/g, '- -')}" before every start. Change settings in the panel; -->`,
    '<!-- values not set there come from the game\'s own serverconfig.xml. -->',
    '<ServerSettings>',
    ...[...props].map(([k, v]) => `\t<property name="${xmlEsc(k)}" value="${xmlEsc(v)}" />`),
    '</ServerSettings>',
  ];
  return lines.join('\r\n') + '\r\n';
}

function writeConfig(server) {
  fs.mkdirSync(userData(server), { recursive: true });
  fs.writeFileSync(path.join(server.dir, CONFIG_FILE), buildConfig(server));
}

const tel = (server, cmd, opts) => telnet.command('127.0.0.1', sd(server).telnetPort, '', cmd, opts);

// ---- mods ----
function readModInfo(dir) {
  try {
    const xml = fs.readFileSync(path.join(dir, 'ModInfo.xml'), 'utf8');
    const info = {};
    for (const m of xml.matchAll(/<(\w+)\s+value="([^"]*)"/g)) if (!(m[1] in info)) info[m[1]] = xmlUnesc(m[2]);
    return info;
  } catch {
    return null;
  }
}

function hasCode(dir) {
  return findFiles(dir, (_rel, name) => /\.dll$/i.test(name), 4).length > 0;
}

function listModsIn(base, enabled) {
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {}
  return entries.map((e) => {
    const dir = path.join(base, e.name);
    const info = readModInfo(dir) || {};
    return {
      folder: e.name,
      name: info.DisplayName || info.Name || e.name,
      version: info.Version || '',
      author: info.Author || '',
      description: info.Description || '',
      website: /^https?:\/\//i.test(info.Website || '') ? info.Website : '',
      enabled,
      builtin: BUILTIN_MOD.test(e.name),
      valid: fs.existsSync(path.join(dir, 'ModInfo.xml')),
      code: hasCode(dir),
    };
  });
}

function modFolder(name) {
  const n = String(name || '');
  if (!n || n === '.' || n === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(n)) throw new HttpError(400, 'Invalid mod folder');
  return n;
}

const sdtd = {
  id: 'sdtd',
  name: '7 Days to Die',
  consoleMode: 'telnet',
  stopTimeoutMs: 120000,
  readyPattern: /StartGame done/,
  FIELDS,

  defaults(input) {
    const v = input.sdtd || {};
    const slug = String(input.name || 'World').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'World';
    return fields.defaults(FIELDS, { ...v, serverName: v.serverName || input.name, gameName: v.gameName || slug, password: v.password ?? randomPassword(8) });
  },

  ports(server) {
    const s = sd(server);
    return [
      { port: s.port, proto: 'TCP+UDP', label: 'Game', forward: true },
      { port: s.port + 1, proto: 'UDP', label: 'Game', forward: true },
      { port: s.port + 2, proto: 'UDP', label: 'Game', forward: true },
      { port: s.telnetPort, proto: 'TCP', label: 'Telnet (keep closed)', forward: false },
    ];
  },

  connectAddress(server, host) {
    return `${host}:${sd(server).port}`;
  },

  describe(server) {
    const s = sd(server);
    const world = s.gameWorld === 'RWG' ? `Random world${s.worldSize ? ' ' + s.worldSize : ''}` : s.gameWorld;
    return { game: '7 Days to Die', detail: `${world} · ${s.maxPlayers} players` };
  },

  async install(server, log, opts = {}) {
    if (!EXE[process.platform]) throw new Error('The 7 Days to Die dedicated server runs on Windows and Linux.');
    const s = sd(server);
    log.info(`${opts.isUpdate ? 'Updating' : 'Installing'} the 7 Days to Die dedicated server via SteamCMD (app ${APP_ID}${s.branch ? `, branch ${s.branch}` : ''}).`);
    if (!opts.isUpdate) log.info('The first install downloads about 15 GB.');
    await steamcmd.appUpdate(APP_ID, server.dir, { validate: !!opts.validate, log, extra: s.branch ? ['-beta', s.branch] : [] });
    writeConfig(server);
    log.info('7 Days to Die is installed.');
  },

  saveFiles(server) {
    writeConfig(server);
  },

  async buildLaunch(server) {
    const s = sd(server);
    const exe = exePath(server);
    if (!exe) throw new HttpError(400, '7 Days to Die servers run on Windows and Linux.');
    if (!fs.existsSync(exe)) throw new HttpError(400, 'Server files are missing. Use Reinstall in Settings.');
    writeConfig(server);
    const logFile = path.join(server.dir, 'logs', 'andromeda-server.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const env = {};
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [server.dir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    return {
      command: exe,
      args: ['-quit', '-batchmode', '-nographics', '-dedicated', `-configfile=${CONFIG_FILE}`, '-logfile', logFile, ...splitArgs(s.extraArgs)],
      cwd: server.dir,
      env,
      logFile,
    };
  },

  // A second sign of life in case the log line changes between versions: the world clock answers.
  async probeReady(server) {
    const out = await tel(server, 'gettime');
    if (!/Day\s+\d+/i.test(out)) throw new Error('world not loaded yet');
    return true;
  },

  async stop(instance) {
    try {
      await tel(instance.server, 'saveworld', { quietMs: 2000 });
      instance.appendConsole('[panel] World saved, shutting down...');
      await tel(instance.server, 'shutdown', { quietMs: 500 }).catch(() => {});
    } catch (err) {
      instance.appendConsole(`[panel] Telnet unavailable (${err.message}); stopping the process.`);
      instance.kill();
    }
  },

  async sendCommand(instance, command) {
    const out = await tel(instance.server, command.replace(/^\//, ''));
    instance.appendConsole(`[telnet] ${out.trim() || '(no response)'}`);
    return out;
  },

  broadcastCommand(msg) {
    return `say "${String(msg).replace(/"/g, "'")}"`;
  },

  async beforeBackup(instance) {
    await tel(instance.server, 'saveworld', { quietMs: 2000 }).catch(() => {});
  },

  async query(server) {
    return { ...telnet.parsePlayers(await tel(server, 'lp')), max: sd(server).maxPlayers || 8 };
  },

  // Saves, generated worlds and serveradmin.xml. The game itself comes back with Reinstall; mods
  // are in their own folder.
  backupConfig(server) {
    return { root: userData(server), ignore: ['**/*.log'] };
  },

  settingsSchema() {
    return {
      note: `Written to ${CONFIG_FILE} before every start, on top of the game's own serverconfig.xml. Blank fields use the game's default. Saves and worlds are in this server's UserData folder.`,
      sections: fields.schema('sdtd', FIELDS, GROUPS, { collapsed: ['Day & night', 'Loot & death', 'Multiplayer', 'Land claims', 'Advanced'] }),
    };
  },

  readSettings(server) {
    return fields.read('sdtd', FIELDS, sd(server));
  },

  writeSettings(server, values, opts = {}) {
    const changes = fields.parse('sdtd', FIELDS, values, opts);
    const next = { ...sd(server), ...changes };
    if (next.crossplay && !next.eac) throw new HttpError(400, 'Crossplay needs Easy Anti-Cheat on');
    if (next.telnetPort === next.port || (next.telnetPort > next.port && next.telnetPort <= next.port + 2)) throw new HttpError(400, 'The telnet port overlaps the game ports');
    Object.assign(sd(server), changes);
    return { restartRequired: true };
  },

  // ---- mods ----
  listMods(server) {
    const mods = [...listModsIn(modsDir(server), true), ...listModsIn(disabledDir(server), false)];
    return mods.sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.folder.localeCompare(b.folder));
  },

  // Install every mod (folder with a ModInfo.xml) found in an uploaded .zip, replacing older copies.
  async installModZip(server, zipFile, { admin = false } = {}) {
    const tmp = path.join(server.dir, '.mod-upload-' + Date.now());
    try {
      await extractZip(zipFile, tmp);
      const infos = findFiles(tmp, (_rel, name) => name.toLowerCase() === 'modinfo.xml', 6);
      // A ModInfo.xml inside another mod's folder isn't a separate mod.
      const dirs = infos.map((f) => path.dirname(f)).filter((d, _i, all) => !all.some((o) => o !== d && d.startsWith(o + path.sep)));
      if (!dirs.length) throw new HttpError(400, 'No mod found in the .zip (a 7 Days to Die mod is a folder with a ModInfo.xml inside)');
      if (!admin) {
        const code = dirs.flatMap((d) => findFiles(d, (_rel, name) => blockedForNonAdmin(name), 8));
        if (code.length) throw new HttpError(403, `Only an admin can install mods that contain programs or code (${path.basename(code[0])}). They run on this PC.`);
      }
      fs.mkdirSync(modsDir(server), { recursive: true });
      const installed = [];
      for (const d of dirs) {
        let folder = path.basename(d);
        if (d === tmp) folder = (readModInfo(d) || {}).Name || 'Mod';
        folder = modFolder(folder.replace(/[\\/:*?"<>|]+/g, '_'));
        if (BUILTIN_MOD.test(folder)) continue; // never replace the game's own mods from an upload
        for (const base of [modsDir(server), disabledDir(server)]) fs.rmSync(path.join(base, folder), { recursive: true, force: true });
        fs.renameSync(d, path.join(modsDir(server), folder));
        installed.push(folder);
      }
      if (!installed.length) throw new HttpError(400, 'The .zip only contained the game\'s built-in mods');
      return installed;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },

  setModEnabled(server, folder, enabled) {
    const name = modFolder(folder);
    if (BUILTIN_MOD.test(name)) throw new HttpError(400, 'The game\'s own mods (0_TFP_…) stay on; other mods depend on them');
    const from = path.join(enabled ? disabledDir(server) : modsDir(server), name);
    const to = path.join(enabled ? modsDir(server) : disabledDir(server), name);
    if (!fs.existsSync(from)) {
      if (fs.existsSync(to)) return;
      throw new HttpError(404, 'Mod not found');
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(from, to);
  },

  removeMod(server, folder) {
    const name = modFolder(folder);
    if (BUILTIN_MOD.test(name)) throw new HttpError(400, 'The game\'s own mods (0_TFP_…) can\'t be removed');
    let found = false;
    for (const base of [modsDir(server), disabledDir(server)]) {
      const p = path.join(base, name);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        found = true;
      }
    }
    if (!found) throw new HttpError(404, 'Mod not found');
  },
};

module.exports = sdtd;
module.exports.parseProps = parseProps;
module.exports.buildConfig = buildConfig;
module.exports.telnet = telnet;
