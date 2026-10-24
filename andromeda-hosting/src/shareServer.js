'use strict';
// Optional dedicated port that serves ONLY the file share (never the control panel), so you can
// port-forward it or point files.<yourdomain> at it without exposing the panel.
const http = require('http');
const path = require('path');
const express = require('express');
const config = require('./config');
const share = require('./services/fileshare');
const { publicRouter } = require('./routes/share');
const logger = require('./util/log');

const log = logger('share');
let server = null;

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
    next();
  });
  const pub = path.join(config.root, 'public');
  app.get('/', (_req, res) => res.redirect('/share'));
  app.get('/css/app.css', (_req, res) => res.sendFile(path.join(pub, 'css', 'app.css')));
  app.get('/img/icon.svg', (_req, res) => res.sendFile(path.join(pub, 'img', 'icon.svg')));
  for (const f of ['share.js', 'ui.js']) app.get('/js/' + f, (_req, res) => res.sendFile(path.join(pub, 'js', f)));
  app.use('/share', publicRouter);
  app.use((_req, res) => res.status(404).send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return res.end();
    res.status(err.status || 500).json({ error: err.message || 'Error' });
  });
  return app;
}

function stop() {
  if (!server) return Promise.resolve();
  const s = server;
  server = null;
  return new Promise((r) => s.close(() => r()));
}

async function apply() {
  const s = share.settings();
  await stop();
  if (!s.enabled || !s.port) return;
  if (s.port === config.port) return log.warn('File share port is the same as the panel port; using the panel only.');
  server = http.createServer(buildApp());
  server.on('error', (err) => {
    log.error(`File share port ${s.port} could not start: ${err.message}`);
    server = null;
  });
  server.listen(s.port, config.host, () => log.info(`File share also available on port ${s.port} (share only, no panel)`));
}

share.events.on('changed', (next, prev) => {
  if (next.enabled !== prev.enabled || next.port !== prev.port) apply();
});

module.exports = { apply, stop, buildApp };
