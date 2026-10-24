'use strict';
require('./checkDeps'); // must stay first: installs packages added by updates
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const manager = require('./manager/manager');
const logger = require('./util/log');

const log = logger('panel');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy ? true : 'loopback');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https://media.forgecdn.net https://*.forgecdn.net https://mc-heads.net; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'"
  );
  next();
});

app.use('/api', express.json({ limit: '8mb' }));
app.use('/api', auth.csrfGuard);
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/files'));
app.use('/api', require('./routes/servers'));
app.use('/api', require('./routes/system'));
app.use('/api', require('./routes/share').adminRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use('/share', require('./routes/share').publicRouter);
// Never let browsers or Cloudflare keep old copies of the panel's files: after an update the
// page must load the new scripts, or new features (and fixes) silently don't show up.
const noStore = (res) => res.setHeader('Cache-Control', 'no-store, max-age=0');
app.use(express.static(path.join(config.root, 'public'), { index: 'index.html', etag: false, lastModified: false, setHeaders: noStore }));
app.get('/{*splat}', (_req, res) => {
  noStore(res);
  res.sendFile(path.join(config.root, 'public', 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) log.error(err);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: err.message || 'Internal error' });
});

const useHttps = config.https.certFile && config.https.keyFile;
const server = useHttps
  ? https.createServer({ cert: fs.readFileSync(config.https.certFile), key: fs.readFileSync(config.https.keyFile) }, app)
  : http.createServer(app);

// ---- live updates over WebSocket ----
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();
  // Only accept sockets opened by our own pages.
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return socket.destroy();
    } catch {
      return socket.destroy();
    }
  }
  const s = auth.sessionFromRequest(req);
  if (!s) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = s.user.id;
    ws.subscribed = null;
    wss.emit('connection', ws);
  });
});

function userOf(ws) {
  const u = db.data.users.find((x) => x.id === ws.userId);
  return u && !u.disabled ? u : null;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const user = userOf(ws);
    if (!user) return ws.close();
    if (msg.type === 'subscribe') {
      const inst = manager.instances.get(msg.serverId);
      if (!inst || !auth.can(user, inst.server, 'view')) return;
      ws.subscribed = msg.serverId;
      const canConsole = auth.can(user, inst.server, 'console');
      send(ws, {
        type: 'snapshot',
        serverId: msg.serverId,
        console: canConsole ? inst.console.slice(-500) : [],
        runtime: inst.toJSON(),
      });
    } else if (msg.type === 'unsubscribe') {
      ws.subscribed = null;
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

function broadcast(serverId, msg, perm = 'view', onlySubscribed = false) {
  const inst = manager.instances.get(serverId);
  for (const ws of wss.clients) {
    if (onlySubscribed && ws.subscribed !== serverId) continue;
    const user = userOf(ws);
    if (!user || (inst && !auth.can(user, inst.server, perm))) continue;
    send(ws, { ...msg, serverId });
  }
}

manager.on('status', (id, status) => broadcast(id, { type: 'status', status }));
manager.on('stats', (id, stats) => broadcast(id, { type: 'stats', stats }));
manager.on('players', (id, players) => broadcast(id, { type: 'players', players }));
manager.on('console', (id, entry) => broadcast(id, { type: 'console', entry }, 'console', true));
manager.on('job', (id, job) => broadcast(id, { type: 'job', job: { ...job, log: job.log.slice(-5) } }));
manager.on('removed', (id) => {
  for (const ws of wss.clients) send(ws, { type: 'removed', serverId: id });
});

// ---- start ----
manager.init();
require('./services/ddns').start();
require('./services/discord').init(manager);
require('./shareServer').apply();
server.listen(config.port, config.host, () => {
  const proto = useHttps ? 'https' : 'http';
  log.info(`Andromeda Hosting is running at ${proto}://localhost:${config.port}`);
  if (!db.data.users.length) log.info(`No accounts yet — open ${proto}://localhost:${config.port} on this PC to create the admin account.`);
});
server.on('error', (err) => {
  log.error(`Could not start the web server: ${err.message}`);
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} — stopping game servers safely before exit...`);
  const force = setTimeout(() => process.exit(exitCode || 1), 4 * 60 * 1000);
  try {
    await manager.shutdownAll();
  } finally {
    db.saveNow();
    clearTimeout(force);
    process.exit(exitCode);
  }
}
// After an update, exit with a code start.bat recognises so it starts the new version.
const updater = require('./services/updater');
updater.init(manager, (why) => shutdown(`Restarting for ${why}`, updater.RESTART_CODE));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => shutdown(sig));
process.on('uncaughtException', (err) => log.error(err));
process.on('unhandledRejection', (err) => log.error(err instanceof Error ? err : new Error(String(err))));
