'use strict';
// File share access rules and WoW (cMaNGOS / SPP) helpers.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-sw-'));
process.env.ANDROMEDA_DATA = path.join(tmp, 'data');

const access = require('../src/util/netaccess');
const { Conf, parseDbInfo } = require('../src/util/conf');
const db = require('../src/db');
const share = require('../src/services/fileshare');
const wow = require('../src/games/wow');

const req = (remote, headers = {}) => ({ socket: { remoteAddress: remote }, headers });

test('client IP: forwarding headers are only trusted from a local proxy', () => {
  // Through cloudflared on this PC
  assert.equal(access.clientIp(req('127.0.0.1', { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '198.51.100.7' })), '198.51.100.7');
  assert.equal(access.clientIp(req('::ffff:127.0.0.1', { 'x-forwarded-for': '10.0.0.9, 198.51.100.8' })), '198.51.100.8');
  // Directly from the internet (port forward): headers are ignored, so they can't be spoofed
  assert.equal(access.clientIp(req('203.0.113.5', { 'x-forwarded-for': '127.0.0.1', 'cf-connecting-ip': '1.1.1.1' })), '203.0.113.5');
  assert.ok(access.isThisPc(req('127.0.0.1')));
  assert.ok(!access.isThisPc(req('127.0.0.1', { 'cf-ray': 'x' })), 'tunnel traffic is not "this PC"');
  assert.ok(access.isLocalNetwork(req('::ffff:192.168.1.20')));
  assert.ok(!access.isLocalNetwork(req('203.0.113.5')));
});

test('IP rules: exact and CIDR', () => {
  assert.ok(access.ipMatches('203.0.113.7', '203.0.113.7'));
  assert.ok(access.ipMatches('203.0.113.200', '203.0.113.0/24'));
  assert.ok(!access.ipMatches('203.0.114.1', '203.0.113.0/24'));
  assert.ok(access.ipMatches('::ffff:203.0.113.7', '203.0.113.7'));
  assert.ok(access.validRule('2001:db8::1'));
  assert.ok(!access.validRule('203.0.113.0/40'));
  assert.ok(!access.validRule('example.com'));
});

test('file share: uploads only from this PC, downloads only from trusted IPs', () => {
  const folder = path.join(tmp, 'share');
  fs.mkdirSync(folder);
  assert.throws(() => share.update({ enabled: true, folder: path.parse(folder).root }), /not a whole drive/);
  assert.throws(() => share.update({ enabled: true, folder: 'relative' }), /full folder path/);
  share.update({ enabled: true, folder });
  const pc = share.check(req('127.0.0.1'));
  assert.deepEqual([pc.canUpload, pc.canDownload], [true, true]);
  const friend = share.check(req('127.0.0.1', { 'cf-connecting-ip': '198.51.100.7' }));
  assert.deepEqual([friend.canUpload, friend.canDownload], [false, false]);
  const lan = share.check(req('192.168.1.20'));
  assert.deepEqual([lan.canUpload, lan.canDownload], [false, false], 'LAN off by default');
  share.addTrusted('198.51.100.0/24', 'Buddy');
  const allowed = share.check(req('127.0.0.1', { 'cf-connecting-ip': '198.51.100.7' }));
  assert.deepEqual([allowed.canUpload, allowed.canDownload, allowed.who], [false, true, 'Buddy']);
  share.update({ lanAccess: true });
  assert.ok(share.check(req('192.168.1.20')).canUpload);
  assert.throws(() => share.addTrusted('not-an-ip'), /isn't an IP/);
  share.removeTrusted('198.51.100.0/24');
  assert.equal(share.check(req('127.0.0.1', { 'cf-connecting-ip': '198.51.100.7' })).canDownload, false);
});

test('MaNGOS .conf editing keeps comments and quoting', () => {
  const c = new Conf('# Rates\r\nRate.XP.Kill    = 1\r\nDataDir = "../../Server/Modules/wotlk"\r\n');
  c.set('Rate.XP.Kill', 3);
  c.set('DataDir', 'x"; evil');
  assert.equal(c.get('Rate.XP.Kill'), '3');
  assert.match(c.toString(), /^# Rates\r\n/);
  assert.match(c.toString(), /DataDir = "x; evil"/);
  assert.deepEqual(parseDbInfo('127.0.0.1;3310;root;123456;wotlkrealmd'), { host: '127.0.0.1', port: 3310, user: 'root', password: '123456', database: 'wotlkrealmd' });
});

function fakeSpp(withMaps = true) {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const root = fs.mkdtempSync(path.join(tmp, 'spp-'));
  const sv = path.join(root, 'SPP_Server');
  const bin = path.join(sv, 'Server', 'Binaries', 'wotlk', 'Bin64');
  const conf = path.join(sv, 'Settings', 'wotlk');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(conf, { recursive: true });
  fs.mkdirSync(path.join(sv, 'Server', 'Database', 'bin'), { recursive: true });
  for (const f of ['mangosd', 'realmd']) fs.writeFileSync(path.join(bin, f + exe), '');
  fs.writeFileSync(path.join(sv, 'Server', 'Database', 'bin', 'mysqld' + exe), '');
  fs.writeFileSync(path.join(conf, 'mangosd.conf'), 'DataDir = "../../Server/Modules/wotlk"\nLoginDatabaseInfo = "127.0.0.1;3310;root;123456;wotlkrealmd"\nRate.XP.Kill = 1\nGameType = 1\nConsole.Enable = 0\n');
  fs.writeFileSync(path.join(conf, 'realmd.conf'), 'RealmServerPort = 3724\n');
  fs.writeFileSync(path.join(conf, 'aiplayerbot.conf'), 'AiPlayerbot.MaxRandomBots = 1000\nAiPlayerbot.Enabled = 1\n');
  if (withMaps) for (const d of ['dbc', 'maps']) fs.mkdirSync(path.join(sv, 'Server', 'Modules', 'wotlk', d), { recursive: true });
  return root;
}

test('WoW: detects SPP installs and explains what is missing', () => {
  const root = fakeSpp();
  const d = wow.detect(root);
  assert.equal(d.layout, 'spp');
  assert.ok(d.root.endsWith('SPP_Server'), 'descends into SPP_Server');
  assert.deepEqual(d.problems, []);
  assert.ok(d.found.database && d.found.mapData && d.found.botsConf);
  const noMaps = wow.detect(fakeSpp(false));
  assert.match(noMaps.problems.join(' '), /Server_Update\.bat/);
  assert.match(wow.detect(path.join(tmp, 'nope')).problems[0], /not found/);
});

test('WoW: install enables the console; settings write to the .conf files safely', async () => {
  const root = fakeSpp();
  const server = { id: 'w1', name: 'WoW WotLK Server 1', game: 'wow', wow: wow.defaults({ name: 'WoW WotLK Server 1', wow: { root } }) };
  await wow.install(server, { info() {}, warn() {} });
  const confDir = wow.detect(root).confDir;
  assert.match(fs.readFileSync(path.join(confDir, 'mangosd.conf'), 'utf8'), /Console\.Enable = 1/);
  wow.writeSettings(server, {
    'conf.mangosd.conf.Rate.XP.Kill': 4,
    'conf.mangosd.conf.GameType': '99', // not an allowed option: ignored
    'conf.aiplayerbot.conf.AiPlayerbot.MaxRandomBots': -5, // negative: ignored
    'conf.aiplayerbot.conf.AiPlayerbot.Enabled': false,
    'wow.realmName': `It's "quoted"`,
  });
  const v = wow.readSettings(server);
  assert.equal(v['conf.mangosd.conf.Rate.XP.Kill'], '4');
  assert.equal(v['conf.mangosd.conf.GameType'], '1');
  assert.equal(v['conf.aiplayerbot.conf.AiPlayerbot.MaxRandomBots'], '1000');
  assert.equal(v['conf.aiplayerbot.conf.AiPlayerbot.Enabled'], false);
  assert.equal(server.wow.realmName, 'Its quoted');
  assert.throws(() => wow.writeSettings(server, { 'wow.address': 'bad host; DROP' }), /hostname or IP/);
  assert.deepEqual(wow.ports(server).map((p) => p.port), [3724, 8085]);
  assert.equal(wow.connectAddress(server, 'play.example.com'), 'set realmlist play.example.com');
});

test('WoW: "All options" lists every key from the .conf files with their own descriptions (admins only)', () => {
  const { describeConf, looksBoolean } = require('../src/util/conf');
  // Shaped like cMaNGOS's mangosd.conf.dist and aiplayerbot.conf.dist.
  const mangosd = [
    '[MangosdConf]', 'ConfVersion=2024020101', '',
    '###################################################################################################################',
    '# SERVER SETTINGS', '#',
    '#    InstantLogout',
    '#        Enable or disable instant logout for security level (0..4) or high',
    '#        Default: 1 (Mods/GMs/Admins)', '#',
    '#    AllFlightPaths',
    '#        Players will start with all flight paths',
    '#        Default: 0 (false)', '#                 1 (true)', '#',
    '#    DeclinedNames',
    '#        Allow russian clients to set and use declined names',
    '#        Default: 0 (false)', '#                 1 (true)', '#',
    '###################################################################################################################', '',
    'InstantLogout = 1', 'AllFlightPaths = 0', 'DeclinedNames = 0', 'LoginDatabaseInfo = "127.0.0.1;3310;root;123456;wotlkrealmd"', 'Ra.Enable = 0', 'Rate.XP.Kill = 1', 'Console.Enable = 1', '',
  ].join('\r\n');
  const bots = ['# Random bot count', 'AiPlayerbot.MinRandomBots = 50', 'AiPlayerbot.MaxRandomBots = 50', '', '# Log out random bots after BotInWorldTime interval', '# AiPlayerbot.RandomBotTimedLogout = 1', '', '# Enable BG/Arena for random Bots', 'AiPlayerbot.RandomBotJoinBG = 1', ''].join('\n');
  const e = describeConf(mangosd);
  const logout = e.find((x) => x.key === 'InstantLogout');
  assert.equal(logout.section, 'Server Settings');
  assert.match(logout.doc, /security level/);
  assert.equal(looksBoolean(logout), false, '0/1 but documented as a level, so not a switch');
  assert.equal(looksBoolean(e.find((x) => x.key === 'AllFlightPaths')), true);
  const b = describeConf(bots);
  assert.equal(b.find((x) => x.key === 'AiPlayerbot.MaxRandomBots').doc, 'Random bot count', 'keys under one comment share it');
  assert.deepEqual(b.find((x) => x.key === 'AiPlayerbot.RandomBotTimedLogout'), { key: 'AiPlayerbot.RandomBotTimedLogout', value: undefined, def: '1', section: '', doc: 'Log out random bots after BotInWorldTime interval' });

  const root = fakeSpp();
  const confDir = wow.detect(root).confDir;
  fs.writeFileSync(path.join(confDir, 'mangosd.conf'), mangosd);
  fs.writeFileSync(path.join(confDir, 'aiplayerbot.conf'), bots);
  const server = { id: 'w2', name: 'WoW', game: 'wow', wow: wow.defaults({ name: 'WoW', wow: { root } }) };
  const fields = wow.settingsSchema(server).sections.flatMap((x) => x.fields);
  const keys = fields.map((f) => f.key);
  assert.ok(keys.includes('conf.mangosd.conf.InstantLogout'));
  assert.ok(keys.includes('conf.aiplayerbot.conf.AiPlayerbot.RandomBotTimedLogout'));
  for (const hidden of ['LoginDatabaseInfo', 'Ra.Enable', 'Console.Enable', 'ConfVersion']) assert.ok(!keys.includes('conf.mangosd.conf.' + hidden), hidden);
  assert.equal(new Set(keys).size, keys.length, 'curated keys are not listed twice');
  assert.ok(fields.find((f) => f.key === 'conf.mangosd.conf.InstantLogout').admin);
  // Non-admins can't change them; admins can, including turning on a commented-out bot option.
  wow.writeSettings(server, { 'conf.mangosd.conf.InstantLogout': '3' }, { admin: false });
  assert.equal(wow.readSettings(server)['conf.mangosd.conf.InstantLogout'], '1');
  wow.writeSettings(server, { 'conf.mangosd.conf.InstantLogout': '3', 'conf.aiplayerbot.conf.AiPlayerbot.RandomBotTimedLogout': '0', 'conf.mangosd.conf.DeclinedNames': '7', 'conf.mangosd.conf.Ra.Enable': '1', 'conf.mangosd.conf.Made.Up': '1' }, { admin: true });
  const after = fs.readFileSync(path.join(confDir, 'mangosd.conf'), 'utf8');
  assert.match(after, /InstantLogout = 3/);
  assert.match(after, /DeclinedNames = 0/, 'switches only take 0 or 1');
  assert.match(after, /Ra\.Enable = 0/, 'hidden keys are never written');
  assert.doesNotMatch(after, /Made\.Up/, 'only keys that exist in the file');
  assert.match(fs.readFileSync(path.join(confDir, 'aiplayerbot.conf'), 'utf8'), /\nAiPlayerbot\.RandomBotTimedLogout = 0\n?$/);
  assert.equal(wow.readSettings(server)['conf.aiplayerbot.conf.AiPlayerbot.RandomBotTimedLogout'], '0');
});

test('WoW: duplicate auction listings that crash mangosd are removed before start, with a record', async () => {
  const root = fakeSpp();
  const server = { id: 'w3', name: 'WoW', game: 'wow', wow: wow.defaults({ name: 'WoW', wow: { root } }) };
  const lines = [];
  const instance = { server, appendConsole: (l) => lines.push(l) };
  const calls = [];
  const dupes = [{ id: 7, houseid: 1, itemguid: 500, item_template: 2589 }, { id: 9, houseid: 1, itemguid: 500, item_template: 2589 }];
  const fakeQuery = async (_s, which, sql, params) => {
    calls.push({ which, sql, params });
    return sql.startsWith('SELECT') ? dupes : { affectedRows: params.length };
  };
  assert.equal(await wow.repairAuctions(instance, fakeQuery), 2);
  assert.equal(calls[0].which, 'Character');
  assert.match(calls[0].sql, /GROUP BY itemguid HAVING COUNT\(\*\) > 1/);
  assert.match(calls[0].sql, /a\.id <> d\.keep_id/, 'the oldest listing of each item is kept');
  assert.deepEqual(calls[1].params, [7, 9]);
  const saved = fs.readdirSync(wow.detect(root).confDir).filter((f) => f.startsWith('andromeda-removed-auctions-'));
  assert.equal(saved.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(wow.detect(root).confDir, saved[0]), 'utf8')), dupes);
  assert.match(lines[0], /Removed 2 duplicate auction listing/);
  // Nothing to fix: no delete. A database error doesn't stop the start.
  calls.length = 0;
  assert.equal(await wow.repairAuctions(instance, async () => []), 0);
  assert.equal(await wow.repairAuctions(instance, async () => { throw new Error('offline'); }), 0);
  assert.match(lines[lines.length - 1], /Couldn't check the auction house/);
});

test('WoW: account names and passwords are validated for console safety', () => {
  assert.ok(wow.NAME_RE.test('Buddy99'));
  assert.ok(!wow.NAME_RE.test('a b'));
  assert.ok(!wow.NAME_RE.test('x'.repeat(17)));
  assert.ok(wow.PASS_RE.test('frost-mourne!'));
  for (const bad of ['a b c', 'quote"d', "single'q", 'abc', 'x'.repeat(17), 'new\nline']) assert.ok(!wow.PASS_RE.test(bad), bad);
});

test.after(() => db.saveNow());
