'use strict';
// 7 Days to Die's telnet console: log in with the password, send one command, collect what the
// server prints back until it goes quiet. One short-lived connection per command keeps it simple
// and survives server restarts.
const net = require('net');

const IAC = 255;

// Drop telnet negotiation bytes (IAC sequences); 7DTD sends a few right after connecting.
function stripTelnet(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== IAC) {
      out.push(buf[i]);
      continue;
    }
    const cmd = buf[i + 1];
    if (cmd === IAC) {
      out.push(IAC);
      i++;
    } else if (cmd >= 251 && cmd <= 254) i += 2; // WILL/WONT/DO/DONT <option>
    else if (cmd === 250) {
      const end = buf.indexOf(240, i); // SB ... SE
      i = end < 0 ? buf.length : end;
    } else i++;
  }
  return Buffer.from(out).toString('utf8');
}

function command(host, port, password, cmd, { timeout = 8000, quietMs = 700 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let text = '';
    let stage = 'login';
    let quiet = null;
    let sentAt = 0;
    const finish = (err) => {
      clearTimeout(timer);
      clearTimeout(quiet);
      sock.destroy();
      if (err) return reject(err);
      resolve(text.slice(sentAt).replace(/\r/g, ''));
    };
    const timer = setTimeout(() => (stage === 'sent' ? finish() : finish(new Error('7 Days to Die telnet did not answer'))), timeout);
    const send = () => {
      stage = 'sent';
      sentAt = text.length;
      sock.write(cmd + '\r\n');
      quiet = setTimeout(() => finish(), quietMs * 3);
    };
    sock.on('error', (err) => finish(err));
    sock.on('close', () => (stage === 'sent' ? finish() : finish(new Error('7 Days to Die telnet closed the connection'))));
    sock.on('data', (chunk) => {
      text += stripTelnet(chunk);
      if (stage === 'login') {
        if (/password incorrect|wrong password/i.test(text)) return finish(new Error('7 Days to Die rejected the telnet password'));
        if (/enter password/i.test(text)) {
          stage = 'auth';
          sock.write(password + '\r\n');
        } else if (/Press 'help'|Logon successful|\*\*\* Connected/i.test(text)) send(); // no password needed
      } else if (stage === 'auth') {
        if (/password incorrect|wrong password/i.test(text)) return finish(new Error('7 Days to Die rejected the telnet password'));
        if (/Logon successful/i.test(text)) send();
      } else {
        clearTimeout(quiet);
        quiet = setTimeout(() => finish(), quietMs);
      }
    });
  });
}

// "lp" (listplayers) output: "0. id=171, Name, pos=(...), ..." lines, then "Total of N in the game".
function parsePlayers(out) {
  const players = [];
  for (const line of String(out).split('\n')) {
    const m = /^\s*\d+\.\s*id=\d+,\s*([^,]+),/.exec(line);
    if (m) players.push(m[1].trim());
  }
  const total = /Total of (\d+) in the game/.exec(out);
  return { online: total ? Number(total[1]) : players.length, players };
}

module.exports = { command, parsePlayers, stripTelnet };
