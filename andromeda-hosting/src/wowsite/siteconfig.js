'use strict';
// What the WotLK website runs with, in data/wowsite.json. The panel writes it from the WoW server's
// Settings → Website section (and on every start); the website process only reads it.
const fs = require('fs');
const path = require('path');
const config = require('../config');

const FILE = path.join(config.dataDir, 'wowsite.json');
const DEFAULT_PORT = 8091;
const REGISTRATION = ['off', 'invite', 'open'];

function siteOf(server) {
  const s = (server.wow && server.wow.site) || {};
  return {
    enabled: s.enabled !== false,
    port: Number(s.port) || DEFAULT_PORT,
    registration: REGISTRATION.includes(s.registration) ? s.registration : 'off',
    discord: /^https:\/\/(discord\.gg|discord\.com)\/[\w/-]+$/i.test(s.discord || '') ? s.discord : '',
  };
}

// The first WoW server with its website turned on (one website per panel).
function fromServers(servers) {
  const server = (servers || []).find((s) => s.game === 'wow' && s.wow && siteOf(s).enabled);
  if (!server) return null;
  const s = siteOf(server);
  return {
    serverId: server.id,
    root: server.wow.root,
    realmName: server.wow.realmName || server.name,
    port: s.port,
    host: config.host,
    registration: s.registration,
    discord: s.discord,
    trustProxy: !!config.trustProxy,
  };
}

function write(servers) {
  const text = JSON.stringify(fromServers(servers) || { disabled: true }, null, 2);
  try {
    if (fs.existsSync(FILE) && fs.readFileSync(FILE, 'utf8') === text) return;
    fs.writeFileSync(FILE + '.tmp', text);
    fs.renameSync(FILE + '.tmp', FILE);
  } catch {}
}

function read() {
  try {
    const c = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return c && !c.disabled ? c : null;
  } catch {
    return null;
  }
}

module.exports = { FILE, DEFAULT_PORT, REGISTRATION, siteOf, fromServers, write, read };
