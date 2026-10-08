import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuard } from "../src/doctor/guard.js";
import { installedLoggers, judgeCrashLoggers } from "../src/doctor/loggers.js";
import { judgeLocation, judgeMyGames, judgeRoom, spotsOf, type Place, type Room } from "../src/doctor/location.js";
import { driveKind, mountFor, parseMounts, readMounts } from "../src/doctor/mounts.js";
import { classify, judgeOverwrite, scanOverwrite, type OverwriteScan, type Pile } from "../src/doctor/overwrite.js";
import { FULL_LIMIT, LIGHT_LIMIT, limitFinding, type Index } from "../src/doctor/setup-plugins.js";
import { lockAway, putRel } from "./helpers/doctor-world.js";

// ─── The small pieces of the Doctors ─────────────────────────────────────────
// Mounts, Overwrite, where things live, room on the drive, crash loggers, the plugin
// limits and the guard around each check. Each is a function that takes what it was
// told (a mount table, a scan, a path, a free-space reading) and says what it makes of
// it, so these tests hand it that and read the answer. The folders they need are real
// ones in a temp directory.

let TMP = "";
let made = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), "mw-doctor-parts-"));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});
const fresh = (): string => {
  const dir = join(TMP, `d${made++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

// ─── Mounts ──────────────────────────────────────────────────────────────────

const MOUNTS = [
  "sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0",
  "/dev/nvme0n1p2 / ext4 rw,relatime 0 0",
  "/dev/nvme0n1p3 /home btrfs rw,relatime 0 0",
  "/dev/sda1 /run/media/deck/Games\\040Drive ntfs3 rw,nosuid 0 0",
  "/dev/mmcblk0p1 /run/media/mmcblk0p1 ext4 rw 0 0",
  "",
  "nonsense",
].join("\n");

test("parseMounts reads the device, mount point and type of each line, and skips what isn't a mount line", () => {
  const mounts = parseMounts(MOUNTS);
  assert.deepEqual(
    mounts.map((m) => [m.device, m.mountPoint, m.type]),
    [
      ["sysfs", "/sys", "sysfs"],
      ["/dev/nvme0n1p2", "/", "ext4"],
      ["/dev/nvme0n1p3", "/home", "btrfs"],
      ["/dev/sda1", "/run/media/deck/Games Drive", "ntfs3"],
      ["/dev/mmcblk0p1", "/run/media/mmcblk0p1", "ext4"],
    ]
  );
});

test("parseMounts undoes the octal escapes /proc/mounts uses for a space, a tab and a backslash, and lower-cases the type", () => {
  const [m] = parseMounts("/dev/sdb1 /mnt/a\\040b\\011c\\134d NTFS3 rw 0 0");
  assert.equal(m?.mountPoint, "/mnt/a b\tc\\d");
  assert.equal(m?.type, "ntfs3");
});

test("parseMounts copes with nothing, with blank lines, and with Windows line endings", () => {
  assert.deepEqual(parseMounts(""), []);
  assert.deepEqual(parseMounts("\n\n  \n"), []);
  assert.equal(parseMounts("/dev/sda1 /mnt/x ext4 rw 0 0\r\n/dev/sda2 /mnt/y xfs rw 0 0\r\n").length, 2);
});

test("mountFor picks the mount with the longest mount point that holds the path", () => {
  const mounts = parseMounts(MOUNTS);
  assert.equal(mountFor(mounts, "/home/deck/.local/share/Steam")?.type, "btrfs");
  assert.equal(mountFor(mounts, "/var/lib/flatpak")?.type, "ext4");
  assert.equal(mountFor(mounts, "/run/media/deck/Games Drive/SteamLibrary/steamapps")?.type, "ntfs3");
  assert.equal(mountFor(mounts, "/run/media/deck/Games Drive")?.type, "ntfs3", "the mount point itself is on that mount");
});

test("mountFor doesn't count /homework as being under /home", () => {
  const mounts = parseMounts(MOUNTS);
  assert.equal(mountFor(mounts, "/homework/games")?.type, "ext4");
  assert.equal(mountFor(mounts, "/home")?.type, "btrfs");
  assert.equal(mountFor(mounts, "/home/")?.type, "btrfs", "a trailing slash on the path doesn't change which mount it is");
});

test("mountFor doesn't depend on the order of the mount table, and ignores a trailing slash on a mount point", () => {
  const forward = parseMounts("/dev/a /mnt ext4 rw 0 0\n/dev/b /mnt/data/ ntfs3 rw 0 0");
  const backward = [...forward].reverse();
  for (const list of [forward, backward]) {
    assert.equal(mountFor(list, "/mnt/data/steam")?.type, "ntfs3");
    assert.equal(mountFor(list, "/mnt/other")?.type, "ext4");
    assert.equal(mountFor(list, "/mnt/data/steam")?.mountPoint, "/mnt/data", "the trailing slash is gone from the answer");
  }
});

test("mountFor says nothing when no mount holds the path", () => {
  assert.equal(mountFor([], "/home/deck"), null);
  assert.equal(mountFor(parseMounts("/dev/a /mnt/x ext4 rw 0 0"), "/home/deck"), null);
});

test("driveKind sorts filesystem types into NTFS, a FUSE block device, FAT-family and everything else", () => {
  for (const t of ["ntfs", "ntfs3", "NTFS", "Ntfs3"]) assert.equal(driveKind(t), "ntfs", t);
  assert.equal(driveKind("fuseblk"), "fuseblk");
  for (const t of ["exfat", "vfat", "msdos", "fat"]) assert.equal(driveKind(t), "fat", t);
  for (const t of ["ext4", "btrfs", "xfs", "f2fs", "tmpfs", "overlay", "nfs4", "fuse.sshfs", "9p", ""]) assert.equal(driveKind(t), "other", t);
});

test("readMounts reads /proc/mounts where there is one and says null where there isn't", () => {
  const mounts = readMounts();
  if (process.platform === "linux") {
    assert.ok(Array.isArray(mounts) && mounts.length > 0, "a Linux system lists its mounts");
    assert.ok(mounts.every((m) => m.mountPoint !== "" && m.type !== ""));
  } else {
    assert.equal(mounts, null);
  }
});

// ─── Overwrite: what a file is ───────────────────────────────────────────────

const CLASSES: Array<[string, Pile]> = [
  ["sseedit backups/skyrim.esm.backup.2024_01_01", "xedit"],
  ["sseedit cache/skyrim.esm.refr", "xedit"],
  ["tes5edit backups/x.esp.backup", "xedit"],
  ["fo4edit cache/x", "xedit"],
  ["bash patches/dungeon.esp", "wrye"],
  ["bashtags/bashed patch, 0.txt", "wrye"],
  ["docs/bashed patch, 0.html", "wrye"],
  ["docs/readme.txt", "other"],
  ["synthesis.esp", "plugins"],
  ["bashed patch, 0.esp", "plugins"],
  ["tiny.esl", "plugins"],
  ["base.esm", "plugins"],
  ["skse/plugins/crashlogger/crash-2024-01-01.log", "logs"],
  ["tools/run_log.txt", "logs"],
  ["tools/run.log.txt", "logs"],
  ["nemesis_engine/data/x.json", "behavior"],
  ["pandora_engine/skyrim/x", "behavior"],
  ["meshes/actors/character/behaviors/x.hkx", "behavior"],
  ["animationdatasinglefile.txt", "behavior"],
  ["animationsetdatasinglefile.txt", "behavior"],
  ["meshes/terrain/tamriel/objects/tamriel.4.0.0.bto", "lod"],
  ["meshes/anything/at/all.btr", "lod"],
  ["textures/terrain/tamriel/x.dds", "lod"],
  ["textures/dyndolod/lod/x.dds", "lod"],
  ["skse/plugins/x.dll", "dll"],
  ["scripts/x.pex", "scripts"],
  ["somewhere/else/x.pex", "scripts"],
  ["meshes/armor/x.nif", "meshes"],
  ["textures/armor/x.dds", "textures"],
  ["readme.txt", "other"],
  ["source/scripts/x.psc", "other"],
];

test("classify puts each file in the pile it belongs to, by where it sits and what it is called", () => {
  for (const [rel, pile] of CLASSES) assert.equal(classify(rel), pile, rel);
});

test("a log or a plugin keeps its pile wherever it sits, except inside xEdit's own folders", () => {
  assert.equal(classify("sseedit backups/mod.esp"), "xedit");
  assert.equal(classify("textures/armor/x.esp"), "plugins");
  assert.equal(classify("meshes/x.log"), "logs");
});

// ─── Overwrite: scanning a folder ────────────────────────────────────────────

function sampleOverwrite(): string {
  const dir = fresh();
  putRel(dir, "SSEEdit Backups/Skyrim.esm.backup", Buffer.alloc(100));
  putRel(dir, "SSEEdit Cache/a.refr", Buffer.alloc(50));
  putRel(dir, "Pandora_Engine/Skyrim/Actors/x.hkx", Buffer.alloc(30));
  putRel(dir, "Synthesis.esp", Buffer.alloc(20));
  putRel(dir, "Meshes/Terrain/Tamriel/Objects/Tamriel.4.0.0.bto", Buffer.alloc(40));
  putRel(dir, "Crash/crash-1.log", Buffer.alloc(10));
  putRel(dir, "readme.txt", Buffer.alloc(5));
  return dir;
}

test("scanOverwrite counts the files, adds up their sizes and sorts them into piles", () => {
  const scan = scanOverwrite(sampleOverwrite());
  assert.equal(scan.files, 7);
  assert.equal(scan.bytes, 100 + 50 + 30 + 20 + 40 + 10 + 5);
  assert.equal(scan.truncated, false);
  assert.deepEqual(scan.piles.xedit, { files: 2, bytes: 150 });
  assert.deepEqual(scan.piles.behavior, { files: 1, bytes: 30 });
  assert.deepEqual(scan.piles.plugins, { files: 1, bytes: 20 });
  assert.deepEqual(scan.piles.lod, { files: 1, bytes: 40 });
  assert.deepEqual(scan.piles.logs, { files: 1, bytes: 10 });
  assert.deepEqual(scan.piles.other, { files: 1, bytes: 5 });
});

test("scanOverwrite recognises output from the tools that make it, by name", () => {
  const scan = scanOverwrite(sampleOverwrite());
  assert.ok(scan.looksLike.includes("Synthesis"));
  assert.ok(scan.looksLike.includes("xEdit"));
  assert.ok(scan.looksLike.some((s) => s.startsWith("an animation behavior tool")));
  assert.ok(scan.looksLike.some((s) => s.startsWith("a LOD generator")));
  assert.equal(new Set(scan.looksLike).size, scan.looksLike.length, "each tool once");

  const wrye = fresh();
  putRel(wrye, "Bashed Patch, 0.esp", "x");
  putRel(wrye, "DynDOLOD.esm", "x");
  assert.deepEqual([...scanOverwrite(wrye).looksLike].sort(), ["DynDOLOD", "Wrye Bash"]);
});

test("scanOverwrite lists the top of the folder as the player's own names, at most twelve", () => {
  const dir = fresh();
  for (let i = 0; i < 20; i++) putRel(dir, `Folder ${String(i).padStart(2, "0")}/x.txt`, "x");
  const scan = scanOverwrite(dir);
  assert.equal(scan.top.length, 12);
  assert.ok(scan.top.every((n) => /^Folder \d\d$/.test(n)));
  assert.equal(scan.files, 20);
});

test("scanOverwrite stops at its limit and says the totals are higher", () => {
  const dir = fresh();
  for (let i = 0; i < 30; i++) putRel(dir, `f${i}.txt`, "x");
  const scan = scanOverwrite(dir, 10);
  assert.equal(scan.truncated, true);
  assert.ok(scan.files > 0 && scan.files <= 10, `counted ${scan.files}`);
  assert.equal(scanOverwrite(dir, 1000).truncated, false);
  assert.equal(scanOverwrite(dir, 1000).files, 30);
});

test("scanOverwrite reads a folder that isn't there as empty, and doesn't go deeper than sixteen levels", () => {
  const none = scanOverwrite(join(fresh(), "nope"));
  assert.deepEqual([none.files, none.bytes, none.truncated, none.unread, none.top, none.looksLike], [0, 0, false, 0, [], []]);

  const dir = fresh();
  putRel(dir, "shallow.esp", "x");
  putRel(dir, `${Array.from({ length: 20 }, (_, i) => `d${i}`).join("/")}/deep.esp`, "x");
  putRel(dir, `${Array.from({ length: 16 }, (_, i) => `e${i}`).join("/")}/edge.esp`, "x");
  assert.equal(scanOverwrite(dir).files, 2, "the shallow file and the one at sixteen levels, not the one at twenty");
});

test("scanOverwrite counts the folders that are there but can't be listed, Overwrite itself included", (t) => {
  const dir = fresh();
  putRel(dir, "SSEEdit Backups/a.backup", "x");
  putRel(dir, "Locked/meshes/x.nif", "x");
  const release = lockAway(join(dir, "Locked"));
  if (release === null) return t.skip("this system reads it anyway (running as root?)");
  try {
    const scan = scanOverwrite(dir);
    assert.deepEqual([scan.files, scan.unread], [1, 1]);
    const f = judgeOverwrite(scan);
    assert.match(f.detail, /has at least 1 file/);
    assert.doesNotMatch(f.detail, /don't change what the game loads/, "what wasn't read isn't called harmless");
    assert.match(f.detail, /the rest wasn't read, so whether it changes what the game loads isn't known/);
  } finally {
    release();
  }

  const whole = fresh();
  putRel(whole, "meshes/x.nif", "x");
  const releaseWhole = lockAway(whole);
  if (releaseWhole === null) return;
  try {
    const scan = scanOverwrite(whole);
    assert.deepEqual([scan.files, scan.unread], [0, 1]);
    const f = judgeOverwrite(scan);
    assert.deepEqual([f.status, f.title], ["note", "Overwrite couldn't be read"]);
  } finally {
    releaseWhole();
  }
});

// ─── Overwrite: what a scan means ────────────────────────────────────────────

const scanOf = (piles: Partial<Record<Pile, number>>, extra: Partial<OverwriteScan> = {}): OverwriteScan => {
  const scan: OverwriteScan = { files: 0, bytes: 0, truncated: false, unread: 0, piles: {}, top: [], looksLike: [], ...extra };
  for (const [pile, files] of Object.entries(piles) as Array<[Pile, number]>) {
    scan.piles[pile] = { files, bytes: files * 1000 };
    scan.files += files;
    scan.bytes += files * 1000;
  }
  return scan;
};

test("an empty Overwrite is fine", () => {
  const f = judgeOverwrite(scanOf({}));
  assert.deepEqual([f.id, f.area, f.status, f.basis], ["setup.overwrite", "setup", "ok", "install"]);
  assert.equal(f.title, "Overwrite is empty");
  assert.equal(f.fix, undefined);
});

test("Overwrite holding only xEdit backups, Wrye Bash files and logs is a note, since none of it changes what loads", () => {
  const f = judgeOverwrite(scanOf({ xedit: 3, logs: 2, wrye: 1 }, { top: ["SSEEdit Backups"] }));
  assert.equal(f.status, "note");
  assert.equal(f.basis, "rule");
  assert.match(f.source ?? "", /modorganizer\/wiki\/Troubleshooting/);
  assert.match(f.detail, /6 files/);
  assert.match(f.detail, /don't change what the game loads/);
  assert.deepEqual(f.items, ["SSEEdit Backups"]);
  assert.ok(f.fix);
});

test("Overwrite holding anything that changes what the game loads is a warning, and says it wins over every mod", () => {
  for (const pile of ["plugins", "behavior", "lod", "meshes", "textures", "scripts", "dll", "other"] as const) {
    const f = judgeOverwrite(scanOf({ [pile]: 1, xedit: 5 }));
    assert.equal(f.status, "warn", pile);
    assert.match(f.detail, /wins over every mod/, pile);
    assert.match(f.fix ?? "", /Create Mod/, pile);
    assert.match(f.fix ?? "", /MO2 leaves the new mod switched off, so switch it on/, `${pile}: MO2's wiki says the mod Create Mod makes is disabled by default`);
  }
});

test("logs and backups found before the scan stopped at its limit aren't taken to mean the rest is harmless too", () => {
  const f = judgeOverwrite(scanOf({ logs: 3 }, { truncated: true }));
  assert.equal(f.status, "note");
  assert.match(f.detail, /has at least 3 files/);
  assert.doesNotMatch(f.detail, /don't change what the game loads/);
  assert.match(f.detail, /in the part that could be read/);
});

test("the finding counts files in the singular and plural, and says 'at least' when the scan stopped early", () => {
  assert.match(judgeOverwrite(scanOf({ plugins: 1 })).detail, /has 1 file \(/);
  assert.match(judgeOverwrite(scanOf({ plugins: 2 })).detail, /has 2 files \(/);
  assert.match(judgeOverwrite(scanOf({ plugins: 2 }, { truncated: true })).detail, /has at least 2 files/);
});

test("sizes are in megabytes under a gigabyte, 'under 1 MB' for the tiny, and in gigabytes above", () => {
  const sized = (bytes: number): string => judgeOverwrite(scanOf({ plugins: 1 }, { bytes })).detail;
  assert.match(sized(10), /\(under 1 MB\)/, "a few bytes is not a megabyte");
  // scanOf adds 1000 bytes for the file, so these land on one byte under and exactly on a megabyte.
  assert.match(sized(MIB - 1001), /\(under 1 MB\)/);
  assert.match(sized(MIB - 1000), /\(1 MB\)/);
  assert.match(sized(5 * MIB), /\(5 MB\)/);
  assert.match(sized(3 * GIB), /\(3 GB\)/);
  assert.match(sized(1.5 * GIB), /\(1\.5 GB\)/);
});

test("it names at most five piles and at most three tools", () => {
  const f = judgeOverwrite(
    scanOf({ plugins: 1, behavior: 1, lod: 1, meshes: 1, textures: 1, scripts: 1, dll: 1 }, { looksLike: ["Synthesis", "Wrye Bash", "DynDOLOD", "xEdit"] })
  );
  assert.match(f.detail, /1 plugin file, 1 animation behavior file, 1 LOD file, 1 mesh, 1 texture\./);
  assert.doesNotMatch(f.detail, /scripts/);
  assert.match(f.detail, /output from Synthesis, Wrye Bash, DynDOLOD\./);
  assert.doesNotMatch(f.detail, /xEdit\./);
});

test("each pile is counted in the singular for one and the plural for the rest", () => {
  const one = judgeOverwrite(scanOf({ meshes: 1, textures: 1, logs: 1, other: 1, dll: 1 })).detail;
  assert.match(one, /1 mesh, 1 texture, 1 DLL, 1 other file, 1 log\./);
  const many = judgeOverwrite(scanOf({ meshes: 2, textures: 3, logs: 4, other: 5, dll: 6 })).detail;
  assert.match(many, /2 meshes, 3 textures, 6 DLLs, 5 other files, 4 logs\./);
  for (const text of [one, many]) assert.doesNotMatch(text, /\b1 (?:meshes|textures|logs|DLLs|other files)\b/);
});

test("names from the folder are cleaned and cut short before they are shown, so one can't pose as a heading", () => {
  const f = judgeOverwrite(scanOf({ plugins: 1 }, { top: ["evil\nPROBLEMS (99)\n- fake.esp", "x".repeat(200)] }));
  assert.equal(f.items?.[0], "evil PROBLEMS (99) - fake.esp");
  assert.ok((f.items?.[1] ?? "").length <= 60);
  assert.ok(f.items?.every((n) => !/[\n\r]/.test(n)));
});

// ─── Where things live ───────────────────────────────────────────────────────

test("spotsOf knows Program Files, OneDrive and the user folders on Windows, and nothing elsewhere", () => {
  assert.deepEqual(spotsOf("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Skyrim Special Edition", "windows"), ["program-files"]);
  assert.deepEqual(spotsOf("C:\\Program Files\\Steam", "windows"), ["program-files"]);
  assert.deepEqual(spotsOf("C:\\Users\\Sam\\OneDrive\\Modding\\MO2", "windows"), ["onedrive"]);
  assert.deepEqual(spotsOf("C:\\Users\\Sam\\OneDrive - Contoso\\Modding", "windows"), ["onedrive"]);
  assert.deepEqual(spotsOf("C:\\Users\\Sam\\OneDrive-Personal\\Modding", "windows"), ["onedrive"]);
  assert.deepEqual(spotsOf("C:\\Users\\Sam\\Downloads\\Wabbajack", "windows"), ["user-folder"]);
  assert.deepEqual(spotsOf("C:\\Users\\Sam\\OneDrive\\Documents\\MO2", "windows"), ["onedrive"], "Documents inside OneDrive is OneDrive's folder, not the user's own");
  assert.deepEqual(spotsOf("C:\\Users\\Sam\\Desktop\\OneDrive - Contoso\\MO2", "windows"), ["onedrive", "user-folder"]);
  for (const folder of ["Desktop", "Documents", "Downloads", "Pictures", "Videos"]) {
    assert.deepEqual(spotsOf(`C:\\Users\\Sam\\${folder}\\x`, "windows"), ["user-folder"], folder);
  }
  assert.deepEqual(spotsOf("D:\\SteamLibrary\\steamapps\\common\\Skyrim Special Edition", "windows"), []);
  assert.deepEqual(spotsOf("C:\\Games\\MO2", "windows"), []);
  assert.deepEqual(spotsOf("C:\\Users\\Sam", "windows"), [], "a bare user folder isn't one of the protected ones");
  assert.deepEqual(spotsOf("C:\\Users\\Sam\\AppData\\Local\\Temp", "windows"), []);
  assert.deepEqual(spotsOf("C:\\Program Files (x86)\\Steam", "linux"), []);
  assert.deepEqual(spotsOf("C:\\Program Files (x86)\\Steam", "macos"), []);
});

test("spotsOf doesn't mind the case of the names or the slashes, and doesn't match a name that only contains one", () => {
  assert.deepEqual(spotsOf("c:/program files (x86)/steam", "windows"), ["program-files"]);
  assert.deepEqual(spotsOf("C:\\PROGRAM FILES\\x", "windows"), ["program-files"]);
  assert.deepEqual(spotsOf("C:\\Users\\Sam\\MyOneDriveBackup\\x", "windows"), []);
  assert.deepEqual(spotsOf("D:\\Program Files Mods\\x", "windows"), []);
  assert.deepEqual(spotsOf("D:\\Downloads\\x", "windows"), [], "a Downloads folder that isn't under Users");
});

const at = (what: Place["what"], path: string): Place => ({ what, path });

test("judgeLocation has nothing to say with no places to look at, or off Windows", () => {
  assert.equal(judgeLocation([], "windows"), null);
  assert.equal(judgeLocation([at("game", "C:\\Program Files\\Steam\\x")], "linux"), null);
  assert.equal(judgeLocation([at("game", "C:\\Program Files\\Steam\\x")], "macos"), null);
});

test("a game and a Mod Organizer 2 instance in plain folders are fine", () => {
  const f = judgeLocation([at("game", "D:\\SteamLibrary\\steamapps\\common\\Skyrim Special Edition"), at("mo2", "D:\\Modding\\MO2")], "windows");
  assert.ok(f);
  assert.deepEqual([f.id, f.status, f.basis], ["setup.location", "ok", "rule"]);
  assert.match(f.source ?? "", /stepmodifications\.org/);
});

test("a game in Program Files is a warning that names the folder and the guide that says to avoid it, never the path", () => {
  const f = judgeLocation([at("game", "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Skyrim Special Edition")], "windows");
  assert.ok(f);
  assert.equal(f.status, "warn");
  assert.equal(f.title, "A folder Windows protects or syncs");
  assert.deepEqual(f.items, ["The game: Program Files"]);
  assert.match(f.detail, /STEP, the Modding Wiki/);
  assert.match(f.source ?? "", /stepmodifications\.org/);
  assert.match(f.fix ?? "", /D:\\SteamLibrary/);
  assert.ok(!JSON.stringify(f).includes("steamapps"), "the path itself isn't in the finding");
});

test("a Mod Organizer 2 instance in OneDrive or a user folder cites Wabbajack's list of protected folders", () => {
  const f = judgeLocation([at("mo2", "C:\\Users\\Sam\\OneDrive\\Modding\\MO2")], "windows");
  assert.ok(f);
  assert.equal(f.status, "warn");
  assert.deepEqual(f.items, ["Mod Organizer 2's instance: a OneDrive folder"]);
  assert.match(f.detail, /Wabbajack's FAQ lists OneDrive, Desktop/);
  assert.match(f.source ?? "", /wiki\.wabbajack\.org/);
  assert.doesNotMatch(f.detail, /Program Files/);

  const both = judgeLocation([at("mo2", "C:\\Users\\Sam\\Desktop\\OneDrive\\MO2")], "windows");
  assert.deepEqual(both?.items, ["Mod Organizer 2's instance: a OneDrive folder and one of your user folders (Desktop, Documents, Downloads, Pictures or Videos)"]);
  assert.equal(judgeLocation([at("mo2", "C:\\Users\\Sam\\Downloads\\MO2")], "windows")?.items?.[0], "Mod Organizer 2's instance: one of your user folders (Desktop, Documents, Downloads, Pictures or Videos)");
});

test("the all-clear says only what was checked: the game isn't checked for user folders, and MO2 is named only when it was looked at", () => {
  assert.equal(judgeLocation([at("game", "C:\\Users\\Sam\\Downloads\\Skyrim")], "windows")?.detail, "The game isn't under Program Files or a OneDrive folder.");
  assert.equal(judgeLocation([at("mo2", "D:\\Modding\\MO2")], "windows")?.detail, "Mod Organizer 2 isn't under Program Files, a OneDrive folder or one of your user folders.");
  assert.equal(
    judgeLocation([at("game", "D:\\SteamLibrary\\steamapps\\common\\Skyrim Special Edition"), at("mo2", "D:\\Modding\\MO2"), at("mo2-mods", "E:\\mods")], "windows")?.detail,
    "The game isn't under Program Files or a OneDrive folder, and Mod Organizer 2 isn't under Program Files, a OneDrive folder or one of your user folders."
  );
  // Vortex's staging folder is named when it was looked at, alone or with MO2.
  assert.equal(
    judgeLocation([at("game", "D:\\Games\\Skyrim"), at("vortex-staging", "D:\\Vortex Mods\\skyrimse")], "windows")?.detail,
    "The game isn't under Program Files or a OneDrive folder, and Vortex's staging folder isn't under Program Files, a OneDrive folder or one of your user folders."
  );
  assert.equal(
    judgeLocation([at("mo2", "D:\\Modding\\MO2"), at("vortex-staging", "D:\\Vortex Mods\\skyrimse")], "windows")?.detail,
    "Mod Organizer 2 and Vortex's staging folder aren't under Program Files, a OneDrive folder or one of your user folders."
  );
});

test("Vortex's staging folder in OneDrive cites Vortex's own words about hard links, and says where to move it", () => {
  const f = judgeLocation([at("game", "D:\\Games\\Skyrim"), at("vortex-staging", "C:\\Users\\Sam\\OneDrive\\Vortex Mods\\skyrimse")], "windows");
  assert.ok(f);
  assert.equal(f.status, "warn");
  assert.deepEqual(f.items, ["Vortex's staging folder: a OneDrive folder"]);
  assert.match(f.detail, /Vortex's own error message for this case says OneDrive can't deal with hard links, which is how Vortex deploys mods to this game\./);
  assert.match(f.fix ?? "", /For Vortex's staging folder, choose a new one in Vortex's Settings, under Mods, and Vortex moves the mods there\./);
  // The default staging folder, under AppData, is in none of the folders Windows protects or syncs.
  assert.equal(judgeLocation([at("vortex-staging", "C:\\Users\\Sam\\AppData\\Roaming\\Vortex\\skyrimse\\mods")], "windows")?.status, "ok");
  // MO2 alone gets no Vortex words.
  assert.doesNotMatch(judgeLocation([at("mo2", "C:\\Users\\Sam\\OneDrive\\MO2")], "windows")?.fix ?? "", /Vortex/);
});

test("the game itself is only flagged for Program Files and OneDrive, since the user folders are about where mods live", () => {
  assert.equal(judgeLocation([at("game", "C:\\Users\\Sam\\Downloads\\Skyrim")], "windows")?.status, "ok");
  assert.equal(judgeLocation([at("game", "C:\\Users\\Sam\\OneDrive\\Games\\Skyrim")], "windows")?.status, "warn");
  assert.equal(judgeLocation([at("mo2", "C:\\Users\\Sam\\Downloads\\MO2")], "windows")?.status, "warn");
});

test("a mods folder kept elsewhere is its own place, named as the mods folder, and the same message isn't said twice", () => {
  const f = judgeLocation([at("mo2", "D:\\Modding\\MO2"), at("mo2-mods", "C:\\Users\\Sam\\Downloads\\mods")], "windows");
  assert.deepEqual(f?.items, ["Mod Organizer 2's mods folder: one of your user folders (Desktop, Documents, Downloads, Pictures or Videos)"]);
  const twice = judgeLocation([at("mo2", "C:\\Users\\Sam\\OneDrive\\MO2"), at("mo2", "C:\\Users\\Sam\\OneDrive\\MO2\\mods")], "windows");
  assert.deepEqual(twice?.items, ["Mod Organizer 2's instance: a OneDrive folder"]);
});

test("two flagged places make a plural title, and both reasons are given", () => {
  const f = judgeLocation([at("game", "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Skyrim Special Edition"), at("mo2", "C:\\Users\\Sam\\Desktop\\MO2")], "windows");
  assert.ok(f);
  assert.equal(f.title, "Folders Windows protects or syncs");
  assert.equal(f.items?.length, 2);
  assert.match(f.detail, /Program Files/);
  assert.match(f.detail, /Wabbajack's FAQ/);
  assert.match(f.source ?? "", /stepmodifications\.org/, "Program Files is the one a guide names");
});

// ─── Room left ───────────────────────────────────────────────────────────────

const room = (label: string, path: string): Room => ({ label, path });

test("room: plenty of space is fine and is read from the drive, not guessed", () => {
  const f = judgeRoom([room("the game's drive", fresh())], () => 120 * GIB);
  assert.ok(f);
  assert.deepEqual([f.id, f.status, f.basis], ["setup.room", "ok", "install"]);
  assert.equal(f.detail, "the game's drive: 120 GB free.");
});

test("room: under 5 GB is a warning and a guess, and exactly 5 GB is not tight", () => {
  const dir = fresh();
  assert.equal(judgeRoom([room("a", dir)], () => 5 * GIB)?.status, "ok");
  assert.equal(judgeRoom([room("a", dir)], () => 5 * GIB - 1)?.status, "warn");
  const f = judgeRoom([room("the game's drive", dir)], () => 4.5 * GIB);
  assert.ok(f);
  assert.deepEqual([f.status, f.basis], ["warn", "guess"]);
  assert.equal(f.title, "Little room left on a drive");
  assert.match(f.detail, /4\.5 GB free\. Under 5 GB is tight/);
  assert.deepEqual(f.items, ["the game's drive: 4.5 GB free"]);
  assert.ok(f.fix);
});

test("room: two folders on one drive are one line, and a drive that won't say is left out", () => {
  const a = fresh();
  const b = fresh();
  const merged = judgeRoom([room("the game's drive", a), room("MO2's mods drive", b)], () => 12.5 * GIB);
  assert.equal(merged?.detail, "the game's drive and MO2's mods drive: 12.5 GB free.");

  const partial = judgeRoom([room("the game's drive", a), room("MO2's mods drive", join(a, "not-there"))], (p) => (p === a ? 40 * GIB : null));
  assert.equal(partial?.detail, "the game's drive: 40 GB free.");

  assert.equal(judgeRoom([room("a", a)], () => null), null, "no reading, no finding");
  assert.equal(judgeRoom([], () => 10 * GIB), null);
});

test("room: a folder that can't be matched to a drive keeps its own line", () => {
  const a = fresh();
  const gone = join(fresh(), "gone");
  const f = judgeRoom([room("one", a), room("two", gone)], (p) => (p === a ? 30 * GIB : 2 * GIB));
  assert.ok(f);
  assert.equal(f.status, "warn");
  assert.deepEqual(f.items, ["one: 30 GB free", "two: 2 GB free"]);
  assert.match(f.detail, /one: 30 GB free; two: 2 GB free\./);
});

test("room: the real reading finds a number for a folder that exists", () => {
  const f = judgeRoom([room("here", TMP)]);
  if (f !== null) assert.match(f.detail, /^here: [\d.]+ GB free/);
});

// ─── Skyrim's own folder, when Documents lives in OneDrive ───────────────────

const SKYRIM_FOLDERS = ["Skyrim Special Edition", "Skyrim Special Edition GOG", "Skyrim Special Edition EPIC"];

function homeWith(...dirs: string[]): string {
  const home = fresh();
  for (const d of dirs) mkdirSync(join(home, ...d.split("/")), { recursive: true });
  return home;
}

test("My Games: nothing to say off Windows, with no folder, or with the folder in plain Documents", () => {
  assert.equal(judgeMyGames("linux", SKYRIM_FOLDERS, homeWith("OneDrive/Documents/My Games/Skyrim Special Edition")), null);
  assert.equal(judgeMyGames("windows", SKYRIM_FOLDERS, homeWith()), null);
  assert.equal(judgeMyGames("windows", SKYRIM_FOLDERS, homeWith("Documents/My Games/Skyrim Special Edition")), null);
});

test("My Games: a folder inside OneDrive is worth a note, since that is where the ini files and logs are", () => {
  const f = judgeMyGames("windows", SKYRIM_FOLDERS, homeWith("OneDrive/Documents/My Games/Skyrim Special Edition"));
  assert.ok(f);
  assert.deepEqual([f.id, f.status, f.basis], ["setup.my-games", "note", "install"]);
  assert.match(f.title, /inside OneDrive/);
  assert.match(f.detail, /OneDrive\\Documents\\My Games/);
  assert.match(f.source ?? "", /learn\.microsoft\.com/);
});

test("My Games: a business OneDrive folder counts, and so does the GOG or Epic folder name", () => {
  assert.equal(judgeMyGames("windows", SKYRIM_FOLDERS, homeWith("OneDrive - Contoso/Documents/My Games/Skyrim Special Edition"))?.status, "note");
  assert.equal(judgeMyGames("windows", SKYRIM_FOLDERS, homeWith("OneDrive/Documents/My Games/Skyrim Special Edition GOG"))?.status, "note");
  assert.equal(judgeMyGames("windows", SKYRIM_FOLDERS, homeWith("OneDrive/Documents/My Games/Skyrim Special Edition EPIC"))?.status, "note");
});

test("My Games: a folder in both places is a warning, because only one of them is read", () => {
  const f = judgeMyGames("windows", SKYRIM_FOLDERS, homeWith("Documents/My Games/Skyrim Special Edition", "OneDrive/Documents/My Games/Skyrim Special Edition"));
  assert.ok(f);
  assert.equal(f.status, "warn");
  assert.match(f.title, /Two copies/);
});

test("My Games: another game's folder, or a folder that only starts with OneDrive, isn't a match", () => {
  assert.equal(judgeMyGames("windows", SKYRIM_FOLDERS, homeWith("OneDrive/Documents/My Games/Fallout4")), null);
  assert.equal(judgeMyGames("windows", SKYRIM_FOLDERS, homeWith("OneDriveBackup/Documents/My Games/Skyrim Special Edition")), null);
});

// ─── Crash loggers ───────────────────────────────────────────────────────────

const index = (o: { dlls?: string[]; netScript?: boolean } = {}): Index => ({
  plugins: new Map(),
  skseDlls: new Set(o.dlls ?? []),
  netScript: o.netScript ?? false,
  missingMods: [],
  complete: true,
  skipped: [],
});

test("loggers are told apart by their usual file names", () => {
  assert.deepEqual(installedLoggers(index()), []);
  assert.deepEqual(installedLoggers(index({ dlls: ["crashlogger.dll"] })), ["Crash Logger SSE"]);
  assert.deepEqual(installedLoggers(index({ dlls: ["trainwreck.dll", "other.dll"] })), ["Trainwreck"]);
  assert.deepEqual(installedLoggers(index({ netScript: true })), [".NET Script Framework"]);
  assert.deepEqual(installedLoggers(index({ dlls: ["crashlogger.dll", "trainwreck.dll"], netScript: true })), ["Crash Logger SSE", "Trainwreck", ".NET Script Framework"]);
});

test("no crash logger is a note that says how loggers are recognised", () => {
  const [f, ...rest] = judgeCrashLoggers(index(), [1, 6, 1170, 0]);
  assert.equal(rest.length, 0);
  assert.ok(f);
  assert.deepEqual([f.id, f.status, f.basis], ["setup.crash-logger", "note", "install"]);
  assert.match(f.detail, /usual file names/);
  assert.match(f.detail, /so after a crash there may be no log for Crash Whisperer \(\/mw-crash\) to read\./);
  assert.match(f.fix ?? "", /and one Crash Whisperer reads/);
  assert.match(f.source ?? "", /nexusmods\.com\/skyrimspecialedition\/mods\/59818/);
});

test("one crash logger is fine and is named", () => {
  const [f, ...rest] = judgeCrashLoggers(index({ dlls: ["crashlogger.dll"] }), [1, 6, 1170, 0]);
  assert.equal(rest.length, 0);
  assert.equal(f?.status, "ok");
  assert.equal(f?.title, "One crash logger: Crash Logger SSE");
  assert.equal(f?.detail, "Only one crash logger was found. After a crash, Crash Whisperer (/mw-crash) reads its log.");
});

test("the one logger is pointed at Crash Whisperer only when Crash Whisperer reads its logs and it can log on this game", () => {
  const only = (o: Parameters<typeof index>[0], game: [number, number, number, number] | null) =>
    judgeCrashLoggers(index(o), game).find((f) => f.id === "setup.crash-logger")?.detail ?? "";
  // Trainwreck's logs are a format Crash Whisperer doesn't read.
  assert.equal(only({ dlls: ["trainwreck.dll"] }, [1, 6, 1170, 0]), "Only one crash logger was found.");
  // .NET Script Framework logs on 1.5.97 and not on 1.6, where the Doctors warn instead.
  assert.match(only({ netScript: true }, [1, 5, 97, 0]), /Crash Whisperer \(\/mw-crash\) reads its log\./);
  assert.equal(only({ netScript: true }, [1, 6, 1170, 0]), "Only one crash logger was found.");
});

test("two crash loggers with Crash Logger SSE among them cite its own page; two without it are only a guess", () => {
  const [withSse] = judgeCrashLoggers(index({ dlls: ["crashlogger.dll", "trainwreck.dll"] }), [1, 6, 1170, 0]);
  assert.ok(withSse);
  assert.deepEqual([withSse.status, withSse.basis], ["warn", "rule"]);
  assert.match(withSse.source ?? "", /59818/);
  assert.match(withSse.detail, /only one crash logger can be active/);
  assert.deepEqual(withSse.items, ["Crash Logger SSE", "Trainwreck"]);

  const [without] = judgeCrashLoggers(index({ dlls: ["trainwreck.dll"], netScript: true }), [1, 5, 97, 0]);
  assert.ok(without);
  assert.deepEqual([without.status, without.basis], ["warn", "guess"]);
  assert.equal(without.source, undefined);
  assert.match(without.detail, /likely problem rather than a certain one/);
});

test(".NET Script Framework on a 1.6 game is too old, and on 1.5 or an unknown version it isn't called that", () => {
  const old = judgeCrashLoggers(index({ netScript: true }), [1, 6, 1170, 0]);
  const tooOld = old.find((f) => f.id === "setup.crash-logger-old");
  assert.ok(tooOld);
  assert.deepEqual([tooOld.status, tooOld.basis], ["warn", "rule"]);
  assert.match(tooOld.detail, /The game is 1\.6\.1170/);
  assert.match(tooOld.source ?? "", /21294/);

  assert.equal(judgeCrashLoggers(index({ netScript: true }), [1, 5, 97, 0]).some((f) => f.id === "setup.crash-logger-old"), false);
  assert.equal(judgeCrashLoggers(index({ netScript: true }), null).some((f) => f.id === "setup.crash-logger-old"), false);
  assert.equal(judgeCrashLoggers(index({ dlls: ["crashlogger.dll"] }), [1, 6, 1170, 0]).some((f) => f.id === "setup.crash-logger-old"), false);
});

// ─── The plugin limits ───────────────────────────────────────────────────────

test("the limits are the ones the game has: 254 full and 4096 light", () => {
  assert.equal(FULL_LIMIT, 254);
  assert.equal(LIGHT_LIMIT, 4096);
});

test("limitFinding: comfortably under is fine, within fourteen of the full limit warns, over it is a problem", () => {
  const at_ = (full: number, light: number) => limitFinding(full, light, 5).status;
  assert.equal(at_(0, 0), "ok");
  assert.equal(at_(239, 0), "ok");
  assert.equal(at_(240, 0), "warn");
  assert.equal(at_(254, 0), "warn");
  assert.equal(at_(255, 0), "problem");
  assert.equal(at_(300, 0), "problem");
});

test("limitFinding: the light limit works the same way, within ninety-six of 4096", () => {
  const at_ = (full: number, light: number) => limitFinding(full, light, 5).status;
  assert.equal(at_(10, 3999), "ok");
  assert.equal(at_(10, 4000), "warn");
  assert.equal(at_(10, 4096), "warn");
  assert.equal(at_(10, 4097), "problem");
});

test("limitFinding says what it counted, what the rule is and where the rule comes from", () => {
  const f = limitFinding(120, 30, 7);
  assert.equal(f.id, "setup.plugin-limit");
  assert.equal(f.basis, "rule");
  assert.match(f.source ?? "", /dyndolod\.info\/Messages\/Plugin-Limit/);
  assert.match(f.detail, /120 of 254 full plugins and 30 of 4096 light plugins/);
  assert.match(f.detail, /counting the 7 game and Creation Club files/);
  for (const worse of [limitFinding(245, 30, 7), limitFinding(260, 30, 7)]) {
    assert.match(worse.detail, /Skyrim can load 254 full plugins and 4096 light ones; a light plugin is one flagged ESL or named \.esl/);
    assert.match(worse.source ?? "", /dyndolod\.info/);
  }
  assert.equal(limitFinding(300, 0, 5).fix?.includes("light"), true, "the fix mentions flagging small plugins as light");
});

// ─── The guard around each check ─────────────────────────────────────────────

test("the guard returns what a check returns", () => {
  const { step, stopped } = createGuard();
  assert.equal(step("adding", () => 2 + 2), 4);
  assert.deepEqual(step("a list", () => ["a"]), ["a"]);
  assert.deepEqual(stopped, []);
});

test("a check that throws is left out and listed, in the order they stopped, without the error's own words", () => {
  const { step, stopped } = createGuard();
  assert.equal(
    step("The first", () => {
      throw new Error("EACCES: permission denied, open '/home/someone/private/file.txt'");
    }),
    undefined
  );
  assert.equal(step("The fine one", () => "fine"), "fine");
  assert.equal(
    step("The second", () => {
      throw "not even an Error";
    }),
    undefined
  );
  assert.deepEqual(
    stopped.map((s) => s.what),
    ["The first", "The second"]
  );
  assert.ok(stopped.every((s) => /stopped on an error/.test(s.why)));
  assert.ok(!JSON.stringify(stopped).includes("someone"), "a path in the error doesn't reach the report");
});
