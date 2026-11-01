'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = process.env.ANDROMEDA_CONFIG || path.join(ROOT, 'config.json');

const defaults = {
  // Address and port the web panel listens on. 0.0.0.0 = reachable from your LAN / VPN.
  host: '0.0.0.0',
  port: 8080,
  // Where the panel stores its database, runtimes (Java, SteamCMD) and caches.
  dataDir: './data',
  // Where game server files live. Put this on a big/fast drive, e.g. "D:/GameServers".
  serversDir: null,
  // Where backups are written. Defaults to <dataDir>/backups.
  backupsDir: null,
  // Set to true when running behind a reverse proxy / Cloudflare Tunnel so client IPs are correct.
  trustProxy: false,
  // Optional HTTPS. Provide PEM files to serve the panel over TLS directly.
  https: { certFile: null, keyFile: null },
};

function load() {
  let user = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
      console.error(`[config] Could not parse ${CONFIG_FILE}: ${err.message}`);
      process.exit(1);
    }
  }
  const cfg = { ...defaults, ...user, https: { ...defaults.https, ...(user.https || {}) } };
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.HOST) cfg.host = process.env.HOST;
  if (process.env.ANDROMEDA_DATA) cfg.dataDir = process.env.ANDROMEDA_DATA;

  const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));
  cfg.dataDir = abs(cfg.dataDir);
  cfg.serversDir = abs(cfg.serversDir || path.join(cfg.dataDir, 'servers'));
  cfg.backupsDir = abs(cfg.backupsDir || path.join(cfg.dataDir, 'backups'));
  cfg.runtimesDir = path.join(cfg.dataDir, 'runtimes');
  cfg.cacheDir = path.join(cfg.dataDir, 'cache');
  cfg.logsDir = path.join(cfg.dataDir, 'logs');
  cfg.root = ROOT;
  for (const dir of [cfg.dataDir, cfg.serversDir, cfg.backupsDir, cfg.runtimesDir, cfg.cacheDir, cfg.logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return cfg;
}

module.exports = load();
