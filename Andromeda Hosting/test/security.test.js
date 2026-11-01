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
  ark.writeSettings(s, { 'extra.game': 'bAutoUnlockAllEngrams=True' }, { admin: false });
  assert.equal(s.ark.extraIni.game, '');
  ark.writeSettings(s, { 'extra.game': 'bAutoUnlockAllEngrams=True' }, { admin: true });
  assert.equal(s.ark.extraIni.game, 'bAutoUnlockAllEngrams=True');
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

test('file manager blocks non-admins from writing executables, including Windows name tricks', () => {
  const { blockedForNonAdmin: blocked } = require('../src/util/paths');
  for (const n of ['mangosd.exe', 'evil.dll', 'run.bat', 'x.ps1', 'user_jvm_args.txt', 'payload.sh', 'RUN.BAT']) assert.ok(blocked(n), n);
  // Windows drops trailing dots/spaces and reads "x.exe::$DATA" as x.exe.
  for (const n of ['run.bat.', 'run.bat. . ', 'evil.exe::$DATA', 'evil.dll:stream', 'user_jvm_args.txt.']) assert.ok(blocked(n), n);
  for (const n of ['server.properties', 'config.yml', 'mod.jar', 'Game.ini', 'notes.txt', 'v1.2.']) assert.ok(!blocked(n), n);
});

test('cover pictures: only real images are accepted, and only from known hosts', () => {
  const covers = require('../src/services/covers');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  assert.equal(covers.sniff(png), 'image/png');
  assert.equal(covers.sniff(jpg), 'image/jpeg');
  assert.equal(covers.sniff(Buffer.from('GIF89a......')), 'image/gif');
  assert.equal(covers.sniff(webp), 'image/webp');
  // SVG and HTML can carry scripts, so they are never served back as a cover.
  assert.equal(covers.sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(covers.sniff(Buffer.from('<html><script>alert(1)</script>')), null);

  const s = { id: 'abcd1234', ark: { edition: 'ase' } };
  assert.throws(() => covers.setCustom(s, Buffer.from('<svg/>')), /JPG, PNG/);
  assert.equal(s.cover, undefined);
  covers.setCustom(s, png);
  assert.equal(s.cover.type, 'image/png');
  assert.equal(s.cover.file, 'abcd1234.png');
  assert.equal(covers.info(s).custom, true);
  // A new upload of another type replaces the old file.
  covers.setCustom(s, jpg);
  assert.equal(s.cover.file, 'abcd1234.jpg');
  assert.ok(!fs.existsSync(path.join(process.env.ANDROMEDA_DATA, 'covers', 'abcd1234.png')));
  covers.removeCustom(s);
  assert.equal(s.cover, undefined);
  assert.ok(!fs.existsSync(path.join(process.env.ANDROMEDA_DATA, 'covers', 'abcd1234.jpg')));

  assert.equal(covers.defaultKey({ cod: { title: 't6' } }), 'cod-t6');
  assert.equal(covers.defaultKey({ mc: {} }), 'minecraft');
  for (const k of Object.keys(require('../src/games/cod').TITLES)) assert.ok(covers.DEFAULTS[`cod-${k}`], k);
  assert.ok(covers.allowedImageUrl('https://cdn.cloudflare.steamstatic.com/steam/apps/202970/header.jpg'));
  assert.ok(covers.allowedImageUrl('https://upload.wikimedia.org/wikipedia/en/a/a1/x.jpg'));
  assert.ok(!covers.allowedImageUrl('http://cdn.cloudflare.steamstatic.com/x.jpg'));
  assert.ok(!covers.allowedImageUrl('https://192.168.1.1/x.jpg'));
  assert.ok(!covers.allowedImageUrl('https://evil.example/steamstatic.com.jpg'));
});

test('admins can view the panel as a user: their permissions, read-only, and only while still admin', () => {
  const db = require('../src/db');
  const venya = auth.createUser({ username: 'Venya', password: 'password123', role: 'admin' });
  const korrupted = auth.createUser({ username: 'Korrupted', password: 'password123' });
  const other = auth.createUser({ username: 'OtherAdmin', password: 'password123', role: 'admin' });
  const fakeReq = (token, method = 'GET') => ({ method, ip: '127.0.0.1', headers: { cookie: token ? `hp_session=${token}` : '', 'user-agent': 'test' } });
  const token = auth.createSession(venya, fakeReq());
  const session = db.data.sessions.find((s) => s.id === auth.sha(token));
  const run = (method) => {
    const req = fakeReq(token, method);
    let err = null;
    auth.requireAuth(req, {}, (e) => (err = e || null));
    return { req, err };
  };

  assert.equal(auth.viewableUser(korrupted.id, venya), korrupted);
  assert.equal(auth.viewableUser(other.id, venya), null, 'not other admins');
  assert.equal(auth.viewableUser(venya.id, venya), null, 'not yourself');

  session.viewAs = korrupted.id;
  let r = run('GET');
  assert.equal(r.err, null);
  assert.equal(r.req.user, korrupted, 'requests run as Korrupted');
  assert.equal(r.req.realUser, venya);
  assert.ok(!auth.can(r.req.user, { access: {} }, 'view'), "so Venya only sees Korrupted's servers");
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    r = run(m);
    assert.equal(r.err && r.err.status, 403, `${m} is refused while viewing`);
    assert.match(r.err.message, /viewing the panel as Korrupted/);
  }

  // Disabled user, or Venya no longer an admin: back to normal.
  korrupted.disabled = true;
  assert.equal(run('GET').req.user, venya);
  assert.equal(session.viewAs, undefined);
  korrupted.disabled = false;
  session.viewAs = korrupted.id;
  venya.role = 'user';
  r = run('POST');
  assert.equal(r.req.user, venya);
  assert.equal(r.err, null);
  assert.equal(session.viewAs, undefined);
});

test('plain HTTP from the internet is flagged; tunnels, LAN and Tailscale are not', () => {
  const { unencryptedFromInternet } = require('../src/util/netaccess');
  const req = (ip, secure = false, headers = {}) => ({ secure, headers, socket: { remoteAddress: ip } });
  assert.equal(unencryptedFromInternet(req('203.0.113.9')), true, 'port-forwarded http');
  assert.equal(unencryptedFromInternet(req('203.0.113.9', true)), false, 'https');
  assert.equal(unencryptedFromInternet(req('127.0.0.1', true, { 'cf-ray': 'x', 'x-forwarded-proto': 'https' })), false, 'Cloudflare Tunnel');
  assert.equal(unencryptedFromInternet(req('127.0.0.1', false, { 'cf-ray': 'x', 'x-forwarded-proto': 'http' })), true, 'a proxy serving plain http');
  assert.equal(unencryptedFromInternet(req('192.168.1.20')), false, 'home network');
  assert.equal(unencryptedFromInternet(req('100.101.102.103')), false, 'Tailscale');
  assert.equal(unencryptedFromInternet(req('::ffff:127.0.0.1')), false, 'this PC');
});

test("account security: 2FA can't be replaced from a session, and password checks are rate-limited", async () => {
  const express = require('express');
  const db = require('../src/db');
  auth.createUser({ username: 'Sam', password: 'correct-horse', role: 'user' });
  const app = express();
  app.use('/api', express.json(), auth.csrfGuard, require('../src/routes/auth'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'AndromedaHosting', cookie }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await call('POST', '/auth/login', { username: 'Sam', password: 'correct-horse' })).status, 200);
    // Turn 2FA on.
    const { secret } = (await call('POST', '/account/2fa/setup')).body;
    const code = auth.totp.hotp(secret, Math.floor(Date.now() / 30000));
    assert.equal((await call('POST', '/account/2fa/enable', { code })).status, 200);
    // A session alone can't swap the authenticator.
    const again = await call('POST', '/account/2fa/setup');
    assert.equal(again.status, 400);
    assert.match(again.body.error, /already on/);
    assert.equal(db.data.users.find((u) => u.username === 'Sam').totpSecret, secret);
    // Guessing the current password through "turn off 2FA" is limited like sign-in.
    let last;
    for (let i = 0; i < 9; i++) last = await call('POST', '/account/2fa/disable', { password: `guess-${i}` });
    assert.equal(last.status, 429);
    const right = await call('POST', '/account/2fa/disable', { password: 'correct-horse' });
    assert.equal(right.status, 429, 'still locked out for a while, even with the right password');
  } finally {
    srv.close();
  }
});
