'use strict';
// Call of Duty: Quake 3 UDP protocol, generated configs and launch arguments.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-cod-'));
process.env.ANDROMEDA_DATA = path.join(tmp, 'data');

const q3 = require('../src/util/q3');
const cod = require('../src/games/cod');
const tools = require('../src/services/codtools');
const { listZip } = require('../src/util/zip');

function fakeServer(rconPassword) {
  const sock = dgram.createSocket('udp4');
  const OOB = Buffer.from([0xff, 0xff, 0xff, 0xff]);
  sock.on('message', (msg, rinfo) => {
    const text = msg.subarray(4).toString('latin1');
    let reply;
    if (text === 'getstatus') {
      reply = 'statusResponse\n\\sv_hostname\\^1Andromeda Hosting ^7BO2\\mapname\\mp_raid\\g_gametype\\dom\\sv_maxclients\\18\n' +
        '10 45 "^2Player1"\n3 0 "bot1"\n0 999 "Bot Two"\n';
    } else if (text.startsWith('rcon ')) {
      const [, pw, ...cmd] = text.split(' ');
      reply = pw === rconPassword ? `print\nran: ${cmd.join(' ')}\n` : 'print\nInvalid password.\n';
    }
    if (reply) sock.send(Buffer.concat([OOB, Buffer.from(reply, 'latin1')]), rinfo.port, rinfo.address);
  });
  return new Promise((r) => sock.bind(0, '127.0.0.1', () => r(sock)));
}

test('getstatus parses players and separates bots by ping', async () => {
  const sock = await fakeServer('pw');
  const port = sock.address().port;
  const st = await q3.getStatus('127.0.0.1', port);
  assert.equal(st.hostname, 'Andromeda Hosting BO2');
  assert.equal(st.map, 'mp_raid');
  assert.equal(st.players.length, 3);
  const q = await cod.query({ cod: { port, maxClients: 18 } });
  assert.deepEqual(q.players, ["Player1"]);
  assert.equal(q.bots, 2);
  assert.equal(q.online, 1);
  assert.equal(await q3.rcon('127.0.0.1', port, 'pw', 'map_rotate'), 'ran: map_rotate\n');
  await assert.rejects(q3.rcon('127.0.0.1', port, 'nope', 'status'), /rejected/);
  sock.close();
});

function server(title, extra = {}) {
  const s = { id: 'abc123', name: `${cod.TITLES[title].namePrefix} 1`, game: 'cod', dir: path.join(tmp, 'srv-' + title) };
  s.cod = { ...cod.defaults({ name: s.name, cod: { title, gameDir: path.join(tmp, 'game-' + title), password: 'rex-1234', plutoKey: 'KEY' } }), ...extra };
  return s;
}

test('every title defaults to Domination, all base maps shuffled, 4x XP and bots', () => {
  for (const [key, t] of Object.entries(cod.TITLES)) {
    const s = server(key);
    const cfg = cod.buildConfig(s);
    assert.match(cfg, /set g_gametype "dom"/, key);
    assert.match(cfg, /set scr_xpscale "4"/, key);
    assert.equal(/scr_weaponxpscale "4"/.test(cfg), t.weaponXp, `${key} weapon XP only where the game has it`);
    assert.match(cfg, /set bots_manage_fill "12"/, key);
    assert.match(cfg, /set g_password "rex-1234"/, key);
    const rot = /set sv_mapRotation "([^"]+)"/.exec(cfg)[1];
    const maps = [...rot.matchAll(/map (mp_\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...maps].sort(), t.maps.map((m) => m[0]).sort(), `${key} has every base map exactly once`);
    if (key === 'iw5') assert.match(rot, /^dsr DOM_default /);
    else if (key === 't6') assert.match(rot, /^exec dom\.cfg map /);
    else assert.match(rot, /^gametype dom map /);
  }
  assert.equal(cod.TITLES.cod4x.maps.length, 16);
  assert.equal(cod.TITLES.iw4x.maps.length, 16);
  assert.equal(cod.TITLES.iw5.maps.length, 16);
  assert.equal(cod.TITLES.t5.maps.length, 14);
  assert.equal(cod.TITLES.t6.maps.length, 14);
});

test('rotation is reshuffled on each config write', () => {
  const s = server('iw4x');
  const orders = new Set();
  for (let i = 0; i < 8; i++) orders.add(/sv_mapRotation "([^"]+)"/.exec(cod.buildConfig(s))[1]);
  assert.ok(orders.size > 1);
  s.cod.shuffle = false;
  const a = /sv_mapRotation "([^"]+)"/.exec(cod.buildConfig(s))[1];
  assert.equal(a, /sv_mapRotation "([^"]+)"/.exec(cod.buildConfig(s))[1]);
});

test('settings validation and injection-safe config values', () => {
  const s = server('t6');
  cod.writeSettings(s, { 'cod.hostname': 'Evil"; quit; "', 'cod.maps': ['mp_raid', 'mp_nope'], 'cod.gametype': 'tdm', 'cod.bots.fill': 99, 'cod.xpScale': 0 });
  const cfg = cod.buildConfig(s);
  // Quotes and semicolons are stripped, so the name can't break out into its own command.
  assert.match(cfg, /set sv_hostname "Evil quit"\r\n/);
  assert.match(cfg, /exec tdm\.cfg map mp_raid"/);
  assert.equal(s.cod.bots.fill, 64);
  assert.equal(s.cod.xpScale, 1);
  assert.throws(() => cod.writeSettings(s, { 'cod.maps': [] }), /at least one map/);
  cod.writeSettings(s, { 'cod.bots.enabled': false });
  assert.match(cod.buildConfig(s), /bots_manage_fill "0"/);
});

test('CoD4x launch runs from the server folder with the bot mod', async () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const s = server('cod4x');
  fs.mkdirSync(path.join(s.cod.gameDir, 'main'), { recursive: true });
  fs.mkdirSync(s.dir, { recursive: true });
  fs.writeFileSync(path.join(s.dir, process.platform === 'win32' ? 'cod4x18_dedrun.exe' : 'cod4x18_dedrun'), '');
  let l = await cod.buildLaunch(s);
  assert.ok(!l.args.includes('fs_game'), 'no fs_game until the bot mod exists');
  fs.mkdirSync(path.join(s.dir, 'mods', 'mp_bots'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'mods', 'mp_bots', 'z_svr_bots.iwd'), '');
  l = await cod.buildLaunch(s);
  assert.deepEqual(l.args.slice(0, 3), ['+set', 'dedicated', '2']);
  assert.ok(l.args.join(' ').includes(`+set fs_homepath ${s.dir}`));
  assert.ok(l.args.join(' ').includes('+set fs_game mods/mp_bots'));
  assert.equal(l.args[l.args.length - 1], '+map_rotate');
  assert.ok(fs.existsSync(path.join(s.dir, 'main', 'hp_abc123.cfg')));
  assert.ok(fs.existsSync(path.join(s.dir, 'generated-server.cfg')));
});

test('CoD4x gets the base game files linked into its folder', () => {
  const game = path.join(tmp, 'cod4game');
  fs.mkdirSync(path.join(game, 'main'), { recursive: true });
  fs.mkdirSync(path.join(game, 'zone', 'english'), { recursive: true });
  fs.writeFileSync(path.join(game, 'main', 'iw_00.iwd'), 'x');
  fs.writeFileSync(path.join(game, 'main', 'config_mp.cfg'), 'x');
  fs.writeFileSync(path.join(game, 'zone', 'english', 'common_mp.ff'), 'x');
  const srv = path.join(tmp, 'cod4srv');
  tools.linkGameFiles(game, srv, { info() {}, warn() {} });
  assert.ok(fs.existsSync(path.join(srv, 'main', 'iw_00.iwd')));
  assert.ok(!fs.existsSync(path.join(srv, 'main', 'config_mp.cfg')), 'only .iwd files from main');
  assert.ok(fs.existsSync(path.join(srv, 'zone', 'english', 'common_mp.ff')));
});

test('bot difficulty uses each game\'s own scale', () => {
  assert.match(cod.buildConfig(server('t6')), /bots_skill "1"/);
  assert.match(cod.buildConfig(server('t5')), /bots_skill "normal"/);
  assert.match(cod.buildConfig(server('iw4x')), /bots_skill "0"/);
  const s = server('t6');
  cod.writeSettings(s, { 'cod.bots.skill': '7' }); // not valid on BO2's 0-3 scale
  assert.equal(s.cod.bots.skill, '1');
  cod.writeSettings(s, { 'cod.bots.skill': '3' });
  assert.equal(s.cod.bots.skill, '3');
});

test('missing or wrong game folders give clear errors', async () => {
  const s = server('t6');
  await assert.rejects(cod.buildLaunch(s), /Game folder not found/);
  fs.mkdirSync(s.cod.gameDir, { recursive: true });
  await assert.rejects(cod.buildLaunch(s), /doesn't look like a Black Ops II/);
  s.cod.gameDir = 'relative/path';
  await assert.rejects(cod.buildLaunch(s), /Set the game folder/);
});

test('Bot Warfare source is packed the way each game loads it', async () => {
  const src = path.join(tmp, 'bw-src');
  for (const d of ['maps/mp/bots', 'scripts/mp', 'scriptdata/waypoints', 'bw-assets', 'mp']) fs.mkdirSync(path.join(src, d), { recursive: true });
  fs.writeFileSync(path.join(src, 'maps/mp/bots/_bot.gsc'), '// bot');
  fs.writeFileSync(path.join(src, 'scripts/mp/bots.gsc'), '// bot');
  fs.writeFileSync(path.join(src, 'scriptdata/waypoints/mp_rust_wp.csv'), '1');
  fs.writeFileSync(path.join(src, 'bw-assets/logo.png'), 'png');
  fs.writeFileSync(path.join(src, 'README.md'), 'readme');
  const log = { info() {}, warn() {} };
  const base = path.join(tmp, 'bw-iw4x');
  await tools.packBotWarfare(src, { title: 'iw4x', modBase: base }, log);
  const names = await listZip(path.join(base, 'mods/mp_bots/z_svr_bots.iwd'));
  assert.ok(names.includes('maps/mp/bots/_bot.gsc'));
  assert.ok(names.includes('scriptdata/waypoints/mp_rust_wp.csv'));
  assert.ok(!names.some((n) => n.startsWith('bw-assets') || n === 'README.md'));
  await tools.packBotWarfare(src, { title: 't6', storage: 't6' }, log);
  assert.deepEqual(fs.readdirSync(tools.plutoStorage('t6')), ['scripts']);
  await tools.packBotWarfare(src, { title: 't5', storage: 't5' }, log);
  assert.deepEqual(fs.readdirSync(tools.plutoStorage('t5')).sort(), ['maps', 'mp', 'scripts']);
  await assert.rejects(tools.packBotWarfare(path.join(tmp, 'empty-src-' + Date.now()), { title: 't6', storage: 't6' }, log), /expected maps/);
});
