import { api, connectSocket, disconnectSocket, onSocket, subscribe } from './api.js';
import { html, $, on, icon, toast, esc } from './ui.js';
import * as login from './views/login.js';
import * as dashboard from './views/dashboard.js';
import * as create from './views/create.js';
import * as serverView from './views/server.js';
import * as users from './views/users.js';
import * as settings from './views/settings.js';
import * as account from './views/account.js';
import * as fileshare from './views/fileshare.js';

// Bump together with package.json "version". If the server is newer than this page, the browser
// (or Cloudflare) is showing an old cached copy and the user is asked to reload.
const PAGE_VERSION = '1.0.0';

export const state = { user: null, panelName: 'Andromeda Hosting', servers: [], version: PAGE_VERSION };

const routes = [
  { re: /^\/?$/, view: dashboard },
  { re: /^\/new$/, view: create, admin: true },
  { re: /^\/server\/([\w-]+)(?:\/(\w+))?$/, view: serverView },
  { re: /^\/users$/, view: users, admin: true },
  { re: /^\/settings$/, view: settings, admin: true },
  { re: /^\/share-admin$/, view: fileshare, admin: true },
  { re: /^\/account$/, view: account },
];

let cleanup = null;

export function navigate(path) {
  if (location.hash !== '#' + path) location.hash = path;
  else route();
}

async function refreshServers() {
  try {
    state.servers = (await api.get('/api/servers')).servers;
  } catch {
    state.servers = [];
  }
  renderNav();
}

function renderNav() {
  const nav = $('#server-nav');
  if (!nav) return;
  const current = location.hash.match(/server\/([\w-]+)/)?.[1];
  nav.innerHTML = state.servers.length
    ? state.servers
        .map(
          (s) => html`<a href="#/server/${s.id}" class="nav-server ${s.id === current ? 'active' : ''}" data-sid="${s.id}">
            <span class="status-dot st-${s.runtime.status}"></span><span class="nav-name">${s.name}</span></a>`.s
        )
        .join('')
    : html`<div class="nav-empty">No servers yet</div>`.s;
}

function shell() {
  const admin = state.user.role === 'admin';
  $('#app').innerHTML = html`
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="#/"><img src="/img/icon.svg" alt=""><span>${state.panelName}</span></a>
        <nav class="nav">
          <a href="#/" data-nav="/">${icon('grid')}<span>Dashboard</span></a>
          ${admin ? html`<a href="#/new" data-nav="/new">${icon('plus')}<span>New server</span></a>` : ''}
          <div class="nav-label">Servers</div>
          <div id="server-nav"></div>
          ${admin
            ? html`<div class="nav-label">Admin</div>
              <a href="#/users" data-nav="/users">${icon('users')}<span>Users &amp; access</span></a>
              <a href="#/share-admin" data-nav="/share-admin">${icon('archive')}<span>File share</span></a>
              <a href="#/settings" data-nav="/settings">${icon('settings')}<span>Panel settings</span></a>`
            : ''}
        </nav>
        <div class="sidebar-foot">
          <a href="#/account" class="me" data-nav="/account">${icon('user')}<span>${state.user.username}</span><small>${state.user.role} · v${PAGE_VERSION}</small></a>
          <button class="icon-btn" id="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn" id="menu-toggle" aria-label="Menu">${icon('menu')}</button>
          <span class="topbar-title">${state.panelName}</span>
          <span id="socket-state" class="socket-state" hidden>Reconnecting…</span>
        </header>
        <main id="view" class="view"></main>
      </div>
    </div>`.s;
  $('#logout').onclick = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    disconnectSocket();
    state.user = null;
    boot();
  };
  $('#menu-toggle').onclick = () => $('#sidebar').classList.toggle('open');
  on($('#sidebar'), 'click', 'a', (_e, a) => {
    $('#sidebar').classList.remove('open');
    // Re-clicking the current page's link should reset it (e.g. back to the game picker).
    if (a.getAttribute('href') === location.hash) route();
  });
  renderNav();
}

async function route() {
  if (!state.user) return;
  const path = location.hash.replace(/^#/, '') || '/';
  if (cleanup) {
    try { cleanup(); } catch {}
    cleanup = null;
  }
  subscribe(null);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === path));
  renderNav();
  const view = $('#view');
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    if (r.admin && state.user.role !== 'admin') break;
    view.innerHTML = '<div class="loading">Loading…</div>';
    view.scrollTop = 0;
    try {
      cleanup = (await r.view.render(view, { params: m.slice(1), state, navigate, refreshServers })) || null;
    } catch (err) {
      view.innerHTML = html`<div class="empty-state">${icon('alert')}<h2>Something went wrong</h2><p>${err.message}</p><a class="btn" href="#/">Back to dashboard</a></div>`.s;
    }
    return;
  }
  view.innerHTML = html`<div class="empty-state"><h2>Page not found</h2><a class="btn" href="#/">Dashboard</a></div>`.s;
}

// Keep sidebar status dots live.
onSocket((msg) => {
  if (msg.type === 'socket') {
    const el = $('#socket-state');
    if (el) el.hidden = msg.connected;
    if (msg.connected) refreshServers();
  }
  if (msg.type === 'status') {
    const s = state.servers.find((x) => x.id === msg.serverId);
    if (s) {
      s.runtime.status = msg.status;
      renderNav();
    } else refreshServers();
  }
  if (msg.type === 'removed') refreshServers();
});

window.addEventListener('hashchange', route);
window.addEventListener('hp:unauthorized', () => {
  if (state.user) {
    state.user = null;
    toast('Your session ended — please sign in again.', 'warn');
    boot();
  }
});

async function boot() {
  let auth;
  try {
    auth = await api.get('/api/auth/state');
  } catch (err) {
    $('#app').innerHTML = html`<div class="boot">Can't reach the panel: ${err.message}</div>`.s;
    return;
  }
  state.panelName = auth.panelName || 'Andromeda Hosting';
  if (auth.version && auth.version !== PAGE_VERSION) {
    // Old cached page: reload once with a cache-busting URL, then tell the user if it persists.
    const key = 'hp-reloaded-for';
    if (sessionStorage.getItem(key) !== auth.version) {
      sessionStorage.setItem(key, auth.version);
      location.replace(`${location.pathname}?v=${encodeURIComponent(auth.version)}${location.hash}`);
      return;
    }
    toast(`The panel was updated to v${auth.version} but your browser is still showing an old copy. Press Ctrl+F5 (and purge Cloudflare's cache if you use your domain).`, 'warn', 20000);
  }
  document.title = state.panelName;
  if (!auth.user) {
    login.render($('#app'), { auth, onLogin: (user) => { state.user = user; boot(); } });
    return;
  }
  state.user = auth.user;
  shell();
  connectSocket();
  await refreshServers();
  route();
}

export function setPanelName(name) {
  state.panelName = name;
  document.title = name;
  document.querySelectorAll('.brand span, .topbar-title').forEach((el) => (el.textContent = name));
}

export { refreshServers, esc };
boot();
