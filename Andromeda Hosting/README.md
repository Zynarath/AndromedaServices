# Andromeda Hosting

Version 2.0.0 · part of [Andromeda Services](../README.md)

A self-hosted game server control panel, like G-Portal or Nitrado, that runs on **your own PC**.
You and your friends sign in from a browser, start and stop servers, change settings, install and
update CurseForge modpacks, manage files, schedule restarts and backups, and watch the live console.
There are no monthly hosting fees; your only cost is electricity.

**Supported games**

| Game | What the panel does |
|---|---|
| **ARK: Survival Ascended** (Windows) | Installs/updates via SteamCMD, CurseForge mod list (search + IDs; the server auto-downloads mods on start), map/cluster/crossplay options, 260+ server settings in the panel (rates, XP, breeding, structures, tribes, transfers, per-level stats, events, launch flags) plus extra INI lines for engram/item/spawn overrides, RCON console, player list |
| **Minecraft — CurseForge modpack** | Search CurseForge, pick a version, one-click install. Uses the pack's official server files when available, otherwise builds the server from the manifest. One-click **update / downgrade** with automatic backup that keeps worlds, `server.properties`, ops and whitelist |
| **Minecraft — Vanilla / Fabric / Forge / NeoForge** | Any version + loader, add individual CurseForge mods, enable/disable mods, change versions later |
| **Call of Duty: CoD4x, IW4x (MW2), Plutonium BO2 / BO1 / MW3** (Windows; CoD4x also Linux) | Multiplayer with bots (Bot Warfare), Domination with every base map shuffled, 4x player and weapon XP by default, RCON console, live player/bot counts. Uses your own game install. See [docs/call-of-duty.md](docs/call-of-duty.md) |
| **Call of Duty: S1x (Advanced Warfare), IW6x (Ghosts)** (Windows) | AlterWare clients run from your own game folder (install them with the AlterWare launcher first). Domination with a shuffled rotation, 4x XP, match rules, RCON console. No Bot Warfare exists for these, so no bots |
| **Satisfactory** (Windows/Linux) | SteamCMD install/update. On the first start the panel claims the server (sets the admin password, shown on the server page) and starts a new game; name, join password, autosave and pause options are applied through the server's API on every start, and stops save first. **Mods from ficsit.app**: search and add them in the Mods tab — the panel picks versions that fit each other and the game build, installs SML and dependencies, and lists the ones players need too |
| **7 Days to Die** (Windows/Linux) | SteamCMD install/update (stable or experimental), 40+ settings written to the server config (world, difficulty, zombies, blood moons, loot, land claims), saves in the server's own folder, telnet console, player list and clean shutdown. **Mods**: install from a mod's .zip, switch mods on/off, warning when a code mod needs Easy Anti-Cheat off |
| **Valheim** (Windows/Linux) | SteamCMD install/update, world name, password, crossplay, presets and world modifiers, admin / allow / ban lists, autosave interval; stops with Ctrl+C so the world is saved |
| **Rust** (Windows/Linux), vanilla or **modded with uMod (Oxide)** | SteamCMD install/update with uMod reinstalled after every game update, procedural or custom maps, RCON console and player list, saves on stop. Browse and install uMod plugins from the panel (update checks, on/off, upload your own .cs), and edit each plugin's settings with readable names; a running server reloads the plugin right away. See [docs/rust.md](docs/rust.md) |
| **World of Warcraft: WotLK 3.3.5a with bots** (Windows; cMaNGOS builds on Linux) | Runs SPP Classics (cMaNGOS + Mangosbot playerbots): starts MySQL → login → world in order, edits rates/bots/realm settings, live console, friends-only game accounts, SQL backups. See [docs/wow.md](docs/wow.md). A separate **WotLK website** (SPP's site rebuilt with the same look, its security problems fixed) runs next to it from Andromeda Services: news, armory, realm status, who's online, honor, auction house, invite-only sign-up. See [its README](../Andromeda%20WotLK%20Website/README.md) |
| **ARK: Survival Evolved** (Windows/Linux) | SteamCMD install/update, Workshop mods via `-automanagedmods`, same settings form, RCON console and player list as ASA |

The panel downloads the right Java version for each Minecraft server by itself (Java 8/17/21/25 from
Eclipse Temurin). You don't need to install Java.

**Panel features**

- Accounts for you and your friends, each with their own password, optional **2FA**, and
  per-server permissions (start/stop, console, settings, files, mods, backups, schedules)
- **View as a user** (admins): *Users & access → View as* shows the panel exactly as that friend
  sees it — their servers, tabs and permissions — read-only, until you press *Stop viewing*
- Dashboard with host CPU/RAM/disk and every server's status, players, CPU and RAM
- Each server card shows the game's cover art (downloaded once from Steam or Wikipedia). Change it
  under **Settings → Cover picture** by uploading your own, or go back to the game's default
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

Install Andromeda Services as described in the [main README](../README.md#install-windows): it
sets up the panel and the WotLK website and adds **Andromeda Services**, which starts and stops them.
Then, in the panel:

1. Go to **Panel settings**:
   - Paste a **CurseForge API key**. It's free: <https://console.curseforge.com> → sign in →
     *API keys*. You need it to search and install modpacks and ARK mods.
   - Set your **public address** (press *Detect*), or a DuckDNS / No-IP name if your IP changes.
2. Optional: run `scriptsopen-firewall.ps1` as Administrator to open the Windows Firewall.

You can also run the panel on its own, on Windows or Linux, with `npm install --omit=dev` then
`npm start` in this folder (Linux: Minecraft, ARK: SE, Satisfactory, 7 Days to Die, Valheim, Rust;
ARK: SA and most Call of Duty titles need Windows).

### Creating servers

**New server** → pick a game → fill in the form → **Create & install**. Progress streams on the
server's Overview tab. When it's done, press **Start**.

- *Modpack update*: **Mods** tab → pick a version → **Update**. A backup is made first.
- *ARK mods*: **Mods** tab → *Browse CurseForge* or paste IDs → restart. ASA downloads and updates
  mods itself on every start, so a daily restart schedule keeps them current.
- *ARK game update*: **Mods** tab → *Update server* (or add an "Update" schedule).
- *Satisfactory mods*: **Mods** tab → *Browse ficsit.app* → add → restart (mods are installed on
  start). Players install the same mods with the Satisfactory Mod Manager.
- *7 Days to Die mods*: **Mods** tab → *Install from .zip*. Mods with their own code (.dll) need Easy
  Anti-Cheat off (Settings → Advanced), and only an admin can install them.

---

## Updating

See [Updating](../README.md#updating) in the main README. Besides **Check for updates** in
Andromeda Services, the panel can update itself: **Panel settings → Updates** checks GitHub every
hour and shows what changed. Click **Update now**, or turn on **Install updates automatically**,
which only installs while nobody is playing. Andromeda Hosting saves and stops running servers,
installs the update, restarts, and starts those servers again. This works when Andromeda Hosting
was started with Andromeda Services.

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

## Branding

Andromeda Hosting is made by **Andromeda Services**. The logos are SVG files in `public/img/`:

| File | What it is |
|---|---|
| `icon.svg` | **Andromeda Hosting** app icon ("Eclipse"): the panel's logo and browser-tab icon |
| `andromeda-hosting-mark.svg` | The Eclipse mark on its own, for dark backgrounds |
| `andromeda-services-icon.svg` | **Andromeda Services** app icon ("Star Gate"); `services/andromeda.ico` is the same for the Windows app |
| `andromeda-services-logo.svg` | Star Gate mark with the "Andromeda Services" name, for dark backgrounds |
| `andromeda-services-mark.svg` / `-mark-light.svg` | The Star Gate mark on its own, for dark / light backgrounds |

## How it works

Node.js + Express backend, WebSocket live updates, plain-JavaScript frontend with no build step, and
a JSON database (`data/panel.json`). There are no native modules, so `npm install` works on any
Windows PC without build tools.

```
src/
  index.js            web server, WebSocket, shutdown handling (checkDeps.js runs first)
  wowsite/            the standalone WotLK website (its own process): pages, armory, accounts, news
  auth.js             users, sessions, permissions, 2FA, "view as"
  games/              one module per game: install, launch, settings, stop, player query
                      (minecraft, ark, cod, wow, satisfactory, sdtd = 7 Days to Die, valheim)
  services/           downloads and integrations: SteamCMD, Java, CurseForge, ficsit.app,
                      modpacks, cover art, Discord, dynamic DNS, file share, self-update
  manager/            process lifecycle, jobs, backups, scheduler
  routes/             REST API
  util/               shared helpers: config file formats (ini, properties, conf), zip,
                      downloads, paths/uploads, settings forms, RCON, process stats
public/               the web UI (plain ES modules, no build step)
services/             Andromeda Services, the Windows app (C#, built by services\build.bat)
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
