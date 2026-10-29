// ─── mw_deck — the ModWrench deck ────────────────────────────────────────────
// Each job's last verdict in this session (the workbench's faces: a verdict and
// counts, held in memory only), which platforms are connected, and the five
// flagship games, read on every call. Every client gets the connector list as
// JSON text. A client that draws MCP Apps pages also gets the deck page
// (ui://modwrench/deck, from @modwrench/ui) and the same list as structured data
// for it to draw; a client that doesn't never fetches the page.
//
// Extracted from index.ts so the tool is testable without booting the stdio
// server (which reads argv and connects a transport on import).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DECK_PAGE, THEME_IDS, deckView, pageData, registerAppPage } from "@modwrench/ui";
import { deckFaces } from "@modwrench/workbench/register";
import type { MetaCatalog } from "./catalog.js";

const CONNECTOR_META: Record<string, { name: string; tool: string }> = {
  "nexus-public": { name: "Nexus Mods", tool: "nexus_search" },
  nexus: { name: "Nexus Mods account", tool: "nexus_validate_key" },
  modio: { name: "mod.io", tool: "modio_list_games" },
  thunderstore: { name: "Thunderstore", tool: "thunderstore_list_communities" },
  workbench: { name: "Workbench", tool: "mw_detect_environment" },
};

/** A connector's name for people ("Nexus Mods"), or its id when it has none. */
export function connectorName(id: string): string {
  return CONNECTOR_META[id]?.name ?? id;
}

const FLAGSHIP_GAMES = [
  { id: "skyrim", name: "Skyrim SE", note: "Nexus \u00b7 Bethesda" },
  { id: "fallout", name: "Fallout 4", note: "Nexus \u00b7 Bethesda" },
  { id: "lethal", name: "Lethal Company", note: "Thunderstore \u00b7 BepInEx" },
  { id: "valheim", name: "Valheim", note: "Thunderstore \u00b7 BepInEx" },
  { id: "gta", name: "GTA V", note: "Nexus \u00b7 Script Hook V" },
];

/** Register mw_deck. The connectors are read from the catalog on every call. */
export function registerDeckTool(
  server: McpServer,
  catalog: Pick<MetaCatalog, "listActive" | "knownIds">
): void {
  const deckPage = registerAppPage(server, DECK_PAGE);
  server.registerTool(
    "mw_deck",
    {
      title: "Open the ModWrench deck",
      description: "Open the ModWrench deck: the active connectors and the flagship games. In clients that support MCP Apps it also shows a page in one of five skins (Skyrim, Fallout Pip-Boy, Lethal Company, Valheim, GTA V); other clients get the connector list as text. Each job (Crash Whisperer, the Doctors, Patch Day, Pulse, Crew Check) shows how it last came out in this session, as a verdict and counts kept in memory only; the connectors are read fresh from the catalog. Use when the user says \"open the deck\", \"summon/show ModWrench\", or wants a visual dashboard. The optional theme sets the page's starting skin.",
      inputSchema: {
        theme: z
          .enum([...THEME_IDS] as [string, ...string[]])
          .optional()
          .describe("Initial theme: skyrim | fallout | lethal | valheim | gta. Default skyrim."),
        view: z
          .enum(["deck", "mods", "crash"])
          .optional()
          .describe("Kept for compatibility; the page always shows the deck."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(deckPage ? { _meta: deckPage } : {}),
    },
    async ({ theme, view }) => {
      const faces = deckFaces();
      const active = new Map(
        catalog.listActive().map((p) => [p.platformId, p.toolCount] as const)
      );
      const connectors = catalog.knownIds().map((id) => {
        const meta = CONNECTOR_META[id] ?? { name: id, tool: "" };
        const on = active.has(id);
        return {
          id,
          name: meta.name,
          tool: meta.tool,
          status: on ? ("on" as const) : ("off" as const),
          ...(on ? { toolCount: active.get(id) } : {}),
        };
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { view: view ?? "deck", theme: theme ?? "skyrim", connectors, faces },
              null,
              2
            ),
          },
        ],
        ...pageData(server, deckView({ theme, connectors, games: FLAGSHIP_GAMES, faces }), deckPage !== undefined),
      };
    }
  );
}
