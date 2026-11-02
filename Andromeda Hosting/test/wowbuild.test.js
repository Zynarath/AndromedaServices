'use strict';
// The Andromeda WotLK server build: download, install next to SPP, offline use, and the WoW setting.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-wowbuild-'));
process.env.ANDROMEDA_DATA = path.join(tmp, 'data');

const wowbuild = require('../src/services/wowbuild');
const wow = require('../src/games/wow');
const { createZip } = require('../src/util/zip');

const EXE = process.platform === 'win32' ? '.exe' : '';
const quiet = () => {
  const lines = [];
  return { lines, info: (m) => lines.push(m), warn: (m) => lines.push(m) };
};

function fakeSpp() {
  const root = fs.mkdtempSync(path.join(tmp, 'spp-'));
  const sv = path.join(root, 'SPP_Server');
  const bin = path.join(sv, 'Server', 'Binaries', 'wotlk', 'Bin64');
  const conf = path.join(sv, 'Settings', 'wotlk');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(conf, { recursive: true });
  for (const f of ['mangosd', 'realmd']) fs.writeFileSync(path.join(bin, f + EXE), 'spp');
  fs.writeFileSync(path.join(conf, 'mangosd.conf'), 'DataDir = "../../Server/Modules/wotlk"\nConsole.Enable = 1\n');
  fs.writeFileSync(path.join(conf, 'realmd.conf'), 'RealmServerPort = 3724\n');
  fs.writeFileSync(path.join(conf, 'aiplayerbot.conf'), 'AiPlayerbot.Enabled = 1\n');
  for (const d of ['dbc', 'maps']) fs.mkdirSync(path.join(sv, 'Server', 'Modules', 'wotlk', d), { recursive: true });
  return { root, bin };
}

// A release like the GitHub workflow publishes: a zip with the programs at its top level.
async function fakeRelease(version, { programs = ['mangosd', 'realmd'] } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'pkg-'));
  for (const f of programs) fs.writeFileSync(path.join(dir, f + EXE), `andromeda ${version}`);
  fs.writeFileSync(path.join(dir, 'ANDROMEDA_BUILD.txt'), version);
  const zip = path.join(tmp, `release-${version}-${Date.now()}.zip`);
  await createZip(dir, zip);
  return {
    release: { tag_name: `v${version}`, assets: [{ name: `andromeda-wotlk-server-${version}.zip`, browser_download_url: `https://example.test/${version}.zip` }] },
    download: async (_url, dest) => fs.copyFileSync(zip, dest),
  };
}

test('installs the latest release next to SPP and leaves SPP\'s programs alone', async () => {
  const { bin } = fakeSpp();
  const r = await fakeRelease('1.1.0');
  const log = quiet();
  const got = await wowbuild.ensure(bin, log, { fetchRelease: async () => r.release, download: r.download });
  assert.equal(got.version, '1.1.0');
  assert.equal(got.dir, path.join(path.dirname(bin), 'Andromeda', '1.1.0'));
  assert.equal(fs.readFileSync(path.join(got.dir, 'mangosd' + EXE), 'utf8'), 'andromeda 1.1.0');
  assert.equal(fs.readFileSync(path.join(bin, 'mangosd' + EXE), 'utf8'), 'spp', 'SPP\'s own program is untouched');
  assert.match(log.lines.join('\n'), /Installed the Andromeda server 1\.1\.0/);
  // Already installed: nothing is downloaded again.
  let downloads = 0;
  await wowbuild.ensure(bin, quiet(), { fetchRelease: async () => r.release, download: async () => downloads++ });
  assert.equal(downloads, 0);
  assert.deepEqual(fs.readdirSync(path.join(path.dirname(bin), 'Andromeda')), ['1.1.0'], 'no temporary folders left behind');
});

test('offline it uses what is installed, and explains when nothing is', async () => {
  const { bin } = fakeSpp();
  const offline = async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); };
  await assert.rejects(wowbuild.ensure(bin, quiet(), { fetchRelease: offline }), /isn't installed and couldn't be downloaded.*SPP original/);
  const r = await fakeRelease('1.1.0');
  await wowbuild.ensure(bin, quiet(), { fetchRelease: async () => r.release, download: r.download });
  const log = quiet();
  assert.equal((await wowbuild.ensure(bin, log, { fetchRelease: offline })).version, '1.1.0');
  assert.match(log.lines.join('\n'), /Couldn't check GitHub/);
});

test('a broken download is not installed; newest versions are kept, older ones removed', async () => {
  const { bin } = fakeSpp();
  const broken = await fakeRelease('2.0.0', { programs: ['mangosd'] });
  const log = quiet();
  await assert.rejects(wowbuild.ensure(bin, log, { fetchRelease: async () => broken.release, download: broken.download }), /isn't installed/);
  assert.match(log.lines.join('\n'), /no mangosd and realmd/);
  for (const v of ['1.0.0', '1.0.1', '1.1.0', '1.2.0']) {
    const r = await fakeRelease(v);
    await wowbuild.ensure(bin, quiet(), { fetchRelease: async () => r.release, download: r.download });
  }
  assert.deepEqual(wowbuild.installed(bin), ['1.2.0', '1.1.0', '1.0.1']);
  assert.equal(wowbuild.compareVersions('1.10.0', '1.9.9') > 0, true, 'numbers, not text');
});

test('WoW setting: "Server program" picks which mangosd and realmd run', async () => {
  const { root, bin } = fakeSpp();
  const server = { id: 'wb', name: 'WoW', game: 'wow', wow: wow.defaults({ name: 'WoW', wow: { root } }) };
  const field = wow.settingsSchema(server).sections.flatMap((s) => s.fields).find((f) => f.key === 'wow.build');
  assert.ok(field, 'offered for SPP installs');
  assert.deepEqual(field.options.map((o) => o.value), ['spp', 'andromeda']);
  assert.equal(wow.readSettings(server)['wow.build'], 'spp', 'SPP original by default');
  assert.equal((await wow.buildLaunch(server)).command, path.join(bin, 'mangosd' + EXE));

  wow.writeSettings(server, { 'wow.build': 'something else' });
  assert.equal(server.wow.build, 'spp', 'unknown values are ignored');
  wow.writeSettings(server, { 'wow.build': 'andromeda' });
  assert.equal(wow.readSettings(server)['wow.build'], 'andromeda');
  await assert.rejects(wow.buildLaunch(server), /not installed yet/);

  const r = await fakeRelease('1.1.0');
  await wowbuild.ensure(bin, quiet(), { fetchRelease: async () => r.release, download: r.download });
  const launch = await wow.buildLaunch(server);
  assert.equal(launch.command, path.join(path.dirname(bin), 'Andromeda', '1.1.0', 'mangosd' + EXE));
  assert.equal(launch.cwd, wow.detect(root).confDir, 'still runs with SPP\'s configs');
  wow.writeSettings(server, { 'wow.build': 'spp' });
  assert.equal((await wow.buildLaunch(server)).command, path.join(bin, 'mangosd' + EXE), 'switching back is instant');
});
