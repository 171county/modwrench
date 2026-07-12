import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerThunderstoreTools } from "../src/register.js";

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

test("registerThunderstoreTools: registers 8 tools (no creds required)", () => {
  const server = new MockMcpServer();
  const result = registerThunderstoreTools(server as unknown as never);
  assert.equal(result.toolCount, 8);
  assert.equal(server.tools.size, 8);
});

test("registerThunderstoreTools: every expected tool is present", () => {
  const server = new MockMcpServer();
  registerThunderstoreTools(server as unknown as never);
  const expected = [
    "thunderstore_list_communities",
    "thunderstore_get_community",
    "thunderstore_list_mods",
    "thunderstore_get_mod",
    "thunderstore_search_mods",
    "thunderstore_mod_versions",
    "thunderstore_top_mods",
    "thunderstore_mod_dependencies",
  ];
  for (const name of expected) {
    assert.ok(server.tools.has(name), `missing tool: ${name}`);
  }
});

// ─── Anonymous auth (no header injection) ───────────────────────────────────

test("anonymous public API: no Authorization or apikey header sent", async () => {
  const server = new MockMcpServer();
  registerThunderstoreTools(server as unknown as never);
  const { calls } = captureFetch(() =>
    jsonResponse({
      pagination: { next_link: null, previous_link: null },
      results: [],
    })
  );
  await server.invoke("thunderstore_list_communities");
  assert.ok(calls.length >= 1);
  assert.equal(calls[0]?.headers.get("authorization"), null);
  assert.equal(calls[0]?.headers.get("apikey"), null);
  // User-Agent should still be set.
  assert.ok(calls[0]?.headers.get("user-agent")?.includes("ModWrench"));
});

// ─── Pagination handling ─────────────────────────────────────────────────────

test("thunderstore_list_communities walks pagination via next_link", async () => {
  const server = new MockMcpServer();
  registerThunderstoreTools(server as unknown as never);
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    const urlStr = url.toString();
    if (urlStr.includes("page=1")) {
      return jsonResponse({
        pagination: {
          next_link: "https://thunderstore.io/api/experimental/community/?page=2",
          previous_link: null,
        },
        results: [{ identifier: "lethal-company", name: "Lethal Company" }],
      });
    }
    return jsonResponse({
      pagination: { next_link: null, previous_link: null },
      results: [{ identifier: "valheim", name: "Valheim" }],
    });
  };
  const res = await server.invoke("thunderstore_list_communities");
  assert.equal(calls, 2);
  // Output should contain both communities from the two pages.
  const text = res.content[0]?.text ?? "";
  assert.ok(text.includes("lethal-company"));
  assert.ok(text.includes("valheim"));
});

test("thunderstore_get_community early-exits when match found on page 1", async () => {
  const server = new MockMcpServer();
  registerThunderstoreTools(server as unknown as never);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({
      pagination: {
        next_link: "https://thunderstore.io/api/experimental/community/?page=2",
        previous_link: null,
      },
      results: [
        { identifier: "lethal-company", name: "Lethal Company" },
        { identifier: "valheim", name: "Valheim" },
      ],
    });
  };
  const res = await server.invoke("thunderstore_get_community", {
    identifier: "lethal-company",
  });
  // Should have early-exited on page 1, not fetched page 2.
  assert.equal(calls, 1);
  assert.ok(res.content[0]?.text.includes("Lethal Company"));
});

test("thunderstore_get_community throws when not found across all pages", async () => {
  const server = new MockMcpServer();
  registerThunderstoreTools(server as unknown as never);
  globalThis.fetch = async () =>
    jsonResponse({
      pagination: { next_link: null, previous_link: null },
      results: [{ identifier: "some-game", name: "Some Game" }],
    });
  await assert.rejects(
    () => server.invoke("thunderstore_get_community", { identifier: "bogus" }),
    (err: Error & { code?: string }) =>
      err.code === "thunderstore_community_not_found"
  );
});

// ─── Per-tool URL shape ──────────────────────────────────────────────────────

test("thunderstore_get_mod hits /api/experimental/package/{ns}/{name}/", async () => {
  const server = new MockMcpServer();
  registerThunderstoreTools(server as unknown as never);
  const { calls } = captureFetch(() =>
    jsonResponse({ name: "BepInExPack", owner: "BepInEx" })
  );
  await server.invoke("thunderstore_get_mod", {
    namespace: "BepInEx",
    name: "BepInExPack",
  });
  assert.ok(
    calls[0]?.url.endsWith("/api/experimental/package/BepInEx/BepInExPack/"),
    `unexpected URL: ${calls[0]?.url}`
  );
});

test("thunderstore_top_mods sorts by rating_score descending", async () => {
  const server = new MockMcpServer();
  registerThunderstoreTools(server as unknown as never);
  globalThis.fetch = async () =>
    jsonResponse([
      {
        name: "Low",
        full_name: "a-Low",
        owner: "a",
        package_url: "u1",
        rating_score: 10,
        versions: [{ version_number: "1.0", downloads: 0 }],
      },
      {
        name: "High",
        full_name: "b-High",
        owner: "b",
        package_url: "u2",
        rating_score: 100,
        versions: [{ version_number: "1.0", downloads: 0 }],
      },
      {
        name: "Mid",
        full_name: "c-Mid",
        owner: "c",
        package_url: "u3",
        rating_score: 50,
        versions: [{ version_number: "1.0", downloads: 0 }],
      },
    ]);
  const res = await server.invoke("thunderstore_top_mods", {
    community: "lethal-company",
    limit: 3,
  });
  const text = res.content[0]?.text ?? "";
  const indexHigh = text.indexOf('"name": "High"');
  const indexMid = text.indexOf('"name": "Mid"');
  const indexLow = text.indexOf('"name": "Low"');
  assert.ok(
    indexHigh < indexMid && indexMid < indexLow,
    "expected High > Mid > Low ordering"
  );
});

test("thunderstore_search_mods filters by case-insensitive substring", async () => {
  const server = new MockMcpServer();
  registerThunderstoreTools(server as unknown as never);
  globalThis.fetch = async () =>
    jsonResponse([
      {
        name: "MoreCompany",
        full_name: "x-MoreCompany",
        owner: "x",
        package_url: "u",
        rating_score: 1,
        versions: [{ version_number: "1.0", downloads: 0 }],
      },
      {
        name: "BetterEmotes",
        full_name: "y-BetterEmotes",
        owner: "y",
        package_url: "u",
        rating_score: 1,
        versions: [{ version_number: "1.0", downloads: 0 }],
      },
    ]);
  const res = await server.invoke("thunderstore_search_mods", {
    community: "lethal-company",
    query: "company",
  });
  const text = res.content[0]?.text ?? "";
  assert.ok(text.includes("MoreCompany"));
  assert.ok(!text.includes("BetterEmotes"));
});

// ─── Error envelope propagation ──────────────────────────────────────────────

test("HTTP 404 on list_mods surfaces as thunderstore_http_error", async () => {
  const server = new MockMcpServer();
  registerThunderstoreTools(server as unknown as never);
  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  await assert.rejects(
    () =>
      server.invoke("thunderstore_list_mods", { community: "bogus-game" }),
    (err: Error & { code?: string; status?: number }) =>
      err.code === "thunderstore_http_error" && err.status === 404
  );
});
