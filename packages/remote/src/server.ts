import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { log } from "@modwrench/core";
import { registerThunderstoreTools } from "@modwrench/thunderstore/register";

export const REMOTE_PUBLIC_PLATFORMS = ["thunderstore"] as const;
export const REMOTE_TOOL_COUNT = 8;

export type RemoteAppOptions = {
  host?: string;
  allowedHosts?: string[];
};

export type StartRemoteServerOptions = RemoteAppOptions & {
  port?: number;
};

export function createRemoteMcpServer(): McpServer {
  const server = new McpServer({
    name: "modwrench-remote",
    version: "0.1.0",
  });

  registerThunderstoreTools(server);

  return server;
}

export function createRemoteApp(options: RemoteAppOptions = {}) {
  const app = createMcpExpressApp(options);

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "modwrench-remote",
      transport: "streamable-http",
      endpoint: "/mcp",
      platforms: REMOTE_PUBLIC_PLATFORMS,
      toolCount: REMOTE_TOOL_COUNT,
    });
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createRemoteMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.once("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log("error", "remote.request_failed", {
        message: err instanceof Error ? err.message : String(err),
      });

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
  });

  return app;
}

export async function startRemoteServer(
  options: StartRemoteServerOptions = {}
): Promise<Server> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  const app = createRemoteApp({
    host,
    allowedHosts: options.allowedHosts,
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      log("info", "remote.started", {
        url: `http://${host}:${address.port}/mcp`,
        platforms: REMOTE_PUBLIC_PLATFORMS,
        tool_count: REMOTE_TOOL_COUNT,
      });
      resolve(server);
    });
    server.once("error", reject);
  });
}
