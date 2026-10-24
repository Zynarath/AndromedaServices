'use strict';
// Per-process CPU / memory sampling without native modules.
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const prev = new Map(); // pid -> { cpuMs, at }
const CORES = os.cpus().length || 1;

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

async function rawWindows(pids) {
  const ps =
    `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { ` +
    `'{0}|{1}|{2}' -f $_.Id,[int64]$_.TotalProcessorTime.TotalMilliseconds,$_.WorkingSet64 }`;
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  const res = new Map();
  for (const line of out.split(/\r?\n/)) {
    const [pid, cpu, mem] = line.trim().split('|');
    if (pid && cpu !== undefined) res.set(Number(pid), { cpuMs: Number(cpu), mem: Number(mem) });
  }
  return res;
}

function rawLinux(pids) {
  const res = new Map();
  for (const pid of pids) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ticks = Number(fields[11]) + Number(fields[12]); // utime + stime
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const rss = /VmRSS:\s+(\d+)/.exec(status);
      res.set(pid, { cpuMs: ticks * 10, mem: rss ? Number(rss[1]) * 1024 : 0 });
    } catch {}
  }
  return res;
}

async function rawPs(pids) {
  const out = await run('ps', ['-o', 'pid=,rss=,time=', '-p', pids.join(',')]);
  const res = new Map();
  for (const line of out.split('\n')) {
    const [pid, rss, time] = line.trim().split(/\s+/);
    if (!pid || !time) continue;
    const parts = time.split(/[-:]/).map(Number);
    let secs = 0;
    for (const p of parts) secs = secs * 60 + p;
    res.set(Number(pid), { cpuMs: secs * 1000, mem: Number(rss) * 1024 });
  }
  return res;
}

// Returns Map pid -> { cpu: percent of the whole machine, mem: bytes }
async function sample(pids) {
  pids = [...new Set(pids.filter(Boolean))];
  const out = new Map();
  if (!pids.length) return out;
  const now = Date.now();
  const raw =
    process.platform === 'win32' ? await rawWindows(pids) : process.platform === 'linux' ? rawLinux(pids) : await rawPs(pids);
  for (const [pid, r] of raw) {
    const p = prev.get(pid);
    let cpu = 0;
    if (p && now > p.at) cpu = Math.max(0, ((r.cpuMs - p.cpuMs) / ((now - p.at) * CORES)) * 100);
    prev.set(pid, { cpuMs: r.cpuMs, at: now });
    out.set(pid, { cpu: Math.min(100, cpu), mem: r.mem });
  }
  for (const pid of prev.keys()) if (!pids.includes(pid)) prev.delete(pid);
  return out;
}

// Whole-machine CPU usage from os.cpus() deltas.
let lastCpu = null;
function systemCpu() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  let pct = 0;
  if (lastCpu) {
    const dt = total - lastCpu.total;
    pct = dt > 0 ? (1 - (idle - lastCpu.idle) / dt) * 100 : 0;
  }
  lastCpu = { idle, total };
  return Math.max(0, Math.min(100, pct));
}

// Parse "0-7,16,18-19" into a list of logical CPU indices.
function parseCpuList(spec) {
  const out = new Set();
  for (const part of String(spec || '').split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i < 1024; i++) out.add(i);
  }
  return [...out].filter((i) => i < CORES).sort((x, y) => x - y);
}

const PRIORITIES = {
  // name: [windows PriorityClass, unix nice]
  idle: ['Idle', 19],
  below_normal: ['BelowNormal', 5],
  normal: ['Normal', 0],
  above_normal: ['AboveNormal', -5],
  high: ['High', -10],
};

// Apply CPU affinity / priority to a running process. Returns an error string or null.
async function applyProcessTuning(pid, { affinity, priority }) {
  const cpus = parseCpuList(affinity);
  const prio = PRIORITIES[priority];
  if (!cpus.length && (!prio || priority === 'normal')) return null;
  if (process.platform === 'win32') {
    const cmds = [`$p = Get-Process -Id ${pid}`];
    if (cpus.length) {
      const mask = cpus.reduce((m, i) => m | (1n << BigInt(i)), 0n);
      cmds.push(`$p.ProcessorAffinity = [IntPtr][Int64]${mask.toString()}`);
    }
    if (prio && priority !== 'normal') cmds.push(`$p.PriorityClass = '${prio[0]}'`);
    const out = await new Promise((resolve) =>
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmds.join('; ')], { windowsHide: true, timeout: 10000 }, (err, _o, stderr) =>
        resolve(err ? stderr || err.message : null)
      )
    );
    return out;
  }
  const errors = [];
  if (cpus.length) {
    const r = await new Promise((resolve) => execFile('taskset', ['-a', '-p', '-c', cpus.join(','), String(pid)], (err) => resolve(err)));
    if (r) errors.push('taskset: ' + r.message);
  }
  if (prio && priority !== 'normal') {
    const r = await new Promise((resolve) => execFile('renice', ['-n', String(prio[1]), '-p', String(pid)], (err) => resolve(err)));
    if (r) errors.push('renice: ' + r.message);
  }
  return errors.length ? errors.join('; ') : null;
}

module.exports = { sample, systemCpu, parseCpuList, applyProcessTuning, CORES, PRIORITIES };
