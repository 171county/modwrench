import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Credential } from "@modwrench/core";
import { registerNexusTools } from "@modwrench/nexus/register";
import { registerModioTools } from "@modwrench/modio/register";
import { registerThunderstoreTools } from "@modwrench/thunderstore/register";
import { registerWorkbenchTools } from "@modwrench/workbench/register";
import { MCP_APP_MIME } from "@modwrench/ui";
import { MetaCatalog, type PlatformDef } from "../src/catalog.js";
import { registerDeckTool } from "../src/deck.js";
import { DRAWS_PAGES } from "./helpers/apps-server.js";

// ─── Every page, end to end, on the real SDK ─────────────────────────────────
// The same server the CLI boots (all four platforms through the catalog, plus
// mw_deck), with a real Client over the SDK's in-memory transport. The per-package
// tests use a stand-in server; this is where the SDK's own behaviour is pinned:
// several packages asking for one page get one resource, a platform activated after
// connecting points at the page that is already there, and what a client declares
// when it connects decides whether it gets structured data.

/** Which tool points at which page. Every other tool points at none. */
const PAGE_OF: Record<string, string> = {
  thunderstore_list_mods: "ui://modwrench/mods",
  thunderstore_search_mods: "ui://modwrench/mods",
  thunderstore_top_mods: "ui://modwrench/mods",
  nexus_trending: "ui://modwrench/mods",
  modio_list_mods: "ui://modwrench/mods",
  modio_search_mods: "ui://modwrench/mods",
  mw_query_mod_metadata: "ui://modwrench/mods",
  thunderstore_mod_dependencies: "ui://modwrench/deps",
  thunderstore_resolve_dependencies: "ui://modwrench/deps",
  mw_read_load_order: "ui://modwrench/deps",
  mw_parse_crashlog: "ui://modwrench/crash",
  mw_diagnose_crash: "ui://modwrench/crash",
  mw_check_known_conflicts: "ui://modwrench/conflicts",
  mw_deck: "ui://modwrench/deck",
  mw_patch_day: "ui://modwrench/patch-day",
  mw_crash_whisperer: "ui://modwrench/crash-whisperer",
  mw_doctor: "ui://modwrench/doctor",
};
const URIS = [...new Set(Object.values(PAGE_OF))].sort();

/** One call per page that needs no network, a real mod platform or the player's files. */
const CALLS: Array<{ name: string; args: Record<string, unknown>; view: string }> = [
  { name: "thunderstore_list_mods", args: { community: "lethal-company" }, view: "mods" },
  { name: "mw_read_load_order", args: { gameId: "nosuchgame" }, view: "deps" },
  { name: "mw_parse_crashlog", args: { logContent: "not a crash log" }, view: "crash" },
  { name: "mw_check_known_conflicts", args: { gameId: "lethalcompany", modIds: ["thunderstore:A-B", "thunderstore:C-D"] }, view: "conflicts" },
  { name: "mw_deck", args: {}, view: "deck" },
];

const PACKAGES = [
  {
    name: "CoolMod",
    full_name: "Someone-CoolMod",
    owner: "Someone",
    package_url: "https://thunderstore.io/c/lethal-company/p/Someone/CoolMod/",
    rating_score: 7,
    is_pinned: false,
    is_deprecated: false,
    categories: ["Misc"],
    versions: [{ version_number: "1.0.0", downloads: 10, date_created: "2026-01-01T00:00:00Z" }],
  },
];

// Thunderstore answers with one package; anything else (LOOT's masterlist) fails, so
// nothing here reaches the network.
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async (input: unknown) =>
    String(input).includes("thunderstore.io")
      ? new Response(JSON.stringify(PACKAGES), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("", { status: 500 })) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

const CRED: Credential = { source: "apikey", apiKey: "fake-test-key" };

/** The CLI's server: nexus and mod.io activate if `store` holds their credential. */
async function boot(store: Map<string, Credential>): Promise<{ server: McpServer; catalog: MetaCatalog }> {
  const platforms: PlatformDef[] = [
    { id: "nexus", kind: "credentialed", register: registerNexusTools, service: "nexus", authHint: "nexus" },
    { id: "modio", kind: "credentialed", register: registerModioTools, service: "modio", authHint: "modio" },
    { id: "thunderstore", kind: "local", register: registerThunderstoreTools },
    { id: "workbench", kind: "local", register: registerWorkbenchTools },
  ];
  const server = new McpServer(
    { name: "modwrench", version: "0" },
    { capabilities: { tools: { listChanged: true }, prompts: {} } }
  );
  const catalog = new MetaCatalog(server, platforms, ({ service }) => {
    const cred = store.get(service);
    if (!cred) throw new Error(`no credential for ${service}`);
    return cred;
  });
  await catalog.activateAll();
  registerDeckTool(server, catalog);
  return { server, catalog };
}

async function connect(server: McpServer, capabilities: Record<string, unknown>): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" }, { capabilities });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const pageOf = (tool: { _meta?: Record<string, unknown> }): string | undefined =>
  (tool._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri;

test("a client that draws pages: each tool points at its page, each page is listed once, and the answers carry the data", async () => {
  const { server } = await boot(new Map([["nexus", CRED], ["modio", CRED]]));
  const client = await connect(server, DRAWS_PAGES);
  try {
    const { tools } = await client.listTools();
    const advertised = Object.fromEntries(tools.filter((t) => pageOf(t) !== undefined).map((t) => [t.name, pageOf(t)]));
    assert.deepEqual(advertised, PAGE_OF);

    const { resources } = await client.listResources();
    assert.deepEqual(resources.map((r) => r.uri).sort(), URIS, "each page is listed exactly once");
    for (const uri of URIS) {
      const read = await client.readResource({ uri });
      assert.equal(read.contents.length, 1, uri);
      const item = read.contents[0] as { mimeType?: string; text?: string };
      assert.equal(item.mimeType, MCP_APP_MIME, uri);
      assert.match(item.text ?? "", /^<!doctype html>/i, uri);
    }

    for (const call of CALLS) {
      const result = await client.callTool({ name: call.name, arguments: call.args });
      assert.equal((result.structuredContent as { view?: string } | undefined)?.view, call.view, call.name);
      assert.equal((result.content as unknown[]).length, 1, `${call.name}: the text answer and nothing else`);
    }
  } finally {
    await client.close();
  }
});

test("a text-only client gets one text item and no HTML or structured data from any page tool", async () => {
  const { server } = await boot(new Map());
  const client = await connect(server, {});
  try {
    for (const call of CALLS) {
      const result = await client.callTool({ name: call.name, arguments: call.args });
      const content = result.content as Array<{ type: string }>;
      assert.equal(content.length, 1, call.name);
      assert.equal(content[0]!.type, "text", call.name);
      assert.equal("structuredContent" in result, false, call.name);
      const json = JSON.stringify(result);
      for (const marker of ["<!doctype", "<html", "<script", "text/html", '"resource"']) assert.ok(!json.includes(marker), `${call.name}: ${marker}`);
    }
  } finally {
    await client.close();
  }
});

test("nexus and mod.io activated after connecting point at the Mods page that is already there", async () => {
  const store = new Map<string, Credential>();
  const { server, catalog } = await boot(store);
  const client = await connect(server, DRAWS_PAGES);
  try {
    store.set("nexus", CRED);
    store.set("modio", CRED);
    assert.equal((await catalog.activate("nexus")).status, "active");
    assert.equal((await catalog.activate("modio")).status, "active");
    const { tools } = await client.listTools();
    for (const name of ["nexus_trending", "modio_list_mods", "modio_search_mods"]) {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `${name} was not registered`);
      assert.equal(pageOf(tool), "ui://modwrench/mods", name);
    }
    const { resources } = await client.listResources();
    assert.equal(resources.filter((r) => r.uri === "ui://modwrench/mods").length, 1);
  } finally {
    await client.close();
  }
});

test("with MODWRENCH_UI=off no tool points at a page, no page is listed and no answer carries data", async () => {
  const prev = process.env.MODWRENCH_UI;
  process.env.MODWRENCH_UI = "off";
  const { server } = await boot(new Map([["nexus", CRED], ["modio", CRED]]));
  const client = await connect(server, DRAWS_PAGES);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.filter((t) => t._meta !== undefined).map((t) => t.name), []);
    // With no resource registered the server never declared resources, so there is nothing to list.
    assert.equal(client.getServerCapabilities()?.resources, undefined);
    for (const call of CALLS) {
      const result = await client.callTool({ name: call.name, arguments: call.args });
      assert.equal("structuredContent" in result, false, call.name);
    }
  } finally {
    await client.close();
    if (prev === undefined) delete process.env.MODWRENCH_UI;
    else process.env.MODWRENCH_UI = prev;
  }
});
