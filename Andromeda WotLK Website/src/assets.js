'use strict';
// Where the WotLK website's original graphics (SPP's website: templates, images, armory icons)
// come from. Used in this order:
//  1. SPP's own Server\website folder, or a website folder anywhere else inside the SPP install
//  2. a copy in <data>/wowsite-assets, which is downloaded once from SPP's website repository
//     (github.com/celguar/mangos-website) when the SPP install doesn't have one. SPP only
//     downloads its website if you answer Y in its launcher, so many installs don't.
// Only pictures and stylesheets are kept from the download.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { findFiles } = require('./util/paths');

const MARKER = path.join('templates', 'WotLK', 'css', 'newhp.css');
const DOWNLOADED = path.join(config.dataDir, 'wowsite-assets');
const SOURCE = process.env.ANDROMEDA_WOWSITE_ASSETS_URL || 'https://github.com/celguar/mangos-website/archive/refs/heads/main.zip';
// The parts of SPP's website the pages use.
const KEEP_DIRS = /^(templates\/(wotlk|offlike\/images|vanilla\/images)\/|images\/|armory\/images\/)/i;
const KEEP_EXT = /\.(css|png|jpe?g|gif|ico|bmp|webp)$/i;

const has = (dir) => !!dir && fs.existsSync(path.join(dir, MARKER));

let cache = { at: 0, key: '', dir: null };
const searched = new Map(); // SPP root -> website folder found by the (slow) deep search, or null
let state = { downloading: false, failedAt: 0, error: null, progress: null };

function dir(cfg, sppRoot) {
  const key = `${cfg.websiteDir || ''}|${sppRoot || ''}`;
  if (cache.key === key && Date.now() - cache.at < 30000) return cache.dir;
  let found = null;
  for (const d of [cfg.websiteDir, sppRoot && path.join(sppRoot, 'Server', 'website')]) if (has(d)) found = found || d;
  if (!found && sppRoot && fs.existsSync(sppRoot)) {
    // A website folder somewhere else in the SPP install. Searched once: the map data is huge.
    if (!searched.has(sppRoot)) {
      const css = findFiles(sppRoot, (rel, name) => name.toLowerCase() === 'newhp.css' && /templates[\\/]wotlk[\\/]css[\\/]newhp\.css$/i.test(rel), 6)[0];
      searched.set(sppRoot, css ? path.resolve(path.dirname(css), '..', '..', '..') : null);
    }
    if (has(searched.get(sppRoot))) found = searched.get(sppRoot);
  }
  if (!found && has(DOWNLOADED)) found = DOWNLOADED;
  cache = { at: Date.now(), key, dir: found };
  return found;
}

async function download(log) {
  if (state.downloading || Date.now() - state.failedAt < 30 * 60 * 1000) return;
  state = { downloading: true, failedAt: 0, error: null, progress: 0 };
  const { downloadFile } = require('./util/download');
  const { extractZip } = require('./util/zip');
  const zip = path.join(config.cacheDir, 'mangos-website.zip');
  try {
    log.info(`SPP's website graphics weren't found in the SPP folder. Downloading them once from ${SOURCE} ...`);
    let lastMb = 0;
    await downloadFile(SOURCE, zip, {
      onProgress: (got) => {
        const mb = Math.floor(got / (25 * 1024 * 1024)) * 25;
        if (mb > lastMb) {
          lastMb = mb;
          log.info(`  downloaded ${mb} MB...`);
        }
        state.progress = got;
      },
    });
    log.info('Unpacking the pictures and stylesheets...');
    const tmp = DOWNLOADED + '.tmp';
    fs.rmSync(tmp, { recursive: true, force: true });
    await extractZip(zip, tmp, { stripRoot: true, filter: (name) => !name.endsWith('/') && KEEP_DIRS.test(name) && KEEP_EXT.test(name) });
    if (!has(tmp)) throw new Error('the download did not contain the WotLK template');
    fs.rmSync(DOWNLOADED, { recursive: true, force: true });
    fs.renameSync(tmp, DOWNLOADED);
    cache = { at: 0, key: '', dir: null };
    log.info(`Website graphics are ready (${DOWNLOADED}). Reload the website.`);
  } catch (err) {
    state.failedAt = Date.now();
    state.error = err.message;
    log.warn(`Couldn't download the website graphics: ${err.message}. The site works without them, just plainly; it tries again in 30 minutes, or copy SPP's Server\\website folder into place.`);
  } finally {
    state.downloading = false;
    fs.rmSync(zip, { force: true });
  }
}

module.exports = { dir, download, status: () => ({ ...state }), DOWNLOADED, has };
