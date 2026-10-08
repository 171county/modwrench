import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDoctor } from "../src/doctor/index.js";
import { summarizeDoctor } from "../src/doctor/summary.js";
import type { DoctorFinding, DoctorOptions, DoctorReport } from "../src/doctor/types.js";
import { FALLOUT4_BASE_PLUGINS } from "../src/doctor/plugins.js";
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
