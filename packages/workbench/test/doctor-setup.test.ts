import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Budget } from "../src/doctor/fsutil.js";
import { DOCTOR_GAMES, runDoctor } from "../src/doctor/index.js";
import { checkPlugins } from "../src/doctor/setup-plugins.js";
import type { DoctorFinding, DoctorOptions, DoctorReport } from "../src/doctor/types.js";
import {
  BASE_PLUGINS,
  dataOf,
  listText,
  makeMo2,
  makeSteam,
  protonPluginsTxt,
  putBasePlugins,
  putRel,
  tes4,
  windowsPluginsTxt,
  LETHAL,
} from "./helpers/doctor-world.js";
import { APP_ID, createSandbox, type World } from "./helpers/world.js";

// ─── The Setup Doctor, end to end ────────────────────────────────────────────
// Each test builds a Skyrim install on disk, the way the files really are (plugins with
// real TES4 headers, a plugins.txt where the game keeps it, a Mod Organizer 2 instance
// with its ini, profile, mod folders and Overwrite), runs the Doctor over it and reads
// what it says. Nothing is faked: the Doctor reads exactly what these tests write.
//
// Every test gets a home folder of its own, so a plugins.txt one test writes isn't there
// for the next. What the machine this runs on has installed never matters.

const sandbox = createSandbox("mw-doctor-setup-");
before(() => sandbox.start());
afterEach(() => sandbox.isolate());
after(() => sandbox.stop());

let homes = 0;

/** A home folder for this test, with the Windows-style AppData inside it. */
function newHome(): string {
  const home = join(sandbox.root, `h${homes++}`);
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.LOCALAPPDATA = join(home, "AppData", "Local");
  process.env.APPDATA = join(home, "AppData", "Roaming");
  return home;
}

/** A Skyrim Special Edition in a Steam library, with the game's own plugins in Data. */
function install(opts: Parameters<typeof sandbox.makeWorld>[0] = {}): World {
  newHome();
  const w = sandbox.makeWorld(opts);
  putBasePlugins(w);
  return w;
}

const plugin = (w: World, name: string, spec: Parameters<typeof tes4>[0] = {}): void => putRel(dataOf(w), name, tes4(spec));
const winList = (...lines: string[]): string => windowsPluginsTxt(sandbox, listText(lines));

function run(options: DoctorOptions = {}): DoctorReport {
  const result = runDoctor({ platform: "windows", area: "setup", ...options });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result as DoctorReport;
}

const find = (r: DoctorReport, id: string): DoctorFinding | undefined => r.findings.find((f) => f.id === id);
const ids = (r: DoctorReport): string[] => r.findings.map((f) => f.id);
const must = (r: DoctorReport, id: string): DoctorFinding => {
  const f = find(r, id);
  assert.ok(f, `${id} is missing; the report has: ${ids(r).join(", ")}`);
  return f;
};

// ─── A healthy install ───────────────────────────────────────────────────────

test("a healthy Windows install has nothing wrong, and the report says what it counted", () => {
  const w = install();
  plugin(w, "SomeMaster.esm", { master: true, masters: ["Skyrim.esm"] });
  plugin(w, "SkyUI_SE.esp", { masters: ["Skyrim.esm"] });
  plugin(w, "Patch.esp", { masters: ["SomeMaster.esm", "SkyUI_SE.esp"] });
  winList("*SomeMaster.esm", "*SkyUI_SE.esp", "*Patch.esp");

  const r = run();
  assert.equal(r.counts.problem, 0);
  assert.notEqual(r.verdict, "problems");
  assert.deepEqual(r.areas, ["setup"]);
  assert.equal(r.platform, "windows");
  assert.equal(r.game.id, "skyrimspecialedition");
  assert.deepEqual(r.looked.plugins, { listed: 3, active: 8, read: 8, unreadable: 0, complete: true });
  assert.equal(r.looked.gameFolder, true);
  assert.equal(r.looked.steam, "custom");
  assert.equal(r.looked.mo2.used, false);
  assert.match(must(r, "setup.plugin-limit").detail, /^8 of 254 full plugins and 0 of 4096 light plugins are switched on, counting the 5 game and Creation Club files/);
  assert.equal(must(r, "setup.plugin-limit").status, "ok");
  assert.equal(must(r, "setup.masters").status, "ok");
  assert.equal(must(r, "setup.masters").title, "Every master is installed, switched on and in order");
  assert.equal(must(r, "setup.location").status, "ok");
  assert.equal(must(r, "setup.crash-logger").status, "note", "no crash logger is only a note");
  assert.ok(r.findings.every((f) => f.area === "setup"));
});

test("the same install under Proton reads plugins.txt from the game's prefix, with Unix line endings", () => {
  const w = install();
  plugin(w, "SkyUI_SE.esp", { masters: ["Skyrim.esm"] });
  protonPluginsTxt(w, listText(["*SkyUI_SE.esp"], "\n"));
  const r = run({ platform: "linux" });
  assert.equal(r.platform, "linux");
  assert.deepEqual(r.looked.plugins, { listed: 1, active: 6, read: 6, unreadable: 0, complete: true });
  assert.equal(must(r, "setup.masters").status, "ok");
  assert.equal(find(r, "setup.location"), undefined, "Windows' protected folders don't exist on Linux");
});

test("a plugins.txt that is only in the Windows profile isn't read for a Linux run, and the other way round", () => {
  const w = install();
  plugin(w, "A.esp", { masters: ["Skyrim.esm"] });
  winList("*A.esp");
  assert.equal(must(run({ platform: "linux" }), "setup.plugin-list").title, "No plugin list found");
  protonPluginsTxt(w, listText(["*A.esp"]));
  assert.equal(find(run({ platform: "linux" }), "setup.plugin-list"), undefined);
});

test("with no plugins.txt anywhere the report says so, instead of claiming the list is fine", () => {
  install();
  const r = run();
  const f = must(r, "setup.plugin-list");
  assert.deepEqual([f.status, f.title, f.basis], ["note", "No plugin list found", "install"]);
  assert.equal(find(r, "setup.masters"), undefined);
  assert.equal(find(r, "setup.plugin-limit"), undefined);
  assert.equal(r.looked.plugins, undefined);
});

// ─── Masters ─────────────────────────────────────────────────────────────────

test("a plugin whose master isn't installed is a problem, with the pair named", () => {
  const w = install();
  plugin(w, "Orphan.esp", { masters: ["Skyrim.esm", "Missing.esm"] });
  winList("*Orphan.esp");
  const r = run();
  const f = must(r, "setup.masters-missing");
  assert.equal(f.status, "problem");
  assert.deepEqual(f.items, ["Orphan.esp needs Missing.esm"]);
  assert.match(f.detail, /1 switched-on plugin needs 1 file that isn't in the game folder\./);
  assert.match(f.detail, /likely to crash the game, on launch or later/);
  assert.equal(f.basis, "install");
  assert.match(f.source ?? "", /loot\.readthedocs\.io/);
  assert.equal(r.verdict, "problems");
  assert.match(r.headline, /^1 problem/);
  assert.match(r.nextSteps.join(" "), /Install the missing master/);
  assert.equal(find(r, "setup.masters"), undefined, "the all-clear line is not said next to a problem");
});

test("missing masters are counted with the right verbs: plugins and files, singular and plural", () => {
  const w = install();
  plugin(w, "A.esp", { masters: ["Skyrim.esm", "Gone.esm"] });
  plugin(w, "B.esp", { masters: ["Skyrim.esm", "Gone.esm"] });
  plugin(w, "C.esp", { masters: ["Skyrim.esm", "AlsoGone.esm"] });
  winList("*A.esp");
  assert.match(must(run(), "setup.masters-missing").detail, /^1 switched-on plugin needs 1 file that isn't in the game folder\./);
  winList("*A.esp", "*B.esp");
  assert.match(must(run(), "setup.masters-missing").detail, /^2 switched-on plugins need 1 file that isn't in the game folder\./);
  winList("*A.esp", "*C.esp");
  assert.match(must(run(), "setup.masters-missing").detail, /^2 switched-on plugins need 2 files that aren't in the game folder\./);
  winList("*A.esp", "*B.esp", "*C.esp");
  assert.match(must(run(), "setup.masters-missing").detail, /^3 switched-on plugins need 2 files that aren't in the game folder\./);
});

test("a master that is installed but switched off is its own problem, whether it's missing from the list or listed without a star", () => {
  const w = install();
  plugin(w, "Extra.esm", { master: true });
  plugin(w, "NeedsExtra.esp", { masters: ["Extra.esm"] });
  winList("*NeedsExtra.esp");
  const missingFromList = must(run(), "setup.masters-off");
  assert.deepEqual(missingFromList.items, ["NeedsExtra.esp needs Extra.esm"]);
  assert.equal(missingFromList.status, "problem");
  assert.equal(find(run(), "setup.masters-missing"), undefined, "installed, so not missing");

  winList("Extra.esm", "*NeedsExtra.esp");
  assert.deepEqual(must(run(), "setup.masters-off").items, ["NeedsExtra.esp needs Extra.esm"]);
});

test("a plugin listed before a master of the same kind that it needs is a late-master problem; in the right order it isn't", () => {
  const w = install();
  plugin(w, "Base.esp", { masters: ["Skyrim.esm"] });
  plugin(w, "Addon.esp", { masters: ["Base.esp"] });
  winList("*Addon.esp", "*Base.esp");
  const late = must(run(), "setup.masters-late");
  assert.equal(late.status, "problem");
  assert.deepEqual(late.items, ["Addon.esp needs Base.esp"]);
  assert.match(late.fix ?? "", /LOOT/);

  winList("*Base.esp", "*Addon.esp");
  const r = run();
  assert.equal(find(r, "setup.masters-late"), undefined);
  assert.equal(must(r, "setup.masters").status, "ok");
});

test("a master-flagged plugin loads first wherever it is listed, so a plain plugin ahead of it is not late", () => {
  const w = install();
  plugin(w, "Flagged.esm", { master: true });
  plugin(w, "Plain.esp", { masters: ["Flagged.esm"] });
  winList("*Plain.esp", "*Flagged.esm");
  const r = run();
  assert.equal(find(r, "setup.masters-late"), undefined);
  assert.equal(must(r, "setup.masters").status, "ok");
});

test("a file named .esm that isn't flagged as a master is left alone rather than guessed at", () => {
  const w = install();
  plugin(w, "Named.esm", { master: false });
  plugin(w, "Needs.esm", { master: false, masters: ["Named.esm"] });
  winList("*Needs.esm", "*Named.esm");
  assert.equal(find(run(), "setup.masters-late"), undefined);
});

test("a plugin that lists itself as a master isn't its own problem", () => {
  const w = install();
  plugin(w, "Odd.esp", { masters: ["Odd.esp", "Skyrim.esm"] });
  winList("*Odd.esp");
  assert.equal(must(run(), "setup.masters").status, "ok");
});

test("many missing masters are capped at eight, with the rest counted", () => {
  const w = install();
  const lines: string[] = [];
  for (let i = 0; i < 11; i++) {
    plugin(w, `Needy${String(i).padStart(2, "0")}.esp`, { masters: [`Gone${i}.esm`] });
    lines.push(`*Needy${String(i).padStart(2, "0")}.esp`);
  }
  winList(...lines);
  const f = must(run(), "setup.masters-missing");
  assert.equal(f.items?.length, 8);
  assert.equal(f.more, 3);
  assert.match(f.detail, /^11 switched-on plugins need 11 files/);
});

test("Creation Club files listed in Skyrim.ccc load without being in plugins.txt, so a plugin that needs one isn't missing a master", () => {
  const w = install();
  plugin(w, "ccBGSSSE001-Fish.esm", { master: true, masters: ["Skyrim.esm"] });
  writeFileSync(join(w.gameDir, "Skyrim.ccc"), "ccBGSSSE001-Fish.esm\r\nccNotInstalled-Thing.esl\r\n");
  plugin(w, "UsesFish.esp", { masters: ["Skyrim.esm", "ccBGSSSE001-Fish.esm"] });
  winList("*UsesFish.esp");
  const r = run();
  assert.equal(must(r, "setup.masters").status, "ok");
  assert.match(must(r, "setup.plugin-limit").detail, /counting the 6 game and Creation Club files/);
  assert.equal(r.looked.plugins?.active, 7);
});

test("a Creation Club file that is installed but not listed in Skyrim.ccc or plugins.txt does not load, so a plugin needing it is flagged", () => {
  const w = install();
  plugin(w, "ccBGSSSE001-Fish.esm", { master: true });
  plugin(w, "UsesFish.esp", { masters: ["ccBGSSSE001-Fish.esm"] });
  winList("*UsesFish.esp");
  assert.deepEqual(must(run(), "setup.masters-off").items, ["UsesFish.esp needs ccBGSSSE001-Fish.esm"]);
});

test("the game's own plugins listed in plugins.txt anyway are not counted twice", () => {
  const w = install();
  plugin(w, "A.esp", { masters: ["Skyrim.esm"] });
  winList("*Skyrim.esm", "*Update.esm", "*A.esp");
  const r = run();
  assert.equal(r.looked.plugins?.active, 6);
  assert.match(must(r, "setup.plugin-limit").detail, /^6 of 254 full plugins/);
});

// ─── The plugin limits ───────────────────────────────────────────────────────

test("light plugins are counted apart: by the ESL flag in the header or by a .esl name", () => {
  const w = install();
  plugin(w, "Tiny.esl", { master: true, light: true });
  plugin(w, "FlaggedLight.esp", { light: true });
  plugin(w, "Plain.esp");
  winList("*Tiny.esl", "*FlaggedLight.esp", "*Plain.esp");
  const r = run();
  assert.match(must(r, "setup.plugin-limit").detail, /^6 of 254 full plugins and 2 of 4096 light plugins/);
});

test("more than 254 full plugins is a problem, counted with the game's own files", () => {
  const w = install();
  const lines: string[] = [];
  for (let i = 0; i < 250; i++) {
    const name = `P${String(i).padStart(3, "0")}.esp`;
    plugin(w, name);
    lines.push(`*${name}`);
  }
  winList(...lines);
  const f = must(run(), "setup.plugin-limit");
  assert.equal(f.status, "problem");
  assert.equal(f.title, "Over Skyrim's plugin limit");
  assert.match(f.detail, /^255 of 254 full plugins/);
});

test("within fourteen of the limit is a warning, and light plugins don't use up the full slots", () => {
  const w = install();
  const lines: string[] = [];
  for (let i = 0; i < 236; i++) {
    const name = `P${String(i).padStart(3, "0")}.esp`;
    plugin(w, name);
    lines.push(`*${name}`);
  }
  winList(...lines);
  assert.equal(must(run(), "setup.plugin-limit").status, "warn", "241 full plugins");

  const w2 = install();
  const lines2: string[] = [];
  for (let i = 0; i < 300; i++) {
    const name = `L${String(i).padStart(3, "0")}.esl`;
    plugin(w2, name, { master: true, light: true });
    lines2.push(`*${name}`);
  }
  winList(...lines2);
  const f = must(run(), "setup.plugin-limit");
  assert.equal(f.status, "ok", "300 light plugins fit");
  assert.match(f.detail, /^5 of 254 full plugins and 300 of 4096 light plugins/);
});

// ─── Files that aren't plugins, and entries that point nowhere ───────────────

test("switched-on files that don't open as plugins are named with what is wrong, and aren't counted", () => {
  const w = install();
  putRel(dataOf(w), "NotAPlugin.esp", "<html>Access denied</html>");
  putRel(dataOf(w), "Empty.esp", "");
  putRel(dataOf(w), "Cut.esp", tes4({ masters: ["Skyrim.esm"] }).subarray(0, 10));
  mkdirSync(join(dataOf(w), "ADirectory.esp"));
  plugin(w, "Fine.esp");
  winList("*NotAPlugin.esp", "*Empty.esp", "*Cut.esp", "*ADirectory.esp", "*Fine.esp");
  const r = run();
  const f = must(r, "setup.plugin-files");
  assert.equal(f.status, "warn");
  assert.deepEqual(
    [...(f.items ?? [])].sort(),
    ["ADirectory.esp (couldn't be opened)", "Cut.esp (cut short)", "Empty.esp (an empty file)", "NotAPlugin.esp (not a plugin file)"].sort()
  );
  assert.equal(r.looked.plugins?.unreadable, 4);
  assert.match(must(r, "setup.plugin-limit").detail, /^6 of 254 full plugins/, "five game files and Fine.esp; the broken ones aren't counted");
});

test("an entry in plugins.txt whose file isn't there is a note, and says the game skips it", () => {
  const w = install();
  for (const n of ["A", "B", "C", "D"]) plugin(w, `${n}.esp`);
  winList("*A.esp", "*B.esp", "*C.esp", "*D.esp", "*Gone.esp");
  const f = must(run(), "setup.plugin-stale");
  assert.equal(f.status, "note");
  assert.deepEqual(f.items, ["Gone.esp"]);
  assert.match(f.detail, /^1 entry in your list points at a plugin file that isn't in the game folder or any enabled mod\. The game skips it, so it is harmless/);
});

test("two or more stale entries are counted in the plural, with the verb to match", () => {
  const w = install();
  for (const n of ["A", "B", "C", "D"]) plugin(w, `${n}.esp`);
  winList("*A.esp", "*B.esp", "*C.esp", "*D.esp", "*Gone.esp", "*Also Gone.esp");
  const f = must(run(), "setup.plugin-stale");
  assert.match(f.detail, /^2 entries in your list point at plugin files that aren't in the game folder or any enabled mod\. The game skips them, so they are harmless/);
});

test("when most of the list isn't anywhere the Doctor looked, it says it may be looking in the wrong place, not that everything is missing", () => {
  const w = install();
  plugin(w, "OnlyOne.esp");
  winList("*OnlyOne.esp", "*A.esp", "*B.esp", "*C.esp", "*D.esp", "*E.esp");
  const r = run();
  const f = must(r, "setup.plugin-list");
  assert.equal(f.status, "note");
  assert.equal(f.title, "Most of your plugins aren't where ModWrench looked");
  assert.match(f.detail, /6 plugins, but only 1 are in the game's Data folder/);
  assert.match(f.fix ?? "", /mo2InstancePath/);
  assert.equal(find(r, "setup.masters-missing"), undefined);
  assert.equal(find(r, "setup.plugin-limit"), undefined);
  assert.equal(r.looked.plugins?.complete, false);
  assert.equal(r.counts.problem, 0);
});

test("a short list that is mostly missing isn't treated as the wrong place: five entries are needed before the Doctor suspects that", () => {
  const w = install();
  plugin(w, "OnlyOne.esp");
  winList("*OnlyOne.esp", "*A.esp", "*B.esp");
  const r = run();
  assert.equal(must(r, "setup.plugin-stale").items?.length, 2);
  assert.equal(find(r, "setup.plugin-list"), undefined);
});

// ─── Crash loggers ───────────────────────────────────────────────────────────

test("crash loggers are recognised by their file names, in either case of folder name", () => {
  const w = install();
  winList();
  putRel(dataOf(w), "SKSE/Plugins/CrashLogger.dll", "x");
  const one = run();
  assert.equal(must(one, "setup.crash-logger").title, "One crash logger: Crash Logger SSE");

  putRel(dataOf(w), "skse/plugins/Trainwreck.DLL", "x");
  const two = must(run(), "setup.crash-logger");
  assert.equal(two.status, "warn");
  assert.equal(two.title, "More than one crash logger");
  assert.deepEqual(two.items, ["Crash Logger SSE", "Trainwreck"]);
});

test(".NET Script Framework on the 1.6 game that the test world has is too old, and says which version the game is", () => {
  const w = install();
  winList();
  putRel(dataOf(w), "DLLPlugins/NetScriptFramework.Runtime.dll", "x");
  const old = must(run(), "setup.crash-logger-old");
  assert.equal(old.status, "warn");
  assert.match(old.detail, /The game is 1\.6\.1170/);

  const older = install({ game: [1, 5, 97, 0] });
  putRel(dataOf(older), "DLLPlugins/NetScriptFramework.Runtime.dll", "x");
  winList();
  assert.equal(find(run(), "setup.crash-logger-old"), undefined, "1.5.97 is the version it was made for");
});

// ─── Mod Organizer 2 ─────────────────────────────────────────────────────────

const skyui = { "SkyUI_SE.esp": tes4({ masters: ["Skyrim.esm"] }) };

test("with Mod Organizer 2 the profile's list and the enabled mods' plugins are what is read", () => {
  const w = install();
  const mo2 = makeMo2(w, {
    modlist: ["+Patch Mod", "+SkyUI", "-Disabled Mod", "-Some_separator"],
    plugins: ["*SkyUI_SE.esp", "*Patch.esp"],
    mods: {
      SkyUI: skyui,
      "Patch Mod": { "Patch.esp": tes4({ masters: ["Skyrim.esm", "SkyUI_SE.esp"] }) },
      "Disabled Mod": { "Hidden.esp": tes4() },
    },
  });
  const r = run({ mo2InstancePath: mo2.instance });
  assert.equal(r.looked.mo2.used, true);
  assert.equal(r.looked.mo2.profile, "Default");
  assert.equal(r.looked.mo2.modFolders, 2);
  assert.deepEqual(r.looked.plugins, { listed: 2, active: 7, read: 7, unreadable: 0, complete: true });
  assert.equal(must(r, "setup.masters").status, "ok");
  assert.equal(must(r, "setup.overwrite").title, "Overwrite is empty");
  assert.ok(r.notChecked.some((n) => /virtual file system/.test(n.what)));
  assert.ok(r.limits.some((l) => /virtual file system exists only while MO2 runs/.test(l)));
});

test("a plugin from a mod that is switched off isn't there for the game, so its list entry is stale", () => {
  const w = install();
  const mo2 = makeMo2(w, {
    modlist: ["-Off Mod", "+SkyUI"],
    plugins: ["*SkyUI_SE.esp", "*Hidden.esp"],
    mods: { SkyUI: skyui, "Off Mod": { "Hidden.esp": tes4() } },
  });
  assert.deepEqual(must(run({ mo2InstancePath: mo2.instance }), "setup.plugin-stale").items, ["Hidden.esp"]);
});

test("a mod the profile switches on that has no folder is a note, and doesn't make the other checks incomplete", () => {
  const w = install();
  const mo2 = makeMo2(w, { modlist: ["+Ghost Mod", "+SkyUI"], plugins: ["*SkyUI_SE.esp"], mods: { SkyUI: skyui } });
  const r = run({ mo2InstancePath: mo2.instance });
  const f = must(r, "setup.mods-missing");
  assert.equal(f.status, "note");
  assert.deepEqual(f.items, ["Ghost Mod"]);
  assert.equal(f.detail, "MO2's profile switches on 1 mod that has no folder in the mods folder, so none of its files load.");
  assert.equal(r.looked.plugins?.complete, true);
});

test("two mods with no folder are counted in the plural, with the verb and pronoun to match", () => {
  const w = install();
  const mo2 = makeMo2(w, { modlist: ["+Ghost Mod", "+Another Ghost", "+SkyUI"], plugins: ["*SkyUI_SE.esp"], mods: { SkyUI: skyui } });
  const f = must(run({ mo2InstancePath: mo2.instance }), "setup.mods-missing");
  assert.equal(f.detail, "MO2's profile switches on 2 mods that have no folder in the mods folder, so none of their files load.");
});

test("when two mods carry the same plugin, the one with the higher priority is the one that is read", () => {
  const w = install();
  // modlist.txt lists the highest priority first, so HighMod's empty file beats LowMod's good one.
  const broken = makeMo2(w, {
    modlist: ["+HighMod", "+LowMod"],
    plugins: ["*Dup.esp"],
    mods: { HighMod: { "Dup.esp": "" }, LowMod: { "Dup.esp": tes4({ masters: ["Skyrim.esm"] }) } },
  });
  assert.deepEqual(must(run({ mo2InstancePath: broken.instance }), "setup.plugin-files").items, ["Dup.esp (an empty file)"]);

  const fine = makeMo2(w, {
    folder: "mo2-fine",
    modlist: ["+LowMod", "+HighMod"],
    plugins: ["*Dup.esp"],
    mods: { HighMod: { "Dup.esp": "" }, LowMod: { "Dup.esp": tes4({ masters: ["Skyrim.esm"] }) } },
  });
  assert.equal(find(run({ mo2InstancePath: fine.instance }), "setup.plugin-files"), undefined, "now LowMod is the higher priority one");
});

test("a plugin in Overwrite is found, and Overwrite is reported with what it holds", () => {
  const w = install();
  const mo2 = makeMo2(w, {
    modlist: ["+SkyUI"],
    plugins: ["*SkyUI_SE.esp", "*Synthesis.esp"],
    mods: { SkyUI: skyui },
    overwrite: { "Synthesis.esp": tes4({ masters: ["Skyrim.esm"] }), "SSEEdit Backups/Skyrim.esm.backup": "x", "meshes/actors/x.hkx": "x" },
  });
  const r = run({ mo2InstancePath: mo2.instance });
  assert.equal(find(r, "setup.plugin-stale"), undefined, "Synthesis.esp is in Overwrite, which MO2 puts on top");
  const f = must(r, "setup.overwrite");
  assert.equal(f.status, "warn");
  assert.equal(f.title, "Overwrite holds files that beat every mod");
  assert.match(f.detail, /3 files/);
  assert.match(f.detail, /output from /);
  assert.match(f.detail, /Synthesis/);
  assert.deepEqual([...(f.items ?? [])].sort(), ["SSEEdit Backups", "Synthesis.esp", "meshes"].sort());
});

test("an Overwrite with only logs and backups is a note, not a warning", () => {
  const w = install();
  const mo2 = makeMo2(w, {
    modlist: ["+SkyUI"],
    plugins: ["*SkyUI_SE.esp"],
    mods: { SkyUI: skyui },
    overwrite: { "SSEEdit Backups/a.backup": "x", "logs/run.log": "x" },
  });
  const f = must(run({ mo2InstancePath: mo2.instance }), "setup.overwrite");
  assert.equal(f.status, "note");
  assert.equal(f.title, "Overwrite holds logs and backups");
});

test("the mods folder is where the instance's ini says it is, so a mod list kept on another drive is read", () => {
  const w = install();
  const elsewhere = join(w.root, "big drive", "mods");
  const mo2 = makeMo2(w, { modlist: ["+SkyUI"], plugins: ["*SkyUI_SE.esp"], mods: { SkyUI: skyui }, modsAt: elsewhere });
  const r = run({ mo2InstancePath: mo2.instance });
  assert.equal(r.looked.plugins?.complete, true);
  assert.equal(find(r, "setup.plugin-stale"), undefined);
  assert.equal(find(r, "setup.mods-missing"), undefined);
  assert.equal(must(r, "setup.masters").status, "ok");
});

test("%BASE_DIR% in the ini means the instance folder", () => {
  const w = install();
  const mo2 = makeMo2(w, { modlist: ["+SkyUI"], plugins: ["*SkyUI_SE.esp"], ini: "\n[Settings]\nmod_directory=%BASE_DIR%/modsB\n" });
  putRel(join(mo2.instance, "modsB", "SkyUI"), "SkyUI_SE.esp", tes4({ masters: ["Skyrim.esm"] }));
  const r = run({ mo2InstancePath: mo2.instance });
  assert.equal(find(r, "setup.plugin-stale"), undefined);
  assert.equal(r.looked.plugins?.complete, true);
});

test("on Linux a Windows path in the ini is read through Wine's Z: drive, and another drive letter can't be", (t) => {
  if (process.platform === "win32") return t.skip("a Z: path only means something to Wine");
  const w = install();
  const real = join(w.root, "wine-mods");
  const wine = `Z:${real.replace(/\//g, "\\")}`;
  const mo2 = makeMo2(w, { modlist: ["+SkyUI"], plugins: ["*SkyUI_SE.esp"], ini: `\n[Settings]\nmod_directory=${wine}\n` });
  putRel(join(real, "SkyUI"), "SkyUI_SE.esp", tes4({ masters: ["Skyrim.esm"] }));
  protonPluginsTxt(w, listText([]));
  const viaZ = run({ platform: "linux", mo2InstancePath: mo2.instance });
  assert.equal(find(viaZ, "setup.plugin-stale"), undefined, "found through Z:");
  assert.equal(viaZ.looked.plugins?.complete, true);

  const other = makeMo2(w, { folder: "mo2-d", modlist: ["+SkyUI"], plugins: ["*SkyUI_SE.esp"], ini: "\n[Settings]\nmod_directory=D:\\Mods\n" });
  rmSync(other.mods, { recursive: true, force: true });
  const viaD = run({ platform: "linux", mo2InstancePath: other.instance });
  assert.equal(viaD.looked.plugins?.complete, false, "a D: drive isn't something ModWrench can map");
  assert.ok(viaD.limits.some((l) => /Some folders or plugins were skipped/.test(l)));
});

test("when a mods folder can't be found, a missing master is a warning that says the master may be in a mod that wasn't read", () => {
  const w = install();
  plugin(w, "Needy.esp", { masters: ["Skyrim.esm", "FromMod.esm"] });
  const mo2 = makeMo2(w, { modlist: ["+Mods"], plugins: ["*Needy.esp"], ini: "\n[Settings]\nmod_directory=D:\\Mods\n" });
  rmSync(mo2.mods, { recursive: true, force: true });
  const r = run({ platform: "linux", mo2InstancePath: mo2.instance });
  const f = must(r, "setup.masters-missing");
  assert.equal(f.status, "warn", "not a certain problem when part of the picture is missing");
  assert.match(f.detail, /Some mod folders couldn't be read, so a master may be in one of them\./);
  assert.equal(r.looked.plugins?.complete, false);

  // The same with every folder readable is a problem.
  const whole = makeMo2(w, { folder: "mo2-whole", modlist: ["+Mods"], plugins: ["*Needy.esp"], mods: { Mods: {} } });
  assert.equal(must(run({ platform: "linux", mo2InstancePath: whole.instance }), "setup.masters-missing").status, "problem");
});

test("MO2's list and the game's own plugins.txt disagreeing is a note, and says it is normal when MO2 starts the game", () => {
  const w = install();
  plugin(w, "A.esp", { masters: ["Skyrim.esm"] });
  winList("*A.esp", "*B.esp");
  const mo2 = makeMo2(w, {
    modlist: ["+Mods"],
    plugins: ["*A.esp", "*C.esp"],
    mods: { Mods: { "C.esp": tes4({ masters: ["Skyrim.esm"] }), "B.esp": tes4({ masters: ["Skyrim.esm"] }) } },
  });
  const f = must(run({ mo2InstancePath: mo2.instance }), "setup.plugin-drift");
  assert.equal(f.status, "note");
  assert.match(f.detail, /^1 plugin is switched on only in MO2's profile and 1 only in the game's own list\./);
  assert.match(f.detail, /normal if you always start the game from MO2/);

  winList("*A.esp", "*C.esp");
  assert.equal(find(run({ mo2InstancePath: mo2.instance }), "setup.plugin-drift"), undefined);
});

test("the profileName argument picks another profile, and an unknown one is reported rather than guessed", () => {
  const w = install();
  const mo2 = makeMo2(w, { modlist: ["+SkyUI"], plugins: ["*SkyUI_SE.esp"], mods: { SkyUI: skyui } });
  const other = join(mo2.instance, "profiles", "Other");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "modlist.txt"), "+SkyUI\n");
  writeFileSync(join(other, "plugins.txt"), listText([]));
  const r = run({ mo2InstancePath: mo2.instance, profileName: "Other" });
  assert.equal(r.looked.mo2.profile, "Other");
  assert.equal(r.looked.plugins?.listed, 0);

  const missing = run({ mo2InstancePath: mo2.instance, profileName: "No Such Profile" });
  assert.equal(missing.looked.mo2.used, false);
  assert.match(missing.looked.mo2.reason, /couldn't read the profile/);
  assert.equal(find(missing, "setup.overwrite"), undefined);
});

test("an instance path with no ModOrganizer.ini in it is not an instance", () => {
  const w = install();
  const r = run({ mo2InstancePath: join(w.root, "not-an-instance") });
  assert.equal(r.looked.mo2.used, false);
  assert.match(r.looked.mo2.reason, /no Mod Organizer 2 instance/);
});

test("an instance whose profile files can't be opened is reported as not read, and the run carries on", () => {
  const w = install();
  const mo2 = makeMo2(w, { modlist: ["+SkyUI"], plugins: ["*SkyUI_SE.esp"], mods: { SkyUI: skyui } });
  rmSync(join(mo2.profileDir, "modlist.txt"));
  mkdirSync(join(mo2.profileDir, "modlist.txt"));
  const r = run({ mo2InstancePath: mo2.instance });
  assert.equal(r.ok, true);
  assert.equal(r.looked.mo2.used, false);
});

// ─── Where the game is ───────────────────────────────────────────────────────

test("no Steam and no gamePath is a problem that says how to fix it", () => {
  newHome();
  const r = run();
  const f = must(r, "setup.game");
  assert.equal(f.status, "problem");
  assert.match(f.title, /^Couldn't find The Elder Scrolls V: Skyrim Special Edition/);
  assert.match(f.detail, /No Steam install was found, and no gamePath was given\./);
  assert.match(f.fix ?? "", /pass gamePath/);
  assert.equal(r.verdict, "problems");
  assert.equal(r.looked.gameFolder, false);
  assert.equal(r.looked.steam, "none");
  assert.equal(find(r, "setup.plugin-list"), undefined, "no game, no plugin checks");
});

test("Steam found but the game isn't in any of its libraries says so", () => {
  newHome();
  const root = join(sandbox.root, "steam-without-skyrim");
  makeSteam(root);
  process.env.STEAM_ROOT = root;
  assert.match(must(run(), "setup.game").detail, /It isn't in any library of the Steam install ModWrench found\./);
});

test("a gamePath that isn't a folder is a problem, and a blank one is ignored", () => {
  const w = install();
  const bad = run({ gamePath: join(w.root, "nope") });
  assert.equal(must(bad, "setup.game").title, "That game folder isn't there");
  assert.equal(bad.looked.gameFolder, false);
  assert.equal(find(run({ gamePath: "   " }), "setup.game"), undefined, "blank means 'not given', and the game is found in Steam");
});

test("a game outside Steam, such as a GOG copy, works when its folder is given", () => {
  newHome();
  const gog = join(sandbox.root, "GOG Games", "Skyrim Special Edition");
  for (const n of BASE_PLUGINS) putRel(join(gog, "Data"), n, tes4({ master: true }));
  putRel(join(gog, "Data"), "A.esp", tes4({ masters: ["Skyrim.esm"] }));
  windowsPluginsTxt(sandbox, listText(["*A.esp"]));
  const r = run({ gamePath: gog });
  assert.equal(r.looked.steam, "none");
  assert.equal(r.looked.gameFolder, true);
  assert.deepEqual(r.looked.plugins, { listed: 1, active: 6, read: 6, unreadable: 0, complete: true });
  assert.equal(must(r, "setup.masters").status, "ok");
});

// ─── Where things live ───────────────────────────────────────────────────────

test("a game under Program Files and an MO2 instance in OneDrive are both flagged on Windows, by name", () => {
  newHome();
  const game = join(sandbox.root, "Program Files (x86)", "Steam", "steamapps", "common", "Skyrim Special Edition");
  for (const n of BASE_PLUGINS) putRel(join(game, "Data"), n, tes4({ master: true }));
  const w: World = { root: sandbox.root, steam: "", steamapps: "", gameDir: game, plugins: "", documents: "" };
  const mo2 = makeMo2(w, { folder: join("OneDrive", "Modding", "MO2"), modlist: [], plugins: [] });
  const r = run({ gamePath: game, mo2InstancePath: mo2.instance });
  const f = must(r, "setup.location");
  assert.equal(f.status, "warn");
  assert.equal(f.title, "Folders Windows protects or syncs");
  assert.deepEqual(f.items, ["The game: Program Files", "Mod Organizer 2's instance: a OneDrive folder"], "the mods folder is inside the instance, so it isn't a line of its own");
  assert.ok(!JSON.stringify(f).includes(sandbox.root));
});

test("a mods folder kept outside the instance, in a folder Windows syncs, is named as the mods folder", () => {
  newHome();
  const w = sandbox.makeWorld();
  putBasePlugins(w);
  const mo2 = makeMo2(w, { folder: join("Modding", "MO2"), modlist: [], plugins: [], modsAt: join(w.root, "OneDrive", "mods") });
  const f = must(run({ mo2InstancePath: mo2.instance }), "setup.location");
  assert.deepEqual(f.items, ["Mod Organizer 2's mods folder: a OneDrive folder"]);
});

test("the location check is for Windows only", () => {
  newHome();
  const game = join(sandbox.root, "Program Files (x86)", "Steam", "steamapps", "common", "Skyrim Special Edition");
  putRel(join(game, "Data"), "Skyrim.esm", tes4({ master: true }));
  assert.equal(find(run({ gamePath: game, platform: "linux" }), "setup.location"), undefined);
  assert.equal(find(run({ gamePath: game, platform: "macos" }), "setup.location"), undefined);
});

test("Documents moved into OneDrive is a note that says where the ini files and logs went", () => {
  const home = newHome();
  const w = sandbox.makeWorld();
  putBasePlugins(w);
  mkdirSync(join(home, "OneDrive", "Documents", "My Games", "Skyrim Special Edition"), { recursive: true });
  const f = must(run(), "setup.my-games");
  assert.equal(f.status, "note");
  assert.equal(find(run({ platform: "linux" }), "setup.my-games"), undefined);
});

test("room on the drive is read from the real drive: a line for the game's drive, in gigabytes", () => {
  install();
  const f = must(run(), "setup.room");
  assert.match(f.detail, /the game's drive: [\d.]+ GB free/);
  assert.ok(f.status === "ok" || f.status === "warn");
});

// ─── Other games ─────────────────────────────────────────────────────────────

test("a game with no plugin checks gets the location and room checks, and says what it didn't check", () => {
  const w = install();
  makeSteam(w.steam, { game: LETHAL });
  const r = run({ gameId: "lethalcompany" });
  assert.deepEqual(
    ids(r).filter((id) => !["setup.location", "setup.room"].includes(id)),
    []
  );
  assert.ok(!r.notChecked.some((n) => /Plugin limits/.test(n.what)));
  assert.ok(r.notChecked.some((n) => /Smart App Control/.test(n.what)), "the Windows-only things it can't see");
  assert.ok(!r.notChecked.some((n) => /Vortex's staging folder/.test(n.what)), "Vortex is for the Bethesda games");
});

test("another Bethesda game says its plugin checks aren't built yet, rather than running Skyrim's rules on it", () => {
  const w = install();
  makeSteam(w.steam, { game: { appId: "377160", dir: "Fallout 4", name: "Fallout 4" } });
  const r = run({ gameId: "fallout4" });
  assert.ok(r.notChecked.some((n) => n.what === "Plugin limits, masters and crash loggers for Fallout 4"));
  assert.equal(find(r, "setup.plugin-limit"), undefined);
  assert.ok(r.notChecked.some((n) => /Vortex's staging folder/.test(n.what)));
});

test("a MelonLoader game says its Proton override isn't checked yet", () => {
  const w = install();
  makeSteam(w.steam, { game: { appId: "823500", dir: "BONEWORKS", name: "BONEWORKS" } });
  assert.ok(run({ gameId: "boneworks" }).notChecked.some((n) => /MelonLoader/.test(n.what)));
});

test("a game the Doctors don't know is an error that lists the ones they do", () => {
  const result = runDoctor({ gameId: "not-a-game" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /don't know "not-a-game"/);
    assert.deepEqual(result.supportedGames, DOCTOR_GAMES);
    assert.ok(result.supportedGames.includes("skyrimspecialedition"));
    assert.ok(result.supportedGames.includes("lethalcompany"));
  }
  for (const odd of ["", "__proto__", "constructor", "SKYRIMSPECIALEDITION"]) assert.equal(runDoctor({ gameId: odd }).ok, false, odd);
});

// ─── Time and the limits of what was read ────────────────────────────────────

test("when the time allowed runs out before the headers are read, the plugin limit isn't called fine", () => {
  const w = install();
  plugin(w, "A.esp", { masters: ["Skyrim.esm"] });
  plugin(w, "B.esp", { masters: ["Missing.esm"] });
  winList("*A.esp", "*B.esp");
  const r = run({ budgetMs: -1 });
  const f = must(r, "setup.plugin-limit");
  assert.equal(f.status, "note");
  assert.equal(f.title, "Plugin count not fully checked");
  assert.match(f.detail, /^None of the 7 switched-on plugins ModWrench found were opened in the time allowed, and whether a plugin is full or light is in its header/);
  assert.doesNotMatch(f.detail, /it did open/, "nothing was opened, so there are no counts to give");
  assert.equal(r.looked.plugins?.complete, false);
  assert.equal(r.looked.plugins?.read, 0);
  assert.ok(r.limits.some((l) => /Some folders or plugins were skipped/.test(l)));
  assert.equal(find(r, "setup.masters-missing"), undefined, "no header was read, so no master was judged");
  assert.equal(must(r, "setup.masters").status, "note");
  assert.equal(must(r, "setup.masters").title, "Masters weren't checked", "with nothing read there is nothing to call 'no problems' in");
  assert.match(must(r, "setup.masters").detail, /^No plugin could be opened in the time allowed/);
  assert.equal(r.counts.problem, 0, "a run that read nothing can't claim a problem");
  // And it doesn't read as a clean bill of health either.
  assert.equal(r.counts.warn, 0);
  assert.equal(r.verdict, "attention");
  assert.equal(r.headline, "Some checks didn't finish, so this isn't the whole picture. Nothing wrong turned up in the rest.");
});

test("a check that stops on an error is listed, and the report doesn't call itself clear", () => {
  const w = install();
  plugin(w, "A.esp", { masters: ["Skyrim.esm"] });
  winList("*A.esp");
  // A path that isn't text makes the Mod Organizer 2 step throw, the way an unexpected error would.
  const r = run({ mo2InstancePath: 5 as never });
  const stopped = r.notChecked.find((n) => n.what === "Reading Mod Organizer 2");
  assert.ok(stopped, `notChecked: ${r.notChecked.map((n) => n.what).join(" | ")}`);
  assert.match(stopped.why, /stopped on an error/);
  assert.ok(r.limits.some((l) => /A check stopped on an error/.test(l)));
  assert.equal(r.counts.problem + r.counts.warn, 0);
  assert.equal(r.verdict, "attention");
  assert.equal(r.headline, "Some checks didn't finish, so this isn't the whole picture. Nothing wrong turned up in the rest.");
  // The checks that could run did.
  assert.equal(must(r, "setup.masters").status, "ok");
});

test("a run cut short says so beside warnings and beside problems too", () => {
  const w = install();
  plugin(w, "Orphan.esp", { masters: ["Skyrim.esm", "Missing.esm"] });
  winList("*Orphan.esp");
  const withProblem = run({ mo2InstancePath: 5 as never });
  assert.equal(withProblem.verdict, "problems");
  assert.equal(withProblem.headline, "1 problem found. Start with the first. Some checks didn't finish, so there may be more.");

  const w2 = install();
  plugin(w2, "A.esp", { masters: ["Skyrim.esm"] });
  winList("*A.esp");
  putRel(join(dataOf(w2), "SKSE", "Plugins"), "CrashLogger.dll", Buffer.from("MZ"));
  putRel(join(dataOf(w2), "SKSE", "Plugins"), "trainwreck.dll", Buffer.from("MZ"));
  const withWarning = run({ mo2InstancePath: 5 as never });
  assert.equal(withWarning.verdict, "attention");
  assert.equal(withWarning.counts.warn, 1);
  assert.equal(withWarning.headline, "1 warning worth a look. Some checks didn't finish, so this isn't the whole picture.");
  assert.doesNotMatch(withWarning.headline, /Nothing is clearly broken/, "it can't say nothing is broken when it didn't look at everything");

  // The same install without the stopped check keeps the plain wording.
  assert.equal(run().headline, "1 warning worth a look. Nothing is clearly broken.");
});

/** A clock that allows `allow` checks and then runs out, so a test can stop a read part-way. */
class RunsOutAfter extends Budget {
  calls = 0;
  constructor(private readonly allow: number) {
    super(60_000);
  }
  override expired(): boolean {
    return ++this.calls > this.allow;
  }
}

test("when time runs out part-way through the headers, the note says how many were opened and what those came to", () => {
  const w = install();
  plugin(w, "A.esp", { masters: ["Skyrim.esm"] });
  plugin(w, "B.esp", { masters: ["Skyrim.esm"], light: true });
  plugin(w, "C.esp", { masters: ["Skyrim.esm"] });
  winList("*A.esp", "*B.esp", "*C.esp");
  const check = (budget: Budget) =>
    checkPlugins({ gameDir: w.gameDir, platform: "windows", mo2: { used: false, reason: "not used" }, libraries: [], appId: APP_ID, budget });

  // Count the checks a full run makes. The last eight are the header reads: the five game files, then A, B and C.
  const whole = new RunsOutAfter(Number.POSITIVE_INFINITY);
  const full = check(whole);
  assert.equal(full.findings.find((f) => f.id === "setup.plugin-limit")?.status, "ok");

  const three = check(new RunsOutAfter(whole.calls - 3));
  const note = three.findings.find((f) => f.id === "setup.plugin-limit");
  assert.equal(note?.status, "note");
  assert.match(note?.detail ?? "", /^3 of the 8 switched-on plugins ModWrench found weren't opened in the time allowed/);
  assert.match(note?.detail ?? "", /The 5 it did open come to 5 full and 0 light, so the real totals are at least that\.$/);
  assert.equal(three.plugins?.read, 5);
  assert.equal(three.plugins?.complete, false);

  const one = check(new RunsOutAfter(whole.calls - 1));
  assert.match(one.findings.find((f) => f.id === "setup.plugin-limit")?.detail ?? "", /^1 of the 8 switched-on plugins ModWrench found weren't opened/);
  assert.match(one.findings.find((f) => f.id === "setup.plugin-limit")?.detail ?? "", /The 7 it did open come to 6 full and 1 light/);

  // One opened out of two: "comes", not "come".
  const w2 = install();
  winList();
  const single = checkPlugins({ gameDir: w2.gameDir, platform: "windows", mo2: { used: false, reason: "not used" }, libraries: [], appId: APP_ID, budget: new RunsOutAfter(1) });
  const singleNote = single.findings.find((f) => f.id === "setup.plugin-limit");
  assert.match(singleNote?.detail ?? "", /^4 of the 5 switched-on plugins ModWrench found weren't opened/);
  assert.match(singleNote?.detail ?? "", /The 1 it did open comes to 1 full and 0 light/);
});

test("when time runs out after the list is already over the limit, the verdict stays a problem: more can only add to it", () => {
  const w = install();
  const lines: string[] = [];
  for (let i = 0; i < 260; i++) {
    plugin(w, `P${i}.esp`, { masters: ["Skyrim.esm"] });
    lines.push(`*P${i}.esp`);
  }
  winList(...lines);
  const check = (budget: Budget) =>
    checkPlugins({ gameDir: w.gameDir, platform: "windows", mo2: { used: false, reason: "not used" }, libraries: [], appId: APP_ID, budget });
  const whole = new RunsOutAfter(Number.POSITIVE_INFINITY);
  check(whole);
  // Everything but the last 3 plugins is read: 265 plugins found, 262 opened, which is over 254 whatever the other 3 are.
  const cut = check(new RunsOutAfter(whole.calls - 3));
  const f = cut.findings.find((x) => x.id === "setup.plugin-limit");
  assert.equal(f?.status, "problem");
  assert.equal(f?.title, "Over Skyrim's plugin limit");
});

test("the limits of the report always include the read-only promise and how to read the basis labels", () => {
  install();
  const r = run();
  assert.match(r.limits[0] ?? "", /Everything here is read from files\. Nothing runs the game/);
  assert.ok(r.limits.some((l) => /"your files" were read directly/.test(l)));
  assert.ok(r.limits.some((l) => /Plugins are read by their header only, never loaded/.test(l)));
});

test("a clear report says it isn't a promise, and the Windows things it can't see are listed", () => {
  const w = install();
  plugin(w, "A.esp", { masters: ["Skyrim.esm"] });
  winList("*A.esp");
  // Make it a clear one: a crash logger present, the room check is whatever the machine has.
  putRel(dataOf(w), "SKSE/Plugins/CrashLogger.dll", "x");
  const r = run();
  if (r.verdict === "clear") assert.match(r.headline, /That isn't a promise the game runs/);
  const what = r.notChecked.map((n) => n.what).join(" | ");
  assert.match(what, /antivirus/);
  assert.match(what, /pagefile/);
  assert.match(what, /nxm:\/\/ links open your mod manager/);
  assert.match(what, /Whether the game starts/);
});

test("the order of findings is worst first, and the next steps come from the problems and warnings", () => {
  const w = install();
  plugin(w, "Orphan.esp", { masters: ["Missing.esm"] });
  putRel(dataOf(w), "NotAPlugin.esp", "nope");
  winList("*Orphan.esp", "*NotAPlugin.esp");
  const r = run();
  const order = r.findings.map((f) => f.status);
  assert.deepEqual(order, [...order].sort((a, b) => ["problem", "warn", "note", "ok"].indexOf(a) - ["problem", "warn", "note", "ok"].indexOf(b)));
  assert.equal(r.findings[0]?.id, "setup.masters-missing");
  assert.ok(r.nextSteps.length >= 2);
  assert.ok(r.nextSteps.length <= 5);
  assert.equal(new Set(r.nextSteps).size, r.nextSteps.length);
  assert.deepEqual(
    r.counts,
    {
      problem: r.findings.filter((f) => f.status === "problem").length,
      warn: r.findings.filter((f) => f.status === "warn").length,
      note: r.findings.filter((f) => f.status === "note").length,
      ok: r.findings.filter((f) => f.status === "ok").length,
    }
  );
});
