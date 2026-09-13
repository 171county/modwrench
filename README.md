# ModWrench

An MCP server that connects your AI assistant to mod platforms and to your own modding setup, so you can ask questions in your AI client instead of clicking through web UIs.

It runs on your machine. No account, no service, no server anyone operates.

## What it does

Four attachments. Install one, some, or all — `@modwrench/cli` composes whichever you've configured into a single MCP entry.

**Nexus Mods** — search mods, read changelogs and file lists, check versions, browse trending and recently updated, preview what's inside an archive before downloading, reverse-lookup a file by MD5, and endorse a mod when you ask it to. *(15 tools)*

**mod.io** — search and browse mods across the games mod.io hosts; pull mod details, files, tags, stats, dependencies and comments. *(17 tools)*

**Thunderstore** — browse communities, search mods, read full version history, and resolve dependency trees. No credential needed; the read API is public. *(9 tools)*

**Workbench** — local, on your machine. Find your installed games, mod managers and loaders; read your load order out of MO2, r2modman or Vortex; parse a crash log from Crash Logger SSE, Buffout 4, NetScriptFramework or BepInEx; look a mod up across platforms; check known conflicts against LOOT's masterlist. *(6 tools)*

Plus two meta tools for activating a platform mid-session and opening a visual panel.

**49 tools. 48 of them read. One writes** — see [The one thing it writes](#the-one-thing-it-writes).

## How to use it

Requires Node.js 20 or newer.

**Claude Code**

```bash
claude mcp add --scope user modwrench -- npx -y @modwrench/cli
```

**Claude Desktop, Cursor, Cline, Continue, Roo Code** — add to your client's MCP config:

```json
{
  "mcpServers": {
    "modwrench": {
      "command": "npx",
      "args": ["-y", "@modwrench/cli"]
    }
  }
}
```

Restart your client. Thunderstore and the local Workbench tools work immediately — no account, no key.

### Connecting Nexus and mod.io

These two need a credential:

```bash
npx -y @modwrench/cli auth key nexus
npx -y @modwrench/cli auth key modio
```

Each command prompts for the key, verifies it against the platform, and stores it in your OS credential manager. Get them from [Nexus API access](https://www.nexusmods.com/users/myaccount?tab=api+access) and [mod.io/me/access](https://mod.io/me/access).

`auth status nexus` to check one, `auth logout nexus` to remove it.

> **Before you connect Nexus.** Nexus's [API Acceptable Use Policy](https://help.nexusmods.com/article/114-api-acceptable-use-policy) tolerates personal API keys for personal use, but asks public applications to register for their own client ID. ModWrench is not a registered Nexus application yet, so connecting Nexus means using your personal key with a third-party tool — and Nexus may choose to limit personal keys used that way. That would affect your key, not ModWrench. Skip Nexus if you'd rather not; nothing else depends on it.

## Your credentials

Your key lives in your operating system's credential manager — Windows Credential Manager, macOS Keychain, or libsecret on Linux. ModWrench reads it from there and nowhere else. Not from a `.env`, not from a config file, not from an environment variable. Those paths do not exist in the code. If the credential manager is empty or unreachable, ModWrench stops and tells you why instead of looking elsewhere.

The key is read once when the server starts and held in memory until the process exits. ModWrench never writes it anywhere.

You can revoke or rotate it on Nexus or mod.io whenever you want. There is nothing to clean up on this end.

## What it connects to

Everything ModWrench talks to, and nothing else:

| Host | When |
|---|---|
| `api.nexusmods.com` | Nexus mod data — only if you connected Nexus |
| `users.nexusmods.com` | only while `auth login nexus` completes an OAuth sign-in |
| `api.mod.io` | mod.io mod data — only if you connected mod.io |
| `thunderstore.io` | Thunderstore's public read API |
| `raw.githubusercontent.com` | LOOT's public conflict masterlist |
| `127.0.0.1` | a local listener that catches the OAuth redirect, during `auth login` only |

Other domains show up in ModWrench's *output* — `www.nexusmods.com` and `mod.io` links back to mod pages — but it does not fetch them. Your browser does, if you click one.

No telemetry. No analytics. No accounts. Nothing is sent to us, because there is no us to send it to — no server is run for this project.

## The one thing it writes

`nexus_endorse_mod` endorses a mod on Nexus, as you, on your account. It is the only tool in ModWrench that changes anything on any platform.

It cannot fire by accident. Ask for an endorsement and the first thing back is a preview — which mod, which version, and a note that the endorsement is public and shows your username. **No network call happens at all unless you confirm.** Only a second, explicitly confirmed call sends it. There's a test asserting the unconfirmed path touches the network zero times.

Everything else reads.

Locally, the Workbench tools open files read-only. There is no filesystem write call anywhere in the package.

## For mod authors

Every output that mentions a mod carries the author's name, the platform it came from, and a link to the mod page.

Where a platform reports an author's permissions, ModWrench passes them through so you see them. It does not enforce them and cannot — this is a metadata bridge, not a gate. What it will not do is help you strip a credit.

The endorse tool exists for the same reason: it's the one way a bridge like this gives something back to the person who made the thing, rather than only taking a page visit away.

## Status

Early — v0.1.1. It will have bugs, and it is not perfect.

The source is open so you can check anything on this page rather than taking it on faith. [TRUST.md](TRUST.md) lists each claim with the command to verify it yourself. If you find one that isn't true, that's a bug — [file it](https://github.com/171county/modwrench/issues).

## License

MIT
