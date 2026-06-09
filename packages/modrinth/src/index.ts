#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "@modwrench/core";
import { registerModrinthTools } from "./register.js";

// Standalone bin. Modrinth's public read API is anonymous so no auth
// subcommand is needed. The @modwrench/cli meta-server composes this with
// the other platform packages.

const server = new McpServer({
  name: "modwrench-modrinth",
  version: "0.0.1",
});

const { toolCount, baseUrl } = registerModrinthTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "modwrench-modrinth.started", {
    base_url: baseUrl,
    tools: toolCount,
  });
}

main().catch((err) => {
  log("error", "modwrench-modrinth.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
