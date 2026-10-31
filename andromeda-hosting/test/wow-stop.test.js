'use strict';
// Stopping the WoW world server: mangosd on Windows hangs after "Halting process..." until its
// console thread gets input, which the panel has to provide since mangosd runs on a pipe.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const wow = require('../src/games/wow');

// A stand-in for mangosd: saves on "saveall", prints "Halting process..." on shutdown, and like the
// real one only exits once its console thread reads again (here: until stdin closes).
const FAKE = `
const rl = require('readline').createInterface({ input: process.stdin });
let halted = false;
rl.on('line', (l) => {
  if (l === 'saveall') console.log('mangos>All players saved');
  if (l === 'server shutdown 0') { halted = true; console.log('mangos>Halting process...'); }
});
rl.on('close', () => { if (halted) process.exit(0); });
setInterval(() => {}, 1000);
`;

function fakeInstance() {
  const inst = new EventEmitter();
  inst.child = spawn(process.execPath, ['-e', FAKE], { stdio: ['pipe', 'pipe', 'pipe'] });
  inst.lines = [];
  inst.appendConsole = (line) => {
    inst.lines.push(line);
    inst.emit('console', { t: Date.now(), line });
  };
  inst.writeStdin = (line) => inst.child.stdin.write(line + '\n');
  inst.child.stdout.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((l) => inst.appendConsole(l)));
  return inst;
}

test('mangosd that waits after "Halting process..." exits after a stop', { timeout: 20000 }, async () => {
  const inst = fakeInstance();
  const exited = new Promise((r) => inst.child.once('exit', (code) => r(code)));
  await wow.stop(inst);
  const code = await exited;
  assert.strictEqual(code, 0);
  assert.ok(inst.lines.some((l) => /Halting process/.test(l)));
  assert.ok(!inst.lines.some((l) => /ending it/.test(l)), 'exited by itself, not killed');
  assert.strictEqual(inst.listenerCount('console'), 0);
});
