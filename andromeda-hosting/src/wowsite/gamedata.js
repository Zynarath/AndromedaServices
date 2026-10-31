'use strict';
// Fixed WotLK 3.3.5a game data the pages need.
const zones = require('./zones.json');

const RACES = { 1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead', 6: 'Tauren', 7: 'Gnome', 8: 'Troll', 10: 'Blood Elf', 11: 'Draenei' };
const CLASSES = { 1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid' };
const ALLIANCE = new Set([1, 3, 4, 7, 11]);
const faction = (race) => (ALLIANCE.has(Number(race)) ? 'Alliance' : 'Horde');
// The game's class and item-quality colours are made for dark backgrounds; several (white common
// items and priests, yellow rogues, light green) vanish on the site's parchment. These are darker
// versions of the same hues, readable on the light pages.
const CLASS_COLORS = { 1: '#7d5126', 2: '#b0306f', 3: '#4a7a12', 4: '#8a7200', 5: '#4b4b4b', 6: '#a3172e', 7: '#0055b0', 8: '#14769e', 9: '#5b46a0', 11: '#b45000' };
const QUALITY_COLORS = ['#6e6e6e', '#2a2a2a', '#1b7a0b', '#0050b0', '#7a22b8', '#b85a00', '#8a6d1f', '#8a6d1f'];

// Equipment slots 0-18, in the order the character sheet shows them.
const SLOTS = ['Head', 'Neck', 'Shoulder', 'Shirt', 'Chest', 'Waist', 'Legs', 'Feet', 'Wrist', 'Hands', 'Finger', 'Finger', 'Trinket', 'Trinket', 'Back', 'Main Hand', 'Off Hand', 'Ranged', 'Tabard'];

// realmlist.icon and realmlist.timezone, as SPP's website named them.
const REALM_TYPES = { 0: 'Normal', 1: 'PvP', 4: 'Normal', 6: 'RP', 8: 'RP-PvP' };
const REALM_ZONES = { 1: 'Development', 2: 'United States', 3: 'Oceanic', 4: 'Latin America', 5: 'Tournament', 6: 'Korea', 8: 'English', 9: 'German', 10: 'French', 11: 'Spanish', 12: 'Russian', 14: 'Taiwan', 16: 'China', 26: 'Test Server' };

// Reputation standing -> rank name (standing is the total from 0 = start of Neutral).
const REP_RANKS = [
  [-42000, 'Hated', 36000],
  [-6000, 'Hostile', 3000],
  [-3000, 'Unfriendly', 3000],
  [0, 'Neutral', 3000],
  [3000, 'Friendly', 6000],
  [9000, 'Honored', 12000],
  [21000, 'Revered', 21000],
  [42000, 'Exalted', 999],
];
function repRank(standing) {
  let r = REP_RANKS[0];
  for (const x of REP_RANKS) if (standing >= x[0]) r = x;
  return { name: r[1], value: Math.min(standing - r[0], r[2]), max: r[2] };
}

const zoneName = (id) => zones[id] || (Number(id) ? `Zone ${id}` : 'Unknown');

function money(copper) {
  const c = Math.max(0, Math.floor(Number(copper) || 0));
  return { g: Math.floor(c / 10000), s: Math.floor((c % 10000) / 100), c: c % 100 };
}

function duration(seconds) {
  let s = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

module.exports = { RACES, CLASSES, faction, CLASS_COLORS, QUALITY_COLORS, SLOTS, REALM_TYPES, REALM_ZONES, repRank, zoneName, money, duration };
