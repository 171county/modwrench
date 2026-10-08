import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { log } from "@modwrench/core";
import { detectEnvironment } from "./detect/environment.js";
import { readLoadOrder } from "./loadorder/index.js";
import { parseCrashlog } from "./crashlog/index.js";
import { queryModMetadata } from "./metadata/index.js";
import {
  attributeSuspects as runAttribution,
  createNexusNameSearch,
  type SuspectAttribution,
} from "./metadata/attribute.js";
import {
  themeForCrashType,
  pageAnswer,
  pageData,
  registerAppPage,
  CONFLICTS_PAGE,
  CRASH_PAGE,
  DEPS_PAGE,
  MODS_PAGE,
  conflictsView,
  crashView,
  modsView,
  orderView,
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
import { checkPatchDay } from "./patchday/index.js";
import { summarizePatchDay } from "./patchday/summary.js";
import { registerCrashWhispererApp, registerDoctorApp, registerPatchDayApp } from "./apps.js";
import { summarizeCrashWhisper, whisper } from "./crashwhisper/index.js";
import { runDoctor } from "./doctor/index.js";
import { summarizeDoctor } from "./doctor/summary.js";
import { correlateCrash, type CrashSuspect } from "./crashlog/diagnose.js";
import { isNetworkPath } from "./localpath.js";

const refusal = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });

/**
 * Every tool's handler runs through here. A path argument that names another computer
 * or a device is refused before anything opens it (see localpath.ts), and the answer
 * names the argument but never repeats the path. An error nobody planned for, such as
 * a file another program holds open, comes back as one plain sentence with its code:
 * Node puts the full path, user name and all, in the error's message, and the SDK
 * would hand that message to the client as the answer.
 */
function guarded<A extends unknown[]>(
  tool: string,
  pathArgs: readonly string[],
  handler: (...args: A) => Promise<CallToolResult>
): (...args: A) => Promise<CallToolResult> {
  return async (...args) => {
    try {
      const input = args[0] as Record<string, unknown> | undefined;
      for (const name of pathArgs) {
        const value = input?.[name];
        if (typeof value === "string" && isNetworkPath(value)) {
          return refusal(
            `${name} names another computer or a device (it starts with \\\\ or //), so ${tool} didn't open it. ` +
              "The workbench tools read only this computer's own drives. Copy the file or folder to a local drive and pass that path instead."
          );
        }
      }
      return await handler(...args);
    } catch (err) {
      const raw = (err as { code?: unknown } | null)?.code;
      const code = typeof raw === "string" && /^E[A-Z]+$/.test(raw) ? raw : undefined;
      log("debug", "workbench.tool_failed", { tool, ...(code ? { code } : {}) });
      return refusal(
        `${tool} stopped on an error it didn't expect${code ? ` (${code})` : ""}, so there is no answer this time. ` +
          (code ? "If a file it reads is open in another program or can't be read with your permissions, close that program and try again. " : "") +
          "The error's own text is left out because it can hold folder names."
      );
    }
  };
}

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

  server.registerTool(
    "mw_detect_environment",
    {
      title: "Detect my modding setup",
      description: "See what you're working with. Auto-detects OS, Steam Deck, installed mod-friendly games (Bethesda / Unity co-op), per-game loaders (SKSE / F4SE / BepInEx), mod managers (MO2 / Vortex / r2modman), and Proton versions on Linux. Read-only — reads known config/save locations and touches nothing else. Use when the user asks \"what've I got installed\", \"find my games\", or before any tool that needs to know their setup.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guarded("mw_detect_environment", [], async () => {
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
    })
  );

  // ─── Tool 2: mw_read_load_order ─────────────────────────────────────────────
  // Read the user's current load order for a specific game, normalized across
  // mod managers. Read-only — never modifies state files. Honest about gaps:
  // Vortex returns mod folders only (no enable state) until LevelDB support
  // lands.

  const depsPage = registerAppPage(server, DEPS_PAGE);
  server.registerTool(
    "mw_read_load_order",
    {
      title: "Read my load order",
      description: "Post your load order — but here, not in a Discord. Reads it for a specific game from whichever manager the user runs (MO2, r2modman, or best-effort Vortex). Normalized output: each entry has name, enabled state, load-order index, and attribution when available. Read-only. Use when the user says \"show/post my load order\", \"what mods do I have enabled\", or \"what order are my mods in\".",
      inputSchema: {
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(depsPage ? { _meta: depsPage } : {}),
    },
    guarded("mw_read_load_order", ["instancePath"], async ({ gameId, modManager, profileName, instancePath }) => {
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

      // The page gets the entries without the folder they were read from.
      const order = result.ok
        ? orderView({
            theme: themeForGameId(gameId),
            ok: true,
            manager: result.modManager,
            profile: result.profile,
            enabledCount: result.enabledCount,
            totalCount: result.totalCount,
            loadOrder: result.mods.map((m) => ({
              name: m.name,
              enabled: m.enabled,
              index: m.loadOrderIndex,
              version: m.version,
              source: m.sourcePlatform,
              pluginFile: m.pluginFile,
              author: m.author,
            })),
            warning: result.warning,
            // MO2's mod folders, which the page draws when the profile lists no plugins.
            folders: (result.modFolders ?? []).map((f) => ({ name: f.name, enabled: f.enabled, index: f.modlistIndex })),
          })
        : orderView({ theme: themeForGameId(gameId), ok: false, reason: result.reason });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        ...pageData(server, order, depsPage !== undefined),
      };
    })
  );

  // ─── Tool 3: mw_parse_crashlog ──────────────────────────────────────────────
  // Parse a crashlog into structured fields. PARSING ONLY — no diagnosis, no
  // suggested causes. That separation is the differentiator: static analyzers
  // (Phostwood, Skyrim Crash Decoder, CLAS) pattern-match against known
  // crashes; here we hand the LLM clean structured data so it can reason
  // across the user's specific load order.

  const crashPage = registerAppPage(server, CRASH_PAGE);
  server.registerTool(
    "mw_parse_crashlog",
    {
      title: "Parse a crash log",
      description: "Crash log in, structure out. Parses a crashlog (file path or pasted content) into fields: exception type, call stack, loaded plugins, registers, suspected FormID refs. Handles Crash Logger SSE (Skyrim), Buffout 4 (Fallout 4), NetScriptFramework (older Skyrim), and BepInEx (Unity). Returns parsed structure only — naming the culprit is the model's job, reasoned over the actual load order, not pattern-matched from a list. Use when the user says \"my game crashed\", \"CTD\", \"here's my crash log\", or \"why did it crash\".",
      inputSchema: {
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(crashPage ? { _meta: crashPage } : {}),
    },
    guarded("mw_parse_crashlog", ["logPath"], async ({ logContent, logPath, logType }) => {
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
        ...pageData(server, crashView(result, themeForCrashType(result.ok ? result.detectedType : undefined)), crashPage !== undefined),
      };
    })
  );

  // ─── Tool 4: mw_query_mod_metadata ──────────────────────────────────────────
  // Cross-platform mod lookup with a normalized response shape. Attribution
  // (author, source platform, page URL) is non-optional on every result —
  // the LLM is structurally prevented from stripping credit, per the trust
  // architecture in the wiring prompt.

  const modsPage = registerAppPage(server, MODS_PAGE);
  server.registerTool(
    "mw_query_mod_metadata",
    {
      title: "Look up a mod across platforms",
      description: "Put a name and a source on a mod. Looks up metadata across platforms (Nexus, mod.io) in one normalized shape: id, name, author, version, downloads, endorsements, pageUrl, and a permissions block that always carries attribution. Use it to enrich a crashlog suspect or a load-order entry — \"who made this\", \"look up this mod\", \"what version is X\". Thunderstore support is planned.",
      inputSchema: {
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      ...(modsPage ? { _meta: modsPage } : {}),
    },
    guarded("mw_query_mod_metadata", [], async ({ modId, modName, platform, gameId }) => {
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
        ],
        ...pageData(
          server,
          modsView({ theme: "skyrim", mods: cards, ...(result.found ? {} : { note: result.reason }) }),
          modsPage !== undefined
        ),
      };
    })
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
  //
  // In clients that support MCP Apps the tool also points at the Conflicts page
  // (conflicts-app.ts in @modwrench/ui); every client gets the same text answer.

  const conflictsPage = registerAppPage(server, CONFLICTS_PAGE);
  server.registerTool(
    "mw_check_known_conflicts",
    {
      title: "Check for known conflicts",
      description: "Check a list of mods/plugins for known pairwise incompatibilities. Two sources: LOOT's masterlist (live, Bethesda games) and ModWrench's bundled community conflict database (any game). Returns conflicts with severity, description, source attribution, and an optional patch suggestion. It flags what's on the list — it won't promise the game runs clean. Input ids can be plugin filenames (\"Skyrim.esp\") or platform-prefixed mod ids (\"nexus:12345\"). Use when the user asks \"what's conflicting\", \"will these mods fight\", or \"known issues between X and Y\".",
      inputSchema: {
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      ...(conflictsPage ? { _meta: conflictsPage } : {}),
    },
    // gameId becomes part of a file name in the community lookup, so it is checked like a path.
    guarded("mw_check_known_conflicts", ["gameId"], async ({ gameId, modIds }) => {
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
        ...pageData(
          server,
          conflictsView({
            theme: themeForGameId(gameId),
            gameId,
            conflicts: result.conflicts,
            sources: result.sources,
            warnings: result.warnings,
          }),
          conflictsPage !== undefined
        ),
      };
    })
  );

  // ─── Tool 6: mw_diagnose_crash ─────────────────────────────────────────────
  // Parse a crashlog, THEN correlate its suspects with the loaded plugins and
  // known conflicts — a bundle of facts for the model to reason over. Still
  // parse-not-guess: ModWrench lines up the evidence, it never names the cause.
  server.registerTool(
    "mw_diagnose_crash",
    {
      title: "Diagnose a crash",
      description: "Crash log in, culprit shortlist out. Parses the log, then correlates its suspects with the loaded plugins and (with a gameId) the known-conflict database into one bundle: which suspected mods are actually in the load order, at what index, and which loaded plugins have known conflicts. It lines up the evidence; it does NOT name the cause — that's the model's call, reasoned over the data. Use when the user says \"what's causing my crash\", \"which mod is it\", or pastes a crash log and wants the answer. Opt-in attribution (attributeSuspects=true) links up to 5 suspects to their Nexus mod pages — author, link, and the name it matched, since a name search can mismatch; off by default so the diagnosis stays fully local.",
      inputSchema: {
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
            "Canonical game id (e.g. 'skyrimspecialedition', 'fallout4') to include the known-conflict cross-check, and to scope attribution if requested. Omit to skip both."
          ),
        attributeSuspects: z
          .boolean()
          .optional()
          .describe(
            "Opt-in, off by default: resolve up to 5 named suspects to their Nexus mod pages (author + link) so the user can reach the author. Requires gameId and a stored Nexus credential; makes bounded network calls to api.nexusmods.com only when true. Default: the diagnosis touches nothing but the log."
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      ...(crashPage ? { _meta: crashPage } : {}),
    },
    // gameId reaches the same community lookup as in mw_check_known_conflicts.
    guarded("mw_diagnose_crash", ["logPath", "gameId"], async ({ logContent, logPath, logType, gameId, attributeSuspects }) => {
      const parsed = parseCrashlog({
        ...(logContent !== undefined ? { logContent } : {}),
        ...(logPath !== undefined ? { logPath } : {}),
        ...(logType !== undefined ? { logType } : {}),
      });

      if (!parsed.ok) {
        return {
          content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }],
          ...pageData(server, crashView(parsed, "skyrim"), crashPage !== undefined),
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

      // Opt-in attribution: attach author + page links to named suspects. The
      // default path skips this entirely — the diagnosis touches nothing but
      // the log. See metadata/attribute.ts for the bounds and the honesty
      // rules (name-search, capped, fail-closed on adult content).
      let suspects: Array<CrashSuspect & { attribution?: SuspectAttribution }> =
        diagnosis.suspects;
      let notes = diagnosis.notes;
      if (attributeSuspects === true) {
        const search = createNexusNameSearch();
        if (!search) {
          notes = [
            ...notes,
            "Attribution skipped: no Nexus credential stored. Run " +
              "`modwrench auth login nexus` (or store an API key), then re-run " +
              "with attributeSuspects to get author links.",
          ];
        } else {
          const r = await runAttribution({
            suspectNames: diagnosis.suspects.map((s) => s.name),
            ...(gameId !== undefined ? { gameDomain: gameId } : {}),
            search,
          });
          notes = [...notes, ...r.notes];
          suspects = diagnosis.suspects.map((s) => {
            const a = r.attributed.get(s.name);
            return a === undefined ? s : { ...s, attribution: a };
          });
        }
      }

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
            text: JSON.stringify(
              { diagnosis: { ...diagnosis, suspects, notes }, crash: parsed },
              null,
              2
            ),
          },
        ],
        ...pageData(server, crashView(parsed, themeForCrashType(parsed.detectedType)), crashPage !== undefined),
      };
    })
  );

  // ─── Tool 7: mw_patch_day ──────────────────────────────────────────────────
  // "Is it safe to update?" Reads the game's version, the script extender build,
  // its Address Library file and every plugin DLL, then applies SKSE's own
  // published compatibility rules. Local and read-only: no network, nothing
  // written. See patchday/ and TRUST.md.
  //
  // The answer is plain text first: a short summary any client can show and the
  // model can read. The full report rides along as structured content, and in
  // clients that support MCP Apps the tool also points at a page that draws it
  // (apps.ts). Clients that don't support the extension never see the page.
  const patchDayPage = registerPatchDayApp(server);
  server.registerTool(
    "mw_patch_day",
    {
      title: "Is it safe to update?",
      description: "Is it safe to update? Right before or after a game patch, reads the game's version, the SKSE build, its Address Library file and every SKSE plugin DLL (game folder and Mod Organizer 2), applies SKSE's own published compatibility rules, and says which plugins would be refused. Verdict is go / check / wait, with a reason per plugin and a note on whether each rule is SKSE's own or inferred. Local and read-only — no network, nothing written or kept. Pass targetVersion (e.g. 1.7.104) to check a patch that isn't installed yet. Skyrim Special Edition / Anniversary Edition only for now. A GO means every check that can be run from files passed; it can't promise the game runs. Use when the user asks \"is it safe to update\", \"Steam updated Skyrim and now it won't start\", \"did SKSE break\", or \"which plugins will break after the patch\".",
      inputSchema: {
        gameId: z
          .string()
          .optional()
          .describe(
            "Canonical game ID. Default 'skyrimspecialedition', the only one supported so far."
          ),
        gamePath: z
          .string()
          .optional()
          .describe(
            "The install folder (the one holding SkyrimSE.exe), when ModWrench can't find the game on its own — a GOG copy, or a Steam library in an unusual place."
          ),
        targetVersion: z
          .string()
          .optional()
          .describe(
            "A game version to check instead of the installed one, like '1.7.104'. Use it before updating; the number is in the Steam patch notes or on the SKSE site."
          ),
        mo2InstancePath: z
          .string()
          .optional()
          .describe(
            "Mod Organizer 2 instance folder, for a portable instance that doesn't live where MO2 normally keeps them. Without it, MO2 is read only when it looks like the active manager."
          ),
        profileName: z
          .string()
          .optional()
          .describe("MO2 profile name. Default: the instance's active profile."),
        logPath: z
          .string()
          .optional()
          .describe(
            "Path to skse64.log if it isn't in the usual Documents/My Games folder. SKSE's own log from the last launch is cross-checked against the predictions."
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(patchDayPage ? { _meta: patchDayPage } : {}),
    },
    guarded("mw_patch_day", ["gamePath", "mo2InstancePath", "logPath"], async ({ gameId, gamePath, targetVersion, mo2InstancePath, profileName, logPath }) => {
      const result = checkPatchDay({
        ...(gameId !== undefined ? { gameId } : {}),
        ...(gamePath !== undefined ? { gamePath } : {}),
        ...(targetVersion !== undefined ? { targetVersion } : {}),
        ...(mo2InstancePath !== undefined ? { mo2InstancePath } : {}),
        ...(profileName !== undefined ? { profileName } : {}),
        ...(logPath !== undefined ? { logPath } : {}),
      });

      log("debug", "workbench.patch_day", {
        ok: result.ok,
        verdict: result.ok ? result.verdict : null,
        plugins: result.ok ? result.plugins.total : 0,
      });

      // Plain text for everyone; the full report only for clients that draw pages, while the
      // page is registered (or when MODWRENCH_STRUCTURED says so). Couldn't run (unsupported
      // game, game not found, a version that isn't one): flagged so a client can show it as a
      // failed call.
      return pageAnswer(server, summarizePatchDay(result), result, patchDayPage !== undefined);
    })
  );

  // ─── Tool 8: mw_crash_whisperer ────────────────────────────────────────────
  // "Why did my game crash?" Reads the newest crash log (or one that's pasted or
  // pointed at), says in plain words what happened, ranks the names the log points
  // at with the reason for each and what each rests on, checks the install for the
  // usual causes, and writes the posts to ask for help with, minus the player's name
  // and folders. Local and read-only. See crashwhisper/ and TRUST.md.
  //
  // Same shape as mw_patch_day: plain text first, structured report only for
  // clients that draw pages, a page for the ones that do.
  const crashWhispererPage = registerCrashWhispererApp(server);
  server.registerTool(
    "mw_crash_whisperer",
    {
      title: "Why did my game crash?",
      description: "Why did my game crash? Reads the newest crash log (or one you paste or point at), says in plain words what happened, and lists the names the log points at, ranked, each with its reason and a label for what it rests on: the log itself, your install, a published rule, or ModWrench's own guess. A ranking is a lead, never a verdict. Also checks the setup for the usual causes (for Skyrim Special Edition: game version, SKSE build, Address Library and plugin DLLs), for a Crash Logger SSE or Buffout 4 log, compares your other recent crashes to see whether it keeps happening, and writes posts to ask for help with (forum, GitHub, Discord, or the mod's author) with the personal details it recognises (your name, computer name, folders, addresses, keys) taken out; it can miss things, so read a post before you send it. Handles Crash Logger SSE, Buffout 4, NetScriptFramework and BepInEx logs. Local and read-only — nothing is written or kept, and ModWrench sends nothing anywhere; the answer goes to the AI you're talking to. Call it with no arguments to read the newest crash log. Use when the user says \"my game crashed\", \"CTD\", \"why did it crash\", \"which mod is it\", or \"help me post about this crash\".",
      inputSchema: {
        logContent: z
          .string()
          .optional()
          .describe(
            "The crash log's text, if the user pasted it. Leave it out to read the newest crash log from disk. Up to about 4 MB."
          ),
        logPath: z
          .string()
          .optional()
          .describe(
            "A crash log file, if it isn't where the crash logger normally writes it. Leave it out and ModWrench looks for the newest one."
          ),
        gameId: z
          .string()
          .optional()
          .describe(
            "Which game to look for a log of: skyrimspecialedition, fallout4, lethalcompany and the other games ModWrench knows. Default: whichever game's log is newest."
          ),
        logType: z
          .enum(["auto", "crashlogger-sse", "buffout4", "netscriptframework", "bepinex"])
          .optional()
          .describe(
            "Format hint. Default 'auto' — detect from the content. Pass one when a truncated log can't be told apart."
          ),
        gamePath: z
          .string()
          .optional()
          .describe(
            "The install folder, when ModWrench can't find the game on its own — a GOG copy, or a Steam library in an unusual place. Used with gameId."
          ),
        mo2InstancePath: z
          .string()
          .optional()
          .describe(
            "Mod Organizer 2 instance folder, for a portable instance that doesn't live where MO2 normally keeps them."
          ),
        profileName: z
          .string()
          .optional()
          .describe("MO2 profile name. Default: the instance's active profile."),
        checkInstall: z
          .boolean()
          .optional()
          .describe(
            "Check the log against the player's install (Skyrim Special Edition so far). Default true. False reads the log alone."
          ),
        compareRecent: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe(
            "How many of the player's other recent crash logs to compare, to see whether the same name keeps coming up (Crash Logger SSE and Buffout 4 logs only; NetScriptFramework and BepInEx logs aren't compared). Default 5; 0 skips it."
          ),
        hideNames: z
          .boolean()
          .optional()
          .describe(
            "Leave the plugin lists (plugins, SKSE or F4SE plugins, DLLs) out of the help posts, for someone who'd rather not share what they run. The leads, the call stack, and the objects, game files and Papyrus functions the log names, with every plugin that changed those objects, still appear."
          ),
        packet: z
          .enum(["forum", "github", "discord", "author"])
          .optional()
          .describe(
            "Put the ready-to-post help text for this place into the answer. Without it the answer says the posts are ready and the page offers them."
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(crashWhispererPage ? { _meta: crashWhispererPage } : {}),
    },
    guarded("mw_crash_whisperer", ["logPath", "gamePath", "mo2InstancePath"], async ({
      logContent,
      logPath,
      gameId,
      logType,
      gamePath,
      mo2InstancePath,
      profileName,
      checkInstall,
      compareRecent,
      hideNames,
      packet,
    }) => {
      const result = whisper({
        ...(logContent !== undefined ? { logContent } : {}),
        ...(logPath !== undefined ? { logPath } : {}),
        ...(gameId !== undefined ? { gameId } : {}),
        ...(logType !== undefined ? { logType } : {}),
        ...(gamePath !== undefined ? { gamePath } : {}),
        ...(mo2InstancePath !== undefined ? { mo2InstancePath } : {}),
        ...(profileName !== undefined ? { profileName } : {}),
        ...(checkInstall !== undefined ? { checkInstall } : {}),
        ...(compareRecent !== undefined ? { compareRecent } : {}),
        ...(hideNames !== undefined ? { hideNames } : {}),
      });

      // Counts and a format name only: nothing from the log or the player's files.
      log("debug", "workbench.crash_whisperer", {
        ok: result.ok,
        format: result.ok ? result.crash.format : null,
        source: result.ok ? result.crash.source : null,
        leads: result.ok ? result.leads.length : 0,
        checks: result.ok ? result.checks.length : 0,
      });

      return pageAnswer(server, summarizeCrashWhisper(result, packet ? { packet } : {}), result, crashWhispererPage !== undefined);
    })
  );

  // ─── Tool 9: mw_doctor ─────────────────────────────────────────────────────
  // "Is my setup ready?" The boring causes behind many "my mods keep breaking"
  // threads, read from files: where things live and how much room is left, the
  // plugin list and the masters each plugin needs, Mod Organizer 2's Overwrite
  // folder, crash loggers, and on Linux and Steam Deck the Steam install, Proton
  // prefix, BepInEx override, nxm:// handler, library drive and folder-name case.
  // Local and read-only, and no folder path ends up in the answer. See doctor/ and
  // TRUST.md.
  //
  // Same shape as the other two pages: plain text first, structured report only for
  // clients that draw pages, a page for the ones that do.
  const doctorPage = registerDoctorApp(server);
  server.registerTool(
    "mw_doctor",
    {
      title: "Is my setup ready?",
      description: "Is my setup ready? The Doctors: a read-only health check for the boring causes behind many \"my mods keep breaking\" threads, read from files alone. Setup Doctor: whether the game or its mods sit in a folder Windows protects or syncs (Program Files, OneDrive, Downloads, Desktop) or on a drive short of space; and, for Skyrim Special Edition, the plugin list (missing, switched-off or late masters read from each plugin's header, the 254 full plus 4096 light plugin limits, entries for plugins that are gone, Mod Organizer 2 and the game's own plugins.txt disagreeing), clutter in MO2's Overwrite folder, and crash loggers (none, or two that fight). Deck Doctor, on Linux and Steam Deck: which Steam is in use (regular or Flatpak), the game's Proton prefix, BepInEx's winhttp launch override, the nxm:// link handler, whether the library sits on an NTFS or FAT drive, and folder names that differ only by capital letters. Every finding says what it rests on: your files, a documented rule (with its source) or ModWrench's own guess. The report also lists what ModWrench can't see, such as antivirus, pagefile size and MO2's live file view. Local and read-only: no network, no program started, nothing written or kept, and no folder paths in the answer. A clear report isn't a promise the game starts. Use when the user says \"why do my mods keep breaking\", \"is my setup OK\", \"check before I install this list\", \"Wabbajack keeps failing\", or \"mods won't load on my Deck\".",
      inputSchema: {
        gameId: z
          .string()
          .optional()
          .describe(
            "Canonical game ID. Default 'skyrimspecialedition', which has the plugin, master and crash-logger checks; the location, disk and Deck checks cover the other games ModWrench knows too (see mw_detect_environment)."
          ),
        area: z
          .enum(["all", "setup", "deck"])
          .optional()
          .describe(
            "Which checks to run. Default 'all': the Setup Doctor, plus the Deck Doctor on Linux. 'deck' runs the Deck checks only and does nothing useful off Linux."
          ),
        gamePath: z
          .string()
          .optional()
          .describe(
            "The folder that holds the game's executable (for Skyrim Special Edition, SkyrimSE.exe), not its Data folder, when ModWrench can't find it in a Steam library on its own: a GOG or Epic copy, or an unusual place."
          ),
        mo2InstancePath: z
          .string()
          .optional()
          .describe(
            "Mod Organizer 2 instance folder, for a portable instance that doesn't live where MO2 normally keeps them. Without it a portable instance isn't found, and the answer says the plugin checks looked at the game's own plugins.txt instead."
          ),
        profileName: z
          .string()
          .optional()
          .describe("MO2 profile name. Default: the instance's active profile."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(doctorPage ? { _meta: doctorPage } : {}),
    },
    guarded("mw_doctor", ["gamePath", "mo2InstancePath"], async ({ gameId, area, gamePath, mo2InstancePath, profileName }) => {
      const result = runDoctor({
        ...(gameId !== undefined ? { gameId } : {}),
        ...(area !== undefined ? { area } : {}),
        ...(gamePath !== undefined ? { gamePath } : {}),
        ...(mo2InstancePath !== undefined ? { mo2InstancePath } : {}),
        ...(profileName !== undefined ? { profileName } : {}),
      });

      // Counts only: nothing from the player's files or folders.
      log("debug", "workbench.doctor", {
        ok: result.ok,
        verdict: result.ok ? result.verdict : null,
        problems: result.ok ? result.counts.problem : 0,
        warnings: result.ok ? result.counts.warn : 0,
      });

      return pageAnswer(server, summarizeDoctor(result), result, doctorPage !== undefined);
    })
  );

  return { toolCount: 9 };
}
