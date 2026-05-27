import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MetaCatalog, type PlatformDef } from "../src/catalog.js";

// MetaCatalog is tested against a mock McpServer (we don't need transport —
// just need to verify the catalog's bookkeeping + activation flow). The
// mock captures tool registrations and tracks sendToolListChanged calls.

class MockMcpServer {
  registered: string[] = [];
  notificationsSent = 0;

  tool(
    name: string,
    _description: string,
    _schema: unknown,
    _handler: unknown
  ): void {
    this.registered.push(name);
  }

  async sendToolListChanged(): Promise<void> {
    this.notificationsSent++;
  }
}

// ─── Test fixtures ──────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(() => {
  // Each test starts with a clean env so credential-based tests are
  // deterministic regardless of the dev machine's .env state.
  process.env = { ...originalEnv };
  delete process.env["NEXUS_API_KEY"];
  delete process.env["MODIO_API_KEY"];
});

afterEach(() => {
  process.env = { ...originalEnv };
});

/**
 * Synthetic platform set for catalog tests. Mirrors the real CLI's mix of
 * credentialed + local platforms without depending on the actual platform
 * package register functions.
 */
function makePlatforms(): PlatformDef[] {
  let nexusCalls = 0;
  let workbenchCalls = 0;
  return [
    {
      id: "nexus",
      kind: "credentialed",
      // Test-only register that just counts invocations and returns a
      // synthetic tool count. The McpServer mock ignores the actual
      // tool.() calls so we don't need real tool definitions.
      register: () => {
        nexusCalls++;
        return { toolCount: 12, baseUrl: "https://api.nexusmods.com/v1" };
      },
      envVar: "NEXUS_API_KEY",
      service: "nexus",
      authHint: "set NEXUS_API_KEY",
    },
    {
      id: "thunderstore",
      kind: "local",
      register: () => {
        workbenchCalls++;
        return { toolCount: 7, baseUrl: "https://thunderstore.io" };
      },
    },
    {
      id: "workbench",
      kind: "local",
      register: () => {
        workbenchCalls++;
        return { toolCount: 5 };
      },
    },
  ];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test("MetaCatalog.knownIds returns all platform identifiers", () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  assert.deepEqual(catalog.knownIds(), ["nexus", "thunderstore", "workbench"]);
});

test("activate: local platform succeeds and is tracked as active", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  const result = await catalog.activate("workbench");
  assert.equal(result.status, "active");
  if (result.status !== "active") return;
  assert.equal(result.alreadyActive, false);
  assert.equal(result.toolCount, 5);
  assert.equal(catalog.isActive("workbench"), true);
});

test("activate: credentialed platform fails without credential", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  const result = await catalog.activate("nexus");
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.match(result.reason, /NEXUS_API_KEY/);
  assert.equal(catalog.isActive("nexus"), false);
});

test("activate: credentialed platform succeeds with env credential", async () => {
  process.env["NEXUS_API_KEY"] = "fake-test-key";
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  const result = await catalog.activate("nexus");
  assert.equal(result.status, "active");
  assert.equal(catalog.isActive("nexus"), true);
});

test("activate: idempotent — second call returns alreadyActive=true", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  const first = await catalog.activate("workbench");
  assert.equal(first.status, "active");
  if (first.status !== "active") return;
  assert.equal(first.alreadyActive, false);

  const second = await catalog.activate("workbench");
  assert.equal(second.status, "active");
  if (second.status !== "active") return;
  assert.equal(second.alreadyActive, true);
});

test("activate: unknown platform returns status=unknown with helpful message", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  const result = await catalog.activate("not-a-platform");
  assert.equal(result.status, "unknown");
  if (result.status !== "unknown") return;
  assert.match(result.reason, /Unknown platform/);
  assert.match(result.reason, /nexus, thunderstore, workbench/);
});

test("activate: emits sendToolListChanged on first successful activation", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  assert.equal(server.notificationsSent, 0);
  await catalog.activate("workbench");
  assert.equal(server.notificationsSent, 1);
});

test("activate: does NOT emit notification on already-active no-op", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  await catalog.activate("workbench");
  assert.equal(server.notificationsSent, 1);
  await catalog.activate("workbench");
  assert.equal(server.notificationsSent, 1, "no notification when no change");
});

test("activate: does NOT emit notification on failed activation", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  await catalog.activate("nexus"); // fails, no creds
  assert.equal(server.notificationsSent, 0);
});

test("activateAll: activates every available platform, records failures", async () => {
  // Only workbench + thunderstore can activate (no nexus cred set).
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  await catalog.activateAll();
  const active = catalog.listActive();
  const failed = catalog.listFailed();
  assert.equal(active.length, 2);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.platformId, "nexus");
});

test("listActive includes toolCount and baseUrl when provided", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  await catalog.activate("thunderstore");
  const active = catalog.listActive();
  assert.equal(active.length, 1);
  assert.equal(active[0]?.platformId, "thunderstore");
  assert.equal(active[0]?.toolCount, 7);
  assert.equal(active[0]?.baseUrl, "https://thunderstore.io");
});

test("listActive omits baseUrl for local platforms that don't provide one", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  await catalog.activate("workbench");
  const active = catalog.listActive();
  assert.equal(active[0]?.platformId, "workbench");
  assert.equal(active[0]?.baseUrl, undefined);
});

test("retry: failed platform becomes active after env var is set", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(server as unknown as never, makePlatforms());
  const first = await catalog.activate("nexus");
  assert.equal(first.status, "failed");

  // Simulate the user running `modwrench auth login nexus` (here just env var).
  process.env["NEXUS_API_KEY"] = "now-available";
  const retry = await catalog.activate("nexus");
  assert.equal(retry.status, "active");
  assert.equal(catalog.isActive("nexus"), true);
  // Failure should clear from the listFailed snapshot after the retry.
  assert.equal(catalog.listFailed().length, 0);
});
