'use strict';
// Finding the realm in an SPP Classics (or plain cMaNGOS WotLK) folder, and the account name and
// password rules. The same as Andromeda Hosting's WoW server (src/games/wow.js), which the website
// used to share before it became its own folder.
const fs = require('fs');
const path = require('path');
const { Conf } = require('./util/conf');
const { findFiles } = require('./util/paths');

const EXE = process.platform === 'win32' ? '.exe' : '';
const NAME_RE = /^[A-Za-z0-9]{3,16}$/;
// cMaNGOS stores passwords for the WoW client's SRP6 login: max 16 chars; no spaces/quotes so the
// console command can't be split or injected.
const PASS_RE = /^[\x21\x23-\x26\x28-\x7e]{4,16}$/;

function readConf(dir, file) {
  const p = path.join(dir, file);
  return new Conf(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
}

function detect(input) {
  let root = path.resolve(String(input || '').trim());
  const out = { root, layout: null, problems: [], found: {} };
  if (!input || !fs.existsSync(root)) {
    out.problems.push('Folder not found');
    return out;
  }
  if (fs.existsSync(path.join(root, 'SPP_Server', 'Server'))) root = path.join(root, 'SPP_Server');
  out.root = root;
  const sppBin = path.join(root, 'Server', 'Binaries', 'wotlk', 'Bin64');
  if (fs.existsSync(path.join(sppBin, 'mangosd' + EXE))) {
    Object.assign(out, { layout: 'spp', bin: sppBin, confDir: path.join(root, 'Settings', 'wotlk') });
    const dbDir = path.join(root, 'Server', 'Database');
    if (fs.existsSync(path.join(dbDir, 'bin', 'mysqld' + EXE))) out.dbDir = dbDir;
  } else {
    const mangosd = findFiles(root, (_r, n) => n === 'mangosd' + EXE, 4)[0];
    const conf = findFiles(root, (_r, n) => n === 'mangosd.conf', 4)[0];
    if (mangosd) Object.assign(out, { layout: 'custom', bin: path.dirname(mangosd), confDir: conf ? path.dirname(conf) : path.dirname(mangosd) });
  }
  if (!out.layout) {
    out.problems.push(
      fs.existsSync(path.join(root, 'Server', 'Binaries'))
        ? 'This SPP install has no WotLK server yet. Run Server_Update.bat in the SPP folder and choose WotLK first.'
        : "Couldn't find mangosd here. Point to your SPP_Classics_V2 folder (or a cMaNGOS folder)."
    );
    return out;
  }
  const has = (p) => fs.existsSync(p);
  out.found = {
    mangosd: has(path.join(out.bin, 'mangosd' + EXE)),
    realmd: has(path.join(out.bin, 'realmd' + EXE)),
    mangosdConf: has(path.join(out.confDir, 'mangosd.conf')),
    realmdConf: has(path.join(out.confDir, 'realmd.conf')),
    botsConf: has(path.join(out.confDir, 'aiplayerbot.conf')),
    database: !!out.dbDir,
  };
  if (!out.found.realmd) out.problems.push(`realmd${EXE} is missing next to mangosd${EXE}`);
  if (!out.found.mangosdConf) out.problems.push('mangosd.conf is missing');
  if (!out.found.realmdConf) out.problems.push('realmd.conf is missing');
  if (out.found.mangosdConf) {
    const conf = readConf(out.confDir, 'mangosd.conf');
    out.dataDir = path.resolve(out.confDir, conf.get('DataDir') || '.');
    out.found.mapData = has(path.join(out.dataDir, 'dbc')) && has(path.join(out.dataDir, 'maps'));
  }
  return out;
}

module.exports = { detect, NAME_RE, PASS_RE };
