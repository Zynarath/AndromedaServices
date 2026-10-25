import { api } from '../../api.js';
import { html, $, on, icon, toast } from '../../ui.js';
import { field } from './settings.js';

// Mod configuration: ARK mods' INI sections and Minecraft mods' config files, as forms.
export async function render(root, { server }) {
  const base = `/api/servers/${server.id}/mod-config`;
  let list;
  let current = null; // { file, data }
  let query = '';
  let rawMode = false;

  const ark = !!server.ark;

  const drawList = () => {
    const q = query.toLowerCase();
    const mods = list.mods.filter((m) => !q || m.name.toLowerCase().includes(q) || m.files.some((f) => f.file.toLowerCase().includes(q)));
    $('#mc-list').innerHTML = html`
      ${mods.length
        ? mods.map(
            (m) => html`<div class="mc-mod"><div class="mc-mod-name">${m.name}${m.files.length > 1 ? html` <span class="count">${m.files.length}</span>` : ''}</div>
              ${m.files.map(
                (f) => html`<button type="button" class="mc-file ${current && current.file === f.file ? 'active' : ''}" data-file="${f.file}">
                  <span>${ark ? f.where : f.file.split('/').slice(1).join('/')}</span>
                  ${f.client ? html`<span class="pill pill-tag" title="Client-side settings: they only matter on players' PCs">client</span>` : ''}
                  ${f.where === 'world' ? html`<span class="pill pill-tag" title="Per-world server config">world</span>` : ''}</button>`
              )}</div>`
          )
        : html`<p class="muted small">${list.mods.length ? 'No mod matches.' : ark ? 'No mod sections yet.' : 'No mod config files yet. Start the server once so the mods create them.'}</p>`}`.s;
  };

  const drawForm = () => {
    const box = $('#mc-form');
    if (!current) {
      box.innerHTML = html`<p class="muted">Pick a mod on the left to see its settings.</p>`.s;
      return;
    }
    const d = current.data;
    const fields = d.fields || [];
    const sections = new Map();
    for (const f of fields) {
      const sec = f.section || '';
      if (!sections.has(sec)) sections.set(sec, []);
      sections.get(sec).push(f);
    }
    const showRaw = rawMode || !d.fields;
    box.innerHTML = html`
      <form id="mc-edit">
        <div class="mc-form-head">
          <div><h3>${ark ? current.file.slice(current.file.indexOf(':') + 1) : current.file.split('/').pop()}</h3>
            <p class="muted small mono">${ark ? d.where : current.file}</p></div>
          ${!ark && list.canRaw && d.fields ? html`<button type="button" class="btn btn-sm btn-ghost" id="mc-raw">${showRaw ? 'Show as form' : 'Edit raw file'}</button>` : ''}
        </div>
        ${ark && list.running ? html`<p class="form-error">Stop the server to change mod settings — ARK rewrites its INI files when it shuts down.</p>` : ''}
        ${showRaw
          ? d.raw === undefined
            ? html`<p class="muted">This file can't be shown as a form, and editing it as text needs the Files permission.</p>`
            : html`${d.fields ? '' : html`<p class="muted small">This ${d.format === 'raw' ? 'kind of file' : 'file'} can't be shown as a form, so here it is as text.</p>`}
              <textarea name="__raw" class="mono mc-raw" rows="24" spellcheck="false">${d.raw}</textarea>`
          : html`${fields.length ? '' : html`<p class="muted">${ark ? 'This section has no settings yet. Add the ones from the mod\'s page below.' : 'No editable values found in this file.'}</p>`}
              ${[...sections].map(([sec, fs]) => html`<fieldset>${sec ? html`<legend>${sec}</legend>` : ''}<div class="form-grid">${fs.map((f) => field({ ...f, key: 'v:' + f.id, type: f.type === 'list' ? 'text' : f.type, hint: [f.hint, f.type === 'list' ? 'List: keep the [ ] brackets' : ''].filter(Boolean).join(' · ') || undefined }, f.value))}</div></fieldset>`)}
              ${d.canAdd
                ? html`<fieldset><legend>Add setting</legend><div class="form-grid">
                    <label class="field"><span>Setting name</span><input name="__newKey" placeholder="e.g. MaxWildLevel" autocomplete="off"></label>
                    <label class="field"><span>Value</span><input name="__newValue" placeholder="e.g. 300" autocomplete="off"></label></div>
                    <p class="muted small">Copy names and values from the mod's page. Repeat a setting on several lines by editing it after adding.</p></fieldset>`
                : ''}`}
        <div class="form-actions sticky"><button class="btn btn-primary" ${ark && list.running ? 'disabled' : ''}>Save</button><span class="muted small">Changes apply on the next (re)start.</span></div>
      </form>`.s;
    $('#mc-raw')?.addEventListener('click', () => {
      rawMode = !rawMode;
      drawForm();
    });
    $('#mc-edit').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const body = { file: current.file };
      if (form.elements.__raw) body.raw = form.elements.__raw.value;
      else {
        body.values = {};
        for (const f of fields) {
          const el = form.elements['v:' + f.id];
          if (!el) continue;
          body.values[f.id] = f.type === 'bool' ? el.checked : el.value;
        }
        const k = form.elements.__newKey?.value.trim();
        if (k) body.values[k] = form.elements.__newValue.value;
      }
      try {
        const r = await api.put(`${base}/file`, body);
        toast(r.changed ? (r.restartRequired ? 'Saved — restart the server to apply' : 'Saved') : 'Nothing changed', 'ok');
        await open(current.file);
        if (ark) await load();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  };

  const open = async (file) => {
    current = { file, data: await api.get(`${base}/file?file=${encodeURIComponent(file)}`) };
    drawList();
    drawForm();
  };

  const load = async () => {
    list = await api.get(base);
    drawList();
  };

  root.innerHTML = html`
    <div class="panel">
      <div class="panel-head"><h3>Mod configuration</h3><button class="btn btn-sm" id="mc-rescan">${icon('refresh')}Rescan</button></div>
      <p class="muted small" id="mc-note"></p>
      ${ark
        ? html`<form class="input-row" id="mc-new"><select name="file"><option value="gus">GameUserSettings.ini</option><option value="game">Game.ini</option></select><input name="section" placeholder="New mod section, e.g. AnnunakiGenesis" autocomplete="off"><button class="btn">${icon('plus')}Add</button></form>`
        : ''}
      <div class="mc-layout">
        <div class="mc-side"><input type="search" id="mc-search" placeholder="Find a mod…" autocomplete="off"><div id="mc-list"></div></div>
        <div class="mc-main" id="mc-form"></div>
      </div>
    </div>`.s;

  await load();
  $('#mc-note').textContent = list.note + (ark && list.loadedMods?.length ? ` Mods in use: ${list.loadedMods.join(', ')}.` : '');
  drawForm();
  $('#mc-search').oninput = (e) => {
    query = e.target.value;
    drawList();
  };
  $('#mc-rescan').onclick = async () => {
    await load();
    toast('Rescanned', 'ok');
  };
  on(root, 'click', '[data-file]', (_e, el) => {
    rawMode = false;
    open(el.dataset.file).catch((err) => toast(err.message, 'error'));
  });
  $('#mc-new')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.section.value.trim();
    if (!name) return;
    const file = `${e.target.file.value}:${name}`;
    try {
      await api.put(`${base}/file`, { file, values: {} });
      e.target.section.value = '';
      await load();
      await open(file);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
