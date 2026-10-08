import { MCP_APP_MIME, MCP_APPS_EXTENSION_ID } from "@modwrench/ui";

// ─── A stand-in MCP server for tests of tools that have a page ───────────────
// Holds the tools and resources registered on it, refuses a second resource at one
// address as the SDK does, and answers getClientCapabilities() with whatever the
// test says the client declared. The real SDK's behaviour is pinned separately in
// packages/workbench/test/apps.test.ts.
//
// The same file is in workbench, thunderstore, nexus, modio and cli: each package's
// typecheck covers only its own tests, so one can't import another's. Keep the
// copies identical.

export type ToolConfig = {
  title?: string;
  description: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};
export type ToolResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
export type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;
export type ResourceConfig = { title?: string; description?: string; mimeType?: string };
export type ReadResult = { contents: Array<{ uri: string; mimeType?: string; text: string; _meta?: Record<string, unknown> }> };
export type Reader = (uri: URL) => Promise<ReadResult>;

/** What a client that draws MCP Apps pages declares when it connects. */
export const DRAWS_PAGES = { extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME] } } };

/** What a text-only client declares when it connects. */
export const PLAIN = { roots: {} };

export class AppsMockServer {
  tools = new Map<string, { config: ToolConfig; handler: Handler }>();
  resources = new Map<string, { name: string; config: ResourceConfig; read: Reader }>();

  /** What the connected client declared (DRAWS_PAGES, PLAIN, ...); undefined before one connects. */
  clientCapabilities: unknown;

  constructor(clientCapabilities?: unknown) {
    this.clientCapabilities = clientCapabilities;
  }

  /** Where tools look for the client's capabilities, as on the SDK's McpServer. */
  get server(): { getClientCapabilities: () => unknown } {
    return { getClientCapabilities: () => this.clientCapabilities };
  }

  registerTool(name: string, config: ToolConfig, handler: Handler): void {
    this.tools.set(name, { config, handler });
  }

  registerResource(name: string, uri: string, config: ResourceConfig, read: Reader): void {
    // The real server refuses a second resource at the same address.
    if (this.resources.has(uri)) throw new Error(`Resource ${uri} is already registered`);
    this.resources.set(uri, { name, config, read });
  }

  /** Call a registered tool as a client would. */
  call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.handler(args);
  }
}

/** A server that is already connected, so registering a resource throws (as the SDK does without resource handlers). */
export class ConnectedServer extends AppsMockServer {
  override registerResource(): void {
    throw new Error("Cannot register capabilities after connecting to transport");
  }
}

/**
 * Run `fn` with environment variables set (undefined removes one), and put them back
 * afterwards, after an async `fn` has finished too. For MODWRENCH_UI and MODWRENCH_STRUCTURED.
 */
export async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const set = (values: Record<string, string | undefined>): void => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  set(vars);
  try {
    return await fn();
  } finally {
    set(prev);
  }
}
