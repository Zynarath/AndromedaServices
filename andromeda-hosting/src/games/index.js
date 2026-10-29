'use strict';
const minecraft = require('./minecraft');
const ark = require('./ark');
const cod = require('./cod');
const wow = require('./wow');
const satisfactory = require('./satisfactory');
const sdtd = require('./sdtd');
const valheim = require('./valheim');

const games = { minecraft, ark, cod, wow, satisfactory, sdtd, valheim };
// Which property of a server record holds its game settings.
const CONFIG_KEY = { minecraft: 'mc', ark: 'ark', cod: 'cod', wow: 'wow', satisfactory: 'sf', sdtd: 'sdtd', valheim: 'vh' };

function gameFor(server) {
  const g = games[server.game];
  if (!g) throw new Error(`Unknown game type ${server.game}`);
  return g;
}

// Templates offered on the "Create server" page.
const templates = [
  { id: 'ark-asa', game: 'ark', edition: 'asa', title: 'ARK: Survival Ascended', subtitle: 'Mods via CurseForge, auto-updated on start', platforms: ['win32'], image: 'ark', namePrefix: 'Ark SA Server' },
  { id: 'ark-ase', game: 'ark', edition: 'ase', title: 'ARK: Survival Evolved', subtitle: 'Mods via Steam Workshop IDs', platforms: ['win32', 'linux'], image: 'ark-ase', namePrefix: 'Ark SE Server' },
  { id: 'mc-curseforge', game: 'minecraft', source: 'curseforge', title: 'Minecraft — CurseForge Modpack', subtitle: 'Install any modpack and update it from the panel', platforms: ['win32', 'linux', 'darwin'], image: 'mc-cf' },
  { id: 'mc-custom', game: 'minecraft', source: 'custom', title: 'Minecraft — Vanilla / Forge / NeoForge / Fabric', subtitle: 'Pick a version and loader, add mods yourself', platforms: ['win32', 'linux', 'darwin'], image: 'mc' },
  {
    id: 'wow-wotlk', game: 'wow', title: 'World of Warcraft: Wrath of the Lich King (3.3.5a)', subtitle: 'cMaNGOS + Mangosbot bots (SPP Classics) · friends-only accounts',
    platforms: ['win32', 'linux'], image: 'wow', namePrefix: 'WoW WotLK Server',
  },
  {
    id: 'satisfactory', game: 'satisfactory', title: 'Satisfactory', subtitle: 'Dedicated server · mods from ficsit.app (SML installed for you)',
    platforms: ['win32', 'linux'], image: 'satisfactory', namePrefix: 'Satisfactory Server',
  },
  {
    id: 'sdtd', game: 'sdtd', title: '7 Days to Die', subtitle: 'Dedicated server · install mods from .zip files',
    platforms: ['win32', 'linux'], image: 'sdtd', namePrefix: '7DTD Server',
  },
  {
    id: 'valheim', game: 'valheim', title: 'Valheim', subtitle: 'Dedicated server · world modifiers, crossplay, saves on stop',
    platforms: ['win32', 'linux'], image: 'valheim', namePrefix: 'Valheim Server',
  },
  ...Object.entries(cod.TITLES).map(([key, t]) => ({
    id: `cod-${key}`, game: 'cod', codTitle: key, title: t.label, subtitle: `Multiplayer · Domination${t.botRepo ? ' · bots' : ''} · ${t.weaponXp ? '4x player & weapon XP' : '4x XP'}`,
    platforms: t.platforms, image: 'cod', namePrefix: t.namePrefix, port: t.port, gameHint: t.gameHint, pluto: !!t.pluto, weaponXp: t.weaponXp,
    bots: !!t.botRepo, alterware: !!t.exes,
  })),
];

module.exports = { games, gameFor, templates, CONFIG_KEY };
