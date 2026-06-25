---
name: build-test
description: Generate the standard fetch-mocked test scaffold for a platform package or a newly added tool. Manual triggers "scaffold a test", "build a test for X", "add tests for the new tool", "write the standard test", "test the new platform".
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Build: Test

Tests for platform packages follow one shape across every wrench: a fetch-mocked MockMcpServer, registration smoke tests, auth-header routing tests, per-tool URL-shape tests, and HTTP error-envelope tests. Writes get three extra tests (preview-sends-nothing, confirm performs the action, no-retry-on-5xx).

The reference implementations are `modwrench/packages/thunderstore/test/register.test.ts` (anonymous) and `mynewrench/packages/roblox/test/register.test.ts` (credentialed + writes). Mirror them.

## Prerequisites
- Load `wrench-cerebral` (the substrate entry) before proceeding.
- `wrench-playbook` and `wrench-code-master` set conventions; `build-tool` is the upstream context if the test is for a tool that was just scaffolded.

## What gets tested (and what doesn't)

**Yes:**
- That the right number of tools register.
- That every expected tool name is present.
- That URLs hit the right path with the right query params.
- That auth headers land in the right shape (`Authorization: Bearer ...` vs `apikey: ...`) based on credential source.
- That non-2xx upstream responses surface as the right `McpwrenchError` code with the right status.
- For writes: that preview makes no network call, that confirm makes exactly one, and that a 5xx is not retried.

**No:**
- Integration against the live platform API. The CI runs offline. Live smoke is a manual step before PR (see `docs/adding-a-platform.md` § 7).
- Deep response-shape assertions. Test the contract (URL, headers, error envelope), not the upstream payload — it changes underneath you and breaks every test for no reason.

## File location

`packages/<platform>/test/register.test.ts`. The `test` script in `package.json` is `node --import tsx --test test/*.test.ts`. Add more files (`auth.test.ts`, etc.) as siblings.

## Copy-pasteable skeleton

This is the full file. TODOs mark what to customize per tool/platform.

```typescript
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
// TODO: import the actual register function for your platform.
import { registerXTools } from "../src/register.js";

// ─── MockMcpServer ──────────────────────────────────────────────────────────
// Captures tool registrations so tests can invoke handlers and assert on what
// they did. Mirrors the shape in modwrench/packages/thunderstore/test/.

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
    handler: ToolHandler,
  ): void {
    this.tools.set(name, { description, schema, handler });
  }
  invoke(name: string, args: Record<string, unknown> = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`tool not registered: ${name}`);
    return tool.handler(args);
  }
}

// ─── fetch stub helpers ─────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = originalFetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function captureFetch(responseFor: (url: string) => Response) {
  const calls: Array<{ url: string; headers: Headers; method: string; body?: string }> = [];
  globalThis.fetch = async (url, init) => {
    const urlStr = url.toString();
    calls.push({
      url: urlStr,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return responseFor(urlStr);
  };
  return { calls };
}

// ─── Credential fixtures ────────────────────────────────────────────────────
// TODO: drop these for anonymous platforms (e.g. Thunderstore, Modrinth).

const keychainCred = {
  source: "keychain" as const,
  accessToken: "test-bearer-token",
};
const envCred = {
  source: "env" as const,
  apiKey: "test-api-key",
};

// ─── Registration smoke tests ───────────────────────────────────────────────

test("registerXTools: registers the expected number of tools", () => {
  const server = new MockMcpServer();
  // TODO: drop the credential arg for anonymous platforms.
  const result = registerXTools(server as unknown as never, keychainCred);
  assert.equal(result.toolCount, /* TODO: N */ 0);
  assert.equal(server.tools.size, /* TODO: N */ 0);
});

test("registerXTools: every expected tool is present", () => {
  const server = new MockMcpServer();
  registerXTools(server as unknown as never, keychainCred);
  const expected = [
    // TODO: list every tool name your register function emits.
    "x_get_thing",
    "x_list_things",
  ];
  for (const name of expected) {
    assert.ok(server.tools.has(name), `missing tool: ${name}`);
  }
});

// ─── Auth header routing ────────────────────────────────────────────────────
// Drop this whole block for anonymous platforms. For anonymous, replace with a
// single test asserting Authorization and apikey are NOT present.

test("auth routing: keychain credential → Authorization: Bearer", async () => {
  const server = new MockMcpServer();
  registerXTools(server as unknown as never, keychainCred);
  const { calls } = captureFetch(() => jsonResponse({ ok: true }));
  // TODO: pick a tool that makes a single request with minimal args.
  await server.invoke("x_get_thing", { thing_id: 1 });
  assert.equal(
    calls[0]?.headers.get("authorization"),
    "Bearer test-bearer-token",
  );
  assert.equal(calls[0]?.headers.get("apikey"), null);
});

test("auth routing: env credential → apikey header", async () => {
  const server = new MockMcpServer();
  registerXTools(server as unknown as never, envCred);
  const { calls } = captureFetch(() => jsonResponse({ ok: true }));
  await server.invoke("x_get_thing", { thing_id: 1 });
  assert.equal(calls[0]?.headers.get("apikey"), "test-api-key");
  assert.equal(calls[0]?.headers.get("authorization"), null);
});

// ─── Per-tool URL shape ─────────────────────────────────────────────────────
// One test per tool. Asserts the URL path, query params, and method.

test("x_get_thing hits /things/{id}", async () => {
  const server = new MockMcpServer();
  registerXTools(server as unknown as never, keychainCred);
  const { calls } = captureFetch(() => jsonResponse({ id: 42, name: "t" }));
  await server.invoke("x_get_thing", { thing_id: 42 });
  assert.ok(
    calls[0]?.url.endsWith("/things/42"),
    `unexpected URL: ${calls[0]?.url}`,
  );
  assert.equal(calls[0]?.method, "GET");
});

test("x_list_things passes pagination query params", async () => {
  const server = new MockMcpServer();
  registerXTools(server as unknown as never, keychainCred);
  const { calls } = captureFetch(() => jsonResponse({ results: [] }));
  await server.invoke("x_list_things", { limit: 50, offset: 100 });
  assert.ok(calls[0]?.url.includes("limit=50"));
  assert.ok(calls[0]?.url.includes("offset=100"));
});

// ─── Write tool tests (drop this block if the platform has no writes) ───────

test("x_publish_thing preview: confirm omitted → no fetch call", async () => {
  const server = new MockMcpServer();
  registerXTools(server as unknown as never, keychainCred);
  const { calls } = captureFetch(() => jsonResponse({ version_id: 99 }));
  const res = await server.invoke("x_publish_thing", {
    thing_id: 1,
    version: "1.0.0",
    payload: "hello",
  });
  assert.equal(calls.length, 0, "preview must not hit the network");
  assert.ok(res.content[0]?.text.includes("PREVIEW"));
  assert.ok(res.content[0]?.text.includes("confirm: true"));
});

test("x_publish_thing confirm=true → exactly one POST", async () => {
  const server = new MockMcpServer();
  registerXTools(server as unknown as never, keychainCred);
  const { calls } = captureFetch(() => jsonResponse({ version_id: 99 }));
  const res = await server.invoke("x_publish_thing", {
    thing_id: 1,
    version: "1.0.0",
    payload: "hello",
    confirm: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "POST");
  assert.ok(calls[0]?.url.endsWith("/things/1/versions"));
  assert.ok(res.content[0]?.text.includes("version_id=99"));
});

test("x_publish_thing on 502: writeClient does NOT retry", async () => {
  const server = new MockMcpServer();
  registerXTools(server as unknown as never, keychainCred);
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response("Bad Gateway", { status: 502 });
  };
  await assert.rejects(
    () =>
      server.invoke("x_publish_thing", {
        thing_id: 1,
        version: "1.0.0",
        payload: "hello",
        confirm: true,
      }),
    (err: Error & { code?: string }) => err.code === "x_http_error",
  );
  assert.equal(attempts, 1, "writeClient must not retry on 5xx");
});

// ─── HTTP error envelope ────────────────────────────────────────────────────

test("HTTP 404 surfaces as x_http_error with status 404", async () => {
  const server = new MockMcpServer();
  registerXTools(server as unknown as never, keychainCred);
  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  await assert.rejects(
    () => server.invoke("x_get_thing", { thing_id: 999 }),
    (err: Error & { code?: string; status?: number }) =>
      err.code === "x_http_error" && err.status === 404,
  );
});

test("HTTP 401 surfaces as x_http_error with status 401", async () => {
  const server = new MockMcpServer();
  registerXTools(server as unknown as never, keychainCred);
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
  await assert.rejects(
    () => server.invoke("x_get_thing", { thing_id: 1 }),
    (err: Error & { code?: string; status?: number }) =>
      err.code === "x_http_error" && err.status === 401,
  );
});
```

## Per-flavor adjustments

**Anonymous platform (no credential arg):**
- Drop `keychainCred` / `envCred` fixtures.
- Drop both auth-routing tests; add one assertion that `Authorization` and `apikey` are absent and `User-Agent` is present. Mirror `modwrench/packages/thunderstore/test/register.test.ts`.
- Call sites: `registerXTools(server as unknown as never)` — no second arg.

**Read-only platform (no writes):**
- Drop the entire write-tool block.

**Write-capable platform:**
- Keep all three write tests per write tool: preview-no-fetch, confirm-makes-POST, no-retry-on-5xx.
- The no-retry test is the load-bearing one — it's what proves the writeClient was declared with `retry: { maxAttempts: 1 }`. If this test passes against a default-retry client, the retry config drifted.

## Running

```
cd packages/<platform>
npm test
```

From the workspace root, `npm test` runs every package's tests in workspace order.

## After tests pass

1. Run a live smoke against the standalone bin (see `docs/adding-a-platform.md` § 7) for at least one tool. Mocks lie sometimes; the live API doesn't.
2. Commit with DCO: `git commit -s -m "test(<platform>): add register tests"`.

## What not to do

- **Don't assert deep response shapes.** The upstream payload changes; your test breaks; nobody learns anything from the failure. Test the contract.
- **Don't share `globalThis.fetch` state between tests.** The `beforeEach`/`afterEach` resets are non-negotiable — without them, test order matters and CI flakes.
- **Don't write a test that hits the real API.** Even if you're "just checking". CI runs offline; flaky network = flaky CI.
- **Don't skip the no-retry test on write tools.** It's the only thing standing between a flaky upstream and a duplicate side effect in production.
