'use strict';
// Ask a console program to shut down the way pressing Ctrl+C in its window would. Some servers
// (Valheim) only save their world on Ctrl+C, and there is no RCON to ask them otherwise.
//  - Linux/macOS: SIGINT.
//  - Windows: there are no signals. Servers are started hidden (windowsHide), which gives each one
//    its own invisible console, so a helper attaches to that console and raises Ctrl+C in it. The
//    helper ignores the event itself, and the panel's own console isn't involved.
const { execFile } = require('child_process');

const PS_SCRIPT = (pid) =>
  "$ErrorActionPreference = 'Stop'; " +
  "Add-Type -Namespace AH -Name Con -MemberDefinition '" +
  '[DllImport("kernel32.dll")] public static extern bool FreeConsole(); ' +
  '[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint id); ' +
  '[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(System.IntPtr h, bool add); ' +
  '[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);' +
  "'; " +
  '[void][AH.Con]::FreeConsole(); ' +
  `if (-not [AH.Con]::AttachConsole(${pid})) { exit 2 }; ` +
  '[void][AH.Con]::SetConsoleCtrlHandler([IntPtr]::Zero, $true); ' +
  'if (-not [AH.Con]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }; ' +
  'Start-Sleep -Milliseconds 300; [void][AH.Con]::FreeConsole(); exit 0';

// Resolves true when the request was delivered (the program still decides how fast it exits).
function sendCtrlC(child) {
  if (!child || !child.pid) return Promise.resolve(false);
  if (process.platform !== 'win32') {
    try {
      return Promise.resolve(child.kill('SIGINT'));
    } catch {
      return Promise.resolve(false);
    }
  }
  const pid = Number(child.pid);
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT(pid)], { windowsHide: true, timeout: 20000 }, (err) => resolve(!err));
  });
}

module.exports = { sendCtrlC, PS_SCRIPT };
