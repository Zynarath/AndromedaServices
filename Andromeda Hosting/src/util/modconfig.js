'use strict';
// Turns mod config files into form fields and writes single values back without touching the rest of
// the file. Understood: Forge/NeoForge TOML (with their "#Range:" / "#Allowed Values:" comments), JSON,
// .properties and Forge 1.12 .cfg. Anything else (or a value this can't map, like a multi-line list)
// is left to the raw editor.

const NUM = /^[+-]?(\d[\d_]*)(\.\d+)?([eE][+-]?\d+)?$/;

// Hints from the comment lines right above a value. Lines the form shows another way (the range as a
// slider, the default as a marker, the allowed values as choices) stay out of the explanation.
function readComments(lines) {
  const out = {};
  const text = [];
  for (const l of lines) {
    const range = /Range:\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*~\s*(-?[\d.]+(?:[eE][+-]?\d+)?)/i.exec(l);
    const def = /^\s*Default:\s*(.+?)\s*$/i.exec(l);
    const allowed = /Allowed Values:\s*(.+)$/i.exec(l);
    const oneSided = /Range:\s*([<>])=?\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*$/i.exec(l); // Forge: "Range: > 5" = 5 or more
    if (range) {
      if (Number(range[1]) <= Number(range[2])) Object.assign(out, { min: Number(range[1]), max: Number(range[2]) });
    } else if (oneSided) out[oneSided[1] === '>' ? 'min' : 'max'] = Number(oneSided[2]);
    else if (def) out.def = def[1].replace(/^"(.*)"$/, '$1');
    else if (allowed) out.options = allowed[1].split(',').map((s) => s.trim()).filter(Boolean);
    else text.push(l.trim());
  }
  out.hint = text.join(' ').replace(/\s+/g, ' ').trim() || undefined;
  return out;
}

// ---- TOML (Forge/NeoForge config files) ----
function parseToml(text) {
  const lines = text.split(/\r?\n/);
  const fields = [];
  let section = '';
  let comments = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      comments = [];
      continue;
    }
    if (t.startsWith('#')) {
      comments.push(t.replace(/^#+\s?/, ''));
      continue;
    }
    const sec = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*$/.exec(t);
    if (sec) {
      section = sec[1].replace(/"/g, '');
      comments = [];
      continue;
    }
    const kv = /^(\s*)("(?:[^"\\]|\\.)*"|[A-Za-z0-9_.-]+)(\s*=\s*)(.+?)\s*$/.exec(line);
    if (!kv) {
      comments = [];
      continue;
    }
    const raw = kv[4];
    const valueStart = kv[1].length + kv[2].length + kv[3].length;
    const key = kv[2].replace(/^"|"$/g, '');
    const info = readComments(comments);
    comments = [];
    let type;
    let value;
    if (raw === 'true' || raw === 'false') [type, value] = ['bool', raw === 'true'];
    else if (NUM.test(raw)) [type, value] = ['number', Number(raw.replace(/_/g, ''))];
    else if (/^"(?:[^"\\]|\\.)*"$/.test(raw)) {
      try {
        value = JSON.parse(raw);
      } catch {
        continue;
      }
      type = info.options ? 'select' : 'text';
    } else if (/^'[^']*'$/.test(raw)) [type, value] = [info.options ? 'select' : 'text', raw.slice(1, -1)];
    else if (/^\[.*\]$/.test(raw)) [type, value] = ['list', raw];
    else continue; // multi-line arrays, inline tables: raw editor
    fields.push({ id: `L${i}`, line: i, start: valueStart, label: key, section, type, value, raw, ...info });
  }
  return fields;
}

function tomlLiteral(field, v) {
  if (field.type === 'bool') return v === true || v === 'true' ? 'true' : 'false';
  if (field.type === 'number') return String(v);
  if (field.type === 'list') return String(v);
  return field.raw.startsWith("'") && !String(v).includes("'") ? `'${v}'` : JSON.stringify(String(v));
}

// ---- .properties ----
function parseProperties(text) {
  const fields = [];
  let comments = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return void (comments = []);
    if (t.startsWith('#') || t.startsWith('!')) return void comments.push(t.replace(/^[#!]+\s?/, ''));
    const m = /^(\s*)([^=:\s]+)(\s*[=:]\s*)(.*)$/.exec(line);
    if (!m) return void (comments = []);
    const raw = m[4].trim();
    const type = raw === 'true' || raw === 'false' ? 'bool' : NUM.test(raw) ? 'number' : 'text';
    fields.push({ id: `L${i}`, line: i, start: m[1].length + m[2].length + m[3].length, label: m[2], section: '', type, value: type === 'bool' ? raw === 'true' : type === 'number' ? Number(raw) : raw, raw, ...readComments(comments) });
    comments = [];
  });
  return fields;
}

// ---- Forge 1.12 .cfg ("B:name=true" inside "category {") ----
function parseCfg(text) {
  const fields = [];
  const stack = [];
  let comments = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return void (comments = []);
    if (t.startsWith('#')) return void comments.push(t.replace(/^#+\s?/, ''));
    const open = /^("?)([^"{]+)\1\s*\{$/.exec(t);
    if (open) return void (stack.push(open[2].trim()), (comments = []));
    if (t === '}') return void (stack.pop(), (comments = []));
    const m = /^(\s*)([BIDS]):("?)([^"=]+)\3(=)(.*)$/.exec(line);
    if (!m) return void (comments = []);
    const raw = m[6].trim();
    const type = { B: 'bool', I: 'number', D: 'number', S: 'text' }[m[2]];
    const info = readComments(comments);
    fields.push({ id: `L${i}`, line: i, start: line.indexOf('=') + 1, label: m[4], section: stack.join('.'), type: type === 'text' && info.options ? 'select' : type, value: type === 'bool' ? raw === 'true' : type === 'number' ? Number(raw) : raw, raw, int: m[2] === 'I', ...info });
    comments = [];
  });
  return fields;
}

// ---- JSON ----
function parseJson(text) {
  const data = JSON.parse(text.replace(/^﻿/, ''));
  const fields = [];
  const walk = (v, p) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.entries(v).forEach(([k, x]) => walk(x, [...p, k]));
    if (Array.isArray(v)) {
      if (v.every((x) => x === null || typeof x !== 'object')) fields.push({ id: 'J' + JSON.stringify(p), path: p, label: p[p.length - 1], section: p.slice(0, -1).join('.'), type: 'list', value: JSON.stringify(v) });
      // Lists of objects (kits, zones, rewards…): each entry's values, numbered from 1.
      else if (v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) v.forEach((x, i) => walk(x, [...p, i]));
      return; // mixed arrays: raw editor
    }
    const type = typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'text' : null;
    if (type) fields.push({ id: 'J' + JSON.stringify(p), path: p, label: p[p.length - 1], section: p.slice(0, -1).join('.'), type, value: v });
  };
  walk(data, []);
  return { data, fields };
}

// ---- Readable names ----
// Config keys as people would write them: "MaxHomesPerPlayer", "max_homes" and "maxHomes" all become
// "Max homes per player". Keys that are already words ("Chat prefix") keep their wording. Acronyms
// (UI, PvP, XP) and numbers stay as they are.
const ACRONYMS = new Map(
  ['UI', 'GUI', 'HUD', 'XP', 'PvP', 'PvE', 'NPC', 'NPCs', 'ID', 'IDs', 'URL', 'API', 'IP', 'HP', 'AI', 'RCON', 'FPS', 'CUI', 'SteamID', 'JSON', 'UTC', 'DPS'].map((w) => [w.toLowerCase(), w])
);

function humanize(key) {
  let s = String(key).trim();
  // "(true/false)" and similar type notes say nothing a switch or number box doesn't already.
  s = s.replace(/\s*\((?:true\s*\/\s*false|false\s*\/\s*true|yes\s*\/\s*no|bool|boolean|number|int|float|string)\)\s*/gi, ' ').trim();
  if (!s) return String(key);
  if (/\s/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
  const words = s
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z]{2,})/g, '$1 $2')
    .trim()
    .split(/\s+/);
  // Split words that are one acronym written in two parts ("Pv P", "NP Cs") back together.
  const joined = [];
  for (const w of words) {
    const prev = joined[joined.length - 1];
    if (prev && ACRONYMS.has((prev + w).toLowerCase()) && !ACRONYMS.has(w.toLowerCase())) joined[joined.length - 1] = prev + w;
    else joined.push(w);
  }
  return joined
    .map((w, i) => {
      const acr = ACRONYMS.get(w.toLowerCase());
      if (acr) return acr;
      if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w; // other acronyms
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase();
    })
    .join(' ');
}

// Readable labels and sections; the key as written in the file is kept in `key`.
function normalizeFields(fields) {
  const part = (x) => (typeof x === 'number' ? `#${x + 1}` : humanize(x));
  return fields.map((f) => {
    const parts = f.path ? f.path.slice(0, -1) : f.section ? f.section.split('.') : [];
    return { ...f, key: String(f.label), label: part(f.label), section: parts.map(part).join(' › ') };
  });
}

// ---- Presentation: what a setting is measured in, a slider for it, and which settings come first ----
const UNIT_WORDS = [
  [/^(ms|millis|milliseconds?)$/, 'ms'],
  [/^(secs?|seconds?)$/, 's'],
  [/^(mins|minutes?)$/, 'min'], // not "min": that is "minimum" far more often
  [/^(hrs?|hours?)$/, 'h'],
  [/^days?$/, 'days'],
  [/^ticks?$/, 'ticks'],
  [/^(percent|percentage|pct)$/, '%'],
  [/^(multipliers?|mult|modifiers?|scale|factor)$/, '×'],
  [/^blocks$/, 'blocks'], // not "block": that is usually the verb ("block teleport while mounted")
  [/^chunks$/, 'chunks'],
  [/^(meters?|metres?)$/, 'm'],
];
const words = (s) => humanize(String(s || '')).toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);
const unitWord = (list) => {
  for (let i = list.length - 1; i >= 0; i--) {
    const hit = UNIT_WORDS.find(([re]) => re.test(list[i]));
    if (hit) return hit[1];
  }
  return undefined;
};

// The unit a number is in, when its name or its comment says so ("CooldownSeconds", "(in ticks)").
function unitOf(f) {
  if (f.type !== 'number') return undefined;
  const key = f.key || f.label;
  if (/%/.test(key)) return '%';
  const own = unitWord(words(key));
  if (own) return own;
  const said = /(?:\bin|\bof|\()\s*(milliseconds|seconds|minutes|hours|days|ticks|blocks|chunks|percent)\b/i.exec(f.hint || '');
  if (said) return unitWord([said[1].toLowerCase()]);
  // "Gather resource modifiers › Wood": the unit is in the group's name.
  const group = String(f.section || '').split(/\s*›\s*|\./).pop();
  const inherited = unitWord(words(group));
  return inherited === '×' ? '×' : undefined;
}

// 1, 2, 5, 10, 20, 50…: the first of these that is not below x.
function niceCeil(x) {
  const mag = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5, 10]) if (m * mag >= x * (1 - 1e-9)) return Number((m * mag).toPrecision(12));
  return x;
}

// Numbers that name something rather than measure it.
const NO_SLIDER = /\b(seed|ports?|ids?|steam ?id|version|password|year|key|code|hash|colou?r)\b/;
const isChance = (f) => /\b(chance|probability|odds)\b/.test(words(f.key || f.label).join(' '));

// A slider for a number: the range the file states when it is a usable one ("Range: 0 ~ 10"), else a
// range around the current and default values. `soft` ranges are a convenience, not a limit: the
// number box next to the slider still takes any value.
function sliderFor(f, unit = unitOf(f)) {
  if (f.type !== 'number' || NO_SLIDER.test(words(f.key || f.label).join(' '))) return undefined;
  const v = Number(f.value);
  const d = f.def === undefined || f.def === '' ? NaN : Number(f.def);
  if (!Number.isFinite(v)) return undefined;
  const hasMin = Number.isFinite(f.min);
  const hasMax = Number.isFinite(f.max);
  const min = hasMin ? f.min : 0;
  if (v < min || (Number.isFinite(d) && d < min)) return undefined; // negative values with no known floor
  const ref = Math.max(Math.abs(v), Number.isFinite(d) ? Math.abs(d) : 0);
  const text = `${f.raw ?? f.value} ${f.def ?? ''}`;
  const float = !f.int && (/\d\.\d/.test(text) || unit === '×' || isChance(f) || !Number.isInteger(v) || (Number.isFinite(d) && !Number.isInteger(d)) || (hasMin && !Number.isInteger(f.min)) || (hasMax && !Number.isInteger(f.max)));
  let max;
  let soft = true;
  if (hasMax && f.max - min <= Math.max(1000, ref * 20)) {
    max = f.max;
    soft = false;
  } else if (isChance(f) && ref <= 1) max = 1;
  else if ((unit === '%' || isChance(f)) && ref <= 100) max = 100;
  else if (unit === '×') max = Math.max(5, niceCeil(ref * 3));
  else if (ref > 0) max = niceCeil(ref * 3);
  else return undefined; // 0 with nothing to say how big it gets
  if (hasMax) max = Math.min(max, f.max);
  if (!(max > min)) return undefined;
  const step = float ? niceCeil((max - min) / 100) : Math.max(1, niceCeil((max - min) / 100));
  return { min, max, step, ...(soft ? { soft: true } : {}) };
}

// Which settings people actually change: switches, amounts, rates and limits come first; colours,
// messages, IDs, debug options and the like wait behind "Show all".
const LIKELY = /\b(enabled?|disabled?|allow(ed)?|max(imum)?|min(imum)?|limit|rates?|multipliers?|modifiers?|chance|cooldown|amount|count|damage|health|time|duration|radius|range|distance|cost|price|xp|experience|drops?|loot|spawn(s|ing)?|levels?|speed|pvp|pve|stack(s|ing)?|size|capacity|delay|interval|rewards?|difficulty|decay|upkeep|gather(ing)?|craft(ing)?|teleport|homes?|kits?|players?|frequency|density)\b/;
const UNLIKELY = /\b(debug|log(ging|s)?|verbose|version|colou?rs?|messages?|prefix|format|sounds?|particles?|effects?|icons?|images?|url|webhook|token|keys?|ids?|guid|uuid|permissions?|commands?|anchor|offset|position|pos|font|lang(uage)?|locale|tooltips?|render(ing|er)?|textures?|models?|shaders?|animations?|telemetry|metrics|avatar|hex|rgba?|json|path|file|folder|directory|ui|gui|hud|cui|overlay|display|steam ?id|update check(er)?)\b/;
const COMMON_LIMIT = 12;

function likelihood(f) {
  const name = words(f.key || f.label).join(' ');
  const group = words(f.section).join(' ');
  let score = { bool: 3, number: 3, select: 3, text: 1 }[f.type] || 0;
  if (LIKELY.test(name)) score += 3;
  if (UNLIKELY.test(name)) score -= 4;
  else if (UNLIKELY.test(group)) score -= 2;
  if (f.hint) score += 1; // explained by its author: meant to be changed
  const depth = String(f.section || '').split(/\s*›\s*|\./).filter(Boolean).length;
  if (depth > 2) score -= 1;
  if (/#\d+/.test(f.section || '')) score -= 2; // one entry of a list (kit #3, zone #7)
  return score;
}

// Adds to every field what the form needs to draw it well: `unit`, `slider` and `common` (false for
// the settings kept behind "Show all"). Small files show everything.
function present(fields, { limit = COMMON_LIMIT } = {}) {
  if (!fields) return fields;
  const out = fields.map((f) => {
    const unit = unitOf(f);
    const slider = sliderFor(f, unit);
    return { ...f, ...(unit ? { unit } : {}), ...(slider ? { slider } : {}), common: true };
  });
  if (out.length <= limit + 3) return out;
  const ranked = out.map((f, i) => [likelihood(f), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  // Enough likely ones: only those. A file of nothing but messages or colours: its first few.
  const likely = ranked.filter(([score]) => score > 0);
  const keep = new Set((likely.length >= 4 ? likely : ranked).slice(0, limit).map(([, i]) => i));
  out.forEach((f, i) => (f.common = keep.has(i)));
  return out;
}

const FORMATS = { '.toml': 'toml', '.json': 'json', '.properties': 'properties', '.cfg': 'cfg' };

function formatOf(file) {
  const ext = (/\.[^.]+$/.exec(file) || [''])[0].toLowerCase();
  return FORMATS[ext] || 'raw';
}

// { format, fields | null } — fields null when only the raw editor can handle the file.
// opts.normalize: readable labels ("Max homes per player") instead of the keys from the file.
function describe(file, text, opts = {}) {
  const format = formatOf(file);
  let fields = null;
  try {
    if (format === 'toml') fields = parseToml(text);
    else if (format === 'properties') fields = parseProperties(text);
    else if (format === 'cfg') fields = parseCfg(text);
    else if (format === 'json') fields = parseJson(text).fields;
  } catch {
    /* not valid for its extension (e.g. JSON with comments): raw editor */
  }
  return { format, fields: fields && opts.normalize ? normalizeFields(fields) : fields };
}

function checkValue(f, v) {
  if (f.type === 'bool') return v === true || v === 'true';
  if (f.type === 'number') {
    const n = Number(v);
    if (v === '' || !Number.isFinite(n)) throw new Error(`${f.label}: must be a number`);
    const low = f.min !== undefined && n < f.min;
    const high = f.max !== undefined && n > f.max;
    if (low || high) throw new Error(`${f.label}: must be ${f.min !== undefined && f.max !== undefined ? `between ${f.min} and ${f.max}` : low ? `${f.min} or more` : `${f.max} or less`}`);
    if (f.int && !Number.isInteger(n)) throw new Error(`${f.label}: must be a whole number`);
    return n;
  }
  if (f.type === 'select' && !f.options.includes(String(v))) throw new Error(`${f.label}: not one of ${f.options.join(', ')}`);
  if (f.type === 'list') {
    const s = String(v).trim();
    if (!/^\[[\s\S]*\]$/.test(s) || /[\r\n]/.test(s)) throw new Error(`${f.label}: write the list on one line, like ["a", "b"]`);
    return s;
  }
  return String(v).replace(/[\r\n]+/g, ' ');
}

// Apply { fieldId: value } to the file text; only changed values are rewritten.
function apply(file, text, values, opts = {}) {
  const { format, fields } = describe(file, text, opts);
  if (!fields) throw new Error('This file can only be edited as raw text');
  const byId = new Map(fields.map((f) => [f.id, f]));
  const changes = [];
  for (const [id, v] of Object.entries(values)) {
    const f = byId.get(id);
    if (!f) continue;
    const val = checkValue(f, v);
    const same = f.type === 'list' ? String(f.value) === val : f.value === val;
    if (!same) changes.push([f, val]);
  }
  if (!changes.length) return { text, changed: 0 };
  if (format === 'json') {
    const { data } = parseJson(text);
    for (const [f, val] of changes) {
      let o = data;
      for (const k of f.path.slice(0, -1)) o = o[k];
      o[f.path[f.path.length - 1]] = f.type === 'list' ? JSON.parse(val) : val;
    }
    const indent = (/\n([ \t]+)"/.exec(text) || [null, '  '])[1];
    return { text: JSON.stringify(data, null, indent) + (text.endsWith('\n') ? '\n' : ''), changed: changes.length };
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  for (const [f, val] of changes) {
    const literal = format === 'toml' ? tomlLiteral(f, val) : String(val);
    lines[f.line] = lines[f.line].slice(0, f.start) + literal;
  }
  return { text: lines.join(eol), changed: changes.length };
}

module.exports = { describe, apply, formatOf, humanize, present, unitOf, sliderFor, likelihood, parseToml, parseJson, parseCfg, parseProperties };
