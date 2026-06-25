import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerCurseForgeTools } from "../src/register.js";
import type { Credential } from "@modwrench/core";

// Mock server pattern — same shape used in nexus + modio tests.
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

const ENV_CRED: Credential = { source: "env", apiKey: "curseforge-test-key" };
const KEYCHAIN_CRED: Credential = {
  source: "keychain",
  accessToken: "curseforge-oauth-token",
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

// CurseForge wraps lists in { data, pagination }.
function cfList<T>(rows: T[]): {
  data: T[];
  pagination: {
    index: number;
    pageSize: number;
    resultCount: number;
    totalCount: number;
  };
} {
  return {
    data: rows,
    pagination: {
      index: 0,
      pageSize: 50,
      resultCount: rows.length,
      totalCount: rows.length,
    },
  };
}

// ─── Registration smoke tests ───────────────────────────────────────────────

test("registerCurseForgeTools: registers 10 tools", () => {
  const server = new MockMcpServer();
  const result = registerCurseForgeTools(server as unknown as never, ENV_CRED);
  assert.equal(result.toolCount, 10);
  assert.equal(server.tools.size, 10);
});

test("registerCurseForgeTools: every expected tool is present", () => {
  const server = new MockMcpServer();
  registerCurseForgeTools(server as unknown as never, ENV_CRED);
  const expected = [
    "curseforge_list_games",
    "curseforge_get_game",
    "curseforge_list_categories",
    "curseforge_search_mods",
    "curseforge_get_mod",
    "curseforge_get_mod_description",
    "curseforge_list_mod_files",
    "curseforge_get_mod_file",
    "curseforge_get_file_changelog",
    "curseforge_featured_mods",
  ];
  for (const name of expected) {
    assert.ok(server.tools.has(name), `missing tool: ${name}`);
  }
});

test("registerCurseForgeTools: baseUrl is the CurseForge Core API", () => {
  const server = new MockMcpServer();
  const result = registerCurseForgeTools(server as unknown as never, ENV_CRED);
  assert.equal(result.baseUrl, "https://api.curseforge.com");
});

// ─── Auth: env key goes in the x-api-key header ──────────────────────────────

test("env credential sends the API key in the x-api-key header", async () => {
  const server = new MockMcpServer();
  registerCurseForgeTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() => jsonResponse(cfList([])));
  await server.invoke("curseforge_list_games", { page_size: 10 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.headers.get("x-api-key"), "curseforge-test-key");
  // The key must NOT leak into the query string.
  assert.ok(
    !calls[0]?.url.includes("curseforge-test-key"),
    "API key should not appear in the URL"
  );
});

test("keychain credential uses Authorization Bearer header (no x-api-key)", async () => {
  const server = new MockMcpServer();
  registerCurseForgeTools(server as unknown as never, KEYCHAIN_CRED);
  const { calls } = captureFetch(() => jsonResponse(cfList([])));
  await server.invoke("curseforge_list_games", { page_size: 10 });
  assert.equal(
    calls[0]?.headers.get("authorization"),
    "Bearer curseforge-oauth-token"
  );
  assert.equal(calls[0]?.headers.get("x-api-key"), null);
});

// ─── Per-tool URL shape ──────────────────────────────────────────────────────

test("curseforge_get_mod hits /v1/mods/{mod_id}", async () => {
  const server = new MockMcpServer();
  registerCurseForgeTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() =>
    jsonResponse({ data: { id: 42, name: "Test" } })
  );
  await server.invoke("curseforge_get_mod", { mod_id: 42 });
  const path = calls[0]?.url.split("?")[0];
  assert.ok(path?.endsWith("/v1/mods/42"), `got: ${calls[0]?.url}`);
});

test("curseforge_search_mods passes gameId and searchFilter", async () => {
  const server = new MockMcpServer();
  registerCurseForgeTools(server as unknown as never, ENV_CRED);
  const { calls } = captureFetch(() => jsonResponse(cfList([])));
  await server.invoke("curseforge_search_mods", {
    game_id: 432,
    search_filter: "jei",
    page_size: 5,
  });
  assert.ok(calls[0]?.url.includes("gameId=432"));
  assert.ok(calls[0]?.url.includes("searchFilter=jei"));
  assert.ok(calls[0]?.url.includes("pageSize=5"));
});

test("curseforge_featured_mods POSTs gameId in the body to /v1/mods/featured", async () => {
  const server = new MockMcpServer();
  registerCurseForgeTools(server as unknown as never, ENV_CRED);
  const bodies: string[] = [];
  globalThis.fetch = async (url, init) => {
    bodies.push(String(init?.body ?? ""));
    assert.equal((init?.method ?? "GET"), "POST");
    assert.ok(url.toString().endsWith("/v1/mods/featured"));
    return jsonResponse({
      data: { featured: [], popular: [], recentlyUpdated: [] },
    });
  };
  await server.invoke("curseforge_featured_mods", { game_id: 432 });
  assert.ok(bodies[0]?.includes('"gameId":432'));
});

// ─── Error envelope propagation ──────────────────────────────────────────────

test("HTTP 401 surfaces as curseforge_http_error", async () => {
  const server = new MockMcpServer();
  registerCurseForgeTools(server as unknown as never, ENV_CRED);
  globalThis.fetch = async () =>
    new Response("Unauthorized", { status: 401 });
  await assert.rejects(
    () => server.invoke("curseforge_list_games", { page_size: 1 }),
    (err: Error & { code?: string; status?: number }) =>
      err.code === "curseforge_http_error" && err.status === 401
  );
});
