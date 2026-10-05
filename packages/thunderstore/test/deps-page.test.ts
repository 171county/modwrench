import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DEPS_APP_URI, DEPS_PAGE, MCP_APP_MIME, appToolMeta, depsView } from "@modwrench/ui";
import { registerThunderstoreTools } from "../src/register.js";
import { AppsMockServer, ConnectedServer, DRAWS_PAGES, PLAIN, withEnv, type ToolResult } from "./helpers/apps-server.js";

// ─── The dependencies page, wired to the two Thunderstore dependency tools ───
// thunderstore_mod_dependencies and thunderstore_resolve_dependencies point at the
// Dependencies page for clients that draw MCP Apps pages, and send it the list as
// structured data. Every other client gets the same text answer as before and no
// HTML at all. What the page draws is covered in packages/ui/test/deps-app.test.ts.

const DEP_TOOLS = ["thunderstore_mod_dependencies", "thunderstore_resolve_dependencies"] as const;

/** A dependency whose author wrote markup and a direction mark into its name. */
const HOSTILE = "Evil<img src=x onerror=alert(1)>-Mod‮-1.0.0";

const originalFetch = globalThis.fetch;
beforeEach(() => {
  // Hostile-Mod needs BepInExPack, the hostile mod and a ref that can't be parsed;
  // every other package needs nothing.
  globalThis.fetch = async (url) => {
    const deps = String(url).includes("/api/experimental/package/Hostile/Mod/")
      ? ["BepInEx-BepInExPack-5.4.2100", HOSTILE, "NoHyphen"]
      : [];
    return new Response(JSON.stringify({ latest: { version_number: "1.0.0", dependencies: deps } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ARGS = { namespace: "Hostile", name: "Mod" };

// The text answers as they were before the page, pinned.
const DIRECT_TEXT =
  "3 dependencies for Hostile-Mod (v1.0.0):\n\n" +
  '[\n  "BepInEx-BepInExPack-5.4.2100",\n  "Evil<img src=x onerror=alert(1)>-Mod‮-1.0.0",\n  "NoHyphen"\n]';

const RESOLVED_TEXT = JSON.stringify(
  {
    root: "Hostile-Mod",
    order: ["BepInEx-BepInExPack", "Evil<img src=x onerror=alert(1)>-Mod‮", "Hostile-Mod"],
    nodes: [
      {
        fullName: "Hostile-Mod",
        namespace: "Hostile",
        name: "Mod",
        depth: 0,
        dependsOn: ["BepInEx-BepInExPack", "Evil<img src=x onerror=alert(1)>-Mod‮"],
        version: "1.0.0",
      },
      { fullName: "BepInEx-BepInExPack", namespace: "BepInEx", name: "BepInExPack", depth: 1, dependsOn: [], version: "1.0.0" },
      {
        fullName: "Evil<img src=x onerror=alert(1)>-Mod‮",
        namespace: "Evil<img src=x onerror=alert(1)>",
        name: "Mod‮",
        depth: 1,
        dependsOn: [],
        version: "1.0.0",
      },
    ],
    unresolved: [{ ref: "NoHyphen", reason: "unparseable dependency string" }],
    truncated: false,
    totalFetched: 3,
  },
  null,
  2
);

const TEXT: Record<(typeof DEP_TOOLS)[number], string> = {
  thunderstore_mod_dependencies: DIRECT_TEXT,
  thunderstore_resolve_dependencies: RESOLVED_TEXT,
};

/** What the page is sent for each tool's fixture. */
const DATA: Record<(typeof DEP_TOOLS)[number], Record<string, unknown>> = {
  thunderstore_mod_dependencies: {
    view: "deps",
    kind: "deps",
    theme: "lethal",
    root: "Hostile-Mod",
    deps: ["BepInEx-BepInExPack-5.4.2100", HOSTILE, "NoHyphen"],
  },
  thunderstore_resolve_dependencies: {
    view: "deps",
    kind: "deps",
    theme: "lethal",
    root: "Hostile-Mod",
    deps: ["BepInEx-BepInExPack", "Evil<img src=x onerror=alert(1)>-Mod‮"],
    unresolved: 1,
    truncated: false,
  },
};

async function run(server: AppsMockServer, tool: string, args: Record<string, unknown> = ARGS): Promise<ToolResult> {
  return server.call(tool, args);
}

function registered(clientCapabilities?: unknown): AppsMockServer {
  const server = new AppsMockServer(clientCapabilities);
  registerThunderstoreTools(server as never);
  return server;
}

function assertNoHtml(result: ToolResult, label: string): void {
  const json = JSON.stringify(result);
  for (const marker of ["<!doctype", "<html", "<script", "text/html", '"resource"']) {
    assert.ok(!json.toLowerCase().includes(marker.toLowerCase()), `${label}: ${marker} in the result`);
  }
}

test("the text answers are the ones the tools gave before the page", async () => {
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    for (const tool of DEP_TOOLS) {
      const result = await run(registered(PLAIN), tool);
      assert.equal(result.content[0]!.type, "text");
      assert.equal(result.content[0]!.text, TEXT[tool], tool);
    }
  });
});

test("a text-only client gets the text answer alone: no page, no structured data, no HTML", async () => {
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    for (const caps of [PLAIN, {}, undefined]) {
      for (const tool of DEP_TOOLS) {
        const label = `${tool} ${JSON.stringify(caps)}`;
        const result = await run(registered(caps), tool);
        assert.deepEqual(result.content, [{ type: "text", text: TEXT[tool] }], label);
        assert.ok(!("structuredContent" in result), label);
        assert.equal(result.isError, undefined, label);
        assertNoHtml(result, label);
        const off = await withEnv({ MODWRENCH_UI: "off" }, () => run(registered(caps), tool));
        assert.deepEqual(result, off, `${label}: the same as with pages switched off`);
      }
    }
  });
});

test("a client that draws pages: the tools point at the Dependencies page and send it the list", async () => {
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    const server = registered(DRAWS_PAGES);
    // Both carry it: the second tool found the page registered rather than failing on a duplicate.
    for (const tool of DEP_TOOLS) assert.deepEqual(server.tools.get(tool)!.config._meta, appToolMeta(DEPS_APP_URI), tool);

    const page = server.resources.get(DEPS_APP_URI);
    assert.ok(page, "the page is registered");
    assert.equal(page.name, DEPS_PAGE.name);
    assert.equal(page.config.mimeType, MCP_APP_MIME);
    assert.equal(page.config.title, DEPS_PAGE.title);
    assert.match(page.config.description!, /read-only/i);
    assert.match(page.config.description!, /no network/i);
    const read = await page.read(new URL(DEPS_APP_URI));
    assert.equal(read.contents.length, 1);
    assert.equal(read.contents[0]!.mimeType, MCP_APP_MIME);
    assert.ok(read.contents[0]!.text.startsWith("<!doctype html>"));
    assert.ok(read.contents[0]!.text.includes("<title>Dependencies</title>"));
    assert.equal(read.contents[0]!._meta, undefined, "the page asks for no permission");

    for (const tool of DEP_TOOLS) {
      const result = await run(server, tool);
      assert.deepEqual(result.structuredContent, DATA[tool], tool);
      assert.deepEqual(result.content, (await run(registered(PLAIN), tool)).content, `${tool}: the same text as a text-only client`);
      assert.equal(result.isError, undefined, tool);
    }
  });
});

test("the page data is the builder's, and the resolved list says when the walk stopped early", async () => {
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    const server = registered(DRAWS_PAGES);
    const direct = await run(server, "thunderstore_mod_dependencies");
    assert.deepEqual(
      direct.structuredContent,
      depsView({ theme: "lethal", root: "Hostile-Mod", deps: ["BepInEx-BepInExPack-5.4.2100", HOSTILE, "NoHyphen"] })
    );
    const shallow = await run(server, "thunderstore_resolve_dependencies", { ...ARGS, maxDepth: 1 });
    assert.equal(shallow.structuredContent!.truncated, true);
    assert.equal(shallow.structuredContent!.unresolved, 1);
  });
});

test("MODWRENCH_UI=off: no page, no page metadata and no structured data, even for a client that draws pages", async () => {
  for (const value of ["off", "OFF", "0", "false", "none", " off "]) {
    await withEnv({ MODWRENCH_UI: value, MODWRENCH_STRUCTURED: undefined }, async () => {
      const server = registered(DRAWS_PAGES);
      assert.equal(server.resources.has(DEPS_APP_URI), false, value);
      for (const tool of DEP_TOOLS) {
        assert.equal(server.tools.get(tool)!.config._meta, undefined, `${tool} ${value}`);
        const result = await run(server, tool);
        assert.deepEqual(result.content, [{ type: "text", text: TEXT[tool] }], `${tool} ${value}`);
        assert.ok(!("structuredContent" in result), `${tool} ${value}`);
      }
    });
  }
});

test("MODWRENCH_STRUCTURED: 'always' sends the data to anyone, 'never' to no one", async () => {
  for (const ui of [undefined, "off"]) {
    await withEnv({ MODWRENCH_UI: ui, MODWRENCH_STRUCTURED: "always" }, async () => {
      for (const tool of DEP_TOOLS) assert.deepEqual((await run(registered(PLAIN), tool)).structuredContent, DATA[tool], `${tool} ui=${ui}`);
    });
  }
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: "never" }, async () => {
    for (const tool of DEP_TOOLS) assert.ok(!("structuredContent" in (await run(registered(DRAWS_PAGES), tool))), tool);
  });
});

test("a server that can't take the page still gets every tool, as text, and none of them points at a page", async () => {
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    // Already connected: registering a resource throws.
    const connected = new ConnectedServer(DRAWS_PAGES);
    assert.equal(registerThunderstoreTools(connected as never).toolCount, 9);
    assert.equal(connected.tools.size, 9);
    assert.equal(connected.resources.size, 0);
    for (const tool of DEP_TOOLS) {
      assert.equal(connected.tools.get(tool)!.config._meta, undefined, tool);
      const result = await run(connected, tool);
      assert.deepEqual(result.content, [{ type: "text", text: TEXT[tool] }], tool);
      assert.ok(!("structuredContent" in result), tool);
    }

    // From before pages: no registerResource at all.
    const tools = new Map<string, { config: { _meta?: unknown }; handler: (a: Record<string, unknown>) => Promise<ToolResult> }>();
    const toolsOnly = {
      server: { getClientCapabilities: () => DRAWS_PAGES },
      registerTool: (name: string, config: { _meta?: unknown }, handler: (a: Record<string, unknown>) => Promise<ToolResult>) =>
        void tools.set(name, { config, handler }),
    };
    assert.equal(registerThunderstoreTools(toolsOnly as never).toolCount, 9);
    assert.equal(tools.size, 9);
    for (const tool of DEP_TOOLS) {
      assert.equal(tools.get(tool)!.config._meta, undefined, tool);
      const result = await tools.get(tool)!.handler(ARGS);
      assert.deepEqual(result.content, [{ type: "text", text: TEXT[tool] }], tool);
      assert.ok(!("structuredContent" in result), tool);
    }
  });
});
