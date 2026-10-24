import { api } from '../../api.js';
import { html, $, icon, toast, confirmBox, modal } from '../../ui.js';

function field(f, value) {
  const id = 'f-' + f.key.replace(/\W/g, '_');
  const hint = f.hint ? html`<small class="hint">${f.hint}</small>` : '';
  if (f.type === 'bool') {
    return html`<label class="switch field-switch"><input type="checkbox" name="${f.key}" ${value ? 'checked' : ''}><span></span>${f.label}${hint}</label>`;
  }
  if (f.type === 'checklist') {
    const picked = new Set(Array.isArray(value) ? value : []);
    return html`<div class="field span-2"><span>${f.label}</span>
      <div class="check-grid" data-checklist="${f.key}">${(f.options || []).map((o) => html`<label class="check"><input type="checkbox" value="${o.value}" ${picked.has(o.value) ? 'checked' : ''}> ${o.label}</label>`)}</div>
      <div class="btn-row"><button type="button" class="btn btn-sm btn-ghost" data-check-all="${f.key}">Select all</button><button type="button" class="btn btn-sm btn-ghost" data-check-none="${f.key}">Clear</button></div>${hint}</div>`;
  }
  if (f.type === 'textarea') {
    return html`<label class="field span-2" for="${id}"><span>${f.label}</span><textarea id="${id}" name="${f.key}" rows="4" class="mono" spellcheck="false">${value ?? ''}</textarea>${hint}</label>`;
  }
  if (f.type === 'select' || f.type === 'select-custom') {
    // Options are plain strings or { value, label } pairs.
    const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
    const v = value == null ? '' : String(value);
    if (v && !opts.some((o) => String(o.value) === v)) opts.push({ value: v, label: v });
    return html`<label class="field" for="${id}"><span>${f.label}</span>
      ${f.type === 'select-custom'
        ? html`<input id="${id}" name="${f.key}" list="${id}-list" value="${v}"><datalist id="${id}-list">${opts.map((o) => html`<option value="${o.value}">`)}</datalist>`
        : html`<select id="${id}" name="${f.key}">${f.key === 'panel.javaMajor' ? html`<option value="">Automatic</option>` : ''}${opts.map((o) => html`<option value="${o.value}" ${String(o.value) === v ? 'selected' : ''}>${o.label}</option>`)}</select>`}
      ${hint}</label>`;
  }
  return html`<label class="field" for="${id}"><span>${f.label}</span>
    <input id="${id}" name="${f.key}" type="${f.type === 'number' ? 'number' : 'text'}" value="${value ?? ''}" ${f.step ? html`step="${f.step}"` : f.type === 'number' ? 'step="any"' : ''} ${f.min != null ? html`min="${f.min}"` : ''} autocomplete="off">${hint}</label>`;
}

export async function render(root, { server, can, refresh, navigate, refreshServers }) {
  const { schema, values } = await api.get(`/api/servers/${server.id}/settings`);
  const admin = server.perms.includes('admin');
  const cores = server.cores || 0;
  const tuning = server.tuning || {};
  const presets = [['', 'All CPUs (default)']];
  if (cores >= 32) presets.push([`16-${cores - 1}`, `CPUs 16–${cores - 1} (2nd CCD on a 9950X3D: keeps the V-Cache CCD free for your game)`]);
  else if (cores >= 8) presets.push([`${cores / 2}-${cores - 1}`, `Second half: CPUs ${cores / 2}–${cores - 1}`]);

  root.innerHTML = html`
    <form id="general" class="panel">
      <h3>General</h3>
      <div class="form-grid">
        <label class="field"><span>Server name</span><input name="name" value="${server.name}" maxlength="48"></label>
        <label class="field"><span>Backups to keep</span><input name="backupKeep" type="number" min="1" max="200" value="${server.backupKeep || 10}"></label>
        <label class="switch field-switch span-2"><input type="checkbox" name="backupBeforeUpdate" ${server.backupBeforeUpdate ? 'checked' : ''}><span></span>Back up automatically before updates</label>
      </div>
      <details class="adv" ${tuning.affinity || (tuning.priority && tuning.priority !== 'normal') ? 'open' : ''}><summary>CPU affinity &amp; priority</summary>
        <p class="muted small">Pin this server to specific CPU threads so it doesn't compete with the game you're playing. Applied each time the server starts.</p>
        <div class="form-grid">
          <label class="field"><span>Preset</span><select id="aff-preset">${presets.map(([v, l]) => html`<option value="${v}" ${v === (tuning.affinity || '') ? 'selected' : ''}>${l}</option>`)}<option value="__custom" ${tuning.affinity && !presets.some((p) => p[0] === tuning.affinity) ? 'selected' : ''}>Custom…</option></select></label>
          <label class="field"><span>CPU list (${cores} threads: 0–${cores - 1})</span><input name="affinity" value="${tuning.affinity || ''}" placeholder="e.g. 16-31 or 8,9,10-15"></label>
          <label class="field"><span>Process priority</span><select name="priority">${[['below_normal', 'Below normal (recommended while gaming)'], ['normal', 'Normal'], ['above_normal', 'Above normal'], ['idle', 'Idle'], ['high', 'High']].map(([v, l]) => html`<option value="${v}" ${v === (tuning.priority || 'normal') ? 'selected' : ''}>${l}</option>`)}</select></label>
        </div>
      </details>
      <div class="form-actions"><button class="btn btn-primary">Save</button></div>
    </form>

    <form id="game" class="panel">
      <h3>Game settings</h3>
      ${schema.note ? html`<p class="muted small">${schema.note}</p>` : ''}
      ${schema.sections.map((sec) => {
        const fields = sec.fields.filter((f) => admin || !f.admin); // admin-only fields are enforced on the server too
        return fields.length ? html`<fieldset><legend>${sec.title}</legend><div class="form-grid">${fields.map((f) => field(f, values[f.key]))}</div></fieldset>` : '';
      })}
      <div class="form-actions sticky"><button class="btn btn-primary">Save game settings</button><span class="muted small">Changes apply on the next (re)start.</span></div>
    </form>

    ${admin
      ? html`<div class="panel danger-zone">
          <h3>Danger zone</h3>
          <div class="danger-row"><div><strong>Reinstall / repair</strong><p class="muted small">${server.ark ? 'Re-runs SteamCMD with "validate" to repair game files.' : 'Re-downloads the server and loader. Worlds and settings are kept.'}</p></div><button class="btn" id="reinstall">${icon('refresh')}Reinstall</button></div>
          <div class="danger-row"><div><strong>Delete server</strong><p class="muted small">Stops the server and removes it from the panel.</p></div><button class="btn btn-danger" id="delete">${icon('trash')}Delete</button></div>
        </div>`
      : ''}`.s;

  const g = $('#general');
  $('#aff-preset').onchange = (e) => {
    if (e.target.value !== '__custom') g.affinity.value = e.target.value;
    else g.affinity.focus();
  };
  g.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api.patch(`/api/servers/${server.id}`, {
        name: g.name.value,
        backupKeep: Number(g.backupKeep.value),
        backupBeforeUpdate: g.backupBeforeUpdate.checked,
        tuning: { affinity: g.affinity.value, priority: g.priority.value },
      });
      toast('Saved', 'ok');
      refreshServers();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const gf = $('#game');
  gf.addEventListener('click', (e) => {
    const all = e.target.closest('[data-check-all]');
    const none = e.target.closest('[data-check-none]');
    const key = (all || none)?.dataset.checkAll || (all || none)?.dataset.checkNone;
    if (key) gf.querySelectorAll(`[data-checklist="${key}"] input`).forEach((c) => (c.checked = !!all));
  });
  gf.onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    for (const sec of schema.sections) {
      for (const f of sec.fields) {
        if (f.type === 'checklist') {
          out[f.key] = [...gf.querySelectorAll(`[data-checklist="${f.key}"] input:checked`)].map((c) => c.value);
          continue;
        }
        const el = gf.elements[f.key];
        if (!el) continue;
        out[f.key] = f.type === 'bool' ? el.checked : f.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      }
    }
    try {
      const r = await api.put(`/api/servers/${server.id}/settings`, { values: out });
      toast(r.restartRequired ? 'Saved — restart the server to apply' : 'Saved', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (admin) {
    $('#reinstall').onclick = async () => {
      if (!(await confirmBox('Reinstall server?', 'The server must be stopped. World saves and settings are kept.', { confirm: 'Reinstall' }))) return;
      try {
        await api.post(`/api/servers/${server.id}/reinstall`);
        toast('Reinstall started', 'ok');
        navigate(`/server/${server.id}/overview`);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    $('#delete').onclick = async () => {
      const r = await modal({
        title: `Delete ${server.name}?`,
        body: html`<p>This stops the server and removes it from the panel.</p>
          <label class="check"><input type="checkbox" id="keep-files"> Keep the files on disk (worlds, configs)</label>
          <label class="field"><span>Type the server name to confirm</span><input id="confirm-name" autocomplete="off"></label>`,
        actions: [
          { label: 'Cancel', value: null },
          {
            label: 'Delete forever',
            kind: 'btn-danger',
            onClick: (w) => {
              if (w.querySelector('#confirm-name').value.trim() !== server.name) throw new Error('Name does not match');
              return { keep: w.querySelector('#keep-files').checked };
            },
          },
        ],
      });
      if (!r) return;
      try {
        await api.del(`/api/servers/${server.id}${r.keep ? '?keepFiles=1' : ''}`);
        toast('Server deleted', 'ok');
        await refreshServers();
        navigate('/');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
}
