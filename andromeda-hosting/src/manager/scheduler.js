'use strict';
// Per-server scheduled tasks: restarts, backups, commands, updates.
const logger = require('../util/log');
const db = require('../db');
const auth = require('../auth');

const log = logger('scheduler');
const pendingWarnings = new Map();

// Permission a schedule's creator must still hold for it to fire (kept in sync with routes).
const ACTION_PERM = { restart: 'control', start: 'control', stop: 'control', backup: 'backups', command: 'console', update: 'mods' };

// A non-admin creator who has since lost the permission (or been removed/disabled) must not keep
// running a privileged schedule. Admin-created schedules have no createdBy requirement.
function creatorAllowed(server, s) {
  if (!s.createdBy) return true; // legacy schedules created before this check (admins only in practice)
  const user = db.data.users.find((u) => u.id === s.createdBy);
  if (!user || user.disabled) return false;
  return auth.can(user, server, ACTION_PERM[s.action]);
}

// Most recent time <= now that a "daily/weekly" schedule should have fired.
function lastOccurrence(s, now) {
  const [hh, mm] = String(s.time || '04:00').split(':').map(Number);
  for (let back = 0; back < 8; back++) {
    const d = new Date(now);
    d.setDate(d.getDate() - back);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() > now) continue;
    if (Array.isArray(s.days) && s.days.length && !s.days.includes(d.getDay())) continue;
    return d.getTime();
  }
  return null;
}

function nextRun(s, now = Date.now()) {
  if (s.type === 'interval') return (s.lastRun || s.createdAt || now) + Math.max(5, Number(s.everyMinutes) || 60) * 60e3;
  const [hh, mm] = String(s.time || '04:00').split(':').map(Number);
  for (let fwd = 0; fwd < 8; fwd++) {
    const d = new Date(now);
    d.setDate(d.getDate() + fwd);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= now) continue;
    if (Array.isArray(s.days) && s.days.length && !s.days.includes(d.getDay())) continue;
    return d.getTime();
  }
  return null;
}

function isDue(s, now) {
  if (!s.enabled) return false;
  if (s.type === 'interval') return now >= nextRun(s, now);
  const occ = lastOccurrence(s, now);
  return occ !== null && occ > (s.lastRun || s.createdAt || 0) && now - occ < 10 * 60e3;
}

async function execute(manager, inst, s) {
  const server = inst.server;
  const label = `Scheduled "${s.name || s.action}"`;
  switch (s.action) {
    case 'restart':
      if (!inst.child) return inst.start();
      return inst.restart();
    case 'start':
      if (!inst.child) return inst.start();
      return;
    case 'stop':
      return inst.stop();
    case 'backup':
      return manager.backup(server.id, { reason: 'scheduled' });
    case 'command':
      if (inst.child && s.payload) return inst.sendCommand(s.payload);
      return;
    case 'update':
      return manager.update(server.id, { latest: true, backup: true, reason: label });
    default:
      log.warn(`Unknown scheduled action ${s.action}`);
  }
}

async function run(manager, inst, s) {
  s.lastRun = Date.now();
  db.save();
  if (!creatorAllowed(inst.server, s)) {
    inst.appendConsole(`[schedule] Skipping "${s.name || s.action}": the user who created it no longer has permission.`);
    return;
  }
  const warn = Number(s.warnMinutes) || 0;
  const disruptive = ['restart', 'stop', 'update'].includes(s.action);
  if (disruptive && warn > 0 && inst.status === 'running' && inst.game.broadcastCommand) {
    const verb = s.action === 'stop' ? 'shutting down' : s.action === 'update' ? 'updating' : 'restarting';
    const say = (mins) => inst.sendCommand(inst.game.broadcastCommand(`Server ${verb} in ${mins} minute${mins === 1 ? '' : 's'}!`)).catch(() => {});
    say(warn);
    const timers = [];
    if (warn > 1) timers.push(setTimeout(() => say(1), (warn - 1) * 60e3));
    timers.push(
      setTimeout(() => {
        pendingWarnings.delete(s.id);
        execute(manager, inst, s).catch((e) => inst.appendConsole(`[schedule] ${s.name || s.action} failed: ${e.message}`));
      }, warn * 60e3)
    );
    pendingWarnings.set(s.id, timers);
    inst.appendConsole(`[schedule] "${s.name || s.action}" will run in ${warn} minute(s).`);
    return;
  }
  inst.appendConsole(`[schedule] Running "${s.name || s.action}"`);
  await execute(manager, inst, s);
}

function start(manager) {
  const tick = () => {
    const now = Date.now();
    for (const inst of manager.instances.values()) {
      for (const s of inst.server.schedules || []) {
        if (pendingWarnings.has(s.id) || !isDue(s, now)) continue;
        run(manager, inst, s).catch((e) => {
          inst.appendConsole(`[schedule] "${s.name || s.action}" failed: ${e.message}`);
          log.warn(`${inst.server.name}: ${s.action} failed: ${e.message}`);
        });
      }
    }
  };
  setInterval(tick, 20000);
}

module.exports = { start, nextRun, isDue, lastOccurrence };
