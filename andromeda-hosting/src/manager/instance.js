'use strict';
// Runtime state for one game server: process, console, job, stats.
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const EventEmitter = require('events');
const { gameFor } = require('../games');
const { applyProcessTuning } = require('../util/procstats');
const { randomId } = require('../util/misc');
const logger = require('../util/log');

const CONSOLE_LINES = 1500;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

class Instance extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.status = 'stopped';
    this.console = [];
    this.child = null;
    this.job = null;
    this.stats = null;
    this.statsHistory = [];
    this.players = null;
    this.startedAt = null;
    this.crashes = [];
    this.stopRequested = false;
    this.aux = new Map(); // helper processes some games need (e.g. WoW: MySQL + login server)
    this.log = logger(`server:${server.id}`);
  }

  get game() {
    return gameFor(this.server);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    if (status !== 'running') this.players = null;
    this.emit('status', status);
  }

  appendConsole(line) {
    const clean = String(line).replace(ANSI, '').replace(/\r/g, '');
    const entry = { t: Date.now(), line: clean };
    this.console.push(entry);
    if (this.console.length > CONSOLE_LINES) this.console.splice(0, this.console.length - CONSOLE_LINES);
    this.emit('console', entry);
    if (this.status === 'starting' && this.game.readyPattern && this.game.readyPattern.test(clean)) {
      this.setStatus('running');
      this.appendConsole('[panel] Server is ready.');
    }
  }

  isBusy() {
    return !!(this.job && this.job.status === 'running');
  }

  async start() {
    if (this.isBusy()) throw Object.assign(new Error(`Wait for "${this.job.label}" to finish first.`), { status: 409 });
    if (this.child) throw Object.assign(new Error('Server is already running'), { status: 409 });
    if (!this.server.installed) throw Object.assign(new Error('Server is not installed yet'), { status: 409 });
    this.stopRequested = false;
    this.setStatus('starting');
    let launch;
    try {
      if (this.game.preStart) await this.game.preStart(this);
      launch = await this.game.buildLaunch(this.server);
    } catch (err) {
      this.appendConsole(`[panel] Cannot start: ${err.message}`);
      if (this.game.postStop) await this.game.postStop(this).catch(() => {});
      this.setStatus('stopped');
      throw err;
    }
    this.appendConsole(`[panel] Starting: ${launch.command} ${launch.args.join(' ')}`);
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: { ...process.env, ...(launch.env || {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.startedAt = Date.now();
    const splitter = () => {
      let partial = '';
      return (chunk) => {
        const parts = (partial + chunk.toString()).split('\n');
        partial = parts.pop();
        for (const p of parts) if (p.trim()) this.appendConsole(p);
      };
    };
    child.stdout.on('data', splitter());
    child.stderr.on('data', splitter());
    child.stdin.on('error', () => {});
    child.on('error', (err) => {
      this.appendConsole(`[panel] Failed to launch: ${err.message}`);
    });
    child.on('exit', (code, signal) => this.onExit(code, signal));
    if (launch.logFile) this.tailLog(launch.logFile);
    if (this.game.probeReady) this.pollReady();

    const tuning = this.server.tuning || {};
    if (child.pid && (tuning.affinity || (tuning.priority && tuning.priority !== 'normal'))) {
      applyProcessTuning(child.pid, tuning).then((err) => {
        if (err) this.appendConsole(`[panel] Could not apply CPU affinity/priority: ${err}`);
        else this.appendConsole(`[panel] Applied CPU affinity "${tuning.affinity || 'all'}" / priority "${tuning.priority || 'normal'}"`);
      });
    }
  }

  tailLog(fileOrList) {
    if (Array.isArray(fileOrList)) {
      // Follow whichever candidate the game starts writing to after launch.
      const started = this.startedAt;
      const pick = setInterval(() => {
        if (!this.child || this.startedAt !== started) return clearInterval(pick);
        for (const f of fileOrList) {
          try {
            if (fs.statSync(f).mtimeMs >= started - 2000) {
              clearInterval(pick);
              return this.tailLog(f);
            }
          } catch {}
        }
      }, 2000);
      return;
    }
    const file = fileOrList;
    let initial = null;
    try {
      const st = fs.statSync(file);
      initial = { size: st.size, birth: st.birthtimeMs };
    } catch {}
    let offset = null;
    let partial = '';
    const tick = () => {
      if (!this.child) return clearInterval(this.tailTimer);
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        return;
      }
      if (offset === null) {
        const rotated = !initial || st.birthtimeMs !== initial.birth || st.size < initial.size;
        offset = rotated ? 0 : initial.size;
      }
      if (st.size < offset) offset = 0;
      if (st.size === offset) return;
      const len = Math.min(st.size - offset, 2 * 1024 * 1024);
      try {
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, offset);
        fs.closeSync(fd);
        offset += len;
        const parts = (partial + buf.toString('utf8')).split(/\r?\n/);
        partial = parts.pop();
        for (const p of parts) if (p.trim()) this.appendConsole(p);
      } catch {}
    };
    this.tailTimer = setInterval(tick, 1000);
  }

  pollReady() {
    const started = this.startedAt;
    const check = async () => {
      if (!this.child || this.startedAt !== started || this.status !== 'starting') return;
      try {
        await this.game.probeReady(this.server);
        if (this.status === 'starting') {
          this.setStatus('running');
          this.appendConsole('[panel] Server is up and answering RCON.');
        }
      } catch {
        setTimeout(check, 10000);
      }
    };
    setTimeout(check, 20000);
  }

  /** Start a helper process whose output is shown in the console with a [name] prefix. */
  spawnAux(name, command, args, { cwd, filter } = {}) {
    this.appendConsole(`[panel] Starting ${name}: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.aux.set(name, child);
    let partial = '';
    const onData = (chunk) => {
      const parts = (partial + chunk.toString()).split('\n');
      partial = parts.pop();
      for (const p of parts) if (p.trim() && (!filter || filter(p))) this.appendConsole(`[${name}] ${p.replace(/\r$/, '')}`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.stdin.on('error', () => {});
    child.on('error', (err) => this.appendConsole(`[panel] ${name} failed to launch: ${err.message}`));
    child.on('exit', (code) => {
      if (this.aux.get(name) === child) this.aux.delete(name);
      this.appendConsole(`[panel] ${name} exited (code ${code ?? 'none'}).`);
      this.emit('aux-exit', name, code);
    });
    return child;
  }

  auxRunning(name) {
    return this.aux.has(name);
  }

  waitForAuxExit(name, timeoutMs) {
    const child = this.aux.get(name);
    if (!child) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs);
      child.once('exit', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
  }

  killAux(name) {
    const child = this.aux.get(name);
    if (!child) return;
    if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else child.kill('SIGKILL');
  }

  onExit(code, signal) {
    this.handleExit(code, signal).catch((err) => this.log.error(err));
  }

  async handleExit(code, signal) {
    clearInterval(this.tailTimer);
    clearTimeout(this.killTimer);
    if (this.game.closeRcon) this.game.closeRcon(this.server);
    this.child = null;
    this.stats = null;
    const expected = this.stopRequested;
    this.appendConsole(`[panel] Server process exited (code ${code ?? 'none'}${signal ? ', signal ' + signal : ''}).`);
    if (expected) {
      if (this.game.postStop && this.aux.size) {
        this.appendConsole('[panel] Stopping helper processes...');
        await this.game.postStop(this).catch((err) => this.appendConsole(`[panel] ${err.message}`));
      }
      this.setStatus('stopped');
      this.emit('exited', { expected: true });
      return;
    }
    // After a crash, helper processes keep running so an auto-restart is quick; without
    // auto-restart they're shut down too.
    if (!this.server.autoRestart && this.game.postStop && this.aux.size) await this.game.postStop(this).catch(() => {});
    this.setStatus('crashed');
    this.emit('exited', { expected: false });
    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < 15 * 60e3);
    this.crashes.push(now);
    if (this.server.autoRestart && this.crashes.length <= 3) {
      this.appendConsole('[panel] Server stopped unexpectedly — restarting in 10 seconds (auto-restart is on).');
      setTimeout(() => {
        if (!this.child && this.status === 'crashed') this.start().catch((e) => this.appendConsole(`[panel] Auto-restart failed: ${e.message}`));
      }, 10000);
    } else if (this.server.autoRestart) {
      this.appendConsole('[panel] Crashed 3+ times in 15 minutes — auto-restart paused. Check the console/crash reports.');
    }
  }

  waitForExit(timeoutMs) {
    if (!this.child) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.once('exited', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  async stop() {
    if (!this.child) {
      if (this.status === 'crashed') this.setStatus('stopped');
      return;
    }
    if (this.status === 'stopping') return this.waitForExit(this.game.stopTimeoutMs + 15000);
    this.stopRequested = true;
    this.setStatus('stopping');
    this.appendConsole('[panel] Stopping server...');
    const timeout = this.game.stopTimeoutMs;
    this.killTimer = setTimeout(() => {
      if (this.child) {
        this.appendConsole(`[panel] Server did not stop within ${timeout / 1000}s — killing it.`);
        this.kill();
      }
    }, timeout);
    const exited = this.waitForExit(timeout + 15000);
    try {
      await this.game.stop(this);
    } catch (err) {
      this.appendConsole(`[panel] Graceful stop failed (${err.message}); killing.`);
      this.kill();
    }
    await exited;
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  kill() {
    for (const name of [...this.aux.keys()]) this.killAux(name);
    const child = this.child;
    if (!child) return;
    this.stopRequested = true;
    if (process.platform === 'win32' && child.pid) {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      child.kill('SIGKILL');
    }
  }

  writeStdin(line) {
    if (!this.child || !this.child.stdin.writable) throw Object.assign(new Error('Server is not running'), { status: 409 });
    this.child.stdin.write(line + '\n');
  }

  async sendCommand(command) {
    if (!this.child) throw Object.assign(new Error('Server is not running'), { status: 409 });
    this.appendConsole(`> ${command}`);
    return this.game.sendCommand(this, command);
  }

  /** Run a long task (install, update, backup...) with streamed log + progress. */
  async runJob(type, label, fn, { setInstalling = false } = {}) {
    if (this.isBusy()) throw Object.assign(new Error(`"${this.job.label}" is already running`), { status: 409 });
    const job = { id: randomId(), type, label, status: 'running', progress: null, progressLabel: '', log: [], startedAt: Date.now() };
    this.job = job;
    if (setInstalling) this.setStatus('installing');
    const emit = () => this.emit('job', job);
    let lastProgress = 0;
    const push = (level, msg) => {
      const line = `${level === 'info' ? '' : level.toUpperCase() + ': '}${msg}`;
      job.log.push({ t: Date.now(), level, line });
      if (job.log.length > 2000) job.log.splice(0, job.log.length - 2000);
      this.appendConsole(`[${type}] ${line}`);
      emit();
    };
    const log = {
      info: (m) => push('info', m),
      warn: (m) => push('warn', m),
      error: (m) => push('error', m),
      progress: (pct, lbl) => {
        job.progress = pct === null || pct === undefined ? null : Math.max(0, Math.min(100, pct));
        if (lbl) job.progressLabel = lbl;
        const now = Date.now();
        if (now - lastProgress > 400) {
          lastProgress = now;
          emit();
        }
      },
    };
    emit();
    try {
      const result = await fn(log);
      job.status = 'done';
      job.progress = 100;
      job.finishedAt = Date.now();
      push('info', `${label} finished.`);
      return result;
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      job.finishedAt = Date.now();
      push('error', `${label} failed: ${err.message}`);
      this.log.error(err);
      throw err;
    } finally {
      if (setInstalling) this.setStatus(this.child ? 'running' : 'stopped');
      emit();
    }
  }

  toJSON() {
    return {
      status: this.status,
      startedAt: this.startedAt,
      pid: this.child ? this.child.pid : null,
      stats: this.stats,
      players: this.players,
      job: this.job ? { ...this.job, log: this.job.log.slice(-200) } : null,
    };
  }
}

module.exports = Instance;
