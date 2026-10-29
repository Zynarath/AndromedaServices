'use strict';
// Community Call of Duty dedicated servers: CoD4x, IW4x (MW2), Plutonium T6 (BO2), T5 (BO1), IW5 (MW3),
// and AlterWare's S1x (Advanced Warfare) and IW6x (Ghosts).
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
    wikiGame: 'Call of Duty 4: Modern Warfare',
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
    wikiGame: 'Modern Warfare 2',
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
    wikiGame: 'Black Ops II',
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
      // Not in the base game: never part of a default rotation, since players without them can't join.
      ['mp_nuketown_2020', 'Nuketown 2025', 'bonus map'],
      ['mp_downhill', 'Downhill', 'DLC'], ['mp_hydro', 'Hydro', 'DLC'], ['mp_mirage', 'Mirage', 'DLC'], ['mp_skate', 'Grind', 'DLC'],
      ['mp_concert', 'Encore', 'DLC'], ['mp_magma', 'Magma', 'DLC'], ['mp_studio', 'Studio', 'DLC'], ['mp_vertigo', 'Vertigo', 'DLC'],
      ['mp_bridge', 'Detour', 'DLC'], ['mp_castaway', 'Cove', 'DLC'], ['mp_paintball', 'Rush', 'DLC'], ['mp_uplink', 'Uplink', 'DLC'],
      ['mp_dig', 'Dig', 'DLC'], ['mp_frostbite', 'Frost', 'DLC'], ['mp_pod', 'Pod', 'DLC'], ['mp_takeoff', 'Takeoff', 'DLC'],
    ],
    // Fixed map sets that replace the ticked maps; the game mode setting still applies.
    playlists: {
      nukejacked: { label: 'NukeJacked: Nuketown 2025 + Hijacked', maps: ['mp_nuketown_2020', 'mp_hijacked'] },
    },
  },
  t5: {
    wikiGame: 'Call of Duty: Black Ops',
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
    wikiGame: 'Modern Warfare 3',
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
  // AlterWare clients (alterware.dev): installed into your own game folder by the AlterWare launcher,
  // like IW4x. Older XLabs builds used s1x.exe / iw6x.exe, so those names work too.
  s1x: {
    wikiGame: 'Advanced Warfare',
    label: 'Advanced Warfare (S1x)',
    short: 'S1x',
    namePrefix: 'S1x Server',
    port: 27016,
    platforms: ['win32'],
    botRepo: null,
    weaponXp: false,
    gameHint: 'Your Advanced Warfare folder with the AlterWare client installed (contains s1-mod.exe)',
    exes: ['s1-mod.exe', 's1x.exe'],
    gametypes: [['dom', 'Domination'], ['war', 'Team Deathmatch'], ['dm', 'Free-for-all'], ['conf', 'Kill Confirmed'], ['hp', 'Hardpoint'], ['sd', 'Search & Destroy'], ['ctf', 'Capture the Flag'], ['ball', 'Uplink'], ['twar', 'Momentum'], ['infect', 'Infected']],
    maps: [
      ['mp_laser2', 'Ascend'], ['mp_lab2', 'Bio Lab'], ['mp_comeback', 'Comeback'], ['mp_detroit', 'Detroit'], ['mp_greenband', 'Greenband'], ['mp_levity', 'Horizon'],
      ['mp_instinct', 'Instinct'], ['mp_recovery', 'Recovery'], ['mp_venus', 'Retreat'], ['mp_prison', 'Riot'], ['mp_solar', 'Solar'], ['mp_terrace', 'Terrace'],
    ],
  },
  iw6x: {
    wikiGame: 'Ghosts',
    label: 'Ghosts (IW6x)',
    short: 'IW6x',
    namePrefix: 'IW6x Server',
    port: 27016,
    platforms: ['win32'],
    botRepo: null,
    weaponXp: false,
    gameHint: 'Your Call of Duty: Ghosts folder with the AlterWare client installed (contains iw6-mod.exe)',
    exes: ['iw6-mod.exe', 'iw6x.exe'],
    gametypes: [['dom', 'Domination'], ['war', 'Team Deathmatch'], ['dm', 'Free-for-all'], ['conf', 'Kill Confirmed'], ['sd', 'Search & Destroy'], ['sr', 'Search & Rescue'], ['blitz', 'Blitz'], ['cranked', 'Cranked'], ['grind', 'Grind'], ['infect', 'Infected']],
    maps: [
      ['mp_chasm', 'Chasm'], ['mp_flooded', 'Flooded'], ['mp_frag', 'Freight'], ['mp_dart', 'Octane'], ['mp_zebra', 'Overlord'], ['mp_prisonbreak', 'Prison Break'],
      ['mp_hashima', 'Siege'], ['mp_sovereign', 'Sovereign'], ['mp_skeleton', 'Stonehaven'], ['mp_fahrenheit', 'Stormfront'], ['mp_strikezone', 'Strikezone'],
      ['mp_lonestar', 'Tremor'], ['mp_warhawk', 'Warhawk'], ['mp_snow', 'Whiteout'],
    ],
  },
};
// Titles run from your game folder with the client's own executable (no extra downloads).
const findExe = (t, dir) => (t.exes || []).map((e) => path.join(dir, e)).find((p) => fs.existsSync(p)) || null;

// Match rules, written the way each game takes them:
//  - BO2 (Plutonium T6): "gts" names from Plutonium's T6 server configs (storage/t6/gamesettings/*.cfg)
//  - CoD4x, MW2 (IW4x), BO1 (Plutonium T5), AW (S1x), Ghosts (IW6x): the series' scr_ dvars (scr_<mode>_timelimit, ...)
//  - MW3 (Plutonium IW5) takes them from DSR files instead, so the panel doesn't offer them there.
// `key` is what's stored; blank = the game mode's default; `always` = written even when blank.
const RULES_KIND = { t6: 'gts', cod4x: 'scr', iw4x: 'scr', t5: 'scr', s1x: 'scr', iw6x: 'scr' };
const MATCH_RULES = [
  { key: 'hardcoreMode', scr: 'scr_hardcore', label: 'Hardcore', type: 'bool' },
  { key: 'friendlyfiretype', scr: 'scr_team_fftype', label: 'Friendly fire', type: 'select', options: [['0', 'Off'], ['1', 'On'], ['2', 'Reflect'], ['3', 'Shared']] },
  { key: 'allowKillcam', scr: 'scr_game_allowkillcam', label: 'Killcam', type: 'bool' },
  { key: 'allowFinalKillcam', label: 'Final killcam', type: 'bool' },
  // Plutonium's own mode files turn this on explicitly, so the panel does too unless it's set to off.
  { key: 'autoTeamBalance', scr: 'scr_teambalance', label: 'Auto-balance teams', type: 'bool', always: true, def: true },
  { key: 'playerMaxHealth', scr: 'scr_player_maxhealth', label: 'Player health', type: 'number', hint: '100 is normal; Hardcore uses 30' },
  { key: 'playerHealthRegenTime', scr: 'scr_player_healthregentime', label: 'Health regeneration delay (seconds)', type: 'number' },
  { key: 'prematchPeriod', label: 'Pre-match countdown (seconds)', type: 'number' },
];
// `scr` is the part after scr_<mode>_.
const MODE_RULES = [
  { key: 'timeLimit', scr: 'timelimit', label: 'Time limit (minutes, 0 = none)', type: 'number' },
  { key: 'scoreLimit', scr: 'scorelimit', label: 'Score limit (0 = none)', type: 'number' },
  { key: 'roundLimit', scr: 'roundlimit', label: 'Rounds (0 = none)', type: 'number', rounds: true },
  { key: 'roundWinLimit', scr: 'winlimit', label: 'Round wins to win the match (0 = none)', type: 'number', rounds: true },
  { key: 'playerNumLives', scr: 'numlives', label: 'Lives per player (0 = unlimited)', type: 'number' },
  { key: 'playerRespawnDelay', scr: 'playerrespawndelay', label: 'Respawn delay (seconds)', type: 'number' },
];
const ROUND_MODES = new Set(['sd', 'sab', 'dd', 'dem', 'ctf']);
const rulesFor = (title, list) => (RULES_KIND[title] === 'scr' ? list.filter((f) => f.scr) : RULES_KIND[title] ? list : []);

// Bot Warfare dvars each game's version documents in its README (ineedbots/<game>_bot_warfare).
const BOT_DVARS = {
  common: ['bots_main_waitForHostTime', 'bots_main_kickBotsAtEnd', 'bots_manage_fill_mode', 'bots_manage_fill_spec', 'bots_team', 'bots_team_amount', 'bots_team_force', 'bots_loadout_rank', 'bots_play_nade', 'bots_play_aim'],
  t6: ['bots_loadout_prestige', 'bots_play_jumpdrop'],
  cod4x: ['bots_main_chat', 'bots_manage_fill_watchplayers', 'bots_loadout_reasonable', 'bots_loadout_allow_op', 'bots_play_knife', 'bots_play_obj', 'bots_play_camp', 'bots_play_jumpdrop', 'bots_play_killstreak', 'bots_play_ads'],
  iw4x: ['bots_main_chat', 'bots_manage_fill_watchplayers', 'bots_loadout_reasonable', 'bots_loadout_allow_op', 'bots_loadout_prestige', 'bots_play_knife', 'bots_play_take_carepackages', 'bots_play_obj', 'bots_play_camp', 'bots_play_jumpdrop', 'bots_play_killstreak', 'bots_play_ads'],
  iw5: ['bots_main_chat', 'bots_manage_fill_watchplayers', 'bots_loadout_reasonable', 'bots_loadout_allow_op', 'bots_loadout_prestige', 'bots_play_knife', 'bots_play_take_carepackages', 'bots_play_obj', 'bots_play_camp', 'bots_play_jumpdrop', 'bots_play_killstreak', 'bots_play_ads'],
  t5: ['bots_manage_fill_watchplayers', 'bots_loadout_reasonable', 'bots_loadout_allow_op', 'bots_loadout_prestige', 'bots_loadout_codpoints', 'bots_play_knife', 'bots_play_take_carepackages', 'bots_play_obj', 'bots_play_camp', 'bots_play_killstreak'],
};
const BOT_FIELDS = [
  // Mode 4 ("bots are used for balancing teams") is in every version's source; the README lists it for most.
  { key: 'fillMode', dvar: 'bots_manage_fill_mode', label: 'How bots fill the server', type: 'select', options: [['0', 'Count bots and real players'], ['1', 'Count only bots'], ['4', 'Use bots to even out the teams']], def: '0' },
  { key: 'fillWatch', dvar: 'bots_manage_fill_watchplayers', label: 'Only add bots once a real player joins', type: 'bool', def: false },
  { key: 'fillSpec', dvar: 'bots_manage_fill_spec', label: 'Count spectators as players', type: 'bool', def: true },
  { key: 'team', dvar: 'bots_team', label: 'Bot team', type: 'select', options: [['autoassign', 'Auto-assign'], ['allies', 'All on one team (allies)'], ['axis', 'All on the other team (axis)'], ['custom', 'Custom split']], def: 'autoassign' },
  { key: 'teamAmount', dvar: 'bots_team_amount', label: 'Custom split: bots on the axis team', type: 'number', def: 0, min: 0, max: 64, hint: 'The rest go to allies' },
  // When a player joins, Bot Warfare kicks a bot from the team with the most bots, ignoring people,
  // so teams end up uneven unless this moves bots across (it checks every 1.5 s).
  { key: 'teamForce', dvar: 'bots_team_force', label: 'Keep teams even by moving bots', type: 'bool', def: true },
  { key: 'rank', dvar: 'bots_loadout_rank', label: 'Bot rank', type: 'number', def: -1, min: -1, max: 100, hint: '-1 = average of the players, 0 = random, or a rank' },
  { key: 'prestige', dvar: 'bots_loadout_prestige', label: 'Bot prestige', type: 'number', def: -1, min: -2, max: 20, hint: '-1 = same as the host, -2 = random, or a prestige' },
  { key: 'codpoints', dvar: 'bots_loadout_codpoints', label: 'Bot COD Points to spend', type: 'number', def: -1, min: -1, max: 10000000, hint: '-1 = average of the players, 0 = random, or an amount' },
  { key: 'reasonable', dvar: 'bots_loadout_reasonable', label: 'Bots skip weak class setups', type: 'bool', def: false },
  { key: 'allowOp', dvar: 'bots_loadout_allow_op', label: 'Bots may use overpowered/annoying classes', type: 'bool', def: true },
  { key: 'nade', dvar: 'bots_play_nade', label: 'Bots throw grenades', type: 'bool', def: true },
  { key: 'knife', dvar: 'bots_play_knife', label: 'Bots knife', type: 'bool', def: true },
  { key: 'jumpdrop', dvar: 'bots_play_jumpdrop', label: 'Bots jump/drop shot', type: 'bool', def: true },
  { key: 'ads', dvar: 'bots_play_ads', label: 'Bots aim down sights', type: 'bool', def: true },
  { key: 'aim', dvar: 'bots_play_aim', label: 'Bots aim', type: 'bool', def: true },
  { key: 'obj', dvar: 'bots_play_obj', label: 'Bots play the objective', type: 'bool', def: true },
  { key: 'camp', dvar: 'bots_play_camp', label: 'Bots camp', type: 'bool', def: true },
  { key: 'killstreak', dvar: 'bots_play_killstreak', label: 'Bots use killstreaks', type: 'bool', def: true },
  { key: 'carePackages', dvar: 'bots_play_take_carepackages', label: 'Bots take care packages', type: 'bool', def: true },
  { key: 'chat', dvar: 'bots_main_chat', label: 'Bot chat rate (0 = silent)', type: 'number', def: 1, min: 0, max: 10, float: true },
  { key: 'kickAtEnd', dvar: 'bots_main_kickBotsAtEnd', label: 'Kick bots at the end of each match', type: 'bool', def: false },
  { key: 'waitForHost', dvar: 'bots_main_waitForHostTime', label: 'Wait before adding bots (seconds)', type: 'number', def: 10, min: 0, max: 600 },
];
const botFieldsFor = (title) => {
  const ok = new Set([...BOT_DVARS.common, ...(BOT_DVARS[title] || [])]);
  return BOT_FIELDS.filter((f) => ok.has(f.dvar));
};
const gtsCfgName = (server, gametype) => `hp_${server.id}_${gametype}.cfg`;
// "execgts <file>" in the map rotation loads <file> from Plutonium's storage/t6/gamesettings folder.
const gtsDir = () => path.join(tools.plutoStorage('t6'), 'gamesettings');

const title = (server) => TITLES[server.cod.title];
const baseMaps = (t) => t.maps.filter((m) => !m[2]).map((m) => m[0]);
const playlist = (server) => (title(server).playlists || {})[server.cod.playlist];
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

function rotationString(t, gametype, maps, gtsCfg) {
  if (t === TITLES.iw5) {
    // IW5 picks game modes with DSR files (admin/*.dsr); "war" is TDM_default there.
    const dsr = { war: 'TDM', dm: 'FFA' }[gametype] || gametype.toUpperCase();
    return `dsr ${dsr}_default ` + maps.map((m) => `map ${m}`).join(' ');
  }
  // Plutonium T6 rotation tokens (from its server configs): "gametype <mode>" sets the mode and must
  // come first; "execgts <file>" loads storage/t6/gamesettings/<file> (the panel's rules); then "map".
  if (t === TITLES.t6) return maps.map((m) => `gametype ${gametype} execgts ${gtsCfg || gametype + '.cfg'} map ${m}`).join(' ');
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
  const list = playlist(server);
  let maps = (list ? list.maps : c.maps && c.maps.length ? c.maps : baseMaps(t)).filter((m) => validMaps.has(m));
  if (!maps.length) maps = baseMaps(t);
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
  if (t.botRepo) {
    lines.push(
      '// Bots (Bot Warfare)',
      `set bots_manage_add "0"`,
      `set bots_manage_fill "${b.enabled ? Math.max(0, Number(b.fill) || 0) : 0}"`,
      `set bots_manage_fill_kick "${b.kick !== false ? 1 : 0}"`,
      `set bots_skill "${clean(b.skill ?? skillsFor(c.title).def)}"`
    );
    for (const f of botFieldsFor(c.title)) lines.push(`set ${f.dvar} "${dvarValue(f, b[f.key] ?? f.def)}"`);
  }
  if (RULES_KIND[c.title] === 'scr') lines.push(...scrRuleLines(c));
  if (c.extraConfig) lines.push('// Extra config lines from the panel', ...String(c.extraConfig).split(/\r?\n/));
  const gametype = c.gametype || 'dom';
  // BO2 picks the mode and its rules from a gamesettings file the rotation loads before each map.
  const gtsCfg = c.title === 't6' ? gtsCfgName(server, gametype) : null;
  lines.push(`// Map rotation (${list ? list.label : 'selected maps'}${c.shuffle !== false ? ', shuffled' : ''})`, `set sv_mapRotation "${rotationString(t, gametype, maps, gtsCfg)}"`, `set sv_mapRotationCurrent ""`);
  return lines.join('\r\n') + '\r\n';
}

function dvarValue(f, v) {
  if (f.type === 'bool') return v ? 1 : 0;
  return clean(v);
}

// BO2 gamesettings file, laid out like Plutonium's own (storage/t6/gamesettings/<mode>.cfg): the
// game's default and mode settings, then set_gametype, then the panel's rules for that mode.
function buildGtsConfig(server) {
  const c = server.cod;
  const gametype = c.gametype || 'dom';
  const lines = [
    `// Generated by Andromeda Hosting: ${gametype} rules for "${clean(server.name)}". Rewritten on every start.`,
    `execgts gamesettings_default.cfg`,
    `execgts gamesettings_${gametype}.cfg`,
    `execgts gamesettings_default.cfg`,
    `execgts gamesettings_${gametype}.cfg`,
    `set_gametype ${gametype}`,
  ];
  for (const [f, v] of activeRules(c)) lines.push(`gts ${f.key} "${dvarValue(f, v)}"`);
  return lines.join('\r\n') + '\r\n';
}

// [field, value] for every rule that applies to the selected game mode and has a value to write.
function activeRules(c) {
  const gametype = c.gametype || 'dom';
  const rules = [
    ...rulesFor(c.title, MATCH_RULES).map((f) => [f, (c.match || {})[f.key], false]),
    ...rulesFor(c.title, MODE_RULES)
      .filter((f) => !f.rounds || ROUND_MODES.has(gametype))
      .map((f) => [f, ((c.modes || {})[gametype] || {})[f.key], true]),
  ];
  const out = [];
  for (const [f, set, perMode] of rules) {
    const v = set === undefined || set === null || set === '' ? (f.always ? f.def : null) : set;
    if (v !== null && v !== undefined) out.push([f, v, perMode]);
  }
  return out;
}

// CoD4x, MW2, BO1: plain dvars in the server config (scr_<mode>_... for the selected mode).
function scrRuleLines(c) {
  const gametype = clean(c.gametype || 'dom');
  const rules = activeRules(c);
  if (!rules.length) return [];
  return ['// Match rules', ...rules.map(([f, v, perMode]) => `set ${perMode ? `scr_${gametype}_${f.scr}` : f.scr} "${dvarValue(f, v)}"`)];
}

function writeConfig(server) {
  const text = buildConfig(server);
  for (const dir of configDirs(server)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, cfgName(server)), text);
  }
  if (server.cod.title === 't6') {
    fs.mkdirSync(gtsDir(), { recursive: true });
    fs.writeFileSync(path.join(gtsDir(), gtsCfgName(server, server.cod.gametype || 'dom')), buildGtsConfig(server));
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
  if (t.exes) {
    if (!findExe(t, c.gameDir)) throw new HttpError(400, `${c.gameDir} doesn't have the ${t.short} client (${t.exes.join(' or ')}). Install it into your game folder with the AlterWare launcher (alterware.dev) first.`);
  } else if (!fs.existsSync(path.join(c.gameDir, t.marker))) {
    throw new HttpError(400, `${c.gameDir} doesn't look like a ${t.label} install (no "${t.marker}" inside).${server.cod.title === 'iw4x' ? ' Install IW4x into your MW2 folder first (iw4x.exe must be there).' : ''}`);
  }
}

function schemaField(key, f) {
  return { key, label: f.label, type: f.type, hint: f.hint, def: f.def, options: f.options && f.options.map(([value, label]) => ({ value, label })) };
}

// Selects get a "game default" choice so a rule can be left to the game mode.
function ruleField(key, f) {
  const field = schemaField(key, f);
  if (f.type === 'select') field.options = [{ value: '', label: 'Game default' }, ...field.options];
  if (f.type === 'bool') {
    field.type = 'select';
    field.options = [{ value: '', label: f.always ? `Default (${f.def ? 'on' : 'off'})` : 'Game default' }, { value: '1', label: 'On' }, { value: '0', label: 'Off' }];
  }
  if (f.type === 'number') field.hint = [f.hint, 'Blank = game default'].filter(Boolean).join('. ');
  return field;
}

function ruleSections(server, t) {
  const match = rulesFor(server.cod.title, MATCH_RULES);
  const mode = rulesFor(server.cod.title, MODE_RULES);
  if (!match.length) return [];
  return [
    { title: 'Match rules (all game modes)', fields: match.map((f) => ruleField('cod.match.' + f.key, f)) },
    ...t.gametypes.map(([gt, label]) => ({
      title: `${label} rules`,
      // Shown only while this game mode is picked above.
      showIf: { key: 'cod.gametype', value: gt },
      fields: mode.filter((f) => !f.rounds || ROUND_MODES.has(gt)).map((f) => ruleField(`cod.mode.${gt}.${f.key}`, f)),
    })),
  ];
}

function ruleAndBotValues(c) {
  const out = {};
  const shown = (v) => (v === null || v === undefined ? '' : String(v));
  for (const f of rulesFor(c.title, MATCH_RULES)) out['cod.match.' + f.key] = shown((c.match || {})[f.key]);
  for (const [gt] of TITLES[c.title].gametypes) for (const f of rulesFor(c.title, MODE_RULES)) out[`cod.mode.${gt}.${f.key}`] = shown(((c.modes || {})[gt] || {})[f.key]);
  const b = c.bots || {};
  for (const f of botFieldsFor(c.title)) out['cod.bots.' + f.key] = f.type === 'bool' ? !!(b[f.key] ?? f.def) : String(b[f.key] ?? f.def);
  return out;
}

function ruleValue(f, v) {
  if (v === '' || v === null || v === undefined) return null;
  if (f.type === 'bool') return v === true || v === '1' || v === 1 ? 1 : 0;
  if (f.type === 'select') return f.options.some((o) => o[0] === String(v)) ? String(v) : null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) throw new HttpError(400, `${f.label}: enter a number from 0 up`);
  return n;
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
      maps: baseMaps(t),
      playlist: '',
      shuffle: true,
      xpScale: Number(c.xpScale) || 4,
      weaponXpScale: Number(c.weaponXpScale) || 4,
      bots: {
        enabled: !!t.botRepo && b.enabled !== false,
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
      log.info(`Using ${t.short} from ${server.cod.gameDir}`);
    }
    if (t.botRepo && (server.cod.bots.enabled || opts.reinstallBots)) {
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
    if (t.exes) {
      // The game's console log (logfile 2 in the generated config) is followed, since these clients
      // print to their own console window.
      return {
        command: findExe(t, c.gameDir),
        args: ['-dedicated', '+set', 'net_port', port, '+exec', cfgName(server), '+map_rotate'],
        cwd: c.gameDir,
        logFile: [path.join(c.gameDir, 'main', 'console_mp.log'), path.join(c.gameDir, 'players2', 'console_mp.log'), path.join(c.gameDir, 'console_mp.log')],
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
          ...(t.playlists
            ? [{
                key: 'cod.playlist',
                label: 'Playlist',
                type: 'select',
                options: [{ value: '', label: 'Custom: the maps ticked below' }, ...Object.entries(t.playlists).map(([value, p]) => ({ value, label: p.label }))],
                hint: 'A playlist replaces the ticked maps. The game mode above still applies.',
              }]
            : []),
          { key: 'cod.shuffle', label: 'Shuffle the map rotation every start', type: 'bool' },
          {
            key: 'cod.maps',
            label: 'Maps in rotation',
            type: 'maps',
            // Previews come from the Call of Duty wiki through the panel (cached after the first look-up).
            options: t.maps.map(([value, label, tag]) => ({ value, label, tag, image: `/api/servers/${server.id}/map-image/${value}` })),
            ...(t.playlists ? { inactiveIf: { key: 'cod.playlist', note: 'A playlist is picked above, so the rotation uses its maps. Pick "Custom" to use these.' } } : {}),
            hint: t.maps.some((m) => m[2]) ? 'Click a map to add or remove it. Everyone who joins needs the bonus/DLC maps you pick.' : 'Click a map to add or remove it.',
          },
        ],
      },
      ...ruleSections(server, t),
      {
        title: 'XP',
        fields: [
          { key: 'cod.xpScale', label: 'Player XP multiplier', type: 'number', step: 1 },
          ...(t.weaponXp ? [{ key: 'cod.weaponXpScale', label: 'Weapon XP multiplier', type: 'number', step: 1 }] : []),
        ],
      },
      ...(t.botRepo ? [{
        title: 'Bots',
        fields: [
          { key: 'cod.bots.enabled', label: 'Fill the server with bots', type: 'bool' },
          { key: 'cod.bots.fill', label: 'Keep this many players in the match (bots + people)', type: 'number', hint: '12 = 6v6. Bots leave as real players join.' },
          { key: 'cod.bots.skill', label: 'Bot difficulty', type: 'select', options: skillsFor(server.cod.title).options.map(([value, label]) => ({ value, label })) },
          { key: 'cod.bots.kick', label: 'Remove a bot when a real player joins', type: 'bool' },
          ...botFieldsFor(server.cod.title).map((f) => schemaField('cod.bots.' + f.key, f)),
        ],
      }] : []),
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
      'cod.playlist': c.playlist || '',
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
      ...ruleAndBotValues(c),
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
    if ('cod.playlist' in v) c.playlist = t.playlists && t.playlists[v['cod.playlist']] ? v['cod.playlist'] : '';
    if ('cod.shuffle' in v) c.shuffle = !!v['cod.shuffle'];
    if ('cod.maps' in v && Array.isArray(v['cod.maps'])) {
      const valid = new Set(t.maps.map((m) => m[0]));
      const picked = v['cod.maps'].filter((m) => valid.has(m));
      if (!picked.length) throw new HttpError(400, 'Pick at least one map');
      c.maps = picked;
    }
    if ('cod.xpScale' in v) c.xpScale = num(v['cod.xpScale'], 1, 100, 1);
    if ('cod.weaponXpScale' in v) c.weaponXpScale = num(v['cod.weaponXpScale'], 1, 100, 1);
    if ('cod.bots.enabled' in v) c.bots.enabled = !!t.botRepo && !!v['cod.bots.enabled'];
    if ('cod.bots.fill' in v) c.bots.fill = num(v['cod.bots.fill'], 0, 64, 12);
    if ('cod.bots.skill' in v && skillsFor(c.title).options.some((o) => o[0] === String(v['cod.bots.skill']))) c.bots.skill = String(v['cod.bots.skill']);
    if ('cod.bots.kick' in v) c.bots.kick = !!v['cod.bots.kick'];
    {
      // Check every rule first, so one bad value doesn't leave the rest half saved.
      const match = { ...(c.match || {}) };
      const modes = JSON.parse(JSON.stringify(c.modes || {}));
      const bots = {};
      for (const f of rulesFor(c.title, MATCH_RULES)) if ('cod.match.' + f.key in v) match[f.key] = ruleValue(f, v['cod.match.' + f.key]);
      for (const [gt] of t.gametypes) {
        for (const f of rulesFor(c.title, MODE_RULES)) {
          const k = `cod.mode.${gt}.${f.key}`;
          if (k in v) (modes[gt] = modes[gt] || {})[f.key] = ruleValue(f, v[k]);
        }
      }
      for (const f of botFieldsFor(c.title)) {
        const k = 'cod.bots.' + f.key;
        if (!(k in v)) continue;
        if (f.type === 'bool') bots[f.key] = !!v[k];
        else if (f.type === 'select') bots[f.key] = f.options.some((o) => o[0] === String(v[k])) ? String(v[k]) : f.def;
        else {
          const n = Number(v[k]);
          const ok = v[k] !== '' && (f.float ? Number.isFinite(n) : Number.isInteger(n));
          bots[f.key] = ok ? Math.max(f.min, Math.min(f.max, n)) : f.def;
        }
      }
      c.match = match;
      c.modes = modes;
      Object.assign(c.bots, bots);
    }
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
module.exports.buildGtsConfig = buildGtsConfig;
module.exports.SKILLS = SKILLS;
