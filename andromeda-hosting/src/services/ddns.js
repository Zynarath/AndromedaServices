'use strict';
// Dynamic DNS for Cloudflare: keeps A records (e.g. play.example.com) pointed at this PC's
// public IP, so friends can always join by name even when your ISP changes your IP.
const db = require('../db');
const logger = require('../util/log');
const { fetchWithRetry } = require('../util/download');
const { HttpError } = require('../util/misc');

const log = logger('ddns');
const API = () => process.env.ANDROMEDA_CF_API || 'https://api.cloudflare.com/client/v4';
const IP_URLS = () =>
  process.env.ANDROMEDA_IP_URL ? [process.env.ANDROMEDA_IP_URL] : ['https://api.ipify.org', 'https://1.1.1.1/cdn-cgi/trace'];
const INTERVAL_MS = 5 * 60 * 1000;

const status = { lastIp: null, lastCheck: null, lastChange: null, error: null, records: [] };
let timer = null;
let running = null;

function settings() {
  const d = db.data.settings.ddns || {};
  return { enabled: !!d.enabled, token: d.token || '', hostnames: Array.isArray(d.hostnames) ? d.hostnames : [] };
}

async function publicIp() {
  for (const url of IP_URLS()) {
    try {
      const res = await fetchWithRetry(url, { timeout: 10000 }, 2);
      const text = await res.text();
      const m = /(?:^|ip=)(\d{1,3}(?:\.\d{1,3}){3})\s*$/m.exec(text.trim());
      if (res.ok && m) return m[1];
    } catch {}
  }
  throw new Error('Could not determine this PC’s public IP address');
}

async function cf(token, method, path, body) {
  const res = await fetchWithRetry(API() + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    timeout: 15000,
  });
  let json = {};
  try {
    json = await res.json();
  } catch {}
  if (!res.ok || json.success === false) {
    const msg = (json.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare: ${msg}`);
  }
  return json.result;
}

// "play.example.com" -> the zone "example.com" (handles multi-part subdomains too).
const zoneCache = new Map();
async function findZone(token, hostname) {
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (zoneCache.has(candidate)) return zoneCache.get(candidate);
    const zones = await cf(token, 'GET', `/zones?name=${encodeURIComponent(candidate)}`);
    if (zones && zones.length) {
      zoneCache.set(candidate, zones[0].id);
      return zones[0].id;
    }
  }
  throw new Error(`No Cloudflare zone found for ${hostname}. Is the domain added to this Cloudflare account, and can the token read it?`);
}

async function syncRecord(token, hostname, ip) {
  const zoneId = await findZone(token, hostname);
  const records = await cf(token, 'GET', `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(hostname)}`);
  const rec = records && records[0];
  if (!rec) {
    await cf(token, 'POST', `/zones/${zoneId}/dns_records`, {
      type: 'A',
      name: hostname,
      content: ip,
      ttl: 60,
      proxied: false,
      comment: 'Managed by Andromeda Hosting (game server address)',
    });
    return 'created';
  }
  // Game traffic can't pass through Cloudflare's proxy, so the record must be "DNS only".
  if (rec.content === ip && rec.proxied === false) return 'unchanged';
  await cf(token, 'PATCH', `/zones/${zoneId}/dns_records/${rec.id}`, { content: ip, proxied: false });
  return 'updated';
}

async function runOnce({ force = false } = {}) {
  const s = settings();
  if (!s.token || !s.hostnames.length) throw new HttpError(400, 'Add a Cloudflare API token and at least one hostname first');
  if (running) return running;
  running = (async () => {
    status.lastCheck = Date.now();
    try {
      const ip = await publicIp();
      const changed = ip !== status.lastIp;
      if (!changed && !force && status.records.length && !status.error) return status;
      const results = [];
      for (const host of s.hostnames) {
        try {
          results.push({ hostname: host, result: await syncRecord(s.token, host, ip) });
        } catch (err) {
          results.push({ hostname: host, result: 'error', error: err.message });
        }
      }
      if (changed && status.lastIp) log.info(`Public IP changed ${status.lastIp} -> ${ip}`);
      if (results.some((r) => r.result === 'created' || r.result === 'updated')) status.lastChange = Date.now();
      status.lastIp = ip;
      status.records = results;
      const errs = results.filter((r) => r.error);
      status.error = errs.length ? errs.map((r) => `${r.hostname}: ${r.error}`).join(' | ') : null;
      if (status.error) log.warn(status.error);
    } catch (err) {
      status.error = err.message;
      log.warn(err.message);
    }
    return status;
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

function start() {
  clearInterval(timer);
  timer = null;
  if (!settings().enabled) return;
  runOnce().catch(() => {});
  timer = setInterval(() => runOnce().catch(() => {}), INTERVAL_MS);
}

function cleanHostnames(input) {
  const list = (Array.isArray(input) ? input : String(input || '').split(/[\s,]+/))
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  for (const h of list) {
    if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) throw new HttpError(400, `"${h}" is not a valid hostname`);
  }
  return [...new Set(list)].slice(0, 10);
}

function publicStatus() {
  const s = settings();
  return { enabled: s.enabled, tokenSet: !!s.token, hostnames: s.hostnames, ...status };
}

function reset() {
  zoneCache.clear();
  status.records = [];
  status.error = null;
}

module.exports = { start, runOnce, publicIp, cleanHostnames, publicStatus, reset, syncRecord };
