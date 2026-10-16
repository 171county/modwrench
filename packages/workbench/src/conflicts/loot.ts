import { load as yamlLoad } from "js-yaml";
import { appIdentity, getEnv, log } from "@modwrench/core";

const APP = appIdentity(import.meta.url);

// LOOT publishes a separate masterlist repo per game. Each repo's
// masterlist.yaml is the community-curated source of truth for load-order
// rules and known incompatibilities. We fetch the raw file from GitHub —
// no auth needed.
//
// The schema we care about (LOOT spec v0.21+):
//   plugins:
//     - name: 'SomeMod.esp'
//       inc:
//         - 'IncompatibleMod.esp'
//         - name: 'ConditionalInc.esp'
//           condition: 'file("...")'    # ignored — we don't evaluate
//           msg: 'A note about when this conflicts'
//
// Other LOOT fields (after, req, msg, group, etc.) aren't used by this tool
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

export type LootIncEntry = {
  plugin: string;
  /** Optional LOOT message (often clarifies why these conflict). */
  msg?: string;
};

export type LootPluginRule = {
  name: string;
  inc: LootIncEntry[];
};

export type LootMasterlist = {
  gameId: string;
  branch: string;
  fetchedAt: number;
  /** Map keyed by lowercased plugin name → rule. LOOT names are case-insensitive. */
  plugins: Map<string, LootPluginRule>;
};

const memCache = new Map<string, LootMasterlist | Promise<LootMasterlist | LootUnavailable>>();

function normalizeIncEntry(raw: unknown): LootIncEntry | null {
  if (typeof raw === "string") return { plugin: raw };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const name = obj["name"];
    if (typeof name === "string") {
      const entry: LootIncEntry = { plugin: name };
      const msg = obj["msg"];
      if (typeof msg === "string") entry.msg = msg;
      return entry;
    }
  }
  return null;
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

  const map = new Map<string, LootPluginRule>();
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
    if (inc.length === 0) continue;
    map.set(name.toLowerCase(), { name, inc });
  }

  return {
    gameId,
    branch,
    fetchedAt: Date.now(),
    plugins: map,
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
