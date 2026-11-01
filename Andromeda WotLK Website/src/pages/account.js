'use strict';
// Log in / out, sign up (if the panel allows it) and "My account".
const { html } = require('../html');
const { box, table, headerImage, raceIcon, classIcon } = require('../layout');
const auth = require('../auth');
const data = require('../data');
const gd = require('../gamedata');
const { charLink } = require('./server');

const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
const err = (msg) => (msg ? html`<div class="site-msg site-msg-error">${msg}</div>` : '');

function loginForm(ctx, error, name = '') {
  return box('Log in', html`${err(error)}
<form class="site-form" method="post" action="/account/login">${csrfField(ctx)}
  <label>Account name <input name="login" value="${name}" maxlength="16" autocomplete="username" required autofocus></label>
  <label>Password <input name="pass" type="password" maxlength="16" autocomplete="current-password" required></label>
  <input type="submit" value="Log in">
</form>
<p>Use the same account name and password as in the game.${ctx.site.registration !== 'off' ? html` No account yet? <a href="/account/register">Create one</a>.` : ''}</p>`);
}

async function loginPage(req, ctx) {
  if (ctx.account) return { redirect: '/account' };
  return { title: 'Log in', pathway: 'Log in', body: loginForm(ctx) };
}

async function loginPost(req, ctx, res) {
  const r = await auth.login(req.ip, req.body.login, req.body.pass);
  if (r.error) return { status: 401, title: 'Log in', pathway: 'Log in', body: loginForm({ ...ctx }, r.error, String(req.body.login || '').slice(0, 16)) };
  auth.rotate(req, res, r.account);
  const back = String(req.body.back || '');
  return { redirect: /^\/(?!\/)[\w\-/?=&%.]*$/.test(back) ? back : '/account' };
}

async function logoutPost(req, ctx, res) {
  auth.rotate(req, res, null);
  return { redirect: '/' };
}

function registerForm(ctx, error, values = {}) {
  const mode = ctx.site.registration;
  if (mode === 'off') {
    return box('New account', html`Sign-up is turned off on this server. Ask the server's owner to create a game account for you.`);
  }
  return box('New account', html`${err(error)}
<form class="site-form" method="post" action="/account/register">${csrfField(ctx)}
  ${mode === 'invite' ? html`<label>Invite code <input name="invite" value="${values.invite || ''}" maxlength="11" placeholder="XXXXX-XXXXX" required></label>` : ''}
  <label>Account name <input name="username" value="${values.username || ''}" maxlength="16" pattern="[A-Za-z0-9]{3,16}" autocomplete="username" required></label>
  <label>Password <input name="password" type="password" maxlength="16" minlength="4" autocomplete="new-password" required></label>
  <label>Password again <input name="password2" type="password" maxlength="16" minlength="4" autocomplete="new-password" required></label>
  <input type="submit" value="Create account">
</form>
<ul class="hints">
  <li>Account names are 3–16 letters and numbers. You log in to the game with this name.</li>
  <li>Passwords are 4–16 characters with no spaces or quotes, and aren't case-sensitive (a WoW 3.3.5a limit).</li>
  ${mode === 'invite' ? html`<li>You need an invite code from the server's owner. Each code works once.</li>` : ''}
</ul>`);
}

async function registerPage(req, ctx) {
  if (ctx.account) return { redirect: '/account' };
  return { title: 'New account', pathway: 'New account', body: registerForm(ctx) };
}

async function registerPost(req, ctx, res) {
  if (ctx.account) return { redirect: '/account' };
  const r = await auth.register(req.ip, req.body, ctx.site.registration);
  if (r.error) return { status: 400, title: 'New account', pathway: 'New account', body: registerForm(ctx, r.error, { username: String(req.body.username || '').slice(0, 16), invite: String(req.body.invite || '').slice(0, 11) }) };
  auth.rotate(req, res, r.account);
  return { redirect: '/account?created=1' };
}

async function manage(req, ctx, _res, message) {
  if (!ctx.account) return { redirect: '/account/login' };
  const chars = await data.q('chars', 'SELECT name, race, class, gender, level, zone, online FROM characters WHERE account = ? ORDER BY level DESC, name', [ctx.account.id]);
  const created = req.query.created === '1';
  const body = html`${headerImage('manageacc')}
${created ? html`<div class="site-msg site-msg-ok">Your account is ready. Set your realmlist (see <a href="/connect">How to play</a>) and log in to the game.</div>` : ''}
${message ? html`<div class="site-msg site-msg-${message.type}">${message.text}</div>` : ''}
${box('My account', html`<p>Logged in as <b>${ctx.account.username}</b>${ctx.account.gmlevel ? html` (GM level ${ctx.account.gmlevel})` : ''}.</p>
${table(['Character', 'Race', 'Class', 'Level', 'Location', 'Status'], chars.map((c) => [charLink(c.name), raceIcon(c.race, c.gender, gd.RACES[c.race] || ''), classIcon(c.class, gd.CLASSES[c.class] || ''), c.level, gd.zoneName(c.zone), c.online ? 'Online' : 'Offline']), { caption: 'Your characters', empty: "You don't have any characters yet." })}`)}
${box('Change password', html`<form class="site-form" method="post" action="/account/password">${csrfField(ctx)}
  <label>Current password <input name="current" type="password" maxlength="16" autocomplete="current-password" required></label>
  <label>New password <input name="password" type="password" maxlength="16" minlength="4" autocomplete="new-password" required></label>
  <label>New password again <input name="password2" type="password" maxlength="16" minlength="4" autocomplete="new-password" required></label>
  <input type="submit" value="Change password">
</form>
<p class="hints">This changes your game password too. You'll be logged out everywhere and need to log in again.</p>`)}`;
  return { title: 'My account', pathway: 'My account', body };
}

async function passwordPost(req, ctx, res) {
  if (!ctx.account) return { redirect: '/account/login' };
  const r = await auth.changePassword(ctx.account, req.body.current, req.body.password, req.body.password2);
  if (r.error) return { status: 400, ...(await manage(req, ctx, res, { type: 'error', text: r.error })) };
  auth.rotate(req, res, null);
  return { title: 'Password changed', pathway: 'My account', body: box('Password changed', html`Your password was changed. <a href="/account/login">Log in again</a> with the new one.`) };
}

module.exports = { loginPage, loginPost, logoutPost, registerPage, registerPost, manage, passwordPost };
