// ─── MCP Apps: the server side of a page ─────────────────────────────────────
// A tool that has a page points at it by URI (`_meta.ui.resourceUri`). A client
// that supports MCP Apps fetches the page with resources/read and draws it in a
// sandboxed frame beside the answer. A client that doesn't never fetches it, so
// the tool's plain-text answer is all it ever sees and nothing extra lands in the
// conversation.
//
// Every package with a page registers it here, with the tool that uses it, so a
// tool only advertises a page that exists. The server is taken as a plain object
// rather than the SDK's McpServer type, so this package needs no SDK of its own.

import { log } from "@modwrench/core";
import { MCP_APP_MIME, MCP_APPS_EXTENSION_ID, appResourceMeta, appToolMeta, panelsDisabled, structuredMode } from "./app.js";

export { structuredMode, type StructuredMode } from "./app.js";

/** One MCP Apps page as the server registers it. */
export type AppPageDef = {
  /** Resource name, e.g. "mods_panel" (house style: "<view>_panel"). */
  name: string;
  /** "ui://modwrench/<view>". */
  uri: string;
  /** Resource title, e.g. "Mods page". */
  title: string;
  /** Must say "read-only" and "no network". */
  description: string;
  /** The full HTML document. Called once per process; the result is cached by URI. */
  render: () => string;
  /** Ask the host for clipboard-write, for a page with a Copy button. */
  clipboard: boolean;
};

/** The one SDK method used here, by shape. */
type ResourceHost = {
  registerResource(
    name: string,
    uri: string,
    config: { title: string; description: string; mimeType: string },
    read: (uri: URL) => Promise<{ contents: Array<Record<string, unknown>> }>
  ): unknown;
};

const registered = new WeakMap<object, Set<string>>();
const html = new Map<string, string>();

/**
 * Register a page once per server and return the `_meta` a tool carries to point at it,
 * or undefined when no page is on offer: MODWRENCH_UI=off, MODWRENCH_STRUCTURED=never,
 * a server without registerResource, or a registration that throws (already connected
 * without resource handlers, a duplicate from another copy of this module). Idempotent
 * per server: the second and later calls for the same URI on the same server return
 * fresh meta without registering again. A failure is not remembered, so a later call
 * may try again.
 */
export function registerAppPage(server: object, page: AppPageDef): Record<string, unknown> | undefined {
  const meta = appToolMeta(page.uri);
  if (!meta) return undefined;
  const done = registered.get(server) ?? new Set<string>();
  if (done.has(page.uri)) return meta;
  try {
    (server as ResourceHost).registerResource(
      page.name,
      page.uri,
      { title: page.title, description: page.description, mimeType: MCP_APP_MIME },
      async (uri) => {
        let text = html.get(page.uri);
        if (text === undefined) {
          text = page.render();
          html.set(page.uri, text);
        }
        return {
          contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text, ...(page.clipboard ? { _meta: appResourceMeta() } : {}) }],
        };
      }
    );
    done.add(page.uri);
    registered.set(server, done);
    return meta;
  } catch (err) {
    log("debug", "ui.page_unavailable", {
      page: page.name,
      reason: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

// ─── Who gets the structured report ──────────────────────────────────────────
// A tool with a page returns its answer twice: a few lines of plain text, and the
// whole report as structured data for the page to draw. Clients treat the two very
// differently. Most show the model the text and ignore the data. Some do the
// opposite: Codex, for one, hands the model the structured data *instead of* the
// text. Sending the report to every client would make a short answer into a large
// one for exactly the clients that read it that way, so by default it goes only to
// a client that has said it can draw pages, and only while the tool has a page for it
// to draw (not with MODWRENCH_UI=off, checked on every answer, and not when the page
// couldn't be registered). Everyone else gets the text.
//
//   MODWRENCH_STRUCTURED=always   send it to every client (for scripts and agents that read it)
//   MODWRENCH_STRUCTURED=never    send it to none, and point at no page (see appToolMeta)
//   anything else                 send it to clients that can draw pages, when there is a page
//
// The mode is read in app.ts, because appToolMeta needs it too; structuredMode is
// re-exported above.

/** Has the connected client said it can draw MCP Apps pages? False when it hasn't, and when there is no way to tell. */
export function clientDrawsPages(server: unknown): boolean {
  try {
    const inner = (server as { server?: { getClientCapabilities?: () => unknown } } | null)?.server;
    const caps = inner?.getClientCapabilities?.() as { extensions?: Record<string, unknown> } | undefined;
    const ui = caps?.extensions?.[MCP_APPS_EXTENSION_ID] as { mimeTypes?: unknown } | undefined;
    return Array.isArray(ui?.mimeTypes) && ui.mimeTypes.includes(MCP_APP_MIME);
  } catch {
    return false;
  }
}

/**
 * `page`: whether the tool's page was registered, so there is something to draw the report.
 * MODWRENCH_UI=off is checked here too, so turning pages off while the server runs stops the
 * data at once, even for a tool that registered its page before.
 */
export function wantsStructured(server: unknown, page: boolean): boolean {
  const mode = structuredMode();
  return mode === "always" || (mode === "auto" && page && !panelsDisabled() && clientDrawsPages(server));
}

/**
 * The structured half of an answer, to spread into a tool result next to its unchanged
 * `content`: `{ structuredContent: data }` for the clients that should have it, else `{}`.
 * Never adds isError.
 */
export function pageData(
  server: unknown,
  data: Record<string, unknown>,
  page: boolean
): { structuredContent?: Record<string, unknown> } {
  return wantsStructured(server, page) ? { structuredContent: data } : {};
}

/**
 * A tool's answer: the plain text for every client, the structured report for the ones that should
 * have it, and an error flag when the tool couldn't run (so a client can show it as a failed call).
 */
export function pageAnswer(
  server: unknown,
  text: string,
  result: { ok: boolean },
  page: boolean
): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: true;
} {
  return {
    content: [{ type: "text", text }],
    ...pageData(server, result as unknown as Record<string, unknown>, page),
    ...(result.ok ? {} : { isError: true as const }),
  };
}
