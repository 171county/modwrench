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
      "here — search for mods, diagnose a crash log, check for known conflicts, " +
      "read my load order, or check whether a game update is safe. Keep it tight; " +
      "I'll pick from there."
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

/** One line that is the address of a file, as opposed to the text of a log. */
function asFilePath(text: string): string | undefined {
  const unquoted = text.replace(/^(["'])(.*)\1$/s, "$2").trim();
  if (unquoted === "" || unquoted.length > 500 || /[\r\n]/.test(unquoted)) return undefined;
  const looksLikeOne = /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/.test(unquoted) || /\.(?:log|txt)$/i.test(unquoted);
  return looksLikeOne ? unquoted : undefined;
}

/** `/mw-crash [log]` — why did my game crash? */
export function buildCrashPrompt(log?: string): PromptResult {
  const trimmed = log?.trim();
  const path = trimmed ? asFilePath(trimmed) : undefined;
  const source = !trimmed
    ? "Why did my game crash? Run `mw_crash_whisperer` with no arguments: it finds and " +
      "reads my newest crash log on this computer itself, so there's nothing for me to " +
      "paste, and my name and folders come out before anything reaches you. "
    : path
      ? "Why did my game crash? Run `mw_crash_whisperer` with logPath set to exactly the " +
        `line below (it reads the file itself):\n${path}\n\n`
      : "Why did my game crash? Run `mw_crash_whisperer` with the log below as logContent. ";
  const answer =
    "Lead with what happened, in plain words. Then the leads it ranked, strongest first, " +
    "each with how sure it is and what it rests on: the log, my files, a published rule, " +
    "or ModWrench's own guess. A lead isn't a finding, so don't call any mod guilty and " +
    "don't call anything safe. Then the setup problems it found, if any, and what I'd do " +
    "first. Offer the help post for the forum, GitHub, Discord or the mod's author; when " +
    "I choose one, call it again with packet set to that place and give me the text to " +
    "copy as it is.";
  if (!trimmed) {
    return user(
      source +
        answer +
        " If it can't find a log, ask me where mine is and use logPath; ask me to paste " +
        "it only if the file can't be reached."
    );
  }
  if (path) return user(source + answer);
  return user(
    source +
      answer +
      " Mention once, in a sentence, that a log pasted into the chat has already reached " +
      "you with my name and folders in it, and that `/mw-crash` with nothing after it " +
      "reads the log from disk and removes them first.\n\n---\n" +
      trimmed
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

/** `/mw-patch [version]` — is it safe to update? */
export function buildPatchPrompt(version?: string): PromptResult {
  const v = version?.trim();
  const target = v
    ? ` Check against game version ${v}: pass targetVersion ${JSON.stringify(v)} so it judges that version, not the installed one.`
    : "";
  return user(
    "Is it safe to update my game? Run `mw_patch_day` and lead with the verdict " +
      "(go / check / wait) in one line. Then list only what's broken or unclear — " +
      "the plugin, why, and whether the reason is SKSE's own rule or inferred — and " +
      "what I'd have to do about each. Don't call it safe: a go only means the " +
      "file checks passed." +
      target
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
  "mw-patch",
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
    "Why did my game crash? Reads your newest crash log (Crash Logger SSE, Buffout 4, NetScriptFramework or BepInEx), says what happened in plain words, ranks the names it points at with how sure it is, and writes a help post with the personal details it recognises taken out. Local and read-only. A lead is not a verdict.",
    {
      log: z
        .string()
        .optional()
        .describe(
          "Leave it empty and ModWrench reads your newest crash log itself, which is the most private way: ModWrench takes out the personal details it recognises before anything reaches the AI. Or give a file path (the path itself reaches the AI as you typed it). Pasting the text works, but a paste has already reached the AI as you typed it."
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

  server.prompt(
    "mw-patch",
    "Is it safe to update? Reads your game version, SKSE and every plugin, and says which ones SKSE would refuse after the patch — before it lands or after. Local and read-only.",
    {
      version: z
        .string()
        .optional()
        .describe(
          "A game version to check before you update, like 1.7.104. Leave it empty to check what's installed now."
        ),
    },
    ({ version }) => buildPatchPrompt(version)
  );

  return { promptCount: PROMPT_COUNT };
}
