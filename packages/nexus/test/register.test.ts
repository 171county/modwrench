import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerNexusTools } from "../src/register.js";
import type { Credential } from "@modwrench/core";

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

const APIKEY_CRED: Credential = { source: "apikey", apiKey: "test-api-key-12345" };
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

test("registerNexusTools: registers 15 tools with an apikey credential", () => {
  const server = new MockMcpServer();
  const result = registerNexusTools(server as unknown as never, APIKEY_CRED);
  assert.equal(result.toolCount, 15);
  assert.equal(server.tools.size, 15);
});

test("registerNexusTools: same tool count with keychain credential", () => {
  const server = new MockMcpServer();
  const result = registerNexusTools(server as unknown as never, KEYCHAIN_CRED);
  assert.equal(result.toolCount, 15);
});

test("registerNexusTools: exposes base URL", () => {
  const server = new MockMcpServer();
  const result = registerNexusTools(server as unknown as never, APIKEY_CRED);
  assert.ok(result.baseUrl.includes("nexusmods.com"));
});

test("registerNexusTools: every expected tool is present", () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
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
    "nexus_updated",
    "nexus_md5_search",
    "nexus_search",
  ];
  for (const name of expected) {
    assert.ok(server.tools.has(name), `missing tool: ${name}`);
  }
});

// ─── Auth header routing ─────────────────────────────────────────────────────

test("apikey credential routes auth to 'apikey' header", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
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
  registerNexusTools(server as unknown as never, APIKEY_CRED);
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
  registerNexusTools(server as unknown as never, APIKEY_CRED);
  const { calls } = captureFetch(() => jsonResponse([]));
  await server.invoke("nexus_list_games", { include_unapproved: true });
  assert.ok(calls[0]?.url.includes("include_unapproved=true"));
});

test("nexus_md5_search hits the md5_search path", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
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
  registerNexusTools(server as unknown as never, APIKEY_CRED);
  globalThis.fetch = async () =>
    new Response("Unauthorized", { status: 401 });
  await assert.rejects(
    () => server.invoke("nexus_validate_key"),
    (err: Error & { code?: string; status?: number }) =>
      err.code === "nexus_http_error" && err.status === 401
  );
});

// ─── Adult content filtering, through the real tool path ─────────────────────
// The unit tests in adult.test.ts prove the filter works. These prove it is
// actually wired into the request path, which is the part that could silently
// regress if someone adds a tool that bypasses nexusRequest.

test("adult filter: nexus_get_mod redacts a flagged mod", async () => {
  delete process.env.NEXUS_ALLOW_ADULT_CONTENT;
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
  captureFetch(() =>
    jsonResponse({
      mod_id: 99,
      name: "Flagged Mod",
      summary: "should not reach the model",
      contains_adult_content: true,
    })
  );

  const res = await server.invoke("nexus_get_mod", {
    game_domain: "skyrimspecialedition",
    mod_id: 99,
  });
  const text = res.content[0]!.text;
  assert.ok(text.includes("filtered"), "response should be marked filtered");
  assert.ok(
    !text.includes("should not reach the model"),
    "flagged content must not survive into the tool result"
  );
});

test("adult filter: list endpoints drop flagged entries but keep clean ones", async () => {
  delete process.env.NEXUS_ALLOW_ADULT_CONTENT;
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
  captureFetch(() =>
    jsonResponse([
      { mod_id: 1, name: "Clean Mod", contains_adult_content: false },
      { mod_id: 2, name: "Flagged Mod", contains_adult_content: true },
    ])
  );

  const res = await server.invoke("nexus_latest_added", {
    game_domain: "skyrimspecialedition",
  });
  const text = res.content[0]!.text;
  assert.ok(text.includes("Clean Mod"), "clean entries must survive");
  assert.ok(!text.includes("Flagged Mod"), "flagged entries must be dropped");
});

test("adult filter: operator opt-in lets flagged content through", async () => {
  process.env.NEXUS_ALLOW_ADULT_CONTENT = "true";
  try {
    const server = new MockMcpServer();
    registerNexusTools(server as unknown as never, APIKEY_CRED);
    captureFetch(() =>
      jsonResponse([
        { mod_id: 2, name: "Flagged Mod", contains_adult_content: true },
      ])
    );
    const res = await server.invoke("nexus_latest_added", {
      game_domain: "skyrimspecialedition",
    });
    assert.ok(res.content[0]!.text.includes("Flagged Mod"));
  } finally {
    delete process.env.NEXUS_ALLOW_ADULT_CONTENT;
  }
});

// ─── nexus_endorse_mod — the only write tool ─────────────────────────────────
// Playbook rule 1 says a write must perform NO upstream call unless
// confirm === true. That is the property worth guarding: a regression here
// would mean ModWrench silently acting on someone's Nexus account.

test("endorse: without confirm, performs NO network call and returns a preview", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
  const { calls } = captureFetch(() => jsonResponse({ status: "ok" }));

  const res = await server.invoke("nexus_endorse_mod", {
    game_domain: "skyrimspecialedition",
    mod_id: 3863,
    version: "5.2SE",
  });

  assert.equal(calls.length, 0, "preview must not touch the network");
  const text = res.content[0]!.text;
  assert.ok(text.includes("PREVIEW"));
  assert.ok(text.includes("nothing has been sent"));
  assert.ok(text.includes("confirm=true"), "must tell the model how to proceed");
});

test("endorse: confirm=false is treated as not confirmed", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
  const { calls } = captureFetch(() => jsonResponse({ status: "ok" }));

  await server.invoke("nexus_endorse_mod", {
    game_domain: "skyrimspecialedition",
    mod_id: 3863,
    version: "5.2SE",
    confirm: false,
  });
  assert.equal(calls.length, 0);
});

test("endorse: confirm=true POSTs to the endorse endpoint with the version", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
  const bodies: string[] = [];
  globalThis.fetch = async (url, init) => {
    bodies.push(String(init?.body ?? ""));
    assert.equal(init?.method, "POST");
    assert.ok(
      String(url).endsWith("/games/skyrimspecialedition/mods/3863/endorse.json"),
      `unexpected url: ${url}`
    );
    return jsonResponse({ status: "Endorsed" });
  };

  const res = await server.invoke("nexus_endorse_mod", {
    game_domain: "skyrimspecialedition",
    mod_id: 3863,
    version: "5.2SE",
    confirm: true,
  });
  assert.ok(bodies[0]!.includes("version=5.2SE"), "version must be sent");
  assert.ok(res.content[0]!.text.includes("Endorsed mod 3863"));
});

test("endorse: a 422 explains the likely cause instead of leaking a raw error", async () => {
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
  captureFetch(() => jsonResponse({ message: "Could not save" }, 422));

  const res = await server.invoke("nexus_endorse_mod", {
    game_domain: "skyrimspecialedition",
    mod_id: 3863,
    version: "5.2SE",
    confirm: true,
  });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("downloaded"));
});

test("endorse: the write path does not retry", async () => {
  // Playbook rule 2. A retried non-idempotent write could toggle state back.
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return jsonResponse({ message: "boom" }, 500);
  };

  await server
    .invoke("nexus_endorse_mod", {
      game_domain: "skyrimspecialedition",
      mod_id: 3863,
      version: "5.2SE",
      confirm: true,
    })
    .catch(() => undefined);

  assert.equal(attempts, 1, "a 5xx on a write must not be retried");
});

test("endorse: description is loudly marked as a write action", () => {
  // Playbook rule 3 — the model only knows this is dangerous if we say so.
  const server = new MockMcpServer();
  registerNexusTools(server as unknown as never, APIKEY_CRED);
  const tool = server.tools.get("nexus_endorse_mod");
  assert.ok(tool);
  assert.ok(tool!.description.startsWith("WRITE ACTION"));
  assert.ok(tool!.description.includes("confirm=true"));
});
