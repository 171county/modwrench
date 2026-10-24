import {
  fetchLootMasterlist,
  hasLootSupport,
  type LootIncEntry,
  type LootMasterlist,
  type LootPluginRule,
} from "./loot.js";
import type { LootFacts } from "./condition.js";
import { loadCommunityConflicts } from "./community.js";
import type {
  CheckKnownConflictsInput,
  CheckKnownConflictsResult,
  KnownConflict,
  LootNote,
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

/**
 * One LOOT incompatibility. One whose condition ModWrench can't answer is
 * informational: it quotes the condition rather than claim the two plugins
 * conflict. One whose condition is true is reported as if it had none.
 */
function lootConflict(modA: string, modB: string, inc: LootIncEntry, unsure: boolean): KnownConflict {
  const named = inc.display ? `${modB} ("${inc.display}")` : modB;
  let description = unsure
    ? `LOOT masterlist flags ${modA} and ${named} as incompatible only under this condition, and ModWrench couldn't tell whether it holds: \`${inc.condition}\`.`
    : `LOOT masterlist flags ${modA} and ${named} as incompatible.`;
  if (inc.detail) description += ` LOOT's note: "${inc.detail}"`;
  return {
    modA,
    modB,
    severity: unsure ? "informational" : "incompatible",
    description,
    source: "loot-masterlist",
  };
}

export function matchesPlugin(rule: LootPluginRule, plugin: string): boolean {
  return typeof rule.match === "string" ? rule.match === plugin.toLowerCase() : rule.match.test(plugin);
}

/**
 * Every entry that matches a plugin counts, in file order, as LOOT merges them.
 * `inputs` maps each normalized input to the input itself: a pair is named as
 * the player named the two plugins, never by LOOT's regex. An entry whose
 * condition is false isn't reported.
 */
function findLootConflicts(
  masterlist: LootMasterlist,
  inputs: Map<string, string>,
  pluginInputs: string[],
  facts: LootFacts
): KnownConflict[] {
  const conflicts: KnownConflict[] = [];
  for (const plugin of pluginInputs) {
    for (const rule of masterlist.rules) {
      if (!matchesPlugin(rule, plugin)) continue;
      for (const inc of rule.inc) {
        const other = inputs.get(inc.plugin.toLowerCase());
        if (other === undefined) continue;
        const holds = inc.when ? inc.when(facts) : true;
        if (holds === false) continue;
        conflicts.push(lootConflict(plugin, other, inc, holds === "unknown"));
      }
    }
  }
  return conflicts;
}

/** LOOT's messages for the plugins, those whose condition is true or that have none, in the plugins' order, each once. */
function findLootNotes(masterlist: LootMasterlist, pluginInputs: string[], facts: LootFacts): LootNote[] {
  const notes: LootNote[] = [];
  const seen = new Set<string>();
  for (const plugin of pluginInputs) {
    for (const rule of masterlist.rules) {
      if (!matchesPlugin(rule, plugin)) continue;
      for (const msg of rule.msg) {
        if (msg.when && msg.when(facts) !== true) continue;
        const key = `${plugin.toLowerCase()}\n${msg.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        notes.push({ plugin, type: msg.type === "say" ? "note" : "warning", text: msg.text });
      }
    }
  }
  return notes;
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
  let lootNotes: LootNote[] | undefined;

  if (!hasLootSupport(input.gameId)) {
    lootStatus.reason = `LOOT masterlists exist only for Bethesda games. ${input.gameId} has no LOOT repo.`;
  } else if (pluginInputs.length === 0) {
    lootStatus.reason =
      "LOOT pass skipped — no plugin filenames in input. " +
      "Pass plugin filenames (.esp/.esm/.esl) to engage LOOT checks.";
  } else {
    const masterlist = await fetchLootMasterlist(input.gameId);
    if ("failed" in masterlist) {
      lootStatus.reason =
        masterlist.failed + " Conflict detection falls back to community data only.";
      warnings.push(lootStatus.reason);
    } else {
      lootStatus.available = true;
      const inputs = new Map(input.modIds.map((id) => [normalizeId(id), id]));
      const facts: LootFacts = { active: pluginInputs, allActive: input.allActive === true };
      lootConflicts = findLootConflicts(masterlist, inputs, pluginInputs, facts);
      if (input.withLootNotes) lootNotes = findLootNotes(masterlist, pluginInputs, facts);
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
  if (lootNotes) result.lootNotes = lootNotes;
  return result;
}
