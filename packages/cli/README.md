# ModWrench

One MCP server for mod platforms and local modding diagnostics. Built for people who mod games.

Search Thunderstore, read your actual load order out of MO2 / r2modman / Vortex, parse a crash log, and get told which mod is the likely culprit — from inside your AI client.

## Install

**Claude Code**

```bash
claude mcp add --scope user modwrench -- npx -y @modwrench/cli
```

**Claude Desktop, Cursor, Cline, Roo Code, Continue** — add to your client's MCP config:

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

Restart your client. Thunderstore and the local diagnostic tools work immediately — no account, no key.

## Connecting Nexus and mod.io

These two need a credential. A personal API key is the fastest route for both:

```bash
npx -y @modwrench/cli auth key nexus
npx -y @modwrench/cli auth key modio
```

Each command prompts for the key, verifies it against the platform, and stores it in your OS credential manager — Windows Credential Manager, macOS Keychain, or Linux libsecret. Get the keys from [Nexus API access](https://www.nexusmods.com/users/myaccount?tab=api+access) and [mod.io/me/access](https://mod.io/me/access).

Check status with `auth status nexus`, remove a key with `auth logout nexus`.

> **About Nexus keys.** Nexus’s [API Acceptable Use Policy](https://help.nexusmods.com/article/114-api-acceptable-use-policy) tolerates personal API keys for testing and personal use, but asks public applications to register for their own client ID. ModWrench is not a registered Nexus application yet, so connecting Nexus means using your personal key with a third-party tool — and Nexus may limit personal keys used that way. That would affect your key, not ModWrench’s. Skip Nexus if you would rather not; nothing else depends on it. `auth login nexus` (OAuth) is implemented and becomes the default once Nexus issues a client ID.

## Credential handling

ModWrench reads credentials **only** from your OS credential manager. Never from `.env`, never from a file on disk, and it never writes one anywhere else. Keys are held no longer than the request that uses them.

## Requirements

Node.js 20 or newer.

Full documentation, tool reference, and source: <https://github.com/171county/modwrench>

## License

MIT
