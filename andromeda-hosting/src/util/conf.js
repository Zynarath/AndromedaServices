'use strict';
// MaNGOS-style .conf files ("Key = value", # comments): a reader/writer that keeps layout and
// comments, and describeConf() which reads each option's documentation from the file itself.

class Conf {
  constructor(text = '') {
    this.lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    this.eol = /\r\n/.test(text) ? '\r\n' : '\n';
  }

  find(key) {
    const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`, 'i');
    return this.lines.findIndex((l) => re.test(l));
  }

  get(key) {
    const i = this.find(key);
    if (i === -1) return undefined;
    let v = this.lines[i].slice(this.lines[i].indexOf('=') + 1).trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v;
  }

  set(key, value) {
    const str = String(value).replace(/[\r\n"]/g, '');
    const i = this.find(key);
    if (i === -1) {
      this.lines.push(`${key} = ${/^-?[\d.]+$/.test(str) ? str : `"${str}"`}`);
      return;
    }
    const line = this.lines[i];
    const old = line.slice(line.indexOf('=') + 1).trim();
    const quoted = old.startsWith('"') || (!/^-?[\d.]+$/.test(str) && old === '');
    this.lines[i] = `${line.slice(0, line.indexOf('=')).trimEnd()} = ${quoted ? `"${str}"` : str}`;
  }

  toString() {
    return this.lines.join(this.eol);
  }
}

// "host;port;user;password;database" -> object
function parseDbInfo(str) {
  const [host, port, user, password, database] = String(str || '').split(';');
  if (!host || !database) return null;
  return { host: host === '.' ? '127.0.0.1' : host, port: Number(port) || 3306, user, password, database };
}

// ---- Documentation ----
// Lists every option in a MaNGOS-style .conf file together with the file's own documentation, so the
// panel can offer a form for all of them. Two layouts are understood:
//  - mangosd.conf / realmd.conf: a banner per section ("# SERVER RATES"), then a comment block that
//    names keys ("#    Rate.Health") followed by their description ("#        Default: 1"), then the values
//  - aiplayerbot.conf: a short comment right above each key; optional keys are commented out
//    ("# AiPlayerbot.RandomBotTimedLogout = 1") and count as not set.

const KEY = '[A-Za-z][A-Za-z0-9_.]*';

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bPvp\b/g, 'PvP').replace(/\bGm\b/g, 'GM');
}

// [{ key, value (undefined when commented out), def (value of a commented-out line), section, doc }]
function describeConf(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const docs = new Map(); // key -> description, from the mangosd-style blocks
  const entries = [];
  const seen = new Map();
  let section = '';
  let blockKeys = [];
  let inDescription = false;
  let comment = []; // comment lines directly above the current line
  let afterKey = false; // keys right below one comment share it (MinRandomBots / MaxRandomBots)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const banner = /^#\s*([A-Z][A-Z0-9 /&()-]{3,})\s*$/.exec(line);
    if (banner && /^#{10,}/.test(lines[i - 1] || '')) {
      section = titleCase(banner[1].trim());
      blockKeys = [];
      comment = [];
      continue;
    }
    const docKey = new RegExp(`^#    (${KEY})(\\s.*)?$`).exec(line);
    if (docKey && !line.includes('=')) {
      if (inDescription) blockKeys = [];
      inDescription = false;
      blockKeys.push(docKey[1]);
      comment.push(line.replace(/^#\s?/, ''));
      continue;
    }
    const descr = /^#\s{5,}(.*)$/.exec(line);
    if (descr && blockKeys.length) {
      inDescription = true;
      for (const k of blockKeys) docs.set(k, [docs.get(k), descr[1].trim()].filter(Boolean).join('\n'));
      continue;
    }
    const set = new RegExp(`^\\s*(${KEY})\\s*=\\s*(.*)$`).exec(line);
    const unset = new RegExp(`^#\\s*(${KEY}\\.${KEY})\\s*=\\s*(.*)$`).exec(line);
    if (set || unset) {
      const m = set || unset;
      const key = m[1];
      let value = m[2].replace(/\s+#.*$/, '').trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      const known = seen.get(key.toLowerCase());
      if (!known) {
        const above = comment.filter((c) => !new RegExp(`^${KEY}\\s*=`).test(c.trim())).join('\n').trim();
        const entry = { key, value: set ? value : undefined, def: set ? undefined : value, section, doc: docs.get(key) || above };
        seen.set(key.toLowerCase(), entry);
        entries.push(entry);
      } else if (set && known.value === undefined) {
        // A commented-out default with the real line further down (e.g. added by the panel): the real one counts.
        known.value = value;
      }
      afterKey = true;
      continue;
    }
    if (/^#/.test(line)) {
      if (afterKey) comment = [];
      afterKey = false;
      if (!/^#+\s*$/.test(line)) comment.push(line.replace(/^#\s?/, ''));
      continue;
    }
    if (!line.trim()) {
      comment = [];
      afterKey = false;
      blockKeys = [];
      inDescription = false;
    }
  }
  return entries;
}

// On/off options: a 0/1 value documented as "(true)/(false)", or a one-line "Enable …" comment.
// Anything less certain stays a plain number field (e.g. InstantLogout is 0/1 but means a GM level).
function looksBoolean(entry) {
  const v = entry.value ?? entry.def;
  if (v !== '0' && v !== '1') return false;
  const doc = entry.doc || '';
  if (/\((true|false)\)/i.test(doc)) return true;
  // One-line comments (aiplayerbot.conf) like "Enable BG/Arena for random bots".
  return !doc.includes('\n') && (/^(enable|disable)\b/i.test(doc) || /\.Enabled?$/.test(entry.key));
}

module.exports = { Conf, parseDbInfo, describeConf, looksBoolean };
