'use strict';
// Entry point of the WotLK website (started by Andromeda Services).
// A standalone site, separate from the Andromeda Hosting panel. It follows its settings in
// data/wowsite.json (edited from Andromeda Services) and applies changes without a restart.
process.env.ANDROMEDA_LOG_FILE = process.env.ANDROMEDA_LOG_FILE || 'wowsite.log';
require('../checkDeps');
const fs = require('fs');
const http = require('http');
const readline = require('readline');
const siteconfig = require('./siteconfig');
const data = require('./data');
const logger = require('../util/log');
const { buildApp } = require('./app');
const assets = require('./assets');

const log = logger('wowsite');
let cfg = null;
let server = null;
let listening = '';


function listen() {
  const want = cfg ? `${cfg.host}:${cfg.port}` : '';
  if (want === listening) return;
  const old = server;
  server = null;
  listening = '';
  if (old) old.close();
  if (!cfg) return;
  const s = http.createServer(buildApp(() => cfg));
  s.on('error', (err) => {
    log.error(`Could not open port ${cfg.port}: ${err.message}. Change the website port in Andromeda Hosting (WoW server → Settings → Website).`);
    listening = '';
  });
  s.listen(cfg.port, cfg.host, () => {
    log.info(`WotLK website "${cfg.title}" is running at http://localhost:${cfg.port}`);
    log.info(`Sign-up: ${{ off: 'off (only accounts made in the panel or game)', invite: 'invite codes', open: 'open to anyone' }[cfg.registration] || 'off'}`);
  });
  server = s;
  listening = want;
}

function apply() {
  const next = siteconfig.read();
  if (JSON.stringify(next) === JSON.stringify(cfg)) return;
  if (!next) log.warn(`The SPP folder isn't set yet. Set it in Andromeda Services (WotLK website → Settings), or in ${siteconfig.FILE}; the site starts by itself.`);
  cfg = next;
  if (cfg) data.setRoot(cfg.root);
  listen();
  if (cfg) {
    const found = assets.dir(cfg, data.paths().root || cfg.root);
    if (found) log.info(`Website graphics: ${found}`);
    else assets.download(log);
  }
}

apply();
fs.watchFile(siteconfig.FILE, { interval: 2000 }, () => apply());

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  log.info('Stopping the WotLK website.');
  fs.unwatchFile(siteconfig.FILE);
  data.reset();
  if (server) server.close();
  setTimeout(() => process.exit(code), 300);
}

// Andromeda Services asks for a clean stop by writing "stop" to stdin.
if (!process.stdin.isTTY) {
  readline.createInterface({ input: process.stdin }).on('line', (l) => {
    if (l.trim().toLowerCase() === 'stop') stop(0);
  });
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => stop(0));
process.on('uncaughtException', (err) => log.error(err));
process.on('unhandledRejection', (err) => log.error(err instanceof Error ? err : new Error(String(err))));
