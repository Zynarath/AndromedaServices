import { api } from '../../api.js';
import { html, $, on, icon, toast, fmtBytes, confirmBox, fmtDate } from '../../ui.js';
import { pickCurseForge } from '../cfpicker.js';

export async function render(root, ctx) {
  const { server } = ctx;
  if (server.ark) return renderArk(root, ctx);
  if (server.cod) return renderCod(root, ctx);
  return renderMc(root, ctx);
}

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
              ${mc.curseforge.url ? html`<a class="small" href="${mc.curseforge.url}" target="_blank" rel="noopener">View on CurseForge ${icon('external')}</a>` : ''}</div></div>
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
      api.get('/api/minecraft/versions').then((r) => ($('#mcv').innerHTML = r.versions.slice(0, 150).map((v) => `<option value="${v}">`).join(''))).catch(() => {});
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
async function renderArk(root, { server, navigate }) {
  let mods = (await api.get(`/api/servers/${server.id}/ark-mods`)).mods;
  const asa = server.ark.edition === 'asa';
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
            <div class="mod-text"><strong>${m.name || 'Mod ' + m.id}</strong><small class="mono">${m.id}${m.url ? html` · <a href="${m.url}" target="_blank" rel="noopener">page</a>` : ''}</small></div>
            <div class="btn-row"><button class="icon-btn" data-move="-1" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button><button class="icon-btn" data-move="1" ${i === mods.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
            <button class="icon-btn" data-remove title="Remove">${icon('trash')}</button></div></li>`)}
        </ol>
        ${!mods.length ? html`<p class="muted">No mods yet.</p>` : ''}
      </div>
      <div class="panel">
        <h3>Game updates</h3>
        <p class="muted small">Updates the ARK dedicated server through SteamCMD. The server is stopped, backed up and started again if it was running. Players need the same game version as the server.</p>
        <div class="btn-row"><button class="btn btn-primary" data-ark-update="0">${icon('download')}Update server</button><button class="btn" data-ark-update="1">${icon('check')}Update &amp; validate files</button></div>
      </div>`.s;
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
  on(root, 'click', '[data-ark-update]', async (_e, el) => {
    try {
      await api.post(`/api/servers/${server.id}/update`, { validate: el.dataset.arkUpdate === '1' });
      toast('Update started', 'ok');
      navigate(`/server/${server.id}/overview`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  draw();
}

// ---------- Call of Duty ----------
async function renderCod(root, { server, navigate }) {
  const c = server.cod;
  const engine = c.title === 'cod4x' ? 'CoD4x server files' : c.pluto ? 'Plutonium' : 'IW4x';
  root.innerHTML = html`
    <div class="panel">
      <h3>Bots</h3>
      <p>${c.botsVersion ? html`<span class="pill pill-ok">${icon('check')}Bot Warfare ${c.botsVersion}</span>` : html`<span class="pill pill-warn">not installed</span>`}
        ${c.bots.enabled ? html` · fills to ${c.bots.fill} players` : ' · bots are off in Settings'}</p>
      <p class="muted small">Bots come from the Bot Warfare mod (by ineedbots). ${c.pluto ? 'It is loaded from Plutonium\'s storage folder, so players don\'t need to download anything.' : 'It runs as a server-only mod (mods/mp_bots/z_svr_bots.iwd), so players don\'t need to download anything.'}</p>
      <button class="btn" data-cod-update="bots">${icon('download')}${c.botsVersion ? 'Update' : 'Install'} Bot Warfare</button>
    </div>
    <div class="panel">
      <h3>${engine}</h3>
      <p class="muted small">${c.title === 'iw4x' ? 'IW4x is updated by its own launcher on your PC; this re-checks the game folder and rewrites the config.' : `Downloads the latest ${engine} and rewrites the config. The server is stopped first and started again if it was running.`}</p>
      <button class="btn btn-primary" data-cod-update="engine">${icon('refresh')}Update ${engine}</button>
    </div>`.s;
  on(root, 'click', '[data-cod-update]', async () => {
    try {
      await api.post(`/api/servers/${server.id}/update`, { reinstallBots: true });
      toast('Update started', 'ok');
      navigate(`/server/${server.id}/overview`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
