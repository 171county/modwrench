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

// Pinned to a stable LOOT version branch rather than `master` so an upstream
// schema change can't silently break our parser. v0.26 is the current
// maintenance branch as of 2026 — community conflict entries keep flowing
// into it via PRs while the schema stays frozen until v0.27.
//
// Bump this default deliberately after verifying the masterlist YAML still
// parses against parseLootMasterlist below. Users can override via env var.
const LOOT_BRANCH = getEnv("LOOT_BRANCH", "v0.26");

// Per-game LOOT repo names. Only Bethesda games have LOOT masterlists.
const LOOT_REPOS: Record<string, string> = {
  skyrimspecialedition: "skyrimse",
  skyrim: "skyrim",
  skyrimvr: "skyrimvr",
  fallout4: "fallout4",
  fallout4vr: "fallout4vr",
  fallout3: "fallout3",
  falloutnv: "falloutnv",
  starfield: "starfield",
  oblivion: "oblivion",
};

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

const memCache = new Map<string, LootMasterlist | Promise<LootMasterlist | null>>();

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

export async function fetchLootMasterlist(
  gameId: string
): Promise<LootMasterlist | null> {
  const repo = LOOT_REPOS[gameId];
  if (!repo) return null;

  const cacheKey = `${gameId}:${LOOT_BRANCH}`;
  const cached = memCache.get(cacheKey);
  if (cached) return cached instanceof Promise ? cached : cached;

  const url = `https://raw.githubusercontent.com/loot/${repo}/${LOOT_BRANCH}/masterlist.yaml`;
  log("debug", "workbench.loot.fetch", { url });

  const pending: Promise<LootMasterlist | null> = (async () => {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "text/yaml, text/plain;q=0.9, */*;q=0.5",
          "User-Agent": APP.userAgent,
        },
      });
      if (!res.ok) {
        log("warn", "workbench.loot.fetch_failed", {
          url,
          status: res.status,
        });
        return null;
      }
      const text = await res.text();
      return parseLootMasterlist(text, gameId, LOOT_BRANCH);
    } catch (err) {
      log("warn", "workbench.loot.fetch_error", {
        url,
        msg: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  })();

  memCache.set(cacheKey, pending);
  const resolved = await pending;
  if (resolved) memCache.set(cacheKey, resolved);
  else memCache.delete(cacheKey);
  return resolved;
}

export function hasLootSupport(gameId: string): boolean {
  return gameId in LOOT_REPOS;
}
