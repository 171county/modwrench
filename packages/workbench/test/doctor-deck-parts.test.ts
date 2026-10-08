import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driveFinding, findCaseClashes } from "../src/doctor/deck.js";
import { parseMounts } from "../src/doctor/mounts.js";
import { findNxmHandler, judgeNxm, type NxmResult } from "../src/doctor/nxm.js";
import { discoverSteam, listSteamInstalls, type SteamFacts, type SteamInstall, type SteamKind } from "../src/doctor/steam.js";
import { launchOptionsFor, launchOptionsOverrideWinhttp, overridesPreferNative, prefixPrefersNativeWinhttp } from "../src/doctor/steamfiles.js";
import { NXM, lockAway, makeSteam, putDesktop, putLaunchOptions, putMimeList, putRel, userRegWith } from "./helpers/doctor-world.js";
import { createSandbox } from "./helpers/world.js";

// ─── The Deck Doctor's pieces ────────────────────────────────────────────────
// What decides whether BepInEx loads under Proton, which app gets nxm:// links, which Steam
// holds the game, what kind of drive a library is on, and folder names that differ only by
// case. Each of these reads a few small files, so each test builds those files, in the
// format the real ones have, in a temp folder and reads them back.
//
// HOME, STEAM_ROOT and the rest point into the sandbox, so what the code finds is only what
// the test built.

const sandbox = createSandbox("mw-deckparts-");
before(() => sandbox.start());
afterEach(() => {
  sandbox.isolate();
  homeNow = sandbox.home;
});
after(() => sandbox.stop());

let made = 0;
const fresh = (): string => {
  const dir = join(sandbox.root, `p${made++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const SKYRIM = "489830";
const LETHAL = "1966720";

// ─── Steam's launch options ──────────────────────────────────────────────────

test("launch options: read from each Steam account's localconfig.vdf, for the one game asked about", () => {
  const steam = fresh();
  putLaunchOptions(steam, "1001", { [LETHAL]: 'WINEDLLOVERRIDES="winhttp=n,b" %command%', [SKYRIM]: "-windowed %command%" });
  putLaunchOptions(steam, "2002", { [LETHAL]: "PROTON_LOG=1 %command%" });
  assert.deepEqual(launchOptionsFor(steam, LETHAL).sort(), ['WINEDLLOVERRIDES="winhttp=n,b" %command%', "PROTON_LOG=1 %command%"].sort());
  assert.deepEqual(launchOptionsFor(steam, SKYRIM), ["-windowed %command%"]);
  assert.deepEqual(launchOptionsFor(steam, "12345"), []);
});

test("launch options: an account folder that isn't a number is ignored, and so are empty options", () => {
  const steam = fresh();
  putLaunchOptions(steam, "anonymous", { [LETHAL]: "SHOULD_NOT_BE_READ=1 %command%" });
  putLaunchOptions(steam, "3003", { [LETHAL]: "   " });
  assert.deepEqual(launchOptionsFor(steam, LETHAL), []);
});

test("launch options: the keys are matched without regard to case, and the userdata folder too", () => {
  const steam = fresh();
  putLaunchOptions(steam, "1001", { [LETHAL]: "FIRST=1 %command%" });
  assert.deepEqual(launchOptionsFor(steam, LETHAL), ["FIRST=1 %command%"]);
  const other = fresh();
  putRel(
    other,
    "UserData/1001/Config/LocalConfig.vdf",
    '"UserLocalConfigStore"\n{\n"software"\n{\n"VALVE"\n{\n"steam"\n{\n"Apps"\n{\n"1966720"\n{\n"launchoptions" "LOWER=1 %command%"\n}\n}\n}\n}\n}\n}\n'
  );
  assert.deepEqual(launchOptionsFor(other, LETHAL), ["LOWER=1 %command%"]);
});

test("launch options: no userdata, an unreadable file or a file that isn't VDF all read as no options", () => {
  assert.deepEqual(launchOptionsFor(fresh(), LETHAL), []);
  const steam = fresh();
  putRel(steam, "userdata/1001/config/localconfig.vdf", "this is { not valid vdf");
  putRel(steam, "userdata/1002/config/localconfig.vdf", "");
  putRel(steam, "userdata/1003/config/localconfig.vdf", Buffer.from([0xff, 0xfe, 0x00, 0x01]));
  mkdirSync(join(steam, "userdata", "1004", "config", "localconfig.vdf"), { recursive: true });
  assert.deepEqual(launchOptionsFor(steam, LETHAL), []);
});

test("launch options: a quote or a backslash inside the options survives Steam's escaping", () => {
  const steam = fresh();
  putLaunchOptions(steam, "1001", { [LETHAL]: 'WINEDLLOVERRIDES="winhttp=n,b" PATH_X=C:\\games\\x %command%' });
  assert.deepEqual(launchOptionsFor(steam, LETHAL), ['WINEDLLOVERRIDES="winhttp=n,b" PATH_X=C:\\games\\x %command%']);
});

// ─── The winhttp override ────────────────────────────────────────────────────

test("overridesPreferNative: n, native, and a list that starts with either, for the DLL named", () => {
  for (const value of ["winhttp=n,b", "winhttp=n", "winhttp=native,builtin", "winhttp=native", "WINHTTP=N,B", "winhttp.dll=n,b", " winhttp = n ,b"]) {
    assert.equal(overridesPreferNative(value, "winhttp"), true, value);
  }
});

test("overridesPreferNative: builtin first, disabled, another DLL, or no setting at all is not a native preference", () => {
  for (const value of ["winhttp=b,n", "winhttp=b", "winhttp=d", "winhttp=", "winhttp", "dxgi=n,b", "version=n", "", ";", "=n"]) {
    assert.equal(overridesPreferNative(value, "winhttp"), false, JSON.stringify(value));
  }
});

test("overridesPreferNative: several DLLs in one value, separated by semicolons or sharing one setting", () => {
  assert.equal(overridesPreferNative("version=n,b;winhttp=n,b", "winhttp"), true);
  assert.equal(overridesPreferNative("dxgi,winhttp=n", "winhttp"), true);
  assert.equal(overridesPreferNative("winhttp=b;dxgi=n", "winhttp"), false);
  assert.equal(overridesPreferNative("dxgi,version=n", "winhttp"), false);
});

test("a launch-options line that sets WINEDLLOVERRIDES for winhttp, quoted any way Steam might store it", () => {
  const yes = [
    'WINEDLLOVERRIDES="winhttp=n,b" %command%',
    "WINEDLLOVERRIDES='winhttp=n,b' %command%",
    "WINEDLLOVERRIDES=winhttp=n,b %command%",
    'WINEDLLOVERRIDES=\\"winhttp=n,b\\" %command%',
    'PROTON_LOG=1 WINEDLLOVERRIDES="winhttp=n,b" %command% -popupwindow',
    'wineDllOverrides = "winhttp=n,b" %command%',
    'WINEDLLOVERRIDES="dxgi=n;winhttp=n,b" %command%',
  ];
  for (const line of yes) assert.equal(launchOptionsOverrideWinhttp(line), true, line);
});

test("a launch-options line that doesn't", () => {
  const no = [
    "%command%",
    "",
    'WINEDLLOVERRIDES="dxgi=n,b" %command%',
    'WINEDLLOVERRIDES="winhttp=b,n" %command%',
    "PROTON_NO_ESYNC=1 %command%",
    "-windowed -noborder",
  ];
  for (const line of no) assert.equal(launchOptionsOverrideWinhttp(line), false, line);
});

test("prefix registry: winhttp set to native in DllOverrides is a native preference, in any of the ways wine writes it", () => {
  for (const value of ["native,builtin", "native", "n,b", "n", "Native,Builtin"]) {
    const prefix = fresh();
    writeFileSync(join(prefix, "user.reg"), userRegWith(value));
    assert.equal(prefixPrefersNativeWinhttp(prefix), true, value);
  }
});

test("prefix registry: builtin first, no winhttp key, or the key in some other section is not", () => {
  for (const value of ["builtin,native", "builtin", "disabled", null]) {
    const prefix = fresh();
    writeFileSync(join(prefix, "user.reg"), userRegWith(value));
    assert.equal(prefixPrefersNativeWinhttp(prefix), false, String(value));
  }
});

test("prefix registry: no user.reg is null, since that is how a prefix Proton hasn't finished looks", () => {
  assert.equal(prefixPrefersNativeWinhttp(fresh()), null);
  assert.equal(prefixPrefersNativeWinhttp(join(fresh(), "missing")), null);
});

test("prefix registry: Windows line endings, a single-backslash section name, and a winhttp.dll key all read the same", () => {
  const prefix = fresh();
  writeFileSync(join(prefix, "user.reg"), '[Software\\Wine\\DllOverrides] 1\r\n"winhttp.dll"="native"\r\n');
  assert.equal(prefixPrefersNativeWinhttp(prefix), true);
});

// ─── Which app opens nxm:// links ────────────────────────────────────────────

type Desk = { env: Record<string, string>; home: string; config: string; data: string; apps: string; etc: string; share: string; bin: string; root: string };

/** A desktop made of temp folders: every place the specification looks lives under one root. */
function desk(desktop = ""): Desk {
  const root = fresh();
  const d: Desk = {
    root,
    home: join(root, "home"),
    config: join(root, "config"),
    data: join(root, "data"),
    etc: join(root, "etc-xdg"),
    share: join(root, "share"),
    apps: join(root, "data", "applications"),
    bin: join(root, "bin"),
    env: {},
  };
  d.env = {
    XDG_CONFIG_HOME: d.config,
    XDG_DATA_HOME: d.data,
    XDG_CONFIG_DIRS: d.etc,
    XDG_DATA_DIRS: d.share,
    FLATPAK_USER_DIR: join(root, "flatpak-user"),
    FLATPAK_SYSTEM_DIR: join(root, "flatpak-system"),
    XDG_CURRENT_DESKTOP: desktop,
  };
  mkdirSync(d.home, { recursive: true });
  mkdirSync(d.bin, { recursive: true });
  return d;
}

const defaultIs = (file: string, ...ids: string[]): string => putMimeList(file, { "Default Applications": { [NXM]: ids } });

test("nxm: the default named in mimeapps.list, with a launcher file that exists, is what opens the links", () => {
  const d = desk();
  defaultIs(join(d.config, "mimeapps.list"), "modorganizer2-nxm-handler.desktop");
  putDesktop(d.apps, "modorganizer2-nxm-handler.desktop", { Name: "Mod Organizer 2 NXM Handler", Exec: "modorganizer2-nxm-handler %u" });
  assert.deepEqual(findNxmHandler(d.env, d.home), {
    status: "ok",
    id: "modorganizer2-nxm-handler.desktop",
    name: "Mod Organizer 2 NXM Handler",
    label: "Mod Organizer 2",
  });
});

test("nxm: a launcher whose program is an absolute path that is gone is a link to nowhere, and one that exists is fine", () => {
  const d = desk();
  defaultIs(join(d.config, "mimeapps.list"), "mymanager.desktop");
  putDesktop(d.apps, "mymanager.desktop", { Name: "My Manager", Exec: `${join(d.bin, "gone")} %u` });
  assert.equal(findNxmHandler(d.env, d.home).status, "program-missing");

  writeFileSync(join(d.bin, "here"), "#!/bin/sh\n");
  putDesktop(d.apps, "mymanager.desktop", { Name: "My Manager", Exec: `${join(d.bin, "here")} %u` });
  assert.equal(findNxmHandler(d.env, d.home).status, "ok");
});

test("nxm: a quoted program with spaces, and env and VAR=value ahead of it, are read the way the desktop reads them", () => {
  const d = desk();
  defaultIs(join(d.config, "mimeapps.list"), "m.desktop");
  const spaced = join(d.bin, "my manager");
  mkdirSync(spaced, { recursive: true });
  writeFileSync(join(spaced, "run"), "");
  putDesktop(d.apps, "m.desktop", { Name: "M", Exec: `env WINEPREFIX=/x FOO=bar "${join(spaced, "run")}" %u` });
  assert.equal(findNxmHandler(d.env, d.home).status, "ok");
  putDesktop(d.apps, "m.desktop", { Name: "M", Exec: `env WINEPREFIX=/x FOO=bar "${join(spaced, "norun")}" %u` });
  assert.equal(findNxmHandler(d.env, d.home).status, "program-missing");
});

test("nxm: TryExec pointing at a program that isn't there counts the same", () => {
  const d = desk();
  defaultIs(join(d.config, "mimeapps.list"), "t.desktop");
  putDesktop(d.apps, "t.desktop", { Name: "T", Exec: "t %u", TryExec: join(d.bin, "nothing") });
  assert.equal(findNxmHandler(d.env, d.home).status, "program-missing");
});

test("nxm: a default that names a launcher that isn't installed is reported with its name", () => {
  const d = desk();
  defaultIs(join(d.config, "mimeapps.list"), "ghost.desktop");
  assert.deepEqual(findNxmHandler(d.env, d.home), { status: "launcher-missing", ids: ["ghost.desktop"] });
});

test("nxm: the first default that exists wins, in one list and across lists", () => {
  const d = desk();
  defaultIs(join(d.config, "mimeapps.list"), "ghost.desktop", "real.desktop");
  putDesktop(d.apps, "real.desktop", { Name: "Real", Exec: "real %u" });
  assert.equal((findNxmHandler(d.env, d.home) as { id: string }).id, "real.desktop");

  const e = desk();
  defaultIs(join(e.config, "mimeapps.list"), "ghost.desktop");
  defaultIs(join(e.etc, "mimeapps.list"), "later.desktop");
  putDesktop(e.apps, "later.desktop", { Name: "Later", Exec: "later %u" });
  assert.equal((findNxmHandler(e.env, e.home) as { id: string }).id, "later.desktop", "a later list's default rescues one that points nowhere");
});

test("nxm: lists are read in the specification's order: the desktop's own file, then mimeapps.list, then the system's", () => {
  const d = desk("KDE");
  for (const id of ["a-kde.desktop", "b-user.desktop", "c-etc.desktop", "d-share.desktop"]) putDesktop(d.apps, id, { Name: id, Exec: "x %u" });
  defaultIs(join(d.share, "applications", "mimeapps.list"), "d-share.desktop");
  defaultIs(join(d.etc, "mimeapps.list"), "c-etc.desktop");
  defaultIs(join(d.config, "mimeapps.list"), "b-user.desktop");
  assert.equal((findNxmHandler(d.env, d.home) as { id: string }).id, "b-user.desktop");

  defaultIs(join(d.config, "kde-mimeapps.list"), "a-kde.desktop");
  assert.equal((findNxmHandler(d.env, d.home) as { id: string }).id, "a-kde.desktop", "kde-mimeapps.list comes first on a KDE desktop");
  assert.equal((findNxmHandler({ ...d.env, XDG_CURRENT_DESKTOP: "GNOME" }, d.home) as { id: string }).id, "b-user.desktop", "and isn't read on another desktop");
  assert.equal((findNxmHandler({ ...d.env, XDG_CURRENT_DESKTOP: "ubuntu:GNOME" }, d.home) as { id: string }).id, "b-user.desktop");

  rmSync(join(d.config, "kde-mimeapps.list"));
  rmSync(join(d.config, "mimeapps.list"));
  assert.equal((findNxmHandler(d.env, d.home) as { id: string }).id, "c-etc.desktop", "the system's config comes before the data folders");
});

test("nxm: with no default, whoever claims the type is listed, sorted and without repeats, and only if their launcher exists", () => {
  const d = desk();
  putMimeList(join(d.config, "mimeapps.list"), { "Added Associations": { [NXM]: ["vortex.desktop", "ghost.desktop"] } });
  putMimeList(join(d.share, "applications", "mimeinfo.cache"), { "MIME Cache": { [NXM]: ["modorganizer2.desktop", "vortex.desktop"] } });
  putDesktop(d.apps, "vortex.desktop", { Name: "Vortex", Exec: "vortex %u" });
  putDesktop(join(d.share, "applications"), "modorganizer2.desktop", { Name: "MO2", Exec: "mo2 %u" });
  assert.deepEqual(findNxmHandler(d.env, d.home), { status: "no-default", claimants: ["modorganizer2.desktop", "vortex.desktop"] });
});

test("nxm: nothing registered at all is 'none'", () => {
  const nothing = desk();
  assert.deepEqual(findNxmHandler(nothing.env, nothing.home), { status: "none" });
  const d = desk();
  putMimeList(join(d.config, "mimeapps.list"), { "Default Applications": { "x-scheme-handler/http": ["browser.desktop"] } });
  assert.deepEqual(findNxmHandler(d.env, d.home), { status: "none" }, "a default for another type isn't one for nxm");
});

test("nxm: Flatpak's exported launchers are found, in the user installation and the system one", () => {
  const d = desk();
  defaultIs(join(d.config, "mimeapps.list"), "com.nexusmods.app.desktop");
  putDesktop(join(d.env.FLATPAK_USER_DIR!, "exports", "share", "applications"), "com.nexusmods.app.desktop", { Name: "Nexus Mods App", Exec: "flatpak run com.nexusmods.app %u" });
  assert.equal((findNxmHandler(d.env, d.home) as { label: string }).label, "the Nexus Mods App");

  const e = desk();
  defaultIs(join(e.config, "mimeapps.list"), "io.github.limo_app.limo.desktop");
  putDesktop(join(e.env.FLATPAK_SYSTEM_DIR!, "exports", "share", "applications"), "io.github.limo_app.limo.desktop", { Name: "Limo", Exec: "flatpak run io.github.limo_app.limo %u" });
  assert.equal((findNxmHandler(e.env, e.home) as { label: string }).label, "Limo");
});

test("nxm: without the XDG variables, the usual places under the home folder are used", () => {
  const d = desk();
  defaultIs(join(d.home, ".config", "mimeapps.list"), "home.desktop");
  putDesktop(join(d.home, ".local", "share", "applications"), "home.desktop", { Name: "Home Manager", Exec: "home %u" });
  const result = findNxmHandler({}, d.home);
  assert.equal(result.status, "ok");
  assert.equal((result as { id: string }).id, "home.desktop");
});

test("nxm: the friendly name comes from the launcher's id and command, and falls back to its own Name, cleaned", () => {
  const label = (id: string, name: string, exec: string): string => {
    const d = desk();
    defaultIs(join(d.config, "mimeapps.list"), id);
    putDesktop(d.apps, id, { Name: name, Exec: exec });
    return (findNxmHandler(d.env, d.home) as { label: string }).label;
  };
  assert.equal(label("modorganizer2-nxm-handler.desktop", "Handler", "h %u"), "Mod Organizer 2");
  assert.equal(label("vortex-nxm.desktop", "Handler", "h %u"), "Vortex");
  assert.equal(label("x.desktop", "Handler", "/opt/Vortex/vortex %u"), "Vortex");
  assert.equal(label("com.nexusmods.app.desktop", "Handler", "h %u"), "the Nexus Mods App");
  assert.equal(label("nexusmods-app.desktop", "Handler", "h %u"), "the Nexus Mods App");
  assert.equal(label("io.github.limo_app.limo.desktop", "Handler", "h %u"), "Limo");
  assert.equal(label("custom.desktop", "My  Own\x07Thing", "h %u"), "My Own Thing");
  assert.equal(label("long.desktop", "N".repeat(200), "h %u").length, 50);
});

test("nxm: lists with Windows line endings, comments, spaces and several ids read the same", () => {
  const d = desk();
  mkdirSync(d.config, { recursive: true });
  writeFileSync(join(d.config, "mimeapps.list"), `# a comment\r\n[Default Applications]\r\n  ${NXM} = ghost.desktop; real.desktop ;\r\n`);
  putDesktop(d.apps, "real.desktop", { Name: "Real", Exec: "real %u" });
  assert.equal((findNxmHandler(d.env, d.home) as { id: string }).id, "real.desktop");
});

const OK: NxmResult = { status: "ok", id: "mo2.desktop", name: "MO2", label: "Mod Organizer 2" };

test("judgeNxm: each outcome is a finding with the page it comes from, and only 'ok' needs no fix", () => {
  const ok = judgeNxm(OK);
  assert.deepEqual([ok.id, ok.area, ok.status, ok.basis], ["deck.nxm-handler", "deck", "ok", "install"]);
  assert.equal(ok.title, "nxm:// links open Mod Organizer 2");
  assert.equal(ok.fix, undefined);

  const results: Array<[NxmResult, string]> = [
    [{ status: "program-missing", id: "a.desktop", name: "A", label: "Vortex" }, "warn"],
    [{ status: "launcher-missing", ids: ["a.desktop"] }, "warn"],
    [{ status: "no-default", claimants: ["a.desktop", "b.desktop"] }, "note"],
    [{ status: "none" }, "note"],
  ];
  for (const [result, status] of results) {
    const f = judgeNxm(result);
    assert.equal(f.status, status, result.status);
    assert.equal(f.basis, "install");
    assert.match(f.source ?? "", /nexus-mods\.github\.io/);
    assert.ok(f.fix, `${result.status} has a fix`);
    assert.match(f.fix ?? "", /xdg-settings set default-url-scheme-handler nxm|Reinstall/);
  }
});

test("judgeNxm: it lists at most three launchers, cleaned, and counts them right", () => {
  const f = judgeNxm({ status: "launcher-missing", ids: ["evil\nNOTES (9)\n.desktop", "two.desktop", "three.desktop", "four.desktop"] });
  assert.match(f.detail, /evil NOTES \(9\) \.desktop, two\.desktop, three\.desktop for nxm:\/\/ links/);
  assert.doesNotMatch(f.detail, /four\.desktop/);
  assert.ok(!/\n/.test(f.detail));
  const claim = judgeNxm({ status: "no-default", claimants: ["evil\nNOTES (9)\n.desktop"] });
  assert.match(claim.detail, /1 installed launcher claims/);
  assert.ok(!/\n/.test(claim.detail));
  assert.match(judgeNxm({ status: "no-default", claimants: ["a.desktop", "b.desktop"] }).detail, /2 installed launchers claim/);
});

test("judgeNxm: one app claiming nxm:// links with no default isn't called several", () => {
  const one = judgeNxm({ status: "no-default", claimants: ["modorganizer2.desktop"] });
  assert.equal(one.title, "One app claims nxm:// links, but it isn't the default");
  assert.match(one.detail, /^1 installed launcher claims nxm:\/\/ links \(modorganizer2\.desktop\), but it isn't set as the default/);
  assert.doesNotMatch(`${one.title} ${one.detail}`, /Several|none is|which one opens/);
  assert.match(one.fix ?? "", /xdg-settings set default-url-scheme-handler nxm/);
  assert.equal(judgeNxm({ status: "no-default", claimants: ["a.desktop", "b.desktop"] }).title, "Several apps claim nxm:// links, none is the default");
});

// ─── The drive a library sits on ─────────────────────────────────────────────

const HOME_LIB = "/home/deck/.local/share/Steam/steamapps";
const CARD_LIB = "/run/media/deck/Games/SteamLibrary/steamapps";
const MOUNTS = (cardType: string): string =>
  ["/dev/nvme0n1p8 / ext4 rw 0 0", "/dev/nvme0n1p9 /home ext4 rw 0 0", `/dev/mmcblk0p1 /run/media/deck/Games ${cardType} rw 0 0`].join("\n");

function facts(libraries: string[], gameLibrary: string | null, kind: SteamKind = "native"): SteamFacts {
  const install: SteamInstall = { kind, root: "/home/deck/.local/share/Steam", libraries };
  return {
    installs: [install],
    chosen: install,
    app: gameLibrary === null ? null : { appId: SKYRIM, name: "Skyrim", installDir: `${gameLibrary}/common/Skyrim`, libraryPath: gameLibrary },
  };
}

test("drive: libraries on Linux filesystems are fine, and the types are named", () => {
  const f = driveFinding(facts([HOME_LIB, CARD_LIB], HOME_LIB), parseMounts(MOUNTS("ext4")));
  assert.ok(f);
  assert.deepEqual([f.id, f.area, f.status, f.basis], ["deck.library-drive", "deck", "ok", "install"]);
  assert.match(f.detail, /2 libraries checked \(ext4\)/);
});

test("drive: nothing to say without a mount table or without a Steam install", () => {
  assert.equal(driveFinding(facts([HOME_LIB], HOME_LIB), null), null);
  assert.equal(driveFinding({ installs: [], chosen: null, app: null }, parseMounts(MOUNTS("ext4"))), null);
});

test("drive: the game's library on NTFS is a warning, on the strength of Valve's own wiki page", () => {
  for (const type of ["ntfs3", "ntfs", "fuseblk"]) {
    const f = driveFinding(facts([HOME_LIB, CARD_LIB], CARD_LIB), parseMounts(MOUNTS(type)));
    assert.ok(f, type);
    assert.deepEqual([f.status, f.basis], ["warn", "rule"], type);
    assert.match(f.source ?? "", /ValveSoftware\/Proton\/wiki\/Using-a-NTFS-disk/, type);
    assert.match(f.detail, /\(including the one with this game\)/, type);
    assert.match(f.detail, /isn't an official Valve guide/, type);
    assert.match(f.fix ?? "", /ext4, btrfs or xfs/, type);
  }
});

test("drive: a library on NTFS that doesn't hold the game is only a note", () => {
  const f = driveFinding(facts([HOME_LIB, CARD_LIB], HOME_LIB), parseMounts(MOUNTS("ntfs3")));
  assert.ok(f);
  assert.equal(f.status, "note");
  assert.doesNotMatch(f.detail, /including the one with this game/);
  assert.match(f.detail, /^A Steam library sits on ntfs3\./);
});

test("drive: exFAT is a guess, with the symlink point called an inference and the runtime issue as its source", () => {
  const f = driveFinding(facts([HOME_LIB, CARD_LIB], CARD_LIB), parseMounts(MOUNTS("exfat")));
  assert.ok(f);
  assert.deepEqual([f.status, f.basis], ["warn", "guess"]);
  assert.match(f.detail, /exFAT can't hold the symlinks a Proton prefix uses\. That it won't work is an inference; no Valve page says it about exFAT\./);
  assert.match(f.source ?? "", /steam-runtime\/issues\/434/);
  assert.doesNotMatch(f.detail, /Valve's Proton wiki|FAT32|either/);
});

test("drive: exFAT next to FAT32 says 'either', after Valve's FAT32 answer", () => {
  const mounts = parseMounts(
    [
      "/dev/nvme0n1p8 / ext4 rw 0 0",
      "/dev/nvme0n1p9 /home ext4 rw 0 0",
      "/dev/mmcblk0p1 /run/media/deck/Games vfat rw 0 0",
      "/dev/sdb1 /run/media/deck/stick exfat rw 0 0",
    ].join("\n")
  );
  const stick = "/run/media/deck/stick/SteamLibrary/steamapps";
  const f = driveFinding(facts([HOME_LIB, CARD_LIB, stick], CARD_LIB), mounts);
  assert.ok(f);
  assert.equal(f.basis, "rule");
  assert.match(f.detail, /Valve has said Proton won't support FAT32[^.]*\. exFAT can't hold the symlinks a Proton prefix uses either\./);
  assert.match(f.source ?? "", /Proton\/issues\/2439/);
});

test("drive: FAT32 is a documented rule, with Valve's answer on Proton's tracker as its source", () => {
  for (const type of ["vfat", "msdos", "fat"]) {
    const f = driveFinding(facts([HOME_LIB, CARD_LIB], CARD_LIB), parseMounts(MOUNTS(type)));
    assert.ok(f, type);
    assert.deepEqual([f.status, f.basis], ["warn", "rule"], type);
    assert.match(f.detail, /Valve has said Proton won't support FAT32, because it can't hold symlinks and caps a file at 4 GB\./, type);
    assert.match(f.source ?? "", /Proton\/issues\/2439/, type);
    assert.doesNotMatch(f.detail, /inference/, type);
  }
});

test("drive: two risky libraries are counted and named together", () => {
  const mounts = parseMounts(["/dev/a / ext4 rw 0 0", "/dev/b /mnt/a ntfs3 rw 0 0", "/dev/c /mnt/b exfat rw 0 0"].join("\n"));
  const f = driveFinding(facts(["/mnt/a/steamapps", "/mnt/b/steamapps", "/home/x/steamapps"], "/mnt/a/steamapps"), mounts);
  assert.ok(f);
  assert.match(f.detail, /^2 Steam libraries \(including the one with this game\) sit on ntfs3 and exfat\./);
  assert.equal(f.basis, "rule", "one of them is NTFS, which has a source");
  assert.match(f.detail, /exFAT can't hold the symlinks/);
});

test("drive: a mount point with a space in it, written the way /proc/mounts escapes it, still matches", () => {
  const mounts = parseMounts("/dev/a / ext4 rw 0 0\n/dev/b /run/media/deck/My\\040Games ntfs3 rw 0 0");
  const f = driveFinding(facts(["/run/media/deck/My Games/SteamLibrary/steamapps"], "/run/media/deck/My Games/SteamLibrary/steamapps"), mounts);
  assert.equal(f?.status, "warn");
});

// ─── Folder names that differ only by case ───────────────────────────────────

function caseSensitive(): boolean {
  const dir = fresh();
  writeFileSync(join(dir, "a"), "");
  writeFileSync(join(dir, "A"), "");
  return readdirSync(dir).length === 2;
}

const norm = (clash: string): string => {
  const slash = clash.lastIndexOf("/");
  return clash.slice(0, slash + 1) + clash.slice(slash + 1).split(" and ").sort().join(" and ");
};

test("case clashes: a folder with distinct names has none, on any file system", () => {
  const root = fresh();
  for (const name of ["Meshes", "Textures", "Scripts"]) mkdirSync(join(root, name));
  mkdirSync(join(root, "Textures", "Actors"));
  assert.deepEqual(findCaseClashes(root), { clashes: [], truncated: false, unread: 0 });
  assert.deepEqual(findCaseClashes(join(root, "nope")), { clashes: [], truncated: false, unread: 0 }, "a folder that isn't there has nothing in it to compare");
});

test("case clashes: Meshes and meshes side by side are found, at the top and two levels down but no deeper", (t) => {
  if (!caseSensitive()) return t.skip("this file system doesn't tell Meshes from meshes");
  const root = fresh();
  for (const dir of ["Meshes", "meshes", "Textures/Actors", "Textures/actors", "Sounds/Fx/Ui", "Sounds/Fx/ui", "Deep/A/B/Level", "Deep/A/B/level"]) {
    mkdirSync(join(root, ...dir.split("/")), { recursive: true });
  }
  const { clashes, truncated } = findCaseClashes(root);
  assert.equal(truncated, false);
  assert.deepEqual(clashes.map(norm).sort(), ["Meshes and meshes", "Sounds/Fx/Ui and ui", "Textures/Actors and actors"]);
  assert.deepEqual(findCaseClashes(root, 3).clashes.map(norm).sort(), ["Deep/A/B/Level and level", "Meshes and meshes", "Sounds/Fx/Ui and ui", "Textures/Actors and actors"]);
});

test("case clashes: files count too, and the names are cleaned for the report", (t) => {
  if (!caseSensitive()) return t.skip("this file system doesn't tell Meshes from meshes");
  const root = fresh();
  writeFileSync(join(root, "SkyUI.esp"), "");
  writeFileSync(join(root, "skyui.esp"), "");
  assert.deepEqual(findCaseClashes(root).clashes.map(norm), ["SkyUI.esp and skyui.esp"]);
});

test("case clashes: a folder that is there but can't be listed is counted as unread, not as one with no clashes", (t) => {
  const root = fresh();
  mkdirSync(join(root, "Meshes", "Armor"), { recursive: true });
  mkdirSync(join(root, "Textures"), { recursive: true });
  const release = lockAway(join(root, "Meshes"));
  if (release === null) return t.skip("this system reads it anyway (running as root?)");
  try {
    assert.deepEqual(findCaseClashes(root), { clashes: [], truncated: false, unread: 1 });
  } finally {
    release();
  }
});

test("case clashes: it stops reading when a folder is enormous, and says so", () => {
  const root = fresh();
  for (let i = 0; i < 20; i++) mkdirSync(join(root, `folder${i}`));
  const result = findCaseClashes(root, 2, 10);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.clashes, []);
  assert.equal(findCaseClashes(root, 2, 1000).truncated, false);
});

// ─── Which Steam, and where the game is ──────────────────────────────────────

let homeNow = sandbox.home;
const NATIVE = (): string => join(homeNow, ".local", "share", "Steam");
const FLATPAK = (): string => join(homeNow, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam");
const FLATPAK_OLD = (): string => join(homeNow, ".var", "app", "com.valvesoftware.Steam", "data", "Steam");

/**
 * A home folder of its own for this test, so installs one test makes aren't there for the next.
 * Steam installs are found under HOME, so the STEAM_ROOT override the sandbox sets has to go too.
 */
function freshHome(): string {
  const home = fresh();
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.STEAM_ROOT;
  homeNow = home;
  return home;
}

test("steam: STEAM_ROOT, when it holds a steamapps folder, is the only install and is called custom", () => {
  freshHome();
  const root = fresh();
  makeSteam(root);
  process.env.STEAM_ROOT = root;
  makeSteam(NATIVE());
  const installs = listSteamInstalls("linux");
  assert.equal(installs.length, 1, "the native one under HOME isn't looked at while STEAM_ROOT is set");
  assert.equal(installs[0]?.kind, "custom");
  assert.equal(installs[0]?.root, root);
  assert.equal(installs[0]?.libraries.length, 1);
});

test("steam: STEAM_ROOT pointing at a folder with no steamapps is no install, not a fall-back to the others", () => {
  freshHome();
  process.env.STEAM_ROOT = fresh();
  makeSteam(NATIVE());
  assert.deepEqual(listSteamInstalls("linux"), []);
  assert.deepEqual(listSteamInstalls("windows"), []);
  assert.deepEqual(listSteamInstalls("macos"), []);
});

test("steam: on Linux the native Steam and the Flatpak one are told apart", () => {
  freshHome();
  makeSteam(NATIVE());
  makeSteam(FLATPAK());
  const installs = listSteamInstalls("linux");
  assert.deepEqual(
    installs.map((i) => i.kind),
    ["native", "flatpak"]
  );
  assert.ok(installs.every((i) => i.libraries.length === 1));
});

test("steam: the Flatpak's older data/Steam folder counts as Flatpak too, and a lone native install is native", () => {
  freshHome();
  makeSteam(FLATPAK_OLD());
  assert.deepEqual(
    listSteamInstalls("linux").map((i) => i.kind),
    ["flatpak"]
  );
  freshHome();
  makeSteam(NATIVE());
  assert.deepEqual(
    listSteamInstalls("linux").map((i) => i.kind),
    ["native"]
  );
});

test("steam: ~/.steam/steam is a link to the same install and is counted once", (t) => {
  freshHome();
  makeSteam(NATIVE());
  mkdirSync(join(homeNow, ".steam"), { recursive: true });
  try {
    symlinkSync(NATIVE(), join(homeNow, ".steam", "steam"), "dir");
  } catch {
    return t.skip("this system won't make a symbolic link here");
  }
  const installs = listSteamInstalls("linux");
  assert.equal(installs.length, 1);
  assert.equal(installs[0]?.kind, "native");
  assert.equal(installs[0]?.root, realpathSync(NATIVE()));
});

test("steam: the libraries are the ones libraryfolders.vdf lists, and only those that exist", () => {
  freshHome();
  const second = fresh();
  makeSteam(second);
  makeSteam(NATIVE(), { libraries: [second, join(fresh(), "gone")] });
  const [install] = listSteamInstalls("linux");
  assert.equal(install?.libraries.length, 2);
  assert.ok(install?.libraries.some((l) => l.startsWith(second)));
});

test("steam: the install that holds the game is chosen, and the game's library is the one it was found in", () => {
  freshHome();
  const second = fresh();
  makeSteam(second, { game: { appId: SKYRIM, dir: "Skyrim Special Edition" } });
  makeSteam(NATIVE(), { libraries: [second] });
  makeSteam(FLATPAK());
  const facts_ = discoverSteam("linux", SKYRIM);
  assert.equal(facts_.installs.length, 2);
  assert.equal(facts_.chosen?.kind, "native");
  assert.ok(facts_.app);
  assert.ok(facts_.app.libraryPath.startsWith(second));
  assert.ok(facts_.app.installDir.endsWith("Skyrim Special Edition"));
});

test("steam: a game that is only in the Flatpak's library makes the Flatpak the chosen install", () => {
  freshHome();
  makeSteam(NATIVE());
  makeSteam(FLATPAK(), { game: { appId: SKYRIM, dir: "Skyrim Special Edition" } });
  assert.equal(discoverSteam("linux", SKYRIM).chosen?.kind, "flatpak");
});

test("steam: with the game nowhere, the first install is chosen and there is no app; with no Steam there is neither", () => {
  freshHome();
  assert.deepEqual(discoverSteam("linux", SKYRIM), { installs: [], chosen: null, app: null });
  makeSteam(NATIVE());
  makeSteam(FLATPAK());
  const none = discoverSteam("linux", SKYRIM);
  assert.equal(none.app, null);
  assert.equal(none.chosen?.kind, "native");
});

test("steam: STEAM_ROOT is honoured on every platform, and the game is found through it", () => {
  freshHome();
  const root = fresh();
  makeSteam(root, { game: { appId: SKYRIM, dir: "Skyrim Special Edition" } });
  process.env.STEAM_ROOT = root;
  for (const platform of ["windows", "macos", "linux"] as const) {
    const found = discoverSteam(platform, SKYRIM);
    assert.equal(found.chosen?.kind, "custom", platform);
    assert.ok(found.app?.installDir.endsWith("Skyrim Special Edition"), platform);
  }
});

// A manifest on its own is not a game: Steam keeps the manifest after the folder is deleted.
test("steam: a manifest with no game folder is not an installed game", () => {
  freshHome();
  const root = fresh();
  const steam = makeSteam(root, { game: { appId: SKYRIM, dir: "Skyrim Special Edition" } });
  process.env.STEAM_ROOT = root;
  assert.ok(discoverSteam("linux", SKYRIM).app, "with the folder it is found");
  rmSync(steam.gameDir!, { recursive: true, force: true });
  const gone = discoverSteam("linux", SKYRIM);
  assert.equal(gone.app, null);
  assert.equal(gone.chosen?.kind, "custom");
});
