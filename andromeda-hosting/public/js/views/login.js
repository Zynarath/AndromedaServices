import { api } from '../api.js';
import { html, $, icon } from '../ui.js';

export function render(root, { auth, onLogin }) {
  const setup = auth.setupRequired;
  let needCode = false;
  const draw = (error = '') => {
    root.innerHTML = html`
      <div class="auth-page">
        <form class="auth-card" id="auth-form" autocomplete="on">
          <div class="auth-brand"><img src="/img/icon.svg" alt=""><h1>${auth.panelName || 'Andromeda Hosting'}</h1></div>
          ${setup
            ? auth.setupAllowedHere
              ? html`<p class="muted">Welcome! Create the <strong>admin account</strong> for this panel. You can add your friends as users afterwards.</p>`
              : html`<div class="callout callout-warn">${icon('alert')}<div>No admin account exists yet. For safety, the first account can only be created
                  <strong>on the host PC</strong> at <code>http://localhost:${location.port || 80}</code>, or with <code>npm run create-admin</code>.</div></div>`
            : html`<p class="muted">Sign in to manage your game servers.</p>`}
          ${error ? html`<div class="form-error" role="alert">${error}</div>` : ''}
          ${setup && !auth.setupAllowedHere
            ? ''
            : html`
              <label class="field"><span>Username</span><input name="username" required autocomplete="username" minlength="3" maxlength="32"></label>
              <label class="field"><span>Password</span><input name="password" type="password" required autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 8 : 1}"></label>
              ${setup ? html`<label class="field"><span>Repeat password</span><input name="password2" type="password" required autocomplete="new-password" minlength="8"></label>` : ''}
              ${needCode ? html`<label class="field"><span>2FA code from your authenticator app</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" required></label>` : ''}
              <button class="btn btn-primary btn-block" type="submit">${setup ? 'Create admin account' : 'Sign in'}</button>`}
        </form>
      </div>`.s;
    const form = $('#auth-form');
    if (needCode) form.code.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      const data = Object.fromEntries(new FormData(form));
      try {
        if (setup) {
          if (data.password !== data.password2) throw new Error('Passwords do not match');
          const r = await api.post('/api/auth/setup', { username: data.username, password: data.password });
          return onLogin(r.user);
        }
        const r = await api.post('/api/auth/login', data);
        if (r.totpRequired) {
          needCode = true;
          const keep = { username: data.username, password: data.password };
          draw();
          $('#auth-form').username.value = keep.username;
          $('#auth-form').password.value = keep.password;
          $('#auth-form').code.focus();
          return;
        }
        onLogin(r.user);
      } catch (err) {
        const keep = data.username;
        draw(err.message);
        const f = $('#auth-form');
        if (f && f.username) f.username.value = keep || '';
        if (f && f.password) f.password.focus();
      }
    };
  };
  draw();
}
