// Shared types for known-conflict detection. Two sources feed this:
//   1. LOOT masterlist (live fetch from GitHub, Bethesda games only)
//   2. data/conflicts/<gameId>.json (bundled with the workbench package, any
//      game — accepts community PRs)

export type ConflictSeverity =
  | "incompatible"
  | "load-order-sensitive"
  | "patch-available"
  | "informational";

export type ConflictSource =
  | "loot-masterlist"
  | "community"
  | "modwrench-curated";

export type KnownConflict = {
  modA: string;
  modB: string;
  severity: ConflictSeverity;
  description: string;
  source: ConflictSource;
  workaround?: string;
  patchModId?: string;
};

/** One of LOOT's messages about a plugin, in LOOT's words. LOOT's "error" is a warning here. */
export type LootNote = {
  plugin: string;
  type: "note" | "warning";
  text: string;
};

export type CheckKnownConflictsInput = {
  gameId: string;
  modIds: string[];
  /**
   * The plugins in modIds are every active plugin (a crash log's whole list), so
   * LOOT's conditions can take any other plugin as inactive. Otherwise a plugin
   * in modIds is active and any other may or may not be.
   */
  allActive?: boolean;
  /** Also return LOOT's messages for the plugins in modIds (mw_diagnose_crash only). */
  withLootNotes?: boolean;
};

export type CheckKnownConflictsResult = {
  conflicts: KnownConflict[];
  sources: {
    loot: { available: boolean; reason?: string };
    community: { available: boolean; entries: number };
  };
  /** Honest about gaps — surfaces partial-data warnings to the LLM. */
  warnings?: string[];
  /** With withLootNotes, once the masterlist is read: LOOT's messages whose condition is true, in the plugins' order. */
  lootNotes?: LootNote[];
};
