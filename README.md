# Andromeda Services

Self-hosted game servers, a World of Warcraft website and the website for Andromeda game server
hosting, run from your own PC. The repository has
three programs, the Windows app that runs them and an Android app to use them from your phone:

| Folder | Version | What it is |
|---|---|---|
| [`Andromeda Hosting/`](Andromeda%20Hosting/) | 2.5.3 | The game server control panel: ARK, Minecraft (CurseForge modpacks), Call of Duty (including Black Ops III with bots), Satisfactory, 7 Days to Die, Valheim, Rust with uMod, and World of Warcraft: WotLK with bots. See its [README](Andromeda%20Hosting/README.md). |
| [`Andromeda WotLK Website/`](Andromeda%20WotLK%20Website/) | 1.0.0 | The WotLK website for your realm: news, armory, realm status, who's online, honor, auction house and invite-only sign-up. See its [README](Andromeda%20WotLK%20Website/README.md). |
| [`Andromeda Services Website/`](Andromeda%20Services%20Website/) | 1.0.2 | The public website for Andromeda game server hosting: supported games, the control panel, FAQ and a launch waitlist. Runs on this PC for now, at <http://localhost:8092>. See its [README](Andromeda%20Services%20Website/README.md). |
| [`services/`](services/) | 1.4.0 | **Andromeda Services**, the Windows app that starts, stops and updates all three, and `install.exe`'s source. |
| [`Andromeda App/`](Andromeda%20App/) | 2.1.0 | The Android app: the panel's dashboard and server pages, a Security tab and the Andromeda Services cards, as a native app (no browser). Install [`Andromeda.apk`](Andromeda%20App/Andromeda.apk); see its [README](Andromeda%20App/README.md). |

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

- It starts and stops **Andromeda Hosting**, the **Andromeda WotLK Website** and the **Andromeda
  Services Website**, each with its own Start / Stop / Restart / Open buttons, version, status and
  live log. The WotLK website's **Settings** (SPP folder, name, port, sign-up, Discord link) are
  set here, and the Andromeda Services Website's **Waitlist** button shows who signed up.
- **Open** (and the link on each card, and the tray menu) goes to each one's public address:
  <https://panel.thefinalhour.us/>, <https://wow.thefinalhour.us/> and <https://thefinalhour.us/>.
  *on this PC* next to the link opens the same thing at `localhost`, for when the domain is down
  (and to create the first admin account, which only works from this PC). To use other addresses,
  add lines like `open.panel=https://panel.example.com` to `Andromeda Hosting\data\services.ini`
  (`open.panel`, `open.site`, `open.web`; nothing after the `=` means this PC).
- Each card shows its program's version, read again after every update.
- **Security** (a tab next to the logs) shows who is connecting to Andromeda Hosting and who is
  trying things they shouldn't: how things look right now, the last 24 hours in numbers (addresses,
  failed sign-ins, lock-outs, probes), then every attempt with its address and country, who is
  signed in, and the addresses that connected, the troublesome ones first. The tab shows how many
  attempts there were today, and the tray warns about a new one. The panel keeps the record (see
  *Security record* in its README); the phone app has the same in its **Security** tab.
- The same cards are in the phone app's **Services** tab, with Start / Stop / Restart. The Windows
  app writes how each program is doing to `services-status.json` in Andromeda Hosting's data folder
  and runs the requests the panel leaves in `services-commands\` (admins only, through the panel's
  sign-in); nothing new listens on the network. It has to be open on the PC for this, and Andromeda
  Hosting can be restarted that way but not stopped.
- *Start when Andromeda Services opens* is a setting for each one (off at first for the Andromeda
  Services Website). *Open Andromeda Services when I
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
**Update now** saves and stops the running game servers and the websites, downloads the update,
installs any new packages, rebuilds Andromeda Services if it changed, and starts
everything that was running again. The panel can also update itself: **Panel settings → Updates**.

Your settings and data are never touched by an update: `Andromeda Hosting\config.json`, its
`data` folder (or wherever `dataDir` points), and the websites' `data` folders (WotLK settings,
waitlist sign-ups) aren't part of the repository. Don't edit the programs' own files, or Git will refuse to
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
