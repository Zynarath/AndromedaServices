'use strict';
const crypto = require('crypto');
const db = require('./db');
const { HttpError, randomId } = require('./util/misc');

const COOKIE = 'hp_session';
const SESSION_IDLE_MS = 30 * 24 * 3600e3;
const PERMS = ['control', 'console', 'settings', 'files', 'mods', 'backups', 'schedules'];
const PERM_LABELS = {
  control: 'Start / stop / restart',
  console: 'View console & send commands',
  settings: 'Change settings',
  files: 'File manager (high trust — can change what the server runs)',
  mods: 'Install & update mods / modpacks',
  backups: 'Create & restore backups',
  schedules: 'Manage schedules',
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(expected, actual);
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (pw.length > 200) throw new HttpError(400, 'Password is too long');
}

function validateUsername(name) {
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(name || '')) throw new HttpError(400, 'Username must be 3–32 letters, numbers, dots, dashes or underscores');
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function findUserByName(name) {
  const lower = String(name || '').toLowerCase();
  return db.data.users.find((u) => u.username.toLowerCase() === lower);
}

function createUser({ username, password, role = 'user' }) {
  validateUsername(username);
  validatePassword(password);
  if (findUserByName(username)) throw new HttpError(400, 'That username is taken');
  const user = { id: randomId(6), username, role: role === 'admin' ? 'admin' : 'user', passwordHash: hashPassword(password), createdAt: Date.now(), totpEnabled: false };
  db.data.users.push(user);
  db.save();
  return user;
}

function createSession(user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.data.sessions.push({ id: sha(token), userId: user.id, createdAt: Date.now(), lastSeen: Date.now(), ip: req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 200) });
  user.lastLogin = Date.now();
  db.save();
  return token;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const id = sha(token);
  const session = db.data.sessions.find((s) => s.id === id);
  if (!session) return null;
  if (Date.now() - session.lastSeen > SESSION_IDLE_MS) {
    db.data.sessions = db.data.sessions.filter((s) => s !== session);
    db.save();
    return null;
  }
  const user = db.data.users.find((u) => u.id === session.userId);
  if (!user || user.disabled) return null;
  if (Date.now() - session.lastSeen > 60e3) {
    session.lastSeen = Date.now();
    db.save();
  }
  return { session, user };
}

function setSessionCookie(req, res, token) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_IDLE_MS / 1000}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function destroySessions(userId, exceptId) {
  db.data.sessions = db.data.sessions.filter((s) => s.userId !== userId || s.id === exceptId);
  db.save();
}

// ---- middleware ----
function requireAuth(req, _res, next) {
  const s = sessionFromRequest(req);
  if (!s) return next(new HttpError(401, 'Please sign in'));
  req.user = s.user;
  req.session = s.session;
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== 'admin') return next(new HttpError(403, 'Admins only'));
  next();
}

// Browsers can't add custom headers to cross-site requests without CORS (which we never allow),
// so requiring one on every state-changing request blocks CSRF.
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'AndromedaHosting') return next(new HttpError(403, 'Missing request header'));
  next();
}

function can(user, server, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = (server.access || {})[user.id];
  if (!perms) return false;
  return perm === 'view' || perms.includes(perm);
}

function permsFor(user, server) {
  if (user.role === 'admin') return [...PERMS, 'admin'];
  return (server.access || {})[user.id] || [];
}

// Simple in-memory brute-force protection for logins.
const attempts = new Map();
function checkRateLimit(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && now < a.resetAt && a.count >= 8) {
    throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil((a.resetAt - now) / 60000)} minute(s).`);
  }
}
function recordFailure(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now > a.resetAt) attempts.set(key, { count: 1, resetAt: now + 15 * 60e3 });
  else a.count++;
}
function clearFailures(key) {
  attempts.delete(key);
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, lastLogin: u.lastLogin || null, totpEnabled: !!u.totpEnabled, disabled: !!u.disabled };
}

module.exports = {
  PERMS,
  PERM_LABELS,
  hashPassword,
  verifyPassword,
  validatePassword,
  createUser,
  findUserByName,
  createSession,
  sessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  destroySessions,
  requireAuth,
  requireAdmin,
  csrfGuard,
  can,
  permsFor,
  checkRateLimit,
  recordFailure,
  clearFailures,
  publicUser,
  sha,
};
