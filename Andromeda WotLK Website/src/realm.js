'use strict';
// Realm facts shown on several pages (front page box, realm status), cached for a few seconds.
const net = require('net');
const data = require('./data');
const { REALM_TYPES, REALM_ZONES } = require('./gamedata');

function portOpen(host, port, timeout = 1200) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

let cache = { at: 0, value: null };

async function info() {
  if (cache.value && Date.now() - cache.at < 15000) return cache.value;
  const realmId = Number(data.worldConf('RealmID')) || 1;
  const out = { name: null, address: null, port: null, online: false, type: null, language: null, players: 0, bots: 0, accounts: null, activeAccounts: null, characters: null, uptime: null, dbOnline: true };
  try {
    const realm = (await data.q('login', 'SELECT * FROM realmlist WHERE id = ?', [realmId]))[0];
    if (realm) {
      Object.assign(out, { name: realm.name, address: realm.address, port: realm.port, type: REALM_TYPES[realm.icon] || 'Normal', language: REALM_ZONES[realm.timezone] || null });
      out.online = await portOpen('127.0.0.1', realm.port);
    }
    const prefix = data.botPrefix() + '%';
    const acc = data.t('login', 'account');
    const [counts] = await data.q('chars', `SELECT SUM(c.online = 1 AND a.username NOT LIKE ?) AS players, SUM(c.online = 1 AND a.username LIKE ?) AS bots, COUNT(*) AS characters FROM characters c LEFT JOIN ${acc} a ON a.id = c.account`, [prefix, prefix]);
    out.players = Number(counts.players) || 0;
    out.bots = Number(counts.bots) || 0;
    out.characters = Number(counts.characters) || 0;
    out.accounts = Number((await data.q('login', 'SELECT COUNT(*) AS n FROM account WHERE username NOT LIKE ?', [prefix]))[0].n);
    const cols = await data.columns('login', 'account');
    if (cols.has('last_login')) {
      out.activeAccounts = Number((await data.q('login', 'SELECT COUNT(*) AS n FROM account WHERE username NOT LIKE ? AND last_login > NOW() - INTERVAL 14 DAY', [prefix]))[0].n);
    }
    if (out.online) {
      try {
        const up = (await data.q('login', 'SELECT starttime FROM uptime WHERE realmid = ? ORDER BY starttime DESC LIMIT 1', [realmId]))[0];
        if (up) out.uptime = Math.max(0, Math.floor(Date.now() / 1000) - Number(up.starttime));
      } catch {}
    }
  } catch (err) {
    if (!(err instanceof data.OfflineError)) throw err;
    out.dbOnline = false;
  }
  cache = { at: Date.now(), value: out };
  return out;
}

// SPP's site: up to 200 online is low, 700 medium, 1000 high, more is full.
function population(n) {
  if (n <= 200) return ['Low', 'green'];
  if (n <= 700) return ['Medium', 'orange'];
  if (n <= 1000) return ['High', 'red'];
  return ['Full', 'red'];
}

module.exports = { info, population, portOpen, clearCache: () => (cache = { at: 0, value: null }) };
