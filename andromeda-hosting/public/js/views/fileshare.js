import { api } from '../api.js';
import { html, $, on, icon, toast, fmtAgo, fmtBytes, copyText } from '../ui.js';

export async function render(root) {
  const draw = async () => {
    const s = await api.get('/api/share/admin');
    const panelLink = `${location.origin}/share`;
    const portLink = s.port ? `${location.protocol}//${location.hostname}:${s.port}/share` : null;
    root.innerHTML = html`
      <div class="page-head"><div><h1>File share</h1><p class="muted">Share a folder on this PC with your friends. They download from a simple page; only you can upload.</p></div>
        ${s.enabled ? html`<a class="btn btn-primary" href="/share" target="_blank" rel="noopener">${icon('external')}Open file share</a>` : ''}</div>

      <form id="fs" class="panel">
        <h3>Settings</h3>
        <label class="switch field-switch"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}><span></span><strong>File sharing on</strong></label>
        <div class="form-grid">
          <label class="field span-2"><span>Folder to share</span><input name="folder" value="${s.folder}" placeholder="e.g. D:\\Share" autocomplete="off">
            <small class="hint">Everything inside this folder (and its subfolders) can be downloaded by allowed IPs.</small></label>
          <label class="field"><span>Page title</span><input name="title" value="${s.title}" maxlength="60"></label>
          <label class="field"><span>Own port for the file share (optional)</span><input name="port" type="number" min="1024" max="65535" value="${s.port || ''}" placeholder="e.g. 8090">
            <small class="hint">Serves only the file share, never the panel. Port-forward this (TCP) or point a tunnel hostname like files.example.com at it.</small></label>
          <label class="switch field-switch span-2"><input type="checkbox" name="lanAccess" ${s.lanAccess ? 'checked' : ''}><span></span>Also let devices on my home network upload and download
            <small class="hint">Off = uploading only works from this PC.</small></label>
        </div>
        <div class="form-actions"><button class="btn btn-primary">Save</button></div>
      </form>

      ${s.enabled && s.folder
        ? html`<div class="panel"><h3>Links to send your friends</h3>
            ${portLink ? html`<div class="address"><code>${portLink}</code><button type="button" class="btn btn-sm" data-copy="${portLink}">${icon('copy')}Copy</button></div>
              <p class="muted small">Replace <code>${location.hostname}</code> with your public address (e.g. play.example.com) and forward TCP port ${s.port}, or use a tunnel hostname.</p>` : ''}
            <div class="address"><code>${panelLink}</code><button type="button" class="btn btn-sm" data-copy="${panelLink}">${icon('copy')}Copy</button></div>
            <p class="muted small">Same page on the panel's address. If the panel is behind Cloudflare Access, friends must pass Access first — the separate port above avoids that.</p></div>`
        : ''}

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h3>Allowed IPs <span class="count">${s.trusted.length}</span></h3></div>
          <p class="muted small">Only these addresses can download. Ask a friend to open the share page — it shows them their IP — or add it from "Recently blocked".</p>
          <form id="add-ip" class="input-row"><input name="rule" placeholder="IP, e.g. 203.0.113.7" autocomplete="off"><input name="label" placeholder="Name (optional)" autocomplete="off"><button class="btn">${icon('plus')}Allow</button></form>
          ${s.trusted.length
            ? html`<table class="table compact"><tbody>${s.trusted.map((t) => html`<tr><td class="ip-cell">${t.rule}</td><td>${t.label || html`<span class="muted">—</span>`}</td><td class="muted small">${fmtAgo(t.addedAt)}</td>
                <td class="right"><button class="icon-btn" data-remove="${t.rule}" title="Remove">${icon('trash')}</button></td></tr>`)}</tbody></table>`
            : html`<p class="muted">No one is allowed yet.</p>`}
          <p class="muted small">Your connection right now: <code>${s.you.ip}</code> (${s.you.canUpload ? 'this PC — can upload' : 'remote'}). Home IPs can change; if a friend suddenly can't get in, check "Recently blocked".</p>
        </div>
        <div class="panel">
          <h3>Recently blocked</h3>
          ${s.denied.length
            ? html`<table class="table compact"><tbody>${s.denied.map((d) => html`<tr><td class="ip-cell">${d.ip}</td><td class="muted small">${fmtAgo(d.at)}${d.count > 1 ? ` · ${d.count}×` : ''}</td>
                <td class="right"><button class="btn btn-sm" data-allow="${d.ip}">Allow</button></td></tr>`)}</tbody></table>`
            : html`<p class="muted">Nobody has been turned away.</p>`}
        </div>
      </div>

      <div class="panel">
        <h3>Recent downloads</h3>
        ${s.downloads.length
          ? html`<table class="table compact"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Size</th></tr></thead><tbody>
              ${s.downloads.map((d) => html`<tr><td class="muted small">${fmtAgo(d.at)}</td><td>${d.who} <span class="muted small ip-cell">${d.ip}</span></td><td class="mono small">${d.path}${d.folder ? ' (zip)' : ''}</td><td>${d.size ? fmtBytes(d.size) : ''}</td></tr>`)}
            </tbody></table>`
          : html`<p class="muted">No downloads since the panel started.</p>`}
      </div>`.s;

    const f = $('#fs');
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api.put('/api/share/admin', { enabled: f.enabled.checked, folder: f.folder.value, title: f.title.value, port: f.port.value, lanAccess: f.lanAccess.checked });
        toast('Saved', 'ok');
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    $('#add-ip').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/share/admin/trusted', { rule: e.target.rule.value, label: e.target.label.value });
        toast('Allowed', 'ok');
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  };
  on(root, 'click', '[data-copy]', (_e, el) => copyText(el.dataset.copy));
  on(root, 'click', '[data-remove]', (_e, el) => api.del(`/api/share/admin/trusted?rule=${encodeURIComponent(el.dataset.remove)}`).then(draw, (e) => toast(e.message, 'error')));
  on(root, 'click', '[data-allow]', async (_e, el) => {
    const label = prompt(`Name for ${el.dataset.allow} (optional)`, '') ?? null;
    if (label === null) return;
    api.post('/api/share/admin/trusted', { rule: el.dataset.allow, label }).then(() => (toast('Allowed', 'ok'), draw()), (e) => toast(e.message, 'error'));
  });
  await draw();
  const t = setInterval(() => document.visibilityState === 'visible' && !root.querySelector('input:focus') && draw().catch(() => {}), 15000);
  return () => clearInterval(t);
}
