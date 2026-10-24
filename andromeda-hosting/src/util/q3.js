'use strict';
// Quake 3-style UDP protocol used by CoD4x, IW4x and Plutonium (T5/T6/IW5):
// out-of-band packets prefixed with four 0xFF bytes for "rcon" and "getstatus".
const dgram = require('dgram');

const OOB = Buffer.from([0xff, 0xff, 0xff, 0xff]);

function request(host, port, payload, { timeout = 3000, quietMs = 250 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const chunks = [];
    let quiet = null;
    const done = (err) => {
      clearTimeout(timer);
      clearTimeout(quiet);
      try {
        sock.close();
      } catch {}
      if (err && !chunks.length) reject(err);
      else resolve(chunks);
    };
    const timer = setTimeout(() => done(new Error('No response (is the server running and the port right?)')), timeout);
    sock.on('error', done);
    sock.on('message', (msg) => {
      chunks.push(msg);
      clearTimeout(quiet);
      quiet = setTimeout(() => done(), quietMs); // multi-packet replies arrive back to back
    });
    sock.send(Buffer.concat([OOB, Buffer.from(payload, 'latin1')]), port, host, (err) => err && done(err));
  });
}

function stripHeader(buf) {
  let s = buf.subarray(4).toString('latin1');
  const nl = s.indexOf('\n');
  // "print\n...", "statusResponse\n..."
  if (nl !== -1 && nl < 32) s = s.slice(nl + 1);
  return s;
}

// Colour codes like ^1 ^7 used in names and hostnames.
const stripColors = (s) => String(s).replace(/\^[0-9:;]/g, '');

async function rcon(host, port, password, command, opts) {
  if (!password) throw new Error('No RCON password set');
  const chunks = await request(host, port, `rcon ${password} ${command}`, { timeout: 4000, ...opts });
  const text = chunks.map(stripHeader).join('');
  if (/Invalid password|Bad rcon/i.test(text)) throw new Error('RCON password rejected');
  return text.replace(/\r/g, '');
}

async function getStatus(host, port) {
  const [first] = await request(host, port, 'getstatus', { timeout: 2500, quietMs: 50 });
  const body = stripHeader(first).split('\n');
  const info = {};
  const parts = (body[0] || '').split('\\').slice(1);
  for (let i = 0; i + 1 < parts.length; i += 2) info[parts[i]] = parts[i + 1];
  const players = [];
  for (const line of body.slice(1)) {
    const m = /^(-?\d+)\s+(-?\d+)\s+"(.*)"/.exec(line.trim());
    if (m) players.push({ score: Number(m[1]), ping: Number(m[2]), name: stripColors(m[3]) });
  }
  return { info, players, hostname: stripColors(info.sv_hostname || info.hostname || ''), map: info.mapname, gametype: info.g_gametype, maxClients: Number(info.sv_maxclients) || null };
}

module.exports = { rcon, getStatus, stripColors };
