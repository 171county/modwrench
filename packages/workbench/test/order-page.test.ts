import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEPS_APP_URI, DEPS_PAGE, MCP_APP_MIME, appToolMeta } from "@modwrench/ui";
import { registerWorkbenchTools } from "../src/register.js";
import { AppsMockServer, ConnectedServer, DRAWS_PAGES, PLAIN, withEnv, type ToolResult } from "./helpers/apps-server.js";

// ─── The load order on the Dependencies page ─────────────────────────────────
// mw_read_load_order points at the Dependencies page for clients that draw MCP Apps
// pages and sends it the load order as structured data, read or not. Every other
// client gets the same text answer as before and no HTML at all. What the page draws
// is covered in packages/ui/test/deps-app.test.ts.

const TOOL = "mw_read_load_order";

// A Mod Organizer 2 instance whose plugin list holds a name with markup in it.
const root = mkdtempSync(join(tmpdir(), "mw-order-page-"));
after(() => rmSync(root, { recursive: true, force: true }));
const instance = join(root, "MO2");
mkdirSync(join(instance, "profiles", "Default"), { recursive: true });
writeFileSync(join(instance, "ModOrganizer.ini"), "[General]\ngameName=Skyrim Special Edition\nselected_profile=Default\n");
writeFileSync(join(instance, "profiles", "Default", "modlist.txt"), "+Evil<img src=x onerror=alert(1)>\n-Disabled Mod\n+SkyUI\n");
writeFileSync(join(instance, "profiles", "Default", "plugins.txt"), "*Evil<img src=x onerror=alert(1)>.esp\nDisabled.esp\n*SkyUI_SE.esp\n");

const READ = { gameId: "skyrimspecialedition", modManager: "mo2", instancePath: instance };
const UNKNOWN = { gameId: "nosuchgame" };

// The text answers as they were before the page, pinned.
const READ_TEXT = JSON.stringify(
  {
    ok: true,
    modManager: "mo2",
    profile: "Default",
    sourcePath: join(instance, "profiles", "Default"),
    mods: [
      { name: "Evil<img src=x onerror=alert(1)>.esp", enabled: true, loadOrderIndex: 0, pluginFile: "Evil<img src=x onerror=alert(1)>.esp" },
      { name: "Disabled.esp", enabled: false, loadOrderIndex: 1, pluginFile: "Disabled.esp" },
      { name: "SkyUI_SE.esp", enabled: true, loadOrderIndex: 2, pluginFile: "SkyUI_SE.esp" },
    ],
    modFolders: [
      { name: "SkyUI", enabled: true, modlistIndex: 0 },
      { name: "Disabled Mod", enabled: false, modlistIndex: 1 },
      { name: "Evil<img src=x onerror=alert(1)>", enabled: true, modlistIndex: 2 },
    ],
    enabledCount: 2,
    totalCount: 3,
  },
  null,
  2
);

const UNKNOWN_TEXT =
  '{\n  "ok": false,\n  "reason": "Unknown gameId \\"nosuchgame\\". Known IDs are listed in @modwrench/workbench\'s KNOWN_GAMES catalogue. Use mw_detect_environment to see detected games on this machine.",\n  "attemptedManagers": []\n}';

/** What the page is sent for each call. */
const READ_DATA = {
  view: "deps",
  kind: "order",
  theme: "skyrim",
  ok: true,
  manager: "mo2",
  profile: "Default",
  enabledCount: 2,
  totalCount: 3,
  loadOrder: [
    { name: "Evil<img src=x onerror=alert(1)>.esp", enabled: true, index: 0, pluginFile: "Evil<img src=x onerror=alert(1)>.esp" },
    { name: "Disabled.esp", enabled: false, index: 1, pluginFile: "Disabled.esp" },
    { name: "SkyUI_SE.esp", enabled: true, index: 2, pluginFile: "SkyUI_SE.esp" },
  ],
};
const UNKNOWN_DATA = {
  view: "deps",
  kind: "order",
  theme: "lethal",
  ok: false,
  reason:
    'Unknown gameId "nosuchgame". Known IDs are listed in @modwrench/workbench\'s KNOWN_GAMES catalogue. Use mw_detect_environment to see detected games on this machine.',
};

const CASES = [
  { label: "read", args: READ, text: READ_TEXT, data: READ_DATA },
  { label: "unknown game", args: UNKNOWN, text: UNKNOWN_TEXT, data: UNKNOWN_DATA },
] as const;

function registered(clientCapabilities?: unknown): AppsMockServer {
  const server = new AppsMockServer(clientCapabilities);
  registerWorkbenchTools(server as never);
  return server;
}

function assertNoHtml(result: ToolResult, label: string): void {
  const json = JSON.stringify(result);
  for (const marker of ["<!doctype", "<html", "<script", "text/html", '"resource"']) {
    assert.ok(!json.toLowerCase().includes(marker.toLowerCase()), `${label}: ${marker} in the result`);
  }
}

test("the text answers are the ones the tool gave before the page", async () => {
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    for (const c of CASES) {
      const result = await registered(PLAIN).call(TOOL, c.args);
      assert.equal(result.content[0]!.type, "text");
      assert.equal(result.content[0]!.text, c.text, c.label);
    }
  });
});

test("a text-only client gets the text answer alone: no page, no structured data, no HTML", async () => {
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    for (const caps of [PLAIN, {}, undefined]) {
      for (const c of CASES) {
        const label = `${c.label} ${JSON.stringify(caps)}`;
        const result = await registered(caps).call(TOOL, c.args);
        assert.deepEqual(result.content, [{ type: "text", text: c.text }], label);
        assert.ok(!("structuredContent" in result), label);
        assert.equal(result.isError, undefined, label);
        assertNoHtml(result, label);
        const off = await withEnv({ MODWRENCH_UI: "off" }, () => registered(caps).call(TOOL, c.args));
        assert.deepEqual(result, off, `${label}: the same as with pages switched off`);
      }
    }
  });
});

test("a client that draws pages: the tool points at the Dependencies page and sends it the load order, read or not", async () => {
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    const server = registered(DRAWS_PAGES);
    assert.deepEqual(server.tools.get(TOOL)!.config._meta, appToolMeta(DEPS_APP_URI));
    assert.equal(server.resources.has("ui://modwrench/order"), false, "the old address is retired");

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

    for (const c of CASES) {
      const result = await server.call(TOOL, c.args);
      assert.deepEqual(result.structuredContent, c.data, c.label);
      assert.deepEqual(result.content, (await registered(PLAIN).call(TOOL, c.args)).content, `${c.label}: the same text as a text-only client`);
      assert.equal(result.isError, undefined, `${c.label}: a load order that couldn't be read is an answer, not an error`);
      assert.ok(!JSON.stringify(result.structuredContent).includes(JSON.stringify(root).slice(1, -1)), `${c.label}: no folder path goes to the page`);
    }
  });
});

test("a Mod Organizer 2 profile with no plugins sends its mod folders to the page, so it isn't drawn as an empty load order", async () => {
  const folderOnly = join(root, "MO2-folders");
  mkdirSync(join(folderOnly, "profiles", "Default"), { recursive: true });
  writeFileSync(join(folderOnly, "ModOrganizer.ini"), "[General]\ngameName=Skyrim Special Edition\nselected_profile=Default\n");
  writeFileSync(join(folderOnly, "profiles", "Default", "modlist.txt"), "+Textures A\n+Textures B\n-Old Mod\n");
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    const args = { gameId: "skyrimspecialedition", modManager: "mo2", instancePath: folderOnly };
    const result = await registered(DRAWS_PAGES).call(TOOL, args);
    const data = result.structuredContent as { rows?: string; enabledCount: number; totalCount: number; loadOrder: Array<{ name: string; enabled: boolean | null }> };
    assert.equal(data.rows, "folders");
    assert.equal(data.totalCount, 3);
    assert.equal(data.enabledCount, 2);
    assert.deepEqual(
      data.loadOrder.map((r) => [r.name, r.enabled]).sort(),
      [["Old Mod", false], ["Textures A", true], ["Textures B", true]]
    );
    // The text answer is the one it always was, and no folder path goes to the page.
    assert.deepEqual(result.content, (await registered(PLAIN).call(TOOL, args)).content);
    assert.ok(!JSON.stringify(data).includes(JSON.stringify(root).slice(1, -1)));
  });
});

test("an r2modman load order keeps each mod's author and platform on the page", async () => {
  // r2modman's folder, wherever this platform keeps it, under a home of our own.
  const home = join(root, "home");
  const r2 =
    process.platform === "win32"
      ? join(home, "AppData", "Roaming", "r2modmanPlus-local")
      : process.platform === "darwin"
        ? join(home, "Library", "Application Support", "r2modmanPlus-local")
        : join(home, ".config", "r2modmanPlus-local");
  mkdirSync(join(r2, "LethalCompany", "profiles", "Default"), { recursive: true });
  writeFileSync(
    join(r2, "LethalCompany", "profiles", "Default", "mods.yml"),
    // As r2modman writes mods.yml: camelCase keys, the Thunderstore id in name, the version under versionNumber.
    "- name: BepInEx-BepInExPack\n  authorName: BepInEx\n  displayName: BepInExPack\n  versionNumber: { major: 5, minor: 4, patch: 2100 }\n  enabled: true\n" +
      "- name: Evil-Mod\n  authorName: \"Evil<img src=x>\"\n  displayName: Mod\n  enabled: false\n"
  );
  await withEnv({ APPDATA: join(home, "AppData", "Roaming"), HOME: home, MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    const result = await registered(DRAWS_PAGES).call(TOOL, { gameId: "lethalcompany", modManager: "r2modman" });
    assert.deepEqual(result.structuredContent, {
      view: "deps",
      kind: "order",
      theme: "lethal",
      ok: true,
      manager: "r2modman",
      profile: "Default",
      enabledCount: 1,
      totalCount: 2,
      loadOrder: [
        { name: "BepInExPack", enabled: true, index: 0, version: "5.4.2100", source: "thunderstore", author: "BepInEx" },
        { name: "Mod", enabled: false, index: 1, source: "thunderstore", author: "Evil<img src=x>" },
      ],
    });
  });
});

test("MODWRENCH_UI=off: no page, no page metadata and no structured data, even for a client that draws pages", async () => {
  for (const value of ["off", "OFF", "0", "false", "none", " off "]) {
    await withEnv({ MODWRENCH_UI: value, MODWRENCH_STRUCTURED: undefined }, async () => {
      const server = registered(DRAWS_PAGES);
      assert.equal(server.resources.size, 0, value);
      assert.equal(server.tools.get(TOOL)!.config._meta, undefined, value);
      for (const c of CASES) {
        const result = await server.call(TOOL, c.args);
        assert.deepEqual(result.content, [{ type: "text", text: c.text }], `${c.label} ${value}`);
        assert.ok(!("structuredContent" in result), `${c.label} ${value}`);
      }
    });
  }
});

test("MODWRENCH_STRUCTURED: 'always' sends the data to anyone, 'never' to no one", async () => {
  for (const ui of [undefined, "off"]) {
    await withEnv({ MODWRENCH_UI: ui, MODWRENCH_STRUCTURED: "always" }, async () => {
      for (const c of CASES) assert.deepEqual((await registered(PLAIN).call(TOOL, c.args)).structuredContent, c.data, `${c.label} ui=${ui}`);
    });
  }
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: "never" }, async () => {
    for (const c of CASES) assert.ok(!("structuredContent" in (await registered(DRAWS_PAGES).call(TOOL, c.args))), c.label);
  });
});

test("a server that can't take the page still gets every tool, as text, and the load order doesn't point at a page", async () => {
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, async () => {
    // Already connected: registering a resource throws.
    const connected = new ConnectedServer(DRAWS_PAGES);
    assert.equal(registerWorkbenchTools(connected as never).toolCount, 9);
    assert.equal(connected.tools.size, 9);
    assert.equal(connected.resources.size, 0);
    assert.equal(connected.tools.get(TOOL)!.config._meta, undefined);
    for (const c of CASES) {
      const result = await connected.call(TOOL, c.args);
      assert.deepEqual(result.content, [{ type: "text", text: c.text }], c.label);
      assert.ok(!("structuredContent" in result), c.label);
    }

    // From before pages: no registerResource at all.
    const tools = new Map<string, { config: { _meta?: unknown }; handler: (a: Record<string, unknown>) => Promise<ToolResult> }>();
    const toolsOnly = {
      server: { getClientCapabilities: () => DRAWS_PAGES },
      registerTool: (name: string, config: { _meta?: unknown }, handler: (a: Record<string, unknown>) => Promise<ToolResult>) =>
        void tools.set(name, { config, handler }),
    };
    assert.equal(registerWorkbenchTools(toolsOnly as never).toolCount, 9);
    assert.equal(tools.size, 9);
    assert.equal(tools.get(TOOL)!.config._meta, undefined);
    for (const c of CASES) {
      const result = await tools.get(TOOL)!.handler(c.args);
      assert.deepEqual(result.content, [{ type: "text", text: c.text }], c.label);
      assert.ok(!("structuredContent" in result), c.label);
    }
  });
});
