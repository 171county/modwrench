import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, userInfo } from "node:os";

import {
  findSteamLibraries,
  findInstalledApp,
  findProtonPrefix,
} from "../src/detect/steam.js";
import { detectInstalledManagers } from "../src/detect/manager.js";

// ─── Why these tests exist ────────────────────────────────────────────────────
// The detection code is the part of ModWrench nobody else has, and it is also
// the part that running the server cannot exercise: it only does anything on a
// machine that has Steam, a Proton prefix, and a mod manager installed. It
// shipped broken on Linux for exactly that reason — MO2 detection returned an
// empty list on every non-Windows platform and nobody noticed.
//
// These build real directory trees in a temp dir and point the detectors at
// them, which makes Steam Deck layouts verifiable from a Windows dev box. That
// is the whole problem being solved here: development happens on Windows and
// every one of these bugs was on Linux.
//
// process.platform is stubbed rather than threading a platform argument through
// the API. The platform checks are load-bearing (they keep the Windows path
// from touching prefix scanning at all) and a test-only parameter would be a
// worse public interface than a stub.

let TMP: string;
const realPlatform = process.platform;
const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

/** Use forward slashes everywhere so VDF fixtures need no escaping. */
function slash(p: string): string {
  return p.split(String.fromCharCode(92)).join("/");
}

function mkdirp(...parts: string[]): string {
  const p = join(...parts);
  mkdirSync(p, { recursive: true });
  return p;
}

function write(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
}

/** Build a Wine/Proton prefix containing a Windows-side AppData tree. */
function makePrefixWithAppData(
  lib: string,
  appId: string,
  user: string,
  relParts: string[]
): void {
  const users = mkdirp(lib, "compatdata", appId, "pfx", "drive_c", "users");
  mkdirp(users, user, ...relParts);
}

before(() => {
  TMP = mkdtempSync(join(tmpdir(), "modwrench-detect-"));
});

after(() => {
  Object.defineProperty(process, "platform", {
    value: realPlatform,
    configurable: true,
  });
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realUserProfile;
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    // Best effort — a temp dir left behind is not worth failing a run over.
  }
});

// ─── findSteamLibraries ───────────────────────────────────────────────────────

test("findSteamLibraries: returns the primary steamapps dir", () => {
  const root = mkdirp(TMP, "libs-primary", "Steam");
  mkdirp(root, "steamapps");
  const libs = findSteamLibraries(root);
  assert.equal(libs.length, 1);
  assert.ok(libs[0]!.toLowerCase().endsWith("steamapps"));
});

test("findSteamLibraries: picks up a second library from the object form", () => {
  const base = mkdirp(TMP, "libs-object");
  const root = mkdirp(base, "Steam");
  const primary = mkdirp(root, "steamapps");
  const sd = mkdirp(base, "sdcard");
  mkdirp(sd, "steamapps");
  write(
    join(primary, "libraryfolders.vdf"),
    [
      '"libraryfolders"',
      "{",
      '\t"0"',
      "\t{",
      `\t\t"path"\t\t"${slash(root)}"`,
      "\t}",
      '\t"1"',
      "\t{",
      `\t\t"path"\t\t"${slash(sd)}"`,
      "\t}",
      "}",
    ].join("\n")
  );
  const libs = findSteamLibraries(root);
  assert.equal(libs.length, 2, "primary + sd card");
  assert.ok(libs.some((l) => slash(l).includes("sdcard")));
});

test("findSteamLibraries: handles the older bare-string path form", () => {
  // Older Steam maps the numeric key straight to a path string rather than to
  // an object with a "path" key. Only the object form used to be handled, so
  // every extra library on an older install was silently dropped.
  const base = mkdirp(TMP, "libs-bare");
  const root = mkdirp(base, "Steam");
  const primary = mkdirp(root, "steamapps");
  const second = mkdirp(base, "drive2");
  mkdirp(second, "steamapps");
  write(
    join(primary, "libraryfolders.vdf"),
    [
      '"libraryfolders"',
      "{",
      `\t"0"\t\t"${slash(root)}"`,
      `\t"1"\t\t"${slash(second)}"`,
      "}",
    ].join("\n")
  );
  const libs = findSteamLibraries(root);
  assert.ok(
    libs.some((l) => slash(l).includes("drive2")),
    "bare-string library must be found"
  );
});

test("findSteamLibraries: matches SteamApps case-insensitively", () => {
  // Legacy installs use "SteamApps". Steam resolves the name case-insensitively;
  // on a case-sensitive filesystem a hardcoded lowercase name loses the library.
  const base = mkdirp(TMP, "libs-case");
  const root = mkdirp(base, "Steam");
  mkdirp(root, "SteamApps");
  const libs = findSteamLibraries(root);
  assert.equal(libs.length, 1);
  assert.ok(libs[0]!.toLowerCase().endsWith("steamapps"));
});

test("findSteamLibraries: survives a missing libraryfolders.vdf", () => {
  const root = mkdirp(TMP, "libs-novdf", "Steam");
  mkdirp(root, "steamapps");
  assert.equal(findSteamLibraries(root).length, 1);
});

// ─── findInstalledApp ─────────────────────────────────────────────────────────

test("findInstalledApp: finds a game living in the second library", () => {
  const base = mkdirp(TMP, "app-second");
  const lib1 = mkdirp(base, "Steam", "steamapps");
  const lib2 = mkdirp(base, "sdcard", "steamapps");
  mkdirp(lib2, "common", "Skyrim Special Edition");
  write(
    join(lib2, "appmanifest_489830.acf"),
    [
      '"AppState"',
      "{",
      '\t"appid"\t\t"489830"',
      '\t"name"\t\t"The Elder Scrolls V: Skyrim Special Edition"',
      '\t"installdir"\t\t"Skyrim Special Edition"',
      "}",
    ].join("\n")
  );
  const app = findInstalledApp([lib1, lib2], "489830");
  assert.ok(app, "app must be found in the non-primary library");
  assert.equal(app!.appId, "489830");
  assert.ok(slash(app!.installDir).includes("sdcard"));
});

// ─── findProtonPrefix ─────────────────────────────────────────────────────────

test("findProtonPrefix: returns null off Linux", () => {
  setPlatform("win32");
  assert.equal(findProtonPrefix([TMP], "489830"), null);
});

test("findProtonPrefix: finds a prefix in a NON-primary library", () => {
  // The original bug. compatdata was looked up only under the primary Steam
  // root, so every game on a second drive or a Steam Deck SD card reported no
  // Proton at all. Steam stores the prefix in the SAME library as the game.
  setPlatform("linux");
  const base = mkdirp(TMP, "proton-sd");
  const lib1 = mkdirp(base, "Steam", "steamapps");
  const lib2 = mkdirp(base, "sdcard", "steamapps");
  const compat = mkdirp(lib2, "compatdata", "489830");
  mkdirp(compat, "pfx");
  write(join(compat, "pfx.lock"), "");
  write(join(compat, "version"), "9.0-203\n");

  const found = findProtonPrefix([lib1, lib2], "489830");
  assert.ok(found, "prefix in the SD-card library must be found");
  assert.equal(found!.prefixVersion, "9.0-203");
  assert.ok(slash(found!.prefixPath).includes("sdcard"));
});

test("findProtonPrefix: reports the Proton build, not the prefix schema version", () => {
  // compatdata/<appid>/version is a PREFIX SCHEMA version — Proton 10.0-4
  // writes "10.1000-105". Surfacing that as the Proton version is misleading.
  // config_info line 2 is the fonts dir inside the Proton distribution, which
  // names the build a user would actually recognize.
  setPlatform("linux");
  const lib = mkdirp(TMP, "proton-cfg", "steamapps");
  const compat = mkdirp(lib, "compatdata", "377160");
  mkdirp(compat, "pfx");
  write(join(compat, "pfx.lock"), "");
  write(join(compat, "version"), "10.1000-105\n");
  write(
    join(compat, "config_info"),
    [
      "10.1000-105",
      "/home/deck/.local/share/Steam/steamapps/common/Proton 9.0/files/share/fonts/",
      "/lib",
      "/lib64",
    ].join("\n")
  );

  const found = findProtonPrefix([lib], "377160");
  assert.ok(found);
  assert.equal(found!.protonBuild, "Proton 9.0");
  assert.equal(
    found!.prefixVersion,
    "10.1000-105",
    "schema version is kept, but separately"
  );
});

test("findProtonPrefix: handles a GE-Proton build name", () => {
  setPlatform("linux");
  const lib = mkdirp(TMP, "proton-ge", "steamapps");
  const compat = mkdirp(lib, "compatdata", "1966720");
  mkdirp(compat, "pfx");
  write(join(compat, "pfx.lock"), "");
  write(
    join(compat, "config_info"),
    [
      "GE-Proton11-6",
      "/home/deck/.steam/root/compatibilitytools.d/GE-Proton11-6/files/share/fonts/",
    ].join("\n")
  );
  const found = findProtonPrefix([lib], "1966720");
  assert.equal(found!.protonBuild, "GE-Proton11-6");
});

test("findProtonPrefix: picks the most recently used prefix when two exist", () => {
  // A prefix and its game can live in different libraries, so more than one
  // candidate is possible. pfx.lock is touched on every launch, which makes
  // its mtime the tiebreaker.
  setPlatform("linux");
  const base = mkdirp(TMP, "proton-dupe");
  const libOld = mkdirp(base, "old", "steamapps");
  const libNew = mkdirp(base, "new", "steamapps");
  for (const [lib, version] of [
    [libOld, "old-prefix"],
    [libNew, "new-prefix"],
  ] as const) {
    const compat = mkdirp(lib, "compatdata", "489830");
    mkdirp(compat, "pfx");
    write(join(compat, "pfx.lock"), "");
    write(join(compat, "version"), version);
  }
  const oldLock = join(libOld, "compatdata", "489830", "pfx.lock");
  const past = new Date(Date.now() - 3600_000);
  utimesSync(oldLock, past, past);

  const found = findProtonPrefix([libOld, libNew], "489830");
  assert.equal(found!.prefixVersion, "new-prefix");
});

test("findProtonPrefix: returns null when the prefix was never created", () => {
  setPlatform("linux");
  const lib = mkdirp(TMP, "proton-none", "steamapps");
  mkdirp(lib, "compatdata", "489830"); // dir exists, but no pfx inside
  assert.equal(findProtonPrefix([lib], "489830"), null);
});

// ─── detectInstalledManagers ──────────────────────────────────────────────────

test("detectInstalledManagers: finds MO2 inside a Proton prefix", () => {
  // mo2Candidates() returned [] on every non-Windows platform, so MO2 was
  // undetectable on Linux and Steam Deck. MO2 has no native Linux build — it
  // runs inside a prefix, where its data sits at the Windows AppData path and
  // nothing under $HOME will ever match.
  setPlatform("linux");
  const home = mkdirp(TMP, "mgr-mo2-home");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const lib = mkdirp(TMP, "mgr-mo2", "steamapps");
  makePrefixWithAppData(lib, "489830", "steamuser", [
    "AppData",
    "Local",
    "ModOrganizer",
    "Skyrim Special Edition",
  ]);

  const managers = detectInstalledManagers([lib]);
  const mo2 = managers.find((m) => m.name === "mo2");
  assert.ok(mo2, "MO2 inside a Proton prefix must be detected");
  assert.ok(mo2!.managedGameIds?.includes("Skyrim Special Edition"));
});

test("detectInstalledManagers: finds Vortex inside a Proton prefix", () => {
  setPlatform("linux");
  const home = mkdirp(TMP, "mgr-vortex-home");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const lib = mkdirp(TMP, "mgr-vortex", "steamapps");
  makePrefixWithAppData(lib, "489830", "steamuser", [
    "AppData",
    "Roaming",
    "Vortex",
  ]);
  const managers = detectInstalledManagers([lib]);
  assert.ok(
    managers.some((m) => m.name === "vortex"),
    "Vortex inside a prefix must be detected"
  );
});

test("detectInstalledManagers: finds MO2 under the real username in a plain Wine prefix", () => {
  // Proton names the prefix user "steamuser"; plain Wine (Lutris, Bottles,
  // bare wine) uses the actual login name. Both have to work.
  setPlatform("linux");
  const home = mkdirp(TMP, "mgr-wine-home");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const lib = mkdirp(TMP, "mgr-wineuser", "steamapps");
  makePrefixWithAppData(lib, "12345", userInfo().username, [
    "AppData",
    "Local",
    "ModOrganizer",
    "Fallout4",
  ]);
  const managers = detectInstalledManagers([lib]);
  const mo2 = managers.find((m) => m.name === "mo2");
  assert.ok(mo2, "MO2 under the real Wine username must be detected");
  assert.ok(mo2!.managedGameIds?.includes("Fallout4"));
});

test("detectInstalledManagers: r2modman flatpak uses the real app id", () => {
  // Regression guard. The code shipped "com.kalindudc.r2modmanPlus", which does
  // not exist, so every flatpak install was silently invisible — no error, just
  // an empty result. The published id is io.github.ebkr.r2modman.
  setPlatform("linux");
  const home = mkdirp(TMP, "mgr-r2-home");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  mkdirp(
    home,
    ".var",
    "app",
    "io.github.ebkr.r2modman",
    "config",
    "r2modmanPlus-local",
    "LethalCompany"
  );
  const managers = detectInstalledManagers([]);
  const r2 = managers.find((m) => m.name === "r2modman");
  assert.ok(r2, "flatpak r2modman must be found via io.github.ebkr.r2modman");
  assert.ok(slash(r2!.dataPath).includes("io.github.ebkr.r2modman"));
  assert.ok(
    !slash(r2!.dataPath).includes("kalindudc"),
    "the non-existent app id must never come back"
  );
});

test("detectInstalledManagers: finds native Linux MO2 via the MO2-LINT registry", () => {
  // MO2 installed by the Linux installer lives outside any prefix; its own
  // state file is the only reliable way to find those instances.
  setPlatform("linux");
  const home = mkdirp(TMP, "mgr-lint-home");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const cfg = mkdirp(home, ".config", "mo2-lint");
  write(
    join(cfg, "state.json"),
    JSON.stringify({ instances: [{ name: "SkyrimSE" }, { name: "Fallout4" }] })
  );
  const managers = detectInstalledManagers([]);
  const mo2 = managers.find((m) => m.name === "mo2");
  assert.ok(mo2, "native MO2 must be found through the installer registry");
  assert.ok(mo2!.managedGameIds?.includes("SkyrimSE"));
});

test("detectInstalledManagers: returns empty rather than throwing with nothing installed", () => {
  setPlatform("linux");
  const home = mkdirp(TMP, "mgr-empty-home");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  assert.deepEqual(detectInstalledManagers([]), []);
});
