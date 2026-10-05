import { test } from "node:test";
import assert from "node:assert/strict";
import { DECK_APP_URI, MCP_APP_MIME, appToolMeta, deckView } from "@modwrench/ui";
import { registerDeckTool } from "../src/deck.js";
import { AppsMockServer, ConnectedServer, DRAWS_PAGES, PLAIN, withEnv, type ToolResult } from "./helpers/apps-server.js";

// ─── mw_deck ─────────────────────────────────────────────────────────────────
// The deck's text answer is the connector list as JSON, read from the catalog on
// every call. It is pinned here byte for byte so that how the deck is drawn can
// change without the text changing. A client that draws MCP Apps pages also gets
// the deck page and the deck as structured data; every other client gets the
// text and nothing else.

type Active = Array<{ platformId: string; toolCount: number }>;
const KNOWN = ["nexus", "modio", "thunderstore", "workbench"];

/** A catalog that knows `known` and has `active` switched on. */
const catalog = (active: Active, known: string[] = KNOWN) =>
  ({ listActive: () => active, knownIds: () => known }) as never;

const BOOT: Active = [
  { platformId: "thunderstore", toolCount: 9 },
  { platformId: "workbench", toolCount: 9 },
];

const deckServer = (active: Active = BOOT, known?: string[], client: unknown = PLAIN): AppsMockServer => {
  const server = new AppsMockServer(client);
  registerDeckTool(server as never, catalog(active, known));
  return server;
};

const GOLDEN = `{
  "view": "deck",
  "theme": "skyrim",
  "connectors": [
    {
      "id": "nexus",
      "name": "Nexus Mods",
      "tool": "nexus_search",
      "status": "off"
    },
    {
      "id": "modio",
      "name": "mod.io",
      "tool": "modio_list_games",
      "status": "off"
    },
    {
      "id": "thunderstore",
      "name": "Thunderstore",
      "tool": "thunderstore_list_communities",
      "status": "on",
      "toolCount": 9
    },
    {
      "id": "workbench",
      "name": "Workbench",
      "tool": "mw_detect_environment",
      "status": "on",
      "toolCount": 9
    }
  ]
}`;

test("mw_deck answers with the connectors as JSON, as it always has", async () => {
  const result = await deckServer().call("mw_deck", {});
  assert.equal(result.content[0]!.type, "text");
  assert.equal(result.content[0]!.text, GOLDEN);
});

test("mw_deck's text echoes the theme and view it was asked for", async () => {
  const result = await deckServer().call("mw_deck", { theme: "fallout", view: "mods" });
  assert.equal(
    result.content[0]!.text,
    GOLDEN.replace('"view": "deck"', '"view": "mods"').replace('"theme": "skyrim"', '"theme": "fallout"')
  );
});

test("mw_deck reads the catalog on every call, and names a platform it has no entry for by its id", async () => {
  const active: Active = [];
  const server = deckServer(active, ["nexus", "newplat"]);
  const before = JSON.parse((await server.call("mw_deck", {})).content[0]!.text) as { connectors: unknown[] };
  assert.deepEqual(before.connectors, [
    { id: "nexus", name: "Nexus Mods", tool: "nexus_search", status: "off" },
    { id: "newplat", name: "newplat", tool: "", status: "off" },
  ]);
  active.push({ platformId: "nexus", toolCount: 15 });
  const after = JSON.parse((await server.call("mw_deck", {})).content[0]!.text) as { connectors: unknown[] };
  assert.deepEqual(after.connectors[0], { id: "nexus", name: "Nexus Mods", tool: "nexus_search", status: "on", toolCount: 15 });
});

// ─── The page ────────────────────────────────────────────────────────────────

const GAMES = [
  { id: "skyrim", name: "Skyrim SE", note: "Nexus · Bethesda" },
  { id: "fallout", name: "Fallout 4", note: "Nexus · Bethesda" },
  { id: "lethal", name: "Lethal Company", note: "Thunderstore · BepInEx" },
  { id: "valheim", name: "Valheim", note: "Thunderstore · BepInEx" },
];

const CLEAN = { MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined };

/** With MODWRENCH_UI and MODWRENCH_STRUCTURED as given (unset otherwise): register mw_deck on `make(client)` and call it. */
const run = (
  client: unknown,
  env: Record<string, string> = {},
  args: Record<string, unknown> = {},
  make: (client: unknown) => AppsMockServer = (c) => new AppsMockServer(c)
) =>
  withEnv({ ...CLEAN, ...env }, async () => {
    const server = make(client);
    registerDeckTool(server as never, catalog(BOOT));
    return { server, result: await server.call("mw_deck", args) };
  });

const deckMeta = () => withEnv(CLEAN, () => appToolMeta(DECK_APP_URI));
const TEXT_ONLY: ToolResult = { content: [{ type: "text", text: GOLDEN }] };

test("a text-only client gets the text and nothing else: no structured data and no HTML", async () => {
  const { result: off } = await run(PLAIN, { MODWRENCH_UI: "off" });
  for (const client of [PLAIN, {}, undefined]) {
    const { server, result } = await run(client);
    assert.deepEqual(result, TEXT_ONLY);
    assert.ok(!("structuredContent" in result));
    const json = JSON.stringify(result).toLowerCase();
    for (const marker of ["<!doctype", "<html", "<script", "text/html", '"resource"']) assert.ok(!json.includes(marker), marker);
    assert.deepEqual(result, off, "the same answer as with pages switched off");
    // The tool still says where its page is: that is metadata, and only a client that draws pages fetches the page.
    assert.deepEqual(server.tools.get("mw_deck")!.config._meta, await deckMeta());
  }
});

test("a client that draws pages gets the deck page, its address on the tool, and the deck as structured data", async () => {
  const { server, result } = await run(DRAWS_PAGES);
  assert.deepEqual(server.tools.get("mw_deck")!.config._meta, await deckMeta());
  assert.deepEqual([...server.resources.keys()], [DECK_APP_URI]);
  const page = server.resources.get(DECK_APP_URI)!;
  assert.equal(page.name, "deck_panel");
  assert.equal(page.config.title, "Deck page");
  assert.equal(page.config.mimeType, MCP_APP_MIME);
  assert.match(page.config.description!, /read-only/i);
  assert.match(page.config.description!, /no network/i);
  const read = await page.read(new URL(DECK_APP_URI));
  assert.equal(read.contents.length, 1);
  const doc = read.contents[0]!;
  assert.equal(doc.uri, DECK_APP_URI);
  assert.equal(doc.mimeType, MCP_APP_MIME);
  assert.ok(doc.text.startsWith("<!doctype html>"));
  assert.ok(doc.text.includes("<title>Deck</title>"));
  assert.ok(!("_meta" in doc), "the deck page asks for no permission");

  assert.deepEqual(result.content, TEXT_ONLY.content);
  const connectors = (JSON.parse(GOLDEN) as { connectors: never[] }).connectors;
  assert.deepEqual(result.structuredContent, deckView({ theme: "skyrim", connectors, games: GAMES }));
  assert.equal(result.structuredContent!.view, "deck");
  assert.deepEqual(result.structuredContent!.connectors, connectors, "the page shows the connectors the text lists");
});

test("the theme asked for is the page's skin, and the text still echoes the theme and view", async () => {
  const { result } = await run(DRAWS_PAGES, {}, { theme: "valheim", view: "crash" });
  assert.equal(result.structuredContent!.theme, "valheim");
  assert.equal(
    result.content[0]!.text,
    GOLDEN.replace('"view": "deck"', '"view": "crash"').replace('"theme": "skyrim"', '"theme": "valheim"')
  );
});

test("MODWRENCH_UI=off: no page, no address on the tool and no structured data, even for a client that draws pages", async () => {
  for (const value of ["off", "OFF", "0", "false", "none", " off "]) {
    const { server, result } = await run(DRAWS_PAGES, { MODWRENCH_UI: value });
    assert.equal(server.resources.size, 0, value);
    assert.ok(!("_meta" in server.tools.get("mw_deck")!.config), value);
    assert.deepEqual(result, TEXT_ONLY, value);
  }
});

test("MODWRENCH_STRUCTURED=always sends the deck to every client, and never sends it to none", async () => {
  const envs: Array<Record<string, string>> = [{ MODWRENCH_STRUCTURED: "always" }, { MODWRENCH_STRUCTURED: "always", MODWRENCH_UI: "off" }];
  for (const env of envs) {
    const { result } = await run(PLAIN, env);
    assert.equal(result.structuredContent?.view, "deck", JSON.stringify(env));
    assert.deepEqual(result.content, TEXT_ONLY.content);
  }
  const { server, result } = await run(DRAWS_PAGES, { MODWRENCH_STRUCTURED: "never" });
  assert.deepEqual(result, TEXT_ONLY);
  assert.ok(server.tools.get("mw_deck")!.config._meta, "the page is still on offer");
});

test("a page that can't be registered leaves mw_deck a plain tool with the same text", async () => {
  const toolsOnly = (client: unknown): AppsMockServer => {
    const server = new AppsMockServer(client);
    (server as unknown as { registerResource: undefined }).registerResource = undefined;
    return server;
  };
  for (const make of [(client: unknown) => new ConnectedServer(client), toolsOnly]) {
    const { server, result } = await run(DRAWS_PAGES, {}, {}, make);
    assert.deepEqual([...server.tools.keys()], ["mw_deck"]);
    assert.ok(!("_meta" in server.tools.get("mw_deck")!.config));
    assert.equal(server.resources.size, 0);
    assert.deepEqual(result, TEXT_ONLY);
  }
});

test("a platform with no entry is named by its id, as data, in the text and on the page alike", async () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const result = await withEnv(CLEAN, () => deckServer([], [hostile], DRAWS_PAGES).call("mw_deck", {}));
  const expected = [{ id: hostile, name: hostile, tool: "", status: "off" }];
  assert.deepEqual((JSON.parse(result.content[0]!.text) as { connectors: unknown }).connectors, expected);
  assert.deepEqual(result.structuredContent!.connectors, expected);
});
