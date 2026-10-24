'use strict';
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const config = require('../config');
const db = require('../db');
const Instance = require('./instance');
const backups = require('./backups');
const scheduler = require('./scheduler');
const { games, templates, CONFIG_KEY } = require('../games');
const procstats = require('../util/procstats');
const { HttpError, randomId, isTcpPortFree, isUdpPortFree } = require('../util/misc');
const cf = require('../services/curseforge');
const logger = require('../util/log');

const log = logger('manager');

class Manager extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map();
  }

  init() {
    for (const server of db.data.servers) this.attach(server);
    setInterval(() => this.sampleStats().catch(() => {}), 3000);
    setInterval(() => this.queryPlayers().catch(() => {}), 15000);
    scheduler.start(this);
    const resume = new Set(require('../services/updater').resumeList());
    for (const inst of this.instances.values()) {
      if ((inst.server.autoStart || resume.has(inst.server.id)) && inst.server.installed) {
        log.info(`${resume.has(inst.server.id) ? 'Restarting after update' : 'Auto-starting'}: ${inst.server.name}`);
        inst.start().catch((e) => log.warn(`Auto-start of ${inst.server.name} failed: ${e.message}`));
      }
    }
  }

  attach(server) {
    const inst = new Instance(server);
    for (const ev of ['status', 'console', 'job']) inst.on(ev, (payload) => this.emit(ev, server.id, payload));
    inst.on('status', () => {
      server.lastStatus = inst.status;
      if (inst.status === 'running' && inst.game.onReady) {
        try {
          inst.game.onReady(server, inst);
        } catch (err) {
          log.warn(`onReady for ${server.name} failed: ${err.message}`);
        }
      }
      db.save();
    });
    this.instances.set(server.id, inst);
    return inst;
  }

  get(id) {
    const inst = this.instances.get(id);
    if (!inst) throw new HttpError(404, 'Server not found');
    return inst;
  }

  async sampleStats() {
    const running = [...this.instances.values()].filter((i) => i.child && i.child.pid);
    if (!running.length) return;
    const stats = await procstats.sample(running.map((i) => i.child.pid));
    for (const inst of running) {
      const s = inst.child && stats.get(inst.child.pid);
      if (!s) continue;
      inst.stats = { cpu: s.cpu, mem: s.mem, at: Date.now() };
      inst.statsHistory.push(inst.stats);
      if (inst.statsHistory.length > 120) inst.statsHistory.shift();
      this.emit('stats', inst.server.id, inst.stats);
    }
  }

  async queryPlayers() {
    for (const inst of this.instances.values()) {
      if (!inst.child || !['running', 'starting'].includes(inst.status) || !inst.game.query) continue;
      try {
        inst.players = await inst.game.query(inst.server);
        if (inst.status === 'starting' && inst.server.game === 'minecraft') inst.setStatus('running');
        this.emit('players', inst.server.id, inst.players);
      } catch {}
    }
  }

  usedPorts(excludeId) {
    const used = new Set();
    for (const s of db.data.servers) {
      if (s.id === excludeId) continue;
      for (const p of games[s.game].ports(s)) used.add(p.port);
      if (s.ark) used.add(s.ark.rconPort);
    }
    used.add(config.port);
    return used;
  }

  async freePort(start, step, proto, used) {
    for (let p = start; p < start + step * 200; p += step) {
      if (used.has(p) || used.has(p + 1)) continue;
      const free = proto === 'udp' ? await isUdpPortFree(p) : await isTcpPortFree(p);
      if (free) return p;
    }
    return start;
  }

  async suggestPorts(game, codTitle) {
    const used = this.usedPorts();
    if (game === 'minecraft') return { port: await this.freePort(25565, 1, 'tcp', used) };
    if (game === 'cod') {
      const t = games.cod.TITLES[codTitle] || games.cod.TITLES.iw4x;
      return { port: await this.freePort(t.port, 1, 'udp', used) };
    }
    const port = await this.freePort(7777, 2, 'udp', used);
    used.add(port);
    return {
      port,
      queryPort: await this.freePort(27015, 1, 'udp', used),
      rconPort: await this.freePort(27020, 1, 'tcp', used),
    };
  }

  checkPortConflicts(server) {
    const used = this.usedPorts(server.id);
    const mine = games[server.game].ports(server).map((p) => p.port);
    if (server.ark) mine.push(server.ark.rconPort);
    const clash = mine.find((p) => used.has(p));
    if (clash) throw new HttpError(400, `Port ${clash} is already used by another server or the panel`);
  }

  async create(input, user) {
    const tpl = templates.find((t) => t.id === input.template);
    if (!tpl) throw new HttpError(400, 'Pick a game');
    const name = String(input.name || '').trim();
    if (!name || name.length > 48) throw new HttpError(400, 'Give the server a name (max 48 characters)');
    if (tpl.game === 'cod') {
      const c = input.cod || {};
      if (!String(c.gameDir || '').trim()) throw new HttpError(400, 'Enter the folder where the game is installed');
      if (games.cod.TITLES[tpl.codTitle].pluto && !String(c.plutoKey || '').trim()) throw new HttpError(400, 'Enter your Plutonium server key');
    }
    if (tpl.game === 'wow') {
      const d = games.wow.detect(input.wow && input.wow.root);
      if (!d.layout || d.problems.length) throw new HttpError(400, d.problems.join(' ') || 'Choose the server folder');
      if (db.data.servers.some((s) => s.wow && path.resolve(s.wow.root) === path.resolve(d.root))) throw new HttpError(400, 'That folder is already used by another server');
    }
    if (tpl.game === 'minecraft' && !input.eulaAccepted) throw new HttpError(400, 'You must accept the Minecraft EULA');
    if (tpl.game === 'minecraft' && tpl.source === 'curseforge' && !(input.mc && input.mc.modId && input.mc.fileId)) {
      throw new HttpError(400, 'Pick a modpack and version');
    }
    const id = randomId(4);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'server';
    const game = games[tpl.game];
    const server = {
      id,
      name,
      game: tpl.game,
      template: tpl.id,
      dir: path.join(config.serversDir, `${slug}-${id}`),
      createdAt: Date.now(),
      createdBy: user.id,
      installed: false,
      autoStart: false,
      autoRestart: true,
      eulaAccepted: !!input.eulaAccepted,
      tuning: { affinity: '', priority: 'normal' },
      backupKeep: 10,
      backupBeforeUpdate: true,
      schedules: [],
      access: {},
    };
    const key = CONFIG_KEY[tpl.game];
    const gameInput = { ...input, [key]: { ...(input[key] || {}), source: tpl.source, edition: tpl.edition, title: tpl.codTitle } };
    server[key] = game.defaults(gameInput);
    if (game.resolveDir) server.dir = game.resolveDir(server); // games that run from an existing install
    this.checkPortConflicts(server);
    if (tpl.source === 'curseforge') {
      try {
        const mod = await cf.getMod(server.mc.curseforge.modId);
        Object.assign(server.mc.curseforge, { packName: mod.name, slug: mod.slug, logo: mod.logo ? mod.logo.thumbnailUrl : null, url: mod.links ? mod.links.websiteUrl : null });
      } catch {}
    }
    db.data.servers.push(server);
    db.save();
    const inst = this.attach(server);
    log.info(`${user.username} created server ${name} (${tpl.id})`);
    this.emit('created', id);
    this.install(id).catch(() => {});
    return inst;
  }

  async install(id, opts = {}) {
    const inst = this.get(id);
    if (inst.child) throw new HttpError(409, 'Stop the server first');
    return inst.runJob(
      'install',
      inst.server.installed ? 'Reinstall' : 'Install',
      async (log) => {
        await inst.game.install(inst.server, log, opts);
        inst.server.installed = true;
        inst.server.lastInstallError = null;
        db.save();
      },
      { setInstalling: true }
    ).catch((err) => {
      inst.server.lastInstallError = err.message;
      db.save();
      throw err;
    });
  }

  /**
   * Update a server.
   *  Minecraft (CurseForge): { fileId } or { latest: true }
   *  Minecraft (custom): { mcVersion, loader, loaderVersion }
   *  ARK: { validate }
   */
  async update(id, opts = {}) {
    const inst = this.get(id);
    const server = inst.server;
    if (inst.isBusy()) throw new HttpError(409, `"${inst.job.label}" is already running`);
    const mc = server.mc;
    let label = 'Update';
    const previous = mc ? JSON.parse(JSON.stringify(mc)) : null;
    if (server.game === 'minecraft' && mc.source === 'curseforge') {
      let fileId = Number(opts.fileId);
      if (opts.latest || !fileId) {
        const files = await cf.getFiles(mc.curseforge.modId, { pageSize: 20 });
        const best = files.find((f) => f.releaseType === 1) || files[0];
        if (!best) throw new HttpError(404, 'No modpack files found');
        fileId = best.id;
      }
      if (fileId === mc.curseforge.fileId && opts.latest) {
        inst.appendConsole('[update] Modpack is already on the latest version.');
        return { upToDate: true };
      }
      mc.curseforge.fileId = fileId;
      label = 'Modpack update';
    } else if (server.game === 'minecraft') {
      if (opts.latest) return { upToDate: true };
      if (opts.mcVersion) mc.mcVersion = String(opts.mcVersion);
      if (opts.loader) mc.loader = String(opts.loader);
      mc.loaderVersion = opts.loaderVersion ? String(opts.loaderVersion) : null;
      mc.javaMajor = null;
      label = 'Version change';
    } else {
      label = opts.validate ? 'Update & validate' : 'Game update';
    }
    db.save();

    const wasRunning = !!inst.child;
    const run = async () => {
      try {
        if (wasRunning) await inst.stop();
        if (server.backupBeforeUpdate !== false && opts.backup !== false && server.installed) {
          await inst.runJob('backup', 'Pre-update backup', (log) => backups.create(inst, { reason: 'pre-update', log }));
        }
        await inst.runJob(
          'update',
          label,
          async (log) => {
            await inst.game.install(server, log, { isUpdate: true, validate: !!opts.validate, reinstallBots: !!opts.reinstallBots });
            server.installed = true;
            server.lastInstallError = null;
            db.save();
          },
          { setInstalling: true }
        );
      } catch (err) {
        if (previous) {
          server.mc = previous; // keep the record pointing at what's actually installed
          inst.appendConsole('[update] Update failed. Your pre-update backup is in the Backups tab if you need to roll back.');
        }
        server.lastInstallError = err.message;
        db.save();
        throw err;
      }
      if (wasRunning) await inst.start();
    };
    const p = run();
    p.catch((e) => log.warn(`Update of ${server.name} failed: ${e.message}`));
    return { started: true, promise: p };
  }

  async backup(id, { reason = 'manual' } = {}) {
    const inst = this.get(id);
    return inst.runJob('backup', 'Backup', (log) => backups.create(inst, { reason, log }));
  }

  async restore(id, name) {
    const inst = this.get(id);
    return inst.runJob('restore', 'Restore backup', (log) => backups.restore(inst, name, log));
  }

  async remove(id, { deleteFiles = true } = {}) {
    const inst = this.get(id);
    if (inst.isBusy()) throw new HttpError(409, 'Wait for the current task to finish');
    if (inst.child) await inst.stop();
    const server = inst.server;
    this.instances.delete(id);
    db.data.servers = db.data.servers.filter((s) => s.id !== id);
    db.save();
    if (deleteFiles) {
      const inside = path.resolve(server.dir).startsWith(path.resolve(config.serversDir) + path.sep);
      if (inside) fs.rmSync(server.dir, { recursive: true, force: true });
      fs.rmSync(backups.dirFor(server), { recursive: true, force: true });
    }
    inst.removeAllListeners();
    this.emit('removed', id, server);
  }

  async shutdownAll() {
    const running = [...this.instances.values()].filter((i) => i.child);
    if (!running.length) return;
    log.info(`Stopping ${running.length} running server(s)...`);
    await Promise.all(running.map((i) => i.stop().catch(() => i.kill())));
  }
}

module.exports = new Manager();
