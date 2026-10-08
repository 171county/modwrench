import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runDoctor } from "../src/doctor/index.js";
import { summarizeDoctor } from "../src/doctor/summary.js";
import type { DoctorFinding, DoctorOptions, DoctorReport } from "../src/doctor/types.js";
import { PLUGIN_GAMES } from "../src/doctor/games.js";
import { FALLOUT4_BASE_PLUGINS } from "../src/doctor/plugins.js";
import { limitFinding } from "../src/doctor/setup-plugins.js";
import { listText, putRel, tes4 } from "./helpers/doctor-world.js";
import { buildPe } from "./helpers/pe-builder.js";
import { createSandbox } from "./helpers/world.js";

// ─── The Setup Doctor on Fallout 4 ───────────────────────────────────────────
// The same plugin checks as Skyrim's, with Fallout 4's own files: its eight base
// plugins, Fallout4.ccc, plugins.txt under %LOCALAPPDATA%\Fallout4 (or "Fallout4 MS"
// and "Fallout4 EPIC" for those stores' copies), F4SE's plugin folder and its crash
// loggers. Installs are built on disk; nothing is faked.

const sandbox = createSandbox("mw-doctor-fo4-");
before(() => sandbox.start());
afterEach(() => sandbox.isolate());
after(() => sandbox.stop());

let n = 0;
type Fo4 = { game: string; data: string; local: string };

/** A Fallout 4 folder with Fallout4.exe at `version` and its base plugins in Data, and a fresh home for this test. */
function fallout4(version: [number, number, number, number] = [1, 11, 240, 0]): Fo4 {
  const base = join(sandbox.root, `fo4-${n++}`);
  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.LOCALAPPDATA = join(home, "AppData", "Local");
  process.env.APPDATA = join(home, "AppData", "Roaming");
  const game = join(base, "Games", "Fallout 4");
  const data = join(game, "Data");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(game, "Fallout4.exe"), buildPe({ version }));
  for (const name of FALLOUT4_BASE_PLUGINS) putRel(data, name, tes4({ master: true, version: 1.0 }));
  return { game, data, local: process.env.LOCALAPPDATA };
}

const pluginsTxt = (w: Fo4, lines: string[], folder = "Fallout4"): void => putRel(w.local, `${folder}/Plugins.txt`, listText(lines));

function run(w: Fo4, extra: DoctorOptions = {}): DoctorReport {
  const result = runDoctor({ gameId: "fallout4", gamePath: w.game, platform: "windows", area: "setup", ...extra });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result as DoctorReport;
}

const must = (r: DoctorReport, id: string): DoctorFinding => {
  const f = r.findings.find((x) => x.id === id);
  assert.ok(f, `${id} is missing; the report has: ${r.findings.map((x) => x.id).join(", ")}`);
  return f;
};

test("a healthy Fallout 4: its eight base plugins and Fallout4.ccc load without being listed, and the limits are Fallout 4's", () => {
  const w = fallout4();
  putRel(w.data, "ccBGSFO4001-PipBoy(Black).esl", tes4({ master: true, light: true, version: 1.0 }));
  writeFileSync(join(w.game, "Fallout4.ccc"), "ccBGSFO4001-PipBoy(Black).esl\r\nccNotInstalled.esl\r\n");
  putRel(w.data, "Armor.esp", tes4({ masters: ["Fallout4.esm"], version: 1.0 }));
  pluginsTxt(w, ["*Armor.esp"]);
  const r = run(w);
  assert.equal(r.game.id, "fallout4");
  const limit = must(r, "setup.plugin-limit");
  assert.equal(limit.status, "ok");
  assert.equal(limit.title, "Plugin count is within Fallout 4's limits");
  assert.match(limit.detail, /^9 of 254 full plugins and 1 of 4096 light plugins are switched on, counting the 9 game and Creation Club files that load without being listed\./);
  assert.match(limit.source ?? "", /github\.com\/Ortham\/libloadorder\/blob\/743e8c9/);
  assert.equal(must(r, "setup.masters").status, "ok");
  assert.ok(!r.notChecked.some((x) => /Plugin limits, masters and crash loggers/.test(x.what)), "they were checked");
  assert.ok(r.limits.some((l) => /Plugins are read by their header only/.test(l)));
});

test("Fallout 4's full limit is libloadorder's: 255 with no light plugin switched on, 254 with one, which takes 0xFE", () => {
  const fo4 = PLUGIN_GAMES.fallout4!;
  assert.equal(limitFinding(255, 0, 8, fo4).status, "warn");
  assert.equal(limitFinding(256, 0, 8, fo4).status, "problem");
  assert.equal(limitFinding(255, 1, 8, fo4).status, "problem");
  assert.equal(limitFinding(254, 1, 8, fo4).status, "warn");
  assert.equal(limitFinding(240, 0, 8, fo4).status, "ok");
  assert.equal(limitFinding(241, 0, 8, fo4).status, "warn");
  const over = limitFinding(255, 1, 8, fo4);
  assert.match(over.detail, /^255 of 254 full plugins and 1 of 4096 light plugins are switched on/);
  assert.match(over.detail, /Fallout 4 can load 254 full plugins and 4096 light ones, or 255 full plugins when no light plugin is switched on; a light plugin is one flagged ESL or named \.esl\./);
  assert.match(limitFinding(10, 0, 8, fo4).detail, /^10 of 255 full plugins and 0 of 4096 light plugins/);
  assert.match(over.source ?? "", /libloadorder\/blob\/743e8c9[0-9a-f]*\/src\/load_order\/mutable\.rs$/);
  // Skyrim's stays DynDOLOD's flat 254.
  assert.equal(limitFinding(255, 0, 5).status, "problem");
  assert.doesNotMatch(limitFinding(255, 0, 5).detail, /when no light plugin/);
});

test("with a header unread, Fallout 4's count is a floor, and the note names both full limits", () => {
  const w = fallout4();
  putRel(w.data, "Cut.esp", tes4({ masters: ["Fallout4.esm"] }).subarray(0, 10));
  pluginsTxt(w, ["*Cut.esp"]);
  const f = must(run(w), "setup.plugin-limit");
  assert.equal(f.title, "Plugin count not fully checked");
  assert.match(f.detail, /can't say whether the list is within Fallout 4's limits of 254 full plugins \(255 when no light plugin is switched on\) and 4096 light ones\./);
  // Past the higher limit, the count is over whatever the unread header says.
  const many = fallout4();
  for (let i = 0; i < 248; i++) putRel(many.data, `M${i}.esp`, tes4({ masters: ["Fallout4.esm"], version: 1.0 }));
  putRel(many.data, "Cut.esp", tes4({ masters: ["Fallout4.esm"] }).subarray(0, 10));
  pluginsTxt(many, [...Array.from({ length: 248 }, (_, i) => `*M${i}.esp`), "*Cut.esp"]);
  const over = must(run(many), "setup.plugin-limit");
  assert.deepEqual([over.status, over.title], ["problem", "Over Fallout 4's plugin limit"]);
  assert.match(over.detail, /^256 of 255 full plugins/);
});

test("a Fallout 4 plugin whose master isn't installed is a problem, as it is for Skyrim", () => {
  const w = fallout4();
  putRel(w.data, "Patch.esp", tes4({ masters: ["Fallout4.esm", "Missing.esm"], version: 1.0 }));
  pluginsTxt(w, ["*Patch.esp"]);
  const f = must(run(w), "setup.masters-missing");
  assert.equal(f.status, "problem");
  assert.deepEqual(f.items, ["Patch.esp needs Missing.esm"]);
});

test("the Microsoft Store and Epic copies keep plugins.txt in their own folders, and GOG's shares Steam's", () => {
  for (const [marker, folder] of [["appxmanifest.xml", "Fallout4 MS"], ["EOSSDK-Win64-Shipping.dll", "Fallout4 EPIC"], ["Galaxy64.dll", "Fallout4"]] as const) {
    const w = fallout4();
    writeFileSync(join(w.game, marker), "");
    putRel(w.data, "Mine.esp", tes4({ masters: ["Fallout4.esm"], version: 1.0 }));
    pluginsTxt(w, ["*Mine.esp"], folder);
    const r = run(w);
    assert.equal(r.looked.plugins?.listed, 1, `${marker}: read from ${folder}`);
  }
});

test("the Microsoft Store copy reads its DLC from the folders beside the game, as libloadorder does, and no other copy does", () => {
  for (const store of [true, false]) {
    const w = fallout4();
    if (store) writeFileSync(join(w.game, "appxmanifest.xml"), "");
    // Not in Data: each DLC has a folder of its own, two levels above the game folder, with the plugin in Content\Data.
    const above = dirname(dirname(w.game));
    for (const [dlc, name] of [["Fallout 4- Far Harbor (PC)", "DLCCoast.esm"], ["Fallout 4- Automatron (PC)", "DLCRobot.esm"]] as const) {
      rmSync(join(w.data, name));
      putRel(above, `${dlc}/Content/Data/${name}`, tes4({ master: true, version: 1.0 }));
    }
    putRel(w.data, "Coast Patch.esp", tes4({ masters: ["Fallout4.esm", "DLCCoast.esm"], version: 1.0 }));
    pluginsTxt(w, ["*Coast Patch.esp"], store ? "Fallout4 MS" : "Fallout4");
    const r = run(w);
    if (store) {
      assert.equal(must(r, "setup.masters").status, "ok");
      // The eight base plugins, two of them from the DLC folders, and the patch.
      assert.match(must(r, "setup.plugin-limit").detail, /^9 of \d+ full plugins/);
    } else {
      assert.deepEqual(must(r, "setup.masters-missing").items, ["Coast Patch.esp needs DLCCoast.esm"]);
      assert.match(must(r, "setup.plugin-limit").detail, /^7 of \d+ full plugins/);
    }
  }
});

test("a gamePath without Fallout4.exe in it isn't taken for the game", () => {
  const w = fallout4();
  const r = runDoctor({ gameId: "fallout4", gamePath: w.data, platform: "windows", area: "setup" }) as DoctorReport;
  const f = must(r, "setup.game");
  assert.equal(f.title, "That folder isn't the game's folder");
  assert.match(f.detail, /no Fallout4\.exe in it/);
});

const f4sePlugins = (w: Fo4, ...dlls: string[]): void => {
  for (const dll of dlls) putRel(w.data, `F4SE/Plugins/${dll}`, buildPe({}));
};

test("crash loggers: none is a note naming Fallout 4's loggers and where Crash Whisperer fits", () => {
  const w = fallout4();
  pluginsTxt(w, []);
  const f = must(run(w), "setup.crash-logger");
  assert.equal(f.status, "note");
  assert.match(f.detail, /^None of Buffout 4, Buffout 4 AE \(MiniBuff\) or Addictol's crash logger was found among F4SE's plugins, so after a crash there may be no log for Crash Whisperer \(\/mw-crash\) to read\./);
  assert.match(f.source ?? "", /nexusmods\.com\/fallout4\/mods\/64880/);
});

test("crash loggers: Buffout 4 on 1.10.984 is fine and points at Crash Whisperer; on 1.11 its page says it isn't supported", () => {
  const ng = fallout4([1, 10, 984, 0]);
  f4sePlugins(ng, "Buffout4.dll");
  pluginsTxt(ng, []);
  const ok = run(ng);
  assert.equal(must(ok, "setup.crash-logger").detail, "Only one crash logger was found. After a crash, Crash Whisperer (/mw-crash) reads its log.");
  assert.equal(ok.findings.find((x) => x.id === "setup.crash-logger-old"), undefined);

  const ae = fallout4([1, 11, 240, 0]);
  f4sePlugins(ae, "Buffout4.dll");
  pluginsTxt(ae, []);
  const r = run(ae);
  const old = must(r, "setup.crash-logger-old");
  assert.deepEqual([old.status, old.basis], ["warn", "rule"]);
  assert.match(old.detail, /^The game is 1\.11\.240\. Buffout 4 NG's page says it doesn't support the Anniversary Edition, which is 1\.11 and later/);
  assert.equal(must(r, "setup.crash-logger").detail, "Only one crash logger was found.", "no pointer to a log it can't be counted on to write");
});

test("crash loggers: Addictol with a Buffout 4 build is a problem from Addictol's own page", () => {
  const w = fallout4();
  f4sePlugins(w, "Addictol.dll", "AddictolCrashLogger.dll", "Buffout4AE.dll");
  pluginsTxt(w, []);
  const r = run(w);
  const f = must(r, "setup.crash-logger-addictol");
  assert.deepEqual([f.status, f.basis], ["problem", "rule"]);
  assert.match(f.source ?? "", /nexusmods\.com\/fallout4\/mods\/84214/);
  assert.deepEqual(f.items, ["Addictol.dll", "Buffout4AE.dll"]);
  // Two crash loggers as well: Buffout 4 AE and Addictol's own.
  const two = must(r, "setup.crash-logger");
  assert.deepEqual([two.status, two.basis], ["warn", "guess"]);
  assert.deepEqual(two.items, ["Buffout 4 AE (MiniBuff)", "Addictol Crash Logger"]);
  assert.match(summarizeDoctor(r), /Addictol and Buffout 4 are both installed \[documented rule\]/);
});

test("Fallout 4's My Games folder in OneDrive is found by its own name", () => {
  const w = fallout4();
  pluginsTxt(w, []);
  mkdirSync(join(process.env.HOME!, "OneDrive", "Documents", "My Games", "Fallout4"), { recursive: true });
  const f = must(run(w), "setup.my-games");
  assert.equal(f.title, "The game's My Games folder is inside OneDrive");
});
