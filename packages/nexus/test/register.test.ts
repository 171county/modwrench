import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerNexusTools } from "../src/register.js";
import type { Credential } from "@mcpwrench/core";

// ─── Mock MCP server that captures tool registrations ───────────────────────
// The real McpServer's `tool()` method registers handlers internally without
// exposing them. We don't need transport — we need to invoke handlers
// directly with stubbed fetch. This tiny mock captures the (name, description,
// schema, handler) tuples so tests can call them with any args.

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

class MockMcpServer {
  tools = new Map<
    string,
    { description: string; schema: unknown; handler: ToolHandler }
  >();

  tool(
    name: string,
    description: string,
    schema: unknown,
    handler: ToolHandler
  ): void {
    this.tools.set(name, { description, schema, handler });
  }

  invoke(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<ReturnType<ToolHandler>> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`tool not registered: ${name}`);
    return tool.handler(args);
  }
}

// ─── Test fixtures ───────────────────────────────────────────────────────────

const ENV_CRED: Credential = { source: "env", apiKey: "test-api-key-12345" };
const KEYCHAIN_CRED: Credential = {
  source: "keychain",
  accessToken: "oauth-token-67890",
  expiresAt: null,
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Capture every URL + headers fetch is called with for assertion. */
function captureFetch(
  responseFor: (url: string) => Response
): { calls: Array<{ url: string; headers: Headers }> } {
  const calls: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = async (url, init) => {
    const urlStr = url.toString();
    calls.push({ url: urlStr, headers: new Headers(init?.headers) });
    return responseFor(urlStr);
  };
  return { calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ─── Registration smoke tests ───────────────────────────────────────────────

test("registerNexusTools: registers 12 tools with env credential", () => {
  const server = new MockMcpServer();
  const result = registerNexusTools(server as unknown as never, ENV_CRED);
  assert.equal(result.toolCount, 12);
  assert.equal(server.tools.size, 12);
});

test("registerNexusTools: same tool count with keychain credential", () => {
  const server = new MockMcpServer();
  const result = registerNexusTools(server as unknown as never, KEYCHAIN_CRED);
  assert.equal(result.toolCount, 12);
});

test("registerNexusTools: exposes base URL", () => {
  const server = new MockMcpServer();
  const result = registerNexusTools(server as unknown as never, ENV_CRED);
  assert.ok(result.baseUrl.includes("nexusmods.com"));
});

test("registerNexusTools: every expected tool is present", () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, ENV_CRED);
  const expected = [
    "nexus_validate_key",
    "nexus_list_games",
    "nexus_get_mod",
    "nexus_latest_added",
    "nexus_latest_updated",
    "nexus_trending",
    "nexus_mod_files",
    "nexus_get_game",
    "nexus_get_file",
    "nexus_file_preview",
    "nexus_mod_changelogs",
    "nexus_md5_search",
  ];
  for (const name of expected) {
    assert.ok(server.tools.has(name), `missing tool: ${name}`);
  }
});

// ─── Auth header routing ─────────────────────────────────────────────────────

test("env credential routes auth to 'apikey' header", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() =>
    jsonResponse({ user_id: 1, name: "test", is_premium: false })
  );
  await server.invoke("nexus_validate_key");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.headers.get("apikey"), "test-api-key-12345");
  assert.equal(calls[0]?.headers.get("authorization"), null);
});

test("keychain credential routes auth to Authorization Bearer header", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, KEYCHAIN_CRED);
  const { calls } = captureFetch(() =>
    jsonResponse({ user_id: 1, name: "test", is_premium: false })
  );
  await server.invoke("nexus_validate_key");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.headers.get("authorization"),
    "Bearer oauth-token-67890"
  );
  assert.equal(calls[0]?.headers.get("apikey"), null);
});

// ─── Per-tool URL shape ──────────────────────────────────────────────────────

test("nexus_get_mod hits /games/{domain}/mods/{id}.json", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() => jsonResponse({ mod_id: 1840, name: "SkyUI" }));
  await server.invoke("nexus_get_mod", {
    game_domain: "skyrimspecialedition",
    mod_id: 1840,
  });
  assert.ok(
    calls[0]?.url.endsWith("/games/skyrimspecialedition/mods/1840.json"),
    `unexpected URL: ${calls[0]?.url}`
  );
});

test("nexus_list_games respects include_unapproved flag", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() => jsonResponse([]));
  await server.invoke("nexus_list_games", { include_unapproved: true });
  assert.ok(calls[0]?.url.includes("include_unapproved=true"));
});

test("nexus_md5_search hits the md5_search path", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() => jsonResponse([]));
  const hash = "a".repeat(32);
  await server.invoke("nexus_md5_search", {
    game_domain: "skyrim",
    md5_hash: hash,
  });
  assert.ok(
    calls[0]?.url.includes(`/games/skyrim/mods/md5_search/${hash}.json`),
    `unexpected URL: ${calls[0]?.url}`
  );
});

// ─── Error envelope propagation ──────────────────────────────────────────────

test("HTTP 401 surfaces as nexus_http_error", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, ENV_CRED);
  globalThis.fetch = async () =>
    new Response("Unauthorized", { status: 401 });
  await assert.rejects(
    () => server.invoke("nexus_validate_key"),
    (err: Error & { code?: string; status?: number }) =>
      err.code === "nexus_http_error" && err.status === 401
  );
});
