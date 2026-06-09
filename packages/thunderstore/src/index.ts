#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "@modwrench/core";
import { registerThunderstoreTools } from "./register.js";

// ─── MCP server boot ──────────────────────────────────────────────────────────
// Standalone bin for running just the Thunderstore tools in isolation. The
// @modwrench/cli meta-server composes this with the other platform packages.
// Read-only public API — no credentials required, no auth subcommand needed.

const server = new McpServer({
  name: "modwrench-thunderstore",
  version: "0.0.1",
});

const { toolCount, baseUrl } = registerThunderstoreTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "modwrench-thunderstore.started", {
    base_url: baseUrl,
    tools: toolCount,
  });
}

main().catch((err) => {
  log("error", "modwrench-thunderstore.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
