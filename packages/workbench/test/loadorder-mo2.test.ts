import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findGameById } from "../src/detect/games.js";
import { discoverMo2 } from "../src/doctor/mo2facts.js";
import { mo2Folder, readMo2LoadOrder } from "../src/loadorder/mo2.js";
import { createSandbox } from "./helpers/world.js";

// ─── Where a Mod Organizer 2 instance keeps its folders ──────────────────────
// mw_read_load_order, Patch Day and the Doctors used to each read ModOrganizer.ini's folder
// settings their own way, and could land on different folders. They now share mo2Folder,
// which follows MO2's PathSettings (src/settings.cpp) and reads a value the way Qt's
// QSettings does. Each test here is an ini two of the old readers disagreed on.

const sandbox = createSandbox("mw-mo2-folders-");
before(() => sandbox.start());
after(() => sandbox.stop());

const SSE = findGameById("skyrimspecialedition")!;
const windows = process.platform === "win32";
let made = 0;

/** An instance with a Default profile, these folders made inside it, and `settings` as its [Settings] section. */
function instance(settings: (dir: string) => string, folders: string[] = ["mods"], o: { portable?: boolean; general?: (dir: string) => string } = {}): string {
  const dir = join(sandbox.root, `mo2-${made++}`);
  mkdirSync(join(dir, "profiles", "Default"), { recursive: true });
  for (const folder of folders) mkdirSync(join(dir, folder), { recursive: true });
  if (o.portable) writeFileSync(join(dir, "ModOrganizer.exe"), "");
  writeFileSync(
    join(dir, "ModOrganizer.ini"),
    `[General]\ngameName=Skyrim Special Edition\nselected_profile=@ByteArray(Default)\n${o.general?.(dir) ?? ""}\n\n[Settings]\n${settings(dir)}\n`
  );
  return dir;
}

/** A path as MO2 on this machine writes it: forward slashes, and under Wine on its Z: drive. */
const ini = (path: string): string => `${windows ? "" : "Z:"}${path.replace(/\\/g, "/")}`;
const same = (path: string | null | undefined): string | null => (path === null || path === undefined ? null : resolve(path));

/** The mods folder, checked to be the one the Doctors find too. */
function modsOf(dir: string): string | null {
  const found = mo2Folder(dir, "mod_directory", "mods");
  const doctors = discoverMo2(SSE, [], { mo2InstancePath: dir });
  assert.equal(doctors.used, true, doctors.reason);
  assert.equal(same(doctors.modsDir), same(found), "the Doctors find the same mods folder");
  return found;
}

test("only [Settings] counts: a mod_directory in [General] is another setting to MO2", () => {
  const dir = instance(() => "", ["mods", "elsewhere"], { general: (d) => `mod_directory=${ini(join(d, "elsewhere"))}` });
  assert.equal(same(modsOf(dir)), same(join(dir, "mods")));
});

test("a folder [Settings] names that isn't there is missing, never swapped for the one MO2 would use without the setting", () => {
  const unplugged = instance((d) => `mod_directory=${ini(join(d, "unplugged"))}`);
  assert.equal(modsOf(unplugged), null);
  // base_directory moves the mods folder with it, so the instance's own isn't MO2's.
  const based = instance((d) => `base_directory=${ini(join(d, "base"))}\nprofiles_directory=${ini(join(d, "profiles"))}`, ["mods", "base"]);
  assert.equal(modsOf(based), null);
});

test("a folder on another computer is missing too, never swapped for the instance's own", () => {
  const base = instance((d) => `base_directory=//127.0.0.1/mw-test-share\nprofiles_directory=${ini(join(d, "profiles"))}`);
  assert.equal(modsOf(base), null);
  const mods = instance(() => "mod_directory=\\\\\\\\127.0.0.1\\\\mw-test-share\\\\mods");
  assert.equal(modsOf(mods), null);
});

test("%BASE_DIR% is MO2's only in capitals, and nothing is replaced inside base_directory", () => {
  // Each is then a path from no root, which MO2 reads from its own program folder: not this instance's.
  const lower = instance(() => "mod_directory=%base_dir%/lower", ["mods", "lower"]);
  assert.equal(modsOf(lower), null);
  const nested = instance((d) => `base_directory=%BASE_DIR%/inner\nprofiles_directory=${ini(join(d, "profiles"))}`, ["mods", "inner/mods"]);
  assert.equal(modsOf(nested), null);
});

test("a path from no root starts at MO2's own folder, which only a portable instance is", () => {
  assert.equal(modsOf(instance(() => "mod_directory=rel", ["mods", "rel"])), null, "MO2 runs from a folder the ini doesn't name");
  const portable = instance(() => "mod_directory=rel", ["mods", "rel"], { portable: true });
  assert.equal(same(modsOf(portable)), same(join(portable, "rel")));
  // A setting that is there but empty is no default: it is MO2's own folder.
  const empty = instance(() => "mod_directory=", ["mods"], { portable: true });
  assert.equal(same(modsOf(empty)), same(empty));
});

test("a value is read the way QSettings reads it: quotes dropped, backslashes doubled, comments and lists", () => {
  const quoted = instance((d) => `mod_directory="${ini(join(d, "a, b"))}"`, ["mods", "a, b"]);
  assert.equal(same(modsOf(quoted)), same(join(quoted, "a, b")), "QSettings quotes a value with a comma in it");
  const doubled = instance((d) => `mod_directory=${ini(join(d, "dbl")).replace(/\//g, "\\\\")}`, ["mods", "dbl"]);
  assert.equal(same(modsOf(doubled)), same(join(doubled, "dbl")), "QSettings doubles a backslash");
  const comment = instance((d) => `mod_directory=${ini(join(d, "c"))}   ; moved here`, ["mods", "c"]);
  assert.equal(same(modsOf(comment)), same(join(comment, "c")));
  // A lone backslash starts an escape, so "\t" is a tab and "\m" is nothing: not the folder a person meant.
  const lone = instance((d) => `mod_directory=${ini(join(d, "dbl")).replace(/\//g, "\\")}`, ["mods", "dbl"]);
  assert.equal(modsOf(lone), null);
  // An unquoted comma makes a list, which MO2 reads as no text: its own folder, not one this instance names.
  const list = instance((d) => `mod_directory=${ini(join(d, "a, b"))}`, ["mods", "a, b"]);
  assert.equal(modsOf(list), null);
});

test("a .. is folded before anything is looked for, as Windows and Wine fold it, so it can step back past a folder that isn't there", () => {
  const dir = instance((d) => `mod_directory=${ini(join(d, "gone"))}/../back`, ["mods", "back"]);
  assert.equal(same(modsOf(dir)), same(join(dir, "back")));
});

test("past its first 512 KB ModOrganizer.ini isn't read, by any of the three, so MO2's default stands", () => {
  const dir = instance((d) => `mod_directory=${ini(join(d, "late"))}`, ["mods", "late"], { general: () => `\n[Geometry]\nblob=${"x".repeat(600 * 1024)}` });
  assert.equal(same(modsOf(dir)), same(join(dir, "mods")));
});

test("mw_read_load_order finds the profiles folder by the same rules", () => {
  const dir = instance((d) => `profiles_directory="${ini(join(d, "My, Profiles")).replace(/\//g, "\\\\")}"`, ["mods", "My, Profiles/Default"]);
  const order = readMo2LoadOrder(SSE, { instancePath: dir });
  assert.equal(same(order?.sourcePath), same(join(dir, "My, Profiles", "Default")));
});

test("under Wine only Z: is this machine, and a folder is found whatever its capitals, as Wine finds it", (t) => {
  if (windows) return t.skip("Wine's drives only mean something on Linux and macOS");
  // A disk that ignores capitals itself, as a Mac's usually does, gives the name back as the ini spells it.
  const probe = join(sandbox.root, "case");
  mkdirSync(probe);
  writeFileSync(join(probe, "a"), "");
  writeFileSync(join(probe, "A"), "");
  const caseSensitive = readdirSync(probe).length === 2;
  const spelled = (path: string | null | undefined): string | null | undefined => (caseSensitive ? path : path?.toLowerCase());
  const dir = instance((d) => `mod_directory=Z:${join(d, "MiXeD", "MODS")}\nprofiles_directory=Z:${join(d, "PROFILES")}`, ["mods", "mixed/mods"]);
  assert.equal(spelled(modsOf(dir)), spelled(join(dir, "mixed", "mods")), "spelled as it is on disk");
  assert.equal(spelled(readMo2LoadOrder(SSE, { instancePath: dir })?.sourcePath), spelled(join(dir, "profiles", "Default")));
  assert.equal(modsOf(instance(() => "mod_directory=D:/Mods")), null, "a drive Wine maps somewhere ModWrench can't tell");
});

test("a profile name that isn't one folder name, passed or set as the ini's selected_profile, is treated as missing", () => {
  const dir = instance(() => "");
  // Each name would find a plugins.txt if it were joined on: "a\b" is a folder of its own off Windows, two on it.
  for (const where of [join(dir, "x"), join(dir, "profiles", "a", "b"), join(dir, "profiles", "a\\b"), dir, join(dir, "profiles")]) {
    mkdirSync(where, { recursive: true });
    writeFileSync(join(where, "plugins.txt"), "*Planted.esp\n");
  }
  const names = ["../x", "a/b", "a\\b", "..", "."];
  for (const name of names) assert.equal(readMo2LoadOrder(SSE, { instancePath: dir, profileName: name }), null, name);
  for (const name of names) {
    const planted = instance(() => "", ["mods", "x"], { general: () => `selected_profile=${name}` });
    writeFileSync(join(planted, "x", "plugins.txt"), "*Planted.esp\n");
    writeFileSync(join(planted, "plugins.txt"), "*Planted.esp\n");
    assert.equal(readMo2LoadOrder(SSE, { instancePath: planted }), null, `selected_profile=${name}`);
    assert.equal(discoverMo2(SSE, [], { mo2InstancePath: planted }).missed, true, `selected_profile=${name}`);
  }
  assert.equal(readMo2LoadOrder(SSE, { instancePath: dir, profileName: "Default" })?.profile, "Default");
});
