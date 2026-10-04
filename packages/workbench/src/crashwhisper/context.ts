import { inspectPatchDay, type PatchDayInstall, type PatchDayReport } from "../patchday/index.js";
import { readFileVersion } from "../patchday/pe.js";
import type { RuleBasis } from "../patchday/rules.js";
import { formatPacked, inspectSksePlugin } from "../patchday/skse.js";
import { clean } from "../patchday/summary.js";
import { scrub } from "./redact.js";
import type { InstallNote } from "./rank.js";

// ─── What the player's own files add to a crash log ──────────────────────────
// A crash log says what was loaded when the game stopped. The files on disk say
// what is there now, and the two can differ: a plugin updated after the crash, a
// game patched since, a DLL removed to test. Where Patch Day can already read the
// install (Skyrim Special Edition so far), this reuses it and answers three things
// about a plugin the log points at: is it still there, where does it come from, and
// does the script extender's own rule refuse it for the installed game version.
//
// Read-only, like Patch Day. Folders never leave this module: what comes out names
// files and, for Mod Organizer 2, mod folders, exactly as the player named them.

export type InstallContext = {
  checked: boolean;
  /** Why the install wasn't read, when it wasn't. */
  reason?: string;
  /** The installed game version, e.g. "1.6.1170". */
  gameVersion?: string;
  /** "SKSE 2.2.6", "SKSE (no build for this game version)", or null when there is none. */
  scriptExtender?: string | null;
  /** Mod Organizer 2 mod folders that hold plugin files. */
  modFolders?: number;
  /** What the install says about one plugin DLL, by file name. */
  note: (file: string) => InstallNote | undefined;
  /** The versions a plugin DLL reports in the install: the one it declares to SKSE and the one stamped on the file. */
  versions: (file: string) => string[];
  /** The plugin DLLs the script extender would load, lower-case file names. */
  files: ReadonlySet<string>;
  /** Plugins the file check flags for the installed game version. */
  flagged: ReadonlyArray<{ file: string; status: "broken" | "unclear"; reason: string; basis: RuleBasis }>;
};

const NONE: Pick<InstallContext, "note" | "versions" | "files" | "flagged"> = {
  note: () => undefined,
  versions: () => [],
  files: new Set(),
  flagged: [],
};

export type InstallOptions = {
  gameId?: string;
  gamePath?: string;
  mo2InstancePath?: string;
  profileName?: string;
};

/** "game" -> "game folder"; "mo2:Some Mod" -> 'MO2 mod "Some Mod"'. Mod folder names are the player's own words. */
function sourceLabel(source: string): string {
  if (source === "game") return "game folder";
  if (source === "mo2:overwrite") return "MO2 overwrite folder";
  if (source.startsWith("mo2:")) return `MO2 mod "${clean(scrub(source.slice(4)), 60)}"`;
  return clean(scrub(source), 60);
}

function trimVersion(parts: number[]): string {
  const out = [...parts];
  while (out.length > 3 && out[out.length - 1] === 0) out.pop();
  return out.join(".");
}

function skipped(reason: string): InstallContext {
  return { checked: false, reason, ...NONE };
}

/** The games whose installs can be read: the same as Patch Day's. */
const INSTALL_GAMES = new Set(["skyrimspecialedition"]);

export function readInstallContext(options: InstallOptions): InstallContext {
  const gameId = options.gameId;
  if (!gameId || !INSTALL_GAMES.has(gameId)) {
    return skipped(
      "Checking the log against your install works for Skyrim Special Edition so far, so for this game only the log itself was used."
    );
  }

  const { result, install } = inspectPatchDay({
    gameId,
    ...(options.gamePath !== undefined ? { gamePath: options.gamePath } : {}),
    ...(options.mo2InstancePath !== undefined ? { mo2InstancePath: options.mo2InstancePath } : {}),
    ...(options.profileName !== undefined ? { profileName: options.profileName } : {}),
  });
  if (!result.ok || !install) {
    const why = result.ok ? "the install could not be read" : clean(scrub(result.error), 200).replace(/[.]$/, "");
    return skipped(`Your Skyrim install wasn't read (${why}), so only the log itself was used.`);
  }
  return fromReport(result, install);
}

function fromReport(report: PatchDayReport, install: PatchDayInstall): InstallContext {
  // The report's file names went through clean() (one line, single spaces, nothing invisible) at Patch Day's
  // 260-character limit, and the install's are as they are on disk, so a name is cleaned the same way to find its entry.
  const flagKey = (file: string): string => clean(file, 260).toLowerCase();
  const flaggedByFile = new Map(
    report.plugins.problems
      .filter((p) => /\.dll$/i.test(p.file))
      .map((p) => [flagKey(p.file), p] as const)
  );
  const files = new Set<string>();
  for (const key of install.files.keys()) if (key.endsWith(".dll")) files.add(key);

  const versionsOf = (file: string): string[] => {
    const entry = install.files.get(file.toLowerCase());
    if (!entry) return [];
    const found: string[] = [];
    const info = inspectSksePlugin(entry.abs);
    const declared = info.versionData?.pluginVersion;
    if (declared) found.push(trimVersion(formatPacked(declared).split(".").map(Number)));
    const stamped = readFileVersion(entry.abs);
    if (stamped) found.push(trimVersion([...stamped]));
    return [...new Set(found)];
  };

  const note = (file: string): InstallNote | undefined => {
    const key = file.toLowerCase();
    if (!/\.dll$/.test(key)) return undefined;
    const entry = install.files.get(key);
    if (!entry) return { present: false };
    const out: InstallNote = { present: true, source: sourceLabel(entry.source) };
    const versions = versionsOf(file);
    if (versions[0]) out.version = versions[0];
    const info = inspectSksePlugin(entry.abs);
    const declaredName = info.versionData?.name?.trim();
    if (declaredName) out.declaredName = clean(scrub(declaredName), 60);
    const problem = flaggedByFile.get(flagKey(entry.file));
    if (problem) {
      out.flagged = {
        status: problem.status === "broken" ? "broken" : "unclear",
        reason: clean(scrub(problem.reason), 300).replace(/\.$/, ""),
        basis: problem.basis,
      };
    }
    return out;
  };

  const se = report.scriptExtender;
  const scriptExtender = se.dllPresent
    ? `SKSE${se.version ? ` ${se.version}` : ""}`
    : se.loaderPresent || se.dllsInstalled.length > 0
      ? "SKSE (no build for this game version)"
      : null;

  return {
    checked: true,
    gameVersion: report.checked.installed.replace(/(\.0)+$/, ""),
    scriptExtender,
    ...(report.sources.mo2.used && report.sources.mo2.modsWithPlugins !== undefined
      ? { modFolders: report.sources.mo2.modsWithPlugins }
      : {}),
    note,
    versions: versionsOf,
    files,
    flagged: [...flaggedByFile.values()].map((p) => ({
      file: p.file,
      status: p.status === "broken" ? ("broken" as const) : ("unclear" as const),
      reason: clean(scrub(p.reason), 300).replace(/\.$/, ""),
      basis: p.basis,
    })),
  };
}

/** Version text as a plugin list prints it ("v1.4.2", "1.4.2.0") to numbers, ignoring zeros at the end; null when it isn't a dotted version. */
export function versionParts(text: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+){1,3})$/i.exec(text.trim());
  if (!m?.[1]) return null;
  const parts = m[1].split(".").map(Number);
  while (parts.length > 2 && parts[parts.length - 1] === 0) parts.pop();
  return parts.every((n) => Number.isFinite(n)) ? parts : null;
}

export function sameVersion(a: string, b: string): boolean {
  const x = versionParts(a);
  const y = versionParts(b);
  return x !== null && y !== null && x.length === y.length && x.every((n, i) => n === y[i]);
}
