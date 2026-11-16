# Andromeda App

Version 1.0.0 · part of [Andromeda Services](../README.md)

Andromeda Services on an Android phone: **Andromeda Hosting** (the game server panel), the **WotLK
website** and the **Andromeda Services website** in one app, one tab each.

| Tab | Opens |
|---|---|
| Hosting | <https://panel.thefinalhour.us/> |
| WoW | <https://wow.thefinalhour.us/> |
| Services | <https://thefinalhour.us/> |

- Each tab is that site, full screen, and stays signed in. Tabs keep where you were when you switch.
- Tap the tab you are on to go back to its first page. Hold a tab to reload it. The phone's Back
  button goes back inside the open tab.
- **Upload** buttons on the sites open the phone's file picker; downloads (backups, files) go to the
  phone's *Downloads* folder.
- Links to other sites (Discord, CurseForge, uMod…) open in the phone's browser.
- If a site can't be reached (no signal, or the PC at home is off), the tab says so with *Try again*.

The app shows the sites as they are served from your PC, so it does whatever they can do: start and
stop game servers, change settings, read the console. It can't start Andromeda Hosting itself or
the websites when they are stopped on the PC; that is still done in Andromeda Services on the PC.

## Install it on your phone

1. Get **`Andromeda.apk`** from this folder onto the phone (download it from GitHub in the phone's
   browser, or copy it over).
2. Open it. Android asks once to allow installing apps from that browser or file manager: allow it,
   then **Install**. It needs Android 10 or newer.
3. Open **Andromeda** and sign in to the panel as usual.

Play Protect may ask whether to scan or send an app it hasn't seen before; either answer works.

## Build it yourself

`build.sh` builds the APK with the Android SDK's own tools: no Gradle, no libraries. It needs a JDK
(11 or newer) and the Android SDK with `platforms;android-34` and `build-tools;34.0.0`:

```bash
ANDROID_HOME=/path/to/android-sdk ./build.sh
```

The APK is signed with `andromeda-app.keystore` in this folder, which the first build creates.
**Keep that file.** Android only installs a new version over the app when it is signed with the
same key; with a different key, uninstall the app first (you then sign in again). The key is not
in the repository on purpose.

To use other addresses, change `SITES` (and `HOME_DOMAIN`) at the top of
`src/us/thefinalhour/andromeda/MainActivity.java` and build again.
