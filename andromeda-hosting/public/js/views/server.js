import { api, onSocket, subscribe } from '../api.js';
import { html, $, on, icon, toast, fmtBytes, fmtDuration, statusPill, gameArt, copyText, confirmBox, sparkline, bindSparkHover, esc, raw, artLabel } from '../ui.js';
import * as settingsTab from './tabs/settings.js';
import * as modsTab from './tabs/mods.js';
import * as filesTab from './tabs/files.js';
import * as backupsTab from './tabs/backups.js';
import * as schedulesTab from './tabs/schedules.js';
import * as accessTab from './tabs/access.js';
import * as playersTab from './tabs/players.js';
import * as accountsTab from './tabs/accounts.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'activity' },
  { id: 'console', label: 'Console', icon: 'terminal', perm: 'console' },
  { id: 'settings', label: 'Settings', icon: 'settings', perm: 'settings', mod: settingsTab },
  { id: 'players', label: 'Players', icon: 'users', perm: 'settings', mod: playersTab, game: 'minecraft' },
  { id: 'accounts', label: 'Accounts', icon: 'users', perm: 'settings', mod: accountsTab, game: 'wow' },
  { id: 'mods', label: 'Mods', icon: 'box', perm: 'mods', mod: modsTab, notGame: 'wow' },
  { id: 'files', label: 'Files', icon: 'folder', perm: 'files', mod: filesTab },
  { id: 'backups', label: 'Backups', icon: 'archive', perm: 'backups', mod: backupsTab },
  { id: 'schedules', label: 'Schedules', icon: 'clock', perm: 'schedules', mod: schedulesTab },
  { id: 'access', label: 'Access', icon: 'shield', perm: 'admin', mod: accessTab },
];

export function gameLine(s) {
  if (s.ark) return `${s.ark.editionLabel} · ${s.ark.map}`;
  if (s.cod) return `${s.cod.label} · ${s.cod.gametypeLabel}`;
  if (s.wow) return `WoW: Wrath of the Lich King · realm "${s.wow.realmName}"`;
  if (s.mc.source === 'curseforge') return `${s.mc.curseforge?.packName || 'Modpack'} ${s.mc.curseforge?.versionName ? '· ' + s.mc.curseforge.versionName : ''}`;
  const l = { vanilla: 'Vanilla', forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric' }[s.mc.loader] || s.mc.loader;
  return `Minecraft ${s.mc.mcVersion || ''} · ${l} ${s.mc.loaderVersion || ''}`;
}

export async function render(root, ctx) {
  const [id, tabParam] = ctx.params;
  const { server: initial } = await api.get(`/api/servers/${id}`);
  let s = initial;
  const can = (p) => s.perms.includes(p) || s.perms.includes('admin');
  const tabs = TABS.filter((t) => (!t.perm || can(t.perm)) && (!t.game || t.game === s.game) && t.notGame !== s.game);
  const tab = tabs.find((t) => t.id === tabParam) || tabs[0];
  let consoleLines = [];
  let tabCleanup = null;

  root.innerHTML = html`
    <div class="server-head">
      <div class="server-art art-${gameArt(s)}">${s.mc?.curseforge?.logo ? html`<img src="${s.mc.curseforge.logo}" alt="">` : html`<span class="art-mono">${artLabel(s)}</span>`}</div>
      <div class="server-title">
        <h1>${s.name}</h1>
        <div class="server-meta"><span id="status-pill">${statusPill(s.runtime.status)}</span><span class="muted">${gameLine(s)}</span></div>
      </div>
      <div class="power" id="power"></div>
    </div>
    <nav class="tabs" role="tablist">${tabs.map((t) => html`<a role="tab" href="#/server/${s.id}/${t.id}" class="${t.id === tab.id ? 'active' : ''}" aria-selected="${t.id === tab.id}">${icon(t.icon)}<span>${t.label}</span></a>`)}</nav>
    <section id="tab" class="tab-body"></section>`.s;

  const drawPower = () => {
    const st = s.runtime.status;
    const busy = s.runtime.job && s.runtime.job.status === 'running';
    const live = ['running', 'starting', 'stopping'].includes(st);
    if (!can('control') || !s.installed) {
      $('#power').innerHTML = '';
      return;
    }
    $('#power').innerHTML = html`
      ${!live ? html`<button class="btn btn-primary" data-power="start" ${busy ? 'disabled' : ''}>${icon('play')}Start</button>` : ''}
      ${live ? html`<button class="btn" data-power="restart" ${st !== 'running' ? 'disabled' : ''}>${icon('restart')}Restart</button>` : ''}
      ${live ? html`<button class="btn" data-power="stop" ${st === 'stopping' ? 'disabled' : ''}>${icon('stop')}Stop</button>` : ''}
      ${live ? html`<button class="btn btn-ghost btn-danger-text" data-power="kill" title="Force kill (may lose unsaved progress)">${icon('skull')}Kill</button>` : ''}`.s;
  };
  drawPower();
  on($('#power'), 'click', '[data-power]', async (_e, el) => {
    const action = el.dataset.power;
    if (action === 'kill' && !(await confirmBox('Force kill?', 'The server process is terminated immediately. Anything not saved yet is lost.', { danger: true, confirm: 'Kill' }))) return;
    el.disabled = true;
    try {
      await api.post(`/api/servers/${s.id}/power`, { action });
    } catch (err) {
      toast(err.message, 'error');
    }
    el.disabled = false;
  });

  const tabEl = $('#tab');
  const refresh = async () => {
    s = (await api.get(`/api/servers/${s.id}`)).server;
    drawPower();
    if (tab.id === 'overview') drawOverview();
  };

  // ---------- Overview ----------
  const drawOverview = () => {
    const rt = s.runtime;
    const live = ['running', 'starting', 'stopping'].includes(rt.status);
    const hist = s.statsHistory || [];
    const job = rt.job;
    const lan = window.__lan || [];
    const forward = s.ports.filter((p) => p.forward);
    const manual = s.mc?.curseforge?.manual || [];
    tabEl.innerHTML = html`
      ${!s.installed && s.lastInstallError && !(job && job.status === 'running')
        ? html`<div class="callout callout-bad">${icon('alert')}<div><strong>Install failed:</strong> ${s.lastInstallError}
            ${s.perms.includes('admin') ? html`<div><button class="btn btn-sm" id="retry-install">${icon('refresh')}Try again</button></div>` : ''}</div></div>`
        : ''}
      ${job && (job.status === 'running' || Date.now() - (job.finishedAt || 0) < 10 * 60e3) ? jobCard(job) : ''}
      ${manual.length
        ? html`<div class="callout callout-warn">${icon('alert')}<div><strong>${manual.length} mod(s) need a manual download.</strong> Their authors block downloads through other apps.
            Download each file and upload it to the <code>mods</code> folder in the Files tab:<ul>${manual.map((m) => html`<li>${m.url ? html`<a href="${m.url}" target="_blank" rel="noopener">${m.name}</a>` : m.name} — <code>${m.fileName}</code></li>`)}</ul></div></div>`
        : ''}
      <div class="grid-2">
        <div class="panel">
          <h3>Connect</h3>
          ${s.wow ? wowConnect(lan, forward) : html`
          ${s.connect
            ? html`<div class="address"><code>${s.connect}</code><button class="btn btn-sm" data-copy="${s.connect}">${icon('copy')}Copy</button></div>
                <p class="muted small">Public address. For players on your own network use <code>${lan[0] || 'your LAN IP'}:${s.ports[0].port}</code>.</p>`
            : html`<p class="muted">Set your public IP / domain under <a href="#/settings">Panel settings</a> to show a shareable address.</p>
                ${lan.length ? html`<div class="address"><code>${lan[0]}:${s.ports[0].port}</code><button class="btn btn-sm" data-copy="${lan[0]}:${s.ports[0].port}">${icon('copy')}Copy</button></div><p class="muted small">LAN / Tailscale address</p>` : ''}`}
          ${s.ark && s.ark.joinPassword !== undefined
            ? html`<p class="small">Join password: ${s.ark.joinPassword ? html`<code>${s.ark.joinPassword}</code> <button class="btn btn-sm btn-ghost" data-copy="${s.ark.joinPassword}">${icon('copy')}</button>` : html`<span class="pill pill-warn">none — anyone can join</span>`}</p>`
            : s.ark && s.ark.hasPassword ? html`<p class="small muted">Password protected.</p>` : ''}
          ${s.cod && s.cod.joinPassword !== undefined
            ? html`<p class="small">Join password: ${s.cod.joinPassword ? html`<code>${s.cod.joinPassword}</code> <button class="btn btn-sm btn-ghost" data-copy="${s.cod.joinPassword}">${icon('copy')}</button>` : html`<span class="pill pill-warn">none — anyone can join</span>`}</p>`
            : ''}
          ${s.cod ? html`<p class="muted small">In game, open the console (<kbd>~</kbd>) and type <code>${s.cod.joinPassword ? `password ${s.cod.joinPassword}; ` : ''}connect ${esc(s.connect || (lan[0] || 'IP') + ':' + s.cod.port)}</code>.</p>` : ''}
          ${s.ark ? html`<p class="muted small">In ARK, open the console (<kbd>~</kbd>) and type <code>open ${esc(s.connect || (lan[0] || 'IP') + ':' + s.ark.port)}</code> to join directly.</p>` : ''}
          <h4>Ports to forward on your router</h4>
          <table class="table compact"><tbody>${forward.map((p) => html`<tr><td><code>${p.port}</code></td><td>${p.proto}</td><td class="muted">${p.label}</td></tr>`)}</tbody></table>
          <p class="muted small">Not needed if you and your friends connect over Tailscale or ZeroTier.</p>`}
        </div>
        <div class="panel">
          <h3>Status</h3>
          <dl class="kv">
            <div><dt>State</dt><dd>${statusPill(rt.status)}</dd></div>
            <div><dt>Uptime</dt><dd id="uptime">${live && rt.startedAt ? fmtDuration(Date.now() - rt.startedAt) : '—'}</dd></div>
            <div><dt>Players</dt><dd id="players">${rt.players ? `${rt.players.online}${rt.players.max ? ' / ' + rt.players.max : ''}${rt.players.bots ? ` · ${rt.players.bots} bots` : ''}` : '—'}</dd></div>
            ${s.mc ? html`<div><dt>Memory limit</dt><dd>${(s.mc.memoryMb / 1024).toFixed(1)} GB</dd></div><div><dt>Java</dt><dd>${s.mc.javaMajor || 'auto'}</dd></div>` : ''}
            ${s.ark ? html`<div><dt>Mods</dt><dd>${s.ark.mods.length}</dd></div><div><dt>Max players</dt><dd>${s.ark.maxPlayers}</dd></div>` : ''}
            ${s.cod ? html`<div><dt>Mode</dt><dd>${s.cod.gametypeLabel}${rt.players && rt.players.map ? ' · ' + rt.players.map : ''}</dd></div><div><dt>XP</dt><dd>${s.cod.xpScale}x${s.cod.weaponXp ? ` · weapon ${s.cod.weaponXpScale}x` : ''}</dd></div><div><dt>Bots</dt><dd>${s.cod.bots.enabled ? `fill to ${s.cod.bots.fill}${rt.players && rt.players.bots != null ? ` (${rt.players.bots} in game)` : ''}` : 'off'}</dd></div>` : ''}
          </dl>
          <div id="player-list" class="chips">${(rt.players?.players || []).map((p) => html`<span class="chip">${p}</span>`)}</div>
          ${can('settings')
            ? html`<div class="toggles">
                <label class="switch"><input type="checkbox" data-flag="autoStart" ${s.autoStart ? 'checked' : ''}><span></span>Start when the panel starts</label>
                <label class="switch"><input type="checkbox" data-flag="autoRestart" ${s.autoRestart ? 'checked' : ''}><span></span>Restart automatically after a crash</label>
              </div>`
            : ''}
        </div>
      </div>
      <div class="grid-2">
        <div class="panel chart-panel"><div class="chart-head"><h3>CPU</h3><span class="chart-value" id="cpu-now">${live && rt.stats ? rt.stats.cpu.toFixed(1) + '%' : '—'}</span></div>
          <div id="cpu-chart">${sparkline(hist.map((h) => h.cpu), { max: 25, fmt: (v) => v.toFixed(1) + '%' })}</div><p class="muted small">Share of the whole PC (${s.cores} threads), last 6 minutes</p></div>
        <div class="panel chart-panel"><div class="chart-head"><h3>Memory</h3><span class="chart-value" id="mem-now">${live && rt.stats ? fmtBytes(rt.stats.mem) : '—'}</span></div>
          <div id="mem-chart">${sparkline(hist.map((h) => h.mem / 1073741824), { max: s.mc ? s.mc.memoryMb / 1024 : 16, fmt: (v) => v.toFixed(2) + ' GB' })}</div><p class="muted small">Working set, last 6 minutes</p></div>
      </div>`.s;
    const retry = $('#retry-install');
    if (retry) retry.onclick = async () => {
      try {
        await api.post(`/api/servers/${s.id}/reinstall`);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  };

  // WoW joins through a realmlist line, not host:port, so it gets its own Connect card.
  function wowConnect(lan, forward) {
    const addr = s.wow.address || '127.0.0.1';
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(addr);
    const line = `set realmlist ${addr}`;
    return html`
      <p class="small">Everyone, you included, puts this one line in <code>Data\\enUS\\realmlist.wtf</code> (or <code>enGB</code>) in their WoW 3.3.5a folder:</p>
      <div class="address"><code>${line}</code><button class="btn btn-sm" data-copy="${line}">${icon('copy')}Copy</button></div>
      ${addr === '127.0.0.1'
        ? html`<div class="callout callout-warn">${icon('alert')}<div>The realm is announced at <code>127.0.0.1</code>, so only this PC can join. Set your domain (e.g. play.example.com) under <a href="#/settings">Panel settings → Public address</a> or <em>Settings → Realm</em>, then restart.</div></div>`
        : isIp
          ? html`<div class="callout callout-warn">${icon('alert')}<div>The realm is announced at the IP <code>${addr}</code>. Friends can join, but <strong>you can't from this PC</strong> (routers don't loop back to their own public IP), and it breaks if your IP changes. Use a hostname like play.example.com in <em>Settings → Realm</em>, then restart.</div></div>`
          : html`<p class="muted small">On this PC, <code>${addr}</code> must point to 127.0.0.1: run <code>scripts\\use-domain-on-this-pc.ps1 -Hostname ${addr}</code> once as Administrator. Friends need nothing extra.</p>`}
      <p class="muted small">They log in with the account you create for them in the <a href="#/server/${s.id}/accounts">Accounts</a> tab. The realm list is updated with this address every time the server starts.</p>
      <p><button class="btn btn-sm" id="wow-diag">${icon('activity')}Check connection</button></p>
      <div id="wow-diag-out"></div>
      <h4>Ports to forward on your router</h4>
      <table class="table compact"><tbody>${forward.map((p) => html`<tr><td><code>${p.port}</code></td><td>${p.proto}</td><td class="muted">${p.label}</td></tr>`)}</tbody></table>
      <p class="muted small">Never forward the database port (3310).</p>`;
  }

  function jobCard(job) {
    const running = job.status === 'running';
    return html`<div class="panel job ${job.status}">
      <div class="job-head"><strong>${job.label}</strong><span class="pill pill-${running ? 'info' : job.status === 'done' ? 'ok' : 'bad'}">${running ? 'In progress' : job.status === 'done' ? 'Finished' : 'Failed'}</span></div>
      ${running ? html`<div class="bar ${job.progress == null ? 'indeterminate' : ''}"><span style="width:${job.progress ?? 30}%"></span></div><div class="muted small">${job.progressLabel || ''}${job.progress != null ? ' · ' + job.progress.toFixed(0) + '%' : ''}</div>` : ''}
      ${job.error ? html`<div class="form-error">${job.error}</div>` : ''}
      <pre class="job-log">${(job.log || []).slice(-8).map((l) => l.line).join('\n')}</pre>
      ${!running && can('console') ? html`<a class="small" href="#/server/${s.id}/console">Full log in Console →</a>` : ''}
    </div>`;
  }

  on(tabEl, 'click', '[data-copy]', (_e, el) => copyText(el.dataset.copy));
  on(tabEl, 'click', '#wow-diag', async (_e, el) => {
    el.disabled = true;
    const out = $('#wow-diag-out');
    out.innerHTML = '<div class="loading">Checking…</div>';
    try {
      const { checks } = await api.get(`/api/servers/${s.id}/wow/diagnose`);
      out.innerHTML = html`<ul class="diag">${checks.map((c) => html`<li class="${c.ok ? 'ok' : 'bad'}">${icon(c.ok ? 'check' : 'alert')}<div><strong>${c.title}</strong><small>${c.detail}</small></div></li>`)}</ul>`.s;
    } catch (err) {
      out.innerHTML = html`<div class="form-error">${err.message}</div>`.s;
    }
    el.disabled = false;
  });
  on(tabEl, 'change', '[data-flag]', async (_e, el) => {
    try {
      await api.patch(`/api/servers/${s.id}`, { [el.dataset.flag]: el.checked });
      s[el.dataset.flag] = el.checked;
      toast('Saved', 'ok', 1500);
    } catch (err) {
      toast(err.message, 'error');
      el.checked = !el.checked;
    }
  });
  bindSparkHover(tabEl);

  // ---------- Console ----------
  const QUICK = s.wow
    ? [['Save all', 'saveall'], ['Server info', 'server info'], ['Who is online', 'account onlinelist'], ['Announce…', 'announce ']]
    : s.cod
    ? [['Status', 'status'], ['Next map', 'map_rotate'], ['Restart map', 'fast_restart'], ['Say…', 'say '], ['Kick…', 'clientkick ']]
    : s.ark
    ? [['Save world', 'SaveWorld'], ['List players', 'ListPlayers'], ['Wipe wild dinos', 'DestroyWildDinos'], ['Broadcast…', 'Broadcast ']]
    : [['List players', 'list'], ['Save world', 'save-all'], ['Whitelist add…', 'whitelist add '], ['Op player…', 'op '], ['Say…', 'say ']];
  const history = [];
  let histIdx = -1;
  const lineClass = (l) => (/^\[panel\]|^\[(install|update|backup|restore|schedule|files|mods|rcon)\]/.test(l) ? 'l-panel' : /\b(ERROR|FATAL|SEVERE|Exception)\b/.test(l) ? 'l-err' : /\bWARN(ING)?\b/.test(l) ? 'l-warn' : /^> /.test(l) ? 'l-cmd' : '');
  const renderLine = (e) => `<div class="${lineClass(e.line)}">${esc(e.line)}</div>`;
  const drawConsole = () => {
    tabEl.innerHTML = html`
      <div class="console-wrap">
        <div class="console-tools">
          <div class="quick">${QUICK.map(([label, cmd]) => html`<button class="btn btn-sm btn-ghost" data-quick="${cmd}">${label}</button>`)}</div>
          <label class="check small"><input type="checkbox" id="autoscroll" checked> Auto-scroll</label>
        </div>
        <div class="console" id="console" tabindex="0" aria-label="Server console" aria-live="off">${raw(consoleLines.map(renderLine).join(''))}</div>
        <form class="console-input" id="cmd-form">
          <span class="prompt">${s.ark || s.cod ? 'RCON' : '>'}</span>
          <input name="command" autocomplete="off" placeholder="${s.ark ? 'ARK admin command, e.g. ServerChat Hello' : s.cod ? 'Server command, e.g. map mp_rust' : s.wow ? 'GM command without the dot, e.g. announce Hello' : 'Server command, e.g. say Hello'}" ${['running', 'starting'].includes(s.runtime.status) ? '' : 'disabled'}>
          <button class="btn btn-primary" ${['running', 'starting'].includes(s.runtime.status) ? '' : 'disabled'}>Send</button>
        </form>
        ${s.ark ? html`<p class="muted small">ARK has no live console; the panel shows <code>ShooterGame.log</code> and sends commands over RCON once the server has finished loading.</p>` : ''}
      </div>`.s;
    const c = $('#console');
    c.scrollTop = c.scrollHeight;
    const form = $('#cmd-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const command = form.command.value.trim();
      if (!command) return;
      history.unshift(command);
      histIdx = -1;
      form.command.value = '';
      try {
        await api.post(`/api/servers/${s.id}/command`, { command });
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    form.command.onkeydown = (e) => {
      if (e.key === 'ArrowUp' && histIdx < history.length - 1) form.command.value = history[++histIdx];
      else if (e.key === 'ArrowDown') form.command.value = histIdx > 0 ? history[--histIdx] : ((histIdx = -1), '');
      else return;
      e.preventDefault();
    };
  };
  on(tabEl, 'click', '[data-quick]', (_e, el) => {
    const input = $('#cmd-form')?.command;
    if (!input || input.disabled) return toast('Server is not running', 'warn');
    input.value = el.dataset.quick;
    if (el.dataset.quick.endsWith(' ')) input.focus();
    else $('#cmd-form').requestSubmit();
  });

  // ---------- live updates ----------
  const pending = [];
  let flushTimer = null;
  const flushConsole = () => {
    flushTimer = null;
    const c = $('#console');
    if (!c) return (pending.length = 0);
    c.insertAdjacentHTML('beforeend', pending.map(renderLine).join(''));
    pending.length = 0;
    while (c.childElementCount > 1500) c.firstElementChild.remove();
    if ($('#autoscroll')?.checked) c.scrollTop = c.scrollHeight;
  };
  let overviewTimer = null;
  const off = onSocket((msg) => {
    if (msg.serverId !== s.id) return;
    if (msg.type === 'snapshot') {
      consoleLines = msg.console;
      s.runtime = msg.runtime;
      if (tab.id === 'console') drawConsole();
    } else if (msg.type === 'console') {
      consoleLines.push(msg.entry);
      if (consoleLines.length > 1500) consoleLines.shift();
      if (tab.id === 'console') {
        pending.push(msg.entry);
        if (!flushTimer) flushTimer = setTimeout(flushConsole, 100);
      }
    } else if (msg.type === 'status') {
      s.runtime.status = msg.status;
      $('#status-pill').innerHTML = statusPill(msg.status).s;
      drawPower();
      if (tab.id === 'console') {
        const live = ['running', 'starting'].includes(msg.status);
        const f = $('#cmd-form');
        if (f) f.querySelectorAll('input,button').forEach((x) => (x.disabled = !live));
      }
      if (['running', 'stopped', 'crashed'].includes(msg.status)) refresh().catch(() => {});
      else if (tab.id === 'overview') drawOverview();
    } else if (msg.type === 'stats') {
      s.runtime.stats = msg.stats;
      s.statsHistory = [...(s.statsHistory || []), msg.stats].slice(-120);
      if (tab.id === 'overview' && $('#cpu-chart')) {
        $('#cpu-now').textContent = msg.stats.cpu.toFixed(1) + '%';
        $('#mem-now').textContent = fmtBytes(msg.stats.mem);
        $('#cpu-chart').innerHTML = sparkline(s.statsHistory.map((h) => h.cpu), { max: 25, fmt: (v) => v.toFixed(1) + '%' }).s;
        $('#mem-chart').innerHTML = sparkline(s.statsHistory.map((h) => h.mem / 1073741824), { max: s.mc ? s.mc.memoryMb / 1024 : 16, fmt: (v) => v.toFixed(2) + ' GB' }).s;
        if (s.runtime.startedAt) $('#uptime').textContent = fmtDuration(Date.now() - s.runtime.startedAt);
      }
    } else if (msg.type === 'players') {
      s.runtime.players = msg.players;
      if (tab.id === 'overview' && $('#players')) {
        $('#players').textContent = `${msg.players.online}${msg.players.max ? ' / ' + msg.players.max : ''}${msg.players.bots ? ` · ${msg.players.bots} bots` : ''}`;
        $('#player-list').innerHTML = (msg.players.players || []).map((p) => `<span class="chip">${esc(p)}</span>`).join('');
      }
    } else if (msg.type === 'job') {
      const prev = s.runtime.job;
      const finished = prev && prev.status === 'running' && msg.job.status !== 'running';
      // The socket only carries the last few log lines; keep the longer tail we already have.
      const log = prev && prev.id === msg.job.id ? [...prev.log, ...msg.job.log.filter((l) => !prev.log.some((p) => p.t === l.t && p.line === l.line))].slice(-50) : msg.job.log;
      s.runtime.job = { ...msg.job, log };
      drawPower();
      if (tab.id === 'overview' && !overviewTimer) overviewTimer = setTimeout(() => { overviewTimer = null; drawOverview(); }, 300);
      if (finished) refresh().catch(() => {});
    } else if (msg.type === 'removed') {
      toast('This server was deleted', 'warn');
      ctx.navigate('/');
    }
  });
  subscribe(s.id);

  try {
    window.__lan = window.__lan || (await api.get('/api/system')).lanAddresses;
  } catch {}

  if (tab.id === 'overview') drawOverview();
  else if (tab.id === 'console') drawConsole();
  else tabCleanup = await tab.mod.render(tabEl, { server: s, can, refresh, navigate: ctx.navigate, refreshServers: ctx.refreshServers });

  const ticker = setInterval(() => {
    if (tab.id === 'overview' && s.runtime.startedAt && ['running', 'starting', 'stopping'].includes(s.runtime.status) && $('#uptime')) {
      $('#uptime').textContent = fmtDuration(Date.now() - s.runtime.startedAt);
    }
  }, 1000);

  return () => {
    off();
    clearInterval(ticker);
    clearTimeout(flushTimer);
    clearTimeout(overviewTimer);
    if (tabCleanup) tabCleanup();
  };
}
