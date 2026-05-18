#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredential, log, type Credential } from "@mcpwrench/core";
import { registerNexusTools } from "@modwrench/nexus/register";
import { registerModioTools } from "@modwrench/modio/register";

// ─── Meta-server boot ─────────────────────────────────────────────────────────
// The CLI bundles every installed @modwrench/* platform package and exposes
// them as one MCP entry. A platform whose credentials can't be resolved is
// skipped (warn-and-continue) rather than fatal — modders can still use the
// platforms they've configured even if others are missing keys.
//
// Subcommands like `auth login` stay on the per-platform bins (modwrench-nexus,
// modwrench-modio) since the auth UX differs by platform.

type PlatformRegistration = {
  name: string;
  register: (server: McpServer, credential: Credential) => {
    toolCount: number;
    baseUrl: string;
  };
  envVar: string;
  service: string;
  authHint: string;
};

const platforms: PlatformRegistration[] = [
  {
    name: "nexus",
    register: registerNexusTools,
    envVar: "NEXUS_API_KEY",
    service: "nexus",
    authHint:
      "Run `modwrench-nexus auth login` (OAuth) or set NEXUS_API_KEY in your .env.",
  },
  {
    name: "modio",
    register: registerModioTools,
    envVar: "MODIO_API_KEY",
    service: "modio",
    authHint:
      "Run `modwrench-modio auth login` (OAuth) or set MODIO_API_KEY in your .env.",
  },
];

const server = new McpServer({
  name: "modwrench",
  version: "0.0.1",
});

const loaded: Array<{ name: string; toolCount: number; baseUrl: string }> = [];
const skipped: Array<{ name: string; reason: string }> = [];

for (const p of platforms) {
  try {
    const credential = loadCredential({
      service: p.service,
      envVar: p.envVar,
      authHint: p.authHint,
    });
    const { toolCount, baseUrl } = p.register(server, credential);
    loaded.push({ name: p.name, toolCount, baseUrl });
  } catch (err) {
    skipped.push({
      name: p.name,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

if (loaded.length === 0) {
  log("error", "modwrench.fatal", {
    message: "No platforms could load credentials.",
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
      base_url: p.baseUrl,
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
