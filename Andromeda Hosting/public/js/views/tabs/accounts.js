import { api } from '../../api.js';
import { html, $, on, icon, toast, fmtDate, confirmBox, modal } from '../../ui.js';

const GM = ['Player', 'Moderator', 'Game master', 'Admin'];

// WoW game accounts. Nobody can register on their own, so the realm stays friends-only.
export async function render(root, { server }) {
  const base = `/api/servers/${server.id}/wow/accounts`;
  const draw = async () => {
    const r = await api.get(base);
    root.innerHTML = html`
      <div class="panel">
        <div class="panel-head"><h3>Game accounts <span class="count">${r.accounts.length}</span></h3>
          <button class="btn btn-primary btn-sm" id="add" ${r.running ? '' : 'disabled'}>${icon('plus')}New account</button></div>
        <p class="muted small">Only accounts you create here can log in — there's no public sign-up, so the realm stays friends-only. Bot accounts are hidden.</p>
        ${!r.running ? html`<div class="callout callout-warn">${icon('info')}<div>Start the server to create or change accounts (they're made through the world server's console).</div></div>` : ''}
        ${r.dbOffline
          ? html`<p class="muted">The database isn't running, so the account list can't be shown. Start the server.</p>`
          : r.accounts.length
            ? html`<table class="table"><thead><tr><th>Account</th><th>Role</th><th>Characters</th><th>Created</th><th></th></tr></thead><tbody>
              ${r.accounts.map((a) => html`<tr data-name="${a.username}">
                <td><strong>${a.username}</strong> ${a.online ? html`<span class="pill pill-ok">online</span>` : ''} ${a.banned ? html`<span class="pill pill-bad">banned</span>` : ''} ${a.expansion < 2 ? html`<span class="pill pill-warn" title="This account can't use WotLK content">expansion ${a.expansion}</span>` : ''}</td>
                <td><select data-gm ${r.running ? '' : 'disabled'} aria-label="Role">${GM.map((g, i) => html`<option value="${i}" ${i === a.gmlevel ? 'selected' : ''}>${g}</option>`)}</select></td>
                <td>${a.characters}</td><td class="muted small">${fmtDate(Date.parse(a.joined))}</td>
                <td class="right nowrap"><button class="btn btn-sm btn-ghost" data-pw ${r.running ? '' : 'disabled'}>${icon('key')}Password</button>
                  <button class="icon-btn" data-del title="Delete" ${r.running ? '' : 'disabled'}>${icon('trash')}</button></td></tr>`)}
              </tbody></table>`
            : html`<p class="muted">No accounts yet. Make one for yourself (role Admin) and one for each friend.</p>`}
      </div>
      <div class="panel">
        <h3>How your friends join</h3>
        <ol class="steps small">
          <li>They need a working WoW <strong>3.3.5a (build 12340)</strong> client.</li>
          <li>In the client folder, open <code>Data\\enUS\\realmlist.wtf</code> (or <code>enGB</code>) with Notepad and replace everything with:<br>
            <code>set realmlist ${server.wow.address || 'your public address'}</code></li>
          <li>Start <code>Wow.exe</code> and log in with the account name and password you made for them.</li>
        </ol>
      </div>`.s;
    const add = $('#add');
    if (add) add.onclick = create;
  };

  const create = async () => {
    const r = await modal({
      title: 'New game account',
      body: html`<form id="acc" class="form-grid">
        <label class="field span-2"><span>Account name</span><input name="username" required pattern="[A-Za-z0-9]{3,16}" maxlength="16" autocomplete="off"><small class="hint">3–16 letters or numbers. This is what they type at the WoW login screen.</small></label>
        <label class="field span-2"><span>Password</span><input name="password" required maxlength="16" autocomplete="new-password"><small class="hint">4–16 characters, no spaces or quotes (a WoW client limit).</small></label>
        <label class="field span-2"><span>Role</span><select name="gmlevel">${GM.map((g, i) => html`<option value="${i}">${g}${i === 3 ? ' (all GM commands)' : ''}</option>`)}</select></label>
      </form>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Create account', kind: 'btn-primary', onClick: (w) => api.post(base, Object.fromEntries(new FormData(w.querySelector('#acc')))) }],
    });
    if (r) {
      toast('Account created', 'ok');
      setTimeout(draw, 2500);
    }
  };

  const name = (el) => el.closest('tr').dataset.name;
  on(root, 'change', '[data-gm]', (_e, el) => api.post(`${base}/${encodeURIComponent(name(el))}/gmlevel`, { gmlevel: Number(el.value) }).then(() => toast('Role changed', 'ok'), (e) => toast(e.message, 'error')));
  on(root, 'click', '[data-pw]', async (_e, el) => {
    const r = await modal({
      title: `New password for ${name(el)}`,
      body: html`<label class="field"><span>Password</span><input id="npw" maxlength="16" autocomplete="new-password"><small class="hint">4–16 characters, no spaces or quotes.</small></label>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Change password', kind: 'btn-primary', onClick: (w) => api.post(`${base}/${encodeURIComponent(name(el))}/password`, { password: w.querySelector('#npw').value }) }],
    });
    if (r) toast('Password changed', 'ok');
  });
  on(root, 'click', '[data-del]', async (_e, el) => {
    if (await confirmBox('Delete account?', `Delete ${name(el)} and all of its characters?`, { danger: true, confirm: 'Delete' }))
      api.del(`${base}/${encodeURIComponent(name(el))}`).then(() => setTimeout(draw, 2000), (e) => toast(e.message, 'error'));
  });
  await draw();
}
