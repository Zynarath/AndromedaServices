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

// ---- more documentation: Workshop discussions and documents the description links to ----
// Many mods explain their settings in a pinned discussion ("Server config", "README", "FAQ") or a
// linked Pastebin/GitHub/Google doc rather than in the description itself.
const DOC_WORDS = /config|setting|\bini\b|server|read ?me|faq|guide|option|admin|command/i;
const MAX_DOC_BYTES = 2 * 1024 * 1024;

// Links in a description that point at documentation we can read as text.
function docLinks(rawDescription, modId) {
  const urls = new Set();
  const re = /https?:\/\/[^\s"'<>\[\]]+/g;
  let m;
  while ((m = re.exec(String(rawDescription || '')))) urls.add(m[0].replace(/[).,]+$/, ''));
  const out = [];
  for (const u of urls) {
    let url;
    try {
      url = new URL(u);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^www\./, '');
    let read = null;
    let label = null;
    if (host === 'steamcommunity.com' && /\/discussion\/\d+\/\d+/.test(url.pathname)) [read, label] = [`https://steamcommunity.com${url.pathname}`, 'Steam discussion'];
    else if (host === 'pastebin.com' && /^\/(raw\/)?[A-Za-z0-9]{6,12}$/.test(url.pathname)) [read, label] = [`https://pastebin.com/raw/${url.pathname.split('/').pop()}`, 'Pastebin'];
    else if (host === 'gist.github.com' && /^\/[\w-]+\/[0-9a-f]+/.test(url.pathname)) [read, label] = [`https://gist.githubusercontent.com${url.pathname.replace(/\/$/, '')}/raw`, 'GitHub Gist'];
    else if (host === 'github.com' && /\/blob\//.test(url.pathname)) [read, label] = [`https://raw.githubusercontent.com${url.pathname.replace('/blob/', '/')}`, 'GitHub'];
    else if (host === 'raw.githubusercontent.com' || host === 'gist.githubusercontent.com') [read, label] = [url.href, 'GitHub'];
    else if (host === 'docs.google.com' && /\/document\/d\/([\w-]+)/.test(url.pathname)) [read, label] = [`https://docs.google.com/document/d/${/\/document\/d\/([\w-]+)/.exec(url.pathname)[1]}/export?format=txt`, 'Google Doc'];
    if (read) out.push({ url: url.href, read, label });
  }
  void modId;
  return out.slice(0, 6);
}

// Discussion threads of a Workshop mod whose titles suggest settings (pinned ones are listed first).
async function workshopDiscussions(modId) {
  const res = await fetchWithRetry(`https://steamcommunity.com/workshop/filedetails/discussions/${modId}`, { timeout: 15000 }, 2);
  if (!res.ok) return [];
  const page = await res.text();
  const found = new Map();
  const re = new RegExp(`https://steamcommunity\\.com/workshop/filedetails/discussion/${modId}/(\\d+)/?`, 'g');
  let m;
  while ((m = re.exec(page))) {
    if (found.has(m[1])) continue;
    const tagEnd = page.indexOf('>', m.index);
    const near = htmlToText(page.slice(tagEnd + 1, tagEnd + 1500)).slice(0, 300);
    found.set(m[1], { url: m[0], read: m[0], label: 'Steam discussion', relevant: DOC_WORDS.test(near), title: near.split('\n').map((x) => x.trim()).find(Boolean) });
  }
  return [...found.values()].sort((a, b) => b.relevant - a.relevant).filter((d) => d.relevant).slice(0, 5);
}

async function readDoc(link) {
  const res = await fetchWithRetry(link.read, { timeout: 15000 }, 2);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOC_BYTES) throw new Error('too large');
  const text = buf.toString('utf8');
  return /<html|<body|<div/i.test(text) ? htmlToText(text) : bbcodeToText(text);
}

// Merge documented settings from several sources; the first source to describe a setting wins.
function mergeDocs(list) {
  const sections = new Map();
  for (const { docs, source } of list) {
    for (const d of docs) {
      const key = d.section.toLowerCase();
      const into = sections.get(key) || { section: d.section, file: d.file, settings: [] };
      sections.set(key, into);
      for (const st of d.settings) {
        const have = into.settings.find((x) => x.key.toLowerCase() === st.key.toLowerCase());
        if (!have) into.settings.push({ ...st, source });
        else if (!have.doc && st.doc) have.doc = st.doc;
      }
    }
  }
  return [...sections.values()];
}

// Everything documented for one mod: description, relevant discussions and linked documents.
async function gatherDocs(d, edition) {
  const sources = [{ label: edition === 'asa' ? 'CurseForge page' : 'Workshop page', url: d.url, settings: 0 }];
  const found = [{ docs: parseModDocs(d.text), source: sources[0].label }];
  sources[0].settings = found[0].docs.reduce((n, x) => n + x.settings.length, 0);
  const links = [...docLinks(d.raw, d.id)];
  if (edition !== 'asa') {
    try {
      for (const t of await workshopDiscussions(d.id)) if (!links.some((l) => l.read === t.read)) links.push(t);
    } catch (err) {
      log.warn(`Couldn't list the discussions of mod ${d.id}: ${err.message}`);
    }
  }
  for (const link of links.slice(0, 8)) {
    const label = link.title ? `${link.label}: ${link.title.slice(0, 80)}` : link.label;
    try {
      const docs = parseModDocs(await readDoc(link));
      const n = docs.reduce((c, x) => c + x.settings.length, 0);
      sources.push({ label, url: link.url, settings: n });
      if (n) found.push({ docs, source: label });
    } catch (err) {
      sources.push({ label, url: link.url, settings: 0, error: err.message });
    }
  }
  return { docs: mergeDocs(found), sources };
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
    raw: d.description || '',
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
    out.push({ id: String(m.id), found: true, name: s.name, imageUrl: s.logo, url: s.url, text, raw: text, updated: Date.parse(s.updated) || null });
  }
  return out;
}

// [{ id, found, name, imageUrl, url, text, docs, updated }] for the given mod IDs.
async function getModInfo(ids, { edition = 'ase', refresh = false } = {}) {
  const c = loadCache();
  const key = (id) => `${edition}:${id}`;
  // Entries from before discussions/linked docs were read (no `sources`) are looked up again.
  const stale = ids.filter((id) => refresh || !c[key(id)] || !c[key(id)].sources || Date.now() - c[key(id)].fetchedAt > TTL_MS);
  if (stale.length) {
    try {
      const got = edition === 'asa' ? (cf.hasKey() ? await curseforgeDetails(stale) : []) : await steamDetails(stale);
      for (const d of got) {
        const { docs, sources } = d.found ? await gatherDocs(d, edition) : { docs: [], sources: [] };
        delete d.raw;
        c[key(d.id)] = { ...d, docs, sources, fetchedAt: Date.now() };
      }
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

// Picture type from the first bytes, for hosts that don't send a proper Content-Type.
function sniffImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Steam's image servers resize on request (the Workshop itself does this); big animated GIFs come
// back as a small still picture.
function thumbnailUrl(url) {
  try {
    const u = new URL(url);
    if (!/steamusercontent\.com$|akamaihd\.net$/.test(u.hostname)) return url;
    u.searchParams.set('imw', '256');
    u.searchParams.set('imh', '256');
    u.searchParams.set('ima', 'fit');
    u.searchParams.set('impolicy', 'Letterbox');
    return u.href;
  } catch {
    return url;
  }
}

async function downloadImage(url) {
  const res = await fetchWithRetry(url, { timeout: 20000 }, 2);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) throw new Error(`too large (${Math.round(buf.length / 1048576)} MB)`);
  const header = String(res.headers.get('content-type') || '').split(';')[0].trim();
  const type = IMAGE_TYPES[header] ? header : sniffImage(buf);
  if (!type) throw new Error(`not a picture (${header || 'no type'})`);
  return { buf, type };
}

const imageMisses = new Map(); // key -> time of the last failed download, retried after an hour

// The mod's picture as { file, type }, downloaded once. Only cached mods (looked up above) qualify.
async function getModImage(id, edition = 'ase') {
  const missKey = `${edition}:${id}`;
  if (Date.now() - (imageMisses.get(missKey) || 0) < 60 * 60e3) return null;
  const info = loadCache()[`${edition}:${id}`];
  if (!info || !info.imageUrl) return null;
  if (!allowedImageHost(info.imageUrl)) {
    log.warn(`Picture for mod ${id} is on an unexpected host: ${info.imageUrl}`);
    return null;
  }
  const base = path.join(IMG_DIR, `${edition}-${id}`);
  for (const [t, ext] of Object.entries(IMAGE_TYPES)) if (fs.existsSync(base + ext)) return { file: base + ext, type: t };
  let img;
  try {
    img = await downloadImage(thumbnailUrl(info.imageUrl));
  } catch (err) {
    try {
      img = await downloadImage(info.imageUrl); // the original, if resizing isn't offered
    } catch (err2) {
      log.warn(`Couldn't get the picture for mod ${id} (${info.imageUrl}): ${err.message}; original: ${err2.message}`);
      imageMisses.set(missKey, Date.now());
      return null;
    }
  }
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.writeFileSync(base + IMAGE_TYPES[img.type], img.buf);
  return { file: base + IMAGE_TYPES[img.type], type: img.type };
}

module.exports = { getModInfo, getModImage, parseModDocs, bbcodeToText, htmlToText, allowedImageHost, docLinks, sniffImage, thumbnailUrl };
