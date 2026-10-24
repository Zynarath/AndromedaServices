'use strict';
// Minimal order-preserving reader/writer for Minecraft's server.properties.

class Properties {
  constructor(text = '') {
    this.lines = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const t = raw.trim();
      const eq = raw.indexOf('=');
      if (!t || t.startsWith('#') || t.startsWith('!') || eq === -1) this.lines.push({ raw });
      else this.lines.push({ key: raw.slice(0, eq).trim(), value: raw.slice(eq + 1).trim() });
    }
    while (this.lines.length && this.lines[this.lines.length - 1].raw === '') this.lines.pop();
  }

  get(key) {
    const l = this.lines.find((x) => x.key === key);
    return l ? l.value : undefined;
  }

  set(key, value) {
    const v = value === undefined || value === null ? '' : String(value).replace(/[\r\n]+/g, ' ');
    const l = this.lines.find((x) => x.key === key);
    if (l) l.value = v;
    else this.lines.push({ key, value: v });
  }

  toObject() {
    const o = {};
    for (const l of this.lines) if (l.key) o[l.key] = l.value;
    return o;
  }

  toString() {
    return this.lines.map((l) => (l.key ? `${l.key}=${l.value}` : l.raw)).join('\n') + '\n';
  }
}

module.exports = Properties;
