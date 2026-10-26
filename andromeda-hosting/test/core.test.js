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

test('ARK: expanded settings, launch options and extra INI lines', async () => {
  const ark = require('../src/games/ark');
  const server = { id: 'a2', name: 'Rex', game: 'ark', dir: path.join(tmp, 'ark2'), ark: ark.defaults({ name: 'Rex', ark: { edition: 'ase' } }) };
  const exe = ark.exePath(server);
  if (!exe) return;
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  const cfg = path.join(server.dir, 'ShooterGame/Saved/Config', process.platform === 'win32' ? 'WindowsServer' : 'LinuxServer');
  const read = (f) => fs.readFileSync(path.join(cfg, f), 'utf8');

  // Never-set switches show ARK's default.
  const before = ark.readSettings(server);
  assert.equal(before['ini.AllowHitMarkers'], true);
  assert.equal(before['ini.ServerPVE'], false);

  ark.writeSettings(server, {
    'ini.PerLevelStatsMultiplier_Player[7]': 2,
    'ini.bAllowSpeedLeveling': true,
    'ini.MaxTributeDinos': 40,
    'launch.forceAllowCaveFlyers': true,
    'launch.activeEvent': 'WinterWonderland',
    'launch.altSaveDir': 'Rag2',
    'extra.game': 'ConfigOverrideItemMaxQuantity=(ItemClassString="PrimalItemResource_Stone_C",Quantity=(MaxItemQuantity=1000,bIgnoreMultiplier=true))\nConfigOverrideItemMaxQuantity=(ItemClassString="PrimalItemResource_Wood_C",Quantity=(MaxItemQuantity=1000,bIgnoreMultiplier=true))',
  }, { admin: true });
  const launch = await ark.buildLaunch(server);
  assert.match(launch.args[0], /\?AltSaveDirectoryName=Rag2$/);
  assert.ok(launch.args.includes('-ForceAllowCaveFlyers'));
  assert.ok(launch.args.includes('-ActiveEvent=WinterWonderland'));
  let game = read('Game.ini');
  assert.match(game, /PerLevelStatsMultiplier_Player\[7\]=2/);
  assert.match(game, /bAllowSpeedLeveling=True/);
  assert.equal(game.match(/ConfigOverrideItemMaxQuantity=/g).length, 2);
  assert.match(read('GameUserSettings.ini'), /MaxTributeDinos=40/);

  // Deleting a line from the box and clearing a field remove them from the files.
  ark.writeSettings(server, {
    'ini.MaxTributeDinos': '',
    'extra.game': 'ConfigOverrideItemMaxQuantity=(ItemClassString="PrimalItemResource_Wood_C",Quantity=(MaxItemQuantity=1000,bIgnoreMultiplier=true))',
  }, { admin: true });
  await ark.buildLaunch(server);
  game = read('Game.ini');
  assert.equal(game.match(/ConfigOverrideItemMaxQuantity=/g).length, 1);
  assert.match(game, /Wood_C/);
  assert.doesNotMatch(read('GameUserSettings.ini'), /MaxTributeDinos/);
  assert.equal(ark.readSettings(server)['ini.MaxTributeDinos'], '');

  // Bad values are rejected without changing anything.
  assert.throws(() => ark.writeSettings(server, { 'launch.maxPlayers': 50, 'launch.activeEvent': 'x -bad' }, { admin: true }), /not a valid value/);
  assert.equal(server.ark.maxPlayers, 20);
  assert.throws(() => ark.writeSettings(server, { 'extra.gus': 'RCONPort=1' }, { admin: true }), /set by the panel/);
  assert.throws(() => ark.writeSettings(server, { 'extra.gus': 'just some text' }, { admin: true }), /Key=Value/);

  // Saving with the server stopped writes the files right away.
  ark.writeSettings(server, { 'ini.XPMultiplier': 2 });
  ark.saveFiles(server);
  assert.match(read('GameUserSettings.ini'), /XPMultiplier=2\r\n/);

  // ARK rewriting the same value on shutdown is not a hand edit...
  const gusPath = path.join(cfg, 'GameUserSettings.ini');
  fs.writeFileSync(gusPath, read('GameUserSettings.ini').replace('XPMultiplier=2', 'XPMultiplier=2.000000'));
  assert.equal(ark.readSettings(server)['ini.XPMultiplier'], 2);
  // ...but changing it in the file is: the panel shows it and keeps it on the next start.
  fs.writeFileSync(gusPath, read('GameUserSettings.ini').replace('XPMultiplier=2.000000', 'XPMultiplier=4'));
  fs.writeFileSync(path.join(cfg, 'Game.ini'), read('Game.ini').replace('bAllowSpeedLeveling=True', 'bAllowSpeedLeveling=False'));
  assert.equal(ark.readSettings(server)['ini.XPMultiplier'], 4);
  assert.equal(ark.readSettings(server)['ini.bAllowSpeedLeveling'], false);
  await ark.buildLaunch(server);
  assert.match(read('GameUserSettings.ini'), /XPMultiplier=4\r\n/);
  assert.equal(server.ark.settings.XPMultiplier, 4);
  assert.equal(server.ark.settings.bAllowSpeedLeveling, false);
  // A save from the form wins over an earlier hand edit (the form was showing it).
  fs.writeFileSync(gusPath, read('GameUserSettings.ini').replace('XPMultiplier=4', 'XPMultiplier=6'));
  ark.writeSettings(server, { 'ini.XPMultiplier': 3 });
  ark.saveFiles(server);
  assert.match(read('GameUserSettings.ini'), /XPMultiplier=3\r\n/);

  // Unreal writes UTF-16 once a value has non-ASCII text; read it and keep that encoding.
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(read('GameUserSettings.ini').replace('SessionName=Rex', 'SessionName=Rëx 🦖'), 'utf16le')]);
  fs.writeFileSync(gusPath, utf16);
  assert.equal(ark.readSettings(server)['ini.SessionName'], 'Rëx 🦖');
  ark.writeSettings(server, { 'ini.XPMultiplier': 5 });
  ark.saveFiles(server);
  const raw = fs.readFileSync(gusPath);
  assert.deepEqual([...raw.subarray(0, 2)], [0xff, 0xfe]);
  const text = raw.toString('utf16le', 2);
  assert.match(text, /SessionName=Rëx 🦖/);
  assert.match(text, /XPMultiplier=5/);

  // Engram points per level: one OverridePlayerLevelEngramPoints line per level.
  const engramLines = () => (read('Game.ini').match(/^OverridePlayerLevelEngramPoints=.*$/gm) || []).map((l) => Number(l.split('=')[1]));
  ark.writeSettings(server, { 'engram.mode': 'same', 'engram.levels': '', 'engram.points': 30, 'engram.custom': '' });
  ark.saveFiles(server);
  assert.deepEqual(engramLines(), new Array(105).fill(30));
  ark.writeSettings(server, { 'engram.mode': 'custom', 'engram.levels': 120, 'engram.points': 50, 'engram.custom': '1-10 = 8\n11-60 = 20\n100 = 99' });
  ark.saveFiles(server);
  let list = engramLines();
  assert.equal(list.length, 120);
  assert.deepEqual([list[0], list[9], list[10], list[59], list[60], list[99], list[119]], [8, 8, 20, 20, 50, 99, 50]);
  assert.equal(ark.readSettings(server)['engram.custom'], '1-10 = 8\n11-60 = 20\n100 = 99');
  // Bad input is rejected; editing the lines in Game.ini by hand shows up as ranges.
  assert.throws(() => ark.writeSettings(server, { 'engram.mode': 'custom', 'engram.custom': '10-5 = 3' }), /low to high/);
  assert.throws(() => ark.writeSettings(server, { 'engram.mode': 'custom', 'engram.custom': 'lots' }), /1-10 = 8/);
  assert.throws(() => ark.writeSettings(server, { 'engram.mode': 'same', 'engram.points': '' }), /Enter the engram points/);
  fs.writeFileSync(path.join(cfg, 'Game.ini'), read('Game.ini').replace(/^OverridePlayerLevelEngramPoints=.*\r\n/gm, '') + ['5', '5', '7'].map((n) => `OverridePlayerLevelEngramPoints=${n}\r\n`).join(''));
  const fromFile = ark.readSettings(server);
  assert.equal(fromFile['engram.mode'], 'custom');
  assert.equal(fromFile['engram.custom'], '1-2 = 5\n3 = 7');
  // Choosing ARK's default in the form (after seeing the edit) removes the lines.
  ark.writeSettings(server, { 'engram.mode': 'default' });
  ark.saveFiles(server);
  assert.deepEqual(engramLines(), []);

  // Schema: edition-only fields are filtered, every section has fields.
  const schema = ark.settingsSchema(server);
  const keys = schema.sections.flatMap((s) => s.fields.map((f) => f.key));
  assert.ok(!keys.includes('launch.pcOnly'));
  assert.ok(keys.includes('ini.PerLevelStatsMultiplier_DinoWild[0]'));
  assert.equal(new Set(keys).size, keys.length);
});

test('password hashing', () => {
  const h = auth.hashPassword('correct horse');
  assert.ok(auth.verifyPassword('correct horse', h));
  assert.ok(!auth.verifyPassword('wrong', h));
});

test('Minecraft: full server.properties, game rules and operators', () => {
  const mc = require('../src/games/minecraft');
  const dir = path.join(tmp, 'mc-settings');
  fs.mkdirSync(dir, { recursive: true });
  const server = { id: 'm1', name: 'Pack', dir, mc: mc.defaults({ name: 'Pack', mc: {} }) };
  const v = mc.readSettings(server);
  assert.equal(v['view-distance'], '10');
  assert.equal(v['region-file-compression'], 'deflate');
  assert.equal(v['enable-status'], true);
  assert.equal(v['gamerule.keepInventory'], '');
  mc.writeSettings(server, {
    'max-tick-time': -1,
    'op-permission-level': '3',
    difficulty: 'nightmare',
    'gamerule.keepInventory': 'true',
    'gamerule.randomTickSpeed': 6,
    'gamerule.mobGriefing': '',
    'panel.ops': 'Alex, Steve, not a name!',
    'panel.minMemoryMb': 8192,
  }, { admin: true });
  const props = fs.readFileSync(path.join(dir, 'server.properties'), 'utf8');
  assert.match(props, /max-tick-time=-1/);
  assert.match(props, /op-permission-level=3/);
  assert.doesNotMatch(props, /nightmare/, 'select values outside the list are ignored');
  assert.deepEqual(server.mc.gamerules, { keepInventory: true, randomTickSpeed: 6 });
  assert.deepEqual(server.mc.ops, ['Alex', 'Steve']);
  assert.equal(server.mc.minMemoryMb, 8192);
  assert.throws(() => mc.writeSettings(server, { 'gamerule.randomTickSpeed': 'fast' }), /whole number/);
  // Operators are admin only.
  mc.writeSettings(server, { 'panel.ops': 'Mallory' }, { admin: false });
  assert.deepEqual(server.mc.ops, ['Alex', 'Steve']);
  // On ready: ops, then game rules; a removed op is de-opped next time.
  const sent = [];
  const inst = { writeStdin: (l) => sent.push(l), appendConsole() {} };
  mc.onReady(server, inst);
  assert.deepEqual(sent, ['op Alex', 'op Steve', 'gamerule keepInventory true', 'gamerule randomTickSpeed 6']);
  mc.writeSettings(server, { 'panel.ops': 'Alex' }, { admin: true });
  sent.length = 0;
  mc.onReady(server, inst);
  assert.deepEqual(sent.slice(0, 2), ['deop Steve', 'op Alex']);
});

test('Mod configuration: Minecraft config files become forms, grouped by the mod that wrote them', async () => {
  const mc = require('../src/games/minecraft');
  const { createZip } = require('../src/util/zip');
  const dir = path.join(tmp, 'mc-modcfg');
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  // Two "jars" with real mod metadata.
  const jarSrc = path.join(tmp, 'jar-create');
  fs.mkdirSync(path.join(jarSrc, 'META-INF'), { recursive: true });
  fs.writeFileSync(path.join(jarSrc, 'META-INF', 'mods.toml'), 'modLoader="javafml"\n[[mods]]\nmodId="create"\ndisplayName="Create"\n');
  await createZip(jarSrc, path.join(dir, 'mods', 'create-1.0.jar'));
  const jarSrc2 = path.join(tmp, 'jar-sodium');
  fs.mkdirSync(jarSrc2, { recursive: true });
  fs.writeFileSync(path.join(jarSrc2, 'fabric.mod.json'), JSON.stringify({ id: 'waystones', name: 'Waystones' }));
  await createZip(jarSrc2, path.join(dir, 'mods', 'waystones.jar'));
  w('server.properties', 'level-name=world\n');
  w('config/create-common.toml', '[worldgen]\n\t#Range: 0 ~ 10\n\tfrequency = 4\n');
  w('world/serverconfig/create-server.toml', '[kinetics]\n\t#Allowed Values: LOW, HIGH\n\tstress = "LOW"\n');
  w('config/waystones/settings.json', '{\n  "cooldown": 30,\n  "allowGlobal": true\n}\n');
  w('config/mystery.json5', '{ // comments\n a: 1 }\n');
  const server = { id: 'mcfg', name: 'Pack', dir, mc: mc.defaults({ name: 'Pack', mc: {} }) };
  const list = await mc.listModConfigs(server);
  const byName = Object.fromEntries(list.mods.map((m) => [m.name, m.files.map((f) => f.file).sort()]));
  assert.deepEqual(byName.Create, ['config/create-common.toml', 'world/serverconfig/create-server.toml']);
  assert.deepEqual(byName.Waystones, ['config/waystones/settings.json']);
  assert.deepEqual(byName.mystery, ['config/mystery.json5']);
  // Form fields, with ranges and allowed values; the raw text for formats without a form.
  const toml = mc.readModConfig(server, 'config/create-common.toml');
  assert.deepEqual(toml.fields.map((f) => [f.label, f.type, f.value, f.min, f.max]), [['frequency', 'number', 4, 0, 10]]);
  assert.equal(mc.readModConfig(server, 'config/mystery.json5').fields, null);
  mc.writeModConfig(server, 'config/create-common.toml', { values: { [toml.fields[0].id]: 7 } });
  assert.equal(fs.readFileSync(path.join(dir, 'config/create-common.toml'), 'utf8'), '[worldgen]\n\t#Range: 0 ~ 10\n\tfrequency = 7\n');
  assert.throws(() => mc.writeModConfig(server, 'config/create-common.toml', { values: { [toml.fields[0].id]: 70 } }), /between 0 and 10/);
  const srv = mc.readModConfig(server, 'world/serverconfig/create-server.toml');
  assert.deepEqual(srv.fields[0].options, ['LOW', 'HIGH']);
  assert.throws(() => mc.writeModConfig(server, 'world/serverconfig/create-server.toml', { values: { [srv.fields[0].id]: 'MEDIUM' } }), /not one of/);
  const json = mc.readModConfig(server, 'config/waystones/settings.json');
  mc.writeModConfig(server, 'config/waystones/settings.json', { values: { [json.fields.find((f) => f.label === 'allowGlobal').id]: false } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'config/waystones/settings.json'), 'utf8')), { cooldown: 30, allowGlobal: false });
  mc.writeModConfig(server, 'config/mystery.json5', { raw: '{ a: 2 }\n' });
  assert.equal(fs.readFileSync(path.join(dir, 'config/mystery.json5'), 'utf8'), '{ a: 2 }\n');
  // Only files the scan lists can be read or written.
  for (const bad of ['server.properties', '../etc/passwd', 'config/../server.properties']) assert.throws(() => mc.readModConfig(server, bad), /not found/);
  assert.throws(() => mc.writeModConfig(server, 'eula.txt', { raw: 'x' }), /not found/);
});

test('Mod configuration: ARK mod sections, with names and documented defaults from the Workshop', async () => {
  const ark = require('../src/games/ark');
  const server = { id: 'amc', name: 'Dino', game: 'ark', dir: path.join(tmp, 'ark-modcfg'), ark: ark.defaults({ name: 'Dino', ark: { edition: 'ase', mods: '1234, 999' } }) };
  const cfg = path.join(server.dir, 'ShooterGame/Saved/Config', process.platform === 'win32' ? 'WindowsServer' : 'LinuxServer');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'GameUserSettings.ini'), '[ServerSettings]\nXPMultiplier=2\n\n[AnnunakiGenesis]\nMaxWildLevel=150\nBlacklist=A\nBlacklist=B\n\n[SomeOtherMod]\nSpeed=2\n');
  // Steam's GetPublishedFileDetails answer: one documented mod, one without settings in its description.
  const realFetch = global.fetch;
  const asked = [];
  global.fetch = async (url, opts) => {
    asked.push(String(url));
    assert.match(String(url), /GetPublishedFileDetails/);
    const ids = [...new URLSearchParams(String(opts.body)).entries()].filter(([k]) => k.startsWith('publishedfileids')).map(([, v]) => v);
    assert.deepEqual(ids, ['1234', '999']);
    return new Response(JSON.stringify({ response: { result: 1, resultcount: 2, publishedfiledetails: [
      { publishedfileid: '1234', result: 1, title: 'Annunaki Genesis', preview_url: 'https://steamuserimages-a.akamaihd.net/ugc/1/a.png', time_updated: 1700000000,
        description: '[h1]Settings[/h1]\r\nAdd to GameUserSettings.ini:\r\n[code][AnnunakiGenesis]\r\nDisableAlphas=False // no alpha creatures\r\nMaxWildLevel=300\r\nTier3Chance=0.25\r\n[/code]' },
      { publishedfileid: '999', result: 1, title: 'Simple Mod', preview_url: '', description: 'No settings.' },
    ] } }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const list = await ark.listModConfigs(server);
    const ann = list.mods.find((m) => m.modId === '1234');
    assert.equal(ann.name, 'Annunaki Genesis');
    assert.equal(ann.image, '/api/servers/amc/mod-image/1234');
    assert.deepEqual(ann.files.map((f) => [f.file, f.documented]), [['gus:AnnunakiGenesis', 3]]);
    assert.equal(list.mods.find((m) => m.modId === '999').name, 'Simple Mod');
    assert.deepEqual(list.mods.find((m) => m.id === 'other').files.map((f) => f.file), ['gus:SomeOtherMod']);
    // Documented settings are pre-filled with their defaults; the file's own value wins where it has one.
    const d = await ark.readModConfig(server, 'gus:AnnunakiGenesis');
    const byKey = Object.fromEntries(d.fields.map((f) => [f.id, f]));
    assert.equal(byKey.DisableAlphas.value, false);
    assert.equal(byKey.DisableAlphas.inFile, false);
    assert.match(byKey.DisableAlphas.hint, /no alpha creatures · Default: False · not in your INI yet/);
    assert.equal(byKey.MaxWildLevel.value, '150');
    assert.equal(byKey.Tier3Chance.value, '0.25');
    assert.equal(byKey.Blacklist.type, 'textarea');
    assert.equal(asked.length, 1, 'mod details are cached');
    await assert.rejects(ark.writeModConfig(server, 'gus:AnnunakiGenesis', { values: { MaxWildLevel: 300 } }, { running: true }), /Stop the server/);
    // Saving the form as shown: defaults stay out of the file; changed values go in.
    await ark.writeModConfig(server, 'gus:AnnunakiGenesis', { values: { DisableAlphas: false, MaxWildLevel: '300', Tier3Chance: '0.5', Blacklist: 'A\nC' } });
    let text = fs.readFileSync(path.join(cfg, 'GameUserSettings.ini'), 'utf8');
    const section = text.slice(text.indexOf('[AnnunakiGenesis]'), text.indexOf('[SomeOtherMod]'));
    for (const line of ['MaxWildLevel=300', 'Tier3Chance=0.5', 'Blacklist=A', 'Blacklist=C']) assert.ok(section.includes(line + '\r\n'), line);
    assert.doesNotMatch(section, /Blacklist=B/);
    assert.doesNotMatch(text, /DisableAlphas/);
    await ark.writeModConfig(server, 'gus:AnnunakiGenesis', { values: { DisableAlphas: false }, writeAll: true });
    text = fs.readFileSync(path.join(cfg, 'GameUserSettings.ini'), 'utf8');
    assert.match(text, /DisableAlphas=False/);
    assert.match(text, /\[ServerSettings\]\r\nXPMultiplier=2/);
    // New sections; ARK's own sections and odd names are refused.
    await ark.writeModConfig(server, 'game:StructuresPlus', { values: {} });
    assert.ok((await ark.listModConfigs(server)).mods.find((m) => m.id === 'other').files.some((f) => f.file === 'game:StructuresPlus'));
    await assert.rejects(ark.writeModConfig(server, 'gus:ServerSettings', { values: { RCONPort: 1 } }), /mod section name/);
    await assert.rejects(ark.writeModConfig(server, 'gus:Bad]Name', { values: {} }), /mod section name/);
    await assert.rejects(ark.writeModConfig(server, 'gus:AnnunakiGenesis', { values: { 'bad key=1\n[x]': 1 } }), /valid setting name/);
  } finally {
    global.fetch = realFetch;
  }
});

test('Mod pages: settings are read from BBCode/HTML descriptions; pictures only from Steam/CurseForge hosts', () => {
  const { parseModDocs, bbcodeToText, htmlToText, allowedImageHost } = require('../src/services/modinfo');
  const docs = parseModDocs(bbcodeToText('[b]Game.ini[/b] settings:\r\n[code][MyModGame]\r\nBossHP=2.0 ; boss health\r\n[/code]\r\n[ServerSettings]\r\nXPMultiplier=3\r\n[list][*]not a setting[/list]\r\n[MyMod]\r\nSpeed of things\r\nSpeed=2\r\nSpeed=5'));
  assert.deepEqual(docs, [
    { section: 'MyModGame', file: 'game', settings: [{ key: 'BossHP', def: '2.0', doc: 'boss health' }] },
    { section: 'MyMod', file: 'gus', settings: [{ key: 'Speed', def: '2', doc: 'Speed of things' }] },
  ]);
  assert.deepEqual(parseModDocs(htmlToText('<p>[CfMod]<br>Rate=1.5 // faster</p>')), [{ section: 'CfMod', file: 'gus', settings: [{ key: 'Rate', def: '1.5', doc: 'faster' }] }]);
  assert.ok(allowedImageHost('https://steamuserimages-a.akamaihd.net/ugc/1/x.png'));
  assert.ok(allowedImageHost('https://images.steamusercontent.com/ugc/1/x.png'));
  assert.ok(allowedImageHost('https://media.forgecdn.net/avatars/1.png'));
  assert.ok(!allowedImageHost('https://evil.example/x.png'));
  assert.ok(!allowedImageHost('http://steamuserimages-a.akamaihd.net/x.png'));
});
