'use strict';
// Where the WotLK website keeps its files: its settings (wowsite.json), the downloaded graphics and
// its log. By default the "data" folder next to src; ANDROMEDA_WOWSITE_DATA moves it.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dataDir = path.resolve(ROOT, process.env.ANDROMEDA_WOWSITE_DATA || 'data');

const cfg = {
  root: ROOT,
  dataDir,
  cacheDir: path.join(dataDir, 'cache'),
  logsDir: path.join(dataDir, 'logs'),
};
for (const dir of [cfg.dataDir, cfg.cacheDir, cfg.logsDir]) fs.mkdirSync(dir, { recursive: true });

module.exports = cfg;
