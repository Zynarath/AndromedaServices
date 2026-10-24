# Discord notifications

Andromeda Hosting posts to your Discord with its own bot:

- **#server-updates**: the big news for everyone. A server came online (with the address to join),
  went offline, crashed, finished an install/update, a new modpack version is out, a server was
  created or deleted.
- **One channel per game server**, named after the server, e.g. `#ark-se-server-1`,
  `#ark-sa-server-1` or `#all-the-mods-10`. Each gets that server's own news plus player
  joins/leaves and backups. Channels are created automatically, renamed when you rename the
  server, and kept (for history) if you delete it.

## Setup (about 3 minutes)

1. **Create the bot.** Open the [Discord Developer Portal](https://discord.com/developers/applications)
   → **New Application** → name it `Andromeda Hosting` (or anything) → **Bot** tab → **Reset Token** →
   copy the token. You don't need any "Privileged Gateway Intents".
2. **Give Andromeda Hosting the token.** Panel settings → **Discord** → paste it → **Save**.
3. **Invite the bot.** Press **Invite Andromeda Hosting** in the same section, pick your Discord server,
   and keep all requested permissions (View Channels, Send Messages, Embed Links, Manage Channels).
   You need *Manage Server* rights on the Discord server, or have the owner click the link.
4. Press **Refresh**, then pick the **Server Updates** channel (it's pre-selected if found) and
   optionally the category for the per-server channels. By default they go in the same category
   as Server Updates.
5. Turn on **Send notifications** → **Save** → **Send test message**.

The per-server channels are created right away for existing servers, and automatically for new ones.

### Permissions

If the bot can't create channels, give its role **Manage Channels**: Discord → Server Settings →
Roles → *Andromeda Hosting* → Manage Channels. If Server Updates is a private or read-only channel, add
the bot's role to that channel with **View Channel** and **Send Messages**.

### Options

| Setting | Default | |
|---|---|---|
| Create a channel for each game server | on | Off = everything goes to Server Updates only |
| Player joins / leaves | on | Posted in the server's own channel |
| Successful backups | on | Failed backups always go to Server Updates |
| Show join passwords (ARK / CoD) | off | Adds the password as a spoiler (`\|\|password\|\|`) to "online" messages. Only turn on if the Discord server is friends-only |

Keep the bot token secret. If it leaks, press **Reset Token** in the Developer Portal and paste
the new one into Andromeda Hosting.
