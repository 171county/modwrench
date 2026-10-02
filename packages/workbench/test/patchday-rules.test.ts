import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessPlugin,
  bindingOf,
  decide,
  V1_6_629,
  V1_7_0,
  V1_7_99,
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

/** A DLL as `inspectSksePlugin` would describe it. `data` present = it exports SKSEPlugin_Version. */
function dll(o: {
  readable?: boolean;
  problem?: string;
  is64?: boolean;
  exports?: Partial<SkseDllInfo["exports"]>;
  data?: Partial<SkseVersionData>;
} = {}): SkseDllInfo {
  const info: SkseDllInfo = {
    readable: o.readable ?? true,
    is64: o.is64 ?? true,
    exports: { version: o.data !== undefined, query: false, load: true, preload: false, ...o.exports },
  };
  if (o.problem !== undefined) info.problem = o.problem;
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

/** A game version; by default the Address Library file for it is present, in the format that era used. */
function ctx(
  runtime: number,
  o: { skse?: number; al?: { present: boolean; format?: number } } = {}
): RuntimeContext {
  return {
    runtime,
    ...(o.skse !== undefined ? { skseVersion: o.skse } : {}),
    addressLibrary: o.al ?? { present: true, format: runtime >= V1_7_99 ? 5 : 2 },
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

  // ── Skyrim 1.5.97: the SE-era script extender, which loads through SKSEPlugin_Query ──
  {
    name: "1.5.97: a plugin with the SE-era entry point is fine",
    info: dll({ exports: { query: true } }),
    ctx: ctx(R5),
    status: "ok",
    binding: "legacy",
    basis: "inferred",
    reason: /SE-era plugin.*1\.5\.97.*1\.6\+/,
  },
  {
    name: "1.5.97: a plugin carrying both generations of entry point is fine",
    info: dll({ exports: { query: true }, data: { versionIndependence: AL, versionIndependenceEx: V5 } }),
    ctx: ctx(R5),
    status: "ok",
    binding: "independent",
    basis: "inferred",
    reason: /both SE and AE/,
  },
  {
    name: "1.5.97: version data with no query entry point is unclear, not condemned",
    info: dll({ data: {} }),
    ctx: ctx(R5),
    status: "unclear",
    binding: "pinned",
    basis: "inferred",
    reason: /SKSEPlugin_Query.*unverified/,
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
    name: "the same refusal on 1.7.x is a prediction, and says so",
    info: dll({ exports: { query: true } }),
    ctx: ctx(R7),
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
    basis: "inferred",
    reason: /signature scanning/,
  },

  // ── Address Library format 5 (reported on Skyrim 1.7.104): a field report, not SKSE source ──
  {
    name: "format-5 Address Library, plugin without the format-5 flag",
    info: dll({ data: { versionIndependence: AL | S629 } }),
    ctx: ctx(R7, { al: { present: true, format: 5 } }),
    status: "broken",
    binding: "independent",
    basis: "field-reports",
    reason: /fail on 1\.7\.104\.0 with "Unsupported address library format: 5"/,
  },
  {
    name: "format-5 Address Library, plugin that declares format 5",
    info: dll({ data: { versionIndependence: AL | S629, versionIndependenceEx: V5 } }),
    ctx: ctx(R7, { al: { present: true, format: 5 } }),
    status: "ok",
    binding: "independent",
    basis: "inferred",
  },
  {
    name: "format number unreadable, game exactly 1.7.99: assumes the newest format, and says it is assuming",
    info: dll({ data: { versionIndependence: AL | S629 } }),
    ctx: ctx(V1_7_99, { al: { present: true } }),
    status: "broken",
    binding: "independent",
    basis: "inferred",
    reason: /format number couldn't be read, so this assumes the newest format/,
  },
  {
    name: "format unknown, game 1.7.98: assumed the older format",
    info: dll({ data: { versionIndependence: AL | S629 } }),
    ctx: ctx(v(1, 7, 98), { al: { present: true } }),
    status: "ok",
    binding: "independent",
    basis: "inferred",
  },
  {
    name: "the file's own format number outranks the game-version guess",
    info: dll({ data: { versionIndependence: AL | S629 } }),
    ctx: ctx(R7, { al: { present: true, format: 2 } }),
    status: "ok",
    binding: "independent",
    basis: "inferred",
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
    name: "pinned plugin that lists a 1.7.x game, on that game: a prediction",
    info: dll({ data: { compatibleVersions: [R7] } }),
    ctx: ctx(R7),
    status: "ok",
    binding: "pinned",
    basis: "inferred",
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

  // ── Where SKSE's source stops: 1.7.0 ──
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
  // The one broken result that is not one of SKSE's own rules is the Address
  // Library format-5 report, which has no SKSE log line to quote.
  for (const c of CASES) {
    const got = assessPlugin(c.info, c.ctx);
    const formatFive = /Unsupported address library format: 5/.test(got.reason);
    assert.equal(got.skseMessage !== undefined, got.status === "broken" && !formatFive, c.name);
  }
});

test("the format-5 refusal rests on a report when the file's format number was read, and on a guess, said aloud, when it wasn't", () => {
  const plugin = dll({ data: { versionIndependence: AL | S629 } });
  const read = assessPlugin(plugin, ctx(R7, { al: { present: true, format: 5 } }));
  const guessed = assessPlugin(plugin, ctx(R7, { al: { present: true } }));
  assert.equal(read.status, "broken");
  assert.equal(read.basis, "field-reports");
  assert.doesNotMatch(read.reason, /couldn't be read/);
  assert.equal(guessed.status, "broken");
  assert.equal(guessed.basis, "inferred");
  assert.match(guessed.reason, /format number couldn't be read/);
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

test("decide: on a game version SKSE has no public source for, a GO needs SKSE's own clean log", () => {
  const beyond = { version: "1.7.104.0", beyondSource: true };
  const asked = (log: DecisionInput["log"]) => decide(input({ ...beyond, log }));

  for (const [label, log] of [
    ["no log", null],
    ["a stale log", { fresh: false, refusals: 0, disagreements: 0 }],
    ["a fresh log that lists refusals", { fresh: true, refusals: 1, disagreements: 0 }],
  ] as Array<[string, DecisionInput["log"]]>) {
    const d = asked(log);
    assert.equal(d.verdict, "check", label);
    assert.ok(d.reasons.some((r) => /aren't public/.test(r)), label);
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
