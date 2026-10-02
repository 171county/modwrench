import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  checkPatchDay,
  PATCH_DAY_GAMES,
  readSkseLog,
  readSteamFacts,
  type PatchDayReport,
  type PatchDayResult,
} from "../src/patchday/index.js";
import type { PluginAssessment } from "../src/patchday/rules.js";
import {
  packVersion,
  VIX_ADDRESS_LIBRARY_V5 as V5,
  VI_ADDRESS_LIBRARY_POST_AE as AL,
  VI_SIGNATURES as SIG,
  VI_STRUCTS_POST_629 as S629,
} from "../src/patchday/skse.js";
import { summarizePatchDay } from "../src/patchday/summary.js";
import { registerWorkbenchTools } from "../src/register.js";
import { buildPe, skseVersionData } from "./helpers/pe-builder.js";

// ─── What these tests are ────────────────────────────────────────────────────
// End to end: real folders on disk laid out like a Skyrim install (a Steam
// library, the game's executable, SKSE, plugin DLLs, Address Library files, a
// Mod Organizer 2 instance, SKSE's log) and checkPatchDay pointed at them. The
// executables and DLLs are real PE images, built by the helper and cross-checked
// elsewhere against files a real toolchain produced.
//
// Every test runs with HOME, USERPROFILE, APPDATA, LOCALAPPDATA, STEAM_ROOT and
// WINEPREFIX pointed into a temp folder, so what the tool finds is only what the
// test built — never the Steam library of whoever runs the suite.

const ENV_KEYS = ["HOME", "USERPROFILE", "STEAM_ROOT", "LOCALAPPDATA", "APPDATA", "WINEPREFIX"] as const;
const saved: Record<string, string | undefined> = {};
let ROOT = "";

function isolate(): void {
  process.env.HOME = join(ROOT, "home");
  process.env.USERPROFILE = join(ROOT, "home");
  process.env.LOCALAPPDATA = join(ROOT, "home", "AppData", "Local");
  process.env.APPDATA = join(ROOT, "home", "AppData", "Roaming");
  process.env.STEAM_ROOT = join(ROOT, "no-steam-here");
  delete process.env.WINEPREFIX;
}

before(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  ROOT = mkdtempSync(join(tmpdir(), "mw-patchday-"));
  isolate();
});
afterEach(isolate);
after(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(ROOT, { recursive: true, force: true });
});

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const real = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: real, configurable: true });
  }
}

// ─── Building a world ────────────────────────────────────────────────────────

type V4 = [number, number, number, number];
const APP_ID = "489830";
const R5 = packVersion(1, 5, 97);
const R6 = packVersion(1, 6, 1170);

type World = { root: string; steam: string; steamapps: string; gameDir: string; plugins: string };

let worlds = 0;

/** A Steam library holding Skyrim SE: executable, SKSE loader and SKSE DLL(s), empty plugin folder. */
function makeWorld(
  o: {
    game?: V4;
    /** null = no script extender at all. */
    skse?: null | { loader?: boolean; dlls?: Array<[string, V4]> };
    manifest?: string;
  } = {}
): World {
  const root = join(ROOT, `w${worlds++}`);
  const steam = join(root, "steam");
  const steamapps = join(steam, "steamapps");
  const gameDir = join(steamapps, "common", "Skyrim Special Edition");
  const plugins = join(gameDir, "Data", "SKSE", "Plugins");
  mkdirSync(plugins, { recursive: true });
  writeFileSync(join(gameDir, "SkyrimSE.exe"), buildPe({ version: o.game ?? [1, 6, 1170, 0] }));
  const skse =
    o.skse === undefined
      ? { loader: true, dlls: [["skse64_1_6_1170.dll", [2, 2, 6, 0]]] as Array<[string, V4]> }
      : o.skse;
  if (skse) {
    if (skse.loader !== false) writeFileSync(join(gameDir, "skse64_loader.exe"), buildPe({ version: [2, 2, 6, 0] }));
    for (const [name, version] of skse.dlls ?? []) writeFileSync(join(gameDir, name), buildPe({ version }));
  }
  if (o.manifest !== undefined) writeFileSync(join(steamapps, `appmanifest_${APP_ID}.acf`), o.manifest);
  return { root, steam, steamapps, gameDir, plugins };
}

function put(dir: string, file: string, bytes: Buffer | string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), bytes);
}

/** A plugin as a current SKSE plugin is built: SKSEPlugin_Version data plus SKSEPlugin_Load. */
function modern(opts: Parameters<typeof skseVersionData>[0]): Buffer {
  return buildPe({
    exports: [{ name: "SKSEPlugin_Version", data: skseVersionData(opts) }, { name: "SKSEPlugin_Load" }],
  });
}
const goodPlugin = (): Buffer =>
  modern({
    name: "Good",
    versionIndependence: AL | S629,
    versionIndependenceEx: V5,
    seVersionRequired: packVersion(2, 2, 6),
  });
const pinnedTo = (...versions: number[]): Buffer => modern({ name: "Pinned", compatibleVersions: versions });
const legacyPlugin = (): Buffer =>
  buildPe({ exports: [{ name: "SKSEPlugin_Query" }, { name: "SKSEPlugin_Load" }] });
const lePlugin = (): Buffer => buildPe({ is64: false, exports: [{ name: "SKSEPlugin_Load" }] });
const supportLib = (): Buffer => buildPe({ exports: [{ name: "SomeHelperFunction" }] });
const notADll = (): Buffer => Buffer.from("this is not a dll");

function addressLibrary(format: number): Buffer {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(format, 0);
  return bytes;
}

function manifest(
  o: { stateFlags?: string; buildId?: string; target?: string; auto?: string; updated?: string } = {}
): string {
  return [
    '"AppState"',
    "{",
    `\t"appid"\t\t"${APP_ID}"`,
    '\t"name"\t\t"The Elder Scrolls V: Skyrim Special Edition"',
    `\t"StateFlags"\t\t"${o.stateFlags ?? "4"}"`,
    '\t"installdir"\t\t"Skyrim Special Edition"',
    ...(o.updated !== undefined ? [`\t"LastUpdated"\t\t"${o.updated}"`] : []),
    `\t"buildid"\t\t"${o.buildId ?? "100"}"`,
    ...(o.target !== undefined ? [`\t"TargetBuildID"\t\t"${o.target}"`] : []),
    ...(o.auto !== undefined ? [`\t"AutoUpdateBehavior"\t\t"${o.auto}"`] : []),
    "}",
    "",
  ].join("\n");
}

/** A healthy 1.6.1170 install: three plugins that all pass, and the Address Library file for them. */
function healthy(o: Parameters<typeof makeWorld>[0] = {}): World {
  const w = makeWorld(o);
  put(w.plugins, "good.dll", goodPlugin());
  put(w.plugins, "pinned.dll", pinnedTo(R6));
  put(w.plugins, "lib.dll", supportLib());
  put(w.plugins, "versionlib-1-6-1170-0.bin", addressLibrary(2));
  return w;
}

/** A complete Skyrim 1.7.104 install with SKSE 2.3.1 and a format-5 Address Library, two plugins that cope. */
function patched(): World {
  const w = makeWorld({ game: [1, 7, 104, 0], skse: { dlls: [["skse64_1_7_104.dll", [2, 3, 1, 0]]] } });
  put(w.plugins, "v5.dll", modern({ name: "V5", versionIndependence: AL | S629, versionIndependenceEx: V5 }));
  put(w.plugins, "sig.dll", modern({ name: "Sig", versionIndependence: SIG | S629 }));
  put(w.plugins, "versionlib-1-7-104-0.bin", addressLibrary(5));
  return w;
}

function ok(result: PatchDayResult): PatchDayReport {
  assert.equal(result.ok, true, result.ok ? "" : `${result.error} ${result.hint ?? ""}`);
  return result as PatchDayReport;
}
const problem = (r: PatchDayReport, file: string) => {
  const found = r.plugins.problems.find((p) => p.file === file);
  assert.ok(found, `no problem listed for ${file}; listed: ${r.plugins.problems.map((p) => p.file).join(", ")}`);
  return found;
};

// ─── A healthy install ───────────────────────────────────────────────────────

test("a healthy 1.6.1170 install is a GO, and the report says what a GO does and doesn't mean", () => {
  const w = healthy();
  const r = ok(checkPatchDay({ gamePath: w.gameDir }));

  assert.equal(r.verdict, "go");
  assert.equal(
    r.headline,
    "GO — Skyrim Special Edition 1.6.1170.0: SKSE build present, Address Library present, all 3 plugins pass SKSE's own checks. " +
      "That is what can be checked from files; it can't prove the game runs."
  );
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.game, { id: "skyrimspecialedition", name: "Skyrim Special Edition" });
  assert.deepEqual(r.checked, { version: "1.6.1170.0", source: "installed", installed: "1.6.1170.0" });

  assert.deepEqual(r.scriptExtender, {
    loaderPresent: true,
    expectedDll: "skse64_1_6_1170.dll",
    dllPresent: true,
    version: "2.2.6",
    dllsInstalled: ["skse64_1_6_1170.dll"],
  });
  assert.deepEqual(r.addressLibrary, {
    expectedFile: "versionlib-1-6-1170-0.bin",
    present: true,
    format: 2,
    pluginsNeedingIt: 1,
  });
  assert.equal(r.plugins.total, 3);
  assert.equal(r.plugins.ok, 3);
  assert.deepEqual(r.plugins.problems, []);
  assert.deepEqual([...r.plugins.passed].sort(), ["good.dll", "lib.dll", "pinned.dll"]);

  assert.equal(r.sources.gameFolderPlugins, 3);
  assert.equal(r.sources.mo2.used, false);
  assert.equal(r.steam, null, "no Steam record was built for this world");
  assert.equal(r.log, null);
});

test("a GO still looks ahead: which plugins are pinned to this version and will fail on the next one", () => {
  const w = healthy();
  put(w.plugins, "old-style.dll", legacyPlugin()); // broken now, but counted as legacy
  const r = ok(checkPatchDay({ gamePath: w.gameDir }));
  assert.deepEqual(r.nextPatch.pinned, [{ file: "pinned.dll", supports: ["1.6.1170.0"] }]);
  assert.equal(r.nextPatch.independent, 1);
  assert.equal(r.nextPatch.legacy, 1);
  assert.match(r.nextPatch.note, /pinned plugins list exact game versions/i);
});

test("with no SKSE log to compare against, the report asks for one launch and a re-run", () => {
  const r = ok(checkPatchDay({ gamePath: healthy().gameDir }));
  assert.equal(r.nextSteps.length, 1);
  assert.match(r.nextSteps[0]!, /Launch the game once through SKSE/);
  assert.equal(r.limits.length, 3, "the 1.7.x caveat is only for 1.7.x");
});

test("running it twice gives the same answer", () => {
  const w = healthy();
  assert.deepEqual(checkPatchDay({ gamePath: w.gameDir }), checkPatchDay({ gamePath: w.gameDir }));
});

// ─── After a patch ───────────────────────────────────────────────────────────

test("after a patch with no SKSE build for the new version: WAIT, and say which file is missing", () => {
  const w = makeWorld({ game: [1, 7, 104, 0] }); // the world's only SKSE DLL is the 1.6.1170 one
  put(w.plugins, "good.dll", goodPlugin());
  const r = ok(checkPatchDay({ gamePath: w.gameDir }));

  assert.equal(r.verdict, "wait");
  assert.match(r.headline, /^WAIT — Skyrim Special Edition 1\.7\.104\.0: SKSE is installed but has no build for this game version \(skse64_1_7_104\.dll is missing\)/);
  assert.deepEqual(r.reasons, ["skse64_1_7_104.dll not found next to the game executable"]);
  assert.deepEqual(r.scriptExtender, {
    loaderPresent: true,
    expectedDll: "skse64_1_7_104.dll",
    dllPresent: false,
    version: null,
    dllsInstalled: ["skse64_1_6_1170.dll"],
  });
  assert.match(r.nextSteps[0]!, /skse\.silverlock\.org.*skse64_1_7_104\.dll/);
});

test("a SKSE loader with no DLL at all is a WAIT too", () => {
  const w = makeWorld({ skse: { loader: true, dlls: [] } });
  const r = ok(checkPatchDay({ gamePath: w.gameDir }));
  assert.equal(r.verdict, "wait");
  assert.deepEqual(r.scriptExtender.dllsInstalled, []);
});

test("on 1.7.104 with everything in place, plugins are judged by the new rules, and the answer is a CHECK", () => {
  const w = patched();
  put(w.plugins, "oldal.dll", modern({ name: "OldAL", versionIndependence: AL | S629 })); // no format-5 flag
  const r = ok(checkPatchDay({ gamePath: w.gameDir }));

  assert.equal(r.verdict, "check");
  assert.match(r.headline, /^CHECK — Skyrim Special Edition 1\.7\.104\.0: 1 plugin would be refused or fail; /);
  assert.match(r.headline, /SKSE's rules for this game version aren't public/);
  assert.equal(r.scriptExtender.version, "2.3.1");
  assert.deepEqual(r.addressLibrary, {
    expectedFile: "versionlib-1-7-104-0.bin",
    present: true,
    format: 5,
    pluginsNeedingIt: 2,
  });
  assert.equal(r.plugins.total, 3);
  assert.equal(r.plugins.ok, 2);
  assert.equal(r.plugins.broken, 1);

  const line = problem(r, "oldal.dll");
  assert.equal(line.status, "broken");
  assert.equal(line.basis, "field-reports");
  assert.equal(line.skseMessage, undefined, "no SKSE source to quote for this one, and none is invented");
  assert.match(line.reason, /Unsupported address library format: 5/);
  assert.equal(line.name, "OldAL");

  assert.equal(r.limits.length, 4);
  assert.match(r.limits[3]!, /SKSE 2\.3\.x.*not open source/);
  assert.equal(r.nextSteps.length, 2);
});

test("the same 1.7.104 install without the plugin that lacks format 5 passes the file checks but still isn't called safe", () => {
  const r = ok(checkPatchDay({ gamePath: patched().gameDir }));
  assert.equal(r.verdict, "check");
  assert.deepEqual(r.plugins.problems, []);
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0]!, /aren't public/);
});

// ─── What if I update? ───────────────────────────────────────────────────────

test("targetVersion asks 'what would happen if I updated', stage by stage as the pieces arrive", () => {
  const w = healthy();
  const ask = (targetVersion: string) => ok(checkPatchDay({ gamePath: w.gameDir, targetVersion }));

  // 1. No SKSE build for the new version yet.
  const noSkse = ask("1.7.104");
  assert.equal(noSkse.verdict, "wait");
  assert.match(noSkse.headline, /^WAIT — If you update Skyrim Special Edition to 1\.7\.104\.0: SKSE has no build for it installed \(skse64_1_7_104\.dll is missing\)/);
  assert.deepEqual(noSkse.checked, { version: "1.7.104.0", source: "targetVersion", installed: "1.6.1170.0" });

  // 2. SKSE's build is in place, but the Address Library for that version isn't.
  writeFileSync(join(w.gameDir, "skse64_1_7_104.dll"), buildPe({ version: [2, 3, 1, 0] }));
  const noLibrary = ask("1.7.104");
  assert.equal(noLibrary.verdict, "wait");
  assert.match(noLibrary.headline, /1 plugin needs the Address Library file for this game version \(versionlib-1-7-104-0\.bin\) and it isn't installed/);

  // 3. Both are in place: the plugin pinned to 1.6.1170 is what would break.
  put(w.plugins, "versionlib-1-7-104-0.bin", addressLibrary(5));
  const complete = ask("1.7.104");
  assert.equal(complete.verdict, "check");
  assert.equal(complete.plugins.broken, 1);
  const line = problem(complete, "pinned.dll");
  assert.equal(line.skseMessage, "disabled, incompatible with current version of the game");
  assert.equal(line.basis, "inferred", "SKSE has no published source for 1.7.x");
  assert.equal(complete.nextSteps.length, 1, "a what-if doesn't tell you to launch the game");
  assert.match(complete.nextSteps[0]!, /broken plugin/);
});

test("targetVersion accepts the forms people type, and naming the installed version is not a what-if", () => {
  const w = healthy();
  for (const text of ["1.7.104", "1.7.104.0", "v1.7.104", "  1.7.104 "]) {
    assert.equal(ok(checkPatchDay({ gamePath: w.gameDir, targetVersion: text })).checked.version, "1.7.104.0", text);
  }
  const same = ok(checkPatchDay({ gamePath: w.gameDir, targetVersion: "1.6.1170" }));
  assert.equal(same.checked.source, "installed");
  assert.equal(same.verdict, "go");
});

test("a what-if ignores Steam's update flag and SKSE's old log, which describe the installed version", () => {
  const w = healthy({ manifest: manifest({ stateFlags: "6", buildId: "100", target: "101" }) });
  writeFileSync(join(w.gameDir, "skse64_1_6_1179.dll"), buildPe({ version: [2, 2, 6, 0] }));
  put(w.plugins, "versionlib-1-6-1179-0.bin", addressLibrary(2));
  const logPath = join(w.root, "skse64.log");
  writeFileSync(logPath, "plugin Data\\SKSE\\Plugins\\good.dll (00000001 Good 00000001) disabled, bad version data\n");
  // pinned.dll is pinned to 1.6.1170; on 1.6.1179 it would be refused, which is the one reason to CHECK.
  const r = ok(checkPatchDay({ gamePath: w.gameDir, targetVersion: "1.6.1179", logPath }));
  assert.equal(r.verdict, "check");
  assert.deepEqual(r.reasons, ["1 plugin would be refused or fail"]);
  assert.equal(r.steam?.updatePending, true, "still reported");
  assert.equal(r.log?.found, true, "still reported");
});

// ─── The zoo: every kind of problem plugin ───────────────────────────────────

test("every kind of problem plugin is named in SKSE's own words, worst first, and non-plugins are ignored", () => {
  const w = makeWorld();
  put(w.plugins, "good.dll", goodPlugin());
  put(w.plugins, "UPPER.DLL", goodPlugin()); // extension case doesn't matter
  put(w.plugins, "legacy.dll", legacyPlugin());
  put(w.plugins, "le.dll", lePlugin());
  put(w.plugins, "junk.dll", notADll());
  put(w.plugins, "pinned-old.dll", modern({ name: "PinnedOld", compatibleVersions: [R5] }));
  put(
    w.plugins,
    "newse.dll",
    modern({ name: "NewSE", versionIndependence: AL | S629, versionIndependenceEx: V5, seVersionRequired: packVersion(2, 9, 0) })
  );
  put(w.plugins, "notes.txt", "not a plugin");
  put(join(w.plugins, "sub"), "deep.dll", legacyPlugin()); // SKSE doesn't look in subfolders, so neither do we
  put(w.plugins, "versionlib-1-6-1170-0.bin", addressLibrary(2));

  const r = ok(checkPatchDay({ gamePath: w.gameDir }));
  assert.equal(r.verdict, "check");
  assert.equal(r.plugins.total, 7);
  assert.equal(r.plugins.ok, 2);
  assert.equal(r.plugins.broken, 4);
  assert.equal(r.plugins.unclear, 1);
  assert.deepEqual(r.plugins.problems.map((p) => p.status), ["broken", "broken", "broken", "broken", "unclear"]);
  assert.deepEqual([...r.plugins.passed].sort(), ["UPPER.DLL", "good.dll"]);
  assert.equal(r.sources.gameFolderPlugins, 7);

  const legacy = problem(r, "legacy.dll");
  assert.equal(legacy.skseMessage, "no version data");
  assert.equal(legacy.binding, "legacy");
  assert.equal(legacy.basis, "skse-source");
  assert.equal(legacy.source, "game");
  assert.equal(problem(r, "le.dll").skseMessage, "LE plugin cannot be used with SE");
  const pinned = problem(r, "pinned-old.dll");
  assert.equal(pinned.skseMessage, "disabled, incompatible with current version of the game");
  assert.equal(pinned.name, "PinnedOld");
  assert.equal(pinned.binding, "pinned");
  const newse = problem(r, "newse.dll");
  assert.equal(newse.skseMessage, "disabled, requires newer script extender");
  assert.match(newse.reason, /SKSE 2\.9\.0 or newer; the installed build is 2\.2\.6/);
  const junk = problem(r, "junk.dll");
  assert.equal(junk.status, "unclear");
  assert.equal(junk.skseMessage, undefined);
  assert.match(junk.reason, /couldn't read this file/);

  assert.deepEqual(r.reasons, ["4 plugins would be refused or fail", "1 plugin couldn't be judged"]);
  assert.deepEqual(r.nextPatch.pinned, [{ file: "pinned-old.dll", supports: ["1.5.97.0"] }]);
  assert.equal(r.nextPatch.independent, 3);
  assert.equal(r.nextPatch.legacy, 1);
  assert.match(r.nextSteps[0]!, /broken plugin.*mod page/);
});

// ─── No SKSE at all ──────────────────────────────────────────────────────────

test("a game with no script extender and no plugins has nothing for a patch to break", () => {
  const r = ok(checkPatchDay({ gamePath: makeWorld({ skse: null }).gameDir }));
  assert.equal(r.verdict, "go");
  assert.match(r.headline, /no script extender and no SKSE plugins are installed/);
  assert.equal(r.scriptExtender.loaderPresent, false);
  assert.equal(r.scriptExtender.dllPresent, false);
  assert.equal(r.scriptExtender.version, null);
  assert.deepEqual(r.scriptExtender.dllsInstalled, []);
});

test("plugins sitting in a game with no script extender are called out, not waved through", () => {
  const w = makeWorld({ skse: null });
  put(w.plugins, "good.dll", goodPlugin());
  const r = ok(checkPatchDay({ gamePath: w.gameDir }));
  assert.equal(r.verdict, "check");
  assert.match(r.headline, /1 SKSE plugin is installed but the script extender isn't \(no skse64_loader\.exe next to the game\), so it isn't loading now/);
});

// ─── Mod Organizer 2 ─────────────────────────────────────────────────────────

/** An MO2 instance: modlist.txt lists highest priority first, as MO2 writes it. */
function makeMo2(
  w: World,
  o: {
    mods: Record<string, Record<string, Buffer | string>>;
    modlist: string[];
    overwrite?: Record<string, Buffer | string>;
    extraProfiles?: Record<string, string[]>;
  }
): string {
  const instance = join(w.root, "mo2");
  mkdirSync(join(instance, "profiles", "Default"), { recursive: true });
  writeFileSync(
    join(instance, "ModOrganizer.ini"),
    "[General]\ngameName=Skyrim Special Edition\nselected_profile=@ByteArray(Default)\n"
  );
  const list = (lines: string[]): string => ["# This file was automatically generated by Mod Organizer.", ...lines, ""].join("\n");
  writeFileSync(join(instance, "profiles", "Default", "modlist.txt"), list(o.modlist));
  for (const [name, lines] of Object.entries(o.extraProfiles ?? {})) {
    mkdirSync(join(instance, "profiles", name), { recursive: true });
    writeFileSync(join(instance, "profiles", name, "modlist.txt"), list(lines));
  }
  for (const [mod, files] of Object.entries(o.mods)) {
    for (const [file, bytes] of Object.entries(files)) put(join(instance, "mods", mod, "SKSE", "Plugins"), file, bytes);
  }
  for (const [file, bytes] of Object.entries(o.overwrite ?? {})) put(join(instance, "overwrite", "SKSE", "Plugins"), file, bytes);
  put(join(instance, "mods", "TexturesOnly", "textures"), "a.dds", "x"); // an enabled mod with no plugins
  return instance;
}

function mo2World(overwrite: Record<string, Buffer | string> = { "over.dll": goodPlugin() }): { w: World; instance: string } {
  const w = makeWorld();
  put(w.plugins, "base.dll", goodPlugin());
  const instance = makeMo2(w, {
    mods: {
      LowMod: { "shared.dll": lePlugin(), "versionlib-1-6-1170-0.bin": addressLibrary(2) },
      HighMod: { "shared.dll": goodPlugin() },
      OffMod: { "off.dll": legacyPlugin() },
    },
    // Top of the file is the highest priority.
    modlist: ["+HighMod", "+TexturesOnly", "+LowMod", "-OffMod"],
    overwrite,
    extraProfiles: { Alt: ["+OffMod"] },
  });
  return { w, instance };
}

test("Mod Organizer 2: enabled mods and overwrite are read, the higher priority wins, and an Address Library inside a mod counts", () => {
  const { w, instance } = mo2World();
  const r = ok(checkPatchDay({ gamePath: w.gameDir, mo2InstancePath: instance }));

  assert.equal(r.sources.mo2.used, true);
  assert.equal(r.sources.mo2.profile, "Default");
  assert.equal(r.sources.mo2.modsWithPlugins, 2, "LowMod and HighMod have plugins; TexturesOnly and the disabled OffMod don't count");
  assert.equal(r.sources.gameFolderPlugins, 1);
  assert.equal(r.plugins.total, 3, "base.dll, shared.dll (HighMod's copy) and over.dll");
  assert.equal(r.addressLibrary.present, true, "found in LowMod");
  assert.equal(r.verdict, "go");
  assert.deepEqual(r.plugins.problems, [], "LowMod's broken shared.dll is shadowed by HighMod's, and OffMod is disabled");
});

test("Mod Organizer 2: the overwrite folder outranks every mod, and the problem says where it came from", () => {
  const { w, instance } = mo2World({ "shared.dll": lePlugin() });
  const r = ok(checkPatchDay({ gamePath: w.gameDir, mo2InstancePath: instance }));
  assert.equal(r.verdict, "check");
  const line = problem(r, "shared.dll");
  assert.equal(line.source, "mo2:overwrite");
  assert.equal(line.skseMessage, "LE plugin cannot be used with SE");
});

test("Mod Organizer 2: a lower-priority copy shows up when the copy above it is switched off", () => {
  const w = makeWorld();
  const instance = makeMo2(w, {
    mods: { LowMod: { "shared.dll": lePlugin() }, HighMod: { "shared.dll": goodPlugin() } },
    modlist: ["-HighMod", "+LowMod"],
  });
  const r = ok(checkPatchDay({ gamePath: w.gameDir, mo2InstancePath: instance }));
  assert.equal(problem(r, "shared.dll").source, "mo2:LowMod");
});

test("Mod Organizer 2: another profile is a different set of plugins, and a missing Address Library there is a WAIT", () => {
  const { w, instance } = mo2World();
  const r = ok(checkPatchDay({ gamePath: w.gameDir, mo2InstancePath: instance, profileName: "Alt" }));
  assert.equal(r.sources.mo2.profile, "Alt");
  assert.equal(problem(r, "off.dll").source, "mo2:OffMod");
  assert.equal(r.addressLibrary.present, false, "the Address Library lives in LowMod, which this profile leaves off");
  assert.equal(r.verdict, "wait");
});

test("Mod Organizer 2: an instance with no readable profile says so and falls back to the game folder", () => {
  const { w, instance } = mo2World();
  const r = ok(checkPatchDay({ gamePath: w.gameDir, mo2InstancePath: instance, profileName: "Nope" }));
  assert.equal(r.sources.mo2.used, false);
  assert.match(r.sources.mo2.reason, /profile/);
  assert.equal(r.plugins.total, 1);
});

test("Mod Organizer 2: a folder that isn't an instance is reported as such", () => {
  const w = makeWorld();
  mkdirSync(join(w.root, "not-an-instance"));
  const r = ok(checkPatchDay({ gamePath: w.gameDir, mo2InstancePath: join(w.root, "not-an-instance") }));
  assert.equal(r.sources.mo2.used, false);
  assert.match(r.sources.mo2.reason, /no Mod Organizer 2 instance/);
});

test("without MO2 in sight, only the game folder is read, and the report says why", () => {
  const r = ok(checkPatchDay({ gamePath: healthy().gameDir }));
  assert.equal(r.sources.mo2.used, false);
  assert.match(r.sources.mo2.reason, /doesn't look like the active manager/);
});

test("Mod Organizer 2 is found on its own where MO2 keeps its instances", () => {
  const w = makeWorld();
  process.env.STEAM_ROOT = w.steam;
  writeFileSync(join(w.steamapps, `appmanifest_${APP_ID}.acf`), manifest());
  // On Windows MO2 keeps instances under %LOCALAPPDATA%; on Linux and the Deck it runs inside a Proton prefix.
  const instancesRoot =
    process.platform === "win32"
      ? join(process.env.LOCALAPPDATA!, "ModOrganizer")
      : join(w.steamapps, "compatdata", "12345", "pfx", "drive_c", "users", "steamuser", "AppData", "Local", "ModOrganizer");
  const instance = join(instancesRoot, "Skyrim SE");
  mkdirSync(join(instance, "profiles", "Default"), { recursive: true });
  writeFileSync(join(instance, "ModOrganizer.ini"), "[General]\ngameName=Skyrim Special Edition\nselected_profile=@ByteArray(Default)\n");
  writeFileSync(join(instance, "profiles", "Default", "modlist.txt"), "+Mod\n");
  put(join(instance, "mods", "Mod", "SKSE", "Plugins"), "found-by-mo2.dll", legacyPlugin());

  const r = ok(checkPatchDay({}));
  assert.equal(r.sources.mo2.used, true);
  assert.equal(problem(r, "found-by-mo2.dll").source, "mo2:Mod");
});

// ─── Steam ───────────────────────────────────────────────────────────────────

test("the game is found through Steam when no folder is given", () => {
  const w = healthy({ manifest: manifest() });
  process.env.STEAM_ROOT = w.steam;
  const r = ok(checkPatchDay());
  assert.equal(r.verdict, "go");
  assert.equal(r.scriptExtender.dllPresent, true);
});

test("with no Steam library and no folder, it says what to pass instead of guessing", () => {
  const r = checkPatchDay();
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /Couldn't find Skyrim Special Edition in any Steam library/);
  assert.match(r.hint ?? "", /gamePath/);
  assert.deepEqual(r.supportedGames, ["skyrimspecialedition"]);
});

test("Steam's own record of a waiting update turns a GO into a CHECK", () => {
  const w = healthy({ manifest: manifest({ stateFlags: "6", buildId: "100", target: "101", auto: "1", updated: "1788220800" }) });
  const r = ok(checkPatchDay({ gamePath: w.gameDir }));
  assert.deepEqual(r.steam, {
    updatePending: true,
    buildId: "100",
    targetBuildId: "101",
    autoUpdate: "on-launch",
    lastUpdated: "2026-09-01",
  });
  assert.equal(r.verdict, "check");
  assert.deepEqual(r.reasons, ["Steam has a game update waiting"]);
  assert.ok(r.nextSteps.some((s) => /Steam has an update waiting.*never changes Steam settings/.test(s)));
});

test("Steam facts: what counts as an update waiting, and what doesn't", () => {
  const cases: Array<[string, Parameters<typeof manifest>[0], boolean]> = [
    ["flags say update required", { stateFlags: "6" }, true],
    ["flags say update required, nothing else", { stateFlags: "2" }, true],
    ["target build differs from the installed build", { stateFlags: "4", buildId: "100", target: "101" }, true],
    ["target build equals the installed build", { stateFlags: "4", buildId: "100", target: "100" }, false],
    ["target build is zero (none queued)", { stateFlags: "4", buildId: "100", target: "0" }, false],
    ["fully installed, no target", { stateFlags: "4" }, false],
  ];
  const w = makeWorld();
  const file = join(w.steamapps, "probe.acf");
  for (const [label, spec, pending] of cases) {
    writeFileSync(file, manifest(spec));
    assert.equal(readSteamFacts(file)?.updatePending, pending, label);
  }
});

test("Steam facts: the update setting is named, an unknown value is passed through, and bad files are null", () => {
  const w = makeWorld();
  const file = join(w.steamapps, "probe.acf");
  for (const [raw, named] of [["0", "always"], ["1", "on-launch"], ["2", "high-priority"], ["9", "9"]] as const) {
    writeFileSync(file, manifest({ auto: raw }));
    assert.equal(readSteamFacts(file)?.autoUpdate, named, raw);
  }
  writeFileSync(file, "this is not a manifest");
  assert.equal(readSteamFacts(file), null);
  assert.equal(readSteamFacts(join(w.steamapps, "missing.acf")), null);
  writeFileSync(file, manifest());
  assert.equal(readSteamFacts(file)?.lastUpdated, undefined, "no LastUpdated, no invented date");
});

test("a damaged Steam record is ignored rather than fatal", () => {
  const w = healthy({ manifest: "not vdf at all" });
  const r = ok(checkPatchDay({ gamePath: w.gameDir }));
  assert.equal(r.steam, null);
  assert.equal(r.verdict, "go");
});

// ─── SKSE's own log ──────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

function setTime(path: string, when: number): void {
  utimesSync(path, new Date(when), new Date(when));
}

/** The exe is "patched" ten days ago; a log written after that is fresh, one written before it is stale. */
function logFor(w: World, lines: string[], age: "fresh" | "stale"): string {
  const now = Date.now();
  setTime(join(w.gameDir, "SkyrimSE.exe"), now - 10 * DAY);
  const path = join(w.root, "skse64.log");
  writeFileSync(path, lines.join("\r\n") + "\r\n");
  setTime(path, age === "fresh" ? now - DAY : now - 20 * DAY);
  return path;
}

const LOADED = [
  "skse64 loader v2.2.6 ...",
  "checking plugin Data\\SKSE\\Plugins\\good.dll",
  "plugin Data\\SKSE\\Plugins\\good.dll (00000001 Good 00000001) loaded correctly (handle 1)",
  "plugin Data\\SKSE\\Plugins\\pinned.dll (00000001 Pinned 00000001) loaded correctly (handle 2)",
];

test("a log written after the last patch, with nothing refused, is the strongest evidence and the report uses it", () => {
  const w = healthy();
  const r = ok(checkPatchDay({ gamePath: w.gameDir, logPath: logFor(w, LOADED, "fresh") }));
  assert.equal(r.verdict, "go");
  assert.equal(r.log?.found, true);
  assert.equal(r.log?.fresh, true);
  assert.equal(r.log?.pluginsLoaded, 2);
  assert.deepEqual(r.log?.refusals, []);
  assert.deepEqual(r.log?.disagreements, []);
  assert.match(r.log?.modified ?? "", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}Z$/);
  assert.equal(r.nextSteps.length, 0, "nothing left to ask the person to do");
});

test("a log from before the last patch describes a different game, and the report says to launch again", () => {
  const w = healthy();
  const r = ok(checkPatchDay({ gamePath: w.gameDir, logPath: logFor(w, LOADED, "stale") }));
  assert.equal(r.log?.found, true);
  assert.equal(r.log?.fresh, false);
  assert.ok(r.nextSteps.some((s) => /Launch the game once/.test(s)));
});

test("when SKSE refused a plugin the file check passed, that disagreement is the headline, with the path scrubbed", () => {
  const w = healthy();
  const refusal =
    "plugin C:\\Users\\Jane Doe\\Games\\Skyrim Special Edition\\Data\\SKSE\\Plugins\\good.dll (00000001 Good 00000001) disabled, incompatible with current version of the game";
  const r = ok(checkPatchDay({ gamePath: w.gameDir, logPath: logFor(w, [...LOADED, refusal], "fresh") }));
  assert.equal(r.verdict, "check");
  assert.deepEqual(r.reasons, ["SKSE's own log from the last launch disagrees with these predictions"]);
  assert.equal(r.log?.refusals.length, 1);
  assert.equal(r.log?.disagreements.length, 1);
  const shown = JSON.stringify(r.log);
  assert.match(r.log!.disagreements[0]!, /^good\.dll: SKSE logged "plugin <path>\\good\.dll \(00000001 Good 00000001\) disabled, incompatible with current version of the game" but the file check passed it$/);
  assert.doesNotMatch(shown, /Jane|Doe|Users|C:/);
});

test("a refusal the file check had already predicted is not a disagreement", () => {
  const w = healthy();
  put(w.plugins, "legacy.dll", legacyPlugin());
  const line = "plugin Data\\SKSE\\Plugins\\legacy.dll (00000000 Legacy 00000000) disabled, no version data";
  const r = ok(checkPatchDay({ gamePath: w.gameDir, logPath: logFor(w, [...LOADED, line], "fresh") }));
  assert.equal(r.log?.refusals.length, 1);
  assert.deepEqual(r.log?.disagreements, []);
  assert.deepEqual(r.reasons, ["1 plugin would be refused or fail"]);
});

test("a log that isn't there is reported as not found, not as an error", () => {
  const w = healthy();
  const r = ok(checkPatchDay({ gamePath: w.gameDir, logPath: join(w.root, "never-written.log") }));
  assert.deepEqual(r.log, { found: false, fresh: false, pluginsLoaded: 0, refusals: [], disagreements: [] });
  assert.equal(r.verdict, "go");
  assert.ok(r.nextSteps.some((s) => /Launch the game once/.test(s)));
});

test("on 1.7.x a clean, fresh log is what turns a prediction into a GO", () => {
  const w = patched();
  const without = ok(checkPatchDay({ gamePath: w.gameDir }));
  assert.equal(without.verdict, "check");

  const clean = ok(
    checkPatchDay({
      gamePath: w.gameDir,
      logPath: logFor(
        w,
        [
          "plugin Data\\SKSE\\Plugins\\v5.dll (00000001 V5 00000001) loaded correctly (handle 1)",
          "plugin Data\\SKSE\\Plugins\\sig.dll (00000001 Sig 00000001) loaded correctly (handle 2)",
        ],
        "fresh"
      ),
    })
  );
  assert.equal(clean.verdict, "go");
  assert.deepEqual(clean.reasons, []);
});

test("on 1.7.x a log with refusals keeps it a CHECK even when the predictions were clean", () => {
  const w = patched();
  const line = "plugin Data\\SKSE\\Plugins\\v5.dll (00000001 V5 00000001) disabled, unsupported version independence method";
  const r = ok(checkPatchDay({ gamePath: w.gameDir, logPath: logFor(w, [line], "fresh") }));
  assert.equal(r.verdict, "check");
  assert.equal(r.log?.disagreements.length, 1);
});

test("SKSE's log is found where Proton keeps Documents on Linux and the Steam Deck", () => {
  const w = healthy();
  const log = join(w.steamapps, "compatdata", APP_ID, "pfx", "drive_c", "users", "steamuser", "Documents", "My Games", "Skyrim Special Edition", "SKSE");
  put(log, "skse64.log", LOADED.join("\n"));
  const r = ok(withPlatform("linux", () => checkPatchDay({ gamePath: w.gameDir })));
  assert.equal(r.log?.found, true);
  assert.equal(r.log?.pluginsLoaded, 2);
});

test("SKSE's log is found in Documents on Windows, including OneDrive-redirected Documents and the GOG folder name", () => {
  for (const [docs, folder] of [
    [["Documents"], "Skyrim Special Edition"],
    [["OneDrive", "Documents"], "Skyrim Special Edition"],
    [["Documents"], "Skyrim Special Edition GOG"],
  ] as const) {
    const w = healthy();
    put(join(ROOT, "home", ...docs, "My Games", folder, "SKSE"), "skse64.log", LOADED.join("\n"));
    const r = ok(withPlatform("win32", () => checkPatchDay({ gamePath: w.gameDir })));
    assert.equal(r.log?.found, true, `${docs.join("/")} / ${folder}`);
    rmSync(join(ROOT, "home", docs[0]), { recursive: true, force: true });
  }
});

// ─── readSkseLog on its own ──────────────────────────────────────────────────

const assessed = (...files: string[]): Map<string, PluginAssessment> =>
  new Map(files.map((f) => [f.toLowerCase(), { status: "ok", binding: "independent", reason: "x", basis: "inferred" } as PluginAssessment]));

function tempLog(text: string): string {
  const dir = join(ROOT, `log${worlds++}`);
  mkdirSync(dir);
  const path = join(dir, "skse64.log");
  writeFileSync(path, text);
  return path;
}

test("readSkseLog: only plugin lines count; CRLF, indentation and capital letters don't matter", () => {
  const path = tempLog(
    [
      "skse64 loader v2.2.6",
      "  Plugin Data\\SKSE\\Plugins\\a.dll (1 A 1) loaded correctly",
      "PLUGIN Data\\SKSE\\Plugins\\b.dll (1 B 1) disabled, bad version data",
      "checking plugin Data\\SKSE\\Plugins\\c.dll disabled, no name specified",
      "plugin Data\\SKSE\\Plugins\\d.dll (1 D 1) something unrelated",
    ].join("\r\n")
  );
  const facts = readSkseLog(path, 0, assessed("a.dll", "b.dll"));
  assert.equal(facts.pluginsLoaded, 1);
  assert.equal(facts.refusals.length, 1);
  assert.match(facts.refusals[0]!, /b\.dll.*disabled, bad version data/);
  assert.equal(facts.disagreements.length, 1, "b.dll was predicted ok");
});

test("readSkseLog: file names match the file check whatever their case, and by name rather than folder", () => {
  const path = tempLog("plugin D:\\Elsewhere\\Mods\\FOO.DLL (1 Foo 1) disabled, no version data\n");
  const facts = readSkseLog(path, 0, assessed("foo.dll"));
  assert.match(facts.disagreements[0]!, /^FOO\.DLL: SKSE logged/);
});

test("readSkseLog: a refusal for a plugin the file check never saw is a refusal, not a disagreement", () => {
  const facts = readSkseLog(tempLog("plugin Data\\SKSE\\Plugins\\mystery.dll (1 M 1) disabled, bad version data\n"), 0, assessed("other.dll"));
  assert.equal(facts.refusals.length, 1);
  assert.deepEqual(facts.disagreements, []);
});

test("readSkseLog: fresh means modified at or after the reference time", () => {
  const path = tempLog("");
  const when = Date.UTC(2026, 8, 1);
  setTime(path, when);
  assert.equal(readSkseLog(path, when, new Map()).fresh, true);
  assert.equal(readSkseLog(path, when + 1, new Map()).fresh, false);
  assert.equal(readSkseLog(path, when - 1, new Map()).fresh, true);
});

test("readSkseLog: output is bounded — at most 40 refusals, 240 characters a line", () => {
  const long = "plugin Data\\SKSE\\Plugins\\x.dll (1 X 1) disabled, " + "very long reason ".repeat(100);
  const many = Array.from({ length: 100 }, (_, i) => `plugin Data\\SKSE\\Plugins\\p${i}.dll (1 P 1) disabled, bad version data`);
  const facts = readSkseLog(tempLog([long, ...many].join("\n")), 0, new Map());
  assert.equal(facts.refusals.length, 40);
  assert.ok(facts.refusals.every((l) => l.length <= 240));
});

test("readSkseLog: an enormous log is read only to a limit", () => {
  const filler = "x".repeat(1023) + "\n";
  const head = "plugin Data\\SKSE\\Plugins\\early.dll (1 E 1) disabled, bad version data\n";
  const tail = "plugin Data\\SKSE\\Plugins\\late.dll (1 L 1) disabled, bad version data\n";
  const path = tempLog(head + filler.repeat(9 * 1024) + tail); // ~9 MB, the limit is 8
  const facts = readSkseLog(path, 0, new Map());
  assert.equal(facts.refusals.length, 1);
  assert.match(facts.refusals[0]!, /early\.dll/);
});

test("readSkseLog: scrubbing keeps file names and drops folders, even with spaces in them", () => {
  const lines = [
    "plugin C:\\Program Files (x86)\\Steam\\steamapps\\common\\Skyrim Special Edition\\Data\\SKSE\\Plugins\\Foo.dll (1 Foo 1) disabled, bad version data",
    "plugin Z:\\home\\jane\\.steam\\steam\\steamapps\\common\\Skyrim Special Edition\\Data\\SKSE\\Plugins\\Bar.dll (1 Bar 1) disabled, bad version data",
    "plugin Data\\SKSE\\Plugins\\Baz.dll (1 Baz 1) disabled, bad version data",
    "fatal error occurred while loading plugin C:\\Users\\Jane Doe\\Games\\X Y\\Data\\SKSE\\Plugins\\Qux.dll",
    "plugin C:\\Users\\Jane Doe\\no-file-name-at-the-end disabled, no version data",
  ];
  const facts = readSkseLog(tempLog(lines.join("\n")), 0, new Map());
  assert.deepEqual(facts.refusals, [
    "plugin <path>\\Foo.dll (1 Foo 1) disabled, bad version data",
    "plugin <path>\\Bar.dll (1 Bar 1) disabled, bad version data",
    "plugin Data\\SKSE\\Plugins\\Baz.dll (1 Baz 1) disabled, bad version data",
    // A drive path with no file name at its end: the rest of the line goes with it.
    "plugin <path>",
  ]);
  assert.doesNotMatch(JSON.stringify(facts), /Jane|Doe|Program Files|steamapps|Users/);
});

// ─── Errors ──────────────────────────────────────────────────────────────────

test("a game Patch Day doesn't cover yet says so and names what it does cover", () => {
  const r = checkPatchDay({ gameId: "fallout4" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /can't check "fallout4" yet/);
  assert.match(r.hint ?? "", /Fallout 4 \(F4SE\) is next/);
  assert.deepEqual(r.supportedGames, PATCH_DAY_GAMES);
  assert.deepEqual(PATCH_DAY_GAMES, ["skyrimspecialedition"]);
});

test("naming the covered game explicitly works the same as leaving it out", () => {
  const w = healthy();
  assert.deepEqual(
    checkPatchDay({ gamePath: w.gameDir, gameId: "skyrimspecialedition" }),
    checkPatchDay({ gamePath: w.gameDir })
  );
});

test("a version that isn't a version is refused with an example", () => {
  const r = checkPatchDay({ gamePath: healthy().gameDir, targetVersion: "banana" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error, '"banana" isn\'t a game version.');
  assert.match(r.hint ?? "", /1\.7\.104/);
});

test("a folder without the game's executable is refused with what to pass", () => {
  const w = makeWorld();
  mkdirSync(join(w.root, "empty"));
  for (const gamePath of [join(w.root, "empty"), join(w.root, "does-not-exist")]) {
    const r = checkPatchDay({ gamePath });
    assert.equal(r.ok, false, gamePath);
    if (r.ok) continue;
    assert.equal(r.error, "SkyrimSE.exe isn't in that folder.");
    assert.equal(r.hint, "gamePath should be the folder that holds SkyrimSE.exe.");
  }
});

test("an executable whose version can't be read is refused rather than guessed at", () => {
  for (const bytes of [notADll(), buildPe()]) {
    const w = makeWorld();
    writeFileSync(join(w.gameDir, "SkyrimSE.exe"), bytes);
    const r = checkPatchDay({ gamePath: w.gameDir });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "Couldn't read the game's version out of SkyrimSE.exe.");
  }
});

// ─── How sure it says it is ──────────────────────────────────────────────────
// The verdict is only as good as what it rests on, so every report says which of
// three things that is: SKSE's own log from a launch, the files read against SKSE's
// rules, or a prediction. The wording itself is tested in patchday-rules.test.ts;
// these check that real runs pick the right one.

test("a healthy install with no log says it is working from the files, and what would settle it", () => {
  const r = ok(checkPatchDay({ gamePath: healthy().gameDir }));
  assert.equal(r.confidence.evidence, "files");
  assert.match(r.confidence.summary, /^From the files only, using SKSE 2\.2\.6's own rules/);
  assert.match(r.confidence.summary, /SKSE's log from a launch would confirm it/);
  assert.deepEqual(r.confidence.basis, { "skse-source": 0, "field-reports": 0, inferred: 0 });
});

test("a log written after the last patch becomes the evidence, and says how many plugins it saw load", () => {
  const w = healthy();
  const r = ok(checkPatchDay({ gamePath: w.gameDir, logPath: logFor(w, LOADED, "fresh") }));
  assert.equal(r.confidence.evidence, "log");
  assert.match(r.confidence.summary, /2 plugins loaded/);
  assert.match(r.confidence.summary, /strongest evidence/);
});

test("a log from before the last patch describes a different game and is not counted as evidence", () => {
  const w = healthy();
  const r = ok(checkPatchDay({ gamePath: w.gameDir, logPath: logFor(w, LOADED, "stale") }));
  assert.equal(r.confidence.evidence, "files");
  assert.doesNotMatch(r.confidence.summary, /strongest evidence/);
});

test("past the game version SKSE's source covers, the answer calls itself a prediction until a log says otherwise", () => {
  const w = patched();
  const guess = ok(checkPatchDay({ gamePath: w.gameDir }));
  assert.equal(guess.confidence.evidence, "prediction");
  assert.match(guess.confidence.summary, /aren't public/);

  const loaded = [
    "plugin Data\\SKSE\\Plugins\\v5.dll (00000001 V5 00000001) loaded correctly (handle 1)",
    "plugin Data\\SKSE\\Plugins\\sig.dll (00000001 Sig 00000001) loaded correctly (handle 2)",
  ];
  const confirmed = ok(checkPatchDay({ gamePath: w.gameDir, logPath: logFor(w, loaded, "fresh") }));
  assert.equal(confirmed.confidence.evidence, "log");
  assert.match(confirmed.confidence.summary, /2 plugins loaded/);
});

test("a what-if is called a what-if, even when there is a fresh log for the installed version", () => {
  const w = healthy();
  const logPath = logFor(w, LOADED, "fresh");
  const r = ok(checkPatchDay({ gamePath: w.gameDir, logPath, targetVersion: "1.6.1179" }));
  assert.equal(r.confidence.evidence, "prediction");
  assert.match(r.confidence.summary, /^A what-if, not a fact/);
  assert.match(r.confidence.summary, /1\.6\.1179\.0/);
  assert.doesNotMatch(r.confidence.summary, /strongest evidence/);
});

test("the tally of what the flagged plugins rest on matches the plugin lines", () => {
  const w = healthy();
  put(w.plugins, "le.dll", lePlugin());
  put(w.plugins, "old.dll", pinnedTo(R5));
  put(w.plugins, "legacy.dll", legacyPlugin());
  const r = ok(checkPatchDay({ gamePath: w.gameDir }));
  assert.ok(r.plugins.problems.length >= 3, "the world should have flagged these");
  const tally = { "skse-source": 0, "field-reports": 0, inferred: 0 };
  for (const line of r.plugins.problems) tally[line.basis]++;
  assert.deepEqual(r.confidence.basis, tally);
});

// ─── The promises ────────────────────────────────────────────────────────────

function snapshot(dir: string, base = dir, acc: Record<string, string> = {}): Record<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(base, full);
    if (entry.isDirectory()) {
      acc[`${rel}/`] = "dir";
      snapshot(full, base, acc);
    } else {
      const s = statSync(full);
      acc[rel] = `${s.size}:${s.mtimeMs}`;
    }
  }
  return acc;
}

test("it changes nothing on disk and its answer contains no folder paths", () => {
  const { w, instance } = mo2World({ "shared.dll": lePlugin() });
  put(w.plugins, "legacy.dll", legacyPlugin());
  writeFileSync(join(w.steamapps, `appmanifest_${APP_ID}.acf`), manifest({ stateFlags: "6", target: "101" }));
  const logPath = logFor(
    w,
    [
      ...LOADED,
      "plugin C:\\Users\\Jane Doe\\Games\\Skyrim Special Edition\\Data\\SKSE\\Plugins\\base.dll (1 Good 1) disabled, bad version data",
    ],
    "fresh"
  );

  const before = snapshot(ROOT);
  const first = ok(checkPatchDay({ gamePath: w.gameDir, mo2InstancePath: instance, logPath, targetVersion: "1.6.1179" }));
  const second = ok(checkPatchDay({ gamePath: w.gameDir, mo2InstancePath: instance, logPath }));
  assert.deepEqual(snapshot(ROOT), before, "no file was created, removed, resized or touched");

  for (const report of [first, second]) {
    // The structured report and the plain-text answer are both something a client shows or a model reads.
    for (const [what, text] of [["report", JSON.stringify(report)], ["text", summarizePatchDay(report)]] as const) {
      assert.ok(!text.includes(ROOT), `no temp-folder path in the ${what}`);
      assert.ok(!text.includes(tmpdir()), `no temp-folder path in the ${what}`);
      assert.doesNotMatch(text, /[A-Za-z]:\\\\/, `no drive-letter path in the ${what}`);
      assert.doesNotMatch(text, /\/(?:home|Users|tmp|var|root|mnt)\//, `no absolute POSIX path in the ${what}`);
      assert.doesNotMatch(text, /Jane|Doe/, `nothing from inside a log line's folder path in the ${what}`);
    }
  }
});

// ─── The MCP tool ────────────────────────────────────────────────────────────
// The answer is a few lines of plain text that any client can show and the model
// can read; the engine's whole report rides along as structured content.

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

class MockMcpServer {
  tools = new Map<string, { handler: (args: Record<string, unknown>) => Promise<ToolResult> }>();
  registerTool(name: string, _config: unknown, handler: never): void {
    this.tools.set(name, { handler });
  }
}

function patchDayTool(): { handler: (args: Record<string, unknown>) => Promise<ToolResult> } {
  const server = new MockMcpServer();
  registerWorkbenchTools(server as unknown as never);
  const tool = server.tools.get("mw_patch_day");
  assert.ok(tool, "mw_patch_day is not registered");
  return tool;
}

/** What a client receives on the wire: JSON, so `undefined` fields are gone. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("mw_patch_day answers in plain text and carries the engine's whole report as structured content", async () => {
  const w = healthy();
  const result = await patchDayTool().handler({ gamePath: w.gameDir });
  const engine = ok(checkPatchDay({ gamePath: w.gameDir }));

  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]!.type, "text");
  assert.equal(result.content[0]!.text, summarizePatchDay(engine));
  assert.match(result.content[0]!.text, /^GO — Skyrim Special Edition 1\.6\.1170\.0/);
  assert.doesNotMatch(result.content[0]!.text, /^\s*[{[]/, "the text is an answer, not a JSON dump");
  assert.deepEqual(wire(result.structuredContent), wire(engine));
});

test("mw_patch_day: a what-if says so in both the text and the report", async () => {
  const w = healthy();
  const result = await patchDayTool().handler({ gamePath: w.gameDir, targetVersion: "1.7.104" });
  assert.match(result.content[0]!.text, /^WAIT — /);
  assert.match(result.content[0]!.text, /How sure: A what-if, not a fact/);
  const report = result.structuredContent as unknown as PatchDayReport;
  assert.equal(report.verdict, "wait");
  assert.equal(report.checked.source, "targetVersion");
  assert.equal(report.confidence.evidence, "prediction");
  assert.equal(result.isError, undefined);
});

test("mw_patch_day: a run that can't happen is flagged as an error, with the reason and the games it covers", async () => {
  const tool = patchDayTool();

  const unsupported = await tool.handler({ gameId: "fallout4" });
  assert.equal(unsupported.isError, true);
  assert.match(unsupported.content[0]!.text, /^Patch Day couldn't run: /);
  assert.match(unsupported.content[0]!.text, /Games it covers: skyrimspecialedition\.$/);
  assert.equal(unsupported.structuredContent?.ok, false);
  assert.deepEqual(unsupported.structuredContent?.supportedGames, ["skyrimspecialedition"]);

  const notAVersion = await tool.handler({ gamePath: healthy().gameDir, targetVersion: "banana" });
  assert.equal(notAVersion.isError, true);
  assert.match(notAVersion.content[0]!.text, /^Patch Day couldn't run: /);
  assert.equal(notAVersion.structuredContent?.ok, false);
});

test("mw_patch_day: when SKSE's own log disagrees, the text leads with SKSE's words and shows no folder path", async () => {
  const w = healthy();
  const refusal =
    "plugin C:\\Users\\Jane Doe\\Games\\Skyrim Special Edition\\Data\\SKSE\\Plugins\\good.dll (00000001 Good 00000001) disabled, incompatible with current version of the game";
  const result = await patchDayTool().handler({ gamePath: w.gameDir, logPath: logFor(w, [...LOADED, refusal], "fresh") });
  const text = result.content[0]!.text;

  assert.match(text, /^CHECK — /);
  assert.match(
    text,
    /^SKSE's own log disagrees with the file check on 1 plugin:\n- good\.dll: SKSE logged "plugin <path>\\good\.dll \(00000001 Good 00000001\) disabled, incompatible with current version of the game" but the file check passed it$/m
  );
  assert.ok(text.indexOf("SKSE's own log disagrees") < text.indexOf("Setup:"), "the disagreement comes before the setup details");
  assert.doesNotMatch(text, /Jane|Doe|Users|C:/);
});

test("mw_patch_day: flagged plugins are listed worst first with their basis, and the text stays short", async () => {
  const w = healthy();
  put(w.plugins, "le.dll", lePlugin());
  put(w.plugins, "legacy.dll", legacyPlugin());
  const result = await patchDayTool().handler({ gamePath: w.gameDir });
  const text = result.content[0]!.text;
  assert.match(text, /^Needs attention \(\d+ of 5 plugins\), worst first:$/m);
  assert.match(text, /^- le\.dll: BROKEN \[SKSE's source; game folder\] /m);
  assert.match(text, /^- legacy\.dll: BROKEN \[/m);
  assert.match(text, /^Every plugin not listed above passed\.$/m);
  assert.ok(text.length < 2500, `the answer ran to ${text.length} characters`);
});
