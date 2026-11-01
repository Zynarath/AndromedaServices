'use strict';
// Downloads and manages Eclipse Temurin (Adoptium) Java runtimes per major version,
// so each Minecraft version gets the Java it needs without touching your system Java.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const { downloadFile, fetchJson } = require('../util/download');
const { extractZip } = require('../util/zip');
const { findFiles } = require('../util/paths');

const exeName = process.platform === 'win32' ? 'java.exe' : 'java';
const locks = new Map();

function runtimeDir(major) {
  return path.join(config.runtimesDir, `java-${major}`);
}

function findJava(major) {
  const dir = runtimeDir(major);
  if (!fs.existsSync(dir)) return null;
  const hits = findFiles(dir, (rel, name) => name === exeName && /(^|\/)bin\/[^/]+$/.test(rel), 4);
  return hits[0] || null;
}

function listInstalled() {
  if (!fs.existsSync(config.runtimesDir)) return [];
  return fs
    .readdirSync(config.runtimesDir)
    .map((d) => /^java-(\d+)$/.exec(d))
    .filter(Boolean)
    .map((m) => ({ major: Number(m[1]), path: findJava(Number(m[1])) }))
    .filter((r) => r.path);
}

async function ensureJava(major, log = console) {
  const existing = findJava(major);
  if (existing) return existing;
  if (locks.has(major)) return locks.get(major);
  const p = (async () => {
    const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
    const ext = os === 'windows' ? 'zip' : 'tar.gz';
    const archive = path.join(config.cacheDir, `temurin-${major}-jre.${ext}`);
    log.info(`Downloading Java ${major} runtime (Eclipse Temurin)...`);
    try {
      await downloadFile(url, archive, {
        onProgress: (r, t) => log.progress && log.progress(t ? (r / t) * 100 : null, `Java ${major}: ${(r / 1048576).toFixed(0)} MB`),
      });
    } catch (err) {
      // Some older versions only ship a JDK build.
      if (err.status === 404) await downloadFile(url.replace('/jre/', '/jdk/'), archive);
      else throw err;
    }
    const dir = runtimeDir(major);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    log.info(`Extracting Java ${major}...`);
    if (ext === 'zip') await extractZip(archive, dir);
    else await new Promise((res, rej) => execFile('tar', ['-xzf', archive, '-C', dir], (e) => (e ? rej(e) : res())));
    fs.rmSync(archive, { force: true });
    const java = findJava(major);
    if (!java) throw new Error(`Java ${major} was downloaded but no ${exeName} was found inside it`);
    log.info(`Java ${major} ready: ${java}`);
    return java;
  })();
  locks.set(major, p);
  try {
    return await p;
  } finally {
    locks.delete(major);
  }
}

// Mojang publishes the required Java version per release; fall back to a known mapping.
const versionJsonCache = new Map();
async function mojangVersionJson(mcVersion) {
  if (versionJsonCache.has(mcVersion)) return versionJsonCache.get(mcVersion);
  const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const entry = manifest.versions.find((v) => v.id === mcVersion);
  if (!entry) throw new Error(`Unknown Minecraft version ${mcVersion}`);
  const json = await fetchJson(entry.url);
  versionJsonCache.set(mcVersion, json);
  return json;
}

function fallbackJavaMajor(mcVersion) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(mcVersion || '');
  if (!m) return 21;
  const [maj, min, patch] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  if (maj >= 26) return 25; // year-based versions (26.1+)
  if (min <= 16) return 8;
  if (min === 17) return 17;
  if (min < 20 || (min === 20 && patch <= 4)) return 17;
  return 21;
}

async function javaMajorFor(mcVersion) {
  try {
    const json = await mojangVersionJson(mcVersion);
    if (json.javaVersion && json.javaVersion.majorVersion) {
      const major = json.javaVersion.majorVersion;
      return major === 16 ? 17 : major; // Temurin has no 16 JRE builds; 17 runs 1.17 fine
    }
  } catch {}
  return fallbackJavaMajor(mcVersion);
}

module.exports = { ensureJava, javaMajorFor, mojangVersionJson, listInstalled, fallbackJavaMajor };
