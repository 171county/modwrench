import { test } from "node:test";
import assert from "node:assert/strict";
import type { CallStackFrame, CrashlogParseResult } from "../src/crashlog/types.js";
import {
  POSSIBLE_AT,
  STRONG_AT,
  cleanFunction,
  frameKind,
  leadKey,
  rankLeads,
  rankWithKeys,
  toFrame,
  type InstallNote,
} from "../src/crashwhisper/rank.js";

// Each rule in the scoring table gets a test of its own, with a log built to trigger that rule and
// no other, so a change to one number shows up as one failing test with a name that says which.

const parsedWith = (over: Partial<CrashlogParseResult> = {}): CrashlogParseResult => ({
  detectedType: "crashlogger-sse",
  exception: { type: "EXCEPTION_ACCESS_VIOLATION" },
  callStack: [],
  loadedPlugins: [],
  rawSections: {},
  ...over,
});

const frames = (...modules: string[]): CallStackFrame[] => modules.map((module, index) => ({ index, module }));
const game = (n: number): string[] => Array.from({ length: n }, () => "SkyrimSE.exe");
const only = (log: CrashlogParseResult, name?: string) => {
  const leads = rankLeads(log);
  const lead = name ? leads.find((l) => l.name === name) : leads[0];
  assert.ok(lead, `no lead${name ? ` named ${name}` : ""} in ${JSON.stringify(leads.map((l) => l.name))}`);
  return lead;
};

// ─── The call stack ──────────────────────────────────────────────────────────

test("the thresholds are the ones the documentation states", () => {
  assert.equal(STRONG_AT, 75);
  assert.equal(POSSIBLE_AT, 35);
});

test("a mod's code at the top of the stack is where the game stopped: +80, strong", () => {
  const lead = only(parsedWith({ callStack: frames("SomeMod.dll", "SkyrimSE.exe") }));
  assert.equal(lead.score, 80);
  assert.equal(lead.strength, "strong");
  assert.match(lead.evidence[0]!.text, /stopped inside SomeMod\.dll/);
  assert.equal(lead.evidence[0]!.basis, "log");
});

test("the first mod code near the top of the stack: +40, possible", () => {
  const lead = only(parsedWith({ callStack: frames(...game(2), "SomeMod.dll") }));
  assert.equal(lead.score, 40);
  assert.equal(lead.strength, "possible");
  assert.match(lead.evidence[0]!.text, /first mod code on the call stack \(frame 2\), right underneath the game's own code/);
});

test("the first mod code deep in the stack: +25, faint", () => {
  const lead = only(parsedWith({ callStack: frames(...game(6), "SomeMod.dll") }));
  assert.equal(lead.score, 25);
  assert.equal(lead.strength, "faint");
});

test("other mod code below the first: +15 within ten frames, +5 beyond", () => {
  const near = rankLeads(parsedWith({ callStack: frames("SkyrimSE.exe", "ModA.dll", "ModB.dll") }));
  assert.deepEqual(near.map((l) => [l.name, l.score]), [["ModA.dll", 40], ["ModB.dll", 15]]);
  assert.match(near[1]!.evidence[0]!.text, /below other mod code/);
  const far = rankLeads(parsedWith({ callStack: frames("SkyrimSE.exe", "ModA.dll", ...game(10), "ModB.dll") }));
  assert.equal(far.find((l) => l.name === "ModB.dll")?.score, 5);
});

test("only the first mod's one-line summary calls it the first mod code; one below another says so", () => {
  const leads = rankLeads(parsedWith({ callStack: frames("SkyrimSE.exe", "ModA.dll", "ModB.dll") }));
  assert.equal(leads.find((l) => l.name === "ModA.dll")?.summary, "The first mod code on the call stack.");
  const below = leads.find((l) => l.name === "ModB.dll")?.summary ?? "";
  assert.doesNotMatch(below, /first mod code/);
  assert.match(below, /below other mod code/);
});

test("each further frame of the same mod adds 5, up to 15", () => {
  const three = only(parsedWith({ callStack: frames("SkyrimSE.exe", "SomeMod.dll", "SomeMod.dll", "SomeMod.dll") }));
  assert.equal(three.score, 40 + 10);
  const many = only(parsedWith({ callStack: frames("SkyrimSE.exe", ...Array.from({ length: 9 }, () => "SomeMod.dll")) }));
  assert.equal(many.score, 40 + 15);
  assert.ok(many.evidence.some((e) => /shows up in 9 frames/.test(e.text)));
});

test("frames found by scanning stack memory are weak: +8, and never 'the first mod code'", () => {
  const stack: CallStackFrame[] = [
    { index: 0, module: "SkyrimSE.exe" },
    { index: 1, module: "RealMod.dll" },
    { index: 2, module: "Leftover.dll", source: "scan" },
  ];
  const leads = rankLeads(parsedWith({ callStack: stack }));
  assert.equal(leads.find((l) => l.name === "RealMod.dll")?.score, 40);
  const scanned = leads.find((l) => l.name === "Leftover.dll");
  assert.equal(scanned?.score, 8);
  assert.equal(scanned?.strength, "faint");
  assert.match(scanned!.evidence[0]!.text, /scans the stack's raw memory/);
});

test("a scan frame in front of the unwound frames doesn't steal 'first mod code'", () => {
  const stack: CallStackFrame[] = [
    { index: 0, module: "SkyrimSE.exe" },
    { index: 1, module: "Leftover.dll", source: "scan" },
    { index: 2, module: "RealMod.dll" },
  ];
  const leads = rankLeads(parsedWith({ callStack: stack }));
  assert.equal(leads.find((l) => l.name === "RealMod.dll")?.score, 40);
});

test("modules that are the game, Windows, the graphics layer, overlays and the script extender never become leads", () => {
  const log = parsedWith({
    callStack: frames(
      "SkyrimSE.exe",
      "skse64_1_6_1170.dll",
      "KERNEL32.DLL",
      "ntdll.dll",
      "d3d11.dll",
      "nvwgf2umx.dll",
      "GameOverlayRenderer64.dll",
      "(unknown)"
    ),
  });
  assert.deepEqual(rankLeads(log), []);
});

test("a C runtime where the game stopped is no lead, and a Windows library doesn't take a mod's 'first mod code' place", () => {
  // Fallout 4's own C runtime at the top of a Buffout 4 stack.
  assert.deepEqual(rankLeads(parsedWith({ detectedType: "buffout4", callStack: frames("MSVCR110.dll", "Fallout4.exe") })), []);
  const lead = only(parsedWith({ callStack: frames("SkyrimSE.exe", "AudioSes.dll", "RealMod.dll") }));
  assert.equal(lead.name, "RealMod.dll");
  assert.equal(lead.score, 40);
  assert.equal(lead.strength, "possible");
});

test("a module with an offset attached is read by its name", () => {
  const lead = only(parsedWith({ callStack: [{ index: 0, module: "SomeMod.dll+0003A41" }] }));
  assert.equal(lead.name, "SomeMod.dll");
  assert.deepEqual(lead.files, ["SomeMod.dll"]);
});

test("the function running is quoted, and the IL offset Mono adds is left off", () => {
  const stack: CallStackFrame[] = [
    { index: 0, module: "SkyrimSE.exe" },
    { index: 1, module: "SomeMod.dll", function: "SomeMod::Hooks::OnEquip" },
  ];
  assert.ok(only(parsedWith({ callStack: stack })).evidence.some((e) => /is SomeMod::Hooks::OnEquip\./.test(e.text)));
  assert.equal(cleanFunction("Foo.Bar.Baz () [0x00012] in <hash>:0"), "Foo.Bar.Baz ()");
  assert.equal(cleanFunction("x".repeat(200), 20).length, 20);
  assert.ok(cleanFunction("x".repeat(200), 20).endsWith("…"));
});

// ─── The objects the logger lists ────────────────────────────────────────────

const objects = (...sources: string[]) =>
  sources.map((likelySource, i) => ({ type: "formid", value: `0x00${(0x1000 + i).toString(16).toUpperCase().padStart(6, "0")}`, likelySource }));

test("an object from a plugin among those involved: +35, and +5 for each more, up to +15", () => {
  const one = only(parsedWith({ suspectedRefs: objects("Cool Mod.esp") }));
  assert.equal(one.score, 35);
  assert.equal(one.strength, "possible");
  assert.match(one.evidence[0]!.text, /lists an object from Cool Mod\.esp among those involved/);
  assert.match(one.evidence[0]!.text, /logger's own guess/);
  assert.equal(only(parsedWith({ suspectedRefs: objects("Cool Mod.esp", "Cool Mod.esp") })).score, 40);
  assert.equal(only(parsedWith({ suspectedRefs: objects(...Array.from({ length: 9 }, () => "Cool Mod.esp")) })).score, 35 + 15);
});

test("the game's own plugins are in every log and never become leads", () => {
  const log = parsedWith({ suspectedRefs: objects("Skyrim.esm", "Update.esm", "Dawnguard.esm", "ccBGSSSE001-Fish.esm", "Fallout4.esm") });
  assert.deepEqual(rankLeads(log), []);
});

test("an object with no plugin named gives no lead", () => {
  assert.deepEqual(rankLeads(parsedWith({ suspectedRefs: [{ type: "formid", value: "0x00012345" }] })), []);
});

// ─── One mod, two files ──────────────────────────────────────────────────────

test("a DLL and a plugin whose names begin the same way are one lead: +20, labelled a guess", () => {
  const log = parsedWith({
    callStack: frames("SkyrimSE.exe", "SkyrimSE.exe", "CitiesOfTheNorth.dll"),
    suspectedRefs: objects("Cities of the North - Whiterun.esp"),
  });
  const leads = rankLeads(log);
  assert.equal(leads.length, 1);
  const lead = leads[0]!;
  assert.equal(lead.name, "CitiesOfTheNorth.dll");
  assert.deepEqual(lead.files, ["CitiesOfTheNorth.dll", "Cities of the North - Whiterun.esp"]);
  assert.equal(lead.score, 40 + 35 + 20);
  const match = lead.evidence.find((e) => /share a name/.test(e.text));
  assert.equal(match?.basis, "guess");
  assert.match(match!.text, /name match, not proof/);
});

test("short names don't pair up by accident", () => {
  const log = parsedWith({ callStack: frames("SkyrimSE.exe", "Fix.dll"), suspectedRefs: objects("Fix Patch.esp") });
  assert.deepEqual(rankLeads(log).map((l) => l.name).sort(), ["Fix Patch.esp", "Fix.dll"]);
});

test("the merged lead answers to both spellings, so another log's lead can be matched to it", () => {
  const log = parsedWith({
    callStack: frames("SkyrimSE.exe", "CitiesOfTheNorth.dll"),
    suspectedRefs: objects("Cities of the North - Whiterun.esp"),
  });
  const [entry] = rankWithKeys(log);
  assert.ok(entry!.keys.includes("citiesofthenorth"));
  assert.ok(entry!.keys.includes("citiesofthenorthwhiterun"));
});

test("leadKey: two spellings of one mod reduce to the same key", () => {
  assert.equal(leadKey("JKs Whiterun Outskirts.esp"), "jkswhiterunoutskirts");
  assert.equal(leadKey("JKsWhiterunOutskirts.dll"), "jkswhiterunoutskirts");
  assert.equal(leadKey("SomeMod.dll+12345"), "somemod");
});

// ─── The C++ exception ───────────────────────────────────────────────────────

test("a C++ exception thrown from a mod's code: +60", () => {
  const log = parsedWith({ callStack: frames(...game(6)) });
  const [lead] = rankLeads(log, { thrownBy: "SomeMod.dll" });
  assert.equal(lead?.score, 60);
  assert.match(lead!.evidence[0]!.text, /thrown from SomeMod\.dll's code/);
});

test("a C++ exception thrown from the game or Windows blames no mod", () => {
  assert.deepEqual(rankLeads(parsedWith(), { thrownBy: "KERNELBASE.dll" }), []);
  assert.deepEqual(rankLeads(parsedWith(), { thrownBy: "SkyrimSE.exe+10EE1C0" }), []);
});

// ─── BepInEx ─────────────────────────────────────────────────────────────────

const bepinex = (over: Partial<CrashlogParseResult> = {}): CrashlogParseResult =>
  parsedWith({
    detectedType: "bepinex",
    exception: { type: "NullReferenceException", description: "Error:Unity Log: NullReferenceException: x" },
    loadedPlugins: [{ name: "MoreCompany" }, { name: "LethalConfig" }],
    ...over,
  });

test("BepInEx: a namespace on the stack counts only when it is one of the mods that loaded", () => {
  const log = bepinex({ callStack: frames("HUDManager", "MoreCompany", "UnityEngine", "Mystery") });
  const leads = rankLeads(log);
  assert.deepEqual(leads.map((l) => l.name), ["MoreCompany"]);
  assert.equal(leads[0]!.score, 40);
});

test("BepInEx: a plugin whose name differs in spacing from its namespace is still matched", () => {
  const log = bepinex({ loadedPlugins: [{ name: "More Company" }], callStack: frames("HUDManager", "MoreCompany") });
  const [lead] = rankLeads(log);
  assert.equal(lead?.name, "More Company");
});

test("BepInEx: a game class whose name begins a mod's name is not that mod's code", () => {
  // Lethal Company's own Terminal class and the DunGen library it uses, beside the mods "Terminal Api" and DunGenPlus.
  const plugins = [{ name: "Terminal Api" }, { name: "DunGenPlus" }];
  assert.deepEqual(rankLeads(bepinex({ loadedPlugins: plugins, callStack: frames("Terminal", "DunGen", "UnityEngine") })), []);
  assert.equal(frameKind("Terminal", plugins), "unknown");
  // The mods' own namespaces still are.
  const own = rankLeads(bepinex({ loadedPlugins: plugins, callStack: frames("TerminalApi", "DunGenPlus") }));
  assert.deepEqual(own.map((l) => l.name), ["Terminal Api", "DunGenPlus"]);
});

test("BepInEx: the top frame is where a logged error was thrown, not where the game stopped", () => {
  const [lead] = rankLeads(bepinex({ callStack: frames("MoreCompany", "UnityEngine") }));
  assert.equal(lead?.score, 80);
  assert.doesNotMatch(`${lead!.evidence[0]!.text} ${lead!.summary}`, /game stopped|moment of the crash/);
  assert.match(lead!.evidence[0]!.text, /error BepInEx logged was thrown inside MoreCompany/);
});

test("BepInEx: frames in the game's own classes and in Unity are not mod code", () => {
  const stack = frames("HUDManager", "UnityEngine", "System", "Assembly-CSharp");
  assert.deepEqual(rankLeads(bepinex({ callStack: stack })), []);
});

test("BepInEx: an error logged under a mod's own name: +35", () => {
  const log = bepinex({ exception: { type: "NullReferenceException", description: "Error:MoreCompany: NullReferenceException: x" } });
  const [lead] = rankLeads(log);
  assert.equal(lead?.name, "MoreCompany");
  assert.equal(lead?.score, 35);
  assert.match(lead!.evidence[0]!.text, /recorded the error under the name "MoreCompany"/);
});

test("BepInEx: an error logged under a name that isn't a loaded plugin still scores, but the evidence doesn't say a mod reported it", () => {
  const log = bepinex({ exception: { type: "NullReferenceException", description: "Error:SomeGameLogger: NullReferenceException: x" } });
  const [lead] = rankLeads(log);
  assert.equal(lead?.name, "SomeGameLogger");
  assert.equal(lead?.score, 35);
  assert.equal(lead?.evidence[0]?.basis, "log");
  assert.match(lead!.evidence[0]!.text, /recorded the error under the name "SomeGameLogger"\. That isn't one of the plugins it loaded/);
  assert.doesNotMatch(lead!.evidence[0]!.text, /the mod itself reported it/);
});

test("BepInEx: the log source 'Unity Log' and BepInEx itself are not mods", () => {
  // HarmonyX is the source name BepInEx gives Harmony's own log (HarmonyLogSource.cs, 5.4.21 and master).
  for (const source of ["Unity Log", "BepInEx", "Console", "HarmonyX"]) {
    const log = bepinex({ exception: { type: "X", description: `Error:${source}: boom` } });
    assert.deepEqual(rankLeads(log), [], source);
  }
});

test("BepInEx: the same mod in many errors counts for more than in one", () => {
  const event = (modules: string[]) => ({ level: "Error" as const, source: "Unity Log", message: "boom", modules });
  const score = (times: number) =>
    rankLeads(bepinex(), { events: Array.from({ length: times }, () => event(["MoreCompany"])) })[0]?.score;
  assert.equal(score(1), 10);
  assert.equal(score(2), 15);
  assert.equal(score(4), 20);
  assert.equal(score(8), 25);
  assert.equal(score(200), 25);
});

test("BepInEx: a namespace in an error that isn't a mod that loaded gives no lead", () => {
  const events = [{ level: "Error" as const, source: "Unity Log", message: "boom", modules: ["HUDManager", "UnityEngine"] }];
  assert.deepEqual(rankLeads(bepinex(), { events }), []);
});

test("frameKind: a BepInEx namespace that isn't a loaded mod is 'unknown', not a mod", () => {
  const plugins = [{ name: "MoreCompany" }];
  assert.equal(frameKind("MoreCompany", plugins), "mod");
  assert.equal(frameKind("HUDManager", plugins), "unknown");
  assert.equal(frameKind("UnityEngine", plugins), "framework");
  assert.equal(frameKind("SomeMod.dll"), "mod");
});

// ─── The other recent logs ───────────────────────────────────────────────────

test("a name that was a lead in other recent logs: +10 each, up to +30, with the counts kept", () => {
  const log = parsedWith({ callStack: frames("SkyrimSE.exe", "SomeMod.dll") });
  const sets = [new Set(["somemod"]), new Set(["somemod"]), new Set(["other"])];
  const [lead] = rankLeads(log, { recent: sets });
  assert.equal(lead?.score, 40 + 20);
  assert.deepEqual(lead?.recurrence, { logs: 2, of: 3 });
  assert.match(lead!.evidence.at(-1)!.text, /also a lead in 2 of your 3 other recent crash logs/);
  const five = Array.from({ length: 5 }, () => new Set(["somemod"]));
  assert.equal(rankLeads(log, { recent: five })[0]?.score, 40 + 30);
});

test("recurrence is matched through either spelling of a merged mod", () => {
  const log = parsedWith({
    callStack: frames("SkyrimSE.exe", "CitiesOfTheNorth.dll"),
    suspectedRefs: objects("Cities of the North - Whiterun.esp"),
  });
  const [lead] = rankLeads(log, { recent: [new Set(["citiesofthenorthwhiterun"])] });
  assert.deepEqual(lead?.recurrence, { logs: 1, of: 1 });
});

test("with no other logs, nothing is said about recurrence", () => {
  const [lead] = rankLeads(parsedWith({ callStack: frames("SkyrimSE.exe", "SomeMod.dll") }), { recent: [] });
  assert.equal(lead?.recurrence, undefined);
  assert.ok(!lead!.evidence.some((e) => /other recent crash/.test(e.text)));
});

// ─── The player's own files ──────────────────────────────────────────────────

const log = parsedWith({ callStack: frames("SkyrimSE.exe", "SomeMod.dll") });

test("a plugin the script extender's rules refuse for the installed game: +15, labelled with the rule's own basis", () => {
  const note: InstallNote = { present: true, source: "game folder", flagged: { status: "broken", reason: "SKSE refuses it", basis: "skse-source" } };
  const [lead] = rankLeads(log, { install: () => note });
  assert.equal(lead?.score, 55);
  assert.equal(lead?.install?.flagged?.status, "broken");
  const flagged = lead!.evidence.find((e) => /flagged/.test(e.text));
  assert.equal(flagged?.basis, "rule");
});

test("an inferred rule is a guess, and an unclear flag adds less", () => {
  const note: InstallNote = { present: true, flagged: { status: "unclear", reason: "can't tell", basis: "inferred" } };
  const [lead] = rankLeads(log, { install: () => note });
  assert.equal(lead?.score, 48);
  assert.equal(lead!.evidence.find((e) => /flagged/.test(e.text))?.basis, "guess");
});

test("a lead whose DLL is gone from the install says so, labelled as from the player's files", () => {
  const [lead] = rankLeads(log, { install: () => ({ present: false }) });
  const gone = lead!.evidence.find((e) => /isn't in your plugin folders/.test(e.text));
  assert.equal(gone?.basis, "install");
  assert.equal(lead?.score, 40);
});

test("the install is only asked about DLLs", () => {
  const asked: string[] = [];
  rankLeads(parsedWith({ suspectedRefs: objects("Cool Mod.esp") }), {
    install: (file) => {
      asked.push(file);
      return undefined;
    },
  });
  assert.deepEqual(asked, []);
});

// ─── Order and size ──────────────────────────────────────────────────────────

test("leads come strongest first, ties by name, with ranks from 1", () => {
  const leads = rankLeads(parsedWith({ callStack: frames("SkyrimSE.exe", "Zeta.dll", "Alpha.dll") }));
  assert.deepEqual(leads.map((l) => [l.rank, l.name]), [[1, "Zeta.dll"], [2, "Alpha.dll"]]);
  const tied = rankLeads(parsedWith({ suspectedRefs: objects("Zed.esp", "Abe.esp") }));
  assert.deepEqual(tied.map((l) => l.name), ["Abe.esp", "Zed.esp"]);
});

test("at most eight leads are returned", () => {
  const stack = frames("SkyrimSE.exe", ...Array.from({ length: 14 }, (_, i) => `Mod${String.fromCharCode(65 + i)}${"x".repeat(i)}.dll`));
  assert.equal(rankLeads(parsedWith({ callStack: stack })).length, 8);
});

test("a log with nothing from any mod has no leads", () => {
  assert.deepEqual(rankLeads(parsedWith({ callStack: frames("SkyrimSE.exe", "KERNEL32.DLL") })), []);
});

test("every evidence line says what it rests on", () => {
  const lead = only(
    parsedWith({
      callStack: frames("SkyrimSE.exe", "CitiesOfTheNorth.dll", "CitiesOfTheNorth.dll"),
      suspectedRefs: objects("Cities of the North - Whiterun.esp"),
    })
  );
  assert.ok(lead.evidence.length >= 4);
  for (const e of lead.evidence) assert.ok(["log", "install", "rule", "guess"].includes(e.basis));
});

// ─── Frames ──────────────────────────────────────────────────────────────────

test("toFrame: module and offset split, kind named, scan marked", () => {
  assert.deepEqual(toFrame({ index: 3, module: "SomeMod.dll+0003A41", function: "SomeMod::Run" }, 0), {
    index: 3,
    module: "SomeMod.dll",
    offset: "0003A41",
    function: "SomeMod::Run",
    kind: "mod",
  });
  assert.equal(toFrame({ module: "SkyrimSE.exe" }, 7).index, 7);
  assert.equal(toFrame({ index: 1, module: "X.dll", source: "scan" }, 0).scan, true);
  assert.equal(toFrame({ index: 1, module: "X.dll" }, 0).scan, undefined);
});

test("toFrame: a BepInEx frame carries no offset, because the runtime's file position isn't one", () => {
  const frame = toFrame({ index: 0, module: "System", offset: "<00000000000000000000000000000000>:0", function: "System.Foo ()" }, 0, []);
  assert.equal(frame.offset, undefined);
  assert.equal(frame.kind, "framework");
});

// ─── Well-known DLLs ─────────────────────────────────────────────────────────

test("a well-known DLL's lead says which mod it is, and a library other mods call is marked shared", () => {
  // Crash Logger SSE v1.11 (evildarkarchon/crash-logs, crash-2023-12-11-02-34-31.log): RaceMenu's skee64.dll under OBody's code.
  const leads = rankLeads(parsedWith({ callStack: frames(...Array(6).fill("skee64.dll"), "OBody.dll", "OBody.dll", "ucrtbase.dll", "KERNEL32.DLL") }));
  const race = leads.find((l) => l.name === "skee64.dll");
  assert.equal(race?.mod, "RaceMenu");
  assert.equal(race?.shared, true);
  const obody = leads.find((l) => l.name === "OBody.dll");
  assert.equal(obody?.mod, "OBody");
  assert.equal(obody?.shared, undefined);
  assert.equal(only(parsedWith({ callStack: frames("SomeMod.dll") })).mod, undefined);
});

test("when the game stopped inside a library other mods call, the mod right under it called it: scored as the first mod code", () => {
  // The same log. The old rule gave OBody +15 as "below other mod code", which made the mod that called RaceMenu a faint lead.
  const leads = rankLeads(parsedWith({ callStack: frames(...Array(6).fill("skee64.dll"), "OBody.dll", "OBody.dll", "ucrtbase.dll", "KERNEL32.DLL") }));
  const obody = leads.find((l) => l.name === "OBody.dll")!;
  assert.equal(obody.score, 40 + 5);
  assert.equal(obody.strength, "possible");
  assert.equal(obody.calls, "skee64.dll");
  assert.match(obody.evidence[0]!.text, /called skee64\.dll directly: it is right underneath it on the call stack \(frame 6\)/);
  assert.match(obody.summary, /called skee64\.dll/);
  assert.doesNotMatch(obody.summary, /below other mod code/);
  // A mod under one that is no shared library is still only "below other mod code".
  const plain = rankLeads(parsedWith({ callStack: frames("ModA.dll", "ModB.dll") }));
  assert.equal(plain.find((l) => l.name === "ModB.dll")?.score, 15);
  assert.equal(plain.find((l) => l.name === "ModB.dll")?.calls, undefined);
});

// ─── Where the logger found an object ────────────────────────────────────────

const ref = (likelySource: string, origin: "objects" | "register" | "stack", value = "0x0003C9FE", extra = {}) => ({ type: "formid", value, likelySource, origin, ...extra });

test("an object the logger printed beside a register is weaker than one on its own list, and one in stack memory weaker still", () => {
  // Crash Logger SSE before v1.20 prints the objects it finds under a register or a stack slot (crash-2023-12-11-02-34-31.log).
  const listed = only(parsedWith({ suspectedRefs: [ref("Weapons Armor Clothing & Clutter Fixes.esp", "objects")] }));
  assert.equal(listed.score, 35);
  const register = only(parsedWith({ suspectedRefs: [ref("Weapons Armor Clothing & Clutter Fixes.esp", "register")] }));
  assert.equal(register.score, 25);
  assert.match(register.evidence[0]!.text, /beside a register .* so this is weaker evidence than it looks\.$/);
  const stack = only(parsedWith({ suspectedRefs: [ref("Weapons Armor Clothing & Clutter Fixes.esp", "stack", "0x0003C9FE", { kind: "Armor", name: "Roughspun Tunic" })] }));
  assert.equal(stack.score, 15);
  assert.equal(stack.strength, "faint");
  assert.match(stack.evidence[0]!.text, /in stack memory \(for example Armor "Roughspun Tunic", 0x0003C9FE\)/);
  assert.match(stack.evidence[0]!.text, /Stack memory also holds leftovers, so this is weak evidence\.$/);
  assert.match(stack.summary, /stack memory/i);
});

test("a reference and the base object it was placed from count as one object, and a base another plugin placed counts for its own", () => {
  // NetScriptFramework, D6DDDA.txt: Skyrim Unbound's sack and its base container, both found at [SP+C90].
  const sack = ref("Skyrim Unbound.esp", "stack", "0xD885F93A", { kind: "TESObjectCONT", name: "Large Sack" });
  const one = only(parsedWith({ detectedType: "netscriptframework", suspectedRefs: [sack, ref("Skyrim Unbound.esp", "stack", "0xD8841320", { kind: "TESObjectREFR", base: "0xD885F93A" })] }));
  assert.equal(one.score, 15);
  assert.match(one.evidence[0]!.text, /^The crash logger found an object from Skyrim Unbound\.esp in stack memory \(for example TESObjectCONT "Large Sack", 0xD885F93A\)/);
  const placed = rankLeads(parsedWith({ detectedType: "netscriptframework", suspectedRefs: [sack, ref("Some Other Mod.esp", "stack", "0xD8841320", { base: "0xD885F93A" })] }));
  assert.deepEqual(placed.map((l) => [l.name, l.score]), [["Skyrim Unbound.esp", 15], ["Some Other Mod.esp", 15]]);
});

test("the player's own character, last changed by a plugin, is a weak lead: it is in use the whole time you play", () => {
  // NetScriptFramework, Shadowrend.txt: the player's TESNPC, last changed by an alternate-start plugin.
  const lead = only(
    parsedWith({
      detectedType: "netscriptframework",
      suspectedRefs: [ref("Skyrim Unbound.esp", "objects", "0x00000007", { kind: "TESNPC", plugins: ["Skyrim.esm", "ccbgssse018-shadowrend.esl", "Skyrim Unbound.esp"] })],
    })
  );
  assert.equal(lead.score, 15);
  assert.equal(lead.strength, "faint");
  assert.match(lead.evidence[0]!.text, /player's character/);
});

test("a Papyrus script in the log named like a loaded plugin makes that plugin a lead, labelled a guess", () => {
  // NetScriptFramework, JContainers.txt: metaSkillMenuScript.load_data on the stack, metaSkillMenu.esp in the load order.
  const papyrus = [
    { script: "JValue", function: "GotoState" },
    { script: "metaSkillMenuScript", function: "load_data" },
    { script: "Actor", function: "AddSpell", native: true as const },
  ];
  const loadedPlugins = [{ name: "Skyrim.esm" }, { name: "metaSkillMenu.esp" }];
  const alone = rankLeads(parsedWith({ detectedType: "netscriptframework", loadedPlugins, papyrus }));
  assert.deepEqual(alone.map((l) => [l.name, l.score]), [["metaSkillMenu.esp", 25]]);
  assert.equal(alone[0]!.evidence[0]!.basis, "guess");
  assert.match(alone[0]!.evidence[0]!.text, /metaSkillMenuScript\.load_data/);
  assert.match(alone[0]!.evidence[0]!.text, /name match, not proof/);
  // Under a library other mods call, the script is a likely caller.
  const called = rankLeads(parsedWith({ detectedType: "netscriptframework", loadedPlugins, papyrus, callStack: frames("JContainers64.dll", "(unknown)") }));
  const meta = called.find((l) => l.name === "metaSkillMenu.esp")!;
  assert.equal(meta.score, 40);
  assert.equal(meta.strength, "possible");
  assert.equal(meta.calls, "JContainers64.dll");
});
