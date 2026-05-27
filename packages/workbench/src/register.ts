import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { log } from "@mcpwrench/core";
import {
  detectOs,
  detectSteamDeck,
  detectGameMode,
} from "./detect/os.js";
import {
  findSteamRoot,
  findSteamLibraries,
  findInstalledApp,
  listProtonTools,
  detectProtonForApp,
} from "./detect/steam.js";
import { KNOWN_GAMES } from "./detect/games.js";
import { detectModLoader } from "./detect/loader.js";
import {
  detectInstalledManagers,
  inferManagerForGame,
} from "./detect/manager.js";
import { readLoadOrder } from "./loadorder/index.js";
import { parseCrashlog } from "./crashlog/index.js";
import { queryModMetadata } from "./metadata/index.js";
import { checkKnownConflicts } from "./conflicts/index.js";

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
    "Auto-detect the user's modding environment: OS, Steam Deck, installed mod-friendly games (Bethesda / Unity co-op / Sims / Minecraft), per-game mod loaders (SKSE / F4SE / BepInEx / etc.), installed mod managers (Vortex / MO2 / r2modman / CurseForge App), and Proton versions on Linux. Read-only — touches no files outside known config/save locations.",
    {},
    async () => {
      const os = detectOs();
      const isSteamDeck = detectSteamDeck();
      const isGameMode = detectGameMode();
      const steamRoot = findSteamRoot();
      const managers = detectInstalledManagers();

      const detectedGames: Array<{
        gameId: string;
        gameName: string;
        installPath: string;
        modManager: string;
        modLoader: string;
        protonVersion?: string;
      }> = [];

      if (steamRoot) {
        const libraries = findSteamLibraries(steamRoot);
        for (const game of KNOWN_GAMES) {
          const app = findInstalledApp(libraries, game.steamAppId);
          if (!app) continue;
          const loader = detectModLoader(app.installDir, game);
          const manager = inferManagerForGame(game, managers) ?? "none";
          const proton = detectProtonForApp(steamRoot, game.steamAppId);
          detectedGames.push({
            gameId: game.gameId,
            gameName: app.name,
            installPath: app.installDir,
            modManager: manager,
            modLoader: loader,
            ...(proton ? { protonVersion: proton } : {}),
          });
        }
      }

      const protonTools =
        os === "linux" && steamRoot ? listProtonTools(steamRoot) : [];

      const result = {
        os,
        isSteamDeck,
        ...(isSteamDeck ? { steamDeckMode: isGameMode ? "game" : "desktop" } : {}),
        steamRoot: steamRoot ?? null,
        installedModManagers: managers.map((m) => ({
          name: m.name,
          dataPath: m.dataPath,
          ...(m.managedGameIds ? { managedGameIds: m.managedGameIds } : {}),
        })),
        detectedGames,
        ...(protonTools.length > 0 ? { availableProton: protonTools } : {}),
      };

      log("debug", "workbench.detect_environment", {
        os,
        isSteamDeck,
        games: detectedGames.length,
        managers: managers.length,
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
    "Read the user's mod load order for a specific game from whichever mod manager they use (MO2, r2modman, or best-effort Vortex). Normalized output: each entry has name, enabled state, load-order index, and attribution metadata when available. Read-only.",
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

  // ─── Tool 3: mw_parse_crashlog ──────────────────────────────────────────────
  // Parse a crashlog into structured fields. PARSING ONLY — no diagnosis, no
  // suggested causes. That separation is the differentiator: static analyzers
  // (Phostwood, Skyrim Crash Decoder, CLAS) pattern-match against known
  // crashes; here we hand the LLM clean structured data so it can reason
  // across the user's specific load order.

  server.tool(
    "mw_parse_crashlog",
    "Parse a crashlog file or pasted content into structured fields (exception type, call stack, loaded plugins, registers, suspected FormID refs). Supports Crash Logger SSE (Skyrim), Buffout 4 (Fallout 4), NetScriptFramework (older Skyrim), BepInEx (Unity games), and Minecraft crash-reports. Returns parsed structure only — diagnosis is the LLM's job.",
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
          "Absolute path to a crashlog file on disk. Common locations: ~/Documents/My Games/Skyrim Special Edition/SKSE/crash-*.log for Crash Logger SSE, ~/Documents/My Games/Fallout4/F4SE/crash-*.log for Buffout 4, the game's BepInEx/LogOutput.log for Unity, or ~/.minecraft/crash-reports/crash-*.txt for Minecraft."
        ),
      logType: z
        .enum([
          "auto",
          "crashlogger-sse",
          "buffout4",
          "netscriptframework",
          "bepinex",
          "minecraft",
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
    "Look up a mod's metadata across supported platforms (Nexus, mod.io) with a normalized shape: id, name, author, version, downloads, endorsements, pageUrl, and a permissions block that always includes attribution. Use this to enrich crashlog suspects or load-order entries with who-made-this and where-it-lives info. Thunderstore and CurseForge support is planned for v3+.",
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
        .enum(["nexus", "modio", "thunderstore", "curseforge", "any"])
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
    "Check a list of mods/plugins for known pairwise incompatibilities. Two sources: LOOT's masterlist (live, Bethesda games) and ModWrench's community conflict database (bundled, any game). Returns conflicts with severity, description, attribution to source, and an optional patch suggestion. Input identifiers can be plugin filenames (Skyrim.esp) or platform-prefixed mod IDs (nexus:12345).",
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
        ],
      };
    }
  );

  return { toolCount: 5 };
}
