'use strict';
// CurseForge Core API client. Needs a free API key from https://console.curseforge.com/
const db = require('../db');
const { fetchJson } = require('../util/download');
const { HttpError } = require('../util/misc');

const BASE = 'https://api.curseforge.com';
const GAME_MINECRAFT = 432;
const GAME_ARK_ASCENDED = 83374;
const CLASS_MODPACK = 4471;
const CLASS_MC_MOD = 6;
const LOADER_TYPES = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
const LOADER_IDS = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };

function key() {
  const k = (db.data.settings.curseforgeApiKey || process.env.CURSEFORGE_API_KEY || '').trim();
  if (!k) throw new HttpError(400, 'No CurseForge API key set. An admin can add one under Panel Settings (free at console.curseforge.com).');
  return k;
}

async function call(pathname, { method = 'GET', body, query } = {}) {
  const url = new URL(BASE + pathname);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  try {
    return await fetchJson(url.toString(), {
      method,
      headers: { 'x-api-key': key(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.status === 403) throw new HttpError(400, 'CurseForge rejected the API key (403). Check it under Panel Settings.');
    throw err;
  }
}

function slimMod(m) {
  return {
    id: m.id,
    name: m.name,
    slug: m.slug,
    summary: m.summary,
    downloads: m.downloadCount,
    logo: m.logo ? m.logo.thumbnailUrl || m.logo.url : null,
    url: m.links ? m.links.websiteUrl : null,
    authors: (m.authors || []).map((a) => a.name),
    updated: m.dateModified,
    gameVersions: [...new Set((m.latestFilesIndexes || []).map((f) => f.gameVersion))].slice(0, 8),
    loaders: [...new Set((m.latestFilesIndexes || []).map((f) => LOADER_TYPES[f.modLoader]).filter(Boolean))],
  };
}

function slimFile(f) {
  return {
    id: f.id,
    modId: f.modId,
    name: f.displayName,
    fileName: f.fileName,
    releaseType: ({ 1: 'release', 2: 'beta', 3: 'alpha' })[f.releaseType] || 'release',
    date: f.fileDate,
    size: f.fileLength,
    gameVersions: f.gameVersions || [],
    serverPackFileId: f.serverPackFileId || null,
    isServerPack: !!f.isServerPack,
    downloadUrl: f.downloadUrl || null,
  };
}

async function search({ gameId = GAME_MINECRAFT, classId, query, gameVersion, loader, index = 0, pageSize = 20, sort = 2 }) {
  const res = await call('/v1/mods/search', {
    query: {
      gameId,
      classId,
      searchFilter: query,
      gameVersion,
      modLoaderType: loader ? LOADER_IDS[loader] : undefined,
      sortField: sort,
      sortOrder: 'desc',
      index,
      pageSize,
    },
  });
  return { results: res.data.map(slimMod), total: res.pagination ? res.pagination.totalCount : res.data.length };
}

async function getMod(id) {
  return (await call(`/v1/mods/${id}`)).data;
}

async function getMods(ids) {
  if (!ids.length) return [];
  return (await call('/v1/mods', { method: 'POST', body: { modIds: ids.map(Number) } })).data;
}

async function getFiles(modId, { gameVersion, loader, pageSize = 50, index = 0 } = {}) {
  const res = await call(`/v1/mods/${modId}/files`, {
    query: { gameVersion, modLoaderType: loader ? LOADER_IDS[loader] : undefined, pageSize, index },
  });
  return res.data;
}

async function getFile(modId, fileId) {
  return (await call(`/v1/mods/${modId}/files/${fileId}`)).data;
}

async function getFilesByIds(fileIds) {
  const out = [];
  for (let i = 0; i < fileIds.length; i += 500) {
    const res = await call('/v1/mods/files', { method: 'POST', body: { fileIds: fileIds.slice(i, i + 500) } });
    out.push(...res.data);
  }
  return out;
}

async function downloadUrl(modId, fileId) {
  try {
    return (await call(`/v1/mods/${modId}/files/${fileId}/download-url`)).data || null;
  } catch {
    return null;
  }
}

module.exports = {
  search,
  getMod,
  getMods,
  getFiles,
  getFile,
  getFilesByIds,
  downloadUrl,
  slimMod,
  slimFile,
  GAME_MINECRAFT,
  GAME_ARK_ASCENDED,
  CLASS_MODPACK,
  CLASS_MC_MOD,
  hasKey: () => !!(db.data.settings.curseforgeApiKey || process.env.CURSEFORGE_API_KEY),
};
