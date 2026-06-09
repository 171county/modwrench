import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "@modwrench/core";
import { pathExists } from "../detect/os.js";
import type { ConflictSeverity, KnownConflict } from "./types.js";

// Community-curated conflict database. One file per game, bundled with the
// workbench package, accepts PRs from contributors. Schema matches the
// wiring-prompt example:
//
//   [
//     {
//       "modA": "nexus:65876",
//       "modB": "nexus:35895",
//       "severity": "incompatible",
//       "description": "...",
//       "source": "community",
//       "workaround": "...",      // optional
//       "patchModId": "nexus:75512"  // optional
//     }
//   ]
//
// modA and modB can be either platform-prefixed IDs (nexus:N, modio:N,
// thunderstore:Author-ModName) or plugin filenames (Skyrim.esp). The checker
// matches against the user's input modIds in either form.

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the bundled data/conflicts directory. After build the file layout is
 * dist/conflicts/community.js → ../../data/conflicts/<gameId>.json
 * (workbench package root → data/conflicts/). We resolve relative to this
 * module's URL so the lookup works whether the package is installed under
 * node_modules or run from the workspace.
 */
function dataDir(): string {
  return resolve(HERE, "..", "..", "data", "conflicts");
}

const VALID_SEVERITIES = new Set<ConflictSeverity>([
  "incompatible",
  "load-order-sensitive",
  "patch-available",
  "informational",
]);

function isValidEntry(raw: unknown): raw is KnownConflict {
  if (!raw || typeof raw !== "object") return false;
  const e = raw as Record<string, unknown>;
  return (
    typeof e["modA"] === "string" &&
    typeof e["modB"] === "string" &&
    typeof e["severity"] === "string" &&
    VALID_SEVERITIES.has(e["severity"] as ConflictSeverity) &&
    typeof e["description"] === "string"
  );
}

export function loadCommunityConflicts(gameId: string): KnownConflict[] {
  const path = resolve(dataDir(), `${gameId}.json`);
  if (!pathExists(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    log("warn", "workbench.community.parse_error", {
      gameId,
      msg: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  if (!Array.isArray(parsed)) {
    log("warn", "workbench.community.shape_error", {
      gameId,
      msg: "expected top-level array",
    });
    return [];
  }
  const out: KnownConflict[] = [];
  for (const raw of parsed) {
    if (!isValidEntry(raw)) continue;
    // Force the source field to "community" if it claims something stronger.
    // modwrench-curated is reserved for entries we vouch for; community-PR
    // entries default to "community" until promoted.
    const entry: KnownConflict = {
      modA: raw.modA,
      modB: raw.modB,
      severity: raw.severity,
      description: raw.description,
      source:
        raw.source === "modwrench-curated" ? "modwrench-curated" : "community",
    };
    if (raw.workaround) entry.workaround = raw.workaround;
    if (raw.patchModId) entry.patchModId = raw.patchModId;
    out.push(entry);
  }
  return out;
}
