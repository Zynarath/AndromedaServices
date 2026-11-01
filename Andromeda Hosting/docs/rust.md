# Rust (vanilla or modded with uMod)

Two templates on **New server**:

- **Rust — Modded (uMod / Oxide)**: installs the dedicated server through SteamCMD, then [uMod](https://umod.org/games/rust) (Oxide).
- **Rust**: the same server without uMod. You can turn uMod on later in **Settings → uMod**.

The first install downloads about 10 GB. Rust uses 8–12 GB of RAM while running.

## Ports

| Port | Protocol | Forward? | What |
| --- | --- | --- | --- |
| 28015 | UDP | yes | Game |
| 28017 | UDP | yes | Server browser (query) |
| 28082 | TCP | yes | Rust+ companion app (0 turns it off) |
| 28016 | TCP | **no** | RCON — the panel's console. It only listens on this PC. |

Players join with `client.connect <address>:28015` in the F1 console, or find the server in the browser
(modded servers are listed under **Modded**).

## Plugins (Mods tab)

- **Browse uMod** searches Rust plugins on umod.org (most downloaded first). Pick one or more and they are
  downloaded into `oxide/plugins`. uMod compiles and loads them by itself, also while the server runs — no restart.
- Installed plugins show their version, and an **Update** button when uMod has a newer one (**Update all** does them all).
- The switch turns a plugin off by moving it to `oxide/plugins.disabled` (uMod unloads it).
- **Remove** deletes the plugin but keeps its settings and data, so reinstalling it later picks up where it left off.
- **Upload .cs** (admins only) installs a plugin from somewhere other than uMod. Plugins are C# code that runs on this
  PC, so only install ones you trust.
- **Update uMod** installs the newest uMod build without updating the game (server stopped). A game update
  (Mods tab → *Update server*) installs uMod again automatically, because Rust updates replace its files.

Many plugins use permissions. Grant them in the **Console**, e.g. `oxide.grant group default kits.use`.

## Plugin settings (Mod configuration tab)

Plugins write their settings to `oxide/config/<Plugin>.json` the first time they load, and their chat messages to
`oxide/lang/en/<Plugin>.json`. Both are shown as forms:

- Setting names are made readable: `MaxHomesPerPlayer`, `max_homes_per_player` and `maxHomesPerPlayer` all show as
  *Max homes per player*; notes like `(true/false)` are dropped because the switch already says that. Hover a
  setting to see its exact name in the file. The file keeps its original names when saved.
- Nested groups become sections (*Options › Gather resource modifiers*), and lists of entries (kits, zones…) are
  numbered *#1, #2…*.
- While the server runs, **Save and reload plugin** writes the file and runs `oxide.reload <Plugin>`, so changes
  apply at once.
- **Edit raw file** (needs the Files permission) edits the JSON directly; invalid JSON is refused.

## Backups

Backups contain the world (`server/<save folder name>`) and everything uMod keeps (plugins, settings, data),
not the game files — those come back with **Reinstall**.
