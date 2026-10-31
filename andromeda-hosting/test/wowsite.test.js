'use strict';
// The WotLK website: password hashing, HTML safety, its settings file, and the web server itself
// (with the realm's database offline, which needs no MySQL).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-site-'));
process.env.ANDROMEDA_DATA = path.join(tmp, 'data');

const srp6 = require('../src/wowsite/srp6');
const { html, raw, sanitize, textToHtml } = require('../src/wowsite/html');
const siteconfig = require('../src/wowsite/siteconfig');
const wow = require('../src/games/wow');
const data = require('../src/wowsite/data');
const { buildApp } = require('../src/wowsite/app');

// A fake SPP install whose database is "offline" (nothing listens on port 1).
function fakeSpp() {
  const root = path.join(tmp, 'SPP_Classics_V2');
  const bin = path.join(root, 'Server', 'Binaries', 'wotlk', 'Bin64');
  const conf = path.join(root, 'Settings', 'wotlk');
  const dataDir = path.join(root, 'Server', 'Data', 'wotlk');
  const site = path.join(root, 'Server', 'website');
  for (const d of [bin, conf, path.join(dataDir, 'dbc'), path.join(dataDir, 'maps'), path.join(site, 'templates', 'WotLK', 'css'), path.join(site, 'config')]) fs.mkdirSync(d, { recursive: true });
  const exe = process.platform === 'win32' ? '.exe' : '';
  for (const f of ['mangosd', 'realmd']) fs.writeFileSync(path.join(bin, f + exe), '');
  fs.writeFileSync(path.join(conf, 'mangosd.conf'), [
    'RealmID = 1',
    'DataDir = "../../Server/Data/wotlk"',
    'LoginDatabaseInfo = "127.0.0.1;1;root;123456;wotlkrealmd"',
    'WorldDatabaseInfo = "127.0.0.1;1;root;123456;wotlkmangos"',
    'CharacterDatabaseInfo = "127.0.0.1;1;root;123456;wotlkcharacters"',
    'WorldServerPort = 8085',
  ].join('\n'));
  fs.writeFileSync(path.join(conf, 'realmd.conf'), 'RealmServerPort = 3724\n');
  fs.writeFileSync(path.join(conf, 'aiplayerbot.conf'), 'AiPlayerbot.RandomBotAccountPrefix = "rndbot"\n');
  fs.writeFileSync(path.join(site, 'templates', 'WotLK', 'css', 'newhp.css'), 'body { color: red }');
  fs.writeFileSync(path.join(site, 'templates', 'WotLK', 'evil.php'), '<?php echo "x";');
  fs.writeFileSync(path.join(site, 'config', 'config.xml'), '<secret/>');
  return root;
}

test('SRP6: same salt/verifier as SPP\'s PHP website (calculateSRP6Verifier)', () => {
  // Made with SPP's own getRegistrationData("FRIEND", "Hunter2!") in PHP.
  const s = '97394283164143B3DEBA6F54AE97030AC4CEF25BDB902E044BC40FAA98AF3625';
  const v = '57EAEFB381928B14757907E16613D6F3EE022A27DE450B2A5314BBF2834B53F5';
  assert.ok(srp6.check('FRIEND', 'Hunter2!', s, v));
  assert.ok(srp6.check('friend', 'hunter2!', s, v), 'WoW 3.3.5a passwords are not case-sensitive');
  assert.ok(!srp6.check('FRIEND', 'Hunter3!', s, v));
  assert.ok(!srp6.check('FRIEND', 'Hunter2!', 'zz', v), 'bad hex is rejected, not thrown');
  const made = srp6.makeVerifier('NEWBIE', 'pass1');
  assert.match(made.s, /^[0-9A-F]{64}$/);
  assert.match(made.v, /^[0-9A-F]{64}$/);
  assert.ok(srp6.check('NEWBIE', 'pass1', made.s, made.v));
  assert.notEqual(srp6.makeVerifier('NEWBIE', 'pass1').s, made.s, 'a new random salt every time');
});

test('html: values are escaped unless built by the code itself', () => {
  const name = '<script>alert(1)</script>';
  assert.equal(String(html`<b>${name}</b>`), '<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>');
  assert.equal(String(html`<a title="${'" onmouseover="x'}">`), '<a title="&quot; onmouseover=&quot;x">');
  assert.equal(String(html`${raw('<i>ok</i>')}${[1, '<', null, false]}`), '<i>ok</i>1&lt;');
});

test('html: old news HTML keeps simple formatting and loses everything dangerous', () => {
  const out = sanitize('<b>Bold</b><img src=x onerror=alert(1)><a href="javascript:alert(2)">bad</a><a href="https://example.com" onclick="x()">good</a><script>alert(3)</script><iframe src=//evil></iframe><p style="color:red">p</p><A HREF="data:text/html,x">d</A><img src="//evil/x.png">');
  assert.ok(!/script|onerror|onclick|javascript:|iframe|style=|data:|\/\/evil/i.test(out), out);
  assert.match(out, /<b>Bold<\/b>/);
  assert.match(out, /<a href="https:\/\/example.com" rel="noopener noreferrer nofollow">good<\/a>/);
  assert.match(out, /<img src="x" alt="">/);
  assert.match(out, /<p>p<\/p>/);
  assert.equal(sanitize('a < b > c'), 'a &lt; b &gt; c');
  assert.equal(textToHtml('Hi <b>\n\nSee https://example.com/x?a=1&b=2'), '<p>Hi &lt;b&gt;</p><p>See <a href="https://example.com/x?a=1&amp;b=2">https://example.com/x?a=1&amp;b=2</a></p>');
});

test('website settings: its own file, with defaults and invalid values dropped', () => {
  assert.equal(siteconfig.normalize({}), null, 'nothing runs until the SPP folder is set');
  const c = siteconfig.normalize({ root: ' C:/Games/SPP_Classics_V2 ', port: 'x', registration: 'everyone', discord: 'javascript:alert(1)', title: '' });
  assert.equal(c.root, 'C:/Games/SPP_Classics_V2');
  assert.equal(c.port, 8091);
  assert.equal(c.host, '0.0.0.0');
  assert.equal(c.registration, 'off', 'sign-up is off unless turned on');
  assert.equal(c.discord, '', 'only discord.gg / discord.com links');
  assert.equal(c.title, 'World of Warcraft');
  assert.equal(c.trustProxy, false);
  // Files written by older versions (by the panel) keep working.
  assert.equal(siteconfig.normalize({ root: '/spp', realmName: 'Andromeda', port: 9000, registration: 'invite' }).title, 'Andromeda');
  fs.mkdirSync(path.dirname(siteconfig.FILE), { recursive: true });
  fs.writeFileSync(siteconfig.FILE, JSON.stringify({ root: '/spp', port: 9100, registration: 'invite', discord: 'https://discord.gg/abc123' }));
  assert.deepEqual(siteconfig.read(), { root: '/spp', title: 'World of Warcraft', port: 9100, host: '0.0.0.0', registration: 'invite', discord: 'https://discord.gg/abc123', trustProxy: false, websiteDir: undefined });
});

test('the panel knows nothing about the website', () => {
  const root = fakeSpp();
  const server = { id: 'w9', name: 'WoW', game: 'wow', wow: wow.defaults({ name: 'WoW', wow: { root } }) };
  assert.ok(!wow.settingsSchema(server).sections.some((x) => x.title === 'Website'));
  assert.deepEqual(wow.ports(server).map((p) => p.port), [3724, 8085]);
});

function request(port, method, url, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) } }, (res) => {
      let text = '';
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('website: pages, assets and forms with the realm database offline', async () => {
  const root = fakeSpp();
  data.setRoot(root);
  const cfg = siteconfig.normalize({ root, title: 'Andromeda', registration: 'invite' });
  const server = http.createServer(buildApp(() => cfg));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const home = await request(port, 'GET', '/');
    assert.equal(home.status, 200, 'the front page still shows when the database is down');
    assert.match(home.text, /The realm database is offline/);
    assert.match(home.headers['content-security-policy'], /script-src 'self'/);
    const cookie = home.headers['set-cookie'][0].split(';')[0];
    assert.match(home.headers['set-cookie'][0], /HttpOnly; SameSite=Lax/);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(home.text)[1];

    const online = await request(port, 'GET', '/server/online');
    assert.equal(online.status, 503);
    assert.match(online.text, /database isn&#39;t running/);

    assert.equal((await request(port, 'GET', '/templates/WotLK/css/newhp.css')).status, 200);
    assert.equal((await request(port, 'GET', '/templates/WotLK/evil.php')).status, 404, 'no PHP or other non-asset files');
    assert.equal((await request(port, 'GET', '/templates/../config/config.xml')).status, 404);
    assert.equal((await request(port, 'GET', '/templates/%2e%2e/config/config.xml')).status, 404);

    const noToken = await request(port, 'POST', '/account/login', { body: 'login=ADMIN&pass=x', cookie });
    assert.equal(noToken.status, 403, 'forms need the CSRF token');
    const withToken = await request(port, 'POST', '/account/login', { body: `_csrf=${encodeURIComponent(csrf)}&login=ADMIN&pass=x`, cookie });
    assert.equal(withToken.status, 503, 'the token is accepted; then the offline database is reported');
    assert.equal((await request(port, 'GET', '/admin')).status, 303, 'admin page needs a login');
    assert.equal((await request(port, 'GET', '/index.php?n=server&sub=playersonline')).headers.location, '/server/online');
    assert.equal((await request(port, 'GET', '/armory/character/%3Cscript%3E')).status, 404);
  } finally {
    server.close();
    data.reset();
  }
});
