import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_APP_MIME,
  MCP_APPS_EXTENSION_ID,
  appResourceMeta,
  appToolMeta,
  pageData,
  registerAppPage,
  type AppPageDef,
} from "../src/index.js";

// ─── Registering a page, from any package ────────────────────────────────────
// registerAppPage is how every package that has a page offers it. These tests pin
// what the tools that use it rely on: a page is registered once per server however
// many tools point at it, a tool is only told about a page that was registered, and
// nothing goes wrong when a server can't take a page. pageData decides who gets the
// structured data. The same rules are checked against the real SDK in
// packages/workbench/test/apps.test.ts.

type Read = (uri: URL) => Promise<{ contents: Array<Record<string, unknown>> }>;

class MockServer {
  calls: Array<{ name: string; uri: string; config: Record<string, unknown>; read: Read }> = [];
  registerResource(name: string, uri: string, config: Record<string, unknown>, read: Read): void {
    if (this.calls.some((c) => c.uri === uri)) throw new Error(`Resource ${uri} is already registered`);
    this.calls.push({ name, uri, config, read });
  }
}

/** A server that refuses the first registration (as an SDK server already connected would) and takes the next. */
class RefusesOnceServer extends MockServer {
  refused = 0;
  override registerResource(name: string, uri: string, config: Record<string, unknown>, read: Read): void {
    if (this.refused++ === 0) throw new Error("Cannot register capabilities after connecting to transport");
    super.registerResource(name, uri, config, read);
  }
}

// Each test uses its own address: a page's HTML is rendered once per address and kept.
let n = 0;
function def(over: Partial<AppPageDef> = {}): AppPageDef & { renders: () => number } {
  let renders = 0;
  const uri = `ui://modwrench/test-${++n}`;
  return {
    name: `test_${n}_panel`,
    uri,
    title: "Test page",
    description: "A test page. Read-only; it makes no network requests and keeps nothing.",
    render: () => {
      renders++;
      return `<!doctype html><title>${uri}</title>`;
    },
    clipboard: false,
    ...over,
    renders: () => renders,
  };
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

test("a page is registered once per server, however many tools ask, and each tool gets its own copy of the metadata", () => {
  withUi(undefined, () => {
    const server = new MockServer();
    const page = def();
    const first = registerAppPage(server, page);
    const second = registerAppPage(server, page);
    assert.equal(server.calls.length, 1);
    assert.deepEqual(first, appToolMeta(page.uri));
    assert.deepEqual(second, first);
    assert.notEqual(second, first, "two tools must not share one mutable object");
  });
});

test("the page is registered under its name, with its title, description and the MCP Apps type", () => {
  withUi(undefined, () => {
    const server = new MockServer();
    const page = def();
    registerAppPage(server, page);
    const [call] = server.calls;
    assert.equal(call!.name, page.name);
    assert.equal(call!.uri, page.uri);
    assert.deepEqual(call!.config, { title: page.title, description: page.description, mimeType: MCP_APP_MIME });
  });
});

test("two servers each get the page once", () => {
  withUi(undefined, () => {
    const page = def();
    const a = new MockServer();
    const b = new MockServer();
    assert.ok(registerAppPage(a, page));
    assert.ok(registerAppPage(b, page));
    assert.ok(registerAppPage(a, page));
    assert.equal(a.calls.length, 1);
    assert.equal(b.calls.length, 1);
  });
});

test("reading the page answers with the address asked for, renders the HTML once, and asks for the clipboard only when told to", async () => {
  const plain = def();
  const copying = def({ clipboard: true });
  const servers = [new MockServer(), new MockServer()];
  withUi(undefined, () => {
    for (const server of servers) {
      registerAppPage(server, plain);
      registerAppPage(server, copying);
    }
  });
  for (const server of servers) {
    const [p, c] = server.calls;
    const read = await p!.read(new URL(plain.uri + "?again"));
    assert.deepEqual(read.contents, [{ uri: plain.uri + "?again", mimeType: MCP_APP_MIME, text: `<!doctype html><title>${plain.uri}</title>` }]);
    assert.ok(!("_meta" in read.contents[0]!), "a page without a Copy button asks for no permission");
    const withCopy = await c!.read(new URL(copying.uri));
    assert.deepEqual(withCopy.contents[0]!._meta, appResourceMeta());
  }
  assert.equal(plain.renders(), 1, "the HTML is rendered once and kept");
  assert.equal(copying.renders(), 1);
});

test("a server that can't take the page gets no metadata, and isn't remembered as having it", () => {
  withUi(undefined, () => {
    const server = new RefusesOnceServer();
    const page = def();
    assert.equal(registerAppPage(server, page), undefined, "the tool must not point at a page that isn't there");
    assert.equal(server.calls.length, 0);
    assert.deepEqual(registerAppPage(server, page), appToolMeta(page.uri), "a later try registers it");
    assert.equal(server.calls.length, 1);
  });
});

test("a server with no registerResource at all gets no page, and nothing throws", () => {
  withUi(undefined, () => {
    for (const server of [{}, { registerResource: "not a function" }, { registerTool() {} }]) {
      assert.equal(registerAppPage(server, def()), undefined);
    }
  });
});

test("MODWRENCH_UI=off: no page is registered and no metadata is returned", () => {
  for (const value of ["off", "OFF", "0", "false", "none", " off "]) {
    withUi(value, () => {
      const server = new MockServer();
      assert.equal(registerAppPage(server, def()), undefined, value);
      assert.equal(server.calls.length, 0, value);
    });
  }
});

test("MODWRENCH_STRUCTURED=never: no page is registered and no metadata is returned, since no page would ever get data", () => {
  for (const value of ["never", "NEVER", "off", "0", "false", "no", "none"]) {
    withUi(undefined, () =>
      withEnv("MODWRENCH_STRUCTURED", value, () => {
        const server = new MockServer();
        assert.equal(registerAppPage(server, def()), undefined, value);
        assert.equal(appToolMeta("ui://modwrench/anything"), undefined, value);
        assert.equal(server.calls.length, 0, value);
      })
    );
  }
});

// ─── Who gets the structured data ────────────────────────────────────────────

const capable = { server: { getClientCapabilities: () => ({ extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME] } } }) } };
const plainClient = { server: { getClientCapabilities: () => ({ roots: {} }) } };

test("pageData: the data goes to a client that draws pages while there is a page, to everyone on 'always', to nobody on 'never'", () => {
  const data = { view: "test", rows: [1, 2] };
  const cases: Array<[mode: string | undefined, client: object, page: boolean, sent: boolean]> = [
    [undefined, capable, true, true],
    [undefined, capable, false, false],
    [undefined, plainClient, true, false],
    [undefined, plainClient, false, false],
    ["always", capable, true, true],
    ["always", capable, false, true],
    ["always", plainClient, true, true],
    ["always", plainClient, false, true],
    ["never", capable, true, false],
    ["never", capable, false, false],
    ["never", plainClient, true, false],
    ["never", plainClient, false, false],
  ];
  for (const [mode, client, page, sent] of cases) {
    const got = withEnv("MODWRENCH_STRUCTURED", mode, () => pageData(client, data, page));
    const label = `${mode ?? "auto"} / ${client === capable ? "draws pages" : "text only"} / ${page ? "page" : "no page"}`;
    if (sent) assert.deepEqual(got, { structuredContent: data }, label);
    else assert.deepEqual(got, {}, label);
    assert.ok(!("isError" in got), label);
  }
});

test("pageData: turning pages off while the server runs stops the data at once, even for a page registered before", () => {
  const data = { view: "test" };
  withUi(undefined, () => {
    const server = new MockServer();
    const page = def();
    assert.ok(registerAppPage(server, page), "the page was registered with pages on");
    assert.deepEqual(pageData(capable, data, true), { structuredContent: data });
    withUi("off", () => assert.deepEqual(pageData(capable, data, true), {}, "auto mode honours MODWRENCH_UI=off on every answer"));
    // "always" is the person's explicit wish to have the data everywhere, pages or not.
    withUi("off", () => withEnv("MODWRENCH_STRUCTURED", "always", () => assert.deepEqual(pageData(plainClient, data, false), { structuredContent: data })));
  });
});
