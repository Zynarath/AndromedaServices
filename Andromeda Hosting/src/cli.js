'use strict';
// Command-line helpers: create an admin or reset a password without the web UI.
//   npm run create-admin -- <username> <password>
//   npm run reset-password -- <username> <new password>
const db = require('./db');
const auth = require('./auth');

const [cmd, username, password] = process.argv.slice(2);
try {
  if (cmd === 'create-admin') {
    if (!username || !password) throw new Error('Usage: npm run create-admin -- <username> <password>');
    auth.createUser({ username, password, role: 'admin' });
    console.log(`Admin "${username}" created.`);
  } else if (cmd === 'reset-password') {
    if (!username || !password) throw new Error('Usage: npm run reset-password -- <username> <new password>');
    const user = auth.findUserByName(username);
    if (!user) throw new Error(`No user named ${username}`);
    auth.validatePassword(password);
    user.passwordHash = auth.hashPassword(password);
    user.totpEnabled = false;
    delete user.totpSecret;
    user.disabled = false;
    auth.destroySessions(user.id);
    console.log(`Password for "${username}" reset (2FA was turned off too).`);
  } else {
    console.log('Commands: create-admin <user> <pass>, reset-password <user> <pass>');
  }
  db.saveNow();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
