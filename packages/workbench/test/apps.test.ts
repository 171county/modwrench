import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CRASH_WHISPERER_APP_URI,
  DOCTOR_APP_URI,
  MCP_APP_MIME,
  MCP_APPS_EXTENSION_ID,
  PATCH_DAY_APP_URI,
} from "@modwrench/ui";
import { clientDrawsPages, pageAnswer, structuredMode, wantsStructured } from "../src/apps.js";
import { registerWorkbenchTools } from "../src/register.js";

// ─── The pages and the tools that point at them ──────────────────────────────
// mw_patch_day, mw_crash_whisperer and mw_doctor each carry a page for clients that
// support MCP Apps. These tests pin the rules that keep that safe to ship:
//
//   - a tool only advertises a page that was actually registered, so a client
//     is never sent after a resource that isn't there;
//   - if a page can't be registered for any reason (switched off, an older or
//     partial server, a server that has already connected) the tool still
//     registers and still answers, as text, and one page failing doesn't take
//     the other down;
//   - nothing else points at a page, and the tool count is what it says;
//   - the full report goes only to clients that can draw it (or when asked for),
//     because some clients show the model the structured data instead of the text.
//
// What the pages look like and do is covered in packages/ui/test/app.test.ts.

type ToolConfig = {
  title?: string;
  description: string;
  inputSchema?: unknown;
  annotations: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};
type ToolResult = { content: Array<{ type: string; text: string }>; structuredContent?: unknown; isError?: boolean };
type ReadResult = { contents: Array<{ uri: string; mimeType?: string; text: string; _meta?: Record<string, unknown> }> };
type ResourceConfig = { title?: string; description?: string; mimeType?: string };
type Reader = (uri: URL) => Promise<ReadResult>;

class AppsMockServer {
  tools = new Map<string, { config: ToolConfig; handler: (args: Record<string, unknown>) => Promise<ToolResult> }>();
  resources = new Map<string, { name: string; config: ResourceConfig; read: Reader }>();
  registerTool(name: string, config: ToolConfig, handler: (args: Record<string, unknown>) => Promise<ToolResult>): void {
    this.tools.set(name, { config, handler });
  }
  registerResource(name: string, uri: string, config: ResourceConfig, read: Reader): void {
    // The real server refuses a second resource at the same address.
    if (this.resources.has(uri)) throw new Error(`Resource ${uri} is already registered`);
    this.resources.set(uri, { name, config, read });
  }
}

/** A server from before pages existed: tools only. */
class ToolsOnlyServer {
  tools = new Map<string, ToolConfig>();
  registerTool(name: string, config: ToolConfig): void {
    this.tools.set(name, config);
  }
}

/** A server that is already connected, so registering a resource throws. */
class ConnectedServer extends AppsMockServer {
  override registerResource(): void {
    throw new Error("Cannot register capabilities after connecting to transport");
  }
}

/** A server with room for one page only: the first registers, the second throws. */
class OnePageServer extends AppsMockServer {
  override registerResource(name: string, uri: string, config: ResourceConfig, read: Reader): void {
    if (this.resources.size >= 1) throw new Error("no room for another page");
    super.registerResource(name, uri, config, read);
  }
}

function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

const withUi = <T>(value: string | undefined, fn: () => T): T => withEnv("MODWRENCH_UI", value, fn);
const withStructured = <T>(value: string | undefined, fn: () => T): T => withEnv("MODWRENCH_STRUCTURED", value, fn);

function register(server: object): { toolCount: number } {
  return registerWorkbenchTools(server as never);
}

const PAGES = [
  { tool: "mw_patch_day", uri: PATCH_DAY_APP_URI, name: "patch_day_panel", title: "Patch Day", elsewhere: "ui://modwrench/patch-day" },
  {
    tool: "mw_crash_whisperer",
    uri: CRASH_WHISPERER_APP_URI,
    name: "crash_whisperer_panel",
    title: "Crash Whisperer",
    elsewhere: "ui://modwrench/crash-whisperer-too",
  },
  { tool: "mw_doctor", uri: DOCTOR_APP_URI, name: "doctor_panel", title: "Doctor", elsewhere: "ui://modwrench/doctor-too" },
] as const;

// ─── With a page ─────────────────────────────────────────────────────────────

test("the pages have their own addresses", () => {
  const uris = PAGES.map((p) => p.uri);
  assert.equal(new Set(uris).size, uris.length);
  for (const uri of uris) assert.match(uri, /^ui:\/\/modwrench\/[a-z-]+$/);
});

test("each page is registered at its address with the MCP Apps type", () => {
  withUi(undefined, () => {
    const server = new AppsMockServer();
    register(server);
    assert.deepEqual([...server.resources.keys()].sort(), PAGES.map((p) => p.uri).sort());
    for (const p of PAGES) {
      const page = server.resources.get(p.uri)!;
      assert.equal(page.name, p.name);
      assert.equal(page.config.mimeType, MCP_APP_MIME);
      assert.ok(page.config.title);
      assert.match(page.config.description ?? "", /read-only/i, p.name);
      assert.match(page.config.description ?? "", /no network/i, p.name);
    }
  });
});

test("each tool points at its page under both spellings and can be called from it", () => {
  withUi(undefined, () => {
    const server = new AppsMockServer();
    register(server);
    for (const p of PAGES) {
      const meta = server.tools.get(p.tool)!.config._meta;
      assert.deepEqual(meta, {
        ui: { resourceUri: p.uri, visibility: ["model", "app"] },
        "ui/resourceUri": p.uri,
      });
      assert.ok(server.resources.has(p.uri), `${p.tool} points at a page that exists`);
    }
  });
});

test("reading a page returns one complete document with the type, the address and only the clipboard permission", async () => {
  await withUi(undefined, async () => {
    const server = new AppsMockServer();
    register(server);
    for (const p of PAGES) {
      const read = server.resources.get(p.uri)!.read;
      const result = await read(new URL(p.uri));
      assert.equal(result.contents.length, 1, p.name);
      const item = result.contents[0]!;
      assert.equal(item.uri, p.uri);
      assert.equal(item.mimeType, MCP_APP_MIME);
      assert.match(item.text, /^<!doctype html>/i);
      assert.ok(item.text.includes(`<title>${p.title}</title>`), `${p.name}: the page has its title`);
      assert.ok(item.text.includes(p.tool), `${p.name}: the page asks for the tool it belongs to`);
      // The only thing the page asks of its host beyond drawing itself.
      assert.deepEqual(item._meta, { ui: { permissions: { clipboardWrite: {} } } });
      // Read again: same page, and a second read isn't a different document.
      const again = await read(new URL(p.uri));
      assert.equal(again.contents[0]!.text, item.text);
    }
  });
});

test("each page asks for its own tool and not another page's", async () => {
  await withUi(undefined, async () => {
    const server = new AppsMockServer();
    register(server);
    const text = new Map<string, string>();
    for (const p of PAGES) text.set(p.tool, (await server.resources.get(p.uri)!.read(new URL(p.uri))).contents[0]!.text);
    for (const p of PAGES) {
      for (const other of PAGES) {
        if (other.tool !== p.tool) assert.ok(!text.get(p.tool)!.includes(other.tool), `the ${p.title} page mentions ${other.tool}`);
      }
    }
    assert.equal(new Set(text.values()).size, PAGES.length, "two pages are the same document");
  });
});

test("a page answers with the address it was asked for", async () => {
  await withUi(undefined, async () => {
    const server = new AppsMockServer();
    register(server);
    for (const p of PAGES) {
      const result = await server.resources.get(p.uri)!.read(new URL(p.elsewhere));
      assert.equal(result.contents[0]!.uri, p.elsewhere);
    }
  });
});

test("only mw_patch_day, mw_crash_whisperer and mw_doctor point at a page, and there are nine tools", () => {
  withUi(undefined, () => {
    const server = new AppsMockServer();
    const { toolCount } = register(server);
    assert.equal(toolCount, 9);
    assert.equal(server.tools.size, 9);
    const withMeta = [...server.tools].filter(([, t]) => t.config._meta !== undefined).map(([name]) => name);
    assert.deepEqual(withMeta.sort(), ["mw_crash_whisperer", "mw_doctor", "mw_patch_day"]);
    assert.equal(server.resources.size, 3);
  });
});

// ─── Without a page ──────────────────────────────────────────────────────────

test("MODWRENCH_UI=off registers no page and the tools carry no page metadata", () => {
  for (const value of ["off", "OFF", "0", "false", "none", " off "]) {
    withUi(value, () => {
      const server = new AppsMockServer();
      const { toolCount } = register(server);
      assert.equal(toolCount, 9, value);
      assert.equal(server.resources.size, 0, `a page was registered with MODWRENCH_UI=${JSON.stringify(value)}`);
      for (const p of PAGES) assert.equal(server.tools.get(p.tool)!.config._meta, undefined, `${p.tool} ${value}`);
    });
  }
});

test("a server that can't register pages still gets every tool, as text", () => {
  withUi(undefined, () => {
    const server = new ToolsOnlyServer();
    const { toolCount } = register(server);
    assert.equal(toolCount, 9);
    for (const p of PAGES) {
      const tool = server.tools.get(p.tool);
      assert.ok(tool, `${p.tool} was not registered`);
      assert.equal(tool._meta, undefined, `${p.tool} points at a page that can't exist`);
    }
  });
});

test("a server that is already connected refuses the pages and the tools still register without them", () => {
  withUi(undefined, () => {
    const server = new ConnectedServer();
    const { toolCount } = register(server);
    assert.equal(toolCount, 9);
    assert.equal(server.resources.size, 0);
    for (const p of PAGES) {
      assert.ok(server.tools.has(p.tool));
      assert.equal(server.tools.get(p.tool)!.config._meta, undefined);
    }
  });
});

test("one page that can't be registered doesn't take the others down, and its tool doesn't point at it", () => {
  withUi(undefined, () => {
    const server = new OnePageServer();
    const { toolCount } = register(server);
    assert.equal(toolCount, 9);
    assert.deepEqual([...server.resources.keys()], [PATCH_DAY_APP_URI]);
    assert.ok(server.tools.get("mw_patch_day")!.config._meta !== undefined, "the page that registered is advertised");
    for (const tool of ["mw_crash_whisperer", "mw_doctor"]) {
      assert.equal(server.tools.get(tool)!.config._meta, undefined, `${tool}: the page that didn't register isn't advertised`);
      assert.ok(server.tools.has(tool));
    }
  });
});

// ─── Who gets the structured report ──────────────────────────────────────────

/** A server whose client said, when it connected, that it can draw MCP Apps pages. */
const drawsPages = (mimeTypes: unknown = [MCP_APP_MIME]): object => ({
  server: { getClientCapabilities: () => ({ extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes } } }) },
});

const withCapabilities = (capabilities: unknown): object => ({ server: { getClientCapabilities: () => capabilities } });

test("the extension a client names to say it can draw pages", () => {
  assert.equal(MCP_APPS_EXTENSION_ID, "io.modelcontextprotocol/ui");
});

test("structuredMode: pages-capable clients by default, and 'always' and 'never' spelled the usual ways", () => {
  for (const v of [undefined, "", "auto", "AUTO", "banana", "  ", "pages", "2"]) assert.equal(structuredMode(v), "auto", String(v));
  for (const v of ["always", "ALWAYS", " always ", "on", "1", "true", "yes", "Yes"]) assert.equal(structuredMode(v), "always", v);
  for (const v of ["never", "Never", " never ", "off", "0", "false", "no", "none"]) assert.equal(structuredMode(v), "never", v);
});

test("structuredMode reads MODWRENCH_STRUCTURED when it isn't given a value", () => {
  withStructured("always", () => assert.equal(structuredMode(), "always"));
  withStructured("never", () => assert.equal(structuredMode(), "never"));
  withStructured(undefined, () => assert.equal(structuredMode(), "auto"));
});

test("clientDrawsPages: only a client that named the extension and the page type", () => {
  assert.equal(clientDrawsPages(drawsPages()), true);
  assert.equal(clientDrawsPages(drawsPages([MCP_APP_MIME, "text/html"])), true);
  // Said something, but not that it draws pages.
  assert.equal(clientDrawsPages(drawsPages(["text/html"])), false, "a different page type");
  assert.equal(clientDrawsPages(drawsPages([])), false, "no page types");
  assert.equal(clientDrawsPages(drawsPages("text/html;profile=mcp-app")), false, "a string is not a list");
  assert.equal(clientDrawsPages(withCapabilities({ extensions: { [MCP_APPS_EXTENSION_ID]: {} } })), false, "no list at all");
  assert.equal(clientDrawsPages(withCapabilities({ extensions: { [MCP_APPS_EXTENSION_ID]: null } })), false, "an empty claim");
  assert.equal(clientDrawsPages(withCapabilities({ extensions: { "io.example/other": { mimeTypes: [MCP_APP_MIME] } } })), false, "another extension");
  assert.equal(clientDrawsPages(withCapabilities({ extensions: {} })), false);
  assert.equal(clientDrawsPages(withCapabilities({ roots: {}, sampling: {} })), false, "a client with no extensions");
  // The extension named at the wrong level doesn't count.
  assert.equal(clientDrawsPages(withCapabilities({ [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME] } })), false);
  assert.equal(clientDrawsPages(withCapabilities({ experimental: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME] } } })), false);
});

test("clientDrawsPages: no way to tell is a no", () => {
  assert.equal(clientDrawsPages(undefined), false);
  assert.equal(clientDrawsPages(null), false);
  assert.equal(clientDrawsPages({}), false, "a server with no .server");
  assert.equal(clientDrawsPages({ server: {} }), false, "no getClientCapabilities");
  assert.equal(clientDrawsPages({ server: { getClientCapabilities: () => undefined } }), false, "not connected yet");
  assert.equal(clientDrawsPages({ server: { getClientCapabilities: () => null } }), false);
  assert.equal(clientDrawsPages({ server: { getClientCapabilities: () => "yes" } }), false);
  assert.equal(
    clientDrawsPages({ server: { getClientCapabilities: () => { throw new Error("boom"); } } }),
    false,
    "a throwing server doesn't take the tool down"
  );
  assert.equal(clientDrawsPages(new AppsMockServer()), false, "the plain mock server");
});

test("wantsStructured: a pages-capable client by default, anyone on 'always', nobody on 'never'", () => {
  const apps = drawsPages();
  const plain = withCapabilities({ roots: {} });
  withStructured(undefined, () => {
    assert.equal(wantsStructured(apps), true);
    assert.equal(wantsStructured(plain), false);
    assert.equal(wantsStructured(new AppsMockServer()), false);
  });
  withStructured("always", () => {
    assert.equal(wantsStructured(apps), true);
    assert.equal(wantsStructured(plain), true);
    assert.equal(wantsStructured(new AppsMockServer()), true);
  });
  withStructured("never", () => {
    assert.equal(wantsStructured(apps), false, "'never' beats a client that asks for it");
    assert.equal(wantsStructured(plain), false);
  });
});

test("pageAnswer: the text for everyone, the report for the ones that should have it", () => {
  const report = { ok: true as const, verdict: "go", plugins: { total: 3 } };
  withStructured(undefined, () => {
    const forApps = pageAnswer(drawsPages(), "a short answer", report);
    assert.deepEqual(forApps.content, [{ type: "text", text: "a short answer" }]);
    assert.deepEqual(forApps.structuredContent, report);
    assert.equal(forApps.isError, undefined);
    assert.ok(!("isError" in forApps), "no isError key at all when it worked");

    const forOthers = pageAnswer(withCapabilities({}), "a short answer", report);
    assert.deepEqual(forOthers.content, [{ type: "text", text: "a short answer" }]);
    assert.ok(!("structuredContent" in forOthers), "no structuredContent key at all for a client that can't draw it");
    assert.equal(forOthers.isError, undefined);
  });
});

test("pageAnswer: a run that couldn't happen is flagged whoever the client is", () => {
  const failed = { ok: false as const, error: "no game" };
  withStructured(undefined, () => {
    const forApps = pageAnswer(drawsPages(), "couldn't run", failed);
    assert.equal(forApps.isError, true);
    assert.deepEqual(forApps.structuredContent, failed);
    const forOthers = pageAnswer(withCapabilities({}), "couldn't run", failed);
    assert.equal(forOthers.isError, true);
    assert.ok(!("structuredContent" in forOthers));
    assert.deepEqual(forOthers.content, [{ type: "text", text: "couldn't run" }]);
  });
});

test("pageAnswer follows MODWRENCH_STRUCTURED", () => {
  const report = { ok: true as const };
  withStructured("always", () => assert.deepEqual(pageAnswer(withCapabilities({}), "t", report).structuredContent, report));
  withStructured("never", () => assert.ok(!("structuredContent" in pageAnswer(drawsPages(), "t", report))));
});

// ─── Both tools answer the same way ──────────────────────────────────────────

test("both tools say in their descriptions that they only read, and annotate it", () => {
  withUi(undefined, () => {
    const server = new AppsMockServer();
    register(server);
    for (const p of PAGES) {
      const { config } = server.tools.get(p.tool)!;
      assert.equal(config.annotations.readOnlyHint, true, p.tool);
      assert.equal(config.annotations.destructiveHint, false, p.tool);
      assert.equal(config.annotations.openWorldHint, false, p.tool);
      assert.match(config.description, /read-only/i, p.tool);
    }
  });
});
