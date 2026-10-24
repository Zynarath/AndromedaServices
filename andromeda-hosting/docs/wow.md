# World of Warcraft: Wrath of the Lich King (3.3.5a) with bots

Andromeda Hosting runs a WotLK private server for your friend group, with thousands of AI players
("Mangosbot" playerbots) so the world feels alive. You can start, stop, restart, edit settings,
see the live console, manage game accounts, back up and restore from the panel.

It's built on **[SPP Classics V2](https://github.com/celguar/spp-classics-cmangos)**: a free Windows
package of the open-source [cMaNGOS](https://github.com/cmangos/mangos-wotlk) server with celguar's
Mangosbot bots, its own MySQL database and the server-side map data. Because the map data comes
with SPP, you don't need to extract anything from a WoW client to run the server. Any other cMaNGOS
WotLK folder (with `mangosd`, `realmd` and their `.conf` files) also works.

## 1. Install SPP Classics (one time)

1. Download **SPP_Classics_V2.exe** from
   [the SPP releases page](https://github.com/celguar/spp-classics-cmangos/releases/tag/v2.0).
2. Run it and extract it somewhere with ~20 GB free, ideally an SSD (e.g. `C:\Games\SPP_Classics_V2`).
3. Open the folder and run **`Server_Update.bat`**. Wait for the download, choose **WotLK** in the
   menu and let it download the WotLK files. Don't close it while it works.
4. When it reaches its main menu, **close it**. From now on Andromeda Hosting starts and stops the server.
   Don't run SPP's launcher at the same time as the panel.

## 2. Add it to the panel

1. **New server → World of Warcraft: Wrath of the Lich King**.
2. **Server folder**: the `SPP_Classics_V2` folder. Click **Check**: every row should be green
   (world server, login server, configs, bots config, map data, bundled MySQL).
3. Pick a **realm name** and click **Create & install**. Nothing is downloaded or copied; the panel
   uses the files where they are and turns on the world server's console.
4. **Start** the server. The panel starts, in order:
   1. **MySQL**, listening on **this PC only** (`127.0.0.1`), because SPP's database uses a
      well-known default password
   2. **realmd**, the login server
   3. **mangosd**, the world server

   The first start creates the random bots and takes a while; watch the Console tab. The server
   counts as online when the world finishes loading.

## 3. Friends-only accounts

There's no public sign-up: **only accounts you create can log in**.

1. With the server running, open the **Accounts** tab → **New account**.
2. Make one for yourself with role **Admin** (all GM commands) and one per friend with role
   **Player**.
3. Accounts are always created for Wrath of the Lich King (expansion 2). Without that, cMaNGOS makes
   vanilla-only accounts that can't enter Northrend or make Death Knights.
4. You can change passwords and roles, or delete accounts, any time. Bot accounts are hidden from
   the list.
5. Passwords are 4–16 characters with no spaces or quotes. That's a WoW client limit, and it also
   keeps console commands safe. Passwords never show up in the console view.

## 4. Let friends connect

- **Router:** forward **TCP 3724** (login) and **TCP 8085** (world) to your PC. Don't forward
  MySQL (3310).
- **Address:** the realm is announced at your panel's public address. Set
  `play.example.com` under Panel settings, or override it per server in Settings → Realm. The
  panel keeps the realm list up to date every time it starts the server.
- **Friends' client:** each friend needs a working **WoW 3.3.5a (build 12340)** client. In its
  `Data\enUS\realmlist.wtf` (or `enGB`), replace the contents with:
  ```
  set realmlist play.example.com
  ```
  The server's Overview shows this line with a Copy button. Then they start `Wow.exe` and log in
  with the account you made.
- **You, on the hosting PC:** use the same `set realmlist play.example.com` as everyone, so
  one client works for all of you. Run this once as Administrator:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\use-domain-on-this-pc.ps1 -Hostname play.example.com
  ```
  It's needed because cMaNGOS gives every player the same realm address. On your own PC that name
  points to your public IP, and most routers can't loop back to it, so you'd log in, pick the realm,
  then hang at "Connecting" and drop. The script adds `127.0.0.1 play.example.com` to your
  hosts file (this PC only; friends are unaffected). Add `-Remove` to undo it.
- **Extra lock-down (optional):** limit the WoW ports in Windows Firewall to your friends' IPs.
  These are the same IPs you allow on the file share.

## Settings

Server → **Settings** edits SPP's config files directly (`Settings\wotlk\mangosd.conf`,
`aiplayerbot.conf`, `realmd.conf`). Every other option is in the **Files** tab, which opens the
SPP folder.

| Section | What you can change |
|---|---|
| Realm | Realm name, the address announced to players, whether the panel starts the bundled MySQL |
| Rates | XP (kill, quest, explore, rested), gold and item drop rates, reputation, honor |
| World | Realm type (PvP/PvE/RP), max and starting level, starting money, player limit, cinematics, cross-faction play |
| Bots | Bots on/off, auto-login, min/max random bots (SPP default 1000; lower it if the server lags), bot level range, bots in the dungeon finder and battlegrounds, bot guilds, quest sharing, auto-learning spells |
| Network | World and login ports |

Changes apply on the next restart. If you change the number of random bots later, SPP's README
says the random bots need a reset to take effect.

## Console, stop, backups

- **Console:** world server output plus `[mysql]` and `[realmd]` lines. Type GM commands without the
  dot, e.g. `announce Raid at 8!`, `server info`, `account onlinelist`. Quick buttons cover the
  common ones.
- **Stop / Restart:** the panel runs `saveall`, then `server shutdown 0`, waits for the world
  server to exit, stops realmd, and shuts MySQL down cleanly. **Kill** forces everything off; avoid
  it unless something is stuck.
- **Crash:** if auto-restart is on, MySQL and realmd stay up and only the world server restarts.
- **Backups:** WoW saves live in MySQL, so a backup is a SQL dump of the login, characters and bots
  databases, plus the three config files, zipped. Run it from the Backups tab or on a schedule.
  **Restore** (server stopped) imports the dump; the panel starts MySQL for it if needed.
- **Discord:** the server gets its own channel (e.g. `#wow-wotlk-server-1`). "Online" messages
  include the realmlist line.

## About the WoW client

Andromeda Hosting doesn't download or distribute the WoW client. Blizzard no longer sells or hosts
3.3.5a, so copies found online are other people redistributing Blizzard's game. To repair a
damaged client:
- Reinstall from your original Wrath of the Lich King discs and patch to 3.3.5a.
- Copy the client from a backup, or from a friend's working install of the same version.
- Check which files are damaged: usually only some `.MPQ` files in `Data\` are corrupted. Replacing
  just those from your discs or backup is enough.

The server itself doesn't need a client: SPP ships the map data it needs.
