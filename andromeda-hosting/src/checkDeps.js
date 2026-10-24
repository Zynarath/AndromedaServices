'use strict';
// Runs before anything else: if an update added a package that isn't installed yet
// (e.g. after pulling new code without re-running install.bat), install it automatically.
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

function missing() {
  return Object.keys(pkg.dependencies || {}).filter((name) => {
    try {
      require.resolve(path.join(name, 'package.json'), { paths: [root] });
      return false;
    } catch {
      return true;
    }
  });
}

const absent = missing();
if (absent.length) {
  console.log(`[setup] Installing missing packages: ${absent.join(', ')} (one time, needs internet)...`);
  try {
    execSync('npm install --omit=dev --no-audit --no-fund', { cwd: root, stdio: 'inherit' });
  } catch {
    console.error('[setup] "npm install" failed. Open a terminal in the andromeda-hosting folder and run: npm install');
    process.exit(1);
  }
  const still = missing();
  if (still.length) {
    console.error(`[setup] Still missing after install: ${still.join(', ')}. Run "npm install" in the andromeda-hosting folder.`);
    process.exit(1);
  }
  console.log('[setup] Packages installed.');
}
