'use strict';
// Order-preserving INI parser for ARK's GameUserSettings.ini / Game.ini.
// ARK allows repeated keys (e.g. OverrideNamedEngramEntries) so lines are kept as a list.

class Ini {
  constructor(text = '') {
    this.sections = []; // { name, lines: [{ key, value } | { raw }] }
    this.preamble = [];
    this.parse(text);
  }

  parse(text) {
    let current = null;
    for (const rawLine of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
      const line = rawLine.trim();
      const sec = /^\[(.+)\]$/.exec(line);
      if (sec) {
        current = { name: sec[1], lines: [] };
        this.sections.push(current);
        continue;
      }
      const target = current ? current.lines : this.preamble;
      const eq = rawLine.indexOf('=');
      if (line && !line.startsWith(';') && !line.startsWith('#') && eq > 0) {
        target.push({ key: rawLine.slice(0, eq).trim(), value: rawLine.slice(eq + 1) });
      } else {
        target.push({ raw: rawLine });
      }
    }
    // Drop trailing blank lines so repeated save cycles don't grow the file.
    for (const s of this.sections) while (s.lines.length && s.lines[s.lines.length - 1].raw === '') s.lines.pop();
  }

  section(name, create = false) {
    const lower = name.toLowerCase();
    let s = this.sections.find((x) => x.name.toLowerCase() === lower);
    if (!s && create) {
      s = { name, lines: [] };
      this.sections.push(s);
    }
    return s;
  }

  get(section, key) {
    const s = this.section(section);
    if (!s) return undefined;
    const lower = key.toLowerCase();
    const line = s.lines.find((l) => l.key && l.key.toLowerCase() === lower);
    return line ? line.value : undefined;
  }

  set(section, key, value) {
    const s = this.section(section, true);
    const lower = key.toLowerCase();
    const line = s.lines.find((l) => l.key && l.key.toLowerCase() === lower);
    if (value === undefined || value === null || value === '') {
      if (line) s.lines = s.lines.filter((l) => l !== line);
      return;
    }
    // Strip newlines so a value can't inject extra INI lines/sections.
    const clean = String(value).replace(/[\r\n]+/g, ' ');
    if (line) line.value = clean;
    else s.lines.push({ key, value: clean });
  }

  toString() {
    const out = this.preamble.map((l) => (l.key ? `${l.key}=${l.value}` : l.raw));
    for (const s of this.sections) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(`[${s.name}]`);
      for (const l of s.lines) out.push(l.key ? `${l.key}=${l.value}` : l.raw);
    }
    return out.join('\r\n') + '\r\n';
  }
}

module.exports = Ini;
