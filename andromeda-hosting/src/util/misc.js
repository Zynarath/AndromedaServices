'use strict';
const crypto = require('crypto');
const net = require('net');
const dgram = require('dgram');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomId = (bytes = 4) => crypto.randomBytes(bytes).toString('hex');
const randomPassword = (len = 16) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// True when nothing on this machine is listening on the port (best effort).
function isTcpPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

function isUdpPortFree(port) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', () => resolve(false));
    sock.bind(port, '0.0.0.0', () => sock.close(() => resolve(true)));
  });
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

module.exports = { sleep, randomId, randomPassword, HttpError, isTcpPortFree, isUdpPortFree, formatBytes };
