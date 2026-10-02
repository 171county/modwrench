import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDoctor } from "../src/doctor/index.js";
import type { DoctorFinding, DoctorOptions, DoctorReport } from "../src/doctor/types.js";
import { LETHAL, NXM, makePrefix, makeSteam, putDesktop, putLaunchOptions, putMimeList, putRel, userRegWith } from "./helpers/doctor-world.js";
import { createSandbox, type World } from "./helpers/world.js";

// ─── The Deck Doctor, end to end ─────────────────────────────────────────────
// Each test lays out a Steam install the way Linux and the Steam Deck have it (the native
// one, Valve's Flatpak, a library on a card, a Proton prefix with its user.reg, Steam's
// launch options, the desktop's mime lists) and runs the Doctor over it as a Linux system.
// The tests pass `platform: "linux"` and a stand-in for /proc/mounts, so they run the same
// on any machine, and the desktop's lists are temp folders named through the XDG variables.

const sandbox = createSandbox("mw-doctor-deck-");
const DESKTOP_KEYS = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CONFIG_DIRS", "XDG_DATA_DIRS", "XDG_CURRENT_DESKTOP", "FLATPAK_USER_DIR", "FLATPAK_SYSTEM_DIR"] as const;
const savedDesktop: Record<string, string | undefined> = {};
before(() => {
  sandbox.start();
  for (const key of DESKTOP_KEYS) savedDesktop[key] = process.env[key];
});
afterEach(() => {
  sandbox.isolate();
  homeNow = sandbox.home;
});
after(() => {
  for (const key of DESKTOP_KEYS) {
    if (savedDesktop[key] === undefined) delete process.env[key];
    else process.env[key] = savedDesktop[key];
  }
  sandbox.stop();
});

let made = 0;
const fresh = (): string => {
  const dir = join(sandbox.root, `k${made++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

let homeNow = sandbox.home;
const NATIVE = (): string => join(homeNow, ".local", "share", "Steam");
const FLATPAK = (): string => join(homeNow, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam");

/** A home of its own with no STEAM_ROOT override, and a desktop made of empty temp folders. */
function freshHome(): { home: string; config: string; data: string; apps: string } {
  const home = fresh();
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.STEAM_ROOT;
  homeNow = home;
  const root = fresh();
  const config = join(root, "config");
  const data = join(root, "data");
  process.env.XDG_CONFIG_HOME = config;
  process.env.XDG_DATA_HOME = data;
  process.env.XDG_CONFIG_DIRS = join(root, "etc-xdg");
  process.env.XDG_DATA_DIRS = join(root, "share");
  process.env.XDG_CURRENT_DESKTOP = "";
  process.env.FLATPAK_USER_DIR = join(root, "flatpak-user");
  process.env.FLATPAK_SYSTEM_DIR = join(root, "flatpak-system");
  return { home, config, data, apps: join(data, "applications") };
}

const SKYRIM = { appId: "489830", dir: "Skyrim Special Edition", name: "The Elder Scrolls V: Skyrim Special Edition" };
const EXT4 = "/dev/nvme0n1p8 / ext4 rw 0 0\n";

function run(options: DoctorOptions = {}): DoctorReport {
  const result = runDoctor({ platform: "linux", area: "deck", mountsText: EXT4, ...options });
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

/** A world whose Steam is the STEAM_ROOT one, with Lethal Company added to its library. */
function lethal(): World & { game: string } {
  freshHome();
  const w = sandbox.makeWorld();
  const { gameDir } = makeSteam(w.steam, { game: LETHAL });
  return { ...w, game: gameDir! };
}

// ─── Which Steam ─────────────────────────────────────────────────────────────

test("STEAM_ROOT is the one Steam looked at, and is called custom", () => {
  freshHome();
  sandbox.makeWorld();
  const f = must(run(), "deck.steam");
  assert.deepEqual([f.status, f.title, f.basis], ["ok", "Steam: custom (STEAM_ROOT)", "install"]);
  assert.match(f.detail, /One Steam install was found \(custom \(STEAM_ROOT\)\), with 1 library\./);
});

test("a lone native Steam, and a lone Flatpak Steam, are each named", () => {
  freshHome();
  makeSteam(NATIVE(), { game: SKYRIM });
  assert.equal(must(run(), "deck.steam").title, "Steam: native");

  freshHome();
  makeSteam(FLATPAK(), { game: SKYRIM });
  const f = must(run(), "deck.steam");
  assert.equal(f.title, "Steam: Flatpak");
  assert.equal(f.status, "ok");
});

test("Flatpak Steam with a library on another drive is a note about permissions, with the override to grant it", () => {
  freshHome();
  const outside = fresh();
  makeSteam(outside, { game: SKYRIM });
  makeSteam(FLATPAK(), { libraries: [outside] });
  const f = must(run(), "deck.steam");
  assert.equal(f.status, "note");
  assert.equal(f.title, "Flatpak Steam with a library on another drive");
  assert.equal(f.basis, "rule");
  assert.match(f.source ?? "", /flathub\/com\.valvesoftware\.Steam/);
  assert.match(f.fix ?? "", /flatpak override --user --filesystem=/);
  assert.match(f.detail, /ModWrench can't see Flatpak's permission settings/);
});

test("both Steams installed is a note that says which one holds the game", () => {
  freshHome();
  makeSteam(NATIVE());
  makeSteam(FLATPAK(), { game: SKYRIM });
  const f = must(run(), "deck.steam");
  assert.equal(f.status, "note");
  assert.equal(f.title, "Two Steam installs");
  assert.match(f.detail, /Found native and Flatpak Steam\. The game is in the Flatpak one\./);
  assert.deepEqual(f.items, ["native Steam, 1 library", "Flatpak Steam, 1 library"]);

  freshHome();
  makeSteam(NATIVE());
  makeSteam(FLATPAK());
  assert.match(must(run(), "deck.steam").detail, /The game wasn't found in either\./);
});

test("no Steam at all is a problem that says where it looked and how to point at it", () => {
  freshHome();
  const r = run();
  const f = must(r, "deck.steam");
  assert.equal(f.status, "problem");
  assert.equal(f.title, "No Steam install found");
  assert.match(f.detail, /~\/\.local\/share\/Steam, ~\/\.steam\/steam and the Flatpak's folder/);
  assert.match(f.fix ?? "", /STEAM_ROOT/);
  assert.equal(r.looked.steam, "none");
  assert.equal(r.verdict, "problems");
});

test("a game folder given by hand still gets the checks that don't need Steam", () => {
  freshHome();
  const gog = fresh();
  putRel(gog, "Data/Meshes/x.nif", "x");
  const r = run({ gamePath: gog });
  assert.equal(r.looked.gameFolder, true);
  assert.equal(must(r, "deck.steam").status, "problem");
  assert.ok(find(r, "deck.prefix"), "the prefix finding is there, saying there isn't one");
  assert.ok(find(r, "deck.nxm-handler"));
});

// ─── The prefix ──────────────────────────────────────────────────────────────

test("no Proton prefix yet is a warning that says to run the game once from Steam", () => {
  freshHome();
  makeSteam(NATIVE(), { game: SKYRIM });
  const f = must(run(), "deck.prefix");
  assert.deepEqual([f.status, f.title, f.basis], ["warn", "No Proton prefix for this game yet", "rule"]);
  assert.match(f.fix ?? "", /Start the game once from Steam/);
  assert.match(f.source ?? "", /r2modmanPlus/);
});

test("a prefix with no user.reg isn't finished, and one with it is fine", () => {
  freshHome();
  const steam = makeSteam(NATIVE(), { game: SKYRIM });
  makePrefix(steam.steamapps, SKYRIM.appId);
  assert.equal(must(run(), "deck.prefix").title, "The Proton prefix isn't fully set up");

  freshHome();
  const steam2 = makeSteam(NATIVE(), { game: SKYRIM });
  makePrefix(steam2.steamapps, SKYRIM.appId, { userReg: userRegWith(null) });
  const f = must(run(), "deck.prefix");
  assert.deepEqual([f.status, f.title, f.basis], ["ok", "The game has a Proton prefix", "install"]);
});

test("a prefix on the card's library is found, and when two libraries have one the most recently launched wins", () => {
  freshHome();
  const card = fresh();
  const cardSteam = makeSteam(card);
  const main = makeSteam(NATIVE(), { game: SKYRIM, libraries: [card] });
  const old = makePrefix(main.steamapps, SKYRIM.appId, { userReg: userRegWith(null), lock: true });
  const newer = makePrefix(cardSteam.steamapps, SKYRIM.appId, { lock: true });
  const past = new Date("2020-01-01T00:00:00Z");
  const now = new Date();
  utimesSync(join(old, "..", "pfx.lock"), past, past);
  utimesSync(join(newer, "..", "pfx.lock"), now, now);
  assert.equal(must(run(), "deck.prefix").title, "The Proton prefix isn't fully set up", "the card's newer prefix, which has no user.reg, is the one in use");

  utimesSync(join(old, "..", "pfx.lock"), now, now);
  utimesSync(join(newer, "..", "pfx.lock"), past, past);
  assert.equal(must(run(), "deck.prefix").title, "The game has a Proton prefix");
});

test("with the game not found and no prefix anywhere there is no prefix finding at all", () => {
  freshHome();
  makeSteam(NATIVE());
  const r = run();
  assert.equal(find(r, "deck.prefix"), undefined);
  assert.equal(must(r, "setup.game").area, "deck", "with only the Deck checks asked for, the finding belongs to that group");
});

// ─── BepInEx under Proton ────────────────────────────────────────────────────

const lethalOptions = (w: World & { game: string }): DoctorOptions => ({ gameId: "lethalcompany", gamePath: w.game });

test("no winhttp.dll in the game folder means BepInEx isn't installed there, which is only a note", () => {
  const w = lethal();
  const f = must(run(lethalOptions(w)), "deck.bepinex-override");
  assert.deepEqual([f.status, f.basis], ["note", "install"]);
  assert.equal(f.title, "BepInEx's loader isn't in the game folder");
});

test("BepInEx's loader with no override anywhere is a problem, with the launch option that fixes it and the page that describes the sign", () => {
  const w = lethal();
  writeFileSync(join(w.game, "winhttp.dll"), "x");
  const f = must(run(lethalOptions(w)), "deck.bepinex-override");
  assert.equal(f.status, "problem");
  assert.equal(f.basis, "rule");
  assert.equal(f.title, "BepInEx's loader is there but Proton isn't told to use it");
  assert.match(f.fix ?? "", /WINEDLLOVERRIDES="winhttp=n,b" %command%/);
  assert.match(f.source ?? "", /docs\.bepinex\.dev/);
  assert.match(f.detail, /no BepInEx console and no BepInEx\/config\/BepInEx\.cfg/);
});

test("the same with a BepInEx log in the folder is only a warning: it worked once", () => {
  const w = lethal();
  writeFileSync(join(w.game, "winhttp.dll"), "x");
  putRel(w.game, "BepInEx/LogOutput.log", "[Info] BepInEx 5\n");
  const f = must(run(lethalOptions(w)), "deck.bepinex-override");
  assert.equal(f.status, "warn");
  assert.match(f.title, /though BepInEx has run here/);
  assert.match(f.detail, /A manager that sets the override only for the game it starts can't be seen from files/);
});

test("the override in the game's Steam launch options is enough", () => {
  const w = lethal();
  writeFileSync(join(w.game, "Winhttp.DLL"), "x");
  putLaunchOptions(w.steam, "1001", { [LETHAL.appId]: 'WINEDLLOVERRIDES="winhttp=n,b" %command%' });
  const f = must(run(lethalOptions(w)), "deck.bepinex-override");
  assert.equal(f.status, "ok");
  assert.match(f.detail, /set in the game's Steam launch options, so Proton prefers/);
});

test("the override in the Proton prefix's user.reg is enough, and both together are said together", () => {
  const w = lethal();
  writeFileSync(join(w.game, "winhttp.dll"), "x");
  makePrefix(w.steamapps, LETHAL.appId, { userReg: userRegWith("native,builtin") });
  assert.match(must(run(lethalOptions(w)), "deck.bepinex-override").detail, /set in the game's Proton prefix, so Proton prefers/);

  putLaunchOptions(w.steam, "1001", { [LETHAL.appId]: "WINEDLLOVERRIDES=winhttp=n,b %command%" });
  assert.match(must(run(lethalOptions(w)), "deck.bepinex-override").detail, /in the game's Steam launch options and in its Proton prefix/);
});

test("launch options set for a different game, or the wrong order of native and builtin, don't count", () => {
  const w = lethal();
  writeFileSync(join(w.game, "winhttp.dll"), "x");
  putLaunchOptions(w.steam, "1001", { "489830": 'WINEDLLOVERRIDES="winhttp=n,b" %command%', [LETHAL.appId]: 'WINEDLLOVERRIDES="winhttp=b,n" %command%' });
  makePrefix(w.steamapps, LETHAL.appId, { userReg: userRegWith("builtin,native") });
  assert.equal(must(run(lethalOptions(w)), "deck.bepinex-override").status, "problem");
});

test("the rest of the launch options line, and the Steam account number it sits under, are never in the report", () => {
  const w = lethal();
  writeFileSync(join(w.game, "winhttp.dll"), "x");
  putLaunchOptions(w.steam, "48151623", { [LETHAL.appId]: 'PRIVATE_TOKEN=abc123-secret-value WINEDLLOVERRIDES="winhttp=n,b" gamemoderun %command%' });
  const r = run(lethalOptions(w));
  assert.equal(must(r, "deck.bepinex-override").status, "ok");
  const everything = JSON.stringify(r);
  for (const leak of ["abc123", "PRIVATE_TOKEN", "gamemoderun", "WINEDLLOVERRIDES=\"winhttp=n,b\" gamemoderun", "48151623"]) {
    assert.ok(!everything.includes(leak), `the report contains ${leak}`);
  }
});

test("the BepInEx check is only for games that use it", () => {
  freshHome();
  makeSteam(NATIVE(), { game: SKYRIM });
  assert.equal(find(run(), "deck.bepinex-override"), undefined);
});

// ─── nxm:// links ────────────────────────────────────────────────────────────

test("the Mod Manager Download button's handler is looked up for the Bethesda games", () => {
  const { config, apps } = freshHome();
  makeSteam(NATIVE(), { game: SKYRIM });
  assert.equal(must(run(), "deck.nxm-handler").title, "Nothing is set to open nxm:// links");

  putMimeList(join(config, "mimeapps.list"), { "Default Applications": { [NXM]: ["modorganizer2-nxm-handler.desktop"] } });
  putDesktop(apps, "modorganizer2-nxm-handler.desktop", { Name: "Mod Organizer 2 NXM Handler", Exec: "modorganizer2-nxm-handler %u" });
  const f = must(run(), "deck.nxm-handler");
  assert.deepEqual([f.status, f.title], ["ok", "nxm:// links open Mod Organizer 2"]);
});

test("the nxm check isn't run for a game that doesn't use Nexus the way the Bethesda games do", () => {
  const w = lethal();
  assert.equal(find(run(lethalOptions(w)), "deck.nxm-handler"), undefined);
});

// ─── The drive ───────────────────────────────────────────────────────────────

test("a library on an NTFS drive is a warning when it holds the game", (t) => {
  if (process.platform === "win32") return t.skip("mount points are a Linux idea");
  freshHome();
  const steam = makeSteam(NATIVE(), { game: SKYRIM });
  const lib = realpathSync(steam.steamapps);
  const f = must(run({ mountsText: `${EXT4}/dev/sda1 ${lib} ntfs3 rw 0 0\n` }), "deck.library-drive");
  assert.deepEqual([f.status, f.basis], ["warn", "rule"]);
  assert.match(f.detail, /\(including the one with this game\) sits on ntfs3/);
});

test("Linux filesystems are fine, and an empty mount table doesn't make up a drive type", (t) => {
  if (process.platform === "win32") return t.skip("mount points are a Linux idea");
  freshHome();
  makeSteam(NATIVE(), { game: SKYRIM });
  const ok = must(run(), "deck.library-drive");
  assert.equal(ok.status, "ok");
  assert.match(ok.detail, /1 library checked \(ext4\)\./);
  const empty = must(run({ mountsText: "" }), "deck.library-drive");
  assert.equal(empty.status, "ok");
  assert.match(empty.detail, /^1 library checked\.$/);
});

// ─── Folder names that differ only by case ───────────────────────────────────

function caseSensitive(): boolean {
  const dir = fresh();
  writeFileSync(join(dir, "a"), "");
  writeFileSync(join(dir, "A"), "");
  return readdirSync(dir).length === 2;
}

test("Meshes and meshes in the Data folder are a warning that says Wine sees only one of them", (t) => {
  if (!caseSensitive()) return t.skip("this file system doesn't tell Meshes from meshes");
  freshHome();
  const steam = makeSteam(NATIVE(), { game: SKYRIM });
  mkdirSync(join(steam.gameDir!, "Data", "Meshes"), { recursive: true });
  mkdirSync(join(steam.gameDir!, "Data", "meshes"), { recursive: true });
  const f = must(run(), "deck.case-clashes");
  assert.equal(f.status, "warn");
  assert.equal(f.basis, "rule");
  assert.match(f.source ?? "", /uesp\.net/);
  assert.equal(f.items?.length, 1);
  assert.match(f.items?.[0] ?? "", /^(Meshes and meshes|meshes and Meshes)$/);
  assert.match(f.fix ?? "", /Limo has a Case Matching Deployer/);
});

test("a Data folder with no clashes is fine, and no Data folder is no finding", () => {
  freshHome();
  const steam = makeSteam(NATIVE(), { game: SKYRIM });
  assert.equal(find(run(), "deck.case-clashes"), undefined, "no Data folder");
  mkdirSync(join(steam.gameDir!, "Data", "Meshes"), { recursive: true });
  const f = must(run(), "deck.case-clashes");
  assert.equal(f.status, "ok");
  assert.match(f.detail, /Looked two levels into the game's Data folder\./);
});

test("for a BepInEx game the folder looked at is BepInEx/plugins", () => {
  const w = lethal();
  putRel(w.game, "BepInEx/plugins/SomeMod/mod.dll", "x");
  const f = must(run(lethalOptions(w)), "deck.case-clashes");
  assert.equal(f.status, "ok");
  assert.match(f.detail, /BepInEx plugins folder/);
});

// ─── Platforms and areas ─────────────────────────────────────────────────────

test("the Deck checks on Windows or macOS are one note saying they are for Linux", () => {
  freshHome();
  sandbox.makeWorld();
  for (const platform of ["windows", "macos"] as const) {
    const r = run({ platform });
    const deckOnly = r.findings.filter((f) => f.area === "deck");
    assert.deepEqual(
      deckOnly.map((f) => f.id),
      ["deck.platform"],
      platform
    );
    assert.equal(deckOnly[0]?.status, "note");
    assert.match(deckOnly[0]?.detail ?? "", platform === "windows" ? /This computer runs Windows\./ : /This computer runs macOS\./);
  }
});

test("asking for everything on Windows runs the Setup checks only, and on Linux runs both", () => {
  freshHome();
  const w = sandbox.makeWorld();
  putRel(w.gameDir, "Data/Skyrim.esm", "x");
  const win = run({ platform: "windows", area: "all" });
  assert.deepEqual(win.areas, ["setup"]);
  assert.ok(win.findings.every((f) => f.area === "setup"));

  const linux = run({ platform: "linux", area: "all" });
  assert.deepEqual(linux.areas, ["setup", "deck"]);
  assert.ok(linux.findings.some((f) => f.area === "deck"));
  assert.ok(linux.findings.some((f) => f.area === "setup"));
  assert.ok(linux.findings.every((f) => linux.areas.includes(f.area)));
});

test("asking for the Deck checks only on Linux doesn't run the Setup checks", () => {
  freshHome();
  sandbox.makeWorld();
  const r = run({ platform: "linux", area: "deck" });
  assert.deepEqual(r.areas, ["deck"]);
  assert.ok(r.findings.every((f) => f.area === "deck"));
  assert.ok(!r.findings.some((f) => f.id.startsWith("setup.") && f.id !== "setup.game"));
});

test("what the Deck Doctor can't see is listed: manager-only settings, r2modman's own setting, GOG and Epic, Flatpak permissions", () => {
  freshHome();
  sandbox.makeWorld();
  const what = run().notChecked.map((n) => n.what).join(" | ");
  assert.match(what, /Settings a mod manager applies only when it launches the game/);
  assert.match(what, /r2modman's own Proton setting/);
  assert.match(what, /GOG, Epic, Heroic, Lutris/);
  assert.match(what, /Flatpak apps have the folder permissions/);
  assert.match(what, /Whether the game starts/);
});

test("the Steam Deck label is for a real Deck only: a run that names its platform never claims one", () => {
  freshHome();
  sandbox.makeWorld();
  assert.equal(run().steamDeck, false);
});

