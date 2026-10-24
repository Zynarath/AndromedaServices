import { api } from '../api.js';
import { html, $, on, icon, modal, toast } from '../ui.js';

const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n || 0));

// Search CurseForge in a modal. Resolves to an array of picked mods, or null.
export function pickCurseForge({ type, title, multi = false, gameVersion, loader }) {
  const picked = new Map();
  return modal({
    title,
    wide: true,
    body: html`<form class="cf-search" id="cf-form"><input name="q" placeholder="Search CurseForge…" autocomplete="off"><button class="btn">${icon('search')}Search</button></form>
      ${gameVersion ? html`<p class="muted small">Showing files for Minecraft ${gameVersion}${loader && loader !== 'vanilla' ? ' · ' + loader : ''}</p>` : ''}
      <div id="cf-results" class="cf-results"><div class="loading">Loading popular…</div></div>`,
    actions: multi ? [{ label: 'Cancel', value: null }, { label: 'Add selected', kind: 'btn-primary', onClick: () => [...picked.values()] }] : [],
    onOpen: (wrap, close) => {
      const results = $('#cf-results', wrap);
      let items = [];
      const search = async (q = '') => {
        results.innerHTML = '<div class="loading">Searching…</div>';
        try {
          const qs = new URLSearchParams({ type, q });
          if (gameVersion) qs.set('gameVersion', gameVersion);
          if (loader && loader !== 'vanilla') qs.set('loader', loader);
          items = (await api.get(`/api/curseforge/search?${qs}`)).results;
          results.innerHTML = items.length
            ? items
                .map(
                  (m) => html`<button type="button" class="cf-item ${picked.has(m.id) ? 'selected' : ''}" data-mid="${m.id}">
                    ${m.logo ? html`<img src="${m.logo}" alt="" loading="lazy">` : html`<span class="cf-noimg">${icon('box')}</span>`}
                    <span class="cf-text"><strong>${m.name}</strong><small>${m.summary}</small>
                      <span class="cf-meta">${icon('download')}${fmtNum(m.downloads)} · ${m.authors.slice(0, 2).join(', ')}${m.gameVersions.length ? ' · ' + m.gameVersions.filter((v) => /^\d/.test(v)).slice(0, 3).join(', ') : ''}</span></span>
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
        search(e.target.q.value.trim());
      };
      on(results, 'click', '[data-mid]', (_e, el) => {
        const m = items.find((x) => String(x.id) === el.dataset.mid);
        if (!multi) return close([m]);
        if (picked.has(m.id)) picked.delete(m.id);
        else picked.set(m.id, m);
        el.classList.toggle('selected');
      });
      search();
    },
  }).then((r) => (Array.isArray(r) && r.length ? r : null));
}

export { toast };
