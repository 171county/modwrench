# Adding a Platform to ModWrench

This guide walks through adding a new platform package (`@modwrench/<platform>`) — wrapping a mod-hosting service's API as a set of MCP tools that ship cleanly under the ModWrench umbrella.

If you're adding tools to an *existing* platform package, skip the scaffolding sections — go straight to the [tool registration](#3-tool-registration) and [trust posture](#5-trust-posture) sections.

This doc reflects the v1 architecture (`@modwrench/nexus`, `@modwrench/modio`). Read those two packages as living examples before you start — copy the parts that fit, ask before you deviate.

---

## Before you start

**Verify the platform is a fit.**

- Does the platform have a documented public read API? (No reverse-engineering, no scraping.)
- Does the platform's ToS permit third-party API clients?
- Are credentials revocable per-app from a user-facing settings page?
- Is the platform actively used by modders, or is this an academic addition?

If any of these are uncertain, open an issue first describing the platform and the proposed scope. We'd rather have the conversation than say no after you've put 20 hours in.

**Decide your auth story.**

- **Read-only public API** (no auth or simple API key): easiest path. Mirror `@modwrench/modio`'s API-key-via-env fallback.
- **OAuth (PKCE)**: required if the platform supports it. Mirror `@modwrench/nexus`'s flow.
- **OAuth (email-code or other non-PKCE)**: case by case. Mirror `@modwrench/modio`'s email-code flow if the shape fits.

Credentials must end up in the OS keychain via `@modwrench/core`'s `setStoredToken`. We don't ship credentials to disk in plain files, and we don't keep them in process memory longer than the request that uses them.

---

## 1. Scaffolding the package

Inside the monorepo:

```
packages/<platform>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # bin entry — subcommand dispatch + MCP boot
    ├── register.ts     # registerXTools(server, credential) — the tool catalog
    └── auth.ts         # auth login/status/logout (only if the platform needs auth)
```

### `package.json` shape

Match the existing platform packages exactly. The fields that matter most:

```json
{
  "name": "@modwrench/<platform>",
  "version": "0.0.1",
  "type": "module",
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
    "modwrench-<platform>": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "clean": "rimraf dist",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modwrench/core": "0.0.1",
    "@modelcontextprotocol/sdk": "^1.0.4",
    "zod": "^3.23.8"
  }
}
```

Three export paths because three audiences:
- `.` — the bin entry, used by `npx @modwrench/<platform>`
- `./register` — used by `@modwrench/cli` to compose this platform into the meta-server
- `./auth` — used by `@modwrench/cli` for `modwrench auth <action> <platform>`

The `bin` field exposes a standalone CLI named `modwrench-<platform>`. Drop `./auth` from exports only if the platform genuinely needs no authentication.

### `tsconfig.json`

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

### Add to workspace order

[package.json](../package.json) at the workspace root has an explicit `workspaces` array. Insert your platform between `core` and `cli`:

```json
"workspaces": [
  "packages/core",
  "packages/nexus",
  "packages/modio",
  "packages/<platform>",
  "packages/workbench",
  "packages/cli"
]
```

Order matters because npm builds workspaces in array order, and CLI imports your platform's `./register` typedefs.

---

## 2. Tool registration

This is the heart of the package. `registerXTools` is a pure function: it takes an MCP server instance and a credential, and registers every tool the platform exposes. No transport, no boot, no side effects.

```typescript
// packages/<platform>/src/register.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getEnv,
  log,
  ModWrenchError,
  type Credential,
} from "@modwrench/core";

export function registerXTools(
  server: McpServer,
  credential: Credential
): { toolCount: number; baseUrl: string } {
  const BASE_URL = getEnv("X_BASE_URL", "https://api.example.com/v1");
  const USER_AGENT = "ModWrench/0.0.1 (+https://github.com/171county/modwrench)";

  async function xRequest<T>(path: string): Promise<T> {
    const url = `${BASE_URL}${path}`;
    log("debug", "x.request", { url });

    const authHeaders: Record<string, string> =
      credential.source === "keychain"
        ? { Authorization: `Bearer ${credential.accessToken}` }
        : { apikey: credential.apiKey };

    const response = await fetch(url, {
      headers: {
        ...authHeaders,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "<no body>");
      throw new ModWrenchError(
        "x_http_error",
        `X API returned ${response.status} for ${path}`,
        { status: response.status, meta: { body: body.slice(0, 500) } }
      );
    }
    return (await response.json()) as T;
  }

  server.tool(
    "x_get_thing",
    "Get a thing from X by id. Use x_list_things to discover ids.",
    {
      thing_id: z.number().int().positive().describe("The numeric thing id."),
    },
    async ({ thing_id }) => {
      const thing = await xRequest<Record<string, unknown>>(
        `/things/${thing_id}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(thing, null, 2) }],
      };
    }
  );

  // ... more tools

  return { toolCount: 1, baseUrl: BASE_URL };
}
```

### Tool description conventions

- **Be honest about what the tool does**, not what you wish it did.
- **Tell the LLM how to chain tools.** "Use `x_list_things` to discover ids" is how the model learns the dependency.
- **Describe the cost / scope.** If a tool paginates server-side or fetches a lot, say so.
- **Mark optional params clearly with defaults** in the `describe` string.

### Tool naming

`<platform>_<verb>_<noun>`. Lowercase, underscore-separated. Examples:
- `nexus_get_mod`, `nexus_list_games`, `nexus_md5_search`
- `modio_search_mods`, `modio_top_games`

Avoid platform-agnostic names — the LLM picks tools by name and a generic `get_mod` would be ambiguous in the meta-server.

### Schema discipline

- Use `zod` for input schemas. The MCP SDK reads them and exposes a JSON Schema to the client automatically.
- Constrain numeric ids with `.int().positive()`.
- Describe every field.
- Validate aggressively in zod; throw cleanly in handlers (the `ModWrenchError` envelope formats nicely).

---

## 3. Bin entry

`src/index.ts` is the standalone entry — what runs when someone does `npx @modwrench/<platform>` or invokes the bin directly.

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredential, log } from "@modwrench/core";
import { authLogin, authStatus, authLogout } from "./auth.js";
import { registerXTools } from "./register.js";

const [, , subcmd, action] = process.argv;
if (subcmd === "auth") {
  if (action === "login") await authLogin();
  else if (action === "status") await authStatus();
  else if (action === "logout") await authLogout();
  else {
    process.stderr.write("Usage: modwrench-x auth <login|status|logout>\n");
    process.exit(1);
  }
  process.exit(0);
}

const credential = loadCredential({
  service: "x",
  envVar: "X_API_KEY",
  authHint:
    "Run `modwrench-x auth login` (OAuth) or set X_API_KEY in your .env.",
});

const server = new McpServer({
  name: "modwrench-x",
  version: "0.0.1",
});

const { toolCount, baseUrl } = registerXTools(server, credential);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "modwrench-x.started", { base_url: baseUrl, tools: toolCount });
}

main().catch((err) => {
  log("error", "modwrench-x.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
```

The auth subcommand handling at the top is critical: a user running `modwrench-x auth login` is doing so *because* they have no credential yet. The credential-load below must not run on that code path.

---

## 4. Auth (if needed)

If the platform uses OAuth with PKCE, mirror [`packages/nexus/src/auth.ts`](../packages/nexus/src/auth.ts). The shape:

- `authLogin()` — opens the browser, captures the OAuth callback on a local loopback HTTP server, exchanges code for token, validates the token against the platform's user-profile endpoint, and stores it in the OS keychain via `setStoredToken`.
- `authStatus()` — reads the stored token, hits the user-profile endpoint to verify it's still good, prints status.
- `authLogout()` — calls `deleteStoredToken`.

For non-PKCE OAuth (e.g. email-code), mirror [`packages/modio/src/auth.ts`](../packages/modio/src/auth.ts).

Token storage:

```typescript
import { setStoredToken } from "@modwrench/core";

setStoredToken("x", {
  access_token: tokenData.access_token,
  refresh_token: tokenData.refresh_token,
  expires_at: tokenData.expires_in
    ? Date.now() + tokenData.expires_in * 1000
    : null,
  saved_at: Date.now(),
});
```

Service names are short, lowercase, hyphen-free. They become the keychain entry name (`modwrench-<service>`).

---

## 5. Wiring into the meta-server

[packages/cli/src/index.ts](../packages/cli/src/index.ts) composes every platform into one MCP entry. Two changes:

### 5a. Register the platform

```typescript
import { registerXTools } from "@modwrench/x/register";

const platforms: PlatformRegistration[] = [
  // ... existing entries
  {
    name: "x",
    kind: "credentialed",
    register: registerXTools,
    envVar: "X_API_KEY",
    service: "x",
    authHint:
      "Run `modwrench-x auth login` (OAuth) or set X_API_KEY in your .env.",
  },
];
```

Use `kind: "local"` instead if the platform doesn't need credentials (currently only `@modwrench/workbench` uses this).

### 5b. Route auth subcommand

```typescript
} else if (platform === "x") {
  authMod = (await import("@modwrench/x/auth")) as unknown as AuthModule;
}
```

### 5c. Add the dep

```json
"dependencies": {
  "@modwrench/x": "0.0.1"
}
```

in [packages/cli/package.json](../packages/cli/package.json).

---

## 6. Trust posture

This is the table-stakes section. Every PR adding a platform is reviewed against these rules. Violations don't merge.

1. **No telemetry.** The platform package phones nothing home. It only contacts the platform's own API.
2. **No persisted user data.** Credentials live in the OS keychain. Search queries, tool calls, and responses are in-memory only.
3. **Attribution preserved.** Tool responses that mention a mod surface the author name and source URL prominently. We do not strip credits when normalizing across platforms.
4. **Permissions respected.** If the platform's mod metadata exposes permission flags (modification allowed, asset reuse allowed, etc.), they pass through unmodified. Downstream tools that act on mods (publishing, v3+) must read these and refuse to act when permissions don't allow.
5. **Rate limits honored.** Fail politely on the platform's infrastructure — never retry-loop, never use undocumented endpoints. Respect `Retry-After` if the platform sends it.
6. **Read-only by default.** v1 platform packages are read-only. Write-side tools (uploading, editing) come in v3+ and require explicit user confirmation at call time.

---

## 7. Testing your platform

- `npm run build` from the workspace root should succeed with your platform in the chain.
- `npm run typecheck` should pass.
- Direct smoke test of the standalone bin:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node packages/<platform>/dist/index.js
```

Your tool catalog should appear in the `tools/list` response with descriptions.

- Run at least one tool against a real platform API call before opening the PR.
- If your tool returns large payloads, add a `_limit` or summary path so the LLM isn't drowning in irrelevant fields.

---

## 8. Submitting

1. Open the PR with the platform package + cli updates + a one-paragraph "why this platform" in the description.
2. Cite the platform's API docs and ToS.
3. Mention any quirks reviewers should know — odd auth, weird pagination, rate-limit specifics.
4. Sign your commits with `-s` (DCO — see [CONTRIBUTING.md](../CONTRIBUTING.md)).
5. Add the platform to the README's "What it does today" section and the Roadmap if it's a new tier.

PRs that follow this guide and the trust posture get reviewed fast. PRs that bypass the trust rules — even if the code is excellent — don't merge.

---

## Living references

- `@modwrench/nexus` — OAuth (PKCE) + legacy API-key fallback, dual auth header routing, 12 tools
- `@modwrench/modio` — OAuth (email code) + legacy API-key fallback, dual auth routing, 11 tools
- `@modwrench/workbench` — uncredentialed `local` kind, demonstrates the alternative registration shape

If something in this doc is wrong or stale, the existing code wins. File an issue with what you found.
