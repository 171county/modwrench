import {
  AI_ADDRESS_LIBRARY_1_10_980,
  AI_ADDRESS_LIBRARY_1_11_137,
  AI_SIGNATURES,
  SI_1_10_980_LAYOUT,
  SI_1_11_137_LAYOUT,
  SI_NO_STRUCTS,
  type F4seDllInfo,
} from "./f4se.js";
import type { PluginAssessment, PluginBinding, PluginStatus, RuleBasis, RuntimeContext } from "./rules.js";
import { formatPacked, packVersion } from "./skse.js";

// ─── Would F4SE load this plugin? ────────────────────────────────────────────
// Pure functions, like rules.ts for SKSE, and from the same kind of source: F4SE's
// own published code (ianpatt/f4se), read at the tag of each release:
//
//   0.6.23  for 1.10.163, the last version before the Next-Gen update. It loads every
//           DLL in Data\F4SE\Plugins and keeps the ones that export F4SEPlugin_Query and
//           F4SEPlugin_Load and whose query accepts the game. It reads no version data,
//           so what the plugin's own code decides can't be seen from its file.
//   0.7.0 to 0.7.4  for 1.10.980 to 1.11.137. Only plugins that carry F4SEPluginVersionData
//           load. A plugin is version-independent when it declares signatures or the
//           1.10.980 Address Library, and no game structures or the 1.10.980 layout.
//   0.7.5 and later  for 1.11.159 on. The same check, but only the 1.11.137 Address
//           Library and layout bits count, so a plugin that declares the 1.10.980 ones
//           is held to the game versions it lists.
//
// `skseMessage` carries the exact status text F4SE writes to f4se.log for a refusal.

export const F4_1_10_163 = packVersion(1, 10, 163);
export const F4_1_10_980 = packVersion(1, 10, 980);
export const F4_1_11_137 = packVersion(1, 11, 137);
export const F4_1_11_159 = packVersion(1, 11, 159);

/**
 * Each game version F4SE has published a build for, and the build whose rules apply to it (F4SE's tags and
 * f4se.silverlock.org). Where a version had more than one (0.7.0 and 0.7.1 for 1.10.980; 0.7.2 and the 0.7.3 beta
 * for 1.10.984), the newest that isn't a beta is listed. 0.7.0, a developer test build, looked for the Address
 * Library under Data\SKSE\Plugins\versionlib-*.bin and 0.7.1 fixed it, so 1.10.980 is judged by 0.7.1.
 */
const BUILDS: ReadonlyArray<{ runtime: number; build: string }> = [
  { runtime: packVersion(1, 10, 163), build: "0.6.23" },
  { runtime: packVersion(1, 10, 980), build: "0.7.1" },
  { runtime: packVersion(1, 10, 984), build: "0.7.2" },
  { runtime: packVersion(1, 11, 137), build: "0.7.4" },
  { runtime: packVersion(1, 11, 159), build: "0.7.5" },
  { runtime: packVersion(1, 11, 169), build: "0.7.6" },
  { runtime: packVersion(1, 11, 191), build: "0.7.7" },
  { runtime: packVersion(1, 11, 221), build: "0.7.8" },
  { runtime: packVersion(1, 11, 240), build: "0.7.9" },
];

/**
 * The published F4SE build whose plugin checks apply to a game version, and whether that build was made for it.
 * A version no build was made for gets the rules of the nearest build before it (0.6.23's before the first).
 */
export function f4seSourceFor(runtime: number): { build: string; covered: boolean } {
  let found = BUILDS[0]!;
  for (const b of BUILDS) if (b.runtime <= runtime) found = b;
  return { build: found.build, covered: found.runtime === runtime };
}

/** The Address Library and structure bits F4SE treats as current on a game version. */
function current(runtime: number): { library: number; layout: number; since: string } {
  return runtime >= F4_1_11_159
    ? { library: AI_ADDRESS_LIBRARY_1_11_137, layout: SI_1_11_137_LAYOUT, since: "1.11.137" }
    : { library: AI_ADDRESS_LIBRARY_1_10_980, layout: SI_1_10_980_LAYOUT, since: "1.10.980" };
}

/** Does the plugin ask F4SE to check for the Address Library file on this game version? */
export function needsF4seAddressLibrary(info: F4seDllInfo, runtime: number): boolean {
  const v = info.versionData;
  return runtime >= F4_1_10_980 && v !== undefined && (v.addressIndependence & current(runtime).library) !== 0;
}

/** How a plugin ties itself to game versions, judged by the newest F4SE's rules: what the next patch will see. */
export function f4seBindingOf(info: F4seDllInfo): PluginBinding {
  const v = info.versionData;
  if (v) {
    const address = (v.addressIndependence & (AI_SIGNATURES | AI_ADDRESS_LIBRARY_1_11_137)) !== 0;
    const layout = (v.structureIndependence & (SI_NO_STRUCTS | SI_1_11_137_LAYOUT)) !== 0;
    return address && layout && v.reservedBreaking === 0 ? "independent" : "pinned";
  }
  if (info.exports.version) return "none";
  if (info.exports.query || info.exports.load || info.exports.preload) return "legacy";
  return "none";
}

export function assessF4sePlugin(info: F4seDllInfo, ctx: RuntimeContext): PluginAssessment {
  const binding = f4seBindingOf(info);
  const R = ctx.runtime;
  const game = formatPacked(R);
  const ruleBasis: RuleBasis = f4seSourceFor(R).covered ? "f4se-source" : "inferred";
  const result = (status: PluginStatus, reason: string, basis: RuleBasis, extra: Partial<PluginAssessment> = {}): PluginAssessment => ({
    status,
    binding,
    reason,
    basis,
    ...extra,
  });
  const refused = (message: string, reason: string, extra: Partial<PluginAssessment> = {}, basis: RuleBasis = ruleBasis) =>
    result("broken", reason, basis, { skseMessage: message, ...extra });

  if (!info.readable) {
    return result("unclear", `couldn't read this file as a Windows DLL (${info.problem ?? "unknown problem"})`, "inferred");
  }

  // Before the Next-Gen update: F4SE 0.6.23 loads each DLL and asks the plugin's own code.
  if (R < F4_1_10_980) {
    if (!info.is64) {
      // LoadLibrary can't put a 32-bit DLL into the 64-bit game.
      return refused("couldn't load plugin", "a 32-bit DLL, which the 64-bit game can't load");
    }
    if (info.exports.query && info.exports.load) {
      return result(
        "ok",
        info.exports.version
          ? "carries both the old entry points and Next-Gen version data, so F4SE 0.6.23 loads it if its own code accepts this game version"
          : `an F4SE plugin of the kind F4SE for ${game} loads; whether it accepts this game version is up to its own code (F4SEPlugin_Query), which files can't show. With no version data it won't load on the Next-Gen update (1.10.980) or later`,
        ruleBasis
      );
    }
    if (info.exports.version || info.exports.query || info.exports.load || info.exports.preload) {
      return refused(
        "does not appear to be an F4SE plugin",
        `it doesn't export both F4SEPlugin_Query and F4SEPlugin_Load, which F4SE for ${game} needs` +
          (info.exports.version ? ". It carries Next-Gen version data, so it is likely a build for 1.10.980 or later" : "")
      );
    }
    return result("ok", "exports nothing F4SE looks for — probably a support library, which F4SE skips", "inferred");
  }

  if (!info.is64) {
    return refused("32-bit plugins can never work", "a 32-bit DLL, which the 64-bit game can't load");
  }
  if (!info.exports.version) {
    if (info.exports.query || info.exports.load || info.exports.preload) {
      return refused(
        "no version data",
        `a plugin from before the Next-Gen update: F4SE for ${game} only loads plugins that carry version data, so it needs a build made for 1.10.980 or later`
      );
    }
    return result("ok", "exports nothing F4SE looks for — probably a support library, which F4SE skips", "inferred");
  }
  const v = info.versionData;
  if (!v) {
    return result("unclear", `declares version data but it couldn't be read (${info.problem ?? "unknown problem"})`, "inferred");
  }

  // CheckPluginCompatibility, in F4SE's order.
  if (v.dataVersion === 0) return refused("disabled, bad version data", "its version data is blank");
  if (v.name === "") return refused("disabled, no name specified", "it doesn't declare a plugin name");

  const now = current(R);
  const address = (v.addressIndependence & (AI_SIGNATURES | now.library)) !== 0;
  const layout = (v.structureIndependence & (SI_NO_STRUCTS | now.layout)) !== 0;
  const independent = address && layout && v.reservedBreaking === 0;
  if (v.addressIndependence & now.library && !ctx.addressLibrary.present) {
    return refused(
      "disabled, address library needs to be updated",
      `it needs the Address Library file for ${game}, which isn't installed`
    );
  }
  const pinnedTo = v.compatibleVersions.map(formatPacked);
  if (!independent && !v.compatibleVersions.includes(R)) {
    // A plugin that declares only the 1.10.980 bits was independent until F4SE 0.7.5.
    const older =
      R >= F4_1_11_159 &&
      (v.addressIndependence & AI_ADDRESS_LIBRARY_1_10_980 || v.structureIndependence & SI_1_10_980_LAYOUT) &&
      !(v.addressIndependence & AI_ADDRESS_LIBRARY_1_11_137);
    return refused(
      "disabled, incompatible with current version of the game",
      older
        ? `it declares the Address Library or game layout of 1.10.980, which F4SE stopped counting from 0.7.5 (game 1.11.159) on, so it is held to the game versions it lists, and ${
            pinnedTo.length > 0 ? `${game} isn't one of them (${pinnedTo.join(", ")})` : "it lists none"
          }. It needs a build that declares the 1.11.137 ones`
        : pinnedTo.length > 0
          ? `it is pinned to specific game versions (${pinnedTo.join(", ")}) and ${game} isn't one of them`
          : "it is pinned to specific game versions and lists none",
      { pinnedTo }
    );
  }
  if (v.seVersionRequired > (ctx.skseVersion ?? Number.MAX_SAFE_INTEGER)) {
    return refused(
      "disabled, requires newer script extender",
      `it needs F4SE ${formatPacked(v.seVersionRequired).replace(/\.0$/, "")} or newer; the installed build is ${formatPacked(ctx.skseVersion!).replace(/\.0$/, "")}`
    );
  }
  if (!independent) return result("ok", `lists ${game} among the game versions it supports`, ruleBasis, { pinnedTo });
  if (v.addressIndependence & now.library) {
    return result(
      "ok",
      `version-independent through the Address Library (the ${now.since} one), so F4SE's version check passes on later game versions too, as long as F4SE keeps counting it`,
      ruleBasis
    );
  }
  return result("ok", "version-independent through signature scanning, so F4SE's version check passes on any later game version too", ruleBasis);
}
