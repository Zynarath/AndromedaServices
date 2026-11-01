'use strict';
// Rust (+ uMod plugins and their settings). Nothing here needs internet access or the real game server.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-rust-'));
process.env.ANDROMEDA_DATA = path.join(tmp, 'data');

const rust = require('../src/games/rust');
const umod = require('../src/services/umod');
const modconfig = require('../src/util/modconfig');
const covers = require('../src/services/covers');
const { templates, games, CONFIG_KEY } = require('../src/games');

const PLUGIN = (cls, title, version) => `namespace Oxide.Plugins
{
    [Info("${title}", "Someone", "${version}")]
    [Description("Does a thing")]
    public class ${cls} : RustPlugin
    {
    }
}
`;

function makeServer(id, extra = {}) {
  const s = { id, name: 'Rusty Test', game: 'rust', dir: path.join(tmp, id) };
  s.rust = rust.defaults({ name: s.name, rust: { source: 'umod', ...extra } });
  fs.mkdirSync(s.dir, { recursive: true });
  return s;
}

test('Rust is registered with modded and vanilla templates', () => {
  assert.ok(games.rust && CONFIG_KEY.rust === 'rust');
  const ids = templates.filter((t) => t.game === 'rust').map((t) => t.id);
  assert.deepStrictEqual(ids.sort(), ['rust-umod', 'rust-vanilla']);
  assert.equal(covers.defaultKey({ rust: {} }), 'rust');
  assert.ok(covers.DEFAULTS.rust);
});

test('defaults: uMod on for the modded template, off for vanilla', () => {
  const s = makeServer('def1');
  assert.equal(s.rust.oxide, true);
  assert.equal(s.rust.hostname, 'Rusty Test');
  assert.equal(s.rust.port, 28015);
  assert.ok(s.rust.rconPassword.length >= 8);
  assert.ok(s.rust.seed >= 1);
  assert.equal(rust.defaults({ name: 'x', rust: { source: 'vanilla' } }).oxide, false);
});

test('settings reject clashing ports and custom maps without a URL', () => {
  const s = makeServer('set1');
  assert.throws(() => rust.writeSettings(s, { 'rust.rconPort': 28015 }), /must all be different/);
  assert.throws(() => rust.writeSettings(s, { 'rust.level': 'custom' }), /custom map/);
  rust.writeSettings(s, { 'rust.level': 'custom', 'rust.levelUrl': 'https://example.com/my.map' });
  assert.equal(s.rust.level, 'custom');
  // Admin-only fields are ignored for non-admins.
  rust.writeSettings(s, { 'rust.extraArgs': '+evil 1' });
  assert.equal(s.rust.extraArgs, '');
});

test('launch command line', async () => {
  const s = makeServer('launch1', { port: 28115, rconPort: 28116, queryPort: 28117, appPort: 0, pve: true });
  await assert.rejects(rust.buildLaunch(s), /Server files are missing/);
  const exe = path.join(s.dir, process.platform === 'win32' ? 'RustDedicated.exe' : 'RustDedicated');
  fs.writeFileSync(exe, '');
  await assert.rejects(rust.buildLaunch(s), /uMod is turned on but not installed/);
  fs.mkdirSync(path.join(s.dir, 'RustDedicated_Data', 'Managed'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'RustDedicated_Data', 'Managed', 'Oxide.Rust.dll'), '');
  const l = await rust.buildLaunch(s);
  const arg = (k) => l.args[l.args.indexOf(k) + 1];
  assert.equal(arg('+server.port'), '28115');
  assert.equal(arg('+rcon.port'), '28116');
  assert.equal(arg('+rcon.ip'), '127.0.0.1');
  assert.equal(arg('+rcon.web'), '1');
  assert.equal(arg('+app.port'), '-1');
  assert.equal(arg('+server.pve'), 'true');
  assert.equal(arg('+server.hostname'), 'Rusty Test');
  assert.equal(arg('+server.level'), 'Procedural Map');
  assert.deepStrictEqual(rust.ports(s).map((p) => [p.port, p.forward]), [[28115, true], [28117, true], [28116, false]]);
});

test('readable config names', () => {
  const cases = [
    ['MaxHomesPerPlayer', 'Max homes per player'], ['max_homes', 'Max homes'], ['maxHomes', 'Max homes'], ['UIScale', 'UI scale'],
    ['Chat prefix', 'Chat prefix'], ['Use permissions (true/false)', 'Use permissions'], ['EnablePvP', 'Enable PvP'], ['Slot1Item', 'Slot 1 item'], ['NPCKillReward', 'NPC kill reward'],
  ];
  for (const [k, want] of cases) assert.equal(modconfig.humanize(k), want, k);
});

test('uMod plugin source parsing and versions', () => {
  const info = umod.parseInfo(PLUGIN('BetterChat', 'Better Chat', '5.2.7'));
  assert.deepStrictEqual([info.title, info.author, info.version, info.className, info.description], ['Better Chat', 'Someone', '5.2.7', 'BetterChat', 'Does a thing']);
  assert.throws(() => umod.checkSource('class Foo {}', 'Foo'), /not an Oxide/);
  assert.throws(() => umod.checkSource(PLUGIN('Other', 'X', '1.0.0'), 'BetterChat'), /must be named Other\.cs/);
  assert.ok(umod.compareVersions('1.10.0', '1.9.3') > 0);
  assert.ok(umod.compareVersions('2.0.0', '2.0.0') === 0);
  assert.ok(umod.compareVersions('1.0', '1.0.1') < 0);
});

test('plugins: install, switch off and on, remove (settings kept)', () => {
  const s = makeServer('plug1');
  rust.installPlugin(s, 'Kits', PLUGIN('Kits', 'Rust Kits', '4.4.10'));
  assert.throws(() => rust.installPlugin(s, '../evil', PLUGIN('Kits', 'Rust Kits', '1')), /Invalid plugin name/);
  let list = rust.listPlugins(s);
  assert.deepStrictEqual(list.map((p) => [p.name, p.title, p.version, p.enabled]), [['Kits', 'Rust Kits', '4.4.10', true]]);
  rust.setPluginEnabled(s, 'Kits', false);
  assert.ok(fs.existsSync(path.join(s.dir, 'oxide', 'plugins.disabled', 'Kits.cs')));
  assert.equal(rust.listPlugins(s)[0].enabled, false);
  rust.setPluginEnabled(s, 'Kits', true);
  fs.mkdirSync(path.join(s.dir, 'oxide', 'config'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'oxide', 'config', 'Kits.json'), '{}');
  rust.removePlugin(s, 'Kits');
  assert.equal(rust.listPlugins(s).length, 0);
  assert.ok(fs.existsSync(path.join(s.dir, 'oxide', 'config', 'Kits.json')));
  assert.throws(() => rust.removePlugin(s, 'Kits'), /not found/);
});

test('plugin settings: readable names, write back, reject bad raw JSON', async () => {
  const s = makeServer('cfg1');
  rust.installPlugin(s, 'GatherManager', PLUGIN('GatherManager', 'Gather Manager', '2.2.78'));
  const cfgDir = path.join(s.dir, 'oxide', 'config');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.mkdirSync(path.join(s.dir, 'oxide', 'lang', 'en'), { recursive: true });
  const cfg = { Options: { GatherResourceModifiers: { Wood: 2.0 }, 'Enable PvP (true/false)': false, MaxHomes: 3 }, Kits: [{ Name: 'starter', Cooldown: 60 }] };
  fs.writeFileSync(path.join(cfgDir, 'GatherManager.json'), JSON.stringify(cfg, null, 2));
  fs.writeFileSync(path.join(s.dir, 'oxide', 'lang', 'en', 'GatherManager.json'), JSON.stringify({ NoPermission: 'Nope' }, null, 2));
  fs.writeFileSync(path.join(cfgDir, 'OldPlugin.json'), '{"a":1}');

  const list = await rust.listModConfigs(s);
  assert.deepStrictEqual(list.mods.map((m) => [m.name, m.installed, m.files.map((f) => f.label)]), [
    ['Gather Manager', true, ['Settings', 'Messages (English)']],
    ['Old plugin', false, ['Settings']],
  ]);

  const d = rust.readModConfig(s, 'config/GatherManager.json');
  const byKey = Object.fromEntries(d.fields.map((f) => [f.key, f]));
  assert.equal(byKey.MaxHomes.label, 'Max homes');
  assert.equal(byKey['Enable PvP (true/false)'].label, 'Enable PvP');
  assert.equal(byKey.Wood.section, 'Options › Gather resource modifiers');
  assert.equal(byKey.Cooldown.section, 'Kits › #1');
  assert.throws(() => rust.readModConfig(s, '../../secret.json'), /not found/);

  const r = rust.writeModConfig(s, 'config/GatherManager.json', { values: { [byKey.MaxHomes.id]: '5', [byKey.Cooldown.id]: '120', [byKey['Enable PvP (true/false)'].id]: true } });
  assert.equal(r.changed, 3);
  const after = JSON.parse(fs.readFileSync(path.join(cfgDir, 'GatherManager.json'), 'utf8'));
  assert.equal(after.Options.MaxHomes, 5);
  assert.equal(after.Kits[0].Cooldown, 120);
  assert.equal(after.Options['Enable PvP (true/false)'], true);
  assert.throws(() => rust.writeModConfig(s, 'config/GatherManager.json', { raw: '{ broken' }), /Not valid JSON/);
});

test('WebRCON: commands, player list, live plugin reload', async () => {
  const wss = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => wss.on('listening', r));
  const port = wss.address().port;
  const seen = [];
  wss.on('connection', (ws, req) => {
    if (req.url !== '/sekrit-pass') return ws.close();
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      seen.push(m.Message);
      ws.send(JSON.stringify({ Identifier: -1, Message: 'unrelated log line', Type: 'Generic' }));
      const reply = m.Message === 'playerlist' ? JSON.stringify([{ SteamID: '7656', DisplayName: 'Alice' }, { SteamID: '7657', DisplayName: 'Bob' }]) : `ok: ${m.Message}`;
      ws.send(JSON.stringify({ Identifier: m.Identifier, Message: reply, Type: 'Generic' }));
    });
  });
  try {
    const s = makeServer('rcon1', { rconPort: port, rconPassword: 'sekrit-pass' });
    assert.deepStrictEqual(await rust.query(s), { online: 2, max: 50, players: ['Alice', 'Bob'] });
    const lines = [];
    const inst = { server: s, appendConsole: (l) => lines.push(l) };
    await rust.sendCommand(inst, '/say hi');
    assert.equal(seen[seen.length - 1], 'say hi');
    assert.ok(lines.includes('[rcon] ok: say hi'));

    rust.installPlugin(s, 'Kits', PLUGIN('Kits', 'Rust Kits', '1.0.0'));
    fs.mkdirSync(path.join(s.dir, 'oxide', 'config'), { recursive: true });
    fs.writeFileSync(path.join(s.dir, 'oxide', 'config', 'Kits.json'), '{}');
    assert.deepStrictEqual(await rust.modConfigChanged(inst, 'config/Kits.json'), { reloaded: true });
    assert.equal(seen[seen.length - 1], 'oxide.reload Kits');

    const bad = makeServer('rcon2', { rconPort: port, rconPassword: 'wrong-pass' });
    await assert.rejects(rust.query(bad));
  } finally {
    wss.close();
  }
});

test('backups keep the world and uMod data, not the game', async () => {
  const s = makeServer('bak1');
  const world = path.join(s.dir, 'server', s.rust.identity);
  fs.mkdirSync(world, { recursive: true });
  fs.writeFileSync(path.join(world, 'proceduralmap.3500.1.sav'), 'world');
  rust.installPlugin(s, 'Kits', PLUGIN('Kits', 'Rust Kits', '1.0.0'));
  fs.mkdirSync(path.join(s.dir, 'oxide', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'oxide', 'logs', 'big.txt'), 'log');
  fs.writeFileSync(path.join(s.dir, 'RustDedicated.exe'), 'game');
  const staging = path.join(tmp, 'bak1-staging');
  fs.mkdirSync(staging);
  await rust.prepareBackup({ server: s }, staging);
  assert.ok(fs.existsSync(path.join(staging, 'server', s.rust.identity, 'proceduralmap.3500.1.sav')));
  assert.ok(fs.existsSync(path.join(staging, 'oxide', 'plugins', 'Kits.cs')));
  assert.ok(!fs.existsSync(path.join(staging, 'oxide', 'logs', 'big.txt')));
  assert.ok(!fs.existsSync(path.join(staging, 'RustDedicated.exe')));

  fs.writeFileSync(path.join(world, 'proceduralmap.3500.1.sav'), 'changed');
  rust.removePlugin(s, 'Kits');
  await rust.restoreBackup({ server: s }, staging, { info() {} });
  assert.equal(fs.readFileSync(path.join(world, 'proceduralmap.3500.1.sav'), 'utf8'), 'world');
  assert.equal(rust.listPlugins(s).length, 1);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
