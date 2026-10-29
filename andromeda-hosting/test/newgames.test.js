'use strict';
// Satisfactory (+ ficsit.app mods), 7 Days to Die (+ mods), Valheim, and their helpers.
// Nothing here needs internet access or the real game servers.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-newgames-'));
process.env.ANDROMEDA_DATA = path.join(tmp, 'data');

const semver = require('../src/util/semver');
const ficsit = require('../src/services/ficsit');
const sfapi = require('../src/util/sfapi');
const satisfactory = require('../src/games/satisfactory');
const sdtd = require('../src/games/sdtd');
const valheim = require('../src/games/valheim');
const telnet = require('../src/util/telnet7d');
const a2s = require('../src/util/a2s');
const { sendCtrlC } = require('../src/util/ctrlc');
const { createZip } = require('../src/util/zip');
const { templates, games, CONFIG_KEY } = require('../src/games');

const quiet = { info() {}, warn() {}, error() {}, progress() {} };

test('semver ranges used by ficsit.app mods', () => {
  const cases = [
    ['3.10.0', '^3.7.0', true], ['4.0.0', '^3.7.0', false], ['3.7.0-beta.1', '^3.7.0', false], ['0.2.5', '^0.2.3', true], ['0.3.0', '^0.2.3', false],
    ['1.2.9', '~1.2.3', true], ['1.3.0', '~1.2.3', false], ['365306', '>=264901', true], ['200000', '>=264901', false], ['1.5.0', '1.x', true],
    ['2.0.0', '1.x', false], ['1.5.0', '>=1.0.0 <2.0.0', true], ['2.1.0', '1.0.0 - 2.0.0', false], ['5.1.0', '^1.0.0 || ^5.0.0', true], ['1.2.4', '1.2.3', false],
  ];
  for (const [v, r, want] of cases) assert.equal(semver.satisfies(v, r), want, `${v} ${r}`);
  assert.ok(semver.compare('1.10.0', '1.9.0') > 0);
  assert.ok(semver.compare('1.0.0', '1.0.0-rc.1') > 0);
});

test('templates and game registry include the new games', () => {
  for (const id of ['satisfactory', 'sdtd', 'valheim', 'cod-s1x', 'cod-iw6x']) assert.ok(templates.find((t) => t.id === id), id);
  for (const g of ['satisfactory', 'sdtd', 'valheim']) assert.ok(games[g] && CONFIG_KEY[g], g);
  const covers = require('../src/services/covers');
  assert.equal(covers.defaultKey({ sf: {} }), 'satisfactory');
  assert.equal(covers.defaultKey({ sdtd: {} }), 'sdtd');
  assert.equal(covers.defaultKey({ vh: {} }), 'valheim');
  for (const k of ['satisfactory', 'sdtd', 'valheim', 'cod-s1x', 'cod-iw6x']) assert.ok(covers.DEFAULTS[k], k);
  // Every game card on the Create page has a default picture.
  for (const t of templates) assert.ok(Object.hasOwn(covers.DEFAULTS, covers.templateKey(t) || ''), t.id);
  assert.equal(covers.defaultInfo('constructor'), null, 'only real games');
  assert.equal(covers.defaultInfo('../x'), null);
});

// ---------- ficsit.app ----------
// A fake ficsit.app: GraphQL answers from MODS, downloads from ZIPS.
const target = ficsit.serverTarget() || 'LinuxServer';
const both = (ref, ver) => [
  { targetName: 'WindowsServer', link: `/v1/version/${ref}-${ver}/WindowsServer/download`, hash: null, size: 1 },
  { targetName: 'LinuxServer', link: `/v1/version/${ref}-${ver}/LinuxServer/download`, hash: null, size: 1 },
];
const ver = (ref, version, extra = {}) => ({ id: `${ref}-${version}`, version, game_version: '>=300000', required_on_remote: true, stability: 'release', dependencies: [], targets: both(ref, version), ...extra });
const MODS = {
  SML: { id: 'smlid', mod_reference: 'SML', name: 'Satisfactory Mod Loader', short_description: '', logo: null, downloads: 1, versions: [ver('SML', '3.9.0'), ver('SML', '3.10.0'), ver('SML', '3.11.0', { game_version: '>=400000' })] },
  ModA: {
    id: 'aid', mod_reference: 'ModA', name: 'Mod A', short_description: '', logo: null, downloads: 1,
    versions: [
      ver('ModA', '1.0.0', { dependencies: [{ mod_id: 'SML', condition: '^3.9.0', optional: false }] }),
      ver('ModA', '1.1.0', { dependencies: [{ mod_id: 'SML', condition: '^3.10.0', optional: false }, { mod_id: 'bid', condition: '>=2.0.0', optional: false }, { mod_id: 'ModOpt', condition: '*', optional: true }, { mod_id: 'FactoryGame', condition: '>=1.0.0', optional: false }] }),
      ver('ModA', '1.2.0-beta.1', { stability: 'beta' }),
    ],
  },
  // Depended on by id ("bid"), not reference. 2.1.0 has no server build.
  ModB: { id: 'bid', mod_reference: 'ModB', name: 'Mod B', short_description: '', logo: null, downloads: 1, versions: [ver('ModB', '2.0.0', { required_on_remote: false }), { ...ver('ModB', '2.1.0'), targets: [{ targetName: 'Windows', link: '/x', hash: null }] }] },
  ClientOnly: { id: 'cid', mod_reference: 'ClientOnly', name: 'Client Only', short_description: '', logo: null, downloads: 1, versions: [{ ...ver('ClientOnly', '1.0.0'), targets: [{ targetName: 'Windows', link: '/x' }] }] },
};
const ZIPS = new Map();
let fetchLog = [];
const realFetch = global.fetch;
function fakeFetch(url, opts = {}) {
  fetchLog.push(url);
  if (url === 'https://api.ficsit.app/v2/query') {
    const { variables } = JSON.parse(opts.body);
    const key = variables.id;
    if (key) {
      const mod = Object.values(MODS).find((m) => m.mod_reference === key || m.id === key) || null;
      return Promise.resolve(new Response(JSON.stringify({ data: { getModByIdOrReference: mod } }), { headers: { 'content-type': 'application/json' } }));
    }
    const mods = Object.values(MODS).filter((m) => !variables.filter.search || m.name.toLowerCase().includes(variables.filter.search.toLowerCase()));
    return Promise.resolve(new Response(JSON.stringify({ data: { getMods: { count: mods.length, mods } } }), { headers: { 'content-type': 'application/json' } }));
  }
  const m = /^https:\/\/api\.ficsit\.app\/v1\/version\/([^/]+)\/(\w+)\/download$/.exec(url);
  if (m && ZIPS.has(m[1])) return Promise.resolve(new Response(fs.readFileSync(ZIPS.get(m[1])), { headers: { 'content-type': 'application/zip' } }));
  return Promise.resolve(new Response('not found', { status: 404 }));
}

async function makeModZip(ref, version, { wrap = false } = {}) {
  const src = path.join(tmp, 'zipsrc', `${ref}-${version}`);
  const root = wrap ? path.join(src, ref) : src;
  fs.mkdirSync(path.join(root, 'Binaries'), { recursive: true });
  fs.writeFileSync(path.join(root, `${ref}.uplugin`), JSON.stringify({ VersionName: version }));
  fs.writeFileSync(path.join(root, 'Binaries', 'mod.bin'), version);
  const out = path.join(tmp, 'zips', `${ref}-${version}.zip`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await createZip(src, out);
  ZIPS.set(`${ref}-${version}`, out);
  return out;
}

test('ficsit.app: resolves mods, dependencies (by id too) and SML against the game build', async (t) => {
  global.fetch = fakeFetch;
  t.after(() => (global.fetch = realFetch));
  const chosen = await ficsit.resolve([{ ref: 'ModA' }], { game: 365306, target });
  assert.deepEqual([...chosen.keys()].sort(), ['ModA', 'ModB', 'SML']);
  assert.equal(chosen.get('ModA').version.version, '1.1.0', 'newest release, not the beta');
  assert.equal(chosen.get('SML').version.version, '3.10.0', '3.11.0 needs a newer game');
  assert.equal(chosen.get('ModB').version.version, '2.0.0', '2.1.0 has no server build');
  assert.ok(!chosen.has('ModOpt'), 'optional dependencies are skipped');
  // A pinned version brings its own requirements.
  const pinned = await ficsit.resolve([{ ref: 'ModA', version: '1.0.0' }], { game: 365306, target });
  assert.deepEqual([...pinned.keys()].sort(), ['ModA', 'SML']);
  await assert.rejects(ficsit.resolve([{ ref: 'ClientOnly' }], { game: 365306, target }), /no dedicated-server build/);
  await assert.rejects(ficsit.resolve([{ ref: 'ModA' }], { game: 100000, target }), /works with this game build/);
  const found = await ficsit.search('mod a');
  assert.equal(found.mods[0].ref, 'ModA');
});

test('ficsit.app: installs into FactoryGame/Mods, checks hashes, removes what is no longer needed', async (t) => {
  global.fetch = fakeFetch;
  t.after(() => (global.fetch = realFetch));
  await makeModZip('SML', '3.10.0');
  await makeModZip('ModA', '1.1.0', { wrap: true });
  await makeModZip('ModB', '2.0.0');
  const dir = path.join(tmp, 'sf-install');
  fs.mkdirSync(path.join(dir, 'FactoryGame', 'Mods', 'OldMod'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'FactoryGame', 'Mods', 'HandPlaced'), { recursive: true });
  const chosen = await ficsit.resolve([{ ref: 'ModA' }], { game: 365306, target });
  // ficsit.app's SHA-256 for the download; a matching one passes.
  const smlTarget = chosen.get('SML').version.targets.find((x) => x.targetName === target);
  smlTarget.hash = crypto.createHash('sha256').update(fs.readFileSync(ZIPS.get('SML-3.10.0'))).digest('hex');
  const installed = await ficsit.install(dir, chosen, { OldMod: '1.0.0' }, { target, log: quiet });
  assert.deepEqual(installed, { SML: '3.10.0', ModA: '1.1.0', ModB: '2.0.0' });
  const mods = path.join(dir, 'FactoryGame', 'Mods');
  for (const ref of ['SML', 'ModA', 'ModB']) assert.ok(fs.existsSync(path.join(mods, ref, `${ref}.uplugin`)), `${ref} unpacked at the plugin root`);
  assert.ok(!fs.existsSync(path.join(mods, 'OldMod')), 'mods the panel installed before and no longer needs are removed');
  assert.ok(fs.existsSync(path.join(mods, 'HandPlaced')), 'folders the panel never installed are left alone');
  // Nothing changed: no downloads the second time.
  fetchLog = [];
  await ficsit.install(dir, chosen, installed, { target, log: quiet });
  assert.ok(!fetchLog.some((u) => u.includes('/download')));
  // A damaged download is refused.
  smlTarget.hash = 'f'.repeat(64);
  await assert.rejects(ficsit.install(dir, chosen, {}, { target, log: quiet }), /checksum/);
});

// ---------- Satisfactory ----------
function sfServer() {
  const s = { id: 'sf01', name: 'Factory Friends', game: 'satisfactory', dir: path.join(tmp, 'sf-srv') };
  s.sf = satisfactory.defaults({ name: s.name, sf: { clientPassword: 'rex-1234' } });
  return s;
}
function fakeInstance(server) {
  const lines = [];
  return { server, child: { pid: 1 }, lines, appendConsole: (l) => lines.push(l), kill() { this.killed = true; } };
}

test('Satisfactory: defaults, launch arguments and admin-only settings', async () => {
  const s = sfServer();
  assert.equal(s.sf.port, 7777);
  assert.equal(s.sf.reliablePort, 8888);
  assert.ok(s.sf.adminPassword.length >= 12, 'an admin password is generated');
  assert.deepEqual(satisfactory.ports(s).map((p) => p.port), [7777, 8888]);
  const exe = { win32: 'Engine/Binaries/Win64/FactoryServer-Win64-Shipping-Cmd.exe', linux: 'Engine/Binaries/Linux/FactoryServer-Linux-Shipping' }[process.platform];
  if (exe) {
    fs.mkdirSync(path.dirname(path.join(s.dir, exe)), { recursive: true });
    fs.writeFileSync(path.join(s.dir, exe), '');
    s.sf.seasonalEvents = false;
    const l = await satisfactory.buildLaunch(s);
    assert.equal(l.args[0], 'FactoryGame');
    assert.ok(l.args.includes('-Port=7777') && l.args.includes('-ReliablePort=8888') && l.args.includes('-DisableSeasonalEvents'));
    assert.ok(l.args.includes('-ini:Game:[/Script/Engine.GameSession]:MaxPlayers=4'));
  }
  assert.ok(!('sf.adminPassword' in satisfactory.readSettings(s)), 'friends with Settings access don\'t see the admin password');
  assert.equal(satisfactory.readSettings(s, { admin: true })['sf.adminPassword'], s.sf.adminPassword);
  satisfactory.writeSettings(s, { 'sf.adminPassword': 'hacked', 'sf.extraArgs': '-evil' }, { admin: false });
  assert.notEqual(s.sf.adminPassword, 'hacked');
  assert.equal(s.sf.extraArgs, '');
  assert.throws(() => satisfactory.writeSettings(s, { 'sf.port': 8888 }, { admin: true }), /must differ/);
});

test('Satisfactory: claims a new server, starts a game, saves before shutdown', async (t) => {
  const real = sfapi.call;
  t.after(() => (sfapi.call = real));
  const calls = [];
  const srv = { claimed: false, admin: null, sessions: [], running: false };
  sfapi.call = async (port, fn, data, opts = {}) => {
    calls.push({ fn, data, token: opts.token });
    const need = (tok) => {
      if (opts.token !== tok) throw new sfapi.ApiError(401, 'invalid_token');
    };
    switch (fn) {
      case 'PasswordlessLogin':
        if (srv.claimed) throw new sfapi.ApiError(403, 'passwordless_login_not_possible');
        return { authenticationToken: 'initial' };
      case 'ClaimServer':
        need('initial');
        srv.claimed = true;
        srv.admin = data.AdminPassword;
        return { authenticationToken: 'admin-1' };
      case 'PasswordLogin':
        if (data.Password !== srv.admin) throw new sfapi.ApiError(401, 'wrong_password');
        return { authenticationToken: 'admin-1' };
      case 'SetAdminPassword':
        need('admin-1');
        srv.admin = data.Password;
        return {};
      case 'EnumerateSessions':
        need('admin-1');
        return { sessions: srv.sessions };
      case 'QueryServerState':
        need('admin-1');
        return { serverGameState: { isGameRunning: srv.running, activeSessionName: srv.sessions[0] && srv.sessions[0].sessionName, numConnectedPlayers: 1, playerLimit: 4 } };
      case 'CreateNewGame':
        need('admin-1');
        srv.sessions.push({ sessionName: data.NewGameData.SessionName });
        srv.running = true;
        return {};
      default:
        need('admin-1');
        return {};
    }
  };
  const s = sfServer();
  const inst = fakeInstance(s);
  satisfactory.onReady(s, inst);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(srv.admin, s.sf.adminPassword, 'claimed with the panel\'s admin password');
  assert.ok(calls.some((c) => c.fn === 'CreateNewGame' && c.data.NewGameData.SessionName === 'Factory Friends'));
  assert.ok(calls.some((c) => c.fn === 'SetClientPassword' && c.data.Password === 'rex-1234'));
  assert.ok(calls.some((c) => c.fn === 'ApplyServerOptions' && c.data.UpdatedServerOptions['FG.AutosaveInterval'] === '300'));
  assert.deepEqual(await satisfactory.query(s), { online: 1, max: 4, players: [], map: 'Factory Friends' });

  // Next start: already claimed, has a game. A changed admin password is switched over.
  calls.length = 0;
  satisfactory.closeRcon(s);
  s.sf.adminPassword = 'new-admin-pw';
  satisfactory.onReady(s, inst);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(srv.admin, 'new-admin-pw');
  assert.ok(!calls.some((c) => c.fn === 'CreateNewGame'), 'existing saves are kept');

  await satisfactory.stop(inst);
  const save = calls.find((c) => c.fn === 'SaveGame');
  assert.equal(save.data.SaveName, 'Factory Friends_panel');
  assert.ok(calls.findIndex((c) => c.fn === 'Shutdown') > calls.indexOf(save), 'saves, then shuts down');
  assert.ok(!inst.killed);
});

// ---------- 7 Days to Die ----------
function sdServer() {
  const s = { id: 'sd01', name: 'Horde "Night" & Co', game: 'sdtd', dir: path.join(tmp, 'sd-srv') };
  s.sdtd = sdtd.defaults({ name: s.name, sdtd: { password: 'rex-1234', difficulty: '3' } });
  return s;
}

test('7 Days to Die: config is built on the game\'s own serverconfig.xml', () => {
  const s = sdServer();
  fs.mkdirSync(s.dir, { recursive: true });
  fs.writeFileSync(
    path.join(s.dir, 'serverconfig.xml'),
    `<?xml version="1.0"?>\n<ServerSettings>\n\t<property name="ServerName" value="My Game Host" />\n\t<property name="GameDifficulty" value="1" />\n\t<property name="LootAbundance" value="100" />\n\t<!-- <property name="SaveGameFolder" value="absolute path" /> -->\n\t<property name="TelnetPassword" value="secret" />\n</ServerSettings>\n`
  );
  sdtd.writeSettings(s, { 'sdtd.extraProps': 'BedrollDeadZoneSize=15\nUserDataFolder=C:\\\\evil' }, { admin: true });
  const xml = sdtd.buildConfig(s);
  const props = sdtd.parseProps(xml);
  assert.equal(props.get('ServerName'), 'Horde "Night" & Co', 'names with quotes and & survive');
  assert.match(xml, /value="Horde &quot;Night&quot; &amp; Co"/);
  assert.equal(props.get('GameDifficulty'), '3');
  assert.equal(props.get('LootAbundance'), '100', 'untouched game defaults are kept');
  assert.equal(props.get('ServerPassword'), 'rex-1234');
  assert.ok(!props.has('SaveGameFolder'), 'commented-out properties stay out');
  assert.equal(props.get('BedrollDeadZoneSize'), '15');
  assert.equal(props.get('UserDataFolder'), path.join(s.dir, 'UserData'), 'saves always stay in the server folder');
  assert.equal(props.get('TelnetPassword'), '', 'telnet stays on this PC');
  assert.equal(props.get('TelnetEnabled'), 'true');
});

test('7 Days to Die: settings validation and admin-only fields', () => {
  const s = sdServer();
  assert.throws(() => sdtd.writeSettings(s, { 'sdtd.crossplay': true, 'sdtd.eac': false }), /Anti-Cheat/);
  assert.throws(() => sdtd.writeSettings(s, { 'sdtd.telnetPort': s.sdtd.port + 1 }), /overlaps/);
  assert.throws(() => sdtd.writeSettings(s, { 'sdtd.maxPlayers': 0 }), /Max players/);
  sdtd.writeSettings(s, { 'sdtd.branch': 'latest_experimental', 'sdtd.extraArgs': '-x' }, { admin: false });
  assert.equal(s.sdtd.branch, '');
  assert.equal(s.sdtd.extraArgs, '');
  assert.deepEqual(sdtd.ports(s).filter((p) => p.forward).map((p) => p.port), [26900, 26901, 26902]);
});

test('7 Days to Die: mods install from .zip, switch off and on, and the game\'s own stay put', async () => {
  const s = sdServer();
  fs.mkdirSync(path.join(s.dir, 'Mods', '0_TFP_Harmony'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'Mods', '0_TFP_Harmony', 'ModInfo.xml'), '<xml><Name value="0_TFP_Harmony" /></xml>');
  fs.writeFileSync(path.join(s.dir, 'Mods', '0_TFP_Harmony', '0Harmony.dll'), '');
  const src = path.join(tmp, 'sdmod');
  fs.mkdirSync(path.join(src, 'Download', 'BiggerBackpack', 'Config'), { recursive: true });
  fs.writeFileSync(path.join(src, 'Download', 'BiggerBackpack', 'ModInfo.xml'), '<?xml version="1.0"?><xml><Name value="BiggerBackpack" /><DisplayName value="Bigger Backpack" /><Version value="2.1" /><Author value="Someone" /><Website value="javascript:alert(1)" /></xml>');
  fs.writeFileSync(path.join(src, 'Download', 'BiggerBackpack', 'Config', 'items.xml'), '<configs/>');
  const zip = path.join(tmp, 'sdmod.zip');
  await createZip(src, zip);
  assert.deepEqual(await sdtd.installModZip(s, zip, { admin: false }), ['BiggerBackpack']);
  let mods = sdtd.listMods(s);
  assert.equal(mods[0].folder, '0_TFP_Harmony');
  assert.ok(mods[0].builtin && mods[0].code);
  const bb = mods.find((m) => m.folder === 'BiggerBackpack');
  assert.equal(bb.name, 'Bigger Backpack');
  assert.equal(bb.version, '2.1');
  assert.equal(bb.website, '', 'only http(s) links are shown');
  assert.ok(bb.enabled && !bb.code);

  sdtd.setModEnabled(s, 'BiggerBackpack', false);
  assert.ok(fs.existsSync(path.join(s.dir, 'Mods.disabled', 'BiggerBackpack', 'ModInfo.xml')));
  assert.equal(sdtd.listMods(s).find((m) => m.folder === 'BiggerBackpack').enabled, false);
  sdtd.setModEnabled(s, 'BiggerBackpack', true);
  assert.ok(fs.existsSync(path.join(s.dir, 'Mods', 'BiggerBackpack')));
  assert.throws(() => sdtd.setModEnabled(s, '0_TFP_Harmony', false), /stay on/);
  assert.throws(() => sdtd.removeMod(s, '0_TFP_Harmony'), /can't be removed/);
  assert.throws(() => sdtd.removeMod(s, '../Mods'), /Invalid mod folder/);

  // Mods with code need an admin.
  fs.writeFileSync(path.join(src, 'Download', 'BiggerBackpack', 'Harmony.dll'), 'MZ');
  const zip2 = path.join(tmp, 'sdmod2.zip');
  await createZip(src, zip2);
  await assert.rejects(sdtd.installModZip(s, zip2, { admin: false }), /Only an admin/);
  await sdtd.installModZip(s, zip2, { admin: true });
  assert.ok(sdtd.listMods(s).find((m) => m.folder === 'BiggerBackpack').code);
  sdtd.removeMod(s, 'BiggerBackpack');
  assert.ok(!fs.existsSync(path.join(s.dir, 'Mods', 'BiggerBackpack')));

  const empty = path.join(tmp, 'empty-src');
  fs.mkdirSync(empty, { recursive: true });
  fs.writeFileSync(path.join(empty, 'readme.txt'), 'hi');
  await createZip(empty, path.join(tmp, 'empty.zip'));
  await assert.rejects(sdtd.installModZip(s, path.join(tmp, 'empty.zip')), /No mod found/);
});

test('7 Days to Die telnet: logs in, runs a command, reads the player list', async () => {
  const server = net.createServer((sock) => {
    sock.write(Buffer.from([255, 251, 1])); // IAC WILL ECHO
    sock.write("*** Connected with 7DTD server.\r\nPress 'help' to get a list of all commands. Press 'exit' to end session.\r\n");
    sock.on('data', (d) => {
      if (String(d).trim() === 'lp') sock.write('0. id=171, Alice, pos=(1, 2, 3), level=5\r\n1. id=172, Bob, pos=(4, 5, 6), level=9\r\nTotal of 2 in the game\r\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const out = await telnet.command('127.0.0.1', server.address().port, '', 'lp', { quietMs: 100 });
    assert.deepEqual(telnet.parsePlayers(out), { online: 2, players: ['Alice', 'Bob'] });
  } finally {
    server.close();
  }
});

// ---------- Valheim ----------
test('Valheim: password rules, command line and admin lists', async () => {
  const s = { id: 'vh01', name: 'Viking Den', game: 'valheim', dir: path.join(tmp, 'vh-srv') };
  s.vh = valheim.defaults({ name: s.name, vh: { password: 'odin-4242' } });
  assert.equal(s.vh.worldName, 'Viking Den');
  assert.throws(() => valheim.writeSettings(s, { 'vh.password': 'abc' }), /at least 5/);
  assert.throws(() => valheim.writeSettings(s, { 'vh.password': 'Viking' }), /part of the server name/);
  assert.throws(() => valheim.writeSettings(s, { 'vh.worldName': '../escape' }), /not valid/);
  valheim.writeSettings(s, { 'vh.combat': 'hard', 'vh.nobuildcost': true, 'vh.admins': '76561198000000001\nXbox_123', 'vh.crossplay': true });
  // A short default password is replaced so the server can start.
  assert.ok(valheim.defaults({ name: 'x', vh: { password: 'ab' } }).password.length >= 5);
  const exe = { win32: 'valheim_server.exe', linux: 'valheim_server.x86_64' }[process.platform];
  if (!exe) return;
  fs.mkdirSync(s.dir, { recursive: true });
  fs.writeFileSync(path.join(s.dir, exe), '');
  const l = await valheim.buildLaunch(s);
  const arg = (flag) => l.args[l.args.indexOf(flag) + 1];
  assert.equal(arg('-name'), 'Viking Den');
  assert.equal(arg('-world'), 'Viking Den');
  assert.equal(arg('-password'), 'odin-4242');
  assert.equal(arg('-savedir'), path.join(s.dir, 'saves'));
  assert.equal(arg('-saveinterval'), '600');
  assert.ok(l.args.join(' ').includes('-modifier combat hard'));
  assert.ok(l.args.join(' ').includes('-setkey nobuildcost'));
  assert.ok(l.args.includes('-crossplay'));
  assert.equal(l.env.SteamAppId, '892970');
  const admins = fs.readFileSync(path.join(s.dir, 'saves', 'adminlist.txt'), 'utf8');
  assert.match(admins, /^76561198000000001$/m);
  assert.match(admins, /^Xbox_123$/m);
});

test('Steam A2S_INFO replies are parsed', () => {
  const str = (s) => Buffer.from(s + '\0', 'utf8');
  const buf = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17]), str('Viking Den'), str('Viking Den'), str('valheim'), str('Valheim'), Buffer.from([0, 0, 3, 10, 0])]);
  assert.deepEqual(a2s.parseInfo(buf), { name: 'Viking Den', map: 'Viking Den', folder: 'valheim', game: 'Valheim', players: 3, maxPlayers: 10, bots: 0 });
  assert.throws(() => a2s.parseInfo(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00])), /not an A2S_INFO/);
});

test('Ctrl+C reaches the server process', { skip: process.platform === 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await new Promise((r) => setTimeout(r, 200));
  const exited = new Promise((r) => child.on('exit', (_code, signal) => r(signal)));
  assert.equal(await sendCtrlC(child), true);
  assert.equal(await exited, 'SIGINT');
});
