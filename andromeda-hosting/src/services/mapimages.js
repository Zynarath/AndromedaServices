'use strict';
// Map preview pictures for the Call of Duty map picker. Looked up by map name on the Call of Duty
// wiki (Fandom), downloaded once and kept in the panel's cache, then served by the panel itself, so
// browsers never contact the wiki. Only maps from the panel's own lists can be looked up.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { fetchJson, fetchWithRetry } = require('../util/download');
const logger = require('../util/log');

const log = logger('map-images');
const WIKI_API = 'https://callofduty.fandom.com/api.php';
const DIR = path.join(config.cacheDir, 'map-images');
const RETRY_NO_PICTURE_MS = 24 * 60 * 60e3; // the wiki has no picture: ask again the next day
const RETRY_NETWORK_MS = 60 * 60e3; // the wiki couldn't be reached: ask again in an hour
const MAX_PARALLEL = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const pending = new Map();
const queue = [];
let running = 0;

const plain = (title) => title.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();

// The wiki page for this map: its title (minus a "(map)"-style suffix) matches the map's name.
async function findImageUrl(game, name) {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${name} ${game} map`,
    gsrlimit: '10',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: '640',
    redirects: '1',
  });
  const data = await fetchJson(`${WIKI_API}?${q}`, { timeout: 15000 });
  const pages = Object.values((data.query && data.query.pages) || {})
    .filter((p) => p.thumbnail && p.thumbnail.source)
    .sort((a, b) => (a.index || 0) - (b.index || 0));
  const want = name.toLowerCase();
  // Best first: the exact title, then "Name (map)" / "Name (<game>)", then any "Name (...)" page,
  // e.g. not "Hijacked (Zombies)" while "Hijacked" exists.
  const rank = (p) => {
    const t = p.title.toLowerCase();
    if (t === want) return 0;
    if (plain(p.title) === want) return /\((map|multiplayer)\b/.test(t) || t.includes(game.toLowerCase()) ? 1 : 2;
    return plain(p.title).startsWith(want) ? 3 : 9;
  };
  const page = pages.map((p) => [rank(p), p]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0])[0];
  return page ? page[1].thumbnail.source : null;
}

function allowedImageUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname.endsWith('.nocookie.net') || u.hostname.endsWith('.fandom.com'));
  } catch {
    return false;
  }
}

async function download(dir, mapId, game, name) {
  const url = await findImageUrl(game, name);
  if (!url) throw Object.assign(new Error(`no picture found on the wiki for ${name}`), { noPicture: true });
  if (!allowedImageUrl(url)) throw new Error(`unexpected image address ${url}`);
  const res = await fetchWithRetry(url, { timeout: 20000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
  if (!TYPES[type]) throw new Error(`not an image (${type || 'no type'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('image too large');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, mapId + TYPES[type]);
  fs.writeFileSync(file, buf);
  fs.writeFileSync(path.join(dir, mapId + '.json'), JSON.stringify({ file: path.basename(file), type, source: url, at: Date.now() }));
  return { file, type };
}

function cached(dir, mapId) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, mapId + '.json'), 'utf8'));
    if (meta.file && fs.existsSync(path.join(dir, meta.file))) return { image: { file: path.join(dir, meta.file), type: meta.type } };
    if (meta.missAt && Date.now() - meta.missAt < (meta.noPicture ? RETRY_NO_PICTURE_MS : RETRY_NETWORK_MS)) return { image: null };
  } catch {}
  return null;
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => {
      running--;
      pump();
    });
  }
}

// Download a map's picture once, a few at a time. Resolves to { file, type } or null.
function fetchOnce(titleKey, mapId, game, name) {
  const key = `${titleKey}/${mapId}`;
  if (pending.has(key)) return pending.get(key);
  const dir = path.join(DIR, titleKey);
  const promise = new Promise((resolve) => {
    queue.push(() =>
      download(dir, mapId, game, name)
        .catch((err) => {
          log.warn(`Map preview for ${name} (${game}): ${err.message}`);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, mapId + '.json'), JSON.stringify({ missAt: Date.now(), noPicture: !!err.noPicture, error: err.message }));
          return null;
        })
        .then(resolve)
    );
    pump();
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

// For the web page: the cached picture right away, or null while it is fetched in the background,
// so a slow wiki never ties up the browser's connections to the panel.
// titleKey and mapId come from the panel's own map lists, so they are safe in file names.
function peek(titleKey, mapId, game, name) {
  const hit = cached(path.join(DIR, titleKey), mapId);
  if (hit) return hit.image;
  fetchOnce(titleKey, mapId, game, name);
  return null;
}

// Same, but waits for the download.
async function get(titleKey, mapId, game, name) {
  const hit = cached(path.join(DIR, titleKey), mapId);
  return hit ? hit.image : fetchOnce(titleKey, mapId, game, name);
}

module.exports = { get, peek, findImageUrl, allowedImageUrl, DIR };
