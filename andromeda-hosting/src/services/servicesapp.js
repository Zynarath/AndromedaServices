'use strict';
// Keeps "Andromeda Services.exe" (the Windows app that starts/stops the panel and the WotLK
// website) built. Updates installed from the panel, or with the old update.bat, don't rebuild it,
// and the app can't replace itself if it was never built. So when the panel starts on Windows it
// builds the app if it's missing or older than its source (and adds the shortcuts the first time).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');

const EXE = path.join(config.root, 'Andromeda Services.exe');
const SRC = path.join(config.root, 'services', 'AndromedaServices.cs');
const BAT = path.join(config.root, 'services', 'build.bat');

function needsBuild() {
  if (!fs.existsSync(SRC) || !fs.existsSync(BAT)) return false;
  if (!fs.existsSync(EXE)) return true;
  return fs.statSync(EXE).mtimeMs < fs.statSync(SRC).mtimeMs - 60000;
}

function ensureBuilt(log) {
  if (process.platform !== 'win32' || !needsBuild()) return;
  const first = !fs.existsSync(EXE);
  log.info(first ? 'Building Andromeda Services (the app that starts and stops everything)...' : 'Rebuilding Andromeda Services after an update...');
  let out = '';
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `""${BAT}"${first ? ' shortcut' : ''}"`], { cwd: config.root, windowsHide: true, windowsVerbatimArguments: true });
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.on('error', (err) => log.warn(`Couldn't build Andromeda Services: ${err.message}`));
  child.on('close', (code) => {
    const lines = out.trim().split(/\r?\n/).filter(Boolean);
    if (code === 0) log.info(`Andromeda Services is ready: ${EXE}${first ? ' (also on your desktop and in the Start menu)' : ''}`);
    else log.warn(`Couldn't build Andromeda Services: ${lines.slice(-3).join(' ') || 'exit ' + code}. Run services\\build.bat to see why.`);
  });
}

module.exports = { ensureBuilt, needsBuild };
