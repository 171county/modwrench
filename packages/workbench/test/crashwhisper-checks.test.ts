import { test } from "node:test";
import assert from "node:assert/strict";
import type { CrashlogParseResult, LoadedPlugin } from "../src/crashlog/types.js";
import type { BepInExFacts, LoadProblem } from "../src/crashwhisper/bepinex-scan.js";
import { runChecks, type CheckInput } from "../src/crashwhisper/checks.js";
import { sameVersion, versionParts, type InstallContext } from "../src/crashwhisper/context.js";
import type { Lead } from "../src/crashwhisper/types.js";

const NOW = Date.parse("2026-10-02T12:00:00Z");

const parsedWith = (over: Partial<CrashlogParseResult> = {}): CrashlogParseResult => ({
  detectedType: "crashlogger-sse",
  gameVersion: "Skyrim SSE v1.6.1170",
  exception: { type: "EXCEPTION_ACCESS_VIOLATION" },
  callStack: [{ index: 0, module: "SkyrimSE.exe" }],
  loadedPlugins: [],
  rawSections: {},
  ...over,
});

const noInstall: InstallContext = {
  checked: false,
  reason: "not read",
  note: () => undefined,
  versions: () => [],
  files: new Set(),
  flagged: [],
};

const installed = (over: Partial<InstallContext> = {}): InstallContext => ({ ...noInstall, checked: true, gameVersion: "1.6.1170", ...over });

const lead = (over: Partial<Lead> = {}): Lead => ({
  rank: 1,
  name: "SomeMod.dll",
  files: ["SomeMod.dll"],
  strength: "strong",
  summary: "x",
  evidence: [],
  score: 90,
  ...over,
});

const input = (over: Partial<CheckInput> = {}): CheckInput => ({
  parsed: parsedWith(),
  game: { name: "Skyrim Special Edition", version: "1.6.1170", id: "skyrimspecialedition" },
  leads: [],
  install: noInstall,
  logPlugins: new Map(),
  modules: new Set(),
  warnings: [],
  now: NOW,
  ...over,
});

const ids = (over: Partial<CheckInput> = {}) => runChecks(input(over)).map((c) => c.id);
const find = (id: string, over: Partial<CheckInput> = {}) => runChecks(input(over)).find((c) => c.id === id);

const plugins = (regular: number, light = 0): LoadedPlugin[] => [
  ...Array.from({ length: regular }, (_, i) => ({ name: `P${i}.esp`, loadIndex: i.toString(16).toUpperCase().padStart(2, "0") })),
  ...Array.from({ length: light }, (_, i) => ({ name: `L${i}.esl`, loadIndex: `FE:${i.toString(16).toUpperCase().padStart(3, "0")}` })),
];

// ─── SkyrimCrashGuard ────────────────────────────────────────────────────────

test("SkyrimCrashGuard: Crash Logger's own banner is a problem, labelled as its rule", () => {
  const c = find("skyrimcrashguard", { warnings: ["SkyrimCrashGuard"] });
  assert.equal(c?.severity, "problem");
  assert.equal(c?.basis, "rule");
  assert.match(c!.detail, /may be incomplete or misleading/);
  assert.match(c!.fix ?? "", /Remove SkyrimCrashGuard/);
});

test("SkyrimCrashGuard: listed among the loaded modules is enough, even without the banner", () => {
  assert.ok(ids({ modules: new Set(["skyrimse", "skyrimcrashguard"]) }).includes("skyrimcrashguard"));
});

test("SkyrimCrashGuard: absent means no check; other names in the banner list aren't confused with it", () => {
  assert.ok(!ids().includes("skyrimcrashguard"));
  assert.ok(!ids({ warnings: ["SomethingElse"] }).includes("skyrimcrashguard"));
});

// ─── BepInEx's own verdicts ──────────────────────────────────────────────────

const facts = (problems: LoadProblem[], over: Partial<BepInExFacts> = {}): BepInExFacts => ({
  problems,
  events: [],
  errorCount: 1,
  repeats: [],
  ...over,
});
const bepinexParsed = parsedWith({ detectedType: "bepinex", callStack: [{ module: "SomeMod" }] });

test("BepInEx load problems: each kind says what happened and what to do, as BepInEx's rule", () => {
  const problems: LoadProblem[] = [
    { kind: "missing-dependency", plugin: "A 1.0.0", detail: "B (1.0.0)", level: "Error" },
    { kind: "incompatible-version", plugin: "C 1.0.0", detail: "D (2.0.0)", level: "Error" },
    { kind: "incompatible-with", plugin: "E 1.0.0", detail: "F", level: "Error" },
    { kind: "load-error", plugin: "G 1.0.0", detail: "System.TypeLoadException: x", level: "Error" },
    { kind: "wrong-bepinex", plugin: "H 1.0.0", detail: "5.4.19.0", level: "Warning" },
    { kind: "dependency-not-loaded", plugin: "I 1.0.0", detail: "", level: "Warning" },
  ];
  const checks = runChecks(input({ parsed: bepinexParsed, bepinex: facts(problems) }));
  const loads = checks.filter((c) => c.id.startsWith("bepinex-load-"));
  assert.equal(loads.length, 6);
  for (const c of loads) assert.equal(c.basis, "rule");
  assert.deepEqual(loads.map((c) => c.severity), ["problem", "problem", "problem", "problem", "note", "note"]);
  assert.match(loads[0]!.detail, /A 1\.0\.0 has missing dependencies: B \(1\.0\.0\)/);
  assert.match(loads[0]!.fix ?? "", /Install the missing mod/);
  assert.match(loads[2]!.title, /doesn't work with another mod/);
  assert.match(loads[4]!.detail, /targets another BepInEx version \(5\.4\.19\.0\)/);
  assert.equal(loads[5]!.fix, undefined);
});

test("BepInEx load problems: eight are listed and the rest counted", () => {
  const problems: LoadProblem[] = Array.from({ length: 11 }, (_, i) => ({
    kind: "missing-dependency" as const,
    plugin: `Mod${i} 1.0.0`,
    detail: "X",
    level: "Error" as const,
  }));
  const checks = runChecks(input({ parsed: bepinexParsed, bepinex: facts(problems) }));
  assert.equal(checks.filter((c) => /^bepinex-load-\d/.test(c.id)).length, 8);
  assert.match(checks.find((c) => c.id === "bepinex-load-more")?.title ?? "", /3 more load problems/);
});

test("a repeating error is worth saying; a pair of them is not", () => {
  const repeat = (count: number) =>
    facts([], { repeats: [{ key: "k", type: "NullReferenceException", source: "MoreCompany", count, message: "NullReferenceException: boom" }] });
  const c = find("bepinex-repeats", { parsed: bepinexParsed, bepinex: repeat(57) });
  assert.match(c?.title ?? "", /57 times/);
  assert.match(c?.fix ?? "", /Disable MoreCompany/);
  assert.equal(find("bepinex-repeats", { parsed: bepinexParsed, bepinex: repeat(4) }), undefined);
});

test("a BepInEx log with no errors says it can't explain a crash", () => {
  const c = find("bepinex-clean", { parsed: parsedWith({ detectedType: "bepinex", callStack: [] }), bepinex: facts([], { errorCount: 0 }) });
  assert.equal(c?.severity, "info");
  assert.match(c!.detail, /can't say why/);
  // And the lack of a stack isn't also reported: there was no error to have one.
  assert.equal(find("no-call-stack", { parsed: parsedWith({ detectedType: "bepinex", callStack: [] }), bepinex: facts([], { errorCount: 0 }) }), undefined);
});

// ─── The plugin limit ────────────────────────────────────────────────────────

test("plugin limit: all 254 regular slots used is a problem, by a documented rule", () => {
  const c = find("plugin-limit", { parsed: parsedWith({ loadedPlugins: plugins(254) }) });
  assert.equal(c?.severity, "problem");
  assert.equal(c?.basis, "rule");
  assert.match(c!.title, /all 254 regular plugin slots/);
});

test("plugin limit: close to it is a note, comfortably under it is nothing", () => {
  assert.equal(find("plugin-limit", { parsed: parsedWith({ loadedPlugins: plugins(240) }) })?.severity, "note");
  assert.equal(find("plugin-limit", { parsed: parsedWith({ loadedPlugins: plugins(239) }) }), undefined);
});

test("plugin limit: light plugins share one slot and aren't counted against it", () => {
  assert.equal(find("plugin-limit", { parsed: parsedWith({ loadedPlugins: plugins(100, 3000) }) }), undefined);
});

test("plugin limit: a BepInEx log's mods are not Bethesda plugins, however many there are", () => {
  // BepInEx lists the mods it loaded, with no load index: there are no slots to run out of.
  const mods = Array.from({ length: 300 }, (_, i) => ({ name: `Plugin${i}` }));
  const bepinex = parsedWith({ detectedType: "bepinex", gameVersion: undefined, loadedPlugins: mods });
  assert.equal(find("plugin-limit", { parsed: bepinex, game: { name: "Lethal Company", id: "lethalcompany" } }), undefined);
  // The same list from a Bethesda logger still counts.
  assert.equal(find("plugin-limit", { parsed: parsedWith({ detectedType: "netscriptframework", loadedPlugins: plugins(254) }) })?.severity, "problem");
  assert.equal(find("plugin-limit", { parsed: parsedWith({ detectedType: "buffout4", loadedPlugins: plugins(254) }) })?.severity, "problem");
});

// ─── The game was patched ────────────────────────────────────────────────────

test("the game was updated since the crash: said when the log and the install disagree, as a fact from the install", () => {
  const c = find("game-updated", { install: installed({ gameVersion: "1.6.1179" }) });
  assert.equal(c?.severity, "note");
  assert.equal(c?.basis, "install");
  assert.match(c!.title, /1\.6\.1170 then, 1\.6\.1179 now/);
  assert.match(c!.fix ?? "", /Patch Day/);
});

test("same game version in both, or a fourth part that is zero: nothing to say", () => {
  assert.equal(find("game-updated", { install: installed({ gameVersion: "1.6.1170" }) }), undefined);
  assert.equal(find("game-updated", { parsed: parsedWith({ gameVersion: "Skyrim SSE v1.6.1170.0" }), install: installed({ gameVersion: "1.6.1170" }) }), undefined);
});

test("without an install read there is nothing to compare, so nothing is claimed", () => {
  assert.equal(find("game-updated"), undefined);
});

// ─── A plugin replaced since the crash ───────────────────────────────────────

const logged = new Map([["somemod.dll", "1.4.2"]]);

test("a plugin the log points at has a different version now: a note, from the player's files", () => {
  const c = find("plugin-updated-somemod.dll", {
    leads: [lead()],
    logPlugins: logged,
    install: installed({ versions: () => ["1.5.0"] }),
  });
  assert.equal(c?.severity, "note");
  assert.equal(c?.basis, "install");
  assert.match(c!.title, /1\.4\.2 then, 1\.5\.0 now/);
});

test("the same version in either of the two places a DLL keeps one is not a change", () => {
  const over = (versions: string[]) => ({ leads: [lead()], logPlugins: logged, install: installed({ versions: () => versions }) });
  assert.equal(find("plugin-updated-somemod.dll", over(["1.4.2"])), undefined);
  assert.equal(find("plugin-updated-somemod.dll", over(["9.9.9", "1.4.2.0"])), undefined);
});

test("a version the log printed in some other form can't be compared, so it isn't", () => {
  const c = find("plugin-updated-somemod.dll", {
    leads: [lead()],
    logPlugins: new Map([["somemod.dll", "16793600"]]),
    install: installed({ versions: () => ["1.5.0"] }),
  });
  assert.equal(c, undefined);
});

test("no installed version, or only a faint lead: nothing to say", () => {
  assert.equal(find("plugin-updated-somemod.dll", { leads: [lead()], logPlugins: logged, install: installed() }), undefined);
  assert.equal(
    find("plugin-updated-somemod.dll", { leads: [lead({ strength: "faint" })], logPlugins: logged, install: installed({ versions: () => ["1.5.0"] }) }),
    undefined
  );
});

test("versionParts and sameVersion ignore trailing zeros and a leading v, and refuse what isn't a version", () => {
  assert.deepEqual(versionParts("v1.4.2.0"), [1, 4, 2]);
  assert.deepEqual(versionParts("1.4.0"), [1, 4]);
  assert.equal(versionParts("16793600"), null);
  assert.equal(versionParts("1.x"), null);
  assert.equal(sameVersion("1.4.0", "1.4"), true);
  assert.equal(sameVersion("1.4.2", "1.4.3"), false);
  assert.equal(sameVersion("nope", "1.4.2"), false);
});

// ─── A plugin the script extender refuses ────────────────────────────────────

test("a lead flagged for the installed game version is a problem, with the rule's own basis", () => {
  const flagged = (basis: "skse-source" | "field-reports" | "inferred", status: "broken" | "unclear") =>
    lead({ install: { present: true, flagged: { status, reason: "SKSE refuses it", basis } } });
  const broken = find("plugin-flagged-somemod.dll", { leads: [flagged("skse-source", "broken")] });
  assert.equal(broken?.severity, "problem");
  assert.equal(broken?.basis, "rule");
  assert.match(broken!.detail, /not from the crash log/);
  assert.equal(find("plugin-flagged-somemod.dll", { leads: [flagged("field-reports", "unclear")] })?.severity, "note");
  assert.equal(find("plugin-flagged-somemod.dll", { leads: [flagged("inferred", "broken")] })?.basis, "guess");
});

test("a faint lead's flag isn't raised to a check", () => {
  const faint = lead({ strength: "faint", install: { present: true, flagged: { status: "broken", reason: "x", basis: "skse-source" } } });
  assert.equal(find("plugin-flagged-somemod.dll", { leads: [faint] }), undefined);
});

// ─── Memory ──────────────────────────────────────────────────────────────────

test("memory nearly full is a note that quotes the log's own figures", () => {
  const c = find("memory", { system: { gpus: [], vram: { used: 6.9, budget: 7.4 }, ram: { used: 31.0, total: 31.9 } } });
  assert.equal(c?.severity, "note");
  assert.equal(c?.basis, "log");
  assert.match(c!.detail, /video memory 6\.9 GB of 7\.4 GB/);
  assert.match(c!.detail, /system memory 31 GB of 31\.9 GB/);
});

test("memory nearly full isn't put first when the game stopped inside a mod's code", () => {
  // Crash Logger SSE v1.11, crash-2023-12-11-02-34-31.log: "GPU MEMORY: 9.42/10.39 GB", and the game stopped inside RaceMenu.
  const stoppedInMod = parsedWith({ callStack: [{ index: 0, module: "skee64.dll+001EAB4" }, { index: 6, module: "OBody.dll+0001D32" }] });
  const c = find("memory", { parsed: stoppedInMod, system: { gpus: [], vram: { used: 9.42, budget: 10.39 } } });
  assert.match(c!.detail, /video memory 9\.4 GB of 10\.4 GB/);
  assert.match(c!.detail, /stopped inside a mod's code, so start with that lead/);
  assert.doesNotMatch(`${c!.detail} ${c!.fix}`, /matter more than any name|Rule it out first/);
  assert.match(c!.fix ?? "", /^If the crash keeps turning up in different places/);
});

test("memory with room to spare says nothing", () => {
  assert.equal(find("memory", { system: { gpus: [], vram: { used: 6.0, budget: 7.4 }, ram: { used: 14, total: 32 } } }), undefined);
  assert.equal(find("memory"), undefined);
});

test("memory: nothing is said about commit, which no logger's figures give", () => {
  // Only a SystemFacts made by hand can still carry commit; the check doesn't read it.
  assert.equal(find("memory", { system: { gpus: [], commit: { used: 53, total: 53.9 } } }), undefined);
});

test("system memory counts only when it is nearly all used", () => {
  assert.equal(find("memory", { system: { gpus: [], ram: { used: 30.4, total: 32 } } })?.id, "memory");
  assert.equal(find("memory", { system: { gpus: [], ram: { used: 28, total: 32 } } }), undefined);
});

// ─── A log without a call stack ──────────────────────────────────────────────

test("no call stack is a note: any lead is weaker for it", () => {
  const c = find("no-call-stack", { parsed: parsedWith({ callStack: [] }) });
  assert.equal(c?.severity, "note");
  assert.match(c!.detail, /weaker/);
  assert.equal(find("no-call-stack"), undefined);
});

test("a BepInEx error with no stack says so in BepInEx's words", () => {
  const c = find("no-call-stack", { parsed: parsedWith({ detectedType: "bepinex", callStack: [] }), bepinex: facts([]) });
  assert.match(c?.title ?? "", /no stack trace/);
});

// ─── An old log ──────────────────────────────────────────────────────────────

test("a crash from weeks ago is said to be old, in case it isn't the one being asked about", () => {
  const c = find("old-log", { time: "2026-09-10 10:00:00" });
  assert.equal(c?.severity, "info");
  assert.match(c!.title, /2026-09-10, about 22 days ago/);
  assert.equal(find("old-log", { time: "2026-09-29 10:00:00" }), undefined);
  assert.equal(find("old-log", { time: "2026-09-18 10:00" })?.id, "old-log");
  assert.equal(find("old-log", { time: "not a time" }), undefined);
  assert.equal(find("old-log"), undefined);
});

// ─── Order ───────────────────────────────────────────────────────────────────

test("problems come first, then notes, then information, each in the order found", () => {
  const checks = runChecks(
    input({
      parsed: parsedWith({ callStack: [], loadedPlugins: plugins(254) }),
      warnings: ["SkyrimCrashGuard"],
      time: "2026-09-10 10:00:00",
      install: installed({ gameVersion: "1.6.1179" }),
    })
  );
  assert.deepEqual(checks.map((c) => [c.severity, c.id]), [
    ["problem", "skyrimcrashguard"],
    ["problem", "plugin-limit"],
    ["note", "game-updated"],
    ["note", "no-call-stack"],
    ["info", "old-log"],
  ]);
});

test("a clean log has no checks at all", () => {
  assert.deepEqual(runChecks(input()), []);
});

test("every check says what it rests on", () => {
  const checks = runChecks(
    input({
      parsed: parsedWith({ callStack: [], loadedPlugins: plugins(250) }),
      warnings: ["SkyrimCrashGuard"],
      system: { gpus: [], vram: { used: 7.3, budget: 7.4 } },
      install: installed({ gameVersion: "1.6.1179" }),
      time: "2026-09-10 10:00:00",
    })
  );
  assert.ok(checks.length >= 5);
  for (const c of checks) assert.ok(["log", "install", "rule", "guess"].includes(c.basis), c.id);
});
