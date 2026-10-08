import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MCP_APP_MIME, MODS_APP_URI, appToolMeta } from "@modwrench/ui";
import { registerThunderstoreTools } from "../src/register.js";
import { AppsMockServer, ConnectedServer, DRAWS_PAGES, PLAIN, withEnv, type ToolResult } from "./helpers/apps-server.js";

// ─── The Thunderstore mod lists and the Mods page ────────────────────────────
// thunderstore_list_mods, thunderstore_search_mods and thunderstore_top_mods answer
// every client in text. A client that draws MCP Apps pages also gets the list as
// structured data for the Mods page (ui://modwrench/mods), which it fetches itself;
// no client gets HTML in the answer.

const HOSTILE = `<img src=x onerror="alert(1)">Cool Mod'); mw('prompt','x'); //`;

const PACKAGES = [
  {
    name: HOSTILE,
    full_name: "Evil-CoolMod",
    owner: "Evil​Author",
    package_url: "https://thunderstore.io/c/lethal-company/p/Evil/CoolMod/",
    rating_score: 7,
    is_pinned: false,
    is_deprecated: false,
    categories: ["Misc"],
    versions: [
      { version_number: "1.2.3", downloads: 1500, date_created: "2026-01-02T00:00:00Z" },
      { version_number: "1.2.2", downloads: 500, date_created: "2026-01-01T00:00:00Z" },
    ],
  },
  {
    name: "BepInExPack",
    full_name: "BepInEx-BepInExPack",
    owner: "BepInEx",
    package_url: "https://thunderstore.io/c/lethal-company/p/BepInEx/BepInExPack/",
    rating_score: 900,
    is_pinned: true,
    is_deprecated: false,
    categories: ["Libraries"],
    versions: [{ version_number: "5.4.2100", downloads: 2000000, date_created: "2025-01-01T00:00:00Z" }],
  },
];

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function servePackages(): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(PACKAGES), { status: 200, headers: { "content-type": "application/json" } });
}

// The text answers, exactly as they were before the page existed.
const GOLDEN = {
  thunderstore_list_mods:
    "Showing 2 of 2 mods in lethal-company:\n\n" +
    JSON.stringify(
      [
        {
          name: HOSTILE,
          full_name: "Evil-CoolMod",
          author: "Evil​Author",
          rating: 7,
          latest_version: "1.2.3",
          total_downloads: 2000,
          pinned: false,
          deprecated: false,
          categories: ["Misc"],
          page_url: "https://thunderstore.io/c/lethal-company/p/Evil/CoolMod/",
        },
        {
          name: "BepInExPack",
          full_name: "BepInEx-BepInExPack",
          author: "BepInEx",
          rating: 900,
          latest_version: "5.4.2100",
          total_downloads: 2000000,
          pinned: true,
          deprecated: false,
          categories: ["Libraries"],
          page_url: "https://thunderstore.io/c/lethal-company/p/BepInEx/BepInExPack/",
        },
      ],
      null,
      2
    ),
  thunderstore_search_mods:
    "Matched 1 mods (showing 1):\n\n" +
    JSON.stringify(
      [
        {
          name: HOSTILE,
          full_name: "Evil-CoolMod",
          author: "Evil​Author",
          rating: 7,
          latest_version: "1.2.3",
          page_url: "https://thunderstore.io/c/lethal-company/p/Evil/CoolMod/",
        },
      ],
      null,
      2
    ),
  thunderstore_top_mods:
    "Top 2 mods in lethal-company by rating:\n\n" +
    JSON.stringify(
      [
        {
          rank: 1,
          name: "BepInExPack",
          full_name: "BepInEx-BepInExPack",
          author: "BepInEx",
          rating: 900,
          latest_version: "5.4.2100",
          page_url: "https://thunderstore.io/c/lethal-company/p/BepInEx/BepInExPack/",
        },
        {
          rank: 2,
          name: HOSTILE,
          full_name: "Evil-CoolMod",
          author: "Evil​Author",
          rating: 7,
          latest_version: "1.2.3",
          page_url: "https://thunderstore.io/c/lethal-company/p/Evil/CoolMod/",
        },
      ],
      null,
      2
    ),
} as const;

const ARGS: Record<keyof typeof GOLDEN, Record<string, unknown>> = {
  thunderstore_list_mods: { community: "lethal-company" },
  thunderstore_search_mods: { community: "lethal-company", query: "COOL" },
  thunderstore_top_mods: { community: "lethal-company" },
};

const TOOLS = Object.keys(GOLDEN) as Array<keyof typeof GOLDEN>;

test("each Thunderstore list tool's text answer is the one it has always given", async () => {
  for (const tool of TOOLS) {
    servePackages();
    const server = new AppsMockServer(PLAIN);
    registerThunderstoreTools(server as never);
    const result = await server.call(tool, ARGS[tool]);
    assert.equal(result.content[0]!.type, "text", tool);
    assert.equal(result.content[0]!.text, GOLDEN[tool], tool);
  }
});

// What the Mods page is sent, for the clients that draw it. The hostile name is data.
const COOL = {
  name: HOSTILE,
  author: "Evil​Author",
  platform: "thunderstore",
  version: "1.2.3",
  endorsements: 7,
  pageUrl: "https://thunderstore.io/c/lethal-company/p/Evil/CoolMod/",
};
const BEPINEX = {
  name: "BepInExPack",
  author: "BepInEx",
  platform: "thunderstore",
  version: "5.4.2100",
  endorsements: 900,
  pageUrl: "https://thunderstore.io/c/lethal-company/p/BepInEx/BepInExPack/",
};
const VIEWS: Record<keyof typeof GOLDEN, Record<string, unknown>> = {
  thunderstore_list_mods: {
    view: "mods",
    theme: "lethal",
    query: "lethal-company mods",
    mods: [{ ...COOL, downloads: 2000 }, { ...BEPINEX, downloads: 2000000 }],
  },
  thunderstore_search_mods: { view: "mods", theme: "lethal", query: "cool", mods: [COOL] },
  thunderstore_top_mods: { view: "mods", theme: "lethal", query: "Top lethal-company", mods: [BEPINEX, COOL] },
};

const CLEAN_ENV = { MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined };

/** Register the tools on `server` and call one, with the environment given (both read it). */
async function run(
  tool: keyof typeof GOLDEN,
  server: AppsMockServer,
  env: Record<string, string | undefined> = {}
): Promise<ToolResult> {
  return withEnv({ ...CLEAN_ENV, ...env }, async () => {
    servePackages();
    registerThunderstoreTools(server as never);
    return server.call(tool, ARGS[tool]);
  });
}

function assertTextOnly(result: ToolResult, tool: keyof typeof GOLDEN, why: string): void {
  assert.deepEqual(result.content, [{ type: "text", text: GOLDEN[tool] }], `${tool} ${why}`);
  assert.equal("structuredContent" in result, false, `${tool} ${why}: structured data`);
  assert.equal("isError" in result, false, `${tool} ${why}: isError`);
  const raw = JSON.stringify(result);
  for (const html of ["<!doctype", "<html", "<script", "text/html", '"resource"']) {
    assert.ok(!raw.toLowerCase().includes(html), `${tool} ${why}: ${html} in the answer`);
  }
}

test("a text-only client gets the text answer and nothing else: no page, no HTML, no structured data", async () => {
  for (const tool of TOOLS) {
    for (const caps of [PLAIN, {}, undefined]) {
      const server = new AppsMockServer(caps);
      const result = await run(tool, server);
      assertTextOnly(result, tool, JSON.stringify(caps ?? "no capabilities"));
      // The tool still names its page (metadata, not HTML); only a client that draws pages fetches it.
      assert.deepEqual(server.tools.get(tool)!.config._meta, appToolMeta(MODS_APP_URI));
      assert.deepEqual(result, await run(tool, new AppsMockServer(caps), { MODWRENCH_UI: "off" }), `${tool}: the same as with pages off`);
    }
  }
});

test("a client that draws pages gets the same text, the list for the Mods page, and a page it can read", async () => {
  for (const tool of TOOLS) {
    const server = new AppsMockServer(DRAWS_PAGES);
    const result = await run(tool, server);
    assert.deepEqual(result.content, [{ type: "text", text: GOLDEN[tool] }], tool);
    assert.deepEqual(result.structuredContent, VIEWS[tool], tool);
    assert.equal("isError" in result, false);
    assert.deepEqual(server.tools.get(tool)!.config._meta, appToolMeta(MODS_APP_URI), tool);

    const page = server.resources.get(MODS_APP_URI);
    assert.ok(page, "the Mods page is registered");
    assert.equal(page.name, "mods_panel");
    assert.equal(page.config.mimeType, MCP_APP_MIME);
    assert.equal(page.config.title, "Mods page");
    assert.match(page.config.description ?? "", /read-only/i);
    assert.match(page.config.description ?? "", /no network/i);
    const read = await page.read(new URL(MODS_APP_URI));
    assert.equal(read.contents.length, 1);
    assert.equal(read.contents[0]!.uri, MODS_APP_URI);
    assert.equal(read.contents[0]!.mimeType, MCP_APP_MIME);
    assert.match(read.contents[0]!.text, /^<!doctype html>/i);
    assert.ok(read.contents[0]!.text.includes("<title>Mods</title>"));
    assert.equal(read.contents[0]!._meta, undefined, "the page asks for no permission");
  }
});

test("the three tools share one Mods page, registered once", async () => {
  // The mock refuses a second registration at one address, as the SDK does, so a
  // tool that tried again would have lost its page.
  const server = new AppsMockServer(DRAWS_PAGES);
  await run("thunderstore_list_mods", server);
  assert.ok(server.resources.has(MODS_APP_URI));
  for (const tool of TOOLS) assert.deepEqual(server.tools.get(tool)!.config._meta, appToolMeta(MODS_APP_URI), tool);
});

test("a Valheim list is drawn in the Valheim skin", async () => {
  servePackages();
  const server = new AppsMockServer(DRAWS_PAGES);
  const result = await withEnv(CLEAN_ENV, () => {
    registerThunderstoreTools(server as never);
    return server.call("thunderstore_list_mods", { community: "valheim" });
  });
  assert.equal(result.structuredContent?.theme, "valheim");
  assert.equal(result.structuredContent?.query, "valheim mods");
});

test("MODWRENCH_UI=off: no page, no page metadata and no structured data, even for a client that draws pages", async () => {
  for (const value of ["off", "OFF", "0", "false", "none", " off "]) {
    for (const tool of TOOLS) {
      const server = new AppsMockServer(DRAWS_PAGES);
      const result = await run(tool, server, { MODWRENCH_UI: value });
      assertTextOnly(result, tool, `MODWRENCH_UI=${JSON.stringify(value)}`);
      assert.equal(server.resources.size, 0, value);
      assert.equal(server.tools.get(tool)!.config._meta, undefined, value);
    }
  }
});

test("MODWRENCH_STRUCTURED: always sends the list to any client, never sends it to none", async () => {
  for (const tool of TOOLS) {
    assert.deepEqual((await run(tool, new AppsMockServer(PLAIN), { MODWRENCH_STRUCTURED: "always" })).structuredContent, VIEWS[tool]);
    assert.deepEqual(
      (await run(tool, new AppsMockServer(PLAIN), { MODWRENCH_STRUCTURED: "always", MODWRENCH_UI: "off" })).structuredContent,
      VIEWS[tool]
    );
    assertTextOnly(await run(tool, new AppsMockServer(DRAWS_PAGES), { MODWRENCH_STRUCTURED: "never" }), tool, "never");
  }
});

test("MODWRENCH_STRUCTURED=never: no page is offered at all, since without its data it could only repeat the text", async () => {
  for (const tool of TOOLS) {
    const server = new AppsMockServer(DRAWS_PAGES);
    assertTextOnly(await run(tool, server, { MODWRENCH_STRUCTURED: "never" }), tool, "never");
    assert.equal(server.resources.size, 0, tool);
    assert.equal(server.tools.get(tool)!.config._meta, undefined, tool);
  }
});

test("a server that can't register the page still gets every tool, answering in text with no page to point at", async () => {
  const toolsOnly = (): AppsMockServer => {
    const server = new AppsMockServer(DRAWS_PAGES);
    (server as { registerResource?: unknown }).registerResource = undefined;
    return server;
  };
  for (const make of [() => new ConnectedServer(DRAWS_PAGES), toolsOnly]) {
    for (const tool of TOOLS) {
      const server = make();
      const result = await run(tool, server);
      assertTextOnly(result, tool, server.constructor.name);
      assert.equal(server.tools.size, 9);
      for (const [name, t] of server.tools) assert.equal(t.config._meta, undefined, name);
    }
  }
});
