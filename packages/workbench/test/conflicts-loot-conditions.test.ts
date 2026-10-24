import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── LOOT's conditions and messages, in the two tools that read LOOT ─────────
// As in conflicts-loot.test.ts, fetch is stubbed: Skyrim SE's answer is the
// CC0 slice of LOOT's real v0.29 list, Fallout 4's is made up for the cases the
// slice has no example of. The crash logs are built here, in Crash Logger SSE's
// and Buffout 4's layout, with or without the count Crash Logger SSE writes
// above its plugin list.

delete process.env["LOOT_BRANCH"];
const { checkKnownConflicts } = await import("../src/conflicts/index.js");
const { registerWorkbenchTools } = await import("../src/register.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const SKYRIM = readFileSync(resolve(HERE, "fixtures", "loot-skyrimse-v0.29.yaml"), "utf8");
const FALLOUT = [
  "plugins:",
  "  - name: 'Base.esp'",
  "    inc:",
  "      - name: 'Third.esp'",
  "        condition: 'active(\"Fourth.esp\")'",
  "    msg:",
  "      - type: say",
  `        content: 'Always shown, with [a link](https://example.test/a) and **bold**: "quoted".'`,
  "      - type: error",
  "        content: 'An error, shown as a warning.'",
  "      - type: warn",
  "        content: [ { lang: de, text: 'Nur auf Deutsch.' } ]",
  "      - type: say",
  "        content: [ { lang: de, text: 'Auf Deutsch.' }, { lang: en, text: 'English, from a list.' } ]",
  "      - type: say",
  "        content: 'Uses {0} and {1}, but {2} has no substitution.'",
  "        subs: [ 'first', '**second**' ]",
  "      - type: say",
  "        content: 'Shown when Fourth.esp is active.'",
  "        condition: 'active(\"Fourth.esp\")'",
  "      - type: warn",
  "        content: 'Shown when Fourth.esp is inactive, which only a whole list can say.'",
  "        condition: 'not active(\"Fourth.esp\")'",
  "      - type: say",
  "        content: 'Never shown: its condition needs the game files.'",
  "        condition: 'version(\"Base.esp\", \"2.0\", >=)'",
  "      - type: say",
  "        content: 'Never shown: its condition does not parse.'",
  "        condition: 'active(\"Base.esp\") and'",
  "      - content: 'Never shown: it has no type.'",
  "      - type: say",
  `        content: '${"y".repeat(400)}'`,
  "      - type: say",
  '        content: "Invisible\\u200bcharacters and\\nline breaks."',
  "  - name: 'Busy.esp'",
  "    msg:",
  ...Array.from({ length: 8 }, (_, i) => `      - { type: say, content: 'Note ${i + 1}' }`),
  ...Array.from({ length: 4 }, (_, i) => `      - { type: warn, content: 'Warning ${i + 1}' }`),
  // A regex entry for the same plugin: its copy of a message is shown once.
  "  - name: 'Bus[y]\\.esp'",
  "    msg:",
  "      - { type: warn, content: 'Warning 1' }",
  "      - { type: say, content: 'From the regex entry.' }",
].join("\n");

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  if (url.includes("/loot/skyrimse/")) return new Response(SKYRIM, { status: 200 });
  if (url.includes("/loot/fallout4/")) return new Response(FALLOUT, { status: 200 });
  return new Response("404: Not Found", { status: 404 });
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

// ─── The tools, registered on a stand-in server ──────────────────────────────

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const tools = new Map<string, Handler>();
registerWorkbenchTools({
  registerTool: (name: string, _config: unknown, handler: Handler) => void tools.set(name, handler),
} as unknown as never);

type LootNotes = { about: string; notes: Array<{ plugin: string; type: string; text: string }>; omitted?: number };
type Diagnosis = { knownConflicts: Array<{ modA: string; modB: string; severity: string }>; lootNotes?: LootNotes };

async function diagnose(logContent: string, gameId: string): Promise<Diagnosis> {
  const r = await tools.get("mw_diagnose_crash")!({ logContent, gameId });
  return (JSON.parse(r.content[0]!.text) as { diagnosis: Diagnosis }).diagnosis;
}

const hex = (i: number) => i.toString(16).toUpperCase().padStart(2, "0");

/** A Crash Logger SSE log listing `plugins`, with the count it writes above them when `total` is given. */
function skyrimLog(plugins: string[], total?: number): string {
  return [
    "Skyrim SSE v1.6.1170",
    "CrashLoggerSSE v1.20.0 Feb 10 2026 04:25:35",
    'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF6D0B6E1C0 SkyrimSE.exe+10EE1C0',
    "",
    "PROBABLE CALL STACK:",
    "\t[ 0] 0x7FF6D0B6E1C0 SkyrimSE.exe+10EE1C0",
    "",
    "PLUGINS:",
    ...(total === undefined ? [] : [`\tLight: 0\tRegular: ${total}\tTotal: ${total}`]),
    ...plugins.map((p, i) => `\t[${hex(i)}]     ${p}`),
  ].join("\n");
}

/** The same for Buffout 4. */
function falloutLog(plugins: string[], total?: number): string {
  return [
    "Fallout 4 v1.10.984",
    "Buffout 4 v1.36.0",
    'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF6A1234567 Fallout4.exe+1234567',
    "",
    "PROBABLE CALL STACK:",
    "[0] 0x7FF6A1234567 Fallout4.exe+1234567",
    "",
    "PLUGINS:",
    ...(total === undefined ? [] : [`\tLight: 0\tRegular: ${total}\tTotal: ${total}`]),
    ...plugins.map((p, i) => `[${hex(i)}]     ${p}`),
  ].join("\n");
}

/** A log listing `plugins`: whole (it gives their number), without a count, and cut short (it gives a bigger one). */
const threeWays = (log: (plugins: string[], total?: number) => string, plugins: string[]) => ({
  whole: log(plugins, plugins.length),
  uncounted: log(plugins),
  cut: log(plugins, plugins.length + 50),
});

const pairs = (d: { knownConflicts: Diagnosis["knownConflicts"] } | { conflicts: Diagnosis["knownConflicts"] }) =>
  ("conflicts" in d ? d.conflicts : d.knownConflicts).map((c) => [c.modA, c.modB, c.severity]);

// ─── inc conditions ──────────────────────────────────────────────────────────

test("mw_check_known_conflicts: an inc entry whose condition is true is incompatible, false is left out, unknown is informational", async () => {
  // Fourth.esp is named, so it is active: the condition holds.
  const named = await checkKnownConflicts({ gameId: "fallout4", modIds: ["Base.esp", "Third.esp", "Fourth.esp"] });
  assert.deepEqual(pairs(named), [["Base.esp", "Third.esp", "incompatible"]]);
  assert.deepEqual(
    named.conflicts.map((c) => c.description),
    ["LOOT masterlist flags Base.esp and Third.esp as incompatible."],
    "described as an entry with no condition"
  );
  // A list someone passed in may leave plugins out, so one it doesn't name isn't known to be inactive.
  assert.deepEqual(pairs(await checkKnownConflicts({ gameId: "fallout4", modIds: ["Base.esp", "Third.esp"] })), [
    ["Base.esp", "Third.esp", "informational"],
  ]);
  // NAT and True Storms conflict only without one of the patches; with one named, the condition is false.
  const patched = await checkKnownConflicts({
    gameId: "skyrimspecialedition",
    modIds: ["NAT.esp", "TrueStormsSE.esp", "NAT_TS_Patch_TSPure.esp", "Vivid WeathersSE.esp"],
  });
  assert.deepEqual(pairs(patched), [["NAT.esp", "Vivid WeathersSE.esp", "incompatible"]]);
  // Told the list is every active plugin, the patch's absence makes it true.
  const whole = await checkKnownConflicts({ gameId: "skyrimspecialedition", modIds: ["NAT.esp", "TrueStormsSE.esp"], allActive: true });
  assert.deepEqual(pairs(whole), [["NAT.esp", "TrueStormsSE.esp", "incompatible"]]);
});

test("mw_diagnose_crash: a plugin the log doesn't list is inactive only when the log says how many it lists and lists that many", async () => {
  // 3DNPC and Open Cities conflict unless their patch is active.
  const log = threeWays(skyrimLog, ["Skyrim.esm", "3DNPC.esp", "open cities skyrim.esp"]);
  assert.deepEqual(pairs(await diagnose(log.whole, "skyrimspecialedition")), [["3DNPC.esp", "open cities skyrim.esp", "incompatible"]]);
  assert.deepEqual(pairs(await diagnose(log.uncounted, "skyrimspecialedition")), [["3DNPC.esp", "open cities skyrim.esp", "informational"]]);
  assert.deepEqual(pairs(await diagnose(log.cut, "skyrimspecialedition")), [["3DNPC.esp", "open cities skyrim.esp", "informational"]]);
  // With the patch listed, the condition is false however the list ends.
  const patched = threeWays(skyrimLog, ["Skyrim.esm", "3DNPC.esp", "open cities skyrim.esp", "Open Cities - 3DNPC Patch.esp"]);
  for (const text of Object.values(patched)) assert.deepEqual(pairs(await diagnose(text, "skyrimspecialedition")), []);
});

// ─── LOOT's messages ─────────────────────────────────────────────────────────

test("mw_diagnose_crash shows LOOT's message when its condition is true, with its substitutions, as plain text", async () => {
  const plugins = ["Skyrim.esm", "3DNPC.esp", "AI Overhaul.esp"];
  const whole = await diagnose(skyrimLog(plugins, plugins.length), "skyrimspecialedition");
  assert.deepEqual(whole.lootNotes?.notes, [
    {
      plugin: "3DNPC.esp",
      type: "note",
      text: "You seem to be using AI Overhaul, but you have not enabled a compatibility patch for this mod. A compatibility patch is provided on this plugin's mod page.",
    },
  ]);
  assert.match(whole.lootNotes?.about ?? "", /^LOOT's notes: .*not evidence about this crash\.$/);
  // Unknown (the log doesn't say it lists every plugin) and false (the patch is there) aren't shown.
  assert.equal((await diagnose(skyrimLog(plugins), "skyrimspecialedition")).lootNotes, undefined);
  const patched = [...plugins, "3DNPC - AI Overhaul Patch.esp"];
  assert.equal((await diagnose(skyrimLog(patched, patched.length), "skyrimspecialedition")).lootNotes, undefined);
});

test("LOOT's errors are shown as warnings, and many() is true for two active plugins that match", async () => {
  const plugins = ["Skyrim.esm", "MPXP1.3 [PATCH - SSkwy.LotD].esp", "RUSTIC SOULGEMS - Sorted.esp", "RUSTIC SOULGEMS - Unsorted - ESL.esp"];
  const d = await diagnose(skyrimLog(plugins, plugins.length), "skyrimspecialedition");
  assert.deepEqual(d.lootNotes?.notes, [
    // type: error, condition: not active("MPXP1\.1 ..."), which a whole list without it makes true.
    { plugin: "MPXP1.3 [PATCH - SSkwy.LotD].esp", type: "warning", text: "Requires: MPXP 1.1 ESP" },
    // type: error, condition: many("RUSTIC SOULGEMS - ..."), once for each plugin it is about.
    { plugin: "RUSTIC SOULGEMS - Sorted.esp", type: "warning", text: "Use only one RUSTIC SOULGEMS." },
    { plugin: "RUSTIC SOULGEMS - Unsorted - ESL.esp", type: "warning", text: "Use only one RUSTIC SOULGEMS." },
  ]);
});

test("LOOT's messages: English only, flattened, cut at 300 characters, warnings first, and only those whose condition is true", async () => {
  const notes = async (log: string) => (await diagnose(log, "fallout4")).lootNotes?.notes.map((n) => [n.type, n.text]);
  const always = [
    ["warning", "An error, shown as a warning."],
    ["note", "Always shown, with a link (https://example.test/a) and bold: 'quoted'."],
    ["note", "English, from a list."],
    ["note", "Uses first and second, but {2} has no substitution."],
    ["note", `${"y".repeat(299)}…`],
    ["note", "Invisible characters and line breaks."],
  ];
  const inactive = ["warning", "Shown when Fourth.esp is inactive, which only a whole list can say."];
  const active = ["note", "Shown when Fourth.esp is active."];
  const without = threeWays(falloutLog, ["Fallout4.esm", "Base.esp"]);
  assert.deepEqual(await notes(without.whole), [always[0], inactive, ...always.slice(1)]);
  assert.deepEqual(await notes(without.uncounted), always);
  assert.deepEqual(await notes(without.cut), always);
  const withFourth = ["Fallout4.esm", "Base.esp", "Fourth.esp"];
  assert.deepEqual(await notes(falloutLog(withFourth, withFourth.length)), [always[0], ...always.slice(1, 4), active, ...always.slice(4)]);
});

test("at most 10 of LOOT's messages are shown, warnings first, with the number left out, and a message two entries share is shown once", async () => {
  const d = await diagnose(falloutLog(["Fallout4.esm", "Busy.esp"]), "fallout4");
  assert.deepEqual(
    d.lootNotes?.notes.map((n) => n.text),
    ["Warning 1", "Warning 2", "Warning 3", "Warning 4", "Note 1", "Note 2", "Note 3", "Note 4", "Note 5", "Note 6"]
  );
  // Note 7, Note 8 and the regex entry's own note.
  assert.equal(d.lootNotes?.omitted, 3);
});

test("mw_check_known_conflicts never carries LOOT's messages", async () => {
  const r = await tools.get("mw_check_known_conflicts")!({ gameId: "fallout4", modIds: ["Base.esp", "Busy.esp", "Fourth.esp"] });
  const text = r.content[0]!.text;
  assert.doesNotMatch(text, /lootNotes|Always shown|Warning 1/);
  assert.equal((await checkKnownConflicts({ gameId: "fallout4", modIds: ["Base.esp", "Busy.esp"] })).lootNotes, undefined);
});
