import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correlateCrash,
  type ConflictChecker,
} from "../src/crashlog/diagnose.js";
import type { CrashlogParseResult } from "../src/crashlog/types.js";

function crash(over: Partial<CrashlogParseResult> = {}): CrashlogParseResult {
  return {
    detectedType: "buffout4",
    exception: { type: "EXCEPTION_ACCESS_VIOLATION" },
    callStack: [],
    loadedPlugins: [],
    rawSections: {},
    ...over,
  };
}

test("flags a suspected ref that is present in the load order, with its index", async () => {
  const parsed = crash({
    loadedPlugins: [{ name: "SomeMod.esp", loadIndex: "FE:012" }],
    suspectedRefs: [
      { type: "FormID", value: "0xFE012800", likelySource: "SomeMod.esp" },
    ],
  });
  const d = await correlateCrash({ parsed });
  assert.equal(d.suspects.length, 1);
  assert.equal(d.suspects[0]?.name, "SomeMod.esp");
  assert.equal(d.suspects[0]?.from, "suspected-ref");
  assert.equal(d.suspects[0]?.inLoadedPlugins, true);
  assert.equal(d.suspects[0]?.loadIndex, "FE:012");
});

test("skips core engine modules but keeps mod DLLs from the call stack", async () => {
  const parsed = crash({
    callStack: [
      { index: 0, module: "Fallout4.exe" },
      { index: 1, module: "SomePlugin.dll", function: "Update" },
    ],
  });
  const d = await correlateCrash({ parsed });
  const names = d.suspects.map((s) => s.name);
  assert.ok(!names.includes("Fallout4.exe"), "core exe excluded");
  assert.ok(names.includes("SomePlugin.dll"), "mod dll kept");
});

test("notes the skipped conflict check when no gameId is supplied", async () => {
  const d = await correlateCrash({ parsed: crash() });
  assert.ok(d.notes.some((n) => /No gameId/.test(n)));
  assert.equal(d.knownConflicts.length, 0);
});

test("includes known conflicts when a checker + gameId are given", async () => {
  const parsed = crash({
    loadedPlugins: [{ name: "A.esp" }, { name: "B.esp" }],
  });
  const checkConflicts: ConflictChecker = async (_g, modIds) => {
    assert.deepEqual(modIds, ["A.esp", "B.esp"]);
    return {
      conflicts: [
        {
          modA: "A.esp",
          modB: "B.esp",
          severity: "incompatible",
          description: "boom",
          source: "community",
        },
      ],
    };
  };
  const d = await correlateCrash({ parsed, gameId: "fallout4", checkConflicts });
  assert.equal(d.knownConflicts.length, 1);
  assert.equal(d.gameId, "fallout4");
});
