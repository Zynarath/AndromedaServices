'use strict';
// Front page (news + right-hand column) and the news archive.
const { html, raw, sanitize, decodeEntities } = require('../html');
const { TPL, box, pager } = require('../layout');
const news = require('../news');
const realm = require('../realm');

const date = (unix) => {
  const d = new Date(Number(unix) * 1000);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};

// One news entry, as SPP's frontpage template drew it. The first few start opened.
function newsItem(topic, i) {
  const alt = i % 2 ? '' : 'alt';
  const open = i < 3;
  return html`<div class="${open ? 'news-expand' : `news-collapse${alt}`}" id="news${topic.topic_id}" data-alt="${alt}">
  <div class="news-border-left"></div><div class="news-border-right"></div>
  <div class="news-listing"><div class="hoverContainer" data-news="${topic.topic_id}"><div><div class="news-top"><ul>
    <li class="item-icon"><img border="0" alt="" src="${TPL}/images/news-contests.gif"></li>
    <li class="news-entry"><h1><a href="#news${topic.topic_id}">${decodeEntities(topic.topic_name)}</a></h1>
      <span class="user">Posted by: <b>${topic.topic_poster}</b>|</span>&nbsp;<span class="posted-date">${date(topic.topic_posted)}</span></li>
    <li class="news-entry-date"><span><strong>${date(topic.topic_posted)}</strong></span></li>
    <li class="news-toggle"><a href="#news${topic.topic_id}"><img src="${TPL}/images/pixel001.gif" alt=""></a></li>
  </ul></div></div></div></div>
  <div class="news-item"><blockquote><dl><dd><ul><li>
    <div class="letter-box0"></div>
    <div class="blog-post">${raw(sanitize(topic.message || ''))}</div>
  </li></ul></dd></dl></blockquote></div>
</div>`;
}

// Shown on the front page until the realm has news of its own.
function welcome(ctx) {
  const title = ctx.site.title;
  return {
    topic_id: 'welcome',
    topic_name: `Welcome to ${title}`,
    topic_poster: 'Andromeda Services',
    topic_posted: Math.floor(Date.now() / 1000),
    message: html`<p>Welcome to <b>${title}</b>, a World of Warcraft: Wrath of the Lich King realm run with Andromeda Services.</p>
<ul>
  <li><a href="/connect">How to play</a>: set your realmlist and log in with your game account.</li>
  <li><a href="/server/realmstatus">Realm status</a> and <a href="/server/online">who's online</a>, players and bots alike.</li>
  <li>The <a href="/armory">armory</a>: look up characters, their gear and talents, and guilds.</li>
</ul>
<p>News from the realm's GMs will show here.</p>`.toString(),
  };
}

async function rightColumn(ctx) {
  const r = await realm.info();
  const quick = [
    ctx.account ? ['Account Management', '/account'] : ['Log in', '/account/login'],
    ctx.site.registration !== 'off' && !ctx.account ? ['Account Creation', '/account/register'] : ['Armory', '/armory'],
    ['Realm Status', '/server/realmstatus'],
    ['Players online', '/server/online'],
    ['How to play', '/connect'],
    ['InGame Commands', '/server/commands'],
  ];
  const [pop, popColor] = realm.population(r.players + r.bots);
  const row = (label, value) => html`<li><div>${label}:&nbsp;${value}</div></li>`;
  return html`<div id="q-links"><h3>Quicklinks</h3><ul>
  ${quick.map(([label, href], i) => html`<li class="${i % 2 ? 'e' : ''}"><a href="${href}">${label}</a></li>`)}
</ul></div>
<span class="gfxhook"></span><hr>
<div id="box3"><h3>Server Information</h3><ul>
  <li><div>&nbsp;</div></li>
  ${r.dbOnline ? '' : html`<li><div><b style="color:#ff8a80">The realm database is offline.</b></div></li>`}
  ${row('Realm name', html`<b>${r.name || ctx.site.realmName}</b>`)}
  ${row('Status', r.online
    ? html`<img src="/images/uparrow2.gif" height="15" alt=""> <b style="color: rgb(35, 67, 3);">Online</b>`
    : html`<img src="/images/downarrow2.gif" height="15" alt=""> <b style="color: rgb(102, 13, 2);">Offline</b>`)}
  ${row('Online', html`<a href="/server/online">${r.players}</a> players, <a href="/server/online?show=bots">${r.bots}</a> bots`)}
  ${r.address ? row('Server IP', html`<b>${r.address}</b>`) : ''}
  ${r.type ? row('Type', html`<b>${r.type}</b>`) : ''}
  ${r.language ? row('Language', html`<b>${r.language}</b>`) : ''}
  ${row('Population', html`<b><font color="${popColor}">${pop}</font></b>`)}
  ${r.accounts !== null ? row('Accounts', html`<b>${r.accounts}${r.activeAccounts !== null ? ` (${r.activeAccounts} Active)` : ''}</b>`) : ''}
  ${r.characters !== null ? row('Characters', html`<b>${r.characters}</b>`) : ''}
  <li><div>&nbsp;</div></li>
</ul></div>
<span class="gfxhook"></span><hr>`;
}

async function front(req, ctx) {
  let items = [];
  try {
    items = (await news.list(0, 10)).rows;
  } catch (err) {
    if (!(err instanceof require('../data').OfflineError)) throw err;
  }
  const body = html`<div class="frontpage" style="margin-left: -29px">
<div id="module-container"><div style="width:470px;"></div>
  <img class="banner-top" src="/templates/wotlk/images/banner_top.png" alt="" width="470"><br>
</div>
<div class="module-container">
  ${items.length ? items.map(newsItem) : html`${newsItem(welcome(ctx), 0)}${ctx.account && ctx.account.gmlevel >= 3 ? html`<div class="news-empty"><a href="/admin">Post your first news</a> to replace this welcome.</div>` : ''}`}
</div>
<div class="news-archive-link"><div class="news-archive-button"><a href="/news"><span>News Archives</span></a></div></div>
</div>`;
  return { body, right: await rightColumn(ctx), extraCss: [`${TPL}/css/additional_fp.css`] };
}

async function archive(req, ctx) {
  const per = 15;
  const pageNo = Math.max(1, Number(req.query.p) || 1);
  const { rows, total } = await news.list((pageNo - 1) * per, per);
  const pages = Math.max(1, Math.ceil(total / per));
  const body = box('Archived News', html`${rows.length ? rows.map((t) => html`<div class="archive-item">
    <h3>${decodeEntities(t.topic_name)} <small>${date(t.topic_posted)} · ${t.topic_poster}</small></h3>
    <div class="blog-post">${raw(sanitize(t.message || ''))}</div></div>`) : 'No news yet.'}
    ${pager(pageNo, pages, (n) => `/news?p=${n}`)}`);
  return { title: 'News Archives', pathway: 'News Archives', body };
}

module.exports = { front, archive };
