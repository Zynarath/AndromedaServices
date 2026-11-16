# Andromeda App

Version 2.0.1 · part of [Andromeda Services](../README.md)

Andromeda Services on an Android phone, as an app of its own: the dashboard and server pages of
**Andromeda Hosting** and the service cards of the **Andromeda Services** window, drawn by the app
itself in the same black-and-blue look. It talks to your panel directly (the same way the panel's
own pages do) and opens no browser.

## What is in it

**Servers** (the panel's dashboard)

- The PC's CPU, memory and free disk, and how many servers are online.
- Every server you may see, the online ones first, each with the game's picture, its state,
  players, CPU and memory, and a **Start** / **Stop** button. *Empty · stops in N min* shows on a
  running server nobody is on. Tap the address to copy it.
- Tap a server to open it:
  - **Start / Restart / Stop / Kill** at the top.
  - **Overview**: how to connect (address, join password, ports to forward), state, uptime, who is
    on, CPU and memory over the last minutes, and the three switches (start with the panel,
    restart after a crash, stop when empty).
  - **Console**: the live console with the panel's colours, the quick commands and a command box.
  - **Settings**: every game setting, one section at a time, with its explanation and a switch,
    slider or list of choices; the settings people change most first, **Show more** for the rest,
    WoW's one-tap choices and *All options*. Nothing is sent until **Save game settings**.
  - **Backups**: back up now, restore, delete.

**Services** (the Andromeda Services window; admins only)

- A card for Andromeda Hosting, the WotLK website and the Andromeda Services website: version,
  state, and **Start / Stop / Restart**. The Windows app's own version and branch are at the top.
- Andromeda Hosting can be restarted from here but not stopped: it is what the app talks to, so
  nothing could start it again from the phone.
- This needs **Andromeda Services 1.3.0 or newer open on the PC** and **Andromeda Hosting 2.4.0 or
  newer**. If either is missing, the tab says so.

**Account**: who is signed in, the panel's address and version, and **Sign out**.

What you see depends on your account, exactly as on the website: a friend only gets the servers,
tabs and buttons you allowed them.

Not in the app yet (use the panel's website): Mods and Mod configuration, Files, Schedules, Access,
Players / Accounts, creating or deleting servers, panel settings and users.

## Install it on your phone

1. Get **`Andromeda.apk`** from this folder onto the phone (download it from GitHub in the phone's
   browser, or copy it over). It needs Android 10 or newer.
2. If the first version of the app (1.0.0) is installed, **uninstall it first**: this one is signed
   with a different key, and Android refuses to install it over the old one.
3. Open the APK and allow installing from that browser or file manager, then **Install**.
4. Open **Andromeda**. The panel's address is already filled in (`https://panel.thefinalhour.us`);
   enter your username and password (and the 6-digit code if you use 2FA). You stay signed in.

To use the panel on your home network or VPN instead, type that address on the sign-in screen,
e.g. `http://192.168.1.20:8080`.

### If something in front of the panel stops the app

Your panel is behind Cloudflare, which can put a page in front of it. The app deals with both kinds
by showing that page once, inside the app, and carrying on by itself when it is passed:

- **"Checking your browser"**: Cloudflare's own check. It usually passes in a few seconds.
- **A sign-in page** (Cloudflare Access, or any rule that redirects visitors): the screen says
  *One more step to reach your panel* and shows the sign-in. Sign in there; the app then finishes
  the panel sign-in you typed and only asks again when Cloudflare's sign-in runs out.

Two things can still get in the way:

- Signing in **with Google** often refuses to work inside an app. Use Cloudflare's one-time code by
  email instead, or let the app past the page with the rule below.
- If the app says the page was passed but its requests are still stopped, Cloudflare is treating
  the app's requests differently from the page. In Cloudflare, add a rule (an Access *Bypass*
  policy, or a WAF *Skip* rule) for `panel.thefinalhour.us/api/*`. The panel still asks for your
  username and password, and its 2FA code, on every one of those requests.

## Build it yourself

`build.sh` builds the APK with the Android SDK's own tools: no Gradle, no libraries. It needs a JDK
(11 or newer) and the Android SDK with `platforms;android-34` and `build-tools;35.0.0`:

```bash
ANDROID_HOME=/path/to/android-sdk ./build.sh
```

The APK is signed with `andromeda-app.keystore` in this folder, which the first build creates.
**Keep that file.** Android only installs a new version over the app when it is signed with the
same key; with a different key, uninstall the app first (you then sign in again). The key is not
in the repository on purpose.

The code is in `src/us/thefinalhour/andromeda/`: `Api.java` (talking to the panel), `Ui.java` (the
look), and one file per screen. The default address is `DEFAULT_ADDRESS` in `Api.java`.
