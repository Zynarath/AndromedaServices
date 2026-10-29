import { api } from '../api.js';
import { html, $, on, icon, modal, toast } from '../ui.js';

export const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n || 0));

/**
 * A search box and result list in a modal; resolves to the picked items, or null.
 *  search(q) -> items (q is '' for the first, "popular" list)
 *  describe(item) -> { key, name, summary, logo, meta (html), disabled }
 */
export function pickFromSearch({ title, placeholder, intro = '', multi = false, search, describe }) {
  const picked = new Map();
  return modal({
    title,
    wide: true,
    body: html`<form class="cf-search" id="cf-form"><input name="q" placeholder="${placeholder}" autocomplete="off"><button class="btn">${icon('search')}Search</button></form>
      ${intro}
      <div id="cf-results" class="cf-results"><div class="loading">Loading popular…</div></div>`,
    actions: multi ? [{ label: 'Cancel', value: null }, { label: 'Add selected', kind: 'btn-primary', onClick: () => [...picked.values()] }] : [],
    onOpen: (wrap, close) => {
      const results = $('#cf-results', wrap);
      let items = [];
      const run = async (q = '') => {
        results.innerHTML = '<div class="loading">Searching…</div>';
        try {
          items = (await search(q)).map((item) => ({ item, ...describe(item) }));
          results.innerHTML = items.length
            ? items
                .map(
                  (d) => html`<button type="button" class="cf-item ${picked.has(String(d.key)) ? 'selected' : ''}" data-key="${d.key}" ${d.disabled ? 'disabled' : ''}>
                    ${d.logo ? html`<img src="${d.logo}" alt="" loading="lazy">` : html`<span class="cf-noimg">${icon('box')}</span>`}
                    <span class="cf-text"><strong>${d.name}</strong><small>${d.summary}</small><span class="cf-meta">${d.meta || ''}</span></span>
                    ${multi ? html`<span class="cf-check">${icon('check')}</span>` : ''}
                  </button>`.s
                )
                .join('')
            : '<div class="empty-mini">No results</div>';
        } catch (err) {
          results.innerHTML = html`<div class="form-error">${err.message}</div>`.s;
        }
      };
      $('#cf-form', wrap).onsubmit = (e) => {
        e.preventDefault();
        run(e.target.q.value.trim());
      };
      on(results, 'click', '[data-key]', (_e, el) => {
        const d = items.find((x) => String(x.key) === el.dataset.key);
        if (!d) return;
        if (!multi) return close([d.item]);
        if (picked.has(el.dataset.key)) picked.delete(el.dataset.key);
        else picked.set(el.dataset.key, d.item);
        el.classList.toggle('selected');
      });
      run();
    },
  }).then((r) => (Array.isArray(r) && r.length ? r : null));
}

// Search CurseForge (modpacks, Minecraft mods, ARK: SA mods).
export function pickCurseForge({ type, title, multi = false, gameVersion, loader }) {
  return pickFromSearch({
    title,
    multi,
    placeholder: 'Search CurseForge…',
    intro: gameVersion ? html`<p class="muted small">Showing files for Minecraft ${gameVersion}${loader && loader !== 'vanilla' ? ' · ' + loader : ''}</p>` : '',
    search: async (q) => {
      const qs = new URLSearchParams({ type, q });
      if (gameVersion) qs.set('gameVersion', gameVersion);
      if (loader && loader !== 'vanilla') qs.set('loader', loader);
      return (await api.get(`/api/curseforge/search?${qs}`)).results;
    },
    describe: (m) => ({
      key: m.id,
      name: m.name,
      summary: m.summary,
      logo: m.logo,
      meta: html`${icon('download')}${fmtNum(m.downloads)} · ${m.authors.slice(0, 2).join(', ')}${m.gameVersions.length ? ' · ' + m.gameVersions.filter((v) => /^\d/.test(v)).slice(0, 3).join(', ') : ''}`,
    }),
  });
}

export { toast };
