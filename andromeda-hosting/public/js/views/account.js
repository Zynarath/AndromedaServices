import { api } from '../api.js';
import { html, $, on, icon, toast, fmtAgo, modal } from '../ui.js';

export async function render(root) {
  const draw = async () => {
    const { user, sessions } = await api.get('/api/account');
    root.innerHTML = html`
      <div class="page-head"><div><h1>Your account</h1><p class="muted">Signed in as <strong>${user.username}</strong> (${user.role})</p></div></div>
      <div class="grid-2">
        <form class="panel" id="pw">
          <h3>Change password</h3>
          <label class="field"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label>
          <label class="field"><span>New password</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
          <label class="field"><span>Repeat new password</span><input type="password" name="password2" required minlength="8" autocomplete="new-password"></label>
          <div class="form-actions"><button class="btn btn-primary">Change password</button></div>
        </form>
        <div class="panel">
          <h3>Two-factor authentication</h3>
          <p class="muted small">Strongly recommended if the panel is reachable from the internet. Works with Google Authenticator, Authy, 1Password, Bitwarden…</p>
          ${user.totpEnabled
            ? html`<p><span class="pill pill-ok">${icon('check')}Enabled</span></p><button class="btn" id="tfa-off">Turn off 2FA</button>`
            : html`<button class="btn btn-primary" id="tfa-on">${icon('shield')}Set up 2FA</button>`}
        </div>
      </div>
      <div class="panel">
        <h3>Signed-in devices</h3>
        <table class="table"><thead><tr><th>Device</th><th>IP</th><th>Last active</th><th></th></tr></thead><tbody>
          ${sessions.map((s) => html`<tr data-sid="${s.id}"><td class="small">${s.ua || 'Unknown'}</td><td class="mono">${s.ip || ''}</td><td>${fmtAgo(s.lastSeen)}</td>
            <td class="right">${s.current ? html`<span class="pill pill-ok">This device</span>` : html`<button class="btn btn-sm btn-ghost" data-revoke>Sign out</button>`}</td></tr>`)}
        </tbody></table>
      </div>`.s;

    const f = $('#pw');
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.password.value !== f.password2.value) return toast('New passwords do not match', 'error');
      try {
        await api.post('/api/account/password', { current: f.current.value, password: f.password.value });
        toast('Password changed. Other devices were signed out.', 'ok');
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const on2 = $('#tfa-on');
    if (on2) on2.onclick = async () => {
      const { secret, url } = await api.post('/api/account/2fa/setup');
      const ok = await modal({
        title: 'Set up two-factor authentication',
        body: html`<ol class="steps">
          <li>In your authenticator app choose <em>Add account → Enter a setup key</em>.</li>
          <li>Enter this key (time-based): <div class="address"><code class="secret">${secret.match(/.{1,4}/g).join(' ')}</code></div>
            <small class="muted">On a phone you can also tap: <a href="${url}">open in authenticator</a></small></li>
          <li>Type the 6-digit code it shows:</li></ol>
          <label class="field"><span>Code</span><input id="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7"></label>`,
        actions: [{ label: 'Cancel', value: null }, { label: 'Enable 2FA', kind: 'btn-primary', onClick: (w) => api.post('/api/account/2fa/enable', { code: w.querySelector('#tfa-code').value }) }],
      });
      if (ok) {
        toast('2FA enabled', 'ok');
        draw();
      }
    };
    const off2 = $('#tfa-off');
    if (off2) off2.onclick = async () => {
      const ok = await modal({
        title: 'Turn off 2FA',
        body: html`<label class="field"><span>Confirm with your password</span><input id="tfa-pw" type="password" autocomplete="current-password"></label>`,
        actions: [{ label: 'Cancel', value: null }, { label: 'Turn off', kind: 'btn-danger', onClick: (w) => api.post('/api/account/2fa/disable', { password: w.querySelector('#tfa-pw').value }) }],
      });
      if (ok) draw();
    };
  };
  on(root, 'click', '[data-revoke]', (_e, el) => api.del(`/api/account/sessions/${el.closest('tr').dataset.sid}`).then(draw));
  await draw();
}
