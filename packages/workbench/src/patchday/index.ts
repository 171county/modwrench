import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathExists } from "../detect/os.js";
import { findGameById, type GameDef } from "../detect/games.js";
import {
  findInstalledApp,
  findSteamLibraries,
  findSteamRoot,
} from "../detect/steam.js";
import { detectInstalledManagers, inferManagerForGame } from "../detect/manager.js";
import { parseVdf } from "../detect/vdf.js";
import { findMo2InstanceForGame, readMo2LoadOrder } from "../loadorder/mo2.js";
import { readFileVersion, readFirstBytes } from "./pe.js";
import {
  formatPacked,
  inspectSksePlugin,
  packVersion,
  parseVersionText,
  unpackVersion,
  VI_ADDRESS_LIBRARY_POST_AE,
} from "./skse.js";
import {
  assessPlugin,
  decide,
  describeConfidence,
  V1_7_0,
  type Confidence,
  type PluginAssessment,
  type RuleBasis,
  type Verdict,
} from "./rules.js";

// ─── Patch Day: "is it safe to update?" ──────────────────────────────────────
// A game update changes the executable. Script-extender plugins are tied to the
// executable's layout, so after a patch the script extender refuses some of them
// and the player finds out when the game won't start. Everything needed to see
// that coming is already on disk: the game's version, which SKSE build is
// installed, whether the Address Library file for this version exists, and what
// each plugin DLL declares about itself. This reads those, applies SKSE's own
// rules, and answers before the player launches.
//
// Local and read-only: no network, nothing written, nothing stored. See
// TRUST.md ("Patch Day").

type PatchDayGame = {
  gameId: string;
  name: string;
  exe: string;
  loader: string;
  /** SKSE's DLL is `<dllPrefix>_<major>_<minor>_<build>.dll`, named for the game version. */
  dllPrefix: string;
  logFolder: string;
  logFile: string;
};

const SUPPORTED: PatchDayGame[] = [
  {
    gameId: "skyrimspecialedition",
    name: "Skyrim Special Edition",
    exe: "SkyrimSE.exe",
    loader: "skse64_loader.exe",
    dllPrefix: "skse64",
    logFolder: "Skyrim Special Edition",
    logFile: "skse64.log",
  },
];

export const PATCH_DAY_GAMES: string[] = SUPPORTED.map((g) => g.gameId);

export type PatchDayOptions = {
  /** Default: the first supported game found on this machine. */
  gameId?: string;
  /** Install folder, for a copy ModWrench can't find (GOG, a custom Steam library). */
  gamePath?: string;
  /** A game version to check against instead of the installed one, e.g. "1.7.104". */
  targetVersion?: string;
  /** MO2 instance folder, when it isn't where MO2 normally keeps instances. */
  mo2InstancePath?: string;
  profileName?: string;
  /** skse64.log, when it isn't in Documents/My Games. */
  logPath?: string;
};

export type PluginLine = {
  file: string;
  /** "game" for Data/SKSE/Plugins, "mo2:<mod>" or "mo2:overwrite" for Mod Organizer 2. */
  source: string;
  name?: string;
  status: PluginAssessment["status"];
  binding: PluginAssessment["binding"];
  reason: string;
  basis: RuleBasis;
  skseMessage?: string;
};

export type SteamFacts = {
  buildId?: string;
  targetBuildId?: string;
  updatePending: boolean;
  /** Steam's per-game update setting: "always", "on-launch", "high-priority", or the raw value. */
  autoUpdate?: string;
  lastUpdated?: string;
};

export type LogFacts = {
  found: boolean;
  modified?: string;
  /** Written after the game executable last changed, so it describes this version. */
  fresh: boolean;
  pluginsLoaded: number;
  /** SKSE's own lines about plugins it refused, verbatim. */
  refusals: string[];
  /** Plugins SKSE refused that the file-based check had passed. */
  disagreements: string[];
};

export type PatchDayReport = {
  ok: true;
  verdict: Verdict;
  headline: string;
  reasons: string[];
  /** What the verdict rests on, in a sentence, and what the flagged plugins' reasons rest on. */
  confidence: Confidence;
  game: { id: string; name: string };
  /** The version the verdict is about. */
  checked: { version: string; source: "installed" | "targetVersion"; installed: string };
  steam: SteamFacts | null;
  scriptExtender: {
    loaderPresent: boolean;
    expectedDll: string;
    dllPresent: boolean;
    version: string | null;
    dllsInstalled: string[];
  };
  addressLibrary: {
    expectedFile: string;
    present: boolean;
    /** The file's own format number: 1 (SE), 2 (AE), 5 (reported on Skyrim 1.7.104). */
    format: number | null;
    pluginsNeedingIt: number;
  };
  plugins: {
    total: number;
    ok: number;
    broken: number;
    unclear: number;
    /** Everything that is broken or unclear, with the reason and where it comes from. */
    problems: PluginLine[];
    /** File names of the plugins that passed. */
    passed: string[];
  };
  /** What the NEXT game update is likely to do, from how each plugin ties itself to versions. */
  nextPatch: {
    pinned: Array<{ file: string; supports: string[] }>;
    independent: number;
    legacy: number;
    note: string;
  };
  sources: {
    gameFolderPlugins: number;
    mo2: { used: boolean; reason: string; profile?: string; modsWithPlugins?: number };
  };
  log: LogFacts | null;
  limits: string[];
  nextSteps: string[];
};

export type PatchDayError = {
  ok: false;
  error: string;
  hint?: string;
  supportedGames: string[];
};

export type PatchDayResult = PatchDayReport | PatchDayError;

// ─── Reading the folders ─────────────────────────────────────────────────────

/** Resolve a path under `base` ignoring letter case — Windows tools don't care, Linux filesystems do. */
function resolveCI(base: string, ...parts: string[]): string | null {
  let current = base;
  for (const part of parts) {
    const direct = join(current, part);
    if (pathExists(direct)) {
      current = direct;
      continue;
    }
    let match: string | undefined;
    try {
      match = readdirSync(current).find((n) => n.toLowerCase() === part.toLowerCase());
    } catch {
      return null;
    }
    if (match === undefined) return null;
    current = join(current, match);
  }
  return current;
}

type FileEntry = { file: string; abs: string; source: string; priority: number };

const ADDRESS_LIBRARY_FILE = /^version(?:lib)?-[\d-]+\.bin$/i;

/**
 * The plugin DLLs and Address Library files directly inside a SKSE plugin
 * folder. SKSE scans one level and never recurses, so neither does this.
 */
function listPluginFiles(dir: string, source: string, priority: number): FileEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: FileEntry[] = [];
  for (const file of names) {
    const lower = file.toLowerCase();
    if (!lower.endsWith(".dll") && !ADDRESS_LIBRARY_FILE.test(file)) continue;
    const abs = join(dir, file);
    try {
      if (!statSync(abs).isFile()) continue; // follows symlinks, as Vortex's deploy may use
    } catch {
      continue;
    }
    out.push({ file, abs, source, priority });
  }
  return out;
}

/** Add `files` to the virtual plugin folder; for a repeated name the higher priority wins, as in MO2's VFS. */
function overlay(winners: Map<string, FileEntry>, files: FileEntry[]): void {
  for (const f of files) {
    const key = f.file.toLowerCase();
    const held = winners.get(key);
    if (!held || f.priority >= held.priority) winners.set(key, f);
  }
}

// ─── Steam ───────────────────────────────────────────────────────────────────

/** Steam's per-game update setting as it writes it to appmanifest (community-reported values). */
function autoUpdateName(raw: string): string {
  return raw === "0" ? "always" : raw === "1" ? "on-launch" : raw === "2" ? "high-priority" : raw;
}

export function readSteamFacts(manifestPath: string): SteamFacts | null {
  let state: ReturnType<typeof parseVdf>;
  try {
    state = parseVdf(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
  if (!state) return null;
  const text = (key: string): string | undefined => {
    const v = state[key];
    return typeof v === "string" ? v : undefined;
  };
  const flags = Number(text("StateFlags") ?? 0);
  const buildId = text("buildid");
  const targetBuildId = text("TargetBuildID");
  const updatePending =
    (Number.isFinite(flags) && (flags & 2) !== 0) ||
    (targetBuildId !== undefined &&
      targetBuildId !== "0" &&
      buildId !== undefined &&
      targetBuildId !== buildId);
  const facts: SteamFacts = { updatePending };
  if (buildId !== undefined) facts.buildId = buildId;
  if (targetBuildId !== undefined) facts.targetBuildId = targetBuildId;
  const auto = text("AutoUpdateBehavior");
  if (auto !== undefined) facts.autoUpdate = autoUpdateName(auto);
  const updated = Number(text("LastUpdated"));
  if (Number.isFinite(updated) && updated > 0) {
    facts.lastUpdated = new Date(updated * 1000).toISOString().slice(0, 10);
  }
  return facts;
}

// ─── SKSE's own log ──────────────────────────────────────────────────────────
// skse64.log is rewritten on every launch and records, plugin by plugin, what
// SKSE decided. It is the ground truth the predictions are measured against.

/**
 * SKSE's lines carry file names, sometimes behind a full folder path that can
 * hold a Windows user name (C:\Users\Jane Doe\Games\...\Foo.dll). Folders are
 * dropped and the file name kept. Spaces inside folder names are allowed, since
 * "Program Files" and "Skyrim Special Edition" are exactly where a naive
 * "up to the next space" rule would leave fragments behind.
 */
function scrubPaths(line: string): string {
  return line
    .replace(
      /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*([^\\/:*?"<>|\r\n()]+?\.[A-Za-z0-9]{1,5})(?![A-Za-z0-9])/g,
      "<path>\\$1"
    )
    // A drive path with no file name at its end: drop the rest of the line rather than guess where it stops.
    .replace(/[A-Za-z]:\\.*$/, "<path>")
    .replace(/\/(?:home|Users|mnt|root|media|run)\/[^\s"')]*/g, "<path>");
}

const MAX_LOG_BYTES = 8 * 1024 * 1024;

/** The first `max` bytes of a text file and its modified time; null if unreadable. Never reads the whole of a huge file. */
function readHead(path: string, max: number): { text: string; mtimeMs: number } | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    const length = Math.min(stat.size, max);
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = readSync(fd, buf, got, length - got, got);
      if (n === 0) break;
      got += n;
    }
    return { text: buf.toString("latin1", 0, got), mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

const LOG_REFUSAL =
  /disabled,|reported as incompatible|no version data|does not appear to be an SKSE plugin|LE plugin cannot|fatal error occurred/i;

export function readSkseLog(
  path: string,
  referenceMs: number,
  assessed: Map<string, PluginAssessment>
): LogFacts {
  const head = readHead(path, MAX_LOG_BYTES);
  if (!head) {
    return { found: false, fresh: false, pluginsLoaded: 0, refusals: [], disagreements: [] };
  }
  const modifiedMs = head.mtimeMs;
  const refusals: string[] = [];
  const disagreements: string[] = [];
  let pluginsLoaded = 0;
  for (const rawLine of head.text.split(/\r?\n/)) {
    const raw = rawLine.trim().slice(0, 600);
    if (!/^plugin\s/i.test(raw)) continue;
    if (/loaded correctly/i.test(raw)) {
      pluginsLoaded++;
      continue;
    }
    if (!LOG_REFUSAL.test(raw)) continue;
    const line = scrubPaths(raw).slice(0, 240);
    refusals.push(line);
    const dll = /^plugin\s+(.+?\.dll)\b/i.exec(raw)?.[1];
    const predicted = dll ? assessed.get(basename(dll.replace(/\\/g, "/")).toLowerCase()) : undefined;
    if (predicted?.status === "ok") {
      disagreements.push(`${basename(dll!.replace(/\\/g, "/"))}: SKSE logged "${line}" but the file check passed it`);
    }
  }
  return {
    found: true,
    modified: new Date(modifiedMs).toISOString().slice(0, 16).replace("T", " ") + "Z",
    fresh: modifiedMs >= referenceMs,
    pluginsLoaded,
    refusals: refusals.slice(0, 40),
    disagreements: disagreements.slice(0, 40),
  };
}

function logCandidates(game: PatchDayGame, gameDir: string, appId: string): string[] {
  const out: string[] = [];
  const steamapps = basename(dirname(gameDir)).toLowerCase() === "common" ? dirname(dirname(gameDir)) : null;
  const tail = (docs: string, folder: string): string =>
    join(docs, "My Games", folder, "SKSE", game.logFile);
  if (process.platform === "win32") {
    const home = homedir();
    for (const docs of [join(home, "Documents"), join(home, "OneDrive", "Documents")]) {
      out.push(tail(docs, game.logFolder), tail(docs, `${game.logFolder} GOG`));
    }
  } else if (steamapps) {
    // Proton keeps Documents inside the game's own Wine prefix, under the user "steamuser".
    const docs = join(steamapps, "compatdata", appId, "pfx", "drive_c", "users", "steamuser", "Documents");
    out.push(tail(docs, game.logFolder));
  }
  return out;
}

// ─── The check ───────────────────────────────────────────────────────────────

function fail(error: string, hint?: string): PatchDayError {
  return { ok: false, error, ...(hint ? { hint } : {}), supportedGames: PATCH_DAY_GAMES };
}

/**
 * What the check looked at, for callers inside this package that need more than the
 * public report carries: the report names files but never folders. Not returned by
 * `mw_patch_day`, never serialised.
 */
export type PatchDayInstall = {
  gameDir: string;
  /** Steam's app id for the game. */
  appId: string;
  /** The Steam library's steamapps folder, when the game sits in one. */
  steamappsDir: string | null;
  /** Every plugin DLL and Address Library file SKSE would see, after overlaying Mod Organizer 2 over the game folder. Keys are lower-case file names. */
  files: ReadonlyMap<string, { file: string; abs: string; source: string }>;
};

export function checkPatchDay(options: PatchDayOptions = {}): PatchDayResult {
  return runPatchDay(options);
}

/** The same check, plus where it looked. A failed check has no install. */
export function inspectPatchDay(options: PatchDayOptions = {}): { result: PatchDayResult; install: PatchDayInstall | null } {
  let install: PatchDayInstall | null = null;
  const result = runPatchDay(options, (found) => {
    install = found;
  });
  return { result, install };
}

function runPatchDay(options: PatchDayOptions, found?: (install: PatchDayInstall) => void): PatchDayResult {
  const gameId = options.gameId ?? PATCH_DAY_GAMES[0]!;
  const game = SUPPORTED.find((g) => g.gameId === gameId);
  const def: GameDef | undefined = findGameById(gameId);
  if (!game || !def) {
    return fail(
      `Patch Day can't check "${gameId}" yet.`,
      "It reads Skyrim Special Edition / Anniversary Edition and SKSE today. Fallout 4 (F4SE) is next."
    );
  }

  let targetPacked: number | null = null;
  if (options.targetVersion !== undefined) {
    targetPacked = parseVersionText(options.targetVersion);
    if (targetPacked === null) {
      return fail(
        `"${options.targetVersion}" isn't a game version.`,
        'Give it like 1.7.104 — the number Steam or the SKSE site shows for the new patch.'
      );
    }
  }

  // Where the game is.
  const steamRoot = findSteamRoot();
  const libraries = steamRoot ? findSteamLibraries(steamRoot) : [];
  let gameDir: string;
  if (options.gamePath) {
    gameDir = resolve(options.gamePath);
  } else {
    const app = findInstalledApp(libraries, def.steamAppId);
    if (!app) {
      return fail(
        `Couldn't find ${game.name} in any Steam library.`,
        "If it's a GOG copy or sits somewhere unusual, pass gamePath (the folder that holds " + game.exe + ")."
      );
    }
    gameDir = app.installDir;
  }
  const exePath = join(gameDir, game.exe);
  if (!pathExists(exePath)) {
    return fail(`${game.exe} isn't in that folder.`, "gamePath should be the folder that holds " + game.exe + ".");
  }
  const installedVersion = readFileVersion(exePath);
  if (!installedVersion) {
    return fail(`Couldn't read the game's version out of ${game.exe}.`);
  }
  const installedPacked = packVersion(...installedVersion);
  const installedText = formatPacked(installedPacked);
  const runtime = targetPacked ?? installedPacked;
  const runtimeText = formatPacked(runtime);
  const whatIf = targetPacked !== null && targetPacked !== installedPacked;

  // Steam's view: has an update landed or is one waiting?
  const steamapps = basename(dirname(gameDir)).toLowerCase() === "common" ? dirname(dirname(gameDir)) : null;
  const manifest = steamapps ? join(steamapps, `appmanifest_${def.steamAppId}.acf`) : null;
  const steam = manifest && pathExists(manifest) ? readSteamFacts(manifest) : null;

  // The script extender: its loader, and the DLL named for this game version.
  const [major, minor, build] = unpackVersion(runtime);
  const expectedDll = `${game.dllPrefix}_${major}_${minor}_${build}.dll`;
  let gameFiles: string[] = [];
  try {
    gameFiles = readdirSync(gameDir);
  } catch {
    // Unreadable folder: treated as empty, and the verdict will say SKSE isn't there.
  }
  const lowerFiles = new Set(gameFiles.map((f) => f.toLowerCase()));
  const dllsInstalled = gameFiles.filter((f) => new RegExp(`^${game.dllPrefix}_\\d+_\\d+_\\d+\\.dll$`, "i").test(f)).sort();
  const loaderPresent = lowerFiles.has(game.loader.toLowerCase());
  const dllPresent = lowerFiles.has(expectedDll.toLowerCase());
  const skseInstalled = loaderPresent || dllsInstalled.length > 0;
  let skseVersion: number | undefined;
  if (dllPresent) {
    const v = readFileVersion(join(gameDir, gameFiles.find((f) => f.toLowerCase() === expectedDll.toLowerCase())!));
    if (v && v[0] > 0) skseVersion = packVersion(v[0], v[1], v[2]);
  }

  // Every place SKSE would find plugins, overlaid the way Mod Organizer 2 overlays them.
  const winners = new Map<string, FileEntry>();
  const gamePlugins = resolveCI(gameDir, "Data", "SKSE", "Plugins");
  const gameFolderFiles = gamePlugins ? listPluginFiles(gamePlugins, "game", 0) : [];
  overlay(winners, gameFolderFiles);

  const managers = detectInstalledManagers(libraries);
  const wantsMo2 = options.mo2InstancePath !== undefined || inferManagerForGame(def, managers) === "mo2";
  const mo2: PatchDayReport["sources"]["mo2"] = { used: false, reason: "no Mod Organizer 2 instance for this game was found" };
  if (wantsMo2) {
    const instance = findMo2InstanceForGame(def, options.mo2InstancePath);
    const order = instance
      ? readMo2LoadOrder(def, {
          ...(options.mo2InstancePath !== undefined ? { instancePath: options.mo2InstancePath } : {}),
          ...(options.profileName !== undefined ? { profileName: options.profileName } : {}),
        })
      : null;
    if (instance && order) {
      const mods = resolveCI(instance, "mods");
      let withPlugins = 0;
      for (const folder of order.modFolders ?? []) {
        if (!folder.enabled || !mods) continue;
        const dir = resolveCI(mods, folder.name, "SKSE", "Plugins");
        const files = dir ? listPluginFiles(dir, `mo2:${folder.name}`, 1 + folder.modlistIndex) : [];
        if (files.length > 0) withPlugins++;
        overlay(winners, files);
      }
      const overwrite = resolveCI(instance, "overwrite", "SKSE", "Plugins");
      if (overwrite) overlay(winners, listPluginFiles(overwrite, "mo2:overwrite", Number.MAX_SAFE_INTEGER));
      mo2.used = true;
      mo2.reason = "Mod Organizer 2's enabled mods and overwrite folder were read, since MO2 is what loads plugins for this game";
      mo2.profile = order.profile;
      mo2.modsWithPlugins = withPlugins;
    } else if (instance) {
      mo2.reason = "found a Mod Organizer 2 instance but not the profile to read from it (profileName may be wrong)";
    }
  } else {
    mo2.reason = "Mod Organizer 2 doesn't look like the active manager for this game";
  }

  // The Address Library file for this game version.
  const alName =
    runtime < packVersion(1, 6, 0)
      ? `version-${major}-${minor}-${build}-0.bin`
      : `versionlib-${major}-${minor}-${build}-0.bin`;
  const alEntry = winners.get(alName.toLowerCase());
  let alFormat: number | undefined;
  if (alEntry) {
    const head = readFirstBytes(alEntry.abs, 4);
    if (head) alFormat = head.readUInt32LE(0);
  }

  // Judge every plugin.
  const ctx = {
    runtime,
    ...(skseVersion !== undefined ? { skseVersion } : {}),
    addressLibrary: { present: alEntry !== undefined, ...(alFormat !== undefined ? { format: alFormat } : {}) },
  };
  const lines: PluginLine[] = [];
  const assessed = new Map<string, PluginAssessment>();
  let pluginsNeedingAddressLibrary = 0;
  const pinned: Array<{ file: string; supports: string[] }> = [];
  let independent = 0;
  let legacy = 0;
  for (const entry of [...winners.values()].sort((a, b) => a.file.localeCompare(b.file))) {
    if (!entry.file.toLowerCase().endsWith(".dll")) continue;
    const info = inspectSksePlugin(entry.abs);
    const verdict = assessPlugin(info, ctx);
    assessed.set(entry.file.toLowerCase(), verdict);
    if (info.versionData && info.versionData.versionIndependence & VI_ADDRESS_LIBRARY_POST_AE) {
      pluginsNeedingAddressLibrary++;
    }
    if (verdict.binding === "independent") independent++;
    else if (verdict.binding === "legacy") legacy++;
    else if (verdict.binding === "pinned") {
      pinned.push({ file: entry.file, supports: (info.versionData?.compatibleVersions ?? []).map(formatPacked) });
    }
    const line: PluginLine = {
      file: entry.file,
      source: entry.source,
      status: verdict.status,
      binding: verdict.binding,
      reason: verdict.reason,
      basis: verdict.basis,
    };
    if (info.versionData?.name) line.name = info.versionData.name;
    if (verdict.skseMessage) line.skseMessage = verdict.skseMessage;
    lines.push(line);
  }
  const counts = {
    total: lines.length,
    ok: lines.filter((l) => l.status === "ok").length,
    broken: lines.filter((l) => l.status === "broken").length,
    unclear: lines.filter((l) => l.status === "unclear").length,
  };

  // SKSE's own log, when it describes the version in question.
  const logPath =
    options.logPath ??
    logCandidates(game, gameDir, def.steamAppId).find((p) => pathExists(p));
  let exeMtime = 0;
  try {
    exeMtime = statSync(exePath).mtimeMs;
  } catch {
    // The version was readable a moment ago; a stat failure just leaves the log "not fresh".
  }
  const log = logPath ? readSkseLog(logPath, exeMtime, assessed) : null;
  const logUsable = log && log.found && !whatIf;

  const decision = decide({
    gameName: game.name,
    version: runtimeText,
    whatIf,
    skse: { installed: skseInstalled, loader: game.loader, dll: expectedDll, dllPresent },
    addressLibrary: { file: alName, present: alEntry !== undefined, pluginsNeedingIt: pluginsNeedingAddressLibrary },
    counts,
    beyondSource: runtime >= V1_7_0,
    steamUpdatePending: !whatIf && steam?.updatePending === true,
    log: logUsable ? { fresh: log.fresh, refusals: log.refusals.length, disagreements: log.disagreements.length } : null,
  });

  const rank = { broken: 0, unclear: 1, ok: 2 } as const;
  const problems = lines
    .filter((l) => l.status !== "ok")
    .sort((a, b) => rank[a.status] - rank[b.status] || a.file.localeCompare(b.file));

  found?.({ gameDir, appId: def.steamAppId, steamappsDir: steamapps, files: winners });

  return {
    ok: true,
    verdict: decision.verdict,
    headline: decision.headline,
    reasons: decision.reasons,
    confidence: describeConfidence({
      whatIf,
      version: runtimeText,
      beyondSource: runtime >= V1_7_0,
      log: logUsable
        ? { fresh: log.fresh, loaded: log.pluginsLoaded, refusals: log.refusals.length, disagreements: log.disagreements.length }
        : null,
      flagged: problems.map((p) => p.basis),
    }),
    game: { id: game.gameId, name: game.name },
    checked: { version: runtimeText, source: whatIf ? "targetVersion" : "installed", installed: installedText },
    steam,
    scriptExtender: {
      loaderPresent,
      expectedDll,
      dllPresent,
      version: skseVersion !== undefined ? formatPacked(skseVersion).replace(/\.0$/, "") : null,
      dllsInstalled,
    },
    addressLibrary: {
      expectedFile: alName,
      present: alEntry !== undefined,
      format: alFormat ?? null,
      pluginsNeedingIt: pluginsNeedingAddressLibrary,
    },
    plugins: {
      ...counts,
      problems,
      passed: lines.filter((l) => l.status === "ok").map((l) => l.file),
    },
    nextPatch: {
      pinned,
      independent,
      legacy,
      note:
        "Pinned plugins list exact game versions, so SKSE will refuse them on the next game update until their authors rebuild them. " +
        "Independent plugins pass SKSE's version check on any later version, but can still break if the game code they hook changes.",
    },
    sources: { gameFolderPlugins: gameFolderFiles.filter((f) => f.file.toLowerCase().endsWith(".dll")).length, mo2 },
    log,
    limits: limitsFor(runtime >= V1_7_0),
    nextSteps: nextStepsFor({ game, runtimeText, whatIf, skseInstalled, dllPresent, expectedDll, alName, alPresent: alEntry !== undefined, pluginsNeedingAddressLibrary, counts, steam, log: logUsable ? log : null }),
  };
}

function limitsFor(beyondSource: boolean): string[] {
  const limits = [
    "Read-only and local: it opens file headers and a few small files, writes nothing, sends nothing and keeps nothing. File names and mod folder names appear in the result; folder paths do not.",
    "A result marked basis \"skse-source\" comes from SKSE's published source (the 2.2.6 build, for Skyrim 1.6.1170) and carries SKSE's own log text. Later SKSE builds can add rules.",
    "A plugin that passes SKSE's version check can still crash or misbehave if the game code it hooks has changed. That can't be seen from files.",
  ];
  if (beyondSource) {
    limits.push(
      "SKSE 2.3.x, which supports Skyrim 1.7.x, is not open source. These results apply the 2.2.6 rules plus the Address Library format-5 behaviour seen in public bug reports; SKSE's own log from a launch is the real answer."
    );
  }
  return limits;
}

function nextStepsFor(a: {
  game: PatchDayGame;
  runtimeText: string;
  whatIf: boolean;
  skseInstalled: boolean;
  dllPresent: boolean;
  expectedDll: string;
  alName: string;
  alPresent: boolean;
  pluginsNeedingAddressLibrary: number;
  counts: { broken: number; unclear: number };
  steam: SteamFacts | null;
  log: LogFacts | null;
}): string[] {
  const steps: string[] = [];
  if (a.skseInstalled && !a.dllPresent) {
    steps.push(
      `Get the SKSE build made for ${a.runtimeText} from skse.silverlock.org and install it as you did before; it adds ${a.expectedDll}. The loader chooses its DLL by game version, so it can sit next to the old one.`
    );
  }
  if (a.pluginsNeedingAddressLibrary > 0 && !a.alPresent) {
    steps.push(`Install the Address Library for SKSE Plugins build for ${a.runtimeText} (it adds ${a.alName}).`);
  }
  if (a.counts.broken > 0) {
    steps.push("For each broken plugin, check its mod page for a build made for this game version. Until there is one, that mod won't work — disabling it is safer than leaving a refused plugin in place.");
  }
  if (!a.whatIf && a.steam?.updatePending) {
    steps.push(
      "Steam has an update waiting. If you aren't ready, game Properties → Updates lets you set it to update only when you launch. ModWrench never changes Steam settings. Once you know the new version number, run this again with targetVersion to see what it would do."
    );
  }
  if (!a.whatIf && (!a.log || !a.log.found || !a.log.fresh)) {
    steps.push("Launch the game once through SKSE, close it, and run this again — SKSE's own log from that launch is the strongest evidence there is.");
  }
  return steps;
}
