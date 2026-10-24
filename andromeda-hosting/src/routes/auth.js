'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const totp = require('../util/totp');
const { HttpError } = require('../util/misc');
const { isThisPc } = require('../util/netaccess');

const router = express.Router();

// The first admin can only be created from a browser on the host PC itself (see netaccess).
const isLoopback = (req) => isThisPc(req);

router.get('/auth/state', (req, res) => {
  const s = auth.sessionFromRequest(req);
  res.json({
    panelName: db.data.settings.panelName,
    version: require('../../package.json').version,
    setupRequired: db.data.users.length === 0,
    setupAllowedHere: isLoopback(req),
    user: s ? auth.publicUser(s.user) : null,
  });
});

// First admin account. Only allowed from the host PC itself so nobody on the internet can claim the panel.
router.post('/auth/setup', (req, res) => {
  if (db.data.users.length) throw new HttpError(400, 'Setup is already complete');
  if (!isLoopback(req)) throw new HttpError(403, 'Create the first admin from the host PC (http://localhost:PORT) or with "npm run create-admin".');
  const user = auth.createUser({ username: req.body.username, password: req.body.password, role: 'admin' });
  auth.setSessionCookie(req, res, auth.createSession(user, req));
  res.json({ user: auth.publicUser(user) });
});

router.post('/auth/login', (req, res) => {
  const { username, password, code } = req.body || {};
  const key = `${req.ip}|${String(username || '').toLowerCase()}`;
  auth.checkRateLimit(key);
  auth.checkRateLimit(req.ip);
  const user = auth.findUserByName(username);
  if (!user || user.disabled || !auth.verifyPassword(password || '', user.passwordHash)) {
    auth.recordFailure(key);
    auth.recordFailure(req.ip);
    throw new HttpError(401, 'Wrong username or password');
  }
  if (user.totpEnabled) {
    if (!code) return res.json({ totpRequired: true });
    if (!totp.verify(user.totpSecret, code)) {
      auth.recordFailure(key);
      throw new HttpError(401, 'Wrong 2FA code');
    }
  }
  auth.clearFailures(key);
  auth.setSessionCookie(req, res, auth.createSession(user, req));
  res.json({ user: auth.publicUser(user) });
});

router.post('/auth/logout', (req, res) => {
  const s = auth.sessionFromRequest(req);
  if (s) {
    db.data.sessions = db.data.sessions.filter((x) => x !== s.session);
    db.save();
  }
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// ---- own account ----
router.get('/account', auth.requireAuth, (req, res) => {
  const sessions = db.data.sessions
    .filter((s) => s.userId === req.user.id)
    .map((s) => ({ id: s.id.slice(0, 16), ip: s.ip, ua: s.ua, createdAt: s.createdAt, lastSeen: s.lastSeen, current: s === req.session }));
  res.json({ user: auth.publicUser(req.user), sessions });
});

router.post('/account/password', auth.requireAuth, (req, res) => {
  const { current, password } = req.body || {};
  if (!auth.verifyPassword(current || '', req.user.passwordHash)) throw new HttpError(400, 'Current password is wrong');
  auth.validatePassword(password);
  req.user.passwordHash = auth.hashPassword(password);
  auth.destroySessions(req.user.id, req.session.id);
  res.json({ ok: true });
});

router.delete('/account/sessions/:id', auth.requireAuth, (req, res) => {
  db.data.sessions = db.data.sessions.filter((s) => !(s.userId === req.user.id && s.id.startsWith(req.params.id) && s !== req.session));
  db.save();
  res.json({ ok: true });
});

router.post('/account/2fa/setup', auth.requireAuth, (req, res) => {
  const secret = totp.generateSecret();
  req.user.pendingTotp = secret;
  db.save();
  res.json({ secret, url: totp.otpauthUrl(secret, req.user.username, db.data.settings.panelName || 'Andromeda Hosting') });
});

router.post('/account/2fa/enable', auth.requireAuth, (req, res) => {
  if (!req.user.pendingTotp) throw new HttpError(400, 'Start 2FA setup first');
  if (!totp.verify(req.user.pendingTotp, req.body.code)) throw new HttpError(400, 'That code is not valid — check your phone clock and try again');
  req.user.totpSecret = req.user.pendingTotp;
  req.user.totpEnabled = true;
  delete req.user.pendingTotp;
  db.save();
  res.json({ ok: true });
});

router.post('/account/2fa/disable', auth.requireAuth, (req, res) => {
  if (!auth.verifyPassword(req.body.password || '', req.user.passwordHash)) throw new HttpError(400, 'Password is wrong');
  req.user.totpEnabled = false;
  delete req.user.totpSecret;
  db.save();
  res.json({ ok: true });
});

module.exports = router;
