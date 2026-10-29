'use strict';
// Valheim dedicated server (SteamCMD app 896660). Everything is set on the command line; worlds
// live in this server's own folder (-savedir), and the admin / allow / ban lists are plain files
// next to them. Valheim has no RCON or stdin console: it saves and exits on Ctrl+C.
const fs = require('fs');
const path = require('path');
const steamcmd = require('../services/steamcmd');
const a2s = require('../util/a2s');
const fields = require('../util/fields');
const { sendCtrlC } = require('../util/ctrlc');
const { HttpError, randomPassword } = require('../util/misc');
const { splitArgs } = require('./minecraft');

const APP_ID = 896660;
const GAME_APP_ID = '892970'; // the game itself; the server needs it in SteamAppId
const EXE = { win32: 'valheim_server.exe', linux: 'valheim_server.x86_64' };

const LISTS = [
  ['admins', 'adminlist.txt', 'Admins', 'Can use the in-game admin console (F5): kick, ban, save… One ID per line.'],
  ['permitted', 'permittedlist.txt', 'Allowed players', 'When this has anyone in it, only these players can join (password still needed). One ID per line.'],
  ['banned', 'bannedlist.txt', 'Banned players', 'One ID per line.'],
];
const ID_LIST = /^[\w:.\- \n]*$/;
const ID_HINT = 'Steam IDs (7656…) or crossplay IDs, e.g. Steam_7656… / Xbox_…';

const MODIFIERS = {
  combat: [['', 'Default'], ['veryeasy', 'Very easy'], ['easy', 'Easy'], ['hard', 'Hard'], ['veryhard', 'Very hard']],
  deathpenalty: [['', 'Default'], ['casual', 'Casual'], ['veryeasy', 'Very easy'], ['easy', 'Easy'], ['hard', 'Hard'], ['hardcore', 'Hardcore']],
  resources: [['', 'Default'], ['muchless', 'Much less'], ['less', 'Less'], ['more', 'More'], ['muchmore', 'Much more'], ['most', 'Most']],
  raids: [['', 'Default'], ['none', 'None'], ['muchless', 'Much less'], ['less', 'Less'], ['more', 'More'], ['muchmore', 'Much more']],
  portals: [['', 'Default'], ['casual', 'Casual (everything goes through)'], ['hard', 'Hard (no boss portals)'], ['veryhard', 'Very hard (no portals)']],
};
const KEYS = [
  ['nobuildcost', 'No build cost'],
  ['playerevents', 'Raids depend on each player\'s progress'],
  ['passivemobs', 'Passive enemies (they don\'t attack first)'],
  ['nomap', 'No map'],
];

const GROUPS = ['Server', 'World modifiers', 'Saving', 'Players', 'Advanced'];
const FIELDS = [
  { name: 'serverName', label: 'Name in the server list', type: 'text', group: 'Server', maxLength: 64, required: true },
  { name: 'password', label: 'Join password', type: 'text', group: 'Server', maxLength: 64, hint: 'At least 5 characters, and not part of the server name (Valheim\'s rules).' },
  { name: 'worldName', label: 'World name', type: 'text', group: 'Server', maxLength: 40, required: true, pattern: /^[A-Za-z0-9_\- ]+$/, patternHint: 'letters, numbers, spaces, - and _', hint: 'A new name starts a new world; the old one stays in the saves folder.' },
  { name: 'public', label: 'Show in the community server list', type: 'bool', group: 'Server', def: true },
  { name: 'crossplay', label: 'Crossplay (Xbox / Game Pass players can join)', type: 'bool', group: 'Server', def: false, hint: 'Players then join with the join code shown in the console instead of the address.' },
  { name: 'port', label: 'Port (UDP, uses this and the next one)', type: 'number', group: 'Server', min: 1024, max: 65530, def: 2456, required: true },
  {
    name: 'preset', label: 'Difficulty preset', type: 'select', group: 'World modifiers', def: '',
    options: [['', 'Normal (default)'], ['casual', 'Casual'], ['easy', 'Easy'], ['hard', 'Hard'], ['hardcore', 'Hardcore'], ['immersive', 'Immersive'], ['hammer', 'Hammer mode']],
    hint: 'The settings below change single things on top of the preset.',
  },
  { name: 'combat', label: 'Combat', type: 'select', group: 'World modifiers', def: '', options: MODIFIERS.combat },
  { name: 'deathpenalty', label: 'Death penalty', type: 'select', group: 'World modifiers', def: '', options: MODIFIERS.deathpenalty },
  { name: 'resources', label: 'Resources', type: 'select', group: 'World modifiers', def: '', options: MODIFIERS.resources },
  { name: 'raids', label: 'Raids', type: 'select', group: 'World modifiers', def: '', options: MODIFIERS.raids },
  { name: 'portals', label: 'Portals', type: 'select', group: 'World modifiers', def: '', options: MODIFIERS.portals },
  ...KEYS.map(([name, label]) => ({ name, label, type: 'bool', group: 'World modifiers', def: false })),
  { name: 'saveInterval', label: 'Save the world every (minutes)', type: 'number', group: 'Saving', min: 1, max: 600, def: 10, hint: 'Valheim\'s own default is 30. The panel also saves on every stop.' },
  { name: 'backups', label: 'World backups Valheim keeps', type: 'number', group: 'Saving', min: 1, max: 100, def: 4 },
  { name: 'backupShort', label: 'Minutes between the first backups', type: 'number', group: 'Saving', min: 1, max: 10000, def: 120 },
  { name: 'backupLong', label: 'Minutes between later backups', type: 'number', group: 'Saving', min: 1, max: 100000, def: 720 },
  ...LISTS.map(([name, , label, hint]) => ({ name, label, type: 'textarea', group: 'Players', pattern: ID_LIST, patternHint: ID_HINT, hint })),
  { name: 'extraArgs', label: 'Extra command-line arguments', type: 'text', group: 'Advanced', admin: true, maxLength: 500, hint: 'Admin only. Added to the end of the server\'s command line.' },
];

const vh = (server) => server.vh;
const savesDir = (server) => path.join(server.dir, 'saves');
const exePath = (server) => (EXE[process.platform] ? path.join(server.dir, EXE[process.platform]) : null);

function checkPassword(v) {
  if (!v.password || v.password.length < 5) throw new HttpError(400, 'Valheim needs a join password of at least 5 characters');
  if (v.serverName.toLowerCase().includes(v.password.toLowerCase())) throw new HttpError(400, 'Valheim doesn\'t allow the password to be part of the server name');
}

function writeLists(server) {
  const dir = savesDir(server);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, file, label] of LISTS) {
    const ids = String(vh(server)[name] || '').split('\n').map((s) => s.trim()).filter(Boolean);
    fs.writeFileSync(path.join(dir, file), [`// ${label} — managed by Andromeda Hosting (Settings → Players). One ID per line.`, ...ids].join('\n') + '\n');
  }
}

const valheim = {
  id: 'valheim',
  name: 'Valheim',
  consoleMode: 'none',
  stopTimeoutMs: 90000,
  // Logged once the server is registered and joinable.
  readyPattern: /Game server connected|Session ".*" with join code/,
  FIELDS,

  defaults(input) {
    const v = input.vh || {};
    const out = fields.defaults(FIELDS, {
      ...v,
      serverName: v.serverName || input.name,
      worldName: String(v.worldName || input.name || 'Dedicated').replace(/[^A-Za-z0-9_\- ]+/g, '').trim().slice(0, 40) || 'Dedicated',
    });
    if (!out.password || out.password.length < 5 || out.serverName.toLowerCase().includes(out.password.toLowerCase())) out.password = v.password && v.password.length >= 5 ? v.password : randomPassword(8);
    return out;
  },

  ports(server) {
    return [
      { port: vh(server).port, proto: 'UDP', label: 'Game', forward: true },
      { port: vh(server).port + 1, proto: 'UDP', label: 'Steam query', forward: true },
    ];
  },

  connectAddress(server, host) {
    return `${host}:${vh(server).port}`;
  },

  async install(server, log, opts = {}) {
    if (!EXE[process.platform]) throw new Error('The Valheim dedicated server runs on Windows and Linux.');
    log.info(`${opts.isUpdate ? 'Updating' : 'Installing'} the Valheim dedicated server via SteamCMD (app ${APP_ID}).`);
    if (!opts.isUpdate) log.info('The first install downloads about 1–2 GB.');
    await steamcmd.appUpdate(APP_ID, server.dir, { validate: !!opts.validate, log });
    writeLists(server);
    log.info('Valheim is installed.');
  },

  saveFiles(server) {
    writeLists(server);
  },

  async buildLaunch(server) {
    const v = vh(server);
    const exe = exePath(server);
    if (!exe) throw new HttpError(400, 'Valheim servers run on Windows and Linux.');
    if (!fs.existsSync(exe)) throw new HttpError(400, 'Server files are missing. Use Reinstall in Settings.');
    checkPassword(v);
    writeLists(server);
    const args = [
      '-nographics', '-batchmode',
      '-name', v.serverName,
      '-port', String(v.port),
      '-world', v.worldName,
      '-password', v.password,
      '-public', v.public ? '1' : '0',
      '-savedir', savesDir(server),
      '-logFile', path.join(server.dir, 'valheim-server.log'),
      '-saveinterval', String(Math.round((v.saveInterval || 10) * 60)),
      '-backups', String(v.backups || 4),
      '-backupshort', String(Math.round((v.backupShort || 120) * 60)),
      '-backuplong', String(Math.round((v.backupLong || 720) * 60)),
    ];
    if (v.crossplay) args.push('-crossplay');
    if (v.preset) args.push('-preset', v.preset);
    for (const m of Object.keys(MODIFIERS)) if (v[m]) args.push('-modifier', m, v[m]);
    for (const [k] of KEYS) if (v[k]) args.push('-setkey', k);
    args.push(...splitArgs(v.extraArgs));
    const env = { SteamAppId: GAME_APP_ID };
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [path.join(server.dir, 'linux64'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    return { command: exe, args, cwd: server.dir, env, logFile: path.join(server.dir, 'valheim-server.log') };
  },

  async stop(instance) {
    instance.appendConsole('[panel] Asking Valheim to save the world and shut down (Ctrl+C)...');
    if (!(await sendCtrlC(instance.child))) {
      instance.appendConsole('[panel] Could not send Ctrl+C; stopping the process. Progress since the last autosave may be lost.');
      instance.kill();
    }
  },

  async sendCommand() {
    throw new HttpError(400, 'Valheim has no server console. Admins (Settings → Players) can use the in-game console (F5) instead.');
  },

  async query(server) {
    const info = await a2s.queryInfo('127.0.0.1', vh(server).port + 1);
    return { online: info.players, max: info.maxPlayers || 10, players: [] };
  },

  backupConfig(server) {
    return { root: savesDir(server), ignore: [] };
  },

  settingsSchema() {
    return {
      note: 'Valheim reads these from its command line, so changes apply on the next (re)start. Worlds are kept in this server\'s saves folder (Files tab → saves/worlds_local).',
      sections: fields.schema('vh', FIELDS, GROUPS, { collapsed: ['Saving', 'Advanced'] }),
    };
  },

  readSettings(server) {
    return fields.read('vh', FIELDS, vh(server));
  },

  writeSettings(server, values, opts = {}) {
    const changes = fields.parse('vh', FIELDS, values, opts);
    const next = { ...vh(server), ...changes };
    checkPassword(next);
    Object.assign(vh(server), changes);
    return { restartRequired: true };
  },
};

module.exports = valheim;
