'use strict';
// Turns mod config files into form fields and writes single values back without touching the rest of
// the file. Understood: Forge/NeoForge TOML (with their "#Range:" / "#Allowed Values:" comments), JSON,
// .properties and Forge 1.12 .cfg. Anything else (or a value this can't map, like a multi-line list)
// is left to the raw editor.

const NUM = /^[+-]?(\d[\d_]*)(\.\d+)?([eE][+-]?\d+)?$/;

// Hints from the comment lines right above a value.
function readComments(lines) {
  const out = { hint: lines.join(' ').trim() || undefined };
  for (const l of lines) {
    const range = /Range:\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*~\s*(-?[\d.]+(?:[eE][+-]?\d+)?)/i.exec(l);
    if (range) Object.assign(out, { min: Number(range[1]), max: Number(range[2]) });
    const def = /^\s*Default:\s*(.+?)\s*$/i.exec(l);
    if (def) out.def = def[1].replace(/^"(.*)"$/, '$1');
    const allowed = /Allowed Values:\s*(.+)$/i.exec(l);
    if (allowed) out.options = allowed[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
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
      return; // arrays of objects: raw editor
    }
    const type = typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'text' : null;
    if (type) fields.push({ id: 'J' + JSON.stringify(p), path: p, label: p[p.length - 1], section: p.slice(0, -1).join('.'), type, value: v });
  };
  walk(data, []);
  return { data, fields };
}

const FORMATS = { '.toml': 'toml', '.json': 'json', '.properties': 'properties', '.cfg': 'cfg' };

function formatOf(file) {
  const ext = (/\.[^.]+$/.exec(file) || [''])[0].toLowerCase();
  return FORMATS[ext] || 'raw';
}

// { format, fields | null } — fields null when only the raw editor can handle the file.
function describe(file, text) {
  const format = formatOf(file);
  try {
    if (format === 'toml') return { format, fields: parseToml(text) };
    if (format === 'properties') return { format, fields: parseProperties(text) };
    if (format === 'cfg') return { format, fields: parseCfg(text) };
    if (format === 'json') return { format, fields: parseJson(text).fields };
  } catch {
    /* not valid for its extension (e.g. JSON with comments): raw editor */
  }
  return { format, fields: null };
}

function checkValue(f, v) {
  if (f.type === 'bool') return v === true || v === 'true';
  if (f.type === 'number') {
    const n = Number(v);
    if (v === '' || !Number.isFinite(n)) throw new Error(`${f.label}: must be a number`);
    if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) throw new Error(`${f.label}: must be between ${f.min} and ${f.max}`);
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
function apply(file, text, values) {
  const { format, fields } = describe(file, text);
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

module.exports = { describe, apply, formatOf, parseToml, parseJson, parseCfg, parseProperties };
