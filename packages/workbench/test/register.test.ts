import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWorkbenchTools } from "../src/register.js";

// Mock server pattern — same shape used in nexus + modio + thunderstore tests.
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

class MockMcpServer {
  tools = new Map<
    string,
    {
      title?: string;
      description: string;
      schema: unknown;
      annotations: Record<string, unknown>;
      handler: ToolHandler;
    }
  >();
  registerTool(
    name: string,
    config: {
      title?: string;
      description: string;
      inputSchema?: unknown;
      annotations: Record<string, unknown>;
    },
    handler: ToolHandler
  ): void {
    this.tools.set(name, {
      title: config.title,
      description: config.description,
      schema: config.inputSchema,
      annotations: config.annotations,
      handler,
    });
  }
}

// ─── Registration smoke tests ───────────────────────────────────────────────

test("registerWorkbenchTools: registers 8 tools", () => {
  const server = new MockMcpServer();
  const result = registerWorkbenchTools(server as unknown as never);
  assert.equal(result.toolCount, 8);
  assert.equal(server.tools.size, 8);
});

test("registerWorkbenchTools: every expected tool is present", () => {
  const server = new MockMcpServer();
  registerWorkbenchTools(server as unknown as never);
  const expected = [
    "mw_detect_environment",
    "mw_read_load_order",
    "mw_parse_crashlog",
    "mw_query_mod_metadata",
    "mw_check_known_conflicts",
    "mw_diagnose_crash",
    "mw_patch_day",
    "mw_crash_whisperer",
  ];
  for (const name of expected) {
    assert.ok(server.tools.has(name), `missing tool: ${name}`);
  }
});

test("every workbench tool declares all four boolean annotation hints", () => {
  // Hints are honest self-descriptions for host UX — hints, not guarantees,
  // per the MCP spec. The read-only promise itself is enforced separately by
  // readonly.test.ts; this guard holds the declared metadata in place.
  const server = new MockMcpServer();
  registerWorkbenchTools(server as unknown as never);
  assert.ok(
    server.tools.size > 0,
    "no tools registered — this guard would pass vacuously"
  );
  for (const [name, tool] of server.tools) {
    assert.equal(typeof tool.title, "string", `${name} is missing a title`);
    for (const hint of [
      "readOnlyHint",
      "destructiveHint",
      "idempotentHint",
      "openWorldHint",
    ]) {
      assert.equal(
        typeof tool.annotations?.[hint],
        "boolean",
        `${name} is missing an explicit boolean ${hint}`
      );
    }
  }
});
