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

**Map picker:** the map list is a grid of cards with each map's picture. Click a map to add or
remove it; *Base game only* picks just the maps everyone has. The pictures come from the
[Call of Duty Wiki](https://callofduty.fandom.com): the panel looks each map up the first time
you open the page, keeps the picture in its cache folder, and serves it itself. Until a picture
is downloaded (or if the wiki has none), the card shows the map's name.

**BO2 match rules:** *Match rules (all game modes)* covers hardcore, friendly fire, killcams,
team balance, player health, health regeneration and the pre-match countdown. Below it, a
rules section for the selected game mode sets its time limit, score limit, lives and respawn
delay, plus rounds for Search & Destroy, Demolition and Capture the Flag. Anything left on
*Game default* / blank isn't written, so the game mode's normal value applies. The panel writes
these into Plutonium's `storage\t6\gamesettings\hp_<id>_<mode>.cfg`, laid out like
Plutonium's own mode files (the game's default and mode settings, `set_gametype <mode>`, then the
panel's rules). The map rotation loads it with `execgts` before each map. *Auto-balance teams*
is on unless you turn it off, as in Plutonium's own configs.

**BO2 bots:** besides how many bots and how hard they are, you can set how the player count
works, which team bots join (or a custom split), forced team balance, bot rank and prestige,
whether bots throw grenades, jump/drop shot and aim, kicking bots at the end of a match, and
how long to wait before adding them. *Keep teams even by moving bots* is on by default: when a
friend joins, Bot Warfare kicks a bot from the team with the most bots (it doesn't count people),
so without it the teams can end up uneven.

**BO2 playlists and DLC maps:** under **Settings → Game mode & maps**, the *Playlist* setting has
**NukeJacked**: a rotation of just Nuketown 2025 and Hijacked, using whichever game mode you
pick (Team Deathmatch is the usual choice). Nuketown 2025 and the DLC maps are also in the
map checklist, marked as bonus map/DLC. They're never in a default rotation, because everyone
who joins needs those map files.

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

The BO2 bot options (team, split, rank, prestige, grenades, jump/drop shot, aim, kick at match
end, wait time, fill mode, spectators) use the dvars documented in the
[t6_bot_warfare README](https://github.com/ineedbots/t6_bot_warfare).

The BO2 rotation format (`execgts <file> map …`), the gamesettings file layout and every
`gts` rule name come from Plutonium's T6 server configs
([T6ServerConfigs](https://github.com/xerxes-at/T6ServerConfigs)).

These follow the standard community server configs, but haven't been run against the real games
yet. If something doesn't take, use **Settings → Extra config lines** to override it, and tell me
what the console says:

- **Map pictures**: the wiki search picks the page whose title matches the map's name. A card can
  end up with a wrong or missing picture if the wiki names a page differently.
- **XP dvars**: `scr_xpscale` everywhere; `scr_weaponxpscale` on MW3/BO1/BO2. Check a match's
  end-of-game XP.
- **Map rotation format**: `gametype dom map …` for CoD4x/IW4x/BO1;
  `dsr DOM_default map …` for MW3. MW3 needs the stock DSR files (`admin/DOM_default.dsr`), which
  come with Plutonium's IW5 server configs.
- **Where Plutonium reads the config**: Andromeda Hosting writes `hp_<id>.cfg` into `main/` (and `admin/`
  for MW3) inside the game folder.
- **Plutonium console**: Plutonium shows its console in its own window, so the panel's console tab
  follows `console_mp.log` and uses RCON for commands.
- **Plutonium download**: the panel runs Plutonium's updater with `-install-dir … -update-only`,
  but only when you don't already have Plutonium installed.
