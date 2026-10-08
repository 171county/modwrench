// ─── mw_critique — feedback for the maintainers, posted by the player ────────
// Drafts a GitHub issue from what the player wants to say, with ModWrench's
// version, the connectors that are on, the AI client as it named itself, the
// system and Node's version filled in. The draft and the link are built by
// @modwrench/workbench/feedback, which also takes the personal details it
// recognises out of the player's words. Nothing is sent: the answer is text, and
// the link opens GitHub's form, which posts only when the player presses its button.
//
// Extracted from index.ts so the tool is testable without booting the stdio server.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { panelsDisabled, structuredMode } from "@modwrench/ui";
import { draftFeedback, summarizeFeedback, type FeedbackKind } from "@modwrench/workbench/feedback";
import type { MetaCatalog } from "./catalog.js";
import { connectorName } from "./deck.js";

/** The client's own name and version from when it connected, if the server has them. */
function clientInfo(server: unknown): { name?: unknown; version?: unknown } | undefined {
  try {
    const inner = (server as { server?: { getClientVersion?: () => unknown } } | null)?.server;
    const info = inner?.getClientVersion?.();
    return info !== null && typeof info === "object" ? (info as { name?: unknown; version?: unknown }) : undefined;
  } catch {
    return undefined;
  }
}

/** Register mw_critique. `version` is ModWrench's own. */
export function registerCritiqueTool(server: McpServer, catalog: Pick<MetaCatalog, "listActive">, version: string): void {
  server.registerTool(
    "mw_critique",
    {
      title: "Draft feedback for ModWrench",
      description:
        "Draft a GitHub issue for ModWrench's maintainers from what the user wants to say (something that went wrong, an idea, or anything else), with what a maintainer needs filled in: ModWrench's version, the connectors that are on, the AI client as it named itself, the operating system and Node's version. Nothing personal is added, and the personal details ModWrench recognises in the user's words (folders, account names, addresses, keys) are taken out. It makes no network request and posts nothing: it returns the draft and a link to GitHub's feedback form with the draft filled in, which the user opens and submits themselves. Use when the user wants to report a problem with ModWrench, suggest something, or give feedback, or uses /mw-critique.",
      inputSchema: {
        kind: z
          .enum(["bug", "idea", "other"])
          .optional()
          .describe("bug: something in ModWrench went wrong. idea: something it could do. other: anything else. Default bug."),
        title: z.string().optional().describe("A short title, in the user's words."),
        feedback: z
          .string()
          .optional()
          .describe(
            "What the user wants to say, in their words: what happened and what they expected, or the idea. Leave out file paths, log contents and personal details unless the user asks for them."
          ),
        steps: z.array(z.string()).optional().describe("For a bug: the steps that make it happen again, one per item."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ kind, title, feedback, steps }) => {
      const draft = draftFeedback({
        kind: kind as FeedbackKind | undefined,
        title,
        feedback,
        steps,
        version,
        connectors: catalog.listActive().map((p) => connectorName(p.platformId)),
        client: clientInfo(server),
        pages: { on: !panelsDisabled(), structured: structuredMode() },
      });
      return { content: [{ type: "text" as const, text: summarizeFeedback(draft) }] };
    }
  );
}
