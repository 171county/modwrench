import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerModrinthTools } from "../src/register.js";

// Mock server pattern — same shape used in nexus + modio + thunderstore tests.
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

// ─── Registration smoke tests ───────────────────────────────────────────────

test("registerModrinthTools: registers 7 tools (no creds required)", () => {
  const server = new MockMcpServer();
  const result = registerModrinthTools(server as unknown as never);
  assert.equal(result.toolCount, 7);
  assert.equal(server.tools.size, 7);
});

test("registerModrinthTools: every expected tool is present", () => {
  const server = new MockMcpServer();
  registerModrinthTools(server as unknown as never);
  const expected = [
    "modrinth_search",
    "modrinth_get_project",
    "modrinth_get_versions",
    "modrinth_get_version",
    "modrinth_list_categories",
    "modrinth_list_loaders",
    "modrinth_list_game_versions",
  ];
  for (const name of expected) {
    assert.ok(server.tools.has(name), `missing tool: ${name}`);
  }
});

// ─── Anonymous auth (no header injection) ───────────────────────────────────

test("anonymous public API: no Authorization or apikey header sent", async () => {
  const server = new MockMcpServer();
  registerModrinthTools(server as unknown as never);
  const { calls } = captureFetch(() =>
    jsonResponse({ hits: [], offset: 0, limit: 20, total_hits: 0 })
  );
  await server.invoke("modrinth_search", { query: "test" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.headers.get("authorization"), null);
  assert.equal(calls[0]?.headers.get("apikey"), null);
  // User-Agent should still be set per Modrinth's ToS.
  assert.ok(calls[0]?.headers.get("user-agent")?.includes("ModWrench"));
});

// ─── Per-tool URL shape ──────────────────────────────────────────────────────

test("modrinth_search hits /v2/search with query and facets", async () => {
  const server = new MockMcpServer();
  registerModrinthTools(server as unknown as never);
  const { calls } = captureFetch(() =>
    jsonResponse({ hits: [], offset: 0, limit: 20, total_hits: 0 })
  );
  await server.invoke("modrinth_search", {
    query: "sodium",
    project_type: "mod",
    loader: "fabric",
    game_version: "1.20.1",
  });
  const url = calls[0]?.url ?? "";
  assert.ok(url.includes("/v2/search"));
  assert.ok(url.includes("query=sodium"));
  // facets should be a JSON-encoded nested array
  assert.ok(url.includes("facets="));
  // Decode the facets param value to verify the structure
  const facetsParam = new URL(url).searchParams.get("facets");
  assert.ok(facetsParam, "facets param should be present");
  const facets = JSON.parse(facetsParam!);
  assert.deepEqual(facets, [
    ["project_type:mod"],
    ["categories:fabric"],
    ["versions:1.20.1"],
  ]);
});

test("modrinth_search without filters omits facets param", async () => {
  const server = new MockMcpServer();
  registerModrinthTools(server as unknown as never);
  const { calls } = captureFetch(() =>
    jsonResponse({ hits: [], offset: 0, limit: 20, total_hits: 0 })
  );
  await server.invoke("modrinth_search", { query: "performance" });
  const url = calls[0]?.url ?? "";
  assert.ok(!new URL(url).searchParams.has("facets"));
});

test("modrinth_get_project hits /v2/project/{slug}", async () => {
  const server = new MockMcpServer();
  registerModrinthTools(server as unknown as never);
  const { calls } = captureFetch(() =>
    jsonResponse({ id: "AANobbMI", slug: "sodium", title: "Sodium" })
  );
  await server.invoke("modrinth_get_project", { id_or_slug: "sodium" });
  assert.ok(calls[0]?.url.endsWith("/v2/project/sodium"));
});

test("modrinth_get_versions filters by loaders and game_versions as JSON arrays", async () => {
  const server = new MockMcpServer();
  registerModrinthTools(server as unknown as never);
  const { calls } = captureFetch(() => jsonResponse([]));
  await server.invoke("modrinth_get_versions", {
    id_or_slug: "sodium",
    loaders: ["fabric", "quilt"],
    game_versions: ["1.20.1"],
  });
  const url = calls[0]?.url ?? "";
  assert.ok(url.includes("/v2/project/sodium/version"));
  const params = new URL(url).searchParams;
  assert.deepEqual(JSON.parse(params.get("loaders")!), ["fabric", "quilt"]);
  assert.deepEqual(JSON.parse(params.get("game_versions")!), ["1.20.1"]);
});

test("modrinth_list_game_versions filters to release type when release_only=true", async () => {
  const server = new MockMcpServer();
  registerModrinthTools(server as unknown as never);
  globalThis.fetch = async () =>
    jsonResponse([
      { version: "1.21", version_type: "release", date: "2024", major: true },
      {
        version: "1.21-pre1",
        version_type: "snapshot",
        date: "2024",
        major: false,
      },
      { version: "1.20.1", version_type: "release", date: "2023", major: false },
    ]);
  const res = await server.invoke("modrinth_list_game_versions", {
    release_only: true,
  });
  const text = res.content[0]?.text ?? "";
  assert.ok(text.includes('"version": "1.21"'));
  assert.ok(text.includes('"version": "1.20.1"'));
  assert.ok(!text.includes("1.21-pre1"), "snapshot should be filtered out");
});

// ─── Error envelope propagation ──────────────────────────────────────────────

test("HTTP 404 on get_project surfaces as modrinth_http_error", async () => {
  const server = new MockMcpServer();
  registerModrinthTools(server as unknown as never);
  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  await assert.rejects(
    () =>
      server.invoke("modrinth_get_project", {
        id_or_slug: "definitely-not-real",
      }),
    (err: Error & { code?: string; status?: number }) =>
      err.code === "modrinth_http_error" && err.status === 404
  );
});
