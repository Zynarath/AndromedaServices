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

test('WoW: account names and passwords are validated for console safety', () => {
  assert.ok(wow.NAME_RE.test('Buddy99'));
  assert.ok(!wow.NAME_RE.test('a b'));
  assert.ok(!wow.NAME_RE.test('x'.repeat(17)));
  assert.ok(wow.PASS_RE.test('frost-mourne!'));
  for (const bad of ['a b c', 'quote"d', "single'q", 'abc', 'x'.repeat(17), 'new\nline']) assert.ok(!wow.PASS_RE.test(bad), bad);
});

test.after(() => db.saveNow());
