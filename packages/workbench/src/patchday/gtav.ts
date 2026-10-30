import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathExists } from "../detect/os.js";
import { findInstalledApp, findSteamLibraries, findSteamRoot } from "../detect/steam.js";
import { readSteamFacts, type SteamFacts } from "./index.js";
import { readFileVersion, type FileVersion } from "./pe.js";
import type { Evidence, Verdict } from "./rules.js";

// ─── Patch Day for GTA V: "is it safe to update GTA V?" ──────────────────────
// Script Hook V, which nearly every GTA V script mod runs on, finds its way around
// the game's executable by exact patterns. A game update moves them, and until its
// author releases a new build Script Hook V stops with "FATAL: Unknown game
// version" and no script mod loads. Its DLL and its log say which game versions it
// was built for, the game's executable says which one is installed, Steam says
// whether an update is waiting, and the log says what happened at the last launch.
// This reads those and answers before the player updates or launches.
//
// GTA V comes in two editions with their own executables and Steam apps: Legacy
// (GTA5.exe) and Enhanced (GTA5_Enhanced.exe, since March 2025). One Script Hook V
// build covers both: its DLL's version is "3751.0.1013.29" for Legacy 1.0.3751.0
// and Enhanced 1.0.1013.29, and its log opens with
// "// GTA V SCRIPT HOOK (build Mar 18 2026, v3788.0/1013.33)". Builds from before
// Enhanced carry one game version: 1.0.2699.16.
//
// Local and read-only: no network, nothing written, nothing stored. See TRUST.md
// ("Patch Day").

type Edition = {
  gameId: "gta5" | "gta5enhanced";
  name: string;
  appId: string;
  exe: string;
  /** A game version to show in a hint. */
  example: string;
};

const ENHANCED: Edition = { gameId: "gta5enhanced", name: "GTA V Enhanced", appId: "3240220", exe: "GTA5_Enhanced.exe", example: "1.0.1158.16" };
const LEGACY: Edition = { gameId: "gta5", name: "GTA V Legacy", appId: "271590", exe: "GTA5.exe", example: "1.0.3889.0" };
/** Enhanced first: with both installed and Script Hook V in both or neither, the answer is about Enhanced and names Legacy. */
const EDITIONS: Edition[] = [ENHANCED, LEGACY];

export const GTA_PATCH_DAY_GAMES: string[] = [LEGACY.gameId, ENHANCED.gameId];

const SHV_DLL = "ScriptHookV.dll";
const SHV_LOG = "ScriptHookV.log";
const SHV_SITE = "dev-c.com/gtav/scripthookv";
/** The head of the log holds everything read here; a long session adds only thread and texture lines after it. */
const LOG_HEAD_BYTES = 256 * 1024;

export type GtaPatchDayOptions = {
  /** "gta5" (Legacy) or "gta5enhanced". Default: the edition whose executable is in gamePath, or else the one installed in a Steam library. */
  gameId?: string;
  /** Install folder, for a copy ModWrench can't find (Rockstar Games Launcher, Epic, a custom Steam library). */
  gamePath?: string;
  /** A game version to check against instead of the installed one, e.g. "1.0.1158.16". */
  targetVersion?: string;
  /** ScriptHookV.log, when it isn't in the game folder. */
  logPath?: string;
};

export type GtaLogFacts = {
  found: boolean;
  /** The day the log was last written. */
  modified?: string;
  /** Written after the game's executable and ScriptHookV.dll last changed, so it describes them as they are. */
  fresh: boolean;
  /** How the last launch went: Script Hook V started, stopped on "Unknown game version", or wrote neither. */
  outcome?: "started" | "unknown-version" | "unfinished";
  /** The game version Script Hook V recognised, as it writes it: VER_EN_1_0_1013_33. */
  recognised?: string;
  /** Script Hook V's build, from the log's first line: "3788.0/1013.33". */
  build?: string;
  scriptsRegistered: number;
};

export type GtaPatchDayReport = {
  ok: true;
  /** Tells this report from Skyrim's and Fallout 4's, which carry plugins and an Address Library. */
  kind: "gtav";
  verdict: Verdict;
  headline: string;
  reasons: string[];
  confidence: { evidence: Evidence; summary: string };
  game: { id: string; name: string };
  /** The version the verdict is about. */
  checked: { version: string; source: "installed" | "targetVersion"; installed: string };
  steam: SteamFacts | null;
  scriptHook: {
    present: boolean;
    /** Its build as its DLL (or else its log) gives it: "3788.0/1013.33", or "1.0.2699.16" for a build from before Enhanced. */
    version: string | null;
    /** The newest version of this edition it was built for, or null when that can't be read or it predates this edition. */
    supports: string | null;
  };
  log: GtaLogFacts | null;
  /** The other edition, when it is installed in a Steam library too. */
  otherEdition: string | null;
  limits: string[];
  nextSteps: string[];
};

export type GtaPatchDayError = {
  ok: false;
  /** Tells the Patch Day page this was a GTA V check, so its what-if box suggests a GTA V version. */
  kind: "gtav";
  error: string;
  hint?: string;
  supportedGames: string[];
};

export type GtaPatchDayResult = GtaPatchDayReport | GtaPatchDayError;

// ─── Versions ────────────────────────────────────────────────────────────────
// Every GTA V version so far is 1.0.<build>.<revision>, so a version is the last two numbers.

type GameVersion = { build: number; rev: number };

const text = (v: GameVersion): string => `1.0.${v.build}.${v.rev}`;
const compare = (a: GameVersion, b: GameVersion): number => a.build - b.build || a.rev - b.rev;

/** "1.0.1158.16", "v1.0.1158.16" or "1158.16"; null for anything else. */
export function parseGtaVersion(raw: string): GameVersion | null {
  const m = /^v?(?:1\.0\.)?(\d{1,5})\.(\d{1,5})$/.exec(raw.trim());
  return m ? { build: Number(m[1]), rev: Number(m[2]) } : null;
}

/** The game executable's FILEVERSION, 1.0.<build>.<revision>. */
function exeVersion(v: FileVersion): GameVersion | null {
  return v[0] === 1 && v[1] === 0 ? { build: v[2], rev: v[3] } : null;
}

/** What a Script Hook V build was made for: Legacy and Enhanced, or Legacy alone for a build from before Enhanced. */
type Supports = { legacy: GameVersion; enhanced: GameVersion | null };

/** ScriptHookV.dll's FILEVERSION: 3751.0.1013.29 is Legacy 1.0.3751.0 and Enhanced 1.0.1013.29; 1.0.2699.16 is Legacy only. */
function dllSupports(v: FileVersion): Supports | null {
  if (v[0] === 1 && v[1] === 0) return { legacy: { build: v[2], rev: v[3] }, enhanced: null };
  if (v[0] > 1) return { legacy: { build: v[0], rev: v[1] }, enhanced: { build: v[2], rev: v[3] } };
  return null;
}

const dllText = (v: FileVersion): string => (v[0] === 1 && v[1] === 0 ? v.join(".") : `${v[0]}.${v[1]}/${v[2]}.${v[3]}`);

/** The log's build tag: "3788.0/1013.33" (Legacy/Enhanced), "1.0.2699.16" or "1.0.393.4a" (Legacy only). */
export function logSupports(build: string): Supports | null {
  const parts = build.split("/");
  const strip = (s: string): string => s.replace(/[a-z]$/i, "");
  if (parts.length === 1) {
    const legacy = parseGtaVersion(strip(parts[0]!));
    return legacy ? { legacy, enhanced: null } : null;
  }
  if (parts.length === 2) {
    const legacy = parseGtaVersion(strip(parts[0]!));
    const enhanced = parseGtaVersion(strip(parts[1]!));
    return legacy && enhanced ? { legacy, enhanced } : null;
  }
  return null;
}

// ─── Script Hook V's log ─────────────────────────────────────────────────────
// ScriptHookV.log is rewritten on every launch, in the game folder. From logs players have posted:
//   // GTA V SCRIPT HOOK (build Mar 18 2026, v3788.0/1013.33)
//   //          (C) Alexander Blade 2015-2026
//   [04:52:31] INIT: Started
//   [04:52:31] INIT: Success, game version is VER_1_0_3788_0       (Enhanced: VER_EN_1_0_813_11)
//   [04:52:31] INIT: Registering script 'ELS.asi' (0x00007FFB3D6550E0)
// and, when the game is newer than the build:
//   [11:46:11] FATAL: Unknown game version
// Older builds add "_STEAM", "_NOSTEAM" or "_EGS" to the version. Script names are other authors' text and later
// lines hold folder paths, so only the build tag, the version tag and a count of scripts are kept.

const HEADER = /^\/\/ GTA V SCRIPT HOOK \(build [^,\n]{1,40}, v([0-9a-z./]{1,40})\)/im;
const STARTED = /\bINIT: Success, game version is (VER_[A-Z0-9_]{1,40})/;
const UNKNOWN = /\bFATAL: Unknown game version/;
const REGISTERED = /\bINIT: Registering script '/g;

/** The edition and version in a VER_ tag: VER_EN_1_0_1013_33 is Enhanced 1.0.1013.33, VER_1_0_3788_0_STEAM Legacy 1.0.3788.0. */
export function parseVerTag(tag: string): { enhanced: boolean; version: GameVersion } | null {
  const m = /^VER_(EN_)?1_0_(\d{1,5})_(\d{1,5})(?:_[A-Z]+)?$/.exec(tag);
  return m ? { enhanced: m[1] !== undefined, version: { build: Number(m[2]), rev: Number(m[3]) } } : null;
}

export function readShvLog(text: string): Omit<GtaLogFacts, "found" | "modified" | "fresh"> {
  const facts: Omit<GtaLogFacts, "found" | "modified" | "fresh"> = { scriptsRegistered: (text.match(REGISTERED) ?? []).length };
  const header = HEADER.exec(text);
  if (header) facts.build = header[1]!;
  const started = STARTED.exec(text);
  if (started) {
    facts.outcome = "started";
    facts.recognised = started[1]!;
  } else if (UNKNOWN.test(text)) {
    facts.outcome = "unknown-version";
  } else {
    facts.outcome = "unfinished";
  }
  return facts;
}

function readStart(path: string, max: number): { text: string; mtimeMs: number } | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    const buf = Buffer.alloc(Math.min(st.size, max));
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, got);
      if (n === 0) break;
      got += n;
    }
    return { text: buf.subarray(0, got).toString("latin1"), mtimeMs: st.mtimeMs };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

// ─── The check ───────────────────────────────────────────────────────────────

function fail(error: string, hint?: string): GtaPatchDayError {
  return { ok: false, kind: "gtav", error, ...(hint ? { hint } : {}), supportedGames: GTA_PATCH_DAY_GAMES };
}

/** True when the request is about GTA V: its game id, or a gamePath holding one of its executables. */
export function isGtaPatchDayRequest(options: { gameId?: string | undefined; gamePath?: string | undefined }): boolean {
  if (options.gameId !== undefined) return GTA_PATCH_DAY_GAMES.includes(options.gameId);
  if (options.gamePath !== undefined) {
    const dir = resolve(options.gamePath);
    return EDITIONS.some((e) => pathExists(join(dir, e.exe)));
  }
  return false;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function checkGtaPatchDay(options: GtaPatchDayOptions = {}): GtaPatchDayResult {
  let chosen: Edition | undefined;
  if (options.gameId !== undefined) {
    chosen = EDITIONS.find((e) => e.gameId === options.gameId);
    if (!chosen) return fail(`"${options.gameId}" isn't a GTA V edition.`, "Use gta5 for GTA V Legacy or gta5enhanced for GTA V Enhanced.");
  }

  let target: GameVersion | null = null;
  if (options.targetVersion !== undefined) {
    target = parseGtaVersion(options.targetVersion);
    if (!target) {
      return fail(
        `"${options.targetVersion}" isn't a GTA V version.`,
        `Give it like ${(chosen ?? ENHANCED).example}: the number Rockstar's patch notes or ${SHV_SITE} give.`
      );
    }
  }

  // Where the game is: the folder given, or a Steam library.
  const libraries = (() => {
    const root = findSteamRoot();
    return root ? findSteamLibraries(root) : [];
  })();
  let gameDir: string;
  let otherEdition: string | null = null;
  if (options.gamePath !== undefined) {
    gameDir = resolve(options.gamePath);
    const here = EDITIONS.filter((e) => pathExists(join(gameDir, e.exe)));
    if (chosen && !here.includes(chosen)) {
      return fail(`${chosen.exe} isn't in that folder.`, `gamePath should be the folder that holds ${chosen.exe}.`);
    }
    chosen = chosen ?? here[0];
    if (!chosen) return fail("Neither GTA5.exe nor GTA5_Enhanced.exe is in that folder.", "gamePath should be the folder that holds the game's executable.");
  } else {
    const installed = (chosen ? [chosen] : EDITIONS).flatMap((e) => {
      const app = findInstalledApp(libraries, e.appId);
      return app && pathExists(join(app.installDir, e.exe)) ? [{ edition: e, dir: app.installDir }] : [];
    });
    // With both installed, the one with Script Hook V; with it in both or neither, Enhanced.
    const pick = installed.find((i) => pathExists(join(i.dir, SHV_DLL))) ?? installed[0];
    if (!pick) {
      return fail(
        `Couldn't find ${chosen ? chosen.name : "GTA V"} in any Steam library.`,
        `For a copy from the Rockstar Games Launcher or Epic, or one somewhere unusual, pass gamePath: the folder that holds ${chosen ? chosen.exe : "GTA5.exe or GTA5_Enhanced.exe"}.`
      );
    }
    chosen = pick.edition;
    gameDir = pick.dir;
    otherEdition = installed.find((i) => i !== pick)?.edition.name ?? null;
  }
  const edition: Edition = chosen;
  const enhanced = edition === ENHANCED;
  const exePath = join(gameDir, edition.exe);

  const exeFileVersion = readFileVersion(exePath);
  const installed = exeFileVersion ? exeVersion(exeFileVersion) : null;
  if (!installed) return fail(`Couldn't read the game's version out of ${edition.exe}.`);
  const checked = target ?? installed;
  const whatIf = target !== null && compare(target, installed) !== 0;

  // Steam's view, when the game sits in a Steam library: is an update waiting?
  const steamapps = basename(dirname(gameDir)).toLowerCase() === "common" ? dirname(dirname(gameDir)) : null;
  const manifest = steamapps ? join(steamapps, `appmanifest_${edition.appId}.acf`) : null;
  const steam = manifest && pathExists(manifest) ? readSteamFacts(manifest) : null;

  // Script Hook V: its DLL, and its log from the last launch.
  const dllPath = join(gameDir, SHV_DLL);
  const present = pathExists(dllPath);
  const dllVersion = present ? readFileVersion(dllPath) : null;
  const logPath = options.logPath !== undefined ? resolve(options.logPath) : join(gameDir, SHV_LOG);
  const head = readStart(logPath, LOG_HEAD_BYTES);
  // Fresh: written after the game and Script Hook V were last changed, so it is about the two of them as they are now.
  const exeTime = mtimeOf(exePath);
  const dllTime = present ? mtimeOf(dllPath) : null;
  let log: GtaLogFacts | null = null;
  if (head) {
    log = {
      found: true,
      modified: new Date(head.mtimeMs).toISOString().slice(0, 10),
      fresh: exeTime !== null && head.mtimeMs >= exeTime && (dllTime === null || head.mtimeMs >= dllTime),
      ...readShvLog(head.text),
    };
  } else if (present) {
    log = { found: false, fresh: false, scriptsRegistered: 0 };
  }
  // What the build supports: from its DLL, or else from the first line of its log.
  const supportsAll = (dllVersion ? dllSupports(dllVersion) : null) ?? (log?.build ? logSupports(log.build) : null);
  const supports = supportsAll ? (enhanced ? supportsAll.enhanced : supportsAll.legacy) : null;
  const shvVersion = dllVersion ? dllText(dllVersion) : log?.build ?? null;

  // A log about this edition, written after the game last changed, about the version installed now.
  const usableLog =
    !whatIf && log?.found === true && log.fresh && (log.outcome !== "started" || parseVerTag(log.recognised ?? "")?.enhanced === enhanced)
      ? log
      : null;

  const ctx = { edition, checked, whatIf, present, supports, supportsKnown: supportsAll !== null, steam, log: usableLog };
  const { verdict, headline, reasons, evidence } = decideGta(ctx);
  const report: GtaPatchDayReport = {
    ok: true,
    kind: "gtav",
    verdict,
    headline,
    reasons,
    confidence: { evidence, summary: confidenceLine(evidence, ctx) },
    game: { id: edition.gameId, name: edition.name },
    checked: { version: text(checked), source: target ? "targetVersion" : "installed", installed: text(installed) },
    steam,
    scriptHook: { present, version: shvVersion, supports: supports ? text(supports) : null },
    log,
    otherEdition,
    limits: limitsFor(edition, steam),
    nextSteps: nextStepsFor(ctx),
  };
  return report;
}

type Ctx = {
  edition: Edition;
  checked: GameVersion;
  whatIf: boolean;
  present: boolean;
  /** The newest version of this edition the build supports; null when unknown or when it predates the edition. */
  supports: GameVersion | null;
  /** Whether the build's versions could be read at all. */
  supportsKnown: boolean;
  steam: SteamFacts | null;
  /** The last launch's log, when it is about this version of this edition. */
  log: GtaLogFacts | null;
};

function decideGta(c: Ctx): { verdict: Verdict; headline: string; reasons: string[]; evidence: Evidence } {
  const v = text(c.checked);
  const name = c.edition.name;
  const pending = !c.whatIf && c.steam?.updatePending === true;

  if (!c.present) {
    return {
      verdict: "go",
      headline: `GO — Script Hook V isn't installed in ${name}, so a game update can't break it.`,
      reasons: [`There's no ${SHV_DLL} in the game folder. Script mods (.asi files and ScriptHookVDotNet scripts) need it; other mods weren't checked.`],
      evidence: "files",
    };
  }

  // The last launch, when its log is about this version: the strongest evidence there is.
  if (c.log?.outcome === "unknown-version") {
    return {
      verdict: "wait",
      headline: `WAIT — Script Hook V stopped at the last launch: "FATAL: Unknown game version". It doesn't know this build of ${name} ${v}.`,
      reasons: [
        "Its log from after the game last changed says it didn't recognise the game, so no script mod loaded.",
        ...(c.supports && compare(c.checked, c.supports) <= 0
          ? [`Its version says it supports ${text(c.supports)}, but a game update can change the game without changing its version number, and the log is what happened.`]
          : []),
      ],
      evidence: "log",
    };
  }

  if (!c.supportsKnown) {
    return {
      verdict: "check",
      headline: `CHECK — Script Hook V is installed, but which game versions it supports couldn't be read.`,
      reasons: [`Neither ${SHV_DLL}'s version nor the first line of ${SHV_LOG} could be read.`],
      evidence: "files",
    };
  }

  if (!c.supports) {
    return {
      verdict: "wait",
      headline: `WAIT — This Script Hook V build is from before ${name} existed and doesn't support it.`,
      reasons: [`It was built for GTA V Legacy only. ${name} needs a build from ${SHV_SITE} that lists an Enhanced version.`],
      evidence: "files",
    };
  }

  if (compare(c.checked, c.supports) > 0) {
    return {
      verdict: "wait",
      headline: c.whatIf
        ? `WAIT — Updating to ${v} would stop Script Hook V: the build you have supports ${name} up to ${text(c.supports)}.`
        : `WAIT — Script Hook V supports ${name} up to ${text(c.supports)}, and the game is ${v}. It will stop with "Unknown game version".`,
      reasons: [`Script Hook V supports the game versions up to the one it was built for, and ${v} is newer.`],
      evidence: c.whatIf ? "prediction" : "files",
    };
  }

  // The build covers this version. A waiting update would replace it with one that build may never have seen.
  if (pending && compare(c.checked, c.supports) < 0) {
    // The build is already ahead of the game: its author caught up first, and the update may be the version it supports.
    return {
      verdict: "check",
      headline: `CHECK — Steam has a ${name} update waiting, and your Script Hook V already supports up to ${text(c.supports)}, newer than the game's ${v}.`,
      reasons: [
        "Steam doesn't say which version the update brings. If it is the one Script Hook V lists, the update is fine; if it is newer, Script Hook V will stop until a new build is out.",
      ],
      evidence: "prediction",
    };
  }
  if (pending) {
    return {
      verdict: "wait",
      headline: `WAIT — Steam has a ${name} update waiting. Script Hook V has stopped after every game update so far, until a new build came out.`,
      reasons: [
        `Today it supports up to ${text(c.supports)} and the game is ${v}${c.log?.outcome === "started" ? ", and it started at the last launch" : ""}.`,
        "Steam doesn't say which version the update brings, so whether a Script Hook V build for it is already out can't be told from your files.",
      ],
      evidence: "prediction",
    };
  }

  if (c.log?.outcome === "started") {
    return {
      verdict: "go",
      headline: `GO — Script Hook V started at the last launch of ${name} ${v}.`,
      reasons: [
        `Its log, from after the game last changed, says it recognised the game (${c.log.recognised}) and registered ${plural(c.log.scriptsRegistered, "script", "scripts")}.`,
      ],
      evidence: "log",
    };
  }

  return {
    verdict: "go",
    headline: c.whatIf
      ? `GO — The Script Hook V you have already supports ${name} ${v}.`
      : `GO — Script Hook V supports ${name} up to ${text(c.supports)}, and the game is ${v}.`,
    reasons: [`Script Hook V supports the game versions up to the one it was built for, ${text(c.supports)}.`],
    evidence: c.whatIf ? "prediction" : "files",
  };
}

function confidenceLine(evidence: Evidence, c: Ctx): string {
  if (evidence === "log") return "Script Hook V's own log from a launch after the game last changed: what really happened.";
  if (evidence === "prediction") {
    return c.whatIf
      ? `A prediction for ${text(c.checked)}, from the versions Script Hook V was built for. Its log from the first launch after updating is the real answer.`
      : "A prediction: every GTA V update so far has stopped Script Hook V until its author released a new build.";
  }
  return c.present
    ? "From the game's and Script Hook V's version numbers. A game update can change the game without changing its number, so Script Hook V's log from the next launch is the real answer."
    : "From the files in the game folder.";
}

function nextStepsFor(c: Ctx): string[] {
  const steps: string[] = [];
  const blocked = c.present && (c.log?.outcome === "unknown-version" || (c.supportsKnown && (!c.supports || compare(c.checked, c.supports) > 0)));
  if (blocked) {
    steps.push(
      c.whatIf
        ? `Before updating, check ${SHV_SITE} for a build that lists ${text(c.checked)}. Until one is out, stay on the version you have if you want your script mods.`
        : `Get the newest Script Hook V from ${SHV_SITE} and copy its ${SHV_DLL} over yours. If its list doesn't include ${text(c.checked)} yet, the author hasn't caught up: script mods won't load until then. Story Mode without them still works.`
    );
  }
  if (!c.whatIf && c.steam?.updatePending) {
    steps.push(
      "Steam has an update waiting. If you aren't ready, game Properties → Updates lets you set it to update only when you launch. ModWrench never changes Steam settings. Once you know the new version number, run this again with targetVersion to see what it would do."
    );
  }
  if (c.present && !c.whatIf && !c.log) {
    steps.push(`Launch Story Mode once, close the game, and run this again: Script Hook V's own log from that launch is the strongest evidence there is.`);
  }
  return steps;
}

function limitsFor(edition: Edition, steam: SteamFacts | null): string[] {
  return [
    "It checks Script Hook V only. Not yet: ScriptHookVDotNet and its Enhanced fork, RAGE Plugin Hook and LSPDFR, the ASI loader, and a mods folder whose copy of update.rpf is from before an update.",
    ...(steam ? [] : [`It can't see whether the Rockstar Games Launcher or Epic has an update waiting for ${edition.name}.`]),
    "Script Hook V and GTA Online don't mix: Script Hook V closes the game if you go Online, and Rockstar bans modded Online play. This check is about Story Mode.",
    "Not yet checked on a real install: built from Script Hook V's logs and file versions as players have posted them.",
  ];
}
