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

const cod = require('../src/games/cod');
const { q3 } = cod;
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

test('every title defaults to Domination, all base maps shuffled, 4x XP, and bots where Bot Warfare exists', () => {
  for (const [key, t] of Object.entries(cod.TITLES)) {
    const s = server(key);
    const cfg = cod.buildConfig(s);
    assert.match(cfg, /set g_gametype "dom"/, key);
    assert.match(cfg, /set scr_xpscale "4"/, key);
    assert.equal(/scr_weaponxpscale "4"/.test(cfg), t.weaponXp, `${key} weapon XP only where the game has it`);
    if (t.botRepo) assert.match(cfg, /set bots_manage_fill "12"/, key);
    else assert.doesNotMatch(cfg, /bots_/, `${key} has no Bot Warfare, so no bot settings`);
    assert.match(cfg, /set g_password "rex-1234"/, key);
    const rot = /set sv_mapRotation "([^"]+)"/.exec(cfg)[1];
    const maps = [...rot.matchAll(/map (mp_\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...maps].sort(), t.maps.filter((m) => !m[2]).map((m) => m[0]).sort(), `${key} has every base map exactly once`);
    if (key === 'iw5') assert.match(rot, /^dsr DOM_default /);
    else if (key === 't6') assert.match(rot, /^gametype dom execgts hp_abc123_dom\.cfg map /);
    else assert.match(rot, /^gametype dom map /);
  }
  assert.equal(cod.TITLES.cod4x.maps.length, 16);
  assert.equal(cod.TITLES.iw4x.maps.length, 16);
  assert.equal(cod.TITLES.iw5.maps.length, 16);
  assert.equal(cod.TITLES.t5.maps.length, 14);
  assert.equal(cod.TITLES.t6.maps.filter((m) => !m[2]).length, 14);
  assert.equal(cod.TITLES.iw6x.maps.length, 14);
  assert.equal(cod.TITLES.s1x.maps.length, 12);
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
  assert.match(cfg, /execgts hp_abc123_tdm\.cfg map mp_raid"/);
  assert.equal(s.cod.bots.fill, 64);
  assert.equal(s.cod.xpScale, 1);
  assert.throws(() => cod.writeSettings(s, { 'cod.maps': [] }), /at least one map/);
  cod.writeSettings(s, { 'cod.bots.enabled': false });
  assert.match(cod.buildConfig(s), /bots_manage_fill "0"/);
});

test('BO2: NukeJacked playlist rotates Nuketown 2025 and Hijacked; DLC maps stay out of defaults', () => {
  const s = server('t6');
  assert.ok(!s.cod.maps.includes('mp_nuketown_2020'));
  cod.writeSettings(s, { 'cod.playlist': 'nukejacked', 'cod.gametype': 'tdm' });
  const cfg = cod.buildConfig(s);
  const rot = /sv_mapRotation "([^"]+)"/.exec(cfg)[1];
  assert.deepEqual([...rot.matchAll(/map (mp_\w+)/g)].map((m) => m[1]).sort(), ['mp_hijacked', 'mp_nuketown_2020']);
  assert.match(rot, /^gametype tdm execgts hp_abc123_tdm\.cfg map /);
  assert.match(cfg, /\/\/ Map rotation \(NukeJacked/);
  assert.equal(cod.readSettings(s)['cod.playlist'], 'nukejacked');
  // Unknown playlists fall back to the ticked maps; other titles have no playlists.
  cod.writeSettings(s, { 'cod.playlist': 'nope', 'cod.maps': ['mp_raid'] });
  assert.match(cod.buildConfig(s), /execgts hp_abc123_tdm\.cfg map mp_raid"/);
  const mw2 = server('iw4x');
  cod.writeSettings(mw2, { 'cod.playlist': 'nukejacked' });
  assert.equal(mw2.cod.playlist, '');
  assert.ok(!cod.settingsSchema(mw2).sections.some((sec) => sec.fields.some((f) => f.key === 'cod.playlist')));
});

test('BO2: match rules, per-mode rules and Bot Warfare settings', () => {
  const s = server('t6');
  // Laid out like Plutonium's own gamesettings files; untouched rules write only auto-balance.
  assert.match(cod.buildGtsConfig(s), /\r\nexecgts gamesettings_default\.cfg\r\nexecgts gamesettings_dom\.cfg\r\nexecgts gamesettings_default\.cfg\r\nexecgts gamesettings_dom\.cfg\r\nset_gametype dom\r\ngts autoTeamBalance "1"\r\n$/);
  assert.match(cod.buildConfig(s), /set bots_team_force "1"/);
  cod.writeSettings(s, {
    'cod.gametype': 'tdm',
    'cod.match.hardcoreMode': '1',
    'cod.match.friendlyfiretype': '2',
    'cod.match.allowKillcam': '',
    'cod.mode.tdm.timeLimit': 0,
    'cod.mode.tdm.scoreLimit': 100,
    'cod.mode.dom.scoreLimit': 300,
    'cod.bots.team': 'custom',
    'cod.bots.teamAmount': 4,
    'cod.bots.aim': false,
    'cod.bots.rank': 999,
  });
  const gts = cod.buildGtsConfig(s);
  assert.match(gts, /set_gametype tdm\r\ngts hardcoreMode "1"\r\ngts friendlyfiretype "2"\r\ngts autoTeamBalance "1"\r\ngts timeLimit "0"\r\ngts scoreLimit "100"\r\n$/);
  assert.doesNotMatch(gts, /allowKillcam|300/);
  const cfg = cod.buildConfig(s);
  assert.match(cfg, /set bots_team "custom"/);
  assert.match(cfg, /set bots_team_amount "4"/);
  assert.match(cfg, /set bots_play_aim "0"/);
  assert.match(cfg, /set bots_loadout_rank "100"/);
  assert.match(cfg, /set bots_play_nade "1"/);
  const values = cod.readSettings(s);
  assert.equal(values['cod.mode.tdm.scoreLimit'], '100');
  assert.equal(values['cod.match.allowKillcam'], '');
  assert.equal(values['cod.bots.aim'], false);
  // Bad numbers are refused without changing anything; injection attempts can't pick values.
  assert.throws(() => cod.writeSettings(s, { 'cod.mode.tdm.timeLimit': 'lots', 'cod.match.hardcoreMode': '0' }), /enter a number/);
  assert.equal(s.cod.match.hardcoreMode, 1);
  cod.writeSettings(s, { 'cod.match.friendlyfiretype': '1"; quit' });
  assert.equal(s.cod.match.friendlyfiretype, null);
  // Schema: round settings only on round modes; rule sections follow the game mode; maps carry previews.
  const sections = cod.settingsSchema(s).sections;
  const tdm = sections.find((x) => x.title === 'Team Deathmatch rules');
  assert.deepEqual(tdm.showIf, { key: 'cod.gametype', value: 'tdm' });
  assert.ok(!tdm.fields.some((f) => f.key.includes('round')));
  assert.ok(sections.find((x) => x.title === 'Search & Destroy rules').fields.some((f) => f.key === 'cod.mode.sd.roundLimit'));
  const maps = sections.flatMap((x) => x.fields).find((f) => f.key === 'cod.maps');
  assert.equal(maps.type, 'maps');
  assert.equal(maps.options.find((o) => o.value === 'mp_nuketown_2020').image, '/api/servers/abc123/map-image/mp_nuketown_2020');
  // MW3 takes its rules from DSR files, so it has no rule sections.
  assert.ok(!cod.settingsSchema(server('iw5')).sections.some((x) => x.showIf));
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

test('map previews: wiki look-up picks the map page, caches the picture, and remembers misses', async () => {
  const mapImages = require('../src/services/mapimages');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    if (u.hostname === 'callofduty.fandom.com') {
      const q = u.searchParams.get('gsrsearch');
      const pages = q.startsWith('Hijacked')
        ? {
            1: { index: 1, title: 'Hijacked (Zombies)', thumbnail: { source: 'https://static.wikia.nocookie.net/wrong.png' } },
            2: { index: 2, title: 'Hijacked', thumbnail: { source: 'https://static.wikia.nocookie.net/callofduty/hijacked.png' } },
          }
        : q.startsWith('Evil')
          ? { 1: { index: 1, title: 'Evil', thumbnail: { source: 'https://attacker.example/x.png' } } }
          : {};
      return new Response(JSON.stringify({ query: { pages } }), { headers: { 'content-type': 'application/json' } });
    }
    if (u.pathname.endsWith('/hijacked.png')) return new Response(png, { headers: { 'content-type': 'image/png' } });
    return new Response('nope', { status: 404 });
  };
  try {
    const img = await mapImages.get('t6', 'mp_hijacked', 'Black Ops II', 'Hijacked');
    assert.equal(img.type, 'image/png');
    assert.deepEqual(fs.readFileSync(img.file), png);
    assert.ok(calls.some((c) => c.endsWith('/callofduty/hijacked.png')), 'exact title wins over "Hijacked (Zombies)"');
    const before = calls.length;
    assert.equal((await mapImages.get('t6', 'mp_hijacked', 'Black Ops II', 'Hijacked')).file, img.file);
    assert.equal(calls.length, before, 'second request is served from the cache');
    // No page found, or an image outside the wiki: no picture, and no retry until tomorrow.
    assert.equal(await mapImages.get('t6', 'mp_nowhere', 'Black Ops II', 'Nowhere'), null);
    assert.equal(await mapImages.get('t6', 'mp_evil', 'Black Ops II', 'Evil'), null);
    assert.ok(!calls.some((c) => c.includes('attacker.example')));
    const n = calls.length;
    assert.equal(await mapImages.get('t6', 'mp_nowhere', 'Black Ops II', 'Nowhere'), null);
    assert.equal(calls.length, n);
  } finally {
    global.fetch = realFetch;
  }
});

test('BO2 start writes the mode file where "execgts" looks (Plutonium storage/t6/gamesettings)', async () => {
  const s = server('t6');
  fs.mkdirSync(path.join(s.cod.gameDir, 'zone'), { recursive: true });
  cod.writeSettings(s, { 'cod.gametype': 'dom', 'cod.mode.dom.scoreLimit': 200 });
  // Plutonium itself isn't installed in the test, so the launch stops after writing the configs.
  await assert.rejects(cod.buildLaunch(s), /Plutonium is not installed/);
  const file = path.join(tools.plutoStorage('t6'), 'gamesettings', 'hp_abc123_dom.cfg');
  assert.match(fs.readFileSync(file, 'utf8'), /set_gametype dom\r\ngts autoTeamBalance "1"\r\ngts scoreLimit "200"\r\n$/);
  assert.match(fs.readFileSync(path.join(s.cod.gameDir, 'main', 'hp_abc123.cfg'), 'utf8'), /sv_mapRotation "gametype dom execgts hp_abc123_dom\.cfg map /);
});

test('CoD4x, MW2 and BO1 get match rules as scr_ dvars; every game gets its own Bot Warfare settings', () => {
  for (const key of ['cod4x', 'iw4x', 't5']) {
    const s = server(key);
    const keys = cod.settingsSchema(s).sections.flatMap((x) => x.fields.map((f) => f.key));
    assert.ok(keys.includes('cod.match.hardcoreMode'), key);
    assert.ok(!keys.includes('cod.match.prematchPeriod'), `${key}: BO2-only rules stay out`);
    // Untouched: only team balance is written.
    assert.match(cod.buildConfig(s), /\/\/ Match rules\r\nset scr_teambalance "1"\r\n\/\/ Map rotation/);
    const tdm = key === 'cod4x' || key === 'iw4x' ? 'war' : 'tdm';
    cod.writeSettings(s, { 'cod.gametype': tdm, 'cod.match.hardcoreMode': '1', 'cod.match.friendlyfiretype': '1', [`cod.mode.${tdm}.scoreLimit`]: 50, [`cod.mode.${tdm}.timeLimit`]: 0, 'cod.mode.sd.roundLimit': 6 });
    const cfg = cod.buildConfig(s);
    assert.match(cfg, /set scr_hardcore "1"\r\nset scr_team_fftype "1"\r\nset scr_teambalance "1"\r\n/);
    assert.match(cfg, new RegExp(`set scr_${tdm}_timelimit "0"\\r\\nset scr_${tdm}_scorelimit "50"\\r\\n`));
    assert.doesNotMatch(cfg, /scr_sd_roundlimit/, 'only the selected mode is written');
    assert.doesNotMatch(cfg, /^gts /m);
  }
  // Bot settings follow each game's README.
  const botKeys = (key) => cod.settingsSchema(server(key)).sections.flatMap((x) => x.fields.map((f) => f.key)).filter((k) => k.startsWith('cod.bots.'));
  assert.ok(botKeys('t5').includes('cod.bots.codpoints'));
  assert.ok(!botKeys('t5').includes('cod.bots.jumpdrop'));
  assert.ok(!botKeys('cod4x').includes('cod.bots.prestige'));
  assert.ok(botKeys('iw5').includes('cod.bots.carePackages'));
  assert.ok(!botKeys('t6').includes('cod.bots.carePackages'));
  const mw2 = server('iw4x');
  cod.writeSettings(mw2, { 'cod.bots.chat': 0.5, 'cod.bots.ads': false, 'cod.bots.fillMode': '4' });
  const cfg = cod.buildConfig(mw2);
  assert.match(cfg, /set bots_main_chat "0.5"/);
  assert.match(cfg, /set bots_play_ads "0"/);
  assert.match(cfg, /set bots_manage_fill_mode "4"/);
  assert.match(cfg, /set bots_team_force "1"/);
  assert.doesNotMatch(cod.buildConfig(server('cod4x')), /bots_loadout_prestige/);
});

test('S1x and IW6x run the AlterWare client from the game folder, without bots', async () => {
  for (const [key, exes] of [['s1x', ['s1-mod.exe', 's1x.exe']], ['iw6x', ['iw6-mod.exe', 'iw6x.exe']]]) {
    const s = server(key);
    assert.equal(s.cod.bots.enabled, false, `${key} has no Bot Warfare`);
    fs.mkdirSync(s.cod.gameDir, { recursive: true });
    await assert.rejects(cod.buildLaunch(s), /AlterWare/, `${key} without the client explains what's missing`);
    // Older XLabs builds are found too.
    fs.writeFileSync(path.join(s.cod.gameDir, exes[1]), '');
    let l = await cod.buildLaunch(s);
    assert.equal(path.basename(l.command), exes[1]);
    fs.writeFileSync(path.join(s.cod.gameDir, exes[0]), '');
    l = await cod.buildLaunch(s);
    assert.equal(path.basename(l.command), exes[0], 'the AlterWare name wins');
    assert.deepEqual(l.args, ['-dedicated', '+set', 'net_port', String(s.cod.port), '+exec', 'hp_abc123.cfg', '+map_rotate']);
    assert.ok(fs.existsSync(path.join(s.cod.gameDir, 'main', 'hp_abc123.cfg')));
    assert.ok(Array.isArray(l.logFile));
    // No bot settings in the schema, and turning bots on is ignored.
    assert.ok(!cod.settingsSchema(s).sections.some((x) => x.title === 'Bots'));
    cod.writeSettings(s, { 'cod.bots.enabled': true });
    assert.equal(s.cod.bots.enabled, false);
  }
});

test('CoD4x install takes the server binary from a release, never the plugins zip', async (t) => {
  const rel = (names) => ({ tag_name: '21.3', assets: names.map((name) => ({ name, browser_download_url: `https://github.com/callofduty4x/CoD4x_Server/releases/download/21.3/${name}` })) });
  // How releases look now: bare binaries plus plugin archives.
  const current = rel(['cod4x18_dedrun', 'cod4x18_dedrun.exe', 'plugins_linux.zip', 'plugins_windows.zip']);
  assert.deepEqual(tools.pickCod4xAsset(current, 'win32'), { url: current.assets[1].browser_download_url, name: 'cod4x18_dedrun.exe', binary: true });
  assert.equal(tools.pickCod4xAsset(current, 'linux').name, 'cod4x18_dedrun');
  // Older releases packed the server in a zip; a plugins zip alone is not a server.
  assert.equal(tools.pickCod4xAsset(rel(['cod4x_server-windows.zip', 'plugins_windows.zip']), 'win32').name, 'cod4x_server-windows.zip');
  assert.equal(tools.pickCod4xAsset(rel(['plugins_windows.zip']), 'win32'), null);

  // End to end with a fake GitHub: the binary lands in the server folder.
  const realFetch = global.fetch;
  t.after(() => (global.fetch = realFetch));
  const binName = process.platform === 'win32' ? 'cod4x18_dedrun.exe' : 'cod4x18_dedrun';
  global.fetch = async (url) => {
    if (url.includes('api.github.com')) return new Response(JSON.stringify(current), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/' + binName)) return new Response(Buffer.from('server-binary'));
    return new Response('wrong file', { status: 404 });
  };
  const dir = path.join(tmp, 'cod4x-install');
  assert.equal(await tools.installCod4x(dir, { info() {}, warn() {} }), '21.3');
  assert.equal(fs.readFileSync(path.join(dir, binName), 'utf8'), 'server-binary');
  assert.equal(tools.findCod4xExe(dir), path.join(dir, binName));
});
