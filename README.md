# Andromeda Services

Self-hosted game servers and a World of Warcraft website, run from your own PC. The repository has
three programs and the Windows app that runs them:

| Folder | Version | What it is |
|---|---|---|
| [`Andromeda Hosting/`](Andromeda%20Hosting/) | 2.1.0 | The game server control panel: ARK, Minecraft (CurseForge modpacks), Call of Duty (including Black Ops III with bots), Satisfactory, 7 Days to Die, Valheim, Rust with uMod, and World of Warcraft: WotLK with bots. See its [README](Andromeda%20Hosting/README.md). |
| [`Andromeda WotLK Website/`](Andromeda%20WotLK%20Website/) | 1.0.0 | The WotLK website for your realm: news, armory, realm status, who's online, honor, auction house and invite-only sign-up. See its [README](Andromeda%20WotLK%20Website/README.md). |
| [`Andromeda Services Website/`](Andromeda%20Services%20Website/) | 1.0.0 | The public website for Andromeda game server hosting: supported games, the control panel, FAQ and a launch waitlist. Runs on this PC for now (`npm start`, then <http://localhost:8092>). See its [README](Andromeda%20Services%20Website/README.md). |
| [`services/`](services/) | 1.0.1 | **Andromeda Services**, the Windows app that starts, stops and updates both, and `install.exe`'s source. |

## Install (Windows)

1. Install **Node.js LTS** (20 or newer) from <https://nodejs.org>.
2. Download or clone this repository, e.g. to `C:\Andromeda Services`.
3. Double-click **`install.exe`** and press **Install**. It installs the packages of both programs,
   makes the panel's `config.json`, builds **Andromeda Services** and adds it to your desktop and
   Start menu. If you downloaded a ZIP, Windows may say it protected your PC: choose *More info* →
   *Run anyway*.
4. Optional: open `Andromeda Hosting\config.json` and set `serversDir` to a big drive, e.g.
   `"D:/GameServers"`. ARK needs roughly 15–25 GB per server; modpacks need 1–5 GB.
5. Open **Andromeda Services**, then open <http://localhost:8080> **on this PC** and create your
   admin account. For safety, the first account can only be created from the host PC.
6. Continue with *Panel settings* in the [Andromeda Hosting README](Andromeda%20Hosting/README.md),
   and, for the website, its [setup](Andromeda%20WotLK%20Website/README.md#set-it-up).

## Andromeda Services

A Windows app that runs everything without console windows:

- It starts and stops **Andromeda Hosting** and the **Andromeda WotLK Website**, each with its own
  Start / Stop / Restart / Open buttons, version, status and live log. The website's **Settings**
  (SPP folder, name, port, sign-up, Discord link) are set here.
- *Start when Andromeda Services opens* is a setting for each one. *Open Andromeda Services when I
  sign in to Windows* starts it all at login, quietly in the system tray.
- Closing the window keeps everything running in the system tray. **Stop all and exit** (in the
  window or the tray menu) stops cleanly: game servers are saved and stopped first.
- **Check for updates** downloads the latest version from GitHub (see [Updating](#updating)).

`install.exe` builds it as `Andromeda Services.exe` in this folder, using the C# compiler that
comes with Windows, so there is nothing extra to install. To rebuild it yourself, run
`services\build.bat`, or `services\build.bat shortcut` to also recreate the shortcuts.
`services\build.bat installer` rebuilds `install.exe` from `services\Installer.cs`.

## Updating

Updates come from GitHub, so the folder must be a Git copy of this repository:

1. Install [Git for Windows](https://git-scm.com/download/win) (default options are fine).
2. Clone the repository:
   ```powershell
   git clone https://github.com/Zynarath/AndromedaServices.git "C:\Andromeda Services"
   ```
   Sign in to GitHub in the browser window if it asks (the repository may be private).
3. Run `install.exe` in that folder once.

**Check for updates** in Andromeda Services shows what changed (it also checks when it opens).
**Update now** saves and stops the running game servers and the website, downloads the update,
installs any new packages for both programs, rebuilds Andromeda Services if it changed, and starts
everything that was running again. The panel can also update itself: **Panel settings → Updates**.

Your settings and data are never touched by an update: `Andromeda Hosting\config.json`, its
`data` folder (or wherever `dataDir` points), and the website's `Andromeda WotLK Website\data`
folder aren't part of the repository. Don't edit the programs' own files, or Git will refuse to
update over your edits.

### Coming from the old AndromedaHosting repository

The panel used to be in an `andromeda-hosting` folder with the website inside it. To move:

1. In Andromeda Services, **Stop all and exit**.
2. Clone this repository (above), then copy `config.json` and the `data` folder (if your
   `config.json` doesn't point `dataDir` elsewhere) from the old `andromeda-hosting` folder into
   `Andromeda Hosting\`.
3. Run `install.exe` and open the new Andromeda Services. The first time the website starts, it
   copies its settings and graphics from the panel's data folder into its own `data` folder.
4. If you used *Open Andromeda Services when I sign in to Windows*, turn it off and on again in
   the new one so it points at the new folder. `install.exe` already pointed the desktop and Start
   menu shortcuts there. Delete the old folder once everything works.
