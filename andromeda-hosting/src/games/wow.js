'use strict';
// World of Warcraft: Wrath of the Lich King 3.3.5a on cMaNGOS with Mangosbot (playerbots).
// Built around SPP Classics V2 (the Windows repack that bundles cMaNGOS + bots + MySQL + map data),
// but any cMaNGOS folder with mangosd/realmd and their .conf files works too.
//
// Processes, in order: MySQL (SPP's bundled one, bound to this PC only) -> realmd (login) -> mangosd (world).
// Commands go to mangosd's console over stdin (cMaNGOS reads it with fgets, which works with a pipe).
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const db = require('../db');
const { Conf, parseDbInfo } = require('../util/conf');
const { findFiles } = require('../util/paths');
const { HttpError, sleep } = require('../util/misc');

const EXE = process.platform === 'win32' ? '.exe' : '';
const NAME_RE = /^[A-Za-z0-9]{3,16}$/;
// cMaNGOS stores passwords for the WoW client's SRP6 login: max 16 chars; no spaces/quotes so the
// console command can't be split or injected.
const PASS_RE = /^[\x21\x23-\x26\x28-\x7e]{4,16}$/;

// ---------- locating the install ----------
function detect(input) {
  let root = path.resolve(String(input || '').trim());
  const out = { root, layout: null, problems: [], found: {} };
  if (!input || !fs.existsSync(root)) {
    out.problems.push('Folder not found');
    return out;
  }
  if (fs.existsSync(path.join(root, 'SPP_Server', 'Server'))) root = path.join(root, 'SPP_Server');
  out.root = root;
  const sppBin = path.join(root, 'Server', 'Binaries', 'wotlk', 'Bin64');
  if (fs.existsSync(path.join(sppBin, 'mangosd' + EXE))) {
    Object.assign(out, { layout: 'spp', bin: sppBin, confDir: path.join(root, 'Settings', 'wotlk') });
    const dbDir = path.join(root, 'Server', 'Database');
    if (fs.existsSync(path.join(dbDir, 'bin', 'mysqld' + EXE))) out.dbDir = dbDir;
  } else {
    const mangosd = findFiles(root, (_r, n) => n === 'mangosd' + EXE, 4)[0];
    const conf = findFiles(root, (_r, n) => n === 'mangosd.conf', 4)[0];
    if (mangosd) Object.assign(out, { layout: 'custom', bin: path.dirname(mangosd), confDir: conf ? path.dirname(conf) : path.dirname(mangosd) });
  }
  if (!out.layout) {
    out.problems.push(
      fs.existsSync(path.join(root, 'Server', 'Binaries'))
        ? 'This SPP install has no WotLK server yet. Run Server_Update.bat in the SPP folder and choose WotLK first.'
        : "Couldn't find mangosd here. Point to your SPP_Classics_V2 folder (or a cMaNGOS folder)."
    );
    return out;
  }
  const has = (p) => fs.existsSync(p);
  out.found = {
    mangosd: has(path.join(out.bin, 'mangosd' + EXE)),
    realmd: has(path.join(out.bin, 'realmd' + EXE)),
    mangosdConf: has(path.join(out.confDir, 'mangosd.conf')),
    realmdConf: has(path.join(out.confDir, 'realmd.conf')),
    botsConf: has(path.join(out.confDir, 'aiplayerbot.conf')),
    database: !!out.dbDir,
  };
  if (!out.found.realmd) out.problems.push(`realmd${EXE} is missing next to mangosd${EXE}`);
  if (!out.found.mangosdConf) out.problems.push('mangosd.conf is missing');
  if (!out.found.realmdConf) out.problems.push('realmd.conf is missing');
  if (out.found.mangosdConf) {
    const conf = readConf(out.confDir, 'mangosd.conf');
    const dataDir = path.resolve(out.confDir, conf.get('DataDir') || '.');
    out.dataDir = dataDir;
    out.found.mapData = has(path.join(dataDir, 'dbc')) && has(path.join(dataDir, 'maps'));
    if (!out.found.mapData) {
      out.problems.push(
        out.layout === 'spp'
          ? 'Map data is missing. Run Server_Update.bat in the SPP folder and choose WotLK so it downloads the maps.'
          : `Map data (dbc + maps) wasn't found in ${dataDir}. Extract it from a working 3.3.5a client with the cMaNGOS extractors.`
      );
    }
  }
  return out;
}

function paths(server) {
  const d = detect(server.wow.root);
  if (!d.layout) throw new HttpError(400, d.problems.join(' '));
  return d;
}

function readConf(dir, file) {
  const p = path.join(dir, file);
  return new Conf(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
}
function writeConf(dir, file, conf) {
  fs.writeFileSync(path.join(dir, file), conf.toString());
}

// ---------- database ----------
function dbInfo(server, which) {
  const p = paths(server);
  const conf = readConf(p.confDir, 'mangosd.conf');
  const info = parseDbInfo(conf.get(`${which}DatabaseInfo`));
  if (!info) throw new HttpError(400, `${which}DatabaseInfo is missing from mangosd.conf`);
  return info;
}

async function query(server, which, sql, params = []) {
  const mysql = require('mysql2/promise'); // loaded on first use so a missing package can't stop the panel
  const info = dbInfo(server, which);
  const conn = await mysql.createConnection({ ...info, connectTimeout: 4000 });
  try {
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    await conn.end().catch(() => {});
  }
}

function portOpen(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

// Start SPP's bundled MySQL if it isn't running. Bound to 127.0.0.1: its root password is a
// well-known default, so it must never be reachable from the network.
async function ensureDb(instance) {
  const server = instance.server;
  const p = paths(server);
  const info = dbInfo(server, 'Login');
  if (await portOpen(info.host, info.port)) return false;
  if (!(server.wow.manageDb && p.dbDir)) throw new HttpError(400, `MySQL isn't running on ${info.host}:${info.port}. Start it, or turn on "Start the bundled database" in Settings.`);
  const ini = path.join(p.dbDir, 'SPP-Database.ini');
  const args = [
    ...(fs.existsSync(ini) ? [`--defaults-file=${ini}`] : []),
    '--console', '--standalone', '--explicit_defaults_for_timestamp', '--log_syslog=0', '--sql-mode=',
    '--bind-address=127.0.0.1', `--port=${info.port}`,
  ];
  instance.spawnAux('mysql', path.join(p.dbDir, 'bin', 'mysqld' + EXE), args, {
    cwd: p.root,
    filter: (l) => !/\[Note\]/.test(l), // MySQL is chatty; keep warnings and errors
  });
  for (let i = 0; i < 90; i++) {
    if (!instance.auxRunning('mysql')) throw new HttpError(500, 'MySQL stopped while starting. See the console for its error.');
    if (await portOpen(info.host, info.port, 800)) {
      instance.appendConsole('[panel] Database is up.');
      return true;
    }
    await sleep(1000);
  }
  throw new HttpError(500, 'MySQL did not start within 90 seconds');
}

async function stopDb(instance) {
  if (!instance.auxRunning('mysql')) return;
  const server = instance.server;
  try {
    // Clean InnoDB shutdown (a hard kill makes MySQL run crash recovery next time).
    await query(server, 'Login', 'SHUTDOWN');
  } catch {
    const p = paths(server);
    const admin = p.dbDir && path.join(p.dbDir, 'bin', 'mysqladmin' + EXE);
    const cnf = p.dbDir && path.join(p.dbDir, 'connection.cnf');
    if (admin && fs.existsSync(admin) && fs.existsSync(cnf)) {
      await new Promise((r) => spawn(admin, [`--defaults-extra-file=${cnf}`, 'shutdown'], { windowsHide: true }).on('close', r).on('error', r));
    }
  }
  if (!(await instance.waitForAuxExit('mysql', 60000))) {
    instance.appendConsole('[panel] MySQL did not stop in time — forcing it.');
    instance.killAux('mysql');
  }
}

function botPrefix(server) {
  try {
    return (readConf(paths(server).confDir, 'aiplayerbot.conf').get('AiPlayerbot.RandomBotAccountPrefix') || 'rndbot').toLowerCase();
  } catch {
    return 'rndbot';
  }
}

function realmAddress(server) {
  return server.wow.address || db.data.settings.publicAddress || '127.0.0.1';
}

// ---------- settings ----------
const BOOL = 'bool';
const FIELDS = [
  { file: 'mangosd.conf', key: 'Rate.XP.Kill', label: 'XP from kills', type: 'number', step: 0.5, group: 'Rates' },
  { file: 'mangosd.conf', key: 'Rate.XP.Quest', label: 'XP from quests', type: 'number', step: 0.5, group: 'Rates' },
  { file: 'mangosd.conf', key: 'Rate.XP.Explore', label: 'XP from exploring', type: 'number', step: 0.5, group: 'Rates' },
  { file: 'mangosd.conf', key: 'Rate.Rest.InGame', label: 'Rested XP gain', type: 'number', step: 0.5, group: 'Rates' },
  { file: 'mangosd.conf', key: 'Rate.Drop.Money', label: 'Gold drops', type: 'number', step: 0.5, group: 'Rates' },
  { file: 'mangosd.conf', key: 'Rate.Drop.Item.Normal', label: 'Item drops (common)', type: 'number', step: 0.5, group: 'Rates' },
  { file: 'mangosd.conf', key: 'Rate.Drop.Item.Rare', label: 'Item drops (rare)', type: 'number', step: 0.5, group: 'Rates' },
  { file: 'mangosd.conf', key: 'Rate.Drop.Item.Epic', label: 'Item drops (epic)', type: 'number', step: 0.5, group: 'Rates' },
  { file: 'mangosd.conf', key: 'Rate.Reputation.Gain', label: 'Reputation gain', type: 'number', step: 0.5, group: 'Rates' },
  { file: 'mangosd.conf', key: 'Rate.Honor', label: 'Honor gain', type: 'number', step: 0.5, group: 'Rates' },
  { file: 'mangosd.conf', key: 'GameType', label: 'Realm type', type: 'select', options: [{ value: '1', label: 'PvP' }, { value: '0', label: 'Normal (PvE)' }, { value: '6', label: 'RP' }, { value: '8', label: 'RP-PvP' }], group: 'World' },
  { file: 'mangosd.conf', key: 'MaxPlayerLevel', label: 'Max level', type: 'number', group: 'World' },
  { file: 'mangosd.conf', key: 'StartPlayerLevel', label: 'Starting level', type: 'number', group: 'World' },
  { file: 'mangosd.conf', key: 'StartPlayerMoney', label: 'Starting money (copper)', type: 'number', group: 'World' },
  { file: 'mangosd.conf', key: 'PlayerLimit', label: 'Player limit (0 = none)', type: 'number', group: 'World' },
  { file: 'mangosd.conf', key: 'SkipCinematics', label: 'Intro cinematics', type: 'select', options: [{ value: '0', label: 'Always show' }, { value: '1', label: 'Skip after the first character' }, { value: '2', label: 'Always skip' }], group: 'World' },
  { file: 'mangosd.conf', key: 'AllowTwoSide.Accounts', label: 'Horde and Alliance on one account', type: BOOL, group: 'World' },
  { file: 'mangosd.conf', key: 'AllowTwoSide.Interaction.Group', label: 'Cross-faction groups', type: BOOL, group: 'World' },
  { file: 'mangosd.conf', key: 'AllowTwoSide.Interaction.Guild', label: 'Cross-faction guilds', type: BOOL, group: 'World' },
  { file: 'mangosd.conf', key: 'AllowTwoSide.Interaction.Chat', label: 'Cross-faction chat', type: BOOL, group: 'World' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.Enabled', label: 'Bots enabled', type: BOOL, group: 'Bots' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.RandomBotAutologin', label: 'Random bots log in automatically', type: BOOL, group: 'Bots' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.MinRandomBots', label: 'Minimum random bots', type: 'number', group: 'Bots', hint: 'SPP default 1000. Lower it if the server lags. Changing the count later needs a random bot reset.' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.MaxRandomBots', label: 'Maximum random bots', type: 'number', group: 'Bots' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.RandomBotMinLevel', label: 'Bot minimum level', type: 'number', group: 'Bots' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.RandomBotMaxLevel', label: 'Bot maximum level', type: 'number', group: 'Bots' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.RandomBotJoinLfg', label: 'Bots use the dungeon finder', type: BOOL, group: 'Bots' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.RandomBotJoinBG', label: 'Bots join battlegrounds', type: BOOL, group: 'Bots' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.AllowGuildBots', label: 'Bot guilds', type: BOOL, group: 'Bots' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.SyncQuestWithPlayer', label: 'Grouped bots complete quests with you', type: BOOL, group: 'Bots' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.AutoLearnTrainerSpells', label: 'Bots learn trainer spells on level-up', type: BOOL, group: 'Bots' },
  { file: 'aiplayerbot.conf', key: 'AiPlayerbot.AutoLearnQuestSpells', label: 'Bots learn quest spells', type: BOOL, group: 'Bots' },
  { file: 'mangosd.conf', key: 'WorldServerPort', label: 'World port (TCP)', type: 'number', group: 'Network' },
  { file: 'realmd.conf', key: 'RealmServerPort', label: 'Login port (TCP)', type: 'number', group: 'Network' },
];

function confPort(server, file, key, def) {
  try {
    return Number(readConf(paths(server).confDir, file).get(key)) || def;
  } catch {
    return def;
  }
}

const wow = {
  id: 'wow',
  name: 'World of Warcraft',
  consoleMode: 'stdin',
  stopTimeoutMs: 180000, // saving a few thousand bots takes a while
  readyPattern: /mangos>/,
  detect,
  NAME_RE,
  PASS_RE,

  defaults(input) {
    const w = input.wow || {};
    const d = detect(w.root);
    return { root: d.root, realmName: String(w.realmName || input.name).slice(0, 32), address: '', manageDb: true };
  },

  resolveDir(server) {
    return server.wow.root;
  },

  ports(server) {
    return [
      { port: confPort(server, 'realmd.conf', 'RealmServerPort', 3724), proto: 'TCP', label: 'Login (realmd)', forward: true },
      { port: confPort(server, 'mangosd.conf', 'WorldServerPort', 8085), proto: 'TCP', label: 'World (mangosd)', forward: true },
    ];
  },

  connectAddress(server, host) {
    return `set realmlist ${server.wow.address || host}`;
  },

  async install(server, log) {
    const d = detect(server.wow.root);
    if (!d.layout || d.problems.length) throw new Error(d.problems.join(' '));
    server.wow.root = d.root;
    log.info(`Found ${d.layout === 'spp' ? 'SPP Classics' : 'cMaNGOS'} WotLK at ${d.root}`);
    log.info(`Binaries: ${d.bin}`);
    log.info(`Config:   ${d.confDir}`);
    log.info(`Map data: ${d.dataDir}`);
    log.info(d.dbDir ? 'Bundled MySQL found — the panel will start and stop it with the server.' : 'No bundled MySQL — make sure your MySQL is running before you start the server.');
    server.wow.manageDb = !!d.dbDir;
    // The panel talks to the world server through its console.
    const conf = readConf(d.confDir, 'mangosd.conf');
    if (conf.get('Console.Enable') !== '1') {
      conf.set('Console.Enable', 1);
      writeConf(d.confDir, 'mangosd.conf', conf);
      log.info('Turned on Console.Enable in mangosd.conf');
    }
    log.info('Ready. Create game accounts for your friends in the Accounts tab once the server is running.');
  },

  async preStart(instance) {
    const server = instance.server;
    const p = paths(server);
    if (p.problems.length) throw new HttpError(400, p.problems.join(' '));
    await ensureDb(instance);
    // Wait until MySQL actually answers queries, then point the realm list at our public address.
    let lastErr;
    for (let i = 0; i < 30; i++) {
      try {
        const realmId = Number(readConf(p.confDir, 'mangosd.conf').get('RealmID')) || 1;
        const worldPort = confPort(server, 'mangosd.conf', 'WorldServerPort', 8085);
        await query(server, 'Login', 'UPDATE realmlist SET name = ?, address = ?, port = ? WHERE id = ?', [server.wow.realmName || server.name, realmAddress(server), worldPort, realmId]);
        instance.appendConsole(`[panel] Realm "${server.wow.realmName || server.name}" announced at ${realmAddress(server)}:${worldPort}`);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await sleep(1000);
      }
    }
    if (lastErr) throw new HttpError(500, `Couldn't reach the login database: ${lastErr.message}`);
    if (p.layout === 'spp') fs.writeFileSync(path.join(p.confDir, 'name.txt'), server.wow.realmName || server.name);
    if (!instance.auxRunning('realmd')) instance.spawnAux('realmd', path.join(p.bin, 'realmd' + EXE), [], { cwd: p.confDir });
  },

  async buildLaunch(server) {
    const p = paths(server);
    return { command: path.join(p.bin, 'mangosd' + EXE), args: [], cwd: p.confDir };
  },

  async probeReady(server) {
    if (!(await portOpen('127.0.0.1', confPort(server, 'mangosd.conf', 'WorldServerPort', 8085)))) throw new Error('not yet');
    return true;
  },

  async stop(instance) {
    instance.writeStdin('saveall');
    await sleep(3000);
    if (instance.child) instance.writeStdin('server shutdown 0');
  },

  async postStop(instance) {
    instance.killAux('realmd'); // stateless; nothing to save
    await instance.waitForAuxExit('realmd', 5000);
    await stopDb(instance);
  },

  async sendCommand(instance, command) {
    instance.writeStdin(command.replace(/^\./, ''));
  },

  broadcastCommand(msg) {
    return `announce ${msg}`;
  },

  async query(server) {
    const rows = await query(server, 'Character', 'SELECT name, level, account FROM characters WHERE online = 1');
    const ids = [...new Set(rows.map((r) => r.account))];
    const accounts = ids.length ? await query(server, 'Login', 'SELECT id, username FROM account WHERE id IN (?)', [ids]) : [];
    const prefix = botPrefix(server);
    const isBot = new Set(accounts.filter((a) => String(a.username).toLowerCase().startsWith(prefix)).map((a) => a.id));
    const humans = rows.filter((r) => !isBot.has(r.account));
    const limit = confPort(server, 'mangosd.conf', 'PlayerLimit', 0);
    return { online: humans.length, max: limit > 0 ? limit : null, players: humans.map((r) => `${r.name} (${r.level})`), bots: rows.length - humans.length };
  },

  // ---- game accounts (friends-only: nobody can register, you create each account) ----
  async listAccounts(server) {
    const prefix = botPrefix(server);
    const accounts = await query(server, 'Login', 'SELECT id, username, gmlevel, joindate, locked, expansion FROM account WHERE LOWER(username) NOT LIKE ? ORDER BY id', [prefix + '%']);
    let banned = new Set();
    try {
      banned = new Set((await query(server, 'Login', 'SELECT id FROM account_banned WHERE active = 1')).map((r) => r.id));
    } catch {}
    let chars = new Map();
    try {
      chars = new Map((await query(server, 'Character', 'SELECT account, COUNT(*) AS n, SUM(online) AS online FROM characters GROUP BY account')).map((r) => [r.account, r]));
    } catch {}
    return accounts.map((a) => ({
      id: a.id,
      username: a.username,
      gmlevel: a.gmlevel,
      joined: a.joindate,
      expansion: a.expansion,
      banned: banned.has(a.id),
      characters: Number((chars.get(a.id) || {}).n || 0),
      online: Number((chars.get(a.id) || {}).online || 0) > 0,
    }));
  },

  // Walks the same path a WoW client takes and reports where it breaks.
  async diagnose(server, instance) {
    const checks = [];
    const add = (ok, title, detail) => checks.push({ ok, title, detail });
    const p = paths(server);
    const realmId = Number(readConf(p.confDir, 'mangosd.conf').get('RealmID')) || 1;
    const authPort = confPort(server, 'realmd.conf', 'RealmServerPort', 3724);
    add(instance.status === 'running', 'World server finished loading',
      instance.status === 'running' ? 'mangosd is up.' : `Status is "${instance.status}". The first start creates the random bots and can take many minutes; wait for Online.`);
    add(instance.auxRunning('realmd') || (await portOpen('127.0.0.1', authPort)), `Login server answers on port ${authPort}`, 'realmd must be running for the client to log in.');
    let realm = null;
    try {
      realm = (await query(server, 'Login', 'SELECT * FROM realmlist WHERE id = ?', [realmId]))[0]; // columns vary between forks
      if (!realm) add(false, 'Realm list entry', `No realm with id ${realmId} (RealmID in mangosd.conf) in the realmlist table.`);
    } catch (err) {
      add(false, 'Realm list readable', `Couldn't read the realm list: ${err.message}`);
    }
    if (realm) {
      add(true, 'Realm list entry', `"${realm.name}" → ${realm.address}:${realm.port} (this exact address is sent to every client)`);
      if (realm.realmflags !== undefined) add(!(realm.realmflags & 2), 'Realm marked online', realm.realmflags & 2 ? 'The realm is flagged offline. mangosd clears this once it has finished starting; if it stays, the world server is still loading or failed.' : 'mangosd has marked the realm online.');
      const builds = String(realm.realmbuilds || '').split(/\s+/).filter(Boolean);
      add(!builds.length || builds.includes('12340'), 'Accepts the 3.3.5a client (build 12340)', builds.length ? `Allowed builds: ${builds.join(', ')}` : 'No build restriction.');
      if (realm.allowedSecurityLevel !== undefined) add(!(realm.allowedSecurityLevel > 0), 'Open to normal players', realm.allowedSecurityLevel > 0 ? `Only GM level ${realm.allowedSecurityLevel}+ can enter (realmlist.allowedSecurityLevel).` : 'Any account can enter.');
      let ip = realm.address;
      if (!net.isIP(ip)) {
        try {
          ip = (await require('dns').promises.lookup(realm.address, { family: 4 })).address;
          add(true, `"${realm.address}" resolves on this PC`, `→ ${ip}${ip.startsWith('127.') ? ' (this PC, via the hosts file)' : ' — on the hosting PC this should be 127.0.0.1; run scripts\\use-domain-on-this-pc.ps1 as Administrator'}`);
        } catch (err) {
          add(false, `"${realm.address}" resolves on this PC`, `DNS lookup failed (${err.code || err.message}). Check the domain/DNS record.`);
          ip = null;
        }
      }
      if (ip) {
        const ok = await portOpen(ip, realm.port, 2500);
        add(ok, `World port reachable at ${ip}:${realm.port}`, ok ? 'This is where the client goes after you pick the realm.' : 'Nothing answered. If this is your public IP, your router can\'t loop back to it from inside your network: use the hosts-file script on this PC.');
      }
    }
    return checks;
  },

  async accountExists(server, username) {
    const rows = await query(server, 'Login', 'SELECT id FROM account WHERE username = ?', [username.toUpperCase()]);
    return rows.length > 0;
  },

  backupConfig() {
    return { root: null };
  },

  // Saves live in MySQL, so backups are SQL dumps of the login, characters and bot databases.
  async prepareBackup(instance, dir, log) {
    const server = instance.server;
    const p = paths(server);
    const startedDb = await ensureDb(instance);
    try {
      const conf = readConf(p.confDir, 'mangosd.conf');
      const wanted = ['Login', 'Character', 'Playerbot'].map((w) => parseDbInfo(conf.get(`${w}DatabaseInfo`))).filter(Boolean);
      const dump = p.dbDir ? path.join(p.dbDir, 'bin', 'mysqldump' + EXE) : 'mysqldump';
      for (const info of wanted) {
        log.info(`Dumping database ${info.database}...`);
        await runSqlTool(dump, info, ['--single-transaction', '--routines', '--databases', info.database], { out: path.join(dir, `${info.database}.sql`) });
      }
      for (const f of ['mangosd.conf', 'realmd.conf', 'aiplayerbot.conf']) {
        if (fs.existsSync(path.join(p.confDir, f))) fs.copyFileSync(path.join(p.confDir, f), path.join(dir, f));
      }
    } finally {
      if (startedDb && !instance.child) await stopDb(instance);
    }
  },

  async restoreBackup(instance, dir, log) {
    const server = instance.server;
    const p = paths(server);
    const startedDb = await ensureDb(instance);
    try {
      const info = dbInfo(server, 'Login');
      const client = p.dbDir ? path.join(p.dbDir, 'bin', 'mysql' + EXE) : 'mysql';
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
        log.info(`Importing ${f}...`);
        await runSqlTool(client, info, [], { input: path.join(dir, f) });
      }
      for (const f of ['mangosd.conf', 'realmd.conf', 'aiplayerbot.conf']) {
        if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(p.confDir, f));
      }
    } finally {
      if (startedDb && !instance.child) await stopDb(instance);
    }
  },

  settingsSchema(server) {
    const p = paths(server);
    const groups = new Map([['Realm', []]]);
    groups.get('Realm').push(
      { key: 'wow.realmName', label: 'Realm name (shown in the realm list)', type: 'text' },
      { key: 'wow.address', label: 'Address players connect to', type: 'text', hint: `Blank = the panel's public address (${db.data.settings.publicAddress || 'not set — 127.0.0.1'}). Use a hostname like play.example.com.` }
    );
    if (p.dbDir) groups.get('Realm').push({ key: 'wow.manageDb', label: 'Start/stop the bundled MySQL with the server', type: 'bool' });
    for (const f of FIELDS) {
      if (f.file === 'aiplayerbot.conf' && !fs.existsSync(path.join(p.confDir, 'aiplayerbot.conf'))) continue;
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push({ key: `conf.${f.file}.${f.key}`, label: f.label, type: f.type, options: f.options, step: f.step, hint: f.hint });
    }
    return {
      note: `Saved straight into mangosd.conf / aiplayerbot.conf / realmd.conf in ${p.confDir}. Every other option is editable in the Files tab.`,
      sections: [...groups].map(([title, fields]) => ({ title, fields })),
    };
  },

  readSettings(server) {
    const p = paths(server);
    const out = { 'wow.realmName': server.wow.realmName || server.name, 'wow.address': server.wow.address || '', 'wow.manageDb': !!server.wow.manageDb };
    const cache = {};
    for (const f of FIELDS) {
      cache[f.file] = cache[f.file] || readConf(p.confDir, f.file);
      const v = cache[f.file].get(f.key);
      out[`conf.${f.file}.${f.key}`] = f.type === BOOL ? v === '1' : v ?? '';
    }
    return out;
  },

  writeSettings(server, values) {
    const p = paths(server);
    if ('wow.realmName' in values) server.wow.realmName = String(values['wow.realmName'] || '').replace(/['"\\]/g, '').trim().slice(0, 32) || server.name;
    if ('wow.address' in values) {
      const a = String(values['wow.address'] || '').trim();
      if (a && !/^[A-Za-z0-9.-]{1,32}$/.test(a)) throw new HttpError(400, 'Address must be a hostname or IP (max 32 characters, no port)');
      server.wow.address = a;
    }
    if ('wow.manageDb' in values) server.wow.manageDb = !!values['wow.manageDb'];
    const files = {};
    for (const f of FIELDS) {
      const k = `conf.${f.file}.${f.key}`;
      if (!(k in values)) continue;
      if (!fs.existsSync(path.join(p.confDir, f.file))) continue;
      let v = values[k];
      if (f.type === BOOL) v = v ? 1 : 0;
      else if (f.type === 'number') {
        if (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0) continue;
        v = Number(v);
      } else if (f.type === 'select' && !f.options.some((o) => o.value === String(v))) continue;
      files[f.file] = files[f.file] || readConf(p.confDir, f.file);
      files[f.file].set(f.key, v);
    }
    for (const [file, conf] of Object.entries(files)) writeConf(p.confDir, file, conf);
    return { restartRequired: true };
  },
};

// Run mysqldump / mysql with the password in the environment (not visible in the process list).
function runSqlTool(exe, info, extra, { out, input } = {}) {
  return new Promise((resolve, reject) => {
    const args = [`--host=${info.host}`, `--port=${info.port}`, `--user=${info.user}`, '--default-character-set=utf8', ...extra];
    const child = spawn(exe, args, { windowsHide: true, env: { ...process.env, MYSQL_PWD: info.password || '' } });
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => reject(new Error(`${path.basename(exe)}: ${e.message}`)));
    if (out) child.stdout.pipe(fs.createWriteStream(out));
    else child.stdout.resume();
    if (input) fs.createReadStream(input).pipe(child.stdin);
    else child.stdin.end();
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(exe)} failed: ${err.trim().split('\n').pop() || 'exit ' + code}`))));
  });
}

module.exports = wow;
