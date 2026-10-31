'use strict';
// The WotLK website's web server: SPP's original graphics served read-only from the SPP install,
// and the pages, rebuilt in Node. Nothing from the old PHP site is ever executed.
const path = require('path');
const express = require('express');
const layout = require('./layout');
const assets = require('./assets');
const { html } = require('./html');
const auth = require('./auth');
const data = require('./data');
const logger = require('../util/log');
const home = require('./pages/home');
const server = require('./pages/server');
const armory = require('./pages/armory');
const account = require('./pages/account');
const admin = require('./pages/admin');

const log = logger('wowsite');
// Only pictures and stylesheets from SPP's website folder are served (no PHP, no scripts, no SVG).
const ASSET_EXT = /\.(css|png|jpe?g|gif|ico|bmp|webp)$/i;

// SPP's website folder (found in the SPP install, or downloaded; see assets.js).
function websiteDir(cfg) {
  return assets.dir(cfg, data.paths().root || cfg.root) || assets.DOWNLOADED;
}
const assetsMissing = (cfg) => !assets.dir(cfg, data.paths().root || cfg.root);

function buildApp(getConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', getConfig().trustProxy ? true : 'loopback');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
    next();
  });

  // ---- static files ----
  const statics = new Map();
  const assets = (sub) => (req, res, next) => {
    if (!ASSET_EXT.test(req.path)) return res.status(404).end();
    const dir = path.join(websiteDir(getConfig()), sub);
    if (!statics.has(dir)) statics.set(dir, express.static(dir, { dotfiles: 'deny', index: false, fallthrough: false, maxAge: '7d', redirect: false }));
    statics.get(dir)(req, res, (err) => {
      if (err) res.status(err.status || 404).end();
      else next();
    });
  };
  app.use('/templates', assets('templates'));
  app.use('/images', assets('images'));
  app.use('/armory/images', assets(path.join('armory', 'images')));
  app.use('/site', express.static(path.join(__dirname, 'public'), { index: false, maxAge: 0 }));
  app.get('/favicon.ico', (_req, res) => res.redirect(301, '/templates/WotLK/images/favicon.ico'));

  app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 50 }));
  app.use(auth.middleware);

  // Keep a logged-in account's GM level and ban status current.
  app.use(async (req, res, next) => {
    const a = req.account;
    if (!a || Date.now() - (a.checked || 0) < 60000) return next();
    try {
      const row = (await data.q('login', 'SELECT gmlevel FROM account WHERE id = ?', [a.id]))[0];
      const banned = row ? (await data.q('login', 'SELECT 1 FROM account_banned WHERE id = ? AND active = 1 LIMIT 1', [a.id]).catch(() => [])).length > 0 : true;
      if (!row || banned) auth.rotate(req, res, null);
      else Object.assign(a, { gmlevel: Number(row.gmlevel) || 0, checked: Date.now() });
    } catch {}
    next();
  });

  const context = (req) => {
    const cfg = getConfig();
    return {
      req,
      site: { title: cfg.realmName || 'World of Warcraft', realmName: cfg.realmName || 'World of Warcraft', registration: cfg.registration || 'off', discord: cfg.discord || '' },
      account: req.account,
      csrf: req.session.csrf,
      assetsMissing: assetsMissing(cfg),
    };
  };

  const render = (res, ctx, out) => {
    if (ctx.assetsMissing && ctx.account && ctx.account.gmlevel >= 3) {
      const st = assets.status();
      out = { ...out, messages: [...(out.messages || []), { type: st.error ? 'error' : 'info', text: st.downloading ? "The original WotLK graphics are downloading (about 200 MB, once). Reload in a few minutes." : `The original WotLK graphics weren't found${st.error ? ` and the download failed: ${st.error}` : ''}. See data/logs/wowsite.log.` }] };
    }
    res.status(out.status || 200).type('html').setHeader('Cache-Control', 'no-store');
    res.send(String(layout.page({ ...ctx, ...out }, out.body)));
  };

  const route = (fn, { post = false } = {}) => async (req, res, next) => {
    try {
      const ctx = context(req);
      if (post && !auth.csrfOk(req)) {
        return render(res, ctx, { status: 403, title: 'Expired', body: layout.box('Please try again', html`This form expired (or came from another site). <a href="${req.originalUrl.replace(/\/(delete|logout)$/, '')}">Go back</a> and send it again.`) });
      }
      const out = await fn(req, ctx, res);
      if (out.redirect) return res.redirect(303, out.redirect);
      render(res, context(req), out);
    } catch (err) {
      next(err);
    }
  };

  app.get('/', route(home.front));
  app.get('/news', route(home.archive));
  app.get('/connect', route(server.connect));
  app.get('/server/realmstatus', route(server.realmstatus));
  app.get('/server/online', route(server.online));
  app.get('/server/characters', route(server.characters));
  app.get('/server/honor', route(server.honor));
  app.get('/server/statistics', route(server.statistics));
  app.get('/server/ah', route(server.ah));
  app.get('/server/commands', route(server.commands));
  app.get('/armory', route(armory.search));
  app.get('/armory/character/:name', route(armory.character));
  app.get('/armory/guild/:id', route(armory.guild));
  app.get('/account', route(account.manage));
  app.get('/account/login', route(account.loginPage));
  app.post('/account/login', route(account.loginPost, { post: true }));
  app.post('/account/logout', route(account.logoutPost, { post: true }));
  app.get('/account/register', route(account.registerPage));
  app.post('/account/register', route(account.registerPost, { post: true }));
  app.post('/account/password', route(account.passwordPost, { post: true }));
  app.get('/admin', route(admin.index));
  app.post('/admin/news', route(admin.newsPost, { post: true }));
  app.post('/admin/news/:id/delete', route(admin.newsDelete, { post: true }));
  app.post('/admin/invites', route(admin.invitePost, { post: true }));
  app.post('/admin/invites/:code/delete', route(admin.inviteDelete, { post: true }));

  // Old SPP links (bookmarks, links in old news posts) go to the matching new page.
  const OLD = {
    'server:realmstatus': '/server/realmstatus', 'server:playersonline': '/server/online', 'server:chars': '/server/characters',
    'server:honor': '/server/honor', 'server:statistic': '/server/statistics', 'server:ah': '/server/ah', 'server:commands': '/server/commands',
    'server:howtoplay': '/connect', 'gameguide:connect': '/connect', 'account:manage': '/account', 'account:register': '/account/register',
    'account:login': '/account/login', 'forum:viewforum': '/news', 'frontpage:': '/',
  };
  app.get('/index.php', (req, res) => res.redirect(301, OLD[`${req.query.n || 'frontpage'}:${req.query.sub || ''}`] || OLD[`${req.query.n}:`] || '/'));
  app.get('/armory/index.php', (req, res) => {
    if (req.query.character) return res.redirect(301, `/armory/character/${encodeURIComponent(String(req.query.character))}`);
    res.redirect(301, req.query.searchType === 'honor' ? '/server/honor' : '/armory');
  });

  app.use(route(async () => ({ status: 404, title: 'Not found', body: layout.box('Page not found', html`That page doesn't exist. <a href="/">Back to the front page</a>.`) })));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (res.headersSent) return res.end();
    const offline = err instanceof data.OfflineError;
    if (!offline) log.error(err);
    let ctx;
    try {
      ctx = context(req);
    } catch {
      return res.status(500).type('text').send('Internal error');
    }
    render(res, ctx, {
      status: offline ? 503 : err.status === 400 ? 400 : 500,
      title: offline ? 'Realm offline' : 'Error',
      body: layout.box(offline ? 'The realm is offline' : 'Something went wrong', offline ? err.message : 'The page could not be shown. The error was written to the website log.'),
    });
  });

  return app;
}

module.exports = { buildApp, websiteDir };
