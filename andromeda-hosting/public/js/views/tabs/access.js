import { api } from '../../api.js';
import { html, on, toast } from '../../ui.js';

export async function render(root, { server }) {
  const draw = async () => {
    const [{ users, perms }, { server: s }] = await Promise.all([api.get('/api/users'), api.get(`/api/servers/${server.id}`)]);
    const access = new Map((s.access || []).map((a) => [a.userId, a.perms]));
    const others = users.filter((u) => u.role !== 'admin');
    root.innerHTML = html`
      <div class="panel">
        <h3>Who can manage this server</h3>
        <p class="muted small">Admins can do everything on every server. Give regular users (like a friend) exactly the permissions they need here. Add users under <a href="#/users">Users &amp; access</a>.</p>
        ${others.length
          ? html`<table class="table access-table"><thead><tr><th>User</th>${perms.map((p) => html`<th class="center" title="${p.label}">${p.label}</th>`)}<th></th></tr></thead><tbody>
            ${others.map((u) => {
              const has = access.get(u.id);
              return html`<tr data-uid="${u.id}" class="${has ? '' : 'no-access'}"><td><strong>${u.username}</strong>${has ? '' : html`<div class="muted small">no access</div>`}</td>
                ${perms.map((p) => html`<td class="center"><input type="checkbox" data-perm="${p.id}" ${has && has.includes(p.id) ? 'checked' : ''} aria-label="${p.label}"></td>`)}
                <td class="right nowrap">${has ? html`<button class="btn btn-sm btn-ghost" data-revoke>Remove</button>` : html`<button class="btn btn-sm" data-grant>Give full access</button>`}</td></tr>`;
            })}
            </tbody></table>`
          : html`<p class="muted">There are no non-admin users yet.</p>`}
        ${users.filter((u) => u.role === 'admin').length ? html`<p class="muted small">Admins: ${users.filter((u) => u.role === 'admin').map((u) => u.username).join(', ')}</p>` : ''}
      </div>`.s;
    return perms;
  };
  let perms = await draw();
  const save = async (uid, list, remove = false) => {
    try {
      await api.put(`/api/servers/${server.id}/access`, { userId: uid, perms: list, remove });
      toast('Access updated', 'ok', 1500);
    } catch (err) {
      toast(err.message, 'error');
    }
    perms = await draw();
  };
  on(root, 'change', '[data-perm]', (_e, el) => {
    const tr = el.closest('tr');
    save(tr.dataset.uid, [...tr.querySelectorAll('[data-perm]:checked')].map((c) => c.dataset.perm));
  });
  on(root, 'click', '[data-grant]', (_e, el) => save(el.closest('tr').dataset.uid, perms.map((p) => p.id)));
  on(root, 'click', '[data-revoke]', (_e, el) => save(el.closest('tr').dataset.uid, [], true));
}
