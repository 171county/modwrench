import { test } from "node:test";
import assert from "node:assert/strict";
import type { Credential } from "@modwrench/core";
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

// ─── Credential injection ─────────────────────────────────────────────────────
// Credentials come ONLY from the OS credential manager in production. Tests
// must never touch a real keychain, so we inject a resolver backed by an
// in-memory store. An empty store models "user has stored nothing" — the
// resolver throws exactly as core's loadCredential would.

type CredStore = Map<string, Credential>;

function makeResolver(store: CredStore) {
  return (opts: { service: string; authHint: string }): Credential => {
    const cred = store.get(opts.service);
    if (!cred) {
      throw new Error(
        `[modwrench/core] No credential found in your OS credential manager ` +
          `for "${opts.service}" (service "modwrench-${opts.service}", account ` +
          `"default"). ${opts.authHint}`
      );
    }
    return cred;
  };
}

const NEXUS_CRED: Credential = { source: "apikey", apiKey: "fake-test-key" };

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
      register: () => {
        nexusCalls++;
        return { toolCount: 12, baseUrl: "https://api.nexusmods.com/v1" };
      },
      service: "nexus",
      authHint: "Store your Nexus credential in your OS credential manager.",
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

/** Build a catalog whose credential resolver is backed by `store`. */
function makeCatalog(store: CredStore = new Map()): MetaCatalog {
  const server = new MockMcpServer();
  return new MetaCatalog(
    server as unknown as never,
    makePlatforms(),
    makeResolver(store)
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test("MetaCatalog.knownIds returns all platform identifiers", () => {
  const catalog = makeCatalog();
  assert.deepEqual(catalog.knownIds(), ["nexus", "thunderstore", "workbench"]);
});

test("activate: local platform succeeds and is tracked as active", async () => {
  const catalog = makeCatalog();
  const result = await catalog.activate("workbench");
  assert.equal(result.status, "active");
  if (result.status !== "active") return;
  assert.equal(result.alreadyActive, false);
  assert.equal(result.toolCount, 5);
  assert.equal(catalog.isActive("workbench"), true);
});

test("activate: credentialed platform fails without a stored credential", async () => {
  const catalog = makeCatalog(); // empty store — nothing in the OS cred manager
  const result = await catalog.activate("nexus");
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.match(result.reason, /OS credential manager/);
  assert.equal(catalog.isActive("nexus"), false);
});

test("activate: credentialed platform succeeds when a credential is stored", async () => {
  const store: CredStore = new Map([["nexus", NEXUS_CRED]]);
  const catalog = makeCatalog(store);
  const result = await catalog.activate("nexus");
  assert.equal(result.status, "active");
  assert.equal(catalog.isActive("nexus"), true);
});

test("activate: idempotent — second call returns alreadyActive=true", async () => {
  const catalog = makeCatalog();
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
  const catalog = makeCatalog();
  const result = await catalog.activate("not-a-platform");
  assert.equal(result.status, "unknown");
  if (result.status !== "unknown") return;
  assert.match(result.reason, /Unknown platform/);
  assert.match(result.reason, /nexus, thunderstore, workbench/);
});

test("activate: emits sendToolListChanged on first successful activation", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(
    server as unknown as never,
    makePlatforms(),
    makeResolver(new Map())
  );
  assert.equal(server.notificationsSent, 0);
  await catalog.activate("workbench");
  assert.equal(server.notificationsSent, 1);
});

test("activate: does NOT emit notification on already-active no-op", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(
    server as unknown as never,
    makePlatforms(),
    makeResolver(new Map())
  );
  await catalog.activate("workbench");
  assert.equal(server.notificationsSent, 1);
  await catalog.activate("workbench");
  assert.equal(server.notificationsSent, 1, "no notification when no change");
});

test("activate: does NOT emit notification on failed activation", async () => {
  const server = new MockMcpServer();
  const catalog = new MetaCatalog(
    server as unknown as never,
    makePlatforms(),
    makeResolver(new Map())
  );
  await catalog.activate("nexus"); // fails, no stored credential
  assert.equal(server.notificationsSent, 0);
});

test("activateAll: activates every available platform, records failures", async () => {
  // Only workbench + thunderstore can activate (no nexus credential stored).
  const catalog = makeCatalog();
  await catalog.activateAll();
  const active = catalog.listActive();
  const failed = catalog.listFailed();
  assert.equal(active.length, 2);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.platformId, "nexus");
});

test("listActive includes toolCount and baseUrl when provided", async () => {
  const catalog = makeCatalog();
  await catalog.activate("thunderstore");
  const active = catalog.listActive();
  assert.equal(active.length, 1);
  assert.equal(active[0]?.platformId, "thunderstore");
  assert.equal(active[0]?.toolCount, 7);
  assert.equal(active[0]?.baseUrl, "https://thunderstore.io");
});

test("listActive omits baseUrl for local platforms that don't provide one", async () => {
  const catalog = makeCatalog();
  await catalog.activate("workbench");
  const active = catalog.listActive();
  assert.equal(active[0]?.platformId, "workbench");
  assert.equal(active[0]?.baseUrl, undefined);
});

test("retry: failed platform becomes active after the credential is stored", async () => {
  // Start with nothing stored; the platform fails. Then simulate the user
  // placing their credential in the OS credential manager (here: adding it to
  // the injected store) and retry — activation should now succeed.
  const store: CredStore = new Map();
  const catalog = makeCatalog(store);
  const first = await catalog.activate("nexus");
  assert.equal(first.status, "failed");

  store.set("nexus", NEXUS_CRED);
  const retry = await catalog.activate("nexus");
  assert.equal(retry.status, "active");
  assert.equal(catalog.isActive("nexus"), true);
  // Failure should clear from the listFailed snapshot after the retry.
  assert.equal(catalog.listFailed().length, 0);
});
