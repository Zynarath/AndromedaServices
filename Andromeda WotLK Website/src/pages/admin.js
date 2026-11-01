'use strict';
// Admin page for GM accounts (gmlevel 3+): post and remove news, and hand out invite codes.
// Everything else about the realm stays in Andromeda Hosting.
const { html } = require('../html');
const { box, table } = require('../layout');
const auth = require('../auth');
const data = require('../data');
const news = require('../news');

const ADMIN_LEVEL = 3;
const isAdmin = (ctx) => ctx.account && ctx.account.gmlevel >= ADMIN_LEVEL;
const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
const deny = (ctx) => (ctx.account ? { status: 403, title: 'Admin panel', body: box('Admin panel', 'Only GM accounts (level 3 or higher) can open this page.') } : { redirect: '/account/login' });

async function inviteRows() {
  try {
    return await data.q('login', `SELECT i.code, i.note, i.created_at, i.used_at, a.username AS used_name FROM ${auth.INVITES} i LEFT JOIN account a ON a.id = i.used_by WHERE i.used_by IS NULL OR i.used_at > NOW() - INTERVAL 30 DAY ORDER BY i.created_at DESC LIMIT 100`);
  } catch (err) {
    if (news.missingTable(err)) return [];
    throw err;
  }
}

async function index(req, ctx, _res, message) {
  if (!isAdmin(ctx)) return deny(ctx);
  const { rows } = await news.list(0, 50);
  const invites = await inviteRows();
  const mode = ctx.site.registration;
  const body = html`${message ? html`<div class="site-msg site-msg-${message.type}">${message.text}</div>` : ''}
${box('Post news', html`<form class="site-form" method="post" action="/admin/news">${csrfField(ctx)}
  <label>Title <input name="title" maxlength="120" required></label>
  <label>Text <textarea name="text" rows="8" maxlength="20000" required></textarea></label>
  <input type="submit" value="Post">
</form><p class="hints">Plain text. Blank lines start a new paragraph; links become clickable.</p>`)}
${box('News', table(['Date', 'Title', 'By', ''], rows.map((t) => [new Date(t.topic_posted * 1000).toISOString().slice(0, 10), t.topic_name, t.topic_poster, html`<form method="post" action="/admin/news/${t.topic_id}/delete" class="inline-form" data-confirm="Delete this news post?">${csrfField(ctx)}<input type="submit" value="Delete"></form>`]), { empty: 'No news yet.' }))}
${box('Invite codes', html`<p>Sign-up on this website is <b>${{ off: 'off', invite: 'by invite code', open: 'open to anyone' }[mode]}</b>. Change it in Andromeda Services: WotLK website → Settings.</p>
<form class="site-form inline" method="post" action="/admin/invites">${csrfField(ctx)}
  <label>Who is it for? <input name="note" maxlength="64" placeholder="e.g. Alex"></label> <input type="submit" value="Create invite code">
</form>
${table(['Code', 'For', 'Created', 'Used by', ''], invites.map((i) => [html`<code class="invite">${i.code}</code>`, i.note, String(i.created_at).slice(0, 16), i.used_name || (i.used_at ? '—' : 'Not used yet'), i.used_at ? '' : html`<form method="post" action="/admin/invites/${i.code}/delete" class="inline-form">${csrfField(ctx)}<input type="submit" value="Revoke"></form>`]), { empty: 'No invite codes yet.' })}`)}`;
  return { title: 'Admin panel', pathway: 'Admin panel', body };
}

async function newsPost(req, ctx, res) {
  if (!isAdmin(ctx)) return deny(ctx);
  const title = String(req.body.title || '').trim().slice(0, 120);
  const text = String(req.body.text || '').trim().slice(0, 20000);
  if (!title || !text) return index(req, ctx, res, { type: 'error', text: 'Give the news post a title and some text.' });
  await news.add(ctx.account, req.ip, title, text);
  return { redirect: '/' };
}

async function newsDelete(req, ctx, res) {
  if (!isAdmin(ctx)) return deny(ctx);
  await news.remove(Number(req.params.id) || 0);
  return index(req, ctx, res, { type: 'ok', text: 'News post deleted.' });
}

async function invitePost(req, ctx, res) {
  if (!isAdmin(ctx)) return deny(ctx);
  await auth.ensureInviteTable();
  const code = auth.inviteCode();
  await data.q('login', `INSERT INTO ${auth.INVITES} SET ?`, [{ code, note: String(req.body.note || '').trim().slice(0, 64), created_by: ctx.account.id, created_at: new Date() }]);
  return index(req, ctx, res, { type: 'ok', text: `Invite code ${code} created. Send it to your friend with this website's address; it works once.` });
}

async function inviteDelete(req, ctx, res) {
  if (!isAdmin(ctx)) return deny(ctx);
  await data.q('login', `DELETE FROM ${auth.INVITES} WHERE code = ? AND used_by IS NULL`, [String(req.params.code || '').toUpperCase()]);
  return index(req, ctx, res, { type: 'ok', text: 'Invite code revoked.' });
}

module.exports = { index, newsPost, newsDelete, invitePost, inviteDelete, ADMIN_LEVEL };
