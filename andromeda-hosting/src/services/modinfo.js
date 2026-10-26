'use strict';
// ARK mod details by ID: name, picture, page link and the description, plus the settings the
// description documents. ARK: Survival Evolved mods come from the Steam Workshop
// (ISteamRemoteStorage/GetPublishedFileDetails, no API key needed); Survival Ascended mods from
// CurseForge. Results are cached for 12 hours; pictures are downloaded once and served by the panel.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const cf = require('./curseforge');
const { fetchWithRetry } = require('../util/download');
const logger = require('../util/log');

const log = logger('mod-info');
const STEAM_API = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
const CACHE_FILE = path.join(config.cacheDir, 'mod-info.json');
const IMG_DIR = path.join(config.cacheDir, 'mod-images');
const TTL_MS = 12 * 60 * 60e3;
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

let cache = null;
function loadCache() {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {
      cache = {};
    }
  }
  return cache;
}
function saveCache() {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

// ---- turning a description into plain text ----
// Steam uses BBCode. Only real BBCode tags are removed: "[AnnunakiGenesis]" is an INI section header.
const BBCODE = /\[\/?(?:b|i|u|s|strike|h[1-6]|code|noparse|list|olist|\*|url(?:=[^\]]*)?|img|quote(?:=[^\]]*)?|spoiler|hr|table|tr|th|td|previewyoutube[^\]]*)\]/gi;
function bbcodeToText(s) {
  return String(s || '').replace(/\[url=([^\]]+)\]/gi, '').replace(BBCODE, '\n').replace(/\r/g, '');
}
function htmlToText(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|pre|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---- settings documented in a mod description ----
// Mods document their options as INI blocks: "[SectionName]" then "Key=Value" lines, often with a
// comment after the value ("MaxLevel=300 // highest wild level") or a line of text above it.
const VANILLA = /^(ServerSettings|SessionSettings|MessageOfTheDay|ScalabilityGroups|\/script\/.*)$/i;
function parseModDocs(text) {
  const lines = String(text).split('\n').map((l) => l.trim());
  const sections = new Map(); // name -> { section, file, settings: [] }
  let current = null;
  let lastText = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      lastText = '';
      continue;
    }
    const head = /^\[([A-Za-z][A-Za-z0-9_.\- ]{1,63})\]$/.exec(line);
    if (head) {
      const name = head[1].trim();
      if (VANILLA.test(name)) {
        current = null;
        continue;
      }
      // Which file: the nearest mention of Game.ini / GameUserSettings.ini in the lines above.
      const before = lines.slice(Math.max(0, i - 6), i).join(' ');
      const file = /Game\.ini/i.test(before) && !/GameUserSettings/i.test(before) ? 'game' : 'gus';
      current = sections.get(name) || { section: name, file, settings: [] };
      sections.set(name, current);
      lastText = '';
      continue;
    }
    const kv = /^([A-Za-z][\w.()]*)\s*=\s*(.*)$/.exec(line);
    if (kv && current) {
      let value = kv[2];
      let note = '';
      const c = /\s+(?:\/\/|;|#|--|–|-)\s*(.*)$/.exec(value);
      if (c) {
        note = c[1];
        value = value.slice(0, c.index);
      }
      value = value.trim().replace(/^"(.*)"$/, '$1');
      if (!current.settings.some((s) => s.key.toLowerCase() === kv[1].toLowerCase())) {
        current.settings.push({ key: kv[1], def: value, doc: [note, !note && lastText.length < 240 ? lastText : ''].filter(Boolean).join(' ').trim() });
      }
      lastText = '';
      continue;
    }
    if (!/^[-=*_#]{3,}$/.test(line)) lastText = line;
  }
  return [...sections.values()].filter((s) => s.settings.length);
}

// ---- fetching ----
async function steamDetails(ids) {
  const body = new URLSearchParams({ itemcount: String(ids.length) });
  ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));
  const res = await fetchWithRetry(STEAM_API, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
  if (!res.ok) throw new Error(`Steam answered HTTP ${res.status}`);
  const data = await res.json();
  return ((data.response && data.response.publishedfiledetails) || []).map((d) => ({
    id: String(d.publishedfileid),
    found: d.result === 1 && !!d.title,
    name: d.title || null,
    imageUrl: d.preview_url || null,
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${d.publishedfileid}`,
    text: bbcodeToText(d.description),
    updated: d.time_updated ? d.time_updated * 1000 : null,
  }));
}

async function curseforgeDetails(ids) {
  const mods = await cf.getMods(ids);
  const out = [];
  for (const m of mods) {
    let text = '';
    try {
      text = htmlToText(await cf.getModDescription(m.id));
    } catch {}
    const s = cf.slimMod(m);
    out.push({ id: String(m.id), found: true, name: s.name, imageUrl: s.logo, url: s.url, text, updated: Date.parse(s.updated) || null });
  }
  return out;
}

// [{ id, found, name, imageUrl, url, text, docs, updated }] for the given mod IDs.
async function getModInfo(ids, { edition = 'ase', refresh = false } = {}) {
  const c = loadCache();
  const key = (id) => `${edition}:${id}`;
  const stale = ids.filter((id) => refresh || !c[key(id)] || Date.now() - c[key(id)].fetchedAt > TTL_MS);
  if (stale.length) {
    try {
      const got = edition === 'asa' ? (cf.hasKey() ? await curseforgeDetails(stale) : []) : await steamDetails(stale);
      for (const d of got) c[key(d.id)] = { ...d, docs: parseModDocs(d.text), fetchedAt: Date.now() };
      saveCache();
    } catch (err) {
      log.warn(`Couldn't look up mod details: ${err.message}`);
    }
  }
  return ids.map((id) => c[key(id)] || { id, found: false, name: null, docs: [] });
}

function allowedImageHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)(steamusercontent\.com|steamuserimages-a\.akamaihd\.net|akamaihd\.net|steamstatic\.com|forgecdn\.net)$/.test(u.hostname);
  } catch {
    return false;
  }
}

// The mod's picture as { file, type }, downloaded once. Only cached mods (looked up above) qualify.
async function getModImage(id, edition = 'ase') {
  const info = loadCache()[`${edition}:${id}`];
  if (!info || !info.imageUrl || !allowedImageHost(info.imageUrl)) return null;
  const base = path.join(IMG_DIR, `${edition}-${id}`);
  for (const ext of Object.values(IMAGE_TYPES)) if (fs.existsSync(base + ext)) return { file: base + ext, type: Object.keys(IMAGE_TYPES).find((t) => IMAGE_TYPES[t] === ext) };
  const res = await fetchWithRetry(info.imageUrl, { timeout: 20000 });
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
  if (!res.ok || !IMAGE_TYPES[type]) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) return null;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.writeFileSync(base + IMAGE_TYPES[type], buf);
  return { file: base + IMAGE_TYPES[type], type };
}

module.exports = { getModInfo, getModImage, parseModDocs, bbcodeToText, htmlToText, allowedImageHost };
