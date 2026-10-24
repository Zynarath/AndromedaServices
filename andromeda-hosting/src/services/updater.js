'use strict';
// Self-update from GitHub: the panel folder is a Git clone, so updating is "git pull" + "npm install"
// and a restart. start.bat/start.sh restart the panel when it exits with RESTART_CODE.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const db = require('../db');
const logger = require('../util/log');
const { HttpError } = require('../util/misc');

const log = logger('updates');
const RESTART_CODE = 75;
const RESUME_FILE = path.join(config.dataDir, 'resume-after-update.json');
// The repo root holds .git; the panel lives in its andromeda-hosting/ subfolder.
const cwd = config.root;
const state = { lastCheck: null, behind: 0, changes: [], error: null, applying: false };
let manager = null;
let restartHook = null;

function git(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    // Never wait for a password prompt in the background (credentials come from Git's credential manager).
    execFile('git', args, { cwd, timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim().split('\n').pop())) : resolve(stdout.trim())
    );
  });
}

async function repoInfo() {
  try {
    const inside = await git(['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') return null;
    const [branch, commit, upstream] = await Promise.all([
      git(['rev-parse', '--abbrev-ref', 'HEAD']),
      git(['log', '-1', '--format=%h %s (%cr)']),
      git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => null),
    ]);
    return { branch, commit, upstream };
  } catch {
    return null;
  }
}

function settings() {
  const u = db.data.settings.updates || {};
  return { auto: !!u.auto };
}

async function check() {
  const info = await repoInfo();
  if (!info) throw new HttpError(400, 'This Andromeda Hosting folder is not a Git copy, so it cannot update itself. See "Updating" in README.md.');
  if (!info.upstream) throw new HttpError(400, `Branch ${info.branch} has no GitHub branch to update from.`);
  try {
    await git(['fetch', '--quiet']);
    state.behind = Number(await git(['rev-list', '--count', 'HEAD..@{u}'])) || 0;
    state.changes = state.behind ? (await git(['log', '--format=%h %s', 'HEAD..@{u}'])).split('\n').filter(Boolean).slice(0, 30) : [];
    state.error = null;
  } catch (err) {
    state.error = `Couldn't reach GitHub: ${err.message}`;
  }
  state.lastCheck = Date.now();
  return status(info);
}

async function status(info) {
  info = info || (await repoInfo());
  return {
    gitRepo: !!info,
    branch: info && info.branch,
    commit: info && info.commit,
    version: require('../../package.json').version,
    canRestart: process.env.ANDROMEDA_LAUNCHER === '1',
    ...settings(),
    ...state,
  };
}

// Is anyone actually playing right now? (Bots don't count.)
function playersOnline() {
  return [...manager.instances.values()].some((i) => i.child && i.players && i.players.online > 0);
}

async function apply({ reason = 'manual' } = {}) {
  if (state.applying) throw new HttpError(409, 'An update is already being installed');
  const info = await repoInfo();
  if (!info) throw new HttpError(400, 'This folder is not a Git copy of the repository');
  state.applying = true;
  try {
    log.info(`Installing update (${reason})...`);
    await git(['pull', '--ff-only'], 180000);
    await new Promise((resolve, reject) =>
      require('child_process').exec('npm install --omit=dev --no-audit --no-fund', { cwd, timeout: 600000, windowsHide: true }, (err, _o, stderr) =>
        err ? reject(new Error(`npm install failed: ${(stderr || err.message).trim().split('\n').pop()}`)) : resolve()
      )
    );
    state.behind = 0;
    state.changes = [];
    log.info('Update downloaded.');
    if (process.env.ANDROMEDA_LAUNCHER !== '1') {
      state.applying = false;
      return { restarted: false, message: 'Update installed. Restart Andromeda Hosting (close its window and run start.bat) to use it.' };
    }
    // Remember which servers were running so they come back after the restart.
    const running = [...manager.instances.values()].filter((i) => i.child).map((i) => i.server.id);
    fs.writeFileSync(RESUME_FILE, JSON.stringify({ servers: running, at: Date.now() }));
    setTimeout(() => restartHook && restartHook(`update (${reason})`), 500);
    return { restarted: true, message: 'Update installed. Andromeda Hosting is restarting — this page will reconnect in a moment.' };
  } catch (err) {
    state.applying = false;
    state.error = err.message;
    log.error(`Update failed: ${err.message}`);
    throw new HttpError(500, `Update failed: ${err.message}`);
  }
}

function setAuto(auto) {
  db.data.settings.updates = { ...(db.data.settings.updates || {}), auto: !!auto };
  db.save();
}

// Servers that were running before an update restart are started again.
function resumeList() {
  try {
    const data = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
    fs.rmSync(RESUME_FILE, { force: true });
    return Date.now() - data.at < 30 * 60e3 ? data.servers : [];
  } catch {
    return [];
  }
}

function init(mgr, onRestart) {
  manager = mgr;
  restartHook = onRestart;
  const tick = async () => {
    try {
      if (!(await repoInfo())) return;
      await check();
      if (settings().auto && state.behind > 0 && !state.applying) {
        if (playersOnline()) log.info('Update available — waiting until nobody is playing to install it.');
        else await apply({ reason: 'automatic' });
      }
    } catch (err) {
      log.warn(`Update check failed: ${err.message}`);
    }
  };
  setTimeout(tick, 2 * 60e3).unref();
  setInterval(tick, 60 * 60e3).unref();
}

module.exports = { init, check, status, apply, setAuto, resumeList, RESTART_CODE };
