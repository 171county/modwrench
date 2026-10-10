import {
  formatPacked,
  packVersion,
  parseVersionText,
  VIX_ADDRESS_LIBRARY_V5,
  VIX_NO_STRUCT_USE,
  VI_ADDRESS_LIBRARY_POST_AE,
  VI_KNOWN,
  VI_SIGNATURES,
  VI_STRUCTS_POST_629,
  type SkseDllInfo,
} from "./skse.js";

// ─── Would the script extender load this plugin? ─────────────────────────────
// Pure functions: facts in, judgement out, no file access — so every rule here
// can be tested from a table.
//
// Where the rule comes from is recorded on every result (`basis`), because
// these are not equally certain and a modder deserves to know which is which:
//
//   "f4se-source"   — the same for Fallout 4: F4SE's own published source, applied
//                     to a game version a published F4SE build was made for (see
//                     f4se-rules.ts).
//   "skse-source"   — SKSE's own published source, PluginManager.cpp
//                     (ianpatt/skse64, checked 2026-10-03), applied to a game
//                     version a published build was made for: 1.5.97 (SKSE
//                     2.0.20), 1.6.x (2.2.8, whose plugin checks are 2.2.6's and
//                     2.2.7's), 1.7.99 (2.3.0) and 1.7.104 (2.3.1). `skseMessage`
//                     is the exact text SKSE writes to skse64.log for the refusal.
//   "field-reports" — behaviour seen in public bug reports and not in SKSE's
//                     source. No rule needs it now: the Address Library format
//                     change the reports showed on 1.7.x is in SKSE 2.3.1's source.
//   "inferred"      — the nearest published build's rules carried to a game
//                     version no published SKSE build was made for, or reasoned
//                     where no source covers the case. A lead, not a verdict.

export type PluginStatus = "ok" | "broken" | "unclear";
export type PluginBinding = "independent" | "pinned" | "legacy" | "none";
export type RuleBasis = "skse-source" | "f4se-source" | "field-reports" | "inferred";

export type RuntimeContext = {
  /** Packed game version being checked: the installed one, or a what-if target. */
  runtime: number;
  /** Packed version of the SKSE build in use, when its DLL's version could be read. */
  skseVersion?: number;
  /** The Address Library file for this game version. */
  addressLibrary: { present: boolean };
};

export type PluginAssessment = {
  status: PluginStatus;
  /**
   * How the plugin ties itself to game versions — independent of the version
   * being checked, so it answers "will the NEXT patch break this?":
   *   independent — Address Library or signatures; passes SKSE's version check
   *                 on any later game version (it can still fail at run time)
   *   pinned      — a fixed list of game versions; refused on any other. An
   *                 Address Library plugin built for the format used before
   *                 1.7.99 counts here: SKSE 2.3.1 holds it to its list
   *   legacy      — SE-era entry points only; no version data
   *   none        — exports nothing SKSE looks for (a support library)
   */
  binding: PluginBinding;
  /** The text SKSE writes to its log for this refusal, when the rule is SKSE's. */
  skseMessage?: string;
  reason: string;
  basis: RuleBasis;
  /** Game versions a pinned plugin lists. */
  pinnedTo?: string[];
};

export const V1_5_97 = packVersion(1, 5, 97);
export const V1_6_0 = packVersion(1, 6, 0);
export const V1_6_629 = packVersion(1, 6, 629);
export const V1_7_0 = packVersion(1, 7, 0);
export const V1_7_99 = packVersion(1, 7, 99);
export const V1_7_104 = packVersion(1, 7, 104);

/**
 * The published SKSE build whose plugin checks these rules follow for a game version, and whether that
 * build was made for that version (if not, its rules are the nearest there are). SKSE 2.2.6, 2.2.7 and
 * 2.2.8, all for 1.6.1170, check plugins the same way, so the newest is named.
 */
export function skseSourceFor(runtime: number): { build: string; covered: boolean } {
  if (runtime < V1_6_0) return { build: "2.0.20", covered: runtime === V1_5_97 };
  if (runtime < V1_7_0) return { build: "2.2.8", covered: true };
  if (runtime === V1_7_99) return { build: "2.3.0", covered: true };
  return { build: "2.3.1", covered: runtime === V1_7_104 };
}

/** SKSE 2.3.1's window for "built before the Address Library format changed": from "the founding of bethesda" to 2025-05-26 GMT. */
const OLD_FORMAT_BUILT_FROM = 520128000;
const OLD_FORMAT_BUILT_BEFORE = 1748217600;

/**
 * An Address Library plugin that doesn't declare the format used from 1.7.99 on and whose PE build time
 * falls in SKSE 2.3.1's window, which SKSE takes to mean it was built for the old format
 * (CheckPluginCompatibility, PluginManager.cpp at v2.3.1).
 */
export function builtForOldAddressLibrary(info: SkseDllInfo): boolean {
  const v = info.versionData;
  return (
    v !== undefined &&
    (v.versionIndependence & VI_ADDRESS_LIBRARY_POST_AE) !== 0 &&
    !(v.versionIndependenceEx & VIX_ADDRESS_LIBRARY_V5) &&
    info.buildTime !== undefined &&
    info.buildTime >= OLD_FORMAT_BUILT_FROM &&
    info.buildTime < OLD_FORMAT_BUILT_BEFORE
  );
}

export function bindingOf(info: SkseDllInfo): PluginBinding {
  const v = info.versionData;
  if (v) {
    // SKSE 2.3.1 takes such a plugin's version independence away and holds it to the versions it lists.
    if (builtForOldAddressLibrary(info)) return "pinned";
    return v.versionIndependence & (VI_ADDRESS_LIBRARY_POST_AE | VI_SIGNATURES)
      ? "independent"
      : "pinned";
  }
  // Declares version data we couldn't read: how it ties itself to versions is unknown, so it is not called legacy.
  if (info.exports.version) return "none";
  if (info.exports.query || info.exports.load || info.exports.preload) return "legacy";
  return "none";
}

export function assessPlugin(info: SkseDllInfo, ctx: RuntimeContext): PluginAssessment {
  const binding = bindingOf(info);
  const R = ctx.runtime;
  const game = formatPacked(R);
  const result = (
    status: PluginStatus,
    reason: string,
    basis: RuleBasis,
    extra: Partial<PluginAssessment> = {}
  ): PluginAssessment => ({ status, binding, reason, basis, ...extra });
  // Where no published SKSE build was made for this game version, the nearest
  // build's rules are carried over, so even a refusal is a prediction there.
  const ruleBasis: RuleBasis = skseSourceFor(R).covered ? "skse-source" : "inferred";
  const refused = (
    message: string,
    reason: string,
    extra: Partial<PluginAssessment> = {},
    basis: RuleBasis = ruleBasis
  ) => result("broken", reason, basis, { skseMessage: message, ...extra });

  if (!info.readable) {
    return result(
      "unclear",
      `couldn't read this file as a Windows DLL (${info.problem ?? "unknown problem"})`,
      "inferred"
    );
  }

  // Game 1.5.x: SKSE 2.0.20 loads every DLL in the folder with LoadLibrary and
  // keeps the ones that export both SKSEPlugin_Query and SKSEPlugin_Load. It reads
  // no version data; the plugin's own SKSEPlugin_Query decides whether it accepts
  // the game version, which a file can't show.
  if (R < V1_6_0) {
    if (!info.is64) {
      // A 32-bit DLL can't be loaded into the 64-bit game, so LoadLibrary fails.
      return refused(
        "couldn't load plugin",
        "a 32-bit DLL — a Skyrim LE plugin, which Special Edition can't load"
      );
    }
    if (info.exports.query && info.exports.load) {
      return result(
        "ok",
        info.exports.version
          ? "carries both SE and AE entry points"
          : "SE-era plugin. Fine on 1.5.97, but with no version data it will not load on any 1.6+ game",
        ruleBasis
      );
    }
    if (info.exports.version || info.exports.query || info.exports.load || info.exports.preload) {
      return refused(
        "does not appear to be an SKSE plugin",
        `it doesn't export both SKSEPlugin_Query and SKSEPlugin_Load, which SKSE for ${game} needs` +
          (info.exports.version ? ". It carries Anniversary Edition version data, so it is likely a build for 1.6 or later" : "")
      );
    }
    return result(
      "ok",
      "exports nothing SKSE looks for — probably a support library, which SKSE skips",
      "inferred"
    );
  }

  if (!info.is64) {
    // A 32-bit DLL can't be loaded into a 64-bit game on any version.
    return refused(
      "LE plugin cannot be used with SE",
      "a 32-bit DLL — a Skyrim LE plugin, which Special Edition and Anniversary Edition can't use",
      {},
      "skse-source"
    );
  }

  const v = info.versionData;

  // Game 1.6+: the version data is what SKSE reads.
  if (!info.exports.version) {
    if (info.exports.query || info.exports.load || info.exports.preload) {
      return refused(
        "no version data",
        `an SE-era plugin: SKSE for ${game} only loads plugins that carry version data, so it needs a build made for Anniversary Edition`
      );
    }
    return result(
      "ok",
      "exports nothing SKSE looks for — probably a support library, which SKSE skips",
      "inferred"
    );
  }
  if (!v) {
    return result(
      "unclear",
      `declares version data but it couldn't be read (${info.problem ?? "unknown problem"})`,
      "inferred"
    );
  }

  // CheckPluginCompatibility, in SKSE's order.
  if (v.dataVersion === 0) {
    return refused("disabled, bad version data", "its version data is blank");
  }
  if (v.name === "") {
    return refused("disabled, no name specified", "it doesn't declare a plugin name");
  }
  if (v.versionIndependence & ~VI_KNOWN) {
    return refused(
      "disabled, unsupported version independence method",
      "it uses a version-independence method this SKSE doesn't know"
    );
  }
  let independent = (v.versionIndependence & (VI_ADDRESS_LIBRARY_POST_AE | VI_SIGNATURES)) !== 0;
  let notListed = "disabled, incompatible with current version of the game";
  const oldFormat = builtForOldAddressLibrary(info);

  if (v.versionIndependence & VI_ADDRESS_LIBRARY_POST_AE) {
    if (!ctx.addressLibrary.present) {
      return refused(
        "disabled, address library needs to be updated",
        `it needs the Address Library file for ${game}, which isn't installed`
      );
    }
    // SKSE 2.3.1 (1.7.104): the Address Library changed format in 1.7.99, so a
    // plugin built for the old one is held to the game versions it lists.
    if (R > V1_7_99 && oldFormat) {
      independent = false;
      notListed = "must be recompiled for new address library";
    }
  }
  if (
    independent &&
    R >= V1_6_629 &&
    !(v.versionIndependence & VI_STRUCTS_POST_629) &&
    !(v.versionIndependenceEx & VIX_NO_STRUCT_USE)
  ) {
    return refused(
      "disabled, only compatible with versions earlier than 1.6.629",
      "it was built before the 1.6.629 game-structure change and doesn't say it handles the new layout"
    );
  }
  const pinnedTo = v.compatibleVersions.map(formatPacked);
  if (!independent && !v.compatibleVersions.includes(R)) {
    if (notListed === "must be recompiled for new address library") {
      return refused(
        notListed,
        "it was built for the Address Library format used before 1.7.99 (it doesn't declare the new one and was built before 2025-05-26), " +
          `so SKSE only accepts it on the game versions it lists, and ${pinnedTo.length > 0 ? `${game} isn't one of them (${pinnedTo.join(", ")})` : "it lists none"}. It needs a rebuild`,
        { pinnedTo }
      );
    }
    return refused(
      notListed,
      pinnedTo.length > 0
        ? `it is pinned to specific game versions (${pinnedTo.join(", ")}) and ${game} isn't one of them`
        : "it is pinned to specific game versions and lists none",
      { pinnedTo }
    );
  }
  if (
    v.seVersionRequired !== 0 &&
    ctx.skseVersion !== undefined &&
    v.seVersionRequired > ctx.skseVersion
  ) {
    return refused(
      "disabled, requires newer script extender",
      `it needs SKSE ${formatPacked(v.seVersionRequired).replace(/\.0$/, "")} or newer; the installed build is ${formatPacked(ctx.skseVersion).replace(/\.0$/, "")}`
    );
  }
  // SKSE 2.3.0, for 1.7.99, makes no such check and loads the plugin; the
  // Address Library file it then reads is already in the new format.
  if (R === V1_7_99 && oldFormat && !v.compatibleVersions.includes(R)) {
    return result(
      "broken",
      "it was built for the Address Library format used before 1.7.99 (it doesn't declare the new one and was built before 2025-05-26). " +
        "SKSE 2.3.0 doesn't check this and loads it, but it is likely to fail when it reads the new file; SKSE 2.3.1 refuses such plugins on 1.7.104",
      "inferred"
    );
  }

  if (!independent) {
    return result("ok", `lists ${game} among the game versions it supports`, ruleBasis, { pinnedTo });
  }
  if (v.versionIndependence & VI_ADDRESS_LIBRARY_POST_AE) {
    return result(
      "ok",
      oldFormat
        ? "version-independent through Address Library on this game version, but built for the Address Library format used before 1.7.99, so from 1.7.104 SKSE accepts it only on game versions it lists"
        : "version-independent through Address Library, so SKSE's version check passes on any later game version too",
      ruleBasis
    );
  }
  return result(
    "ok",
    "version-independent through signature scanning, so SKSE's version check passes on any later game version too",
    ruleBasis
  );
}

// ─── The headline ────────────────────────────────────────────────────────────

export type Verdict = "go" | "check" | "wait";

export type DecisionInput = {
  gameName: string;
  /** The script extender, as players call it. Default "SKSE". */
  extender?: string;
  /** The script extender refuses this copy of the game outright (a store edition it doesn't support), in words. */
  unsupported?: string;
  /** The game version being judged, e.g. "1.7.104.0". */
  version: string;
  /** Checking a version the user named rather than the one installed. */
  whatIf: boolean;
  skse: {
    installed: boolean;
    loader: string;
    dll: string;
    dllPresent: boolean;
    /** The loader, and the SKSE versions stamped on it and on the DLL, when they were read. */
    loaderPresent?: boolean;
    loaderVersion?: string;
    dllVersion?: string;
  };
  addressLibrary: { file: string; present: boolean; pluginsNeedingIt: number };
  counts: { total: number; ok: number; broken: number; unclear: number };
  /** True when no published SKSE build was made for this game version. */
  beyondSource: boolean;
  /** Mod Organizer 2 loads plugins for this game, but what it holds couldn't be read. */
  mo2Unread?: boolean;
  steamUpdatePending: boolean;
  /** SKSE's log, when one was read. Only one written after the game last changed (`fresh`) is ground truth. */
  log: { fresh: boolean; refusals: number; disagreements: number } | null;
};

export type Decision = { verdict: Verdict; headline: string; reasons: string[] };

export function decide(input: DecisionInput): Decision {
  const { skse, addressLibrary: lib, counts, log } = input;
  const X = input.extender ?? "SKSE";
  const at = input.whatIf
    ? `If you update ${input.gameName} to ${input.version}`
    : `${input.gameName} ${input.version}`;
  const reasons: string[] = [];

  // A copy the script extender refuses outright: nothing it would load can load, before or after an update.
  if (input.unsupported) {
    return {
      verdict: "check",
      headline: `CHECK — ${at}: ${input.unsupported}, so ${X} plugins can't load on this copy, before or after an update.`,
      reasons: [input.unsupported],
    };
  }

  // No script extender at all: SKSE plugins can't load, so a game update has
  // nothing on that side to break.
  if (!skse.installed) {
    const n = counts.total;
    if (n === 0) {
      return {
        verdict: "go",
        headline:
          `GO — ${at}: no script extender and no ${X} plugins are installed, so a game update has nothing to break on that side. ` +
          `Mods that aren't ${X} plugins aren't covered by this check.`,
        reasons,
      };
    }
    return {
      verdict: "check",
      headline: `CHECK — ${at}: ${n} ${X} plugin${n === 1 ? " is" : "s are"} installed but the script extender isn't (no ${skse.loader} next to the game), so ${n === 1 ? "it isn't" : "they aren't"} loading now.`,
      reasons: [`${skse.loader} not found next to the game executable`],
    };
  }

  if (!skse.dllPresent) {
    return {
      verdict: "wait",
      headline: input.whatIf
        ? `WAIT — ${at}: ${X} has no build for it installed (${skse.dll} is missing). ${X}'s loader starts only the game version it was built for, so the build for ${input.version} goes in after the update; put in before, it stops ${X} working on the version you have now.`
        : `WAIT — ${at}: ${X} is installed but has no build for this game version (${skse.dll} is missing). Until one is installed the game won't start with ${X}.`,
      reasons: [`${skse.dll} not found next to the game executable`],
    };
  }
  if (lib.pluginsNeedingIt > 0 && !lib.present) {
    return {
      verdict: "wait",
      headline: `WAIT — ${at}: ${lib.pluginsNeedingIt} plugin${lib.pluginsNeedingIt === 1 ? " needs" : "s need"} the Address Library file for this game version (${lib.file}) and it isn't installed.`,
      reasons: [`${lib.file} not found in the plugin folders`],
    };
  }

  // SKSE starts through its loader, and each loader starts only the game version
  // its build was made for (IdentifyEXE.cpp); a release's loader and DLL carry the same version.
  if (skse.loaderPresent === false) {
    reasons.push(`${skse.loader} isn't next to the game, and ${X} starts through it`);
  } else if (skse.loaderVersion && skse.dllVersion && skse.loaderVersion !== skse.dllVersion) {
    reasons.push(
      `${skse.loader} is from ${X} ${skse.loaderVersion} but ${skse.dll} is from ${X} ${skse.dllVersion}, and each ${X} loader starts only the game version its build was made for`
    );
  }
  if (counts.broken > 0) {
    reasons.push(`${counts.broken} plugin${counts.broken === 1 ? "" : "s"} would be refused or fail`);
  }
  if (counts.unclear > 0) {
    reasons.push(`${counts.unclear} plugin${counts.unclear === 1 ? "" : "s"} couldn't be judged`);
  }
  if (input.mo2Unread) {
    reasons.push("Mod Organizer 2's mods couldn't be read, so the plugins installed through it weren't checked");
  }
  if (input.steamUpdatePending) reasons.push("Steam has a game update waiting");
  // A log from before the last patch describes a different game, so it is not evidence either way.
  if (log && log.fresh && log.disagreements > 0) {
    reasons.push(`${X}'s own log from the last launch disagrees with these predictions`);
  } else if (log && log.fresh && log.refusals > 0 && counts.broken === 0) {
    reasons.push(`${X}'s own log from the last launch reports refused plugins`);
  }
  if (input.beyondSource && !(log && log.fresh && log.refusals === 0)) {
    reasons.push(
      `${X} hasn't published its source for this game version, so a clean result here is a prediction — launch the game once and re-run to compare against ${X}'s own log`
    );
  }

  const total = counts.total;
  if (reasons.length === 0) {
    return {
      verdict: "go",
      headline:
        `GO — ${at}: ${X} build present, ${lib.pluginsNeedingIt > 0 ? "Address Library present, " : ""}` +
        `${total === 0 ? "no plugins to check" : total === 1 ? `the 1 plugin passes ${X}'s own checks` : `all ${total} plugins pass ${X}'s own checks`}. ` +
        "That is what can be checked from files; it can't prove the game runs.",
      reasons,
    };
  }
  return {
    verdict: "check",
    headline: `CHECK — ${at}: ${reasons.join("; ")}.`,
    reasons,
  };
}

// ─── How sure the answer is ──────────────────────────────────────────────────
// A verdict is only as good as what it rests on, and the three things it can
// rest on are very different in weight. SKSE's own log from a launch is a fact.
// The files read through SKSE's published rules are a strong prediction. A
// what-if, or a game version no published SKSE build was made for, is a guess
// built on the nearest thing known. The answer says which one it is, in a
// sentence, so nobody has to infer it from the field names.

export type Evidence = "log" | "files" | "prediction";

export type Confidence = {
  /** "log": SKSE's own log from a launch after the last patch. "files": read from disk, judged by SKSE's published rules. "prediction": a what-if, or a game version SKSE hasn't published source for. */
  evidence: Evidence;
  /** One plain sentence about what the verdict rests on. */
  summary: string;
  /** What the reasons for the flagged (broken or unclear) plugins rest on. */
  basis: Record<RuleBasis, number>;
};

export type ConfidenceInput = {
  whatIf: boolean;
  /** The game version being judged, e.g. "1.7.104.0". */
  version: string;
  /** True when no published SKSE build was made for this game version. */
  beyondSource: boolean;
  /** A skse64.log written after the game last changed, when one was read. */
  log: { fresh: boolean; loaded: number; refusals: number; disagreements: number } | null;
  /** The basis of each flagged plugin. */
  flagged: RuleBasis[];
  /**
   * The script extender: its name, which published build's rules apply to a game version, and the build that asks a
   * plugin's own code instead of reading version data. Default SKSE.
   */
  extender?: { name: string; sourceFor: (runtime: number) => { build: string; covered: boolean }; queryBuild: string; queryExport: string };
};

const SKSE_EXTENDER = { name: "SKSE", sourceFor: skseSourceFor, queryBuild: "2.0.20", queryExport: "SKSEPlugin_Query" };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function describeConfidence(input: ConfidenceInput): Confidence {
  const basis: Record<RuleBasis, number> = { "skse-source": 0, "f4se-source": 0, "field-reports": 0, inferred: 0 };
  for (const b of input.flagged) basis[b]++;
  const x = input.extender ?? SKSE_EXTENDER;
  const X = x.name;
  const build = x.sourceFor(parseVersionText(input.version) ?? 0).build;

  if (input.whatIf) {
    return {
      evidence: "prediction",
      summary:
        `A what-if, not a fact: this judges the plugins you have now against ${input.version}, and nothing changes until you update. ` +
        (input.beyondSource
          ? `${X} hasn't published its source for that version, so it applies the rules of ${X} ${build}, the nearest published build.`
          : `It uses ${X} ${build}'s own rules.`),
      basis,
    };
  }
  if (input.log && input.log.fresh) {
    const { loaded, refusals, disagreements } = input.log;
    return {
      evidence: "log",
      summary:
        `Backed by ${X}'s own log from a launch after the last patch: ${plural(loaded, "plugin", "plugins")} loaded, ${refusals} refused` +
        (disagreements > 0 ? `, including ${disagreements} the file check had passed` : "") +
        ". That is the strongest evidence there is.",
      basis,
    };
  }
  if (input.beyondSource) {
    return {
      evidence: "prediction",
      summary:
        `A prediction: ${X} hasn't published its source for this game version, so this applies the rules of ${X} ${build}, the nearest published build. ` +
        `${X}'s own log from a launch is the real answer.`,
      basis,
    };
  }
  return {
    evidence: "files",
    summary:
      `From the files only, using ${X} ${build}'s own rules, the checks ${X} makes at launch. ` +
      (build === x.queryBuild
        ? `On this game version ${X} also asks each plugin's own code (${x.queryExport}) whether it accepts the game, which files can't show. `
        : "") +
      `${X}'s log from a launch would confirm it.`,
    basis,
  };
}
