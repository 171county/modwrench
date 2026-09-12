#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredential, log } from "@modwrench/core";
import { authLogin, authStatus, authLogout } from "./auth.js";
import { registerNexusTools } from "./register.js";

// ─── Subcommand dispatch ──────────────────────────────────────────────────────
// `modwrench-nexus auth <login|status|logout>` runs an auth subcommand and
// exits; any other invocation falls through to MCP server boot below.

const [, , subcmd, action] = process.argv;
if (subcmd === "auth") {
  if (action === "login") await authLogin();
  else if (action === "status") await authStatus();
  else if (action === "logout") await authLogout();
  else {
    process.stderr.write(
      "Usage: modwrench-nexus auth <login|status|logout>\n"
    );
    process.exit(1);
  }
  process.exit(0);
}

// ─── MCP server boot ──────────────────────────────────────────────────────────

const credential = loadCredential({
  service: "nexus",
  envVar: "NEXUS_API_KEY",
  authHint:
    "Run `modwrench-nexus auth login` (OAuth) or set NEXUS_API_KEY in your .env (legacy API key).",
});

const server = new McpServer({
  name: "modwrench-nexus",
  version: "0.1.0",
});

const { toolCount, baseUrl } = registerNexusTools(server, credential);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "modwrench-nexus.started", {
    base_url: baseUrl,
    tools: toolCount,
  });
}

main().catch((err) => {
  log("error", "modwrench-nexus.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
