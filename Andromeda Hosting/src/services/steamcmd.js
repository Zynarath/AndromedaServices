'use strict';
// SteamCMD wrapper: downloads SteamCMD on first use and installs/updates dedicated servers.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const config = require('../config');
const { downloadFile } = require('../util/download');
const { extractZip } = require('../util/zip');

const dir = path.join(config.runtimesDir, 'steamcmd');
const exe = path.join(dir, process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd.sh');

async function ensureSteamCmd(log = console) {
  if (fs.existsSync(exe)) return exe;
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    const zip = path.join(config.cacheDir, 'steamcmd.zip');
    log.info('Downloading SteamCMD...');
    await downloadFile('https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip', zip);
    await extractZip(zip, dir);
    fs.rmSync(zip, { force: true });
  } else {
    const tgz = path.join(config.cacheDir, 'steamcmd_linux.tar.gz');
    log.info('Downloading SteamCMD...');
    await downloadFile('https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz', tgz);
    await new Promise((res, rej) => execFile('tar', ['-xzf', tgz, '-C', dir], (e) => (e ? rej(e) : res())));
    fs.rmSync(tgz, { force: true });
  }
  if (!fs.existsSync(exe)) throw new Error('SteamCMD download did not contain the expected executable');
  return exe;
}

function runSteamCmd(args, log, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: dir, windowsHide: true });
    let out = '';
    let partial = '';
    const handle = (chunk) => {
      const text = partial + chunk.toString();
      const lines = text.split(/\r\n|\n|\r/);
      partial = lines.pop();
      for (const line of lines) {
        const l = line.trim();
        if (!l) continue;
        out += l + '\n';
        onLine && onLine(l);
      }
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', reject);
    child.on('close', (code) => {
      if (partial.trim()) {
        out += partial;
        onLine && onLine(partial.trim());
      }
      resolve({ code, out });
    });
  });
}

/** Install or update a Steam app (anonymous login). */
async function appUpdate(appId, installDir, { validate = false, log = console, extra = [] } = {}) {
  await ensureSteamCmd(log);
  fs.mkdirSync(installDir, { recursive: true });
  const args = ['+force_install_dir', installDir, '+login', 'anonymous', '+app_update', String(appId), ...extra];
  if (validate) args.push('validate');
  args.push('+quit');
  for (let attempt = 1; attempt <= 3; attempt++) {
    log.info(`Running SteamCMD (attempt ${attempt}) for app ${appId}...`);
    let lastPct = -1;
    const { out } = await runSteamCmd(args, log, (line) => {
      const m = /progress:\s*([\d.]+)\s*\((\d+)\s*\/\s*(\d+)\)/.exec(line);
      if (m) {
        const pct = Number(m[1]);
        const state = /Update state \(0x\w+\) (\w+)/.exec(line);
        if (log.progress) log.progress(pct, `${state ? state[1] : 'working'} ${(Number(m[2]) / 1073741824).toFixed(2)} / ${(Number(m[3]) / 1073741824).toFixed(2)} GB`);
        if (Math.floor(pct / 10) !== Math.floor(lastPct / 10)) log.info(line);
        lastPct = pct;
      } else if (!/^\[\s*\d+%\]/.test(line)) {
        log.info(line);
      }
    });
    if (new RegExp(`Success! App '${appId}'`).test(out)) return true;
    if (/No subscription|Invalid Platform/i.test(out)) throw new Error('SteamCMD refused the app (wrong platform for this server?)');
    if (/0x202|Not enough disk space/i.test(out)) throw new Error('SteamCMD: not enough disk space');
    log.warn('SteamCMD did not report success, retrying...');
  }
  throw new Error('SteamCMD failed to install/update the server after 3 attempts. See the log above.');
}

module.exports = { ensureSteamCmd, appUpdate, steamcmdExe: exe };
