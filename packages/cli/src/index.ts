#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredential, log, type Credential } from "@mcpwrench/core";
import { registerNexusTools } from "@modwrench/nexus/register";
import { registerModioTools } from "@modwrench/modio/register";
import { registerThunderstoreTools } from "@modwrench/thunderstore/register";
import { registerModrinthTools } from "@modwrench/modrinth/register";
import { registerWorkbenchTools } from "@modwrench/workbench/register";

// ─── Subcommand dispatch ─────────────────────────────────────────────────────
// Must run before the MCP boot block below. Two routes today:
//   `modwrench --version | -v`         → print version, exit
//   `modwrench auth <action> <plat>`   → per-platform auth flow
// A user running `auth login` does so precisely because they don't have a
// credential yet — the credential-load block below must not run on that path.

const [, , subcmd, action, platform] = process.argv;

if (subcmd === "--version" || subcmd === "-v") {
  // Read directly from this package's package.json so version stays in sync
  // automatically — no hardcoded duplicate to forget on release.
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgJson = JSON.parse(
    readFileSync(resolve(here, "..", "package.json"), "utf8")
  ) as { version: string };
  process.stdout.write(`${pkgJson.version}\n`);
  process.exit(0);
}

if (subcmd === "auth") {
  if (!action || !platform) {
    process.stderr.write(
      "Usage: modwrench auth <login|status|logout> <nexus|modio>\n"
    );
    process.exit(1);
  }

  type AuthModule = {
    authLogin(): Promise<void>;
    authStatus(): Promise<void>;
    authLogout(): Promise<void>;
  };

  let authMod: AuthModule;
  if (platform === "nexus") {
    authMod = (await import("@modwrench/nexus/auth")) as unknown as AuthModule;
  } else if (platform === "modio") {
    authMod = (await import("@modwrench/modio/auth")) as unknown as AuthModule;
  } else {
    process.stderr.write(
      `Unknown platform "${platform}". Supported: nexus, modio.\n`
    );
    process.exit(1);
  }

  if (action === "login") await authMod.authLogin();
  else if (action === "status") await authMod.authStatus();
  else if (action === "logout") await authMod.authLogout();
  else {
    process.stderr.write(
      `Unknown action "${action}". Supported: login, status, logout.\n`
    );
    process.exit(1);
  }
  process.exit(0);
}

// ─── Meta-server boot ─────────────────────────────────────────────────────────
// The CLI bundles every installed @modwrench/* platform package and exposes
// them as one MCP entry. Two registration shapes coexist:
//
//   - Credentialed platforms (Nexus, mod.io): need an API token from the
//     keychain or env. A platform whose credentials can't be resolved is
//     skipped (warn-and-continue) rather than fatal.
//   - Local platforms (Workbench): no credential needed; always loaded. These
//     read local filesystem state only.
//
// Subcommands like `auth login` stay on the per-platform bins (modwrench-nexus,
// modwrench-modio) since the auth UX differs by platform.

type CredentialedRegistration = {
  name: string;
  kind: "credentialed";
  register: (server: McpServer, credential: Credential) => {
    toolCount: number;
    baseUrl: string;
  };
  envVar: string;
  service: string;
  authHint: string;
};

type LocalRegistration = {
  name: string;
  kind: "local";
  register: (server: McpServer) => { toolCount: number; baseUrl?: string };
};

type PlatformRegistration = CredentialedRegistration | LocalRegistration;

const platforms: PlatformRegistration[] = [
  {
    name: "nexus",
    kind: "credentialed",
    register: registerNexusTools,
    envVar: "NEXUS_API_KEY",
    service: "nexus",
    authHint:
      "Run `modwrench auth login nexus` (OAuth) or set NEXUS_API_KEY in your .env.",
  },
  {
    name: "modio",
    kind: "credentialed",
    register: registerModioTools,
    envVar: "MODIO_API_KEY",
    service: "modio",
    authHint:
      "Run `modwrench auth login modio` (OAuth) or set MODIO_API_KEY in your .env.",
  },
  {
    name: "thunderstore",
    kind: "local",
    register: registerThunderstoreTools,
  },
  {
    name: "modrinth",
    kind: "local",
    register: registerModrinthTools,
  },
  {
    name: "workbench",
    kind: "local",
    register: registerWorkbenchTools,
  },
];

const server = new McpServer({
  name: "modwrench",
  version: "0.0.1",
});

const loaded: Array<{ name: string; toolCount: number; baseUrl?: string }> = [];
const skipped: Array<{ name: string; reason: string }> = [];

for (const p of platforms) {
  try {
    if (p.kind === "credentialed") {
      const credential = loadCredential({
        service: p.service,
        envVar: p.envVar,
        authHint: p.authHint,
      });
      const { toolCount, baseUrl } = p.register(server, credential);
      loaded.push({ name: p.name, toolCount, baseUrl });
    } else {
      const { toolCount } = p.register(server);
      loaded.push({ name: p.name, toolCount });
    }
  } catch (err) {
    skipped.push({
      name: p.name,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

if (loaded.length === 0) {
  log("error", "modwrench.fatal", {
    message: "No platforms could load.",
    skipped,
  });
  process.exit(1);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "modwrench.started", {
    loaded: loaded.map((p) => ({
      platform: p.name,
      tools: p.toolCount,
      ...(p.baseUrl ? { base_url: p.baseUrl } : {}),
    })),
    skipped: skipped.map((p) => p.name),
    total_tools: loaded.reduce((sum, p) => sum + p.toolCount, 0),
  });
}

main().catch((err) => {
  log("error", "modwrench.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
