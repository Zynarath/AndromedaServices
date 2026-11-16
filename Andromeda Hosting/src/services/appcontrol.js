'use strict';
// What Andromeda Services (the Windows app) runs, and asking it to start, stop or restart one of
// them. The panel can't see or control that app directly, so the two share two things in the
// panel's data folder (the app's side is RemoteTick in services/AndromedaServices.cs):
//   services-status.json   written by the app whenever something changes, and every few seconds
//   services-commands/     the panel drops one small file per request; the app runs it within a second
// Nothing listens on the network for this.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { HttpError, randomId } = require('../util/misc');

const STATUS_FILE = path.join(config.dataDir, 'services-status.json');
const COMMANDS_DIR = path.join(config.dataDir, 'services-commands');
const FRESH_MS = 15000; // older than this: the app isn't open (or is too old to write it)
const ACTIONS = ['start', 'stop', 'restart'];
const STATES = ['stopped', 'starting', 'running', 'stopping', 'external', 'crashed', 'waiting'];

// { available, version, about, updating, services: [{ key, name, description, state, version, address, canStop }] }
function status(now = Date.now()) {
  let stat;
  let data;
  try {
    stat = fs.statSync(STATUS_FILE);
    data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8').replace(/^﻿/, ''));
  } catch {
    return { available: false, reason: 'Andromeda Services 1.3.0 or newer has to be open on the PC to show and control these.', services: [] };
  }
  if (now - stat.mtimeMs > FRESH_MS) return { available: false, reason: "Andromeda Services isn't open on the PC, so these can't be shown or controlled from here.", services: [] };
  const services = (Array.isArray(data.services) ? data.services : [])
    .filter((s) => s && typeof s.key === 'string')
    .map((s) => ({
      key: s.key,
      name: String(s.name || s.key),
      description: String(s.description || ''),
      state: STATES.includes(s.state) ? s.state : 'stopped',
      version: String(s.version || ''),
      address: /^https?:\/\//i.test(String(s.address || '')) ? String(s.address) : '',
      canStop: s.canStop !== false,
    }));
  return { available: true, version: String(data.version || ''), about: String(data.about || ''), updating: !!data.updating, services };
}

// Ask the app to start / stop / restart one of its programs.
function send(key, action) {
  if (!ACTIONS.includes(action)) throw new HttpError(400, 'Unknown action');
  const now = status();
  if (!now.available) throw new HttpError(409, now.reason);
  if (now.updating) throw new HttpError(409, 'Andromeda Services is installing an update. Try again in a minute.');
  const service = now.services.find((s) => s.key === key);
  if (!service) throw new HttpError(404, 'Unknown service');
  // The panel is what carries these requests: once stopped, nothing could start it again from here.
  if (action === 'stop' && !service.canStop) throw new HttpError(400, `${service.name} can only be stopped on the PC: it is what the app talks to, so it couldn't be started again from here. Restart works.`);
  fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  const file = path.join(COMMANDS_DIR, `${Date.now()}-${randomId(4)}.json`);
  fs.writeFileSync(file + '.tmp', JSON.stringify({ service: key, action }));
  fs.renameSync(file + '.tmp', file); // the app only reads *.json, so never a half-written one
  return { ok: true, service: service.name, action };
}

module.exports = { status, send, STATUS_FILE, COMMANDS_DIR };
