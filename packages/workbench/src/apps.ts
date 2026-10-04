import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log } from "@modwrench/core";
import {
  CRASH_WHISPERER_APP_URI,
  DOCTOR_APP_URI,
  MCP_APP_MIME,
  MCP_APPS_EXTENSION_ID,
  PATCH_DAY_APP_URI,
  appResourceMeta,
  appToolMeta,
  renderCrashWhispererApp,
  renderDoctorApp,
  renderPatchDayApp,
} from "@modwrench/ui";

// ─── Pages for MCP Apps clients ──────────────────────────────────────────────
// A tool that has a page points at it by URI (`_meta.ui.resourceUri`). A client
// that supports MCP Apps fetches the page with resources/read and draws it in a
// sandboxed frame beside the answer. A client that doesn't never fetches it, so
// the tool's plain-text answer is all it ever sees and nothing extra lands in the
// conversation.
//
// The page is registered here, with the tool that uses it, so a tool only
// advertises a page that exists. Registering a resource has to happen before the
// server connects; if it can't (the page is switched off with MODWRENCH_UI=off,
// the server is already connected, or this isn't a full MCP server), the tool
// simply goes without a page and keeps working as text.

type Page = {
  /** The name the resource is registered under. */
  name: string;
  uri: string;
  title: string;
  description: string;
  render: () => string;
};

const html = new Map<string, string>();

/**
 * Register one page. Returns the `_meta` the tool should carry to point at it, or
 * undefined when no page is on offer.
 */
function registerPage(server: McpServer, page: Page): Record<string, unknown> | undefined {
  const meta = appToolMeta(page.uri);
  if (!meta) return undefined;
  try {
    server.registerResource(
      page.name,
      page.uri,
      { title: page.title, description: page.description, mimeType: MCP_APP_MIME },
      async (uri) => {
        let text = html.get(page.uri);
        if (text === undefined) {
          text = page.render();
          html.set(page.uri, text);
        }
        return { contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text, _meta: appResourceMeta() }] };
      }
    );
    return meta;
  } catch (err) {
    log("debug", "workbench.page_unavailable", {
      page: page.name,
      reason: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** The Patch Day page. */
export function registerPatchDayApp(server: McpServer): Record<string, unknown> | undefined {
  return registerPage(server, {
    name: "patch_day_panel",
    uri: PATCH_DAY_APP_URI,
    title: "Patch Day page",
    description:
      "The page that MCP Apps clients draw for mw_patch_day: the verdict, how sure it is, which plugins need attention and what to do. Read-only; it makes no network requests and keeps nothing.",
    render: renderPatchDayApp,
  });
}

/** The Crash Whisperer page. */
export function registerCrashWhispererApp(server: McpServer): Record<string, unknown> | undefined {
  return registerPage(server, {
    name: "crash_whisperer_panel",
    uri: CRASH_WHISPERER_APP_URI,
    title: "Crash Whisperer page",
    description:
      "The page that MCP Apps clients draw for mw_crash_whisperer: what happened, which names the log points at and why, how sure it is, the setup checks, the call stack, and posts to ask for help with, ready to copy. Read-only; it makes no network requests and keeps nothing.",
    render: renderCrashWhispererApp,
  });
}

/** The Doctor page. */
export function registerDoctorApp(server: McpServer): Record<string, unknown> | undefined {
  return registerPage(server, {
    name: "doctor_panel",
    uri: DOCTOR_APP_URI,
    title: "Doctor page",
    description:
      "The page that MCP Apps clients draw for mw_doctor: where the setup stands, what needs attention and what each finding rests on, with the fix for each, and what ModWrench can't see. Read-only; it makes no network requests and keeps nothing.",
    render: renderDoctorApp,
  });
}

// ─── Who gets the structured report ──────────────────────────────────────────
// A tool with a page returns its answer twice: a few lines of plain text, and the
// whole report as structured data for the page to draw. Clients treat the two very
// differently. Most show the model the text and ignore the data. Some do the
// opposite: Codex, for one, hands the model the structured data *instead of* the
// text. Sending the report to every client would make a short answer into a large
// one for exactly the clients that read it that way, so by default it goes only to
// a client that has said it can draw pages, and only while the tool has a page for it
// to draw (not with MODWRENCH_UI=off, and not when the page couldn't be registered).
// Everyone else gets the text.
//
//   MODWRENCH_STRUCTURED=always   send it to every client (for scripts and agents that read it)
//   MODWRENCH_STRUCTURED=never    send it to none
//   anything else                 send it to clients that can draw pages, when there is a page

export type StructuredMode = "auto" | "always" | "never";

const ALWAYS = new Set(["always", "on", "1", "true", "yes"]);
const NEVER = new Set(["never", "off", "0", "false", "no", "none"]);

export function structuredMode(value: string | undefined = process.env.MODWRENCH_STRUCTURED): StructuredMode {
  const v = value?.trim().toLowerCase() ?? "";
  return ALWAYS.has(v) ? "always" : NEVER.has(v) ? "never" : "auto";
}

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

/** `page`: whether the tool's page was registered, so there is something to draw the report. */
export function wantsStructured(server: unknown, page: boolean): boolean {
  const mode = structuredMode();
  return mode === "always" || (mode === "auto" && page && clientDrawsPages(server));
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
    ...(wantsStructured(server, page) ? { structuredContent: result as unknown as Record<string, unknown> } : {}),
    ...(result.ok ? {} : { isError: true as const }),
  };
}
