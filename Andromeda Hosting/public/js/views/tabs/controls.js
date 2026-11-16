import { html, icon } from '../../ui.js';

// Setting rows: one setting per row with its name, what it does and the control that fits it —
// a switch, a slider with a number box, option buttons, a list of chips or a text box — plus a
// marker that says whether it is at its default and a way back to it. Used by the Settings tab
// and the Mod configuration tab.

// ---- values as text, for comparing what's shown with the default / what was loaded ----
export const asText = (f, v) => (f.type === 'bool' ? (v === true || /^(true|1)$/i.test(String(v)) ? 'true' : 'false') : String(v ?? '').trim());
const sameText = (a, b) => a.toLowerCase() === b.toLowerCase() || (a !== '' && b !== '' && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) === Number(b));

// ---- units ----
const UNIT_LABEL = { '×': '×', '%': '%', s: 'sec', min: 'min', h: 'hours', ms: 'ms', ticks: 'ticks', days: 'days', blocks: 'blocks', chunks: 'chunks', m: 'm', yd: 'yards', copper: 'copper' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function duration(sec) {
  if (sec < 90) return '';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return [d && plural(d, 'day'), h && plural(h, 'hour'), m && `${m} min`, !d && !h && s && `${s} sec`].filter(Boolean).join(' ');
}
// The same amount in words people think in: 900000 ms -> "15 min", 250000 copper -> "25g".
function readout(unit, value) {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n) || n < 0) return '';
  if (unit === 'ms') return n >= 1000 ? duration(n / 1000) || `${n / 1000} sec` : '';
  if (unit === 's') return duration(n);
  if (unit === 'min') return n >= 90 ? duration(n * 60) : '';
  if (unit === 'ticks') return n >= 20 ? duration(n / 20) || `${n / 20} sec` : '';
  if (unit === 'copper') {
    const g = Math.floor(n / 10000);
    const s = Math.floor((n % 10000) / 100);
    const c = Math.round(n % 100);
    return [g && `${g.toLocaleString()} gold`, s && `${s} silver`, (c || (!g && !s)) && `${c} copper`].filter(Boolean).join(' ');
  }
  return '';
}

// ---- section pictures: an icon picked from what the section is called ----
const SECTION_ICONS = [
  [/all options|advanced|debug|logging|misc|other|expert|custom/i, 'wrench'],
  [/\bbots?\b|\bai\b|playerbot/i, 'bot'],
  [/rate|multiplier|xp\b|experience|progress|harvest|gather|taming|breeding/i, 'trending'],
  [/pvp|combat|damage|weapon|raid|instance|battle|arena|war|turret|kill/i, 'swords'],
  [/perform|tick|thread|memory|optimi|jvm|java|cpu/i, 'gauge'],
  [/network|ports?\b|connect|rcon|query|multiplayer|crossplay|cluster/i, 'network'],
  [/loot|drop|item|gear|reward|kit|stack|inventory|engram|craft/i, 'gem'],
  [/econom|price|cost|shop|money|gold|auction|trade|currency/i, 'coins'],
  [/chat|message|lang|motd|broadcast|announce|notif/i, 'message'],
  [/spawn|creature|dino|animal|mob|zombie|entit|wildlife|enem/i, 'paw'],
  [/health|food|hunger|stamina|surviv|difficult|death|stats?\b/i, 'heart'],
  [/build|structure|base|home|claim|land|decay|upkeep/i, 'home'],
  [/time|day|night|cooldown|schedule|sav(e|ing)|backup|restart/i, 'clock'],
  [/world|map|terrain|biome|gen\b|dimension|environment|realm|weather/i, 'globe'],
  [/player|character|account|whitelist|member|group|tribe|guild|team/i, 'users'],
  [/\bui\b|gui|hud|display|visual|client|render|graphic|colou?r|sound/i, 'eye'],
  [/secur|admin|password|permission|protect|anti|ban\b/i, 'shield'],
  [/mod\b|mods\b|plugin|umod|oxide|addon/i, 'box'],
  [/rule|mode|gameplay|game\b|general|basic|server|session|setting|option/i, 'sliders'],
];
export const sectionIcon = (title) => (SECTION_ICONS.find(([re]) => re.test(String(title || ''))) || [null, 'sliders'])[1];

// ---- controls ----
const SEG_MAX = 4;
function options(f, value) {
  const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  if (f.key === 'panel.javaMajor') opts.unshift({ value: '', label: 'Automatic' });
  const v = value == null ? '' : String(value);
  if (v && !opts.some((o) => String(o.value) === v)) opts.push({ value: v, label: v });
  return opts;
}
const fitsSegments = (opts) => opts.length >= 2 && opts.length <= SEG_MAX && opts.every((o) => String(o.label).length <= 24) && opts.reduce((n, o) => n + String(o.label).length, 0) <= 58;

// A list written as ["a", "b"] or [1, 2] can be edited as chips; anything else stays text.
function listItems(value) {
  try {
    const arr = JSON.parse(String(value));
    if (Array.isArray(arr) && arr.length && arr.length <= 80 && arr.every((x) => typeof x === 'string' || typeof x === 'number')) return arr;
  } catch {}
  return null;
}
const chip = (item) => html`<span class="chip chip-x" data-item="${JSON.stringify(item)}">${String(item)}<button type="button" data-chip-remove aria-label="Remove ${String(item)}">${icon('x')}</button></span>`;

const isColor = (f, v) => f.type === 'text' && /^#[0-9a-f]{6}$/i.test(String(v ?? '').trim());
// Controls that need the full width of the row, under the name and explanation.
const isWide = (f, v) => ['textarea', 'list', 'maps', 'checklist'].includes(f.type) || (f.type === 'text' && String(v ?? '').length > 44);

function control(f, value, id) {
  if (f.type === 'bool') {
    return html`<label class="switch"><input type="checkbox" id="${id}" name="${f.key}" data-main ${value === true || value === 'true' ? 'checked' : ''}><span></span><em class="switch-word"></em></label>`;
  }
  if (f.type === 'select' || f.type === 'select-custom') {
    const opts = options(f, value);
    const v = value == null ? '' : String(value);
    if (f.type === 'select-custom') return html`<input id="${id}" name="${f.key}" list="${id}-list" value="${v}" data-main><datalist id="${id}-list">${opts.map((o) => html`<option value="${o.value}">`)}</datalist>`;
    if (fitsSegments(opts)) {
      return html`<div class="seg" role="radiogroup" aria-label="${f.label}">${opts.map(
        (o, i) => html`<label class="seg-opt"><input type="radio" name="${f.key}" ${i === 0 ? html`id="${id}"` : ''} value="${o.value}" ${String(o.value) === v ? 'checked' : ''}><span>${o.label}</span></label>`
      )}</div>`;
    }
    return html`<select id="${id}" name="${f.key}" data-main>${opts.map((o) => html`<option value="${o.value}" ${String(o.value) === v ? 'selected' : ''}>${o.label}</option>`)}</select>`;
  }
  if (f.type === 'number') {
    const s = f.slider;
    const hardMin = f.min ?? (s ? s.min : undefined);
    const hardMax = f.max ?? (s && !s.soft ? s.max : undefined);
    const shown = value === '' || value == null ? (f.def ?? '') : value;
    // The slider's ends sit on whole steps, so dragging lands on round numbers.
    const lo = s ? Math.floor(s.min / s.step + 1e-9) * s.step : 0;
    const hi = s ? Math.max(Math.ceil(s.max / s.step - 1e-9) * s.step, Number(shown) || 0) : 0;
    return html`<div class="num-wrap">
      ${s ? html`<input type="range" class="slide" data-slide min="${lo}" max="${hi}" step="${s.step}" value="${shown}" aria-label="${f.label}" tabindex="-1">` : ''}
      <span class="num-box"><input type="number" id="${id}" name="${f.key}" data-main value="${value ?? ''}" step="${f.step || (s ? s.step : 'any')}" ${hardMin != null ? html`min="${hardMin}"` : ''} ${hardMax != null ? html`max="${hardMax}"` : ''} ${f.def != null && f.def !== '' ? html`placeholder="${f.def}"` : ''} autocomplete="off">${f.unit ? html`<span class="unit">${UNIT_LABEL[f.unit] || f.unit}</span>` : ''}</span>
    </div>${['ms', 's', 'min', 'ticks', 'copper'].includes(f.unit) ? html`<small class="set-readout" data-readout="${f.unit}"></small>` : ''}`;
  }
  if (f.type === 'textarea') return html`<textarea id="${id}" name="${f.key}" data-main rows="4" class="mono" spellcheck="false">${value ?? ''}</textarea>`;
  if (f.type === 'list') {
    const items = listItems(value);
    if (!items) return html`<input id="${id}" name="${f.key}" data-main class="mono" value="${value ?? ''}" autocomplete="off" spellcheck="false"><small class="hint">A list: keep the [ ] brackets and the commas.</small>`;
    return html`<div class="chips-edit" data-chips="${typeof items[0]}"><span class="chips-items">${items.map(chip)}</span>
      <input class="chip-add" id="${id}" placeholder="Add one, then Enter" autocomplete="off" spellcheck="false"><input type="hidden" name="${f.key}" data-main value="${String(value)}"></div>`;
  }
  if (isColor(f, value)) return html`<div class="color-wrap"><input type="color" data-color value="${String(value).trim().toLowerCase()}" aria-label="${f.label} colour"><input id="${id}" name="${f.key}" data-main class="mono" value="${value}" autocomplete="off" spellcheck="false"></div>`;
  return html`<input id="${id}" name="${f.key}" data-main type="text" value="${value ?? ''}" ${f.def != null && f.def !== '' ? html`placeholder="${f.def}"` : ''} autocomplete="off" ${isWide(f, value) ? 'spellcheck="false"' : ''}>`;
}

// One setting. f: { key, label, type, hint, tip (its name in the file), def, slider, unit, options,
// common (false = behind "Show more"), badge }. `legacy` draws the picture grids (maps, checklists).
export function row(f, value, { legacy } = {}) {
  const id = 'f-' + f.key.replace(/\W/g, '_');
  const more = f.common === false ? 'set-more' : '';
  const search = `${f.label} ${f.tip || ''} ${f.hint || ''}`.toLowerCase();
  if ((f.type === 'maps' || f.type === 'checklist') && legacy) return html`<div class="set-row set-wide set-plain ${more}" data-search="${search}">${legacy(f, value)}</div>`;
  const hasDef = f.def !== undefined && f.def !== null && !(f.def === '' && f.type !== 'select');
  return html`<div class="set-row ${isWide(f, value) ? 'set-wide' : ''} ${more}" data-type="${f.type}" data-init="${asText(f, value)}" ${hasDef ? html`data-def="${asText(f, f.def)}"` : ''} data-search="${search}">
    <div class="set-text">
      <div class="set-head"><label class="set-label" for="${id}">${f.label}</label>${f.badge ? html`<span class="tag">${f.badge}</span>` : ''}<span class="set-state"></span></div>
      ${f.hint ? html`<p class="set-help">${f.hint}</p>` : ''}
      ${f.tip ? html`<code class="set-key" title="Its name in the file">${f.tip}</code>` : ''}
    </div>
    <div class="set-control">${control(f, value, id)}</div>
  </div>`;
}

// ---- behaviour ----
const mainOf = (rowEl) => rowEl.querySelector('[data-main]');
function current(rowEl) {
  const radio = rowEl.querySelector('.seg input:checked');
  if (rowEl.querySelector('.seg')) return radio ? radio.value : '';
  const el = mainOf(rowEl);
  if (!el) return '';
  return el.type === 'checkbox' ? String(el.checked) : el.value.trim();
}

function syncSlider(rowEl) {
  const slide = rowEl.querySelector('[data-slide]');
  const el = mainOf(rowEl);
  if (!slide || el.value === '') return;
  const n = Number(el.value);
  if (!Number.isFinite(n)) return;
  if (n > Number(slide.max)) slide.max = n; // a typed value beyond the slider's convenient range
  if (n < Number(slide.min)) slide.min = n;
  slide.value = n;
  paintSlider(slide);
}
// The part of the track left of the thumb is drawn filled.
function paintSlider(slide) {
  const span = Number(slide.max) - Number(slide.min);
  slide.style.setProperty('--fill', `${span > 0 ? ((Number(slide.value) - Number(slide.min)) / span) * 100 : 0}%`);
}

function renderChips(rowEl, items) {
  const box = rowEl.querySelector('[data-chips]');
  box.querySelector('.chips-items').innerHTML = items.map((i) => chip(i).s).join('');
  mainOf(rowEl).value = JSON.stringify(items);
}
const chipItems = (rowEl) => [...rowEl.querySelectorAll('.chip-x')].map((c) => JSON.parse(c.dataset.item));

// Put a value into a row's control (reset to default, quick choices).
export function setValue(rowEl, value) {
  const el = mainOf(rowEl);
  const seg = rowEl.querySelector('.seg');
  if (seg) seg.querySelectorAll('input').forEach((r) => (r.checked = r.value === String(value)));
  else if (el.type === 'checkbox') el.checked = value === true || /^(true|1)$/i.test(String(value));
  else if (rowEl.querySelector('[data-chips]')) renderChips(rowEl, listItems(value) || []);
  else el.value = value;
  const color = rowEl.querySelector('[data-color]');
  if (color && /^#[0-9a-f]{6}$/i.test(String(value))) color.value = String(value).toLowerCase();
  syncSlider(rowEl);
}

function resetLabel(rowEl) {
  const def = rowEl.dataset.def;
  if (rowEl.dataset.type === 'bool') return def === 'true' ? 'on' : 'off';
  const opt = [...rowEl.querySelectorAll('.seg input')].find((r) => r.value === def);
  if (opt) return opt.nextElementSibling.textContent;
  const sel = rowEl.querySelector('select[data-main]');
  const o = sel && [...sel.options].find((x) => x.value === def);
  return o ? o.textContent : def.length > 28 ? def.slice(0, 26) + '…' : def;
}

// Redraw a row's markers: default / changed (with "reset"), edited since it was loaded, the
// amount in words, the switch's On/Off.
function update(rowEl) {
  if (!rowEl.dataset.type) return;
  const now = current(rowEl);
  const word = rowEl.querySelector('.switch-word');
  if (word) word.textContent = now === 'true' ? 'On' : 'Off';
  const slide = rowEl.querySelector('[data-slide]');
  if (slide) paintSlider(slide);
  const out = rowEl.querySelector('[data-readout]');
  if (out) out.textContent = readout(out.dataset.readout, now === '' ? mainOf(rowEl).placeholder : now);
  rowEl.classList.toggle('is-dirty', !sameText(now, rowEl.dataset.init));
  const state = rowEl.querySelector('.set-state');
  if (rowEl.dataset.def === undefined) return;
  // A blank box means "use the default".
  const isDefault = sameText(now, rowEl.dataset.def) || (now === '' && rowEl.dataset.type !== 'select');
  rowEl.classList.toggle('is-changed', !isDefault);
  state.innerHTML = isDefault
    ? '<span class="tag tag-default">default</span>'
    : html`<span class="tag tag-changed">changed</span><button type="button" class="set-reset" data-reset>reset to ${resetLabel(rowEl)}</button>`.s;
}

// Wire up every row inside `root` (rows added later are picked up too; call refresh() after adding).
// onChange runs after any edit. Returns { refresh, dirty, markSaved }.
export function bindRows(root, onChange = () => {}) {
  const changed = (rowEl) => {
    update(rowEl);
    onChange(rowEl);
  };
  const onEdit = (e) => {
    const rowEl = e.target.closest('.set-row');
    if (!rowEl || !root.contains(rowEl) || !rowEl.dataset.type) return;
    const t = e.target;
    if (t.matches('[data-slide]')) {
      const el = mainOf(rowEl);
      let n = Number(t.value);
      if (el.min !== '') n = Math.max(n, Number(el.min));
      if (el.max !== '') n = Math.min(n, Number(el.max));
      el.value = Number(n.toFixed(6));
    } else if (t.matches('[data-color]')) mainOf(rowEl).value = t.value;
    else if (t.matches('.chip-add')) return;
    else {
      syncSlider(rowEl);
      const color = rowEl.querySelector('[data-color]');
      if (color && /^#[0-9a-f]{6}$/i.test(t.value.trim())) color.value = t.value.trim().toLowerCase();
    }
    changed(rowEl);
  };
  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);
  root.addEventListener('click', (e) => {
    const rowEl = e.target.closest('.set-row');
    if (!rowEl || !root.contains(rowEl)) return;
    if (e.target.closest('[data-reset]')) {
      setValue(rowEl, rowEl.dataset.def);
      changed(rowEl);
    } else if (e.target.closest('[data-chip-remove]')) {
      e.target.closest('.chip-x').remove();
      renderChips(rowEl, chipItems(rowEl));
      changed(rowEl);
    }
  });
  // Lists: Enter (or a comma) adds what was typed as a chip.
  root.addEventListener('keydown', (e) => {
    if (!e.target.matches('.chip-add') || (e.key !== 'Enter' && e.key !== ',')) return;
    e.preventDefault();
    const rowEl = e.target.closest('.set-row');
    const text = e.target.value.trim();
    if (!text) return;
    const numbers = rowEl.querySelector('[data-chips]').dataset.chips === 'number';
    if (numbers && !Number.isFinite(Number(text))) return e.target.classList.add('bad');
    e.target.classList.remove('bad');
    e.target.value = '';
    renderChips(rowEl, [...chipItems(rowEl), numbers ? Number(text) : text]);
    changed(rowEl);
  });
  const rows = () => [...root.querySelectorAll('.set-row[data-type]')];
  const refresh = (within = root) => within.querySelectorAll('.set-row[data-type]').forEach(update);
  refresh();
  return {
    refresh,
    dirty: () => rows().filter((r) => r.classList.contains('is-dirty')).length,
    markSaved: () => rows().forEach((r) => {
      r.dataset.init = current(r);
      update(r);
    }),
    discard: () => rows().filter((r) => r.classList.contains('is-dirty')).forEach((r) => {
      setValue(r, r.dataset.init);
      changed(r);
    }),
  };
}

// "3 unsaved changes" next to the Save button.
export const dirtyText = (n) => (n ? `${n} unsaved change${n === 1 ? '' : 's'}` : '');
