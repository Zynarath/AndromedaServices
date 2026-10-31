'use strict';
// Website accounts are the game accounts themselves (the realm's `account` table).
// Fixed from SPP's PHP site: sessions are random server-side tokens (not a serialized cookie the
// server unserializes), cookies are HttpOnly + SameSite, every form carries a CSRF token, logins
// are rate-limited, random-bot accounts can't sign in, and new accounts only come in the way the
// panel allows (off / single-use invite codes / open).
const crypto = require('crypto');
const data = require('./data');
const srp6 = require('./srp6');
const { NAME_RE, PASS_RE } = require('../games/wow');

const COOKIE = 'wotlk_sid';
const IDLE_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 5000;
const sessions = new Map(); // token -> { csrf, account, seen }

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function newSession() {
  if (sessions.size >= MAX_SESSIONS) {
    // Drop the longest-idle visitors first.
    const oldest = [...sessions].sort((a, b) => a[1].seen - b[1].seen).slice(0, Math.ceil(MAX_SESSIONS / 10));
    for (const [k] of oldest) sessions.delete(k);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const s = { csrf: crypto.randomBytes(24).toString('base64url'), account: null, seen: Date.now() };
  sessions.set(token, s);
  return [token, s];
}

function setCookie(req, res, token) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

// Every visitor gets a session, so even the login form has a CSRF token.
function middleware(req, res, next) {
  const token = parseCookies(req)[COOKIE];
  let s = token && sessions.get(token);
  if (s && Date.now() - s.seen > IDLE_MS) {
    sessions.delete(token);
    s = null;
  }
  if (!s) {
    const [t, ns] = newSession();
    setCookie(req, res, t);
    s = ns;
    req.sessionToken = t;
  } else req.sessionToken = token;
  s.seen = Date.now();
  req.session = s;
  req.account = s.account;
  next();
}

function csrfOk(req) {
  const sent = String((req.body && req.body._csrf) || '');
  const want = req.session && req.session.csrf;
  return !!want && sent.length === want.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(want));
}

// Start a fresh session on login/logout so a token seen before can't be reused.
function rotate(req, res, account) {
  sessions.delete(req.sessionToken);
  const [t, s] = newSession();
  s.account = account;
  setCookie(req, res, t);
  req.session = s;
  req.sessionToken = t;
  req.account = account;
}

function endSessionsFor(accountId) {
  for (const [k, s] of sessions) if (s.account && s.account.id === accountId) sessions.delete(k);
}

// ---- brute-force protection: 8 failures per IP or per account name in 15 minutes ----
const failures = new Map();
const WINDOW = 15 * 60 * 1000;
function tooMany(...keys) {
  const now = Date.now();
  return keys.some((k) => (failures.get(k) || []).filter((t) => now - t < WINDOW).length >= 8);
}
function fail(...keys) {
  const now = Date.now();
  for (const k of keys) failures.set(k, [...(failures.get(k) || []).filter((t) => now - t < WINDOW), now]);
  if (failures.size > 20000) failures.clear();
}

async function banned(accountId) {
  try {
    return (await data.q('login', 'SELECT 1 FROM account_banned WHERE id = ? AND active = 1 LIMIT 1', [accountId])).length > 0;
  } catch {
    return false;
  }
}

async function login(ip, username, password) {
  const name = String(username || '').trim().toUpperCase();
  const pass = String(password || '');
  if (tooMany(`ip:${ip}`, `user:${name}`)) return { error: 'Too many failed logins. Wait 15 minutes and try again.' };
  const bad = () => {
    fail(`ip:${ip}`, `user:${name}`);
    return { error: 'Wrong account name or password.' };
  };
  if (!NAME_RE.test(name) || !pass || pass.length > 16) return bad();
  if (name.startsWith(data.botPrefix())) return bad();
  const rows = await data.q('login', 'SELECT id, username, s, v, gmlevel, locked FROM account WHERE username = ?', [name]);
  const a = rows[0];
  if (!a || !srp6.check(name, pass, a.s, a.v)) return bad();
  if (await banned(a.id)) return { error: 'This account is banned.' };
  return { account: { id: a.id, username: a.username, gmlevel: Number(a.gmlevel) || 0 } };
}

async function insertAccount(name, pass) {
  const cols = await data.columns('login', 'account');
  const { s, v } = srp6.makeVerifier(name, pass);
  const row = { username: name, s, v };
  if (cols.has('expansion')) row.expansion = 2; // WotLK: Northrend and Death Knights
  if (cols.has('sha_pass_hash')) row.sha_pass_hash = srp6.shaPassHash(name, pass);
  if (cols.has('joindate')) row.joindate = new Date();
  const res = await data.q('login', 'INSERT INTO account SET ?', [row]);
  return res.insertId;
}

const INVITES = 'andromeda_site_invites';
async function ensureInviteTable() {
  await data.q('login', `CREATE TABLE IF NOT EXISTS ${INVITES} (
    code VARCHAR(16) NOT NULL PRIMARY KEY,
    note VARCHAR(64) NOT NULL DEFAULT '',
    created_by INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    used_by INT NULL,
    used_at DATETIME NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8`);
}

function inviteCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(10);
  const s = [...b].map((x) => abc[x % abc.length]).join('');
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

async function register(ip, { username, password, password2, invite }, mode) {
  const name = String(username || '').trim().toUpperCase();
  const pass = String(password || '');
  if (mode !== 'open' && mode !== 'invite') return { error: "Sign-up is turned off. Ask the server's owner for an account." };
  if (tooMany(`reg:${ip}`)) return { error: 'Too many attempts. Wait 15 minutes and try again.' };
  if (!NAME_RE.test(name)) return { error: 'Account names are 3–16 letters and numbers.' };
  if (name.startsWith(data.botPrefix())) return { error: 'That account name is reserved.' };
  if (!PASS_RE.test(pass)) return { error: 'Passwords are 4–16 characters with no spaces or quotes (a WoW client limit).' };
  if (pass !== String(password2 || '')) return { error: "The passwords don't match." };
  if ((await data.q('login', 'SELECT id FROM account WHERE username = ?', [name])).length) return { error: 'That account name is taken.' };
  let code = null;
  if (mode === 'invite') {
    code = String(invite || '').trim().toUpperCase();
    await ensureInviteTable();
    // Claim the code first so two sign-ups can't share it.
    const claim = await data.q('login', `UPDATE ${INVITES} SET used_by = 0, used_at = NOW() WHERE code = ? AND used_by IS NULL`, [code]);
    if (!claim.affectedRows) {
      fail(`reg:${ip}`);
      return { error: 'That invite code is wrong or already used.' };
    }
  }
  let id;
  try {
    id = await insertAccount(name, pass);
  } catch (err) {
    if (code) await data.q('login', `UPDATE ${INVITES} SET used_by = NULL, used_at = NULL WHERE code = ?`, [code]).catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') return { error: 'That account name is taken.' };
    throw err;
  }
  if (code) await data.q('login', `UPDATE ${INVITES} SET used_by = ? WHERE code = ?`, [id, code]);
  fail(`reg:${ip}`); // also caps how many accounts one address can make in 15 minutes
  return { account: { id, username: name, gmlevel: 0 } };
}

async function changePassword(account, current, next, next2) {
  const rows = await data.q('login', 'SELECT s, v FROM account WHERE id = ?', [account.id]);
  if (!rows[0] || !srp6.check(account.username, String(current || ''), rows[0].s, rows[0].v)) return { error: 'Your current password is wrong.' };
  if (!PASS_RE.test(String(next || ''))) return { error: 'Passwords are 4–16 characters with no spaces or quotes (a WoW client limit).' };
  if (next !== next2) return { error: "The new passwords don't match." };
  const cols = await data.columns('login', 'account');
  const { s, v } = srp6.makeVerifier(account.username, next);
  const row = { s, v };
  if (cols.has('sha_pass_hash')) row.sha_pass_hash = srp6.shaPassHash(account.username, next);
  if (cols.has('sessionkey')) row.sessionkey = '';
  await data.q('login', 'UPDATE account SET ? WHERE id = ?', [row, account.id]);
  endSessionsFor(account.id);
  return { ok: true };
}

module.exports = { middleware, csrfOk, rotate, login, register, changePassword, ensureInviteTable, inviteCode, INVITES, sessions, endSessionsFor };
