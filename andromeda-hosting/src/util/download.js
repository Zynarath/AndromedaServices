'use strict';
const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { sleep } = require('./misc');

const UA = 'Andromeda Hosting/1.0 (self-hosted game server panel)';

async function fetchWithRetry(url, opts = {}, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        ...opts,
        headers: { 'User-Agent': UA, ...(opts.headers || {}) },
        signal: opts.signal || AbortSignal.timeout(opts.timeout || 30000),
      });
      if (res.status >= 500 && i < attempts - 1) {
        lastErr = new Error(`HTTP ${res.status} from ${url}`);
        await sleep(1000 * (i + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(1000 * (i + 1));
    }
  }
  throw new Error(`Request to ${url} failed: ${lastErr && lastErr.message}`);
}

async function fetchJson(url, opts = {}) {
  const res = await fetchWithRetry(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} from ${url}${body ? ': ' + body.slice(0, 200) : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchText(url, opts = {}) {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

// Stream a URL to disk. onProgress(receivedBytes, totalBytes|null).
async function downloadFile(url, dest, { onProgress, headers, timeout = 30 * 60 * 1000 } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetchWithRetry(url, { headers, timeout });
  if (!res.ok) {
    const err = new Error(`Download failed (HTTP ${res.status}) for ${url}`);
    err.status = res.status;
    throw err;
  }
  const total = Number(res.headers.get('content-length')) || null;
  let received = 0;
  let lastReport = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      const now = Date.now();
      if (onProgress && now - lastReport > 500) {
        lastReport = now;
        onProgress(received, total);
      }
      cb(null, chunk);
    },
  });
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  if (onProgress) onProgress(received, total);
  return dest;
}

module.exports = { fetchWithRetry, fetchJson, fetchText, downloadFile, UA };
