'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');

const file = path.join(config.logsDir, 'panel.log');
let stream = null;
try {
  // Keep the panel log from growing forever: start fresh when it passes 10 MB.
  if (fs.existsSync(file) && fs.statSync(file).size > 10 * 1024 * 1024) fs.renameSync(file, file + '.old');
  stream = fs.createWriteStream(file, { flags: 'a' });
} catch {
  stream = null;
}

function write(level, scope, msg) {
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${msg}`;
  (level === 'ERROR' ? console.error : console.log)(line);
  if (stream) stream.write(line + '\n');
}

function logger(scope) {
  return {
    info: (m) => write('INFO', scope, m),
    warn: (m) => write('WARN', scope, m),
    error: (m) => write('ERROR', scope, m instanceof Error ? m.stack || m.message : m),
  };
}

module.exports = logger;
