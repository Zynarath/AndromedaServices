import { api, onSocket } from '../api.js';
import { html, $, on, icon, toast, fmtBytes, statusPill, gameArt, artInner, copyText, sparkline, bindSparkHover } from '../ui.js';

function card(s) {
  const rt = s.runtime;
  const running = ['running', 'starting', 'stopping'].includes(rt.status);
  const canControl = s.perms.includes('control');
  const players = rt.players ? `${rt.players.online}${rt.players.max ? '/' + rt.players.max : ''}${rt.players.bots ? ` +${rt.players.bots}🤖` : ''}` : '—';
  const job = rt.job && rt.job.status === 'running' ? rt.job : null;
  return html`
    <article class="server-card" data-id="${s.id}">
      <a class="card-art art-${gameArt(s)}" href="#/server/${s.id}">
        ${artInner(s)}
        <span class="card-status">${statusPill(rt.status)}</span>
      </a>
      <div class="card-body">
        <a href="#/server/${s.id}" class="card-title">${s.name}</a>
        <div class="card-sub">${s.summary.game}</div>
        <div class="card-sub muted">${s.summary.detail}</div>
        ${job
          ? html`<div class="mini-job"><div class="bar"><span style="width:${job.progress ?? 5}%"></span></div><small>${job.label}${job.progressLabel ? ' · ' + job.progressLabel : ''}</small></div>`
          : html`<dl class="card-stats">
              <div><dt>Players</dt><dd data-f="players">${players}</dd></div>
              <div><dt>CPU</dt><dd data-f="cpu">${running && rt.stats ? rt.stats.cpu.toFixed(1) + '%' : '—'}</dd></div>
              <div><dt>RAM</dt><dd data-f="mem">${running && rt.stats ? fmtBytes(rt.stats.mem) : '—'}</dd></div>
            </dl>`}
        ${!s.installed && !job && s.lastInstallError ? html`<div class="card-error">${icon('alert')} Install failed — open the server for details</div>` : ''}
      </div>
      <div class="card-actions">
        ${s.connect ? html`<button class="btn btn-ghost btn-sm" data-copy="${s.connect}" title="Copy address">${icon('copy')}<span>${s.connect}</span></button>` : html`<span></span>`}
        ${canControl && s.installed
          ? running
            ? html`<button class="btn btn-sm" data-power="stop" ${rt.status === 'stopping' ? 'disabled' : ''}>${icon('stop')}Stop</button>`
            : html`<button class="btn btn-sm btn-primary" data-power="start" ${job ? 'disabled' : ''}>${icon('play')}Start</button>`
          : ''}
      </div>
    </article>`;
}

// Updates a container's children in place instead of swapping them out, so the tiles and cards
// don't replay their entrance animation every time new numbers arrive.
function patch(container, markup) {
  const t = document.createElement('template');
  t.innerHTML = markup;
  const next = [...t.content.children];
  const prev = [...container.children];
  if (next.length !== prev.length || next.some((n, i) => n.tagName !== prev[i].tagName || n.dataset.id !== prev[i].dataset.id)) {
    container.replaceChildren(...next);
    return;
  }
  next.forEach((n, i) => {
    if (prev[i].className !== n.className) prev[i].className = n.className;
    if (prev[i].innerHTML !== n.innerHTML) prev[i].innerHTML = n.innerHTML;
  });
}

export async function render(root, { state, refreshServers }) {
  const [sys, list] = await Promise.all([api.get('/api/system'), api.get('/api/servers')]);
  let servers = list.servers;
  const admin = state.user.role === 'admin';

  const drawTiles = (sys) => {
    const memUsed = sys.memTotal - sys.memFree;
    const online = servers.filter((s) => s.runtime.status === 'running').length;
    patch($('#tiles', root), html`
      <div class="tile"><div class="tile-label">${icon('cpu')} Host CPU</div><div class="tile-value">${sys.cpu.toFixed(0)}<small>%</small></div><div class="tile-meta" title="${sys.cpuModel}">${sys.cores} threads · ${sys.cpuModel.replace(/\s+\d+-Core Processor/, '')}</div></div>
      <div class="tile"><div class="tile-label">${icon('memory')} Host memory</div><div class="tile-value">${fmtBytes(memUsed)}</div><div class="tile-meta">of ${fmtBytes(sys.memTotal)} · ${fmtBytes(sys.memFree)} free</div>
        <div class="meter" role="meter" aria-valuenow="${Math.round((memUsed / sys.memTotal) * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${(memUsed / sys.memTotal) * 100}%"></span></div></div>
      <div class="tile"><div class="tile-label">${icon('archive')} Server drive</div><div class="tile-value">${sys.disk ? fmtBytes(sys.disk.free) : '—'}</div><div class="tile-meta">${sys.disk ? 'free of ' + fmtBytes(sys.disk.total) : 'unknown'}</div>
        ${sys.disk ? html`<div class="meter"><span style="width:${(1 - sys.disk.free / sys.disk.total) * 100}%"></span></div>` : ''}</div>
      <div class="tile"><div class="tile-label">${icon('server')} Servers online</div><div class="tile-value">${online}<small> / ${servers.length}</small></div><div class="tile-meta">${sys.lanAddresses.length ? 'LAN: ' + sys.lanAddresses.slice(0, 2).join(', ') : sys.hostname}</div></div>`.s);
  };

  // Whole-PC CPU and memory over the last hour (the panel samples every 5 seconds).
  const drawCharts = (sys) => {
    const hist = sys.history || [];
    const gb = (b) => b / 1073741824;
    const step = sys.historyStep || 5;
    const span = hist.length > 1 ? Math.round(((hist.length - 1) * step) / 60) : 0;
    const since = span >= 60 ? 'last hour' : span > 0 ? `last ${span} min` : 'collecting…';
    const now = hist[hist.length - 1];
    patch($('#host-charts', root), html`
      <div class="panel chart-panel"><div class="chart-head"><h3>${icon('cpu')} CPU usage</h3><span class="chart-value">${now ? now.cpu.toFixed(0) + '%' : '—'}</span></div>
        ${sparkline(hist.map((h) => h.cpu), { max: 100, height: 90, step, fmt: (v) => v.toFixed(0) + '%' })}
        <p class="muted small">Whole PC (${sys.cores} threads), ${since}</p></div>
      <div class="panel chart-panel"><div class="chart-head"><h3>${icon('memory')} Memory usage</h3><span class="chart-value">${now ? fmtBytes(now.mem) : '—'}</span></div>
        ${sparkline(hist.map((h) => gb(h.mem)), { max: gb(sys.memTotal), height: 90, step, fmt: (v) => v.toFixed(1) + ' GB' })}
        <p class="muted small">Of ${fmtBytes(sys.memTotal)}, ${since}</p></div>`.s);
  };

  const drawCards = () => {
    patch($('#cards', root), servers.length
      ? servers.map((s) => card(s).s).join('')
      : html`<div class="empty-state wide">${icon('server')}<h2>No servers yet</h2>
          <p>${admin ? 'Create your first ARK or Minecraft server — the panel downloads everything it needs.' : 'An admin has not given you access to any servers yet.'}</p>
          ${admin ? html`<a class="btn btn-primary" href="#/new">${icon('plus')}Create a server</a>` : ''}</div>`.s);
  };

  root.innerHTML = html`
    <div class="page-head">
      <div><h1>Dashboard</h1><p class="muted">Everything running on ${sys.hostname}</p></div>
      ${admin ? html`<a class="btn btn-primary" href="#/new">${icon('plus')}New server</a>` : ''}
    </div>
    <section class="tiles" id="tiles"></section>
    <section class="grid-2 host-charts" id="host-charts"></section>
    <section class="cards" id="cards"></section>`.s;
  drawTiles(sys);
  drawCards();

  on(root, 'click', '[data-copy]', (_e, el) => copyText(el.dataset.copy));
  on(root, 'click', '[data-power]', async (_e, el) => {
    const id = el.closest('[data-id]').dataset.id;
    el.disabled = true;
    try {
      await api.post(`/api/servers/${id}/power`, { action: el.dataset.power });
    } catch (err) {
      toast(err.message, 'error');
      el.disabled = false;
    }
  });

  let redraw = null;
  const scheduleRedraw = () => {
    clearTimeout(redraw);
    redraw = setTimeout(drawCards, 150);
  };
  const off = onSocket((msg) => {
    const s = servers.find((x) => x.id === msg.serverId);
    if (msg.type === 'removed' || (msg.serverId && !s && msg.type === 'status')) {
      api.get('/api/servers').then((r) => { servers = r.servers; drawCards(); });
      return;
    }
    if (!s) return;
    if (msg.type === 'status') {
      s.runtime.status = msg.status;
      if (msg.status !== 'running') s.runtime.players = null;
      if (msg.status === 'stopped' || msg.status === 'running') api.get('/api/servers').then((r) => { servers = r.servers; scheduleRedraw(); });
      scheduleRedraw();
    } else if (msg.type === 'stats') {
      s.runtime.stats = msg.stats;
      const el = root.querySelector(`[data-id="${s.id}"]`);
      if (el) {
        const cpu = el.querySelector('[data-f=cpu]');
        const mem = el.querySelector('[data-f=mem]');
        if (cpu) cpu.textContent = msg.stats.cpu.toFixed(1) + '%';
        if (mem) mem.textContent = fmtBytes(msg.stats.mem);
      }
    } else if (msg.type === 'players') {
      s.runtime.players = msg.players;
      const el = root.querySelector(`[data-id="${s.id}"] [data-f=players]`);
      if (el) el.textContent = `${msg.players.online}${msg.players.max ? '/' + msg.players.max : ''}${msg.players.bots ? ` +${msg.players.bots}🤖` : ''}`;
    } else if (msg.type === 'job') {
      const wasRunning = s.runtime.job && s.runtime.job.status === 'running';
      s.runtime.job = msg.job;
      if (wasRunning && msg.job.status !== 'running') api.get('/api/servers').then((r) => { servers = r.servers; scheduleRedraw(); });
      scheduleRedraw();
    }
  });
  drawCharts(sys);
  bindSparkHover($('#host-charts', root));
  const timer = setInterval(() => api.get('/api/system').then((s) => { drawTiles(s); drawCharts(s); }).catch(() => {}), 5000);
  return () => {
    off();
    clearInterval(timer);
    clearTimeout(redraw);
    refreshServers();
  };
}
