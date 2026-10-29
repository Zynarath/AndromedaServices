'use strict';
// Satisfactory dedicated server (SteamCMD app 1690800).
// The panel drives it through the server's HTTPS API on the game port: on the first start it claims
// the server (sets the admin password, so nobody else can), starts a new game if there is none,
// and on every start applies the name, join password and server options from Settings. Stops save
// the game first. Mods come from ficsit.app (see services/ficsit.js) and are installed before a
// start whenever the mod list changed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const steamcmd = require('../services/steamcmd');
const ficsit = require('../services/ficsit');
const fields = require('../util/fields');
const { HttpError, randomPassword, splitArgs } = require('../util/misc');

// Satisfactory's dedicated server HTTPS API (POST https://host:<game port>/api/v1).
// Request:  { "function": "QueryServerState", "data": { ... } }, Authorization: Bearer <token>
// Reply:    200 { data: { ... } }, 204 for functions with nothing to return, or
//           4xx/5xx { errorCode, errorMessage }.
// The server makes its own self-signed certificate, so certificate checks are off; the panel only
// ever talks to it on 127.0.0.1.
const api = (() => {
  class ApiError extends Error {
    constructor(status, code, message) {
      super(message || code || `HTTP ${status}`);
      this.status = status;
      this.code = code;
    }
  }

  function call(port, fn, data = {}, { token, timeout = 10000, host = '127.0.0.1' } = {}) {
    const body = JSON.stringify({ function: fn, data });
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return new Promise((resolve, reject) => {
      const req = https.request({ host, port, path: '/api/v1', method: 'POST', headers, rejectUnauthorized: false, timeout }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {}
          if (res.statusCode >= 400 || (json && json.errorCode)) {
            return reject(new ApiError(res.statusCode, json && json.errorCode, (json && json.errorMessage) || (json && json.errorCode) || `${fn}: HTTP ${res.statusCode}`));
          }
          resolve(json && json.data !== undefined ? json.data : json || {});
        });
      });
      req.on('timeout', () => req.destroy(new Error(`${fn}: no answer from the Satisfactory server`)));
      req.on('error', reject);
      req.end(body);
    });
  }
  return { call, ApiError };
})();

const APP_ID = 1690800;
const BINARIES = {
  win32: { direct: 'Engine/Binaries/Win64/FactoryServer-Win64-Shipping-Cmd.exe', wrapper: 'FactoryServer.exe' },
  linux: { direct: 'Engine/Binaries/Linux/FactoryServer-Linux-Shipping', wrapper: 'FactoryServer.sh' },
};

const GROUPS = ['Server', 'Gameplay', 'Saving', 'Advanced'];
const FIELDS = [
  { name: 'serverName', label: 'Server name', type: 'text', group: 'Server', maxLength: 64, required: true },
  { name: 'clientPassword', label: 'Join password (blank = anyone can join)', type: 'text', group: 'Server', maxLength: 64 },
  { name: 'adminPassword', label: 'Admin password', type: 'text', group: 'Server', maxLength: 64, required: true, admin: true, hint: 'Admin only. For the in-game Server Manager. The panel uses it too, so change it here rather than in the game.' },
  { name: 'maxPlayers', label: 'Max players', type: 'number', group: 'Server', min: 1, max: 64, def: 4, hint: 'Satisfactory is balanced for 4; more works but costs CPU.' },
  { name: 'port', label: 'Game port (UDP + TCP)', type: 'number', group: 'Server', min: 1024, max: 65535, def: 7777, required: true },
  { name: 'reliablePort', label: 'Reliable messaging port (TCP)', type: 'number', group: 'Server', min: 1024, max: 65535, def: 8888, required: true },
  { name: 'autoPause', label: 'Pause when nobody is online', type: 'bool', group: 'Gameplay', def: true },
  { name: 'saveOnDisconnect', label: 'Save when a player leaves', type: 'bool', group: 'Gameplay', def: true },
  { name: 'seasonalEvents', label: 'Seasonal events (FICSMAS)', type: 'bool', group: 'Gameplay', def: true },
  { name: 'networkQuality', label: 'Network quality', type: 'select', group: 'Gameplay', def: '3', options: [['0', 'Low'], ['1', 'Medium'], ['2', 'High'], ['3', 'Ultra']] },
  { name: 'autosaveMinutes', label: 'Autosave every (minutes)', type: 'number', group: 'Saving', min: 1, max: 600, def: 5 },
  { name: 'autosaveCount', label: 'Autosaves to keep', type: 'number', group: 'Saving', min: 1, max: 100, def: 5 },
  { name: 'multihome', label: 'Listen only on this IP', type: 'text', group: 'Advanced', admin: true, pattern: /^[0-9a-fA-F.:]+$/, patternHint: 'an IP address', hint: 'Admin only. Blank = every network card (normal).' },
  { name: 'extraArgs', label: 'Extra command-line arguments', type: 'text', group: 'Advanced', admin: true, maxLength: 500, hint: 'Admin only.' },
];

const sf = (server) => server.sf;
const tokens = new Map(); // server id -> admin token (memory only)

// Where the dedicated server keeps saves (it ignores the install folder for these).
function savesDir() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'FactoryGame', 'Saved', 'SaveGames');
  return path.join(os.homedir(), '.config', 'Epic', 'FactoryGame', 'Saved', 'SaveGames');
}

function binary(server) {
  const b = BINARIES[process.platform];
  if (!b) return null;
  const direct = path.join(server.dir, b.direct);
  if (fs.existsSync(direct)) return { exe: direct, direct: true };
  return { exe: path.join(server.dir, b.wrapper), direct: false };
}

const call = (server, fn, data, opts = {}) => api.call(sf(server).port, fn, data, opts);

// An admin token: claim the server if nobody has, otherwise log in with the admin password.
async function adminToken(server, instance, { fresh = false } = {}) {
  const s = sf(server);
  if (!fresh && tokens.has(server.id)) return tokens.get(server.id);
  let token = null;
  try {
    const r = await call(server, 'PasswordlessLogin', { MinimumPrivilegeLevel: 'InitialAdmin' });
    // Unclaimed: take it, so the admin password is the panel's and not whoever connects first.
    const claimed = await call(server, 'ClaimServer', { ServerName: s.serverName, AdminPassword: s.adminPassword }, { token: r.authenticationToken });
    token = claimed.authenticationToken;
    s.appliedAdminPassword = s.adminPassword;
    if (instance) instance.appendConsole(`[panel] Claimed the server as "${s.serverName}". The admin password is in Settings.`);
  } catch (err) {
    if (err instanceof api.ApiError && err.status < 500) {
      const tryLogin = async (pw) => (await call(server, 'PasswordLogin', { MinimumPrivilegeLevel: 'Administrator', Password: pw })).authenticationToken;
      try {
        token = await tryLogin(s.adminPassword);
        s.appliedAdminPassword = s.adminPassword;
      } catch (e) {
        // The password was changed in Settings: log in with the old one, then switch it.
        if (!s.appliedAdminPassword || s.appliedAdminPassword === s.adminPassword) throw new Error('The server was claimed with a different admin password. Enter that password under Settings → Admin password.');
        token = await tryLogin(s.appliedAdminPassword);
        await call(server, 'SetAdminPassword', { Password: s.adminPassword, AuthenticationToken: token }, { token });
        s.appliedAdminPassword = s.adminPassword;
        token = await tryLogin(s.adminPassword);
        if (instance) instance.appendConsole('[panel] Admin password changed.');
      }
    } else throw err;
  }
  tokens.set(server.id, token);
  return token;
}

// Call with the admin token, logging in again once if it was rejected (e.g. after a restart).
async function adminCall(server, fn, data, instance) {
  try {
    return await call(server, fn, data, { token: await adminToken(server, instance) });
  } catch (err) {
    if (!(err instanceof api.ApiError) || (err.status !== 401 && err.status !== 403)) throw err;
    return call(server, fn, data, { token: await adminToken(server, instance, { fresh: true }) });
  }
}

function serverOptions(s) {
  const b = (v) => (v ? 'True' : 'False');
  return {
    'FG.DSAutoPause': b(s.autoPause),
    'FG.DSAutoSaveOnDisconnect': b(s.saveOnDisconnect),
    'FG.AutosaveInterval': String(Math.round((s.autosaveMinutes || 5) * 60)),
    'FG.NetworkQuality': String(s.networkQuality ?? '3'),
  };
}

// Run once the API answers after every start.
async function configure(server, instance) {
  const s = sf(server);
  await adminToken(server, instance, { fresh: true });
  await adminCall(server, 'RenameServer', { ServerName: s.serverName }, instance);
  await adminCall(server, 'SetClientPassword', { Password: s.clientPassword || '' }, instance);
  await adminCall(server, 'ApplyServerOptions', { UpdatedServerOptions: serverOptions(s) }, instance);
  const sessions = await adminCall(server, 'EnumerateSessions', {}, instance).catch(() => null);
  const state = (await adminCall(server, 'QueryServerState', {}, instance)).serverGameState || {};
  if (!state.isGameRunning && sessions && !(sessions.sessions || []).length) {
    const name = s.serverName.replace(/[^\w\- ]+/g, '').trim().slice(0, 32) || 'Factory';
    await adminCall(server, 'CreateNewGame', { NewGameData: { SessionName: name } }, instance);
    instance.appendConsole(`[panel] No saves yet, so the panel started a new game ("${name}"). Pick a different start in the in-game Server Manager if you like.`);
  }
  instance.appendConsole('[panel] Server name, join password and options applied.');
}

const satisfactory = {
  id: 'satisfactory',
  name: 'Satisfactory',
  consoleMode: 'api',
  stopTimeoutMs: 90000,
  FIELDS,
  savesDir,

  defaults(input) {
    const v = input.sf || {};
    return {
      ...fields.defaults(FIELDS, { ...v, serverName: v.serverName || input.name, adminPassword: v.adminPassword || randomPassword(12) }),
      mods: [],
      modsInstalled: {},
      modsDirty: false,
    };
  },

  ports(server) {
    const s = sf(server);
    return [
      { port: s.port, proto: 'TCP+UDP', label: 'Game + server API', forward: true },
      { port: s.reliablePort, proto: 'TCP', label: 'Reliable messaging', forward: true },
    ];
  },

  connectAddress(server, host) {
    return `${host}:${sf(server).port}`;
  },

  async install(server, log, opts = {}) {
    if (!BINARIES[process.platform]) throw new Error('The Satisfactory dedicated server runs on Windows and Linux.');
    log.info(`${opts.isUpdate ? 'Updating' : 'Installing'} the Satisfactory dedicated server via SteamCMD (app ${APP_ID}).`);
    if (!opts.isUpdate) log.info('The first install downloads about 8 GB.');
    await steamcmd.appUpdate(APP_ID, server.dir, { validate: !!opts.validate, log });
    if (sf(server).mods.length) {
      // A new game build can need newer mod versions.
      sf(server).modsDirty = true;
      await this.syncMods(server, log).catch((err) => log.warn(`Mods: ${err.message} They'll be tried again on the next start.`));
    }
    log.info('Satisfactory is installed.');
  },

  // Install / update / remove mods so FactoryGame/Mods matches the list. `update` takes newer versions.
  async syncMods(server, log) {
    const s = sf(server);
    if (!s.mods.length && !Object.keys(s.modsInstalled || {}).length) {
      s.modsDirty = false;
      return {};
    }
    const game = ficsit.gameBuild(server.dir);
    log.info(`Resolving ${s.mods.length} mod(s) and their dependencies on ficsit.app${game ? ` for game build ${game}` : ''}...`);
    if (!game) log.warn('Could not read the game build number; mods are not checked against it.');
    const chosen = s.mods.length ? await ficsit.resolve(s.mods.map((m) => ({ ref: m.ref, version: m.version || null })), { game, log }) : new Map();
    s.modsInstalled = await ficsit.install(server.dir, chosen, s.modsInstalled || {}, { log });
    s.modsRemote = [...chosen.values()].filter((c) => c.version.required_on_remote).map((c) => ({ ref: c.mod.mod_reference, name: c.mod.name, version: c.version.version }));
    s.modsDirty = false;
    s.modsGame = game;
    return s.modsInstalled;
  },

  async preStart(instance) {
    const s = sf(instance.server);
    if (!s.modsDirty) return;
    const log = { info: (m) => instance.appendConsole(`[mods] ${m}`), warn: (m) => instance.appendConsole(`[mods] WARN: ${m}`), progress() {} };
    await this.syncMods(instance.server, log);
  },

  async buildLaunch(server) {
    const s = sf(server);
    const bin = binary(server);
    if (!bin) throw new HttpError(400, 'Satisfactory servers run on Windows and Linux.');
    if (!fs.existsSync(bin.exe)) throw new HttpError(400, 'Server files are missing. Use Reinstall in Settings.');
    tokens.delete(server.id);
    const args = [
      ...(bin.direct ? ['FactoryGame'] : []),
      `-Port=${s.port}`,
      `-ReliablePort=${s.reliablePort}`,
      '-log',
      '-unattended',
      `-ini:Game:[/Script/Engine.GameSession]:MaxPlayers=${s.maxPlayers || 4}`,
      `-ini:Engine:[/Script/FactoryGame.FGSaveSession]:mNumRotatingAutosaves=${s.autosaveCount || 5}`,
    ];
    if (s.multihome) args.push(`-multihome=${s.multihome}`);
    if (!s.seasonalEvents) args.push('-DisableSeasonalEvents');
    args.push(...splitArgs(s.extraArgs));
    return {
      command: bin.exe,
      args,
      cwd: path.dirname(bin.exe),
      // The wrapper starts the real server as a child, so its output only reaches the log file.
      logFile: bin.direct ? null : path.join(server.dir, 'FactoryGame', 'Saved', 'Logs', 'FactoryGame.log'),
    };
  },

  async probeReady(server) {
    await call(server, 'HealthCheck', { ClientCustomData: '' }, { timeout: 5000 });
    return true;
  },

  onReady(server, instance) {
    configure(server, instance).catch((err) => instance.appendConsole(`[panel] Couldn't set up the server through its API: ${err.message}`));
  },

  async stop(instance) {
    const server = instance.server;
    try {
      const state = (await adminCall(server, 'QueryServerState', {}, instance)).serverGameState || {};
      if (state.isGameRunning && state.activeSessionName) {
        const name = `${state.activeSessionName}_panel`.replace(/[^\w\- ]+/g, '_');
        await adminCall(server, 'SaveGame', { SaveName: name }, instance);
        instance.appendConsole(`[panel] Game saved as "${name}", shutting down...`);
      }
      await adminCall(server, 'Shutdown', {}, instance);
    } catch (err) {
      instance.appendConsole(`[panel] Server API unavailable (${err.message}); stopping the process.`);
      instance.kill();
    }
  },

  async sendCommand(instance, command) {
    const r = await adminCall(instance.server, 'RunCommand', { Command: command.replace(/^\//, '') }, instance);
    const out = String(r.commandResult || '').trim();
    instance.appendConsole(`[api] ${out || '(no response)'}`);
    return out;
  },

  async beforeBackup(instance) {
    const state = (await adminCall(instance.server, 'QueryServerState', {}, instance)).serverGameState || {};
    if (state.isGameRunning && state.activeSessionName) {
      await adminCall(instance.server, 'SaveGame', { SaveName: `${state.activeSessionName}_panel`.replace(/[^\w\- ]+/g, '_') }, instance);
      await new Promise((r) => setTimeout(r, 3000));
    }
  },

  async query(server) {
    const state = (await adminCall(server, 'QueryServerState', {})).serverGameState || {};
    return { online: Number(state.numConnectedPlayers) || 0, max: Number(state.playerLimit) || sf(server).maxPlayers, players: [], map: state.activeSessionName || undefined };
  },

  // The dedicated server keeps its saves (and its claim, ServerSettings.<port>.sav) in the user
  // profile, not the install folder, so backups copy that folder.
  backupConfig() {
    return { root: path.join(savesDir(), 'server'), ignore: [] };
  },

  async prepareBackup(instance, dir) {
    const src = path.join(savesDir(), 'server');
    if (!fs.existsSync(src)) throw new Error(`No Satisfactory saves found yet in ${src}`);
    fs.cpSync(src, path.join(dir, 'server'), { recursive: true });
  },

  async restoreBackup(instance, dir, log) {
    const src = path.join(dir, 'server');
    if (!fs.existsSync(src)) throw new Error('This backup has no Satisfactory saves in it');
    const dest = path.join(savesDir(), 'server');
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      log.info(`Restoring ${f}`);
      fs.cpSync(path.join(src, f), path.join(dest, f), { recursive: true, force: true });
    }
  },

  settingsSchema(server) {
    return {
      note: `The name, passwords and options are applied through the server's API every time it starts. Saves live in ${path.join(savesDir(), 'server')} (shared by every Satisfactory server on this PC; the panel backs that folder up).`,
      sections: fields.schema('sf', FIELDS, GROUPS, { collapsed: ['Saving', 'Advanced'] }).map((sec) =>
        sec.title === 'Server' && sf(server).appliedAdminPassword && sf(server).appliedAdminPassword !== sf(server).adminPassword
          ? { ...sec, fields: sec.fields.map((f) => (f.key === 'sf.adminPassword' ? { ...f, hint: `${f.hint} The new password is set on the next start.` } : f)) }
          : sec
      ),
    };
  },

  readSettings(server, opts = {}) {
    const out = fields.read('sf', FIELDS, sf(server));
    if (!opts.admin) delete out['sf.adminPassword'];
    return out;
  },

  writeSettings(server, values, opts = {}) {
    const changes = fields.parse('sf', FIELDS, values, opts);
    const next = { ...sf(server), ...changes };
    if (next.port === next.reliablePort) throw new HttpError(400, 'The game port and reliable messaging port must differ');
    Object.assign(sf(server), changes);
    return { restartRequired: true };
  },

  closeRcon(server) {
    tokens.delete(server.id);
  },
};

module.exports = satisfactory;
module.exports.api = api; // the HTTPS API client (tests stand in a fake server through api.call)
