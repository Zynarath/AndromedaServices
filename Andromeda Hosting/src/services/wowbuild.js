'use strict';
// The Andromeda WotLK server: SPP Classics V2's WotLK server with our changes (dungeon finder
// matchmaking, ...), from github.com/Zynarath/mangos-wotlk (branch "andromeda"). GitHub builds it
// and publishes each version as a release; the panel installs it next to SPP's own programs:
//   <SPP>\Server\Binaries\wotlk\Bin64\mangosd.exe            SPP's original, never touched
//   <SPP>\Server\Binaries\wotlk\Andromeda\1.1.0\mangosd.exe  ours, one folder per version
// Only the programs differ: both use SPP's .conf files, map data and databases, so switching back
// and forth is just a restart.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { downloadFile } = require('../util/download');
const { extractZip } = require('../util/zip');
const { latestRelease } = require('./codtools');

const REPO = 'Zynarath/mangos-wotlk';
const EXE = process.platform === 'win32' ? '.exe' : '';
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const ASSET_RE = /^andromeda-wotlk-server-[\d.]+\.zip$/i;
const KEEP = 3; // installed versions kept, newest first

// <SPP>\Server\Binaries\wotlk\Bin64 -> <SPP>\Server\Binaries\wotlk\Andromeda
const buildsDir = (sppBin) => path.join(path.dirname(sppBin), 'Andromeda');

function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

const complete = (dir) => ['mangosd', 'realmd'].every((n) => fs.existsSync(path.join(dir, n + EXE)));

// Installed versions, newest first.
function installed(sppBin) {
  const root = buildsDir(sppBin);
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names.filter((n) => VERSION_RE.test(n) && complete(path.join(root, n))).sort((a, b) => compareVersions(b, a));
}

// The newest installed version, or null.
function current(sppBin) {
  const version = installed(sppBin)[0];
  return version ? { version, dir: path.join(buildsDir(sppBin), version) } : null;
}

// Makes sure the newest release is installed (when GitHub can be reached) and returns the newest
// installed version. Offline, an installed version is used as it is.
async function ensure(sppBin, log, { fetchRelease = () => latestRelease(REPO), download = downloadFile } = {}) {
  const root = buildsDir(sppBin);
  let release = null;
  try {
    release = await fetchRelease();
  } catch (err) {
    log.warn(`Couldn't check GitHub for a newer Andromeda server (${err.message}).`);
  }
  if (release) {
    const version = String(release.tag_name || '').replace(/^v/i, '');
    const asset = (release.assets || []).find((a) => ASSET_RE.test(a.name));
    if (!VERSION_RE.test(version) || !asset) {
      log.warn(`The latest release on github.com/${REPO} (${release.tag_name}) has no server download.`);
    } else if (!installed(sppBin).includes(version)) {
      log.info(`Downloading the Andromeda server ${version}...`);
      const zip = path.join(config.cacheDir, `andromeda-wotlk-server-${version}-${Date.now()}.zip`);
      const tmp = path.join(root, `.${version}-${Date.now()}`);
      try {
        await download(asset.browser_download_url, zip);
        await extractZip(zip, tmp, { stripRoot: true });
        if (!complete(tmp)) throw new Error('the download has no mangosd and realmd');
        fs.rmSync(path.join(root, version), { recursive: true, force: true });
        fs.renameSync(tmp, path.join(root, version));
        log.info(`Installed the Andromeda server ${version} in ${path.join(root, version)}`);
      } catch (err) {
        log.warn(`Couldn't install the Andromeda server ${version}: ${err.message}`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(zip, { force: true });
      }
    }
  }
  // Keep a few versions, so an older one can be put back by hand if a new one misbehaves.
  for (const old of installed(sppBin).slice(KEEP)) {
    try {
      fs.rmSync(path.join(root, old), { recursive: true, force: true });
    } catch {} // in use or locked: try again next start
  }
  const now = current(sppBin);
  if (!now) {
    throw new Error(`The Andromeda server isn't installed and couldn't be downloaded from github.com/${REPO}/releases. ` +
      'Check the internet connection and start again, or switch Settings → Realm → Server program back to "SPP original".');
  }
  return now;
}

module.exports = { REPO, buildsDir, installed, current, ensure, compareVersions };
