'use strict';
// Installs / updates a CurseForge Minecraft modpack as a dedicated server.
// Prefers the pack's official server pack; otherwise builds one from the client manifest.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const cf = require('./curseforge');
const loaders = require('./loaders');
const { ensureJava, javaMajorFor } = require('./java');
const { downloadFile } = require('../util/download');
const { extractZip, readEntry, listZip, commonRoot } = require('../util/zip');
const Properties = require('../util/properties');

// Files and folders that belong to the server owner and must survive pack updates.
const PRESERVE_FILES = new Set([
  'server.properties',
  'eula.txt',
  'ops.json',
  'whitelist.json',
  'banned-ips.json',
  'banned-players.json',
  'usercache.json',
  'user_jvm_args.txt',
]);

// Mods that are known to crash or be useless on a dedicated server.
const CLIENT_ONLY_SLUGS = new Set([
  'oculus', 'iris', 'sodium', 'embeddium', 'rubidium', 'magnesium', 'optifine', 'betterf3', 'legendary-tooltips',
  'toast-control', 'controlling', 'chat-heads', 'not-enough-animations', 'ding', 'reeses-sodium-options',
  'sodium-extra', 'entity-model-features', 'entitytexturefeatures', 'cull-less-leaves', 'enhancedvisuals',
  'fancymenu', 'drippy-loading-screen', 'loading-screen-tips', 'skin-layers-3d', 'zoomify', 'ok-zoomer',
]);

function levelNames(dir) {
  const names = new Set(['world']);
  const propsFile = path.join(dir, 'server.properties');
  if (fs.existsSync(propsFile)) {
    const level = new Properties(fs.readFileSync(propsFile, 'utf8')).get('level-name');
    if (level) names.add(level);
  }
  return names;
}

function makeProtector(dir, isUpdate) {
  if (!isUpdate) return () => true;
  const worlds = levelNames(dir);
  return (rel) => {
    const top = rel.split('/')[0];
    if (worlds.has(top) || worlds.has(top.replace(/_(nether|the_end)$/, ''))) return false;
    if (!rel.includes('/') && PRESERVE_FILES.has(rel) && fs.existsSync(path.join(dir, rel))) return false;
    return true;
  };
}

function parseLoader(manifest) {
  const loadersList = (manifest.minecraft && manifest.minecraft.modLoaders) || [];
  const primary = loadersList.find((l) => l.primary) || loadersList[0];
  if (!primary) return { loader: 'vanilla', loaderVersion: null };
  const [name, ...rest] = primary.id.split('-');
  return { loader: name.toLowerCase(), loaderVersion: rest.join('-') };
}

async function cfDownload(file, dest, log) {
  let url = file.downloadUrl || (await cf.downloadUrl(file.modId, file.id));
  if (!url) return false;
  await downloadFile(url, dest, {
    onProgress: (r, t) => log.progress && t && t > 5e6 && log.progress((r / t) * 100, `${file.fileName}: ${(r / 1048576).toFixed(0)} MB`),
  });
  return true;
}

function launchMatches(launch, loader) {
  if (!launch) return false;
  if (loader === 'forge' || loader === 'neoforge') return launch.kind === 'argsfile' || /forge/i.test(launch.file);
  if (loader === 'fabric') return /fabric/i.test(launch.file);
  if (loader === 'quilt') return /quilt/i.test(launch.file);
  return true;
}

/**
 * @returns {Promise<{mcVersion, loader, loaderVersion, javaMajor, packName, versionName, manual: Array}>}
 */
async function installModpack({ dir, modId, fileId, isUpdate, log }) {
  fs.mkdirSync(dir, { recursive: true });
  const mod = await cf.getMod(modId);
  const file = await cf.getFile(modId, fileId);
  log.info(`Modpack: ${mod.name} — ${file.displayName}`);

  // 1) The client pack zip carries manifest.json with the exact MC + loader versions.
  const packZip = path.join(config.cacheDir, `cf-${modId}-${fileId}.zip`);
  log.info('Downloading modpack manifest...');
  if (!(await cfDownload(file, packZip, log))) throw new Error('This modpack file cannot be downloaded through the CurseForge API.');
  const manifestEntry = await readEntry(packZip, (n) => n === 'manifest.json' || /^[^/]+\/manifest\.json$/.test(n));
  if (!manifestEntry) throw new Error('The modpack zip has no manifest.json — is this really a CurseForge modpack?');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  const mcVersion = manifest.minecraft.version;
  let { loader, loaderVersion } = parseLoader(manifest);
  log.info(`Minecraft ${mcVersion}, ${loader} ${loaderVersion || ''}`);

  const javaMajor = await javaMajorFor(mcVersion);
  const java = await ensureJava(javaMajor, log);
  const allow = makeProtector(dir, isUpdate);

  if (isUpdate) {
    log.info('Removing old mods and loader files (worlds and server settings are kept)...');
    fs.rmSync(path.join(dir, 'mods'), { recursive: true, force: true });
    loaders.cleanLoader(dir);
  }

  const manual = [];
  let usedServerPack = false;

  // 2) Prefer the official server pack.
  if (file.serverPackFileId) {
    try {
      const sp = await cf.getFile(modId, file.serverPackFileId);
      const spZip = path.join(config.cacheDir, `cf-${modId}-${sp.id}-server.zip`);
      log.info(`Downloading server pack ${sp.fileName} (${(sp.fileLength / 1048576).toFixed(0)} MB)...`);
      if (await cfDownload(sp, spZip, log)) {
        log.info('Extracting server pack...');
        const names = await listZip(spZip);
        await extractZip(spZip, dir, {
          stripRoot: commonRoot(names),
          filter: allow,
          onProgress: (d, t) => log.progress && log.progress((d / t) * 100, `Extracting ${d}/${t}`),
        });
        fs.rmSync(spZip, { force: true });
        usedServerPack = true;
      } else {
        log.warn('Server pack is not downloadable via the API; building the server from the manifest instead.');
      }
    } catch (err) {
      log.warn(`Server pack failed (${err.message}); building the server from the manifest instead.`);
    }
  }

  if (!usedServerPack) {
    // 3) Build from the manifest: download every server-compatible mod and copy overrides.
    const ids = manifest.files.filter((f) => f.required !== false).map((f) => f.fileID);
    log.info(`Resolving ${ids.length} mods...`);
    const files = await cf.getFilesByIds(ids);
    const mods = await cf.getMods([...new Set(files.map((f) => f.modId))]);
    const modById = new Map(mods.map((m) => [m.id, m]));
    const modsDir = path.join(dir, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    let done = 0;
    for (const f of files) {
      done++;
      const m = modById.get(f.modId);
      const gv = f.gameVersions || [];
      const clientOnly = (gv.includes('Client') && !gv.includes('Server')) || (m && CLIENT_ONLY_SLUGS.has(m.slug));
      if (m && m.classId && m.classId !== cf.CLASS_MC_MOD) continue; // resource packs, shaders, worlds
      if (clientOnly) {
        log.info(`Skipping client-only mod: ${m ? m.name : f.fileName}`);
        continue;
      }
      if (log.progress) log.progress((done / files.length) * 100, `Mods ${done}/${files.length}`);
      const ok = await cfDownload(f, path.join(modsDir, f.fileName), { info() {} }).catch((e) => {
        log.warn(`Failed to download ${f.fileName}: ${e.message}`);
        return false;
      });
      if (!ok) manual.push({ name: m ? m.name : f.fileName, fileName: f.fileName, url: m && m.links ? `${m.links.websiteUrl}/files/${f.id}` : null });
    }
    const overrides = manifest.overrides || 'overrides';
    const prefix = manifestEntry.name.includes('/') ? manifestEntry.name.split('/')[0] + '/' : '';
    log.info('Copying modpack config overrides...');
    await extractZip(packZip, dir, { stripRoot: prefix, subdir: overrides, filter: allow });
  }
  fs.rmSync(packZip, { force: true });

  // 4) Make sure the right loader is installed and launchable.
  let launch = loaders.detectLaunch(dir);
  if (!launchMatches(launch, loader)) {
    log.info(`Installing ${loader} ${loaderVersion || ''} for Minecraft ${mcVersion}...`);
    loaderVersion = (await loaders.installLoader(dir, { mcVersion, loader, loaderVersion, java, log })) || loaderVersion;
    launch = loaders.detectLaunch(dir);
  }
  // Server packs often ship installers and scripts we no longer need.
  for (const f of fs.readdirSync(dir)) if (/installer\.jar(\.log)?$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  if (!launch) throw new Error('Installed the pack but could not find a server jar to start. Check the Files tab.');
  log.info(`Launch target: ${launch.file}`);

  if (manual.length) {
    log.warn(`${manual.length} mod(s) block third-party downloads and must be added to the mods folder by hand:`);
    for (const m of manual) log.warn(`  - ${m.name} (${m.fileName}) ${m.url || ''}`);
  }
  return { mcVersion, loader, loaderVersion, javaMajor, packName: mod.name, versionName: file.displayName, manual, usedServerPack };
}

module.exports = { installModpack, parseLoader, PRESERVE_FILES };
