'use strict';
// Who is really on the other end of a request: this PC, the home network, or someone on the
// internet (possibly relayed by a Cloudflare Tunnel running on this PC).
const net = require('net');

const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'cf-ray', 'true-client-ip'];

const normalize = (ip) => String(ip || '').replace(/^::ffff:/i, '').trim();
const peer = (req) => normalize(req.socket.remoteAddress);
const isLoopbackAddr = (ip) => ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');
const proxied = (req) => PROXY_HEADERS.some((h) => req.headers[h] !== undefined);

function isPrivateAddr(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return /^f[cd]/i.test(ip) || /^fe80:/i.test(ip);
}

// A browser on this PC (a tunnel on this PC also connects from localhost, but adds forwarding headers).
function isThisPc(req) {
  return isLoopbackAddr(peer(req)) && !proxied(req);
}

// This PC, or a device connecting directly from the home network / Tailscale range.
function isLocalNetwork(req) {
  const ip = peer(req);
  return !proxied(req) && (isLoopbackAddr(ip) || isPrivateAddr(ip));
}

// The visitor's real IP. Forwarding headers are only believed when the connection itself comes
// from this PC (i.e. from cloudflared or another local proxy), so nobody can spoof them.
function clientIp(req) {
  const ip = peer(req);
  if (isLoopbackAddr(ip) && proxied(req)) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return normalize(String(cf).split(',')[0]);
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return normalize(xff[xff.length - 1]);
    if (req.headers['x-real-ip']) return normalize(req.headers['x-real-ip']);
  }
  return ip;
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

// Matches an IP against "1.2.3.4", "1.2.3.0/24" or an exact IPv6 address.
function ipMatches(ip, rule) {
  ip = normalize(ip);
  rule = String(rule || '').trim();
  if (!rule) return false;
  if (rule.includes('/') && net.isIPv4(ip)) {
    const [base, bitsStr] = rule.split('/');
    const bits = Number(bitsStr);
    if (!net.isIPv4(base) || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
  }
  return ip.toLowerCase() === normalize(rule).toLowerCase();
}

function validRule(rule) {
  const r = String(rule || '').trim();
  if (net.isIP(r)) return true;
  const [base, bits] = r.split('/');
  return net.isIPv4(base) && /^\d{1,2}$/.test(bits || '') && Number(bits) <= 32;
}

module.exports = { isThisPc, isLocalNetwork, clientIp, ipMatches, validRule, isPrivateAddr, normalize, PROXY_HEADERS };
