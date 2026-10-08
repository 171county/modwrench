import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createRemoteApp,
  REMOTE_PUBLIC_PLATFORMS,
  REMOTE_TOOL_COUNT,
  startRemoteServer,
} from "../src/server.js";

async function closeServer(server: Server): Promise<void> {
  server.close();
  await once(server, "close");
}

test("health endpoint describes the public remote server", async () => {
  const app = createRemoteApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.transport, "streamable-http");
    assert.deepEqual(body.platforms, [...REMOTE_PUBLIC_PLATFORMS]);
    assert.equal(body.toolCount, REMOTE_TOOL_COUNT);
  } finally {
    await closeServer(server);
  }
});

test("streamable HTTP endpoint lists remote-safe tools", async () => {
  const app = createRemoteApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  const client = new Client({
    name: "modwrench-remote-test",
    version: "0.0.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${address.port}/mcp`)
  );

  try {
    await client.connect(transport);
    const result = await client.listTools();
    const toolNames = result.tools.map((tool) => tool.name);

    assert.equal(result.tools.length, REMOTE_TOOL_COUNT);
    assert.ok(toolNames.includes("thunderstore_list_communities"));
    assert.ok(!toolNames.some((name) => name.startsWith("nexus_")));
    assert.ok(!toolNames.some((name) => name.startsWith("modio_")));
    assert.ok(!toolNames.some((name) => name.startsWith("mw_")));
  } finally {
    await client.close();
    await closeServer(server);
  }
});

test("streamable HTTP endpoint points the Thunderstore list and dependency tools at their pages", async () => {
  const app = createRemoteApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  const client = new Client({
    name: "modwrench-remote-test",
    version: "0.0.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${address.port}/mcp`)
  );

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const pages = Object.fromEntries(
      tools
        .filter((tool) => tool._meta !== undefined)
        .map((tool) => [tool.name, (tool._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri])
    );
    assert.deepEqual(pages, {
      thunderstore_list_mods: "ui://modwrench/mods",
      thunderstore_search_mods: "ui://modwrench/mods",
      thunderstore_top_mods: "ui://modwrench/mods",
      thunderstore_mod_dependencies: "ui://modwrench/deps",
      thunderstore_resolve_dependencies: "ui://modwrench/deps",
    });

    const { resources } = await client.listResources();
    assert.deepEqual(resources.map((r) => r.uri).sort(), ["ui://modwrench/deps", "ui://modwrench/mods"]);
    for (const uri of ["ui://modwrench/mods", "ui://modwrench/deps"]) {
      const read = await client.readResource({ uri });
      const item = read.contents[0] as { mimeType?: string; text?: string };
      assert.equal(item.mimeType, "text/html;profile=mcp-app", uri);
      assert.match(item.text ?? "", /^<!doctype html>/i, uri);
    }
  } finally {
    await client.close();
    await closeServer(server);
  }
});

const PAGE_CLIENT = { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } };
const ONE_MOD = [
  {
    name: "CoolMod",
    full_name: "Someone-CoolMod",
    owner: "Someone",
    package_url: "https://thunderstore.io/c/valheim/p/Someone/CoolMod/",
    rating_score: 7,
    is_pinned: false,
    is_deprecated: false,
    categories: [],
    versions: [{ version_number: "1.0.0", downloads: 10, date_created: "2026-01-01" }],
  },
];

/** A remote server on a free port, with Thunderstore's API answered locally. */
async function remote(options: Parameters<typeof createRemoteApp>[0] = {}) {
  const realFetch = globalThis.fetch;
  const server = createRemoteApp(options).listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  globalThis.fetch = async (input, init) =>
    String(input instanceof Request ? input.url : input).startsWith(endpoint) ? realFetch(input, init) : Response.json(ONE_MOD);
  return {
    endpoint,
    post: (body: unknown, session?: string) =>
      realFetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(session ? { "mcp-session-id": session } : {}),
        },
        body: JSON.stringify(body),
      }),
    remove: (session: string) => realFetch(endpoint, { method: "DELETE", headers: { "mcp-session-id": session } }),
    async close() {
      globalThis.fetch = realFetch;
      await closeServer(server);
    },
  };
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
};

// Each client keeps a session, so the server that runs tools/call is the one that saw the
// client's initialize and knows whether it draws pages, as the local stdio server does.
test("a client that draws pages gets a Thunderstore page's data from remote, and a client that doesn't gets only the text", async () => {
  const r = await remote();
  const listMods = async (options?: typeof PAGE_CLIENT) => {
    const client = new Client({ name: "modwrench-remote-test", version: "0.0.0" }, options);
    await client.connect(new StreamableHTTPClientTransport(new URL(r.endpoint)));
    try {
      return await client.callTool({ name: "thunderstore_list_mods", arguments: { community: "valheim" } });
    } finally {
      await client.close();
    }
  };
  const structured = process.env.MODWRENCH_STRUCTURED;
  try {
    delete process.env.MODWRENCH_STRUCTURED;
    const drawn = await listMods(PAGE_CLIENT);
    const view = drawn.structuredContent as { view?: string; mods?: Array<{ name?: string; author?: string }> };
    assert.equal(view.view, "mods");
    assert.deepEqual(view.mods?.map((m) => [m.name, m.author]), [["CoolMod", "Someone"]]);

    const text = await listMods();
    assert.equal(text.structuredContent, undefined);
    assert.deepEqual(text.content, drawn.content);
    assert.match((text.content as Array<{ text: string }>)[0]!.text, /^Showing 1 of 1 mods in valheim/);
  } finally {
    if (structured === undefined) delete process.env.MODWRENCH_STRUCTURED;
    else process.env.MODWRENCH_STRUCTURED = structured;
    await r.close();
  }
});

test("a request without a session, or with one the server doesn't know, is refused; a client can end its session", async () => {
  const r = await remote();
  try {
    assert.equal((await r.post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 400);
    assert.equal((await r.post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "no-such-session")).status, 404);

    const init = await r.post(INITIALIZE);
    assert.equal(init.status, 200);
    const session = init.headers.get("mcp-session-id");
    assert.ok(session);
    assert.equal((await r.remove(session)).status, 200);
    assert.equal((await r.post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, session)).status, 404);
  } finally {
    await r.close();
  }
});

test("a session left unused is closed, and opening one past the limit closes the least recently used", async () => {
  const idle = await remote({ sessionIdleMs: 50 });
  try {
    const session = (await idle.post(INITIALIZE)).headers.get("mcp-session-id")!;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal((await idle.post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, session)).status, 404);
  } finally {
    await idle.close();
  }

  const full = await remote({ maxSessions: 1 });
  try {
    const first = (await full.post(INITIALIZE)).headers.get("mcp-session-id")!;
    const second = (await full.post(INITIALIZE)).headers.get("mcp-session-id")!;
    assert.notEqual(first, second);
    assert.equal((await full.post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, first)).status, 404);
    assert.notEqual((await full.post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, second)).status, 404);
  } finally {
    await full.close();
  }
});

test("startRemoteServer passes the session limits on to the app", async () => {
  const server = await startRemoteServer({ port: 0, sessionIdleMs: 50, maxSessions: 1 });
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const post = (body: unknown, session?: string) =>
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify(body),
    });
  try {
    const first = (await post(INITIALIZE)).headers.get("mcp-session-id")!;
    await post(INITIALIZE);
    // maxSessions: 1 closed the first session when the second opened.
    assert.equal((await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, first)).status, 404);
  } finally {
    await closeServer(server);
  }
});

test("a DELETE the transport refuses leaves the session open, and an empty session header counts as none", async () => {
  const r = await remote();
  try {
    const session = (await r.post(INITIALIZE)).headers.get("mcp-session-id")!;
    const refused = await fetch(r.endpoint, { method: "DELETE", headers: { "mcp-session-id": session, "mcp-protocol-version": "1999-01-01" } });
    assert.equal(refused.status, 400);
    assert.notEqual((await r.post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, session)).status, 404);

    const empty = await fetch(r.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": "" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    assert.equal(empty.status, 400);
    assert.match(JSON.stringify(await empty.json()), /Mcp-Session-Id header is required/);
  } finally {
    await r.close();
  }
});
