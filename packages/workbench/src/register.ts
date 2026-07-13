import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { log } from "@modwrench/core";
import { detectEnvironment } from "./detect/environment.js";
import { readLoadOrder } from "./loadorder/index.js";
import { parseCrashlog } from "./crashlog/index.js";
import { queryModMetadata } from "./metadata/index.js";
import {
  renderShell,
  createUIResource,
  themeForCrashType,
  type CrashData,
  type ConflictsData,
  type DepsData,
} from "@modwrench/ui";

/** Pick the theme skin from a canonical game id. */
function themeForGameId(gameId: string): string {
  const g = gameId.toLowerCase();
  if (g.includes("fallout")) return "fallout";
  if (g.includes("skyrim") || g.includes("starfield") || g.includes("oblivion"))
    return "skyrim";
  if (g.includes("valheim")) return "valheim";
  return "lethal";
}
import { checkKnownConflicts } from "./conflicts/index.js";
import { correlateCrash } from "./crashlog/diagnose.js";

/**
 * Register all Workbench tools on the given MCP server. Workbench tools are
 * uncredentialed — they read local filesystem state, not platform APIs. That
 * makes the registration shape slightly different from @modwrench/nexus and
 * @modwrench/modio: no Credential parameter required.
 *
 * Returns metadata useful for boot logging.
 */
export function registerWorkbenchTools(server: McpServer): {
  toolCount: number;
} {
  // ─── Tool 1: mw_detect_environment ──────────────────────────────────────────
  // Discovers the user's OS, Steam Deck status, installed mod-friendly games,
  // mod managers, mod loaders, and Proton versions (Linux). This is the
  // foundation tool — every other workbench tool that needs to reason about
  // the user's setup starts by calling this.

  server.tool(
    "mw_detect_environment",
    "See what you're working with. Auto-detects OS, Steam Deck, installed mod-friendly games (Bethesda / Unity co-op), per-game loaders (SKSE / F4SE / BepInEx), mod managers (MO2 / Vortex / r2modman), and Proton versions on Linux. Read-only — reads known config/save locations and touches nothing else. Use when the user asks \"what've I got installed\", \"find my games\", or before any tool that needs to know their setup.",
    {},
    async () => {
      const result = detectEnvironment();

      log("debug", "workbench.detect_environment", {
        os: result.os,
        isSteamDeck: result.isSteamDeck,
        games: result.detectedGames.length,
        managers: result.installedModManagers.length,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ─── Tool 2: mw_read_load_order ─────────────────────────────────────────────
  // Read the user's current load order for a specific game, normalized across
  // mod managers. Read-only — never modifies state files. Honest about gaps:
  // Vortex returns mod folders only (no enable state) until LevelDB support
  // lands.

  server.tool(
    "mw_read_load_order",
    "Post your load order — but here, not in a Discord. Reads it for a specific game from whichever manager the user runs (MO2, r2modman, or best-effort Vortex). Normalized output: each entry has name, enabled state, load-order index, and attribution when available. Read-only. Use when the user says \"show/post my load order\", \"what mods do I have enabled\", or \"what order are my mods in\".",
    {
      gameId: z
        .string()
        .describe(
          "Canonical game ID (e.g. 'skyrimspecialedition', 'lethalcompany'). Use mw_detect_environment to discover the games on this machine."
        ),
      modManager: z
        .enum(["vortex", "mo2", "r2modman", "auto"])
        .optional()
        .describe(
          "Which mod manager to read from. Default 'auto' — picks the most likely manager for this game's family."
        ),
      profileName: z
        .string()
        .optional()
        .describe(
          "Profile name. MO2 reads the active profile from ModOrganizer.ini if omitted; r2modman defaults to the first profile alphabetically (typically 'Default')."
        ),
      instancePath: z
        .string()
        .optional()
        .describe(
          "Optional override for MO2's instance path — useful for portable MO2 installs that don't live under %LOCALAPPDATA%/ModOrganizer."
        ),
    },
    async ({ gameId, modManager, profileName, instancePath }) => {
      const result = readLoadOrder({
        gameId,
        modManager,
        ...(profileName !== undefined ? { profileName } : {}),
        ...(instancePath !== undefined ? { instancePath } : {}),
      });

      log("debug", "workbench.read_load_order", {
        gameId,
        ok: result.ok,
        manager: result.ok ? result.modManager : null,
        mods: result.ok ? result.totalCount : 0,
      });

      const orderUI = result.ok
        ? [
            createUIResource({
              uri: "ui://modwrench/order",
              html: renderShell({
                theme: themeForGameId(gameId),
                view: "deps",
                deps: {
                  loadOrder: result.mods.map((m) => ({
                    name: m.name,
                    enabled: m.enabled,
                    index: m.loadOrderIndex,
                    version: m.version,
                    source: m.sourcePlatform,
                    pluginFile: m.pluginFile,
                  })),
                  manager: result.modManager,
                  profile: result.profile,
                  enabledCount: result.enabledCount,
                  totalCount: result.totalCount,
                } as DepsData,
              }),
              meta: { "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"] },
            }),
          ]
        : [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
          ...orderUI,
        ],
      };
    }
  );

  // ─── Tool 3: mw_parse_crashlog ──────────────────────────────────────────────
  // Parse a crashlog into structured fields. PARSING ONLY — no diagnosis, no
  // suggested causes. That separation is the differentiator: static analyzers
  // (Phostwood, Skyrim Crash Decoder, CLAS) pattern-match against known
  // crashes; here we hand the LLM clean structured data so it can reason
  // across the user's specific load order.

  server.tool(
    "mw_parse_crashlog",
    "Crash log in, structure out. Parses a crashlog (file path or pasted content) into fields: exception type, call stack, loaded plugins, registers, suspected FormID refs. Handles Crash Logger SSE (Skyrim), Buffout 4 (Fallout 4), NetScriptFramework (older Skyrim), and BepInEx (Unity). Returns parsed structure only — naming the culprit is the model's job, reasoned over the actual load order, not pattern-matched from a list. Use when the user says \"my game crashed\", \"CTD\", \"here's my crash log\", or \"why did it crash\".",
    {
      logContent: z
        .string()
        .optional()
        .describe(
          "Crashlog file content as a string. Provide this OR logPath."
        ),
      logPath: z
        .string()
        .optional()
        .describe(
          "Absolute path to a crashlog file on disk. Common locations: ~/Documents/My Games/Skyrim Special Edition/SKSE/crash-*.log for Crash Logger SSE, ~/Documents/My Games/Fallout4/F4SE/crash-*.log for Buffout 4, or the game's BepInEx/LogOutput.log for Unity."
        ),
      logType: z
        .enum([
          "auto",
          "crashlogger-sse",
          "buffout4",
          "netscriptframework",
          "bepinex",
        ])
        .optional()
        .describe(
          "Format hint. Default 'auto' — detect from content. Pass an explicit type when the auto-detect heuristic fails on a truncated log."
        ),
    },
    async ({ logContent, logPath, logType }) => {
      const result = parseCrashlog({
        ...(logContent !== undefined ? { logContent } : {}),
        ...(logPath !== undefined ? { logPath } : {}),
        ...(logType !== undefined ? { logType } : {}),
      });

      log("debug", "workbench.parse_crashlog", {
        ok: result.ok,
        type: result.ok ? result.detectedType : null,
        frames: result.ok ? result.callStack.length : 0,
        plugins: result.ok ? result.loadedPlugins.length : 0,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
          createUIResource({
            uri: "ui://modwrench/crash",
            html: renderShell({
              theme: themeForCrashType(result.ok ? result.detectedType : undefined),
              view: "crash",
              crash: result as unknown as CrashData,
            }),
            meta: { "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"] },
          }),
        ],
      };
    }
  );

  // ─── Tool 4: mw_query_mod_metadata ──────────────────────────────────────────
  // Cross-platform mod lookup with a normalized response shape. Attribution
  // (author, source platform, page URL) is non-optional on every result —
  // the LLM is structurally prevented from stripping credit, per the trust
  // architecture in the wiring prompt.

  server.tool(
    "mw_query_mod_metadata",
    "Put a name and a source on a mod. Looks up metadata across platforms (Nexus, mod.io) in one normalized shape: id, name, author, version, downloads, endorsements, pageUrl, and a permissions block that always carries attribution. Use it to enrich a crashlog suspect or a load-order entry — \"who made this\", \"look up this mod\", \"what version is X\". Thunderstore support is planned.",
    {
      modId: z
        .string()
        .optional()
        .describe(
          "Platform-specific mod ID. Nexus IDs are numeric (from the URL); mod.io IDs are numeric too. Required for direct lookup."
        ),
      modName: z
        .string()
        .optional()
        .describe(
          "Mod name for fuzzy lookup (mod.io only — Nexus has no public search endpoint). Pass with gameId."
        ),
      platform: z
        .enum(["nexus", "modio", "thunderstore", "any"])
        .optional()
        .describe(
          "Which platform to query. Default 'any' — tries Nexus first when a numeric modId + gameId are given, then mod.io. Use explicit platform to skip the cascade."
        ),
      gameId: z
        .string()
        .optional()
        .describe(
          "Platform-specific game identifier. For Nexus: the domain name (e.g. 'skyrimspecialedition'). For mod.io: the numeric game id as a string. Use modio_list_games / nexus_list_games to discover these."
        ),
    },
    async ({ modId, modName, platform, gameId }) => {
      const result = await queryModMetadata({
        ...(modId !== undefined ? { modId } : {}),
        ...(modName !== undefined ? { modName } : {}),
        ...(platform !== undefined ? { platform } : {}),
        ...(gameId !== undefined ? { gameId } : {}),
      });

      log("debug", "workbench.query_mod_metadata", {
        found: result.found,
        attempted: result.attemptedPlatforms,
      });

      const cards = result.found
        ? [
            {
              id: result.mod.id,
              name: result.mod.name,
              author: result.mod.attribution.author,
              platform: result.mod.platform,
              version: result.mod.version,
              downloads: result.mod.downloadCount,
              endorsements: result.mod.endorsements,
              summary: result.mod.summary,
              pageUrl: result.mod.pageUrl,
            },
          ]
        : [];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
          createUIResource({
            uri: "ui://modwrench/mods",
            html: renderShell({ view: "mods", mods: { mods: cards } }),
            meta: { "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"] },
          }),
        ],
      };
    }
  );

  // ─── Tool 5: mw_check_known_conflicts ──────────────────────────────────────
  // Pairwise conflict lookup across two sources:
  //   1. LOOT masterlist (live fetch from GitHub) — Bethesda games only
  //   2. data/conflicts/<gameId>.json — community-curated, bundled with the
  //      workbench package, any game
  //
  // Each entry in the input modIds list is identified as either a plugin
  // filename (.esp/.esm/.esl) or a platform-prefixed ID (nexus:N, modio:N,
  // thunderstore:X). Plugin matches drive the LOOT pass; both kinds drive the
  // community pass.

  server.tool(
    "mw_check_known_conflicts",
    "Check a list of mods/plugins for known pairwise incompatibilities. Two sources: LOOT's masterlist (live, Bethesda games) and ModWrench's bundled community conflict database (any game). Returns conflicts with severity, description, source attribution, and an optional patch suggestion. It flags what's on the list — it won't promise the game runs clean. Input ids can be plugin filenames (\"Skyrim.esp\") or platform-prefixed mod ids (\"nexus:12345\"). Use when the user asks \"what's conflicting\", \"will these mods fight\", or \"known issues between X and Y\".",
    {
      gameId: z
        .string()
        .describe(
          "Canonical game ID (e.g. 'skyrimspecialedition', 'lethalcompany'). LOOT support is Bethesda-only; non-Bethesda games rely on the community database only."
        ),
      modIds: z
        .array(z.string())
        .min(2)
        .describe(
          "List of mods/plugins to check pairwise. Entries can be plugin filenames ('Skyrim.esp') or platform-prefixed mod IDs ('nexus:12345', 'modio:67890', 'thunderstore:Author-ModName'). At least 2 required for a conflict to be possible."
        ),
    },
    async ({ gameId, modIds }) => {
      const result = await checkKnownConflicts({ gameId, modIds });

      const conflictUI = createUIResource({
        uri: "ui://modwrench/conflicts",
        html: renderShell({
          theme: themeForGameId(gameId),
          view: "conflicts",
          conflicts: {
            gameId,
            conflicts: result.conflicts,
            sources: result.sources,
            warnings: result.warnings,
          } as ConflictsData,
        }),
        meta: { "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"] },
      });

      log("debug", "workbench.check_known_conflicts", {
        gameId,
        inputs: modIds.length,
        conflicts: result.conflicts.length,
        lootAvailable: result.sources.loot.available,
        communityEntries: result.sources.community.entries,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
          conflictUI,
        ],
      };
    }
  );

  // ─── Tool 6: mw_diagnose_crash ─────────────────────────────────────────────
  // Parse a crashlog, THEN correlate its suspects with the loaded plugins and
  // known conflicts — a bundle of facts for the model to reason over. Still
  // parse-not-guess: ModWrench lines up the evidence, it never names the cause.
  server.tool(
    "mw_diagnose_crash",
    "Crash log in, culprit shortlist out. Parses the log, then correlates its suspects with the loaded plugins and (with a gameId) the known-conflict database into one bundle: which suspected mods are actually in the load order, at what index, and which loaded plugins have known conflicts. It lines up the evidence; it does NOT name the cause — that's the model's call, reasoned over the data. Use when the user says \"what's causing my crash\", \"which mod is it\", or pastes a crash log and wants the answer.",
    {
      logContent: z
        .string()
        .optional()
        .describe("Crashlog content as a string. Provide this OR logPath."),
      logPath: z
        .string()
        .optional()
        .describe(
          "Absolute path to a crashlog on disk (the SKSE/F4SE crash folder, or the game's BepInEx/LogOutput.log)."
        ),
      logType: z
        .enum(["auto", "crashlogger-sse", "buffout4", "netscriptframework", "bepinex"])
        .optional()
        .describe("Format hint. Default 'auto' — detect from content."),
      gameId: z
        .string()
        .optional()
        .describe(
          "Canonical game id (e.g. 'skyrimspecialedition', 'fallout4') to include the known-conflict cross-check. Omit to skip it."
        ),
    },
    async ({ logContent, logPath, logType, gameId }) => {
      const parsed = parseCrashlog({
        ...(logContent !== undefined ? { logContent } : {}),
        ...(logPath !== undefined ? { logPath } : {}),
        ...(logType !== undefined ? { logType } : {}),
      });

      if (!parsed.ok) {
        return {
          content: [
            { type: "text", text: JSON.stringify(parsed, null, 2) },
            createUIResource({
              uri: "ui://modwrench/crash",
              html: renderShell({
                theme: "skyrim",
                view: "crash",
                crash: parsed as unknown as CrashData,
              }),
              meta: { "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"] },
            }),
          ],
        };
      }

      const diagnosis = await correlateCrash({
        parsed,
        ...(gameId !== undefined ? { gameId } : {}),
        checkConflicts: async (g, modIds) => {
          const r = await checkKnownConflicts({ gameId: g, modIds });
          return {
            conflicts: r.conflicts,
            ...(r.warnings ? { warnings: r.warnings } : {}),
          };
        },
      });

      log("debug", "workbench.diagnose_crash", {
        type: diagnosis.detectedType,
        suspects: diagnosis.suspects.length,
        knownConflicts: diagnosis.knownConflicts.length,
        gameId: gameId ?? null,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ diagnosis, crash: parsed }, null, 2),
          },
          createUIResource({
            uri: "ui://modwrench/crash",
            html: renderShell({
              theme: themeForCrashType(parsed.detectedType),
              view: "crash",
              crash: parsed as unknown as CrashData,
            }),
            meta: { "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"] },
          }),
        ],
      };
    }
  );

  return { toolCount: 6 };
}
