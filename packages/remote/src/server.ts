import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { log } from "@modwrench/core";
import { registerThunderstoreTools } from "@modwrench/thunderstore/register";

export const REMOTE_PUBLIC_PLATFORMS = ["thunderstore"] as const;
export const REMOTE_TOOL_COUNT = 9;

export type RemoteAppOptions = {
  host?: string;
  allowedHosts?: string[];
  /** How long a client's session may go unused before it is closed. Default 24 hours. */
  sessionIdleMs?: number;
  /** How many sessions may be open at once; opening one more closes the least recently used. Default 100. */
  maxSessions?: number;
};

export type StartRemoteServerOptions = RemoteAppOptions & {
  port?: number;
};

export function createRemoteMcpServer(): McpServer {
  const server = new McpServer({
    name: "modwrench-remote",
    version: "0.1.0",
  });

  // Five of these tools point at a page. Each client gets a server of its own for its session
  // (createRemoteApp), so the server that answers tools/call saw the client's initialize and
  // sends a page's data only to a client that draws pages.
  registerThunderstoreTools(server);

  return server;
}

type Session = { server: McpServer; transport: StreamableHTTPServerTransport; idle: NodeJS.Timeout | undefined };

const NO_SESSION = "Bad Request: Mcp-Session-Id header is required (send initialize first to get one)";

function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
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

  // One server per client session, kept in memory only, so a server sees the client's
  // initialize (and whether it draws pages) before its tool calls. Nothing is written.
  // The session cap bounds memory; the idle limit is long because SDK 1.29 clients don't
  // start a new session by themselves after a 404, so an expired session errors until the
  // client reconnects.
  const idleMs = options.sessionIdleMs ?? 24 * 60 * 60_000;
  const maxSessions = options.maxSessions ?? 100;
  const sessions = new Map<string, Session>();
  const closeSession = (id: string): void => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    clearTimeout(session.idle);
    void session.transport.close();
    void session.server.close();
  };
  // Restart the idle clock and move the session to the end, so the first key is the least recently used.
  const touch = (id: string, session: Session): void => {
    clearTimeout(session.idle);
    session.idle = setTimeout(() => closeSession(id), idleMs);
    session.idle.unref();
    sessions.delete(id);
    sessions.set(id, session);
  };

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      // An empty header is no header, as the SDK's own session check treats it.
      const id = req.header("mcp-session-id") || undefined;
      if (id !== undefined) {
        const session = sessions.get(id);
        if (!session) return void rpcError(res, 404, -32001, "Session not found");
        touch(id, session);
        await session.transport.handleRequest(req, res, req.body);
        return;
      }
      if (!isInitializeRequest(req.body)) return void rpcError(res, 400, -32000, NO_SESSION);
      const server = createRemoteMcpServer();
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          if (sessions.size >= maxSessions) closeSession(sessions.keys().next().value!);
          touch(sessionId, { server, transport, idle: undefined });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) closeSession(transport.sessionId);
      };
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

  // A client ends its session. The transport closes itself when it accepts the DELETE, and
  // its onclose drops the session; a DELETE it refuses leaves the session open.
  app.delete("/mcp", async (req: Request, res: Response) => {
    const id = req.header("mcp-session-id") || undefined;
    if (id === undefined) return void rpcError(res, 400, -32000, NO_SESSION);
    const session = sessions.get(id);
    if (!session) return void rpcError(res, 404, -32001, "Session not found");
    try {
      await session.transport.handleRequest(req, res);
    } catch (err) {
      log("error", "remote.request_failed", { message: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) rpcError(res, 500, -32603, "Internal server error");
    }
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
    sessionIdleMs: options.sessionIdleMs,
    maxSessions: options.maxSessions,
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
