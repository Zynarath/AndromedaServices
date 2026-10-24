import { api } from '../../api.js';
import { html, $, on, icon, toast, fmtDate, modal, confirmBox } from '../../ui.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ACTIONS = {
  restart: 'Restart server',
  backup: 'Create backup',
  start: 'Start server',
  stop: 'Stop server',
  command: 'Run console command',
  update: 'Update game / modpack to latest',
};

function describe(s) {
  const when = s.type === 'interval' ? `every ${s.everyMinutes >= 60 && s.everyMinutes % 60 === 0 ? s.everyMinutes / 60 + ' h' : s.everyMinutes + ' min'}` : `at ${s.time} ${s.days && s.days.length && s.days.length < 7 ? 'on ' + s.days.map((d) => DAYS[d]).join(', ') : 'every day'}`;
  return when;
}

export async function render(root, { server }) {
  const base = `/api/servers/${server.id}/schedules`;
  let schedules = [];
  const draw = async () => {
    schedules = (await api.get(base)).schedules;
    root.innerHTML = html`
      <div class="panel">
        <div class="panel-head"><h3>Schedules</h3><button class="btn btn-primary btn-sm" id="add">${icon('plus')}Add schedule</button></div>
        <p class="muted small">Times use this PC's clock (${Intl.DateTimeFormat().resolvedOptions().timeZone}). ${server.ark ? 'A daily restart also pulls mod updates on ARK: Survival Ascended.' : ''}</p>
        ${schedules.length
          ? html`<table class="table"><thead><tr><th>Name</th><th>Action</th><th>When</th><th>Next run</th><th>On</th><th></th></tr></thead><tbody>
            ${schedules.map((s) => html`<tr data-id="${s.id}"><td>${s.name || '—'}</td><td>${ACTIONS[s.action]}${s.payload ? html` <code>${s.payload}</code>` : ''}${s.warnMinutes ? html`<div class="muted small">warns players ${s.warnMinutes} min before</div>` : ''}</td>
              <td>${describe(s)}</td><td class="muted">${s.enabled ? fmtDate(s.nextRun) : 'paused'}</td>
              <td><label class="switch"><input type="checkbox" data-toggle ${s.enabled ? 'checked' : ''} aria-label="Enabled"><span></span></label></td>
              <td class="right nowrap"><button class="icon-btn" data-edit title="Edit">${icon('edit')}</button><button class="icon-btn" data-del title="Delete">${icon('trash')}</button></td></tr>`)}
            </tbody></table>`
          : html`<div class="empty-mini">No schedules. Common setup: a daily restart at 05:00 with a 5-minute warning, and a backup every 6 hours.
              <div class="btn-row center"><button class="btn btn-sm" data-preset="restart">Add daily restart</button><button class="btn btn-sm" data-preset="backup">Add 6-hourly backup</button></div></div>`}
      </div>`.s;
    $('#add').onclick = () => editor();
  };

  const editor = async (s = { enabled: true, action: 'restart', type: 'daily', time: '05:00', days: [], warnMinutes: 5, everyMinutes: 360 }) => {
    const r = await modal({
      title: s.id ? 'Edit schedule' : 'New schedule',
      body: html`<form id="sch" class="form-grid">
        <label class="field span-2"><span>Name</span><input name="name" value="${s.name || ''}" placeholder="e.g. Nightly restart"></label>
        <label class="field"><span>Action</span><select name="action">${Object.entries(ACTIONS).map(([k, v]) => html`<option value="${k}" ${k === s.action ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label class="field" id="payload-f"><span>Command</span><input name="payload" value="${s.payload || ''}" placeholder="${server.ark ? 'Broadcast Hello' : 'say Hello'}"></label>
        <label class="field"><span>Repeat</span><select name="type"><option value="daily" ${s.type === 'daily' ? 'selected' : ''}>At a time of day</option><option value="interval" ${s.type === 'interval' ? 'selected' : ''}>Every N minutes</option></select></label>
        <label class="field" id="time-f"><span>Time</span><input type="time" name="time" value="${s.time || '05:00'}"></label>
        <label class="field" id="every-f"><span>Every (minutes)</span><input type="number" name="everyMinutes" min="5" value="${s.everyMinutes || 360}"></label>
        <div class="field span-2" id="days-f"><span>Days (none = every day)</span><div class="day-picks">${DAYS.map((d, i) => html`<label class="day"><input type="checkbox" name="day" value="${i}" ${(s.days || []).includes(i) ? 'checked' : ''}><span>${d}</span></label>`)}</div></div>
        <label class="field" id="warn-f"><span>Warn players first (minutes)</span><input type="number" name="warnMinutes" min="0" max="60" value="${s.warnMinutes || 0}"></label>
      </form>`,
      actions: [
        { label: 'Cancel', value: null },
        {
          label: 'Save',
          kind: 'btn-primary',
          onClick: (w) => {
            const f = w.querySelector('#sch');
            const d = Object.fromEntries(new FormData(f));
            d.days = [...f.querySelectorAll('[name=day]:checked')].map((c) => Number(c.value));
            d.enabled = s.enabled;
            return d;
          },
        },
      ],
      onOpen: (w) => {
        const f = w.querySelector('#sch');
        const sync = () => {
          const daily = f.type.value === 'daily';
          w.querySelector('#time-f').hidden = !daily;
          w.querySelector('#days-f').hidden = !daily;
          w.querySelector('#every-f').hidden = daily;
          w.querySelector('#payload-f').hidden = f.action.value !== 'command';
          w.querySelector('#warn-f').hidden = !['restart', 'stop', 'update'].includes(f.action.value);
        };
        f.addEventListener('change', sync);
        sync();
      },
    });
    if (!r) return;
    try {
      if (s.id) await api.put(`${base}/${s.id}`, r);
      else await api.post(base, r);
      toast('Schedule saved', 'ok');
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  on(root, 'click', '[data-edit]', (_e, el) => editor(schedules.find((s) => s.id === el.closest('tr').dataset.id)));
  on(root, 'click', '[data-del]', async (_e, el) => {
    if (!(await confirmBox('Delete schedule?', 'This cannot be undone.', { danger: true, confirm: 'Delete' }))) return;
    await api.del(`${base}/${el.closest('tr').dataset.id}`).then(draw, (e) => toast(e.message, 'error'));
  });
  on(root, 'change', '[data-toggle]', async (_e, el) => {
    const s = schedules.find((x) => x.id === el.closest('tr').dataset.id);
    await api.put(`${base}/${s.id}`, { ...s, enabled: el.checked }).then(draw, (e) => toast(e.message, 'error'));
  });
  on(root, 'click', '[data-preset]', async (_e, el) => {
    const body = el.dataset.preset === 'restart'
      ? { name: 'Daily restart', action: 'restart', type: 'daily', time: '05:00', days: [], warnMinutes: 5 }
      : { name: 'Backup every 6 hours', action: 'backup', type: 'interval', everyMinutes: 360 };
    await api.post(base, body).then(draw, (e) => toast(e.message, 'error'));
  });
  await draw();
}
