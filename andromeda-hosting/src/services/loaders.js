'use strict';
// Minecraft server installation: vanilla, Forge, NeoForge and Fabric.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { fetchJson, fetchText, downloadFile } = require('../util/download');
const { mojangVersionJson } = require('./java');
const { findFiles, relTo } = require('../util/paths');

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function listMcVersions(snapshots = false) {
  const manifest = await cached('mc-manifest', 10 * 60e3, () =>
    fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
  );
  return manifest.versions.filter((v) => v.type === 'release' || (snapshots && v.type === 'snapshot')).map((v) => v.id);
}

function neoForgePrefix(mc) {
  // 1.20.4 -> "20.4.", 1.21 -> "21.0.", 1.21.1 -> "21.1.", 26.1 -> "26.1."
  const parts = mc.split('.');
  if (parts[0] === '1') return `${parts[1]}.${parts[2] || '0'}.`;
  return `${parts[0]}.${parts[1] || '0'}.`;
}

async function listLoaderVersions(loader, mc) {
  if (loader === 'fabric') {
    const list = await cached('fabric-' + mc, 10 * 60e3, () => fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`));
    return list.map((e) => ({ version: e.loader.version, stable: e.loader.stable }));
  }
  if (loader === 'forge') {
    const [xml, promos] = await Promise.all([
      cached('forge-meta', 10 * 60e3, () => fetchText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml')),
      cached('forge-promos', 10 * 60e3, () => fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).catch(() => ({ promos: {} })),
    ]);
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
      .map((m) => m[1])
      .filter((v) => v.startsWith(mc + '-'))
      .map((v) => v.slice(mc.length + 1));
    const rec = promos.promos[`${mc}-recommended`];
    const latest = promos.promos[`${mc}-latest`];
    return versions.reverse().map((v) => ({ version: v, stable: v === rec || (!rec && v === latest), recommended: v === rec }));
  }
  if (loader === 'neoforge') {
    if (mc === '1.20.1') {
      const res = await cached('neo-legacy', 10 * 60e3, () => fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge'));
      return res.versions.filter((v) => v.startsWith('1.20.1-')).map((v) => ({ version: v.slice(7), stable: true })).reverse();
    }
    const res = await cached('neo', 10 * 60e3, () => fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'));
    const prefix = neoForgePrefix(mc);
    return res.versions.filter((v) => v.startsWith(prefix)).map((v) => ({ version: v, stable: !/beta|alpha/.test(v) })).reverse();
  }
  return [];
}

function runJava(java, args, cwd, log) {
  return new Promise((resolve, reject) => {
    log.info(`> java ${args.join(' ')}`);
    const child = spawn(java, args, { cwd, windowsHide: true });
    let n = 0;
    const onData = (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        // Installers print thousands of lines; keep the log readable.
        if (++n % 20 === 0 || /error|exception|fail|success|done/i.test(line)) log.info(line.trim());
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Installer exited with code ${code}`))));
  });
}

async function installVanilla(dir, mc, log) {
  const json = await mojangVersionJson(mc);
  if (!json.downloads || !json.downloads.server) throw new Error(`Minecraft ${mc} has no dedicated server download`);
  log.info(`Downloading Minecraft ${mc} server.jar...`);
  await downloadFile(json.downloads.server.url, path.join(dir, 'server.jar'));
}

async function installFabric(dir, mc, loaderVersion, log) {
  const installers = await cached('fabric-installers', 60 * 60e3, () => fetchJson('https://meta.fabricmc.net/v2/versions/installer'));
  const installer = (installers.find((i) => i.stable) || installers[0]).version;
  if (!loaderVersion) loaderVersion = (await listLoaderVersions('fabric', mc)).find((v) => v.stable)?.version;
  if (!loaderVersion) throw new Error(`No Fabric loader available for Minecraft ${mc}`);
  log.info(`Downloading Fabric server launcher (MC ${mc}, loader ${loaderVersion})...`);
  await downloadFile(
    `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loaderVersion}/${installer}/server/jar`,
    path.join(dir, 'fabric-server-launch.jar')
  );
  // Fetch the vanilla jar now so the first start doesn't need to.
  await installVanilla(dir, mc, log).catch((e) => log.warn(`Could not pre-download vanilla jar (Fabric will fetch it on first start): ${e.message}`));
  return loaderVersion;
}

async function installForgeLike(dir, java, url, log, label) {
  const installer = path.join(dir, `${label}-installer.jar`);
  log.info(`Downloading ${label} installer: ${url}`);
  await downloadFile(url, installer);
  log.info(`Running ${label} installer (this can take a few minutes)...`);
  await runJava(java, ['-jar', installer, '--installServer'], dir, log);
  for (const f of [installer, installer + '.log', path.join(dir, 'installer.log')]) fs.rmSync(f, { force: true });
}

async function installForge(dir, mc, version, java, log) {
  if (!version) {
    const list = await listLoaderVersions('forge', mc);
    version = (list.find((v) => v.recommended) || list[0] || {}).version;
  }
  if (!version) throw new Error(`No Forge build found for Minecraft ${mc}`);
  const base = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
  try {
    await installForgeLike(dir, java, `${base}/${mc}-${version}/forge-${mc}-${version}-installer.jar`, log, 'forge');
  } catch (err) {
    if (err.status !== 404) throw err;
    // Very old builds use a "-<mc>" suffix in the artifact name.
    const v = `${mc}-${version}-${mc}`;
    await installForgeLike(dir, java, `${base}/${v}/forge-${v}-installer.jar`, log, 'forge');
  }
  return version;
}

async function installNeoForge(dir, mc, version, java, log) {
  if (!version) version = (await listLoaderVersions('neoforge', mc)).find((v) => v.stable)?.version;
  if (!version) throw new Error(`No NeoForge build found for Minecraft ${mc}`);
  const url =
    mc === '1.20.1'
      ? `https://maven.neoforged.net/releases/net/neoforged/forge/1.20.1-${version}/forge-1.20.1-${version}-installer.jar`
      : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
  await installForgeLike(dir, java, url, log, 'neoforge');
  return version;
}

// Remove an old loader install so an upgrade doesn't leave two launch targets behind.
function cleanLoader(dir) {
  for (const p of ['libraries/net/minecraftforge/forge', 'libraries/net/neoforged', 'run.bat', 'run.sh', 'fabric-server-launch.jar', '.fabric']) {
    fs.rmSync(path.join(dir, p), { recursive: true, force: true });
  }
  for (const f of fs.readdirSync(dir)) {
    if (/^(forge|neoforge)-.*\.jar$/i.test(f) && !/installer/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  }
}

async function installLoader(dir, { mcVersion, loader, loaderVersion, java, log }) {
  fs.mkdirSync(dir, { recursive: true });
  if (loader === 'vanilla' || !loader) {
    await installVanilla(dir, mcVersion, log);
    return null;
  }
  if (loader === 'fabric') return installFabric(dir, mcVersion, loaderVersion, log);
  if (loader === 'forge') return installForge(dir, mcVersion, loaderVersion, java, log);
  if (loader === 'neoforge') return installNeoForge(dir, mcVersion, loaderVersion, java, log);
  throw new Error(`Mod loader "${loader}" is not supported yet`);
}

/**
 * Work out how to start the server in dir. Returns { kind: 'argsfile' | 'jar', file } (relative paths) or null.
 */
function detectLaunch(dir) {
  if (!fs.existsSync(dir)) return null;
  const argsName = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  const argFiles = findFiles(
    path.join(dir, 'libraries'),
    (rel, name) => name === argsName && /(^|\/)net\/(minecraftforge\/forge|neoforged\/(neoforge|forge))\//.test(rel),
    8
  );
  if (argFiles.length) {
    argFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return { kind: 'argsfile', file: relTo(dir, argFiles[0]) };
  }
  const jars = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar') && !/installer/i.test(f));
  const order = [
    /^fabric-server-launch(er)?\.jar$/i,
    /^fabric-server.*\.jar$/i,
    /^quilt-server-launch\.jar$/i,
    /^(neo)?forge-.*-shim\.jar$/i,
    /^(neo)?forge-.*universal.*\.jar$/i,
    /^(neo)?forge-.*\.jar$/i,
    /^server\.jar$/i,
    /^minecraft_server.*\.jar$/i,
  ];
  for (const re of order) {
    const hit = jars.find((j) => re.test(j));
    if (hit) return { kind: 'jar', file: hit };
  }
  return jars.length === 1 ? { kind: 'jar', file: jars[0] } : null;
}

module.exports = { listMcVersions, listLoaderVersions, installLoader, installVanilla, detectLaunch, cleanLoader, runJava };
