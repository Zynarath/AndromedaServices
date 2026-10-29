'use strict';
// Cover art shown behind each server's card. Every game has a default picture (its Steam library
// art, or the Wikipedia box art for games that aren't on Steam), downloaded once into the panel's
// cache and served by the panel itself, so browsers never contact Steam or Wikipedia. A server can
// replace it with an uploaded picture, kept in <dataDir>/covers.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { fetchJson, fetchWithRetry } = require('../util/download');
const { HttpError } = require('../util/misc');
const logger = require('../util/log');

const log = logger('covers');
const CACHE_DIR = path.join(config.cacheDir, 'covers');
const CUSTOM_DIR = path.join(config.dataDir, 'covers');
const RETRY_MS = 6 * 60 * 60e3; // no default picture could be fetched: ask again after 6 hours
const MAX_DOWNLOAD = 8 * 1024 * 1024;
const MAX_UPLOAD = 8 * 1024 * 1024;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

// Steam app ids are the games' store pages (not their dedicated servers).
const DEFAULTS = {
  'ark-asa': { steam: 2399830 },
  'ark-ase': { steam: 346110 },
  'cod-cod4x': { steam: 7940 },
  'cod-iw4x': { steam: 10180 },
  'cod-t6': { steam: 202970 },
  'cod-t5': { steam: 42700 },
  'cod-iw5': { steam: 115300 },
  'cod-s1x': { steam: 209650 },
  'cod-iw6x': { steam: 209160 },
  satisfactory: { steam: 526870 },
  sdtd: { steam: 251570 },
  valheim: { steam: 892970 },
  wow: { wiki: 'World of Warcraft: Wrath of the Lich King' },
  minecraft: { wiki: 'Minecraft' },
};
const pending = new Map();

function defaultKey(server) {
  if (server.ark) return server.ark.edition === 'ase' ? 'ark-ase' : 'ark-asa';
  if (server.cod) return `cod-${server.cod.title}`;
  if (server.wow) return 'wow';
  if (server.mc) return 'minecraft';
  if (server.sf) return 'satisfactory';
  if (server.sdtd) return 'sdtd';
  if (server.vh) return 'valheim';
  return null;
}

// What a file really is, from its first bytes (never trust a name or a Content-Type header).
// SVG is left out on purpose: it can carry scripts.
function sniff(buf) {
  if (buf.length >= 4 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function allowedImageUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return u.protocol === 'https:' && (h.endsWith('.steamstatic.com') || h.endsWith('.akamaihd.net') || h === 'upload.wikimedia.org');
  } catch {
    return false;
  }
}

// Candidate picture addresses for a game, best first.
async function candidates(src) {
  if (src.wiki) {
    const q = new URLSearchParams({
      action: 'query', format: 'json', titles: src.wiki, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '1000', pilicense: 'any', redirects: '1',
    });
    const data = await fetchJson(`https://en.wikipedia.org/w/api.php?${q}`, { timeout: 15000 });
    const page = Object.values((data.query && data.query.pages) || {})[0];
    return page && page.thumbnail ? [page.thumbnail.source] : [];
  }
  // The wide library art has no logo on it, so the card's own label reads cleanly on top.
  const urls = [`https://cdn.cloudflare.steamstatic.com/steam/apps/${src.steam}/library_hero.jpg`];
  try {
    const data = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${src.steam}&filters=basic`, { timeout: 15000 });
    const header = data[src.steam] && data[src.steam].data && data[src.steam].data.header_image;
    if (header) urls.push(header);
  } catch {}
  urls.push(`https://cdn.cloudflare.steamstatic.com/steam/apps/${src.steam}/header.jpg`);
  return urls;
}

async function downloadFirst(urls) {
  let lastErr = new Error('no picture found');
  for (const url of urls) {
    try {
      if (!allowedImageUrl(url)) throw new Error(`unexpected image address ${url}`);
      const res = await fetchWithRetry(url, { timeout: 20000 }, 2);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      if (res.url && !allowedImageUrl(res.url)) throw new Error(`redirected to ${res.url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_DOWNLOAD) throw new Error('image too large');
      const type = sniff(buf);
      if (!type) throw new Error(`not an image: ${url}`);
      return { buf, type, url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function cachedDefault(key) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, key + '.json'), 'utf8'));
    if (meta.file && fs.existsSync(path.join(CACHE_DIR, meta.file))) return { image: { file: path.join(CACHE_DIR, meta.file), type: meta.type, at: meta.at } };
    if (meta.missAt && Date.now() - meta.missAt < RETRY_MS) return { image: null };
  } catch {}
  return null;
}

function fetchDefault(key) {
  if (pending.has(key)) return pending.get(key);
  const promise = (async () => {
    try {
      const { buf, type, url } = await downloadFirst(await candidates(DEFAULTS[key]));
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const file = key + EXT[type];
      fs.writeFileSync(path.join(CACHE_DIR, file), buf);
      const at = Date.now();
      fs.writeFileSync(path.join(CACHE_DIR, key + '.json'), JSON.stringify({ file, type, source: url, at }));
      return { file: path.join(CACHE_DIR, file), type, at };
    } catch (err) {
      log.warn(`Default cover for ${key}: ${err.message}`);
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(path.join(CACHE_DIR, key + '.json'), JSON.stringify({ missAt: Date.now(), error: err.message }));
      return null;
    }
  })().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

function customFile(server) {
  if (!server.cover || !server.cover.file) return null;
  const file = path.join(CUSTOM_DIR, path.basename(server.cover.file));
  return fs.existsSync(file) ? { file, type: server.cover.type, at: server.cover.at } : null;
}

// For the server list: the picture's address (with a version so browsers pick up changes), or null
// while the default is still being downloaded in the background.
function info(server) {
  const custom = customFile(server);
  if (custom) return { url: `/api/servers/${server.id}/cover?v=${custom.at}`, custom: true };
  const key = defaultKey(server);
  if (!key || !DEFAULTS[key]) return null;
  const hit = cachedDefault(key);
  if (!hit) fetchDefault(key);
  return hit && hit.image ? { url: `/api/servers/${server.id}/cover?v=d${hit.image.at}`, custom: false } : null;
}

// The picture to send for a server: its own upload, else the game's default (downloaded if needed).
async function get(server) {
  const custom = customFile(server);
  if (custom) return custom;
  const key = defaultKey(server);
  if (!key || !DEFAULTS[key]) return null;
  const hit = cachedDefault(key);
  return hit ? hit.image : fetchDefault(key);
}

// The Create page's game cards: a template's default picture, by the same keys as servers.
function templateKey(t) {
  if (t.game === 'ark') return `ark-${t.edition}`;
  if (t.game === 'cod') return `cod-${t.codTitle}`;
  return isGame(t.game) ? t.game : null;
}

// The address of a game's default picture, or null when it couldn't be fetched recently. A picture
// that isn't cached yet gets an address without a version; that request waits for the download.
const isGame = (key) => Object.hasOwn(DEFAULTS, key);

function defaultInfo(key) {
  if (!isGame(key)) return null;
  const hit = cachedDefault(key);
  if (hit) return hit.image ? { url: `/api/covers/${key}?v=${hit.image.at}`, cached: true } : null;
  fetchDefault(key);
  return { url: `/api/covers/${key}`, cached: false };
}

async function getDefault(key) {
  if (!isGame(key)) return null;
  const hit = cachedDefault(key);
  return hit ? hit.image : fetchDefault(key);
}

// Save an uploaded picture as this server's cover. Returns the new server.cover record.
function setCustom(server, buf) {
  if (!buf || !buf.length) throw new HttpError(400, 'Choose a picture to upload');
  if (buf.length > MAX_UPLOAD) throw new HttpError(400, 'Pictures can be at most 8 MB');
  const type = sniff(buf);
  if (!type) throw new HttpError(400, 'Use a JPG, PNG, WebP or GIF picture');
  fs.mkdirSync(CUSTOM_DIR, { recursive: true });
  const file = server.id + EXT[type];
  const tmp = path.join(CUSTOM_DIR, file + '.tmp');
  fs.writeFileSync(tmp, buf);
  removeCustom(server);
  fs.renameSync(tmp, path.join(CUSTOM_DIR, file));
  server.cover = { file, type, at: Date.now() };
  return server.cover;
}

// Back to the game's default picture.
function removeCustom(server) {
  if (server.cover && server.cover.file) fs.rmSync(path.join(CUSTOM_DIR, path.basename(server.cover.file)), { force: true });
  delete server.cover;
}

module.exports = { info, get, templateKey, defaultInfo, getDefault, setCustom, removeCustom, defaultKey, sniff, allowedImageUrl, DEFAULTS, MAX_UPLOAD };
