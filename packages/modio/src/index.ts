#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredential, log } from "@modwrench/core";
import { authLogin, authStatus, authLogout } from "./auth.js";
import { registerModioTools } from "./register.js";

// ─── Subcommand dispatch ──────────────────────────────────────────────────────

const [, , subcmd, action] = process.argv;
if (subcmd === "auth") {
  if (action === "login") await authLogin();
  else if (action === "status") await authStatus();
  else if (action === "logout") await authLogout();
  else {
    process.stderr.write(
      "Usage: modwrench-modio auth <login|status|logout>\n"
    );
    process.exit(1);
  }
  process.exit(0);
}

// ─── MCP server boot ──────────────────────────────────────────────────────────

const credential = loadCredential({
  service: "modio",
  envVar: "MODIO_API_KEY",
  authHint:
    "Run `modwrench-modio auth login` (OAuth) or set MODIO_API_KEY in your .env (read-only API key).",
});

const server = new McpServer({
  name: "modwrench-modio",
  version: "0.0.1",
});

const { toolCount, baseUrl } = registerModioTools(server, credential);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "modwrench-modio.started", {
    base_url: baseUrl,
    tools: toolCount,
  });
}

main().catch((err) => {
  log("error", "modwrench-modio.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
