'use strict';
// Database access for the WotLK website: the realm's login, characters and world databases (from
// mangosd.conf), plus SPP's armory database when it's there (item icons, talent and faction names).
// Every query takes its values as parameters; table/database names only ever come from mangosd.conf.
const fs = require('fs');
const path = require('path');
const { Conf, parseDbInfo } = require('../util/conf');
const { detect } = require('../games/wow');

let root = null;
let layout = null; // detect() result for root
let confStamp = '';
let infos = null; // { login, chars, world, armory }
const pools = new Map();
let armoryOk = { at: 0, ok: false };
let columnCache = new Map();

class OfflineError extends Error {}

function setRoot(next) {
  if (next === root) return;
  root = next;
  layout = null;
  reset();
}

function reset() {
  for (const p of pools.values()) p.end().catch(() => {});
  pools.clear();
  infos = null;
  confStamp = '';
  armoryOk = { at: 0, ok: false };
  columnCache = new Map();
}

function paths() {
  if (!layout) layout = detect(root || '');
  return layout;
}

function readInfos() {
  const p = paths();
  if (!p.layout) throw new OfflineError(`The WoW server folder (${root || 'not set'}) wasn't found.`);
  const file = path.join(p.confDir, 'mangosd.conf');
  const stamp = String(fs.statSync(file).mtimeMs);
  if (infos && stamp === confStamp) return infos;
  const conf = new Conf(fs.readFileSync(file, 'utf8'));
  const login = parseDbInfo(conf.get('LoginDatabaseInfo'));
  const chars = parseDbInfo(conf.get('CharacterDatabaseInfo'));
  const world = parseDbInfo(conf.get('WorldDatabaseInfo'));
  if (!login || !chars || !world) throw new OfflineError('mangosd.conf has no database settings.');
  const armoryName = world.database.replace(/mangos$/i, '') + 'armory';
  if (infos) reset();
  infos = { login, chars, world, armory: { ...world, database: armoryName } };
  confStamp = stamp;
  return infos;
}

function pool(which) {
  const info = readInfos()[which];
  if (!pools.has(which)) {
    const mysql = require('mysql2/promise');
    pools.set(which, mysql.createPool({ ...info, connectionLimit: 6, connectTimeout: 3000, dateStrings: true, charset: 'utf8mb4' }));
  }
  return pools.get(which);
}

async function q(which, sql, params = []) {
  try {
    const [rows] = await pool(which).query(sql, params);
    return rows;
  } catch (err) {
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|PROTOCOL_CONNECTION_LOST|ER_ACCESS_DENIED/.test(err.code || '')) {
      throw new OfflineError("The realm's database isn't running. Start the WoW server from Andromeda Hosting.");
    }
    throw err;
  }
}

// `db`.`table` for joins across the realm's databases (SPP keeps them all on one MySQL server).
function t(which, table) {
  const db = readInfos()[which].database.replace(/`/g, '');
  return `\`${db}\`.\`${table}\``;
}

async function hasArmory() {
  if (Date.now() - armoryOk.at < 60000) return armoryOk.ok;
  let ok = false;
  try {
    ok = (await q('login', 'SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [readInfos().armory.database])).length > 0;
  } catch {}
  armoryOk = { at: Date.now(), ok };
  return ok;
}

async function columns(which, table) {
  const key = `${which}.${table}`;
  if (!columnCache.has(key)) {
    try {
      const rows = await q(which, 'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [readInfos()[which].database, table]);
      columnCache.set(key, new Set(rows.map((r) => r.c.toLowerCase())));
    } catch (err) {
      if (err instanceof OfflineError) throw err;
      columnCache.set(key, new Set());
    }
  }
  return columnCache.get(key);
}

// Random bot accounts all start with this prefix (aiplayerbot.conf).
function botPrefix() {
  try {
    const file = path.join(paths().confDir, 'aiplayerbot.conf');
    return (new Conf(fs.readFileSync(file, 'utf8')).get('AiPlayerbot.RandomBotAccountPrefix') || 'rndbot').toUpperCase();
  } catch {
    return 'RNDBOT';
  }
}

function worldConf(key) {
  try {
    return new Conf(fs.readFileSync(path.join(paths().confDir, 'mangosd.conf'), 'utf8')).get(key);
  } catch {
    return undefined;
  }
}

// ---- lookups ----
async function items(entries) {
  const ids = [...new Set(entries.map(Number).filter((n) => n > 0))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = await q('world', 'SELECT entry, name, Quality, ItemLevel, RequiredLevel, InventoryType, class, subclass, displayid FROM item_template WHERE entry IN (?)', [ids]);
  for (const r of rows) out.set(Number(r.entry), r);
  const icons = await iconNames(rows.map((r) => r.displayid));
  for (const r of out.values()) r.icon = icons.get(Number(r.displayid)) || null;
  return out;
}

async function iconNames(displayIds) {
  const ids = [...new Set(displayIds.map(Number).filter((n) => n > 0))];
  const out = new Map();
  if (!ids.length || !(await hasArmory())) return out;
  try {
    for (const r of await q('armory', 'SELECT id, name FROM dbc_itemdisplayinfo WHERE id IN (?)', [ids])) out.set(Number(r.id), String(r.name).toLowerCase());
  } catch {}
  return out;
}

// Names from the armory's copies of the game's DBC tables (id -> name), or an empty map.
async function dbcNames(table, ids) {
  const out = new Map();
  const list = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n)))];
  if (!list.length || !/^dbc_[a-z_]+$/.test(table) || !(await hasArmory())) return out;
  try {
    for (const r of await q('armory', `SELECT id, name FROM \`${table}\` WHERE id IN (?)`, [list])) out.set(Number(r.id), r.name);
  } catch {}
  return out;
}

module.exports = { setRoot, paths, q, t, columns, hasArmory, botPrefix, worldConf, items, iconNames, dbcNames, OfflineError, reset };
