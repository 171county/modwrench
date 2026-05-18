# MCPwrench

A workshop of focused MCP servers that bring modding platforms, asset libraries, and game-data sources into AI clients (Claude Desktop, Cursor, and any other MCP-compatible host).

The first product line — **ModWrench** — wraps Nexus Mods and mod.io so a modder can search, inspect, and reason about mods in conversation with an AI instead of clicking through web UIs.

## Guiding principles

### 1. The wrench holds tools, not keys.

**MCPwrench servers never persist secrets to disk.** Credentials are either:

- **(a)** supplied at process start by the MCP client's secure config — environment variables passed by Claude Desktop, Cursor, etc.; or
- **(b)** held in the OS-native keychain (Windows Credential Manager, macOS Keychain, libsecret on Linux) after an OAuth flow.

Never in repo-local files. Never in logs. Never echoed in tool responses. Never in shared config that lives in a git history.

`.env` is a developer convenience for local testing only. It is gitignored and is **not** a deployment mechanism. If you find yourself reaching for a "ship the .env to production" workaround, the answer is to wire OAuth instead.

### 2. Lean tool surfaces.

Each server exposes only the endpoints modders actually use. We don't mirror every API endpoint a platform publishes — comments, monetization, multipart uploads, service-to-service routes, and similar "fluff" stay out of the default surface. They can be added per-installation if someone wants them.

When in doubt, ask: *would a modder, mid-conversation with an AI, plausibly want this?* If no, leave it out.

### 3. Fail fast, fail loud.

Missing config errors clearly at boot — never silently. HTTP errors from upstream APIs surface with status code and a snippet of the response body. Logs go to stderr as structured JSON, never stdout (which is reserved for MCP protocol traffic).

### 4. Small shared core, no premature abstraction.

`@mcpwrench/core` provides only what every server actually needs: secret loading, env helpers, structured logging, a shared error type. New utilities go in only when a second server proves they're shared — not on speculation.

## Authentication roadmap

| Phase | Status | Mechanism |
|---|---|---|
| API-key (dev) | Shipped | `NEXUS_API_KEY` / `MODIO_API_KEY` in `.env` (workspace root, gitignored) |
| OAuth sign-in | Shipped (read-only scope) | Per-server `auth login` subcommand; token in OS keychain via `@napi-rs/keyring`; boot-time fallback chain: keychain → env → fail with hint |
| OAuth write scopes (endorse, subscribe, rate, comment) | Deliberately deferred | Will require explicit per-tool confirmation prompts |

### OAuth flow (planned)

Each server's `bin` ships an `auth` subcommand:

```
modwrench-nexus auth login    # opens browser, completes OAuth, stores token in keychain
modwrench-nexus auth status   # shows current identity and token expiry
modwrench-nexus auth logout   # removes token from keychain
```

- **Nexus**: standard OAuth2 auth-code + PKCE via Nexus SSO. Browser opens, local loopback receives the callback, token is saved.
- **mod.io**: email exchange flow (`email_request` → 5-digit code → `email_exchange`). No browser needed — user enters the code into the CLI.

Servers check the keychain first at boot, then fall back to the env-var API key (developer testing path). If neither is present, the server fails with a message pointing to `auth login`.

## Current state

| Package | Purpose | Tools | Auth |
|---|---|---|---|
| `@mcpwrench/core` | Workshop-level shared helpers (secrets, env, logging, errors, keychain) | — | — |
| `@modwrench/nexus` | Nexus Mods MCP server | 12 | API key + OAuth (PKCE auth-code) |
| `@modwrench/modio` | mod.io MCP server | 11 | API key + OAuth (email magic-code) |
| `@modwrench/cli` | Meta-server: bundles every installed `@modwrench/*` platform into one MCP entry | 23 (sum) | Delegates to each platform's credential chain |

Both servers are read-only today; writes (endorse, subscribe, rate, comment) will arrive with OAuth.

## Layout

```
mcpwrench/
├── packages/
│   ├── core/                              shared helpers
│   ├── nexus/                             Nexus Mods MCP server
│   ├── modio/                             mod.io MCP server
│   └── cli/                               meta-server bundling every platform
├── .env                                   gitignored, developer-local secrets
├── .env.example                           template
├── .mcp.json                              Claude Code project-scoped server config
├── claude_desktop_config.example.json     Claude Desktop config template
└── VISION.md                              this file
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

Adjust the absolute paths if you didn't clone to `C:\Apps\mcpwrench`. Then **fully quit and reopen** Claude Desktop (closing the window is not enough — it must restart). The two servers should appear in the MCP indicator.

API keys do **not** belong in either config file. The servers locate the workspace `.env` on their own via `findWorkspaceRoot`.
