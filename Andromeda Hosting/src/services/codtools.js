'use strict';
// Downloads for the community Call of Duty clients:
//  - CoD4x dedicated server binaries (GitHub releases)
//  - Plutonium (T5/T6/IW5) via its official updater
//  - Bot Warfare bot mods by ineedbots (GitHub releases)
// None of these include the games themselves: the servers run on your own game install.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const config = require('../config');
const { fetchJson, fetchWithRetry, downloadFile } = require('../util/download');
const { extractZip, createZip } = require('../util/zip');
const { findFiles } = require('../util/paths');

// Prefer the Plutonium you already play with (%LOCALAPPDATA%\Plutonium, kept updated by its launcher);
// otherwise Andromeda Hosting keeps its own copy under data/runtimes/plutonium.
const OWN_PLUTO = path.join(config.runtimesDir, 'plutonium');
const USER_PLUTO = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Plutonium') : null;
const bootstrapperIn = (root) => path.join(root, 'bin', 'plutonium-bootstrapper-win32.exe');
function plutoRoot() {
  if (USER_PLUTO && fs.existsSync(bootstrapperIn(USER_PLUTO))) return USER_PLUTO;
  return OWN_PLUTO;
}
const plutoBootstrapper = () => bootstrapperIn(plutoRoot());

async function latestRelease(repo) {
  try {
    return await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  } catch (err) {
    if (err.status !== 403 && err.status !== 429) throw err;
  }
  // API rate limit (60/hour per IP): read the release page instead.
  const res = await fetchWithRetry(`https://github.com/${repo}/releases/latest`);
  const tag = decodeURIComponent((/\/releases\/tag\/([^/?#]+)/.exec(res.url) || [])[1] || '');
  if (!tag) throw new Error(`Couldn't find the latest release of ${repo}`);
  const page = await (await fetchWithRetry(`https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`)).text();
  const assets = [...new Set([...page.matchAll(/href="(\/[^"]+\/releases\/download\/[^"]+)"/g)].map((m) => m[1]))].map((href) => ({
    name: decodeURIComponent(href.split('/').pop()),
    browser_download_url: 'https://github.com' + href,
  }));
  return { tag_name: tag, assets, zipball_url: `https://github.com/${repo}/archive/refs/tags/${tag}.zip` };
}

// Pick a release asset by name patterns; fall back to the source zip.
function pickAsset(release, patterns) {
  for (const re of patterns) {
    const a = (release.assets || []).find((x) => re.test(x.name));
    if (a) return { url: a.browser_download_url, name: a.name };
  }
  return null;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

// ---- T7x (Black Ops III) ----
// AlterWare's T7x client, from the address its install guide gives (forum.alterware.dev/t/1418).
// It's a single exe that goes in the Unranked Server folder, next to the zone folder.
const T7X_URL = 'https://master.bo3.eu/t7x/t7x.exe';

async function installT7x(gameDir, log, url = T7X_URL) {
  const dest = path.join(gameDir, 't7x.exe');
  const tmp = path.join(config.cacheDir, `t7x-${Date.now()}.exe`);
  log.info(`Downloading T7x from ${url}...`);
  try {
    await downloadFile(url, tmp);
    const head = Buffer.alloc(2);
    const fd = fs.openSync(tmp, 'r');
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    // Windows programs start with "MZ"; anything else is an error page, not T7x.
    if (head.toString('latin1') !== 'MZ') throw new Error('the download is not a Windows program');
    fs.copyFileSync(tmp, dest);
    log.info(`T7x installed: ${dest}`);
  } catch (err) {
    if (fs.existsSync(dest)) {
      log.warn(`Couldn't update T7x (${err.message}). Keeping the t7x.exe already in ${gameDir}.`);
      return;
    }
    throw new Error(`Couldn't download T7x (${err.message}). Download t7x.exe yourself (see alterware.dev) and put it in ${gameDir}, then press Reinstall.`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---- CoD4x ----
// Each release has the server as a bare binary (cod4x18_dedrun.exe / cod4x18_dedrun) next to
// plugins_windows.zip / plugins_linux.zip, which hold only optional plugins. Older releases
// packed the server in a zip, so that's still understood, but a plugins archive never is.
function pickCod4xAsset(release, platform = process.platform) {
  const win = platform === 'win32';
  const binName = win ? 'cod4x18_dedrun.exe' : 'cod4x18_dedrun';
  const assets = (release.assets || []).filter((a) => !/plugin/i.test(a.name));
  const bin = assets.find((a) => a.name.toLowerCase() === binName);
  if (bin) return { url: bin.browser_download_url, name: bin.name, binary: true };
  const zip = pickAsset({ assets }, win ? [/windows.*\.zip$/i, /win.*\.zip$/i] : [/linux.*\.zip$/i, /linux.*\.tar\.gz$/i]);
  return zip ? { ...zip, binary: false } : null;
}

async function installCod4x(serverDir, log) {
  log.info('Looking up the latest CoD4x server release on GitHub...');
  const rel = await latestRelease('callofduty4x/CoD4x_Server');
  const win = process.platform === 'win32';
  const asset = pickCod4xAsset(rel);
  if (!asset) throw new Error(`CoD4x release ${rel.tag_name} has no ${win ? 'Windows' : 'Linux'} server download. Get ${win ? 'cod4x18_dedrun.exe' : 'cod4x18_dedrun'} from github.com/callofduty4x/CoD4x_Server/releases and put it in ${serverDir}`);
  fs.mkdirSync(serverDir, { recursive: true });
  log.info(`Downloading ${asset.name} (${rel.tag_name})...`);
  if (asset.binary) {
    const dest = path.join(serverDir, win ? 'cod4x18_dedrun.exe' : 'cod4x18_dedrun');
    const tmp = dest + '.download';
    await downloadFile(asset.url, tmp);
    fs.renameSync(tmp, dest);
  } else {
    const file = path.join(config.cacheDir, asset.name);
    await downloadFile(asset.url, file);
    if (asset.name.endsWith('.zip')) await extractZip(file, serverDir, { stripRoot: true });
    else await new Promise((res, rej) => execFile('tar', ['-xzf', file, '-C', serverDir], (e) => (e ? rej(e) : res())));
    fs.rmSync(file, { force: true });
  }
  const exe = findCod4xExe(serverDir);
  if (!exe) throw new Error(`Downloaded ${asset.name} but could not find ${win ? 'cod4x18_dedrun.exe' : 'cod4x18_dedrun'} in it`);
  if (!win) fs.chmodSync(exe, 0o755);
  log.info(`CoD4x server ${rel.tag_name} installed.`);
  return rel.tag_name;
}

function findCod4xExe(dir) {
  const name = process.platform === 'win32' ? 'cod4x18_dedrun.exe' : 'cod4x18_dedrun';
  return findFiles(dir, (_rel, n) => n === name, 3)[0] || null;
}

// ---- Plutonium ----
async function updatePlutonium(log) {
  if (process.platform !== 'win32') throw new Error('Plutonium servers need Windows');
  if (plutoRoot() === USER_PLUTO) {
    log.info(`Using your Plutonium install at ${USER_PLUTO} (it updates whenever you open the Plutonium launcher).`);
    return;
  }
  const PLUTO_DIR = OWN_PLUTO;
  fs.mkdirSync(PLUTO_DIR, { recursive: true });
  const updater = path.join(PLUTO_DIR, 'plutonium.exe');
  log.info('Downloading the Plutonium updater...');
  await downloadFile('https://cdn.plutonium.pw/updater/plutonium.exe', updater);
  log.info('Updating Plutonium files (first run downloads a few hundred MB)...');
  await new Promise((resolve, reject) => {
    const child = spawn(updater, ['-install-dir', PLUTO_DIR, '-update-only'], { cwd: PLUTO_DIR, windowsHide: true });
    const out = (d) => d.toString().split(/\r?\n/).filter((l) => l.trim()).forEach((l) => log.info(l.trim()));
    child.stdout.on('data', out);
    child.stderr.on('data', out);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Plutonium updater exited with code ${code}`))));
  });
  if (!fs.existsSync(bootstrapperIn(PLUTO_DIR))) throw new Error(`Plutonium updated but ${bootstrapperIn(PLUTO_DIR)} is missing. Install Plutonium normally from plutonium.pw and Andromeda Hosting will use that.`);
  log.info('Plutonium is up to date.');
}

function plutoStorage(game) {
  return path.join(plutoRoot(), 'storage', game);
}

// ---- Bot Warfare ----
// Built from each repo's source (the layout the READMEs describe), so it doesn't depend on how a
// release archive happens to be packaged and doesn't use the rate-limited GitHub API.
//  - IW4x / CoD4x: mods/mp_bots/z_svr_bots.iwd ("svr" iwds stay on the server; players download nothing)
//  - Plutonium T6: scripts/ into Plutonium's storage/t6
//  - Plutonium IW5 / T5: maps/, scripts/, scriptdata/ (+ mp/ for T5) into storage/<game>
async function installBotWarfare({ repo, title, modBase, storage }, log) {
  const url = `https://codeload.github.com/${repo}/zip/refs/heads/master`;
  const zip = path.join(config.cacheDir, `${repo.replace('/', '-')}.zip`);
  log.info(`Downloading Bot Warfare (${repo})...`);
  await downloadFile(url, zip);
  const tmp = path.join(config.cacheDir, `bw-${Date.now()}`);
  try {
    await extractZip(zip, tmp, { stripRoot: true });
    await packBotWarfare(tmp, { title, modBase, storage }, log);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
  }
  return `master (${new Date().toISOString().slice(0, 10)})`;
}

// Put an extracted Bot Warfare source tree where each game loads it from.
async function packBotWarfare(tmp, { title, modBase, storage }, log) {
  {
    const has = (d) => fs.existsSync(path.join(tmp, d));
    if (!has('maps') && !has('scripts')) throw new Error("The Bot Warfare download doesn't contain the expected maps/ or scripts/ folders");
    if (title === 'iw4x' || title === 'cod4x') {
      const out = path.join(modBase, 'mods', 'mp_bots', 'z_svr_bots.iwd');
      await createZip(tmp, out, { globs: ['maps/**', 'scripts/**', 'scriptdata/**'] });
      log.info(`Bot Warfare packed into ${out}`);
    } else {
      const dirs = title === 't6' ? ['scripts'] : title === 't5' ? ['maps', 'scripts', 'mp'] : ['maps', 'scripts', 'scriptdata'];
      const target = plutoStorage(storage);
      for (const d of dirs) if (has(d)) copyDir(path.join(tmp, d), path.join(target, d));
      log.info(`Bot Warfare copied into ${target}`);
    }
  }
}

// CoD4x wants the base game's main/*.iwd and zone/ inside the server folder. Hard links take no
// extra space when the server and game are on the same drive; otherwise the files are copied.
function linkGameFiles(gameDir, serverDir, log) {
  let linked = 0;
  let copied = 0;
  const place = (src, dest) => {
    try {
      const a = fs.statSync(src);
      const b = fs.existsSync(dest) ? fs.statSync(dest) : null;
      if (b && b.size === a.size) return;
      if (b) fs.rmSync(dest, { force: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.linkSync(src, dest);
        linked++;
      } catch {
        fs.copyFileSync(src, dest);
        copied++;
      }
    } catch (err) {
      log.warn(`Could not add ${src}: ${err.message}`);
    }
  };
  const main = path.join(gameDir, 'main');
  for (const f of fs.existsSync(main) ? fs.readdirSync(main) : []) if (/\.iwd$/i.test(f)) place(path.join(main, f), path.join(serverDir, 'main', f));
  const zone = path.join(gameDir, 'zone');
  for (const abs of findFiles(zone, () => true, 4)) place(abs, path.join(serverDir, 'zone', path.relative(zone, abs)));
  if (linked || copied) log.info(`Game files: ${linked} linked, ${copied} copied into the server folder.`);
}

module.exports = { installT7x, T7X_URL, installCod4x, pickCod4xAsset, findCod4xExe, updatePlutonium, plutoStorage, installBotWarfare, packBotWarfare, linkGameFiles, latestRelease, plutoRoot, plutoBootstrapper };
