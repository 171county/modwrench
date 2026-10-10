import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessPlugin,
  bindingOf,
  decide,
  describeConfidence,
  skseSourceFor,
  V1_6_629,
  V1_7_0,
  V1_7_99,
  type ConfidenceInput,
  type DecisionInput,
  type PluginBinding,
  type PluginStatus,
  type RuleBasis,
  type RuntimeContext,
} from "../src/patchday/rules.js";
import {
  packVersion as v,
  VIX_ADDRESS_LIBRARY_V5 as V5,
  VIX_NO_STRUCT_USE as NO_STRUCTS,
  VI_ADDRESS_LIBRARY_POST_AE as AL,
  VI_SIGNATURES as SIG,
  VI_STRUCTS_POST_629 as S629,
  type SkseDllInfo,
  type SkseVersionData,
} from "../src/patchday/skse.js";

// The rules are pure: facts about a DLL and a game version in, a judgement out.
// So every rule SKSE applies is exercised here from a table, with the exact text
// SKSE writes to its log, the boundaries where a rule starts to apply, and the
// order SKSE checks them in (a plugin that breaks two rules gets the first).

const R5 = v(1, 5, 97);
const R6 = v(1, 6, 1170);
const R7 = v(1, 7, 104);
/** A game version no published SKSE build was made for. */
const R7_NEXT = v(1, 7, 110);

/** PE build times either side of SKSE 2.3.1's window for "built for the old Address Library format". */
const BUILT_2024 = 1717200000; // 2024-06-01
const CUTOFF = 1748217600; // 2025-05-26 00:00 UTC
const BETHESDA_FOUNDED = 520128000; // 1986-06-26, the window's lower bound

/** A DLL as `inspectSksePlugin` would describe it. `data` present = it exports SKSEPlugin_Version. */
function dll(o: {
  readable?: boolean;
  problem?: string;
  is64?: boolean;
  exports?: Partial<SkseDllInfo["exports"]>;
  data?: Partial<SkseVersionData>;
  buildTime?: number;
} = {}): SkseDllInfo {
  const info: SkseDllInfo = {
    readable: o.readable ?? true,
    is64: o.is64 ?? true,
    exports: { version: o.data !== undefined, query: false, load: true, preload: false, ...o.exports },
  };
  if (o.problem !== undefined) info.problem = o.problem;
  if (o.buildTime !== undefined) info.buildTime = o.buildTime;
  if (o.data !== undefined) {
    info.versionData = {
      dataVersion: 1,
      pluginVersion: 1,
      name: "Test",
      author: "tests",
      versionIndependenceEx: 0,
      versionIndependence: 0,
      compatibleVersions: [],
      seVersionRequired: 0,
      ...o.data,
    };
  }
  return info;
}

/** A game version; by default the Address Library file for it is present. */
function ctx(runtime: number, o: { skse?: number; al?: { present: boolean } } = {}): RuntimeContext {
  return {
    runtime,
    ...(o.skse !== undefined ? { skseVersion: o.skse } : {}),
    addressLibrary: o.al ?? { present: true },
  };
}

type Case = {
  name: string;
  info: SkseDllInfo;
  ctx: RuntimeContext;
  status: PluginStatus;
  binding: PluginBinding;
  basis: RuleBasis;
  /** SKSE's own log text; undefined means the rule has none (and the result must carry none). */
  message?: string;
  reason?: RegExp;
  pinnedTo?: string[];
};

const NOTHING = { load: false } as const;

const CASES: Case[] = [
  // ── files SKSE can't make sense of ──
  {
    name: "a file that isn't a DLL can't be judged",
    info: dll({ readable: false, problem: "not a Windows executable (no MZ header)", exports: NOTHING }),
    ctx: ctx(R6),
    status: "unclear",
    binding: "none",
    basis: "inferred",
    reason: /couldn't read this file.*no MZ header/,
  },
  {
    name: "a 32-bit DLL is a Skyrim LE plugin",
    info: dll({ is64: false, exports: NOTHING }),
    ctx: ctx(R6),
    status: "broken",
    binding: "none",
    basis: "skse-source",
    message: "LE plugin cannot be used with SE",
    reason: /32-bit/,
  },
  {
    name: "a 32-bit DLL is just as unusable on 1.7.x, and that needs no source to know",
    info: dll({ is64: false, exports: NOTHING }),
    ctx: ctx(R7),
    status: "broken",
    binding: "none",
    basis: "skse-source",
    message: "LE plugin cannot be used with SE",
  },

  // ── Skyrim 1.5.97: SKSE 2.0.20, which keeps a DLL only if it exports both SKSEPlugin_Query and SKSEPlugin_Load ──
  {
    name: "1.5.97: a plugin with both SE-era entry points is fine",
    info: dll({ exports: { query: true } }),
    ctx: ctx(R5),
    status: "ok",
    binding: "legacy",
    basis: "skse-source",
    reason: /SE-era plugin.*1\.5\.97.*1\.6\+/,
  },
  {
    name: "1.5.97: a plugin carrying both generations of entry point is fine",
    info: dll({ exports: { query: true }, data: { versionIndependence: AL, versionIndependenceEx: V5 } }),
    ctx: ctx(R5),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
    reason: /both SE and AE/,
  },
  {
    name: "1.5.97: version data with no SKSEPlugin_Query is refused, as SKSE 2.0.20 refuses it",
    info: dll({ data: {} }),
    ctx: ctx(R5),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "does not appear to be an SKSE plugin",
    reason: /SKSEPlugin_Query and SKSEPlugin_Load.*build for 1\.6 or later/,
  },
  {
    name: "1.5.97: SKSEPlugin_Query without SKSEPlugin_Load is refused too",
    info: dll({ exports: { query: true, load: false } }),
    ctx: ctx(R5),
    status: "broken",
    binding: "legacy",
    basis: "skse-source",
    message: "does not appear to be an SKSE plugin",
  },
  {
    name: "1.5.97: a 32-bit DLL can't be loaded at all, which SKSE 2.0.20 logs as a failed load",
    info: dll({ is64: false, exports: NOTHING }),
    ctx: ctx(R5),
    status: "broken",
    binding: "none",
    basis: "skse-source",
    message: "couldn't load plugin",
    reason: /32-bit/,
  },
  {
    name: "1.5.97: a DLL exporting nothing SKSE looks for is a support library",
    info: dll({ exports: NOTHING }),
    ctx: ctx(R5),
    status: "ok",
    binding: "none",
    basis: "inferred",
    reason: /support library/,
  },
  {
    name: "an older 1.5.x game, which no published SKSE build was made for, is a prediction",
    info: dll({ exports: { query: true } }),
    ctx: ctx(v(1, 5, 80)),
    status: "ok",
    binding: "legacy",
    basis: "inferred",
  },

  // ── Skyrim 1.6+ : the version data is what SKSE reads ──
  {
    name: "an SE-era plugin has no version data and is refused on AE",
    info: dll({ exports: { query: true } }),
    ctx: ctx(R6),
    status: "broken",
    binding: "legacy",
    basis: "skse-source",
    message: "no version data",
    reason: /SE-era plugin.*1\.6\.1170\.0.*Anniversary Edition/,
  },
  {
    name: "the same refusal on 1.7.104 rests on SKSE 2.3.1's published source",
    info: dll({ exports: { query: true } }),
    ctx: ctx(R7),
    status: "broken",
    binding: "legacy",
    basis: "skse-source",
    message: "no version data",
  },
  {
    name: "the same refusal past 1.7.104, where SKSE has published no source, is a prediction, and says so",
    info: dll({ exports: { query: true } }),
    ctx: ctx(R7_NEXT),
    status: "broken",
    binding: "legacy",
    basis: "inferred",
    message: "no version data",
  },
  {
    name: "a preload-only plugin counts as SE-era too",
    info: dll({ exports: { load: false, preload: true } }),
    ctx: ctx(R6),
    status: "broken",
    binding: "legacy",
    basis: "skse-source",
    message: "no version data",
  },
  {
    name: "a DLL exporting nothing SKSE looks for is skipped, not refused",
    info: dll({ exports: NOTHING }),
    ctx: ctx(R6),
    status: "ok",
    binding: "none",
    basis: "inferred",
    reason: /support library/,
  },
  {
    name: "version data that couldn't be read is unclear",
    info: dll({ exports: { version: true }, problem: "SKSEPlugin_Version points outside the file" }),
    ctx: ctx(R6),
    status: "unclear",
    binding: "none",
    basis: "inferred",
    reason: /couldn't be read.*points outside the file/,
  },

  // ── CheckPluginCompatibility, rule by rule ──
  {
    name: "blank version data",
    info: dll({ data: { dataVersion: 0 } }),
    ctx: ctx(R6),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, bad version data",
  },
  {
    name: "no plugin name",
    info: dll({ data: { name: "" } }),
    ctx: ctx(R6),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, no name specified",
  },
  {
    name: "an unknown version-independence method",
    info: dll({ data: { versionIndependence: 8 } }),
    ctx: ctx(R6),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, unsupported version independence method",
  },
  {
    name: "Address Library plugin with no Address Library file installed",
    info: dll({ data: { versionIndependence: AL | S629 } }),
    ctx: ctx(R6, { al: { present: false } }),
    status: "broken",
    binding: "independent",
    basis: "skse-source",
    message: "disabled, address library needs to be updated",
    reason: /Address Library file for 1\.6\.1170\.0, which isn't installed/,
  },
  {
    name: "Address Library plugin with the file present passes",
    info: dll({ data: { versionIndependence: AL | S629 } }),
    ctx: ctx(R6),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
    reason: /through Address Library.*any later game version/,
  },
  {
    name: "a signature-scanning plugin needs no Address Library file",
    info: dll({ data: { versionIndependence: SIG | S629 } }),
    ctx: ctx(R7, { al: { present: false } }),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
    reason: /signature scanning/,
  },

  // ── SKSE 2.3.1 (1.7.104): the Address Library changed format in 1.7.99. A plugin without the
  //    new-format flag whose PE build time is in [1986-06-26, 2025-05-26) is held to its version list. ──
  {
    name: "1.7.104: an Address Library plugin without the new-format flag, built in 2024, is refused in SKSE's words",
    info: dll({ data: { versionIndependence: AL | S629 }, buildTime: BUILT_2024 }),
    ctx: ctx(R7),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "must be recompiled for new address library",
    reason: /format used before 1\.7\.99.*it lists none\. It needs a rebuild/,
    pinnedTo: [],
  },
  {
    name: "1.7.104: built one second before 2025-05-26, still refused",
    info: dll({ data: { versionIndependence: AL | S629 }, buildTime: CUTOFF - 1 }),
    ctx: ctx(R7),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "must be recompiled for new address library",
  },
  {
    name: "1.7.104: built on 2025-05-26 or later, SKSE lets it through",
    info: dll({ data: { versionIndependence: AL | S629 }, buildTime: CUTOFF }),
    ctx: ctx(R7),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "1.7.104: a build time at the window's lower bound is inside it",
    info: dll({ data: { versionIndependence: AL | S629 }, buildTime: BETHESDA_FOUNDED }),
    ctx: ctx(R7),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "must be recompiled for new address library",
  },
  {
    name: "1.7.104: a build time below the window, a zero one included, is let through as SKSE does",
    info: dll({ data: { versionIndependence: AL | S629 }, buildTime: BETHESDA_FOUNDED - 1 }),
    ctx: ctx(R7),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "1.7.104: a zero build time, as a reproducible build writes it",
    info: dll({ data: { versionIndependence: AL | S629 }, buildTime: 0 }),
    ctx: ctx(R7),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "1.7.104: an old build that lists 1.7.104 in its versions passes",
    info: dll({ data: { versionIndependence: AL | S629, compatibleVersions: [R7] }, buildTime: BUILT_2024 }),
    ctx: ctx(R7),
    status: "ok",
    binding: "pinned",
    basis: "skse-source",
    reason: /lists 1\.7\.104\.0/,
    pinnedTo: ["1.7.104.0"],
  },
  {
    name: "1.7.104: an old build that lists only other versions is refused with SKSE 2.3.1's text",
    info: dll({ data: { versionIndependence: AL | S629, compatibleVersions: [R6] }, buildTime: BUILT_2024 }),
    ctx: ctx(R7),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "must be recompiled for new address library",
    reason: /1\.7\.104\.0 isn't one of them \(1\.6\.1170\.0\)/,
    pinnedTo: ["1.6.1170.0"],
  },
  {
    name: "1.7.104: with the new-format flag, the build time doesn't matter",
    info: dll({ data: { versionIndependence: AL | S629, versionIndependenceEx: V5 }, buildTime: BUILT_2024 }),
    ctx: ctx(R7),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "1.7.104: signature scanning on its own is untouched by the Address Library rule",
    info: dll({ data: { versionIndependence: SIG | S629 }, buildTime: BUILT_2024 }),
    ctx: ctx(R7),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "1.7.104: Address Library plus signatures, old build: SKSE still takes its independence away",
    info: dll({ data: { versionIndependence: AL | SIG | S629 }, buildTime: BUILT_2024 }),
    ctx: ctx(R7),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "must be recompiled for new address library",
  },
  {
    name: "1.7.104 order: a missing Address Library file is reported before the old format",
    info: dll({ data: { versionIndependence: AL | S629 }, buildTime: BUILT_2024 }),
    ctx: ctx(R7, { al: { present: false } }),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, address library needs to be updated",
  },
  {
    name: "1.7.104 order: an old-format plugin is held to its list, so the structure rule never gets to it",
    info: dll({ data: { versionIndependence: AL }, buildTime: BUILT_2024 }),
    ctx: ctx(R7),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "must be recompiled for new address library",
  },
  {
    name: "past 1.7.104 the same rule is carried forward as a prediction",
    info: dll({ data: { versionIndependence: AL | S629 }, buildTime: BUILT_2024 }),
    ctx: ctx(R7_NEXT),
    status: "broken",
    binding: "pinned",
    basis: "inferred",
    message: "must be recompiled for new address library",
  },

  // ── SKSE 2.3.0 (1.7.99) doesn't make that check: the plugin loads, then reads a file in the new format ──
  {
    name: "1.7.99: an old-format plugin is flagged as an inference, with no SKSE text, because SKSE 2.3.0 loads it",
    info: dll({ data: { versionIndependence: AL | S629 }, buildTime: BUILT_2024 }),
    ctx: ctx(V1_7_99),
    status: "broken",
    binding: "pinned",
    basis: "inferred",
    reason: /SKSE 2\.3\.0 doesn't check this and loads it/,
  },
  {
    name: "1.7.99: one that lists 1.7.99 passes SKSE 2.3.0's checks",
    info: dll({ data: { versionIndependence: AL | S629, compatibleVersions: [V1_7_99] }, buildTime: BUILT_2024 }),
    ctx: ctx(V1_7_99),
    status: "ok",
    binding: "pinned",
    basis: "skse-source",
  },
  {
    name: "1.7.99: SKSE 2.3.0 still applies the structure rule to an old-format plugin, and that comes first",
    info: dll({ data: { versionIndependence: AL }, buildTime: BUILT_2024 }),
    ctx: ctx(V1_7_99),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, only compatible with versions earlier than 1.6.629",
  },
  {
    name: "1.7.99: a plugin with the new-format flag passes",
    info: dll({ data: { versionIndependence: AL | S629, versionIndependenceEx: V5 }, buildTime: BUILT_2024 }),
    ctx: ctx(V1_7_99),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },

  // ── On 1.6.1170 an old-format plugin passes, but it is pinned as far as the next patch goes ──
  {
    name: "1.6.1170: an old-format Address Library plugin passes, and its reason doesn't promise later versions",
    info: dll({ data: { versionIndependence: AL | S629 }, buildTime: BUILT_2024 }),
    ctx: ctx(R6),
    status: "ok",
    binding: "pinned",
    basis: "skse-source",
    reason: /from 1\.7\.104 SKSE accepts it only on game versions it lists/,
  },

  // ── The 1.6.629 game-structure change ──
  {
    name: "pre-1.6.629 layout on 1.6.628 is fine",
    info: dll({ data: { versionIndependence: AL } }),
    ctx: ctx(v(1, 6, 628)),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "pre-1.6.629 layout on 1.6.629 is refused",
    info: dll({ data: { versionIndependence: AL } }),
    ctx: ctx(V1_6_629),
    status: "broken",
    binding: "independent",
    basis: "skse-source",
    message: "disabled, only compatible with versions earlier than 1.6.629",
    reason: /1\.6\.629 game-structure change/,
  },
  {
    name: "…unless the plugin declares it handles the new layout",
    info: dll({ data: { versionIndependence: AL | S629 } }),
    ctx: ctx(V1_6_629),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "…or declares it doesn't use game structs at all",
    info: dll({ data: { versionIndependence: AL, versionIndependenceEx: NO_STRUCTS } }),
    ctx: ctx(V1_6_629),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "a plugin pinned to exact versions isn't held to the structure rule",
    info: dll({ data: { compatibleVersions: [V1_6_629] } }),
    ctx: ctx(V1_6_629),
    status: "ok",
    binding: "pinned",
    basis: "skse-source",
    pinnedTo: ["1.6.629.0"],
  },

  // ── Plugins pinned to exact game versions ──
  {
    name: "pinned plugin that lists the installed version",
    info: dll({ data: { compatibleVersions: [R5, R6] } }),
    ctx: ctx(R6),
    status: "ok",
    binding: "pinned",
    basis: "skse-source",
    reason: /lists 1\.6\.1170\.0/,
    pinnedTo: ["1.5.97.0", "1.6.1170.0"],
  },
  {
    name: "pinned plugin that doesn't",
    info: dll({ data: { compatibleVersions: [R5] } }),
    ctx: ctx(R6),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, incompatible with current version of the game",
    reason: /pinned to specific game versions \(1\.5\.97\.0\) and 1\.6\.1170\.0 isn't one of them/,
    pinnedTo: ["1.5.97.0"],
  },
  {
    name: "pinned plugin that lists no versions at all",
    info: dll({ data: {} }),
    ctx: ctx(R6),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, incompatible with current version of the game",
    reason: /lists none/,
    pinnedTo: [],
  },
  {
    name: "the structure flag on its own is not version independence",
    info: dll({ data: { versionIndependence: S629 } }),
    ctx: ctx(R6),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, incompatible with current version of the game",
    pinnedTo: [],
  },
  {
    name: "pinned plugin that lists 1.7.104, on that game: SKSE 2.3.1's own rule",
    info: dll({ data: { compatibleVersions: [R7] } }),
    ctx: ctx(R7),
    status: "ok",
    binding: "pinned",
    basis: "skse-source",
    pinnedTo: ["1.7.104.0"],
  },

  // ── The script extender version a plugin demands ──
  {
    name: "plugin needs a newer SKSE than is installed",
    info: dll({ data: { versionIndependence: AL | S629, seVersionRequired: v(2, 3, 0) } }),
    ctx: ctx(R6, { skse: v(2, 2, 6) }),
    status: "broken",
    binding: "independent",
    basis: "skse-source",
    message: "disabled, requires newer script extender",
    reason: /SKSE 2\.3\.0 or newer; the installed build is 2\.2\.6/,
  },
  {
    name: "plugin needs exactly the installed SKSE",
    info: dll({ data: { versionIndependence: AL | S629, seVersionRequired: v(2, 2, 6) } }),
    ctx: ctx(R6, { skse: v(2, 2, 6) }),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "installed SKSE version unknown: not held against the plugin",
    info: dll({ data: { versionIndependence: AL | S629, seVersionRequired: v(9, 9, 9) } }),
    ctx: ctx(R6),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },

  // ── SKSE's order: the first rule a plugin breaks is the one it is told about ──
  {
    name: "order: bad data beats a missing name",
    info: dll({ data: { dataVersion: 0, name: "" } }),
    ctx: ctx(R6),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, bad version data",
  },
  {
    name: "order: a missing name beats an unknown method",
    info: dll({ data: { name: "", versionIndependence: 8 } }),
    ctx: ctx(R6),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, no name specified",
  },
  {
    name: "order: an unknown method beats a missing Address Library",
    info: dll({ data: { versionIndependence: 8 | AL } }),
    ctx: ctx(R6, { al: { present: false } }),
    status: "broken",
    binding: "independent",
    basis: "skse-source",
    message: "disabled, unsupported version independence method",
  },
  {
    name: "order: a missing Address Library beats the structure rule",
    info: dll({ data: { versionIndependence: AL } }),
    ctx: ctx(R6, { al: { present: false } }),
    status: "broken",
    binding: "independent",
    basis: "skse-source",
    message: "disabled, address library needs to be updated",
  },
  {
    name: "order: a pinned mismatch beats a too-new SKSE requirement",
    info: dll({ data: { compatibleVersions: [R5], seVersionRequired: v(2, 9, 0) } }),
    ctx: ctx(R6, { skse: v(2, 2, 6) }),
    status: "broken",
    binding: "pinned",
    basis: "skse-source",
    message: "disabled, incompatible with current version of the game",
    pinnedTo: ["1.5.97.0"],
  },

  // ── Where SKSE's source stops: the published builds are for 1.5.97, 1.6.x, 1.7.99 and 1.7.104 ──
  {
    name: "a pass on 1.7.104 rests on SKSE 2.3.1's source",
    info: dll({ data: { versionIndependence: AL | S629, versionIndependenceEx: V5 } }),
    ctx: ctx(R7),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "a pass past 1.7.104 is a prediction",
    info: dll({ data: { versionIndependence: AL | S629, versionIndependenceEx: V5 } }),
    ctx: ctx(R7_NEXT),
    status: "ok",
    binding: "independent",
    basis: "inferred",
  },
  {
    name: "a pass on the last 1.6.x build SKSE can encode still rests on SKSE's source",
    info: dll({ data: { versionIndependence: AL | S629 } }),
    ctx: ctx(v(1, 6, 4095)),
    status: "ok",
    binding: "independent",
    basis: "skse-source",
  },
  {
    name: "a pass on 1.7.0 is a prediction",
    info: dll({ data: { versionIndependence: AL | S629 } }),
    ctx: ctx(V1_7_0),
    status: "ok",
    binding: "independent",
    basis: "inferred",
  },
  {
    name: "a refusal on 1.7.0 is a prediction too",
    info: dll({ data: { compatibleVersions: [R6] } }),
    ctx: ctx(V1_7_0),
    status: "broken",
    binding: "pinned",
    basis: "inferred",
    message: "disabled, incompatible with current version of the game",
    pinnedTo: ["1.6.1170.0"],
  },
];

for (const c of CASES) {
  test(c.name, () => {
    const got = assessPlugin(c.info, c.ctx);
    assert.equal(got.status, c.status, `status (reason: ${got.reason})`);
    assert.equal(got.binding, c.binding, "binding");
    assert.equal(got.basis, c.basis, "basis");
    assert.equal(got.skseMessage, c.message, "SKSE's log text");
    if (c.reason) assert.match(got.reason, c.reason);
    if (c.pinnedTo) assert.deepEqual(got.pinnedTo, c.pinnedTo, "pinnedTo");
    assert.ok(got.reason.length > 0);
  });
}

test("every refusal that carries SKSE's log text is marked broken, and nothing else carries it", () => {
  // The one broken result that is not one of SKSE's own refusals is the old
  // Address Library format on 1.7.99, which SKSE 2.3.0 loads without a word.
  for (const c of CASES) {
    const got = assessPlugin(c.info, c.ctx);
    const loadedAnyway = /SKSE 2\.3\.0 doesn't check this/.test(got.reason);
    assert.equal(got.skseMessage !== undefined, got.status === "broken" && !loadedAnyway, c.name);
  }
});

test("no rule rests on field reports any more: the Address Library format change is in SKSE 2.3.1's source", () => {
  for (const c of CASES) assert.notEqual(assessPlugin(c.info, c.ctx).basis, "field-reports", c.name);
});

test("skseSourceFor: the published SKSE build for each game version, and where none was made for it", () => {
  assert.deepEqual(skseSourceFor(R5), { build: "2.0.20", covered: true });
  assert.deepEqual(skseSourceFor(v(1, 5, 80)), { build: "2.0.20", covered: false });
  assert.deepEqual(skseSourceFor(R6), { build: "2.2.8", covered: true });
  assert.deepEqual(skseSourceFor(V1_7_99), { build: "2.3.0", covered: true });
  assert.deepEqual(skseSourceFor(R7), { build: "2.3.1", covered: true });
  assert.deepEqual(skseSourceFor(R7_NEXT), { build: "2.3.1", covered: false });
  assert.deepEqual(skseSourceFor(V1_7_0), { build: "2.3.1", covered: false });
});

test("a refusal's reason never promises more than the rule says", () => {
  // Reasons are shown to people deciding whether to patch; none should say a
  // plugin "will" crash the game or is "safe" — only what SKSE does with it.
  for (const c of CASES) {
    const { reason } = assessPlugin(c.info, c.ctx);
    assert.doesNotMatch(reason, /\bwill crash\b|\bis safe\b|\bsafe to\b/i, c.name);
  }
});

// ─── How a plugin ties itself to game versions (the next patch) ──────────────

test("bindingOf: Address Library or signatures make a plugin independent; neither makes it pinned", () => {
  assert.equal(bindingOf(dll({ data: { versionIndependence: AL } })), "independent");
  assert.equal(bindingOf(dll({ data: { versionIndependence: SIG } })), "independent");
  assert.equal(bindingOf(dll({ data: { versionIndependence: AL | SIG | S629 } })), "independent");
  assert.equal(bindingOf(dll({ data: { versionIndependence: S629 } })), "pinned");
  assert.equal(bindingOf(dll({ data: { versionIndependence: 0 } })), "pinned");
});

test("bindingOf: SE-era entry points mean legacy; nothing SKSE looks for means none", () => {
  assert.equal(bindingOf(dll({ exports: { query: true } })), "legacy");
  assert.equal(bindingOf(dll({ exports: { load: false, preload: true } })), "legacy");
  assert.equal(bindingOf(dll({ exports: NOTHING })), "none");
});

test("bindingOf: version data that couldn't be read is unknown, not legacy", () => {
  assert.equal(bindingOf(dll({ exports: { version: true }, problem: "points outside the file" })), "none");
});

test("bindingOf: an Address Library plugin built for the format used before 1.7.99 is pinned, since SKSE 2.3.1 holds it to its list", () => {
  assert.equal(bindingOf(dll({ data: { versionIndependence: AL | S629 }, buildTime: BUILT_2024 })), "pinned");
  assert.equal(bindingOf(dll({ data: { versionIndependence: AL | SIG }, buildTime: BUILT_2024 })), "pinned");
  assert.equal(bindingOf(dll({ data: { versionIndependence: AL | S629 }, buildTime: CUTOFF })), "independent");
  assert.equal(bindingOf(dll({ data: { versionIndependence: AL | S629, versionIndependenceEx: V5 }, buildTime: BUILT_2024 })), "independent");
  assert.equal(bindingOf(dll({ data: { versionIndependence: SIG | S629 }, buildTime: BUILT_2024 })), "independent");
});

// ─── The headline ────────────────────────────────────────────────────────────

const BASE: DecisionInput = {
  gameName: "Skyrim Special Edition",
  version: "1.6.1170.0",
  whatIf: false,
  skse: { installed: true, loader: "skse64_loader.exe", dll: "skse64_1_6_1170.dll", dllPresent: true },
  addressLibrary: { file: "versionlib-1-6-1170-0.bin", present: true, pluginsNeedingIt: 1 },
  counts: { total: 3, ok: 3, broken: 0, unclear: 0 },
  beyondSource: false,
  steamUpdatePending: false,
  log: null,
};
const input = (o: Partial<DecisionInput>): DecisionInput => ({ ...BASE, ...o });

test("decide: everything passing is a GO that says what a GO means", () => {
  const d = decide(BASE);
  assert.equal(d.verdict, "go");
  assert.equal(
    d.headline,
    "GO — Skyrim Special Edition 1.6.1170.0: SKSE build present, Address Library present, all 3 plugins pass SKSE's own checks. " +
      "That is what can be checked from files; it can't prove the game runs."
  );
  assert.deepEqual(d.reasons, []);
});

test("decide: one plugin, no Address Library involved, and no plugins at all read naturally", () => {
  const one = decide(
    input({ counts: { total: 1, ok: 1, broken: 0, unclear: 0 }, addressLibrary: { ...BASE.addressLibrary, pluginsNeedingIt: 0 } })
  );
  assert.match(one.headline, /SKSE build present, the 1 plugin passes SKSE's own checks\./);
  const none = decide(input({ counts: { total: 0, ok: 0, broken: 0, unclear: 0 }, addressLibrary: { ...BASE.addressLibrary, pluginsNeedingIt: 0 } }));
  assert.equal(none.verdict, "go");
  assert.match(none.headline, /SKSE build present, no plugins to check\./);
});

test("decide: no script extender and no plugins means nothing here for an update to break", () => {
  const d = decide(
    input({
      skse: { installed: false, loader: "skse64_loader.exe", dll: "skse64_1_6_1170.dll", dllPresent: false },
      counts: { total: 0, ok: 0, broken: 0, unclear: 0 },
      addressLibrary: { ...BASE.addressLibrary, pluginsNeedingIt: 0, present: false },
    })
  );
  assert.equal(d.verdict, "go");
  assert.match(d.headline, /no script extender and no SKSE plugins are installed/);
  assert.doesNotMatch(d.headline, /SKSE build present/);
  assert.match(d.headline, /aren't SKSE plugins aren't covered/);
});

test("decide: plugins with no script extender to load them are a CHECK, not a GO", () => {
  const skse = { installed: false, loader: "skse64_loader.exe", dll: "skse64_1_6_1170.dll", dllPresent: false };
  const two = decide(input({ skse, counts: { total: 2, ok: 2, broken: 0, unclear: 0 } }));
  assert.equal(two.verdict, "check");
  assert.equal(
    two.headline,
    "CHECK — Skyrim Special Edition 1.6.1170.0: 2 SKSE plugins are installed but the script extender isn't (no skse64_loader.exe next to the game), so they aren't loading now."
  );
  assert.deepEqual(two.reasons, ["skse64_loader.exe not found next to the game executable"]);
  const one = decide(input({ skse, counts: { total: 1, ok: 1, broken: 0, unclear: 0 } }));
  assert.match(one.headline, /1 SKSE plugin is installed but .* so it isn't loading now\./);
});

test("decide: SKSE installed but no build for this game version is a WAIT", () => {
  const skse = { installed: true, loader: "skse64_loader.exe", dll: "skse64_1_7_104.dll", dllPresent: false };
  const now = decide(input({ version: "1.7.104.0", skse }));
  assert.equal(now.verdict, "wait");
  assert.match(now.headline, /^WAIT — Skyrim Special Edition 1\.7\.104\.0: SKSE is installed but has no build for this game version \(skse64_1_7_104\.dll is missing\)/);
  assert.deepEqual(now.reasons, ["skse64_1_7_104.dll not found next to the game executable"]);

  const ahead = decide(input({ version: "1.7.104.0", whatIf: true, skse }));
  assert.equal(ahead.verdict, "wait");
  assert.match(ahead.headline, /^WAIT — If you update Skyrim Special Edition to 1\.7\.104\.0: SKSE has no build for it installed \(skse64_1_7_104\.dll is missing\)/);
  // SKSE's loader refuses every game version but its own, so the new build can't be put in place early.
  assert.match(ahead.headline, /SKSE's loader starts only the game version it was built for, so the build for 1\.7\.104\.0 goes in after the update/);
  assert.doesNotMatch(ahead.headline, /before updating|next to the old one|picks its DLL/);
});

test("decide: plugins that need an Address Library file that isn't there are a WAIT", () => {
  const lib = { file: "versionlib-1-7-104-0.bin", present: false };
  const many = decide(input({ addressLibrary: { ...lib, pluginsNeedingIt: 4 } }));
  assert.equal(many.verdict, "wait");
  assert.match(many.headline, /4 plugins need the Address Library file for this game version \(versionlib-1-7-104-0\.bin\) and it isn't installed\./);
  const one = decide(input({ addressLibrary: { ...lib, pluginsNeedingIt: 1 } }));
  assert.match(one.headline, /1 plugin needs the Address Library file/);
  assert.deepEqual(one.reasons, ["versionlib-1-7-104-0.bin not found in the plugin folders"]);
  const noneNeedIt = decide(input({ addressLibrary: { ...lib, pluginsNeedingIt: 0 } }));
  assert.equal(noneNeedIt.verdict, "go", "a missing file nobody needs is not a problem");
});

test("decide: a missing SKSE build outranks everything else", () => {
  const d = decide(
    input({
      skse: { installed: true, loader: "skse64_loader.exe", dll: "skse64_1_7_104.dll", dllPresent: false },
      addressLibrary: { file: "x.bin", present: false, pluginsNeedingIt: 3 },
      counts: { total: 3, ok: 0, broken: 3, unclear: 0 },
      steamUpdatePending: true,
    })
  );
  assert.equal(d.verdict, "wait");
  assert.match(d.headline, /skse64_1_7_104\.dll is missing/);
});

test("decide: broken and unclear plugins, and a waiting Steam update, are each a reason to CHECK", () => {
  const broken = decide(input({ counts: { total: 3, ok: 1, broken: 2, unclear: 0 } }));
  assert.equal(broken.verdict, "check");
  assert.equal(broken.headline, "CHECK — Skyrim Special Edition 1.6.1170.0: 2 plugins would be refused or fail.");
  assert.deepEqual(broken.reasons, ["2 plugins would be refused or fail"]);

  const oneBroken = decide(input({ counts: { total: 3, ok: 2, broken: 1, unclear: 0 } }));
  assert.deepEqual(oneBroken.reasons, ["1 plugin would be refused or fail"]);

  const unclear = decide(input({ counts: { total: 3, ok: 2, broken: 0, unclear: 1 } }));
  assert.equal(unclear.verdict, "check");
  assert.deepEqual(unclear.reasons, ["1 plugin couldn't be judged"]);

  const steam = decide(input({ steamUpdatePending: true }));
  assert.equal(steam.verdict, "check");
  assert.deepEqual(steam.reasons, ["Steam has a game update waiting"]);
});

test("decide: no loader, or a loader from another SKSE build than the DLL, is a CHECK; a matching pair is no reason at all", () => {
  const skse = { ...BASE.skse, loaderPresent: true, dllVersion: "2.2.6" };
  const missing = decide(input({ skse: { ...skse, loaderPresent: false } }));
  assert.equal(missing.verdict, "check");
  assert.deepEqual(missing.reasons, ["skse64_loader.exe isn't next to the game, and SKSE starts through it"]);
  const mixed = decide(input({ skse: { ...skse, loaderVersion: "2.3.1" } }));
  assert.equal(mixed.verdict, "check");
  assert.match(mixed.reasons[0]!, /^skse64_loader\.exe is from SKSE 2\.3\.1 but skse64_1_6_1170\.dll is from SKSE 2\.2\.6/);
  assert.equal(decide(input({ skse: { ...skse, loaderVersion: "2.2.6" } })).verdict, "go");
  assert.equal(decide(input({ skse: { ...skse } })).verdict, "go", "a loader whose version couldn't be read isn't held against it");
});

test("decide: Mod Organizer 2's mods left unread is a reason to CHECK, never a GO", () => {
  const d = decide(input({ mo2Unread: true }));
  assert.equal(d.verdict, "check");
  assert.deepEqual(d.reasons, ["Mod Organizer 2's mods couldn't be read, so the plugins installed through it weren't checked"]);
});

test("decide: several reasons are listed together, in a stable order", () => {
  const d = decide(
    input({ counts: { total: 4, ok: 1, broken: 2, unclear: 1 }, steamUpdatePending: true })
  );
  assert.equal(
    d.headline,
    "CHECK — Skyrim Special Edition 1.6.1170.0: 2 plugins would be refused or fail; 1 plugin couldn't be judged; Steam has a game update waiting."
  );
});

test("decide: what SKSE itself logged is weighed against the file check", () => {
  const disagree = decide(input({ log: { fresh: true, refusals: 1, disagreements: 1 } }));
  assert.equal(disagree.verdict, "check");
  assert.deepEqual(disagree.reasons, ["SKSE's own log from the last launch disagrees with these predictions"]);

  const onlyLog = decide(input({ log: { fresh: true, refusals: 2, disagreements: 0 } }));
  assert.equal(onlyLog.verdict, "check");
  assert.deepEqual(onlyLog.reasons, ["SKSE's own log from the last launch reports refused plugins"]);

  // A refusal the file check already predicted adds nothing beyond the count.
  const predicted = decide(
    input({ counts: { total: 3, ok: 2, broken: 1, unclear: 0 }, log: { fresh: true, refusals: 1, disagreements: 0 } })
  );
  assert.deepEqual(predicted.reasons, ["1 plugin would be refused or fail"]);

  const clean = decide(input({ log: { fresh: true, refusals: 0, disagreements: 0 } }));
  assert.equal(clean.verdict, "go");
});

test("decide: a log from before the last patch describes a different game, so its refusals don't count", () => {
  const stale = decide(input({ log: { fresh: false, refusals: 2, disagreements: 1 } }));
  assert.equal(stale.verdict, "go");
  assert.deepEqual(stale.reasons, []);
});

test("decide: on a game version SKSE has published no source for, a GO needs SKSE's own clean log", () => {
  const beyond = { version: "1.7.110.0", beyondSource: true };
  const asked = (log: DecisionInput["log"]) => decide(input({ ...beyond, log }));

  for (const [label, log] of [
    ["no log", null],
    ["a stale log", { fresh: false, refusals: 0, disagreements: 0 }],
    ["a fresh log that lists refusals", { fresh: true, refusals: 1, disagreements: 0 }],
  ] as Array<[string, DecisionInput["log"]]>) {
    const d = asked(log);
    assert.equal(d.verdict, "check", label);
    assert.ok(d.reasons.some((r) => /SKSE hasn't published its source for this game version/.test(r)), label);
  }
  const clean = asked({ fresh: true, refusals: 0, disagreements: 0 });
  assert.equal(clean.verdict, "go");
  assert.deepEqual(clean.reasons, []);
});

test("decide: a what-if names the version it is about", () => {
  const d = decide(
    input({ version: "1.7.104.0", whatIf: true, beyondSource: true, counts: { total: 2, ok: 1, broken: 1, unclear: 0 } })
  );
  assert.equal(d.verdict, "check");
  assert.match(d.headline, /^CHECK — If you update Skyrim Special Edition to 1\.7\.104\.0: 1 plugin would be refused or fail; /);
});

test("decide: no headline calls anything safe", () => {
  const inputs: DecisionInput[] = [
    BASE,
    input({ counts: { total: 0, ok: 0, broken: 0, unclear: 0 } }),
    input({ steamUpdatePending: true }),
    input({ beyondSource: true }),
    input({ skse: { installed: false, loader: "a", dll: "b", dllPresent: false } }),
    input({ skse: { installed: true, loader: "a", dll: "b", dllPresent: false } }),
  ];
  for (const i of inputs) {
    assert.doesNotMatch(decide(i).headline, /\bsafe\b/i, decide(i).headline);
  }
});

// ─── How sure the answer is ──────────────────────────────────────────────────
// Three kinds of evidence, in plain words: SKSE's own log from a launch (a fact),
// the files read through SKSE's published rules (a strong prediction), and a
// what-if or a game version SKSE's rules aren't public for (a guess built on the
// nearest thing known). Each has to be named as what it is.

const sure = (o: Partial<ConfidenceInput> = {}) =>
  describeConfidence({ whatIf: false, version: "1.6.1170.0", beyondSource: false, log: null, flagged: [], ...o });

test("confidence: SKSE's own log from after the last patch is the strongest evidence, and its counts are quoted", () => {
  const c = sure({ log: { fresh: true, loaded: 12, refusals: 0, disagreements: 0 } });
  assert.equal(c.evidence, "log");
  assert.equal(
    c.summary,
    "Backed by SKSE's own log from a launch after the last patch: 12 plugins loaded, 0 refused. That is the strongest evidence there is."
  );
  assert.equal(
    sure({ log: { fresh: true, loaded: 1, refusals: 2, disagreements: 1 } }).summary,
    "Backed by SKSE's own log from a launch after the last patch: 1 plugin loaded, 2 refused, including 1 the file check had passed. That is the strongest evidence there is."
  );
});

test("confidence: a log from before the last patch describes a different game and isn't evidence", () => {
  const c = sure({ log: { fresh: false, loaded: 5, refusals: 0, disagreements: 0 } });
  assert.equal(c.evidence, "files");
  assert.doesNotMatch(c.summary, /Backed by/);
});

test("confidence: files read through SKSE's published rules say that is all they are, and name the build", () => {
  const c = sure();
  assert.equal(c.evidence, "files");
  assert.match(c.summary, /^From the files only, using SKSE 2\.2\.8's own rules/);
  assert.match(c.summary, /log from a launch would confirm it/);
  assert.match(sure({ version: "1.7.104.0" }).summary, /^From the files only, using SKSE 2\.3\.1's own rules/);
  assert.match(sure({ version: "1.7.99.0" }).summary, /^From the files only, using SKSE 2\.3\.0's own rules/);
});

test("confidence: on 1.5.97 it names SKSE 2.0.20 and says each plugin's own SKSEPlugin_Query has a say files can't show", () => {
  const c = sure({ version: "1.5.97.0" });
  assert.equal(c.evidence, "files");
  assert.match(c.summary, /^From the files only, using SKSE 2\.0\.20's own rules/);
  assert.match(c.summary, /SKSEPlugin_Query.*files can't show/);
});

test("confidence: on a game version SKSE has published no source for it is a prediction, and says whose rules it borrowed", () => {
  const c = sure({ beyondSource: true, version: "1.7.110.0" });
  assert.equal(c.evidence, "prediction");
  assert.match(c.summary, /^A prediction: SKSE hasn't published its source for this game version/);
  assert.match(c.summary, /rules of SKSE 2\.3\.1, the nearest published build/);
  // A clean, fresh log is the thing that turns that prediction into evidence.
  assert.equal(sure({ beyondSource: true, log: { fresh: true, loaded: 3, refusals: 0, disagreements: 0 } }).evidence, "log");
});

test("confidence: a what-if is a prediction even when a log was read, and names the version it is about", () => {
  const c = sure({ whatIf: true, version: "1.7.110.0", beyondSource: true, log: { fresh: true, loaded: 9, refusals: 0, disagreements: 0 } });
  assert.equal(c.evidence, "prediction");
  assert.match(c.summary, /^A what-if, not a fact: .* against 1\.7\.110\.0, and nothing changes until you update\./);
  assert.match(c.summary, /SKSE hasn't published its source for that version, so it applies the rules of SKSE 2\.3\.1/);
  const older = sure({ whatIf: true, version: "1.6.1179.0" });
  assert.match(older.summary, /It uses SKSE 2\.2\.8's own rules\./);
  const published = sure({ whatIf: true, version: "1.7.104.0" });
  assert.match(published.summary, /It uses SKSE 2\.3\.1's own rules\./);
});

test("confidence: the basis counts say what the flagged plugins' reasons rest on", () => {
  const bases: RuleBasis[] = ["skse-source", "inferred", "skse-source", "field-reports", "inferred", "inferred"];
  assert.deepEqual(sure({ flagged: bases }).basis, { "skse-source": 2, "f4se-source": 0, "field-reports": 1, inferred: 3 });
  assert.deepEqual(sure().basis, { "skse-source": 0, "f4se-source": 0, "field-reports": 0, inferred: 0 });
});

test("confidence: no sentence calls anything safe", () => {
  const inputs: ConfidenceInput[] = [
    { whatIf: false, version: "1.6.1170.0", beyondSource: false, log: null, flagged: [] },
    { whatIf: false, version: "1.5.97.0", beyondSource: false, log: null, flagged: [] },
    { whatIf: false, version: "1.7.110.0", beyondSource: true, log: null, flagged: [] },
    { whatIf: true, version: "1.7.110.0", beyondSource: true, log: null, flagged: [] },
    { whatIf: false, version: "1.6.1170.0", beyondSource: false, log: { fresh: true, loaded: 2, refusals: 0, disagreements: 0 }, flagged: [] },
  ];
  for (const i of inputs) assert.doesNotMatch(describeConfidence(i).summary, /\bsafe\b/i);
});
