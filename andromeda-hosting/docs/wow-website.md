# The WotLK website

SPP Classics comes with a website: the old World of Warcraft site design with news, an armory,
realm status and sign-up. It runs on an old Apache and PHP. Andromeda Hosting has a rebuilt
version of it in Node.js, with the same look. Your friends can check who's online, look at
characters and gear, and read your news. The original's security problems are fixed.

It runs as its own program next to the panel. Start it with **Andromeda Services** (see the
README) or with `start-wow-site.bat`.

## Set it up

1. Add your WoW server to the panel first ([wow.md](wow.md)).
2. **The original graphics:** the site uses the pictures and stylesheets from SPP's own
   `Server\website` folder. If that folder is missing, open SPP's `Launcher.bat` once and let it
   download the website (about 170 MB). Then close the launcher. Don't turn the website on in
   SPP's launcher: that starts SPP's old Apache on port 80. Without the folder, the site still
   works, but looks plain.
3. In the panel, open **WoW server → Settings → Website** (admins only):
   - **WotLK website for this realm**: on by default. One website per panel; it shows the first
     WoW server that has it on.
   - **Website port**: 8091 by default.
   - **Who can create game accounts on the website**:
     - **Nobody** (default): only accounts you make in the Accounts tab.
     - **Invite code**: GM accounts create single-use codes on the site's Admin panel.
     - **Anyone**: open sign-up. Only use this if the site isn't reachable from the internet.
   - **Discord invite link** (optional): shown in the Community menu.
4. Open **Andromeda Services** and start **WotLK website**, then open
   `http://localhost:8091`. Settings you change in the panel apply within a few seconds; you
   don't need to restart anything.

The world server doesn't have to be running, but MySQL does. The panel starts MySQL with the WoW
server; while it's off, the site shows "The realm is offline".

**Friends outside your network:** forward TCP 8091 on your router, or keep the site on
Tailscale. The address is the same as the panel's, with `:8091` at the end. The WoW server's
Overview in the panel shows the link.

## Pages

| Menu | Page |
|---|---|
| News | Front page news (SPP's existing news shows too), news archive |
| Account | Log in, new account (if sign-up is on), my account (your characters, change password), Admin panel (GM level 3+) |
| Game guide | How to play: the realmlist line, with your realm's real address |
| Workshop | Realm status, honor ranking, players online, characters, statistics (factions, races, classes, levels), auction house, armory |
| Community | Your Discord link |
| Support | In-game commands (GM commands only for GM accounts), bug tracker (SPP's GitHub) |

Most lists can show **everyone**, **players only** or **bots only**, since thousands of
Mangosbot bots also live on the realm.

**Armory:** search characters and guilds. A character page shows equipped gear with icons,
quality colours and item level, talent points per tree, professions, reputation, guild, and
honor. Guild pages list the members. Icons, talent tree names and faction names come from SPP's
armory database (`wotlkarmory`). Without it, gear shows by name only, and talents and reputation
are left out.

**Admin panel** (`/admin`, accounts with GM level 3 or higher): post and delete news, and create
or revoke invite codes. To make your own account a GM, use the panel's **Accounts** tab (role
**Admin**).

Logging in uses the **game account**: the same name and password as in WoW. Changing your
password on the site changes it in the game too.

## What was left out

The old site has a lot more, much of it switched off in SPP's config. These parts weren't
rebuilt:
- forums, private messages, chat, media galleries, vote and donate pages, TeamSpeak
- player map, talent calculator, armory achievements, arena teams and item tooltips
- character tools (rename, re-customize, copy)
- password recovery by secret question
- languages other than English

**The user list was removed on purpose.** It showed every account's login name, which is half
of what someone needs to log in.

Old links keep working: `index.php?n=server&sub=playersonline`,
`armory/index.php?character=Name` and similar addresses redirect to the matching new pages.

## What's fixed compared with SPP's website

| SPP's website | Andromeda's |
|---|---|
| Apache 2.4.25 and PHP 7.2, both without security updates for years | Node.js, like the panel. No PHP runs, ever |
| Sign-up open to anyone who can reach the site | Off by default; single-use invite codes if you want sign-up |
| Login cookie holds serialized PHP data that the server unserializes | Random session token kept on the server; HttpOnly, SameSite cookie |
| No CSRF protection on forms | Every form carries a per-session token |
| No limit on password guesses | 8 failures per IP or per account in 15 minutes, then a wait |
| SQL built by pasting values into queries (armory, auction house sorting...) | Every value is a query parameter |
| News and names printed as raw HTML | Everything is escaped; old news HTML is cleaned to simple formatting |
| Loads a script from a third-party site (classicdb.ch) | No outside scripts; a Content-Security-Policy blocks them |
| Serves its whole folder, including `config/` and the installer | Serves only pictures and stylesheets from SPP's folder |
| Random-bot accounts can log in to the site | Bot accounts and banned accounts can't |

The database itself stays as safe as before: the panel starts SPP's MySQL on 127.0.0.1 only,
because SPP's root password (`123456`) is public. Never forward port 3310.

## How it works

- `src/wowsite/`: the website. It reads the realm's database settings from `mangosd.conf`.
  It uses the panel's settings in `data/wowsite.json`, which the panel writes and the site
  watches. It logs to `data/logs/wowsite.log`.
- Accounts: SRP6 salt and verifier, exactly like cMaNGOS and SPP's PHP site, so accounts made in
  the game, the panel or either website all work everywhere. New accounts are WotLK accounts
  (expansion 2).
- News is stored where SPP kept it (`f_topics` / `f_posts`, news forum 1, in the login database).
  Invite codes are in a new table, `andromeda_site_invites`, in the same database.
