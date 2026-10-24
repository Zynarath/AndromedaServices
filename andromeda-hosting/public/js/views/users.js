import { api } from '../api.js';
import { html, $, on, icon, toast, fmtAgo, modal, confirmBox } from '../ui.js';

export async function render(root, { state }) {
  const draw = async () => {
    const { users, perms } = await api.get('/api/users');
    root.innerHTML = html`
      <div class="page-head"><div><h1>Users &amp; access</h1><p class="muted">Give your friends their own login. Admins manage everything; users only see servers you share with them.</p></div>
        <button class="btn btn-primary" id="add">${icon('plus')}Add user</button></div>
      <div class="panel">
        <table class="table"><thead><tr><th>User</th><th>Role</th><th>Servers</th><th>2FA</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${users.map((u) => html`<tr data-id="${u.id}" class="${u.disabled ? 'no-access' : ''}">
          <td><strong>${u.username}</strong>${u.id === state.user.id ? html` <span class="pill pill-off">you</span>` : ''}${u.disabled ? html` <span class="pill pill-bad">disabled</span>` : ''}</td>
          <td><select data-role ${u.id === state.user.id ? 'disabled' : ''} aria-label="Role"><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option><option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option></select></td>
          <td>${u.role === 'admin' ? html`<span class="muted">All servers</span>` : u.servers.length ? u.servers.map((s) => html`<a class="chip" href="#/server/${s.id}/access">${s.name}</a>`) : html`<span class="muted">None — share from a server's Access tab</span>`}</td>
          <td>${u.totpEnabled ? html`<span class="pill pill-ok">On</span>` : html`<span class="muted">Off</span>`}</td>
          <td class="muted">${fmtAgo(u.lastLogin)}</td>
          <td class="right nowrap">
            <button class="btn btn-sm btn-ghost" data-pw>${icon('key')}Password</button>
            ${u.totpEnabled ? html`<button class="btn btn-sm btn-ghost" data-reset2fa>Reset 2FA</button>` : ''}
            ${u.id !== state.user.id ? html`<button class="btn btn-sm btn-ghost" data-disable>${u.disabled ? 'Enable' : 'Disable'}</button><button class="icon-btn" data-del title="Delete">${icon('trash')}</button>` : ''}
          </td></tr>`)}
        </tbody></table>
      </div>
      <div class="panel"><h3>Permissions you can give per server</h3><ul class="perm-list">${perms.map((p) => html`<li><strong>${p.label}</strong></li>`)}</ul></div>`.s;
    $('#add').onclick = addUser;
  };

  const addUser = async () => {
    const r = await modal({
      title: 'Add user',
      body: html`<form id="nu" class="form-grid">
        <label class="field span-2"><span>Username</span><input name="username" required autocomplete="off"></label>
        <label class="field span-2"><span>Temporary password (8+ characters)</span><input name="password" required autocomplete="new-password"></label>
        <label class="field span-2"><span>Role</span><select name="role"><option value="user">User — only servers you share</option><option value="admin">Admin — full control of the panel</option></select></label>
      </form><p class="muted small">Send them the panel address and these details. They can change the password and turn on 2FA under their account.</p>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Create user', kind: 'btn-primary', onClick: (w) => api.post('/api/users', Object.fromEntries(new FormData(w.querySelector('#nu')))) }],
    });
    if (r) {
      toast('User created', 'ok');
      draw();
    }
  };

  const id = (el) => el.closest('tr').dataset.id;
  on(root, 'change', '[data-role]', (_e, el) => api.patch(`/api/users/${id(el)}`, { role: el.value }).then(() => toast('Role updated', 'ok'), (e) => toast(e.message, 'error')).then(draw));
  on(root, 'click', '[data-pw]', async (_e, el) => {
    const r = await modal({
      title: 'Set a new password',
      body: html`<label class="field"><span>New password</span><input id="npw" autocomplete="new-password" minlength="8"></label><p class="muted small">Signs the user out everywhere.</p>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Set password', kind: 'btn-primary', onClick: (w) => api.patch(`/api/users/${id(el)}`, { password: w.querySelector('#npw').value }) }],
    });
    if (r) toast('Password changed', 'ok');
  });
  on(root, 'click', '[data-reset2fa]', async (_e, el) => {
    if (await confirmBox('Reset 2FA?', 'They will be able to sign in with just their password and can set up 2FA again.')) api.patch(`/api/users/${id(el)}`, { resetTotp: true }).then(draw, (e) => toast(e.message, 'error'));
  });
  on(root, 'click', '[data-disable]', (_e, el) => api.patch(`/api/users/${id(el)}`, { disabled: el.textContent.trim() === 'Disable' }).then(draw, (e) => toast(e.message, 'error')));
  on(root, 'click', '[data-del]', async (_e, el) => {
    if (await confirmBox('Delete user?', 'Their access to all servers is removed.', { danger: true, confirm: 'Delete' })) api.del(`/api/users/${id(el)}`).then(draw, (e) => toast(e.message, 'error'));
  });
  await draw();
}
