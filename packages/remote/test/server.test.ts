import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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

// HTTP requires a 405 to say which methods the address does take.
test("GET /mcp is refused with 405 and an Allow header naming the methods /mcp takes", async () => {
  const r = await remote();
  try {
    for (const method of ["GET", "HEAD"]) {
      const res = await fetch(r.endpoint, { method, headers: { accept: "text/event-stream" } });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get("allow"), "POST, DELETE", method);
    }
  } finally {
    await r.close();
  }
});

// express.json() rejects such a body before any route runs; Express's own handler would answer
// with an HTML page holding the stack trace and the server's folder paths.
test("a body that isn't JSON, or is too large, gets a short JSON-RPC error, not an HTML page with a stack trace", async () => {
  const server = createRemoteApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const cases: Array<[string, number, number, string]> = [
    ["{not json", 400, -32700, "Parse error"],
    [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "a".repeat(200_000) } }), 413, -32600, "Request body too large"],
  ];
  try {
    for (const [body, status, code, message] of cases) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body,
      });
      assert.equal(res.status, status, message);
      assert.match(res.headers.get("content-type") ?? "", /^application\/json/, message);
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { jsonrpc: "2.0", error: { code, message }, id: null });
      assert.doesNotMatch(text, /node_modules|<pre>|\bat \S+ \(/, message);
    }
  } finally {
    await closeServer(server);
  }
});

/** POSTs an initialize, naming the page it came from when there is one, as a browser does. */
const initializeFrom = (endpoint: string, origin?: string) =>
  fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(origin ? { origin } : {}) },
    body: JSON.stringify(INITIALIZE),
  });

const EVIL = "http://evil.example";

// A browser names the page a request came from in Origin, and the page can't change it, so a page
// on another site, or one that has pointed its own name at this computer (DNS rebinding), is
// refused before its body is read or a session looked at. Programs other than browsers send no Origin.
test("a request from a page on another site gets 403 on POST, GET and DELETE, and opens or ends no session", async () => {
  const r = await remote({ maxSessions: 1 });
  const json = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const from = (origin: string, method: string, headers: Record<string, string>, body?: string) =>
    fetch(r.endpoint, { method, headers: { ...headers, origin }, body });
  try {
    const session = (await r.post(INITIALIZE)).headers.get("mcp-session-id");
    assert.ok(session, "a request with no Origin is answered");
    const refused = [
      await from(EVIL, "POST", json, JSON.stringify(INITIALIZE)),
      await from(EVIL, "POST", { ...json, "mcp-session-id": session }, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })),
      await from(EVIL, "POST", json, "{not json"),
      await from(EVIL, "GET", { accept: "text/event-stream", "mcp-session-id": session }),
      await from(EVIL, "DELETE", { "mcp-session-id": session }),
    ];
    for (const res of refused) {
      assert.equal(res.status, 403);
      assert.equal(res.headers.get("mcp-session-id"), null);
      assert.deepEqual(await res.json(), { jsonrpc: "2.0", error: { code: -32000, message: `Invalid Origin: ${EVIL}` }, id: null });
    }
    // Only one session may be open, so a session opened by the refused initialize would have
    // closed this one; so would the refused DELETE.
    assert.equal((await r.post({ jsonrpc: "2.0", id: 3, method: "tools/list" }, session)).status, 200);
  } finally {
    await r.close();
  }
});

test("by default a page on this computer may connect only while the server listens on this computer alone", async () => {
  const local = await remote();
  try {
    for (const origin of ["http://localhost:6274", "http://127.0.0.1:5173", "http://[::1]:8080", "https://localhost"]) {
      assert.equal((await initializeFrom(local.endpoint, origin)).status, 200, origin);
    }
    for (const origin of [EVIL, "http://localhost.evil.example", "null"]) {
      assert.equal((await initializeFrom(local.endpoint, origin)).status, 403, origin);
    }
  } finally {
    await local.close();
  }

  // Listening on every interface, "localhost" is whichever computer the browser runs on.
  const open = await remote({ host: "0.0.0.0", allowedHosts: ["127.0.0.1"] });
  try {
    assert.equal((await initializeFrom(open.endpoint, "http://localhost:6274")).status, 403);
    assert.equal((await initializeFrom(open.endpoint)).status, 200);
  } finally {
    await open.close();
  }
});

test("allowedOrigins replaces the default with exactly the pages listed, and the Host check still applies", async () => {
  const r = await remote({ allowedOrigins: ["https://app.example"] });
  try {
    assert.equal((await initializeFrom(r.endpoint, "https://app.example")).status, 200);
    assert.equal((await initializeFrom(r.endpoint, "https://app.example:8443")).status, 403);
    assert.equal((await initializeFrom(r.endpoint, "http://localhost:6274")).status, 403);
    assert.equal((await initializeFrom(r.endpoint)).status, 200);
  } finally {
    await r.close();
  }

  const wrongHost = await remote({ allowedHosts: ["mcp.example"], allowedOrigins: ["https://app.example"] });
  try {
    const res = await initializeFrom(wrongHost.endpoint, "https://app.example");
    assert.equal(res.status, 403);
    assert.match(JSON.stringify(await res.json()), /Invalid Host: 127\.0\.0\.1/);
  } finally {
    await wrongHost.close();
  }
});

const ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));

test("MODWRENCH_ALLOWED_ORIGINS is read as a comma-separated list and reaches the server", { timeout: 60_000 }, async () => {
  // The entry point refuses port 0, so find a free port first.
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as AddressInfo).port;
  await closeServer(probe);

  const child = spawn(process.execPath, ["--import", "tsx", ENTRY], {
    env: {
      ...process.env,
      MODWRENCH_REMOTE_HOST: "127.0.0.1",
      MODWRENCH_REMOTE_PORT: String(port),
      MODWRENCH_ALLOWED_HOSTS: "",
      MODWRENCH_ALLOWED_ORIGINS: " https://a.example, ,https://b.example ",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let stderr = "";
      child.stderr.on("data", (d) => {
        stderr += d;
        if (stderr.includes("remote.started")) resolve();
      });
      child.once("exit", (code) => reject(new Error(`the server exited (${code}): ${stderr}`)));
    });
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    assert.equal((await initializeFrom(endpoint, "https://a.example")).status, 200);
    assert.equal((await initializeFrom(endpoint, "https://b.example")).status, 200);
    assert.equal((await initializeFrom(endpoint, "http://localhost:6274")).status, 403);
  } finally {
    // tsx runs an esbuild helper under the server. On Windows, killing the server alone leaves the
    // helper running with the server's stderr open, and this test file then never ends, so end the
    // whole tree there.
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    else child.kill();
    child.stderr.destroy();
  }
});
