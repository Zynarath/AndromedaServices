'use strict';
// Community Call of Duty dedicated servers: CoD4x, IW4x (MW2) and Plutonium T6 (BO2), T5 (BO1), IW5 (MW3).
// They all run on your own game install; Andromeda Hosting writes the server config (game mode, shuffled
// map rotation, XP rates, bots) right before every start.
const fs = require('fs');
const path = require('path');
const q3 = require('../util/q3');
const tools = require('../services/codtools');
const { HttpError, randomPassword } = require('../util/misc');

// Bot Warfare difficulty values differ per game (from each mod's README / source).
const SKILLS = {
  default: { def: '0', options: [['0', 'Mixed (random per bot)'], ['1', 'Easiest'], ['3', 'Easy'], ['4', 'Medium'], ['5', 'Hard'], ['7', 'Hardest'], ['9', 'Fully random']] },
  t6: { def: '1', options: [['0', 'Easy'], ['1', 'Normal'], ['2', 'Hard'], ['3', 'Hardest']] },
  t5: { def: 'normal', options: [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['fu', 'Hardest']] },
};
const skillsFor = (key) => SKILLS[key] || SKILLS.default;

const TITLES = {
  cod4x: {
    label: 'Call of Duty 4 (CoD4x)',
    short: 'CoD4x',
    namePrefix: 'CoD4x Server',
    port: 28960,
    platforms: ['win32', 'linux'],
    botRepo: 'ineedbots/cod4x_bot_warfare',
    weaponXp: false,
    gameHint: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Call of Duty 4',
    marker: 'main',
    gametypes: [['dom', 'Domination'], ['war', 'Team Deathmatch'], ['dm', 'Free-for-all'], ['sd', 'Search & Destroy'], ['sab', 'Sabotage'], ['koth', 'Headquarters']],
    maps: [
      ['mp_backlot', 'Backlot'], ['mp_bloc', 'Bloc'], ['mp_bog', 'Bog'], ['mp_cargoship', 'Wet Work'], ['mp_citystreets', 'District'], ['mp_convoy', 'Ambush'],
      ['mp_countdown', 'Countdown'], ['mp_crash', 'Crash'], ['mp_crossfire', 'Crossfire'], ['mp_farm', 'Downpour'], ['mp_overgrown', 'Overgrown'],
      ['mp_pipeline', 'Pipeline'], ['mp_shipment', 'Shipment'], ['mp_showdown', 'Showdown'], ['mp_strike', 'Strike'], ['mp_vacant', 'Vacant'],
    ],
  },
  iw4x: {
    label: 'Modern Warfare 2 (IW4x)',
    short: 'IW4x',
    namePrefix: 'IW4x Server',
    port: 28960,
    platforms: ['win32'],
    botRepo: 'ineedbots/iw4x_bot_warfare',
    weaponXp: false,
    gameHint: 'Your MW2 folder with IW4x installed (contains iw4x.exe)',
    marker: 'iw4x.exe',
    gametypes: [['dom', 'Domination'], ['war', 'Team Deathmatch'], ['dm', 'Free-for-all'], ['sd', 'Search & Destroy'], ['sab', 'Sabotage'], ['koth', 'Headquarters'], ['ctf', 'Capture the Flag'], ['dd', 'Demolition']],
    maps: [
      ['mp_afghan', 'Afghan'], ['mp_derail', 'Derail'], ['mp_estate', 'Estate'], ['mp_favela', 'Favela'], ['mp_highrise', 'Highrise'], ['mp_invasion', 'Invasion'],
      ['mp_checkpoint', 'Karachi'], ['mp_quarry', 'Quarry'], ['mp_rundown', 'Rundown'], ['mp_rust', 'Rust'], ['mp_boneyard', 'Scrapyard'], ['mp_nightshift', 'Skidrow'],
      ['mp_subbase', 'Sub Base'], ['mp_terminal', 'Terminal'], ['mp_underpass', 'Underpass'], ['mp_brecourt', 'Wasteland'],
    ],
  },
  t6: {
    label: 'Black Ops II (Plutonium T6)',
    short: 'BO2',
    namePrefix: 'BO2 Server',
    port: 4976,
    platforms: ['win32'],
    pluto: 't6mp',
    storage: 't6',
    botRepo: 'ineedbots/t6_bot_warfare',
    weaponXp: true,
    gameHint: 'Your Black Ops II folder (contains the zone folder)',
    marker: 'zone',
    gametypes: [['dom', 'Domination'], ['tdm', 'Team Deathmatch'], ['dm', 'Free-for-all'], ['conf', 'Kill Confirmed'], ['hq', 'Headquarters'], ['koth', 'Hardpoint'], ['sd', 'Search & Destroy'], ['ctf', 'Capture the Flag'], ['dem', 'Demolition']],
    maps: [
      ['mp_la', 'Aftermath'], ['mp_dockside', 'Cargo'], ['mp_carrier', 'Carrier'], ['mp_drone', 'Drone'], ['mp_express', 'Express'], ['mp_hijacked', 'Hijacked'],
      ['mp_meltdown', 'Meltdown'], ['mp_overflow', 'Overflow'], ['mp_nightclub', 'Plaza'], ['mp_raid', 'Raid'], ['mp_slums', 'Slums'], ['mp_village', 'Standoff'],
      ['mp_turbine', 'Turbine'], ['mp_socotra', 'Yemen'],
    ],
  },
  t5: {
    label: 'Black Ops (Plutonium T5)',
    short: 'BO1',
    namePrefix: 'BO1 Server',
    port: 28960,
    platforms: ['win32'],
    pluto: 't5mp',
    storage: 't5',
    botRepo: 'ineedbots/t5_bot_warfare',
    weaponXp: true,
    gameHint: 'Your Black Ops folder (contains the zone folder)',
    marker: 'zone',
    gametypes: [['dom', 'Domination'], ['tdm', 'Team Deathmatch'], ['dm', 'Free-for-all'], ['koth', 'Headquarters'], ['sd', 'Search & Destroy'], ['sab', 'Sabotage'], ['ctf', 'Capture the Flag'], ['dem', 'Demolition']],
    maps: [
      ['mp_array', 'Array'], ['mp_cracked', 'Cracked'], ['mp_crisis', 'Crisis'], ['mp_firingrange', 'Firing Range'], ['mp_duga', 'Grid'], ['mp_hanoi', 'Hanoi'],
      ['mp_cairo', 'Havana'], ['mp_havoc', 'Jungle'], ['mp_cosmodrome', 'Launch'], ['mp_nuked', 'Nuketown'], ['mp_radiation', 'Radiation'], ['mp_mountain', 'Summit'],
      ['mp_villa', 'Villa'], ['mp_russianbase', 'WMD'],
    ],
  },
  iw5: {
    label: 'Modern Warfare 3 (Plutonium IW5)',
    short: 'MW3',
    namePrefix: 'MW3 Server',
    port: 27016,
    platforms: ['win32'],
    pluto: 'iw5mp',
    storage: 'iw5',
    botRepo: 'ineedbots/iw5_bot_warfare',
    weaponXp: true,
    gameHint: 'Your Modern Warfare 3 folder (contains the zone folder)',
    marker: 'zone',
    gametypes: [['dom', 'Domination'], ['war', 'Team Deathmatch'], ['dm', 'Free-for-all'], ['conf', 'Kill Confirmed'], ['koth', 'Headquarters'], ['sd', 'Search & Destroy'], ['sab', 'Sabotage'], ['ctf', 'Capture the Flag'], ['dd', 'Demolition'], ['tdef', 'Team Defender']],
    maps: [
      ['mp_alpha', 'Lockdown'], ['mp_bootleg', 'Bootleg'], ['mp_bravo', 'Mission'], ['mp_carbon', 'Carbon'], ['mp_dome', 'Dome'], ['mp_exchange', 'Downturn'],
      ['mp_hardhat', 'Hardhat'], ['mp_interchange', 'Interchange'], ['mp_lambeth', 'Fallen'], ['mp_mogadishu', 'Bakaara'], ['mp_paris', 'Resistance'],
      ['mp_plaza2', 'Arkaden'], ['mp_radar', 'Outpost'], ['mp_seatown', 'Seatown'], ['mp_underground', 'Underground'], ['mp_village', 'Village'],
    ],
  },
};

const title = (server) => TITLES[server.cod.title];
const cfgName = (server) => `hp_${server.id}.cfg`;
const clean = (v) => String(v ?? '').replace(/["\r\n;]/g, '').trim();

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rotationString(t, gametype, maps) {
  if (t === TITLES.iw5) {
    // IW5 picks game modes with DSR files (admin/*.dsr); "war" is TDM_default there.
    const dsr = { war: 'TDM', dm: 'FFA' }[gametype] || gametype.toUpperCase();
    return `dsr ${dsr}_default ` + maps.map((m) => `map ${m}`).join(' ');
  }
  if (t === TITLES.t6) return maps.map((m) => `exec ${gametype}.cfg map ${m}`).join(' ');
  return `gametype ${gametype} ` + maps.map((m) => `map ${m}`).join(' ');
}

// Where the bot mod lives: a server-side iwd mod for IW4x/CoD4x, Plutonium's storage otherwise.
function botsBase(server) {
  return server.cod.title === 'cod4x' ? server.dir : server.cod.gameDir;
}
function botsInstalled(server) {
  const t = title(server);
  if (t.pluto) return fs.existsSync(path.join(tools.plutoStorage(t.storage), 'scripts'));
  return fs.existsSync(path.join(botsBase(server), 'mods', 'mp_bots', 'z_svr_bots.iwd'));
}

function configDirs(server) {
  if (server.cod.title === 'cod4x') return [path.join(server.dir, 'main')];
  if (server.cod.title === 'iw5') return [path.join(server.cod.gameDir, 'admin'), path.join(server.cod.gameDir, 'main')];
  return [path.join(server.cod.gameDir, 'main')];
}

function buildConfig(server) {
  const c = server.cod;
  const t = title(server);
  const validMaps = new Set(t.maps.map((m) => m[0]));
  let maps = (c.maps && c.maps.length ? c.maps : t.maps.map((m) => m[0])).filter((m) => validMaps.has(m));
  if (!maps.length) maps = t.maps.map((m) => m[0]);
  if (c.shuffle !== false) maps = shuffle(maps);
  const lines = [
    `// Generated by Andromeda Hosting for "${clean(server.name)}". Rewritten on every start —`,
    `// add your own settings in the panel under Settings → Extra config lines.`,
    `set sv_hostname "${clean(c.hostname || server.name)}"`,
    `set g_password "${clean(c.password)}"`,
    `set rcon_password "${clean(c.rconPassword)}"`,
    `set sv_maxclients "${Math.max(2, Math.min(64, Number(c.maxClients) || 18))}"`,
    `set g_gametype "${clean(c.gametype || 'dom')}"`,
    `set scr_xpscale "${Number(c.xpScale) || 1}"`,
  ];
  if (t.weaponXp) lines.push(`set scr_weaponxpscale "${Number(c.weaponXpScale) || 1}"`);
  lines.push(`set logfile "2"`, `set g_log "hp_${server.id}_games.log"`);
  if (!t.pluto) lines.push(`set sv_allowDownload "1"`);
  const b = c.bots || {};
  lines.push(
    '// Bots (Bot Warfare)',
    `set bots_manage_add "0"`,
    `set bots_manage_fill "${b.enabled ? Math.max(0, Number(b.fill) || 0) : 0}"`,
    `set bots_manage_fill_mode "0"`,
    `set bots_manage_fill_kick "${b.kick !== false ? 1 : 0}"`,
    `set bots_skill "${clean(b.skill ?? skillsFor(c.title).def)}"`,
    `set bots_team "autoassign"`
  );
  if (c.extraConfig) lines.push('// Extra config lines from the panel', ...String(c.extraConfig).split(/\r?\n/));
  lines.push('// Map rotation (all selected maps, shuffled)', `set sv_mapRotation "${rotationString(t, c.gametype || 'dom', maps)}"`, `set sv_mapRotationCurrent ""`);
  return lines.join('\r\n') + '\r\n';
}

function writeConfig(server) {
  const text = buildConfig(server);
  for (const dir of configDirs(server)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, cfgName(server)), text);
  }
  fs.mkdirSync(server.dir, { recursive: true });
  fs.writeFileSync(path.join(server.dir, 'generated-server.cfg'), text); // visible copy in the Files tab
  return text;
}

function checkGameDir(server) {
  const c = server.cod;
  const t = title(server);
  if (!c.gameDir || !path.isAbsolute(c.gameDir)) throw new HttpError(400, `Set the game folder for ${t.label} (e.g. ${t.gameHint})`);
  if (!fs.existsSync(c.gameDir)) throw new HttpError(400, `Game folder not found: ${c.gameDir}`);
  if (!fs.existsSync(path.join(c.gameDir, t.marker))) {
    throw new HttpError(400, `${c.gameDir} doesn't look like a ${t.label} install (no "${t.marker}" inside).${server.cod.title === 'iw4x' ? ' Install IW4x into your MW2 folder first (iw4x.exe must be there).' : ''}`);
  }
}

const cod = {
  id: 'cod',
  name: 'Call of Duty',
  consoleMode: 'rcon',
  stopTimeoutMs: 30000,
  TITLES,

  defaults(input) {
    const c = input.cod || {};
    const key = TITLES[c.title] ? c.title : 'iw4x';
    const t = TITLES[key];
    const b = c.bots || {};
    return {
      title: key,
      gameDir: String(c.gameDir || '').trim(),
      port: Number(c.port) || t.port,
      hostname: c.hostname || input.name,
      password: c.password ?? '',
      rconPassword: randomPassword(16),
      maxClients: Number(c.maxClients) || 18,
      gametype: c.gametype || 'dom',
      maps: t.maps.map((m) => m[0]),
      shuffle: true,
      xpScale: Number(c.xpScale) || 4,
      weaponXpScale: Number(c.weaponXpScale) || 4,
      bots: {
        enabled: b.enabled !== false,
        fill: Number(b.fill ?? 12) || 0,
        skill: skillsFor(key).options.some((o) => o[0] === String(b.skill)) ? String(b.skill) : skillsFor(key).def,
        kick: b.kick !== false,
      },
      botsVersion: null,
      plutoKey: String(c.plutoKey || '').trim(),
      extraConfig: '',
    };
  },

  ports(server) {
    return [{ port: server.cod.port, proto: 'UDP', label: 'Game', forward: true }];
  },

  connectAddress(server, host) {
    return `${host}:${server.cod.port}`;
  },

  async install(server, log, opts = {}) {
    const t = title(server);
    if (!t.platforms.includes(process.platform)) throw new Error(`${t.label} servers need Windows.`);
    checkGameDir(server);
    fs.mkdirSync(server.dir, { recursive: true });
    if (server.cod.title === 'cod4x') {
      await tools.installCod4x(server.dir, log);
      tools.linkGameFiles(server.cod.gameDir, server.dir, log);
    } else if (t.pluto) {
      await tools.updatePlutonium(log);
    } else {
      log.info(`Using IW4x from ${server.cod.gameDir}`);
    }
    if (server.cod.bots.enabled || opts.reinstallBots) {
      try {
        server.cod.botsVersion = await tools.installBotWarfare({ repo: t.botRepo, title: server.cod.title, modBase: botsBase(server), storage: t.storage }, log);
      } catch (err) {
        log.warn(`Bots could not be installed automatically: ${err.message}`);
        log.warn(`The server still works without bots. To add them by hand, follow the README at github.com/${t.botRepo}.`);
      }
    }
    writeConfig(server);
    log.info(`${t.label} server is ready. Config: ${cfgName(server)}`);
  },

  async buildLaunch(server) {
    const c = server.cod;
    const t = title(server);
    checkGameDir(server);
    writeConfig(server);
    const port = String(c.port);
    const fsGame = !t.pluto && c.bots.enabled && botsInstalled(server) ? ['+set', 'fs_game', 'mods/mp_bots'] : [];
    if (server.cod.title === 'cod4x') {
      const exe = tools.findCod4xExe(server.dir);
      if (!exe) throw new HttpError(400, 'CoD4x server files are missing. Use Reinstall in Settings.');
      return {
        command: exe,
        args: ['+set', 'dedicated', '2', '+set', 'net_port', port, '+set', 'fs_homepath', server.dir, ...fsGame, '+exec', cfgName(server), '+map_rotate'],
        cwd: server.dir,
      };
    }
    if (server.cod.title === 'iw4x') {
      return {
        command: path.join(c.gameDir, 'iw4x.exe'),
        args: ['-dedicated', '-stdout', '+set', 'net_port', port, ...fsGame, '+exec', cfgName(server), '+map_rotate'],
        cwd: c.gameDir,
      };
    }
    if (!fs.existsSync(tools.plutoBootstrapper())) throw new HttpError(400, 'Plutonium is not installed yet. Install it from plutonium.pw, or use Reinstall in Settings.');
    if (!c.plutoKey) throw new HttpError(400, 'Add your Plutonium server key in Settings (free at platform.plutonium.pw/serverkeys).');
    return {
      command: tools.plutoBootstrapper(),
      args: [t.pluto, c.gameDir, '-dedicated', '+set', 'key', c.plutoKey, '+set', 'net_port', port, '+exec', cfgName(server), server.cod.title === 'iw5' ? '+start_map_rotate' : '+map_rotate'],
      cwd: tools.plutoRoot(),
      // Plutonium's console goes to its own window, so follow the console log instead.
      logFile: [path.join(c.gameDir, 'main', 'console_mp.log'), path.join(tools.plutoStorage(t.storage), 'main', 'console_mp.log'), path.join(tools.plutoStorage(t.storage), 'console_mp.log')],
    };
  },

  async probeReady(server) {
    await q3.getStatus('127.0.0.1', server.cod.port);
    return true;
  },

  async stop(instance) {
    try {
      await q3.rcon('127.0.0.1', instance.server.cod.port, instance.server.cod.rconPassword, 'quit', { timeout: 1500 });
    } catch {}
    // Some builds don't answer "quit" over RCON; make sure the process goes away.
    setTimeout(() => instance.child && instance.kill(), 8000);
  },

  async sendCommand(instance, command) {
    const out = await q3.rcon('127.0.0.1', instance.server.cod.port, instance.server.cod.rconPassword, command.replace(/^\//, ''));
    instance.appendConsole(`[rcon] ${q3.stripColors(out).trim() || '(no response)'}`);
    return out;
  },

  broadcastCommand(msg) {
    return `say "${clean(msg)}"`;
  },

  async query(server) {
    const st = await q3.getStatus('127.0.0.1', server.cod.port);
    // Bots report a ping of 0 (or 999); real players don't.
    const humans = st.players.filter((p) => p.ping > 0 && p.ping < 999);
    return { online: humans.length, max: st.maxClients || server.cod.maxClients, players: humans.map((p) => p.name), bots: st.players.length - humans.length, map: st.map };
  },

  backupConfig(server) {
    return { root: server.dir, ignore: ['**/*.exe', '**/*.dll', '**/*.so', 'zone/**', 'main/*.iwd', 'mods/**'] };
  },

  settingsSchema(server) {
    const t = title(server);
    const sections = [
      {
        title: 'Server',
        fields: [
          { key: 'cod.hostname', label: 'Name in the server browser', type: 'text' },
          { key: 'cod.password', label: 'Join password (blank = anyone can join)', type: 'text' },
          { key: 'cod.maxClients', label: 'Max players (including bots)', type: 'number' },
          { key: 'cod.port', label: 'Port (UDP)', type: 'number' },
        ],
      },
      {
        title: 'Game mode & maps',
        fields: [
          { key: 'cod.gametype', label: 'Game mode', type: 'select', options: t.gametypes.map(([value, label]) => ({ value, label })) },
          { key: 'cod.shuffle', label: 'Shuffle the map rotation every start', type: 'bool' },
          { key: 'cod.maps', label: 'Maps in rotation', type: 'checklist', options: t.maps.map(([value, label]) => ({ value, label })) },
        ],
      },
      {
        title: 'XP',
        fields: [
          { key: 'cod.xpScale', label: 'Player XP multiplier', type: 'number', step: 1 },
          ...(t.weaponXp ? [{ key: 'cod.weaponXpScale', label: 'Weapon XP multiplier', type: 'number', step: 1 }] : []),
        ],
      },
      {
        title: 'Bots',
        fields: [
          { key: 'cod.bots.enabled', label: 'Fill the server with bots', type: 'bool' },
          { key: 'cod.bots.fill', label: 'Keep this many players in the match (bots + people)', type: 'number', hint: '12 = 6v6. Bots leave as real players join.' },
          { key: 'cod.bots.skill', label: 'Bot difficulty', type: 'select', options: skillsFor(server.cod.title).options.map(([value, label]) => ({ value, label })) },
          { key: 'cod.bots.kick', label: 'Remove a bot when a real player joins', type: 'bool' },
        ],
      },
      {
        title: 'Advanced',
        fields: [
          { key: 'cod.gameDir', label: 'Game folder', type: 'text', admin: true, hint: t.gameHint },
          ...(t.pluto ? [{ key: 'cod.plutoKey', label: 'Plutonium server key', type: 'text', admin: true, hint: 'Free: sign in at platform.plutonium.pw → Server Keys → create one.' }] : []),
          { key: 'cod.extraConfig', label: 'Extra config lines', type: 'textarea', admin: true, hint: 'Admin only. Added to the generated config, e.g. set scr_dom_scorelimit 300' },
        ],
      },
    ];
    return { note: `Andromeda Hosting writes ${cfgName(server)} before every start (a copy is in the Files tab as generated-server.cfg).`, sections };
  },

  readSettings(server) {
    const c = server.cod;
    return {
      'cod.hostname': c.hostname,
      'cod.password': c.password,
      'cod.maxClients': c.maxClients,
      'cod.port': c.port,
      'cod.gametype': c.gametype,
      'cod.shuffle': c.shuffle !== false,
      'cod.maps': c.maps,
      'cod.xpScale': c.xpScale,
      'cod.weaponXpScale': c.weaponXpScale,
      'cod.bots.enabled': !!c.bots.enabled,
      'cod.bots.fill': c.bots.fill,
      'cod.bots.skill': String(c.bots.skill ?? skillsFor(c.title).def),
      'cod.bots.kick': c.bots.kick !== false,
      'cod.gameDir': c.gameDir,
      'cod.plutoKey': c.plutoKey,
      'cod.extraConfig': c.extraConfig,
    };
  },

  writeSettings(server, v, opts = {}) {
    const c = server.cod;
    const t = title(server);
    const num = (x, min, max, def) => Math.max(min, Math.min(max, Number.isFinite(Number(x)) && x !== '' ? Number(x) : def));
    if ('cod.hostname' in v) c.hostname = clean(v['cod.hostname']).slice(0, 64) || server.name;
    if ('cod.password' in v) c.password = clean(v['cod.password']).replace(/\s/g, '').slice(0, 32);
    if ('cod.maxClients' in v) c.maxClients = num(v['cod.maxClients'], 2, 64, 18);
    if ('cod.port' in v) c.port = num(v['cod.port'], 1024, 65535, t.port);
    if ('cod.gametype' in v && t.gametypes.some((g) => g[0] === v['cod.gametype'])) c.gametype = v['cod.gametype'];
    if ('cod.shuffle' in v) c.shuffle = !!v['cod.shuffle'];
    if ('cod.maps' in v && Array.isArray(v['cod.maps'])) {
      const valid = new Set(t.maps.map((m) => m[0]));
      const picked = v['cod.maps'].filter((m) => valid.has(m));
      if (!picked.length) throw new HttpError(400, 'Pick at least one map');
      c.maps = picked;
    }
    if ('cod.xpScale' in v) c.xpScale = num(v['cod.xpScale'], 1, 100, 1);
    if ('cod.weaponXpScale' in v) c.weaponXpScale = num(v['cod.weaponXpScale'], 1, 100, 1);
    if ('cod.bots.enabled' in v) c.bots.enabled = !!v['cod.bots.enabled'];
    if ('cod.bots.fill' in v) c.bots.fill = num(v['cod.bots.fill'], 0, 64, 12);
    if ('cod.bots.skill' in v && skillsFor(c.title).options.some((o) => o[0] === String(v['cod.bots.skill']))) c.bots.skill = String(v['cod.bots.skill']);
    if ('cod.bots.kick' in v) c.bots.kick = !!v['cod.bots.kick'];
    // The game folder decides which executable the panel launches, the Plutonium key authenticates
    // it, and extra config is free text written into the server config — all admin only.
    if ('cod.gameDir' in v && opts.admin) {
      const dir = String(v['cod.gameDir'] || '').trim();
      if (dir && (dir.startsWith('\\\\') || dir.startsWith('//'))) throw new HttpError(400, 'Network paths (\\\\server\\share) are not allowed for the game folder.');
      c.gameDir = dir;
    }
    if ('cod.plutoKey' in v && opts.admin) c.plutoKey = String(v['cod.plutoKey'] || '').trim();
    if ('cod.extraConfig' in v && opts.admin) c.extraConfig = String(v['cod.extraConfig'] || '').slice(0, 20000);
    return { restartRequired: true };
  },
};

module.exports = cod;
module.exports.buildConfig = buildConfig;
module.exports.rotationString = rotationString;
module.exports.SKILLS = SKILLS;
