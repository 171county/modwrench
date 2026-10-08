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

// Every POST gets a fresh server, so the one that runs tools/call never saw the client's
// initialize and can't tell that the client draws pages. By default a client that does
// gets the page's address but not its data, and the page shows the text answer. README
// and TRUST.md say so, and that a deployment that wants drawn pages sets
// MODWRENCH_STRUCTURED=always. Pinned so the docs and the server can't drift apart.
test("a client that draws pages gets a Thunderstore page's data from remote only with MODWRENCH_STRUCTURED=always", async () => {
  const realFetch = globalThis.fetch;
  const app = createRemoteApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  globalThis.fetch = async (input, init) =>
    String(input instanceof Request ? input.url : input).startsWith(endpoint)
      ? realFetch(input, init)
      : Response.json([
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
        ]);
  const listMods = async () => {
    const client = new Client(
      { name: "modwrench-remote-test", version: "0.0.0" },
      { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } }
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
    try {
      return await client.callTool({ name: "thunderstore_list_mods", arguments: { community: "valheim" } });
    } finally {
      await client.close();
    }
  };
  const structured = process.env.MODWRENCH_STRUCTURED;

  try {
    delete process.env.MODWRENCH_STRUCTURED;
    const auto = await listMods();
    assert.match((auto.content as Array<{ text: string }>)[0]!.text, /^Showing 1 of 1 mods in valheim/);
    assert.equal(auto.structuredContent, undefined, "remote can see what the client draws now: update README and TRUST.md");

    process.env.MODWRENCH_STRUCTURED = "always";
    const always = await listMods();
    const view = always.structuredContent as { view?: string; mods?: Array<{ name?: string; author?: string }> };
    assert.equal(view.view, "mods");
    assert.deepEqual(view.mods?.map((m) => [m.name, m.author]), [["CoolMod", "Someone"]]);
  } finally {
    if (structured === undefined) delete process.env.MODWRENCH_STRUCTURED;
    else process.env.MODWRENCH_STRUCTURED = structured;
    globalThis.fetch = realFetch;
    await closeServer(server);
  }
});
