import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Credential } from "@modwrench/core";
import { registerNexusTools } from "@modwrench/nexus/register";
import { registerModioTools } from "@modwrench/modio/register";
import { registerThunderstoreTools } from "@modwrench/thunderstore/register";
import { registerWorkbenchTools } from "@modwrench/workbench/register";
import { MetaCatalog, type PlatformDef } from "../src/catalog.js";
import { registerDeckTool } from "../src/deck.js";
import { SERVER_INSTRUCTIONS } from "../src/instructions.js";

const CRED: Credential = { source: "apikey", apiKey: "fake-test-key" };

test("the first paragraph of the instructions stands on its own within 512 characters", () => {
  const first = SERVER_INSTRUCTIONS.split("\n\n")[0]!;
  assert.ok(first.length <= 512, `${first.length} characters`);
});

test("every tool the instructions name is a real tool, and a client gets them on connecting", async () => {
  const platforms: PlatformDef[] = [
    { id: "nexus", kind: "credentialed", register: registerNexusTools, service: "nexus", authHint: "nexus" },
    { id: "modio", kind: "credentialed", register: registerModioTools, service: "modio", authHint: "modio" },
    { id: "thunderstore", kind: "local", register: registerThunderstoreTools },
    { id: "workbench", kind: "local", register: registerWorkbenchTools },
  ];
  const server = new McpServer({ name: "modwrench", version: "0" }, { instructions: SERVER_INSTRUCTIONS });
  const catalog = new MetaCatalog(server, platforms, () => CRED);
  await catalog.activateAll();
  registerDeckTool(server, catalog);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    assert.equal(client.getInstructions(), SERVER_INSTRUCTIONS);
    // mw_activate_platform is registered by the boot script itself (src/index.ts), not the catalog.
    const real = new Set([...(await client.listTools()).tools.map((t) => t.name), "mw_activate_platform"]);
    const named = SERVER_INSTRUCTIONS.match(/\b(?:mw|nexus|modio|thunderstore)_[a-z_]+\b/g) ?? [];
    assert.ok(named.length > 5, "the check would pass vacuously");
    for (const name of named) assert.ok(real.has(name), `${name} is not a tool`);
  } finally {
    await client.close();
  }
});
