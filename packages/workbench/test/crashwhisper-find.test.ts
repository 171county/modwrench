import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CRASH_LOG_GAMES, decodeLog, findCrashLogs, readLogFile } from "../src/crashwhisper/find.js";
import { createSandbox, put } from "./helpers/world.js";

const sandbox = createSandbox("mw-crashfind-");
before(() => sandbox.start());
afterEach(() => sandbox.isolate());
after(() => sandbox.stop());

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const real = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: real, configurable: true });
  }
}

/** A log file whose modified time is `daysAgo` days back. */
function logAt(dir: string, name: string, daysAgo: number, text = "log"): string {
  put(dir, name, text);
  const when = new Date(Date.now() - daysAgo * 86_400_000);
  utimesSync(join(dir, name), when, when);
  return join(dir, name);
}

const skseFolder = (documents: string, folder = "Skyrim Special Edition"): string => join(documents, "My Games", folder, "SKSE");

test("the games it knows where to look for", () => {
  assert.ok(CRASH_LOG_GAMES.includes("skyrimspecialedition"));
  assert.ok(CRASH_LOG_GAMES.includes("fallout4"));
  assert.ok(CRASH_LOG_GAMES.includes("lethalcompany"));
});

// ─── Crash Logger and Buffout 4: Documents\My Games\<game>\SKSE ───────────────

test("Skyrim under Proton: the newest crash log first, and only crash logs", () => {
  const w = sandbox.makeWorld();
  const dir = skseFolder(w.documents);
  logAt(dir, "crash-2026-09-01-10-00-00.log", 30);
  logAt(dir, "crash-2026-10-01-21-14-03.log", 1);
  logAt(dir, "crash-2026-09-20-08-00-00.log", 12);
  logAt(dir, "crash-2026-10-01-21-14-03.dmp", 0);
  logAt(dir, "skse64.log", 0);
  logAt(dir, "notes.txt", 0);
  const { logs } = findCrashLogs({ gameId: "skyrimspecialedition" });
  assert.deepEqual(
    logs.map((l) => l.name),
    ["crash-2026-10-01-21-14-03.log", "crash-2026-09-20-08-00-00.log", "crash-2026-09-01-10-00-00.log"]
  );
  assert.ok(logs.every((l) => l.gameId === "skyrimspecialedition"));
  assert.ok(logs[0]!.size > 0 && logs[0]!.mtimeMs > logs[1]!.mtimeMs);
});

test("a Crashlogs folder inside the SKSE folder is read too", () => {
  const w = sandbox.makeWorld();
  const dir = skseFolder(w.documents);
  logAt(dir, "crash-a.log", 5);
  logAt(join(dir, "Crashlogs"), "crash-b.log", 1);
  const names = findCrashLogs({ gameId: "skyrimspecialedition" }).logs.map((l) => l.name);
  assert.deepEqual(names, ["crash-b.log", "crash-a.log"]);
});

test("a GOG copy's Documents folder is read", () => {
  const w = sandbox.makeWorld();
  logAt(skseFolder(w.documents, "Skyrim Special Edition GOG"), "crash-gog.log", 1);
  assert.deepEqual(findCrashLogs({ gameId: "skyrimspecialedition" }).logs.map((l) => l.name), ["crash-gog.log"]);
});

test("folder names are matched whatever their letter case", () => {
  const w = sandbox.makeWorld();
  logAt(join(w.documents, "my games", "skyrim special edition", "skse"), "crash-lower.log", 1);
  assert.deepEqual(findCrashLogs({ gameId: "skyrimspecialedition" }).logs.map((l) => l.name), ["crash-lower.log"]);
});

test("on Windows the logs are under the player's Documents, and a OneDrive-redirected Documents too", () => {
  sandbox.makeWorld();
  logAt(skseFolder(join(sandbox.home, "Documents")), "crash-local.log", 3);
  logAt(skseFolder(join(sandbox.home, "OneDrive", "Documents")), "crash-onedrive.log", 1);
  const names = withPlatform("win32", () => findCrashLogs({ gameId: "skyrimspecialedition" }).logs.map((l) => l.name));
  assert.deepEqual(names, ["crash-onedrive.log", "crash-local.log"]);
});

/** Where Proton keeps Fallout 4's Documents, in the same Steam library as the world's Skyrim. */
const fo4Documents = (steamapps: string): string =>
  join(steamapps, "compatdata", "377160", "pfx", "drive_c", "users", "steamuser", "Documents");

test("Fallout 4's logs sit under F4SE", () => {
  const w = sandbox.makeWorld();
  logAt(join(fo4Documents(w.steamapps), "My Games", "Fallout4", "F4SE"), "crash-fo4.log", 1);
  const { logs } = findCrashLogs({ gameId: "fallout4", gamePath: w.gameDir });
  assert.deepEqual(logs.map((l) => [l.name, l.gameId]), [["crash-fo4.log", "fallout4"]]);
});

test("a game path given with the game id is used for logs kept in the install folder", () => {
  const w = sandbox.makeWorld();
  logAt(join(w.gameDir, "Data", "F4SE", "Plugins"), "crash-in-game.log", 1);
  const names = findCrashLogs({ gameId: "fallout4", gamePath: w.gameDir }).logs.map((l) => l.name);
  assert.deepEqual(names, ["crash-in-game.log"]);
});

test("with no game given, the newest log of any game comes first", () => {
  const w = sandbox.makeWorld();
  logAt(skseFolder(w.documents), "crash-skyrim.log", 4);
  logAt(join(fo4Documents(w.steamapps), "My Games", "Fallout4", "F4SE"), "crash-fo4.log", 1);
  const logs = findCrashLogs().logs;
  assert.equal(logs[0]?.name, "crash-fo4.log");
  assert.ok(logs.some((l) => l.name === "crash-skyrim.log"));
});

test("no logs anywhere: nothing found, and what was searched is said without folders", () => {
  sandbox.makeWorld();
  const r = findCrashLogs({ gameId: "skyrimspecialedition" });
  assert.deepEqual(r.logs, []);
  assert.deepEqual(r.looked, ["Skyrim Special Edition: no log found"]);
  for (const line of r.looked) assert.doesNotMatch(line, /[\\/]|home|mw-crashfind/i);
});

test("what was searched is counted in words", () => {
  const w = sandbox.makeWorld();
  logAt(skseFolder(w.documents), "crash-1.log", 1);
  logAt(skseFolder(w.documents), "crash-2.log", 2);
  assert.deepEqual(findCrashLogs({ gameId: "skyrimspecialedition" }).looked, ["Skyrim Special Edition: 2 logs found"]);
});

test("at most 40 logs per game are kept, the newest", () => {
  const w = sandbox.makeWorld();
  const dir = skseFolder(w.documents);
  for (let i = 0; i < 55; i++) logAt(dir, `crash-${String(i).padStart(2, "0")}.log`, i + 1);
  const { logs } = findCrashLogs({ gameId: "skyrimspecialedition" });
  assert.equal(logs.length, 40);
  assert.equal(logs[0]?.name, "crash-00.log");
});

test("a game it doesn't know finds nothing", () => {
  sandbox.makeWorld();
  assert.deepEqual(findCrashLogs({ gameId: "notagame" }), { logs: [], looked: [] });
});

// ─── BepInEx ─────────────────────────────────────────────────────────────────

test("BepInEx: the log in the game folder", () => {
  const w = sandbox.makeWorld();
  logAt(join(w.gameDir, "BepInEx"), "LogOutput.log", 1);
  const { logs } = findCrashLogs({ gameId: "lethalcompany", gamePath: w.gameDir });
  assert.deepEqual(logs.map((l) => [l.name, l.gameId]), [["LogOutput.log", "lethalcompany"]]);
});

test("BepInEx: r2modman profiles, the most recently played first", () => {
  sandbox.makeWorld();
  const profiles = join(sandbox.home, ".config", "r2modmanPlus-local", "LethalCompany", "profiles");
  logAt(join(profiles, "Default", "BepInEx"), "LogOutput.log", 8);
  logAt(join(profiles, "Friends", "BepInEx"), "LogOutput.log", 2);
  const logs = findCrashLogs({ gameId: "lethalcompany" }).logs;
  assert.equal(logs.length, 2);
  assert.ok(logs[0]!.mtimeMs > logs[1]!.mtimeMs);
});

// ─── Reading ─────────────────────────────────────────────────────────────────

test("decodeLog: UTF-8 with or without a byte-order mark, and UTF-16 either way round", () => {
  assert.equal(decodeLog(Buffer.from("plain")), "plain");
  assert.equal(decodeLog(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("with bom")])), "with bom");
  assert.equal(decodeLog(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("utf16", "utf16le")])), "utf16");
  const be = Buffer.from("utf16be", "utf16le");
  be.swap16();
  assert.equal(decodeLog(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), "utf16be");
});

test("readLogFile: a small file whole; a missing one is null", () => {
  const w = sandbox.makeWorld();
  const path = logAt(skseFolder(w.documents), "crash-x.log", 0, "hello\nworld");
  assert.deepEqual(readLogFile(path), { text: "hello\nworld", size: 11, cut: false, head: 11, tail: 0 });
  assert.equal(readLogFile(join(w.root, "no-such-file.log")), null);
});

test("readLogFile: a huge file is read at its beginning and its end", () => {
  const w = sandbox.makeWorld();
  const dir = join(w.root, "big");
  mkdirSync(dir, { recursive: true });
  const filler = "x".repeat(1023) + "\n";
  const chunk = filler.repeat(1024); // 1 MiB
  const parts = ["HEAD-MARK\n", chunk];
  for (let i = 0; i < 6; i++) parts.push(chunk);
  parts.push("MIDDLE-MARK\n");
  for (let i = 0; i < 12; i++) parts.push(chunk);
  parts.push("TAIL-MARK\n");
  const path = join(dir, "LogOutput.log");
  writeFileSync(path, parts.join(""));
  const read = readLogFile(path);
  assert.equal(read?.cut, true);
  assert.ok(read!.text.includes("HEAD-MARK"));
  assert.ok(read!.text.includes("TAIL-MARK"));
  assert.ok(!read!.text.includes("MIDDLE-MARK"));
  assert.ok(read!.text.length < 13 * 1024 * 1024);
});

// ─── A big file: both ends in one encoding, whole lines only ──────────────────

/** A numbered line of a fixed length, so a cut can be laid exactly where a test wants it. */
const numbered = (i: number, width = 64): string => `${`line ${String(i).padStart(5, "0")} `.padEnd(width - 1, ".")}\n`;

function bigFile(name: string, bytes: Buffer): { path: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "mw-bigread-"));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return { path, done: () => rmSync(dir, { recursive: true, force: true }) };
}

function lines(text: string): string[] {
  return text.split("\n").filter((l) => l !== "");
}

test("a big file keeps whole lines at both cuts, and nothing from between them", () => {
  const all = Array.from({ length: 400 }, (_, i) => numbered(i));
  const file = bigFile("a.log", Buffer.from(all.join("")));
  try {
    // 400 lines of 64 bytes; read 4096 bytes: 1024 from the start, 3072 from the end.
    const read = readLogFile(file.path, 4096);
    assert.equal(read?.cut, true);
    assert.equal(read?.head, 1024);
    assert.equal(read?.tail, 3072);
    const got = lines(read!.text);
    assert.ok(got.length > 40 && got.length < 70, `${got.length} lines`);
    for (const l of got) assert.ok(all.includes(`${l}\n`), `a line was cut: ${JSON.stringify(l)}`);
    assert.ok(got.includes(all[0]!.trim()));
    assert.ok(got.includes(all[399]!.trim()));
    assert.ok(!got.includes(all[200]!.trim()));
  } finally {
    file.done();
  }
});

test("a cut that falls mid-line drops the half line at each end", () => {
  // 61-byte lines do not divide 1024 or 3072, so both cuts land inside a line.
  const all = Array.from({ length: 300 }, (_, i) => numbered(i, 61));
  const file = bigFile("b.log", Buffer.from(all.join("")));
  try {
    const read = readLogFile(file.path, 4096);
    for (const l of lines(read!.text)) assert.ok(all.includes(`${l}\n`), `a line was cut: ${JSON.stringify(l)}`);
    // 1024 / 61 = 16.8: 16 whole lines are kept from the start.
    assert.ok(lines(read!.text).includes(all[15]!.trim()));
    assert.ok(!lines(read!.text).includes(all[16]!.trim()));
  } finally {
    file.done();
  }
});

test("a cut that falls exactly on a line start keeps that line", () => {
  // 200 lines of 64 bytes = 12800. The tail starts 3072 from the end = byte 9728 = the start of line 152.
  const all = Array.from({ length: 200 }, (_, i) => numbered(i));
  const file = bigFile("c.log", Buffer.from(all.join("")));
  try {
    const got = lines(readLogFile(file.path, 4096)!.text);
    assert.ok(got.includes(all[152]!.trim()), "the first line of the tail was thrown away");
    assert.ok(!got.includes(all[151]!.trim()));
    assert.ok(got.includes(all[15]!.trim()), "the last whole line of the head was thrown away");
  } finally {
    file.done();
  }
});

test("a UTF-16 file is read at its end in UTF-16 too, either way round, and with an odd length", () => {
  const all = Array.from({ length: 400 }, (_, i) => numbered(i));
  const text = all.join("");
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const be = Buffer.from(text, "utf16le");
  be.swap16();
  const withBe = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
  const cases: [string, Buffer][] = [
    ["utf-16le", le],
    ["utf-16be", withBe],
    ["utf-16le, odd length", Buffer.concat([le, Buffer.from([0x0a])])],
    ["utf-16be, odd length", Buffer.concat([withBe, Buffer.from([0x00])])],
  ];
  for (const [name, bytes] of cases) {
    const file = bigFile("u16.log", bytes);
    try {
      const read = readLogFile(file.path, 4096);
      assert.equal(read?.cut, true, name);
      assert.ok(!read!.text.includes("\u0000"), `${name}: the tail was read as the wrong encoding`);
      const got = lines(read!.text);
      assert.ok(got.length > 20, `${name}: ${got.length} lines`);
      for (const l of got) assert.ok(all.includes(`${l}\n`), `${name}: a line was cut or garbled: ${JSON.stringify(l.slice(0, 40))}`);
      assert.ok(got.includes(all[0]!.trim()), name);
      assert.ok(got.includes(all[399]!.trim()), name);
      assert.ok(!got.includes(all[200]!.trim()), name);
    } finally {
      file.done();
    }
  }
});

test("UTF-16 written without a byte-order mark is still read as text", () => {
  const text = "Crash at 0x7FF6 in Mod.dll\nsecond line\n";
  assert.equal(decodeLog(Buffer.from(text, "utf16le")), text);
  const be = Buffer.from(text, "utf16le");
  be.swap16();
  assert.equal(decodeLog(be), text);
  // Plain text, even with a few zero bytes in it, stays UTF-8.
  assert.equal(decodeLog(Buffer.from("plain text, nothing odd about it at all")), "plain text, nothing odd about it at all");
  const rare = Buffer.from("a long line of ordinary text with one stray zero byte here: \u0000 and then more text after it\n");
  assert.equal(decodeLog(rare), rare.toString("utf8"));
});

test("a UTF-8 file with a multi-byte character at the cut leaves no broken characters", () => {
  const all = Array.from({ length: 300 }, (_, i) => `ü${String(i).padStart(4, "0")} Zürich-Café ${"é".repeat(20)}\n`);
  const file = bigFile("d.log", Buffer.from(all.join("")));
  try {
    for (const whole of [3001, 4097, 4093, 5003]) {
      const read = readLogFile(file.path, whole);
      assert.equal(read?.cut, true);
      assert.ok(!read!.text.includes("\ufffd"), `a character was split (whole=${whole})`);
    }
  } finally {
    file.done();
  }
});

test("a big file with no line breaks at all gives nothing half-read", () => {
  const file = bigFile("e.log", Buffer.from("x".repeat(9000)));
  try {
    const read = readLogFile(file.path, 4096);
    assert.equal(read?.cut, true);
    assert.equal(read!.text.trim(), "");
  } finally {
    file.done();
  }
});
