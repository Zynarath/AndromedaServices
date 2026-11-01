'use strict';
// Armory: character search, character sheets and guild rosters. Item icons, talent trees and
// faction names come from SPP's armory database when it's installed; without it those parts show
// names or are left out.
const { html } = require('../html');
const { box, table, pager, subheader, metal, raceIcon, classIcon } = require('../layout');
const data = require('../data');
const gd = require('../gamedata');
const { itemLink, charLink } = require('./server');

const PROFESSIONS = { 164: 'Blacksmithing', 165: 'Leatherworking', 171: 'Alchemy', 182: 'Herbalism', 186: 'Mining', 197: 'Tailoring', 202: 'Engineering', 333: 'Enchanting', 393: 'Skinning', 755: 'Jewelcrafting', 773: 'Inscription' };
const SECONDARY = { 129: 'First Aid', 185: 'Cooking', 356: 'Fishing' };
const NAME_RE = /^[^\s<>"'`;\\/]{2,12}$/u;

function portrait(c) {
  const dir = c.level >= 80 ? 'wow-80' : c.level >= 70 ? 'wow-70' : c.level >= 60 ? 'wow' : 'wow-default';
  return `/armory/images/portraits/${dir}/${Number(c.gender) ? 1 : 0}-${Number(c.race)}-${Number(c.class)}.gif`;
}

async function isBotAccount(accountId) {
  const rows = await data.q('login', 'SELECT username FROM account WHERE id = ?', [accountId]);
  return !!rows[0] && String(rows[0].username).toUpperCase().startsWith(data.botPrefix());
}

async function search(req, ctx) {
  const q = String(req.query.q || '').trim().slice(0, 24);
  const p = Math.max(1, Number(req.query.p) || 1);
  let results = html``;
  if (q) {
    const like = q.replace(/[%_\\]/g, '\\$&') + '%';
    const chars = await data.q('chars', 'SELECT name, race, class, gender, level, zone, online FROM characters WHERE name LIKE ? ORDER BY level DESC, name LIMIT ?, 25', [like, (p - 1) * 25]);
    const total = Number((await data.q('chars', 'SELECT COUNT(*) AS n FROM characters WHERE name LIKE ?', [like]))[0].n);
    let guilds = [];
    try {
      guilds = await data.q('chars', 'SELECT g.guildid, g.name, COUNT(m.guid) AS members FROM guild g LEFT JOIN guild_member m ON m.guildid = g.guildid WHERE g.name LIKE ? GROUP BY g.guildid ORDER BY members DESC LIMIT 10', [like]);
    } catch {}
    results = html`${subheader(`Characters (${total})`)}
${table(['Name', 'Race', 'Class', 'Level', 'Location'], chars.map((c) => [charLink(c.name), raceIcon(c.race, c.gender, gd.RACES[c.race] || ''), classIcon(c.class, gd.CLASSES[c.class] || ''), c.level, gd.zoneName(c.zone)]), { empty: 'No characters found.' })}
${pager(p, Math.ceil(total / 25), (n) => `/armory?q=${encodeURIComponent(q)}&p=${n}`)}
${guilds.length ? html`<br>${subheader('Guilds')}${table(['Guild', 'Members'], guilds.map((g) => [html`<a href="/armory/guild/${g.guildid}"><b>${g.name}</b></a>`, g.members]))}` : ''}`;
  }
  const body = box('Armory', html`<div class="armory-search">
  <img src="/armory/images/armory-top.gif" alt="" class="armory-logo">
  <form method="get" action="/armory">Search characters and guilds: <input name="q" value="${q}" maxlength="24" size="24" autofocus> <input type="submit" value="Search"></form>
</div><br>${results}`);
  return { title: 'Armory', pathway: 'Armory', body };
}

async function talents(c) {
  if (!(await data.hasArmory())) return null;
  let tabs;
  try {
    tabs = await data.q('armory', 'SELECT id, name, tab_number FROM dbc_talenttab WHERE refmask_chrclasses = ? ORDER BY tab_number', [2 ** (Number(c.class) - 1)]);
  } catch {
    return null;
  }
  if (!tabs.length) return null;
  const tals = await data.q('armory', 'SELECT id, ref_talenttab, rank1, rank2, rank3, rank4, rank5 FROM dbc_talent WHERE ref_talenttab IN (?)', [tabs.map((t) => t.id)]);
  const ranks = new Map();
  const tCols = await data.columns('chars', 'character_talent');
  if (tCols.size) {
    const spec = tCols.has('spec') && c.activeSpec !== undefined ? ' AND spec = ?' : '';
    const rows = await data.q('chars', `SELECT talent_id, current_rank FROM character_talent WHERE guid = ?${spec}`, spec ? [c.guid, c.activeSpec] : [c.guid]);
    for (const r of rows) ranks.set(Number(r.talent_id), Number(r.current_rank) + 1);
  } else {
    const spellIds = tals.flatMap((t) => [t.rank1, t.rank2, t.rank3, t.rank4, t.rank5]).filter(Boolean);
    const known = new Set(spellIds.length ? (await data.q('chars', 'SELECT spell FROM character_spell WHERE guid = ? AND spell IN (?)', [c.guid, spellIds])).map((r) => Number(r.spell)) : []);
    for (const t of tals) for (let r = 5; r >= 1; r--) if (known.has(Number(t[`rank${r}`]))) {
      ranks.set(Number(t.id), r);
      break;
    }
  }
  return tabs.map((tab) => ({ name: tab.name, points: tals.filter((t) => t.ref_talenttab === tab.id).reduce((s, t) => s + (ranks.get(Number(t.id)) || 0), 0) }));
}

async function character(req, ctx) {
  const name = String(req.params.name || '');
  const notFound = { status: 404, title: 'Armory', pathway: 'Armory', body: box('Character not found', html`No character called <b>${name}</b> on this realm. <a href="/armory">Search the armory</a>.`) };
  if (!NAME_RE.test(name)) return notFound;
  const cCols = await data.columns('chars', 'characters');
  const extra = ['totalKills', 'totalHonorPoints', 'arenaPoints', 'activeSpec', 'totaltime', 'money', 'health', 'power1', 'chosenTitle'].filter((x) => cCols.has(x.toLowerCase()));
  const c = (await data.q('chars', `SELECT guid, account, name, race, class, gender, level, zone, online${extra.map((x) => `, ${x}`).join('')} FROM characters WHERE name = ?`, [name]))[0];
  if (!c) return notFound;
  const bot = await isBotAccount(c.account);
  let guild = null;
  try {
    guild = (await data.q('chars', 'SELECT g.guildid, g.name, r.rname FROM guild_member m JOIN guild g ON g.guildid = m.guildid LEFT JOIN guild_rank r ON r.guildid = m.guildid AND r.rid = m.rank WHERE m.guid = ?', [c.guid]))[0];
  } catch {}
  const inv = await data.q('chars', 'SELECT slot, item_template FROM character_inventory WHERE guid = ? AND bag = 0 AND slot < 19 ORDER BY slot', [c.guid]);
  const its = await data.items(inv.map((r) => r.item_template));
  const equipped = new Map(inv.map((r) => [Number(r.slot), its.get(Number(r.item_template))]));
  const levels = [...equipped].filter(([slot, it]) => it && slot !== 3 && slot !== 18).map(([, it]) => Number(it.ItemLevel)); // not shirt/tabard
  const avgIlvl = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : null;
  const skills = await data.q('chars', 'SELECT skill, value, max FROM character_skills WHERE guid = ? AND skill IN (?)', [c.guid, [...Object.keys(PROFESSIONS), ...Object.keys(SECONDARY)].map(Number)]).catch(() => []);
  const talentTrees = await talents(c).catch(() => null);
  let reps = [];
  try {
    const rows = await data.q('chars', 'SELECT faction, standing FROM character_reputation WHERE guid = ? AND (flags & 1) = 1 AND standing <> 0 ORDER BY standing DESC LIMIT 15', [c.guid]);
    const names = await data.dbcNames('dbc_faction', rows.map((r) => r.faction));
    reps = rows.filter((r) => names.has(Number(r.faction))).map((r) => ({ faction: names.get(Number(r.faction)), ...gd.repRank(Number(r.standing)) }));
  } catch {}

  const slotRow = (i) => {
    const it = equipped.get(i);
    return [html`<span class="slot-name">${gd.SLOTS[i]}</span>`, it ? itemLink(it, '') : html`<span class="empty-slot">—</span>`, it ? it.ItemLevel : ''];
  };
  const prof = (map) => skills.filter((s) => map[s.skill]).map((s) => html`<div class="prof"><b>${map[s.skill]}</b> <div class="stat-bar"><div style="width:${Math.min(100, (s.value * 100) / (s.max || 450)).toFixed(0)}%"></div></div> ${s.value} / ${s.max}</div>`);
  const color = gd.CLASS_COLORS[c.class] || '#2a2a2a';
  const body = html`${box(null, html`<div class="char-header">
  <img class="char-portrait" src="${portrait(c)}" width="64" height="64" alt="">
  <div class="char-title">
    <h2 style="color:${color}">${c.name}${bot ? html` <small class="bot-tag" title="A random bot">bot</small>` : ''}</h2>
    <div>Level ${c.level} ${gd.RACES[c.race] || ''} <span style="color:${color}">${gd.CLASSES[c.class] || ''}</span> · ${gd.faction(c.race)}</div>
    ${guild ? html`<div>&lt;<a href="/armory/guild/${guild.guildid}">${guild.name}</a>&gt;${guild.rname ? ` · ${guild.rname}` : ''}</div>` : ''}
    <div>${c.online ? html`<b style="color: rgb(35, 67, 3);">Online</b> in ${gd.zoneName(c.zone)}` : html`Last seen in ${gd.zoneName(c.zone)}`}</div>
  </div>
  <div class="char-facts">
    ${avgIlvl !== null ? html`<div>Average item level: <b>${avgIlvl}</b></div>` : ''}
    ${c.totalKills !== undefined ? html`<div>Honorable kills: <b>${Number(c.totalKills).toLocaleString('en-US')}</b></div>` : ''}
    ${c.totaltime !== undefined ? html`<div>Played: <b>${gd.duration(c.totaltime)}</b></div>` : ''}
    ${talentTrees ? html`<div>Talents: <b>${talentTrees.map((t) => t.points).join(' / ')}</b></div>` : ''}
  </div>
</div>`)}
${box('Equipment', table(['Slot', 'Item', 'Item level'], [0, 1, 2, 14, 4, 3, 18, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17].map(slotRow)))}
${talentTrees ? box('Talents', metal(html`<table class="talent-trees" width="100%"><tr>${talentTrees.map((t) => html`<td align="center"><div class="tree-name">${t.name}</div><div class="tree-points">${t.points}</div></td>`)}</tr></table>`)) : ''}
${skills.length ? box('Professions', html`${prof(PROFESSIONS)}${prof(SECONDARY)}`) : ''}
${reps.length ? box('Reputation', table(['Faction', 'Standing', 'Progress'], reps.map((r) => [r.faction, html`<b class="rep-${r.name.toLowerCase()}">${r.name}</b>`, `${r.value} / ${r.max}`]))) : ''}`;
  return { title: c.name, pathway: html`<a href="/armory">Armory</a> &gt; ${c.name}`, body };
}

async function guild(req, ctx) {
  const id = Number(req.params.id);
  const g = Number.isInteger(id) && id > 0 ? (await data.q('chars', 'SELECT guildid, name, leaderguid, motd, info, createdate FROM guild WHERE guildid = ?', [id]))[0] : null;
  if (!g) return { status: 404, title: 'Armory', pathway: 'Armory', body: box('Guild not found', html`<a href="/armory">Search the armory</a>.`) };
  const p = Math.max(1, Number(req.query.p) || 1);
  const members = await data.q('chars', 'SELECT c.name, c.race, c.class, c.gender, c.level, c.online, r.rname, m.rank FROM guild_member m JOIN characters c ON c.guid = m.guid LEFT JOIN guild_rank r ON r.guildid = m.guildid AND r.rid = m.rank WHERE m.guildid = ? ORDER BY m.rank, c.level DESC, c.name LIMIT ?, 50', [id, (p - 1) * 50]);
  const total = Number((await data.q('chars', 'SELECT COUNT(*) AS n FROM guild_member WHERE guildid = ?', [id]))[0].n);
  const body = box(g.name, html`${g.info ? html`<p class="guild-info">${g.info}</p>` : ''}
${table(['Name', 'Race', 'Class', 'Level', 'Rank', 'Status'], members.map((m) => [charLink(m.name), raceIcon(m.race, m.gender, gd.RACES[m.race] || ''), classIcon(m.class, gd.CLASSES[m.class] || ''), m.level, m.rname || `Rank ${m.rank}`, m.online ? html`<b style="color: rgb(35, 67, 3);">Online</b>` : 'Offline']), { caption: `${total} members` })}
${pager(p, Math.ceil(total / 50), (n) => `/armory/guild/${id}?p=${n}`)}`);
  return { title: g.name, pathway: html`<a href="/armory">Armory</a> &gt; ${g.name}`, body };
}

module.exports = { search, character, guild };
