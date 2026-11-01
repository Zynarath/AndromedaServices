'use strict';
// The WotLK website's own settings, in its data/wowsite.json. The website is separate from the
// Andromeda Hosting panel: Andromeda Services edits this file (WotLK website → Settings), and the
// running site picks changes up by itself. It can also be edited by hand.
//
//   root          the SPP Classics folder (SPP_Classics_V2), or any cMaNGOS WotLK folder
//   title         the site's name (browser tab, header, footer)
//   port / host   where the site listens (default 8091 on all addresses)
//   registration  who can create game accounts: "off" (default), "invite" or "open"
//   discord       optional Discord invite link for the Community menu
//   trustProxy    true only behind a reverse proxy on another machine (a Cloudflare Tunnel on this
//                 PC is already trusted)
const fs = require('fs');
const path = require('path');
const config = require('./config');

const FILE = path.join(config.dataDir, 'wowsite.json');
const DEFAULT_PORT = 8091;
const REGISTRATION = ['off', 'invite', 'open'];
const DISCORD_RE = /^https:\/\/(discord\.gg|discord\.com)\/[\w/-]+$/i;

// Fills in defaults and drops anything invalid. Returns null when no SPP folder is set yet.
function normalize(c) {
  if (!c || typeof c !== 'object' || !String(c.root || '').trim()) return null;
  const port = Number(c.port);
  return {
    root: String(c.root).trim(),
    title: String(c.title || c.realmName || 'World of Warcraft').trim().slice(0, 48) || 'World of Warcraft',
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT,
    host: typeof c.host === 'string' && c.host.trim() ? c.host.trim() : '0.0.0.0',
    registration: REGISTRATION.includes(c.registration) ? c.registration : 'off',
    discord: DISCORD_RE.test(c.discord || '') ? c.discord : '',
    trustProxy: c.trustProxy === true,
    websiteDir: typeof c.websiteDir === 'string' && c.websiteDir ? c.websiteDir : undefined,
  };
}

// Before the website had its own folder it kept its settings and downloaded graphics in Andromeda
// Hosting's data folder. Copy them over once, so an existing site keeps working after the move.
function migrateFromPanel() {
  if (fs.existsSync(FILE)) return;
  for (const panel of ['Andromeda Hosting', 'andromeda-hosting'].map((d) => path.join(config.root, '..', d))) {
    let dataDir = path.join(panel, 'data');
    try {
      const c = JSON.parse(fs.readFileSync(path.join(panel, 'config.json'), 'utf8'));
      if (c.dataDir) dataDir = path.resolve(panel, c.dataDir);
    } catch {}
    const old = path.join(dataDir, 'wowsite.json');
    if (!fs.existsSync(old)) continue;
    try {
      fs.copyFileSync(old, FILE);
      const assets = path.join(dataDir, 'wowsite-assets');
      const to = path.join(config.dataDir, 'wowsite-assets');
      if (fs.existsSync(assets) && !fs.existsSync(to)) fs.cpSync(assets, to, { recursive: true });
      console.log(`[wowsite] Copied the website's settings from ${dataDir} to ${config.dataDir}.`);
    } catch (err) {
      console.error(`[wowsite] Couldn't copy the website's settings from ${dataDir}: ${err.message}`);
    }
    return;
  }
}

function read() {
  try {
    return normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    return null;
  }
}

migrateFromPanel();

module.exports = { FILE, DEFAULT_PORT, REGISTRATION, normalize, read };
