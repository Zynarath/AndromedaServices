'use strict';
// Satisfactory mods from ficsit.app (the Satisfactory Mod Repository), the same source the
// Satisfactory Mod Manager and ficsit-cli use. The panel resolves each requested mod plus its
// dependencies (including SML, the mod loader) to versions that fit each other and the installed
// game build, downloads the dedicated-server build of each, and unpacks it into FactoryGame/Mods/<mod>.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const semver = require('../util/semver');
const { fetchJson, downloadFile } = require('../util/download');
const { extractZip } = require('../util/zip');
const { findFiles } = require('../util/paths');
const { HttpError } = require('../util/misc');

const API = 'https://api.ficsit.app';
const CACHE_MS = 10 * 60e3;
const REF_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const STABILITY = { release: 0, beta: 1, alpha: 2 };
// Not mods: the game itself shows up as a dependency of some mods.
const NOT_MODS = new Set(['FactoryGame']);
const cache = new Map();

const TARGET = { win32: 'WindowsServer', linux: 'LinuxServer' };
const serverTarget = () => TARGET[process.platform] || null;

async function gql(query, variables) {
  const res = await fetchJson(`${API}/v2/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    timeout: 20000,
  });
  if (res.errors && res.errors.length && !res.data) throw new Error(`ficsit.app: ${res.errors[0].message}`);
  return res.data || {};
}

const MOD_FIELDS = 'id mod_reference name short_description logo downloads';

async function search(q, { limit = 30, offset = 0 } = {}) {
  const text = String(q || '').trim().slice(0, 100);
  const filter = { limit: Math.min(50, limit), offset: Math.max(0, offset), ...(text ? { search: text } : { order_by: 'downloads', order: 'desc' }) };
  const data = await gql(`query ($filter: ModFilter) { getMods(filter: $filter) { count mods { ${MOD_FIELDS} } } }`, { filter });
  const r = data.getMods || { count: 0, mods: [] };
  return { count: r.count, mods: r.mods.filter((m) => !NOT_MODS.has(m.mod_reference)).map(slim) };
}

function slim(m) {
  return { id: m.id, ref: m.mod_reference, name: m.name, summary: m.short_description || '', logo: m.logo || null, downloads: m.downloads || 0, url: `https://ficsit.app/mod/${encodeURIComponent(m.mod_reference)}` };
}

// A mod and its versions, by reference ("SML") or id.
async function getMod(idOrRef, { refresh = false } = {}) {
  const key = String(idOrRef);
  const hit = cache.get(key);
  if (hit && !refresh && Date.now() - hit.at < CACHE_MS) return hit.mod;
  const versionFields = 'id version game_version required_on_remote stability created_at dependencies { mod_id condition optional } targets { targetName link hash size }';
  const data = await gql(
    `query ($id: String!) { getModByIdOrReference(modIdOrReference: $id) { ${MOD_FIELDS} versions(filter: { limit: 100 }) { ${versionFields} } } }`,
    { id: key }
  );
  const mod = data.getModByIdOrReference;
  if (!mod) throw new HttpError(404, `ficsit.app has no mod "${key}"`);
  cache.set(key, { at: Date.now(), mod });
  cache.set(mod.mod_reference, { at: Date.now(), mod });
  cache.set(mod.id, { at: Date.now(), mod });
  return mod;
}

function hasTarget(version, target) {
  return (version.targets || []).some((t) => t.targetName === target);
}

// The build number of the installed game (e.g. 365306), which mods state compatibility against.
function gameBuild(serverDir) {
  for (const sub of ['Win64', 'Linux']) {
    const dir = path.join(serverDir, 'Engine', 'Binaries', sub);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.version'));
    } catch {}
    for (const f of files.sort((a, b) => Number(/FactoryServer/i.test(b)) - Number(/FactoryServer/i.test(a)))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const cl = Number(j.Changelist || j.CompatibleChangelist);
        if (cl > 100000) return cl;
      } catch {}
    }
  }
  return null;
}

/**
 * Pick a version for every requested mod and everything they need.
 *  wanted: [{ ref, version? }]  (version pins an exact version)
 * Resolves to Map(ref -> { mod, version, requiredBy: [refs] }).
 */
async function resolve(wanted, { game = null, target = serverTarget(), log } = {}) {
  if (!target) throw new Error('Satisfactory mods are only available for Windows and Linux servers');
  const ranges = new Map(); // ref -> [{ range, from }]
  const chosen = new Map();
  const mods = new Map();
  const wantedRefs = new Set(wanted.map((w) => w.ref));
  const addRange = (ref, range, from) => {
    if (!ranges.has(ref)) ranges.set(ref, []);
    ranges.get(ref).push({ range, from });
  };
  for (const w of wanted) addRange(w.ref, w.version ? `=${w.version}` : '*', 'you');

  const pick = (mod) => {
    const rs = ranges.get(mod.mod_reference) || [];
    const fits = (v) => hasTarget(v, target) && rs.every((r) => r.range === '*' || semver.satisfies(v.version, r.range)) && (!game || !v.game_version || semver.satisfies(String(game), v.game_version));
    const ok = mod.versions.filter((v) => semver.parse(v.version) && fits(v));
    ok.sort((a, b) => (STABILITY[a.stability] ?? 3) - (STABILITY[b.stability] ?? 3) || semver.compare(b.version, a.version));
    return ok[0] || null;
  };
  const explain = (mod) => {
    const rs = ranges.get(mod.mod_reference) || [];
    const withTarget = mod.versions.filter((v) => hasTarget(v, target));
    if (!withTarget.length) return `${mod.name} has no dedicated-server build for ${target === 'WindowsServer' ? 'Windows' : 'Linux'}`;
    const need = rs.filter((r) => r.range !== '*').map((r) => `${r.range} (for ${r.from})`);
    const gameFits = withTarget.filter((v) => !game || !v.game_version || semver.satisfies(String(game), v.game_version));
    if (!gameFits.length) return `no version of ${mod.name} works with this game build (${game})`;
    return `no version of ${mod.name} matches ${need.join(' and ') || 'the requirements'}`;
  };

  // Keep going until every mod's version satisfies everything that depends on it.
  for (let round = 0; round < 50; round++) {
    let changed = false;
    for (const ref of [...ranges.keys()]) {
      if (!mods.has(ref)) {
        const m = await getMod(ref);
        mods.set(ref, m);
        if (m.mod_reference !== ref) {
          // Depended on by id: carry the constraints over to the reference.
          for (const r of ranges.get(ref)) addRange(m.mod_reference, r.range, r.from);
          ranges.delete(ref);
          mods.set(m.mod_reference, m);
          changed = true;
          continue;
        }
      }
      const mod = mods.get(ref);
      const v = pick(mod);
      if (!v) throw new HttpError(409, `Can't install ${mod.name}: ${explain(mod)}.`);
      const prev = chosen.get(ref);
      if (prev && prev.version.id === v.id) continue;
      chosen.set(ref, { mod, version: v, requiredBy: [] });
      changed = true;
      // What the previously picked version needed no longer applies.
      for (const [other, list] of ranges) ranges.set(other, list.filter((r) => r.from !== ref));
      for (const d of v.dependencies || []) {
        if (NOT_MODS.has(d.mod_id)) continue;
        if (d.optional && !wantedRefs.has(d.mod_id) && !chosen.has(d.mod_id)) continue;
        addRange(d.mod_id, d.condition || '*', mod.mod_reference);
      }
    }
    if (!changed) break;
  }
  // Drop mods only an earlier, replaced version needed.
  const needed = new Set();
  const visit = (ref) => {
    if (needed.has(ref) || !chosen.has(ref)) return;
    needed.add(ref);
    for (const d of chosen.get(ref).version.dependencies || []) {
      const depRef = mods.get(d.mod_id) ? mods.get(d.mod_id).mod_reference : d.mod_id;
      if (!d.optional || wantedRefs.has(depRef)) {
        if (chosen.has(depRef)) chosen.get(depRef).requiredBy.push(ref);
        visit(depRef);
      }
    }
  };
  for (const ref of wantedRefs) visit((mods.get(ref) || {}).mod_reference || ref);
  for (const ref of [...chosen.keys()]) if (!needed.has(ref)) chosen.delete(ref);
  if (log) for (const [ref, c] of chosen) log.info(`  ${c.mod.name} (${ref}) ${c.version.version}${c.requiredBy.length ? ` — needed by ${[...new Set(c.requiredBy)].join(', ')}` : ''}`);
  return chosen;
}

function absoluteLink(link) {
  if (/^https:\/\//i.test(link)) return link;
  if (String(link).startsWith('/')) return API + link;
  throw new Error(`unexpected download address ${link}`);
}

function sha256(file) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', rej).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex')));
  });
}

/**
 * Install resolved mods into <serverDir>/FactoryGame/Mods. `previous` is { ref: version } of what the
 * panel installed last time; those folders are replaced or removed, other folders are left alone.
 * Returns the new { ref: version } map.
 */
async function install(serverDir, chosen, previous = {}, { target = serverTarget(), log } = {}) {
  const modsDir = path.join(serverDir, 'FactoryGame', 'Mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const result = {};
  const tmpRoot = path.join(config.cacheDir, 'ficsit');
  fs.mkdirSync(tmpRoot, { recursive: true });
  for (const [ref, c] of chosen) {
    if (!REF_RE.test(ref)) throw new Error(`unexpected mod reference "${ref}"`);
    const dest = path.join(modsDir, ref);
    if (previous[ref] === c.version.version && fs.existsSync(path.join(dest, `${ref}.uplugin`))) {
      result[ref] = c.version.version;
      continue;
    }
    const t = c.version.targets.find((x) => x.targetName === target);
    log.info(`Downloading ${c.mod.name} ${c.version.version}...`);
    const zip = path.join(tmpRoot, `${ref}-${c.version.version}-${target}.zip`);
    const unpack = path.join(tmpRoot, `${ref}-unpack-${Date.now()}`);
    try {
      await downloadFile(absoluteLink(t.link), zip, { timeout: 10 * 60e3 });
      if (t.hash && /^[0-9a-f]{64}$/i.test(t.hash)) {
        const got = await sha256(zip);
        if (got.toLowerCase() !== t.hash.toLowerCase()) throw new Error(`${c.mod.name}: download is damaged (checksum mismatch)`);
      }
      await extractZip(zip, unpack);
      // The plugin root is the folder with <ref>.uplugin (the archive may or may not wrap it in a folder).
      const plugin = findFiles(unpack, (_rel, name) => name.toLowerCase() === `${ref.toLowerCase()}.uplugin`, 3)[0];
      if (!plugin) throw new Error(`${c.mod.name}: the download has no ${ref}.uplugin`);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(path.dirname(plugin), dest);
      result[ref] = c.version.version;
      log.info(`Installed ${c.mod.name} ${c.version.version}`);
    } finally {
      fs.rmSync(zip, { force: true });
      fs.rmSync(unpack, { recursive: true, force: true });
    }
  }
  for (const ref of Object.keys(previous)) {
    if (result[ref] || !REF_RE.test(ref)) continue;
    fs.rmSync(path.join(modsDir, ref), { recursive: true, force: true });
    log.info(`Removed ${ref} (no longer needed)`);
  }
  return result;
}

module.exports = { search, getMod, resolve, install, gameBuild, serverTarget, slim, REF_RE };
