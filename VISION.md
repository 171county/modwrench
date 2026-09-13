# ModWrench

A workshop of focused MCP servers that bring modding platforms, asset libraries, and game-data sources into AI clients (Claude Desktop, Cursor, and any other MCP-compatible host).

The first product line — **ModWrench** — wraps Nexus Mods and mod.io so a modder can search, inspect, and reason about mods in conversation with an AI instead of clicking through web UIs.

## Guiding principles

### 1. The wrench holds tools, not keys.

**ModWrench servers never persist secrets to disk, and never read them from anywhere but the OS credential manager.** There is exactly one credential source:

- The OS-native credential manager (Windows Credential Manager, macOS Keychain, libsecret on Linux) — holding either an API key the user placed there themselves, or a token written by `auth login` after an OAuth flow.

There is no second path. Not environment variables passed by the MCP client, not `.env`, not a config file, not a command-line flag. If the credential manager is empty or unreachable, the server fails with a hint pointing at `auth login` rather than looking elsewhere. The whole credential path is `packages/core/src/auth.ts` — it is short on purpose, so it can be read in full.

Never in repo-local files. Never in logs. Never echoed in tool responses. Never in shared config that lives in a git history.

`.env` holds non-secret operational config only — base URLs, ports, host bindings; see `.env.example`. It is gitignored, it is not a deployment mechanism, and it is **not** a credential path.

### 2. Lean tool surfaces.

Each server exposes only the endpoints modders actually use. The default surface stays focused on discovery, metadata, versioning, diagnostics, and workflow steps that make sense inside an AI conversation.

When in doubt, ask: *would a modder, mid-conversation with an AI, plausibly want this?* If no, leave it out.

### 3. Fail fast, fail loud.

Missing config errors clearly at boot — never silently. HTTP errors from upstream APIs surface with status code and a snippet of the response body. Logs go to stderr as structured JSON, never stdout (which is reserved for MCP protocol traffic).

### 4. Small shared core, no premature abstraction.

`@modwrench/core` provides only what every server actually needs: secret loading, env helpers, structured logging, a shared error type. New utilities go in only when a second server proves they're shared — not on speculation.

## Authentication roadmap

| Phase | Status | Mechanism |
|---|---|---|
| API key / token | Shipped | User stores it in the OS credential manager (service `modwrench-<platform>`); ModWrench reads only |
| OAuth sign-in | Shipped (read-only scope) | Per-server `auth login` subcommand; token in OS keychain via `@napi-rs/keyring`; credential source: OS credential manager only (no env fallback) â†’ fail with hint |
| OAuth write scopes (endorse, subscribe, rate, comment) | Deliberately deferred | Will require explicit per-tool confirmation prompts |

### OAuth flow (planned)

Each server's `bin` ships an `auth` subcommand:

```
modwrench-nexus auth login    # opens browser, completes OAuth, stores token in keychain
modwrench-nexus auth status   # shows current identity and token expiry
modwrench-nexus auth logout   # removes token from keychain
```

- **Nexus**: standard OAuth2 auth-code + PKCE via Nexus SSO. Browser opens, local loopback receives the callback, token is saved.
- **mod.io**: email exchange flow (`email_request` â†’ 5-digit code â†’ `email_exchange`). No browser needed — user enters the code into the CLI.

Servers read the credential from the OS credential manager at boot, and from nowhere else. There is no env-var or `.env` fallback. If nothing is stored — or the credential manager cannot be reached, which happens on Steam Deck Game Mode and on headless Linux without libsecret — the server fails with a message naming the real cause and pointing at `auth login`.

## Current state

| Package | Purpose | Tools | Auth |
|---|---|---|---|
| `@modwrench/core` | Workshop-level shared helpers (secrets, env, logging, errors, keychain) | — | — |
| `@modwrench/nexus` | Nexus Mods MCP server | 12 | API key + OAuth (PKCE auth-code) |
| `@modwrench/modio` | mod.io MCP server | 11 | API key + OAuth (email magic-code) |
| `@modwrench/cli` | Meta-server: bundles every installed `@modwrench/*` platform into one MCP entry | 23 (sum) | Delegates to each platform's credential chain |

Both servers are read-only today; writes (endorse, subscribe, rate, comment) will arrive with OAuth.

## Layout

```
modwrench/
â”œâ”€â”€ packages/
â”‚   â”œâ”€â”€ core/                              shared helpers
â”‚   â”œâ”€â”€ nexus/                             Nexus Mods MCP server
â”‚   â”œâ”€â”€ modio/                             mod.io MCP server
â”‚   â””â”€â”€ cli/                               meta-server bundling every platform
â”œâ”€â”€ .env                                   gitignored, non-secret local config only
â”œâ”€â”€ .env.example                           template
â”œâ”€â”€ .mcp.json                              Claude Code project-scoped server config
â”œâ”€â”€ claude_desktop_config.example.json     Claude Desktop config template
â””â”€â”€ VISION.md                              this file
```

Adding a new server: copy `packages/modio/`, rename, swap the API client, then add an entry to the `platforms` array in `packages/cli/src/index.ts`. The core stays the same.

Each platform package exposes both:
- `@modwrench/<name>` — standalone bin (its own MCP entry, isolated process)
- `@modwrench/<name>/register` — a pure `registerXxxTools(server, credential)` function consumed by `@modwrench/cli`

So the CLI runs every platform in one process, while the per-platform bins remain available for users who want process isolation.

## Running

Both servers ship as compiled JS in each package's `dist/`. Build before running:

```powershell
npm run build
```

### Claude Code (the CLI)

`.mcp.json` at the workspace root registers both servers. Claude Code prompts for approval the first time it sees the file; approve once and the tools are available in every session opened from this directory.

### Claude Desktop

Copy the contents of `claude_desktop_config.example.json` into:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Adjust the absolute paths if you didn't clone to `C:\Apps\modwrench`. Then **fully quit and reopen** Claude Desktop (closing the window is not enough — it must restart). The two servers should appear in the MCP indicator.

API keys do **not** belong in either config file — or in any file. Servers read credentials only from the OS credential manager. Put yours there with `auth login`, or add it yourself under the service name `modwrench-<platform>`.

