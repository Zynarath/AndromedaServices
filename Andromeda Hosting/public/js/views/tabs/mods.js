import { api } from '../../api.js';
import { html, $, on, icon, toast, fmtBytes, confirmBox, fmtDate, esc, webUrl } from '../../ui.js';
import { pickCurseForge, pickFromSearch, fmtNum } from '../cfpicker.js';

export async function render(root, ctx) {
  const { server, navigate } = ctx;
  // Every "update the game server" button: data-game-update = 0 (update), 1 (update + validate), cod.
  on(root, 'click', '[data-game-update]', async (_e, el) => {
    const v = el.dataset.gameUpdate;
    try {
      await api.post(`/api/servers/${server.id}/update`, v === 'cod' ? { reinstallBots: true } : { validate: v === '1' });
      toast('Update started', 'ok');
      navigate(`/server/${server.id}/overview`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  if (server.ark) return renderArk(root, ctx);
  if (server.cod) return renderCod(root, ctx);
  if (server.sf) return renderSatisfactory(root, ctx);
  if (server.sdtd) return renderSdtd(root, ctx);
  if (server.rust) return renderRust(root, ctx);
  return renderMc(root, ctx);
}

const gameUpdatesPanel = (text) => html`<div class="panel">
  <h3>Game updates</h3>
  <p class="muted small">${text}</p>
  <div class="btn-row"><button class="btn btn-primary" data-game-update="0">${icon('download')}Update server</button><button class="btn" data-game-update="1">${icon('check')}Update &amp; validate files</button></div>
</div>`;

// ---------- Minecraft ----------
async function renderMc(root, { server, navigate }) {
  const mc = server.mc;
  const isPack = mc.source === 'curseforge';
  const draw = async () => {
    const { mods } = await api.get(`/api/servers/${server.id}/mods`);
    root.innerHTML = html`
      ${isPack
        ? html`<div class="panel">
            <div class="pack-chosen big">${mc.curseforge.logo ? html`<img src="${mc.curseforge.logo}" alt="">` : ''}
              <div><strong>${mc.curseforge.packName || 'Modpack'}</strong><small>Installed: ${mc.curseforge.versionName || mc.curseforge.fileId} · Minecraft ${mc.mcVersion} · ${mc.loader} ${mc.loaderVersion || ''}</small>
              ${mc.curseforge.url ? html`<a class="small" href="${webUrl(mc.curseforge.url)}" target="_blank" rel="noopener">View on CurseForge ${icon('external')}</a>` : ''}</div></div>
            <h4>Versions</h4>
            <div id="versions"><div class="loading">Checking CurseForge for versions…</div></div>
          </div>`
        : html`<div class="panel">
            <h3>Version</h3>
            <p>Minecraft <strong>${mc.mcVersion}</strong> · ${mc.loader} ${mc.loaderVersion || ''}</p>
            <form id="change-version" class="form-grid">
              <label class="field"><span>Minecraft version</span><input name="mcVersion" value="${mc.mcVersion}" list="mcv"><datalist id="mcv"></datalist></label>
              <label class="field"><span>Loader</span><select name="loader">${['vanilla', 'fabric', 'forge', 'neoforge'].map((l) => html`<option ${l === mc.loader ? 'selected' : ''}>${l}</option>`)}</select></label>
              <label class="field"><span>Loader version (blank = latest recommended)</span><input name="loaderVersion" placeholder="latest"></label>
              <div class="form-actions"><button class="btn">${icon('arrowUp')}Change version</button></div>
            </form>
            <p class="muted small">Your world is kept and a backup is made first. Downgrading Minecraft versions can corrupt worlds.</p>
          </div>`}
      <div class="panel">
        <div class="panel-head"><h3>Installed mods <span class="count">${mods.length}</span></h3>
          <div class="btn-row">
            ${mc.loader !== 'vanilla' ? html`<button class="btn btn-sm" id="add-mod">${icon('plus')}Add from CurseForge</button>` : ''}
            <a class="btn btn-sm btn-ghost" href="#/server/${server.id}/files" id="open-mods">${icon('upload')}Upload .jar</a>
          </div></div>
        ${mods.length
          ? html`<input class="filter" id="mod-filter" placeholder="Filter mods…">
            <table class="table" id="mod-table"><thead><tr><th>Mod file</th><th>Size</th><th class="right">Enabled</th><th></th></tr></thead><tbody>
            ${mods.map((m) => html`<tr data-file="${m.file}"><td class="mono">${m.file.replace(/\.disabled$/, '')}</td><td>${fmtBytes(m.size)}</td>
              <td class="right"><label class="switch"><input type="checkbox" data-toggle ${m.enabled ? 'checked' : ''} aria-label="Enabled"><span></span></label></td>
              <td class="right"><button class="icon-btn" data-del title="Delete">${icon('trash')}</button></td></tr>`)}
            </tbody></table>`
          : html`<p class="muted">${mc.loader === 'vanilla' ? 'Vanilla servers do not load mods. Switch the loader to Fabric/Forge/NeoForge to add mods.' : 'No mods yet.'}</p>`}
        <p class="muted small">Changes take effect after a restart. Disabled mods are renamed to <code>.jar.disabled</code>.</p>
      </div>`.s;

    if (isPack) loadVersions();
    const cv = $('#change-version');
    if (cv) {
      api.get('/api/minecraft/versions').then((r) => ($('#mcv').innerHTML = r.versions.slice(0, 150).map((v) => `<option value="${esc(v)}">`).join(''))).catch(() => {});
      cv.onsubmit = async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(cv));
        if (!(await confirmBox('Change version?', `Switch to Minecraft ${d.mcVersion} with ${d.loader}? The server will be stopped, backed up and reinstalled.`, { confirm: 'Change version' }))) return;
        try {
          await api.post(`/api/servers/${server.id}/update`, d);
          toast('Version change started', 'ok');
          navigate(`/server/${server.id}/overview`);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    }
    const add = $('#add-mod');
    if (add) add.onclick = async () => {
      const picked = await pickCurseForge({ type: 'mcmod', title: `Add mods (Minecraft ${mc.mcVersion}, ${mc.loader})`, multi: true, gameVersion: mc.mcVersion, loader: mc.loader });
      if (!picked) return;
      for (const m of picked) {
        try {
          const r = await api.post(`/api/servers/${server.id}/mods`, { modId: m.id });
          toast(`Added ${r.file}`, 'ok');
        } catch (err) {
          toast(`${m.name}: ${err.message}`, 'error', 8000);
        }
      }
      draw();
    };
    const filter = $('#mod-filter');
    if (filter) filter.oninput = () => root.querySelectorAll('#mod-table tbody tr').forEach((tr) => (tr.hidden = !tr.dataset.file.toLowerCase().includes(filter.value.toLowerCase())));
  };

  async function loadVersions() {
    const box = $('#versions');
    try {
      const { files, current } = await api.get(`/api/servers/${server.id}/modpack/versions`);
      const curIdx = files.findIndex((f) => f.id === current);
      box.innerHTML = html`
        ${curIdx > 0 ? html`<div class="callout callout-ok">${icon('arrowUp')}<div><strong>Update available:</strong> ${files[0].name}. <button class="btn btn-sm btn-primary" data-update="${files[0].id}">Update now</button></div></div>` : curIdx === 0 ? html`<p class="muted small">${icon('check')} You're on the newest version.</p>` : ''}
        <table class="table"><thead><tr><th>Version</th><th>Minecraft</th><th>Released</th><th></th></tr></thead><tbody>
        ${files.slice(0, 25).map((f) => html`<tr class="${f.id === current ? 'current' : ''}"><td>${f.name} ${f.releaseType !== 'release' ? html`<span class="pill pill-warn">${f.releaseType}</span>` : ''}</td>
          <td>${f.gameVersions.filter((v) => /^\d/.test(v)).join(', ')}</td><td>${fmtDate(Date.parse(f.date))}</td>
          <td class="right">${f.id === current ? html`<span class="pill pill-ok">Installed</span>` : html`<button class="btn btn-sm" data-update="${f.id}">${files.indexOf(f) < curIdx || curIdx === -1 ? 'Update' : 'Downgrade'}</button>`}</td></tr>`)}
        </tbody></table>`.s;
    } catch (err) {
      box.innerHTML = html`<div class="form-error">${err.message}</div>`.s;
    }
  }

  on(root, 'click', '[data-update]', async (_e, el) => {
    if (!(await confirmBox('Install this modpack version?', 'The server will be stopped and backed up. Old mods are replaced; worlds, server.properties, ops and whitelist are kept. Config files are replaced with the pack\'s.', { confirm: 'Install version' }))) return;
    try {
      await api.post(`/api/servers/${server.id}/update`, { fileId: Number(el.dataset.update) });
      toast('Modpack update started', 'ok');
      navigate(`/server/${server.id}/overview`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  on(root, 'change', '[data-toggle]', async (_e, el) => {
    const file = el.closest('tr').dataset.file;
    try {
      await api.patch(`/api/servers/${server.id}/mods/${encodeURIComponent(file)}`, { enabled: el.checked });
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  on(root, 'click', '[data-del]', async (_e, el) => {
    const file = el.closest('tr').dataset.file;
    if (!(await confirmBox('Delete mod?', `Delete ${file}?`, { danger: true, confirm: 'Delete' }))) return;
    try {
      await api.del(`/api/servers/${server.id}/mods/${encodeURIComponent(file)}`);
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  on(root, 'click', '#open-mods', () => sessionStorage.setItem('hp-files-path', 'mods'));
  await draw();
}

// ---------- ARK ----------
async function renderArk(root, { server }) {
  let mods = (await api.get(`/api/servers/${server.id}/ark-mods`)).mods;
  const asa = server.ark.edition === 'asa';
  // A picture that can't be loaded becomes the plain placeholder ("error" doesn't bubble, hence capture).
  root.addEventListener(
    'error',
    (e) => {
      if (e.target.tagName !== 'IMG' || !e.target.closest('#mod-list')) return;
      const ph = document.createElement('span');
      ph.className = 'cf-noimg';
      ph.innerHTML = icon('box');
      e.target.replaceWith(ph);
    },
    true
  );
  const draw = () => {
    root.innerHTML = html`
      <div class="panel">
        <div class="panel-head"><h3>Mods <span class="count">${mods.length}</span></h3>
          <div class="btn-row">${asa ? html`<button class="btn btn-sm" id="browse">${icon('search')}Browse CurseForge</button>` : ''}</div></div>
        <p class="muted small">${asa ? 'Mods load in this order. ARK: Survival Ascended downloads and updates them automatically every time the server starts — just restart to get mod updates.' : 'Steam Workshop mod IDs, loaded in order. Downloaded on start via -automanagedmods.'}</p>
        <form class="input-row" id="add-id"><input name="modid" placeholder="Add by ${asa ? 'CurseForge project' : 'Workshop'} ID, e.g. 928988" inputmode="numeric" pattern="[0-9, ]+"><button class="btn">${icon('plus')}Add</button></form>
        <ol class="mod-list" id="mod-list">
          ${mods.map((m, i) => html`<li data-id="${m.id}">
            ${m.logo ? html`<img src="${m.logo}" alt="">` : html`<span class="cf-noimg">${icon('box')}</span>`}
            <div class="mod-text"><strong>${m.name || 'Mod ' + m.id}</strong><small class="mono">${m.id}${m.url ? html` · <a href="${webUrl(m.url)}" target="_blank" rel="noopener">page</a>` : ''}</small></div>
            <div class="btn-row"><button class="icon-btn" data-move="-1" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button><button class="icon-btn" data-move="1" ${i === mods.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
            <button class="icon-btn" data-remove title="Remove">${icon('trash')}</button></div></li>`)}
        </ol>
        ${!mods.length ? html`<p class="muted">No mods yet.</p>` : ''}
      </div>
      ${gameUpdatesPanel('Updates the ARK dedicated server through SteamCMD. The server is stopped, backed up and started again if it was running. Players need the same game version as the server.')}`.s;
    const add = $('#add-id');
    add.onsubmit = (e) => {
      e.preventDefault();
      const ids = add.modid.value.split(/[ ,]+/).filter((x) => /^\d+$/.test(x));
      save([...mods.map((m) => String(m.id)), ...ids]);
    };
    const b = $('#browse');
    if (b) b.onclick = async () => {
      const picked = await pickCurseForge({ type: 'asa', title: 'Add ARK: Survival Ascended mods', multi: true });
      if (picked) save([...mods.map((m) => String(m.id)), ...picked.map((p) => String(p.id))]);
    };
  };
  const save = async (ids) => {
    try {
      const r = await api.put(`/api/servers/${server.id}/ark-mods`, { mods: ids });
      mods = (await api.get(`/api/servers/${server.id}/ark-mods`)).mods;
      draw();
      toast(r.restartRequired ? 'Mod list saved — restart to apply' : 'Mod list saved', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  on(root, 'click', '[data-remove]', (_e, el) => save(mods.map((m) => String(m.id)).filter((id) => id !== el.closest('li').dataset.id)));
  on(root, 'click', '[data-move]', (_e, el) => {
    const ids = mods.map((m) => String(m.id));
    const i = ids.indexOf(el.closest('li').dataset.id);
    const j = i + Number(el.dataset.move);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    save(ids);
  });
  draw();
}

// ---------- Call of Duty ----------
async function renderCod(root, { server }) {
  const c = server.cod;
  const engine = c.title === 'cod4x' ? 'CoD4x server files' : c.pluto ? 'Plutonium' : c.engine || 'IW4x';
  root.innerHTML = html`
    ${c.botsAvailable === false ? '' : html`<div class="panel">
      <h3>Bots</h3>
      <p>${c.botsVersion ? html`<span class="pill pill-ok">${icon('check')}Bot Warfare ${c.botsVersion}</span>` : html`<span class="pill pill-warn">not installed</span>`}
        ${c.bots.enabled ? html` · fills to ${c.bots.fill} players` : ' · bots are off in Settings'}</p>
      <p class="muted small">Bots come from the Bot Warfare mod (by ineedbots). ${c.pluto ? 'It is loaded from Plutonium\'s storage folder, so players don\'t need to download anything.' : 'It runs as a server-only mod (mods/mp_bots/z_svr_bots.iwd), so players don\'t need to download anything.'}</p>
      <button class="btn" data-game-update="cod">${icon('download')}${c.botsVersion ? 'Update' : 'Install'} Bot Warfare</button>
    </div>`}
    <div class="panel">
      <h3>${engine}</h3>
      ${c.t7x ? html`<p class="muted small">Downloads the latest T7x (<code>t7x.exe</code>) from AlterWare into the Unranked Server folder and rewrites the config. The server is stopped first and started again if it was running. Your friends need T7x in their own Black Ops III folder to join.</p>
      <p class="muted small">Bots are Black Ops III's own (no mod needed): ${c.bots.enabled ? `${c.bots.fill} in each match` : 'off'}. Change them in Settings → Bots.</p>`
      : html`<p class="muted small">${c.title === 'iw4x' || c.engine ? `${engine} is updated by its own launcher on your PC; this re-checks the game folder and rewrites the config.` : `Downloads the latest ${engine} and rewrites the config. The server is stopped first and started again if it was running.`}</p>`}
      <button class="btn btn-primary" data-game-update="cod">${icon('refresh')}Update ${engine}</button>
    </div>`.s;
}

// ---------- Satisfactory (ficsit.app) ----------
const modLogo = (m) => (m.logo ? html`<img src="${m.logo}" alt="" loading="lazy">` : html`<span class="cf-noimg">${icon('box')}</span>`);

async function renderSatisfactory(root, { server, navigate }) {
  let state = null;
  const draw = async () => {
    state = await api.get(`/api/servers/${server.id}/sf-mods`);
    const { mods, deps, dirty, gameBuild, remote, running, target } = state;
    root.innerHTML = html`
      <div class="panel">
        <div class="panel-head"><h3>Mods <span class="count">${mods.length}</span></h3>
          <div class="btn-row">
            <button class="btn btn-sm" id="sf-browse" ${target ? '' : 'disabled'}>${icon('search')}Browse ficsit.app</button>
            <button class="btn btn-sm btn-primary" id="sf-sync" ${running ? 'disabled title="Stop the server first, or just restart it"' : ''}>${icon('download')}Install / update now</button>
          </div></div>
        <p class="muted small">Mods come from <a href="https://ficsit.app" target="_blank" rel="noopener">ficsit.app</a>. The panel picks versions that work together${gameBuild ? html` and with this game build (<code>${gameBuild}</code>)` : ''}, adds what they need (like the mod loader, SML) and installs the dedicated-server build of each.
          ${dirty ? html`<strong>Changes are installed on the next start</strong> (or now with the button above while the server is stopped).` : ''}</p>
        ${mods.length
          ? html`<ul class="mod-list unordered">${mods.map((m) => html`<li data-ref="${m.ref}">${modLogo(m)}
              <div class="mod-text"><strong>${m.name}</strong><small>${m.summary}</small>
                <small class="mono">${m.ref} · ${m.installed ? html`installed ${m.installed}` : html`<span class="pill pill-warn">not installed yet</span>`} · <a href="${webUrl(m.url)}" target="_blank" rel="noopener">page</a></small></div>
              <div class="btn-row"><button class="icon-btn" data-sf-remove title="Remove">${icon('trash')}</button></div></li>`)}</ul>`
          : html`<p class="muted">No mods yet. Browse ficsit.app to add some.</p>`}
        ${deps.length
          ? html`<h4>Installed because other mods need them</h4>
            <ul class="mod-list unordered compact">${deps.map((m) => html`<li>${modLogo(m)}<div class="mod-text"><strong>${m.name}</strong><small class="mono">${m.ref} · ${m.installed}</small></div></li>`)}</ul>`
          : ''}
      </div>
      ${remote.length
        ? html`<div class="panel">
            <h3>Players need these too</h3>
            <p class="muted small">These mods run on both sides, so everyone who joins installs them with the <a href="https://ficsit.app/satisfactory-mod-manager" target="_blank" rel="noopener">Satisfactory Mod Manager</a> (same versions):</p>
            <ul class="chips">${remote.map((r) => html`<li class="chip">${r.name} ${r.version}</li>`)}</ul>
          </div>`
        : ''}
      ${gameUpdatesPanel('Updates the Satisfactory dedicated server through SteamCMD, then brings mods up to versions that support the new build. The server is stopped, backed up and started again if it was running.')}`.s;
  };

  on(root, 'click', '#sf-browse', async () => {
    const picked = await pickFicsit(server, new Set(state.mods.map((m) => m.ref)));
    if (!picked) return;
    for (const m of picked) {
      try {
        await api.post(`/api/servers/${server.id}/sf-mods`, { ref: m.ref });
        toast(`Added ${m.name}`, 'ok');
      } catch (err) {
        toast(`${m.name}: ${err.message}`, 'error', 8000);
      }
    }
    draw();
  });
  on(root, 'click', '[data-sf-remove]', async (_e, el) => {
    const ref = el.closest('[data-ref]').dataset.ref;
    if (!(await confirmBox('Remove mod?', `Remove ${ref}? It's uninstalled on the next start, along with dependencies nothing else needs.`, { danger: true, confirm: 'Remove' }))) return;
    try {
      await api.del(`/api/servers/${server.id}/sf-mods/${encodeURIComponent(ref)}`);
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  on(root, 'click', '#sf-sync', async () => {
    try {
      await api.post(`/api/servers/${server.id}/sf-mods/sync`);
      toast('Installing mods', 'ok');
      navigate(`/server/${server.id}/overview`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  await draw();
}

// Search ficsit.app in a modal. Resolves to the picked mods, or null.
function pickFicsit(server, have) {
  return pickFromSearch({
    title: 'Add Satisfactory mods',
    placeholder: 'Search ficsit.app…',
    multi: true,
    search: async (q) => (await api.get(`/api/servers/${server.id}/sf-mods/search?q=${encodeURIComponent(q)}`)).mods,
    describe: (m) => ({
      key: m.ref,
      name: m.name,
      summary: m.summary,
      logo: m.logo,
      disabled: have.has(m.ref),
      meta: html`${icon('download')}${fmtNum(m.downloads)} · ${m.ref}${have.has(m.ref) ? ' · already added' : ''}`,
    }),
  });
}

// ---------- 7 Days to Die ----------
async function renderSdtd(root, { server }) {
  const draw = async () => {
    const { mods, eac, running } = await api.get(`/api/servers/${server.id}/sdtd-mods`);
    const codeMods = mods.filter((m) => m.enabled && m.code && !m.builtin);
    root.innerHTML = html`
      ${codeMods.length && eac
        ? html`<div class="callout callout-warn">${icon('alert')}<div><strong>Easy Anti-Cheat is on, but ${codeMods.map((m) => m.name).join(', ')} ${codeMods.length === 1 ? 'has' : 'have'} its own code (.dll).</strong>
            Code mods only load with EAC off: turn it off in <a href="#/server/${server.id}/settings">Settings → Advanced</a>. Players then start the game without EAC too.</div></div>`
        : ''}
      <div class="panel">
        <div class="panel-head"><h3>Mods <span class="count">${mods.filter((m) => !m.builtin).length}</span></h3>
          <div class="btn-row"><label class="btn btn-sm btn-primary">${icon('upload')}Install from .zip<input type="file" id="sdtd-zip" accept=".zip,application/zip" hidden></label>
            <a class="btn btn-sm btn-ghost" href="https://www.nexusmods.com/7daystodie" target="_blank" rel="noopener">${icon('external')}Find mods</a></div></div>
        <p class="muted small">Download a mod's <strong>.zip</strong> (from Nexus Mods, 7daystodiemods.com, GitHub…) and install it here — the panel finds the mod folders (with a ModInfo.xml) inside and puts them in <code>Mods</code>, replacing older copies.
          Server-side mods (XML only) work for everyone right away; mods with new models, sounds or UI also need to be installed by each player. ${running ? html`<strong>Restart the server to apply changes.</strong>` : ''}</p>
        <div id="sdtd-progress"></div>
        ${mods.length
          ? html`<table class="table"><thead><tr><th>Mod</th><th>Version</th><th class="right">Enabled</th><th></th></tr></thead><tbody>
            ${mods.map((m) => html`<tr data-folder="${m.folder}">
              <td><strong>${m.name}</strong>${m.builtin ? html` <span class="pill">built in</span>` : ''}${m.code ? html` <span class="pill pill-warn" title="Contains .dll files: needs EAC off">code</span>` : ''}${!m.valid ? html` <span class="pill pill-bad" title="No ModInfo.xml: the game ignores this folder">no ModInfo.xml</span>` : ''}
                <div class="muted small">${m.author ? 'by ' + m.author + ' · ' : ''}<span class="mono">${m.folder}</span>${m.website ? html` · <a href="${webUrl(m.website)}" target="_blank" rel="noopener">page</a>` : ''}</div>
                ${m.description ? html`<div class="muted small">${m.description}</div>` : ''}</td>
              <td>${m.version || '—'}</td>
              <td class="right">${m.builtin ? html`<span class="muted small">always</span>` : html`<label class="switch"><input type="checkbox" data-sdtd-toggle ${m.enabled ? 'checked' : ''} aria-label="Enabled"><span></span></label>`}</td>
              <td class="right">${m.builtin ? '' : html`<button class="icon-btn" data-sdtd-del title="Delete">${icon('trash')}</button>`}</td></tr>`)}
            </tbody></table>`
          : html`<p class="muted">No mods yet.</p>`}
      </div>
      ${gameUpdatesPanel('Updates the 7 Days to Die server through SteamCMD (pick stable or experimental in Settings → Advanced). The server is stopped, backed up and started again if it was running. Mods may need updating after a new game version.')}`.s;
    $('#sdtd-zip').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const box = $('#sdtd-progress');
      box.innerHTML = html`<div class="mini-job"><div class="bar"><span style="width:2%"></span></div><small>Uploading ${file.name}…</small></div>`.s;
      try {
        const r = await api.upload(`/api/servers/${server.id}/sdtd-mods/upload`, file, (p) => {
          const bar = box.querySelector('.bar span');
          if (bar) bar.style.width = `${Math.round(p * 100)}%`;
          if (p >= 1) box.querySelector('small').textContent = 'Installing…';
        });
        toast(`Installed ${r.installed.join(', ')}${r.restartRequired ? ' — restart to apply' : ''}`, 'ok', 6000);
        draw();
      } catch (err) {
        box.innerHTML = '';
        toast(err.message, 'error', 8000);
      }
    };
  };
  on(root, 'change', '[data-sdtd-toggle]', async (_e, el) => {
    const folder = el.closest('tr').dataset.folder;
    try {
      await api.patch(`/api/servers/${server.id}/sdtd-mods/${encodeURIComponent(folder)}`, { enabled: el.checked });
      draw();
    } catch (err) {
      toast(err.message, 'error');
      el.checked = !el.checked;
    }
  });
  on(root, 'click', '[data-sdtd-del]', async (_e, el) => {
    const folder = el.closest('tr').dataset.folder;
    if (!(await confirmBox('Delete mod?', `Delete the ${folder} folder from the server?`, { danger: true, confirm: 'Delete' }))) return;
    try {
      await api.del(`/api/servers/${server.id}/sdtd-mods/${encodeURIComponent(folder)}`);
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  await draw();
}

// ---------- Rust (uMod plugins) ----------
async function renderRust(root, { server, navigate }) {
  let state = null;
  const base = `/api/servers/${server.id}/rust-plugins`;
  const draw = async () => {
    state = await api.get(base);
    const { plugins, oxide, running, canUpload } = state;
    const updates = plugins.filter((p) => p.update);
    root.innerHTML = html`
      ${!oxide.enabled
        ? html`<div class="callout">${icon('info')}<div><strong>uMod is off: this is a vanilla Rust server.</strong> To use plugins, turn on <em>Use uMod (Oxide) plugins</em> in <a href="#/server/${server.id}/settings">Settings → uMod</a>, then install uMod below.</div></div>`
        : !oxide.installed
        ? html`<div class="callout callout-warn">${icon('alert')}<div><strong>uMod isn't installed yet.</strong> Install it below (with the server stopped) so plugins can load.</div></div>`
        : ''}
      <div class="panel">
        <div class="panel-head"><h3>uMod (Oxide)</h3>
          <div class="btn-row"><button class="btn btn-sm" id="rust-oxide" ${!oxide.enabled || running ? 'disabled' : ''} ${running ? 'title="Stop the server first"' : ''}>${icon('download')}${oxide.installed ? 'Update uMod' : 'Install uMod'}</button>
            <a class="btn btn-sm btn-ghost" href="https://umod.org/games/rust" target="_blank" rel="noopener">${icon('external')}umod.org</a></div></div>
        <p class="muted small">${oxide.installed ? html`Installed${oxide.version ? html`: <strong>${oxide.version}</strong>` : ''}${oxide.installedAt ? ` (${fmtDate(oxide.installedAt)})` : ''}.` : 'Not installed.'}
          uMod is the mod framework that loads plugins. Every Rust update replaces it, so the panel installs it again after each game update; use this button when uMod releases a fix between game updates.</p>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Plugins <span class="count">${plugins.length}</span></h3>
          <div class="btn-row">
            ${updates.length ? html`<button class="btn btn-sm btn-primary" id="rust-update-all">${icon('arrowUp')}Update all (${updates.length})</button>` : ''}
            <button class="btn btn-sm ${updates.length ? '' : 'btn-primary'}" id="rust-browse" ${oxide.enabled ? '' : 'disabled'}>${icon('search')}Browse uMod</button>
            ${canUpload && oxide.enabled ? html`<label class="btn btn-sm btn-ghost" title="Admins only: a plugin from somewhere other than uMod">${icon('upload')}Upload .cs<input type="file" id="rust-cs" accept=".cs" hidden></label>` : ''}
          </div></div>
        <p class="muted small">Plugins come from <a href="https://umod.org/plugins?categories=rust" target="_blank" rel="noopener">umod.org</a>. uMod loads new, updated and switched-on plugins by itself${running ? ' while the server runs' : ' when the server starts'} — no restart needed.
          Change their settings in the <a href="#/server/${server.id}/modconfig">Mod configuration</a> tab. Many plugins also need permissions: <code>oxide.grant group default &lt;permission&gt;</code> in the Console.</p>
        ${plugins.length
          ? html`<input class="filter" id="rust-filter" placeholder="Filter plugins…">
            <ul class="mod-list unordered" id="rust-list">${plugins.map(
              (p) => html`<li data-name="${p.name}" data-search="${`${p.title} ${p.name} ${p.author}`.toLowerCase()}">${modLogo({ logo: p.umod && p.umod.logo })}
                <div class="mod-text"><span><strong>${p.title}</strong> ${p.update ? html`<span class="pill pill-warn" title="Newer version on uMod">${p.umod.version} available</span>` : ''}${!p.enabled ? html` <span class="pill pill-tag">off</span>` : ''}</span>
                  ${p.description ? html`<small>${p.description}</small>` : ''}
                  <small class="mono">${p.version ? `v${p.version}` : 'no version'}${p.author ? ` · by ${p.author}` : ''} · ${p.name}.cs${p.umod ? html` · <a href="${webUrl(p.umod.url)}" target="_blank" rel="noopener">uMod page</a>` : html` · <span class="muted">not on uMod</span>`}</small></div>
                <div class="btn-row">
                  ${p.update ? html`<button class="btn btn-sm" data-rust-update title="Install ${p.umod.version} from uMod">${icon('arrowUp')}Update</button>` : ''}
                  ${p.hasConfig ? html`<a class="icon-btn" href="#/server/${server.id}/modconfig" title="Settings">${icon('edit')}</a>` : ''}
                  <label class="switch" title="${p.enabled ? 'Turn off' : 'Turn on'}"><input type="checkbox" data-rust-toggle ${p.enabled ? 'checked' : ''} aria-label="Enabled"><span></span></label>
                  <button class="icon-btn" data-rust-remove title="Remove">${icon('trash')}</button></div></li>`
            )}</ul>`
          : html`<p class="muted">${oxide.enabled ? 'No plugins yet. Browse uMod to add some — popular first picks: Gather Manager, Stack Size Controller, Rust Kits, Better Chat.' : 'Turn on uMod to add plugins.'}</p>`}
      </div>
      ${gameUpdatesPanel(`Updates Rust through SteamCMD${oxide.enabled ? ', then installs uMod again (game updates replace it)' : ''}. The server is stopped, backed up and started again if it was running. Rust updates on the first Thursday of every month; servers must update before players can join again.`)}`.s;

    const filter = $('#rust-filter');
    if (filter) filter.oninput = () => root.querySelectorAll('#rust-list li').forEach((li) => (li.hidden = !li.dataset.search.includes(filter.value.toLowerCase())));
    const cs = $('#rust-cs');
    if (cs) cs.onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const r = await api.upload(`${base}/upload/${encodeURIComponent(file.name.replace(/\.cs$/i, ''))}`, file);
        toast(`Installed ${r.title} ${r.version}${r.live ? ' — uMod is loading it' : ''}`, 'ok', 6000);
        draw();
      } catch (err) {
        toast(err.message, 'error', 8000);
      }
    };
  };

  const install = async (names) => {
    try {
      const r = await api.post(base, { names });
      for (const p of r.installed) toast(`Installed ${p.title} ${p.version}${r.live ? ' — uMod is loading it' : ''}`, 'ok', 5000);
      for (const f of r.failed) toast(`${f.name}: ${f.error}`, 'error', 8000);
    } catch (err) {
      toast(err.message, 'error', 8000);
    }
    draw();
  };

  on(root, 'click', '#rust-browse', async () => {
    const picked = await pickUmod(server, new Set(state.plugins.map((p) => p.name.toLowerCase())));
    if (picked && picked.length) await install(picked.map((p) => p.name));
  });
  on(root, 'click', '#rust-update-all', () => install(state.plugins.filter((p) => p.update).map((p) => p.name)));
  on(root, 'click', '[data-rust-update]', (_e, el) => install([el.closest('[data-name]').dataset.name]));
  on(root, 'change', '[data-rust-toggle]', async (_e, el) => {
    const name = el.closest('[data-name]').dataset.name;
    try {
      await api.patch(`${base}/${encodeURIComponent(name)}`, { enabled: el.checked });
      draw();
    } catch (err) {
      toast(err.message, 'error');
      el.checked = !el.checked;
    }
  });
  on(root, 'click', '[data-rust-remove]', async (_e, el) => {
    const name = el.closest('[data-name]').dataset.name;
    const p = state.plugins.find((x) => x.name === name);
    if (!(await confirmBox('Remove plugin?', `Remove ${p ? p.title : name}? Its settings and data are kept, so installing it again later picks up where it left off.`, { danger: true, confirm: 'Remove' }))) return;
    try {
      await api.del(`${base}/${encodeURIComponent(name)}`);
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  on(root, 'click', '#rust-oxide', async () => {
    try {
      await api.post(`${base}/oxide`, {});
      toast('Installing uMod', 'ok');
      navigate(`/server/${server.id}/overview`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  await draw();
}

function pickUmod(server, have) {
  return pickFromSearch({
    title: 'Add uMod plugins',
    placeholder: 'Search uMod plugins for Rust…',
    intro: html`<p class="muted small">Most downloaded first. Plugins run on the server only — players don't install anything.</p>`,
    multi: true,
    search: async (q) => (await api.get(`/api/servers/${server.id}/rust-plugins/search?q=${encodeURIComponent(q)}`)).plugins,
    describe: (p) => ({
      key: p.name,
      name: p.title,
      summary: p.summary,
      logo: p.logo,
      disabled: have.has(p.name.toLowerCase()),
      meta: html`${icon('download')}${fmtNum(p.downloads)} · v${p.version}${p.author ? ` · ${p.author}` : ''}${have.has(p.name.toLowerCase()) ? ' · installed' : ''}`,
    }),
  });
}
