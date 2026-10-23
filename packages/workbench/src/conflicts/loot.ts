import { load as yamlLoad } from "js-yaml";
import { appIdentity, getEnv, log } from "@modwrench/core";
import { clean } from "../patchday/summary.js";
import { parseCondition, type Condition } from "./condition.js";

const APP = appIdentity(import.meta.url);

// LOOT publishes a separate masterlist repo per game. Each repo's
// masterlist.yaml is the community-curated source of truth for load-order
// rules and known incompatibilities. We fetch the raw file from GitHub —
// no auth needed.
//
// The schema we care about (LOOT's metadata syntax, libloot docs/metadata):
//   plugins:
//     - name: 'SomeMod.esp'
//       inc:
//         - 'IncompatibleMod.esp'
//         - name: 'ConditionalInc.esp'
//           display: 'Conditional Inc'  # LOOT's name for the file (CommonMark)
//           detail: 'Only the v2 files.' # or a list of { lang, text }
//           condition: 'active("...")' # see condition.ts
//       msg:
//         - type: say                   # or warn, or error
//           content: 'Use {0}.'         # or a list of { lang, text }
//           subs: [ 'Another.esp' ]     # put in place of {0}, {1}, ...
//           condition: 'active("...")'
//
// display, detail, content and condition are someone else's text, read by a
// model: they're kept as one plain line, cut at TEXT_MAX (the longest detail
// in Skyrim SE's and Fallout 4's lists is 177 characters). One entry even has
// its name and display swapped.
//
// Other LOOT fields (after, req, group, etc.) aren't used by this tool
// — they're for load-order optimization, not incompatibility detection.

// Pinned to the branch LOOT itself reads by default (DEFAULT_MASTERLIST_BRANCH
// in loot/loot's game_settings.h), v0.29 since LOOT 0.29.0. A version branch
// rather than whatever is newest, so an upstream syntax change can't silently
// break our parser. LOOT moves its users off older branches when it updates,
// and new entries go to the current one only: v0.26 has had none since 0.29.0
// came out (2026-04-11).
//
// Bump this default when LOOT's does, after verifying the masterlist YAML
// still parses against parseLootMasterlist below. Users can override via env var.
const LOOT_BRANCH = getEnv("LOOT_BRANCH", "v0.29");

// Per-game LOOT repo names. Only Bethesda games have LOOT masterlists. The VR
// editions have no list on a current branch: LOOT reads Skyrim SE's for Skyrim
// VR and Fallout 4's for Fallout 4 VR (loot/loot's game_settings.cpp).
const LOOT_REPOS: Record<string, string> = {
  skyrimspecialedition: "skyrimse",
  skyrim: "skyrim",
  skyrimvr: "skyrimse",
  fallout4: "fallout4",
  fallout4vr: "fallout4",
  fallout3: "fallout3",
  falloutnv: "falloutnv",
  starfield: "starfield",
  oblivion: "oblivion",
};

// The fetch's limits. The largest masterlist is Oblivion's, at 1.2 MB, so a
// body over 8 MB isn't one, and is left unread rather than held in memory.
// 30 seconds lets 1.2 MB arrive over a connection as slow as about 320 kbit/s,
// and gives up well before the 60 seconds an MCP client waits for a tool's
// answer by default (the MCP SDK's request timeout), so a stalled connection
// still gets an answer from the community data.
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

const FETCH_FAILED =
  "LOOT masterlist fetch failed (network, GitHub unreachable, or parse error).";
const TIMED_OUT = `LOOT masterlist fetch timed out after ${TIMEOUT_MS / 1000} seconds.`;
const TOO_LARGE = `LOOT masterlist was over ${MAX_BYTES / 1024 / 1024} MB, so it wasn't read.`;

/** Why the masterlist can't be used: one sentence, for the answer. */
export type LootUnavailable = { failed: string };

const TEXT_MAX = 300;

export type LootIncEntry = {
  plugin: string;
  /** LOOT's name for the file, as plain text. */
  display?: string;
  /** LOOT's note on the entry, in English, as plain text. */
  detail?: string;
  /** The condition LOOT applies the entry under, as LOOT wrote it, on one line. */
  condition?: string;
  /** That condition, read. */
  when?: Condition;
};

/** One of LOOT's messages about a plugin. */
export type LootMessage = {
  type: "say" | "warn" | "error";
  /** In English, with its substitutions made, as plain text. */
  text: string;
  when?: Condition;
};

export type LootPluginRule = {
  name: string;
  /** What a plugin's name is checked against: LOOT's name lowercased, or the regex it is. */
  match: string | RegExp;
  inc: LootIncEntry[];
  msg: LootMessage[];
};

export type LootMasterlist = {
  gameId: string;
  branch: string;
  fetchedAt: number;
  /**
   * Every entry with an inc or msg list, in file order. A plugin can match several
   * (its exact name and any number of regexes), and LOOT merges them all, in this order.
   */
  rules: LootPluginRule[];
};

// LOOT reads an entry's name as a regex when it holds any of : \ * ? |, so a
// backslash alone ('Example\.esm') makes one. It anchors it as ^name$ and
// matches it case-insensitively (libloot's plugin_metadata.rs).
const REGEX_NAME = /[:\\*?|]/;

/** How an entry's name matches a plugin, or null for a regex JavaScript can't read (the entry is skipped). */
function nameMatch(name: string, gameId: string): string | RegExp | null {
  if (!REGEX_NAME.test(name)) return name.toLowerCase();
  try {
    return new RegExp(`^${name}$`, "iu");
  } catch {
    log("warn", "workbench.loot.bad_regex", { gameId, name });
    return null;
  }
}

const memCache = new Map<string, LootMasterlist | Promise<LootMasterlist | LootUnavailable>>();

/** LOOT's English text: a plain string, or the `en` item of a list of { lang, text }. */
function english(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const en = value.find((v) => v && typeof v === "object" && (v as Record<string, unknown>)["lang"] === "en");
  return en ? (en as Record<string, unknown>)["text"] : undefined;
}

/**
 * LOOT's CommonMark as one plain line: a link becomes "text (address)", bold and
 * code marks go, and a double quote becomes a single one so the text can't close
 * the quotes it is put in.
 */
function plainText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const flat = value
    .replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, "$1 ($2)")
    .replace(/\*\*|__|`/g, "")
    .replace(/"/g, "'");
  return clean(flat, TEXT_MAX) || undefined;
}

function normalizeIncEntry(raw: unknown): LootIncEntry | null {
  if (typeof raw === "string") return { plugin: raw };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const name = obj["name"];
    if (typeof name === "string") {
      const entry: LootIncEntry = { plugin: name };
      const display = plainText(obj["display"]);
      if (display) entry.display = display;
      const detail = plainText(english(obj["detail"]));
      if (detail) entry.detail = detail;
      // Conditions are code, so only made one line; they never hold a backtick, which would end the quote.
      // What is read is LOOT's own text, whole.
      const condition = obj["condition"];
      if (typeof condition === "string") {
        const line = clean(condition.replace(/`/g, "'"), TEXT_MAX);
        if (line) {
          entry.condition = line;
          entry.when = parseCondition(condition);
        }
      }
      return entry;
    }
  }
  return null;
}

/** A message LOOT shows for a plugin, or null for one without a type or English text. */
function normalizeMessage(raw: unknown): LootMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const type = obj["type"];
  if (type !== "say" && type !== "warn" && type !== "error") return null;
  const content = english(obj["content"]);
  if (typeof content !== "string") return null;
  // {0}, {1}, ... take the substitutions in order; one without a substitution stays as written.
  const subs: unknown[] = Array.isArray(obj["subs"]) ? obj["subs"] : [];
  const filled = content.replace(/\{(\d+)\}/g, (whole, n: string) => {
    const sub = subs[Number(n)];
    return typeof sub === "string" ? sub : whole;
  });
  const text = plainText(filled);
  if (!text) return null;
  const message: LootMessage = { type, text };
  const condition = obj["condition"];
  if (typeof condition === "string" && condition.trim()) message.when = parseCondition(condition);
  return message;
}

function parseLootMasterlist(
  text: string,
  gameId: string,
  branch: string
): LootMasterlist | null {
  let doc: unknown;
  try {
    doc = yamlLoad(text);
  } catch (err) {
    log("warn", "workbench.loot.parse_error", {
      gameId,
      msg: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const plugins = (doc as Record<string, unknown>)["plugins"];
  if (!Array.isArray(plugins)) return null;

  const rules: LootPluginRule[] = [];
  for (const raw of plugins) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const name = entry["name"];
    if (typeof name !== "string") continue;
    const incRaw = entry["inc"];
    const inc: LootIncEntry[] = [];
    if (Array.isArray(incRaw)) {
      for (const i of incRaw) {
        const normalized = normalizeIncEntry(i);
        if (normalized) inc.push(normalized);
      }
    }
    const msg: LootMessage[] = [];
    if (Array.isArray(entry["msg"])) {
      for (const m of entry["msg"]) {
        const normalized = normalizeMessage(m);
        if (normalized) msg.push(normalized);
      }
    }
    if (inc.length === 0 && msg.length === 0) continue;
    const match = nameMatch(name, gameId);
    if (match !== null) rules.push({ name, match, inc, msg });
  }

  return {
    gameId,
    branch,
    fetchedAt: Date.now(),
    rules,
  };
}

/** The body as text, read as a stream, or null once it passes MAX_BYTES: it is never held whole or parsed in part. */
async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchLootMasterlist(
  gameId: string
): Promise<LootMasterlist | LootUnavailable> {
  const repo = LOOT_REPOS[gameId];
  if (!repo) return { failed: FETCH_FAILED };

  const cacheKey = `${gameId}:${LOOT_BRANCH}`;
  const cached = memCache.get(cacheKey);
  if (cached) return cached instanceof Promise ? cached : cached;

  const url = `https://raw.githubusercontent.com/loot/${repo}/${LOOT_BRANCH}/masterlist.yaml`;
  log("debug", "workbench.loot.fetch", { url });

  const pending: Promise<LootMasterlist | LootUnavailable> = (async () => {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "text/yaml, text/plain;q=0.9, */*;q=0.5",
          "User-Agent": APP.userAgent,
        },
        // Covers reading the body too: a stall at any point ends the fetch.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        log("warn", "workbench.loot.fetch_failed", {
          url,
          status: res.status,
        });
        return { failed: FETCH_FAILED };
      }
      const text = await readCapped(res);
      if (text === null) {
        log("warn", "workbench.loot.too_large", { url, maxBytes: MAX_BYTES });
        return { failed: TOO_LARGE };
      }
      return parseLootMasterlist(text, gameId, LOOT_BRANCH) ?? { failed: FETCH_FAILED };
    } catch (err) {
      log("warn", "workbench.loot.fetch_error", {
        url,
        msg: err instanceof Error ? err.message : String(err),
      });
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      return { failed: timedOut ? TIMED_OUT : FETCH_FAILED };
    }
  })();

  memCache.set(cacheKey, pending);
  const resolved = await pending;
  if ("failed" in resolved) memCache.delete(cacheKey);
  else memCache.set(cacheKey, resolved);
  return resolved;
}

export function hasLootSupport(gameId: string): boolean {
  return gameId in LOOT_REPOS;
}
