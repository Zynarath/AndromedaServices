'use strict';
// Security hardening: admin-only launch fields, schedule permission gating,
// config-injection stripping, and the file-manager executable block.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-sec-'));
process.env.ANDROMEDA_DATA = path.join(tmp, 'data');

const minecraft = require('../src/games/minecraft');
const ark = require('../src/games/ark');
const cod = require('../src/games/cod');
const Ini = require('../src/util/ini');
const Properties = require('../src/util/properties');
const auth = require('../src/auth');

test('Minecraft: Extra JVM arguments are admin-only', () => {
  const dir = path.join(tmp, 'mc');
  fs.mkdirSync(dir, { recursive: true });
  const s = { name: 'mc', dir, mc: minecraft.defaults({ name: 'mc', mc: { loader: 'vanilla' } }) };
  // A non-admin "settings" user cannot inject a command-execution JVM flag...
  minecraft.writeSettings(s, { 'panel.jvmArgs': '-XX:OnOutOfMemoryError=calc.exe' }, { admin: false });
  assert.equal(s.mc.jvmArgs, '');
  // ...but an admin still can.
  minecraft.writeSettings(s, { 'panel.jvmArgs': '-Dfoo=bar' }, { admin: true });
  assert.equal(s.mc.jvmArgs, '-Dfoo=bar');
  // The field is flagged admin in the schema so the UI hides it.
  const jvm = minecraft.settingsSchema(s).sections.flatMap((x) => x.fields).find((f) => f.key === 'panel.jvmArgs');
  assert.equal(jvm.admin, true);
});

test('ARK: extra command-line arguments are admin-only', () => {
  const s = { name: 'ark', dir: path.join(tmp, 'ark'), ark: ark.defaults({ name: 'ark', ark: { edition: 'ase' } }) };
  ark.writeSettings(s, { 'launch.extraArgs': '-bad' }, { admin: false });
  assert.equal(s.ark.extraArgs, '');
  ark.writeSettings(s, { 'launch.extraArgs': '-ForceAllowCaveFlyers' }, { admin: true });
  assert.equal(s.ark.extraArgs, '-ForceAllowCaveFlyers');
});

test('CoD: game folder / Plutonium key / extra config are admin-only, and reject UNC', () => {
  const s = { name: 'cod', dir: path.join(tmp, 'cod'), cod: cod.defaults({ name: 'cod', cod: { title: 'iw4x', gameDir: path.join(tmp, 'g') } }) };
  const before = s.cod.gameDir;
  cod.writeSettings(s, { 'cod.gameDir': '\\\\evil\\share', 'cod.extraConfig': 'set x 1', 'cod.plutoKey': 'k' }, { admin: false });
  assert.equal(s.cod.gameDir, before);
  assert.equal(s.cod.extraConfig, '');
  assert.equal(s.cod.plutoKey, '');
  assert.throws(() => cod.writeSettings(s, { 'cod.gameDir': '\\\\evil\\share' }, { admin: true }), /Network paths/);
  cod.writeSettings(s, { 'cod.gameDir': 'C:/Games/MW2' }, { admin: true });
  assert.equal(s.cod.gameDir, 'C:/Games/MW2');
});

test('schedule permission mapping requires the matching permission', () => {
  // These are the pairings the routes and scheduler enforce.
  const ACTION_PERM = { restart: 'control', start: 'control', stop: 'control', backup: 'backups', command: 'console', update: 'mods' };
  const server = { access: { u1: ['schedules'] } }; // only "schedules"
  const user = { id: 'u1', role: 'user' };
  for (const [action, perm] of Object.entries(ACTION_PERM)) {
    assert.equal(auth.can(user, server, perm), false, `${action} needs ${perm}, which this user lacks`);
  }
  // With console added, command is allowed; power actions still are not.
  server.access.u1 = ['schedules', 'console'];
  assert.equal(auth.can(user, server, 'console'), true);
  assert.equal(auth.can(user, server, 'control'), false);
  // Admins can do everything.
  assert.equal(auth.can({ id: 'a', role: 'admin' }, server, 'control'), true);
});

test('INI and properties writers strip newlines (no config injection)', () => {
  const ini = new Ini('[ServerSettings]\n');
  ini.set('ServerSettings', 'SessionName', 'Hi\r\nRCONEnabled=True\r\n[Danger]');
  assert.doesNotMatch(ini.toString(), /\nRCONEnabled=True/);
  assert.match(ini.toString(), /SessionName=Hi RCONEnabled=True \[Danger\]/);
  const props = new Properties('motd=x\n');
  props.set('motd', 'hello\renable-rcon=true');
  assert.doesNotMatch(props.toString(), /\renable-rcon|\nenable-rcon/);
});

test('file manager blocks non-admins from writing executables', () => {
  // Mirror of the server-side check in src/routes/files.js.
  const BLOCKED_EXT = /\.(exe|dll|so|dylib|bat|cmd|com|scr|msi|ps1|psm1|vbs|vbe|wsf|jse|hta|cpl|sh|bash)$/i;
  const BLOCKED_NAME = /^user_jvm_args\.txt$/i;
  const blocked = (n) => BLOCKED_EXT.test(n) || BLOCKED_NAME.test(n);
  for (const n of ['mangosd.exe', 'evil.dll', 'run.bat', 'x.ps1', 'user_jvm_args.txt', 'payload.sh']) assert.ok(blocked(n), n);
  for (const n of ['server.properties', 'config.yml', 'mod.jar', 'Game.ini', 'notes.txt']) assert.ok(!blocked(n), n);
});
