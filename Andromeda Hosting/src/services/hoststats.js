'use strict';
// Whole-PC CPU and memory, sampled every 5 seconds and kept for the last hour, for the dashboard's
// graphs. This is the only caller of procstats.systemCpu(): it measures CPU time between calls, so
// a second caller would make both readings jumpy.
const os = require('os');
const procstats = require('../util/procstats');

const EVERY_MS = 5000;
const KEEP = 720; // one hour
const samples = [];
let timer = null;

function take() {
  samples.push({ t: Date.now(), cpu: Math.round(procstats.systemCpu() * 10) / 10, mem: os.totalmem() - os.freemem() });
  if (samples.length > KEEP) samples.splice(0, samples.length - KEEP);
}

function start() {
  if (timer) return;
  take(); // primes the CPU counters; the first reading is 0
  timer = setInterval(take, EVERY_MS);
  timer.unref();
}

const latest = () => samples[samples.length - 1] || { cpu: 0, mem: os.totalmem() - os.freemem() };
const history = () => samples.slice(1);

module.exports = { start, latest, history, EVERY_MS };
