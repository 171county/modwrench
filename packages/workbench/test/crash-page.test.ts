import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CRASH_APP_URI, MCP_APP_MIME, appToolMeta, crashView } from "@modwrench/ui";
import { registerWorkbenchTools } from "../src/register.js";
import { parseCrashlog } from "../src/crashlog/index.js";
import {
  AppsMockServer,
  ConnectedServer,
  DRAWS_PAGES,
  PLAIN,
  withEnv,
  type Handler,
  type ToolConfig,
  type ToolResult,
} from "./helpers/apps-server.js";

// ─── mw_parse_crashlog and mw_diagnose_crash on the Crash log page ───────────
// Both tools answer in text, as they always have. In clients that draw MCP Apps
// pages they also point at the Crash log page and send it the parsed crash as
// structured content; every other client gets the text and nothing else.

/** A small Crash Logger SSE log with a plugin name nobody should trust. */
const LOG = [
  "Skyrim SSE v1.6.640.0",
  "CrashLoggerSSE v1-12-1",
  'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF7B3D2A3F0 SkyrimSE.exe+1AA3A3F0',
  "",
  "PROBABLE CALL STACK:",
  "[0] 0x7FF7B3D2A3F0 SkyrimSE.exe+1AA3A3F0",
  "[1] 0x7FFF12345678 EvilMod.dll+12345",
  "",
  "REGISTERS:",
  "RCX 0x0000000000000018 (size_t)",
  "",
  "PLUGINS:",
  "[00]     Skyrim.esm",
  '[01]     <img src=x onerror="alert(1)">.esp',
  "",
].join("\n");

// The text answers as they were before the page existed, byte for byte.
const PARSED_TEXT = String.raw`{
  "ok": true,
  "detectedType": "crashlogger-sse",
  "exception": {
    "type": "EXCEPTION_ACCESS_VIOLATION",
    "address": "0x7FF7B3D2A3F0",
    "description": "Unhandled exception \"EXCEPTION_ACCESS_VIOLATION\" at 0x7FF7B3D2A3F0 SkyrimSE.exe+1AA3A3F0"
  },
  "callStack": [
    {
      "index": 0,
      "module": "SkyrimSE.exe",
      "offset": "1AA3A3F0"
    },
    {
      "index": 1,
      "module": "EvilMod.dll",
      "offset": "12345"
    }
  ],
  "loadedPlugins": [
    {
      "loadIndex": "00",
      "name": "Skyrim.esm"
    },
    {
      "loadIndex": "01",
      "name": "<img src=x onerror=\"alert(1)\">.esp"
    }
  ],
  "pluginList": "listed",
  "rawSections": {
    "PROBABLE CALL STACK": "[0] 0x7FF7B3D2A3F0 SkyrimSE.exe+1AA3A3F0\n[1] 0x7FFF12345678 EvilMod.dll+12345",
    "REGISTERS": "RCX 0x0000000000000018 (size_t)",
    "PLUGINS": "[00]     Skyrim.esm\n[01]     <img src=x onerror=\"alert(1)\">.esp"
  },
  "gameVersion": "Skyrim SSE v1.6.640.0",
  "loggerVersion": "CrashLoggerSSE v1-12-1",
  "registers": {
    "RCX": "0x0000000000000018"
  },
  "registerTypes": {
    "RCX": "size_t"
  }
}`;

const FAILED_TEXT = String.raw`{
  "ok": false,
  "reason": "Provide either logContent or logPath."
}`;

const DIAGNOSED_TEXT = String.raw`{
  "diagnosis": {
    "detectedType": "crashlogger-sse",
    "suspects": [
      {
        "name": "EvilMod.dll",
        "from": "call-stack",
        "inLoadedPlugins": false
      }
    ],
    "loadedPluginCount": 2,
    "knownConflicts": [],
    "notes": [
      "No gameId given — skipped the known-conflict cross-check. Pass gameId (e.g. skyrimspecialedition) to include it."
    ],
    "disclaimer": "ModWrench correlated these facts from the crash log — it does not name the cause. Reason over the suspects, whether they're in the load order, and any known conflicts to pick the likely culprit. Don't guess beyond the data."
  },
  "crash": ` + PARSED_TEXT.replace(/\n/g, "\n  ") + "\n}";

// What the page is sent for each: the parsed crash (for mw_diagnose_crash too: the diagnosis stays in the text).
const PAGE_DATA = crashView(parseCrashlog({ logContent: LOG }), "skyrim");
const FAILED_DATA = crashView({ ok: false, reason: "Provide either logContent or logPath." }, "skyrim");

/** The four answers: each tool on a log it parses and on a call it can't parse. */
const CASES = [
  { tool: "mw_parse_crashlog", args: { logContent: LOG }, text: PARSED_TEXT, data: PAGE_DATA },
  { tool: "mw_parse_crashlog", args: {}, text: FAILED_TEXT, data: FAILED_DATA },
  { tool: "mw_diagnose_crash", args: { logContent: LOG }, text: DIAGNOSED_TEXT, data: PAGE_DATA },
  { tool: "mw_diagnose_crash", args: {}, text: FAILED_TEXT, data: FAILED_DATA },
] as const;

const TOOLS = ["mw_parse_crashlog", "mw_diagnose_crash"] as const;

/** Defaults for the two variables these tests are about, whatever the shell running them has set. */
const DEFAULTS = { MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined };

/** A server from before pages existed: tools only, and no way to tell what the client declared. */
class ToolsOnlyServer {
  tools = new Map<string, { config: ToolConfig; handler: Handler }>();
  registerTool(name: string, config: ToolConfig, handler: Handler): void {
    this.tools.set(name, { config, handler });
  }
}

type AnyServer = { tools: Map<string, { config: ToolConfig; handler: Handler }> };

/** Each case's answer, in CASES order. */
async function answers(server: AnyServer): Promise<ToolResult[]> {
  const out: ToolResult[] = [];
  for (const c of CASES) out.push(await server.tools.get(c.tool)!.handler({ ...c.args }));
  return out;
}

/** The answer a client that can't draw pages gets: the text, and nothing else. */
const textOnly = (c: (typeof CASES)[number]): ToolResult => ({ content: [{ type: "text", text: c.text }] });

const label = (c: (typeof CASES)[number]): string => `${c.tool} ${"logContent" in c.args ? "parsed" : "unparsed"}`;

test("the crash tools' text answers are what they were before the page", async () => {
  await withEnv(DEFAULTS, async () => {
    const server = new AppsMockServer(PLAIN);
    registerWorkbenchTools(server as never);
    const results = await answers(server);
    CASES.forEach((c, i) => {
      const result = results[i]!;
      assert.equal(result.content[0]!.type, "text", label(c));
      assert.equal(result.content[0]!.text, c.text, label(c));
      assert.equal(result.content.length, 1, `${label(c)}: no panel rides along with the text`);
      assert.equal(result.isError, undefined, label(c));
    });
  });
});

// ─── A client that can't draw pages ──────────────────────────────────────────

test("a text-only client gets the text and nothing else, exactly as with MODWRENCH_UI=off", async () => {
  const off = await withEnv({ ...DEFAULTS, MODWRENCH_UI: "off" }, async () => {
    const server = new AppsMockServer(PLAIN);
    registerWorkbenchTools(server as never);
    return answers(server);
  });
  for (const capabilities of [PLAIN, {}, undefined]) {
    await withEnv(DEFAULTS, async () => {
      const server = new AppsMockServer(capabilities);
      registerWorkbenchTools(server as never);
      // The page is advertised (metadata, not HTML); only a client that draws pages ever reads it.
      for (const tool of TOOLS) assert.deepEqual(server.tools.get(tool)!.config._meta, appToolMeta(CRASH_APP_URI), tool);
      const results = await answers(server);
      CASES.forEach((c, i) => {
        const result = results[i]!;
        assert.deepEqual(result, textOnly(c), `${label(c)} for ${JSON.stringify(capabilities)}`);
        assert.ok(!("structuredContent" in result), label(c));
        const json = JSON.stringify(result);
        for (const html of [/<!doctype/i, /<html/i, /<script/i, /text\/html/i, /"resource"/]) assert.doesNotMatch(json, html, label(c));
        assert.deepEqual(result, off[i], `${label(c)}: the same as with the pages off`);
      });
    });
  }
});

// ─── A client that draws pages ───────────────────────────────────────────────

test("both tools point at the Crash log page, registered once, which reads as one document with no permission", async () => {
  await withEnv(DEFAULTS, async () => {
    const server = new AppsMockServer(DRAWS_PAGES);
    registerWorkbenchTools(server as never);
    for (const tool of TOOLS) assert.deepEqual(server.tools.get(tool)!.config._meta, appToolMeta(CRASH_APP_URI), tool);
    const page = server.resources.get(CRASH_APP_URI);
    assert.ok(page, "the Crash log page is not registered");
    assert.equal(page.name, "crash_panel");
    assert.equal(page.config.mimeType, MCP_APP_MIME);
    assert.equal(page.config.title, "Crash log page");
    assert.match(page.config.description ?? "", /read-only/i);
    assert.match(page.config.description ?? "", /no network/i);
    const read = await page.read(new URL(CRASH_APP_URI));
    assert.equal(read.contents.length, 1);
    const item = read.contents[0]!;
    assert.equal(item.uri, CRASH_APP_URI);
    assert.equal(item.mimeType, MCP_APP_MIME);
    assert.match(item.text, /^<!doctype html>/i);
    assert.ok(item.text.includes("<title>Crash log</title>"));
    assert.equal(item._meta, undefined, "the page asks for no permission");
    for (const tool of TOOLS) assert.ok(!item.text.includes(tool), `the page names ${tool}: a page shared by two tools calls neither`);
  });
});

test("a client that draws pages gets the parsed crash as the page's data, beside the same text", async () => {
  await withEnv(DEFAULTS, async () => {
    const server = new AppsMockServer(DRAWS_PAGES);
    registerWorkbenchTools(server as never);
    const results = await answers(server);
    CASES.forEach((c, i) => {
      const result = results[i]!;
      assert.deepEqual(result.content, textOnly(c).content, label(c));
      assert.equal(result.isError, undefined, label(c));
      assert.deepEqual(result.structuredContent, c.data, label(c));
      assert.equal(result.structuredContent!.view, "crash", label(c));
    });
    // The plugin name nobody should trust is sent as data; the page puts it on screen as text.
    const plugins = results[0]!.structuredContent!.loadedPlugins as Array<{ name: string }>;
    assert.equal(plugins[1]!.name, '<img src=x onerror="alert(1)">.esp');
  });
});

test("the page's skin follows the game whose log it is", async () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const buffout = readFileSync(join(here, "fixtures", "crash-buffout4.log"), "utf8");
  await withEnv(DEFAULTS, async () => {
    const server = new AppsMockServer(DRAWS_PAGES);
    registerWorkbenchTools(server as never);
    for (const tool of TOOLS) {
      const result = await server.call(tool, { logContent: buffout });
      assert.equal(result.structuredContent!.theme, "fallout", tool);
      assert.equal(result.structuredContent!.detectedType, "buffout4", tool);
    }
  });
});

// ─── No page ─────────────────────────────────────────────────────────────────

test("MODWRENCH_UI=off: no page, no page metadata and no data for the page, even for a client that draws pages", async () => {
  for (const value of ["off", "OFF", "0", "false", "none", " off "]) {
    await withEnv({ ...DEFAULTS, MODWRENCH_UI: value }, async () => {
      const server = new AppsMockServer(DRAWS_PAGES);
      registerWorkbenchTools(server as never);
      assert.equal(server.resources.has(CRASH_APP_URI), false, value);
      for (const tool of TOOLS) assert.equal(server.tools.get(tool)!.config._meta, undefined, `${tool} ${value}`);
      const results = await answers(server);
      CASES.forEach((c, i) => assert.deepEqual(results[i], textOnly(c), `${label(c)} ${value}`));
    });
  }
});

test("MODWRENCH_STRUCTURED: 'always' sends the page's data to anyone, 'never' to no one", async () => {
  for (const ui of [undefined, "off"]) {
    await withEnv({ MODWRENCH_UI: ui, MODWRENCH_STRUCTURED: "always" }, async () => {
      const server = new AppsMockServer(PLAIN);
      registerWorkbenchTools(server as never);
      const results = await answers(server);
      CASES.forEach((c, i) => {
        assert.deepEqual(results[i]!.content, textOnly(c).content, label(c));
        assert.deepEqual(results[i]!.structuredContent, c.data, `${label(c)} with MODWRENCH_UI=${ui}`);
      });
    });
  }
  await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: "never" }, async () => {
    const server = new AppsMockServer(DRAWS_PAGES);
    registerWorkbenchTools(server as never);
    const results = await answers(server);
    CASES.forEach((c, i) => assert.deepEqual(results[i], textOnly(c), label(c)));
  });
});

test("a server that can't take the page still gets both tools, as text, with no page metadata and no data for it", async () => {
  await withEnv(DEFAULTS, async () => {
    const connected = new ConnectedServer(DRAWS_PAGES);
    const toolsOnly = new ToolsOnlyServer();
    for (const server of [connected, toolsOnly]) {
      const { toolCount } = registerWorkbenchTools(server as never);
      assert.equal(toolCount, 9);
      assert.equal(server.tools.size, 9);
      for (const tool of TOOLS) assert.equal(server.tools.get(tool)!.config._meta, undefined, tool);
      const results = await answers(server);
      CASES.forEach((c, i) => assert.deepEqual(results[i], textOnly(c), label(c)));
    }
    assert.equal(connected.resources.size, 0);
  });
});
