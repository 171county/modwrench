import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerModioTools } from "../src/register.js";
import type { Credential } from "@modwrench/core";

// Mock server pattern — same shape used in nexus + thunderstore tests.
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
  invoke(name: string, args: Record<string, unknown> = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`tool not registered: ${name}`);
    return tool.handler(args);
  }
}

const ENV_CRED: Credential = { source: "env", apiKey: "modio-test-key" };
const KEYCHAIN_CRED: Credential = {
  source: "keychain",
  accessToken: "modio-oauth-token",
  expiresAt: null,
};

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = originalFetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function captureFetch(responseFor: (url: string) => Response) {
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

function modioEnvelope<T>(rows: T[]): {
  data: T[];
  result_count: number;
  result_total: number;
  result_offset: number;
  result_limit: number;
} {
  return {
    data: rows,
    result_count: rows.length,
    result_total: rows.length,
    result_offset: 0,
    result_limit: 100,
  };
}

// ─── Registration smoke tests ───────────────────────────────────────────────

test("registerModioTools: registers 11 tools", () => {
  const server = new MockMcpServer();
  const result = registerModioTools(server as unknown as never, ENV_CRED);
  assert.equal(result.toolCount, 11);
  assert.equal(server.tools.size, 11);
});

test("registerModioTools: every expected tool is present", () => {
  const server = new MockMcpServer();
  registerModioTools(server as unknown as never, ENV_CRED);
  const expected = [
    "modio_list_games",
    "modio_get_game",
    "modio_list_mods",
    "modio_get_mod",
    "modio_search_mods",
    "modio_mod_files",
    "modio_popular",
    "modio_get_file",
    "modio_game_tags",
    "modio_mod_dependencies",
    "modio_top_games",
  ];
  for (const name of expected) {
    assert.ok(server.tools.has(name), `missing tool: ${name}`);
  }
});

// ─── mod.io's auth quirk: api_key as QUERY param, OAuth as Bearer header ────

test("env credential injects api_key into the query string", async () => {
  const server = new MockMcpServer();
  registerModioTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() => jsonResponse(modioEnvelope([])));
  await server.invoke("modio_list_games", { limit: 10 });
  assert.equal(calls.length, 1);
  assert.ok(
    calls[0]?.url.includes("api_key=modio-test-key"),
    `expected api_key in url, got: ${calls[0]?.url}`
  );
  // No Authorization header should be set on env path.
  assert.equal(calls[0]?.headers.get("authorization"), null);
});

test("keychain credential uses Authorization Bearer header (no api_key in URL)", async () => {
  const server = new MockMcpServer();
  registerModioTools(server as unknown as never, KEYCHAIN_CRED);
  const { calls } = captureFetch(() => jsonResponse(modioEnvelope([])));
  await server.invoke("modio_list_games", { limit: 10 });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.headers.get("authorization"),
    "Bearer modio-oauth-token"
  );
  assert.ok(
    !calls[0]?.url.includes("api_key="),
    "OAuth path should not include api_key in URL"
  );
});

// ─── Per-tool URL shape ──────────────────────────────────────────────────────

test("modio_get_mod hits /games/{game_id}/mods/{mod_id}", async () => {
  const server = new MockMcpServer();
  registerModioTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() => jsonResponse({ id: 42, name: "Test" }));
  await server.invoke("modio_get_mod", { game_id: 6195, mod_id: 42 });
  // Strip query params (api_key) before checking path
  const path = calls[0]?.url.split("?")[0];
  assert.ok(path?.endsWith("/games/6195/mods/42"));
});

test("modio_search_mods passes query and limit", async () => {
  const server = new MockMcpServer();
  registerModioTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() => jsonResponse(modioEnvelope([])));
  await server.invoke("modio_search_mods", {
    game_id: 1,
    query: "lighting",
    limit: 5,
  });
  assert.ok(calls[0]?.url.includes("_q=lighting"));
  assert.ok(calls[0]?.url.includes("_limit=5"));
});

test("modio_popular sorts by 'popular'", async () => {
  const server = new MockMcpServer();
  registerModioTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() => jsonResponse(modioEnvelope([])));
  await server.invoke("modio_popular", { game_id: 1, limit: 10 });
  assert.ok(calls[0]?.url.includes("_sort=popular"));
});

test("modio_top_games paginates and ranks server-side", async () => {
  const server = new MockMcpServer();
  registerModioTools(server as unknown as never, ENV_CRED);
  // Stub returns a single page so the pagination loop exits cleanly.
  globalThis.fetch = async () =>
    jsonResponse({
      data: [
        { id: 1, name: "Game A", name_id: "a", stats: { mods_count_total: 100 } },
        { id: 2, name: "Game B", name_id: "b", stats: { mods_count_total: 200 } },
      ],
      result_count: 2,
      result_total: 2,
      result_offset: 0,
      result_limit: 100,
    });
  const res = await server.invoke("modio_top_games", { metric: "mods", limit: 5 });
  // Output text should mention "Top X mod.io games by mods"
  const text = res.content[0]?.text ?? "";
  assert.ok(text.includes("mod.io games by mods"));
  // Game B (200 mods) should rank above Game A (100 mods).
  const indexA = text.indexOf('"name": "Game A"');
  const indexB = text.indexOf('"name": "Game B"');
  assert.ok(indexB < indexA, "Game B should appear before Game A in ranked output");
});

// ─── Error envelope propagation ──────────────────────────────────────────────

test("HTTP 401 surfaces as modio_http_error", async () => {
  const server = new MockMcpServer();
  registerModioTools(server as unknown as never, ENV_CRED);
  globalThis.fetch = async () =>
    new Response("Unauthorized", { status: 401 });
  await assert.rejects(
    () => server.invoke("modio_list_games", { limit: 1 }),
    (err: Error & { code?: string; status?: number }) =>
      err.code === "modio_http_error" && err.status === 401
  );
});
