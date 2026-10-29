import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_APP_MIME, MCP_APPS_EXTENSION_ID } from "@modwrench/ui";
import {
  checkGtaPatchDay,
  isGtaPatchDayRequest,
  logSupports,
  parseGtaVersion,
  parseVerTag,
  readShvLog,
  type GtaPatchDayReport,
  type GtaPatchDayResult,
} from "../src/patchday/gtav.js";
import { summarizeGtaPatchDay } from "../src/patchday/summary.js";
import { registerWorkbenchTools } from "../src/register.js";
import { holdsPath } from "./helpers/paths.js";
import { buildPe } from "./helpers/pe-builder.js";

// ─── What these tests are ────────────────────────────────────────────────────
// GTA V's Patch Day, end to end: folders laid out like a GTA V install (the game's
// executable, ScriptHookV.dll, ScriptHookV.log, a Steam library) and the check
// pointed at them. The executables and DLLs are real PE images from the helper,
// carrying the FILEVERSION a real one does.
//
// The logs are Script Hook V's own, as players have posted them on Steam's forums,
// GTAForums, GitHub and Pastebin, with their folder paths taken out. None of this
// has been run against a real GTA V install yet.
//
// Every test runs with HOME, USERPROFILE, APPDATA, LOCALAPPDATA and STEAM_ROOT
// pointed into a temp folder, so what the check finds is only what the test built.

const ENV_KEYS = ["HOME", "USERPROFILE", "STEAM_ROOT", "LOCALAPPDATA", "APPDATA"] as const;
const saved: Record<string, string | undefined> = {};
let ROOT = "";

function isolate(): void {
  process.env.HOME = join(ROOT, "home");
  process.env.USERPROFILE = join(ROOT, "home");
  process.env.LOCALAPPDATA = join(ROOT, "home", "AppData", "Local");
  process.env.APPDATA = join(ROOT, "home", "AppData", "Roaming");
  process.env.STEAM_ROOT = join(ROOT, "no-steam-here");
}

before(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  ROOT = mkdtempSync(join(tmpdir(), "mw-patchday-gtav-"));
  isolate();
});
afterEach(isolate);
after(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(ROOT, { recursive: true, force: true });
});

// ─── Logs players posted ─────────────────────────────────────────────────────

/** GTAForums, Script Hook V topic, March 2026: one build for both editions, on Legacy. */
const LOG_2026_LEGACY = [
  "// GTA V SCRIPT HOOK (build Mar 18 2026, v3788.0/1013.33)",
  "//          (C) Alexander Blade 2015-2026",
  "[04:52:31] INIT: Started",
  "[04:52:31] INIT: Success, game version is VER_1_0_3788_0",
  "[04:52:31] INIT: Registering script 'ELS.asi' (0x00007FFB3D6550E0)",
  "[04:52:38] INIT: Pool 1 extended",
  "[04:52:43] INIT: DX init succeeded",
].join("\r\n");

/** The same build on Enhanced. The version tag is the one SHVDN's issue tracker shows for Enhanced, with this build's number. */
const LOG_2026_ENHANCED = LOG_2026_LEGACY.replace("VER_1_0_3788_0", "VER_EN_1_0_1013_33").replace(
  "[04:52:31] INIT: Registering script 'ELS.asi' (0x00007FFB3D6550E0)",
  "[04:52:31] INIT: Registering script 'NativeTrainer.asi' (0x00007FFB3D6550E0)\r\n[04:52:31] INIT: Registering script 'ScriptHookVDotNet.asi' (0x00007FFB3D6560E0)"
);

/** Steam's GTA V forum, September 2018: the game updated past the build. */
const LOG_UNKNOWN = ["// GTA V SCRIPT HOOK (build Sep 3 2017, v1.0.1180.2)", "// (C) Alexander Blade 2015-2017", "[11:46:11] INIT: Started", "[11:46:11] FATAL: Unknown game version"].join("\r\n");

/** Pastebin, 2017: a Steam copy, with more scripts and the texture lines that carry folder paths. */
const LOG_2017 = [
  "// GTA V SCRIPT HOOK (build Sep 3 2017, v1.0.1180.2)",
  "// (C) Alexander Blade 2015-2017",
  "[11:13:06] INIT: Started",
  "[11:13:06] INIT: Success, game version is VER_1_0_1180_2_STEAM",
  "[11:13:06] INIT: Registering script 'LUA.asi' (0x00007FFABD17E6A0)",
  "[11:13:07] INIT: Registering script 'Menyoo.asi' (0x00007FFAA7F1DC00)",
  "[11:13:07] INIT: Registering additional script thread 'Menyoo.asi' (0x00007FFAA7F1C850)",
  "[11:13:07] INIT: Registering script 'NativeTrainer.asi' (0x00007FFAE9E2A3C0)",
  "[11:14:01] CORE: Creating texture 'C:\\Users\\Someone\\Games\\Grand Theft Auto V\\menyooStuff\\Graphics\\Speedo\\needle_orange.png', id 0",
].join("\r\n");

test("the version tags Script Hook V writes, from every era", () => {
  assert.deepEqual(parseVerTag("VER_1_0_3788_0"), { enhanced: false, version: { build: 3788, rev: 0 } });
  assert.deepEqual(parseVerTag("VER_1_0_1180_2_STEAM"), { enhanced: false, version: { build: 1180, rev: 2 } });
  assert.deepEqual(parseVerTag("VER_1_0_505_2_NOSTEAM"), { enhanced: false, version: { build: 505, rev: 2 } });
  assert.deepEqual(parseVerTag("VER_1_0_1868_4_EGS"), { enhanced: false, version: { build: 1868, rev: 4 } });
  assert.deepEqual(parseVerTag("VER_EN_1_0_813_11"), { enhanced: true, version: { build: 813, rev: 11 } });
  assert.equal(parseVerTag("VER_2_0_1_1"), null);
  assert.equal(parseVerTag("nonsense"), null);
});

test("the build on the log's first line: both editions since Enhanced, Legacy alone before it", () => {
  assert.deepEqual(logSupports("3788.0/1013.33"), { legacy: { build: 3788, rev: 0 }, enhanced: { build: 1013, rev: 33 } });
  assert.deepEqual(logSupports("1.0.2699.16"), { legacy: { build: 2699, rev: 16 }, enhanced: null });
  assert.deepEqual(logSupports("1.0.393.4a"), { legacy: { build: 393, rev: 4 }, enhanced: null });
  assert.equal(logSupports("1/2/3"), null);
  assert.equal(logSupports("banana"), null);
});

test("a GTA V version is given the way patch notes and dev-c.com give it", () => {
  assert.deepEqual(parseGtaVersion("1.0.1158.16"), { build: 1158, rev: 16 });
  assert.deepEqual(parseGtaVersion("v1.0.3889.0"), { build: 3889, rev: 0 });
  assert.deepEqual(parseGtaVersion(" 1158.16 "), { build: 1158, rev: 16 });
  assert.equal(parseGtaVersion("1.7.104"), null);
  assert.equal(parseGtaVersion("latest"), null);
});

test("reading a log keeps the build, the outcome, the version tag and a count, and nothing an author or a folder wrote", () => {
  assert.deepEqual(readShvLog(LOG_2026_LEGACY), { scriptsRegistered: 1, build: "3788.0/1013.33", outcome: "started", recognised: "VER_1_0_3788_0" });
  assert.deepEqual(readShvLog(LOG_UNKNOWN), { scriptsRegistered: 0, build: "1.0.1180.2", outcome: "unknown-version" });
  // "Registering additional script thread" is a second thread of a script already counted.
  assert.deepEqual(readShvLog(LOG_2017), { scriptsRegistered: 3, build: "1.0.1180.2", outcome: "started", recognised: "VER_1_0_1180_2_STEAM" });
  assert.deepEqual(readShvLog("// GTA V SCRIPT HOOK (build Mar 18 2026, v3788.0/1013.33)\n[04:52:31] INIT: Started\n"), {
    scriptsRegistered: 0,
    build: "3788.0/1013.33",
    outcome: "unfinished",
  });
  assert.deepEqual(readShvLog(""), { scriptsRegistered: 0, outcome: "unfinished" });
});

// ─── Building an install ─────────────────────────────────────────────────────

type V4 = [number, number, number, number];
let installs = 0;

type Install = { gameDir: string; steamapps: string };

/**
 * A GTA V folder: the edition's executable and, unless shv is null, ScriptHookV.dll with the given FILEVERSION. In a
 * Steam library (steamapps/common/Grand Theft Auto V…) when steam is set, so the manifest is found next to it.
 */
function makeInstall(o: { edition?: "legacy" | "enhanced"; game?: V4; shv?: V4 | null | "garbage"; steam?: { root: string; manifest?: string } } = {}): Install {
  const edition = o.edition ?? "enhanced";
  const steamapps = o.steam ? join(o.steam.root, "steamapps") : join(ROOT, `i${installs}`, "steamapps");
  const folder = edition === "enhanced" ? "Grand Theft Auto V Enhanced" : "Grand Theft Auto V";
  const gameDir = o.steam ? join(steamapps, "common", folder) : join(ROOT, `i${installs}`, "Rockstar Games", folder);
  installs++;
  mkdirSync(gameDir, { recursive: true });
  const exe = edition === "enhanced" ? "GTA5_Enhanced.exe" : "GTA5.exe";
  writeFileSync(join(gameDir, exe), buildPe({ version: o.game ?? (edition === "enhanced" ? [1, 0, 1013, 33] : [1, 0, 3788, 0]) }));
  const shv = o.shv === undefined ? ([3788, 0, 1013, 33] as V4) : o.shv;
  if (shv === "garbage") writeFileSync(join(gameDir, "ScriptHookV.dll"), "not a dll");
  else if (shv) writeFileSync(join(gameDir, "ScriptHookV.dll"), buildPe({ version: shv }));
  if (o.steam) {
    const appId = edition === "enhanced" ? "3240220" : "271590";
    writeFileSync(
      join(steamapps, `appmanifest_${appId}.acf`),
      o.steam.manifest ?? `"AppState"\n{\n\t"appid"\t\t"${appId}"\n\t"name"\t\t"${folder}"\n\t"StateFlags"\t\t"4"\n\t"installdir"\t\t"${folder}"\n\t"buildid"\t\t"100"\n}\n`
    );
  }
  return { gameDir, steamapps };
}

/** Write ScriptHookV.log into the game folder, newer than the game and Script Hook V ("fresh") or older ("stale"). */
function putLog(i: Install, text: string, age: "fresh" | "stale" = "fresh"): void {
  const path = join(i.gameDir, "ScriptHookV.log");
  writeFileSync(path, text);
  const now = Date.now() / 1000;
  const when = age === "fresh" ? now + 60 : now - 86400;
  utimesSync(path, when, when);
}

function ok(result: GtaPatchDayResult): GtaPatchDayReport {
  if (!result.ok) assert.fail(`expected a report, got: ${result.error} ${result.hint ?? ""}`);
  return result;
}

// ─── The verdicts ────────────────────────────────────────────────────────────

test("GO from the files: the Script Hook V build supports the installed Enhanced version, and no log yet", () => {
  const i = makeInstall();
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.kind, "gtav");
  assert.equal(r.verdict, "go");
  assert.deepEqual(r.game, { id: "gta5enhanced", name: "GTA V Enhanced" });
  assert.deepEqual(r.checked, { version: "1.0.1013.33", source: "installed", installed: "1.0.1013.33" });
  assert.deepEqual(r.scriptHook, { present: true, version: "3788.0/1013.33", supports: "1.0.1013.33" });
  assert.equal(r.confidence.evidence, "files");
  assert.deepEqual(r.log, { found: false, fresh: false, scriptsRegistered: 0 });
  assert.match(r.nextSteps.join(" "), /Launch Story Mode once/);
  assert.equal(r.steam, null);
  assert.match(r.limits.join(" "), /Rockstar Games Launcher or Epic/);
});

test("the same build on Legacy is judged by its Legacy half", () => {
  const i = makeInstall({ edition: "legacy" });
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.verdict, "go");
  assert.equal(r.game.id, "gta5");
  assert.equal(r.scriptHook.supports, "1.0.3788.0");
});

test("WAIT: the game is newer than the Script Hook V build (Enhanced 1.0.1158.16 against a 1158.13 build)", () => {
  const i = makeInstall({ game: [1, 0, 1158, 16], shv: [3889, 0, 1158, 13] });
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.verdict, "wait");
  assert.match(r.headline, /^WAIT — Script Hook V supports GTA V Enhanced up to 1\.0\.1158\.13, and the game is 1\.0\.1158\.16/);
  assert.match(r.nextSteps[0]!, /dev-c\.com/);
});

test("WAIT: a build from before Enhanced doesn't support Enhanced at all", () => {
  const i = makeInstall({ shv: [1, 0, 2699, 16] });
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.verdict, "wait");
  assert.equal(r.scriptHook.version, "1.0.2699.16");
  assert.equal(r.scriptHook.supports, null);
  assert.match(r.headline, /from before GTA V Enhanced existed/);
});

test("GO: no ScriptHookV.dll, so nothing for an update to break, and no step to launch", () => {
  const i = makeInstall({ shv: null });
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.verdict, "go");
  assert.equal(r.scriptHook.present, false);
  assert.equal(r.log, null);
  assert.deepEqual(r.nextSteps, []);
});

test("CHECK: ScriptHookV.dll is there but its version can't be read, and there's no log", () => {
  const i = makeInstall({ shv: "garbage" });
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.verdict, "check");
  assert.equal(r.scriptHook.version, null);
});

test("an unreadable DLL with a log: the log's first line says what the build supports", () => {
  const i = makeInstall({ shv: "garbage" });
  putLog(i, LOG_2026_ENHANCED);
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.scriptHook.version, "3788.0/1013.33");
  assert.equal(r.scriptHook.supports, "1.0.1013.33");
  assert.equal(r.verdict, "go");
});

// ─── The log from the last launch ────────────────────────────────────────────

test("GO from the log: Script Hook V started on this version of this edition", () => {
  const i = makeInstall();
  putLog(i, LOG_2026_ENHANCED);
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.verdict, "go");
  assert.equal(r.confidence.evidence, "log");
  assert.match(r.headline, /^GO — Script Hook V started at the last launch of GTA V Enhanced 1\.0\.1013\.33/);
  assert.match(r.reasons[0]!, /VER_EN_1_0_1013_33.*2 scripts/);
  assert.equal(r.log?.outcome, "started");
  assert.equal(r.log?.fresh, true);
  assert.deepEqual(r.nextSteps, []);
});

test('WAIT from the log: "Unknown game version" wins even when the numbers match (a patch that kept its version number)', () => {
  // GTAForums, April 2026: Enhanced updated on 30 March without changing 1.0.1013.33, and Script Hook V stopped.
  const i = makeInstall();
  putLog(i, LOG_UNKNOWN.replace("v1.0.1180.2", "v3788.0/1013.33"));
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.verdict, "wait");
  assert.equal(r.confidence.evidence, "log");
  assert.match(r.headline, /FATAL: Unknown game version/);
  assert.match(r.reasons.join(" "), /without changing its version number/);
});

test("a log older than the game or Script Hook V isn't used, and the check says to launch once", () => {
  const i = makeInstall();
  putLog(i, LOG_UNKNOWN, "stale");
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.verdict, "go", "an old failure, from before Script Hook V was replaced, doesn't count");
  assert.equal(r.log?.fresh, false);
  assert.equal(r.confidence.evidence, "files");
  assert.match(r.nextSteps.join(" "), /Launch Story Mode once/);
});

test("a log from the other edition isn't taken as this one's", () => {
  const i = makeInstall();
  putLog(i, LOG_2026_LEGACY);
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  assert.equal(r.confidence.evidence, "files");
});

test("logPath points at a log somewhere else", () => {
  const i = makeInstall();
  const elsewhere = join(ROOT, "copied-ScriptHookV.log");
  writeFileSync(elsewhere, LOG_2026_ENHANCED);
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir, logPath: elsewhere }));
  assert.equal(r.log?.outcome, "started");
});

// ─── Before updating ─────────────────────────────────────────────────────────

test("targetVersion: a version newer than the build is a WAIT, one it covers a GO, both predictions", () => {
  const i = makeInstall({ game: [1, 0, 1013, 29] });
  putLog(i, LOG_2026_ENHANCED.replace("VER_EN_1_0_1013_33", "VER_EN_1_0_1013_29"));
  const newer = ok(checkGtaPatchDay({ gamePath: i.gameDir, targetVersion: "1.0.1158.16" }));
  assert.equal(newer.verdict, "wait");
  assert.equal(newer.confidence.evidence, "prediction");
  assert.deepEqual(newer.checked, { version: "1.0.1158.16", source: "targetVersion", installed: "1.0.1013.29" });
  assert.match(newer.headline, /^WAIT — Updating to 1\.0\.1158\.16 would stop Script Hook V/);
  assert.match(newer.nextSteps[0]!, /Before updating/);

  const covered = ok(checkGtaPatchDay({ gamePath: i.gameDir, targetVersion: "1013.33" }));
  assert.equal(covered.verdict, "go");
  assert.equal(covered.confidence.evidence, "prediction");
  assert.match(covered.headline, /already supports GTA V Enhanced 1\.0\.1013\.33/);
});

test("a targetVersion that isn't a GTA V version is refused, with an example", () => {
  const i = makeInstall();
  const r = checkGtaPatchDay({ gamePath: i.gameDir, targetVersion: "1.7.104" });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /isn't a GTA V version/);
    assert.match(r.hint ?? "", /1\.0\.1158\.16/);
    assert.deepEqual(r.supportedGames, ["gta5", "gta5enhanced"]);
  }
});

test("WAIT: Steam has an update waiting, even though the build covers the installed version", () => {
  const steam = join(ROOT, "steam-pending");
  const manifest =
    '"AppState"\n{\n\t"appid"\t\t"3240220"\n\t"StateFlags"\t\t"6"\n\t"installdir"\t\t"Grand Theft Auto V Enhanced"\n\t"buildid"\t\t"100"\n\t"TargetBuildID"\t\t"200"\n\t"AutoUpdateBehavior"\t\t"1"\n}\n';
  const i = makeInstall({ steam: { root: steam, manifest } });
  putLog(i, LOG_2026_ENHANCED);
  process.env.STEAM_ROOT = steam;
  const r = ok(checkGtaPatchDay({}));
  assert.equal(r.verdict, "wait");
  assert.equal(r.confidence.evidence, "prediction");
  assert.equal(r.steam?.updatePending, true);
  assert.match(r.headline, /Steam has a GTA V Enhanced update waiting/);
  assert.match(r.reasons.join(" "), /it started at the last launch/);
  assert.match(r.nextSteps.join(" "), /update only when you launch/);
  assert.doesNotMatch(r.limits.join(" "), /Rockstar Games Launcher/, "Steam's view is known");
});

test("CHECK: an update is waiting and Script Hook V is already ahead of the game, so the update may be the version it supports", () => {
  const steam = join(ROOT, "steam-ahead");
  const manifest =
    '"AppState"\n{\n\t"appid"\t\t"3240220"\n\t"StateFlags"\t\t"6"\n\t"installdir"\t\t"Grand Theft Auto V Enhanced"\n\t"buildid"\t\t"100"\n\t"TargetBuildID"\t\t"200"\n}\n';
  makeInstall({ game: [1, 0, 1013, 29], steam: { root: steam, manifest } });
  process.env.STEAM_ROOT = steam;
  const r = ok(checkGtaPatchDay({}));
  assert.equal(r.verdict, "check");
  assert.equal(r.confidence.evidence, "prediction");
  assert.match(r.headline, /already supports up to 1\.0\.1013\.33, newer than the game's 1\.0\.1013\.29/);
  assert.match(r.nextSteps.join(" "), /targetVersion/);
});

// ─── Finding the game ────────────────────────────────────────────────────────

test("both editions in Steam: the one with Script Hook V is checked, and the other is named", () => {
  const steam = join(ROOT, "steam-both");
  makeInstall({ edition: "enhanced", shv: null, steam: { root: steam } });
  makeInstall({ edition: "legacy", steam: { root: steam } });
  process.env.STEAM_ROOT = steam;
  const r = ok(checkGtaPatchDay({}));
  assert.equal(r.game.id, "gta5");
  assert.equal(r.otherEdition, "GTA V Enhanced");
  // Asking for one gets that one.
  assert.equal(ok(checkGtaPatchDay({ gameId: "gta5enhanced" })).game.id, "gta5enhanced");
});

test("errors: not in Steam, the wrong edition in gamePath, no executable, an edition that doesn't exist", () => {
  const none = checkGtaPatchDay({});
  assert.equal(none.ok, false);
  if (!none.ok) assert.match(none.hint ?? "", /Rockstar Games Launcher or Epic/);

  const enhanced = makeInstall();
  const wrong = checkGtaPatchDay({ gameId: "gta5", gamePath: enhanced.gameDir });
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.error, "GTA5.exe isn't in that folder.");

  const empty = join(ROOT, "empty");
  mkdirSync(empty, { recursive: true });
  const nothing = checkGtaPatchDay({ gamePath: empty });
  assert.equal(nothing.ok, false);

  const bogus = checkGtaPatchDay({ gameId: "gta4" });
  assert.equal(bogus.ok, false);
  if (!bogus.ok) assert.match(bogus.hint ?? "", /gta5enhanced/);
});

test("isGtaPatchDayRequest: GTA V by its game id or by an executable in gamePath, nothing else", () => {
  const i = makeInstall({ edition: "legacy" });
  assert.equal(isGtaPatchDayRequest({ gameId: "gta5" }), true);
  assert.equal(isGtaPatchDayRequest({ gameId: "gta5enhanced" }), true);
  assert.equal(isGtaPatchDayRequest({ gameId: "skyrimspecialedition" }), false);
  assert.equal(isGtaPatchDayRequest({ gamePath: i.gameDir }), true);
  assert.equal(isGtaPatchDayRequest({ gamePath: ROOT }), false);
  assert.equal(isGtaPatchDayRequest({}), false);
});

// ─── What leaves the check ───────────────────────────────────────────────────

test("the report and its text name no folder and nothing from the log but its build and version tag", () => {
  const i = makeInstall();
  putLog(i, LOG_2026_ENHANCED + "\r\n" + LOG_2017.split("\r\n").slice(-1)[0]);
  const r = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  for (const out of [JSON.stringify(r), summarizeGtaPatchDay(r)]) {
    assert.equal(holdsPath(out, i.gameDir), false, "the game folder");
    assert.equal(holdsPath(out, ROOT), false, "the temp root");
    for (const leak of ["NativeTrainer.asi", "ScriptHookVDotNet.asi", "Someone", "menyooStuff", "0x00007FF"]) {
      assert.ok(!out.includes(leak), `${leak} left the check`);
    }
  }
});

test("the text answer: the verdict first, then how sure, why, the setup line, the steps and the limits", () => {
  const i = makeInstall({ game: [1, 0, 1158, 16], shv: [3889, 0, 1158, 13] });
  const text = summarizeGtaPatchDay(ok(checkGtaPatchDay({ gamePath: i.gameDir })));
  const lines = text.split("\n");
  assert.match(lines[0]!, /^WAIT — /);
  assert.match(text, /\nHow sure: From the game's and Script Hook V's version numbers/);
  assert.match(text, /\nSetup: GTA V Enhanced: 1\.0\.1158\.16 · Script Hook V: v3889\.0\/1158\.13, supports up to 1\.0\.1158\.13 · Script Hook V log: not found\./);
  assert.match(text, /\nNext steps:\n1\. Get the newest Script Hook V/);
  assert.match(text, /\nWhat this can't tell you:\n- It checks Script Hook V only/);
  assert.match(text, /Not yet checked on a real install/);

  const failed = summarizeGtaPatchDay({ ok: false, error: "Nope.", hint: "Try this.", supportedGames: ["gta5", "gta5enhanced"] });
  assert.equal(failed, "Patch Day couldn't run: Nope.\nTry this.\nGames it covers: gta5, gta5enhanced.");
});

// ─── Through mw_patch_day ────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: string; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

class MockMcpServer {
  tools = new Map<string, { handler: (args: Record<string, unknown>) => Promise<ToolResult> }>();
  constructor(private readonly clientCapabilities?: unknown) {}
  get server(): { getClientCapabilities: () => unknown } {
    return { getClientCapabilities: () => this.clientCapabilities };
  }
  registerTool(name: string, _config: unknown, handler: never): void {
    this.tools.set(name, { handler });
  }
  registerResource(): void {}
}

const DRAWS_PAGES = { extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME] } } };

function patchDay(): (args: Record<string, unknown>) => Promise<ToolResult> {
  const server = new MockMcpServer(DRAWS_PAGES);
  registerWorkbenchTools(server as unknown as never);
  return server.tools.get("mw_patch_day")!.handler;
}

const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("mw_patch_day takes GTA V by gameId or by gamePath, answering in text with the report alongside", async () => {
  const i = makeInstall();
  putLog(i, LOG_2026_ENHANCED);
  const engine = ok(checkGtaPatchDay({ gamePath: i.gameDir }));
  for (const args of [{ gamePath: i.gameDir }, { gameId: "gta5enhanced", gamePath: i.gameDir }]) {
    const result = await patchDay()(args);
    assert.equal(result.content[0]!.text, summarizeGtaPatchDay(engine));
    assert.deepEqual(wire(result.structuredContent), wire(engine));
    assert.equal(result.isError, undefined);
  }
});

test("mw_patch_day with nothing given finds GTA V in Steam when there's no Skyrim or Fallout 4", async () => {
  const steam = join(ROOT, "steam-gta-only");
  makeInstall({ edition: "legacy", steam: { root: steam } });
  process.env.STEAM_ROOT = steam;
  const result = await patchDay()({});
  assert.equal((result.structuredContent as { kind?: string }).kind, "gtav");
  assert.match(result.content[0]!.text, /^GO — Script Hook V supports GTA V Legacy/);
});

test("mw_patch_day lists GTA V among the games it covers when it can't run: nothing installed, or a game it doesn't know", async () => {
  for (const args of [{}, { gameId: "skyrimvr" }]) {
    const result = await patchDay()(args);
    assert.match(result.content[0]!.text, /Games it covers: skyrimspecialedition, fallout4, gta5, gta5enhanced\./, JSON.stringify(args));
  }
});
