import { api, onSocket } from '../../api.js';
import { html, $, on, icon, toast, fmtBytes, fmtDate, confirmBox } from '../../ui.js';

export async function render(root, { server, navigate }) {
  const base = `/api/servers/${server.id}/backups`;
  const draw = async () => {
    const { backups, keep } = await api.get(base);
    root.innerHTML = html`
      <div class="panel">
        <div class="panel-head"><h3>Backups <span class="count">${backups.length}</span></h3>
          <button class="btn btn-primary btn-sm" id="create">${icon('archive')}Back up now</button></div>
        <p class="muted small">${server.ark ? 'Backs up ShooterGame/Saved (map saves, tribes, configs).' : 'Backs up the whole server folder (worlds, mods, configs) except libraries and logs.'}
          The newest ${keep} are kept. Running servers are saved first. Add a schedule to back up automatically.</p>
        ${backups.length
          ? html`<table class="table"><thead><tr><th>Created</th><th>Type</th><th>Size</th><th></th></tr></thead><tbody>
              ${backups.map((b) => html`<tr data-name="${b.name}"><td>${fmtDate(b.createdAt)}</td><td><span class="pill pill-off">${b.reason || 'manual'}</span></td><td>${fmtBytes(b.size)}</td>
                <td class="right nowrap"><button class="btn btn-sm" data-restore>${icon('restart')}Restore</button>
                  <a class="icon-btn" href="${base}/${encodeURIComponent(b.name)}/download" title="Download" download>${icon('download')}</a>
                  <button class="icon-btn" data-del title="Delete">${icon('trash')}</button></td></tr>`)}
            </tbody></table>`
          : html`<p class="muted">No backups yet.</p>`}
      </div>`.s;
    $('#create').onclick = async () => {
      try {
        await api.post(base, {});
        toast('Backup started — progress is shown on the Overview tab', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  };
  on(root, 'click', '[data-restore]', async (_e, el) => {
    const name = el.closest('tr').dataset.name;
    if (!(await confirmBox('Restore backup?', `The server must be stopped. Current files covered by this backup (world, configs${server.ark ? ', saves' : ', mods'}) are replaced with the backup from ${name.slice(0, 19).replace('_', ' ')}.`, { danger: true, confirm: 'Restore' }))) return;
    try {
      await api.post(`${base}/${encodeURIComponent(name)}/restore`);
      toast('Restore started', 'ok');
      navigate(`/server/${server.id}/overview`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  on(root, 'click', '[data-del]', async (_e, el) => {
    const name = el.closest('tr').dataset.name;
    if (!(await confirmBox('Delete backup?', name, { danger: true, confirm: 'Delete' }))) return;
    await api.del(`${base}/${encodeURIComponent(name)}`).then(draw, (e) => toast(e.message, 'error'));
  });
  const off = onSocket((msg) => {
    if (msg.serverId === server.id && msg.type === 'job' && msg.job.type === 'backup' && msg.job.status !== 'running') draw();
  });
  await draw();
  return off;
}
