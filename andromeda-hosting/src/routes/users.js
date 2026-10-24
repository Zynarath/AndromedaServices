'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { HttpError } = require('../util/misc');

const router = express.Router();
router.use('/users', auth.requireAuth, auth.requireAdmin);

router.get('/users', (_req, res) => {
  res.json({
    users: db.data.users.map((u) => ({
      ...auth.publicUser(u),
      servers: db.data.servers.filter((s) => s.access && s.access[u.id]).map((s) => ({ id: s.id, name: s.name, perms: s.access[u.id] })),
    })),
    perms: auth.PERMS.map((p) => ({ id: p, label: auth.PERM_LABELS[p] })),
  });
});

router.post('/users', (req, res) => {
  const user = auth.createUser({ username: req.body.username, password: req.body.password, role: req.body.role });
  res.json({ user: auth.publicUser(user) });
});

function target(req) {
  const u = db.data.users.find((x) => x.id === req.params.id);
  if (!u) throw new HttpError(404, 'User not found');
  return u;
}

const otherAdmins = (u) => db.data.users.some((x) => x.id !== u.id && x.role === 'admin' && !x.disabled);

router.patch('/users/:id', (req, res) => {
  const u = target(req);
  const { role, password, disabled, resetTotp } = req.body || {};
  if (role && role !== u.role) {
    if (u.role === 'admin' && !otherAdmins(u)) throw new HttpError(400, 'There must be at least one admin');
    u.role = role === 'admin' ? 'admin' : 'user';
  }
  if (password) {
    auth.validatePassword(password);
    u.passwordHash = auth.hashPassword(password);
    auth.destroySessions(u.id);
  }
  if (disabled !== undefined) {
    if (disabled && u.id === req.user.id) throw new HttpError(400, "You can't disable yourself");
    if (disabled && u.role === 'admin' && !otherAdmins(u)) throw new HttpError(400, 'There must be at least one admin');
    u.disabled = !!disabled;
    if (u.disabled) auth.destroySessions(u.id);
  }
  if (resetTotp) {
    u.totpEnabled = false;
    delete u.totpSecret;
  }
  db.save();
  res.json({ user: auth.publicUser(u) });
});

router.delete('/users/:id', (req, res) => {
  const u = target(req);
  if (u.id === req.user.id) throw new HttpError(400, "You can't delete yourself");
  if (u.role === 'admin' && !otherAdmins(u)) throw new HttpError(400, 'There must be at least one admin');
  db.data.users = db.data.users.filter((x) => x !== u);
  for (const s of db.data.servers) if (s.access) delete s.access[u.id];
  auth.destroySessions(u.id);
  res.json({ ok: true });
});

module.exports = router;
