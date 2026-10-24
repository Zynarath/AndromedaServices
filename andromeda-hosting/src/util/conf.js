'use strict';
// Reader/writer for MaNGOS-style .conf files ("Key = value", # comments), keeping layout and comments.

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

module.exports = { Conf, parseDbInfo };
