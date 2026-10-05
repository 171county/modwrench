import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCrashlog } from "../src/crashlog/index.js";

// Lines cut from real crash logs that people published, kept as the loggers wrote them (tabs, padding, odd spacing)
// and shortened to what each test needs. Where a log came from is said above the tests that use it. Nothing personal
// was in these lines; where a log had a folder path or a player's name nearby, those lines were left out.
//
//   Buffout 4 v1.36.0 and v1.26.2: evildarkarchon/crash-logs, FO4/crash-12624.log and FO4/crash-16B95BE.log.
//   Crash Logger SSE v1.11.1: evildarkarchon/crash-logs, Skyrim/crash-2023-12-10-13-03-48.log and crash-2023-12-11-02-34-31.log.
//   NetScriptFramework v15: the example crash logs published with Phostwood's crash-analyzer (Shadowrend.txt, D6DDDA.txt,
//     JContainers.txt, "SkyrimUpscaler - Crash_2024_4_12_14-45-22.txt", "PDPerfPlugin Crash_2023_12_27_2-30-9.txt",
//     "USVFS Crash_2023_3_26_15-19-9.txt"). Only the logs are used here, nothing of the analyzer.
//   BepInEx 5.4.21: a Lethal Company modpack's LogOutput.log, and the one in Kirazake/REPO-Game-PTBR-Mod.

function parse(lines: string[]) {
  const result = parseCrashlog({ logContent: lines.join("\n") });
  assert.equal(result.ok, true);
  return result;
}

// ─── The plugin list ─────────────────────────────────────────────────────────

test("Buffout 4 v1.36: plugin rows with no space after the index are read", () => {
  const r = parse([
    "Fallout 4 v1.10.984",
    "Buffout 4 v1.36.0 Oct 13 2024 01:09:30",
    "",
    'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FFEFDE07AE3 flexRelease_x64.dll+0027AE3\trep stosb',
    "",
    "PLUGINS:",
    "\t[00]Fallout4.esm",
    "\t[01]DLCRobot.esm",
    "\t[3E]SettlementMenuManager.esp",
    "\t[FE]WET.esp",
    "",
  ]);
  assert.equal(r.detectedType, "buffout4");
  assert.deepEqual(
    r.loadedPlugins.map((p) => [p.loadIndex, p.name]),
    [
      ["00", "Fallout4.esm"],
      ["01", "DLCRobot.esm"],
      ["3E", "SettlementMenuManager.esp"],
      ["FE", "WET.esp"],
    ]
  );
  assert.equal(r.pluginList, "listed");
});

test("Buffout 4 v1.26: a PLUGINS section that holds only ERROR is a list the logger failed to write, not zero plugins", () => {
  const r = parse([
    "Fallout 4 v1.10.163",
    "Buffout 4 v1.26.2",
    "",
    'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF6F34995BE Fallout4.exe+16B95BE',
    "",
    "F4SE PLUGINS:",
    "\tXDI.dll",
    "",
    "PLUGINS:",
    "\tERROR",
  ]);
  assert.deepEqual(r.loadedPlugins, []);
  assert.equal(r.pluginList, "failed");
});

test("Crash Logger SSE: its own error line under PLUGINS (\"print_plugins:\" and the error) is a failed list too", () => {
  const r = parse(["Skyrim SSE v1.6.640", "CrashLoggerSSE v1-11-1-0 Nov 18 2023 13:56:33", "", "PLUGINS:", "\tprint_plugins:\tERROR", ""]);
  assert.equal(r.pluginList, "failed");
});

test("Crash Logger SSE: a log with no PLUGINS section has no plugin list", () => {
  const r = parse(["Skyrim SSE v1.6.640", "CrashLoggerSSE v1-11-1-0 Nov 18 2023 13:56:33", "", "PROBABLE CALL STACK:", "\t[ 0] 0x7FF916FCDAE5         skee64.dll+001DAE5", ""]);
  assert.equal(r.pluginList, "absent");
});

test("NetScriptFramework: a log with no 'Game plugins' group has no plugin list, and its own .NET plugins are not one", () => {
  const r = parse([
    "Unhandled native exception occurred at 0x7FF8327CB14F (SkyrimUpscaler.dll+9B14F) on thread 28172!",
    "",
    "FrameworkName: NetScriptFramework",
    "FrameworkVersion: 15",
    "ApplicationName: SkyrimSE.exe",
    "ApplicationVersion: 1.5.97.0",
    "",
    "Plugins (2)",
    "{",
    "  custom_skills",
    "  {",
    '    Name: "Custom Skills"',
    "    Version: 1",
    "  }",
    "}",
  ]);
  assert.deepEqual(r.loadedPlugins, []);
  assert.equal(r.pluginList, "absent");
});

test("NetScriptFramework: a 'Game plugins' group is a plugin list", () => {
  const r = parse([
    "Unhandled native exception occurred at 0x7FFDDAACAE45 (JContainers64.dll+10AE45) on thread 10564!",
    "",
    "FrameworkName: NetScriptFramework",
    "",
    "Game plugins (2)",
    "{",
    "  [00] Skyrim.esm",
    "  [FE 000] ccbgssse018-shadowrend.esl",
    "}",
  ]);
  assert.equal(r.loadedPlugins.length, 2);
  assert.equal(r.pluginList, "listed");
});

test("BepInEx: the plugins the chainloader loaded are a plugin list", () => {
  const r = parse([
    "[Message:   BepInEx] BepInEx 5.4.21.0 - Lethal Company (11/23/2023 9:01:25 PM)",
    "[Message:   BepInEx] Chainloader started",
    "[Info   :   BepInEx] 1 plugins to load",
    "[Info   :   BepInEx] Loading [MoreCompany 1.4.1]",
    "[Message:   BepInEx] Chainloader startup complete",
  ]);
  assert.equal(r.pluginList, "listed");
  // "0 plugins to load" is a list with nothing in it; a log cut off before the chainloader ran has none.
  assert.equal(parse(["[Message:   BepInEx] Chainloader started", "[Info   :   BepInEx] 0 plugins to load"]).pluginList, "listed");
  assert.equal(parse(["[Message:   BepInEx] BepInEx 5.4.21.0 - REPO (23/05/2025 20:29:54)", "[Message:   BepInEx] Preloader started"]).pluginList, "absent");
});

// ─── Frames and registers ────────────────────────────────────────────────────

test("Buffout 4 and Crash Logger SSE: a game frame keeps its Address Library id, and it is still not a function name", () => {
  const fo4 = parse([
    "Fallout 4 v1.10.163",
    "Buffout 4 v1.26.2",
    "",
    "PROBABLE CALL STACK:",
    "\t[ 0] 0x7FF6F34995BE Fallout4.exe+16B95BE -> 1242880+0x1FE",
    "\t[ 1] 0x7FF6F385B316 Fallout4.exe+1A7B316 -> 1112196+0x246",
    "\t[ 9] 0x7FFFE0F27034 KERNEL32.DLL+0017034",
    "",
  ]);
  assert.deepEqual(
    fo4.callStack.map((f) => [f.module, f.addressId]),
    [
      ["Fallout4.exe", "1242880+0x1FE"],
      ["Fallout4.exe", "1112196+0x246"],
      ["KERNEL32.DLL", undefined],
    ]
  );
  assert.equal(fo4.callStack[0]?.function, undefined);

  const sse = parse([
    "Skyrim SSE v1.6.640",
    "CrashLoggerSSE v1-11-1-0 Nov 18 2023 13:56:33",
    "",
    "PROBABLE CALL STACK:",
    "\t[ 8] 0x7FF95522892F skse64_1_6_640.dll+001892F",
    "\t[ 9] 0x7FF74CA2DD91       SkyrimSE.exe+05EDD91 -> 36588+0x21\tmov rcx, [0x00007FF74F413990]",
    "",
  ]);
  assert.equal(sse.callStack[1]?.addressId, "36588+0x21");
  assert.equal(sse.callStack[1]?.function, undefined);
  assert.equal(sse.callStack[0]?.addressId, undefined);
});

test("Buffout 4 and Crash Logger SSE: each register keeps the type the logger gave its value", () => {
  const fo4 = parse([
    "Fallout 4 v1.10.163",
    "Buffout 4 v1.26.2",
    "",
    "REGISTERS:",
    "\tRAX 0x0                (size_t)",
    "\tRBX 0x1B2FF604D20      (void*)",
    "\tR11 0x1B2AD031700      (hknpStreamContactSolver*)",
    "",
  ]);
  assert.equal(fo4.registers?.["R11"], "0x1B2AD031700");
  assert.deepEqual(fo4.registerTypes, { RAX: "size_t", RBX: "void*", R11: "hknpStreamContactSolver*" });

  const sse = parse([
    "Skyrim SSE v1.6.640",
    "CrashLoggerSSE v1-11-1-0 Nov 18 2023 13:56:33",
    "",
    "REGISTERS:",
    "\tRAX 0x2                (size_t) [2]",
    "\tRBP 0x7FF91AFB8668     (void* -> skee64.dll+01E8668\tadd [rax], al)",
    "\tR8  0x14975AB3CB0      (void*)",
    "",
  ]);
  assert.deepEqual(sse.registerTypes, { RAX: "size_t", RBP: "void*", R8: "void*" });
  // R8 and R9 are registers too: they were dropped because their names have one character after the R.
  assert.equal(sse.registers?.["R8"], "0x14975AB3CB0");
});

// ─── Objects the logger names ────────────────────────────────────────────────

const NSF_HEAD = [
  "Unhandled native exception occurred at 0x7FF71ED8D780 (SkyrimSE.exe+A0D780) on thread 16404!",
  "",
  "FrameworkName: NetScriptFramework",
  "FrameworkVersion: 15",
  "ApplicationName: SkyrimSE.exe",
  "ApplicationVersion: 1.5.97.0",
  "Time: 12 Jan 2024 01:16:38.295",
  "",
];

// In the Shadowrend log the player's character name stood where "Prisoner" is.
test("NetScriptFramework: 'Possible relevant objects' gives the form ids, kinds and plugins, the last to change it first", () => {
  const r = parse([
    ...NSF_HEAD,
    "Possible relevant objects (2)",
    "{",
    "  [  11]    TESNPC(Name: `Prisoner`, FormId: 00000007, File: `Skyrim Unbound.esp <- ccbgssse018-shadowrend.esl <- Skyrim.esm`)",
    "  [  11]    PlayerCharacter(FormId: 00000014, BaseForm: TESNPC(Name: `Prisoner`, FormId: 00000007, File: `Skyrim Unbound.esp <- ccbgssse018-shadowrend.esl <- Skyrim.esm`))",
    "}",
  ]);
  assert.deepEqual(r.suspectedRefs, [
    {
      type: "formid",
      value: "0x00000007",
      origin: "stack",
      kind: "TESNPC",
      likelySource: "Skyrim Unbound.esp",
      plugins: ["Skyrim.esm", "ccbgssse018-shadowrend.esl", "Skyrim Unbound.esp"],
    },
    // Its base record is a separate row, which the reference names as its base; the reference itself names no plugin.
    { type: "formid", value: "0x00000014", origin: "stack", kind: "PlayerCharacter", base: "0x00000007" },
  ]);
  // The player chose that name: it is left out.
  assert.doesNotMatch(JSON.stringify(r.suspectedRefs), /Prisoner/);
});

test("NetScriptFramework: objects with no form id are not forms, and an object's owner is left to its own row", () => {
  const r = parse([
    ...NSF_HEAD,
    "Possible relevant objects (5)",
    "{",
    "  [ 198]    BSLightingShaderProperty(Name: null)",
    "  [ 340]    BSMultiBoundNode(Name: `Chunk`)",
    "  [ 404]    TESObjectCONT(Name: `Large Sack`, FormId: D885F93A, File: `Skyrim Unbound.esp`)",
    "  [ 404]    TESObjectREFR(FormId: D8841320, File: `Skyrim Unbound.esp`, BaseForm: TESObjectCONT(Name: `Large Sack`, FormId: D885F93A, File: `Skyrim Unbound.esp`))",
    "  [ 411]    BSFadeNode(Name: `MiscSackLargeFlat02`, Owner: `TESObjectREFR(FormId: D8841320, File: `Skyrim Unbound.esp`, BaseForm: TESObjectCONT(Name: `Large Sack`, FormId: D885F93A, File: `Skyrim Unbound.esp`))`)",
    "}",
  ]);
  assert.deepEqual(
    (r.suspectedRefs ?? []).map((ref) => [ref.value, ref.kind, ref.name, ref.likelySource, ref.origin, ref.base]),
    [
      ["0xD885F93A", "TESObjectCONT", "Large Sack", "Skyrim Unbound.esp", "stack", undefined],
      ["0xD8841320", "TESObjectREFR", undefined, "Skyrim Unbound.esp", "stack", "0xD885F93A"],
    ]
  );
});

// NetScriptFramework's Framework/CrashLog.cs gives each object the distance from the registers it was found at: 0 or 1
// for a register, i+2 for the stack slot [SP+8*i]. The list is sorted by that alone, so it is no guess at relevance.
// The first row is from the SmoothCam log (in CX), the last from D6DDDA.txt (at [SP+C90]); the two between are the
// same row moved to either side of the line.
test("NetScriptFramework: the number before an object says whether it was in a register or on the stack", () => {
  const r = parse([
    ...NSF_HEAD,
    "Possible relevant objects (4)",
    "{",
    "  [   0]    TESNPC(Name: `Prisoner`, FormId: 00000007, File: `0_StartPlayer_Spells.esp <- Skyrim.esm`)",
    "  [   1]    TESObjectCONT(Name: `Large Sack`, FormId: D885F93A, File: `Skyrim Unbound.esp`)",
    "  [   2]    TESObjectCONT(Name: `Large Sack`, FormId: D885F93B, File: `Skyrim Unbound.esp`)",
    "  [ 404]    TESObjectREFR(FormId: D8841320, File: `Skyrim Unbound.esp`, BaseForm: TESObjectCONT(Name: `Large Sack`, FormId: D885F93A, File: `Skyrim Unbound.esp`))",
    "}",
  ]);
  assert.deepEqual(
    (r.suspectedRefs ?? []).map((ref) => [ref.value, ref.origin]),
    [
      ["0x00000007", "register"],
      ["0xD885F93A", "register"],
      ["0xD885F93B", "stack"],
      ["0xD8841320", "stack"],
    ]
  );
});

const SSE_HEAD = ["Skyrim SSE v1.6.640", "CrashLoggerSSE v1-11-1-0 Nov 18 2023 13:56:33", ""];

test("Crash Logger SSE before v1.20: objects printed under stack slots become weaker refs, once each", () => {
  const r = parse([
    ...SSE_HEAD,
    "STACK:",
    "\t[RSP+1C0] 0x1471B288368      (void*)",
    "\t[RSP+1C8] 0x1471B288100      (Character*)",
    "\t\tFlags: 0x00520508 ",
    '\t\tName: "Vampire Cattle"',
    "\t\tFormID: 0xFF00B34C",
    "\t\tFormType: ActorCharacter (62)",
    "\t\tObject Reference: ",
    "\t\tFlags: 0x00000008 kInitialized",
    '\t\tName: "Vampire Cattle"',
    "\t\tFormID: 0xFF000977",
    "\t\tFormType: NPC (43)",
    "\t\tFlags: 0x00520508 kInitialized | kMustUpdate",
    "\t\tFormID: 0xFF00B34C",
    "\t\tFormType: ActorCharacter (62)",
    "\t[RSP+1D0] 0x112E0BE826D694B3 (size_t) [1237940039285380275]",
    "\t[RSP+2C8] 0x146DB9B3580      (TESObjectARMA*)",
    '\t\tFile: "Skyrim.esm"',
    "\t\tFlags: 0x00000009 kDestructible | kInitialized",
    '\t\tEditorID: "PrisonerClothesAA"',
    "\t\tFormID: 0x0003CA03",
    "\t\tFormType: Armature (102)",
    "\t[RSP+2D0] 0x14661B77880      (TESObjectARMO*)",
    '\t\tFile: "Weapons Armor Clothing & Clutter Fixes.esp"',
    "\t\tModified by: Skyrim.esm -> Update.esm -> Weapons Armor Clothing & Clutter Fixes.esp",
    "\t\tFlags: 0x00000009 kDestructible | kInitialized",
    '\t\tName: "Roughspun Tunic"',
    '\t\tEditorID: "ClothesPrisonerTunic"',
    "\t\tFormID: 0x0003C9FE",
    "\t\tFormType: Armor (26)",
    '\t\tGetFullName: "Roughspun Tunic"',
    "\t[RSP+2D8] 0x148DC79BE80      (BSFadeNode*)",
    '\t\tName: "skeleton_female.nif"',
    '\t\tRTTIName: "BSFadeNode"',
    "",
  ]);
  assert.deepEqual(r.suspectedRefs, [
    { type: "formid", value: "0xFF00B34C", origin: "stack", kind: "ActorCharacter", name: "Vampire Cattle" },
    { type: "formid", value: "0xFF000977", origin: "stack", kind: "NPC", name: "Vampire Cattle" },
    { type: "formid", value: "0x0003CA03", origin: "stack", kind: "Armature", likelySource: "Skyrim.esm", plugins: ["Skyrim.esm"] },
    {
      type: "formid",
      value: "0x0003C9FE",
      origin: "stack",
      kind: "Armor",
      name: "Roughspun Tunic",
      likelySource: "Weapons Armor Clothing & Clutter Fixes.esp",
      plugins: ["Skyrim.esm", "Update.esm", "Weapons Armor Clothing & Clutter Fixes.esp"],
    },
  ]);
});

test("Crash Logger SSE before v1.20: an object printed under a register is marked as from a register", () => {
  // The same lines Crash Logger SSE v1.11 writes under a stack slot, here under a register, the way it prints both.
  const r = parse([
    ...SSE_HEAD,
    "REGISTERS:",
    "\tRCX 0x16EF2241C00      (TESObjectARMA*)",
    '\t\tFile: "AOS-ISC Patcher.esp"',
    "\t\tModified by: [Christine] Ida Elf Archer.esp -> AOS-ISC Patcher.esp",
    "\t\tFlags: 0x00000008 kInitialized",
    '\t\tEditorID: "00IdaElfArcherCuirass01AA"',
    "\t\tFormID: 0xFE1B880A",
    "\t\tFormType: Armature (102)",
    "\tRDX 0xA18DFF250        (void*)",
    "",
  ]);
  assert.deepEqual(r.suspectedRefs, [
    {
      type: "formid",
      value: "0xFE1B880A",
      origin: "register",
      kind: "Armature",
      likelySource: "AOS-ISC Patcher.esp",
      plugins: ["[Christine] Ida Elf Archer.esp", "AOS-ISC Patcher.esp"],
    },
  ]);
  assert.equal(r.registers?.["RCX"], "0x16EF2241C00");
});

test("Crash Logger SSE: with a relevant-objects list, objects under the stack slots are not added", () => {
  const r = parse([
    "Skyrim SSE v1.6.1170",
    "CrashLoggerSSE v1-20-1-0",
    "",
    "POSSIBLE RELEVANT OBJECTS:",
    '\tRSP+378: (BGSProjectile*) [0x0010FBEE] ("Skyrim.esm")',
    "",
    "STACK:",
    "\t[RSP+2C8] 0x146DB9B3580      (TESObjectARMA*)",
    '\t\tFile: "Skyrim.esm"',
    "\t\tFormID: 0x0003CA03",
    "\t\tFormType: Armature (102)",
    "",
  ]);
  assert.deepEqual(
    (r.suspectedRefs ?? []).map((ref) => [ref.value, ref.origin]),
    [["0x0010FBEE", "objects"]]
  );
});

test("Crash Logger SSE before v1.20: the player's own name is left out of an object", () => {
  const r = parse([
    ...SSE_HEAD,
    "STACK:",
    "\t[RSP+48 ] 0x15BE2BC30F0      (PlayerCharacter*)",
    '\t\tName: "Prisoner"',
    "\t\tFormID: 0x00000014",
    "\t\tFormType: ActorCharacter (62)",
    "",
  ]);
  assert.deepEqual(r.suspectedRefs, [{ type: "formid", value: "0x00000014", origin: "stack", kind: "ActorCharacter" }]);
});

// ─── Header facts and the module list ────────────────────────────────────────

test("NetScriptFramework: the crash time and the framework's version come from the header", () => {
  const r = parse([
    "Unhandled native exception occurred at 0x7FFDDAACAE45 (JContainers64.dll+10AE45) on thread 10564!",
    "",
    "FrameworkName: NetScriptFramework",
    "FrameworkVersion: 15",
    "FrameworkArchitecture: x64",
    "GameLibrary: SkyrimSE",
    "GameLibraryVersion: 18",
    "ApplicationName: SkyrimSE.exe",
    "ApplicationVersion: 1.5.97.0",
    "VersionInfo: Successfully loaded",
    "Time: 26 Jan 2024 23:40:39.174",
    "",
  ]);
  assert.equal(r.timestamp, "2024-01-26 23:40:39");
  assert.equal(r.loggerVersion, "NetScriptFramework v15");
  // A time in another language's month names is not guessed at.
  const other = parse(["Unhandled native exception occurred at 0x7FF71ED8D780 on thread 1!", "FrameworkName: NetScriptFramework", "Time: 26 janv. 2024 23:40:39.174"]);
  assert.equal(other.timestamp, undefined);
});

test("NetScriptFramework: the loaded modules are listed by name, without the colon it writes after each", () => {
  const r = parse([
    ...NSF_HEAD,
    "Modules",
    "{",
    "  SkyrimSE.exe:                                     0x7FF747E50000",
    "  bdhkm64.dll:                                      0x7FF8B26C0000",
    "  d3d11.dll:                                        0x180000000",
    "  d3d11.dll:                                        0x7FF8DE8A0000",
    "  usvfs_x64.dll:                                    0x7FF8966D0000",
    "}",
  ]);
  assert.deepEqual(r.modules, [
    { name: "SkyrimSE.exe", base: "0x7FF747E50000" },
    { name: "bdhkm64.dll", base: "0x7FF8B26C0000" },
    { name: "d3d11.dll", base: "0x180000000" },
    { name: "d3d11.dll", base: "0x7FF8DE8A0000" },
    { name: "usvfs_x64.dll", base: "0x7FF8966D0000" },
  ]);
});

test("Crash Logger SSE and Buffout 4: the MODULES section gives the same list", () => {
  const sse = parse([
    ...SSE_HEAD,
    "MODULES:",
    "\tXINPUT1_3.dll                                    0x000000400000",
    "\tsteam_api64.dll                                  0x00005FD90000",
    "\tShadowBoost.dll                                  0x016D039F0000",
    "",
  ]);
  assert.deepEqual(sse.modules, [
    { name: "XINPUT1_3.dll", base: "0x000000400000" },
    { name: "steam_api64.dll", base: "0x00005FD90000" },
    { name: "ShadowBoost.dll", base: "0x016D039F0000" },
  ]);
  const fo4 = parse(["Fallout 4 v1.10.984", "Buffout 4 v1.36.0 Oct 13 2024 01:09:30", "", "MODULES:", "\tFallout4.exe                       0x7FF78A5B0000", ""]);
  assert.deepEqual(fo4.modules, [{ name: "Fallout4.exe", base: "0x7FF78A5B0000" }]);
});

// ─── NetScriptFramework call stacks that are really stack memory ─────────────

// The SkyrimUpscaler log. The source-file strings in two stack slots (the mod's build folder) are cut off.
test("NetScriptFramework: a 'Probable callstack' that is the raw stack slots is marked as a scan, without impossible values", () => {
  const r = parse([
    "Unhandled native exception occurred at 0x7FF8327CB14F (SkyrimUpscaler.dll+9B14F) on thread 28172!",
    "",
    "FrameworkName: NetScriptFramework",
    "",
    "Probable callstack",
    "{",
    "  [0]   0x7FF8327CB14F     (SkyrimUpscaler.dll+9B14F)",
    "  [1]   0x1E43280D940",
    "  [2]   0xAAA3587920",
    "  [3]   0x7FF869245A01",
    "  [4]   0x1E43077ECE0",
    "  [5]   0xAAA35882A0",
    "  [6]   0xAAA35882A4",
    "  [7]   0xAAA35882B0",
    "  [8]   0x7FF604D484D8     (SkyrimSE.exe+30284D8)",
    "  [9]   0x1E4329DE190",
    "  [10]  0x4F",
    "  [11]  0x1E400000000",
    "  [12]  0x7FF83286B570     (SkyrimUpscaler.dll+13B570)",
    "  [13]  0x7FF83284AFD8     (SkyrimUpscaler.dll+11AFD8)",
    "  [14]  0x49026D0B000001D4",
    "  [15]  0x7FF83284B108     (SkyrimUpscaler.dll+11B108)",
    "  [16]  0x1",
    "}",
    "",
    "Stack",
    "{",
    "  [SP+0]    0x1E43280D940      (void*)",
    "  [SP+8]    0xAAA3587920       (char**)",
    "  [SP+10]   0x7FF869245A01     (u64):[140704892606977]",
    "  [SP+18]   0x1E43077ECE0      (void*)",
    "  [SP+20]   0xAAA35882A0       (void*)",
    "  [SP+28]   0xAAA35882A4       (void*)",
    "  [SP+30]   0xAAA35882B0       (void*)",
    "  [SP+38]   0x7FF604D484D8     (SkyrimSE.exe+30284D8) (void*)",
    "  [SP+40]   0x1E4329DE190      (void*)",
    "  [SP+48]   0x4F               (u8):[79]",
    "  [SP+50]   0x1E400000000      (void*)",
    "  [SP+58]   0x7FF83286B570     (SkyrimUpscaler.dll+13B570) (void*)",
    "  [SP+60]   0x7FF83284AFD8     (SkyrimUpscaler.dll+11AFD8) (char*)",
    "  [SP+68]   0x49026D0B000001D4 (u64):[5260887208734228948]",
    '  [SP+70]   0x7FF83284B108     (SkyrimUpscaler.dll+11B108) (char*) "hk_IDXGIFactory_CreateSwapChain"',
    "  [SP+78]   0x1                (u8):[1]",
    "  [SP+80]   0x0                (NULL)",
    "}",
  ]);
  // Where it stopped is still frame 0, as unwound.
  assert.deepEqual(r.callStack[0], { index: 0, module: "SkyrimUpscaler.dll", offset: "9B14F" });
  // 0x4F, 0x1 and 0x49026D0B000001D4 can't be where code returns to; the rest are what was in stack memory.
  assert.deepEqual(
    r.callStack.map((f) => f.index),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15]
  );
  assert.ok(r.callStack.slice(1).every((f) => f.source === "scan"));
  assert.equal(r.callStack.find((f) => f.index === 12)?.module, "SkyrimUpscaler.dll");
});

// The USVFS log: frame 0 is a jump to an address nothing is loaded at, and the unwinder went on from there.
test("NetScriptFramework: an unwound call stack stays unwound, but values that can't be return addresses go", () => {
  const r = parse([
    "Unhandled native exception occurred at 0xFFFFFF0024A48D48 on thread 22340!",
    "",
    "FrameworkName: NetScriptFramework",
    "",
    "Probable callstack",
    "{",
    "  [0]   0xFFFFFF0024A48D48",
    "  [1]   0x7FF89674C8AE     (usvfs_x64.dll+4C8AE)",
    "  [2]   0x7FF8C000049C",
    "  [3]   0x27B18B7BE60",
    "  [4]   0x27B00000000",
    "  [5]   0x1",
    "  [6]   0xBA1CEFDFD0",
    "  [7]   0x5A0058",
    "  [8]   0x27B18B7BE60",
    "  [9]   0x1",
    "  [10]  0x18015EF1E        (d3d11.dll+15EF1E)",
    "  [11]  0x18004A15F        (d3d11.dll+4A15F)",
    "}",
    "",
    "Stack",
    "{",
    "  [SP+0]    0x7FF89674C8AE     (usvfs_x64.dll+4C8AE) (void*)",
    "  [SP+8]    0xBA000000B7       (u64):[798863917239]",
    '  [SP+10]   0x7FF89680E300     (usvfs_x64.dll+10E300) (char*) "usvfs::hook_DeleteFileW"',
    "}",
  ]);
  assert.deepEqual(
    r.callStack.map((f) => f.index),
    [0, 1, 2, 3, 4, 6, 7, 8, 10, 11]
  );
  assert.ok(r.callStack.every((f) => f.source === undefined));
  assert.equal(r.callStack[1]?.module, "usvfs_x64.dll");
});

// ─── What the registers and stack say the game was handling ──────────────────

test("NetScriptFramework: game files named in stack strings are listed once each, and folder paths never", () => {
  const r = parse([
    ...NSF_HEAD,
    "Registers",
    "{",
    "  R14:      0xED156FECB0       (BSResource::anonymous_namespace::LooseFileStream**)",
    "}",
    "",
    "Stack",
    "{",
    "  [SP+118]  0x2D943F3DF30      (BSResource::anonymous_namespace::LooseFileStream*)",
    String.raw`  [SP+198]  0x2DA0E173ED8      (char*) "textures\terrain\tamriel\skyrim.dds"`,
    String.raw`  [SP+1E0]  0x2DA0E173ED8      (char*) "textures\terrain\tamriel\skyrim.dds"`,
    String.raw`  [SP+760]  0x2D97CAF52C8      (char*) "Meshes\Terrain\Tamriel\Tamriel.32.0.0.BTR"`,
    String.raw`  [SP+790]  0xED156FF398       (char*) "Meshes\Terrain\Tamriel\Tamriel.32.0.0.BTR"`,
    // Not from the log: a full path, which says where the game is installed, and what is left once ModWrench has
    // taken a folder path out.
    String.raw`  [SP+7A0]  0xED156FF3A0       (char*) "D:\Games\Skyrim Special Edition\Data\textures\sky.dds"`,
    String.raw`  [SP+7A8]  0xED156FF3A8       (char*) "REDACTED-PATH\textures\sky.dds"`,
    '  [SP+7B0]  0xED156FF3B0       (char*) "data/NetScriptFramework/Plugins/GrassControl.config.txt"',
    "}",
  ]);
  assert.deepEqual(r.assetPaths, [String.raw`textures\terrain\tamriel\skyrim.dds`, String.raw`Meshes\Terrain\Tamriel\Tamriel.32.0.0.BTR`]);
});

test("a game file string with an empty folder in it is left out: it can hold a network share glued after a folder", () => {
  // Not from a log. The redactor takes out a share at the start of a string; one after a folder name is not found as one.
  const r = parse([
    ...NSF_HEAD,
    "Stack",
    "{",
    String.raw`  [SP+198]  0x2DA0E173ED8      (char*) "textures\terrain\tamriel\skyrim.dds"`,
    String.raw`  [SP+1A0]  0x2DA0E173EE0      (char*) "textures\\NAS-HOME\Share-Private\Skyrim\sky.dds"`,
    '  [SP+1A8]  0x2DA0E173EE8      (char*) "meshes//NAS-HOME/Share-Private/rock.nif"',
    "}",
  ]);
  assert.deepEqual(r.assetPaths, [String.raw`textures\terrain\tamriel\skyrim.dds`]);
});

test("Crash Logger SSE before v1.20: game files in the stack's strings and object lines are listed too", () => {
  const r = parse([
    ...SSE_HEAD,
    "STACK:",
    "\t" + String.raw`[RSP+1E8] 0x1719EF2EDB0      (char*) "meshes\armor\yurianawench\nordbootsf.tri"`,
    '\t[RSP+1F0] 0x17300000002      (char*) "3"',
    "\t[RSP+2D8] 0x148DC79BE80      (BSFadeNode*)",
    '\t\tName: "skeleton_female.nif"',
    '\t\tRTTIName: "BSFadeNode"',
    "\t[RSP+368] 0x16EF2241C00      (TESObjectARMA*)",
    '\t\tFile: "AOS-ISC Patcher.esp"',
    "\t\tFormID: 0xFE1B880A",
    "\t\tFormType: Armature (102)",
    "",
  ]);
  assert.deepEqual(r.assetPaths, [String.raw`meshes\armor\yurianawench\nordbootsf.tri`, "skeleton_female.nif", "AOS-ISC Patcher.esp"]);
});

test("NetScriptFramework: the Papyrus functions on the stack are named, script and function, once each", () => {
  const r = parse([
    ...NSF_HEAD,
    "Stack",
    "{",
    "  [SP+4C8]  0x14584E0700       (BSScript::Internal::ScriptFunction*) -> (File: JValue.psc, Type: JValue, Name: GotoState)",
    "  [SP+A98]  0x8627F5C0         (BSScript::Internal::CodeTasklet**) -> (Function: BSScript::Internal::ScriptFunction(File: empdqfbhivdffaoslryamit, Type: metaSkillMenuScript, Name: load_data))",
    "  [SP+C48]  0x8627A580         (BSScript::NativeFunction2<Actor, bool, SpellItem*, bool>**) -> (File: <native>, Type: Actor, Name: AddSpell)",
    "  [SP+C70]  0x20E225C00        (BSScript::NativeFunction2<Actor, bool, SpellItem*, bool>*) -> (File: <native>, Type: Actor, Name: AddSpell)",
    "}",
  ]);
  assert.deepEqual(r.papyrus, [
    { script: "JValue", function: "GotoState" },
    { script: "metaSkillMenuScript", function: "load_data" },
    { script: "Actor", function: "AddSpell", native: true },
  ]);
});

// ─── BepInEx: versions, and whether the last error stopped anything ──────────

const LETHAL = [
  "[Message:   BepInEx] BepInEx 5.4.21.0 - Lethal Company (11/23/2023 9:01:25 PM)",
  "[Info   :   BepInEx] Running under Unity v2022.3.9.15351836",
  "[Message:   BepInEx] Chainloader started",
  "[Info   :   BepInEx] 1 plugins to load",
  "[Info   :   BepInEx] Loading [MoreCompany 1.4.1]",
  "[Info   :MoreCompany] Loaded cosmetic: builtin.denimhat from bundle: ",
  "[Message:   BepInEx] Chainloader startup complete",
  "[Info   : Unity Log] subcribing to steam callbacks",
  "[Error  : Unity Log] NullReferenceException: Object reference not set to an instance of an object",
  "Stack trace:",
  "MoreCompany.MenuManagerLogoOverridePatch.Postfix (MenuManager __instance) (at <d5bf177559dc4b70b9f919f46304d515>:0)",
  "(wrapper dynamic-method) MenuManager.DMD<MenuManager::Awake>(MenuManager)",
  "",
  "[Info   : Unity Log] Changing gamma",
  "[Info   : Unity Log] [Dissonance:Core] (02:55:08.275) DissonanceComms: Starting Dissonance Voice Comms (8.0.4)",
  "- Network: [DissonanceSetup (Dissonance.Integrations.Unity_NFGO.NfgoCommsNetwork)]",
  "[Info   : Unity Log] [Netcode] ShutdownInternal",
  "[Info   : Unity Log] Leaving current lobby",
  "[Info   : Unity Log] unsubscribing from steam callbacks",
];

test("BepInEx: the loader's version and each plugin's version are kept", () => {
  const r = parse(LETHAL);
  assert.equal(r.loggerVersion, "BepInEx 5.4.21.0");
  assert.deepEqual(r.loadedPlugins, [{ name: "MoreCompany", version: "1.4.1" }]);
  // The date on BepInEx's first line is when the game's executable was last written, not when the log was: it is not read.
  assert.equal(r.timestamp, undefined);
});

test("BepInEx: a real exception is marked as one, with how much the log went on after it", () => {
  const r = parse(LETHAL);
  assert.equal(r.exception.type, "NullReferenceException");
  assert.deepEqual(r.lastError, { exception: true, entriesAfter: 5 });
});

// The R.E.P.O. log: errors, but no exception anywhere, and the session went on to its end. (Its last lines name the
// player's Windows account in a save path; that line is left out here.)
test("BepInEx: an error that is not an exception is marked as not one", () => {
  const r = parse([
    "[Message:   BepInEx] BepInEx 5.4.21.0 - REPO (23/05/2025 20:29:54)",
    "[Info   :   BepInEx] 1 plugins to load",
    "[Info   :   BepInEx] Loading [REPO_Translator 1.0]",
    "[Error  :REPO_Translator] WARNING: YOU HAVE ENABLED DEVMODE TRANSLATOR, DO NOT EDIT THE TRANSLATE FILE BEFORE TURNING OFF THE GAME!!!!",
    "[Message:   BepInEx] Chainloader startup complete",
    "[Error  : Unity Log] Material 'TextMeshPro/Mobile/Distance Field (Instance)' with Shader 'TextMeshPro/Mobile/Distance Field' doesn't have a color property '_GlowColor'",
    "[Info   : Unity Log] Changed level to: Level - Arctic",
    "[Error  : Unity Log] Material 'TextMeshPro/Mobile/Distance Field (Instance)' with Shader 'TextMeshPro/Mobile/Distance Field' doesn't have a color property '_GlowColor'",
    "[Info   : Unity Log] Cancelling Steam Auth Ticket...",
    "[Info   : Unity Log] [2025-05-24T15:52:22] [Info] [PunVoiceClient] [PunVoiceClient(Clone)] PunVoiceClient singleton instance is being reset because destroyed.",
  ]);
  assert.equal(r.exception.type, undefined);
  assert.deepEqual(r.callStack, []);
  assert.deepEqual(r.lastError, { exception: false, entriesAfter: 2 });
  assert.deepEqual(r.loadedPlugins, [{ name: "REPO_Translator", version: "1.0" }]);
});

test("BepInEx: a log with no error has no last error", () => {
  const r = parse(["[Message:   BepInEx] BepInEx 5.4.21.0 - REPO (23/05/2025 20:29:54)", "[Info   :   BepInEx] 0 plugins to load"]);
  assert.equal(r.lastError, undefined);
});
