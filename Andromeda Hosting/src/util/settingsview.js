'use strict';
// How every game's Settings form is laid out: one section at a time, the settings people change
// most first, sliders for amounts. Games describe their settings as sections of fields; this adds
// what the page needs to draw them well, for the games that didn't spell it out themselves
// (World of Warcraft does: see games/wow.js).
const { sliderFor, unitOf, likelihood } = require('./modconfig');

const SHOW_FIRST = 8; // sections longer than this keep the rest behind "Show more"
const DRAWN_AS_IS = new Set(['maps', 'checklist', 'textarea']);

function presentField(f, value) {
  if (f.type !== 'number') return { ...f };
  const probe = { type: 'number', key: f.label, label: f.label, hint: f.hint, value: value === '' || value === undefined || value === null ? f.def : value, def: f.def, min: f.min, max: f.max };
  const unit = f.unit || unitOf(probe);
  const slider = f.slider || sliderFor(probe, unit);
  return { ...f, ...(unit ? { unit } : {}), ...(slider ? { slider } : {}) };
}

function presentSchema(schema, values = {}) {
  if (schema.layout) return schema;
  const sections = schema.sections.map((sec) => {
    const fields = sec.fields.map((f) => presentField(f, values[f.key]));
    if (fields.some((f) => f.common !== undefined)) return { ...sec, fields };
    // Pictures and long lists always show; of the rest, the likeliest to be changed.
    const ranked = fields.map((f, i) => [DRAWN_AS_IS.has(f.type) ? 99 : likelihood({ ...f, key: f.label, section: '' }) + (f.required ? 2 : 0) - (f.admin ? 3 : 0), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const keep = new Set(fields.length <= SHOW_FIRST + 2 ? fields.map((_f, i) => i) : ranked.slice(0, SHOW_FIRST).map(([, i]) => i));
    return { ...sec, fields: fields.map((f, i) => ({ ...f, common: keep.has(i) })) };
  });
  return { ...schema, layout: 'categories', sections };
}

module.exports = { presentSchema };
