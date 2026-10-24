import { api } from '../api.js';
import { html, $, $$, on, icon, toast, esc } from '../ui.js';
import { pickCurseForge } from './cfpicker.js';

const ART = { ark: 'ark', 'ark-ase': 'ark', 'mc-cf': 'mc-cf', mc: 'mc', cod: 'cod', wow: 'wow' };

export async function render(root, { navigate, refreshServers }) {
  const [{ templates, curseforgeKey, platform }, { servers: existing }] = await Promise.all([api.get('/api/templates'), api.get('/api/servers')]);
  // "Ark SE Server 1", "Ark SE Server 2"... skipping numbers already taken.
  const nextName = (prefix) => {
    for (let n = 1; ; n++) if (!existing.some((x) => x.name.toLowerCase() === `${prefix} ${n}`.toLowerCase())) return `${prefix} ${n}`;
  };
  const words = ['raptor', 'trike', 'rex', 'dodo', 'stego', 'ptera', 'carno', 'bronto', 'creeper', 'ender'];
  const friendlyPassword = () => `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;
  let autoName = '';
  let tpl = null;
  let pack = null; // { mod, fileId }

  const chooser = () => {
    root.innerHTML = html`
      <div class="page-head"><div><h1>Create a server</h1><p class="muted">Pick a game. Files are downloaded and installed automatically.</p></div></div>
      <div class="tpl-grid">
        ${templates.map(
          (t) => html`<button class="tpl ${t.supported ? '' : 'tpl-disabled'}" data-tpl="${t.id}" ${t.supported ? '' : 'disabled'}>
            <span class="tpl-art art-${ART[t.image]}"><span class="art-mono">${t.game === 'ark' ? 'ARK' : t.game === 'cod' ? t.namePrefix.split(' ')[0] : t.game === 'wow' ? 'WoW' : 'MC'}</span></span>
            <span class="tpl-text"><strong>${t.title}</strong><small>${t.supported ? t.subtitle : `Not available on ${platform === 'win32' ? 'Windows' : platform} — needs Windows`}</small></span>
          </button>`
        )}
      </div>`.s;
    on(root, 'click', '[data-tpl]', (_e, el) => {
      tpl = templates.find((t) => t.id === el.dataset.tpl);
      form();
    });
  };

  const form = async () => {
    const isMc = tpl.game === 'minecraft';
    const ports = tpl.game === 'wow' ? {} : await api.get(`/api/servers/suggest-ports?game=${tpl.game}&title=${tpl.codTitle || ''}`).catch(() => ({}));
    root.innerHTML = html`
      <div class="page-head"><div>
        <button class="link-btn" id="back">← All games</button>
        <h1>${tpl.title}</h1></div></div>
      <form id="create-form" class="panel form-grid">
        <label class="field span-2"><span>Server name</span><input name="name" required maxlength="48" value="${tpl.namePrefix ? nextName(tpl.namePrefix) : ''}" placeholder="${isMc ? 'Filled in from the modpack name' : 'Ark SE Server 1'}">
          <small class="hint">Also used for this server's Discord channel.</small></label>
        ${tpl.id === 'mc-curseforge' ? cfSection(curseforgeKey) : ''}
        ${tpl.id === 'mc-custom' ? mcCustomSection() : ''}
        ${isMc ? mcCommon(ports) : tpl.game === 'cod' ? codSection(tpl, ports) : tpl.game === 'wow' ? wowSection() : arkSection(tpl, ports)}
        <div class="form-actions span-2">
          <button class="btn btn-primary" type="submit">${icon('plus')}Create &amp; install</button>
          <span class="muted small">You can change all of this later in the server's Settings tab.</span>
        </div>
      </form>`.s;
    $('#back').onclick = chooser;
    const f = $('#create-form');
    if (tpl.id === 'mc-custom') setupCustom(f);
    if (tpl.id === 'mc-curseforge') setupCf(f);
    if (tpl.game === 'wow') setupWow(f);
    if (tpl.game === 'ark' && tpl.edition === 'asa' && curseforgeKey) {
      $('#ark-mod-search').onclick = async () => {
        const picked = await pickCurseForge({ type: 'asa', title: 'Add ARK: Survival Ascended mods', multi: true });
        if (!picked) return;
        const cur = f.mods.value.split(',').map((x) => x.trim()).filter(Boolean);
        f.mods.value = [...new Set([...cur, ...picked.map((m) => String(m.id))])].join(',');
      };
    }
    const mem = f.memoryMb;
    if (mem) mem.oninput = () => ($('#mem-label').textContent = (mem.value / 1024).toFixed(1) + ' GB');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const body = { template: tpl.id, name: d.name, eulaAccepted: !!d.eula };
      if (tpl.game === 'wow') {
        body.wow = { root: d.root, realmName: d.realmName || d.name };
      } else if (tpl.game === 'cod') {
        body.cod = {
          gameDir: d.gameDir, port: Number(d.port), password: d.password, maxClients: Number(d.maxClients), gametype: 'dom',
          xpScale: Number(d.xpScale), weaponXpScale: Number(d.weaponXpScale || d.xpScale), plutoKey: d.plutoKey,
          bots: { enabled: !!d.bots, fill: Number(d.botFill), skill: Number(d.botSkill), kick: true },
        };
      } else if (isMc) {
        body.mc = { memoryMb: Number(d.memoryMb), port: Number(d.port), maxPlayers: Number(d.maxPlayers), whitelist: !!d.whitelist, whitelistNames: d.whitelistNames };
        if (tpl.id === 'mc-curseforge') {
          if (!pack) return toast('Pick a modpack first', 'warn');
          Object.assign(body.mc, { modId: pack.mod.id, fileId: Number(d.fileId) });
        } else {
          Object.assign(body.mc, { mcVersion: d.mcVersion, loader: d.loader, loaderVersion: d.loaderVersion || null });
        }
      } else {
        body.ark = {
          edition: tpl.edition, map: d.map === '__custom' ? d.customMap : d.map, sessionName: d.sessionName || d.name, maxPlayers: Number(d.maxPlayers),
          serverPassword: d.serverPassword, adminPassword: d.adminPassword, mods: d.mods, port: Number(d.port), queryPort: Number(d.queryPort), rconPort: Number(d.rconPort),
        };
      }
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const r = await api.post('/api/servers', body);
        toast('Server created — installing now', 'ok');
        await refreshServers();
        navigate(`/server/${r.server.id}`);
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    };
  };

  function cfSection(hasKey) {
    if (!hasKey) {
      return html`<div class="callout callout-warn span-2">${icon('key')}<div><strong>CurseForge API key needed.</strong>
        Get a free key at <a href="https://console.curseforge.com/" target="_blank" rel="noopener">console.curseforge.com</a> and paste it in
        <a href="#/settings">Panel settings</a>. It lets the panel search and download modpacks.</div></div>`;
    }
    return html`<div class="field span-2"><span>Modpack</span>
        <div id="pack-box" class="pack-box"><button type="button" class="btn" id="pick-pack">${icon('search')}Browse CurseForge modpacks</button></div></div>
      <label class="field span-2" id="file-field" hidden><span>Version</span><select name="fileId" id="file-select"></select>
        <small class="hint">Newest first. The panel uses the pack's official server files when available.</small></label>`;
  }

  function setupCf(f) {
    const btn = $('#pick-pack');
    if (!btn) return;
    const choose = async () => {
      const picked = await pickCurseForge({ type: 'modpack', title: 'Choose a modpack' });
      if (!picked) return;
      const mod = picked[0];
      pack = { mod };
      if (!f.name.value || f.name.value === autoName) f.name.value = autoName = mod.name.slice(0, 48);
      $('#pack-box').innerHTML = html`<div class="pack-chosen">${mod.logo ? html`<img src="${mod.logo}" alt="">` : ''}
        <div><strong>${mod.name}</strong><small>${mod.summary}</small></div><button type="button" class="btn btn-sm" id="pick-pack">Change</button></div>`.s;
      $('#pick-pack').onclick = choose;
      const sel = $('#file-select');
      sel.innerHTML = '<option>Loading versions…</option>';
      $('#file-field').hidden = false;
      try {
        const { files } = await api.get(`/api/curseforge/mods/${mod.id}/files`);
        sel.innerHTML = files
          .map((x) => html`<option value="${x.id}">${x.name} — MC ${x.gameVersions.filter((v) => /^\d/.test(v)).join(', ')}${x.releaseType !== 'release' ? ' (' + x.releaseType + ')' : ''}${x.serverPackFileId ? ' · server pack' : ''}</option>`.s)
          .join('');
      } catch (err) {
        sel.innerHTML = '';
        toast(err.message, 'error');
      }
    };
    btn.onclick = choose;
  }

  function mcCustomSection() {
    return html`
      <label class="field"><span>Minecraft version</span><select name="mcVersion" id="mc-version"><option>Loading…</option></select></label>
      <label class="field"><span>Mod loader</span><select name="loader" id="mc-loader">
        <option value="vanilla">Vanilla (no mods)</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option></select></label>
      <label class="field span-2"><span>Loader version</span><select name="loaderVersion" id="loader-version" disabled><option value="">Latest recommended</option></select></label>`;
  }

  async function setupCustom(f) {
    const vSel = $('#mc-version');
    try {
      const { versions } = await api.get('/api/minecraft/versions');
      vSel.innerHTML = versions.map((v) => `<option>${esc(v)}</option>`).join('');
    } catch (err) {
      vSel.outerHTML = '<input name="mcVersion" id="mc-version" placeholder="e.g. 1.21.1" required>';
      toast(`Couldn't load the version list: ${err.message}`, 'warn');
    }
    const refresh = async () => {
      const loader = f.loader.value;
      const lv = $('#loader-version');
      lv.innerHTML = '<option value="">Latest recommended</option>';
      lv.disabled = loader === 'vanilla';
      if (loader === 'vanilla') return;
      try {
        const { versions } = await api.get(`/api/minecraft/loaders/${loader}?mc=${encodeURIComponent(f.mcVersion.value)}`);
        if (!versions.length) toast(`${loader} has no builds for ${f.mcVersion.value}`, 'warn');
        lv.innerHTML += versions.map((v) => `<option value="${esc(v.version)}">${esc(v.version)}${v.recommended ? ' (recommended)' : v.stable === false ? ' (beta)' : ''}</option>`).join('');
      } catch {}
    };
    f.loader.onchange = refresh;
    f.addEventListener('change', (e) => e.target.name === 'mcVersion' && refresh());
  }

  function mcCommon(ports) {
    return html`
      <label class="field"><span>Memory: <strong id="mem-label">6.0 GB</strong></span><input type="range" name="memoryMb" min="2048" max="24576" step="512" value="6144">
        <small class="hint">Modded packs: 6–10 GB. Leave plenty for the game you're playing at the same time.</small></label>
      <label class="field"><span>Max players</span><input type="number" name="maxPlayers" value="10" min="1" max="500"></label>
      <label class="field"><span>Port (TCP)</span><input type="number" name="port" value="${ports.port || 25565}" min="1024" max="65535"></label>
      <div></div>
      <label class="switch field-switch span-2"><input type="checkbox" name="whitelist" checked><span></span>Friends only (whitelist)
        <small class="hint">Minecraft has no join passwords — the whitelist is how you keep it private. Only listed players can join.</small></label>
      <label class="field span-2"><span>Your group's Minecraft usernames</span><input name="whitelistNames" placeholder="e.g. YourName, FriendName" autocomplete="off">
        <small class="hint">Comma-separated. Added automatically the first time the server starts; manage later in the Players tab.</small></label>
      <label class="check span-2"><input type="checkbox" name="eula" required> I agree to the <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noopener">Minecraft EULA</a></label>`;
  }

  function wowSection() {
    return html`
      <div class="callout span-2">${icon('info')}<div>Andromeda Hosting runs the <strong>SPP Classics V2</strong> server package (cMaNGOS + Mangosbot bots + its own MySQL and map data).
        Install it first: download <a href="https://github.com/celguar/spp-classics-cmangos/releases/tag/v2.0" target="_blank" rel="noopener">SPP_Classics_V2.exe</a>,
        extract it, run <code>Server_Update.bat</code>, choose <strong>WotLK</strong> and let it finish downloading — then close it. Any other cMaNGOS WotLK folder works too.</div></div>
      <label class="field span-2"><span>Server folder</span><div class="input-row"><input name="root" required placeholder="e.g. C:\\Games\\SPP_Classics_V2" autocomplete="off"><button type="button" class="btn" id="wow-check">${icon('search')}Check</button></div>
        <small class="hint">The SPP_Classics_V2 folder (or its SPP_Server folder). The panel uses the files where they are; nothing is copied.</small></label>
      <div id="wow-detect" class="span-2"></div>
      <label class="field span-2"><span>Realm name</span><input name="realmName" maxlength="32" placeholder="Same as the server name"></label>
      <div class="callout span-2">${icon('shield')}<div><strong>Friends only:</strong> nobody can sign up by themselves. You create an account for each friend in the server's <em>Accounts</em> tab.</div></div>`;
  }

  function setupWow(f) {
    const box = $('#wow-detect');
    const check = async () => {
      if (!f.root.value.trim()) return;
      box.innerHTML = '<div class="loading">Checking…</div>';
      try {
        const d = await api.get(`/api/wow/detect?path=${encodeURIComponent(f.root.value)}`);
        const row = (ok, label) => html`<li class="${ok ? 'ok' : 'bad'}">${icon(ok ? 'check' : 'x')} ${label}</li>`;
        box.innerHTML = html`<div class="panel detect">
          <strong>${d.layout === 'spp' ? 'SPP Classics install found' : d.layout === 'custom' ? 'cMaNGOS folder found' : 'Not a WotLK server folder'}</strong> <span class="muted small mono">${d.root}</span>
          ${d.layout ? html`<ul class="checklist">${row(d.found.mangosd, 'World server (mangosd)')}${row(d.found.realmd, 'Login server (realmd)')}${row(d.found.mangosdConf && d.found.realmdConf, 'Config files')}
            ${row(d.found.botsConf, 'Bots config (aiplayerbot.conf)')}${row(d.found.mapData, 'Map data (dbc + maps)')}${row(d.found.database, 'Bundled MySQL (started by the panel)')}</ul>` : ''}
          ${d.problems.length ? html`<div class="form-error">${d.problems.join(' ')}</div>` : html`<p class="small">${icon('check')} Ready to add.</p>`}</div>`.s;
      } catch (err) {
        box.innerHTML = html`<div class="form-error">${err.message}</div>`.s;
      }
    };
    $('#wow-check').onclick = check;
    f.root.addEventListener('change', check);
  }

  function codSection(t, ports) {
    return html`
      <label class="field span-2"><span>Game folder</span><input name="gameDir" required placeholder="${t.gameHint}" autocomplete="off">
        <small class="hint">Your own install of the game. ${t.codTitle === 'iw4x' ? 'IW4x must already be installed in it (iw4x.exe).' : t.codTitle === 'cod4x' ? 'Andromeda Hosting downloads the CoD4x server files itself.' : 'Andromeda Hosting downloads and updates Plutonium itself.'}</small></label>
      ${t.pluto
        ? html`<label class="field span-2"><span>Plutonium server key</span><input name="plutoKey" required autocomplete="off" placeholder="Paste key">
            <small class="hint">Free: sign in at <a href="https://platform.plutonium.pw/serverkeys" target="_blank" rel="noopener">platform.plutonium.pw/serverkeys</a> and create a key.</small></label>`
        : ''}
      <div class="callout span-2">${icon('info')}<div><strong>Domination</strong> with every base map in a shuffled rotation, <strong>4x XP</strong>${t.weaponXp ? ' and <strong>4x weapon XP</strong>' : ''}, and bots filling empty slots. All of it can be changed later in Settings.</div></div>
      <label class="field"><span>Player XP multiplier</span><input type="number" name="xpScale" value="4" min="1" max="100"></label>
      ${t.weaponXp ? html`<label class="field"><span>Weapon XP multiplier</span><input type="number" name="weaponXpScale" value="4" min="1" max="100"></label>` : html`<div></div>`}
      <label class="switch field-switch span-2"><input type="checkbox" name="bots" checked><span></span>Bots (Bot Warfare)
        <small class="hint">Bots fill the match and step aside as your friends join.</small></label>
      <label class="field"><span>Keep this many players in a match</span><input type="number" name="botFill" value="12" min="0" max="18"><small class="hint">Bots + people. 12 = 6v6.</small></label>
      <label class="field"><span>Bot difficulty</span><select name="botSkill"><option value="0">Mixed</option><option value="1">1 – Recruit</option><option value="3">3 – Regular</option><option value="5">5 – Hardened</option><option value="7">7 – Veteran</option></select></label>
      <label class="field"><span>Join password</span><input name="password" autocomplete="off" value="${friendlyPassword()}"><small class="hint">Your friends need it to join. Clear it to make the server public.</small></label>
      <label class="field"><span>Max players</span><input type="number" name="maxClients" value="18" min="2" max="64"></label>
      <details class="span-2 adv"><summary>Port</summary><div class="form-grid">
        <label class="field"><span>Port (UDP)</span><input type="number" name="port" value="${ports.port || t.port}"></label></div></details>`;
  }

  function arkSection(t, ports) {
    const maps = t.edition === 'asa'
      ? ['TheIsland_WP', 'ScorchedEarth_WP', 'TheCenter_WP', 'Aberration_WP', 'Extinction_WP', 'Ragnarok_WP', 'Valguero_WP', 'Astraeos_WP', 'LostColony_WP']
      : ['TheIsland', 'TheCenter', 'ScorchedEarth_P', 'Ragnarok', 'Aberration_P', 'Extinction', 'Valguero_P', 'Genesis', 'Gen2', 'CrystalIsles', 'LostIsland', 'Fjordur'];
    return html`
      <label class="field"><span>Map</span><select name="map" id="ark-map">${maps.map((m) => html`<option>${m}</option>`)}<option value="__custom">Other / mod map…</option></select></label>
      <label class="field" id="custom-map" hidden><span>Map name</span><input name="customMap" placeholder="e.g. Svartalfheim_WP"></label>
      <label class="field"><span>Max players</span><input type="number" name="maxPlayers" value="20" min="1" max="200"></label>
      <label class="field"><span>Name in server list</span><input name="sessionName" maxlength="60" placeholder="Same as server name"></label>
      <label class="field"><span>Join password</span><input name="serverPassword" autocomplete="off" value="${friendlyPassword()}">
        <small class="hint">Your friends type this to join. Clear it to make the server public.</small></label>
      <label class="field"><span>Admin password</span><input name="adminPassword" autocomplete="off" placeholder="Generated if left blank"></label>
      <label class="field span-2"><span>Mods (${t.edition === 'asa' ? 'CurseForge project IDs' : 'Steam Workshop IDs'}, comma-separated)</span>
        <div class="input-row"><input name="mods" placeholder="${t.edition === 'asa' ? 'e.g. 928988,929420' : 'e.g. 731604991,889745138'}">
          ${t.edition === 'asa' ? html`<button type="button" class="btn" id="ark-mod-search">${icon('search')}Browse</button>` : ''}</div>
        <small class="hint">${t.edition === 'asa' ? 'ASA downloads mods automatically when the server starts.' : 'Steam Workshop IDs. Downloaded on start with -automanagedmods.'}</small></label>
      <details class="span-2 adv"><summary>Ports</summary><div class="form-grid">
        <label class="field"><span>Game port (UDP)</span><input type="number" name="port" value="${ports.port || 7777}"></label>
        <label class="field"><span>RCON port (TCP, local)</span><input type="number" name="rconPort" value="${ports.rconPort || 27020}"></label>
        ${t.edition === 'ase' ? html`<label class="field"><span>Query port (UDP)</span><input type="number" name="queryPort" value="${ports.queryPort || 27015}"></label>` : html`<input type="hidden" name="queryPort" value="${ports.queryPort || 27015}">`}
      </div></details>
      <div class="callout span-2">${icon('info')}<div>The first install downloads about 10–15 GB through SteamCMD. ARK with mods typically uses 10–16 GB of RAM while running.</div></div>`;
  }

  root.addEventListener('change', (e) => {
    if (e.target.id === 'ark-map') $('#custom-map').hidden = e.target.value !== '__custom';
  });
  chooser();
}
