'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

const FILE = path.join(config.dataDir, 'panel.json');

const empty = () => ({
  version: 1,
  users: [],
  sessions: [],
  servers: [],
  settings: {
    panelName: 'Andromeda Hosting',
    curseforgeApiKey: '',
    publicAddress: '',
  },
});

let data = empty();
if (fs.existsSync(FILE)) {
  try {
    data = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    data.settings = { ...empty().settings, ...data.settings };
  } catch (err) {
    const broken = FILE + '.corrupt-' + Date.now();
    fs.copyFileSync(FILE, broken);
    console.error(`[db] panel.json is corrupt (${err.message}); copied to ${broken} and starting from the last backup if present.`);
    if (fs.existsSync(FILE + '.bak')) data = { ...empty(), ...JSON.parse(fs.readFileSync(FILE + '.bak', 'utf8')) };
  }
}

// One-time rebrand: carry an older install's default name over to the new one.
if (data.settings.panelName === 'HomePortal') data.settings.panelName = 'Andromeda Hosting';

let timer = null;
function saveNow() {
  clearTimeout(timer);
  timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak');
  fs.renameSync(tmp, FILE);
}

function save() {
  if (!timer) timer = setTimeout(saveNow, 250);
}

module.exports = {
  get data() {
    return data;
  },
  save,
  saveNow,
};
