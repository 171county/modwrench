import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log } from "@modwrench/core";
import {
  MCP_APP_MIME,
  PATCH_DAY_APP_URI,
  appResourceMeta,
  appToolMeta,
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

let patchDayHtml: string | undefined;

/**
 * Register the Patch Day page. Returns the `_meta` the tool should carry to point
 * at it, or undefined when no page is on offer.
 */
export function registerPatchDayApp(server: McpServer): Record<string, unknown> | undefined {
  const meta = appToolMeta(PATCH_DAY_APP_URI);
  if (!meta) return undefined;
  try {
    server.registerResource(
      "patch_day_panel",
      PATCH_DAY_APP_URI,
      {
        title: "Patch Day page",
        description:
          "The page that MCP Apps clients draw for mw_patch_day: the verdict, how sure it is, which plugins need attention and what to do. Read-only; it makes no network requests and keeps nothing.",
        mimeType: MCP_APP_MIME,
      },
      async (uri) => {
        patchDayHtml ??= renderPatchDayApp();
        return {
          contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text: patchDayHtml, _meta: appResourceMeta() }],
        };
      }
    );
    return meta;
  } catch (err) {
    log("debug", "workbench.page_unavailable", {
      page: "patch_day",
      reason: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
