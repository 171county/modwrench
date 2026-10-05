import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CRASH_WHISPERER_APP_URI,
  DOCTOR_APP_URI,
  PATCH_DAY_APP_URI,
  registerAppPage,
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

/** The Patch Day page. */
export function registerPatchDayApp(server: McpServer): Record<string, unknown> | undefined {
  return registerAppPage(server, {
    name: "patch_day_panel",
    uri: PATCH_DAY_APP_URI,
    title: "Patch Day page",
    description:
      "The page that MCP Apps clients draw for mw_patch_day: the verdict, how sure it is, which plugins need attention and what to do. Read-only; it makes no network requests and keeps nothing.",
    render: renderPatchDayApp,
    clipboard: true,
  });
}

/** The Crash Whisperer page. */
export function registerCrashWhispererApp(server: McpServer): Record<string, unknown> | undefined {
  return registerAppPage(server, {
    name: "crash_whisperer_panel",
    uri: CRASH_WHISPERER_APP_URI,
    title: "Crash Whisperer page",
    description:
      "The page that MCP Apps clients draw for mw_crash_whisperer: what happened, which names the log points at and why, how sure it is, the setup checks, the call stack, and posts to ask for help with, ready to copy. Read-only; it makes no network requests and keeps nothing.",
    render: renderCrashWhispererApp,
    clipboard: true,
  });
}

/** The Doctor page. */
export function registerDoctorApp(server: McpServer): Record<string, unknown> | undefined {
  return registerAppPage(server, {
    name: "doctor_panel",
    uri: DOCTOR_APP_URI,
    title: "Doctor page",
    description:
      "The page that MCP Apps clients draw for mw_doctor: where the setup stands, what needs attention and what each finding rests on, with the fix for each, and what ModWrench can't see. Read-only; it makes no network requests and keeps nothing.",
    render: renderDoctorApp,
    clipboard: true,
  });
}
