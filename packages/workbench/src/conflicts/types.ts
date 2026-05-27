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

export type CheckKnownConflictsInput = {
  gameId: string;
  modIds: string[];
};

export type CheckKnownConflictsResult = {
  conflicts: KnownConflict[];
  sources: {
    loot: { available: boolean; reason?: string };
    community: { available: boolean; entries: number };
  };
  /** Honest about gaps — surfaces partial-data warnings to the LLM. */
  warnings?: string[];
};
