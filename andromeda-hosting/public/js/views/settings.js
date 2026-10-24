import { api } from '../api.js';
import { html, $, icon, toast, fmtAgo } from '../ui.js';
import { setPanelName } from '../app.js';

export async function render(root) {
  const [s, sys] = await Promise.all([api.get('/api/settings'), api.get('/api/system')]);
  const d = s.ddns;
  root.innerHTML = html`
    <div class="page-head"><div><h1>Panel settings</h1><p class="muted">Applies to the whole panel.</p></div></div>
    <form id="ps" class="panel">
      <h3>General</h3>
      <div class="form-grid">
        <label class="field"><span>Panel name</span><input name="panelName" value="${s.panelName}" maxlength="40"></label>
        <label class="field"><span>Public address players connect to</span>
          <div class="input-row"><input name="publicAddress" value="${s.publicAddress}" placeholder="e.g. play.example.com"><button type="button" class="btn" id="detect">${icon('globe')}Detect</button></div>
          <small class="hint">Your public IP, a dynamic DNS name (DuckDNS, No-IP) or a Tailscale IP. Shown as the "Connect" address on each server.</small></label>
      </div>
      <h3>CurseForge</h3>
      <div class="form-grid">
        <label class="field span-2"><span>API key ${s.curseforgeKeySet ? html`<span class="pill pill-ok">set</span>` : html`<span class="pill pill-warn">not set</span>`}</span>
          <input name="curseforgeApiKey" type="password" autocomplete="off" placeholder="${s.curseforgeKeySet ? '•••••••• (leave blank to keep)' : 'Paste your key'}">
          <small class="hint">Free from <a href="https://console.curseforge.com/" target="_blank" rel="noopener">console.curseforge.com</a> → sign in → API Keys. Needed to browse/install modpacks and ARK mods.</small></label>
      </div>
      <div class="form-actions"><button class="btn btn-primary">Save settings</button>${s.curseforgeKeySet ? html`<button type="button" class="btn btn-ghost" id="clear-key">Remove API key</button>` : ''}</div>
    </form>
    <form id="dd" class="panel">
      <h3>Domain &amp; dynamic DNS</h3>
      <p class="muted small">Keeps your game hostnames (for example <code>play.example.com</code>) pointed at this PC's public IP, checking every 5 minutes.
        Needs the domain's DNS on Cloudflare. The panel itself is reached through a Cloudflare Tunnel; see <code>docs/domain-setup.md</code>.</p>
      <label class="switch field-switch"><input type="checkbox" name="enabled" ${d.enabled ? 'checked' : ''}><span></span>Keep DNS records updated</label>
      <div class="form-grid">
        <label class="field span-2"><span>Hostnames for game servers (comma-separated)</span><input name="hostnames" value="${d.hostnames.join(', ')}" placeholder="play.example.com">
          <small class="hint">Created as "DNS only" A records. Don't list the panel's hostname here; the tunnel handles that one.</small></label>
        <label class="field span-2"><span>Cloudflare API token ${d.tokenSet ? html`<span class="pill pill-ok">set</span>` : html`<span class="pill pill-warn">not set</span>`}</span>
          <input name="token" type="password" autocomplete="off" placeholder="${d.tokenSet ? '•••••••• (leave blank to keep)' : 'Paste token'}">
          <small class="hint">Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit zone DNS" template → Zone: example.com.</small></label>
      </div>
      ${d.lastCheck
        ? html`<div class="callout ${d.error ? 'callout-bad' : 'callout-ok'}">${icon(d.error ? 'alert' : 'check')}<div>
            ${d.error ? html`<strong>Problem:</strong> ${d.error}<br>` : ''}Public IP <code>${d.lastIp || '?'}</code> · checked ${fmtAgo(d.lastCheck)}${d.lastChange ? html` · last changed ${fmtAgo(d.lastChange)}` : ''}
            ${d.records.length ? html`<ul>${d.records.map((r) => html`<li><code>${r.hostname}</code>: ${r.result}${r.error ? ' (' + r.error + ')' : ''}</li>`)}</ul>` : ''}</div></div>`
        : ''}
      <div class="form-actions"><button class="btn btn-primary">Save</button><button type="button" class="btn" id="dd-run">${icon('refresh')}Update now</button>
        <button type="button" class="btn btn-ghost" id="dd-use">Use first hostname as public address</button></div>
    </form>
    <div id="upd" class="panel"><h3>Updates</h3><div id="upd-body"><div class="loading">Checking…</div></div></div>
    <form id="dc" class="panel"><h3>Discord</h3><div id="dc-body"><div class="loading">Checking Discord…</div></div></form>
    <div class="panel">
      <h3>This PC</h3>
      <dl class="kv">
        <div><dt>Host</dt><dd>${sys.hostname} (${sys.platform})</dd></div>
        <div><dt>CPU</dt><dd>${sys.cpuModel} · ${sys.cores} threads</dd></div>
        <div><dt>LAN addresses</dt><dd>${sys.lanAddresses.join(', ') || '—'}</dd></div>
        <div><dt>Panel port</dt><dd>${sys.panelPort}</dd></div>
        <div><dt>Panel data</dt><dd class="mono">${s.dataDir} <span class="muted">(accounts, servers, settings — copy this folder to move the panel)</span></dd></div>
        <div><dt>Server files</dt><dd class="mono">${s.serversDir}</dd></div>
        <div><dt>Backups</dt><dd class="mono">${s.backupsDir}</dd></div>
        <div><dt>Java runtimes</dt><dd>${sys.java.length ? sys.java.map((j) => 'Java ' + j).join(', ') : 'none yet (downloaded automatically)'}</dd></div>
        <div><dt>Node.js</dt><dd>${sys.node}</dd></div>
      </dl>
      <p class="muted small">Folders and the panel port are set in <code>config.json</code> next to the panel (restart the panel after editing).</p>
    </div>`.s;
  const f = $('#ps');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    try {
      await api.put('/api/settings', d);
      setPanelName(d.panelName || 'Andromeda Hosting');
      toast('Settings saved', 'ok');
      render(root);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  $('#detect').onclick = async () => {
    try {
      f.publicAddress.value = (await api.get('/api/system/public-ip')).ip;
      toast('Detected — press Save to keep it', 'ok');
    } catch (err) {
      toast(`Couldn't detect: ${err.message}`, 'error');
    }
  };
  const dd = $('#dd');
  dd.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api.put('/api/settings', { ddns: { enabled: dd.enabled.checked, hostnames: dd.hostnames.value, token: dd.token.value } });
      toast('Saved', 'ok');
      render(root);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  $('#dd-run').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await api.post('/api/settings/ddns/run');
      toast(r.error ? r.error : `DNS is pointing at ${r.lastIp}`, r.error ? 'error' : 'ok', 7000);
      render(root);
    } catch (err) {
      toast(err.message, 'error');
      e.target.disabled = false;
    }
  };
  $('#dd-use').onclick = async () => {
    const host = dd.hostnames.value.split(/[\s,]+/).filter(Boolean)[0];
    if (!host) return toast('Add a hostname first', 'warn');
    await api.put('/api/settings', { publicAddress: host }).then(() => { toast(`Public address set to ${host}`, 'ok'); render(root); }, (e) => toast(e.message, 'error'));
  };
  renderDiscord();
  renderUpdates();
  const clear = $('#clear-key');
  if (clear) clear.onclick = () => api.put('/api/settings', { clearCurseforgeKey: true }).then(() => render(root));
}

async function renderDiscord() {
  const box = $('#dc-body');
  if (!box) return;
  let o;
  try {
    o = await api.get('/api/settings/discord');
  } catch (err) {
    box.innerHTML = html`<div class="form-error">${err.message}</div>`.s;
    return;
  }
  const updatesId = o.updatesChannelId || o.suggestedUpdatesChannelId || '';
  const step = !o.tokenSet ? 1 : !o.bot ? 1 : !o.guilds.length ? 2 : 3;
  box.innerHTML = html`
    <p class="muted small">A bot posts server news (online, offline, crashes, updates, new modpack versions) to your <strong>Server Updates</strong> channel,
      and gives every game server its own text channel named after it (e.g. <code>#ark-se-server-1</code>), where player joins and backups go too.</p>
    ${o.error ? html`<div class="callout callout-bad">${icon('alert')}<div>${o.error}</div></div>` : ''}
    ${o.lastError && !o.error ? html`<div class="callout callout-warn">${icon('alert')}<div>Last message failed: ${o.lastError}</div></div>` : ''}

    <h4>1 · Bot token ${o.bot ? html`<span class="pill pill-ok">${icon('check')}${o.bot.name}</span>` : ''}</h4>
    ${step === 1
      ? html`<ol class="steps small">
          <li>Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">Discord Developer Portal</a> → <strong>New Application</strong> → name it e.g. <em>Andromeda Hosting</em>.</li>
          <li>Go to <strong>Bot</strong> → <strong>Reset Token</strong> → copy the token. (No privileged intents are needed.)</li>
          <li>Paste it here and save.</li></ol>`
      : ''}
    <label class="field"><span>Bot token</span><input name="token" type="password" autocomplete="off" placeholder="${o.tokenSet ? '•••••••• (leave blank to keep)' : 'Paste the bot token'}"></label>

    ${o.bot
      ? html`<h4>2 · Add the bot to your Discord server</h4>
        <p class="small"><a class="btn btn-sm" href="${o.bot.inviteUrl}" target="_blank" rel="noopener">${icon('external')}Invite ${o.bot.name}</a>
          <span class="muted">Pick your server. It asks for: View Channels, Send Messages, Embed Links, Manage Channels.</span></p>
        ${o.guilds.length
          ? html`<label class="field"><span>Discord server</span><select name="guildId">${o.guilds.map((g) => html`<option value="${g.id}" ${g.id === o.guildId ? 'selected' : ''}>${g.name}</option>`)}</select></label>`
          : html`<p class="muted small">The bot isn't in any server yet. Invite it, then press <em>Refresh</em>.</p>`}`
      : ''}

    ${o.channels.length
      ? html`<h4>3 · Channels</h4>
        <div class="form-grid">
          <label class="field"><span>Server Updates channel</span><select name="updatesChannelId"><option value="">— choose —</option>${o.channels.map((c) => html`<option value="${c.id}" ${c.id === updatesId ? 'selected' : ''}>#${c.name}</option>`)}</select></label>
          <label class="field"><span>Put per-server channels in category</span><select name="categoryId"><option value="">Same category as Server Updates</option>${o.categories.map((c) => html`<option value="${c.id}" ${c.id === o.categoryId ? 'selected' : ''}>${c.name}</option>`)}</select></label>
        </div>
        <div class="toggles">
          <label class="switch"><input type="checkbox" name="enabled" ${o.enabled ? 'checked' : ''}><span></span><strong>Send notifications</strong></label>
          <label class="switch"><input type="checkbox" name="perServerChannels" ${o.perServerChannels ? 'checked' : ''}><span></span>Create a channel for each game server</label>
          <label class="switch"><input type="checkbox" name="playerEvents" ${o.playerEvents ? 'checked' : ''}><span></span>Post player joins / leaves (server channels)</label>
          <label class="switch"><input type="checkbox" name="backupEvents" ${o.backupEvents ? 'checked' : ''}><span></span>Post successful backups (server channels)</label>
          <label class="switch"><input type="checkbox" name="includePassword" ${o.includePassword ? 'checked' : ''}><span></span>Show join passwords (ARK / Call of Duty, as a spoiler) in "online" messages</label>
        </div>`
      : ''}
    <div class="form-actions">
      <button class="btn btn-primary">Save</button>
      <button type="button" class="btn" id="dc-refresh">${icon('refresh')}Refresh</button>
      ${o.channels.length ? html`<button type="button" class="btn" id="dc-test">Send test message</button><button type="button" class="btn btn-ghost" id="dc-sync">Create / rename server channels</button>` : ''}
      ${o.tokenSet ? html`<button type="button" class="btn btn-ghost btn-danger-text" id="dc-clear">Disconnect</button>` : ''}
    </div>`.s;

  const f = $('#dc');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = { token: f.token.value };
    for (const k of ['guildId', 'updatesChannelId', 'categoryId']) if (f.elements[k]) body[k] = f.elements[k].value;
    for (const k of ['enabled', 'perServerChannels', 'playerEvents', 'backupEvents', 'includePassword']) if (f.elements[k]) body[k] = f.elements[k].checked;
    if (o.guilds.length === 1 && !body.guildId) body.guildId = o.guilds[0].id;
    try {
      await api.put('/api/settings', { discord: body });
      toast(body.enabled ? 'Saved — server channels are being created' : 'Saved', 'ok');
      renderDiscord();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  $('#dc-refresh').onclick = () => renderDiscord();
  const t = $('#dc-test');
  if (t) t.onclick = () => api.post('/api/settings/discord/test').then(() => toast('Test message sent', 'ok'), (e) => toast(e.message, 'error'));
  const sy = $('#dc-sync');
  if (sy) sy.onclick = () => api.post('/api/settings/discord/sync').then((r) => toast(`${r.synced} server channel(s) ready`, 'ok'), (e) => toast(e.message, 'error'));
  const cl = $('#dc-clear');
  if (cl) cl.onclick = () => api.put('/api/settings', { discord: { clearToken: true } }).then(renderDiscord);
}

async function renderUpdates(fresh) {
  const box = $('#upd-body');
  if (!box) return;
  let u;
  try {
    u = fresh || (await api.get('/api/settings/updates'));
  } catch (err) {
    box.innerHTML = html`<div class="form-error">${err.message}</div>`.s;
    return;
  }
  if (!u.gitRepo) {
    box.innerHTML = html`<p class="muted small">This copy of Andromeda Hosting wasn't installed with Git, so it can't update itself.
      See <strong>Updating</strong> in README.md to switch to a Git copy (one time), then updates install from here.</p>`.s;
    return;
  }
  box.innerHTML = html`
    <p class="small">Version <strong>${u.version}</strong> · branch <code>${u.branch}</code> · ${u.commit}</p>
    ${u.error ? html`<div class="callout callout-bad">${icon('alert')}<div>${u.error}</div></div>` : ''}
    ${u.behind
      ? html`<div class="callout callout-ok">${icon('arrowUp')}<div><strong>${u.behind} update${u.behind === 1 ? '' : 's'} available:</strong>
          <ul>${u.changes.map((c) => html`<li class="small">${c.replace(/^\w+ /, '')}</li>`)}</ul></div></div>`
      : html`<p class="muted small">${u.lastCheck ? `Up to date (checked ${new Date(u.lastCheck).toLocaleTimeString()}).` : 'Checks GitHub every hour.'}</p>`}
    <label class="switch field-switch"><input type="checkbox" id="upd-auto" ${u.auto ? 'checked' : ''}><span></span>Install updates automatically
      <small class="hint">Only while nobody is playing. Running servers are saved, stopped and started again afterwards.</small></label>
    ${u.canRestart ? '' : html`<p class="muted small">Started without start.bat, so after an update you'll need to restart Andromeda Hosting yourself.</p>`}
    <div class="form-actions"><button type="button" class="btn" id="upd-check">${icon('refresh')}Check now</button>
      ${u.behind ? html`<button type="button" class="btn btn-primary" id="upd-apply">${icon('download')}Update now</button>` : ''}</div>`.s;
  $('#upd-check').onclick = async (e) => {
    e.target.disabled = true;
    try {
      renderUpdates(await api.post('/api/settings/updates/check'));
    } catch (err) {
      toast(err.message, 'error');
      e.target.disabled = false;
    }
  };
  $('#upd-auto').onchange = (e) => api.put('/api/settings/updates', { auto: e.target.checked }).then(() => toast('Saved', 'ok', 1500), (err) => toast(err.message, 'error'));
  const apply = $('#upd-apply');
  if (apply) apply.onclick = async () => {
    apply.disabled = true;
    apply.textContent = 'Installing…';
    try {
      const r = await api.post('/api/settings/updates/apply');
      toast(r.message, 'ok', 15000);
      if (r.restarted) {
        // Wait for the restarted panel, then load the new page.
        const start = Date.now();
        const poll = async () => {
          try {
            const s = await api.get('/api/auth/state');
            if (s.version !== u.version || Date.now() - start > 20000) return location.reload();
          } catch {}
          setTimeout(poll, 2000);
        };
        setTimeout(poll, 4000);
      } else renderUpdates();
    } catch (err) {
      toast(err.message, 'error', 10000);
      renderUpdates();
    }
  };
}
