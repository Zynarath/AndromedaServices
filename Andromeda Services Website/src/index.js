'use strict';
// Starts the Andromeda Services website.
//   npm start                      http://localhost:8092, this PC only
//   set PORT=9000 && npm start     another port
//   set HOST=0.0.0.0 && npm start  also reachable from other PCs on your network
const path = require('path');
const { createSite } = require('./server');

const port = Number(process.env.PORT) || 8092;
const host = process.env.HOST || '127.0.0.1';
const dataDir = process.env.ANDROMEDA_SITE_DATA || path.join(__dirname, '..', 'data');

const server = createSite({ dataDir });
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Start with another port, e.g. PORT=8093.` : err.message);
  process.exit(1);
});
server.listen(port, host, () => {
  console.log(`Andromeda Services website: http://localhost:${port}`);
  console.log(`Waitlist (this PC only):    http://localhost:${port}/admin`);
  if (host === '127.0.0.1') console.log('Only this PC can open it. Set HOST=0.0.0.0 to open it to your network.');
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
