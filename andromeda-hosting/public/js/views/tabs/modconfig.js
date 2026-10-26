import { api } from '../../api.js';
import { html, $, $$, on, icon, toast } from '../../ui.js';
import { field } from './settings.js';

// Mod configuration: each mod (with its Workshop/CurseForge picture and name) and its settings —
// ARK mod INI sections pre-filled with the defaults from the mod's page, Minecraft mod config files.
export async function render(root, { server }) {
  const base = `/api/servers/${server.id}/mod-config`;
  const ark = !!server.ark;
  let list;
  let current = null; // { file, data }
  let modQuery = '';
  let rawMode = false;

  const thumb = (m, cls = 'mc-thumb') =>
    m.image ? html`<img class="${cls}" src="${m.image}" alt="" loading="lazy">` : html`<span class="${cls} mc-thumb-none">${icon('box')}</span>`;

  const drawList = () => {
    const q = modQuery.toLowerCase();
    const mods = list.mods.filter((m) => !q || m.name.toLowerCase().includes(q) || String(m.modId || '').includes(q) || m.files.some((f) => f.file.toLowerCase().includes(q)));
    $('#mc-list').innerHTML = html`${mods.length
      ? mods.map(
          (m) => html`<div class="mc-card">
            <div class="mc-card-head">${thumb(m)}<div class="mc-card-title"><strong>${m.name}</strong>
              <small class="muted">${m.modId ? html`<span class="mono">${m.modId}</span>` : ''}${m.url ? html` · <a href="${m.url}" target="_blank" rel="noopener">mod page</a>` : ''}</small></div></div>
            ${m.files.length
              ? m.files.map(
                  (f) => html`<button type="button" class="mc-file ${current && current.file === f.file ? 'active' : ''}" data-file="${f.file}">
                    <span>${ark ? f.where : f.file.split('/').slice(1).join('/')}</span>
                    ${f.documented ? html`<span class="pill pill-ok" title="Settings documented on the mod page">${f.documented} documented</span>` : ''}
                    ${f.client ? html`<span class="pill pill-tag" title="Client-side settings: they only matter on players' PCs">client</span>` : ''}
                    ${f.where === 'world' ? html`<span class="pill pill-tag">world</span>` : ''}</button>`
                )
              : html`<p class="muted small mc-none">${ark ? 'No settings found on its mod page. If it has some, add its section above.' : 'No config files.'}</p>`}
          </div>`
        )
      : html`<p class="muted small">${list.mods.length ? 'No mod matches.' : ark ? 'No mods in the mod list yet (Mods tab).' : 'No mod config files yet. Start the server once so the mods create them.'}</p>`}`.s;
  };

  // Default value shown as text, for comparing with what's in the input.
  const asText = (f, v) => (f.type === 'bool' ? (v === true || /^true$/i.test(String(v)) ? 'true' : 'false') : String(v ?? '').trim());

  const drawForm = () => {
    const box = $('#mc-form');
    if (!current) {
      box.innerHTML = html`<div class="mc-empty">${icon('edit')}<p>Pick a mod on the left to see its settings.</p></div>`.s;
      return;
    }
    const d = current.data;
    const mod = list.mods.find((m) => m.files.some((f) => f.file === current.file)) || {};
    const fields = d.fields || [];
    const sections = new Map();
    for (const f of fields) {
      const sec = f.section || '';
      if (!sections.has(sec)) sections.set(sec, []);
      sections.get(sec).push(f);
    }
    const showRaw = rawMode || !d.fields;
    const changed = fields.filter((f) => f.def !== undefined && asText(f, f.value) !== asText(f, f.def)).length;
    box.innerHTML = html`
      <form id="mc-edit" novalidate>
        <div class="mc-form-head">
          ${ark ? thumb(mod, 'mc-hero') : ''}
          <div class="mc-form-title"><h3>${ark ? mod.name || current.file.slice(current.file.indexOf(':') + 1) : current.file.split('/').pop()}</h3>
            <p class="muted small mono">${ark ? d.where : current.file}</p>
            ${fields.some((f) => f.def !== undefined) ? html`<p class="small">${changed} of ${fields.filter((f) => f.def !== undefined).length} settings changed from their defaults</p>` : ''}</div>
          <div class="btn-row">
            ${d.mod && d.mod.url ? html`<a class="btn btn-sm btn-ghost" href="${d.mod.url}" target="_blank" rel="noopener">Mod page</a>` : ''}
            ${!ark && list.canRaw && d.fields ? html`<button type="button" class="btn btn-sm btn-ghost" id="mc-raw">${showRaw ? 'Show as form' : 'Edit raw file'}</button>` : ''}
          </div>
        </div>
        ${ark && list.running ? html`<p class="form-error">Stop the server to change mod settings — ARK rewrites its INI files when it shuts down.</p>` : ''}
        ${ark && !d.documented && !showRaw ? html`<p class="muted small">The mod page doesn't document settings for this section, so only what's in your INI is shown. Add settings from the mod's instructions below.</p>` : ''}
        ${showRaw
          ? d.raw === undefined
            ? html`<p class="muted">This file can't be shown as a form, and editing it as text needs the Files permission.</p>`
            : html`${d.fields ? '' : html`<p class="muted small">This file can't be shown as a form, so here it is as text.</p>`}
              <textarea name="__raw" class="mono mc-raw" rows="24" spellcheck="false">${d.raw}</textarea>`
          : html`${fields.length > 8 ? html`<input type="search" id="mc-find" class="filter" placeholder="Find a setting…" autocomplete="off">` : ''}
              ${fields.length ? '' : html`<p class="muted">No settings yet. Add the ones from the mod's page below.</p>`}
              ${[...sections].map(
                ([sec, fs]) => html`<fieldset>${sec ? html`<legend>${sec}</legend>` : ''}<div class="form-grid">${fs.map((f) =>
                  field({ ...f, key: 'v:' + f.id, type: f.type === 'list' ? 'text' : f.type, def: undefined, hint: [f.hint, f.type === 'list' ? 'List: keep the [ ] brackets' : ''].filter(Boolean).join(' · ') || undefined }, f.value)
                )}</div></fieldset>`
              )}
              ${d.canAdd
                ? html`<fieldset><legend>Add a setting</legend><div class="form-grid">
                    <label class="field"><span>Setting name</span><input name="__newKey" placeholder="e.g. MaxWildLevel" autocomplete="off"></label>
                    <label class="field"><span>Value</span><input name="__newValue" placeholder="e.g. 300" autocomplete="off"></label></div></fieldset>`
                : ''}`}
        <div class="form-actions sticky"><button class="btn btn-primary" ${ark && list.running ? 'disabled' : ''}>Save</button>
          ${ark && fields.some((f) => f.def !== undefined) && !showRaw ? html`<button type="button" class="btn" id="mc-write-all" ${list.running ? 'disabled' : ''} title="Also write the settings that are still at their default into the INI">Save and write all defaults</button>` : ''}
          <span class="muted small">Changes apply on the next (re)start.</span></div>
      </form>`.s;

    // Default / changed markers and "reset" on every setting that has a known default.
    const form = $('#mc-edit');
    for (const f of fields) {
      if (f.def === undefined) continue;
      const el = form.elements['v:' + f.id];
      if (!el) continue;
      const wrap = el.closest('.field, .field-switch');
      const bar = document.createElement('div');
      bar.className = 'mc-def';
      wrap.appendChild(bar);
      const update = () => {
        const now = asText(f, f.type === 'bool' ? el.checked : el.value);
        const isDefault = now.toLowerCase() === asText(f, f.def).toLowerCase() || (now !== '' && Number(now) === Number(f.def));
        bar.innerHTML = isDefault
          ? html`<span class="pill pill-tag">default</span>`.s
          : html`<span class="pill pill-warn">changed</span> <button type="button" class="link-btn">reset to ${f.type === 'bool' ? (asText(f, f.def) === 'true' ? 'on' : 'off') : f.def}</button>`.s;
        const btn = bar.querySelector('button');
        if (btn)
          btn.onclick = () => {
            if (f.type === 'bool') el.checked = asText(f, f.def) === 'true';
            else el.value = f.def;
            update();
          };
      };
      el.addEventListener(f.type === 'bool' ? 'change' : 'input', update);
      update();
    }
    $('#mc-find')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      for (const fs of $$('fieldset', form)) {
        let any = false;
        for (const item of fs.querySelectorAll('.form-grid > *')) {
          const show = !q || item.textContent.toLowerCase().includes(q);
          item.hidden = !show;
          if (show) any = true;
        }
        fs.hidden = !any && !!q;
      }
    });
    $('#mc-raw')?.addEventListener('click', () => {
      rawMode = !rawMode;
      drawForm();
    });
    const submit = async (writeAll) => {
      const body = { file: current.file, writeAll };
      if (form.elements.__raw) body.raw = form.elements.__raw.value;
      else {
        body.values = {};
        for (const f of fields) {
          const el = form.elements['v:' + f.id];
          if (el) body.values[f.id] = f.type === 'bool' ? el.checked : el.value;
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
    form.onsubmit = (e) => {
      e.preventDefault();
      submit(false);
    };
    $('#mc-write-all')?.addEventListener('click', () => submit(true));
  };

  const open = async (file) => {
    current = { file, data: await api.get(`${base}/file?file=${encodeURIComponent(file)}`) };
    drawList();
    drawForm();
  };

  const load = async (refresh = false) => {
    list = await api.get(base + (refresh ? '?refresh=1' : ''));
    drawList();
  };

  root.innerHTML = html`
    <div class="panel">
      <div class="panel-head"><h3>Mod configuration</h3>
        <div class="btn-row">${ark ? html`<button class="btn btn-sm" id="mc-refresh" title="Fetch names, pictures and settings from the mod pages again">${icon('refresh')}Refresh mod info</button>` : html`<button class="btn btn-sm" id="mc-rescan">${icon('refresh')}Rescan</button>`}</div></div>
      <p class="muted small" id="mc-note"></p>
      ${ark
        ? html`<details class="adv"><summary>A mod's settings aren't listed?</summary>
            <p class="muted small">Some mods explain their settings on another site instead of their mod page. Create the section they tell you to use, then add their settings to it.</p>
            <form class="input-row" id="mc-new"><select name="file"><option value="gus">GameUserSettings.ini</option><option value="game">Game.ini</option></select><input name="section" placeholder="Section name, e.g. AnnunakiGenesis" autocomplete="off"><button class="btn">${icon('plus')}Add section</button></form></details>`
        : ''}
      <div class="mc-layout">
        <div class="mc-side"><input type="search" id="mc-search" placeholder="Find a mod…" autocomplete="off"><div id="mc-list"><p class="muted small">Looking up your mods…</p></div></div>
        <div class="mc-main" id="mc-form"></div>
      </div>
    </div>`.s;

  drawForm();
  await load();
  $('#mc-note').textContent = list.note;
  $('#mc-search').oninput = (e) => {
    modQuery = e.target.value;
    drawList();
  };
  $('#mc-rescan')?.addEventListener('click', async () => {
    await load();
    toast('Rescanned', 'ok');
  });
  $('#mc-refresh')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await load(true);
      if (current) await open(current.file);
      toast('Mod info refreshed', 'ok');
    } finally {
      e.target.disabled = false;
    }
  });
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
  // Open the first documented mod straight away.
  const first = list.mods.find((m) => m.files.some((f) => f.documented)) || list.mods.find((m) => m.files.length);
  if (first) await open(first.files[0].file).catch(() => {});
}
