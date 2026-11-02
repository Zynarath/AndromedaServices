# Call of Duty servers (CoD4x, IW4x, Plutonium BO2 / BO1 / MW3, T7x BO3)

Andromeda Hosting runs multiplayer servers for these community clients:

| Template | Game | Engine | Default port (UDP) |
|---|---|---|---|
| Call of Duty 4 (CoD4x) | CoD4: Modern Warfare | [CoD4x](https://cod4x.ovh) | 28960 |
| Modern Warfare 2 (IW4x) | MW2 | [IW4x](https://alterware.dev) | 28960 |
| Black Ops II (Plutonium T6) | BO2 | [Plutonium](https://plutonium.pw) | 4976 |
| Black Ops (Plutonium T5) | BO1 | Plutonium | 28960 |
| Modern Warfare 3 (Plutonium IW5) | MW3 | Plutonium | 27016 |
| Black Ops III (T7x) | BO3 | Activision's Unranked Server + [T7x](https://alterware.dev) | 27017 |

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

## What you need

**You must own each game.** None of the clients include game files. Andromeda Hosting runs the server
from your existing install, so set the **game folder** when you create the server:

| Game | Game folder | Also needed |
|---|---|---|
| CoD4x | Your CoD4 folder (has `main` and `zone`) | Nothing. Andromeda Hosting downloads the CoD4x server and links the game files into the server folder (hard links: no extra disk space on the same drive) |
| IW4x | Your MW2 folder **with IW4x installed** (has `iw4x.exe`) | Install IW4x first with the AlterWare launcher |
| BO3 | The **Black Ops III Unranked Server** folder (Steam → Library → Tools; has `zone`) | Nothing. Andromeda Hosting downloads T7x (`t7x.exe`) into it. Players need T7x too |
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
- **XP dvars**: `scr_xpscale` everywhere; `scr_weaponxpscale` on MW3/BO1/BO2. Check a match's
  end-of-game XP.
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
- **Plutonium download**: the panel runs Plutonium's updater with `-install-dir … -update-only`,
  but only when you don't already have Plutonium installed.
