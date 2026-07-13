// ─── MCP prompts — the "/" summons ───────────────────────────────────────────
// MCP prompts are the typed entry points modders already expect: most hosts
// (Claude Code, Claude Desktop, Cursor) surface a server's prompts as
// slash-commands. These are how you *summon* ModWrench instead of hoping the
// model picks the right tool from a plain sentence.
//
// Each prompt returns a seeded user turn that steers the model to the correct
// ModWrench tool(s). They hold no state and read nothing — a prompt is just a
// well-aimed opening line. Voice is deadpan modder: names real tools, promises
// nothing it can't keep, never hypes.
//
// Extracted from index.ts so the registration + message-building is unit
// testable without booting the stdio server (which reads argv and connects a
// transport on import).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** A prompt result is one seeded user turn. Text only — no state, no fetch. */
export type PromptResult = {
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
};

function user(text: string): PromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

// ─── Message builders (pure — exported for tests) ────────────────────────────

/** `/modwrench` — summon + orient. */
export function buildModwrenchPrompt(): PromptResult {
  return user(
    "Open ModWrench. Call `mw_deck` to show the active connectors and the " +
      "flagship-game shortcuts, then tell me in a line or two what I can do from " +
      "here — search for mods, diagnose a crash log, check for known conflicts, or " +
      "read my load order. Keep it tight; I'll pick from there."
  );
}

/** `/mw-find <query>` — one search across every live platform. */
export function buildFindPrompt(query: string): PromptResult {
  return user(
    `Find mods matching "${query}" across whatever ModWrench platforms are live. ` +
      "Use the search tools available (nexus_search, modio_search_mods, " +
      "thunderstore_search_mods) and show the results as mod cards. Keep the author " +
      "credit on every result — attribution stays on."
  );
}

/** `/mw-crash [log]` — crash log in, culprit out. */
export function buildCrashPrompt(log?: string): PromptResult {
  const trimmed = log?.trim();
  if (trimmed) {
    return user(
      "Parse this crash log with `mw_parse_crashlog`, then diagnose it from the " +
        "parsed output only — exception, call stack, registers, modules, plugins. " +
        "Name the most likely culprit mod and the fix. Don't guess beyond the data.\n\n" +
        "---\n" +
        trimmed
    );
  }
  return user(
    "I want to debug a crash. Ask me to paste the crash log or give a path — the " +
      "usual spots are Documents/My Games/Skyrim Special Edition/SKSE/crash-*.log, " +
      ".../Fallout4/F4SE/crash-*.log, or the game's BepInEx/LogOutput.log. Then parse " +
      "it with `mw_parse_crashlog` and diagnose from the parsed data only — don't " +
      "guess beyond what's in the log."
  );
}

/** `/mw-conflicts [game]` — known-conflict check, no promises. */
export function buildConflictsPrompt(game?: string): PromptResult {
  const g = game?.trim();
  const forGame = g ? ` for ${g}` : "";
  const detect = g
    ? `run \`mw_read_load_order\` for ${g} (and \`mw_detect_environment\` first if you need the manager)`
    : "run `mw_detect_environment` to find the game and manager, then `mw_read_load_order`";
  return user(
    `Check my mods for known conflicts${forGame}. If you don't have my plugin/mod ` +
      `list yet, ${detect}, then pass that list into \`mw_check_known_conflicts\` and ` +
      "show the conflicts view. Flag what's on the list — don't imply the game will " +
      "or won't run. It's Bethesda; nothing's a promise."
  );
}

/** `/mw-order` — post your load order to Claude, not a Discord. */
export function buildOrderPrompt(): PromptResult {
  return user(
    "Read my current load order. Run `mw_detect_environment` first if you need the " +
      "game and manager, then `mw_read_load_order`, and show it in the load-order " +
      "view — priority, enabled/disabled, versions."
  );
}

// ─── Prompt catalog + registration ───────────────────────────────────────────

/** Canonical prompt names, in menu order. Kept in sync with registerPrompts. */
export const PROMPT_NAMES = [
  "modwrench",
  "mw-find",
  "mw-crash",
  "mw-conflicts",
  "mw-order",
] as const;

export const PROMPT_COUNT = PROMPT_NAMES.length;

/**
 * Register ModWrench's prompts on the given MCP server. Calling `.prompt()`
 * makes the SDK advertise the `prompts` capability automatically, so hosts
 * that render slash-commands will surface these. Returns the count for boot
 * logging.
 */
export function registerPrompts(server: McpServer): { promptCount: number } {
  server.prompt(
    "modwrench",
    "Summon ModWrench. Opens the deck, shows which platforms are live, and lays out what you can do from here — search, diagnose a crash, check conflicts, read your load order. Start here.",
    () => buildModwrenchPrompt()
  );

  server.prompt(
    "mw-find",
    "Find a mod across every live platform (Nexus / mod.io / Thunderstore) without opening three tabs. Give it a name or a vibe.",
    {
      query: z
        .string()
        .describe(
          "What you're hunting for — a mod name, an author, or a vibe ('immersive armor', 'better sprint')."
        ),
    },
    ({ query }) => buildFindPrompt(query)
  );

  server.prompt(
    "mw-crash",
    "Crash log in, culprit out. Paste a Buffout 4 / Crash Logger SSE / BepInEx log (or point at the file) and ModWrench parses it so the model can name the likely mod. It parses; it never guesses.",
    {
      log: z
        .string()
        .optional()
        .describe(
          "Paste the crash log text, or a file path. Leave it empty and I'll ask where yours lives (…/SKSE/, …/F4SE/, BepInEx/LogOutput.log)."
        ),
    },
    ({ log }) => buildCrashPrompt(log)
  );

  server.prompt(
    "mw-conflicts",
    "Check your setup for known mod conflicts — LOOT's masterlist (Bethesda) plus ModWrench's community list. It flags what's on the list; it won't promise the game runs.",
    {
      game: z
        .string()
        .optional()
        .describe(
          "Canonical game id (e.g. skyrimspecialedition, lethalcompany). Leave it empty and I'll detect it first."
        ),
    },
    ({ game }) => buildConflictsPrompt(game)
  );

  server.prompt(
    "mw-order",
    "Post your load order — to Claude, not a Discord. Reads your MO2 / r2modman / Vortex order and lays it out.",
    () => buildOrderPrompt()
  );

  return { promptCount: PROMPT_COUNT };
}
