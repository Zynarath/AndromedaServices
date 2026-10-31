# The WotLK website

SPP Classics comes with a website: the old World of Warcraft site design with news, an armory,
realm status and sign-up. It runs on an old Apache and PHP. This is a rebuilt version in Node.js
with the same look. Your friends can check who's online, look at characters and gear, and read
your news. The original's security problems are fixed.

It's a **standalone site**: separate from the Andromeda Hosting panel, with its own settings.
Start, stop and set it up in **Andromeda Services** (see the README), or run
`start-wow-site.bat`.

## Set it up

1. **Andromeda Services → WotLK website → Settings**:
   - **SPP folder**: your `SPP_Classics_V2` folder (or any cMaNGOS WotLK folder). The site reads
     the realm's database settings from its `mangosd.conf`.
   - **Site name**: shown in the browser tab and on the page.
   - **Port**: 8091 by default.
   - **Who can create game accounts on the site**:
     - **Nobody** (default): only accounts made in the game or in the panel's Accounts tab.
     - **Invite code**: GM accounts create single-use codes on the site's Admin panel.
     - **Anyone**: open sign-up. Don't use this on a public site.
   - **Discord invite link** (optional): shown in the Community menu.

   **Save**. The running site applies the settings within a few seconds, with no restart. They're
   stored in `data\wowsite.json`, which you can also edit by hand.
2. **Start** the WotLK website in Andromeda Services and open `http://localhost:8091`.
3. **The original graphics** come from SPP's own website folder (`Server\website`, or any website
   folder inside the SPP install). SPP only downloads that folder if you answered **Y** in its
   launcher. If it isn't there, the site downloads the same pictures and stylesheets once from
   SPP's website repository (about 100 MB, into `data\wowsite-assets`). It shows the plain look
   until that finishes; `data\logs\wowsite.log` shows the progress. Don't turn the website on in
   SPP's own launcher: that starts SPP's old Apache on port 80.

The world server doesn't have to be running, but the realm's MySQL does. Andromeda Hosting starts
MySQL with the WoW server; while it's off, the site shows "The realm is offline".

## Your own address: wow.thefinalhour.us

The site is an ordinary website, so it can go through the same free **Cloudflare Tunnel** as the
panel ([domain-setup.md](domain-setup.md)). You get `https://wow.thefinalhour.us` with HTTPS, no
router port opened for the site, and your home IP stays hidden.

1. **`thefinalhour.us` on Cloudflare.** The domain's DNS must be managed by Cloudflare
   ([domain-setup.md](domain-setup.md), step 1). If you already use Cloudflare for the panel, skip
   this.
2. **A tunnel on this PC.** If you set one up for the panel, skip this. Otherwise:
   Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → *Cloudflared* →
   name it `andromeda-hosting` → copy the token (`eyJ...`), then in an **administrator** PowerShell
   in the `andromeda-hosting` folder:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\setup-cloudflare-tunnel.ps1 -Token eyJ...your-token...
   ```
3. **The hostname.** Open the tunnel → **Public hostnames** (also called *published application
   routes*) → **Add**:
   - Subdomain: `wow` · Domain: `thefinalhour.us`
   - Service type: `HTTP` · URL: `localhost:8091` (the site's port)

   Save. Cloudflare creates the DNS record itself. If an older `A` record for `wow` exists in
   **DNS**, delete it.
4. **HTTPS only.** Cloudflare → `thefinalhour.us` → **SSL/TLS → Edge Certificates** → turn on
   **Always Use HTTPS**.
5. Open **https://wow.thefinalhour.us**. Nothing changes in the site: it already trusts the tunnel
   running on the same PC, so visitors' real IPs (used for login limits) and secure cookies work.
6. **Keep it locked down:**
   - Use **Nobody** or **Invite code** sign-up (Settings). Anyone on the internet can open the
     site now.
   - Don't forward port 8091 on your router; the tunnel doesn't need it. To make sure only the
     tunnel and this PC can reach the site, add `"host": "127.0.0.1"` to `data\wowsite.json`.
   - Never forward the database port (3310).

**The game itself doesn't go through the tunnel.** Cloudflare's free tunnel only carries websites,
not WoW's login and world connections. Players connect to the realm at a separate name that points
at your home IP, such as `play.thefinalhour.us`: [domain-setup.md](domain-setup.md) step 3 and
[wow.md](wow.md) (forward TCP 3724 and 8085). The site's **How to play** page shows the realmlist
line with that address, taken from the realm's own settings.

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
or revoke invite codes. To make your own account a GM, use the Andromeda Hosting panel's
**Accounts** tab (role **Admin**), or `.account set gmlevel <name> 3` in the world server console.

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

- `src/wowsite/`: the website, a separate program from the panel. It reads the realm's database
  settings from `mangosd.conf` and its own settings from `data/wowsite.json` (written by Andromeda
  Services; the site watches the file). It logs to `data/logs/wowsite.log`.
- Accounts: SRP6 salt and verifier, exactly like cMaNGOS and SPP's PHP site, so accounts made in
  the game, the panel or either website all work everywhere. New accounts are WotLK accounts
  (expansion 2).
- News is stored where SPP kept it (`f_topics` / `f_posts`, news forum 1, in the login database).
  Invite codes are in a new table, `andromeda_site_invites`, in the same database.
