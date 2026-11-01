'use strict';
// The page frame of SPP's website (templates/offlike body_header/body_footer with the WotLK
// template's CSS and images), rebuilt without its inline scripts. The graphics are served from the
// SPP install's own Server\website folder, so they look exactly as before.
const { html, raw } = require('./html');

const TPL = '/templates/WotLK';
const OFF = '/templates/offlike';

// Box with a title bar (builddiv_start / builddiv_end).
function box(title, body, type = 0) {
  if (!title) {
    return html`<div style="background: url('${TPL}/images/light.jpg') repeat; border: 0 solid #000; border-top-width: 1px; border-bottom-width: 1px; border-top-style: solid; border-bottom-style: solid; margin: 4px 0 5px 0"><div class="contentdiv">${body}</div></div>`;
  }
  return html`<div style="width: 659px; height: 29px; background: url('${TPL}/images/${type === 1 ? 'content-parting.jpg' : 'content-parting2.jpg'}') no-repeat;"><div style="padding: 2px 0 0 23px;"><h2 class="parting-title">${title}</h2></div></div>
<div style="background: url('${TPL}/images/light.jpg') repeat; border-bottom: 1px solid #000; margin: 0 0 5px 0"><div class="contentdiv">${body}</div></div>`;
}

// Bevelled metal frame around tables (write_metalborder_header / _footer).
function metal(body) {
  const img = (n, w, h) => html`<img src="${TPL}/images/metalborder-${n}.gif" width="${w}" height="${h}" alt="">`;
  return html`<table class="metalborder" border="0" cellpadding="0" cellspacing="0" width="100%"><tbody>
<tr><td width="12">${img('top-left', 12, 12)}</td><td style="background:url('${TPL}/images/metalborder-top.gif');"></td><td width="12">${img('top-right', 12, 12)}</td></tr>
<tr><td style="background:url('${TPL}/images/metalborder-left.gif');"></td><td>${body}</td><td style="background:url('${TPL}/images/metalborder-right.gif');"></td></tr>
<tr><td>${img('bot-left', 12, 11)}</td><td style="background:url('${TPL}/images/metalborder-bot.gif');"></td><td>${img('bot-right', 12, 11)}</td></tr>
</tbody></table>`;
}

function subheader(title) {
  return html`<table border="0" cellpadding="0" cellspacing="0" width="100%"><tbody><tr>
<td width="24"><img src="${TPL}/images/subheader-left-sword.gif" height="20" width="24" alt=""></td>
<td bgcolor="#05374a" width="100%"><b style="color:white;">${title}:</b></td>
<td width="10"><img src="${TPL}/images/subheader-right.gif" height="20" width="10" alt=""></td>
</tr></tbody></table>`;
}

// Big picture header some pages open with (header_image("realm") etc.).
function headerImage(name) {
  return html`<table style="margin-left:-7px;" cellspacing="0" cellpadding="0" border="0" width="102%"><tr><td width="10"></td>
<td style="background:url('${OFF}/images/headers/${name}bg.jpg')" align="left"><div><img src="${OFF}/images/headers/${name}head.jpg" alt=""></div></td>
<td width="10"></td></tr><tr><td height="10"></td></tr></table>`;
}

// Ranking-style table: header cells, then rows in alternating colours.
function table(headers, rows, { caption, empty = 'Nothing to show.' } = {}) {
  const cols = headers.length;
  return metal(html`<table class="ranking" cellpadding="3" cellspacing="0" width="100%"><tbody>
${caption ? html`<tr><td class="rankingHeader" align="center" colspan="${cols}">${caption}</td></tr>` : ''}
<tr>${headers.map((h) => html`<td class="rankingHeader" align="center" nowrap="nowrap">${h}</td>`)}</tr>
${rows.length ? rows.map((r, i) => html`<tr>${r.map((c) => html`<td class="serverStatus${(i % 2) + 1}" align="center">${c}</td>`)}</tr>`) : html`<tr><td class="serverStatus1" align="center" colspan="${cols}">${empty}</td></tr>`}
</tbody></table>`);
}

function pager(page, pages, href) {
  if (pages <= 1) return '';
  const nums = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) out.push(html`<span>…</span>`);
    out.push(n === page ? html`<b>[${n}]</b>` : html`<a href="${href(n)}">${n}</a>`);
    prev = n;
  }
  return html`<div class="pager">Page: ${out}</div>`;
}

const raceIcon = (race, gender, title) => html`<img src="${TPL}/images/icon/race/${Number(race)}-${Number(gender) ? 1 : 0}.gif" width="18" height="18" alt="${title}" title="${title}">`;
const classIcon = (cls, title) => html`<img src="${TPL}/images/icon/class/${Number(cls)}.gif" width="18" height="18" alt="${title}" title="${title}">`;

function menu(ctx) {
  const { account, site } = ctx;
  const sections = [
    ['1', 'menunews', [['Current News', '/'], ['Archived News', '/news']]],
    ['2', 'menuaccount', [
      account && ['My account', '/account'],
      !account && ['Log in', '/account/login'],
      !account && site.registration !== 'off' && ['New account', '/account/register'],
      account && account.gmlevel >= 3 && ['Admin panel', '/admin'],
    ]],
    ['3', 'menugameguide', [['How to play', '/connect']]],
    ['4', 'menuinteractive', [
      ['Realm status', '/server/realmstatus'],
      ['Honor', '/server/honor'],
      ['Players online', '/server/online'],
      ['Characters', '/server/characters'],
      ['Statistics', '/server/statistics'],
      ['Auction House', '/server/ah'],
      ['Armory', '/armory'],
    ]],
    ['7', 'menucommunity', [site.discord && ['Discord', site.discord]]],
    ['8', 'menusupport', [['In-game commands', '/server/commands'], ['Bug tracker', 'https://github.com/Zynarath/AndromedaServices/issues']]],
  ];
  return sections
    .map(([n, id, links]) => [n, id, links.filter(Boolean)])
    .filter(([, , links]) => links.length)
    .map(([n, id, links]) => html`<div id="${id}">
  <div class="menu-button-on" id="${id}-button" data-menu="${id}">
    <span class="${id}-icon-on" id="${id}-icon">&nbsp;</span><a class="${id}-header-on" id="${id}-header"><em>${id}</em></a><a id="${id}-collapse" class="leftmenu-minuslink"></a><span class="menuentry-rightborder"></span>
  </div>
  <div id="${id}-inner">
    <div class="leftmenu-cont-top"></div>
    <div class="leftmenu-cont-mid"><div class="m-left"><div class="m-right"><div class="leftmenu-cnt" id="menucontainer${n}">
      <ul class="mainnav"><li style="position:relative;" id="menufiller${n}">
        ${links.map(([label, href]) => html`<div><a class="menufiller" href="${href}"${/^https?:/.test(href) ? raw(' rel="noopener noreferrer" target="_blank"') : ''}>${label}</a></div>`)}
      </li></ul>
    </div></div></div></div>
    <div class="leftmenu-cont-bot"></div>
  </div>
</div>`);
}

function loginBox(ctx) {
  const { account, csrf } = ctx;
  if (account) {
    return html`<form action="/account/logout" method="post"><input type="hidden" name="_csrf" value="${csrf}">
      ${account.username}
      <a href="/account"><img src="${TPL}/images/button-profile.gif" alt="Profile"></a>
      <input type="image" src="${TPL}/images/button-logout.gif" alt="Logout" value="Logout"></form>`;
  }
  return html`<form action="/account/login" method="post"><input type="hidden" name="_csrf" value="${csrf}">
      Login: <input name="login" size="14" type="text" maxlength="16" autocomplete="username">
      Password: <input name="pass" size="14" type="password" maxlength="16" autocomplete="current-password">
      <input type="image" src="${TPL}/images/button-login.gif" alt="Login" value="Login"></form>`;
}

const CSS = ['newhp.css', 'newhp_basic.css', 'newhp_icons.css', 'newhp_layout.css', 'newhp_specific.css', 'additional_optimisation.css'];

// ctx: { site, account, csrf, title, pathway, messages, right (front page column), extraCss, assetsMissing }
function page(ctx, body) {
  const title = ctx.title ? `${ctx.site.title} - ${ctx.title}` : ctx.site.title;
  return html`<!DOCTYPE html>
<html lang="en"${ctx.assetsMissing ? raw(' class="no-assets"') : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1040">
<!-- The design is dark text on parchment. Browser dark modes (Chrome's auto dark mode, Dark Reader)
     turn that text light and unreadable, so the page opts out of them. -->
<meta name="color-scheme" content="only light">
<meta name="darkreader-lock">
<title>${title}</title>
<script src="/site/fit.js"></script>
<link rel="shortcut icon" href="${TPL}/images/favicon.ico">
${CSS.map((f) => html`<link rel="stylesheet" href="${TPL}/css/${f}">`)}
${(ctx.extraCss || []).map((f) => html`<link rel="stylesheet" href="${f}">`)}
<link rel="stylesheet" href="/site/site.css">
<script src="/site/site.js" defer></script>
</head>
<body>
<div class="page-bg-top" style="background: url('${TPL}/images/page-bg-top.jpg') repeat-x 0 0;"></div>
<center>
<table align="center" border="0" cellpadding="0" cellspacing="0"><tr><td>
<div id="hp">
  <div class="top-nav-container">
    <div id="loginbox"><div class="loginboxleft"></div><div class="loginboxbg">${loginBox(ctx)}</div><div class="loginboxright"></div></div>
    <div style="position: absolute; top: 0; left: 0; z-index: 20002;">
      <div id="wow-logo"><a href="/"><img title="${ctx.site.title}" alt="World of Warcraft" height="103" width="252" src="${TPL}/images/pixel000.gif"></a></div>
    </div>
  </div>
  <div><div id="hpwrapper">
  <table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
  <td valign="top"><div id="navwrapper"><div id="nav"><div id="left-bg"></div><div id="leftmenu"><div id="leftmenucontainer">
    ${menu(ctx)}
  </div></div></div><div style="clear: both;"></div></div></td>
  <td valign="top"><div id="mainwrapper"><div id="main"><div id="main-content-wrapper"><div id="main-content">
  <table cellspacing="0" cellpadding="0" border="0">
    <tr><td><div id="main-top"><div><div><div></div></div></div></div></td></tr>
    <tr><td><div id="contentpadding"><div id="cnt"><div id="cnt-wrapper"><div id="contentcontainer">
      <table cellspacing="0" cellpadding="0" border="0" width="99%"><tr>
      <td valign="top"><div id="cntmain">
        <div id="cnt-top"><div><div></div></div></div>
        <div id="content"><div id="content-left"><div id="content-right">
        <div id="compcont" style="margin:-15px;"><div style="clear:both;display:block;position:relative;width:100%;margin-top:-4px;">
          ${ctx.pathway ? html`<div class="redbannerbg"><div class="redbannerleft"></div><div class="redbannerlabel">${ctx.pathway}</div><div class="redbannerright"></div></div>` : ''}
          ${(ctx.messages || []).map((m) => html`<div class="site-msg site-msg-${m.type || 'info'}">${m.text}</div>`)}
          ${body}
        </div></div>
        </div></div></div>
        <div id="cnt-bot"><div><div>&nbsp;</div></div></div>
      </div></td>
      ${ctx.right ? html`<td valign="top" style="padding-left: 21px; padding-top: 5px;">${ctx.right}</td>` : ''}
      </tr></table>
    </div></div></div>
    <div style="clear: both; font-size: 1px;">&nbsp;</div>
    <center><div id="copyright">
      <div id="blizzlogo-bot"><img alt="Blizzard" border="0" src="${TPL}/images/bot-blizzlogo.gif"></div>
      <span class="textlinks"><small>
        ${ctx.site.title}<br>
        Powered by <a href="https://github.com/Zynarath/AndromedaServices" rel="noopener noreferrer" target="_blank">Andromeda Services</a><br>
        <b>World of Warcraft images and logos are copyright Blizzard Entertainment.</b>
      </small></span><br><br><br>
    </div></center>
    </div></td></tr>
    <tr><td><div id="main-bottom"><div><div></div></div></div></td></tr>
  </table>
  </div></div>
  <div style="position: relative; z-index: 10;"><img class="statue" style="position: absolute; top: -445px; left: -243px;" alt="" src="/templates/vanilla/images/statue.png"></div>
  </div></div></td>
  </tr></table>
  </div></div>
</div>
</td></tr></table>
</center>
<div id="ironframe" style="z-index: 11;"></div>
<div id="pageend"></div>
</body>
</html>`;
}

module.exports = { page, box, metal, subheader, headerImage, table, pager, raceIcon, classIcon, TPL, OFF };
