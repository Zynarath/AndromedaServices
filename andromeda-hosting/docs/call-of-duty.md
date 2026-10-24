# Call of Duty servers (CoD4x, IW4x, Plutonium BO2 / BO1 / MW3)

Andromeda Hosting runs multiplayer servers for these community clients:

| Template | Game | Engine | Default port (UDP) |
|---|---|---|---|
| Call of Duty 4 (CoD4x) | CoD4: Modern Warfare | [CoD4x](https://cod4x.ovh) | 28960 |
| Modern Warfare 2 (IW4x) | MW2 | [IW4x](https://alterware.dev) | 28960 |
| Black Ops II (Plutonium T6) | BO2 | [Plutonium](https://plutonium.pw) | 4976 |
| Black Ops (Plutonium T5) | BO1 | Plutonium | 28960 |
| Modern Warfare 3 (Plutonium IW5) | MW3 | Plutonium | 27016 |

If you run two servers that share a default port (e.g. CoD4x and IW4x), the panel picks the next
free port for the second one.

Every new server starts as:

- **Domination**
- **All base maps** (16 for CoD4/MW2/MW3, 14 for BO1/BO2) in a rotation that's **reshuffled
  every start**
- **4x player XP**, plus **4x weapon XP** on the games that have weapon levels (MW3, BO1, BO2)
- **Bots** ([Bot Warfare](https://github.com/ineedbots) by INeedBots) keeping the match at 12
  players (6v6). A bot leaves whenever a friend joins.
- A generated **join password**, since the servers are for your friend group

All of it can be changed per server under **Settings** (game mode, map checklist, shuffle, XP,
bot count and difficulty, password, extra config lines).

## What you need

**You must own each game.** None of the clients include game files. Andromeda Hosting runs the server
from your existing install, so set the **game folder** when you create the server:

| Game | Game folder | Also needed |
|---|---|---|
| CoD4x | Your CoD4 folder (has `main` and `zone`) | Nothing. Andromeda Hosting downloads the CoD4x server and links the game files into the server folder (hard links: no extra disk space on the same drive) |
| IW4x | Your MW2 folder **with IW4x installed** (has `iw4x.exe`) | Install IW4x first with the AlterWare launcher |
| BO2 / BO1 / MW3 | Your game folder (has `zone`) | A free **Plutonium server key**: sign in at [platform.plutonium.pw/serverkeys](https://platform.plutonium.pw/serverkeys) and create one. If Plutonium is already installed (`%LOCALAPPDATA%\Plutonium`), Andromeda Hosting uses that install; otherwise it downloads its own copy |

Forward each server's **UDP** port on your router (see the server's Overview), or have your
friends connect over Tailscale.

## Joining

In game, open the console (`~`) and type:

```
password rex-1234; connect play.example.com:28960
```

The server's Overview shows the exact line, with its own password and port. BO2/BO1/MW3 servers
also show up in Plutonium's server browser.

## Bots

On install, Andromeda Hosting downloads Bot Warfare **from its source repository** and puts it where each
game loads it, following each mod's README:

| Game | Where | Players need it? |
|---|---|---|
| IW4x, CoD4x | `mods/mp_bots/z_svr_bots.iwd` (+ `fs_game mods/mp_bots`) | No. `z_svr_` iwds stay on the server |
| BO2 | `Plutonium\storage\t6\scripts` | No |
| MW3 | `Plutonium\storage\iw5\` (maps, scripts, scriptdata) | No |
| BO1 | `Plutonium\storage\t5\` (maps, scripts, mp) | No |

The Plutonium copies are shared by every server of that game. Servers with bots turned off set
`bots_manage_fill 0`, so they stay bot-free.

Bot difficulty uses each mod's own scale. Andromeda Hosting shows the right choices per game:
0–9 for CoD4x/IW4x/MW3, 0–3 for BO2, easy/normal/hard/fu for BO1.

Update the bots from the server's **Mods** tab.

## What's verified and what isn't

These settings come straight from each project's own documentation or source code and are covered
by tests:
- Bot Warfare dvars (`bots_manage_fill`, `bots_manage_fill_kick`, `bots_skill`...) and install
  locations
- The CoD4x setup (game `.iwd` and `zone` files in the server folder, `+set dedicated 2`)
- The `rcon` / `getstatus` protocol

These follow the standard community server configs, but haven't been run against the real games
yet. If something doesn't take, use **Settings → Extra config lines** to override it, and tell me
what the console says:

- **XP dvars**: `scr_xpscale` everywhere; `scr_weaponxpscale` on MW3/BO1/BO2. Check a match's
  end-of-game XP.
- **Map rotation format**: `gametype dom map …` for CoD4x/IW4x/BO1; `exec dom.cfg map …` for BO2;
  `dsr DOM_default map …` for MW3. MW3 needs the stock DSR files (`admin/DOM_default.dsr`), which
  come with Plutonium's IW5 server configs.
- **Where Plutonium reads the config**: Andromeda Hosting writes `hp_<id>.cfg` into `main/` (and `admin/`
  for MW3) inside the game folder.
- **Plutonium console**: Plutonium shows its console in its own window, so the panel's console tab
  follows `console_mp.log` and uses RCON for commands.
- **Plutonium download**: the panel runs Plutonium's updater with `-install-dir … -update-only`,
  but only when you don't already have Plutonium installed.
