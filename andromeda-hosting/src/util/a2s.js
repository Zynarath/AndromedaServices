'use strict';
// Steam server query (A2S_INFO): name, map and player count from games that answer Steam's
// server browser protocol (Valheim on its query port). https://developer.valvesoftware.com/wiki/Server_queries
const dgram = require('dgram');

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const INFO_REQUEST = Buffer.concat([HEADER, Buffer.from('TSource Engine Query\0', 'latin1')]);

function parseInfo(buf) {
  let o = 4;
  if (buf.readInt32LE(0) !== -1 || buf[o++] !== 0x49) throw new Error('not an A2S_INFO reply');
  o++; // protocol
  const str = () => {
    const end = buf.indexOf(0, o);
    if (end < 0) throw new Error('truncated A2S_INFO reply');
    const s = buf.toString('utf8', o, end);
    o = end + 1;
    return s;
  };
  const name = str();
  const map = str();
  const folder = str();
  const game = str();
  o += 2; // app id
  if (o + 3 > buf.length) throw new Error('truncated A2S_INFO reply');
  return { name, map, folder, game, players: buf[o], maxPlayers: buf[o + 1], bots: buf[o + 2] };
}

function queryInfo(host, port, { timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const done = (err, val) => {
      clearTimeout(timer);
      sock.close();
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => done(new Error('no answer to the Steam query')), timeout);
    sock.on('error', (err) => done(err));
    sock.on('message', (msg) => {
      try {
        // Newer servers first answer with a challenge (0x41) that has to be sent back.
        if (msg.length >= 9 && msg.readInt32LE(0) === -1 && msg[4] === 0x41) {
          sock.send(Buffer.concat([INFO_REQUEST, msg.subarray(5, 9)]), port, host);
          return;
        }
        done(null, parseInfo(msg));
      } catch (err) {
        done(err);
      }
    });
    sock.send(INFO_REQUEST, port, host);
  });
}

module.exports = { queryInfo, parseInfo };
