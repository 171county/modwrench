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
 * Build an MCP-UI resource content block from an inline HTML string.
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
      text: opts.html,
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
