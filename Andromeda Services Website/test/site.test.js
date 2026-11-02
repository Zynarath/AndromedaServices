'use strict';
// The marketing site: pages, path safety, the waitlist and the this-PC-only admin view.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { createSite } = require('../src/server');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-site-'));
let base;
let server;

test.before(async () => {
  server = createSite({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const join = (body, headers = {}) =>
  fetch(`${base}/api/waitlist`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const list = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'waitlist.json'), 'utf8'));

// fetch() cleans up "../" in URLs, so send the raw request line to test path traversal.
function rawGet(p) {
  return new Promise((resolve, reject) => {
    const s = net.connect(server.address().port, '127.0.0.1', () => s.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    let out = '';
    s.on('data', (d) => (out += d));
    s.on('end', () => resolve(Number(out.split(' ')[1])));
    s.on('error', reject);
  });
}

test('serves the pages with security headers', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const html = await res.text();
  assert.match(html, /Join the waitlist/);
  assert.equal((await fetch(`${base}/css/site.css`)).status, 200);
  const missing = await fetch(`${base}/nope`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /drifted out of orbit/);
});

test('never serves files outside public/', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fsrc%2fserver.js', '/%2e%2e%5csrc%5cserver.js', '/css/../../package.json']) {
    assert.equal(await rawGet(p), 404, p);
  }
  assert.equal(await rawGet('/%E0%A4%A'), 400, 'broken escapes');
});

test('every game on the form is one the server accepts', () => {
  const { GAMES } = require('../src/server');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const onForm = [...html.matchAll(/name="games" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(onForm.sort(), Object.keys(GAMES).sort());
});

test('waitlist: validates, cleans up and saves sign-ups, one per email', async () => {
  assert.equal((await join({ email: 'not-an-email' })).status, 400);
  assert.equal((await fetch(`${base}/api/waitlist`, { method: 'POST', body: 'email=a@b.co' })).status, 415, 'JSON only');
  assert.equal((await fetch(`${base}/api/waitlist`)).status, 405);
  assert.equal((await join({ email: 'x@example.com', note: 'x'.repeat(9000) })).status, 413);

  let res = await join({ email: ' Friend@Example.com ', name: 'Buddy\u0000<b>', games: ['rust', 'rust', 'fortnite', 'valheim'], players: '5–10', note: 'Hi' });
  assert.deepEqual(await res.json(), { ok: true, again: false });
  let [e] = list();
  assert.equal(e.email, 'friend@example.com');
  assert.equal(e.name, 'Buddy <b>', 'control characters removed');
  assert.deepEqual(e.games, ['rust', 'valheim'], 'unknown and repeated games dropped');

  res = await join({ email: 'friend@example.com', games: ['minecraft'] });
  assert.deepEqual(await res.json(), { ok: true, again: true });
  assert.equal(list().length, 1, 'same email updates the entry');
  [e] = list();
  assert.deepEqual(e.games, ['minecraft']);
  assert.ok(e.first, 'keeps when they first joined');

  // Bots that fill the hidden field get a fake OK and are not saved.
  assert.equal((await join({ email: 'bot@example.com', website: 'http://spam' })).status, 200);
  assert.ok(!list().some((x) => x.email === 'bot@example.com'));
});

test('waitlist: limits sign-ups from one address', async () => {
  let status = 0;
  for (let i = 0; i < 8 && status !== 429; i++) status = (await join({ email: `p${i}@example.com` })).status;
  assert.equal(status, 429);
});

test('admin: only this PC, not through a proxy or tunnel; HTML and CSV are escaped', async () => {
  const entries = list();
  entries.push({ email: 'evil@example.com', name: '<script>alert(1)</script>', games: [], players: '', note: '=HYPERLINK("http://x")', at: new Date().toISOString() });
  fs.writeFileSync(path.join(dataDir, 'waitlist.json'), JSON.stringify(entries));

  const page = await fetch(`${base}/admin`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(!html.includes('<script>alert'), 'names are escaped');
  assert.match(html, /&lt;script&gt;/);

  const csv = await (await fetch(`${base}/admin/waitlist.csv`)).text();
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/, 'formulas are defused');

  for (const h of ['x-forwarded-for', 'cf-connecting-ip', 'forwarded']) {
    assert.equal((await fetch(`${base}/admin`, { headers: { [h]: '203.0.113.5' } })).status, 404, h);
    assert.equal((await fetch(`${base}/admin/waitlist.csv`, { headers: { [h]: '203.0.113.5' } })).status, 404, h);
  }
});
