'use strict';
// Satisfactory's dedicated server HTTPS API (POST https://host:<game port>/api/v1).
// Request:  { "function": "QueryServerState", "data": { ... } }, Authorization: Bearer <token>
// Reply:    200 { data: { ... } }, 204 for functions with nothing to return, or
//           4xx/5xx { errorCode, errorMessage }.
// The server makes its own self-signed certificate, so certificate checks are off; the panel only
// ever talks to it on 127.0.0.1.
const https = require('https');

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

function call(port, fn, data = {}, { token, timeout = 10000, host = '127.0.0.1' } = {}) {
  const body = JSON.stringify({ function: fn, data });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    const req = https.request({ host, port, path: '/api/v1', method: 'POST', headers, rejectUnauthorized: false, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {}
        if (res.statusCode >= 400 || (json && json.errorCode)) {
          return reject(new ApiError(res.statusCode, json && json.errorCode, (json && json.errorMessage) || (json && json.errorCode) || `${fn}: HTTP ${res.statusCode}`));
        }
        resolve(json && json.data !== undefined ? json.data : json || {});
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${fn}: no answer from the Satisfactory server`)));
    req.on('error', reject);
    req.end(body);
  });
}

module.exports = { call, ApiError };
