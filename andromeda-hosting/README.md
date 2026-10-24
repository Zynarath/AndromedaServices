# Andromeda Hosting

A self-hosted game server control panel, like G-Portal or Nitrado, that runs on **your own PC**.
You and your friends sign in from a browser, start and stop servers, change settings, install and
update CurseForge modpacks, manage files, schedule restarts and backups, and watch the live console.
There are no monthly hosting fees; your only cost is electricity.

**Supported games**

| Game | What the panel does |
|---|---|
| **ARK: Survival Ascended** (Windows) | Installs/updates via SteamCMD, CurseForge mod list (search + IDs; the server auto-downloads mods on start), map/cluster/crossplay options, INI settings form, RCON console, player list |
| **Minecraft — CurseForge modpack** | Search CurseForge, pick a version, one-click install. Uses the pack's official server files when available, otherwise builds the server from the manifest. One-click **update / downgrade** with automatic backup that keeps worlds, `server.properties`, ops and whitelist |
| **Minecraft — Vanilla / Fabric / Forge / NeoForge** | Any version + loader, add individual CurseForge mods, enable/disable mods, change versions later |
| **Call of Duty: CoD4x, IW4x (MW2), Plutonium BO2 / BO1 / MW3** (Windows; CoD4x also Linux) | Multiplayer with bots (Bot Warfare), Domination with every base map shuffled, 4x player and weapon XP by default, RCON console, live player/bot counts. Uses your own game install. See [docs/call-of-duty.md](docs/call-of-duty.md) |
| **World of Warcraft: WotLK 3.3.5a with bots** (Windows; cMaNGOS builds on Linux) | Runs SPP Classics (cMaNGOS + Mangosbot playerbots): starts MySQL → login → world in order, edits rates/bots/realm settings, live console, friends-only game accounts, SQL backups. See [docs/wow.md](docs/wow.md) |
| **ARK: Survival Evolved** (Windows/Linux) | SteamCMD install/update, Workshop mods via `-automanagedmods`, same settings form, RCON console and player list as ASA |

The panel downloads the right Java version for each Minecraft server by itself (Java 8/17/21/25 from
Eclipse Temurin). You don't need to install Java.

**Panel features**

- Accounts for you and your friends, each with their own password, optional **2FA**, and
  per-server permissions (start/stop, console, settings, files, mods, backups, schedules)
- Dashboard with host CPU/RAM/disk and every server's status, players, CPU and RAM
- Live console (WebSocket) with command history and quick commands
- File manager: browse, edit configs in the browser, drag-and-drop upload (folders too), download
  files or whole folders as .zip, extract zips
- Backups: one click or scheduled, keep the newest N, restore, download
- Schedules: daily restarts with in-game warnings, interval backups, console commands, auto-updates
- Auto-start servers with the panel, and auto-restart after a crash (stops after 3 crashes in 15 min)
- **CPU affinity and priority** per server. On a 9950X3D you can pin servers to the second CCD
  (CPUs 16–31) so the game you're playing keeps the 3D V-Cache CCD to itself
- Clean shutdown: closing the panel saves and stops all servers first
- Friends-only by default: ARK servers get a generated join password, Minecraft servers a
  whitelist you manage in the **Players** tab
- Discord bot: posts to a Server Updates channel and keeps one channel per game server
- Custom domain support: built-in Cloudflare dynamic DNS for game hostnames, and works behind a
  Cloudflare Tunnel for the panel

---

## Install (Windows)

1. Install **Node.js LTS** (20 or newer) from <https://nodejs.org>.
2. Download or clone this folder, e.g. to `C:\Andromeda Hosting`.
3. Double-click **`install.bat`**.
4. Optional: open `config.json` and set `serversDir` to a big drive, e.g. `"D:/GameServers"`.
   ARK needs roughly 15–25 GB per server; modpacks need 1–5 GB.
5. Double-click **`start.bat`**, then open <http://localhost:8080> **on this PC** and create your
   admin account. For safety, the first account can only be created from the host PC.
6. Go to **Panel settings**:
   - Paste a **CurseForge API key**. It's free: <https://console.curseforge.com> → sign in →
     *API keys*. You need it to search and install modpacks and ARK mods.
   - Set your **public address** (press *Detect*), or a DuckDNS / No-IP name if your IP changes.
7. Optional:
   - Run `scripts\open-firewall.ps1` as Administrator to open the Windows Firewall.
   - Run `scripts\install-autostart.ps1` to start the panel when you log in.

You can also run it on Linux with `./start.sh` (Minecraft and ARK: SE; ARK: SA needs Windows).

### Creating servers

**New server** → pick a game → fill in the form → **Create & install**. Progress streams on the
server's Overview tab. When it's done, press **Start**.

- *Modpack update*: **Mods** tab → pick a version → **Update**. A backup is made first.
- *ARK mods*: **Mods** tab → *Browse CurseForge* or paste IDs → restart. ASA downloads and updates
  mods itself on every start, so a daily restart schedule keeps them current.
- *ARK game update*: **Mods** tab → *Update server* (or add an "Update" schedule).

---

## Updating

Make your Andromeda Hosting folder a Git copy of the repository once; after that, double-click
**`update.bat`** to download the latest version.

1. Install [Git for Windows](https://git-scm.com/download/win) (default options are fine).
2. Close Andromeda Hosting. In PowerShell:
   ```powershell
   cd $HOME\Desktop
   git clone -b claude/eager-fermi-ocfo13 https://github.com/YOUR-USERNAME/HomePanel.git HomePanel
   ```
   Sign in to GitHub in the browser window if it asks (the repository may be private).
3. Copy your **`data`** folder and **`config.json`** from your old `andromeda-hosting` folder into
   `HomePanel\andromeda-hosting\`. These hold your servers, users and settings; Git never touches them.
4. From now on, run Andromeda Hosting from `HomePanel\andromeda-hosting` (`start.bat`).

After that, updates come from the panel itself: **Panel settings → Updates** checks GitHub every
hour and shows what changed. Click **Update now**, or turn on **Install updates automatically**,
which only installs while nobody is playing. Andromeda Hosting saves and stops running servers, installs
the update, restarts, and starts those servers again. This works when Andromeda Hosting was started with
`start.bat`. `update.bat` still works as a manual fallback.

Don't edit Andromeda Hosting's own files in that folder. Change settings in the panel or `config.json`,
otherwise Git will refuse to update over your edits.

## Using your own domain

To put the panel at `https://panel.<yourdomain>` (free HTTPS through a Cloudflare Tunnel, no
ports opened) and give players `play.<yourdomain>`, which Andromeda Hosting keeps pointed at your home
IP, follow **[docs/domain-setup.md](docs/domain-setup.md)**.

## File share

Share a folder with your friends: they download from a simple page (only IPs you allow), and only
your PC can upload. It can run on its own port so the panel stays private. See
**[docs/file-share.md](docs/file-share.md)**.

## Discord notifications

A built-in bot posts to your **#server-updates** channel and keeps a channel per game server
(`#ark-se-server-1`, `#all-the-mods-10`...). Setup: **[docs/discord-setup.md](docs/discord-setup.md)**.

## Letting your friend in

Your friend needs two things: access to the **panel** (to manage servers) and to the **game ports**
(to play). Pick one option.

### Option A — Tailscale (recommended, easiest and safest)

1. Install [Tailscale](https://tailscale.com) (free) on your PC and on your friend's PC, and sign in.
   Share your machine with them from the Tailscale admin page, or invite them to your tailnet.
2. Your friend opens `http://<your-tailscale-ip>:8080` and signs in with the account you created
   for them under **Users & access**.
3. They join games at `<your-tailscale-ip>:25565` (Minecraft) or with `open <tailscale-ip>:7777`
   in the ARK console.

Nothing is exposed to the internet and you don't need to set up port forwarding. The catch is
that everyone who plays needs Tailscale.

### Option B — Port forwarding (anyone can join the game)

1. In your router, forward the game ports to your PC's LAN IP. Each server's **Overview** lists them
   (Minecraft: TCP 25565; ARK: SA: UDP 7777).
2. Give players your public IP or DDNS name.
3. Keep the **panel** private: use Tailscale for it (Option A), or put it behind a
   [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
   for HTTPS (set `"trustProxy": true` in `config.json`). If you expose the panel port directly,
   turn on 2FA for every account.

If your router's WAN IP doesn't match what *Detect* shows, your ISP uses CGNAT and port
forwarding won't work. Use Tailscale, or a tunnel service like [playit.gg](https://playit.gg) for
the game ports.

---

## Hosting and gaming on the same PC

64 GB RAM and a 9950X3D are plenty for a modded Minecraft server and an ARK server while you play.
Some tips:

- Minecraft memory is set per server (6–10 GB suits most modpacks). ARK uses about 10–16 GB with mods.
- **Settings → CPU affinity & priority**: choose the *CPUs 16–31* preset and *Below normal*
  priority. Your game stays on the V-Cache CCD and the servers can't cause stutter.
- To join your own server, use `localhost` or your LAN IP. Your public IP often doesn't work from
  inside your own network.
- Your second PC (32 GB) can run its own copy of Andromeda Hosting later. The current version manages
  one machine per panel.

## Configuration (`config.json`)

| Key | Default | Meaning |
|---|---|---|
| `host` / `port` | `0.0.0.0` / `8080` | Where the panel listens |
| `dataDir` | `./data` | Database, Java runtimes, SteamCMD, caches, logs |
| `serversDir` | `<dataDir>/servers` | Game server files |
| `backupsDir` | `<dataDir>/backups` | Backup zips |
| `trustProxy` | `false` | `true` behind Cloudflare Tunnel / a reverse proxy |
| `https.certFile` / `https.keyFile` | `null` | Serve the panel over HTTPS directly |

Forgot your password? Stop the panel and run `npm run reset-password -- <username> <new password>`.
This also turns off 2FA for that account.

## Security notes

- Passwords are hashed with scrypt. Sessions use HttpOnly, SameSite=Strict cookies, and every
  change needs a custom request header, which blocks CSRF.
- Logins are rate-limited, and 2FA (TOTP) is available for every account.
- The file manager can't reach anything outside a server's folder, including through symlinks.
- The panel talks to ARK's RCON over localhost only. **Don't forward the RCON port** on your router.
- Anyone with *console* or *files* permission can effectively run commands on the server, so only
  give those to people you trust.

## How it works

Node.js + Express backend, WebSocket live updates, plain-JavaScript frontend with no build step, and
a JSON database (`data/panel.json`). There are no native modules, so `npm install` works on any
Windows PC without build tools.

```
src/
  index.js            web server, WebSocket, shutdown handling
  auth.js             users, sessions, permissions
  games/              minecraft.js, ark.js — install, launch, settings, stop, player query
  services/           java (Temurin), steamcmd, curseforge API, loaders (Forge/NeoForge/Fabric), modpack installer
  manager/            process lifecycle, jobs, backups, scheduler
  routes/             REST API
public/               the web UI
test/                 unit tests (npm test)
```

## Status / limitations

- Built and tested on Linux with a fake Minecraft server and mock RCON: process control,
  console, backups, schedules, permissions, file manager and the UI. The internet-dependent parts
  (CurseForge, Mojang, Forge/NeoForge/Fabric downloads, SteamCMD) and the Windows-only parts
  (ARK: SA, PowerShell process stats/affinity) follow the official APIs, but they haven't run on
  a real Windows PC yet. Please report anything that breaks.
- A few CurseForge mods block third-party downloads. When the panel builds a server from a pack
  manifest (no official server pack), it lists those mods with links so you can upload them yourself.
- Quilt modpacks aren't supported yet.
- One machine per panel. Managing your second PC from the same panel isn't supported yet.
