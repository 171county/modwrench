#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "@modwrench/core";
import { registerWorkbenchTools } from "./register.js";

// ─── MCP server boot ──────────────────────────────────────────────────────────
// Standalone bin for running just the workbench tools in isolation. The
// @modwrench/cli meta-server composes this with the platform packages, but
// users who only want local-filesystem tools (no Nexus/mod.io credentials)
// can run this one directly.

const server = new McpServer({
  name: "modwrench-workbench",
  version: "0.0.1",
});

const { toolCount } = registerWorkbenchTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "modwrench-workbench.started", { tools: toolCount });
}

main().catch((err) => {
  log("error", "modwrench-workbench.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
