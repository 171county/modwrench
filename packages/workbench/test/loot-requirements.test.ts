import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdirSync, symlinkSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, sep } from "node:path";
import { allowedPlace, checkLootRequirements, summarizeRequirements, type Requirement, type RequirementsOptions, type RequirementsReport } from "../src/conflicts/requirements.js";
import { parseCondition } from "../src/conflicts/condition.js";
import { dataOf, listText, makeMo2, protonPluginsTxt, putBasePlugins, putRel, tes4, windowsPluginsTxt } from "./helpers/doctor-world.js";
import { createSandbox, type World } from "./helpers/world.js";

// ─── mw_loot_requirements: LOOT's req entries, checked against the install ───
// Each test builds a Skyrim Special Edition install on disk (a Data folder, a plugin
// list where the game keeps it, and for Mod Organizer 2 an instance with mods, a
// modlist.txt and Overwrite) and answers LOOT's requirements from a small made-up
// masterlist, served by a stubbed fetch. Some of its paths are hostile: they name
// places outside the game's folders, where a folder of decoy files sits that would
// turn an answer to "present" if anything there were looked at.

const sandbox = createSandbox("mw-loot-req-");
const OUTSIDE = join(sandbox.root, "outside");

const MASTERLIST = [
  "plugins:",
  "  - name: 'Needs.esp'",
  "    req:",
  "      - 'Master.esm'",
  "      - 'Absent.esm'",
  "      - name: 'SKSE/Plugins/there.dll'",
  "        display: '[There](https://example.test/there) **DLL**'",
  "      - name: 'SKSE/Plugins/gone.dll'",
  "        display: 'Gone DLL'",
  "      - name: 'SKSE/Plugins/ow.dll'",
  "      - name: '../skse64_loader.exe'",
  "      - name: '../gone_loader.exe'",
  "      - name: 'SKSE/Plugins/when-on.dll'",
  "        condition: 'active(\"Other.esp\")'",
  "      - name: 'SKSE/Plugins/when-off.dll'",
  "        condition: 'active(\"NotHere.esp\")'",
  "      - name: 'SKSE/Plugins/unsure.dll'",
  "        condition: 'version(\"Needs.esp\", \"2.0\", >=)'",
  "      - name: 'SKSE/Plugins/if-there.dll'",
  "        condition: 'file(\"SKSE/Plugins/there.dll\")'",
  "      - name: 'SKSE/Plugins/if-gone.dll'",
  "        condition: 'file(\"SKSE/Plugins/gone.dll\")'",
  "      - name: 'Constrained.esp'",
  "        constraint: 'version(\"Constrained.esp\", \"1.0\", >=)'",
  "      - 'Ghosted.esp'",
  "      - name: 'Long.esp'",
  `        display: '${"x".repeat(400)}'`,
  "        detail: [ { lang: de, text: 'Nur auf Deutsch.' }, { lang: en, text: 'In **English**: \"quoted\".' } ]",
  // A regex entry for the same plugin: a requirement it shares is listed once.
  "  - name: 'Need[s]\\.esp'",
  "    req: [ 'Master.esm' ]",
  // Paths that lead out of the game's folders, or that the allow-list doesn't permit.
  "  - name: 'Hostile.esp'",
  "    req:",
  `      - '${join(OUTSIDE, "secret.dll")}'`,
  "      - '../../outside/secret.dll'",
  "      - '../Data/../../outside/secret.dll'",
  "      - 'SKSE/Plugins/../../../../outside/secret.dll'",
  "      - 'C:\\Windows\\secret.dll'",
  "      - 'C:secret.dll'",
  "      - '\\\\server\\share\\secret.dll'",
  "      - '//server/share/secret.dll'",
  "      - '..\\secret.dll'",
  '      - "SKSE/Plugins/secret\\0.dll"',
  "      - 'SKSE/Plugins/secret.so'",
  "      - 'SKSE/Plugins/secret.dll.lnk'",
  "      - 'NUL.dll'",
  "      - 'SKSE/COM1.dll'",
  "      - 'SKSE./Plugins/secret.dll'",
  "      - 'SKSE//secret.dll'",
  "      - 'file:///secret.dll'",
  "      - 'Linked/secret.dll'",
].join("\n");

const HOSTILE_COUNT = 18;

let serve: string | null = MASTERLIST;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  if (serve !== null && url.includes("/loot/skyrimse/")) return new Response(serve, { status: 200 });
  return new Response("404: Not Found", { status: 404 });
}) as typeof fetch;

before(() => {
  sandbox.start();
  // The decoys: each would make a hostile requirement read as present, if anything here were looked at.
  for (const rel of ["secret.dll", "Plugins/secret.dll", "SKSE/Plugins/secret.dll"]) putRel(OUTSIDE, rel, "decoy");
});
afterEach(() => sandbox.isolate());
after(() => {
  globalThis.fetch = realFetch;
  sandbox.stop();
});

let homes = 0;
/** A Skyrim Special Edition in a Steam library, with a home folder of its own and the game's plugins in Data. */
function install(): World {
  const home = join(sandbox.root, `h${homes++}`);
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.LOCALAPPDATA = join(home, "AppData", "Local");
  process.env.APPDATA = join(home, "AppData", "Roaming");
  const w = sandbox.makeWorld();
  putBasePlugins(w);
  // The same decoys just outside the game's folder, where "../../outside" from Data would land.
  for (const rel of ["secret.dll", "Plugins/secret.dll"]) putRel(join(w.steamapps, "common", "outside"), rel, "decoy");
  return w;
}

const plugin = (w: World, name: string): void => putRel(dataOf(w), name, tes4());

/** The Windows install most tests use: plugins in Data, the game's own plugins.txt, a DLL, the loader. */
function windowsInstall(): World {
  const w = install();
  for (const name of ["Needs.esp", "Other.esp", "Master.esm", "Hostile.esp", "Constrained.esp"]) plugin(w, name);
  putRel(dataOf(w), "Ghosted.esp.ghost", tes4());
  putRel(dataOf(w), "SKSE/Plugins/there.dll", "dll");
  windowsPluginsTxt(sandbox, listText(["*Needs.esp", "*Other.esp", "*Master.esm", "*Hostile.esp"]));
  return w;
}

async function run(options: Partial<RequirementsOptions> = {}): Promise<RequirementsReport> {
  const r = await checkLootRequirements({ gameId: "skyrimspecialedition", platform: "windows", ...options });
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  return r as RequirementsReport;
}

const of = (r: RequirementsReport, file: string): Requirement | undefined => r.requirements.find((q) => q.file === file);
const status = (r: RequirementsReport, file: string): string | undefined => of(r, file)?.status;

/** A link to a folder: a junction on Windows, which needs no special rights there and which lstat reports as a link. */
const linkFolder = (target: string, path: string): void => symlinkSync(target, path, "junction");

// ─── Spying on the file system ───────────────────────────────────────────────

type Call = { fn: string; path: string };
function spyOnFs(): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const names = ["statSync", "lstatSync", "openSync", "existsSync", "readFileSync", "readdirSync", "accessSync", "statfsSync", "realpathSync", "opendirSync", "writeFileSync", "mkdirSync", "rmSync", "unlinkSync", "renameSync", "copyFileSync", "symlinkSync"];
  const target = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const originals = new Map<string, (...a: unknown[]) => unknown>();
  for (const name of names) {
    const original = target[name]!;
    originals.set(name, original);
    target[name] = function (this: unknown, p: unknown, ...rest: unknown[]) {
      calls.push({ fn: name, path: String(p) });
      return original.call(this, p, ...rest);
    };
  }
  syncBuiltinESMExports();
  return {
    calls,
    restore: () => {
      for (const [name, original] of originals) target[name] = original;
      syncBuiltinESMExports();
    },
  };
}

// ─── The allow-list ──────────────────────────────────────────────────────────

test("the allow-list takes paths below Data, and one file in the game's folder for a single leading ../", () => {
  assert.deepEqual(allowedPlace("Master.esm"), { from: "data", names: ["Master.esm"] });
  assert.deepEqual(allowedPlace("SKSE/Plugins/x.dll"), { from: "data", names: ["SKSE", "Plugins", "x.dll"] });
  assert.deepEqual(allowedPlace("tools/GenerateFNIS_for_Users/GenerateFNISforUsers.exe"), { from: "data", names: ["tools", "GenerateFNIS_for_Users", "GenerateFNISforUsers.exe"] });
  assert.deepEqual(allowedPlace("../skse64_loader.exe"), { from: "game", names: ["skse64_loader.exe"] });
  assert.deepEqual(allowedPlace("NVSE/Plugins/Scripts/gr_0KEYWORDS.txt"), { from: "data", names: ["NVSE", "Plugins", "Scripts", "gr_0KEYWORDS.txt"] });
  for (const ending of ["esp", "esm", "esl", "dll", "exe", "bsa", "ba2", "ini", "txt", "dds", "hlsli", "DLL", "Esp"]) {
    assert.notEqual(allowedPlace(`a/b.${ending}`), null, ending);
  }
});

test("the allow-list refuses every path that could leave the game's folders, or that it has no reason to look for", () => {
  const refused = [
    "/etc/secret.dll",
    join(OUTSIDE, "secret.dll"),
    "../../secret.dll",
    "../Data/x.dll",
    "../a/../b.dll",
    "SKSE/../x.dll",
    "SKSE/Plugins/../../../../outside/secret.dll",
    "./x.dll",
    "SKSE/./x.dll",
    "C:\\Windows\\x.dll",
    "C:/Windows/x.dll",
    "C:x.dll",
    "x.dll:stream.dll",
    "\\\\server\\share\\x.dll",
    "//server/share/x.dll",
    "\\\\?\\C:\\x.dll",
    "..\\x.dll",
    "SKSE\\Plugins\\x.dll",
    "SKSE/Plugins/x\0.dll",
    "SKSE/Plugins/x\n.dll",
    "SKSE/Plugins/x\x7f.dll",
    "x*.dll",
    "x?.dll",
    "x|y.dll",
    'x".dll',
    "x<y.dll",
    "SKSE//x.dll",
    "SKSE/",
    "SKSE./x.dll",
    "SKSE /x.dll",
    "NUL.dll",
    "nul",
    "SKSE/COM1.dll",
    "lpt9.txt",
    "CON",
    "x.so",
    "x.dll.lnk",
    "x.bat",
    "x.ps1",
    "x",
    "file:///x.dll",
    `${"a/".repeat(8)}x.dll`,
    `${"a".repeat(257)}.dll`,
  ];
  for (const path of refused) assert.equal(allowedPlace(path), null, JSON.stringify(path));
  // Eight names is the most, and 260 characters.
  assert.notEqual(allowedPlace(`${"a/".repeat(7)}x.dll`), null);
  assert.notEqual(allowedPlace(`${"a".repeat(256)}.dll`), null);
});

// ─── LOOT's file() with a look at the install ────────────────────────────────

test("file() takes its answer from the caller's look when it has one, and stays unknown without one", () => {
  const facts = { active: ["A.esp"], allActive: true };
  const there = parseCondition('file("SKSE/Plugins/x.dll")');
  assert.equal(there(facts), "unknown", "the conflict tools don't look");
  assert.equal(there({ ...facts, exists: () => true }), true);
  assert.equal(there({ ...facts, exists: () => false }), false);
  assert.equal(parseCondition('not file("x.dll")')({ ...facts, exists: () => false }), true);
  // An active plugin's file is there, whatever the look says.
  assert.equal(parseCondition('file("a.esp")')({ ...facts, exists: () => false }), true);
  // A regex path is still answered from the active plugins alone, and many() isn't asked about.
  const asked: string[] = [];
  const exists = (p: string): boolean => (asked.push(p), false);
  assert.equal(parseCondition('file("B.*\\.esp")')({ ...facts, exists }), "unknown");
  assert.equal(parseCondition('many("x.*\\.dll")')({ ...facts, exists }), "unknown");
  assert.deepEqual(asked, []);
});

// ─── A failed fetch (first, before the list is held in memory) ───────────────

test("when LOOT's list can't be fetched, the answer says so and checks nothing", async () => {
  windowsInstall();
  serve = null;
  try {
    const r = await run();
    assert.ok("failed" in r.masterlist);
    assert.deepEqual(r.requirements, []);
    assert.match(summarizeRequirements(r), /LOOT masterlist fetch failed.*So no requirement was checked\./);
  } finally {
    serve = MASTERLIST;
  }
});

// ─── Without Mod Organizer 2 ─────────────────────────────────────────────────

test("on Windows without MO2, Data and the game's folder are the whole picture: present and missing are both said", async () => {
  const w = windowsInstall();
  const r = await run();
  assert.equal(r.from, "the game's own plugins.txt");
  assert.equal(r.activePlugins, 9, "the five base plugins and the four switched-on ones");
  assert.equal(status(r, "Master.esm"), "present");
  assert.deepEqual(of(r, "Absent.esm"), { plugin: "Needs.esp", file: "Absent.esm", status: "missing", why: "it isn't in the game's Data folder" });
  assert.deepEqual(of(r, "SKSE/Plugins/there.dll"), { plugin: "Needs.esp", file: "SKSE/Plugins/there.dll", display: "There (https://example.test/there) DLL", status: "present" });
  assert.equal(status(r, "SKSE/Plugins/gone.dll"), "missing");
  assert.equal(of(r, "SKSE/Plugins/gone.dll")?.display, "Gone DLL");
  assert.equal(status(r, "../skse64_loader.exe"), "present");
  assert.deepEqual(of(r, "../gone_loader.exe"), { plugin: "Needs.esp", file: "../gone_loader.exe", status: "missing", why: "it isn't in the game's folder" });
  assert.equal(status(r, "Ghosted.esp"), "present", "LOOT counts a ghosted plugin as there");
  // Master.esm is listed once, though two entries for Needs.esp require it.
  assert.equal(r.requirements.filter((q) => q.file === "Master.esm").length, 1);
  void w;
});

test("a requirement's condition: true is checked, false is skipped, unknown is listed as unknown with the condition quoted", async () => {
  windowsInstall();
  const r = await run();
  assert.equal(status(r, "SKSE/Plugins/when-on.dll"), "missing", "Other.esp is active");
  assert.equal(of(r, "SKSE/Plugins/when-off.dll"), undefined, "NotHere.esp is known to be inactive");
  assert.deepEqual(of(r, "SKSE/Plugins/unsure.dll"), {
    plugin: "Needs.esp",
    file: "SKSE/Plugins/unsure.dll",
    status: "unknown",
    why: "LOOT applies it only under a condition ModWrench can't answer",
    condition: 'version("Needs.esp", "2.0", >=)',
  });
  // file() is answered by the same look: there.dll is there, gone.dll isn't.
  assert.equal(status(r, "SKSE/Plugins/if-there.dll"), "missing");
  assert.equal(of(r, "SKSE/Plugins/if-gone.dll"), undefined);
});

test("a file LOOT puts a constraint on is unknown when it's there, with the constraint quoted", async () => {
  windowsInstall();
  const r = await run();
  assert.deepEqual(of(r, "Constrained.esp"), {
    plugin: "Needs.esp",
    file: "Constrained.esp",
    status: "unknown",
    why: "it is there, but LOOT counts it only when its constraint holds, and ModWrench can't tell whether it does",
    condition: 'version("Constrained.esp", "1.0", >=)',
  });
});

test("LOOT's display and its English detail are one plain line of at most 300 characters", async () => {
  windowsInstall();
  const long = of(await run(), "Long.esp")!;
  assert.equal(Array.from(long.display!).length, 300);
  assert.ok(long.display!.endsWith("…"));
  assert.equal(long.detail, "In English: 'quoted'.");
});

test("on a system where capitals matter, a file not found is unknown, not missing", async () => {
  const w = install();
  for (const name of ["Needs.esp", "Other.esp", "Master.esm"]) plugin(w, name);
  putRel(dataOf(w), "SKSE/Plugins/there.dll", "dll");
  protonPluginsTxt(w, listText(["*Needs.esp", "*Other.esp", "*Master.esm"]));
  const r = await run({ platform: "linux" });
  assert.equal(r.activePlugins, 8);
  assert.equal(status(r, "SKSE/Plugins/there.dll"), "present");
  assert.equal(status(r, "Master.esm"), "present");
  for (const file of ["Absent.esm", "SKSE/Plugins/gone.dll", "../gone_loader.exe", "SKSE/Plugins/when-on.dll"]) {
    assert.equal(status(r, file), "unknown", file);
    assert.match(of(r, file)!.why!, /names that differ only in capital letters are different files/, file);
  }
  assert.ok(r.requirements.every((q) => q.status !== "missing"));
});

// ─── Hostile paths ───────────────────────────────────────────────────────────

test("a path that leaves the game's folders is unknown, and nothing outside them is looked at", async () => {
  const w = windowsInstall();
  linkFolder(OUTSIDE, join(dataOf(w), "Linked"));
  const spy = spyOnFs();
  let r: RequirementsReport;
  try {
    r = await run();
  } finally {
    spy.restore();
  }
  const hostile = r.requirements.filter((q) => q.plugin === "Hostile.esp");
  assert.equal(hostile.length, HOSTILE_COUNT);
  for (const q of hostile) assert.equal(q.status, "unknown", JSON.stringify(q.file));
  assert.match(of(r, "Linked/secret.dll")!.why!, /a link or junction is on the way to it, and links aren't followed/);
  for (const q of hostile.filter((h) => h.file !== "Linked/secret.dll")) assert.match(q.why!, /it wasn't looked for/, JSON.stringify(q.file));

  const touched = spy.calls.filter((c) => c.path.includes(`${sep}outside`) || c.path.includes(join(dataOf(w), "Linked") + sep));
  assert.deepEqual(touched, [], "something outside the game's folders, or past the link, was looked at");
  assert.deepEqual(spy.calls.filter((c) => /^(?:writeFileSync|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync|symlinkSync)$/.test(c.fn)), [], "nothing is written");
  // Every look at a path LOOT names is lstat, below the game's folder.
  for (const c of spy.calls.filter((c) => c.fn === "lstatSync")) assert.ok(c.path.startsWith(w.gameDir + sep), c.path);
  // No file the masterlist can name is opened or read: only the plugin list and Steam's and the game's own lists are.
  const opened = spy.calls.filter((c) => c.fn === "openSync" || c.fn === "readFileSync").map((c) => c.path);
  for (const path of opened) assert.match(path, /(?:Plugins\.txt|Skyrim\.ccc|\.vdf|\.acf)$/, path);
  assert.ok(!spy.calls.some((c) => /^\s*[\\/]{2}/.test(c.path)), "a network path was touched");
});

// ─── Mod Organizer 2 ─────────────────────────────────────────────────────────

type Mods = Record<string, Record<string, Buffer | string>>;

const MODS: Mods = {
  "Needs Mod": { "Needs.esp": tes4(), "SKSE/Plugins/there.dll": "dll" },
  "Off Mod": { "SKSE/Plugins/gone.dll": "dll", "Absent.esm": tes4() },
};

/**
 * An MO2 instance whose settings name the game folder it plays: Steam's by default, the folder given, or, with null,
 * none. With forward slashes, as MO2 writes a path, since to QSettings a lone backslash starts an escape.
 */
function mo2Install(o: { mods?: Mods; modlist?: string[]; game?: string | null; w?: World } = {}) {
  const w = o.w ?? install();
  const game = o.game === undefined ? w.gameDir : o.game;
  const mo2 = makeMo2(w, {
    modlist: o.modlist ?? ["+Needs Mod", "-Off Mod"],
    plugins: ["*Needs.esp"],
    mods: o.mods ?? MODS,
    overwrite: { "SKSE/Plugins/ow.dll": "dll" },
    ...(game === null ? {} : { ini: `gamePath=@ByteArray(${game.replace(/\\/g, "/")})` }),
  });
  return { w, mo2, run: (options: Partial<RequirementsOptions> = {}) => run({ mo2InstancePath: mo2.instance, ...options }) };
}

test("with MO2, Data's files are looked for in Data, each enabled mod and Overwrite; one only in a mod that is off is missing", async () => {
  const { w, mo2, run: check } = mo2Install();
  const spy = spyOnFs();
  let r: RequirementsReport;
  try {
    r = await check();
  } finally {
    spy.restore();
  }
  assert.equal(r.from, "Mod Organizer 2");
  assert.equal(r.profile, "Default");
  assert.equal(r.activePlugins, 6, "the five base plugins, and Needs.esp from its mod");
  assert.equal(status(r, "SKSE/Plugins/there.dll"), "present");
  assert.equal(status(r, "SKSE/Plugins/ow.dll"), "present");
  const where = "it isn't in the game's Data folder, any enabled mod's folder or Overwrite";
  assert.deepEqual(of(r, "SKSE/Plugins/gone.dll"), { plugin: "Needs.esp", file: "SKSE/Plugins/gone.dll", display: "Gone DLL", status: "missing", why: where });
  assert.deepEqual(of(r, "Absent.esm"), { plugin: "Needs.esp", file: "Absent.esm", status: "missing", why: where });
  assert.equal(status(r, "../skse64_loader.exe"), "present");
  // With MO2 a mod can put files in the game's folder only while the game runs, so not finding one there proves nothing.
  assert.equal(status(r, "../gone_loader.exe"), "unknown");
  assert.match(of(r, "../gone_loader.exe")!.why!, /Root Builder/);
  // Every lstat is below the game's folder, the enabled mod's folder or Overwrite, and never in the mod that is off.
  const enabled = join(mo2.mods, "Needs Mod");
  const lstats = spy.calls.filter((c) => c.fn === "lstatSync").map((c) => c.path);
  assert.ok(lstats.length > 0);
  for (const path of lstats) assert.ok([w.gameDir + sep, enabled, mo2.overwrite + sep].some((root) => path.startsWith(root)), path);
});

test("with MO2, the game folder is the one its settings name, such as a Stock Game beside the instance", async () => {
  const w = install();
  const stock = join(w.root, "Stock Game");
  for (const name of ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"]) putRel(join(stock, "Data"), name, tes4());
  putRel(join(stock, "Data"), "SKSE/Plugins/gone.dll", "dll");
  putRel(stock, "gone_loader.exe", "exe");
  const r = await mo2Install({ w, game: stock }).run();
  assert.equal(status(r, "SKSE/Plugins/gone.dll"), "present", "it is in the Stock Game's Data, not Steam's");
  assert.equal(status(r, "../gone_loader.exe"), "present");
  assert.equal(status(r, "../skse64_loader.exe"), "unknown", "Steam's copy has it; the Stock Game doesn't");
});

test("with MO2, settings that don't say which game folder it plays leave Data's files unknown, never missing", async () => {
  const r = await mo2Install({ game: null }).run();
  assert.equal(status(r, "SKSE/Plugins/there.dll"), "present");
  assert.equal(status(r, "SKSE/Plugins/gone.dll"), "unknown");
  assert.match(of(r, "SKSE/Plugins/gone.dll")!.why!, /don't name the game folder it plays/);
  assert.ok(r.requirements.every((q) => q.status !== "missing"));
});

test("with MO2, a mod folder that is a link isn't followed, and one with an odd name isn't looked in: absence is unknown", async () => {
  const linked = mo2Install({ modlist: ["+Needs Mod", "+Linked Mod", "-Off Mod"] });
  // The decoy folder holds no gone.dll, so following the link would wrongly prove it missing.
  linkFolder(OUTSIDE, join(linked.mo2.mods, "Linked Mod"));
  let r = await linked.run();
  assert.equal(status(r, "SKSE/Plugins/gone.dll"), "unknown");
  assert.match(of(r, "SKSE/Plugins/gone.dll")!.why!, /a link or junction is on the way/);
  assert.equal(status(r, "SKSE/Plugins/there.dll"), "present");

  r = await mo2Install({ modlist: ["+Needs Mod", "+../mods/Off Mod"] }).run();
  assert.equal(status(r, "SKSE/Plugins/gone.dll"), "unknown", "the odd name would reach the mod that is off");
  assert.match(of(r, "SKSE/Plugins/gone.dll")!.why!, /isn't a plain folder name/);
});

test("an MO2 profile that can't be read stops the check, rather than read the game's own list as if it were MO2's", async () => {
  const { mo2 } = mo2Install();
  const r = await checkLootRequirements({ gameId: "skyrimspecialedition", platform: "windows", mo2InstancePath: mo2.instance, profileName: "No Such Profile" });
  assert.equal(r.ok, false);
  assert.match(summarizeRequirements(r), /^Mod Organizer 2 couldn't be read: .*nothing was checked\.$/);
});

test("no plugin list, or a game whose plugin list it doesn't read, is said plainly", async () => {
  install();
  const none = await checkLootRequirements({ gameId: "skyrimspecialedition", platform: "windows" });
  assert.equal(none.ok, false);
  assert.match(summarizeRequirements(none), /no plugin list \(plugins\.txt\)/);
  const other = await checkLootRequirements({ gameId: "oblivion", platform: "windows" });
  assert.equal(other.ok, false);
  assert.match(summarizeRequirements(other), /skyrimspecialedition and fallout4 only/);
});

// ─── The tool ────────────────────────────────────────────────────────────────

type Config = { annotations?: Record<string, boolean>; inputSchema?: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; structuredContent?: unknown }>;

test("mw_loot_requirements takes a game, an MO2 instance and a profile, is read-only, says it reaches out for LOOT's list, and answers in text only", async () => {
  const { registerWorkbenchTools } = await import("../src/register.js");
  const tools = new Map<string, { config: Config; handler: Handler }>();
  registerWorkbenchTools({
    registerTool: (name: string, config: Config, handler: Handler) => void tools.set(name, { config, handler }),
    registerResource: () => undefined,
  } as unknown as never);
  const tool = tools.get("mw_loot_requirements")!;
  assert.deepEqual(Object.keys(tool.config.inputSchema!).sort(), ["gameId", "mo2InstancePath", "profileName"]);
  assert.equal(tool.config.annotations?.readOnlyHint, true);
  assert.equal(tool.config.annotations?.openWorldHint, true, "it fetches LOOT's list");
  assert.equal((tool.config as { _meta?: unknown })._meta, undefined, "it has no page");
  const r = await tool.handler({ gameId: "oblivion" });
  assert.deepEqual(r, { content: [{ type: "text", text: "mw_loot_requirements reads the plugin list of skyrimspecialedition and fallout4 only, so it can't check \"oblivion\"." }] });
});

test("mw_loot_requirements looks in a portable MO2 instance it is pointed at, refuses a network path for one, and says when none was used", async () => {
  const { registerWorkbenchTools } = await import("../src/register.js");
  const tools = new Map<string, Handler>();
  registerWorkbenchTools({ registerTool: (name: string, _c: Config, handler: Handler) => void tools.set(name, handler), registerResource: () => undefined } as unknown as never);
  const tool = tools.get("mw_loot_requirements")!;
  const text = async (args: Record<string, unknown>): Promise<string> => ((await tool(args)) as { content: Array<{ text: string }> }).content[0]!.text;
  const { mo2 } = mo2Install();
  assert.match(await text({ gameId: "skyrimspecialedition", mo2InstancePath: mo2.instance }), /Mod Organizer 2's virtual file system/);
  assert.match(await text({ gameId: "skyrimspecialedition", mo2InstancePath: "\\\\server\\share" }), /mo2InstancePath/);
  windowsInstall();
  assert.match(summarizeRequirements(await run()), /run this again with its folder as mo2InstancePath/);
});

test("the answer names LOOT as the source, lists warnings first, never calls anything a problem, and names no folder", async () => {
  const w = windowsInstall();
  const text = summarizeRequirements(await run());
  // Hostile.esp's requirements quote the masterlist's own paths, one of which is the decoy folder; nothing else names one.
  const ours = text.split("\n").filter((l) => !l.includes("Hostile.esp")).join("\n");
  assert.ok(!ours.includes(sandbox.root) && !text.includes(w.gameDir), "the answer names a folder");
  assert.doesNotMatch(text, /problem/i);
  assert.match(text, /- Warning, missing: LOOT says Needs\.esp needs SKSE\/Plugins\/gone\.dll \("Gone DLL"\)\. It isn't in the game's Data folder\./);
  assert.match(text, /^LOOT's requirements for the 9 active plugins of The Elder Scrolls V: Skyrim Special Edition, read from the game's own plugins\.txt\./);
  assert.match(text, /LOOT calls a missing requirement an error; here it is a warning/);
  assert.match(text, /- Present: LOOT says Needs\.esp needs SKSE\/Plugins\/there\.dll \("There \(https:\/\/example\.test\/there\) DLL"\)\./);
  assert.match(text, /- Unknown: LOOT says Needs\.esp needs SKSE\/Plugins\/unsure\.dll\. LOOT applies it only under a condition ModWrench can't answer: `version\("Needs\.esp", "2\.0", >=\)`\./);
  assert.match(text, /LOOT's note: "In English: 'quoted'\."/);
  assert.match(text, /What this can't tell you:\n- These are LOOT's records/);
  // Warnings first, then unknown, then present.
  const rank = ["- Warning, missing", "- Unknown", "- Present"];
  const order = text.split("\n").filter((l) => /^- (?:Warning, missing|Unknown|Present):/.test(l)).map((l) => rank.indexOf(l.split(":")[0]!));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

