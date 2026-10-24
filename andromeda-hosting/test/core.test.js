'use strict';
// Unit tests for the pieces that don't need internet access or real game servers.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-test-'));
process.env.ANDROMEDA_DATA = path.join(tmp, 'data');

const Ini = require('../src/util/ini');
const Properties = require('../src/util/properties');
const Rcon = require('../src/util/rcon');
const totp = require('../src/util/totp');
const { createZip, extractZip, readEntry, commonRoot } = require('../src/util/zip');
const { safeResolve } = require('../src/util/paths');
const { parseCpuList } = require('../src/util/procstats');
const scheduler = require('../src/manager/scheduler');
const { detectLaunch } = require('../src/services/loaders');
const { parseLoader } = require('../src/services/modpack');
const auth = require('../src/auth');

test('INI keeps unknown keys, duplicates and comments', () => {
  const src = '[ServerSettings]\r\nXPMultiplier=1\r\n; comment\r\n[/script/shootergame.shootergamemode]\r\nOverrideNamedEngramEntries=a\r\nOverrideNamedEngramEntries=b\r\n';
  const ini = new Ini(src);
  ini.set('serversettings', 'xpmultiplier', '3');
  ini.set('ServerSettings', 'TamingSpeedMultiplier', '5');
  ini.set('SessionSettings', 'SessionName', 'My Server');
  const out = ini.toString();
  assert.match(out, /XPMultiplier=3/);
  assert.match(out, /TamingSpeedMultiplier=5/);
  assert.match(out, /; comment/);
  assert.equal(out.match(/OverrideNamedEngramEntries/g).length, 2);
  assert.equal(new Ini(out).get('SessionSettings', 'SessionName'), 'My Server');
  // Round trips are stable.
  assert.equal(new Ini(out).toString(), out);
});

test('server.properties round trip', () => {
  const p = new Properties('#Minecraft server properties\nmotd=Hi\nserver-port=25565\n');
  p.set('server-port', 25570);
  p.set('pvp', 'false');
  const out = p.toString();
  assert.match(out, /^#Minecraft/);
  assert.match(out, /server-port=25570/);
  assert.equal(new Properties(out).get('pvp'), 'false');
});

test('RCON client authenticates and runs commands against a mock server', async () => {
  const PASSWORD = 'secret';
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= buf.readInt32LE(0) + 4) {
        const size = buf.readInt32LE(0);
        const id = buf.readInt32LE(4);
        const type = buf.readInt32LE(8);
        const body = buf.toString('utf8', 12, 4 + size - 2);
        buf = buf.subarray(4 + size);
        const reply = (rid, rtype, text) => {
          const b = Buffer.from(text);
          const out = Buffer.alloc(14 + b.length);
          out.writeInt32LE(10 + b.length, 0);
          out.writeInt32LE(rid, 4);
          out.writeInt32LE(rtype, 8);
          b.copy(out, 12);
          sock.write(out);
        };
        if (type === 3) {
          reply(id, 0, ''); // Source servers send an empty value first
          reply(body === PASSWORD ? id : -1, 2, '');
        } else if (type === 2) {
          reply(id, 0, body === 'ListPlayers' ? '0. Alice, 0002abc\n1. Bob, 0002def' : `ran ${body}`);
        }
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ok = new Rcon('127.0.0.1', port, PASSWORD, { timeout: 2000 });
  assert.match(await ok.send('ListPlayers'), /Alice/);
  assert.equal(await ok.send('SaveWorld'), 'ran SaveWorld');
  ok.close();
  const bad = new Rcon('127.0.0.1', port, 'wrong', { timeout: 2000 });
  await assert.rejects(bad.send('x'), /authentication failed/);
  for (const s of sockets) s.destroy();
  server.close();
});

test('TOTP codes verify within the window', () => {
  const secret = totp.generateSecret();
  const code = totp.hotp(secret, Math.floor(Date.now() / 30000));
  assert.ok(totp.verify(secret, code));
  assert.ok(!totp.verify(secret, '000000') || code === '000000');
  // RFC 6238 test vector (SHA1, T=59s) for the ASCII secret "12345678901234567890".
  assert.equal(totp.hotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082');
});

test('zip create/extract/read with root stripping and zip-slip safety', async () => {
  const src = path.join(tmp, 'zsrc', 'Pack-1.0');
  fs.mkdirSync(path.join(src, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(src, 'manifest.json'), '{"a":1}');
  fs.writeFileSync(path.join(src, 'mods', 'x.jar'), 'jar');
  fs.writeFileSync(path.join(src, 'session.lock'), 'lock');
  const zip = path.join(tmp, 'z.zip');
  await createZip(path.join(tmp, 'zsrc'), zip, { ignore: ['**/session.lock'] });
  const entry = await readEntry(zip, (n) => n.endsWith('manifest.json'));
  assert.equal(entry.data.toString(), '{"a":1}');
  const dest = path.join(tmp, 'zdest');
  await extractZip(zip, dest, { stripRoot: true });
  assert.ok(fs.existsSync(path.join(dest, 'mods', 'x.jar')));
  assert.ok(!fs.existsSync(path.join(dest, 'session.lock')));
  assert.equal(commonRoot(['a/1', 'a/b/2']), 'a/');
  assert.equal(commonRoot(['a/1', 'b/2']), '');
});

test('safeResolve blocks escaping the server folder', () => {
  const root = path.join(tmp, 'srv');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(safeResolve(root, 'world/level.dat'), path.join(root, 'world', 'level.dat'));
  assert.throws(() => safeResolve(root, '../etc/passwd'));
  assert.throws(() => safeResolve(root, '..\\..\\x'));
  if (process.platform !== 'win32') {
    fs.symlinkSync(os.tmpdir(), path.join(root, 'link'));
    assert.throws(() => safeResolve(root, 'link/anything'));
  }
});

test('CPU list parsing', () => {
  const n = os.cpus().length;
  assert.deepEqual(parseCpuList('0'), [0]);
  assert.deepEqual(parseCpuList(`0-${n - 1}`).length, n);
  assert.deepEqual(parseCpuList('9999'), []);
});

test('scheduler: daily schedules fire once after their time', () => {
  const now = new Date();
  now.setHours(5, 2, 0, 0);
  const t = now.getTime();
  const s = { enabled: true, type: 'daily', time: '05:00', days: [], createdAt: t - 86400e3 };
  assert.ok(scheduler.isDue(s, t));
  s.lastRun = t - 60e3;
  assert.ok(!scheduler.isDue(s, t));
  const interval = { enabled: true, type: 'interval', everyMinutes: 60, createdAt: t - 61 * 60e3 };
  assert.ok(scheduler.isDue(interval, t));
  assert.ok(scheduler.nextRun({ type: 'daily', time: '05:00', days: [] }, t) > t);
});

test('launch detection prefers Forge/NeoForge args files, then known jars', () => {
  const dir = path.join(tmp, 'mc');
  const argsName = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  fs.mkdirSync(path.join(dir, 'libraries/net/neoforged/neoforge/21.1.77'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.jar'), '');
  assert.deepEqual(detectLaunch(dir), { kind: 'jar', file: 'server.jar' });
  fs.writeFileSync(path.join(dir, 'libraries/net/neoforged/neoforge/21.1.77', argsName), '');
  assert.equal(detectLaunch(dir).kind, 'argsfile');
  const fab = path.join(tmp, 'fab');
  fs.mkdirSync(fab);
  fs.writeFileSync(path.join(fab, 'server.jar'), '');
  fs.writeFileSync(path.join(fab, 'fabric-server-launch.jar'), '');
  assert.equal(detectLaunch(fab).file, 'fabric-server-launch.jar');
});

test('modpack manifest loader parsing', () => {
  assert.deepEqual(parseLoader({ minecraft: { modLoaders: [{ id: 'neoforge-21.1.77', primary: true }] } }), { loader: 'neoforge', loaderVersion: '21.1.77' });
  assert.deepEqual(parseLoader({ minecraft: { modLoaders: [{ id: 'forge-47.2.0' }] } }), { loader: 'forge', loaderVersion: '47.2.0' });
  assert.deepEqual(parseLoader({ minecraft: { modLoaders: [] } }), { loader: 'vanilla', loaderVersion: null });
});

test('ARK: Evolved launch arguments and INI', async () => {
  const ark = require('../src/games/ark');
  const server = { id: 'a1', name: 'Dino', game: 'ark', dir: path.join(tmp, 'ark'), ark: ark.defaults({ name: 'Dino', ark: { edition: 'ase', mods: '731604991, 889745138', map: 'Ragnarok' } }) };
  assert.deepEqual(server.ark.mods, ['731604991', '889745138']);
  const exe = ark.exePath(server);
  if (!exe) return; // not supported on this platform
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  ark.writeSettings(server, { 'ini.XPMultiplier': 3, 'ini.ServerPVE': true, 'launch.maxPlayers': 12 });
  const launch = await ark.buildLaunch(server);
  assert.match(launch.args[0], /^Ragnarok\?listen\?Port=7777\?RCONEnabled=True\?RCONPort=27020\?QueryPort=27015\?MaxPlayers=12\?GameModIds=731604991,889745138$/);
  assert.ok(launch.args.includes('-NoBattlEye'));
  assert.ok(launch.args.includes('-automanagedmods'));
  const gus = fs.readFileSync(path.join(server.dir, 'ShooterGame/Saved/Config', process.platform === 'win32' ? 'WindowsServer' : 'LinuxServer', 'GameUserSettings.ini'), 'utf8');
  assert.match(gus, /XPMultiplier=3/);
  assert.match(gus, /ServerPVE=True/);
  assert.match(gus, /SessionName=Dino/);
  assert.match(gus, /ServerAdminPassword=\w{14}/);
});

test('password hashing', () => {
  const h = auth.hashPassword('correct horse');
  assert.ok(auth.verifyPassword('correct horse', h));
  assert.ok(!auth.verifyPassword('wrong', h));
});
