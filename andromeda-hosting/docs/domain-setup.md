# Using your own domain (example.com)

When you're done:

| Address | Goes to | How |
|---|---|---|
| `https://panel.example.com` | The Andromeda Hosting panel | Cloudflare Tunnel: free HTTPS, no router ports opened, your home IP stays hidden |
| `play.example.com` | Your game servers | A DNS record Andromeda Hosting keeps updated with your home IP, plus router port forwarding |

The panel and the games need different setups. Cloudflare can proxy and tunnel websites for free,
but it can't carry game traffic (Minecraft TCP or ARK UDP) on the free plan. So the game hostname
has to point straight at your home IP.

Everything below is free. It assumes Andromeda Hosting is already installed and working at
`http://localhost:8080`.

---

## 1. Move the domain's DNS to Cloudflare (one time, ~15 minutes)

You keep your registrar (wherever you bought `example.com`). Only the DNS moves.

1. Make a free account at <https://dash.cloudflare.com/sign-up>.
2. **Add a domain** → `example.com` → pick the **Free** plan.
3. Cloudflare scans your existing DNS records. If the domain already has a website or **email**
   (MX records), check those records appear in the list before continuing, so nothing breaks.
4. Cloudflare shows two nameservers, like `xxx.ns.cloudflare.com`. At your registrar, replace the
   domain's nameservers with those two.
5. Wait until Cloudflare emails that the domain is **Active**. This usually takes minutes, but
   can take up to 24 hours.

## 2. Panel: `panel.example.com` through a Cloudflare Tunnel

The tunnel is a small program (`cloudflared`) running on your PC. It makes an outgoing connection
to Cloudflare, so you don't open any port for the panel.

1. In the Cloudflare dashboard open **Zero Trust**. The first visit asks for a team name; the free
   plan is fine. Go to **Networks → Tunnels → Create a tunnel**.
2. Choose **Cloudflared**, name it `andromeda-hosting`, and choose **Windows** as the environment.
3. Cloudflare shows an install command containing a long token (`eyJ...`). Copy the token, then in
   an **administrator** PowerShell in the Andromeda Hosting folder run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\setup-cloudflare-tunnel.ps1 -Token eyJ...your-token...
   ```
   This installs `cloudflared` as a Windows service that starts with your PC. You can also just
   paste the command Cloudflare shows.
4. Back in the dashboard, add a **public hostname** (also called a published application route):
   - Subdomain: `panel` · Domain: `example.com`
   - Service type: `HTTP` · URL: `localhost:8080`
5. Save and open **https://panel.example.com**.

Nothing needs to change in Andromeda Hosting. It already trusts the forwarding headers from a tunnel
running on the same PC, so secure cookies, sign-in rate limiting and the live console all work.
For safety, the **first admin account can still only be created at http://localhost:8080 on the
PC itself**. Requests through the tunnel are treated as remote.

### Lock the panel to just you and your friend

The panel can run commands on your PC, so only you two should be able to reach it. Use both:

- **2FA**: every account → *Your account* → *Set up 2FA*.
- **Cloudflare Access** (free for up to 50 people): Zero Trust → **Access → Applications → Add →
  Self-hosted** → domain `panel.example.com` → add a policy with action *Allow* and
  *Include → Emails* = **your email and your friend's email only**. Everyone else is stopped by
  Cloudflare before they ever see the Andromeda Hosting sign-in page. You two get a one-time code by
  email (session length is configurable, e.g. 1 month). The live console keeps working behind
  Access.
- In Andromeda Hosting, give your friend their own account under **Users & access**: role *Admin* if
  they should manage everything, or *User* with per-server permissions.
- Optional: if you only ever use the panel through the domain, set `"host": "127.0.0.1"` in
  `config.json`. The panel then only answers the tunnel and this PC, not other devices on your
  network. Skip this if you also use Tailscale or LAN access.

## 3. Games: `play.example.com`

Your friend group joins the games directly (not through the panel), so keep the servers private
the way each game supports:

- **ARK (SE and SA)**: a join password. Andromeda Hosting fills in a random one like `stego-7095` when you
  create the server. See or change it under the server's Overview or Settings → *Join password*.
- **Minecraft**: a whitelist (Minecraft has no join passwords). New servers are *friends only* by
  default. Add your group's usernames in the server's **Players** tab.

### 3a. Keep the hostname pointed at your home IP

Home IPs change, so let Andromeda Hosting update the DNS record:

1. Cloudflare dashboard → profile icon → **My Profile → API Tokens → Create Token** → use the
   **Edit zone DNS** template → *Zone Resources*: Include → Specific zone → `example.com` →
   create, then copy the token.
2. Andromeda Hosting → **Panel settings → Domain & dynamic DNS**:
   - Turn on **Keep DNS records updated**
   - Hostnames: `play.example.com`
   - Paste the token → **Save** → **Update now**. It should say the record was *created*.
   - Press **Use first hostname as public address**. Every server's Overview now shows
     `play.example.com` as the address to share.

Andromeda Hosting checks every 5 minutes and creates the record as **DNS only** (grey cloud). Leave it
grey: if you turn the orange proxy on, games can't connect, and Andromeda Hosting switches it back off.

### 3b. Forward the game ports on your router

Each server's **Overview** lists its ports. Defaults:

| Game | Port | Protocol |
|---|---|---|
| Minecraft (first server) | 25565 | TCP |
| ARK: Survival Ascended | 7777 | UDP |

In your router, forward these to your PC's LAN IP (shown in Panel settings → *This PC*). Give the PC
a fixed/reserved LAN IP in the router so the forward keeps working. Run
`scripts\open-firewall.ps1` as Administrator if you haven't already.

**Don't forward 8080 (the panel) or the ARK RCON port (27020).** The tunnel already covers the
panel.

Check: if the public IP in *Domain & dynamic DNS* differs from the WAN IP shown in your router, your
ISP uses CGNAT and port forwarding can't work. Use [playit.gg](https://playit.gg) for the game
ports, or Tailscale for friends only.

### 3c. Joining

- **Minecraft**: add a server with address `play.example.com`.
- **More Minecraft servers** on other ports (25566, 25567...) can each get their own name with an
  SRV record. In Cloudflare DNS, add a record: Type `SRV`, Name `_minecraft._tcp.mc2`, Priority `0`,
  Weight `5`, Port `25566`, Target `play.example.com`. Players then join `mc2.example.com`
  with no port.
- **ARK: Survival Ascended**: find the server by its name in the in-game list (Unofficial), or open
  the console with `~` and type `open play.example.com:7777`. If the game won't resolve the
  name, use the IP shown under *Domain & dynamic DNS*.
- **You, on the hosting PC**: use `localhost` / `127.0.0.1`. Your own domain may not work from
  inside your network, because many routers don't support "NAT loopback".

## Troubleshooting

| Symptom | Fix |
|---|---|
| `panel.example.com` shows a Cloudflare 502/1033 error | The tunnel is running but Andromeda Hosting isn't. Start `start.bat` (or `scripts\install-autostart.ps1`) and check the tunnel shows *Healthy* |
| Panel loads but the console never updates | Cloudflare dashboard → your domain → **Network** → make sure **WebSockets** is on (it's on by default) |
| "Create the first admin from the host PC" | Expected. Open `http://localhost:8080` on the gaming PC once to create the admin |
| DNS status says "No Cloudflare zone found" | The token isn't scoped to `example.com`, or the domain isn't active on Cloudflare yet |
| DNS says "An A, AAAA, or CNAME record with that host already exists" | Delete the old record for that name in Cloudflare (or pick another name). Don't put `panel.example.com` in the DDNS list; the tunnel owns it |
| Friends can't join but the hostname resolves to your IP | Port forward missing or wrong protocol (ARK needs **UDP**), Windows Firewall, or CGNAT |
