'use strict';
// Account passwords as cMaNGOS stores them: an SRP6 salt (s) and verifier (v), both upper-case hex.
// Same algorithm as SPP's website (calculateSRP6Verifier in its core/common.php), so accounts made
// in the game, by the panel or by either website all log in everywhere.
const crypto = require('crypto');

const N = BigInt('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7');
const g = 7n;

const sha1 = (...parts) => crypto.createHash('sha1').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest();

function modPow(base, exp, mod) {
  let r = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return r;
}

// salt: the raw salt bytes (hex-decoded "s"). Returns the 32-byte verifier, big-endian.
function verifier(username, password, salt) {
  const h1 = sha1(`${username}:${password}`.toUpperCase());
  const h2 = sha1(Buffer.from(salt).reverse(), h1);
  const x = BigInt('0x' + Buffer.from(h2).reverse().toString('hex')); // little-endian integer
  return Buffer.from(modPow(g, x, N).toString(16).padStart(64, '0'), 'hex');
}

function makeVerifier(username, password) {
  const salt = crypto.randomBytes(32);
  return { s: salt.toString('hex').toUpperCase(), v: verifier(username, password, salt).toString('hex').toUpperCase() };
}

function check(username, password, s, v) {
  if (!/^[0-9a-f]{1,64}$/i.test(String(s || '')) || !/^[0-9a-f]{1,64}$/i.test(String(v || ''))) return false;
  const want = Buffer.from(String(v).padStart(64, '0'), 'hex');
  const got = verifier(username, password, Buffer.from(String(s).padStart(64, '0'), 'hex'));
  return crypto.timingSafeEqual(want, got);
}

// Older cores (and some forks) still read this column.
const shaPassHash = (username, password) => sha1(`${username}:${password}`.toUpperCase()).toString('hex').toUpperCase();

module.exports = { makeVerifier, check, verifier, shaPassHash };
