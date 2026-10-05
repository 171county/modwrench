import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correlateCrash,
  type ConflictChecker,
} from "../src/crashlog/diagnose.js";
import { parseCrashlog } from "../src/crashlog/index.js";
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

// Lines from two published logs: a Crash Logger SSE v1.11.1 log (evildarkarchon/crash-logs) whose only object is an
// armor printed under a stack slot, and NetScriptFramework's Shadowrend.txt, whose only objects are the player's own
// records (the character's name replaced). Both stood ahead of the call stack's mods as the "highest signal".
test("objects found beside a register or in stack memory, and the player's character, come after the call stack's mods", async () => {
  const sse = parseCrashlog({
    logContent: [
      "Skyrim SSE v1.6.640",
      "CrashLoggerSSE v1-11-1-0 Nov 18 2023 13:56:33",
      "",
      'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF91ADEEAB4 skee64.dll+001EAB4\tmov rbx, [rsi+rax*8+0x08]',
      "",
      "PROBABLE CALL STACK:",
      "\t[ 0] 0x7FF91ADEEAB4   skee64.dll+001EAB4",
      "\t[ 6] 0x7FF929731D32    OBody.dll+0001D32",
      "\t[10] 0x7FFA3962AA58    ntdll.dll+005AA58",
      "",
      "STACK:",
      "\t[RSP+2D0] 0x14661B77880      (TESObjectARMO*)",
      '\t\tFile: "Weapons Armor Clothing & Clutter Fixes.esp"',
      "\t\tModified by: Skyrim.esm -> Update.esm -> Weapons Armor Clothing & Clutter Fixes.esp",
      "\t\tFlags: 0x00000009 kDestructible | kInitialized",
      '\t\tName: "Roughspun Tunic"',
      '\t\tEditorID: "ClothesPrisonerTunic"',
      "\t\tFormID: 0x0003C9FE",
      "\t\tFormType: Armor (26)",
      "",
    ].join("\n"),
  });
  assert.ok(sse.ok);
  const d = await correlateCrash({ parsed: sse });
  assert.deepEqual(
    d.suspects.map((s) => [s.name, s.from, s.detail]),
    [
      ["skee64.dll", "call-stack", undefined],
      ["OBody.dll", "call-stack", undefined],
      ["Weapons Armor Clothing & Clutter Fixes.esp", "suspected-ref", "formid: 0x0003C9FE (in stack memory)"],
    ]
  );

  const nsf = parseCrashlog({
    logContent: [
      "Unhandled native exception occurred at 0x7FF71ED8D780 (SkyrimSE.exe+A0D780) on thread 16404!",
      "",
      "FrameworkName: NetScriptFramework",
      "ApplicationName: SkyrimSE.exe",
      "ApplicationVersion: 1.5.97.0",
      "",
      "Possible relevant objects (2)",
      "{",
      "  [  11]    TESNPC(Name: `Prisoner`, FormId: 00000007, File: `Skyrim Unbound.esp <- ccbgssse018-shadowrend.esl <- Skyrim.esm`)",
      "  [  11]    PlayerCharacter(FormId: 00000014, BaseForm: TESNPC(Name: `Prisoner`, FormId: 00000007, File: `Skyrim Unbound.esp <- ccbgssse018-shadowrend.esl <- Skyrim.esm`))",
      "}",
      "",
      "Probable callstack",
      "{",
      "  [0]   0x7FF71ED8D780     (SkyrimSE.exe+A0D780)          hkbClipGenerator::unk_A0D770+10",
      "  [10]  0x7FFF67D7A2C4     (TrueDirectionalMovement.dll+1A2C4)",
      "}",
    ].join("\n"),
  });
  assert.ok(nsf.ok);
  assert.deepEqual(
    (await correlateCrash({ parsed: nsf })).suspects.map((s) => [s.name, s.detail]),
    [
      ["TrueDirectionalMovement.dll", undefined],
      ["Skyrim Unbound.esp", "formid: 0x00000007 (the player's character)"],
    ]
  );
});

test("an object from the logger's own list of relevant objects still comes before the call stack's mods", async () => {
  const d = await correlateCrash({
    parsed: crash({
      callStack: [{ index: 0, module: "SomePlugin.dll" }],
      suspectedRefs: [{ type: "formid", value: "0xFE012800", likelySource: "SomeMod.esp", origin: "objects" }],
    }),
  });
  assert.deepEqual(d.suspects.map((s) => [s.name, s.detail]), [["SomeMod.esp", "formid: 0xFE012800"], ["SomePlugin.dll", undefined]]);
});
