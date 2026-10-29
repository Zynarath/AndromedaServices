'use strict';
// Settings forms for games whose settings are a flat list of values kept on the server record
// (Valheim, 7 Days to Die, Satisfactory). Each field:
//   { name, label, type: text|number|bool|select|textarea, group, def, min, max, step, options: [[value, label]],
//     pattern, maxLength, admin, hint }
// `admin` fields end up on a command line or decide what the server runs, so only admins may change them.
const { HttpError } = require('./misc');

function schema(prefix, fields, groups, { collapsed = [] } = {}) {
  const sections = groups.map((title) => ({
    title,
    collapsed: collapsed.includes(title),
    fields: fields
      .filter((f) => f.group === title)
      .map((f) => ({
        key: `${prefix}.${f.name}`,
        label: f.label,
        type: f.type,
        hint: f.hint,
        admin: f.admin,
        def: f.def,
        min: f.min,
        step: f.step || (f.type === 'number' && !f.float ? 1 : undefined),
        options: f.options && f.options.map(([value, label]) => ({ value, label })),
      })),
  }));
  return sections.filter((s) => s.fields.length);
}

function read(prefix, fields, obj) {
  const out = {};
  for (const f of fields) {
    const v = obj[f.name];
    out[`${prefix}.${f.name}`] = f.type === 'bool' ? !!(v ?? f.def) : v === null || v === undefined ? '' : String(v);
  }
  return out;
}

// Check every value first, then return a function that applies them, so a bad value leaves nothing half-saved.
function parse(prefix, fields, values, { admin = false } = {}) {
  const changes = {};
  for (const f of fields) {
    const k = `${prefix}.${f.name}`;
    if (!(k in values)) continue;
    if (f.admin && !admin) continue;
    if (f.readOnly) continue;
    const v = values[k];
    const blank = v === '' || v === null || v === undefined;
    if (f.type === 'bool') changes[f.name] = v === true || v === 'true' || v === '1' || v === 1;
    else if (f.type === 'number') {
      if (blank) {
        if (f.required) throw new HttpError(400, `${f.label}: enter a number`);
        changes[f.name] = f.def ?? null;
        continue;
      }
      const n = Number(v);
      if (!Number.isFinite(n) || (!f.float && !Number.isInteger(n))) throw new HttpError(400, `${f.label}: enter a ${f.float ? '' : 'whole '}number`);
      if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) throw new HttpError(400, `${f.label}: must be from ${f.min ?? '…'} to ${f.max ?? '…'}`);
      changes[f.name] = n;
    } else if (f.type === 'select') {
      const s = blank ? '' : String(v);
      if (!f.options.some((o) => String(o[0]) === s)) throw new HttpError(400, `${f.label}: "${s}" is not one of the choices`);
      changes[f.name] = s;
    } else {
      let s = String(v ?? '').replace(/\r\n?/g, '\n');
      if (f.type !== 'textarea') s = s.replace(/\n/g, ' ').trim();
      else s = s.trim();
      if (f.maxLength && s.length > f.maxLength) throw new HttpError(400, `${f.label}: at most ${f.maxLength} characters`);
      if (s && f.pattern && !f.pattern.test(s)) throw new HttpError(400, `${f.label}: "${s.slice(0, 60)}" is not valid${f.patternHint ? ` (${f.patternHint})` : ''}`);
      if (!s && f.required) throw new HttpError(400, `${f.label} can't be empty`);
      changes[f.name] = s;
    }
  }
  return changes;
}

function defaults(fields, input = {}) {
  const out = {};
  for (const f of fields) {
    const v = input[f.name];
    out[f.name] = v === undefined || v === null || v === '' ? (f.def ?? (f.type === 'bool' ? false : f.type === 'number' ? null : '')) : f.type === 'number' ? Number(v) : f.type === 'bool' ? !!v : String(v);
  }
  return out;
}

module.exports = { schema, read, parse, defaults };
