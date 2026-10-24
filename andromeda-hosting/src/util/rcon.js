'use strict';
// Source RCON protocol client (used by ARK and optionally Minecraft).
const net = require('net');

const TYPE_AUTH = 3;
const TYPE_EXEC = 2;
const TYPE_AUTH_RESPONSE = 2;

function encode(id, type, body) {
  const b = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  return buf;
}

class Rcon {
  constructor(host, port, password, { timeout = 5000 } = {}) {
    Object.assign(this, { host, port, password, timeout });
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.authed = false;
  }

  connect() {
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const sock = net.connect({ host: this.host, port: this.port });
      let timer = null;
      const fail = (err) => {
        clearTimeout(timer);
        reject(err); // reject first so close() can't replace the real reason
        this.close();
      };
      timer = setTimeout(() => fail(new Error('RCON connection timed out')), this.timeout);
      sock.on('error', fail);
      sock.on('close', () => this.close());
      sock.on('data', (d) => this.onData(d));
      sock.on('connect', () => {
        this.socket = sock;
        const id = this.nextId++;
        this.pending.set(id, {
          auth: true,
          resolve: () => {
            clearTimeout(timer);
            this.authed = true;
            resolve();
          },
          reject: fail,
        });
        // A response to id -1 means the password was wrong.
        this.authId = id;
        sock.write(encode(id, TYPE_AUTH, this.password));
      });
    });
    return this.connecting;
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readInt32LE(0);
      if (this.buffer.length < size + 4) break;
      const id = this.buffer.readInt32LE(4);
      const type = this.buffer.readInt32LE(8);
      const body = this.buffer.toString('utf8', 12, 4 + size - 2);
      this.buffer = this.buffer.subarray(4 + size);
      this.onPacket(id, type, body);
    }
  }

  onPacket(id, type, body) {
    if (type === TYPE_AUTH_RESPONSE && (id === -1 || this.pending.get(id)?.auth)) {
      if (id === -1) {
        const p = this.pending.get(this.authId);
        if (p) p.reject(new Error('RCON authentication failed (wrong admin password?)'));
        return;
      }
      const p = this.pending.get(id);
      this.pending.delete(id);
      p.resolve();
      return;
    }
    const p = this.pending.get(id);
    if (!p || p.auth) return;
    // Responses can be split across packets; collect until the line goes quiet.
    p.body += body;
    clearTimeout(p.quiet);
    p.quiet = setTimeout(() => {
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.resolve(p.body);
    }, 120);
  }

  async send(command) {
    if (!this.authed) await this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('RCON command timed out'));
      }, this.timeout);
      this.pending.set(id, { body: '', resolve, reject, timer });
      this.socket.write(encode(id, TYPE_EXEC, command));
    });
  }

  close() {
    if (this.socket) this.socket.destroy();
    this.socket = null;
    this.authed = false;
    this.connecting = null;
    this.buffer = Buffer.alloc(0);
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) {
      clearTimeout(p.timer);
      clearTimeout(p.quiet);
      if (p.body !== undefined && p.body !== '') p.resolve(p.body);
      else p.reject(new Error('RCON connection closed'));
    }
  }
}

module.exports = Rcon;
