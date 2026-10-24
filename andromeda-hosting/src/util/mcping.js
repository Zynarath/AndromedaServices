'use strict';
// Minecraft Server List Ping (1.7+): returns player counts, version and MOTD.
const net = require('net');

function varint(n) {
  const out = [];
  n >>>= 0;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

function readVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (true) {
    if (pos >= buf.length) return null;
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: result, size: pos - offset };
    shift += 7;
    if (shift > 35) throw new Error('VarInt too big');
  }
}

function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

function motdText(desc) {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  let s = desc.text || '';
  if (Array.isArray(desc.extra)) s += desc.extra.map(motdText).join('');
  return s;
}

function mcPing(host, port, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('timeout'));
    }, timeout);
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.on('connect', () => {
      const hostBuf = Buffer.from(host, 'utf8');
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      const handshake = Buffer.concat([varint(-1), varint(hostBuf.length), hostBuf, portBuf, varint(1)]);
      sock.write(packet(0, handshake));
      sock.write(packet(0, Buffer.alloc(0)));
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        let off = len.size;
        const pid = readVarint(buf, off);
        off += pid.size;
        const strLen = readVarint(buf, off);
        off += strLen.size;
        const json = JSON.parse(buf.toString('utf8', off, off + strLen.value));
        clearTimeout(timer);
        sock.destroy();
        resolve({
          online: json.players?.online ?? 0,
          max: json.players?.max ?? 0,
          sample: (json.players?.sample || []).map((p) => p.name),
          version: json.version?.name || '',
          motd: motdText(json.description),
          latency: Date.now() - start,
        });
      } catch (err) {
        clearTimeout(timer);
        sock.destroy();
        reject(err);
      }
    });
  });
}

module.exports = { mcPing };
