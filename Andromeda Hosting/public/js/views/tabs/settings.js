import { api } from '../../api.js';
import { html, $, icon, toast, confirmBox, modal, gameArt, artInner } from '../../ui.js';
import { row, bindRows, setValue, dirtyText, sectionIcon } from './controls.js';

export function field(f, value) {
  const id = 'f-' + f.key.replace(/\W/g, '_');
  const hint = f.hint ? html`<small class="hint">${f.hint}</small>` : '';
  const tip = f.tip ? html`title="${f.tip}"` : '';
  if (f.type === 'bool') {
    return html`<label class="switch field-switch" ${tip}><input type="checkbox" name="${f.key}" ${value ? 'checked' : ''}><span></span>${f.label}${hint}</label>`;
  }
  if (f.type === 'maps') {
    // Map picker: one card per map with its preview picture. Uses the same checklist plumbing.
    const picked = new Set(Array.isArray(value) ? value : []);
    const opts = f.options || [];
    const inactive = f.inactiveIf ? html`data-inactive-key="${f.inactiveIf.key}"` : '';
    return html`<div class="field span-2 map-field" ${inactive}><span>${f.label}</span>
      ${f.inactiveIf ? html`<p class="map-inactive-note">${f.inactiveIf.note}</p>` : ''}
      <div class="map-grid" data-checklist="${f.key}">${opts.map(
        (o) => html`<label class="map-card" title="${o.value}"><input type="checkbox" value="${o.value}" ${picked.has(o.value) ? 'checked' : ''} ${o.tag ? html`data-tag="${o.tag}"` : ''}>
          <span class="map-img"><img src="${o.image}" alt="" loading="lazy"><span class="map-fallback">${o.label}</span></span>
          <span class="map-name"><span>${o.label}</span>${o.tag ? html`<span class="pill pill-tag">${o.tag}</span>` : ''}</span></label>`
      )}</div>
      <div class="btn-row"><button type="button" class="btn btn-sm btn-ghost" data-check-all="${f.key}">Select all</button>${opts.some((o) => o.tag) ? html`<button type="button" class="btn btn-sm btn-ghost" data-check-base="${f.key}">Base game only</button>` : ''}<button type="button" class="btn btn-sm btn-ghost" data-check-none="${f.key}">Clear</button><span class="muted small map-count" data-map-count="${f.key}"></span></div>
      ${hint}<small class="hint">Map pictures from the Call of Duty Wiki (Fandom), downloaded once by the panel.</small></div>`;
  }
  if (f.type === 'checklist') {
    const picked = new Set(Array.isArray(value) ? value : []);
    return html`<div class="field span-2"><span>${f.label}</span>
      <div class="check-grid" data-checklist="${f.key}">${(f.options || []).map((o) => html`<label class="check"><input type="checkbox" value="${o.value}" ${picked.has(o.value) ? 'checked' : ''}> ${o.label}</label>`)}</div>
      <div class="btn-row"><button type="button" class="btn btn-sm btn-ghost" data-check-all="${f.key}">Select all</button><button type="button" class="btn btn-sm btn-ghost" data-check-none="${f.key}">Clear</button></div>${hint}</div>`;
  }
  if (f.type === 'textarea') {
    return html`<label class="field span-2" for="${id}" ${tip}><span>${f.label}</span><textarea id="${id}" name="${f.key}" rows="4" class="mono" spellcheck="false">${value ?? ''}</textarea>${hint}</label>`;
  }
  if (f.type === 'select' || f.type === 'select-custom') {
    // Options are plain strings or { value, label } pairs.
    const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
    const v = value == null ? '' : String(value);
    if (v && !opts.some((o) => String(o.value) === v)) opts.push({ value: v, label: v });
    return html`<label class="field" for="${id}" ${tip}><span>${f.label}</span>
      ${f.type === 'select-custom'
        ? html`<input id="${id}" name="${f.key}" list="${id}-list" value="${v}"><datalist id="${id}-list">${opts.map((o) => html`<option value="${o.value}">`)}</datalist>`
        : html`<select id="${id}" name="${f.key}">${f.key === 'panel.javaMajor' ? html`<option value="">Automatic</option>` : ''}${opts.map((o) => html`<option value="${o.value}" ${String(o.value) === v ? 'selected' : ''}>${o.label}</option>`)}</select>`}
      ${hint}</label>`;
  }
  return html`<label class="field" for="${id}" ${tip}><span>${f.label}</span>
    <input id="${id}" name="${f.key}" type="${f.type === 'number' ? 'number' : 'text'}" value="${value ?? ''}" ${f.def != null ? html`placeholder="Default: ${f.def}"` : ''} ${f.step ? html`step="${f.step}"` : f.type === 'number' ? html`step="any"` : ''} ${f.min != null ? html`min="${f.min}"` : ''} autocomplete="off">${hint}</label>`;
}

export async function render(root, { server, refresh, navigate, refreshServers }) {
  const { schema, values } = await api.get(`/api/servers/${server.id}/settings`);
  const admin = server.perms.includes('admin');
  const cores = server.cores || 0;
  const tuning = server.tuning || {};
  // Admin-only fields are enforced on the server too; sections left empty by that aren't listed.
  const sections = schema.sections.map((sec) => ({ ...sec, fields: sec.fields.filter((f) => admin || !f.admin) })).filter((sec) => sec.fields.length);
  const cond = (sec) => (sec.showIf ? html`data-show-key="${sec.showIf.key}" data-show-value="${sec.showIf.value}"` : '');
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

    <div class="panel" id="cover">
      <h3>Cover picture</h3>
      <p class="muted small">Shown behind the server's name on the dashboard. Until you pick your own, it's the game's default art.</p>
      <div class="cover-edit">
        <div class="card-art cover-preview art-${gameArt(server)}" id="cover-preview"></div>
        <div class="cover-controls">
          <div class="btn-row">
            <label class="btn">${icon('upload')}Upload picture…<input type="file" id="cover-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden></label>
            <button type="button" class="btn btn-ghost" id="cover-reset">${icon('restart')}Use the game's default</button>
          </div>
          <small class="hint">JPG, PNG, WebP or GIF, up to 8 MB. Wide pictures (about 3:1) fit the card best.</small>
        </div>
      </div>
    </div>

    <form id="game" class="panel cat-form" novalidate>
      <div class="cat-hero art-${gameArt(server)}">${server.cover ? html`<span class="art-cover" style="background-image:url('${server.cover.url}')"></span>` : ''}
        <div class="cat-hero-text"><h3>Game settings</h3>${schema.note ? html`<p>${schema.note}</p>` : ''}</div>
      </div>
      <div class="cat-tools">
        <label class="search-box">${icon('search')}<input type="search" id="settings-filter" placeholder="Find a setting…" autocomplete="off" aria-label="Find a setting"></label>
        ${sections.some((sec) => sec.advanced) ? html`<label class="switch" title="Every other option, described by the game's own files"><input type="checkbox" id="adv-toggle"><span></span>Show all options</label>` : ''}
      </div>
      <div class="cat-layout">
        <nav class="cat-rail" aria-label="Sections">${sections.map((sec, i) => {
          const firstAdv = sec.advanced && !(sections[i - 1] || {}).advanced;
          const newFile = sec.advanced && (firstAdv || sections[i - 1].file !== sec.file);
          return html`${firstAdv ? html`<div class="cat-rail-label" data-adv hidden>All options</div>` : ''}${newFile ? html`<div class="cat-rail-file" data-adv hidden>${sec.file}</div>` : ''}
            <button type="button" class="cat-link" data-cat="${i}" ${sec.advanced ? 'data-adv hidden' : ''} ${cond(sec)}>${icon(sec.icon || sectionIcon(sec.short || sec.title))}<span class="cat-name">${sec.short || sec.title}</span><span class="cat-count">${sec.fields.length}</span></button>`;
        })}</nav>
        <div class="cat-panes">
          ${sections.map((sec, i) => {
            const more = sec.advanced ? 0 : sec.fields.filter((f) => f.common === false).length;
            return html`<section class="cat-pane ${more ? 'only-common' : ''}" data-cat="${i}" ${sec.advanced ? 'data-adv' : ''} ${cond(sec)} hidden>
              <header class="cat-banner"><span class="cat-emblem">${icon(sec.icon || sectionIcon(sec.short || sec.title))}</span><div><h4>${sec.short || sec.title}${sec.file ? html` <span class="tag">${sec.file}</span>` : ''}</h4>${sec.blurb ? html`<p>${sec.blurb}</p>` : sec.advanced ? html`<p>Every other option in this part of ${sec.file}, as the file itself describes it. Leave a box as it is to keep the file unchanged.</p>` : ''}</div></header>
              ${sec.presets ? html`<div class="presets"><span class="presets-label">${sec.presets.label}</span><div class="preset-row">${sec.presets.choices.map((c, j) => html`<button type="button" class="preset" data-preset="${i}:${j}">${c.label}</button>`)}</div></div>` : ''}
              <div class="set-list" ${sec.advanced ? html`data-lazy="${i}"` : ''}>${sec.advanced ? '' : sec.fields.map((f) => row(f, values[f.key], { legacy: field }))}</div>
              ${more ? html`<button type="button" class="more-btn" data-more>${icon('chevron')}<span></span></button>` : ''}
            </section>`;
          })}
          <p class="muted" id="settings-nomatch" hidden>No settings match.</p>
        </div>
      </div>
      <div class="form-actions sticky save-bar"><button class="btn btn-primary">Save game settings</button><span class="dirty-note" id="dirty-note"></span><button type="button" class="btn btn-sm btn-ghost" id="discard" hidden>Discard changes</button><span class="muted small">Changes apply on the next (re)start.</span></div>
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

  const drawCover = (srv) => {
    $('#cover-preview').innerHTML = artInner(srv).s;
    $('#cover-reset').hidden = !(srv.cover && srv.cover.custom);
  };
  drawCover(server);
  const coverChanged = (srv) => {
    drawCover(srv);
    refresh();
    refreshServers();
  };
  $('#cover-file').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return toast('Pictures can be at most 8 MB', 'error');
    try {
      coverChanged((await api.put(`/api/servers/${server.id}/cover`, file)).server);
      toast('Cover picture saved', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  $('#cover-reset').onclick = async () => {
    try {
      coverChanged((await api.del(`/api/servers/${server.id}/cover`)).server);
      toast("Back to the game's default picture", 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const gf = $('#game');
  const links = [...gf.querySelectorAll('.cat-link')];
  const panes = [...gf.querySelectorAll('.cat-pane')];
  const advToggle = $('#adv-toggle');
  const filter = $('#settings-filter');
  const remember = (key, v) => {
    try {
      if (v === undefined) return sessionStorage.getItem(`settings:${server.id}:${key}`);
      sessionStorage.setItem(`settings:${server.id}:${key}`, v);
    } catch {}
    return null;
  };

  // Sections tied to another field (e.g. one game mode's rules) only show while it has that value.
  const conditionMet = (el) => !el.dataset.showKey || (gf.elements[el.dataset.showKey] && gf.elements[el.dataset.showKey].value === el.dataset.showValue);
  const usable = (el) => conditionMet(el) && (!el.hasAttribute('data-adv') || (advToggle && advToggle.checked));

  const rows = bindRows(gf, () => {
    const n = rows.dirty();
    $('#dirty-note').textContent = dirtyText(n);
    $('#discard').hidden = !n;
    markPresets();
    panes.forEach(labelMore);
  });

  // "All options" sections can hold hundreds of rows: they are drawn the first time they're shown.
  const fill = (pane) => {
    const list = pane.querySelector('[data-lazy]');
    if (!list) return;
    const sec = sections[Number(list.dataset.lazy)];
    list.removeAttribute('data-lazy');
    list.innerHTML = sec.fields.map((f) => row(f, values[f.key], { legacy: field }).s).join('');
    rows.refresh(list);
  };

  // "Show 12 more settings": the ones kept back, minus those already showing because they were changed.
  function labelMore(pane) {
    const btn = pane.querySelector('[data-more]');
    if (!btn) return;
    const open = !pane.classList.contains('only-common');
    const kept = pane.querySelectorAll('.set-more:not(.is-changed):not(.is-dirty)').length;
    btn.hidden = !open && !kept;
    btn.classList.toggle('open', open);
    btn.querySelector('span').textContent = open ? 'Show fewer settings' : `Show ${kept} more setting${kept === 1 ? '' : 's'}`;
  }

  let active = -1;
  const show = (i) => {
    if (!links[i] || !usable(links[i])) i = links.findIndex(usable);
    active = i;
    links.forEach((l, n) => {
      l.classList.toggle('active', n === i);
      l.setAttribute('aria-current', n === i ? 'true' : 'false');
    });
    panes.forEach((p, n) => (p.hidden = n !== i));
    if (panes[i]) fill(panes[i]);
    remember('section', String(i));
  };

  const markPresets = () =>
    gf.querySelectorAll('[data-preset]').forEach((b) => {
      const [i, j] = b.dataset.preset.split(':').map(Number);
      const wanted = sections[i].presets.choices[j].values;
      b.classList.toggle('active', Object.entries(wanted).every(([k, v]) => gf.elements[k] && Number(gf.elements[k].value) === Number(v)));
    });

  const applyConditions = () => {
    for (const el of [...links, ...gf.querySelectorAll('[data-adv]:not(.cat-pane)')]) el.hidden = !usable(el);
    // A field that another field overrides while it has a value (the map grid vs. a playlist).
    gf.querySelectorAll('[data-inactive-key]').forEach((el) => el.classList.toggle('inactive', !!(gf.elements[el.dataset.inactiveKey] || {}).value));
    if (!filter.value.trim()) show(active);
  };

  // Searching looks through every section at once and lists the matches under their section's name.
  const search = () => {
    const q = filter.value.trim().toLowerCase();
    gf.classList.toggle('searching', !!q);
    if (!q) {
      gf.querySelectorAll('.set-row').forEach((r) => (r.hidden = false));
      $('#settings-nomatch').hidden = true;
      return show(active);
    }
    let any = false;
    panes.forEach((pane, i) => {
      if (!usable(links[i])) return void (pane.hidden = true);
      fill(pane);
      const whole = links[i].textContent.toLowerCase().includes(q); // a match on the section's name shows all of it
      let hits = 0;
      for (const r of pane.querySelectorAll('.set-row')) {
        r.hidden = !(whole || r.dataset.search.includes(q));
        if (!r.hidden) hits++;
      }
      pane.hidden = !hits;
      if (hits) any = true;
    });
    $('#settings-nomatch').hidden = any;
  };

  if (advToggle) {
    advToggle.checked = remember('all') === '1';
    advToggle.onchange = () => {
      remember('all', advToggle.checked ? '1' : '0');
      applyConditions();
      search();
    };
  }
  filter.oninput = search;
  const countMaps = () =>
    gf.querySelectorAll('[data-map-count]').forEach((el) => {
      const n = gf.querySelectorAll(`[data-checklist="${CSS.escape(el.dataset.mapCount)}"] input:checked`).length;
      el.textContent = `${n} map${n === 1 ? '' : 's'} picked`;
    });
  active = Number(remember('section')) || 0;
  applyConditions();
  countMaps();
  markPresets();
  panes.forEach(labelMore);
  gf.addEventListener('change', (e) => {
    if (e.target.name && gf.querySelector(`[data-show-key="${CSS.escape(e.target.name)}"], [data-inactive-key="${CSS.escape(e.target.name)}"]`)) applyConditions();
    if (e.target.closest('[data-checklist]')) countMaps();
  });
  // A preview that isn't ready shows the map's name instead. The panel fetches it in the background,
  // so ask again a few times ("error"/"load" don't bubble, hence capture).
  gf.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (img.tagName !== 'IMG' || !img.closest('.map-img')) return;
      img.closest('.map-img').classList.add('noimg');
      const tries = Number(img.dataset.tries || 0);
      if (tries < 3) {
        img.dataset.tries = tries + 1;
        setTimeout(() => img.isConnected && (img.src = img.src.replace(/\?.*$/, '') + '?try=' + (tries + 1)), [4000, 10000, 30000][tries]);
      }
    },
    true
  );
  gf.addEventListener('load', (e) => e.target.tagName === 'IMG' && e.target.closest('.map-img')?.classList.remove('noimg'), true);
  gf.addEventListener('click', (e) => {
    const link = e.target.closest('.cat-link');
    if (link) {
      if (filter.value) {
        filter.value = '';
        search();
      }
      return show(Number(link.dataset.cat));
    }
    const moreBtn = e.target.closest('[data-more]');
    if (moreBtn) {
      const pane = moreBtn.closest('.cat-pane');
      pane.classList.toggle('only-common');
      return labelMore(pane);
    }
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      const [i, j] = preset.dataset.preset.split(':').map(Number);
      for (const [k, v] of Object.entries(sections[i].presets.choices[j].values)) {
        const el = gf.elements[k];
        if (!el) continue;
        setValue(el.closest('.set-row'), v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    if (e.target.closest('#discard')) return rows.discard();
    const all = e.target.closest('[data-check-all]');
    const none = e.target.closest('[data-check-none]');
    const base = e.target.closest('[data-check-base]');
    const key = all?.dataset.checkAll || none?.dataset.checkNone || base?.dataset.checkBase;
    if (!key) return;
    gf.querySelectorAll(`[data-checklist="${key}"] input`).forEach((c) => (c.checked = base ? !c.dataset.tag : !!all));
    countMaps();
  });
  gf.onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    for (const sec of sections) {
      for (const f of sec.fields) {
        if (f.type === 'checklist' || f.type === 'maps') {
          out[f.key] = [...gf.querySelectorAll(`[data-checklist="${f.key}"] input:checked`)].map((c) => c.value);
          continue;
        }
        const el = gf.elements[f.key]; // sections that were never opened aren't drawn, so aren't sent
        if (!el) continue;
        out[f.key] = f.type === 'bool' ? el.checked : f.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      }
    }
    try {
      const r = await api.put(`/api/servers/${server.id}/settings`, { values: out });
      rows.markSaved();
      $('#dirty-note').textContent = '';
      $('#discard').hidden = true;
      if (r.warning) toast(r.warning, 'warn', 8000);
      else toast(r.restartRequired ? 'Saved — restart the server to apply' : 'Saved', 'ok');
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
