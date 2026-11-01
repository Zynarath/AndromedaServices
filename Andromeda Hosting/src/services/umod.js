'use strict';
// uMod (umod.org): the Oxide mod framework for Rust and its plugin library. Plugins are single C#
// files (.cs) that Oxide compiles and loads from oxide/plugins while the server runs.
const fs = require('fs');
const path = require('path');
const { fetchJson, fetchText, downloadFile } = require('../util/download');
const { extractZip } = require('../util/zip');
const { HttpError } = require('../util/misc');

const SITE = 'https://umod.org';
const OXIDE_RELEASES = 'https://api.github.com/repos/OxideMod/Oxide.Rust/releases/latest';
const OXIDE_ZIP = { win32: 'Oxide.Rust.zip', linux: 'Oxide.Rust-linux.zip' };
// Plugin names are C# class names, which is also the file name on uMod (BetterChat → BetterChat.cs).
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SORTS = ['downloads', 'title', 'updated_at', 'watchers'];
const CACHE_MS = 10 * 60e3;
const MAX_PLUGIN_BYTES = 4 * 1024 * 1024;
const cache = new Map();

function slim(d) {
  return {
    name: d.name,
    title: d.title || d.name,
    summary: d.description || '',
    author: d.author || '',
    version: d.latest_release_version || '',
    downloads: Number(d.downloads) || 0,
    logo: /^https:\/\/assets\.umod\.org\//.test(d.icon_url || '') ? d.icon_url : null, // the only image host the panel's CSP allows for uMod
    url: /^https:\/\/umod\.org\//.test(d.url || '') ? d.url : `${SITE}/plugins/${encodeURIComponent(d.slug || d.name)}`,
    updatedAt: d.updated_at_atom || d.latest_release_at_atom || null,
  };
}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return v;
}

// Rust plugins on uMod, most downloaded first (or by `sort`). uMod gives 10 per page, so `pages`
// asks for several at once.
async function search(query = '', { page = 1, sort = 'downloads', pages = 1 } = {}) {
  if (pages > 1) {
    const first = Math.max(1, Number(page) || 1);
    const all = await Promise.all(Array.from({ length: Math.min(pages, 5) }, (_, i) => searchPage(query, { page: first + i, sort }).catch(() => null)));
    const ok = all.filter(Boolean);
    if (!ok.length) return searchPage(query, { page: first, sort }); // let the real error through
    const seen = new Set();
    const plugins = ok.flatMap((r) => r.plugins).filter((p) => !seen.has(p.name) && seen.add(p.name));
    return { plugins, page: first, pages: ok[0].pages, total: ok[0].total };
  }
  return searchPage(query, { page, sort });
}

async function searchPage(query, { page = 1, sort = 'downloads' }) {
  const qs = new URLSearchParams({ query: String(query).slice(0, 100), page: String(Math.max(1, Number(page) || 1)), sort: SORTS.includes(sort) ? sort : 'downloads', sortdir: sort === 'title' ? 'asc' : 'desc' });
  qs.append('categories[]', 'rust');
  return cached(`s:${qs}`, async () => {
    const r = await fetchJson(`${SITE}/plugins/search.json?${qs}`, { timeout: 20000 });
    return { plugins: (r.data || []).filter((d) => NAME_RE.test(d.name || '')).map(slim), page: r.current_page || 1, pages: r.last_page || 1, total: r.total || 0 };
  });
}

// One plugin's uMod listing, by its exact name. null when uMod doesn't have it.
async function getPlugin(name, { refresh = false } = {}) {
  if (!NAME_RE.test(name)) throw new HttpError(400, 'Invalid plugin name');
  if (refresh) cache.delete(`p:${name}`);
  return cached(`p:${name}`, async () => {
    const qs = new URLSearchParams({ query: name, page: '1', sort: 'downloads', sortdir: 'desc' });
    qs.append('categories[]', 'rust');
    const r = await fetchJson(`${SITE}/plugins/search.json?${qs}`, { timeout: 20000 });
    const d = (r.data || []).find((x) => String(x.name).toLowerCase() === name.toLowerCase());
    return d ? slim(d) : null;
  });
}

// Latest versions for many plugins at once (a missing or unreachable one is just left out).
async function latestVersions(names) {
  const out = {};
  await Promise.all(
    names.map(async (n) => {
      const p = await getPlugin(n).catch(() => null);
      if (p) out[n] = p;
    })
  );
  return out;
}

// The plugin's source from uMod, checked to look like an Oxide plugin before anything is written.
async function downloadPlugin(name) {
  if (!NAME_RE.test(name)) throw new HttpError(400, 'Invalid plugin name');
  const text = await fetchText(`${SITE}/plugins/${name}.cs`, { timeout: 60000 }).catch((err) => {
    throw new HttpError(err.status === 404 ? 404 : 502, err.status === 404 ? `uMod has no download for ${name}` : `Couldn't download ${name} from uMod (${err.message})`);
  });
  if (text.length > MAX_PLUGIN_BYTES) throw new HttpError(400, `${name} is larger than a plugin should be`);
  checkSource(text, name);
  return text;
}

// An Oxide plugin declares [Info("Title", "Author", "1.2.3")] on a class named like its file.
function checkSource(text, name) {
  const info = parseInfo(text);
  if (!info) throw new HttpError(400, 'This is not an Oxide/uMod plugin (no [Info("Title", "Author", "Version")] found)');
  if (name && info.className && info.className !== name) throw new HttpError(400, `The plugin's class is ${info.className}, so its file must be named ${info.className}.cs`);
  return info;
}

const unescape = (s) => s.replace(/\\(.)/g, '$1');

function parseInfo(text) {
  const src = String(text || '');
  const info = /\[\s*Info\s*\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(?:"((?:[^"\\]|\\.)*)"|([\d.]+))/.exec(src);
  if (!info) return null;
  const desc = /\[\s*Description\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/.exec(src);
  const cls = /\bclass\s+([A-Za-z_]\w*)\s*:\s*(?:Rust|Covalence)Plugin\b/.exec(src);
  return { title: unescape(info[1]), author: unescape(info[2]), version: info[3] !== undefined ? unescape(info[3]) : info[4], description: desc ? unescape(desc[1]) : '', className: cls ? cls[1] : null };
}

// 1.10.0 > 1.9.3; anything not numeric compares as text.
function compareVersions(a, b) {
  const pa = String(a || '').split(/[.\-+]/);
  const pb = String(b || '').split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ---- Oxide itself ----
async function latestOxide() {
  return cached('oxide', async () => {
    const r = await fetchJson(OXIDE_RELEASES, { timeout: 20000, headers: { Accept: 'application/vnd.github+json' } });
    const asset = (r.assets || []).find((a) => a.name === OXIDE_ZIP[process.platform]);
    return { version: String(r.tag_name || '').replace(/^v/, ''), url: asset ? asset.browser_download_url : null, publishedAt: r.published_at || null };
  });
}

// Download the newest Oxide.Rust build and unpack it over the server (it replaces some of the
// game's own files in RustDedicated_Data/Managed, so it must be done again after every game update).
async function installOxide(dir, log) {
  if (!OXIDE_ZIP[process.platform]) throw new Error('uMod (Oxide) for Rust runs on Windows and Linux.');
  let rel = null;
  try {
    cache.delete('oxide');
    rel = await latestOxide();
  } catch (err) {
    log.warn(`Couldn't ask GitHub for the newest uMod version (${err.message}); downloading the latest release directly.`);
  }
  const url = (rel && rel.url) || `https://github.com/OxideMod/Oxide.Rust/releases/latest/download/${OXIDE_ZIP[process.platform]}`;
  const zip = path.join(dir, `.oxide-${Date.now()}.zip`);
  log.info(`Downloading uMod (Oxide) for Rust${rel && rel.version ? ` ${rel.version}` : ''}...`);
  try {
    await downloadFile(url, zip, {
      onProgress: (got, total) => log.progress && total && log.progress((got / total) * 100, `${(got / 1048576).toFixed(1)} MB`),
    });
    const files = await extractZip(zip, dir);
    if (!files.some((f) => /Oxide\.Rust\.dll$/i.test(f))) throw new Error('The uMod download did not contain Oxide.Rust.dll');
    for (const sub of ['plugins', 'config', 'data', 'lang', 'logs']) fs.mkdirSync(path.join(dir, 'oxide', sub), { recursive: true });
    log.info(`uMod (Oxide) installed (${files.length} files).`);
    return rel && rel.version ? rel.version : 'latest';
  } finally {
    fs.rmSync(zip, { force: true });
  }
}

module.exports = { search, getPlugin, latestVersions, downloadPlugin, parseInfo, checkSource, compareVersions, latestOxide, installOxide, NAME_RE };
