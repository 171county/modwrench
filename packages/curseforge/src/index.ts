#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredential, log } from "@modwrench/core";
import { registerCurseForgeTools } from "./register.js";

// ─── MCP server boot ──────────────────────────────────────────────────────────
// CurseForge issues long-lived API keys via the developer console
// (https://console.curseforge.com) — there is no interactive OAuth flow, so
// this server has no `auth` subcommand. Set CURSEFORGE_API_KEY in your .env.

const credential = loadCredential({
  service: "curseforge",
  envVar: "CURSEFORGE_API_KEY",
  authHint:
    "Set CURSEFORGE_API_KEY in your .env. Generate a key at https://console.curseforge.com (For Developers → API Keys).",
});

const server = new McpServer({
  name: "modwrench-curseforge",
  version: "0.1.0",
});

const { toolCount, baseUrl } = registerCurseForgeTools(server, credential);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "modwrench-curseforge.started", {
    base_url: baseUrl,
    tools: toolCount,
  });
}

main().catch((err) => {
  log("error", "modwrench-curseforge.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
