'use strict';
// The "Interactive" and "Support" pages: realm status, who's online, characters, honor, statistics,
// auction house, in-game commands and how to connect.
const { html, raw } = require('../html');
const { box, table, pager, headerImage, subheader, raceIcon, classIcon, TPL } = require('../layout');
const data = require('../data');
const realm = require('../realm');
const gd = require('../gamedata');

const PER_PAGE = 25;
const pageOf = (req) => Math.max(1, Math.min(100000, Number(req.query.p) || 1));

const charLink = (name) => html`<a href="/armory/character/${encodeURIComponent(name)}"><b style="color: rgb(35, 67, 3);">${name}</b></a>`;
const race = (r) => raceIcon(r.race, r.gender, gd.RACES[r.race] || 'Unknown');
const cls = (r) => classIcon(r.class, gd.CLASSES[r.class] || 'Unknown');
const lvl = (r) => html`<b style="color: rgb(102, 13, 2);">${r.level}</b>`;

// "Who" filter shared by the list pages: everyone, real players only, or bots only.
function whoFilter(req) {
  const show = ['players', 'bots'].includes(req.query.show) ? req.query.show : 'all';
  const prefix = data.botPrefix() + '%';
  if (show === 'players') return { show, join: `JOIN ${data.t('login', 'account')} a ON a.id = c.account`, where: 'a.username NOT LIKE ?', params: [prefix] };
  if (show === 'bots') return { show, join: `JOIN ${data.t('login', 'account')} a ON a.id = c.account`, where: 'a.username LIKE ?', params: [prefix] };
  return { show, join: '', where: '1=1', params: [] };
}

function whoTabs(base, current, extra = '') {
  const tab = (key, label) => (key === current ? html`<b>[${label}]</b>` : html`<a href="${base}?show=${key}${raw(extra)}">${label}</a>`);
  return html`<div class="filter-tabs">Show: ${tab('all', 'Everyone')} · ${tab('players', 'Players')} · ${tab('bots', 'Bots')}</div>`;
}

async function realmstatus(req, ctx) {
  const r = await realm.info();
  const [pop, popColor] = realm.population(r.players + r.bots);
  const up = html`<img src="/images/uparrow2.gif" style="vertical-align: bottom;" height="19" width="18" alt=""> <b style="color: rgb(35, 67, 3);">Up</b>`;
  const down = html`<img src="/images/downarrow2.gif" style="vertical-align: bottom;" height="19" width="18" alt=""> <b style="color: rgb(102, 13, 2);">Down</b>`;
  const body = html`${headerImage('realm')}${box(null, html`
<div style="padding:10px 20px;">This page lists the World of Warcraft realm and its status. A realm can be listed as either ${up} or ${down}.
If the realm is down, chances are it's being restarted or updated and will be back shortly.</div><br>
${subheader('Realm Status')}
${table(['Status', 'Realm name', 'Type', 'Population', 'Online', 'Uptime'], [
    [r.online ? up : down, html`<b>${r.name || ctx.site.realmName}</b>`, r.type || '—', html`<font color="${popColor}"><b>${pop}</b></font>`, `${r.players} players, ${r.bots} bots`, r.uptime !== null ? gd.duration(r.uptime) : '—'],
  ])}`)}`;
  return { title: 'Realm Status', pathway: 'Realm Status', body };
}

async function online(req, ctx) {
  const w = whoFilter(req);
  const p = pageOf(req);
  const where = `c.online = 1 AND ${w.where}`;
  const rows = await data.q('chars', `SELECT c.name, c.race, c.class, c.gender, c.level, c.zone FROM characters c ${w.join} WHERE ${where} ORDER BY c.name LIMIT ?, ?`, [...w.params, (p - 1) * PER_PAGE, PER_PAGE]);
  const total = Number((await data.q('chars', `SELECT COUNT(*) AS n FROM characters c ${w.join} WHERE ${where}`, w.params))[0].n);
  const pages = Math.ceil(total / PER_PAGE);
  const body = box('Players online', html`${whoTabs('/server/online', w.show)}
${table(['#', 'Name', 'Race', 'Class', 'Level', 'Location'],
    rows.map((r, i) => [html`<b style="color: rgb(102, 13, 2);">${(p - 1) * PER_PAGE + i + 1}</b>`, charLink(r.name), race(r), cls(r), lvl(r), html`<b style="color: rgb(35, 67, 3);">${gd.zoneName(r.zone)}</b>`]),
    { caption: `${ctx.site.realmName} · ${total} online`, empty: 'Nobody is online right now.' })}
${pager(p, pages, (n) => `/server/online?show=${w.show}&p=${n}`)}`);
  return { title: 'Players online', pathway: 'Players online', body };
}

async function characters(req, ctx) {
  const w = whoFilter(req);
  const p = pageOf(req);
  const search = String(req.query.q || '').trim().slice(0, 12);
  const classId = Number(req.query.class) || 0;
  const conds = [w.where];
  const params = [...w.params];
  if (search) {
    conds.push('c.name LIKE ?');
    params.push(search.replace(/[%_\\]/g, '\\$&') + '%');
  }
  if (gd.CLASSES[classId]) {
    conds.push('c.class = ?');
    params.push(classId);
  }
  const where = conds.join(' AND ');
  const rows = await data.q('chars', `SELECT c.name, c.race, c.class, c.gender, c.level, c.zone, c.online FROM characters c ${w.join} WHERE ${where} ORDER BY c.level DESC, c.name LIMIT ?, ?`, [...params, (p - 1) * PER_PAGE, PER_PAGE]);
  const total = Number((await data.q('chars', `SELECT COUNT(*) AS n FROM characters c ${w.join} WHERE ${where}`, params))[0].n);
  const keep = `&q=${encodeURIComponent(search)}&class=${classId || ''}`;
  const body = box('Characters on the server', html`
<form class="search-form" method="get" action="/server/characters">
  <input type="hidden" name="show" value="${w.show}">
  Name: <input name="q" value="${search}" maxlength="12" size="14">
  Class: <select name="class"><option value="">Any</option>${Object.entries(gd.CLASSES).map(([id, n]) => html`<option value="${id}"${Number(id) === classId ? raw(' selected') : ''}>${n}</option>`)}</select>
  <input type="submit" value="Search">
</form>
${whoTabs('/server/characters', w.show, keep)}
${table(['Name', 'Race', 'Class', 'Level', 'Location', 'Status'],
    rows.map((r) => [charLink(r.name), race(r), cls(r), lvl(r), gd.zoneName(r.zone), r.online ? html`<b style="color: rgb(35, 67, 3);">Online</b>` : 'Offline']),
    { caption: `${total} characters`, empty: 'No characters match.' })}
${pager(p, Math.ceil(total / PER_PAGE), (n) => `/server/characters?show=${w.show}${keep}&p=${n}`)}`);
  return { title: 'Characters', pathway: 'Characters on the server', body };
}

async function honor(req, ctx) {
  const w = whoFilter(req);
  const p = pageOf(req);
  const cols = await data.columns('chars', 'characters');
  const honorCol = cols.has('totalhonorpoints') ? 'c.totalHonorPoints' : '0';
  const killsCol = cols.has('totalkills') ? 'c.totalKills' : '0';
  const factionSel = ['alliance', 'horde'].includes(req.query.faction) ? req.query.faction : '';
  let where = w.where;
  if (factionSel) where += ` AND c.race ${factionSel === 'alliance' ? '' : 'NOT '}IN (1,3,4,7,11)`;
  const rows = await data.q('chars', `SELECT c.name, c.race, c.class, c.gender, c.level, ${killsCol} AS kills, ${honorCol} AS honor FROM characters c ${w.join} WHERE ${where} AND ${killsCol} > 0 ORDER BY kills DESC, honor DESC LIMIT ?, ?`, [...w.params, (p - 1) * PER_PAGE, PER_PAGE]);
  const total = Number((await data.q('chars', `SELECT COUNT(*) AS n FROM characters c ${w.join} WHERE ${where} AND ${killsCol} > 0`, w.params))[0].n);
  const tabs = html`<div class="filter-tabs">Faction: ${[['', 'Both'], ['alliance', 'Alliance'], ['horde', 'Horde']].map(([k, l], i) => html`${i ? ' · ' : ''}${k === factionSel ? html`<b>[${l}]</b>` : html`<a href="/server/honor?show=${w.show}&faction=${k}">${l}</a>`}`)}</div>`;
  const body = box('Honor', html`${tabs}${whoTabs('/server/honor', w.show, `&faction=${factionSel}`)}
${table(['Rank', 'Name', 'Race', 'Class', 'Level', 'Honorable kills', 'Honor points'],
    rows.map((r, i) => [html`<b>${(p - 1) * PER_PAGE + i + 1}</b>`, charLink(r.name), race(r), cls(r), lvl(r), Number(r.kills).toLocaleString('en-US'), Number(r.honor).toLocaleString('en-US')]),
    { empty: 'Nobody has an honorable kill yet.' })}
${pager(p, Math.ceil(total / PER_PAGE), (n) => `/server/honor?show=${w.show}&faction=${factionSel}&p=${n}`)}`);
  return { title: 'Honor', pathway: 'Honor', body };
}

function bars(title, entries, total) {
  return html`${subheader(title)}<table class="stat-bars" width="100%" cellpadding="3" cellspacing="0">${entries.map(([label, n, icon]) => {
    const pct = total ? (n * 100) / total : 0;
    return html`<tr><td width="170">${icon || ''} ${label}</td><td><div class="stat-bar"><div style="width:${pct.toFixed(1)}%"></div></div></td><td width="110" align="right"><b>${n.toLocaleString('en-US')}</b> (${pct.toFixed(1)}%)</td></tr>`;
  })}</table><br>`;
}

async function statistics(req, ctx) {
  const w = whoFilter(req);
  const byRace = await data.q('chars', `SELECT c.race AS k, COUNT(*) AS n FROM characters c ${w.join} WHERE ${w.where} GROUP BY c.race`, w.params);
  const byClass = await data.q('chars', `SELECT c.class AS k, COUNT(*) AS n FROM characters c ${w.join} WHERE ${w.where} GROUP BY c.class`, w.params);
  const byLevel = await data.q('chars', `SELECT LEAST(FLOOR((c.level - 1) / 10), 7) AS k, COUNT(*) AS n FROM characters c ${w.join} WHERE ${w.where} GROUP BY k ORDER BY k`, w.params);
  const total = byRace.reduce((s, r) => s + Number(r.n), 0);
  const alliance = byRace.filter((r) => gd.faction(r.k) === 'Alliance').reduce((s, r) => s + Number(r.n), 0);
  const body = box('Statistics', html`${whoTabs('/server/statistics', w.show)}
<p>${total.toLocaleString('en-US')} characters on ${ctx.site.realmName}.</p>
${bars('Factions', [['Alliance', alliance, html`<img src="${TPL}/images/icon/faction/alliance.gif" width="18" height="18" alt="">`], ['Horde', total - alliance, html`<img src="${TPL}/images/icon/faction/horde.gif" width="18" height="18" alt="">`]], total)}
${bars('Races', byRace.map((r) => [gd.RACES[r.k] || `Race ${r.k}`, Number(r.n), raceIcon(r.k, 0, gd.RACES[r.k] || '')]).sort((a, b) => b[1] - a[1]), total)}
${bars('Classes', byClass.map((r) => [gd.CLASSES[r.k] || `Class ${r.k}`, Number(r.n), classIcon(r.k, gd.CLASSES[r.k] || '')]).sort((a, b) => b[1] - a[1]), total)}
${bars('Levels', byLevel.map((r) => [Number(r.k) === 7 ? 'Level 71–80' : `Level ${r.k * 10 + 1}–${r.k * 10 + 10}`, Number(r.n)]), total)}`);
  return { title: 'Statistics', pathway: 'Statistics', body };
}

function coins(copper) {
  if (!Number(copper)) return '—';
  const m = gd.money(copper);
  const part = (n, kind) => (n ? html`<span class="coin">${n}<img src="${TPL}/images/ah_system/16px-${kind}.gif" width="12" height="12" alt="${kind[0]}"></span> ` : '');
  return html`${part(m.g, 'gold')}${part(m.s, 'silver')}${part(m.c, 'copper')}`;
}

const itemLink = (it, entry) => {
  if (!it) return `Item #${entry}`;
  const color = gd.QUALITY_COLORS[it.Quality] || '#2a2a2a';
  return html`<span class="item-cell">${it.icon ? html`<img class="item-icon" src="/armory/images/icons/64x64/${it.icon}.png" width="20" height="20" alt="">` : ''}<b style="color:${color}" class="q${Number(it.Quality)}">${it.name}</b></span>`;
};

async function ah(req, ctx) {
  const houses = { ally: [1, 2, 3], horde: [4, 5, 6], black: [7] };
  const filter = houses[req.query.filter] ? req.query.filter : '';
  const p = pageOf(req);
  const cols = await data.columns('chars', 'auction');
  if (!cols.size) return { title: 'Auction House', pathway: 'Auction House', body: box('Auction House', 'The auction house is empty.') };
  const count = cols.has('item_count') ? 'a.item_count' : '1';
  const where = filter ? 'WHERE a.houseid IN (?)' : '';
  const params = filter ? [houses[filter]] : [];
  const rows = await data.q('chars', `SELECT a.item_template AS entry, ${count} AS cnt, a.buyoutprice AS buyout, IF(a.lastbid > 0, a.lastbid, a.startbid) AS bid, a.time, s.name AS seller
    FROM auction a LEFT JOIN characters s ON s.guid = a.itemowner ${where} ORDER BY a.time LIMIT ?, ?`, [...params, (p - 1) * 50, 50]);
  const total = Number((await data.q('chars', `SELECT COUNT(*) AS n FROM auction a ${where}`, params))[0].n);
  const its = await data.items(rows.map((r) => r.entry));
  const now = Math.floor(Date.now() / 1000);
  const left = (t) => {
    const s = Number(t) - now;
    return s <= 0 ? 'Expired' : gd.duration(s);
  };
  const tabs = html`<div class="filter-tabs">${[['', 'All'], ['ally', 'Alliance Auctions'], ['horde', 'Horde Auctions'], ['black', 'Blackwater Auctions']].map(([k, l], i) => html`${i ? ' · ' : ''}${k === filter ? html`<b>[${l}]</b>` : html`<a href="/server/ah?filter=${k}">${l}</a>`}`)}</div>`;
  const body = box('Auction House', html`${tabs}
${table(['Item', 'Qty', 'Seller', 'Current bid', 'Buyout', 'Time left'],
    rows.map((r) => [itemLink(its.get(Number(r.entry)), r.entry), r.cnt, r.seller ? charLink(r.seller) : '—', coins(r.bid), coins(r.buyout), left(r.time)]),
    { caption: `${total} auctions`, empty: 'No auctions right now.' })}
${pager(p, Math.ceil(total / 50), (n) => `/server/ah?filter=${filter}&p=${n}`)}`);
  return { title: 'Auction House', pathway: 'Auction House', body };
}

async function commands(req, ctx) {
  const level = ctx.account ? ctx.account.gmlevel : 0;
  const rows = await data.q('world', 'SELECT name, security, help FROM command WHERE security <= ? ORDER BY name', [level]);
  const body = box('Available Commands (In Game)', html`<p>Type these in the game's chat box, starting with a dot (for example <b>.help</b>).${level ? '' : ' GM commands are hidden; log in with a GM account to see them.'}</p>
${table(['Command', 'Help'], rows.map((r) => [html`<b>.${r.name}</b>`, html`<div class="cmd-help">${String(r.help || '').replace(/^Syntax:\s*/i, '')}</div>`]), { empty: 'No commands found.' })}`);
  return { title: 'In-game commands', pathway: 'In-game commands', body };
}

async function connect(req, ctx) {
  let address = null;
  try {
    address = (await realm.info()).address;
  } catch {}
  const line = `set realmlist ${address || ctx.req.hostname}`;
  const body = box('How to play', html`<ol class="howto">
  <li>Install World of Warcraft: Wrath of the Lich King, patched to <b>3.3.5a (build 12340)</b>.</li>
  <li>${ctx.site.registration === 'off' ? html`Get a game account from the server's owner.` : html`Create a game account on the <a href="/account/register">New account</a> page${ctx.site.registration === 'invite' ? ' (you need an invite code from the server\'s owner)' : ''}.`}</li>
  <li>Open <b>Data\\enUS\\realmlist.wtf</b> (or <b>enGB</b>) in your WoW folder with Notepad and replace everything in it with:
    <pre class="realmlist">${line}</pre></li>
  <li>Start <b>Wow.exe</b> (not the launcher) and log in with your account name and password.</li>
  <li>Have fun! Thousands of bots play here too: invite them to groups, trade with them, or duel them.</li>
</ol>`);
  return { title: 'How to play', pathway: 'How to play', body };
}

module.exports = { realmstatus, online, characters, honor, statistics, ah, commands, connect, itemLink, charLink, coins };
