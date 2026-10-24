'use strict';
// Dynamic DNS against a mock Cloudflare API, and first-admin setup behind a tunnel.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.ANDROMEDA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-domain-'));

const records = []; // the mock zone's DNS records
let currentIp = '203.0.113.7';
const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (result, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: code < 300, result, errors: code < 300 ? [] : [{ message: 'denied' }] }));
    };
    if (url.pathname === '/ip') return res.end(currentIp);
    if (req.headers.authorization !== 'Bearer good-token') return send(null, 403);
    if (url.pathname === '/cf/zones') return send(url.searchParams.get('name') === 'example.com' ? [{ id: 'z1', name: 'example.com' }] : []);
    if (url.pathname === '/cf/zones/z1/dns_records' && req.method === 'GET') return send(records.filter((r) => r.name === url.searchParams.get('name')));
    if (url.pathname === '/cf/zones/z1/dns_records' && req.method === 'POST') {
      const r = { id: 'r' + (records.length + 1), ...JSON.parse(body) };
      records.push(r);
      return send(r);
    }
    const m = /^\/cf\/zones\/z1\/dns_records\/(\w+)$/.exec(url.pathname);
    if (m && req.method === 'PATCH') {
      const r = records.find((x) => x.id === m[1]);
      Object.assign(r, JSON.parse(body));
      return send(r);
    }
    send(null, 404);
  });
});

test('dynamic DNS creates, keeps and updates the game hostname', async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  process.env.ANDROMEDA_CF_API = base + '/cf';
  process.env.ANDROMEDA_IP_URL = base + '/ip';
  const db = require('../src/db');
  const ddns = require('../src/services/ddns');

  assert.deepEqual(ddns.cleanHostnames('Play.Example.com., mc2.example.com'), ['play.example.com', 'mc2.example.com']);
  assert.throws(() => ddns.cleanHostnames('not a host'));

  db.data.settings.ddns = { enabled: true, token: 'good-token', hostnames: ['play.example.com'] };
  let s = await ddns.runOnce({ force: true });
  assert.equal(s.error, null);
  assert.equal(s.records[0].result, 'created');
  assert.equal(records[0].content, '203.0.113.7');
  assert.equal(records[0].proxied, false);

  s = await ddns.runOnce({ force: true });
  assert.equal(s.records[0].result, 'unchanged');

  currentIp = '198.51.100.20';
  records[0].proxied = true; // someone turned on the orange cloud by mistake
  s = await ddns.runOnce();
  assert.equal(s.records[0].result, 'updated');
  assert.equal(records[0].content, '198.51.100.20');
  assert.equal(records[0].proxied, false);

  db.data.settings.ddns.hostnames = ['play.otherdomain.com'];
  ddns.reset();
  s = await ddns.runOnce({ force: true });
  assert.match(s.error, /No Cloudflare zone/);

  db.data.settings.ddns = { enabled: true, token: 'bad', hostnames: ['play.example.com'] };
  ddns.reset();
  s = await ddns.runOnce({ force: true });
  assert.match(s.error, /Cloudflare: denied/);
  mock.close();
});

test('first-admin setup is refused for requests relayed by a tunnel', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', require('../src/routes/auth'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}/api/auth/state`;
  const direct = await (await fetch(url)).json();
  assert.equal(direct.setupAllowedHere, true);
  const tunneled = await (await fetch(url, { headers: { 'CF-Connecting-IP': '198.51.100.9', 'X-Forwarded-For': '198.51.100.9' } })).json();
  assert.equal(tunneled.setupAllowedHere, false);
  const r = await fetch(url.replace('state', 'setup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.9' },
    body: JSON.stringify({ username: 'attacker', password: 'password123' }),
  });
  assert.equal(r.status, 403);
  srv.close();
});
