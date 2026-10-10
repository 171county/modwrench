import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { documentsRoots } from "../crashwhisper/find.js";
import { pathExists } from "../detect/os.js";
import { findGameById, type GameDef } from "../detect/games.js";
import {
  findInstalledApp,
  findSteamLibraries,
  findSteamRoot,
} from "../detect/steam.js";
import { detectInstalledManagers, inferManagerForGame } from "../detect/manager.js";
import { parseVdf } from "../detect/vdf.js";
import { findMo2InstanceForGame, mo2Folder, readMo2LoadOrder } from "../loadorder/mo2.js";
import { isNetworkPath } from "../localpath.js";
import { inspectF4sePlugin } from "./f4se.js";
import { assessF4sePlugin, F4_1_10_980, f4seSourceFor, needsF4seAddressLibrary } from "./f4se-rules.js";
import { readFileVersion, readFirstBytes, type FileVersion } from "./pe.js";
import {
  formatPacked,
  inspectSksePlugin,
  packVersion,
  parseVersionText,
  unpackVersion,
  VI_ADDRESS_LIBRARY_POST_AE,
} from "./skse.js";
import { clean } from "./summary.js";
import {
  assessPlugin,
  decide,
  describeConfidence,
  skseSourceFor,
  type Confidence,
  type PluginAssessment,
  type RuleBasis,
  type RuntimeContext,
  type Verdict,
} from "./rules.js";

// ─── Patch Day: "is it safe to update?" ──────────────────────────────────────
// A game update changes the executable. Script-extender plugins are tied to the
// executable's layout, so after a patch the script extender refuses some of them
// and the player finds out when the game won't start. Everything needed to see
// that coming is already on disk: the game's version, which script extender
// build is installed, whether the Address Library file for this version exists,
// and what each plugin DLL declares about itself. This reads those, applies the
// script extender's own rules (SKSE's for Skyrim Special Edition, F4SE's for
// Fallout 4), and answers before the player launches.
//
// Local and read-only: no network, nothing written, nothing stored. See
// TRUST.md ("Patch Day").

/** The version data a plugin declares, as far as the script extender's log prints it. */
type Declared = { dataVersion: number; name: string; pluginVersion: number };

/** One plugin DLL, read and judged. */
type Checked = {
  assessment: PluginAssessment;
  declared?: Declared;
  /** The script extender looks for the Address Library file for this plugin. */
  needsAddressLibrary: boolean;
  /** The game versions it lists, packed. */
  compatibleVersions: number[];
};

/** How a script extender's log words what it did with a plugin. */
type LogDialect = {
  /** The script extender, for the words of a disagreement. */
  name: string;
  /** Every status it writes for a plugin it didn't load. */
  refusals: readonly string[];
  /** How older builds name a plugin by its full path, up to and including the plugin folder. A file name can't start with a drive. */
  pluginFolder: RegExp;
  /** What it writes after a DLL that exports nothing it looks for. */
  skippedTail: string;
  /** Builds of it that write no "(handle N)" after a status. */
  handleOptional: boolean;
  /** A failed load can carry more after its error number: "(Error 126: failed to load x.dll)", which F4SE adds for a missing dependency. */
  errorSuffix: boolean;
};

/** What differs between the script extenders Patch Day reads. */
type Extender = {
  name: "SKSE" | "F4SE";
  /** Where its builds are published. */
  site: string;
  /** The Address Library mod for it. */
  addressLibrary: string;
  /** Data\<folder>\Plugins holds its plugins, and My Games\<game>\<folder> its log. */
  folder: string;
  /** The basis of a rule from its published source. */
  sourceBasis: RuleBasis;
  check(path: string, ctx: RuntimeContext): Checked;
  sourceFor(runtime: number): { build: string; covered: boolean };
  /** The Address Library file a game version needs. */
  addressLibraryFile(major: number, minor: number, build: number): string;
  /** The file starts with a format number worth reporting (Skyrim's does; Fallout 4's starts with a count). */
  addressLibraryFormat: boolean;
  /** Its own version, from the FILEVERSION stamped on its DLL and loader; undefined when the file isn't its. */
  stamp(v: FileVersion): number | undefined;
  dialect: LogDialect;
  /** The build that asks each plugin's own code instead of reading version data, and the export it calls. */
  queryBuild: string;
  queryExport: string;
  nextPatchNote: string;
  /** Copies of the game it refuses, by a file only that store puts in the game folder, and its own words. */
  unsupported: ReadonlyArray<{ file: string; words: string }>;
  /** GOG copies need a DLL with this suffix, or none. F4SE's applies from game 1.10.980 on (F4SE 0.7.0). */
  gogSuffix: string;
};

type PatchDayGame = {
  gameId: string;
  name: string;
  exe: string;
  loader: string;
  /** The game's own launcher, which Steam's Play button starts: on the Steam Deck the loader is often renamed to it. */
  launcher: string;
  /** The script extender's DLL is `<dllPrefix>_<major>_<minor>_<build>.dll`, named for the game version. */
  dllPrefix: string;
  logFolder: string;
  logFile: string;
  extender: Extender;
  /** A game version to show in a hint. */
  example: string;
};

export type PatchDayOptions = {
  /**
   * Default: the game whose executable is in gamePath, or else the first supported game installed in a Steam
   * library (Skyrim Special Edition before Fallout 4); the answer then names any other one it found there.
   */
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
  /** SKSE's refusals, one per log line: the plugin's file name and SKSE's own status text. */
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
    /** Which script extender: SKSE for Skyrim Special Edition, F4SE for Fallout 4. */
    name: "SKSE" | "F4SE";
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
    mo2: {
      used: boolean;
      reason: string;
      /** Mod Organizer 2 loads plugins here (or was named), but what it holds couldn't be read, so its plugins weren't checked. */
      unread?: boolean;
      profile?: string;
      modsWithPlugins?: number;
    };
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

/**
 * Resolve a path under `base` ignoring letter case — Windows tools don't care, Linux filesystems do.
 * Null for a step that lands on another computer: a mods folder ModOrganizer.ini puts there, or a mod
 * named "..\..\UNC\host\share" under a \\?\C:\ folder.
 */
function resolveCI(base: string, ...parts: string[]): string | null {
  let current = base;
  for (const part of parts) {
    const direct = join(current, part);
    if (isNetworkPath(direct)) return null;
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
 * File, mod folder, profile and declared plugin names are other people's words, and the structured report
 * reaches the model in some clients. They go in flattened to one line with nothing invisible left, as the
 * text does, and cut only past the 255 characters a file name (or SKSE's name field) can hold, so a real
 * name comes through whole.
 */
const NAME_MAX = 260;

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
//
// SKSE's own format strings (PluginManager.cpp, ianpatt/skse64):
//   2.2.x, 2.3.x  "plugin %s (%08X %s %08X) %s (handle %d)"     "loaded correctly"
//                 "plugin %s (%08X %s %08X) %s %d (handle %d)"  anything else, with an error code
//                 "loading plugin \"%s\""                       the declared name alone, before loading it
//                                                               (2.2.8 on: "%sloading", "pre" while preloading)
//   2.0.20        "plugin %s (%08X %s %08X) %s (handle %d)"     the first %s a full path
//                 "plugin %s does not appear to be an SKSE plugin"
//                 "couldn't load plugin %s (Error %d)"
// The first %s is the DLL's file name and the second the name the plugin gives
// itself. Both are whatever the plugin's author chose, line breaks included, so
// neither is trusted: the plugin is the longest file name actually on disk that
// the line names, and its status is read only from the fixed tail SKSE writes
// last. Where the plugin's declared name is known, all of it, every line, is
// taken as part of that plugin's entry, so a name can't write lines of its own;
// a loading line, which has no file name, is taken whole by the longest declared
// name that fits it. Not covered: on 2.0.20 the name comes from the plugin's own
// code (SKSEPlugin_Query), and a plugin whose code runs can write anything here.
// What is kept is the file name and SKSE's status text, never the declared name,
// and never a folder: SKSE 2.0.20's paths can hold a Windows user name.

/** Every status SKSE 2.0.20, 2.2.6 to 2.2.8, 2.3.0 and 2.3.1 write for a plugin they didn't load. */
const SKSE_REFUSALS = [
  "disabled, bad version data",
  "disabled, no name specified",
  "disabled, unsupported version independence method",
  "disabled, address library needs to be updated",
  "must be recompiled for new address library",
  "disabled, only compatible with versions earlier than 1.6.629",
  "disabled, incompatible with current version of the game",
  "disabled, requires newer script extender",
  "disabled, fatal error occurred while checking plugin compatibility",
  "no version data",
  "LE plugin cannot be used with SE",
  "couldn't load plugin",
  "does not appear to be an SKSE plugin",
  "reported as incompatible during load",
  "disabled, fatal error occurred while loading plugin",
  "crashed during postload",
  "reported as incompatible during query",
  "disabled, fatal error occurred while querying plugin",
  "broken version check, will crash the game",
];
const LOADED = "loaded correctly";
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What the script extender writes after the version block: the status, an error code (except after a load), and the
 * handle (`status`); and the same read from the end of a whole line, when the version block can't be matched exactly (`line`).
 */
function tails(d: LogDialect): { status: RegExp; line: RegExp; failed: RegExp; skipped: RegExp } {
  const status = [LOADED, ...d.refusals].map(escapeRe).join("|");
  const handle = d.handleOptional ? "(?: \\(handle -?\\d+\\))?" : " \\(handle -?\\d+\\)";
  return {
    status: new RegExp(`^(${status})(?: (-?\\d+))?${handle}$`),
    line: new RegExp(` [0-9A-F]{8}\\) (${status})(?: (-?\\d+))?${handle}$`),
    // What follows the number can hold brackets of its own ("failed to load Helper (x64).dll"): the line's last one closes it.
    failed: d.errorSuffix ? / \(Error (-?\d+)(?:: .*)?\)$/ : / \(Error (-?\d+)\)$/,
    skipped: new RegExp(` \\(|${escapeRe(d.skippedTail)}$`),
  };
}
/** SKSE 2.0.20 names a plugin by its full path, <game folder>\Data\SKSE\Plugins\<file>. A file name can't start with a drive. */
const PLUGIN_FOLDER = /^(?:[A-Za-z]:|\\\\).*?\\Data\\SKSE\\Plugins\\/i;
const SKIPPED_TAIL = " does not appear to be an SKSE plugin";

/** Every status F4SE 0.6.23 and 0.7.0 to 0.7.9 write for a plugin they didn't load (PluginManager.cpp, ianpatt/f4se). */
const F4SE_REFUSALS = [
  "disabled, bad version data",
  "disabled, no name specified",
  "disabled, address library needs to be updated",
  "disabled, incompatible with current version of the game",
  "disabled, requires newer script extender",
  "disabled, fatal error occurred while checking plugin compatibility",
  "no version data",
  "32-bit plugins can never work",
  "couldn't load plugin",
  "does not appear to be an F4SE plugin",
  "reported as incompatible during query",
  "reported as incompatible during load",
  "disabled, fatal error occurred while loading plugin",
];

const SKSE_DIALECT: LogDialect = { name: "SKSE", refusals: SKSE_REFUSALS, pluginFolder: PLUGIN_FOLDER, skippedTail: SKIPPED_TAIL, handleOptional: false, errorSuffix: false };
// F4SE 0.6.23 names a plugin by its full path and writes no handle; 0.7.x writes the file name and a handle, as SKSE does.
const F4SE_DIALECT: LogDialect = {
  name: "F4SE",
  refusals: F4SE_REFUSALS,
  pluginFolder: /^(?:[A-Za-z]:|\\\\).*?\\Data\\F4SE\\Plugins\\/i,
  skippedTail: " does not appear to be an F4SE plugin",
  handleOptional: true,
  errorSuffix: true,
};

const SKSE: Extender = {
  name: "SKSE",
  site: "skse.silverlock.org",
  addressLibrary: "Address Library for SKSE Plugins",
  folder: "SKSE",
  sourceBasis: "skse-source",
  check(path, ctx) {
    const info = inspectSksePlugin(path);
    const v = info.versionData;
    return {
      assessment: assessPlugin(info, ctx),
      ...(v ? { declared: v } : {}),
      needsAddressLibrary: v !== undefined && (v.versionIndependence & VI_ADDRESS_LIBRARY_POST_AE) !== 0,
      compatibleVersions: v?.compatibleVersions ?? [],
    };
  },
  sourceFor: skseSourceFor,
  addressLibraryFile: (major, minor, build) =>
    packVersion(major, minor, build) < packVersion(1, 6, 0) ? `version-${major}-${minor}-${build}-0.bin` : `versionlib-${major}-${minor}-${build}-0.bin`,
  addressLibraryFormat: true,
  // SKSE stamps its DLL and its loader FILEVERSION 0,major,minor,beta (skse64_common/skse_version.rc), so 2.2.6 reads as 0.2.2.6.
  stamp: (v) => (v[0] === 0 && v[1] > 0 ? packVersion(v[1], v[2], v[3]) : undefined),
  dialect: SKSE_DIALECT,
  queryBuild: "2.0.20",
  queryExport: "SKSEPlugin_Query",
  nextPatchNote:
    "Pinned plugins list exact game versions, so SKSE will refuse them on the next game update until their authors rebuild them. " +
    "That includes Address Library plugins built for the format used before 1.7.99: SKSE 2.3.1 accepts them only on game versions they list. " +
    "Independent plugins pass SKSE's version check on any later version, but can still break if the game code they hook changes.",
  unsupported: [],
  gogSuffix: "",
};

const F4SE: Extender = {
  name: "F4SE",
  site: "f4se.silverlock.org",
  addressLibrary: "Address Library for F4SE Plugins",
  folder: "F4SE",
  sourceBasis: "f4se-source",
  check(path, ctx) {
    const info = inspectF4sePlugin(path);
    const v = info.versionData;
    return {
      assessment: assessF4sePlugin(info, ctx),
      ...(v ? { declared: v } : {}),
      needsAddressLibrary: needsF4seAddressLibrary(info, ctx.runtime),
      compatibleVersions: v?.compatibleVersions ?? [],
    };
  },
  sourceFor: f4seSourceFor,
  // F4SE's CheckAddressLibrary looks for Data\F4SE\Plugins\version-<major>-<minor>-<build>-0.bin.
  addressLibraryFile: (major, minor, build) => `version-${major}-${minor}-${build}-0.bin`,
  addressLibraryFormat: false,
  // F4SE stamps FILEVERSION 0,major,minor,beta too (f4se_common/f4se_version.rc), and its major is 0: 0.7.9 reads as 0.0.7.9.
  stamp: (v) => (v[0] === 0 && (v[1] > 0 || v[2] > 0) ? packVersion(v[1], v[2], v[3]) : undefined),
  dialect: F4SE_DIALECT,
  queryBuild: "0.6.23",
  queryExport: "F4SEPlugin_Query",
  nextPatchNote:
    "Pinned plugins list exact game versions, so F4SE will refuse them on the next game update until their authors rebuild them. " +
    "That includes plugins that declare only the 1.10.980 Address Library or game layout: from F4SE 0.7.5 (game 1.11.159) on, F4SE accepts them only on game versions they list. " +
    "Independent plugins pass F4SE's version check on any later version, but can still break if the game code they hook changes.",
  // F4SE's loader refuses these copies (f4se_loader/main.cpp, f4se_loader_common/IdentifyEXE.cpp).
  unsupported: [
    { file: "appxmanifest.xml", words: "F4SE doesn't support the Microsoft Store (Game Pass) version of Fallout 4: its loader refuses it" },
    { file: "EOSSDK-Win64-Shipping.dll", words: "F4SE doesn't support the Epic Games Store version of Fallout 4: its loader refuses it" },
  ],
  gogSuffix: "_gog",
};

const SUPPORTED: PatchDayGame[] = [
  {
    gameId: "skyrimspecialedition",
    name: "Skyrim Special Edition",
    exe: "SkyrimSE.exe",
    loader: "skse64_loader.exe",
    launcher: "SkyrimSELauncher.exe",
    dllPrefix: "skse64",
    logFolder: "Skyrim Special Edition",
    logFile: "skse64.log",
    extender: SKSE,
    example: "1.7.104",
  },
  {
    gameId: "fallout4",
    name: "Fallout 4",
    exe: "Fallout4.exe",
    loader: "f4se_loader.exe",
    launcher: "Fallout4Launcher.exe",
    dllPrefix: "f4se",
    logFolder: "Fallout4",
    logFile: "f4se.log",
    extender: F4SE,
    example: "1.11.240",
  },
];

export const PATCH_DAY_GAMES: string[] = SUPPORTED.map((g) => g.gameId);

/** Every game and executable Patch Day reads, in words: "Skyrim Special Edition or Fallout 4". */
const ANY_GAME = SUPPORTED.map((g) => g.name).join(" or ");
const ANY_EXE = SUPPORTED.map((g) => g.exe).join(" or ");

const hex8 = (n: number): string => n.toString(16).toUpperCase().padStart(8, "0");

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

/**
 * What the script extender's log says about the plugins: skse64.log by default, or f4se.log with F4SE's `dialect`.
 * `assessed` holds the file check's judgement of every plugin DLL on disk, and `declared` the version data each one
 * declares, both keyed by lower-case file name.
 */
export function readSkseLog(
  path: string,
  referenceMs: number,
  assessed: Map<string, PluginAssessment>,
  declared: ReadonlyMap<string, Declared> = new Map(),
  dialect: LogDialect = SKSE_DIALECT
): LogFacts {
  const t = tails(dialect);
  const head = readHead(path, MAX_LOG_BYTES);
  if (!head) {
    return { found: false, fresh: false, pluginsLoaded: 0, refusals: [], disagreements: [] };
  }
  const modifiedMs = head.mtimeMs;
  const refusals: string[] = [];
  const disagreements: string[] = [];
  let pluginsLoaded = 0;
  // Longest first, so "SkyUI.dll - patch.dll" is never taken for "SkyUI.dll".
  const onDisk = [...assessed.keys()].sort((a, b) => b.length - a.length);
  // The same for declared names, so of two names that fit a loading line, the one that spans more lines takes them.
  const names = [...declared.values()].map((d) => d.name.slice(0, 255).replace(/\r/g, "")).sort((a, b) => b.length - a.length);
  const lines = head.text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trimStart();
    const loading = /^(?:pre)?loading plugin "/i.exec(raw);
    if (loading) {
      const said = raw.slice(loading[0].length);
      for (const name of names) {
        const spans = name.split("\n").length - 1;
        if ([said, ...lines.slice(i + 1, i + 1 + spans)].join("\n").trimEnd() !== `${name}"`) continue;
        i += spans;
        break;
      }
      continue;
    }
    const lead = /^(?:couldn't load plugin|plugin) /i.exec(raw);
    if (!lead) continue;
    const rest = raw.slice(lead[0].length).replace(dialect.pluginFolder, "");
    const lower = rest.toLowerCase();
    const key = onDisk.find(
      (k) => lower.startsWith(k) && (lower.startsWith(" (", k.length) || lower.slice(k.length) === dialect.skippedTail.toLowerCase())
    );
    const after = key !== undefined ? rest.slice(key.length) : "";

    let status: string | undefined;
    let code: string | undefined;
    let exact = false;
    if (key !== undefined) {
      // The version block exactly as SKSE prints it for this file: from its version data, or zeros when SKSE hadn't read any.
      const blocks = [" (00000000  00000000) "];
      const data = declared.get(key);
      if (data) blocks.unshift(` (${hex8(data.dataVersion)} ${data.name.slice(0, 255).replace(/\r/g, "")} ${hex8(data.pluginVersion)}) `);
      for (const block of blocks) {
        const spans = block.split("\n").length - 1;
        const joined = [after, ...lines.slice(i + 1, i + 1 + spans)].join("\n");
        if (!joined.startsWith(block)) continue;
        exact = true;
        i += spans;
        const m = t.status.exec(joined.slice(block.length).trimEnd());
        if (m) [, status, code] = m;
        break;
      }
    }
    if (!exact) {
      const tail = t.line.exec(raw.trimEnd());
      const failed = /^couldn't load plugin /i.test(raw) ? t.failed.exec(rest) : null;
      if (tail) [, status, code] = tail;
      else if (failed) [status, code] = ["couldn't load plugin", failed[1]];
      else if (rest.endsWith(dialect.skippedTail)) status = dialect.skippedTail.trim();
    }
    if (status === undefined) continue;
    if (status === LOADED) {
      pluginsLoaded++;
      continue;
    }
    const predicted = key !== undefined ? assessed.get(key) : undefined;
    // SKSE writes one of these for a DLL that exports nothing it looks for, and doesn't count it as an error.
    if ((status === "no version data" || status === dialect.skippedTail.trim()) && predicted?.status === "ok" && predicted.binding === "none") {
      continue;
    }
    const guess = rest.slice(0, Math.max(0, rest.search(t.skipped))) || rest;
    const file = clean(key !== undefined ? rest.slice(0, key.length) : guess.split(/[\\/]/).pop()!, 120);
    const said = code !== undefined && code !== "0" ? ` (error ${code})` : "";
    refusals.push(clean(`${file}: ${status}${said}`, 240));
    if (predicted?.status === "ok") {
      disagreements.push(clean(`${file}: ${dialect.name} logged "${status}"${said} but the file check passed it`, 320));
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
    join(docs, "My Games", folder, game.extender.folder, game.logFile);
  if (process.platform === "win32") {
    // Documents in the user's folder, and wherever OneDrive's Known Folder Move put it, as the crash log finder reads them.
    for (const docs of documentsRoots(null, appId)) {
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
  // Which game: the one asked for; else the one whose executable is in gamePath; else the first one installed in a
  // Steam library, and the answer then names any other one it found there.
  const asked = options.gameId;
  let chosen: PatchDayGame | undefined;
  if (asked !== undefined) {
    chosen = SUPPORTED.find((g) => g.gameId === asked && findGameById(g.gameId) !== undefined);
    if (!chosen) {
      return fail(
        `Patch Day can't check "${asked}" yet.`,
        "It reads Skyrim Special Edition and Anniversary Edition with SKSE, and Fallout 4 with F4SE."
      );
    }
  } else if (options.gamePath) {
    const dir = resolve(options.gamePath);
    chosen = SUPPORTED.find((g) => pathExists(join(dir, g.exe)));
  }

  let targetPacked: number | null = null;
  if (options.targetVersion !== undefined) {
    targetPacked = parseVersionText(options.targetVersion);
    if (targetPacked === null) {
      return fail(
        `"${options.targetVersion}" isn't a game version.`,
        chosen
          ? `Give it like ${chosen.example} — the number Steam or the ${chosen.extender.name} site shows for the new patch.`
          : `Give it like ${SUPPORTED.map((g) => `${g.example} for ${g.name}`).join(" or ")} — the number Steam or the script extender's site shows for the new patch.`
      );
    }
  }

  // Where the game is.
  const steamRoot = findSteamRoot();
  const libraries = steamRoot ? findSteamLibraries(steamRoot) : [];
  let gameDir: string;
  let alsoInstalled: PatchDayGame[] = [];
  if (options.gamePath) {
    gameDir = resolve(options.gamePath);
    if (!chosen) {
      return fail(`Neither ${SUPPORTED.map((g) => g.exe).join(" nor ")} is in that folder.`, `gamePath should be the folder that holds ${ANY_EXE}.`);
    }
  } else {
    const installed = (chosen ? [chosen] : SUPPORTED).flatMap((g) => {
      const app = findInstalledApp(libraries, findGameById(g.gameId)!.steamAppId);
      return app ? [{ game: g, dir: app.installDir }] : [];
    });
    const first = installed[0];
    if (!first) {
      return fail(
        `Couldn't find ${chosen ? chosen.name : ANY_GAME} in any Steam library.`,
        `If it's a GOG copy or sits somewhere unusual, pass gamePath (the folder that holds ${chosen ? chosen.exe : ANY_EXE}).`
      );
    }
    chosen = first.game;
    gameDir = first.dir;
    alsoInstalled = installed.slice(1).map((i) => i.game);
  }
  const game: PatchDayGame = chosen;
  const def: GameDef = findGameById(game.gameId)!;
  const x = game.extender;
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
  let gameFiles: string[] = [];
  try {
    gameFiles = readdirSync(gameDir);
  } catch {
    // Unreadable folder: treated as empty, and the verdict will say the script extender isn't there.
  }
  const lowerFiles = new Set(gameFiles.map((f) => f.toLowerCase()));
  // From 0.7.0 (game 1.10.980) on, F4SE's loader starts a GOG build of its DLL for a GOG copy, which it tells by the GOG
  // Galaxy library the game uses; the library sitting in the game folder stands in for that here. 0.6.23, for 1.10.163,
  // starts the same DLL for every copy. The version checked decides, so a what-if to a later version expects the GOG build.
  const gog = x.gogSuffix !== "" && runtime >= F4_1_10_980 && lowerFiles.has("galaxy64.dll");
  const expectedDll = `${game.dllPrefix}_${major}_${minor}_${build}${gog ? x.gogSuffix : ""}.dll`;
  const dllPattern = new RegExp(`^${game.dllPrefix}_\\d+_\\d+_\\d+${x.gogSuffix !== "" ? `(?:${x.gogSuffix})?` : ""}\\.dll$`, "i");
  const dllsInstalled = gameFiles.filter((f) => dllPattern.test(f)).sort();
  const dllPresent = lowerFiles.has(expectedDll.toLowerCase());
  // A copy the script extender refuses outright, told by a file only that store puts in the game folder.
  const unsupported = x.unsupported.find((u) => lowerFiles.has(u.file.toLowerCase()))?.words;
  const skseFileVersion = (file: string): number | undefined => {
    const name = gameFiles.find((f) => f.toLowerCase() === file.toLowerCase());
    const v = name ? readFileVersion(join(gameDir, name)) : null;
    return v ? x.stamp(v) : undefined;
  };
  // On the Steam Deck the loader is often renamed to the game's launcher, so that Steam's Play button starts SKSE.
  // It is still SKSE's loader if it carries SKSE's stamp; the game's own launcher doesn't.
  const loaderFile = lowerFiles.has(game.loader.toLowerCase())
    ? game.loader
    : skseFileVersion(game.launcher) !== undefined
      ? game.launcher
      : undefined;
  const loaderPresent = loaderFile !== undefined;
  const skseInstalled = loaderPresent || dllsInstalled.length > 0;
  const skseVersion = dllPresent ? skseFileVersion(expectedDll) : undefined;
  const loaderVersion = loaderFile !== undefined ? skseFileVersion(loaderFile) : undefined;
  const shortVersion = (packed: number): string => formatPacked(packed).replace(/\.0$/, "");

  // Every place SKSE would find plugins, overlaid the way Mod Organizer 2 overlays them.
  const winners = new Map<string, FileEntry>();
  const gamePlugins = resolveCI(gameDir, "Data", x.folder, "Plugins");
  const gameFolderFiles = gamePlugins ? listPluginFiles(gamePlugins, "game", 0) : [];
  overlay(winners, gameFolderFiles);

  const managers = detectInstalledManagers(libraries);
  const wantsMo2 = options.mo2InstancePath !== undefined || inferManagerForGame(def, managers) === "mo2";
  const mo2: PatchDayReport["sources"]["mo2"] = { used: false, reason: "no Mod Organizer 2 instance for this game was found" };
  if (wantsMo2) {
    const instance = findMo2InstanceForGame(def, options.mo2InstancePath);
    let order: ReturnType<typeof readMo2LoadOrder> = null;
    let unopenable = false;
    if (instance) {
      try {
        order = readMo2LoadOrder(def, {
          ...(options.mo2InstancePath !== undefined ? { instancePath: options.mo2InstancePath } : {}),
          ...(options.profileName !== undefined ? { profileName: options.profileName } : {}),
        });
      } catch {
        // A profile file that is locked or that this account may not read. Node's error names its full path, so it stops here.
        unopenable = true;
      }
    }
    // The folder ModOrganizer.ini names, or MO2's default, as it is spelled on disk.
    const folder = (key: "mod_directory" | "overwrite_directory", name: string): string | null => {
      const path = instance ? mo2Folder(instance, key, name) : null;
      return path === null ? null : resolveCI(dirname(path), basename(path));
    };
    const mods = order ? folder("mod_directory", "mods") : null;
    const enabled = (order?.modFolders ?? []).filter((f) => f.enabled);
    if (order && !mods && enabled.length > 0) {
      mo2.unread = true;
      mo2.reason = "read Mod Organizer 2's profile but couldn't find the folder its mods are kept in, so they weren't read";
    } else if (order) {
      let withPlugins = 0;
      for (const mod of enabled) {
        const dir = mods ? resolveCI(mods, mod.name, x.folder, "Plugins") : null;
        const files = dir ? listPluginFiles(dir, `mo2:${mod.name}`, 1 + mod.modlistIndex) : [];
        if (files.length > 0) withPlugins++;
        overlay(winners, files);
      }
      const overwrite = folder("overwrite_directory", "overwrite");
      const overwritePlugins = overwrite ? resolveCI(overwrite, x.folder, "Plugins") : null;
      if (overwritePlugins) overlay(winners, listPluginFiles(overwritePlugins, "mo2:overwrite", Number.MAX_SAFE_INTEGER));
      mo2.used = true;
      mo2.reason = `Mod Organizer 2's profile and enabled mods were read${overwrite ? ", and its Overwrite folder" : ""}, since MO2 is what loads plugins for this game`;
      mo2.profile = clean(order.profile, NAME_MAX);
      mo2.modsWithPlugins = withPlugins;
    } else if (instance) {
      mo2.unread = true;
      mo2.reason = unopenable
        ? "found a Mod Organizer 2 instance but couldn't open its profile files"
        : "found a Mod Organizer 2 instance but not the profile to read from it (profileName may be wrong)";
    } else if (options.mo2InstancePath !== undefined) {
      mo2.unread = true;
    }
  } else {
    mo2.reason = "Mod Organizer 2 doesn't look like the active manager for this game";
  }

  // The Address Library file for this game version.
  const alName = x.addressLibraryFile(major, minor, build);
  const alEntry = winners.get(alName.toLowerCase());
  let alFormat: number | undefined;
  if (alEntry && x.addressLibraryFormat) {
    const head = readFirstBytes(alEntry.abs, 4);
    if (head) alFormat = head.readUInt32LE(0);
  }

  // Judge every plugin.
  const source = x.sourceFor(runtime);
  const ctx = {
    runtime,
    ...(skseVersion !== undefined ? { skseVersion } : {}),
    addressLibrary: { present: alEntry !== undefined },
  };
  const lines: PluginLine[] = [];
  const assessed = new Map<string, PluginAssessment>();
  const declared = new Map<string, Declared>();
  let pluginsNeedingAddressLibrary = 0;
  const pinned: Array<{ file: string; supports: string[] }> = [];
  let independent = 0;
  let legacy = 0;
  for (const entry of [...winners.values()].sort((a, b) => a.file.localeCompare(b.file))) {
    if (!entry.file.toLowerCase().endsWith(".dll")) continue;
    const checked = x.check(entry.abs, ctx);
    const verdict = checked.assessment;
    assessed.set(entry.file.toLowerCase(), verdict);
    if (checked.declared) declared.set(entry.file.toLowerCase(), checked.declared);
    if (checked.needsAddressLibrary) pluginsNeedingAddressLibrary++;
    if (verdict.binding === "independent") independent++;
    else if (verdict.binding === "legacy") legacy++;
    else if (verdict.binding === "pinned") {
      pinned.push({ file: clean(entry.file, NAME_MAX), supports: checked.compatibleVersions.map(formatPacked) });
    }
    const line: PluginLine = {
      file: clean(entry.file, NAME_MAX),
      source: clean(entry.source, NAME_MAX),
      status: verdict.status,
      binding: verdict.binding,
      reason: verdict.reason,
      basis: verdict.basis,
    };
    const name = clean(checked.declared?.name ?? "", NAME_MAX);
    if (name) line.name = name;
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
  const log = logPath ? readSkseLog(logPath, exeMtime, assessed, declared, x.dialect) : null;
  const logUsable = log && log.found && !whatIf;

  const decision = decide({
    gameName: game.name,
    extender: x.name,
    ...(unsupported !== undefined ? { unsupported } : {}),
    version: runtimeText,
    whatIf,
    skse: {
      installed: skseInstalled,
      loader: loaderFile ?? game.loader,
      dll: expectedDll,
      dllPresent,
      loaderPresent,
      ...(loaderVersion !== undefined ? { loaderVersion: shortVersion(loaderVersion) } : {}),
      ...(skseVersion !== undefined ? { dllVersion: shortVersion(skseVersion) } : {}),
    },
    addressLibrary: { file: alName, present: alEntry !== undefined, pluginsNeedingIt: pluginsNeedingAddressLibrary },
    counts,
    beyondSource: !source.covered,
    mo2Unread: mo2.unread === true,
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
      beyondSource: !source.covered,
      log: logUsable
        ? { fresh: log.fresh, loaded: log.pluginsLoaded, refusals: log.refusals.length, disagreements: log.disagreements.length }
        : null,
      flagged: problems.map((p) => p.basis),
      extender: { name: x.name, sourceFor: x.sourceFor, queryBuild: x.queryBuild, queryExport: x.queryExport },
    }),
    game: { id: game.gameId, name: game.name },
    checked: { version: runtimeText, source: whatIf ? "targetVersion" : "installed", installed: installedText },
    steam,
    scriptExtender: {
      name: x.name,
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
      note: x.nextPatchNote,
    },
    sources: { gameFolderPlugins: gameFolderFiles.filter((f) => f.file.toLowerCase().endsWith(".dll")).length, mo2 },
    log,
    limits: limitsFor(source, runtimeText, x),
    nextSteps: [
      ...nextStepsFor({ game, runtimeText, whatIf, skseInstalled, dllPresent, expectedDll, alName, alPresent: alEntry !== undefined, pluginsNeedingAddressLibrary, counts, steam, log: logUsable ? log : null }),
      // Picked without being asked: say which other game is there and how to check it.
      ...alsoInstalled.map(
        (other) => `This checked ${game.name}, the first game it found. ${other.name} is installed too: ask for it by name (gameId "${other.gameId}") to check it.`
      ),
    ],
  };
}

function limitsFor(source: { build: string; covered: boolean }, version: string, x: Extender): string[] {
  const X = x.name;
  const limits = [
    "Read-only and local: it opens file headers and a few small files, writes nothing, sends nothing and keeps nothing. File names and mod folder names appear in the result; folder paths do not.",
    `A result marked basis "${x.sourceBasis}" comes from the published source of ${X} ${source.build} and carries ${X}'s own log text. Later ${X} builds can add rules.`,
    `A plugin that passes ${X}'s version check can still crash or misbehave if the game code it hooks has changed. That can't be seen from files.`,
  ];
  if (!source.covered) {
    limits.push(
      `${X} hasn't published its source for ${version}. These results apply the rules of ${X} ${source.build}, the nearest published build; ${X}'s own log from a launch is the real answer.`
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
  const x = a.game.extender;
  const X = x.name;
  if (a.skseInstalled && !a.dllPresent) {
    // The script extender's loader refuses any game version but the one it was built for (IdentifyEXE.cpp in SKSE and F4SE), so a build and its loader go together.
    steps.push(
      a.whatIf
        ? `Once the game is on ${a.runtimeText}, get the ${X} build made for it from ${x.site} and install all of its files as you did before, ${a.game.loader} included; it adds ${a.expectedDll}. Until then keep the ${X} you have: each ${X} loader starts only the game version it was built for.`
        : `Get the ${X} build made for ${a.runtimeText} from ${x.site} and install all of its files as you did before, ${a.game.loader} included; it adds ${a.expectedDll}. Each ${X} loader starts only the game version it was built for, so the one you have can't start this version.`
    );
  }
  if (a.pluginsNeedingAddressLibrary > 0 && !a.alPresent) {
    steps.push(`Install the ${x.addressLibrary} build for ${a.runtimeText} (it adds ${a.alName}).`);
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
    steps.push(`Launch the game once through ${X}, close it, and run this again — ${X}'s own log from that launch is the strongest evidence there is.`);
  }
  return steps;
}
