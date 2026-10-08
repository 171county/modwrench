import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkPatchDay, type PatchDayReport } from "../src/patchday/index.js";
import { summarizePatchDay } from "../src/patchday/summary.js";
import {
  AI_ADDRESS_LIBRARY_1_10_980 as AL980,
  AI_ADDRESS_LIBRARY_1_11_137 as AL137,
  AI_SIGNATURES as SIG,
  SI_1_10_980_LAYOUT as L980,
  SI_1_11_137_LAYOUT as L137,
  SI_NO_STRUCTS as NOSTRUCT,
  inspectF4sePlugin,
  parseF4seVersionData,
  type F4seDllInfo,
} from "../src/patchday/f4se.js";
import { assessF4sePlugin, f4seBindingOf, f4seSourceFor } from "../src/patchday/f4se-rules.js";
import { packVersion } from "../src/patchday/skse.js";
import { buildPe, f4seVersionData } from "./helpers/pe-builder.js";
import { createSandbox } from "./helpers/world.js";

// ─── Patch Day for Fallout 4 ─────────────────────────────────────────────────
// F4SE's rules, from its published source at each release's tag, applied to what a
// plugin file declares; and the whole check over a Fallout 4 install built on disk.

const V = (a: number, b: number, c: number): number => packVersion(a, b, c);
const OG = V(1, 10, 163);
const NG = V(1, 10, 984);
const AE137 = V(1, 11, 137);
const AE240 = V(1, 11, 240);

// ─── Reading the struct ──────────────────────────────────────────────────────

test("F4SEPluginVersionData is read field by field from F4SE's layout", () => {
  const v = parseF4seVersionData(
    f4seVersionData({
      dataVersion: 1,
      pluginVersion: 0x01020300,
      name: "Weapon Fix",
      author: "someone",
      addressIndependence: AL137,
      structureIndependence: L137,
      compatibleVersions: [AE240, V(1, 11, 221)],
      seVersionRequired: V(0, 7, 9),
      reservedBreaking: 4,
    })
  );
  assert.deepEqual(v, {
    dataVersion: 1,
    pluginVersion: 0x01020300,
    name: "Weapon Fix",
    author: "someone",
    addressIndependence: AL137,
    structureIndependence: L137,
    compatibleVersions: [AE240, V(1, 11, 221)],
    seVersionRequired: V(0, 7, 9),
    reservedBreaking: 4,
  });
  assert.equal(parseF4seVersionData(Buffer.alloc(1115)), null, "a short buffer isn't read");
});

test("a name that fills its 256 bytes is cut at 255, as F4SE's Sanitize does", () => {
  const v = parseF4seVersionData(f4seVersionData({ rawName: Buffer.alloc(256, 0x41) }));
  assert.equal(v?.name.length, 255);
});

test("a plugin DLL's exports and version data are read without running it", () => {
  const dir = join(sandbox.root, "inspect");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "p.dll");
  writeFileSync(file, buildPe({ exports: [{ name: "F4SEPlugin_Version", data: f4seVersionData({ name: "P" }) }, { name: "F4SEPlugin_Load" }] }));
  const info = inspectF4sePlugin(file);
  assert.equal(info.readable, true);
  assert.equal(info.is64, true);
  assert.deepEqual(info.exports, { version: true, query: false, load: true, preload: false });
  assert.equal(info.versionData?.name, "P");
  writeFileSync(file, buildPe({ is64: false, exports: [{ name: "F4SEPlugin_Query" }] }));
  assert.equal(inspectF4sePlugin(file).is64, false);
  writeFileSync(file, "not a DLL");
  assert.equal(inspectF4sePlugin(file).readable, false);
});

// ─── The rules ───────────────────────────────────────────────────────────────

const info = (o: { version?: Parameters<typeof f4seVersionData>[0] | null; query?: boolean; load?: boolean; is64?: boolean } = {}): F4seDllInfo => {
  const versionData = o.version === null || o.version === undefined ? undefined : parseF4seVersionData(f4seVersionData(o.version))!;
  return {
    readable: true,
    is64: o.is64 ?? true,
    exports: { version: versionData !== undefined, query: o.query ?? false, load: o.load ?? versionData !== undefined, preload: false },
    ...(versionData ? { versionData } : {}),
  };
};
const ctx = (runtime: number, library = true, f4se = V(0, 7, 9)) => ({ runtime, skseVersion: f4se, addressLibrary: { present: library } });

test("F4SE's published builds: each game version gets its build, and one no build was made for gets the nearest before it", () => {
  assert.deepEqual(f4seSourceFor(OG), { build: "0.6.23", covered: true });
  assert.deepEqual(f4seSourceFor(V(1, 10, 980)), { build: "0.7.1", covered: true });
  assert.deepEqual(f4seSourceFor(NG), { build: "0.7.2", covered: true });
  assert.deepEqual(f4seSourceFor(AE137), { build: "0.7.4", covered: true });
  assert.deepEqual(f4seSourceFor(V(1, 11, 159)), { build: "0.7.5", covered: true });
  assert.deepEqual(f4seSourceFor(AE240), { build: "0.7.9", covered: true });
  assert.deepEqual(f4seSourceFor(V(1, 11, 250)), { build: "0.7.9", covered: false });
  assert.deepEqual(f4seSourceFor(V(1, 10, 130)), { build: "0.6.23", covered: false });
});

test("before the Next-Gen update: F4SE 0.6.23 keeps a plugin that exports both F4SEPlugin_Query and F4SEPlugin_Load", () => {
  const old = assessF4sePlugin(info({ query: true, load: true }), ctx(OG));
  assert.deepEqual([old.status, old.basis, old.binding], ["ok", "f4se-source", "legacy"]);
  assert.match(old.reason, /whether it accepts this game version is up to its own code \(F4SEPlugin_Query\)/);
  const ng = assessF4sePlugin(info({ version: { addressIndependence: AL137, structureIndependence: L137 } }), ctx(OG));
  assert.deepEqual([ng.status, ng.skseMessage], ["broken", "does not appear to be an F4SE plugin"]);
  assert.match(ng.reason, /likely a build for 1\.10\.980 or later/);
  const x86 = assessF4sePlugin(info({ query: true, load: true, is64: false }), ctx(OG));
  assert.deepEqual([x86.status, x86.skseMessage], ["broken", "couldn't load plugin"]);
});

test("from the Next-Gen update on, a plugin without version data isn't loaded, and a 32-bit one never is", () => {
  const old = assessF4sePlugin(info({ query: true, load: true }), ctx(NG));
  assert.deepEqual([old.status, old.skseMessage, old.basis], ["broken", "no version data", "f4se-source"]);
  const x86 = assessF4sePlugin(info({ query: true, is64: false }), ctx(AE240));
  assert.deepEqual([x86.status, x86.skseMessage], ["broken", "32-bit plugins can never work"]);
  const library = assessF4sePlugin({ readable: true, is64: true, exports: { version: false, query: false, load: false, preload: false } }, ctx(AE240));
  assert.deepEqual([library.status, library.binding, library.basis], ["ok", "none", "inferred"]);
});

test("F4SE 0.7.0 to 0.7.4 count the 1.10.980 Address Library and layout; 0.7.5 on count only the 1.11.137 ones", () => {
  const ng = info({ version: { addressIndependence: AL980, structureIndependence: L980 } });
  assert.equal(assessF4sePlugin(ng, ctx(NG)).status, "ok");
  // 1.11.137 got F4SE 0.7.4, which still counted the 1.10.980 bits.
  assert.equal(assessF4sePlugin(ng, ctx(AE137)).status, "ok");
  const later = assessF4sePlugin(ng, ctx(AE240));
  assert.deepEqual([later.status, later.skseMessage], ["broken", "disabled, incompatible with current version of the game"]);
  assert.match(later.reason, /declares the Address Library or game layout of 1\.10\.980, which F4SE stopped counting from 0\.7\.5 \(game 1\.11\.159\) on/);
  assert.equal(f4seBindingOf(ng), "pinned", "the next patch holds it to its list");
  const ae = info({ version: { addressIndependence: AL137, structureIndependence: L137 } });
  assert.equal(assessF4sePlugin(ae, ctx(AE240)).status, "ok");
  assert.equal(f4seBindingOf(ae), "independent");
  assert.match(assessF4sePlugin(ae, ctx(AE240)).reason, /version-independent through the Address Library \(the 1\.11\.137 one\)/);
});

test("the Address Library file is checked only for a plugin that declares the current Address Library", () => {
  const ae = info({ version: { addressIndependence: AL137, structureIndependence: NOSTRUCT } });
  const missing = assessF4sePlugin(ae, ctx(AE240, false));
  assert.deepEqual([missing.status, missing.skseMessage], ["broken", "disabled, address library needs to be updated"]);
  const signatures = info({ version: { addressIndependence: SIG, structureIndependence: NOSTRUCT } });
  assert.equal(assessF4sePlugin(signatures, ctx(AE240, false)).status, "ok");
});

test("a pinned plugin is fine on a version it lists, refused on others, and anything in reservedBreaking pins it", () => {
  const pinned = info({ version: { compatibleVersions: [AE240] } });
  assert.equal(assessF4sePlugin(pinned, ctx(AE240)).status, "ok");
  const elsewhere = assessF4sePlugin(pinned, ctx(V(1, 11, 221)));
  assert.equal(elsewhere.status, "broken");
  assert.deepEqual(elsewhere.pinnedTo, ["1.11.240.0"]);
  const breaking = info({ version: { addressIndependence: AL137, structureIndependence: L137, reservedBreaking: 1 } });
  assert.equal(assessF4sePlugin(breaking, ctx(AE240)).skseMessage, "disabled, incompatible with current version of the game");
});

test("bad version data, no name, and an F4SE too old for the plugin, in F4SE's order and words", () => {
  assert.equal(assessF4sePlugin(info({ version: { dataVersion: 0 } }), ctx(AE240)).skseMessage, "disabled, bad version data");
  assert.equal(assessF4sePlugin(info({ version: { name: "" } }), ctx(AE240)).skseMessage, "disabled, no name specified");
  const newer = assessF4sePlugin(info({ version: { addressIndependence: AL137, structureIndependence: L137, seVersionRequired: V(0, 8, 0) } }), ctx(AE240));
  assert.equal(newer.skseMessage, "disabled, requires newer script extender");
  assert.match(newer.reason, /needs F4SE 0\.8\.0 or newer; the installed build is 0\.7\.9/);
});

test("a game version no F4SE build was made for is judged by the nearest build, and says it is inferred", () => {
  const pinned = info({ version: { compatibleVersions: [AE240] } });
  const r = assessF4sePlugin(pinned, ctx(V(1, 11, 250)));
  assert.deepEqual([r.status, r.basis], ["broken", "inferred"]);
});

// ─── The whole check, over a Fallout 4 install ───────────────────────────────

const sandbox = createSandbox("mw-patchday-f4-");
before(() => sandbox.start());
afterEach(() => sandbox.isolate());
after(() => sandbox.stop());

let worlds = 0;
type F4World = { gameDir: string; plugins: string; steamapps: string; log: string };

/** A Fallout 4 in a Steam library, with F4SE 0.7.9 for `game` and its Address Library file, unless told otherwise. */
function fallout4(o: { game?: [number, number, number]; f4se?: boolean; library?: boolean; files?: string[] } = {}): F4World {
  const [a, b, c] = o.game ?? [1, 11, 240];
  const steamapps = join(sandbox.root, `f4-${worlds++}`, "steamapps");
  const gameDir = join(steamapps, "common", "Fallout 4");
  const plugins = join(gameDir, "Data", "F4SE", "Plugins");
  mkdirSync(plugins, { recursive: true });
  writeFileSync(join(gameDir, "Fallout4.exe"), buildPe({ version: [a, b, c, 0] }));
  if (o.f4se !== false) {
    // F4SE stamps FILEVERSION 0,0,7,9 on its loader and DLL (f4se_version.rc).
    writeFileSync(join(gameDir, "f4se_loader.exe"), buildPe({ version: [0, 0, 7, 9] }));
    writeFileSync(join(gameDir, `f4se_${a}_${b}_${c}.dll`), buildPe({ version: [0, 0, 7, 9] }));
  }
  if (o.library !== false) writeFileSync(join(plugins, `version-${a}-${b}-${c}-0.bin`), Buffer.alloc(8));
  for (const f of o.files ?? []) writeFileSync(join(gameDir, f), "");
  const log = join(steamapps, "compatdata", "377160", "pfx", "drive_c", "users", "steamuser", "Documents", "My Games", "Fallout4", "F4SE", "f4se.log");
  return { gameDir, plugins, steamapps, log };
}

const plugin = (w: F4World, file: string, version: Parameters<typeof f4seVersionData>[0]): void =>
  writeFileSync(join(w.plugins, file), buildPe({ exports: [{ name: "F4SEPlugin_Version", data: f4seVersionData(version) }, { name: "F4SEPlugin_Load" }] }));

function run(w: F4World, extra: Parameters<typeof checkPatchDay>[0] = {}): PatchDayReport {
  const r = checkPatchDay({ gameId: "fallout4", gamePath: w.gameDir, ...extra });
  assert.equal(r.ok, true, r.ok ? "" : `${r.error} ${r.hint ?? ""}`);
  return r as PatchDayReport;
}

test("with no game named, a gamePath holding Fallout4.exe is checked as Fallout 4", () => {
  const w = fallout4();
  plugin(w, "Good.dll", { name: "Good", addressIndependence: AL137, structureIndependence: L137 });
  const r = checkPatchDay({ gamePath: w.gameDir });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.game.id, "fallout4");
  assert.equal(r.scriptExtender.name, "F4SE");
  assert.ok(!r.nextSteps.some((s) => /installed too/.test(s)), "a folder was given, so no other game was looked for");
});

test("with no game named and none given by folder, the first game installed in Steam is checked, and the answer names the other", () => {
  // Skyrim Special Edition in a Steam library, then Fallout 4 beside it.
  const sky = sandbox.makeWorld();
  const gameDir = join(sky.steamapps, "common", "Fallout 4");
  mkdirSync(join(gameDir, "Data", "F4SE", "Plugins"), { recursive: true });
  writeFileSync(join(gameDir, "Fallout4.exe"), buildPe({ version: [1, 11, 240, 0] }));
  writeFileSync(join(gameDir, "f4se_loader.exe"), buildPe({ version: [0, 0, 7, 9] }));
  writeFileSync(join(gameDir, "f4se_1_11_240.dll"), buildPe({ version: [0, 0, 7, 9] }));
  writeFileSync(
    join(sky.steamapps, "appmanifest_377160.acf"),
    ['"AppState"', "{", '\t"appid"\t\t"377160"', '\t"name"\t\t"Fallout 4"', '\t"StateFlags"\t\t"4"', '\t"installdir"\t\t"Fallout 4"', "}", ""].join("\n")
  );
  const both = checkPatchDay();
  assert.equal(both.ok, true, both.ok ? "" : both.error);
  if (!both.ok) return;
  assert.equal(both.game.id, "skyrimspecialedition");
  assert.equal(
    both.nextSteps.at(-1),
    'This checked Skyrim Special Edition, the first game it found. Fallout 4 is installed too: ask for it by name (gameId "fallout4") to check it.'
  );
  assert.match(summarizePatchDay(both), /Fallout 4 is installed too: ask for it by name \(gameId "fallout4"\)/);
  // Asked for by name, the other isn't mentioned.
  const named = checkPatchDay({ gameId: "fallout4" });
  assert.equal(named.ok && named.game.id, "fallout4");
  assert.ok(named.ok && !named.nextSteps.some((s) => /installed too/.test(s)));
  // With Skyrim gone from Steam, Fallout 4 is the one found.
  rmSync(join(sky.steamapps, "appmanifest_489830.acf"));
  const alone = checkPatchDay();
  assert.equal(alone.ok && alone.game.id, "fallout4");
  assert.ok(alone.ok && !alone.nextSteps.some((s) => /installed too/.test(s)));
});

test("a healthy Fallout 4 1.11.240 is a GO, with F4SE named everywhere and SKSE nowhere", () => {
  const w = fallout4();
  plugin(w, "Good.dll", { name: "Good", addressIndependence: AL137, structureIndependence: L137 });
  const r = run(w);
  assert.equal(r.verdict, "go");
  assert.deepEqual(r.game, { id: "fallout4", name: "Fallout 4" });
  assert.deepEqual(r.scriptExtender, { name: "F4SE", loaderPresent: true, expectedDll: "f4se_1_11_240.dll", dllPresent: true, version: "0.7.9", dllsInstalled: ["f4se_1_11_240.dll"] });
  assert.deepEqual(r.addressLibrary, { expectedFile: "version-1-11-240-0.bin", present: true, format: null, pluginsNeedingIt: 1 });
  assert.match(r.headline, /^GO — Fallout 4 1\.11\.240\.0: F4SE build present, Address Library present, the 1 plugin passes F4SE's own checks\./);
  assert.match(r.confidence.summary, /using F4SE 0\.7\.9's own rules/);
  const text = summarizePatchDay(r);
  assert.doesNotMatch(text, /SKSE/);
  assert.match(text, /F4SE: v0\.7\.9 \(f4se_1_11_240\.dll\)/);
});

test("a plugin pinned to the version before is refused on 1.11.240, in F4SE's own words", () => {
  const w = fallout4();
  plugin(w, "Old.dll", { name: "Old", compatibleVersions: [V(1, 11, 221)] });
  const r = run(w);
  assert.equal(r.verdict, "check");
  const p = r.plugins.problems[0]!;
  assert.deepEqual([p.file, p.status, p.basis, p.skseMessage], ["Old.dll", "broken", "f4se-source", "disabled, incompatible with current version of the game"]);
  assert.match(summarizePatchDay(r), /F4SE says: "disabled, incompatible with current version of the game"/);
  assert.deepEqual(r.nextPatch.pinned, [{ file: "Old.dll", supports: ["1.11.221.0"] }]);
  assert.match(r.nextPatch.note, /from F4SE 0\.7\.5 \(game 1\.11\.159\) on/);
});

test("no F4SE build for the game version: WAIT, naming the file and f4se.silverlock.org", () => {
  const w = fallout4({ game: [1, 11, 240], f4se: false });
  writeFileSync(join(w.gameDir, "f4se_loader.exe"), buildPe({ version: [0, 0, 7, 8] }));
  writeFileSync(join(w.gameDir, "f4se_1_11_221.dll"), buildPe({ version: [0, 0, 7, 8] }));
  const r = run(w);
  assert.equal(r.verdict, "wait");
  assert.match(r.headline, /F4SE is installed but has no build for this game version \(f4se_1_11_240\.dll is missing\)/);
  assert.ok(r.nextSteps.some((s) => /Get the F4SE build made for 1\.11\.240\.0 from f4se\.silverlock\.org/.test(s)), r.nextSteps.join("\n"));
});

test("a GOG copy needs F4SE's GOG build of the DLL", () => {
  const w = fallout4({ files: ["Galaxy64.dll"] });
  const r = run(w);
  assert.equal(r.scriptExtender.expectedDll, "f4se_1_11_240_gog.dll");
  assert.equal(r.verdict, "wait", "only the Steam build of the DLL is installed");
  writeFileSync(join(w.gameDir, "f4se_1_11_240_gog.dll"), buildPe({ version: [0, 0, 7, 9] }));
  const fixed = run(w);
  assert.equal(fixed.scriptExtender.dllPresent, true);
  assert.deepEqual(fixed.scriptExtender.dllsInstalled, ["f4se_1_11_240.dll", "f4se_1_11_240_gog.dll"]);
});

test("the Microsoft Store and Epic copies, which F4SE's loader refuses, are a CHECK that says so", () => {
  for (const [file, words] of [
    ["appxmanifest.xml", /F4SE doesn't support the Microsoft Store \(Game Pass\) version of Fallout 4: its loader refuses it, so F4SE plugins can't load on this copy/],
    ["EOSSDK-Win64-Shipping.dll", /F4SE doesn't support the Epic Games Store version of Fallout 4/],
  ] as const) {
    const r = run(fallout4({ files: [file] }));
    assert.equal(r.verdict, "check", file);
    assert.match(r.headline, words, file);
  }
});

test("before the Next-Gen update, an old-style plugin is fine on 1.10.163 and a Next-Gen one isn't", () => {
  const w = fallout4({ game: [1, 10, 163], library: false });
  writeFileSync(join(w.gameDir, "f4se_loader.exe"), buildPe({ version: [0, 0, 6, 23] }));
  writeFileSync(join(w.gameDir, "f4se_1_10_163.dll"), buildPe({ version: [0, 0, 6, 23] }));
  writeFileSync(join(w.plugins, "Classic.dll"), buildPe({ exports: [{ name: "F4SEPlugin_Query" }, { name: "F4SEPlugin_Load" }] }));
  plugin(w, "NextGen.dll", { name: "NextGen", addressIndependence: AL137, structureIndependence: L137 });
  const r = run(w);
  assert.equal(r.scriptExtender.version, "0.6.23");
  assert.deepEqual(
    r.plugins.problems.map((p) => [p.file, p.skseMessage]),
    [["NextGen.dll", "does not appear to be an F4SE plugin"]]
  );
  assert.ok(r.plugins.passed.includes("Classic.dll"));
  assert.match(r.confidence.summary, /F4SE also asks each plugin's own code \(F4SEPlugin_Query\) whether it accepts the game/);
  // Updating to the Next-Gen game: the old-style plugin has no version data.
  const ahead = run(w, { targetVersion: "1.10.984" });
  assert.ok(ahead.plugins.problems.some((p) => p.file === "Classic.dll" && p.skseMessage === "no version data"));
});

test("f4se.log from after the last patch is read: refusals, and a refusal the file check had passed", () => {
  const w = fallout4();
  plugin(w, "Good.dll", { name: "Good", addressIndependence: AL137, structureIndependence: L137 });
  plugin(w, "Old.dll", { name: "Old", compatibleVersions: [V(1, 11, 221)] });
  mkdirSync(join(w.log, ".."), { recursive: true });
  writeFileSync(
    w.log,
    [
      "F4SE runtime: initialize (version = 1.11.240 010B0F00 01DC2D3A2B3C4D5E, os = 6.2 (9200))",
      "scanning plugin directory C:\\Steam\\steamapps\\common\\Fallout 4\\Data\\F4SE\\Plugins\\",
      "checking plugin Good.dll",
      "checking plugin Old.dll",
      "plugin Old.dll (00000001 Old 01000000) disabled, incompatible with current version of the game 0 (handle 0)",
      "plugin Good.dll (00000001 Good 01000000) disabled, address library needs to be updated 0 (handle 0)",
      "",
    ].join("\r\n")
  );
  const later = new Date(Date.now() + 60_000);
  utimesSync(w.log, later, later);
  const r = run(w);
  assert.equal(r.log?.found, true);
  assert.equal(r.log?.fresh, true);
  assert.deepEqual(r.log?.refusals, ["Old.dll: disabled, incompatible with current version of the game", "Good.dll: disabled, address library needs to be updated"]);
  assert.deepEqual(r.log?.disagreements, ['Good.dll: F4SE logged "disabled, address library needs to be updated" but the file check passed it']);
  assert.equal(r.confidence.evidence, "log");
  assert.match(summarizePatchDay(r), /^F4SE's own log disagrees with the file check on 1 plugin:$/m);
});

test("an F4SE 0.6.23 log, which names each plugin by its full path and writes no handle, is read too", () => {
  const w = fallout4({ game: [1, 10, 163], library: false });
  writeFileSync(join(w.gameDir, "f4se_loader.exe"), buildPe({ version: [0, 0, 6, 23] }));
  writeFileSync(join(w.gameDir, "f4se_1_10_163.dll"), buildPe({ version: [0, 0, 6, 23] }));
  writeFileSync(join(w.plugins, "Classic.dll"), buildPe({ exports: [{ name: "F4SEPlugin_Query" }, { name: "F4SEPlugin_Load" }] }));
  writeFileSync(join(w.plugins, "Picky.dll"), buildPe({ exports: [{ name: "F4SEPlugin_Query" }, { name: "F4SEPlugin_Load" }] }));
  mkdirSync(join(w.log, ".."), { recursive: true });
  writeFileSync(
    w.log,
    [
      "checking plugin C:\\Users\\Jane Doe\\Games\\Fallout 4\\Data\\F4SE\\Plugins\\Classic.dll",
      "plugin C:\\Users\\Jane Doe\\Games\\Fallout 4\\Data\\F4SE\\Plugins\\Classic.dll (00000001 Classic 00000001) loaded correctly",
      "checking plugin C:\\Users\\Jane Doe\\Games\\Fallout 4\\Data\\F4SE\\Plugins\\Picky.dll",
      "plugin C:\\Users\\Jane Doe\\Games\\Fallout 4\\Data\\F4SE\\Plugins\\Picky.dll (00000001 Picky 00000001) reported as incompatible during query",
      "",
    ].join("\r\n")
  );
  const later = new Date(Date.now() + 60_000);
  utimesSync(w.log, later, later);
  const r = run(w);
  assert.equal(r.log?.pluginsLoaded, 1);
  assert.deepEqual(r.log?.refusals, ["Picky.dll: reported as incompatible during query"]);
  assert.ok(!JSON.stringify(r).includes("Jane"), "no folder from the log reaches the report");
});

test("F4SE 0.6.23's other refusals: a DLL that couldn't load, whatever its reason says, and one that isn't an F4SE plugin", () => {
  const w = fallout4({ game: [1, 10, 163], library: false });
  writeFileSync(join(w.gameDir, "f4se_loader.exe"), buildPe({ version: [0, 0, 6, 23] }));
  writeFileSync(join(w.gameDir, "f4se_1_10_163.dll"), buildPe({ version: [0, 0, 6, 23] }));
  for (const name of ["Needy.dll", "Plain.dll"]) writeFileSync(join(w.plugins, name), buildPe({ exports: [{ name: "F4SEPlugin_Query" }, { name: "F4SEPlugin_Load" }] }));
  writeFileSync(join(w.plugins, "Half.dll"), buildPe({ exports: [{ name: "F4SEPlugin_Load" }] }));
  writeFileSync(join(w.plugins, "Helper.dll"), buildPe({}));
  const folder = "C:\\Games\\Fallout 4\\Data\\F4SE\\Plugins\\";
  mkdirSync(join(w.log, ".."), { recursive: true });
  writeFileSync(
    w.log,
    [
      // A missing dependency: F4SE adds what it found missing after the error number, and a name can hold a bracket.
      `couldn't load plugin ${folder}Needy.dll (Error 126: failed to load Helper (x64).dll)`,
      `couldn't load plugin ${folder}Plain.dll (Error 193)`,
      `plugin ${folder}Half.dll does not appear to be an F4SE plugin`,
      // A support library that exports nothing F4SE looks for: F4SE says the same, and it isn't a refusal.
      `plugin ${folder}Helper.dll does not appear to be an F4SE plugin`,
      "",
    ].join("\r\n")
  );
  const later = new Date(Date.now() + 60_000);
  utimesSync(w.log, later, later);
  const r = run(w);
  assert.deepEqual(r.log?.refusals, [
    "Needy.dll: couldn't load plugin (error 126)",
    "Plain.dll: couldn't load plugin (error 193)",
    "Half.dll: does not appear to be an F4SE plugin",
  ]);
  // The file check passed the two that load and failed Half.dll, so F4SE's log disagrees about the two that didn't load.
  assert.deepEqual(r.log?.disagreements, [
    'Needy.dll: F4SE logged "couldn\'t load plugin" (error 126) but the file check passed it',
    'Plain.dll: F4SE logged "couldn\'t load plugin" (error 193) but the file check passed it',
  ]);
});
