// Crash correlation — the "which mod is it" bundle.
//
// PARSE-NOT-GUESS still holds: this never names the cause. It lines up the
// evidence already in the crash log — suspected refs, call-stack modules — and
// cross-references them against the loaded plugins and (optionally) the known-
// conflict database, so the model reasons over facts instead of vibes. Pure:
// the conflict check is injected, so it unit-tests without a filesystem or net.

import type { CrashlogParseResult } from "./types.js";
import type { KnownConflict } from "../conflicts/types.js";

export type CrashSuspect = {
  name: string;
  from: "suspected-ref" | "call-stack";
  detail?: string;
  /** Whether this name appears in the crash's own loaded-plugin list. */
  inLoadedPlugins: boolean;
  loadIndex?: string;
};

export type CrashDiagnosis = {
  detectedType: string;
  suspects: CrashSuspect[];
  loadedPluginCount: number;
  knownConflicts: KnownConflict[];
  gameId?: string;
  notes: string[];
  disclaimer: string;
};

export type ConflictChecker = (
  gameId: string,
  modIds: string[]
) => Promise<{ conflicts: KnownConflict[]; warnings?: string[] }>;

// Engine/runtime modules that appear in almost every crash — not useful
// suspects. Matched case-insensitively at the start of the module name.
const CORE_MODULE =
  /^(fallout4|falloutnv|skyrimse|skyrimvr|skyrim|tesv|starfield|f4se|skse64|skse|nvse|kernel32|kernelbase|ntdll|user32|d3d1[12]|dxgi|nvwgf2umx|nvd3dum|msvcp\d|vcruntime\d|steamclient|bink2w64|binkw)/i;

export async function correlateCrash(opts: {
  parsed: CrashlogParseResult;
  gameId?: string;
  checkConflicts?: ConflictChecker;
}): Promise<CrashDiagnosis> {
  const plugins = opts.parsed.loadedPlugins ?? [];
  const byLower = new Map(
    plugins.map((p) => [p.name.toLowerCase(), p] as const)
  );
  const suspects: CrashSuspect[] = [];
  const seen = new Set<string>();

  // 1. Suspected refs the parser already flagged (highest signal).
  for (const ref of opts.parsed.suspectedRefs ?? []) {
    const src = ref.likelySource?.trim();
    if (!src) continue;
    const key = src.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const lp = byLower.get(key);
    suspects.push({
      name: src,
      from: "suspected-ref",
      detail: `${ref.type}: ${ref.value}`,
      inLoadedPlugins: lp !== undefined,
      ...(lp?.loadIndex !== undefined ? { loadIndex: lp.loadIndex } : {}),
    });
  }

  // 2. Non-core modules on the call stack.
  for (const frame of opts.parsed.callStack ?? []) {
    const mod = frame.module?.trim();
    if (!mod) continue;
    const key = mod.toLowerCase();
    if (seen.has(key)) continue;
    if (CORE_MODULE.test(mod)) continue;
    seen.add(key);
    const lp = byLower.get(key);
    suspects.push({
      name: mod,
      from: "call-stack",
      ...(frame.function ? { detail: frame.function } : {}),
      inLoadedPlugins: lp !== undefined,
      ...(lp?.loadIndex !== undefined ? { loadIndex: lp.loadIndex } : {}),
    });
  }

  // 3. Optional known-conflict cross-check over the loaded plugins.
  const notes: string[] = [];
  let knownConflicts: KnownConflict[] = [];
  if (opts.gameId && opts.checkConflicts && plugins.length >= 2) {
    try {
      const r = await opts.checkConflicts(
        opts.gameId,
        plugins.map((p) => p.name)
      );
      knownConflicts = r.conflicts;
      for (const w of r.warnings ?? []) notes.push(w);
    } catch (err) {
      notes.push(
        `known-conflict check failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else if (!opts.gameId) {
    notes.push(
      "No gameId given — skipped the known-conflict cross-check. Pass gameId (e.g. skyrimspecialedition) to include it."
    );
  }

  return {
    detectedType: opts.parsed.detectedType,
    suspects,
    loadedPluginCount: plugins.length,
    knownConflicts,
    ...(opts.gameId !== undefined ? { gameId: opts.gameId } : {}),
    notes,
    disclaimer:
      "ModWrench correlated these facts from the crash log — it does not name the cause. Reason over the suspects, whether they're in the load order, and any known conflicts to pick the likely culprit. Don't guess beyond the data.",
  };
}
