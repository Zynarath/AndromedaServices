# Call of Duty servers (CoD4x, IW4x, Plutonium BO2 / BO1 / MW3, T7x BO3, H1-Mod MWR)

Andromeda Hosting runs multiplayer servers for these community clients:

| Template | Game | Engine | Default port (UDP) |
|---|---|---|---|
| Call of Duty 4 (CoD4x) | CoD4: Modern Warfare | [CoD4x](https://cod4x.ovh) | 28960 |
| Modern Warfare 2 (IW4x) | MW2 | [IW4x](https://alterware.dev) | 28960 |
| Black Ops II (Plutonium T6) | BO2 | [Plutonium](https://plutonium.pw) | 4976 |
| Black Ops (Plutonium T5) | BO1 | Plutonium | 28960 |
| Modern Warfare 3 (Plutonium IW5) | MW3 | Plutonium | 27016 |
| Black Ops III (T7x) | BO3 | Activision's Unranked Server + [T7x](https://alterware.dev) | 27017 |
| Modern Warfare Remastered (H1-Mod) | MWR | [H1-Mod](https://github.com/auroramod/h1-mod) | 27016 |

If you run two servers that share a default port (e.g. CoD4x and IW4x), the panel picks the next
free port for the second one.

Every new server starts as:

- **Domination**
- **All base maps** (16 for CoD4/MW2/MW3, 14 for BO1/BO2) in a rotation that's **reshuffled
  every start**
- **4x player XP**, plus **4x weapon XP** on the games that have weapon levels (MW3, BO1, BO2)
- **Bots** ([Bot Warfare](https://github.com/ineedbots) by INeedBots) keeping the match at 12
  players (6v6). A bot leaves whenever a friend joins. BO3 uses its own bots instead: see
  [Black Ops III](#black-ops-iii-t7x).
- A generated **join password**, since the servers are for your friend group

All of it can be changed per server under **Settings** (game mode, map checklist, shuffle, XP,
bot count and difficulty, password, extra config lines).

**Map picker:** the map list is a grid of cards with each map's picture. Click a map to add or
remove it; *Base game only* picks just the maps everyone has. The pictures come from the
[Call of Duty Wiki](https://callofduty.fandom.com): the panel looks each map up the first time
you open the page, keeps the picture in its cache folder, and serves it itself. Until a picture
is downloaded (or if the wiki has none), the card shows the map's name.

**Match rules (BO2, CoD4x, MW2, BO1):** *Match rules (all game modes)* covers hardcore, friendly fire, killcams,
team balance, player health and health regeneration (BO2 adds final killcam and the pre-match
countdown). Below it, a
rules section for the selected game mode sets its time limit, score limit, lives and respawn
delay, plus rounds for Search & Destroy, Demolition and Capture the Flag. Anything left on
*Game default* / blank isn't written, so the game mode's normal value applies. The panel writes
BO2's rules go into Plutonium's `storage\t6\gamesettings\hp_<id>_<mode>.cfg`, laid out like
Plutonium's own mode files (the game's default and mode settings, `set_gametype <mode>`, then the
panel's rules). The map rotation loads it with `execgts` before each map. *Auto-balance teams*
is on unless you turn it off, as in Plutonium's own configs. CoD4x, MW2 and BO1 get the same rules
as `scr_` dvars in the server config (`scr_hardcore`, `scr_team_fftype`, `scr_game_allowkillcam`,
`scr_teambalance`, `scr_player_maxhealth`, `scr_player_healthregentime`, and
`scr_<mode>_timelimit` / `scorelimit` / `numlives` / `playerrespawndelay` / `roundlimit` /
`winlimit` for the selected mode). MW3 takes its rules from DSR files, so the panel leaves them
to MW3's own `<MODE>_default.dsr`.

**Bots (every game):** besides how many bots and how hard they are, the panel shows every Bot
Warfare option that game's version documents: how bots fill the server (including *Use bots to
even out the teams*), waiting for a real player, which team bots join (or a custom split), bot
rank and prestige (COD Points on BO1), class choices, and whether bots knife, throw grenades,
jump/drop shot, aim down sights, play the objective, camp, use killstreaks, take care packages
and chat. Options a game's Bot Warfare doesn't have aren't shown for it. *Keep teams even by moving bots* is on by default: when a
friend joins, Bot Warfare kicks a bot from the team with the most bots (it doesn't count people),
so without it the teams can end up uneven.

**BO2 playlists and DLC maps:** under **Settings → Game mode & maps**, the *Playlist* setting has
**NukeJacked**: a rotation of just Nuketown 2025 and Hijacked, using whichever game mode you
pick (Team Deathmatch is the usual choice). Nuketown 2025 and the DLC maps are also in the
map checklist, marked as bonus map/DLC. They're never in a default rotation, because everyone
who joins needs those map files.

## Black Ops III (T7x)

BO3 runs on Activision's free **Call of Duty: Black Ops III – Unranked Server** with AlterWare's
**T7x** client on top. The Unranked Server on its own gives no XP and has no bots, so T7x is needed.

**Set up:**

1. In Steam, open *Library → Tools* and install **Call of Duty: Black Ops III – Unranked Server**.
2. In the panel, **New server → Black Ops III (T7x)**, and set the game folder to that install
   (the folder with `zone` in it).
3. **Create & install** downloads `t7x.exe` from AlterWare (the address in its
   [install guide](https://forum.alterware.dev/t/how-to-install-the-t7x-client/1418)) into that folder.
   *Mods → Update T7x* gets the latest one later.
4. Forward **UDP 27017** (or whatever port the server shows).

**Your friends** need their own copy of Black Ops III on Steam with T7x installed: put `t7x.exe` in
their Black Ops III folder and start the game with it. Then join from the console:
`password <join password>; connect <address>:27017`.

**What the panel writes:** `zone\hp_<id>.cfg` in the Unranked Server folder, laid out like the
T7x server configs ([Dss0/t7-server-config](https://github.com/Dss0/t7-server-config)):
`live_steam_server_name`, `g_password`, `rcon_password`, `com_maxclients`, `sv_lobby_mode mp`,
`sv_skip_lobby 1`, the game mode's own `gamedata/gamesettings/mp/gamesettings_<mode>.cfg`, the bots,
and `sv_maprotation "gametype <mode> map … map …"`. It starts
`t7x.exe -dedicated +set net_port <port> +set logfile 2 +exec hp_<id>.cfg`, the same line as
T7x's own `T7x_MP_Server.bat`.

**Maps:** the 12 base maps are the default rotation. Nuk3town, Fringe Night, Redwood Snow and
the 16 DLC maps can be ticked in Settings, but everyone who joins needs them.

**Bots:** BO3 has bots of its own, so there's no Bot Warfare. *Bots in the match* is split evenly
over the two teams (`bot_maxAllies` / `bot_maxAxis`); in Free-for-all and Gun Game they all go in
`bot_maxFree`. Difficulty is `bot_difficulty`: Easy, Normal, Hard or Veteran. Keep *Max players*
above bots + people, because it isn't confirmed that BO3's bots make room when a friend joins.

### XP, Cryptokeys and the Black Market

- **XP:** T7x lets you level up against bots offline (Combat Training), and the panel writes
  `scr_xpscale` (4x by default). No source confirms that XP counts on a T7x **dedicated** server,
  so check your rank after a match. If it doesn't count, Combat Training with T7x is the way to
  level up with bots.
- **Cryptokeys and the Black Market** come only from Activision's own servers (Demonware), for
  ranked public matches. A private server can't give them, and none of the community clients
  (T7x, BOIII) has its own Black Market. BOIII only has "unlock all". Adding keys to your Activision
  account any other way means editing official stats, which can get the account banned, so the
  panel doesn't do it. T7x connects to Activision's official servers, so Cryptokeys from official
  public matches still work as normal.

## Modern Warfare Remastered (H1-Mod)

MWR runs on **H1-Mod**, the community client that adds dedicated servers to the game. You and
your friends each need your own copy of Modern Warfare Remastered with H1-Mod in it.

**Set up:**

1. Download `h1-mod.exe` from [github.com/auroramod/h1-mod/releases](https://github.com/auroramod/h1-mod/releases)
   and put it in your Modern Warfare Remastered folder (next to `h1_mp64_ship.exe`). Start it
   once: it downloads the rest of its files itself.
2. In the panel, **New server → Modern Warfare Remastered (H1-Mod)**, and set the game folder to
   that folder.
3. Forward **UDP 27016** (or whatever port the server shows).

**Your friends** start the game with `h1-mod.exe` too, pick Multiplayer, and join from the
console: `password <join password>; connect <address>:27016`.

**What the panel does:** it writes `main\hp_<id>.cfg` and starts
`h1-mod.exe -dedicated -stdout +set net_port <port> +exec hp_<id>.cfg +map_rotate`. The 16 base
maps are the default rotation; Winter Crash, Beach Bog, Daybreak and the four Variety Map Pack
maps can be ticked in Settings, but everyone who joins needs them. H1-Mod answers a different
status query from the other games (`getInfo`), which gives the number of players and bots but
not their names, so the panel shows counts only.

**Bots:** MWR has bots of its own, and H1-Mod adds them with its `spawnBot` command. There is no
setting that keeps them in the match, so the panel does it: once a map has loaded it sends
`spawnBot <n>` for however many are missing, and tops them up when it checks the server. Bots
don't leave when people join, so keep *Max players* above bots + people. There is no difficulty
setting.

### Messages when H1-Mod starts

- **"Your game files are outdated or unsupported"** is H1-Mod's own check. It compares
  `zone\patch_ui_mp.ff` (and, when you start the game yourself rather than a server,
  `zone\patch_icbm.ff` from the campaign) with the copies it was built for. It's a warning: press
  OK and the game carries on, though H1-Mod says to expect crashes. It appears when `h1-mod.exe`
  isn't in the game folder itself, when the campaign or multiplayer part isn't installed, or when
  the copy of the game isn't the Steam build H1-Mod supports. Start with Steam's *Verify
  integrity of game files*.
- **On a server this matters more:** the message is a window that waits for OK, and a server
  started by the panel has no window you can see, so it would stay on *Starting*. The panel
  checks the same file before every start and says so in the console if it doesn't match.
- **A message about an out-of-date AMD graphics driver** isn't from H1-Mod (there is no such
  message in its code). It is the game's own start-up check, which knows the driver versions
  from when the game came out and doesn't understand newer ones. With a current driver it can be
  dismissed. It never appears on a server, which doesn't use the graphics card.

### XP, Parts and Depot Credits

- **XP and rank** work as in the normal game, and are kept on each player's own PC by H1-Mod
  (not on Activision's servers). The panel writes `scr_xpscale`, **4x at most**: the game's rank
  script is expected to end the match on a higher value, like the other games built on this
  engine, so the panel never writes more than 4.
- **The Depot** is H1-Mod's own offline one: the real Depot lived on Activision's servers, which
  a private server can't reach. Each player's Parts, Depot Credits and unlocked items are in
  `players2\user\depot.json` in their own game folder. At the end of every round H1-Mod gives:
  - **Parts**: 10% of the score you made that round;
  - **Depot Credits**: 2 or 3, once you've accepted H1-Mod's notice in the Depot menu.
- **A server can't multiply Depot Credits.** The amounts above are in H1-Mod's menu scripts on
  each player's PC, not in anything the server sends. What a server can change is how often a
  round ends: shorter matches (a lower *Time limit* or *Score limit* under Settings) mean more
  round ends an hour, so more Depot Credits an hour. Parts follow your score, so they don't
  change with XP either.
- H1-Mod's own options menu also has *Unlock all items / classes / loot* switches, for anyone
  who would rather skip the grind.

## What you need

**You must own each game.** None of the clients include game files. Andromeda Hosting runs the server
from your existing install, so set the **game folder** when you create the server:

| Game | Game folder | Also needed |
|---|---|---|
| CoD4x | Your CoD4 folder (has `main` and `zone`) | Nothing. Andromeda Hosting downloads the CoD4x server and links the game files into the server folder (hard links: no extra disk space on the same drive) |
| IW4x | Your MW2 folder **with IW4x installed** (has `iw4x.exe`) | Install IW4x first with the AlterWare launcher |
| BO3 | The **Black Ops III Unranked Server** folder (Steam → Library → Tools; has `zone`) | Nothing. Andromeda Hosting downloads T7x (`t7x.exe`) into it. Players need T7x too |
| MWR | Your Modern Warfare Remastered folder with `h1-mod.exe` in it | Download `h1-mod.exe` from [H1-Mod's releases](https://github.com/auroramod/h1-mod/releases) first. Players need it too |
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
| IW4x, CoD4x | `mods/mp_bots/z_svr_bots.iwd` (+ `fs_game mods/mp_bots`). On CoD4x, the `scriptdata` folder (waypoints, bot names) also goes into `mods/mp_bots` | No. `z_svr_` iwds stay on the server |
| BO2 | `Plutonium\storage\t6\scripts` | No |
| MW3 | `Plutonium\storage\iw5\` (maps, scripts, scriptdata) | No |
| BO1 | `Plutonium\storage\t5\` (maps, scripts, mp) | No |

The Plutonium copies are shared by every server of that game. Servers with bots turned off set
`bots_manage_fill 0`, so they stay bot-free.

Bot difficulty uses each mod's own scale. Andromeda Hosting shows the right choices per game:
0–9 for CoD4x/IW4x/MW3, 0–3 for BO2, easy/normal/hard/fu for BO1.

Update the bots from the server's **Mods** tab.

**CoD4x waypoints:** the bots find their way with a waypoint file per map,
`mods\mp_bots\scriptdata\waypoints\<map>_wp.csv` in the server folder. CoD4x scripts open plain
files from the mod's folder and can't read inside an `.iwd`, so that's where the panel puts them. Without
its waypoint file a bot only walks straight at things: it gets stuck on walls and stops after
the first flag. Up to 2.5.0 the panel packed the waypoints into the `.iwd`, and 2.5.1 and 2.5.2
put them in the server folder's own `scriptdata`, which the server doesn't read either; a server
set up then is fixed the next time it starts (the console says the waypoints were moved). When a map loads,
the server console should say `Loaded <n> waypoints from file.` A custom map with no waypoint
file in Bot Warfare has none, and bots stay dumb on it.

## XP on CoD4x

Call of Duty 4 itself has no XP multiplier (`scr_xpscale` came with later games), and it only
counts XP at all when `sv_pure` is 1, which CoD4x switches off by itself when its own
`xbase_00.iwd` isn't in the server's `main` folder. So the panel adds a small script of its own
to the bot mod (`scripts/mp/andromeda_xp.gsc` in `z_svr_bots.iwd`):

- it turns XP on whatever `sv_pure` is;
- it reads the panel's multiplier (`andromeda_xpscale` in the config) and adds the extra XP on
  top of what the game gives. The XP pop-ups in game show the full amount (**+40** for a kill
  at 4x). As in the normal game, there are no pop-ups in hardcore.

The config also sets `ModStats 0`, so XP goes to each player's normal CoD4 rank and classes.
With CoD4x's default (`ModStats 1`) a server running a mod keeps a separate rank that starts at
level 1. To go back to that, add `set ModStats "1"` under *Extra config lines*.

The script lives in the bot mod, so XP needs Bot Warfare installed (**Mods** tab). The mod loads
even with bots turned off in Settings.

## What's verified and what isn't

These settings come straight from each project's own documentation or source code and are covered
by tests:
- Bot Warfare dvars (`bots_manage_fill`, `bots_manage_fill_kick`, `bots_skill`...) and install
  locations
- The CoD4x setup (game `.iwd` and `zone` files in the server folder, `+set dedicated 2`)
- The `rcon` / `getstatus` protocol

The bot options use the dvars each game's Bot Warfare README documents
([cod4x](https://github.com/ineedbots/cod4x_bot_warfare), [iw4x](https://github.com/ineedbots/iw4x_bot_warfare),
[t6](https://github.com/ineedbots/t6_bot_warfare), [t5](https://github.com/ineedbots/t5_bot_warfare),
[iw5](https://github.com/ineedbots/iw5_bot_warfare)).

The BO2 rotation format (`execgts <file> map …`), the gamesettings file layout and every
`gts` rule name come from Plutonium's T6 server configs
([T6ServerConfigs](https://github.com/xerxes-at/T6ServerConfigs)).

These follow the standard community server configs, but haven't been run against the real games
yet. If something doesn't take, use **Settings → Extra config lines** to override it, and tell me
what the console says:

- **CoD4x / MW2 / BO1 match rules**: the `scr_` dvars above are the series' standard names, but
  haven't been checked against each game's scripts. If one doesn't take, override it under
  *Extra config lines*.
- **Map pictures**: the wiki search picks the page whose title matches the map's name. A card can
  end up with a wrong or missing picture if the wiki names a page differently.
- **XP dvars**: `scr_xpscale` on every game but CoD4x; `scr_weaponxpscale` on MW3/BO1/BO2. Check
  a match's end-of-game XP.
- **CoD4x XP script and waypoints**: both follow the game's own rank scripts, the CoD4x server
  source and Bot Warfare's source, and the packing is tested, but neither has been run against a
  real CoD4x server from here. If the server stops loading maps after this update, the console
  will show a script error: tell me what it says.
- **Map rotation format**: `gametype dom map …` for CoD4x/IW4x/BO1;
  `dsr DOM_default map …` for MW3. MW3 needs the stock DSR files (`admin/DOM_default.dsr`), which
  come with Plutonium's IW5 server configs.
- **Where Plutonium reads the config**: Andromeda Hosting writes `hp_<id>.cfg` into `main/` (and `admin/`
  for MW3) inside the game folder.
- **Plutonium console**: Plutonium shows its console in its own window, so the panel's console tab
  follows `console_mp.log` and uses RCON for commands.
- **Black Ops III (T7x)**: the launch line, config dvars and bot dvars come from the T7x server
  configs, but none of it has been run against a real server yet. Unknowns: whether T7x answers
  the panel's RCON and `getstatus` (if it doesn't, the server stays on *Starting* and the console
  can't send commands), where T7x writes `console_mp.log` (the panel watches
  `identities\dedicatedpc`, `t7x`, `logs` and the folder itself), whether `scr_xpscale` changes
  BO3's XP, and whether `-dedicated` is right. One installer uses `-headless`; if the server
  doesn't start, tell me what its window says.
- **Modern Warfare Remastered (H1-Mod)**: the launch line, the `getInfo` query, `spawnBot`, the
  rotation format and the Depot rules are read from H1-Mod's source code, but none of it has
  been run against a real server from here. Unknowns: whether MWR's rank script takes
  `scr_xpscale` (check the XP after a match), whether bots stay through every map change (the
  panel adds them again if they don't), and the map names of the bonus and DLC maps.
- **Plutonium download**: the panel runs Plutonium's updater with `-install-dir … -update-only`,
  but only when you don't already have Plutonium installed.
