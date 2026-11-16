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
const { spawn, execFile } = require('child_process');
const ddns = require('../services/ddns');
const { Conf, parseDbInfo, describeConf, looksBoolean, docInfo } = require('../util/conf');
const modconfig = require('../util/modconfig');
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

// mangosd shuts itself down while loading auctions ("AuctionHouseMgr::AddAItem():
// mAitems.find(it->GetGUIDLow()) == mAitems.end()") when two rows of the auction table hold the same
// item, which an interrupted save can leave behind. Keep the oldest listing per item, remove the
// others, and save the removed rows to a file so nothing disappears without a record.
async function repairAuctions(instance, q = query) {
  const server = instance.server;
  let dupes;
  try {
    dupes = await q(server, 'Character', 'SELECT a.* FROM auction a JOIN (SELECT itemguid, MIN(id) AS keep_id FROM auction GROUP BY itemguid HAVING COUNT(*) > 1) d ON a.itemguid = d.itemguid AND a.id <> d.keep_id');
  } catch (err) {
    instance.appendConsole(`[panel] Couldn't check the auction house for duplicate listings: ${err.message}`);
    return 0;
  }
  if (!dupes.length) return 0;
  const file = path.join(paths(server).confDir, `andromeda-removed-auctions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(dupes, null, 2));
  await q(server, 'Character', `DELETE FROM auction WHERE id IN (${dupes.map(() => '?').join(',')})`, dupes.map((r) => r.id));
  instance.appendConsole(`[panel] Removed ${dupes.length} duplicate auction listing(s) (the same item listed twice), which stop the world server from starting. The removed rows are saved in ${file}`);
  return dupes.length;
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

// After "Halting process..." (characters and bots are saved by then) mangosd on Windows waits for
// its console thread, which sits reading stdin. It wakes it by typing into the console window, but
// the panel gives it a pipe instead of a console, so that never arrives and mangosd hangs there.
// Sending empty lines and closing stdin lets the thread finish; if it still hasn't exited after a
// minute, only mangosd is ended (MySQL is then shut down cleanly as usual).
function unblockConsoleOnHalt(instance, child) {
  let timers = [];
  const onLine = ({ line }) => {
    if (!/Halting process/i.test(line) || timers.length) return;
    const poke = () => {
      try {
        if (child.stdin.writable) child.stdin.write('\n');
      } catch {}
    };
    timers = [
      setTimeout(poke, 500),
      setTimeout(poke, 2000),
      setTimeout(() => {
        try {
          child.stdin.end();
        } catch {}
      }, 4000),
      setTimeout(() => {
        if (instance.child !== child) return;
        instance.appendConsole('[panel] The world server saved and halted but did not exit — ending it.');
        if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
        else child.kill('SIGKILL');
      }, 60000),
    ];
  };
  instance.on('console', onLine);
  child.once('exit', () => {
    instance.off('console', onLine);
    timers.forEach(clearTimeout);
  });
}

function botPrefix(server) {
  try {
    return (readConf(paths(server).confDir, 'aiplayerbot.conf').get('AiPlayerbot.RandomBotAccountPrefix') || 'rndbot').toLowerCase();
  } catch {
    return 'rndbot';
  }
}

function realmAddress(server) {
  return server.wow.address || ddns.publicAddress() || '127.0.0.1';
}

// ---------- settings ----------
// The settings people change, written out by hand: a plain name, what it does, a slider range and
// whether it shows straight away (`common`) or behind "Show more". Everything else in the .conf
// files is listed under "All options" from the files' own documentation (confOptions below).
//   std     the original game's value, used when the file doesn't document a default
//   def     switches only: what the server does when the line is missing (see boolDefault)
//   slider  { min, max, step, soft }: soft = a convenient range, the number box takes any value
const BOOL = 'bool';
const M = 'mangosd.conf';
const B = 'aiplayerbot.conf';
const rate = (key, label, hint, o = {}) => ({ file: M, key, label, type: 'number', step: 0.5, group: 'Rates', unit: '×', std: 1, slider: { min: 0, max: 10, step: 0.5, soft: true }, hint, ...o });
const skill = (key, label, what) => ({ file: M, key, label, type: 'number', group: 'Rates', std: 1, slider: { min: 1, max: 10, step: 1, soft: true }, hint: `How many points ${what} go up each time they increase. 1 is the original game.` });
const world = (key, label, type, hint, o = {}) => ({ file: M, key, label, type, group: 'World', hint, ...o });
const chars = (key, label, type, hint, o = {}) => ({ file: M, key, label, type, group: 'Characters', hint, ...o });
const pvp = (key, label, hint, o = {}) => ({ file: M, key, label, type: BOOL, group: 'Instances & PvP', hint, ...o });
const bot = (key, label, type, hint, o = {}) => ({ file: B, key: `AiPlayerbot.${key}`, label, type, group: 'Bots', hint, ...o });
const LEVELS = { min: 1, max: 80, step: 1, soft: true };
const XP = { slider: { min: 0, max: 20, step: 0.5, soft: true }, common: true };

const FIELDS = [
  rate('Rate.XP.Kill', 'XP from kills', 'Experience for killing creatures. 1× is the original game; 2× levels twice as fast.', XP),
  rate('Rate.XP.Quest', 'XP from quests', 'Experience for handing in quests.', XP),
  rate('Rate.XP.Explore', 'XP from exploring', 'Experience for discovering a new area on the map.', XP),
  rate('Rate.Rest.InGame', 'Rested XP gain', 'How fast the rested bonus (the blue part of the XP bar) builds while a character is online in an inn or city.'),
  rate('Rate.Drop.Money', 'Gold drops', 'How much money creatures carry.', { common: true }),
  rate('Rate.Drop.Item.Normal', 'Item drops (common)', 'How often creatures drop white items.'),
  rate('Rate.Drop.Item.Rare', 'Item drops (rare)', 'How often creatures drop blue items.', { common: true }),
  rate('Rate.Drop.Item.Epic', 'Item drops (epic)', 'How often creatures and bosses drop purple items.', { common: true }),
  rate('Rate.Reputation.Gain', 'Reputation gain', 'Reputation from kills and quests.', { common: true }),
  rate('Rate.Honor', 'Honor gain', 'Honor from player kills and battlegrounds.', { common: true }),
  rate('Rate.Drop.Item.Uncommon', 'Item drops (uncommon/green)', 'How often creatures drop green items.', { common: true }),
  rate('Rate.Drop.Item.Legendary', 'Item drops (legendary)', 'How often orange items drop.'),
  rate('Rate.Drop.Item.Quest', 'Quest item drops', 'How often the items a quest asks for drop. Raise it to cut down on "collect 10" grinding.'),
  rate('Rate.Rest.Offline.InTavernOrCity', 'Rested XP while offline in an inn/city', 'How fast the rested bonus builds while logged out in an inn or city.'),
  rate('Rate.Rest.Offline.InWilderness', 'Rested XP while offline in the wild', 'How fast the rested bonus builds while logged out anywhere else.'),
  rate('Rate.Talent', 'Talent points per level', 'Talent points earned per level. Above 1× characters can fill more than one talent tree.', { slider: { min: 0, max: 5, step: 0.5, soft: true } }),
  skill('SkillGain.Crafting', 'Skill points per crafting skill-up', 'crafting professions'),
  skill('SkillGain.Gathering', 'Skill points per gathering skill-up', 'gathering professions (mining, herbalism, skinning)'),
  skill('SkillGain.Weapon', 'Skill points per weapon skill-up', 'weapon skills'),
  skill('SkillGain.Defense', 'Skill points per defense skill-up', 'the defense skill'),
  rate('Rate.Mining.Amount', 'Ore per mining node', 'How many times a mining node can be mined before it is used up.'),
  rate('Rate.Health', 'Health regeneration', 'How fast health comes back.'),
  rate('Rate.Mana', 'Mana regeneration', 'How fast mana comes back.'),
  rate('Rate.Damage.Fall', 'Fall damage', 'Damage from falling. 0× turns it off.', { slider: { min: 0, max: 5, step: 0.5, soft: true } }),
  rate('Rate.Auction.Time', 'Auction duration', 'How long auctions run.', { slider: { min: 0.5, max: 10, step: 0.5, soft: true } }),
  rate('Rate.Auction.Deposit', 'Auction deposit', 'The deposit paid to put an item up for auction.'),
  rate('Rate.Auction.Cut', 'Auction house cut', 'The share the auction house keeps from a sale.'),

  world('GameType', 'Realm type', 'select', 'On a PvP realm players can attack each other in contested zones; on a Normal realm only when they choose to. RP realms are the same two, meant for role-playing.', { common: true, options: [{ value: '1', label: 'PvP' }, { value: '0', label: 'Normal (PvE)' }, { value: '6', label: 'RP' }, { value: '8', label: 'RP-PvP' }] }),
  world('MaxPlayerLevel', 'Max level', 'number', "The level cap. 80 is Wrath of the Lich King's.", { common: true, std: 80, slider: LEVELS }),
  world('StartPlayerLevel', 'Starting level', 'number', 'The level new characters start at.', { common: true, std: 1, slider: LEVELS }),
  world('StartPlayerMoney', 'Starting money (copper)', 'number', 'Money new characters start with, in copper: 100 = 1 silver, 10000 = 1 gold.', { common: true, std: 0, unit: 'copper', slider: { min: 0, max: 5000000, step: 10000, soft: true } }),
  world('PlayerLimit', 'Player limit (0 = none)', 'number', 'The most players online at once, not counting game masters. 0 = no limit.', { common: true, slider: { min: 0, max: 500, step: 10, soft: true } }),
  world('SkipCinematics', 'Intro cinematics', 'select', 'The intro video a new character sees when it first enters the world.', { options: [{ value: '0', label: 'Always show' }, { value: '1', label: 'Skip after the first character' }, { value: '2', label: 'Always skip' }] }),
  world('AllowTwoSide.Accounts', 'Horde and Alliance on one account', BOOL, 'One account can have characters of both factions on this realm.', { common: true }),
  world('AllowTwoSide.Interaction.Group', 'Cross-faction groups', BOOL, 'Horde and Alliance players can invite each other to a group. Handy when only a few friends play.', { common: true }),
  world('AllowTwoSide.Interaction.Guild', 'Cross-faction guilds', BOOL, 'Horde and Alliance players can be in the same guild.'),
  world('AllowTwoSide.Interaction.Chat', 'Cross-faction chat', BOOL, 'Horde and Alliance players can understand each other in chat.'),
  world('AllowTwoSide.Interaction.Auction', 'Shared auction house', BOOL, 'Every auction house shows the auctions of both factions.'),
  world('AllowTwoSide.Interaction.Mail', 'Cross-faction mail', BOOL, 'Horde and Alliance players can send each other mail.'),
  world('Motd', 'Message of the day', 'text', 'Shown at login. Use @ for a new line', { common: true }),
  world('ActivateWeather', 'Weather', BOOL, 'Rain, snow and sandstorms.'),

  chars('CharactersPerRealm', 'Characters per account on this realm (1–10)', 'number', 'How many characters one account can have here.', { common: true, std: 10, slider: { min: 1, max: 10, step: 1 } }),
  chars('StartHeroicPlayerLevel', 'Death Knight starting level', 'number', 'The level new Death Knights start at. 55 in the original game.', { common: true, std: 55, slider: LEVELS }),
  chars('MinLevelForHeroicCharacterCreating', 'Level needed to create a Death Knight', 'number', 'An account needs a character of at least this level before it can create a Death Knight. 0 = anyone can.', { common: true, std: 55, slider: { min: 0, max: 80, step: 1, soft: true } }),
  chars('AllFlightPaths', 'Start with every flight path', BOOL, 'New characters know every flight master from the start.', { common: true }),
  chars('AlwaysMaxSkillForLevel', 'Weapon/defense skills always maxed', BOOL, 'Weapon and defense skills are always at the highest value for the character\'s level, so nobody has to train them up.'),
  chars('MaxPrimaryTradeSkill', 'Primary professions per character', 'number', 'How many primary professions (mining, tailoring, enchanting…) one character can learn. 2 in the original game.', { std: 2, slider: { min: 0, max: 11, step: 1, soft: true } }),
  chars('Death.SicknessLevel', 'Resurrection sickness from level', 'number', 'Characters below this level come back from the spirit healer without resurrection sickness.', { std: 11, slider: { min: 1, max: 81, step: 1, soft: true } }),

  pvp('Instance.IgnoreLevel', 'Enter instances below the required level', 'Players can walk into a dungeon or raid before they reach its level.', { common: true }),
  pvp('Instance.IgnoreRaid', 'Enter raids without a raid group', 'Raid instances can be entered alone or in a normal 5-player group.', { common: true }),
  pvp('Quests.IgnoreRaid', 'Allow non-raid quests in raids', 'Ordinary quests still count while you are in a raid group.'),
  pvp('Battleground.CastDeserter', 'Deserter debuff for leaving battlegrounds', 'Leaving a battleground early puts the Deserter debuff on the player, so they can\'t queue again for 15 minutes.', { common: true }),
  pvp('Battlefield.WGEnabled', 'Wintergrasp battles', 'The scheduled battle for Wintergrasp in Northrend.'),
  pvp('Arena.AutoDistributePoints', 'Hand out arena points automatically', 'Arena points are given out on a schedule instead of by a game master command.'),

  { file: M, key: 'MapUpdate.Threads', label: 'Map update threads', type: 'number', group: 'Performance', common: true, hint: 'How many CPU threads update the world. At most your CPU threads minus one', slider: { min: 1, max: 16, step: 1, soft: true } },
  { file: M, key: 'PlayerSave.Interval', label: 'Save players every (ms)', type: 'number', group: 'Performance', common: true, unit: 'ms', std: 900000, hint: 'How often characters are written to the database, in milliseconds: 900000 = 15 minutes. Shorter loses less after a crash but works the disk harder.', slider: { min: 60000, max: 1800000, step: 60000, soft: true } },
  { file: M, key: 'Visibility.Distance.Continents', label: 'View distance on continents (yards)', type: 'number', group: 'Performance', common: true, unit: 'yd', hint: 'How far away players see creatures and each other outdoors. Further looks better and costs more CPU, most of all with many bots.', slider: { min: 5, max: 330, step: 5, soft: true } },

  bot('Enabled', 'Bots enabled', BOOL, 'Turns the computer-controlled players on. Off = a world with only real players.', { def: false, common: true }),
  bot('RandomBotAutologin', 'Random bots log in automatically', BOOL, 'The random bots come online by themselves when the server starts.', { def: true }),
  bot('MinRandomBots', 'Minimum random bots', 'number', 'The fewest bots online at once. SPP default 1000. Lower it if the server lags. Changing the count later needs a random bot reset.', { common: true, slider: { min: 0, max: 3000, step: 50, soft: true } }),
  bot('MaxRandomBots', 'Maximum random bots', 'number', 'The most bots online at once. Every bot costs CPU and memory.', { common: true, slider: { min: 0, max: 3000, step: 50, soft: true } }),
  bot('RandomBotMinLevel', 'Bot minimum level', 'number', 'The lowest level random bots can be.', { common: true, slider: LEVELS }),
  bot('RandomBotMaxLevel', 'Bot maximum level', 'number', 'The highest level random bots can be.', { common: true, slider: LEVELS }),
  bot('RandomBotJoinLfg', 'Bots use the dungeon finder', BOOL, "cMaNGOS WotLK's dungeon finder has no matchmaking: it only starts a dungeon for a full group of 5 that queued together, so queueing alone (or with bots queueing on their own) never pops. Invite 4 bots near your level first (1 tank, 1 healer, 3 damage), then queue as a group. See docs/wow.md.", { def: true, common: true }),
  bot('RandomBotJoinBG', 'Bots join battlegrounds', BOOL, 'Bots queue for battlegrounds, so they start even with only a few real players.', { def: true, common: true }),
  bot('AllowGuildBots', 'Bot guilds', BOOL, undefined, { def: true }),
  bot('SyncQuestWithPlayer', 'Grouped bots complete quests with you', BOOL, undefined, { def: false }),
  bot('AutoLearnTrainerSpells', 'Bots learn trainer spells on level-up', BOOL, 'Bots get their class spells as they level, without visiting a trainer.', { def: false }),
  bot('AutoLearnQuestSpells', 'Bots learn quest spells', BOOL, 'Bots also get the spells that normally come from class quests.', { def: false }),

  { file: M, key: 'WorldServerPort', label: 'World port (TCP)', type: 'number', group: 'Network', common: true, std: 8085, hint: 'The port the game world listens on. Forward it on your router.' },
  { file: 'realmd.conf', key: 'RealmServerPort', label: 'Login port (TCP)', type: 'number', group: 'Network', common: true, std: 3724, hint: 'The port the login server listens on. WoW clients use 3724 unless their realmlist says otherwise, so leave it unless something else needs that port.' },
];

// The sections of the settings page, in the order they are shown: [title, icon, what it is about].
const GROUPS = [
  ['Realm', 'flag', 'The name players see in the realm list, and the address their game connects to.'],
  ['Rates', 'trending', 'How fast characters progress. 1× is the original game: 2× doubles it, 0.5× halves it.'],
  ['Bots', 'bot', 'Computer-controlled players that fill the world, join your group and queue for battlegrounds.'],
  ['World', 'globe', 'The rules of the realm: PvP or PvE, the level cap, what new characters start with and how the two factions mix.'],
  ['Characters', 'user', 'Limits and head starts for the characters players create.'],
  ['Instances & PvP', 'swords', 'Who may enter dungeons and raids, and how battlegrounds and arenas behave.'],
  ['Performance', 'gauge', 'How hard the server works. Leave these alone unless the server lags.'],
  ['Network', 'network', 'The ports players connect to. Both must be forwarded on your router.'],
];
// One-click starting points: each choice fills in a few settings (nothing is saved until Save).
const confKey = (file, key) => `conf.${file}.${key}`;
const xpPreset = (label, x) => ({ label, values: Object.fromEntries(['Kill', 'Quest', 'Explore'].map((k) => [confKey(M, `Rate.XP.${k}`), x])) });
const botPreset = (label, n) => ({ label, values: { [confKey(B, 'AiPlayerbot.MinRandomBots')]: n, [confKey(B, 'AiPlayerbot.MaxRandomBots')]: n } });
const PRESETS = {
  Rates: { label: 'Leveling speed', choices: [xpPreset('Original · 1×', 1), xpPreset('Relaxed · 2×', 2), xpPreset('Fast · 5×', 5), xpPreset('Very fast · 10×', 10)] },
  Bots: { label: 'How busy the world is', choices: [botPreset('Quiet · 100 bots', 100), botPreset('Lively · 500', 500), botPreset('Busy · 1000', 1000), botPreset('Crowded · 2000', 2000)] },
};

// A switch with no "Key = value" line in the file (missing, or only a commented-out "# Key = 1") runs
// with its default: the commented-out value if there is one, else the server's own default (def).
// The form must show that, or saving it would write "= 0" and turn the option off without anyone
// touching it (this is how bots stopped using the dungeon finder).
function boolDefault(conf, f) {
  const re = new RegExp(`^#\\s*${f.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*"?([01])\\b`, 'i');
  const line = conf.lines.find((l) => re.test(l));
  return line ? re.exec(line)[1] === '1' : !!f.def;
}

// Every other option in the server's own .conf files, as "All options" sections (admin only).
// Left out: database logins, folders, the remote admin/SOAP interfaces, the console the panel talks
// to, the ports the panel manages, and keys the curated sections above already cover.
const CONF_FILES = ['mangosd.conf', 'realmd.conf', 'aiplayerbot.conf'];
const NEVER = /^(ConfVersion|RealmID|DataDir|LogsDir|BindIP|PidFile|Console\.Enable|WorldServerPort|RealmServerPort|.*DatabaseInfo|.*DatabaseConnections|Ra\..*|SOAP\..*|Metric\..*|Dummy\..*)$/i;
const BOT_GROUPS = [
  [/Premade/i, 'Premade specs & gear'],
  [/ClassRaceProb|^AiPlayerbot\.Class/i, 'Class & race mix'],
  [/Respawn/i, 'Respawn'],
  [/LLM|Toxic|Thunderfury|Greet|Repl/i, 'Chat'],
  [/Guild/i, 'Guilds'],
  [/Arena|BG|Battleground|PvP|Honor/i, 'PvP'],
  [/Equip|Gear|Item|Tabard|Loot|Enchant|Gem|Roll|Cloak/i, 'Gear & loot'],
  [/Teleport|Map|Zone|Travel|Rpg|Move|Walk|Speed|Mount|Flight/i, 'Movement & travel'],
  [/Chat|Say|Emote|Talk|Broadcast|Whisper|Yell/i, 'Chat'],
  [/Level|Xp|Talent|Spell|Learn|Quest|Skill/i, 'Leveling, spells & quests'],
  [/RandomBot|Account|Login|Logout|Online|Count/i, 'Random bots'],
];
// "AiPlayerbot.RandomBotTimedLogout" -> "Random bot timed logout"; "Rate.Drop.Item.Poor" -> "Rate · Drop · Item · Poor".
const optionName = (key) => key.replace(/^AiPlayerbot\./, '').split('.').map((part) => modconfig.humanize(part)).join(' · ');

// Every option of the three files by "conf.<file>.<key>" (lower case), with the file's own documentation.
function confDocs(server) {
  const dir = paths(server).confDir;
  const out = new Map();
  for (const file of CONF_FILES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    for (const e of describeConf(fs.readFileSync(full, 'utf8'))) out.set(confKey(file, e.key).toLowerCase(), e);
  }
  return out;
}

function confOptions(server) {
  const dir = paths(server).confDir;
  const curated = new Set(FIELDS.map((f) => `${f.file}|${f.key}`.toLowerCase()));
  const out = [];
  for (const file of CONF_FILES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    for (const e of describeConf(fs.readFileSync(full, 'utf8'))) {
      if (NEVER.test(e.key) || curated.has(`${file}|${e.key}`.toLowerCase())) continue;
      const group = file === 'aiplayerbot.conf' ? (BOT_GROUPS.find(([re]) => re.test(e.key)) || [null, 'Other'])[1] : e.section || 'Other';
      out.push({ ...e, file, group, bool: looksBoolean(e) });
    }
  }
  return out;
}

// "1.0" and 1 are the same setting; don't rewrite a line just to change how its number looks.
function sameConfValue(current, next) {
  if (current === undefined) return false;
  const a = String(current).trim();
  const b = String(next).trim();
  return a === b || (a !== '' && b !== '' && Number.isFinite(Number(a)) && Number(a) === Number(b));
}

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
  describe(server) {
    return { game: 'WoW: Wrath of the Lich King', detail: `Realm: ${server.wow.realmName || server.name}` };
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
    await repairAuctions(instance);
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
    if (!instance.child) return;
    unblockConsoleOnHalt(instance, instance.child);
    instance.writeStdin('server shutdown 0');
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
    const docs = confDocs(server);
    const groups = new Map(GROUPS.map(([title, icon, blurb]) => [title, { title, icon, blurb, presets: PRESETS[title], fields: [] }]));
    groups.get('Realm').fields.push(
      { key: 'wow.realmName', label: 'Realm name (shown in the realm list)', type: 'text', common: true, hint: 'What players see when they pick a realm after logging in.' },
      { key: 'wow.address', label: 'Address players connect to', type: 'text', common: true, hint: `Blank = the panel's public address (${ddns.publicAddress() || 'not set — 127.0.0.1'}). Use a hostname like play.example.com.` }
    );
    if (p.dbDir) groups.get('Realm').fields.push({ key: 'wow.manageDb', label: 'Start/stop the bundled MySQL with the server', type: 'bool', common: true, hint: 'The database that holds accounts and characters starts and stops together with the server. Turn it off only if you run MySQL yourself.' });
    for (const f of FIELDS) {
      if (f.file === B && !fs.existsSync(path.join(p.confDir, B))) continue;
      const doc = docInfo((docs.get(confKey(f.file, f.key).toLowerCase()) || {}).doc);
      // The default the form marks and resets to: what the file documents, else the original game's.
      const said = doc.def ?? (f.std === undefined ? undefined : String(f.std));
      const def = f.type === BOOL ? (f.def !== undefined ? !!f.def : said === '0' || said === '1' ? said === '1' : undefined) : said;
      groups.get(f.group).fields.push({
        key: confKey(f.file, f.key), label: f.label, type: f.type, options: f.options, step: f.step, tip: `${f.file}: ${f.key}`,
        hint: f.hint || doc.text.slice(0, 300) || undefined, common: !!f.common, slider: f.slider, unit: f.unit, def,
      });
    }
    const curated = [...groups.values()].filter((g) => g.fields.length);
    for (const g of curated) if (g.presets && !g.presets.choices.every((c) => Object.keys(c.values).every((k) => g.fields.some((f) => f.key === k)))) delete g.presets;
    // "All options": every other key in the files, described by the files themselves.
    const all = new Map();
    for (const e of confOptions(server)) {
      const id = `${e.file}|${e.group}`;
      if (!all.has(id)) all.set(id, { title: `All options: ${e.group} (${e.file})`, short: e.group, file: e.file, advanced: true, collapsed: true, fields: [] });
      const doc = docInfo(e.doc);
      const unset = e.value === undefined; // only there as a commented-out line: the server uses its default
      const def = doc.def ?? e.def;
      const field = { key: confKey(e.file, e.key), label: optionName(e.key), tip: `${e.file}: ${e.key}`, admin: true, hint: doc.text.slice(0, 400) || undefined, def };
      const notSet = (shown) => (unset ? [{ value: '', label: shown === undefined ? 'Not set' : `Not set (${shown})` }] : []);
      if (e.bool) {
        field.type = 'select';
        field.options = [...notSet(def === undefined ? undefined : def === '1' ? 'on' : 'off'), { value: '1', label: 'On' }, { value: '0', label: 'Off' }];
      } else if (doc.choices && (unset || doc.choices.some((c) => c.value === e.value))) {
        field.type = 'select';
        field.options = [...notSet(def), ...doc.choices.map((c) => ({ value: c.value, label: `${c.label.charAt(0).toUpperCase()}${c.label.slice(1)} (${c.value})` }))];
      } else {
        const numeric = /^-?\d+(\.\d+)?$/.test(e.value ?? e.def ?? '');
        field.type = numeric ? 'number' : 'text';
        if (numeric && /^Rate\./.test(e.key)) Object.assign(field, { unit: '×', slider: { min: 0, max: 10, step: 0.5, soft: true } });
        else if (numeric && doc.max !== undefined && doc.max - doc.min <= 1000) field.slider = { min: doc.min, max: doc.max, step: 1, soft: true };
      }
      all.get(id).fields.push(field);
    }
    return {
      layout: 'categories',
      note: `Saved straight into mangosd.conf, aiplayerbot.conf and realmd.conf in ${p.confDir}. Each section shows the settings people change most; "Show more" has the rest of that section, and "All options" (admins only) lists every other line of those files with the files' own descriptions.`,
      sections: [...curated, ...all.values()],
    };
  },

  readSettings(server) {
    const p = paths(server);
    const out = { 'wow.realmName': server.wow.realmName || server.name, 'wow.address': server.wow.address || '', 'wow.manageDb': !!server.wow.manageDb };
    const cache = {};
    for (const f of FIELDS) {
      cache[f.file] = cache[f.file] || readConf(p.confDir, f.file);
      const v = cache[f.file].get(f.key);
      out[`conf.${f.file}.${f.key}`] = f.type === BOOL ? (v === undefined ? boolDefault(cache[f.file], f) : v === '1') : v ?? '';
    }
    for (const e of confOptions(server)) out[`conf.${e.file}.${e.key}`] = e.value ?? '';
    return out;
  },

  writeSettings(server, values, opts = {}) {
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
      const current = files[f.file].get(f.key);
      if (sameConfValue(current, v)) continue; // leave untouched lines exactly as they are
      if (f.type === BOOL && current === undefined && !!v === boolDefault(files[f.file], f)) continue; // already the default
      files[f.file].set(f.key, v);
    }
    // "All options": only keys that are really in the file (set or commented out), admins only.
    if (opts.admin) {
      for (const e of confOptions(server)) {
        const k = `conf.${e.file}.${e.key}`;
        if (!(k in values)) continue;
        let v = values[k];
        if (v === '' || v === null || v === undefined) continue; // blank = leave the file as it is
        v = String(v).trim();
        if (e.bool && v !== '0' && v !== '1') continue;
        if (sameConfValue(e.value, v)) continue;
        files[e.file] = files[e.file] || readConf(p.confDir, e.file);
        files[e.file].set(e.key, v);
      }
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
module.exports.repairAuctions = repairAuctions;
