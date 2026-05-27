import {
  fetchLootMasterlist,
  hasLootSupport,
  type LootMasterlist,
} from "./loot.js";
import { loadCommunityConflicts } from "./community.js";
import type {
  CheckKnownConflictsInput,
  CheckKnownConflictsResult,
  KnownConflict,
} from "./types.js";

// Identifier normalization. Input modIds can be:
//   - Plugin filename: "Skyrim.esp", "JK's Whiterun Outskirts.esp"
//   - Platform mod ID: "nexus:12345", "modio:67890",
//                      "thunderstore:Author-ModName"
//   - Bare numeric (assumed nexus): "12345"  → we don't auto-prefix; only
//                                                explicit prefixes match
//
// Matching:
//   - Plugin names are case-insensitive (LOOT convention).
//   - Platform IDs are case-sensitive on the suffix, lowercase on the prefix.

export function looksLikePlugin(id: string): boolean {
  return /\.(esp|esm|esl)$/i.test(id);
}

export function normalizeId(id: string): string {
  return looksLikePlugin(id) ? id.toLowerCase() : id;
}

function dedupePairs(conflicts: KnownConflict[]): KnownConflict[] {
  const seen = new Set<string>();
  const out: KnownConflict[] = [];
  for (const c of conflicts) {
    const a = normalizeId(c.modA);
    const b = normalizeId(c.modB);
    const key = [a, b].sort().join("||") + "::" + c.source;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function findLootConflicts(
  masterlist: LootMasterlist,
  inputSet: Set<string>,
  pluginInputs: string[]
): KnownConflict[] {
  const conflicts: KnownConflict[] = [];
  for (const plugin of pluginInputs) {
    const rule = masterlist.plugins.get(plugin.toLowerCase());
    if (!rule) continue;
    for (const inc of rule.inc) {
      const incLower = inc.plugin.toLowerCase();
      if (!inputSet.has(incLower)) continue;
      const entry: KnownConflict = {
        modA: rule.name,
        modB: inc.plugin,
        severity: "incompatible",
        description:
          inc.msg ??
          `LOOT masterlist flags ${rule.name} and ${inc.plugin} as incompatible.`,
        source: "loot-masterlist",
      };
      conflicts.push(entry);
    }
  }
  return conflicts;
}

export function findCommunityConflicts(
  entries: KnownConflict[],
  inputSet: Set<string>
): KnownConflict[] {
  const matches: KnownConflict[] = [];
  for (const entry of entries) {
    const a = normalizeId(entry.modA);
    const b = normalizeId(entry.modB);
    if (inputSet.has(a) && inputSet.has(b)) matches.push(entry);
  }
  return matches;
}

export async function checkKnownConflicts(
  input: CheckKnownConflictsInput
): Promise<CheckKnownConflictsResult> {
  const inputSet = new Set(input.modIds.map(normalizeId));
  const pluginInputs = input.modIds.filter(looksLikePlugin);

  const warnings: string[] = [];

  // ─── LOOT pass ──────────────────────────────────────────────────────────────
  const lootStatus: CheckKnownConflictsResult["sources"]["loot"] = {
    available: false,
  };
  let lootConflicts: KnownConflict[] = [];

  if (!hasLootSupport(input.gameId)) {
    lootStatus.reason = `LOOT masterlists exist only for Bethesda games. ${input.gameId} has no LOOT repo.`;
  } else if (pluginInputs.length === 0) {
    lootStatus.reason =
      "LOOT pass skipped — no plugin filenames in input. " +
      "Pass plugin filenames (.esp/.esm/.esl) to engage LOOT checks.";
  } else {
    const masterlist = await fetchLootMasterlist(input.gameId);
    if (!masterlist) {
      lootStatus.reason =
        "LOOT masterlist fetch failed (network, GitHub unreachable, or " +
        "parse error). Conflict detection falls back to community data only.";
      warnings.push(lootStatus.reason);
    } else {
      lootStatus.available = true;
      lootConflicts = findLootConflicts(masterlist, inputSet, pluginInputs);
    }
  }

  // ─── Community pass ─────────────────────────────────────────────────────────
  const communityEntries = loadCommunityConflicts(input.gameId);
  const communityConflicts = findCommunityConflicts(
    communityEntries,
    inputSet
  );

  const conflicts = dedupePairs([...lootConflicts, ...communityConflicts]);

  const result: CheckKnownConflictsResult = {
    conflicts,
    sources: {
      loot: lootStatus,
      community: {
        available: true,
        entries: communityEntries.length,
      },
    },
  };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}
