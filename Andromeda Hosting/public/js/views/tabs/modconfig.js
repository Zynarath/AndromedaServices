import { api } from '../../api.js';
import { html, $, $$, on, icon, toast, webUrl } from '../../ui.js';
import { row, bindRows, dirtyText, sectionIcon } from './controls.js';

// Mod configuration: pick a mod on the left (with its Workshop / CurseForge / uMod picture, or the
// logo from its jar) and change its settings on the right — ARK mod INI sections pre-filled with
// the defaults from the mod's page, Minecraft mod config files, Rust uMod plugin settings.
// Settings have readable names, the explanation their author wrote, sliders for amounts and a
// marker for what was changed from the default. Big files open on the settings people change
// most; "All" and the search box reach the rest.
export async function render(root, { server }) {
  const base = `/api/servers/${server.id}/mod-config`;
  const ark = !!server.ark;
  const plugins = !!server.rust;
  let list;
  let current = null; // { file, data }
  let modQuery = '';
  let rawMode = false;
  let showAll = false;
  let rows = null;

  const thumb = (m, cls = 'mod-pic') =>
    m.image ? html`<img class="${cls}" src="${m.image}" alt="" loading="lazy">` : html`<span class="${cls} mod-pic-none">${icon('box')}</span>`;
  const modOf = (file) => list.mods.find((m) => m.files.some((f) => f.file === file)) || {};
  const fileName = (f) => f.label || (ark ? f.where : f.file.split('/').pop());
  // The file a mod opens on: the first one that changes how the server plays.
  const firstFile = (m) => (m.files.find((f) => f.documented) || m.files.find((f) => !f.client) || m.files[0] || {}).file;
  const modSub = (m) => {
    const documented = m.files.reduce((n, f) => n + (f.documented || 0), 0);
    if (ark) return documented ? `${documented} documented setting${documented === 1 ? '' : 's'}` : `${m.files.length} section${m.files.length === 1 ? '' : 's'} in your INI`;
    if (plugins) return m.files.map((f) => f.label).join(' · ');
    return `${m.files.length} config file${m.files.length === 1 ? '' : 's'}`;
  };
  const statePill = (m) =>
    plugins && !m.installed ? html`<span class="pill pill-tag" title="The plugin was removed; its settings are kept">not installed</span>` : plugins && !m.enabled ? html`<span class="pill pill-tag">off</span>` : '';

  const drawList = () => {
    const q = modQuery.toLowerCase();
    const mods = list.mods.filter((m) => !q || m.name.toLowerCase().includes(q) || String(m.modId || '').includes(q) || m.files.some((f) => f.file.toLowerCase().includes(q)));
    const open = current ? modOf(current.file).id : null;
    $('#mc-list').innerHTML = html`${mods.length
      ? mods.map(
          (m) => html`<button type="button" class="mod-item ${m.id === open ? 'active' : ''}" data-mod="${m.id}" ${m.files.length ? '' : 'disabled'}>
            ${thumb(m)}<span class="mod-item-text"><strong>${m.name}</strong><small>${m.files.length ? modSub(m) : 'Nothing to configure'}</small></span>${statePill(m)}</button>`
        )
      : html`<p class="muted small mc-none">${list.mods.length ? 'No mod matches.' : ark ? 'No mods in the mod list yet (Mods tab).' : plugins ? 'No plugin settings yet. Add plugins in the Mods tab and start the server once so they write their settings.' : 'No mod config files yet. Start the server once so the mods create them.'}</p>`}`.s;
  };

  const drawForm = () => {
    const box = $('#mc-form');
    if (!current) {
      box.innerHTML = html`<div class="mc-empty">${icon('sliders')}<p>Pick a mod on the left to see its settings.</p></div>`.s;
      return;
    }
    const d = current.data;
    const mod = modOf(current.file);
    const file = (mod.files || []).find((f) => f.file === current.file) || {};
    const fields = d.fields || [];
    const sections = new Map();
    for (const f of fields) {
      const sec = f.section || '';
      if (!sections.has(sec)) sections.set(sec, []);
      sections.get(sec).push(f);
    }
    const showRaw = rawMode || !d.fields;
    const kept = fields.filter((f) => f.common === false).length;
    const url = (d.mod && d.mod.url) || mod.url;
    const stopFirst = ark && list.running;
    box.innerHTML = html`
      <form id="mc-edit" novalidate>
        <div class="mod-hero">${mod.image ? html`<span class="mod-hero-bg" style="background-image:url('${mod.image}')"></span>` : ''}
          ${thumb(mod, 'mod-hero-pic')}
          <div class="mod-hero-text">
            <h3>${mod.name || fileName(file)} ${statePill(mod)}</h3>
            ${mod.description ? html`<p class="mod-hero-about">${mod.description}</p>` : ''}
            <p class="mod-hero-meta"><span class="mono">${ark ? d.where : plugins ? `oxide/${current.file}` : current.file}</span><span id="mc-changed"></span></p>
          </div>
          <div class="btn-row">
            ${url ? html`<a class="btn btn-sm" href="${webUrl(url)}" target="_blank" rel="noopener" title="${plugins ? 'What each setting does is explained on the plugin\'s page' : 'Open the mod\'s page'}">${icon('external')}${plugins ? 'Plugin page' : 'Mod page'}</a>` : ''}
            ${!ark && list.canRaw && d.fields ? html`<button type="button" class="btn btn-sm btn-ghost" id="mc-raw">${showRaw ? 'Show as form' : 'Edit raw file'}</button>` : ''}
          </div>
        </div>
        ${(mod.files || []).length > 1
          ? html`<div class="file-tabs" role="tablist">${mod.files.map(
              (f) => html`<button type="button" role="tab" class="file-tab ${f.file === current.file ? 'active' : ''}" data-file="${f.file}" title="${ark ? f.where : f.file}">${fileName(f)}
                ${f.client ? html`<span class="tag" title="Client-side settings: they only matter on players' PCs">players' PCs</span>` : f.role === 'world' ? html`<span class="tag" title="Kept with this world">this world</span>` : ''}</button>`
            )}</div>`
          : ''}
        ${d.mod && d.mod.sources && d.mod.sources.length
          ? html`<details class="adv mc-sources"><summary>Where these settings come from (${d.mod.sources.length} source${d.mod.sources.length === 1 ? '' : 's'} checked)</summary><ul>${d.mod.sources.map(
              (src) => html`<li>${src.url ? html`<a href="${webUrl(src.url)}" target="_blank" rel="noopener">${src.label}</a>` : src.label} — ${src.error ? html`<span class="muted">couldn't read it (${src.error})</span>` : `${src.settings} setting${src.settings === 1 ? '' : 's'}`}</li>`
            )}</ul><p class="muted small">The panel reads the mod's page, its discussions about settings, and documents the page links to (Pastebin, GitHub, Google Docs). If the mod explains a setting only in a video or on Discord, add it below.</p></details>`
          : ''}
        ${file.client ? html`<div class="callout">${icon('info')}<div>This file holds client-side settings (graphics, sounds, key hints). They only matter on players' own PCs, so changing them here does nothing for the server.</div></div>` : ''}
        ${stopFirst ? html`<p class="form-error">Stop the server to change mod settings — ARK rewrites its INI files when it shuts down.</p>` : ''}
        ${ark && !d.documented && !showRaw ? html`<p class="muted small">The mod page doesn't document settings for this section, so only what's in your INI is shown. Add settings from the mod's instructions below.</p>` : ''}
        ${showRaw
          ? d.raw === undefined
            ? html`<p class="muted">This file can't be shown as a form, and editing it as text needs the Files permission.</p>`
            : html`${d.fields ? '' : html`<p class="muted small">This file can't be shown as a form, so here it is as text.</p>`}
              <textarea name="__raw" class="mono mc-raw" rows="24" spellcheck="false">${d.raw}</textarea>`
          : html`${fields.length > 6
                ? html`<div class="cat-tools">
                    <label class="search-box">${icon('search')}<input type="search" id="mc-find" placeholder="Find a setting…" autocomplete="off" aria-label="Find a setting"></label>
                    ${kept ? html`<div class="seg" role="radiogroup" aria-label="Which settings to show"><label class="seg-opt"><input type="radio" name="__view" value="common" ${showAll ? '' : 'checked'}><span>Most used · ${fields.length - kept}</span></label><label class="seg-opt"><input type="radio" name="__view" value="all" ${showAll ? 'checked' : ''}><span>All · ${fields.length}</span></label></div>` : ''}
                  </div>`
                : ''}
              ${fields.length ? '' : html`<p class="muted">No settings yet. Add the ones from the mod's page below.</p>`}
              <div id="mc-sections" class="${kept && !showAll ? 'only-common' : ''}">${[...sections].map(
                ([sec, fs]) => html`<section class="set-sec"><h4>${icon(sectionIcon(sec || (plugins ? file.label : mod.name)))}<span>${sec || (sections.size > 1 ? 'General' : 'Settings')}</span><span class="count">${fs.length}</span></h4>
                  <div class="set-list">${fs.map((f) => row({ ...f, key: 'v:' + f.id, tip: f.key && f.key !== f.label ? f.key : undefined, badge: ark && f.inFile === false ? 'not in your INI yet' : undefined }, f.value))}</div></section>`
              )}</div>
              <p class="muted" id="mc-nomatch" hidden>No settings match.</p>
              ${kept ? html`<button type="button" class="more-btn" id="mc-more">${icon('chevron')}<span></span></button>` : ''}
              ${d.canAdd
                ? html`<details class="adv"><summary>Add a setting that isn't listed</summary><div class="form-grid">
                    <label class="field"><span>Setting name</span><input name="__newKey" placeholder="e.g. MaxWildLevel" autocomplete="off"></label>
                    <label class="field"><span>Value</span><input name="__newValue" placeholder="e.g. 300" autocomplete="off"></label></div></details>`
                : ''}`}
        <div class="form-actions sticky save-bar"><button class="btn btn-primary" ${stopFirst ? 'disabled' : ''}>${plugins && list.running ? 'Save and reload plugin' : 'Save'}</button>
          ${ark && fields.some((f) => f.def !== undefined) && !showRaw ? html`<button type="button" class="btn" id="mc-write-all" ${list.running ? 'disabled' : ''} title="Also write the settings that are still at their default into the INI">Save and write all defaults</button>` : ''}
          <span class="dirty-note" id="mc-dirty"></span><button type="button" class="btn btn-sm btn-ghost" id="mc-discard" hidden>Discard changes</button>
          <span class="muted small">${plugins ? (list.running ? 'The plugin reloads with the new settings right away.' : 'Changes apply when the server starts.') : 'Changes apply on the next (re)start.'}</span></div>
      </form>`.s;

    const form = $('#mc-edit');
    const body = $('#mc-sections');
    // Sections whose settings are all kept back (or filtered out) don't show an empty heading.
    const tidy = () => {
      if (!body) return;
      let any = false;
      for (const sec of $$('.set-sec', body)) {
        const visible = $$('.set-row', sec).some((r) => !r.hidden && (!body.classList.contains('only-common') || !r.matches('.set-more:not(.is-changed):not(.is-dirty)')));
        sec.hidden = !visible;
        if (visible) any = true;
      }
      $('#mc-nomatch').hidden = any || !fields.length;
      const more = $('#mc-more');
      if (more) {
        const hiddenNow = body.classList.contains('only-common') ? $$('.set-more:not(.is-changed):not(.is-dirty)', body).length : 0;
        more.hidden = !!($('#mc-find') || {}).value || (body.classList.contains('only-common') && !hiddenNow);
        more.classList.toggle('open', !body.classList.contains('only-common'));
        more.querySelector('span').textContent = body.classList.contains('only-common') ? `Show all ${fields.length} settings (${hiddenNow} more)` : 'Show only the most used';
      }
    };
    const summary = () => {
      const withDef = $$('.set-row[data-def]', form);
      const changed = withDef.filter((r) => r.classList.contains('is-changed')).length;
      $('#mc-changed').textContent = showRaw ? '' : `${fields.length} setting${fields.length === 1 ? '' : 's'}${withDef.length ? ` · ${changed} changed from ${withDef.length === 1 ? 'its default' : 'their defaults'}` : ''}`;
      const n = rows.dirty();
      $('#mc-dirty').textContent = dirtyText(n);
      $('#mc-discard').hidden = !n;
    };
    rows = bindRows(form, summary);
    summary();
    tidy();

    const setView = (all) => {
      showAll = all;
      body.classList.toggle('only-common', !all);
      for (const r of $$('input[name="__view"]', form)) r.checked = (r.value === 'all') === all;
      tidy();
    };
    on(form, 'change', 'input[name="__view"]', (_e, el) => setView(el.value === 'all'));
    $('#mc-more')?.addEventListener('click', () => setView(body.classList.contains('only-common')));
    $('#mc-discard').onclick = () => rows.discard();
    // Searching looks through every setting, whichever view is on.
    $('#mc-find')?.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      body.classList.toggle('only-common', !q && !showAll && kept > 0);
      for (const sec of $$('.set-sec', body)) {
        const whole = !!q && sec.querySelector('h4').textContent.toLowerCase().includes(q);
        for (const r of $$('.set-row', sec)) r.hidden = !!q && !whole && !r.dataset.search.includes(q);
      }
      tidy();
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
        toast(r.changed ? (r.applied ? 'Saved — plugin reloaded' : r.restartRequired ? 'Saved — restart the server to apply' : 'Saved') : 'Nothing changed', 'ok');
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
    const sameMod = current && modOf(current.file).id === modOf(file).id;
    current = { file, data: await api.get(`${base}/file?file=${encodeURIComponent(file)}`) };
    if (!sameMod) showAll = false;
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
      <details class="adv mc-about"><summary>How this page works</summary><p class="muted small" id="mc-note"></p></details>
      <div class="mc-layout">
        <div class="mc-side">
          <label class="search-box">${icon('search')}<input type="search" id="mc-search" placeholder="Find a mod…" autocomplete="off" aria-label="Find a mod"></label>
          <div id="mc-list"><p class="muted small">Looking up your mods…</p></div>
          ${ark
            ? html`<details class="adv"><summary>A mod's settings aren't listed?</summary>
                <p class="muted small">Some mods explain their settings on another site instead of their mod page. Create the section they tell you to use, then add their settings to it.</p>
                <form id="mc-new"><select name="file"><option value="gus">GameUserSettings.ini</option><option value="game">Game.ini</option></select><input name="section" placeholder="Section name, e.g. AnnunakiGenesis" autocomplete="off"><button class="btn btn-sm">${icon('plus')}Add section</button></form></details>`
            : ''}
        </div>
        <div class="mc-main" id="mc-form"></div>
      </div>
    </div>`.s;

  // Pictures that can't be loaded become the plain placeholder.
  root.addEventListener(
    'error',
    (e) => {
      if (e.target.tagName !== 'IMG' || !e.target.matches('.mod-pic, .mod-hero-pic')) return;
      const ph = document.createElement('span');
      ph.className = `${e.target.className} mod-pic-none`;
      ph.innerHTML = icon('box');
      e.target.replaceWith(ph);
      root.querySelector('.mod-hero-bg')?.remove();
    },
    true
  );
  drawForm();
  await load();
  const drawNote = () => {
    $('#mc-note').textContent = list.note + (list.hidden && list.hidden.length ? ` Hidden because they have nothing to configure: ${list.hidden.join(', ')}.` : '');
  };
  drawNote();
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
      drawNote();
      if (current) await open(current.file);
      toast('Mod info refreshed', 'ok');
    } finally {
      e.target.disabled = false;
    }
  });
  const go = (file) => {
    rawMode = false;
    open(file).catch((err) => toast(err.message, 'error'));
  };
  on(root, 'click', '[data-file]', (_e, el) => go(el.dataset.file));
  on(root, 'click', '[data-mod]', (_e, el) => {
    const m = list.mods.find((x) => x.id === el.dataset.mod);
    if (m && firstFile(m)) go(firstFile(m));
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
  if (first) await open(firstFile(first)).catch(() => {});
}
