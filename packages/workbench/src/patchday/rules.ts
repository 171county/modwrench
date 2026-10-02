import {
  formatPacked,
  packVersion,
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
//   "skse-source"   — SKSE's own published source, PluginManager.cpp's
//                     CheckPluginCompatibility (ianpatt/skse64, the 2.2.6 build
//                     for Skyrim 1.6.1170, checked 2026-10-02), applied to a game
//                     version that source covers (up to 1.6.x). `skseMessage` is
//                     the exact text SKSE writes to skse64.log for the refusal.
//   "field-reports" — behaviour seen in public bug reports for game versions
//                     SKSE has no published source for (Address Library format 5,
//                     reported on 1.7.104.0).
//   "inferred"      — the 2.2.6 rules carried forward to a game version SKSE has
//                     no published source for (1.7.x), or reasoned where no source
//                     or report covers the case. A lead, not a verdict.
//
// SKSE 2.3.x, which supports Skyrim 1.7.x, is not open source. The 2.2.6 rules
// are applied to 1.7.x as the best available baseline, plus the one new fact
// the field reports establish — and on 1.7.x every result is labelled "inferred"
// (or "field-reports"), refusals included, rather than implying more.

export type PluginStatus = "ok" | "broken" | "unclear";
export type PluginBinding = "independent" | "pinned" | "legacy" | "none";
export type RuleBasis = "skse-source" | "field-reports" | "inferred";

export type RuntimeContext = {
  /** Packed game version being checked: the installed one, or a what-if target. */
  runtime: number;
  /** Packed version of the SKSE build in use, when its DLL's version could be read. */
  skseVersion?: number;
  /** The Address Library file for this game version. */
  addressLibrary: { present: boolean; format?: number };
};

export type PluginAssessment = {
  status: PluginStatus;
  /**
   * How the plugin ties itself to game versions — independent of the version
   * being checked, so it answers "will the NEXT patch break this?":
   *   independent — Address Library or signatures; passes SKSE's version check
   *                 on any later game version (it can still fail at run time)
   *   pinned      — a fixed list of game versions; refused on any other
   *   legacy      — SE-era entry points only; no version data
   *   none        — exports nothing SKSE looks for (a support library)
   */
  binding: PluginBinding;
  /** The text SKSE 2.2.6 writes to its log for this refusal, when the rule is SKSE's. */
  skseMessage?: string;
  reason: string;
  basis: RuleBasis;
  /** Game versions a pinned plugin lists. */
  pinnedTo?: string[];
};

export const V1_6_0 = packVersion(1, 6, 0);
export const V1_6_629 = packVersion(1, 6, 629);
export const V1_7_0 = packVersion(1, 7, 0);
export const V1_7_99 = packVersion(1, 7, 99);

export function bindingOf(info: SkseDllInfo): PluginBinding {
  const v = info.versionData;
  if (v) {
    return v.versionIndependence & (VI_ADDRESS_LIBRARY_POST_AE | VI_SIGNATURES)
      ? "independent"
      : "pinned";
  }
  // Declares version data we couldn't read: how it ties itself to versions is unknown, so it is not called legacy.
  if (info.exports.version) return "none";
  if (info.exports.query || info.exports.load || info.exports.preload) return "legacy";
  return "none";
}

/**
 * Does this Address Library need plugins that declare format-5 support, and how
 * do we know?
 *
 * The file's own format number is the evidence: a public bug report shows
 * format 5 and the resulting "Unsupported address library format: 5" on
 * Skyrim 1.7.104.0. When that number can't be read, the answer is a guess from
 * the game version (1.7.99, the first 1.7 runtime, is assumed to behave the
 * same). No report covers that guess, so it is labelled `inferred`.
 */
function format5Need(ctx: RuntimeContext): { needed: boolean; basis: RuleBasis } {
  const format = ctx.addressLibrary.format;
  if (format !== undefined) return { needed: format > 2, basis: "field-reports" };
  return { needed: ctx.runtime >= V1_7_99, basis: "inferred" };
}

export function assessPlugin(info: SkseDllInfo, ctx: RuntimeContext): PluginAssessment {
  const binding = bindingOf(info);
  const R = ctx.runtime;
  const game = formatPacked(R);
  const beyondSource = R >= V1_7_0;
  const result = (
    status: PluginStatus,
    reason: string,
    basis: RuleBasis,
    extra: Partial<PluginAssessment> = {}
  ): PluginAssessment => ({ status, binding, reason, basis, ...extra });
  // SKSE's published source covers game versions up to 1.6.x. On 1.7.x the same
  // rules are carried forward, so even a refusal is a prediction there.
  const ruleBasis: RuleBasis = beyondSource ? "inferred" : "skse-source";
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

  // Game 1.5.x: SE-era script extender (2.0.x), which loads plugins through
  // SKSEPlugin_Query. Its source isn't what was checked, so these are inferred.
  if (R < V1_6_0) {
    if (info.exports.query) {
      return result(
        "ok",
        info.exports.version
          ? "carries both SE and AE entry points"
          : "SE-era plugin. Fine on 1.5.97, but with no version data it will not load on any 1.6+ game",
        "inferred"
      );
    }
    if (info.exports.version || info.exports.load) {
      return result(
        "unclear",
        "has no SKSEPlugin_Query export, which the SE-era script extender is understood to need (unverified)",
        "inferred"
      );
    }
    return result(
      "ok",
      "exports nothing SKSE looks for — probably a support library, which SKSE skips",
      "inferred"
    );
  }

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
  const independent = (v.versionIndependence & (VI_ADDRESS_LIBRARY_POST_AE | VI_SIGNATURES)) !== 0;

  if (v.versionIndependence & VI_ADDRESS_LIBRARY_POST_AE) {
    if (!ctx.addressLibrary.present) {
      return refused(
        "disabled, address library needs to be updated",
        `it needs the Address Library file for ${game}, which isn't installed`
      );
    }
    const format5 = format5Need(ctx);
    if (format5.needed && !(v.versionIndependenceEx & VIX_ADDRESS_LIBRARY_V5)) {
      return result(
        "broken",
        `it was built for the older Address Library format and doesn't declare format-5 support. ` +
          `Plugins like this fail on ${game} with "Unsupported address library format: 5" until their author rebuilds them` +
          (format5.basis === "inferred"
            ? ". The Address Library file's format number couldn't be read, so this assumes the newest format"
            : ""),
        format5.basis
      );
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
    return refused(
      "disabled, incompatible with current version of the game",
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

  if (!independent) {
    return result("ok", `lists ${game} among the game versions it supports`, ruleBasis, { pinnedTo });
  }
  if (v.versionIndependence & VI_ADDRESS_LIBRARY_POST_AE) {
    return result(
      "ok",
      "version-independent through Address Library, so SKSE's version check passes on any later game version too",
      ruleBasis
    );
  }
  return result(
    "ok",
    "version-independent through signature scanning, so SKSE's version check passes on any later game version too",
    ruleBasis
  );
}

// ─── The headline ──────────────────────────────────────────────────────────────

export type Verdict = "go" | "check" | "wait";

export type DecisionInput = {
  gameName: string;
  /** The game version being judged, e.g. "1.7.104.0". */
  version: string;
  /** Checking a version the user named rather than the one installed. */
  whatIf: boolean;
  skse: { installed: boolean; loader: string; dll: string; dllPresent: boolean };
  addressLibrary: { file: string; present: boolean; pluginsNeedingIt: number };
  counts: { total: number; ok: number; broken: number; unclear: number };
  /** True when the game version is one SKSE has no published source for. */
  beyondSource: boolean;
  steamUpdatePending: boolean;
  /** A skse64.log written after the game last changed: ground truth from the last launch. */
  log: { fresh: boolean; refusals: number; disagreements: number } | null;
};

export type Decision = { verdict: Verdict; headline: string; reasons: string[] };

export function decide(input: DecisionInput): Decision {
  const { skse, addressLibrary: lib, counts, log } = input;
  const at = input.whatIf
    ? `If you update ${input.gameName} to ${input.version}`
    : `${input.gameName} ${input.version}`;
  const reasons: string[] = [];

  // No script extender at all: SKSE plugins can't load, so a game update has
  // nothing on that side to break.
  if (!skse.installed) {
    const n = counts.total;
    if (n === 0) {
      return {
        verdict: "go",
        headline:
          `GO — ${at}: no script extender and no SKSE plugins are installed, so a game update has nothing to break on that side. ` +
          "Mods that aren't SKSE plugins aren't covered by this check.",
        reasons,
      };
    }
    return {
      verdict: "check",
      headline: `CHECK — ${at}: ${n} SKSE plugin${n === 1 ? " is" : "s are"} installed but the script extender isn't (no ${skse.loader} next to the game), so ${n === 1 ? "it isn't" : "they aren't"} loading now.`,
      reasons: [`${skse.loader} not found next to the game executable`],
    };
  }

  if (!skse.dllPresent) {
    return {
      verdict: "wait",
      headline: input.whatIf
        ? `WAIT — ${at}: SKSE has no build for it installed (${skse.dll} is missing). The loader picks its DLL by game version, so the new one can be put in place before updating.`
        : `WAIT — ${at}: SKSE is installed but has no build for this game version (${skse.dll} is missing). Until one is installed the game won't start with SKSE.`,
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

  if (counts.broken > 0) {
    reasons.push(`${counts.broken} plugin${counts.broken === 1 ? "" : "s"} would be refused or fail`);
  }
  if (counts.unclear > 0) {
    reasons.push(`${counts.unclear} plugin${counts.unclear === 1 ? "" : "s"} couldn't be judged`);
  }
  if (input.steamUpdatePending) reasons.push("Steam has a game update waiting");
  if (log && log.disagreements > 0) {
    reasons.push("SKSE's own log from the last launch disagrees with these predictions");
  } else if (log && log.refusals > 0 && counts.broken === 0) {
    reasons.push("SKSE's own log from the last launch reports refused plugins");
  }
  if (input.beyondSource && !(log && log.fresh && log.refusals === 0)) {
    reasons.push(
      "SKSE's rules for this game version aren't public, so a clean result here is a prediction — launch the game once and re-run to compare against SKSE's own log"
    );
  }

  const total = counts.total;
  if (reasons.length === 0) {
    return {
      verdict: "go",
      headline:
        `GO — ${at}: SKSE build present, ${lib.pluginsNeedingIt > 0 ? "Address Library present, " : ""}` +
        `${total === 0 ? "no plugins to check" : total === 1 ? "the 1 plugin passes SKSE's own checks" : `all ${total} plugins pass SKSE's own checks`}. ` +
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
