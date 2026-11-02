# Andromeda Services Website

Version 1.0.1 · part of [Andromeda Services](../README.md)

The public website for Andromeda game server hosting. For now it runs on your own PC only, until
the hosting hardware is ready. It has:

- **The pitch**: what Andromeda is, with an illustration of the control panel
- **Supported games**: ARK (Ascended and Evolved), Minecraft, Rust, Valheim, Satisfactory, 7 Days
  to Die, Call of Duty and WoW: Wrath of the Lich King, each with what the panel does for it
- **The control panel**: console, mods, files, backups, schedules, accounts, Discord, privacy
- **How it works** and an **FAQ**
- **A launch waitlist**: email, name, group size, games and a note. Sign-ups are saved on this
  PC, and you see them at `/admin`

It uses the same look as the panel: black, thin lines, the Star Gate logo and blue accents. It
works on phones too.

## Run it

**From Andromeda Services** (easiest): the *Andromeda Services Website* card has Start, Stop,
Restart and Open buttons, its log, and a **Waitlist** button. Turn on *Start when Andromeda
Services opens* to have it run whenever the app does. From the app it always uses port 8092 and
only this PC can open it.

**By hand**: you need Node.js 20 or newer. The site has no packages, so there's nothing to install.

```powershell
cd "C:\Andromeda Services\Andromeda Services Website"
npm start
```

Then open <http://localhost:8092>. Press Ctrl+C to stop it.

- **Another port**: `$env:PORT=9000; npm start` (PowerShell) or `set PORT=9000 && npm start` (cmd).
- **Show it to other PCs on your network**: start it with `HOST=0.0.0.0` the same way, then open
  `http://<this PC's IP>:8092` on the other PC. By default only this PC can open it.

## The waitlist

- Open <http://localhost:8092/admin> on this PC to see everyone who signed up, which games they
  want and their group sizes, and to **download it as a CSV** for Excel or an email tool.
- The admin page only opens on this PC. From anywhere else, including through a Cloudflare
  Tunnel or other proxy on this PC, it's a 404.
- Sign-ups are saved in `data\waitlist.json`. It isn't part of the repository, so updates never
  touch it. Signing up again with the same email updates that person's answers.
- Spam protection: a hidden field that bots fill in, at most 5 sign-ups per address every
  10 minutes, and size limits on every field.

## Editing the site

All the text is in `public/index.html`, the look in `public/css/site.css`, and the animations and
form in `public/js/site.js`. Reload the browser to see changes; no restart needed.

If you add or remove a game on the waitlist form, add or remove it in `GAMES` in `src/server.js`
as well (`npm test` checks the two match).

## Before it goes public

When the hardware is ready and the site goes online:

1. Put it behind HTTPS (for example the Cloudflare Tunnel from
   [domain-setup.md](../Andromeda%20Hosting/docs/domain-setup.md)) and start it with `HOST=0.0.0.0`
   only if the tunnel isn't on this PC.
2. Add a privacy notice for the waitlist (you're collecting email addresses), and pricing once
   it's decided. The FAQ says pricing comes at launch.
3. Check the game list. Hosting some of them commercially, especially the WoW private server and the
   community Call of Duty clients, may conflict with those games' terms. Take those off the page
   if you won't offer them.

## Tests

```powershell
npm test
```
