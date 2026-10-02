import { test } from "node:test";
import assert from "node:assert/strict";
import { MCP_APP_MIME, PATCH_DAY_APP_URI } from "@modwrench/ui";
import { registerWorkbenchTools } from "../src/register.js";

// ─── The page and the tool that points at it ─────────────────────────────────
// mw_patch_day can carry a page for clients that support MCP Apps. These tests
// pin the rules that keep that safe to ship:
//
//   - the tool only advertises a page that was actually registered, so a client
//     is never sent after a resource that isn't there;
//   - if the page can't be registered for any reason (switched off, an older or
//     partial server, a server that has already connected) the tool still
//     registers and still answers, as text;
//   - nothing else points at a page, and the tool count doesn't change.
//
// What the page looks like and does is covered in packages/ui/test/app.test.ts.

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

class AppsMockServer {
  tools = new Map<string, { config: ToolConfig; handler: (args: Record<string, unknown>) => Promise<ToolResult> }>();
  resources = new Map<string, { name: string; config: ResourceConfig; read: (uri: URL) => Promise<ReadResult> }>();
  registerTool(name: string, config: ToolConfig, handler: (args: Record<string, unknown>) => Promise<ToolResult>): void {
    this.tools.set(name, { config, handler });
  }
  registerResource(name: string, uri: string, config: ResourceConfig, read: (uri: URL) => Promise<ReadResult>): void {
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

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.MODWRENCH_UI;
  if (value === undefined) delete process.env.MODWRENCH_UI;
  else process.env.MODWRENCH_UI = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MODWRENCH_UI;
    else process.env.MODWRENCH_UI = prev;
  }
}

function register(server: object): { toolCount: number } {
  return registerWorkbenchTools(server as never);
}

// ─── With a page ─────────────────────────────────────────────────────────────

test("the Patch Day page is registered at its address with the MCP Apps type", () => {
  withEnv(undefined, () => {
    const server = new AppsMockServer();
    register(server);
    assert.deepEqual([...server.resources.keys()], [PATCH_DAY_APP_URI]);
    const page = server.resources.get(PATCH_DAY_APP_URI)!;
    assert.equal(page.name, "patch_day_panel");
    assert.equal(page.config.mimeType, MCP_APP_MIME);
    assert.ok(page.config.title);
    assert.match(page.config.description ?? "", /read-only/i);
    assert.match(page.config.description ?? "", /no network/i);
  });
});

test("mw_patch_day points at the page under both spellings and can be called from it", () => {
  withEnv(undefined, () => {
    const server = new AppsMockServer();
    register(server);
    const meta = server.tools.get("mw_patch_day")!.config._meta;
    assert.deepEqual(meta, {
      ui: { resourceUri: PATCH_DAY_APP_URI, visibility: ["model", "app"] },
      "ui/resourceUri": PATCH_DAY_APP_URI,
    });
    assert.ok(server.resources.has(PATCH_DAY_APP_URI), "the tool points at a page that exists");
  });
});

test("reading the page returns one complete document with the type, the address and only the clipboard permission", async () => {
  await withEnv(undefined, async () => {
    const server = new AppsMockServer();
    register(server);
    const read = server.resources.get(PATCH_DAY_APP_URI)!.read;
    const result = await read(new URL(PATCH_DAY_APP_URI));
    assert.equal(result.contents.length, 1);
    const item = result.contents[0]!;
    assert.equal(item.uri, PATCH_DAY_APP_URI);
    assert.equal(item.mimeType, MCP_APP_MIME);
    assert.match(item.text, /^<!doctype html>/i);
    assert.match(item.text, /<title>Patch Day<\/title>/);
    assert.match(item.text, /mw_patch_day/, "the page asks for the tool it belongs to");
    // The only thing the page asks of its host beyond drawing itself.
    assert.deepEqual(item._meta, { ui: { permissions: { clipboardWrite: {} } } });
    // Read again: same page, and a second read isn't a different document.
    const again = await read(new URL(PATCH_DAY_APP_URI));
    assert.equal(again.contents[0]!.text, item.text);
  });
});

test("the page answers with the address it was asked for", async () => {
  await withEnv(undefined, async () => {
    const server = new AppsMockServer();
    register(server);
    const read = server.resources.get(PATCH_DAY_APP_URI)!.read;
    const result = await read(new URL("ui://modwrench/patch-day"));
    assert.equal(result.contents[0]!.uri, "ui://modwrench/patch-day");
  });
});

test("only mw_patch_day points at a page, and there are still seven tools", () => {
  withEnv(undefined, () => {
    const server = new AppsMockServer();
    const { toolCount } = register(server);
    assert.equal(toolCount, 7);
    assert.equal(server.tools.size, 7);
    const withMeta = [...server.tools].filter(([, t]) => t.config._meta !== undefined).map(([name]) => name);
    assert.deepEqual(withMeta, ["mw_patch_day"]);
    assert.equal(server.resources.size, 1);
  });
});

// ─── Without a page ──────────────────────────────────────────────────────────

test("MODWRENCH_UI=off registers no page and the tool carries no page metadata", () => {
  for (const value of ["off", "OFF", "0", "false", "none", " off "]) {
    withEnv(value, () => {
      const server = new AppsMockServer();
      const { toolCount } = register(server);
      assert.equal(toolCount, 7, value);
      assert.equal(server.resources.size, 0, `a page was registered with MODWRENCH_UI=${JSON.stringify(value)}`);
      assert.equal(server.tools.get("mw_patch_day")!.config._meta, undefined, value);
    });
  }
});

test("a server that can't register pages still gets the tool, as text", () => {
  withEnv(undefined, () => {
    const server = new ToolsOnlyServer();
    const { toolCount } = register(server);
    assert.equal(toolCount, 7);
    const tool = server.tools.get("mw_patch_day");
    assert.ok(tool, "the tool was not registered");
    assert.equal(tool._meta, undefined, "the tool points at a page that can't exist");
  });
});

test("a server that is already connected refuses the page and the tool still registers without it", () => {
  withEnv(undefined, () => {
    const server = new ConnectedServer();
    const { toolCount } = register(server);
    assert.equal(toolCount, 7);
    assert.equal(server.resources.size, 0);
    assert.ok(server.tools.has("mw_patch_day"));
    assert.equal(server.tools.get("mw_patch_day")!.config._meta, undefined);
  });
});
