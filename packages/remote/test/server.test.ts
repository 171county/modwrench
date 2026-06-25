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
