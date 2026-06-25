---
name: build-platform
description: Scaffold a new platform package inside an existing wrench (e.g. @modwrench/<platform>, @mynewrench/<platform>). Manual triggers "scaffold a platform", "add a platform package", "build a platform for X", "wire in a new API", "add <name> as a platform".
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Build: Platform

A platform package wraps one external API as a set of MCP tools. One package per platform, one tool per meaningful operation. This skill is the procedural form of `docs/adding-a-platform.md` — read that doc once for the prose; use this skill to actually scaffold.

## Prerequisites
- Load `wrench-cerebral` (the substrate entry) before proceeding.
- `wrench-playbook` and `wrench-code-master` set the voice and code conventions.

## Before scaffolding — verify fit

Ask if not already pinned:

1. **Documented public API?** No reverse-engineering, no scraping. If the platform has no public API, stop.
2. **ToS permits third-party clients?** If unclear, surface it to the user before writing code.
3. **Credentials revocable per-app from a settings page?** If the platform only does long-lived passwords, the auth story gets hard.
4. **Auth shape?** Three buckets: anonymous (no auth, like Thunderstore/Modrinth), API key via env, or OAuth (PKCE preferred). Pick one. Anonymous is the easiest path and the bar for the first tool.

## File layout

Inside the wrench's `packages/`:

```
packages/<platform>/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts        # bin entry — subcommand dispatch + MCP boot
│   ├── register.ts     # registerXTools(server, credential) — the tool catalog
│   └── auth.ts         # auth login/status/logout — skip if anonymous
└── test/
    └── register.test.ts
```

`auth.ts` exists only if the platform needs credentials. Anonymous platforms drop it and drop the `./auth` export from `package.json`.

## `package.json` shape

```json
{
  "name": "@<wrench>/<platform>",
  "version": "0.0.1",
  "description": "<wrench> — <Platform> MCP server. <one-line scope>.",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./register": {
      "types": "./dist/register.d.ts",
      "import": "./dist/register.js"
    },
    "./auth": {
      "types": "./dist/auth.d.ts",
      "import": "./dist/auth.js"
    }
  },
  "bin": {
    "<wrench>-<platform>": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "clean": "rimraf dist",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test test/*.test.ts"
  },
  "dependencies": {
    "@mcpwrench/core": "0.0.1",
    "@modelcontextprotocol/sdk": "^1.0.4",
    "zod": "^3.23.8"
  }
}
```

Drop the `./auth` export and the `auth.ts` reference if anonymous (mirror `modwrench/packages/thunderstore/package.json`).

Three export paths because three audiences:
- `.` — bin entry, used by `npx @<wrench>/<platform>`
- `./register` — used by the wrench's CLI meta-server
- `./auth` — used by the CLI for `<wrench> auth <action> <platform>`

## `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## `register.ts` — the canonical shape

This is the heart of the package. `registerXTools` is a pure function: takes an MCP server + credential, registers every tool, returns `{ toolCount, baseUrl }`. No transport, no boot, no side effects. Use the shared HTTP client from `@mcpwrench/core` — don't hand-roll fetch logic.

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createHttpClient,
  getEnv,
  log,
  McpwrenchError,
  type Credential,
} from "@mcpwrench/core";

export function registerXTools(
  server: McpServer,
  credential: Credential,
): { toolCount: number; baseUrl: string } {
  const BASE_URL = getEnv("X_BASE_URL", "https://api.example.com/v1");
  const USER_AGENT = "<Wrench>/0.0.1 (+https://mcpwrench.dev)";

  // Read client — normal retry, 4 concurrent.
  const httpClient = createHttpClient({
    baseUrl: BASE_URL,
    userAgent: USER_AGENT,
    errorCodePrefix: "x",            // → "x_http_error" on non-2xx
    authHeaders: () =>
      credential.source === "keychain"
        ? { Authorization: `Bearer ${credential.accessToken}` }
        : { apikey: credential.apiKey },
  });

  // Write client — retry disabled so transient 5xx can't double-execute.
  // Only declare if this package registers write tools.
  const writeClient = createHttpClient({
    baseUrl: BASE_URL,
    userAgent: USER_AGENT,
    errorCodePrefix: "x",
    authHeaders: httpClient ? undefined : undefined, // copy auth from read client
    retry: { maxAttempts: 1 },
  });

  // ... server.tool(...) calls go here. Use build-tool to scaffold each one.

  return { toolCount: /* N */ 0, baseUrl: BASE_URL };
}
```

Key points:

- **Two clients, not one, if writes exist.** The read client gets the default retry (3 attempts, exponential backoff). The write client gets `retry: { maxAttempts: 1 }` so a flaky 5xx response can't cause the upstream side effect to happen twice. See `mynewrench/packages/roblox/src/register.ts` for the canonical declaration.
- **`errorCodePrefix`** scopes error codes to the platform (`x_http_error` instead of `http_error`) — makes downstream error handlers unambiguous.
- **`authHeaders` is a callback**, not a static object. It runs per request, which means token refresh is straightforward when the time comes.
- **Anonymous platforms omit `authHeaders` entirely.** The shared client sends User-Agent and Accept; no Authorization header gets injected. See `packages/thunderstore/src/register.ts`.
- **Return `{ toolCount, baseUrl }`.** The CLI meta-server logs these on boot so users see what's loaded.

## Tool naming + descriptions

- `<platform>_<verb>_<noun>`, lowercase, underscore-separated. E.g. `roblox_get_universe`, `roblox_list_datastores`.
- Avoid generic names like `get_mod` — the meta-server composes multiple platforms and ambiguous names confuse the LLM's tool-selection step.
- Every tool description tells the LLM **how to chain**: "use `x_list_things` to discover ids" is how the dependency surfaces.
- Every zod field has `.describe()`. The MCP SDK exposes these to the client as JSON Schema; missing descriptions degrade the LLM's accuracy.

Hand off to `build-tool` for the per-tool scaffolding (read vs write branching is non-trivial).

## `auth.ts` — if the platform needs credentials

Three exports, each handling one subcommand:

- `authLogin()` — runs the OAuth flow (PKCE preferred), exchanges code for token, validates it against the platform's profile endpoint, and stores it via `setStoredToken("<service>", { access_token, refresh_token, expires_at, saved_at })`.
- `authStatus()` — reads the stored token, hits the profile endpoint to verify it, prints status to stderr.
- `authLogout()` — calls `deleteStoredToken("<service>")`.

For PKCE, mirror `modwrench/packages/nexus/src/auth.ts`. For email-code OAuth, mirror `modwrench/packages/modio/src/auth.ts`. For API-key only, the package usually skips `auth.ts` and relies on the env-var fallback in `loadCredential`.

Service name is short, lowercase, no hyphens. It becomes the keychain entry `<wrench>-<service>`.

## `src/index.ts` — bin entry

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredential, log } from "@mcpwrench/core";
import { authLogin, authStatus, authLogout } from "./auth.js";
import { registerXTools } from "./register.js";

const [, , subcmd, action] = process.argv;
if (subcmd === "auth") {
  if (action === "login") await authLogin();
  else if (action === "status") await authStatus();
  else if (action === "logout") await authLogout();
  else {
    process.stderr.write("Usage: <wrench>-x auth <login|status|logout>\n");
    process.exit(1);
  }
  process.exit(0);
}

const credential = loadCredential({
  service: "x",
  envVar: "X_API_KEY",
  authHint: "Run `<wrench>-x auth login` or set X_API_KEY in your .env.",
});

const server = new McpServer({ name: "<wrench>-x", version: "0.0.1" });
const { toolCount, baseUrl } = registerXTools(server, credential);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "<wrench>-x.started", { base_url: baseUrl, tools: toolCount });
}

main().catch((err) => {
  log("error", "<wrench>-x.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
```

The `auth` subcommand handler runs **before** `loadCredential` because a user running `auth login` is doing so because they have no credential yet.

## Wire into the workspace + CLI

1. Add `packages/<platform>` to the root `package.json` workspaces array, between core and CLI. Order matters — npm builds in array order, and the CLI imports `./register` types from your platform.
2. Add `"@<wrench>/<platform>": "0.0.1"` to `packages/cli/package.json` dependencies.
3. In `packages/cli/src/index.ts`, append a `PlatformRegistration` entry with `kind: "credentialed"` (or `"local"` for anonymous), and route the auth subcommand to dynamically import `@<wrench>/<platform>/auth`.

## After scaffolding

1. Hand off to `build-tool` to add the first tool.
2. Hand off to `build-test` to scaffold the test file.
3. Run `npm run build && npm run typecheck && npm test` from the workspace root. Fix until green.
4. Commit with DCO: `git commit -s -m "feat(<platform>): scaffold @<wrench>/<platform> package"`.

## Trust posture (the platform package must obey)

These are reviewed on every PR. Violations don't merge.

1. **No telemetry.** The package contacts the platform's API and nothing else.
2. **No persisted user data.** Credentials live in the OS keychain only.
3. **Attribution preserved.** Responses surface author + source URL when describing user-generated content.
4. **Permissions respected.** Mod/asset permission flags pass through unchanged.
5. **Rate limits honored.** The shared HTTP client respects `Retry-After`; don't bypass it.
6. **Read-only by default.** Write tools are opt-in via the confirm gate (see `build-tool`).
