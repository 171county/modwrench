import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseCrashlog } from "../src/crashlog/index.js";
import { detectCrashlogType } from "../src/crashlog/detect.js";
import { namespaceRoot } from "../src/crashlog/bepinex.js";

// The fixtures here are laid out the way the loggers' own source writes them (Crash Logger SSE's
// CrashHandler.cpp, Analysis.cpp and CommonHeader.cpp; BepInEx's BaseChainloader.cs), which differs from
// the smaller samples the first parser tests used: frame numbers are padded, module names are right-aligned,
// light plugins use a colon, and the call stack can be the newer "hybrid" one. Mod names are invented, except in
// the fixtures cut from real logs, which say so where they are used.

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(resolve(HERE, "fixtures", name), "utf8");

function parse(text: string) {
  const result = parseCrashlog({ logContent: text });
  assert.equal(result.ok, true);
  return result;
}

// ─── Crash Logger SSE, as written by its own code ────────────────────────────

test("real SSE layout: header, time and exception", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  assert.equal(r.detectedType, "crashlogger-sse");
  assert.equal(r.gameVersion, "Skyrim SSE v1.6.1170");
  assert.match(r.loggerVersion ?? "", /^CrashLoggerSSE v1\.20\.0/);
  assert.equal(r.timestamp, "2026-10-01 21:14:03");
  assert.equal(r.exception.type, "EXCEPTION_ACCESS_VIOLATION");
  assert.equal(r.exception.address, "0x7FF6D0B6E1C0");
});

test("real SSE layout: the memory the access violation touched", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  assert.deepEqual(r.exception.fault, { access: "read", address: "0x000000000008" });
});

test("real SSE layout: padded frame numbers and right-aligned module names parse", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  assert.equal(r.callStack.length, 12);
  assert.deepEqual(
    r.callStack.slice(0, 2).map((f) => [f.index, f.module, f.offset]),
    [
      [0, "SkyrimSE.exe", "10EE1C0"],
      [1, "SkyrimSE.exe", "00AA92B"],
    ]
  );
  assert.equal(r.callStack[11]?.index, 11);
});

test("real SSE layout: a symbol after the disassembly is the function; disassembly alone is not", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  const mod = r.callStack[3];
  assert.equal(mod?.module, "CloakAndDaggerFix.dll");
  assert.equal(mod?.function, "CloakAndDaggerFix::Hooks::OnEquip");
  // "mov rax, qword ptr [rcx+0x8]" is not a name.
  assert.equal(r.callStack[0]?.function, undefined);
  assert.equal(r.callStack[8]?.function, undefined);
});

test("real SSE layout: frames found by scanning stack memory are marked", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  const scanned = r.callStack.filter((f) => f.source === "scan").map((f) => f.index);
  assert.deepEqual(scanned, [8, 9, 10, 11]);
  assert.equal(r.callStack[7]?.source, undefined);
});

test("real SSE layout: a frame with no module is kept, so frame numbers stay in step", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  assert.equal(r.callStack[10]?.module, "(unknown)");
  assert.equal(r.callStack[10]?.index, 10);
});

test("real SSE layout: the call stack heading is found under its newer name", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  assert.ok(r.rawSections["PROBABLE CALL STACK"]);
  assert.match(r.rawSections["PROBABLE CALL STACK"] ?? "", /CloakAndDaggerFix/);
  // The call stack's rows must not be swallowed by the section before it.
  assert.doesNotMatch(r.rawSections["SYSTEM SPECS"] ?? "", /0x7FF6D0B6E1C0/);
});

test("real SSE layout: light plugins with a colon and regular ones both parse", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  assert.equal(r.loadedPlugins.length, 8);
  const light = r.loadedPlugins.find((p) => p.name === "Tiny Tweak.esl");
  assert.equal(light?.loadIndex, "FE:000");
  const regular = r.loadedPlugins.find((p) => p.name === "Cloak and Dagger.esp");
  assert.equal(regular?.loadIndex, "05");
});

test("real SSE layout: relevant objects keep the plugin out of the brackets, without the bracket", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  const sources = (r.suspectedRefs ?? []).map((ref) => ref.likelySource);
  assert.ok(sources.includes("Skyrim.esm"));
  assert.ok(sources.includes("Cloak and Dagger.esp"));
  assert.ok(sources.includes("HearthFires.esm"));
  for (const source of sources) assert.ok(!source?.startsWith("("), `unexpected leading bracket in ${source}`);
  const form = (r.suspectedRefs ?? []).find((ref) => ref.value === "0x00BD3F21");
  assert.equal(form?.likelySource, "Cloak and Dagger.esp");
});

test("real SSE layout: lines that name no plugin (a native function, a script) yield no object", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  assert.equal((r.suspectedRefs ?? []).length, 4);
});

test("real SSE layout: other sections stay available as raw text", () => {
  const r = parse(fixture("crash-sse-real-format.log"));
  assert.match(r.rawSections["SKSE PLUGINS"] ?? "", /CloakAndDaggerFix\.dll v1\.4\.2/);
  assert.match(r.rawSections["SYSTEM SPECS"] ?? "", /PHYSICAL MEMORY: 14\.20 GB\/31\.92 GB/);
  assert.match(r.rawSections["SYSTEM SPECS"] ?? "", /GPU MEMORY: 6\.20\/7\.40 GB/);
});

test("older heading: PROBABLE CALL STACK with padded numbers and no tags", () => {
  const text = [
    "Skyrim SSE v1.6.640.0",
    "CrashLoggerSSE v1-12-1",
    'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF7B3D2A3F0 SkyrimSE.exe+1AA3A3F0',
    "",
    "PROBABLE CALL STACK:",
    "\t[ 0] 0x7FF7B3D2A3F0 SkyrimSE.exe+1AA3A3F0 -> 36517+0x28\tmov rax, [rcx]",
    "\t[ 1] 0x7FFF12345678 SomeMod.dll+0012345 -> 1",
    "\t[10] 0x7FFF12345679 ntdll.dll+0000042",
    "",
  ].join("\n");
  const r = parse(text);
  assert.equal(r.callStack.length, 3);
  assert.equal(r.callStack[1]?.module, "SomeMod.dll");
  assert.equal(r.callStack[1]?.offset, "0012345");
  assert.equal(r.callStack[2]?.index, 10);
  // "-> 36517+0x28" is an Address Library id, not a name.
  assert.equal(r.callStack[0]?.function, undefined);
});

test("thread dumps and unrelated lines do not make frames", () => {
  const text = ["Skyrim SSE v1.6.1170", "CrashLoggerSSE v1.20.0", "", "PROBABLE CALL STACK:", "\tWARNING: Stack trace capture failed.", ""].join("\n");
  const r = parse(text);
  assert.equal(r.callStack.length, 0);
});

// A real Crash Logger SSE v1.20.1 log from a public GitHub issue (tiltedphoques/TiltedEvolution#863), cut down, with
// the install folder and the player character's name replaced. Since v1.20 the plugin is quoted inside the brackets.
test("Crash Logger SSE v1.20+: a quoted plugin name is read without its quotes and brackets", () => {
  const r = parse(fixture("crash-sse-v1-20-quoted.log"));
  assert.equal(r.detectedType, "crashlogger-sse");
  assert.deepEqual(
    (r.suspectedRefs ?? []).map((ref) => [ref.value, ref.likelySource]),
    [
      ["0x00000014", "Reduce Player Stat Offsets.esp"],
      ["0x001059DD", "Skyrim.esm"],
      ["0x001059DD", "Skyrim.esm"],
      ["0x001059DD", "Skyrim.esm"],
    ]
  );
});

test("Crash Logger SSE: the quoted rows of later versions and the older unquoted row all give the plugin", () => {
  const text = [
    "Skyrim SSE v1.5.97",
    "CrashLoggerSSE v1-22-0-0 May  2 2026 06:34:15",
    "",
    "POSSIBLE RELEVANT OBJECTS:",
    // v1.22 and later put the name and flags after it (Seb263/SkyrimSE_ModBugReports#51).
    '\tR14: (EffectSetting*) "Tonitrus" [0xFE01E808] ("StormCalling.esl") "Tonitrus" {kDualValueModifier}',
    '\tRSP+378: (BGSProjectile*) [0x0010FBEE] ("Skyrim.esm")',
    '\tRSP+418: (FormID 0x14 -> PlayerCharacter* 0x1A73F896080) "Hero" [0x00000014] ("Some (Odd) Name.esp")',
    '\tRBX: TESForm: "Iron Sword" [0x00012EB7] (Older Shape.esp)',
    "",
  ].join("\n");
  const r = parse(text);
  assert.deepEqual(
    (r.suspectedRefs ?? []).map((ref) => [ref.value, ref.likelySource]),
    [
      ["0xFE01E808", "StormCalling.esl"],
      ["0x0010FBEE", "Skyrim.esm"],
      ["0x00000014", "Some (Odd) Name.esp"],
      ["0x00012EB7", "Older Shape.esp"],
    ]
  );
});

test("a 12-digit address is not mistaken for a FormID with its tail cut off", () => {
  const text = [
    "Skyrim SSE v1.6.1170",
    "CrashLoggerSSE v1.20.0",
    "",
    "POSSIBLE RELEVANT OBJECTS:",
    "\tRBX: 0x7FF6D0B6E1C0 SomeThing.esp",
    "",
  ].join("\n");
  const r = parse(text);
  assert.equal((r.suspectedRefs ?? []).filter((ref) => ref.type === "formid" && ref.value === "0x7FF6D0B6").length, 0);
});

// ─── NetScriptFramework ──────────────────────────────────────────────────────

// A real NetScriptFramework log from a public GitHub issue (mwilsnd/SkyrimSE-SmoothCam#69), cut down (the Registers,
// Stack, Modules and Game plugins groups are shortened) with the character's name and a personal plugin's name
// replaced. Its layout is the one Framework/CrashLog.cs writes.

test("NetScriptFramework (real layout): detected from its own header", () => {
  const text = fixture("crash-netscriptframework-real-format.log");
  assert.equal(detectCrashlogType(text), "netscriptframework");
  assert.equal(detectCrashlogType("Unhandled native exception occurred at 0x7FF6756DF5E2 on thread 1!\n"), "netscriptframework");
});

test("NetScriptFramework (real layout): where it happened, the game, and the frames with their modules", () => {
  const r = parse(fixture("crash-netscriptframework-real-format.log"));
  assert.equal(r.detectedType, "netscriptframework");
  assert.equal(r.gameVersion, "SkyrimSE.exe v1.5.97.0");
  assert.equal(r.exception.address, "0x7FF6756DF5E2");
  assert.equal(r.exception.type, undefined, "a native crash log names no exception code");
  assert.match(r.exception.description ?? "", /^Unhandled native exception occurred at 0x7FF6756DF5E2 \(SkyrimSE\.exe\+84F5E2\)/);
  assert.equal(r.callStack.length, 14);
  assert.deepEqual(r.callStack[0], { index: 0, module: "SkyrimSE.exe", offset: "84F5E2", function: "ThirdPersonState::Update_84F490+152" });
  assert.deepEqual(r.callStack[1], { index: 1, module: "SmoothCam.dll", offset: "9EAEE" });
  // A row with no module keeps its place.
  assert.deepEqual(r.callStack[2], { index: 2, module: "(unknown)" });
  assert.equal(r.callStack[9]?.module, "VCRUNTIME140.dll");
  assert.equal(r.callStack[13]?.index, 13);
});

test("NetScriptFramework (real layout): the game's plugins with their indexes, and not the framework's own plugins", () => {
  const r = parse(fixture("crash-netscriptframework-real-format.log"));
  assert.equal(r.loadedPlugins.length, 25);
  assert.deepEqual(r.loadedPlugins[0], { loadIndex: "00", name: "Skyrim.esm" });
  assert.deepEqual(r.loadedPlugins.find((p) => p.name === "SmoothCam.esl"), { loadIndex: "FE 000", name: "SmoothCam.esl" });
  assert.ok(!r.loadedPlugins.some((p) => /custom_skills|Custom Skills/.test(p.name)));
  assert.match(r.rawSections["Modules"] ?? "", /SmoothCam\.dll/);
  assert.match(r.rawSections["Plugins"] ?? "", /Custom Skills/);
});

test("NetScriptFramework: module and offset come apart, with frame numbers", () => {
  const r = parse(fixture("crash-netscriptframework.log"));
  assert.deepEqual(
    r.callStack.map((f) => [f.index, f.module, f.offset]),
    [
      [0, "SkyrimSE.exe", "1AA3A3F0"],
      [1, "SkyrimSE.exe", "1AA3B1A0"],
      [2, "SomeMod.dll", "12345"],
    ]
  );
});

// ─── BepInEx ─────────────────────────────────────────────────────────────────

test("BepInEx: namespaceRoot reads the shapes Mono and Unity print", () => {
  assert.equal(namespaceRoot("LethalConfig.ConfigEntries.SyncAll ()"), "LethalConfig");
  assert.equal(namespaceRoot("System.Collections.Generic.Dictionary`2.Enumerator.MoveNext ()"), "System");
  assert.equal(namespaceRoot("Object UnityEngine.Object.Instantiate(Object original, Transform parent)"), "UnityEngine");
  assert.equal(namespaceRoot("(wrapper dynamic-method) HUDManager.DMD<HUDManager::AddChatMessage>(HUDManager,string,int)"), "HUDManager");
  assert.equal(namespaceRoot("UnityEngine.Debug:LogException(Exception)"), "UnityEngine");
  assert.equal(namespaceRoot("ghostCodes.NetHandler.AlarmLightsClientRpc (System.Boolean normalLights) (at ./x.cs:99)"), "ghostCodes");
  assert.equal(namespaceRoot("just some words"), undefined);
});

test("BepInEx: Unity-style traces (no 'at') give the call stack of the latest error", () => {
  const r = parse(fixture("LogOutput-real-format.log"));
  assert.equal(r.detectedType, "bepinex");
  assert.equal(r.exception.type, "IndexOutOfRangeException");
  assert.deepEqual(
    r.callStack.map((f) => f.module),
    ["HUDManager", "LethalConfig", "HUDManager", "UnityEngine", "UnityEngine", "BetterEmotes"]
  );
  // The inner-exception marker is not a frame, and the file position is not part of the function.
  assert.ok(!r.callStack.some((f) => /Rethrow/.test(f.function ?? "")));
  assert.equal(r.callStack[1]?.function, "LethalConfig.UI.ConfigMenu.Refresh ()");
});

test("BepInEx: classic 'at' traces still parse, without the IL offset in the function", () => {
  const r = parse(fixture("LogOutput.log"));
  const frame = r.callStack.find((f) => f.module === "LethalConfig");
  assert.equal(frame?.function, "LethalConfig.ConfigEntries.SyncAll ()");
});

test("BepInEx: earlier errors stay in the raw sections", () => {
  const r = parse(fixture("LogOutput-real-format.log"));
  assert.match(r.rawSections["earlier_fatal_events"] ?? "", /NullReferenceException/);
});
