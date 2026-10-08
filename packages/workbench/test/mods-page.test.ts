import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_APP_MIME, MODS_APP_URI, appToolMeta } from "@modwrench/ui";
import { registerWorkbenchTools } from "../src/register.js";
import { AppsMockServer, ConnectedServer, DRAWS_PAGES, PLAIN, withEnv, type ToolResult } from "./helpers/apps-server.js";

// ─── mw_query_mod_metadata and the Mods page ─────────────────────────────────
// mw_query_mod_metadata answers every client in text. A client that draws MCP Apps
// pages also gets the mod (or, when there is none, the reason) as structured data
// for the Mods page (ui://modwrench/mods), which it fetches itself; no client gets
// HTML in the answer.
//
// A lookup that finds a mod needs a Nexus or mod.io credential from the OS
// credential manager, which a test can't count on either way. These tests use the
// two answers that need none (no id or name; Thunderstore, not supported yet), and
// the mapping of a found mod is pinned by reading the source, as attribution is in
// packages/modio/test/attribution.test.ts.

// The text answers, exactly as they were before the page existed.
const NO_QUERY = { found: false, reason: "Provide either modId or modName.", attemptedPlatforms: [] };
const THUNDERSTORE = {
  found: false,
  reason: `Platform "thunderstore" support is not implemented yet (planned for a later version). Use platform="nexus" or "modio" for now.`,
  attemptedPlatforms: [],
};

const CASES = [
  { args: {}, golden: JSON.stringify(NO_QUERY, null, 2), reason: NO_QUERY.reason },
  { args: { modName: "SkyUI", platform: "thunderstore" }, golden: JSON.stringify(THUNDERSTORE, null, 2), reason: THUNDERSTORE.reason },
];

test("mw_query_mod_metadata's text answer is the one it has always given", async () => {
  for (const c of CASES) {
    const server = new AppsMockServer(PLAIN);
    registerWorkbenchTools(server as never);
    const result = await server.call("mw_query_mod_metadata", c.args);
    assert.equal(result.content[0]!.type, "text");
    assert.equal(result.content[0]!.text, c.golden);
  }
});

const CLEAN_ENV = { MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined };

/** Register the tools on `server` and call mw_query_mod_metadata, with the environment given (both read it). */
async function run(server: AppsMockServer, args: Record<string, unknown>, env: Record<string, string | undefined> = {}): Promise<ToolResult> {
  return withEnv({ ...CLEAN_ENV, ...env }, async () => {
    registerWorkbenchTools(server as never);
    return server.call("mw_query_mod_metadata", args);
  });
}

function assertTextOnly(result: ToolResult, golden: string, why: string): void {
  assert.deepEqual(result.content, [{ type: "text", text: golden }], why);
  assert.equal("structuredContent" in result, false, `${why}: structured data`);
  assert.equal("isError" in result, false, `${why}: isError`);
  const raw = JSON.stringify(result);
  for (const html of ["<!doctype", "<html", "<script", "text/html", '"resource"']) {
    assert.ok(!raw.toLowerCase().includes(html), `${why}: ${html} in the answer`);
  }
}

test("a text-only client gets the text answer and nothing else: no page, no HTML, no structured data", async () => {
  for (const c of CASES) {
    for (const caps of [PLAIN, {}, undefined]) {
      const server = new AppsMockServer(caps);
      const result = await run(server, c.args);
      assertTextOnly(result, c.golden, JSON.stringify(caps ?? "no capabilities"));
      // The tool still names its page (metadata, not HTML); only a client that draws pages fetches it.
      assert.deepEqual(server.tools.get("mw_query_mod_metadata")!.config._meta, appToolMeta(MODS_APP_URI));
      assert.deepEqual(result, await run(new AppsMockServer(caps), c.args, { MODWRENCH_UI: "off" }), "the same as with pages off");
    }
  }
});

test("a client that draws pages gets the same text, the reason there is no mod for the Mods page, and a page it can read", async () => {
  for (const c of CASES) {
    const server = new AppsMockServer(DRAWS_PAGES);
    const result = await run(server, c.args);
    assert.deepEqual(result.content, [{ type: "text", text: c.golden }]);
    // The reason, not the per-platform diagnostics: those are for the AI to suggest next steps.
    assert.deepEqual(result.structuredContent, { view: "mods", theme: "skyrim", mods: [], note: c.reason });
    assert.equal("isError" in result, false, "not finding a mod is an answer, not a failed call");
    assert.deepEqual(server.tools.get("mw_query_mod_metadata")!.config._meta, appToolMeta(MODS_APP_URI));

    const page = server.resources.get(MODS_APP_URI);
    assert.ok(page, "the Mods page is registered");
    assert.equal(page.name, "mods_panel");
    assert.equal(page.config.mimeType, MCP_APP_MIME);
    assert.equal(page.config.title, "Mods page");
    assert.match(page.config.description ?? "", /read-only/i);
    assert.match(page.config.description ?? "", /no network/i);
    const read = await page.read(new URL(MODS_APP_URI));
    assert.equal(read.contents.length, 1);
    assert.equal(read.contents[0]!.mimeType, MCP_APP_MIME);
    assert.match(read.contents[0]!.text, /^<!doctype html>/i);
    assert.ok(read.contents[0]!.text.includes("<title>Mods</title>"));
    assert.equal(read.contents[0]!._meta, undefined, "the page asks for no permission");
  }
});

test("MODWRENCH_UI=off: no page, no page metadata and no structured data, even for a client that draws pages", async () => {
  for (const value of ["off", "OFF", "0", "false", "none", " off "]) {
    const server = new AppsMockServer(DRAWS_PAGES);
    assertTextOnly(await run(server, CASES[0]!.args, { MODWRENCH_UI: value }), CASES[0]!.golden, `MODWRENCH_UI=${JSON.stringify(value)}`);
    assert.equal(server.resources.size, 0, value);
    assert.equal(server.tools.get("mw_query_mod_metadata")!.config._meta, undefined, value);
  }
});

test("MODWRENCH_STRUCTURED: always sends the page's data to any client, never sends it to none", async () => {
  const c = CASES[0]!;
  const view = { view: "mods", theme: "skyrim", mods: [], note: c.reason };
  assert.deepEqual((await run(new AppsMockServer(PLAIN), c.args, { MODWRENCH_STRUCTURED: "always" })).structuredContent, view);
  assert.deepEqual((await run(new AppsMockServer(PLAIN), c.args, { MODWRENCH_STRUCTURED: "always", MODWRENCH_UI: "off" })).structuredContent, view);
  assertTextOnly(await run(new AppsMockServer(DRAWS_PAGES), c.args, { MODWRENCH_STRUCTURED: "never" }), c.golden, "never");
});

test("a server that can't register the page still gets every tool, and mw_query_mod_metadata answers in text with no page to point at", async () => {
  const toolsOnly = (): AppsMockServer => {
    const server = new AppsMockServer(DRAWS_PAGES);
    (server as { registerResource?: unknown }).registerResource = undefined;
    return server;
  };
  for (const server of [new ConnectedServer(DRAWS_PAGES), toolsOnly()]) {
    assertTextOnly(await run(server, CASES[0]!.args), CASES[0]!.golden, server.constructor.name);
    assert.equal(server.tools.size, 9);
    for (const [name, t] of server.tools) assert.equal(t.config._meta, undefined, name);
  }
});

const REGISTER = new URL("../src/register.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("a mod that is found goes to the page with its author, platform and page address", () => {
  const src = readFileSync(REGISTER, "utf8");
  const start = src.indexOf('"mw_query_mod_metadata",');
  assert.ok(start > -1, "mw_query_mod_metadata not found, so this guard would pass vacuously");
  const body = src.slice(start, src.indexOf("server.registerTool(", start));
  assert.match(body, /modsView\(/, "the answer no longer goes through the Mods page's data builder");
  assert.match(body, /author: result\.mod\.attribution\.author/, "the found mod's author is not sent");
  assert.match(body, /platform: result\.mod\.platform/, "the found mod's platform is not sent");
  assert.match(body, /pageUrl: result\.mod\.pageUrl/, "the found mod's page address is not sent");
  assert.match(body, /note: result\.reason/, "the reason nothing was found is not sent");
});
