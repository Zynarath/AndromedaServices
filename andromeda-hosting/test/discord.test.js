'use strict';
// Discord notifications against a mock Discord REST API.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const EventEmitter = require('events');

process.env.ANDROMEDA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'andromeda-discord-'));

const channels = [
  { id: '100', type: 4, name: 'Game Stuff', position: 0 },
  { id: '200', type: 0, name: '📢server-updates', parent_id: '100', position: 1 },
];
const messages = [];
let rateLimitOnce = true;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, json) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (req.headers.authorization !== 'Bot good') return send(401, { message: '401: Unauthorized' });
    const u = req.url;
    if (u === '/users/@me') return send(200, { id: '999', username: 'Andromeda Hosting' });
    if (u === '/oauth2/applications/@me') return send(200, { id: '999' });
    if (u === '/users/@me/guilds') return send(200, [{ id: '1', name: 'The Final Hour' }]);
    if (u === '/guilds/1/channels' && req.method === 'GET') return send(200, channels);
    if (u === '/guilds/1/channels' && req.method === 'POST') {
      const c = { id: String(300 + channels.length), ...JSON.parse(body), position: channels.length };
      channels.push(c);
      return send(201, c);
    }
    let m = /^\/channels\/(\d+)$/.exec(u);
    if (m) {
      const c = channels.find((x) => x.id === m[1]);
      if (!c) return send(404, { message: 'Unknown Channel' });
      if (req.method === 'PATCH') Object.assign(c, JSON.parse(body));
      return send(200, c);
    }
    m = /^\/channels\/(\d+)\/messages$/.exec(u);
    if (m && req.method === 'POST') {
      if (rateLimitOnce) {
        rateLimitOnce = false;
        return send(429, { retry_after: 0.05 });
      }
      messages.push({ channel: m[1], ...JSON.parse(body) });
      return send(200, { id: 'm' + messages.length });
    }
    send(404, { message: 'nope' });
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('channel names follow Discord rules', () => {
  const { channelName } = require('../src/services/discord');
  assert.equal(channelName('Ark SE Server 1'), 'ark-se-server-1');
  assert.equal(channelName('All the Mods 10 - ATM10'), 'all-the-mods-10-atm10');
  assert.equal(channelName('  !!  '), 'game-server');
});

test('setup overview, per-server channels and event messages', async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.ANDROMEDA_DISCORD_API = `http://127.0.0.1:${mock.address().port}`;
  const db = require('../src/db');
  const discord = require('../src/services/discord');

  db.data.settings.discord = { token: 'good' };
  const o = await discord.overview();
  assert.equal(o.bot.name, 'Andromeda Hosting');
  assert.match(o.bot.inviteUrl, /client_id=999.*permissions=19472/);
  assert.equal(o.guildId, '1');
  assert.equal(o.suggestedUpdatesChannelId, '200');

  Object.assign(db.data.settings.discord, { enabled: true, guildId: '1', updatesChannelId: '200', playerEvents: true });
  db.data.settings.publicAddress = 'play.example.com';

  const server = {
    id: 's1', name: 'Ark SE Server 1', game: 'ark', autoRestart: true,
    ark: { edition: 'ase', map: 'TheIsland', port: 7777, mods: ['1'], settings: { ServerPassword: 'rex-1234' } },
  };
  const manager = new EventEmitter();
  manager.instances = new Map([['s1', { server, status: 'stopped' }]]);
  discord.init(manager);

  manager.emit('status', 's1', 'starting');
  manager.emit('status', 's1', 'running');
  await wait(400);
  const created = channels.find((c) => c.name === 'ark-se-server-1');
  assert.ok(created, 'per-server channel created');
  assert.equal(created.parent_id, '100', 'placed in the same category as Server Updates');
  const online = messages.filter((m) => m.embeds[0].title.includes('is online'));
  assert.deepEqual(online.map((m) => m.channel).sort(), ['200', created.id].sort());
  const fields = online[0].embeds[0].fields;
  assert.ok(fields.some((f) => f.value === '`play.example.com:7777`'));
  assert.ok(fields.some((f) => f.name === 'Password' && !f.value.includes('rex-1234')), 'password hidden unless enabled');

  // Player joins go to the server channel only; the first sample is just a baseline.
  manager.emit('players', 's1', { online: 1, max: 20, players: ['Zyn'] });
  manager.emit('players', 's1', { online: 2, max: 20, players: ['Zyn', 'Buddy'] });
  await wait(200);
  const join = messages.filter((m) => /Buddy/.test(m.embeds[0].description || ''));
  assert.equal(join.length, 1);
  assert.equal(join[0].channel, created.id);

  manager.emit('status', 's1', 'crashed');
  manager.emit('job', 's1', { id: 'j1', type: 'update', label: 'Game update', status: 'done' });
  await wait(300);
  assert.ok(messages.some((m) => m.channel === '200' && /crashed/.test(m.embeds[0].title)));
  assert.ok(messages.some((m) => m.channel === '200' && /Game update finished/.test(m.embeds[0].title)));

  // Rename -> channel renamed, not duplicated.
  server.name = 'Ark SE Ragnarok';
  manager.emit('renamed', 's1');
  await wait(200);
  assert.equal(channels.find((c) => c.id === created.id).name, 'ark-se-ragnarok');
  assert.equal(channels.filter((c) => c.type === 0).length, 2);

  // Bad token surfaces a readable error instead of throwing.
  db.data.settings.discord.token = 'bad';
  await discord.post(server, { title: 'x', where: 'updates' });
  assert.match(discord.publicSettings().lastError, /token is invalid/);
  mock.close();
});
