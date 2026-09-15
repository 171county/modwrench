// ─── MCP-UI resource block ────────────────────────────────────────────────────
// Follows the MCP-UI spec (mcpui.dev): a tool returns a content item of type
// "resource" whose `resource.uri` starts with `ui://` and whose `text` is inline
// HTML the host renders in a sandboxed iframe. The iframe posts intents back to
// the host via window.parent.postMessage({ type, payload }) — see shell.ts.
//
// Stateless by construction: the HTML is built fresh from each tool result and
// carries no server-side session. This is the same "hold nothing" posture the
// rest of ModWrench follows — the UI is a pure function of the tool output.

export type UIResourceBlock = {
  type: "resource";
  resource: {
    uri: string;
    mimeType: "text/html";
    text: string;
    _meta?: Record<string, unknown>;
  };
};

/**
 * True when the user has turned panels off with MODWRENCH_UI=off.
 *
 * MCP-UI support is uneven across clients today. A client that does not render
 * `ui://` resources does not ignore them either — it puts the HTML into the
 * conversation as text, so the model reads 28kb of markup and minified
 * JavaScript it can do nothing with.
 *
 * Measured against a real session: one panel is ~27.6kb, roughly 8,800 tokens,
 * about 7% of a 128k context window. A four-tool answer spends over a quarter
 * of the window on markup that was never drawn. On a long session that is the
 * difference between finishing and running out of room.
 *
 * Read per call rather than cached at import, so a host that mutates process.env
 * between requests is honoured, and so tests can toggle it without re-importing.
 */
function panelsDisabled(): boolean {
  const raw = (process.env.MODWRENCH_UI ?? "").trim().toLowerCase();
  return raw === "off" || raw === "0" || raw === "false" || raw === "none";
}

/** Sent in place of the panel when MODWRENCH_UI=off — ~120 bytes, not ~28kb. */
const SUPPRESSED_HTML =
  '<!doctype html><meta charset="utf-8"><title>ModWrench</title>' +
  "<p>Panel suppressed by MODWRENCH_UI=off. Unset it to restore the UI.";

/**
 * Build an MCP-UI resource content block from an inline HTML string.
 *
 * Honours `MODWRENCH_UI=off`: the block keeps its shape, so every caller and
 * any client expecting a resource still works, but the payload shrinks to a
 * single line. Suppressing the block entirely would change the content array's
 * shape at 19 call sites for no benefit.
 *
 * @throws if `uri` does not start with `ui://` (per the MCP-UI spec).
 */
export function createUIResource(opts: {
  uri: string;
  html: string;
  meta?: Record<string, unknown>;
}): UIResourceBlock {
  if (!opts.uri.startsWith("ui://")) {
    throw new Error(
      `[modwrench/ui] A UI resource uri must start with "ui://" — got "${opts.uri}".`
    );
  }
  return {
    type: "resource",
    resource: {
      uri: opts.uri,
      mimeType: "text/html",
      text: panelsDisabled() ? SUPPRESSED_HTML : opts.html,
      ...(opts.meta ? { _meta: opts.meta } : {}),
    },
  };
}

/** Escape a string for safe interpolation into HTML text/attribute context. */
export function esc(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
