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
const { extractZip, createZip, listZip, readEntry } = require('../util/zip');
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
//  - IW4x / CoD4x: mods/mp_bots/z_svr_bots.iwd ("svr" iwds stay on the server; players download nothing).
//    CoD4x also gets mods/mp_bots/scriptdata/ (waypoints, bot names), where its scripts read files
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

// ---- CoD4x: XP ----
// Stock CoD4 has no XP multiplier (scr_xpscale arrived with later games) and only counts XP at all
// when sv_pure is 1 (level.rankedMatch in _globallogic.gsc), which CoD4x turns off by itself when
// its own xbase_00.iwd isn't in main. This script rides in the bot mod: it turns XP on, and adds the
// extra XP for the panel's multiplier (andromeda_xpscale) on top of what the game gives, and makes
// the game's XP pop-up show the full amount.
const COD4X_XP_PATH = 'scripts/mp/andromeda_xp.gsc';
const COD4X_XP_SCRIPT = [
  '// Written by Andromeda Hosting. XP on a CoD4x server: see docs/call-of-duty.md.',
  'init()',
  '{',
  '\tlevel.rankedMatch = true;',
  '\tlevel.andromedaXpScale = getdvarfloat( "andromeda_xpscale" );',
  '',
  '\tif ( level.andromedaXpScale > 1 )',
  '\t{',
  '\t\tlevel thread onPlayerConnect();',
  '\t}',
  '}',
  '',
  'onPlayerConnect()',
  '{',
  '\tfor ( ;; )',
  '\t{',
  '\t\tlevel waittill( "connected", player );',
  '\t\tplayer thread watchXp();',
  '\t}',
  '}',
  '',
  '// The game adds XP to self.pers[ "rankxp" ]; whatever it adds, add the rest of the multiplier.',
  'watchXp()',
  '{',
  '\tself endon( "disconnect" );',
  '',
  '\twhile ( !isdefined( self.pers[ "rankxp" ] ) )',
  '\t{',
  '\t\twait 0.05;',
  '\t}',
  '',
  '\tlast = self.pers[ "rankxp" ];',
  '',
  '\tfor ( ;; )',
  '\t{',
  '\t\twait 0.05;',
  '\t\tnow = self.pers[ "rankxp" ];',
  '',
  '\t\tif ( now > last )',
  '\t\t{',
  '\t\t\tbonus = int( ( now - last ) * ( level.andromedaXpScale - 1 ) );',
  '\t\t\tself maps\\mp\\gametypes\\_rank::incRankXP( bonus );',
  '',
  '\t\t\tif ( self maps\\mp\\gametypes\\_rank::updateRank() )',
  '\t\t\t{',
  '\t\t\t\tself thread maps\\mp\\gametypes\\_rank::updateRankAnnounceHUD();',
  '\t\t\t}',
  '',
  '\t\t\t// The game\'s own pop-up adds up what it is given, so the extra makes it show the full amount.',
  '\t\t\tif ( bonus > 0 && isdefined( self.enableText ) && self.enableText && !level.hardcoreMode )',
  '\t\t\t{',
  '\t\t\t\tself thread maps\\mp\\gametypes\\_rank::updateRankScoreHUD( bonus );',
  '\t\t\t}',
  '',
  '\t\t\tnow = self.pers[ "rankxp" ];',
  '\t\t}',
  '',
  '\t\tlast = now;',
  '\t}',
  '}',
  '',
].join('\r\n');
const COD4X_CALLBACKS = 'maps/mp/gametypes/_callbacksetup.gsx';

// Add the XP script to a Bot Warfare source tree and start it from Bot Warfare's own
// _callbacksetup.gsx, right after the game mode has started (where it starts its own scripts).
function addCod4xXpScript(tree, log) {
  const file = path.join(tree, COD4X_CALLBACKS);
  if (!fs.existsSync(file)) {
    log.warn(`Bot Warfare has no ${COD4X_CALLBACKS}, so the XP script couldn't be added. XP then depends on sv_pure, and the XP multiplier does nothing.`);
    return false;
  }
  let text = fs.readFileSync(file, 'utf8');
  if (!text.includes('andromeda_xp::init')) {
    const m = /^([ \t]*)level\.gametypestarted\s*=\s*true;[^\n]*\n/m.exec(text);
    if (!m) {
      log.warn(`Couldn't find where to start the XP script in ${COD4X_CALLBACKS}. XP then depends on sv_pure, and the XP multiplier does nothing.`);
      return false;
    }
    const at = m.index + m[0].length;
    const eol = m[0].endsWith('\r\n') ? '\r\n' : '\n';
    text = text.slice(0, at) + `${m[1]}scripts\\mp\\andromeda_xp::init();${eol}` + text.slice(at);
    fs.writeFileSync(file, text);
  }
  const script = path.join(tree, COD4X_XP_PATH);
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, COD4X_XP_SCRIPT);
  return true;
}

const cod4xScriptdata = (serverDir) => path.join(serverDir, 'mods', 'mp_bots', 'scriptdata');

// Put an extracted Bot Warfare source tree where each game loads it from.
async function packBotWarfare(tmp, { title, modBase, storage }, log) {
  {
    const has = (d) => fs.existsSync(path.join(tmp, d));
    if (!has('maps') && !has('scripts')) throw new Error("The Bot Warfare download doesn't contain the expected maps/ or scripts/ folders");
    if (title === 'cod4x') {
      // CoD4x scripts open plain files under <fs_homepath>/<fs_game>/ (FS_BuildOSPath with no game
      // folder given uses the current one), never from inside an iwd, and Bot Warfare reads
      // scriptdata/waypoints/<map>_wp.csv and scriptdata/botnames.txt that way. So scriptdata goes
      // in the mod folder next to the iwd, and only the scripts go in the iwd.
      addCod4xXpScript(tmp, log);
      const out = path.join(modBase, 'mods', 'mp_bots', 'z_svr_bots.iwd');
      await createZip(tmp, out, { globs: ['maps/**', 'scripts/**'] });
      log.info(`Bot Warfare packed into ${out}`);
      if (has('scriptdata')) {
        copyDir(path.join(tmp, 'scriptdata'), cod4xScriptdata(modBase));
        log.info(`Bot waypoints copied into ${cod4xScriptdata(modBase)}`);
      } else {
        log.warn("The Bot Warfare download has no scriptdata folder, so the bots have no waypoints and won't find their way around.");
      }
    } else if (title === 'iw4x') {
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

// A CoD4x bot mod packed by an older panel has the waypoints inside the iwd (up to 2.5.0) or in
// <server>/scriptdata (2.5.1 and 2.5.2), neither of which the server reads, and no XP script.
// Everything needed is already on disk, so it's put right without a download.
// Returns true when it changed something.
async function repairCod4xBots(serverDir, log) {
  const iwd = path.join(serverDir, 'mods', 'mp_bots', 'z_svr_bots.iwd');
  if (!fs.existsSync(iwd) || !fs.statSync(iwd).size) return false;
  let moved = false;
  const misplaced = path.join(serverDir, 'scriptdata');
  if (fs.existsSync(path.join(misplaced, 'waypoints')) && !fs.existsSync(path.join(cod4xScriptdata(serverDir), 'waypoints'))) {
    copyDir(misplaced, cod4xScriptdata(serverDir));
    fs.rmSync(misplaced, { recursive: true, force: true });
    log.info(`CoD4x bot waypoints moved to ${cod4xScriptdata(serverDir)}, where the server reads them.`);
    moved = true;
  }
  const names = await listZip(iwd);
  const xp = names.includes(COD4X_XP_PATH) ? await readEntry(iwd, COD4X_XP_PATH) : null;
  const xpCurrent = !!xp && xp.data.toString('utf8') === COD4X_XP_SCRIPT;
  const waypointsPacked = names.some((n) => n.startsWith('scriptdata/'));
  const waypointsMissing = !fs.existsSync(path.join(cod4xScriptdata(serverDir), 'waypoints'));
  // Without Bot Warfare's _callbacksetup.gsx the XP script can't be added, so don't retry every start.
  const xpPossible = names.includes(COD4X_CALLBACKS);
  if ((xpCurrent || !xpPossible) && !(waypointsPacked && waypointsMissing)) return moved;
  const tmp = path.join(config.cacheDir, `bw-repair-${Date.now()}`);
  try {
    await extractZip(iwd, tmp);
    // Waypoints already next to the server may have been edited there: keep those.
    if (!waypointsMissing) fs.rmSync(path.join(tmp, 'scriptdata'), { recursive: true, force: true });
    await packBotWarfare(tmp, { title: 'cod4x', modBase: serverDir }, { info() {}, warn: log.warn });
    log.info('CoD4x bot mod updated: bot waypoints put in the mod folder, XP script up to date.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return true;
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

module.exports = { installT7x, T7X_URL, installCod4x, pickCod4xAsset, findCod4xExe, updatePlutonium, plutoStorage, installBotWarfare, packBotWarfare, repairCod4xBots, addCod4xXpScript, COD4X_XP_SCRIPT, linkGameFiles, latestRelease, plutoRoot, plutoBootstrapper };
