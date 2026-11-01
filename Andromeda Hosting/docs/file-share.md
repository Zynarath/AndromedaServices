# File share

Share one folder on your PC with your friends, e.g. game files, mod packs or addons.

- **Downloading:** only from the IP addresses you allow, plus this PC.
- **Uploading, renaming, deleting:** only from **this PC**. You can optionally allow devices on
  your home network too.
- Friends don't need a panel account. They open a simple page that lists the files.

## Setup

1. Panel → **File share** (left sidebar, admins only).
2. Turn on **File sharing**, set **Folder to share** (e.g. `D:\Share`), and save. Pick a folder,
   not a whole drive; the panel refuses drive roots.
3. Optional: set **Own port for the file share**, e.g. `8090`. That port serves *only* the file
   share, never the control panel. See below for how friends reach it.
4. Upload files: on this PC click **Open file share** and drag files or whole folders onto the
   page. You can also copy files straight into the folder in Explorer; the page always shows
   what's there.

## Letting a friend in

1. Send your friend the share link (shown on the File share page).
2. They open it and see "Your connection isn't on the allowed list yet", with their IP address
   and a Copy button.
3. Their visit shows up under **Recently blocked** on your File share page. Click **Allow** and
   give it a name. You can also type an IP, or a range like `203.0.113.0/24`, under **Allowed IPs**.
4. They refresh the page and can download.

Home IP addresses change from time to time. If a friend suddenly can't get in, check
**Recently blocked** and allow their new address.

## How friends reach it

Pick one:

| Option | Link | Setup |
|---|---|---|
| **Port forward the share port** (best for big files) | `http://play.example.com:8090/share` | Forward **TCP 8090** on your router to this PC, and allow it in Windows Firewall |
| **Cloudflare Tunnel hostname** | `https://files.example.com/share` | In your tunnel, add a public hostname `files` → `HTTP` → `localhost:8090`. HTTPS, no port forward. Cloudflare's terms discourage serving lots of very large files through it, so for multi-GB downloads the port forward is the safer choice |
| **Panel address** | `https://panel.example.com/share` | Works out of the box, but if the panel is behind Cloudflare Access, friends must pass Access first |

Whichever you use, the IP check uses the friend's real address. Through a tunnel the panel reads
the address Cloudflare reports; through a port forward it reads the connection itself.
Forwarding headers sent straight from the internet are ignored, so nobody can fake an allowed IP.

## Details

- **Big files:** downloads can be paused and resumed (HTTP range requests). Folders download as
  one `.zip`. It's uncompressed, so it starts immediately and stays fast.
- **Activity:** the File share page lists recent downloads (who, what, size) and recently blocked
  visitors.
- **Safety:** uploads and changes need a request header that other websites can't add, so a page
  you visit can't tamper with your share in the background. Paths can't escape the shared folder.
- **Your responsibility:** only share files you're allowed to share.
