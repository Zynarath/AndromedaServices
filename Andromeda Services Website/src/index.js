'use strict';
// Starts the Andromeda Services website.
//   npm start                      http://localhost:8092, this PC only
//   set PORT=9000 && npm start     another port
//   set HOST=0.0.0.0 && npm start  also reachable from other PCs on your network
// Andromeda Services starts and stops it too (it uses port 8092).
const path = require('path');
const readline = require('readline');
const { createSite } = require('./server');

// Started by Andromeda Services: always 8092 on this PC, where the app looks for it.
const fromApp = process.env.ANDROMEDA_SERVICES === '1';
const port = (!fromApp && Number(process.env.PORT)) || 8092;
const host = (!fromApp && process.env.HOST) || '127.0.0.1';
const dataDir = process.env.ANDROMEDA_SITE_DATA || path.join(__dirname, '..', 'data');

const server = createSite({ dataDir });
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Start with another port, e.g. PORT=8093.` : err.message);
  process.exit(1);
});
server.listen(port, host, () => {
  // Andromeda Services looks for "is running at" to show the site as running.
  console.log(`Andromeda Services website is running at http://localhost:${port}`);
  console.log(`Waitlist (this PC only): http://localhost:${port}/admin`);
  if (host === '127.0.0.1') console.log('Only this PC can open it. Set HOST=0.0.0.0 to open it to your network.');
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  console.log('Stopping the website...');
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// Andromeda Services stops it by typing "stop" (works in a console window too).
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim().toLowerCase() === 'stop') stop();
});
