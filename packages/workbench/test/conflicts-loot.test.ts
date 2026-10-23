import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── LOOT's masterlist, as the known-conflict check reads it ─────────────────
// mw_check_known_conflicts, and mw_diagnose_crash with a gameId, fetch LOOT's
// masterlist from GitHub. Here fetch is stubbed. Skyrim SE's answer is a slice of
// the real v0.29 list (fixtures/loot-skyrimse-v0.29.yaml, CC0, with its source
// named at the top); Fallout 4's is made up for the cases the real list has no
// example of. Four more repos stand in for the fetch's limits: two that stall,
// and lists of 8 and 16 MB. Every other repo answers 404, as GitHub does for a
// list that doesn't exist.

// The branch is read from LOOT_BRANCH when the module loads, so it's cleared first.
delete process.env["LOOT_BRANCH"];
const { checkKnownConflicts } = await import("../src/conflicts/index.js");
const { fetchLootMasterlist } = await import("../src/conflicts/loot.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const SKYRIM = readFileSync(resolve(HERE, "fixtures", "loot-skyrimse-v0.29.yaml"), "utf8");
const FALLOUT = [
  "plugins:",
  // A regex JavaScript can't read: the entry is skipped and the rest of the list still counts.
  "  - name: 'Bad(\\.esp'",
  "    inc: [ 'Other.esp' ]",
  "  - name: 'Example.esm'",
  "    inc:",
  "      - 'Other.esp'",
  "      - name: 'Noted.esp'",
  "        display: '[Noted Mod](https://example.test/noted) **v2**'",
  "        detail:",
  "          - lang: de",
  "            text: 'Nur `Version 2`.'",
  "          - lang: en",
  '            text: "Only `version 2`:\\n\\nsee \\"the notes\\" first."',
  "      - name: 'German.esp'",
  "        detail: [ { lang: de, text: 'Nur auf Deutsch.' } ]",
  "      - name: 'Long.esp'",
  `        detail: '${"x".repeat(400)}'`,
  "      - name: 'Quoted.esp'",
  '        condition: "active(\\"Quoted.esp\\")\\nand `rm -rf`"',
  // A regex by its backslash alone, matching the same plugin as the exact entry above.
  "  - name: 'Example\\.esm'",
  "    inc: [ 'Other.esp', 'Second.esp' ]",
  // The same pair again, from the other side.
  "  - name: 'Other.esp'",
  "    inc: [ 'Example.esm' ]",
  // Brackets, parentheses, dots and a plus, but none of : \ * ? |, so not a regex.
  "  - name: 'Weird (Name) [v1.2] + more.esp'",
  "    inc: [ 'Other.esp' ]",
  // LOOT anchors it as ^Alpha|Beta\.esp$, so it matches any name that starts with Alpha.
  "  - name: 'Alpha|Beta\\.esp'",
  "    inc: [ 'Other.esp' ]",
].join("\n");

const MB = 1024 * 1024;
/** A YAML comment line of `n` bytes, newline included. */
const commentLine = (n: number): Uint8Array => new TextEncoder().encode(n < 2 ? "\n" : "#" + "x".repeat(n - 2) + "\n");
const PAD = commentLine(65_536);

/** A connection that never finishes on its own: it ends only when the fetch's signal does. */
function stalled(signal: AbortSignal | null | undefined, sendsHeaders: boolean): Promise<Response> {
  if (!signal) return Promise.reject(new Error("no signal: this fetch would wait for ever"));
  if (!sendsHeaders) return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("plugins:\n"));
      signal.addEventListener("abort", () => controller.error(signal.reason));
    },
  });
  return Promise.resolve(new Response(body, { status: 200 }));
}

/** Fallout 4's list naming a conflict, then comment lines up to `total` bytes, counting what was sent. */
const padded = { sent: 0, cancelled: false };
function paddedList(total: number): Response {
  const head = new TextEncoder().encode(FALLOUT + "\n");
  padded.sent = 0;
  padded.cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const left = total - padded.sent;
      if (left <= 0) return controller.close();
      const chunk = padded.sent === 0 ? head : left < PAD.byteLength ? commentLine(left) : PAD;
      controller.enqueue(chunk);
      padded.sent += chunk.byteLength;
    },
    cancel() {
      padded.cancelled = true;
    },
  });
  return new Response(body, { status: 200 });
}

const requested: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const url = String(input);
  requested.push(url);
  if (url.includes("/loot/skyrimse/")) return new Response(SKYRIM, { status: 200 });
  if (url.includes("/loot/fallout4/")) return new Response(FALLOUT, { status: 200 });
  if (url.includes("/loot/falloutnv/")) return stalled(init?.signal, false);
  if (url.includes("/loot/oblivion/")) return stalled(init?.signal, true);
  if (url.includes("/loot/fallout3/")) return paddedList(8 * MB);
  if (url.includes("/loot/starfield/")) return paddedList(16 * MB);
  return new Response("404: Not Found", { status: 404 });
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

/** The pairs a check found, as [modA, modB, severity]. */
async function pairs(gameId: string, modIds: string[]): Promise<string[][]> {
  const r = await checkKnownConflicts({ gameId, modIds });
  assert.equal(r.sources.loot.available, true, `${gameId}: ${r.sources.loot.reason ?? ""}`);
  return r.conflicts.map((c) => [c.modA, c.modB, c.severity]);
}

// ─── Which list is fetched ───────────────────────────────────────────────────

test("the masterlist comes from v0.29, the branch LOOT itself reads by default", async () => {
  await pairs("skyrimspecialedition", ["NAT.esp", "Vivid WeathersSE.esp"]);
  assert.ok(
    requested.includes("https://raw.githubusercontent.com/loot/skyrimse/v0.29/masterlist.yaml"),
    requested.join("\n")
  );
  assert.ok(requested.every((url) => url.includes("/v0.29/")), requested.join("\n"));
});

test("Skyrim VR reads Skyrim SE's masterlist and Fallout 4 VR reads Fallout 4's, as LOOT does", async () => {
  assert.deepEqual(await pairs("skyrimvr", ["NAT.esp", "Vivid WeathersSE.esp"]), [
    ["NAT.esp", "Vivid WeathersSE.esp", "incompatible"],
  ]);
  assert.deepEqual(await pairs("fallout4vr", ["Example.esm", "Other.esp"]), [
    ["Example.esm", "Other.esp", "incompatible"],
  ]);
  assert.deepEqual(
    requested.filter((url) => /\/loot\/(skyrimvr|fallout4vr)\//.test(url)),
    [],
    "there is no VR repo on a current branch"
  );
});

// ─── The fetch's limits ──────────────────────────────────────────────────────

const FALLBACK = " Conflict detection falls back to community data only.";

test("a fetch that stalls gives up after 30 seconds, before the answer starts or in the middle of it", async (t) => {
  const asked: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  // The fetch asks for its 30 seconds; the test waits 10 milliseconds instead.
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    asked.push(ms);
    return timeout(10);
  });
  const reason = "LOOT masterlist fetch timed out after 30 seconds." + FALLBACK;
  for (const gameId of ["falloutnv", "oblivion"]) {
    const r = await checkKnownConflicts({ gameId, modIds: ["Example.esm", "Other.esp"] });
    assert.deepEqual(r.conflicts, [], gameId);
    assert.deepEqual(r.sources.loot, { available: false, reason }, gameId);
    assert.deepEqual(r.warnings, [reason], gameId);
  }
  assert.deepEqual(asked, [30_000, 30_000]);
});

test("a masterlist over 8 MB is left unread, never parsed in part; one of 8 MB is read", async () => {
  const over = await checkKnownConflicts({ gameId: "starfield", modIds: ["Example.esm", "Other.esp"] });
  assert.deepEqual(over.conflicts, [], "the conflict at the top of the list isn't used");
  assert.deepEqual(over.sources.loot, {
    available: false,
    reason: "LOOT masterlist was over 8 MB, so it wasn't read." + FALLBACK,
  });
  assert.equal(padded.cancelled, true, "the rest of the body was cancelled");
  assert.ok(padded.sent <= 8 * MB + 2 * PAD.byteLength, `${padded.sent} bytes were sent before it stopped`);

  assert.deepEqual(await pairs("fallout3", ["Example.esm", "Other.esp"]), [["Example.esm", "Other.esp", "incompatible"]]);
  assert.equal(padded.sent, 8 * MB);
  assert.equal(padded.cancelled, false);
});

// ─── What an entry says ──────────────────────────────────────────────────────

const LOOT = "loot-masterlist" as const;
const UNCHECKED = "as incompatible only under this condition, and ModWrench couldn't tell whether it holds:";

test("an entry LOOT applies only under a condition is informational, and quotes the condition", async () => {
  const r = await checkKnownConflicts({
    gameId: "skyrimspecialedition",
    modIds: ["NAT.esp", "TrueStormsSE.esp", "Vivid WeathersSE.esp", "3DNPC.esp", "open cities skyrim.esp", "True Light.esp", "RelightingSkyrim_SSE.esp"],
  });
  assert.deepEqual(r.conflicts, [
    {
      modA: "NAT.esp",
      modB: "TrueStormsSE.esp",
      severity: "informational",
      description: `LOOT masterlist flags NAT.esp and TrueStormsSE.esp ("True Storms Special Edition") ${UNCHECKED} \`active("TrueStormsSE.esp") and not active("NAT_TS_Patch_.*\\.esp")\`.`,
      source: LOOT,
    },
    {
      modA: "NAT.esp",
      modB: "Vivid WeathersSE.esp",
      severity: "incompatible",
      description: "LOOT masterlist flags NAT.esp and Vivid WeathersSE.esp as incompatible.",
      source: LOOT,
    },
    {
      modA: "3DNPC.esp",
      modB: "open cities skyrim.esp",
      severity: "informational",
      description: `LOOT masterlist flags 3DNPC.esp and open cities skyrim.esp ${UNCHECKED} \`not active("Open Cities - 3DNPC Patch.esp")\`.`,
      source: LOOT,
    },
    {
      modA: "True Light.esp",
      modB: "RelightingSkyrim_SSE.esp",
      severity: "informational",
      description:
        `LOOT masterlist flags True Light.esp and RelightingSkyrim_SSE.esp ${UNCHECKED} ` +
        '`checksum("RelightingSkyrim_SSE.esp", A05D4081) or checksum("RelightingSkyrim_SSE.esp", C5529E7D)`.' +
        ` LOOT's note: "Incompatible with interiors versions."`,
      source: LOOT,
    },
  ]);
});

test("LOOT's display and its English detail are quoted as one plain line of at most 300 characters", async () => {
  const r = await checkKnownConflicts({
    gameId: "fallout4",
    modIds: ["Example.esm", "Noted.esp", "German.esp", "Long.esp", "Quoted.esp"],
  });
  const said = Object.fromEntries(r.conflicts.map((c) => [c.modB, [c.severity, c.description]]));
  assert.deepEqual(said, {
    // Markdown flattened, line breaks and double quotes made safe, the English text picked from the list.
    "Noted.esp": [
      "incompatible",
      `LOOT masterlist flags Example.esm and Noted.esp ("Noted Mod (https://example.test/noted) v2") as incompatible. LOOT's note: "Only version 2: see 'the notes' first."`,
    ],
    // A note with no English text isn't shown in another language.
    "German.esp": ["incompatible", "LOOT masterlist flags Example.esm and German.esp as incompatible."],
    "Long.esp": ["incompatible", `LOOT masterlist flags Example.esm and Long.esp as incompatible. LOOT's note: "${"x".repeat(299)}…"`],
    // A condition is code: one line, and a backtick can't end the quote around it.
    "Quoted.esp": ["informational", `LOOT masterlist flags Example.esm and Quoted.esp ${UNCHECKED} \`active("Quoted.esp") and 'rm -rf'\`.`],
  });
});

// ─── Which entries a plugin matches ──────────────────────────────────────────

test("the slice of LOOT's real list parses: each entry with an inc or msg list, in file order, regex names read as regexes", async () => {
  const list = await fetchLootMasterlist("skyrimspecialedition");
  assert.ok(!("failed" in list), JSON.stringify(list));
  const kind = (match: string | RegExp) => (typeof match === "string" ? "exact" : "regex");
  assert.deepEqual(
    list.rules.map((r) => [r.name, kind(r.match), r.inc.length, r.msg.length]),
    [
      ["NAT.esp", "exact", 21, 1],
      ["True Light.esp", "exact", 6, 0],
      ["3DNPC.esp", "exact", 1, 8],
      ["Kapotun ARMA .+\\.esp", "regex", 1, 0],
      ["aMidianBorn_ContentAddon(Light)?\\.esp", "regex", 5, 2],
      ["amidianborn_contentaddon.esp", "exact", 0, 2],
      ["aMidianBorn_ContentAddonLight.esp", "exact", 1, 1],
      ["RUSTIC SOULGEMS - (Sorted|Unsorted)( - ESL)?( - GIST)?\\.esp", "regex", 1, 1],
      ["MPXP1\\.3 \\[PATCH - (DBPT\\.)?SSkwy\\.LotD\\]( \\(OCS\\))?\\.esp", "regex", 1, 1],
      ["MPXP1\\.3 \\[PATCH - (DBPT\\.)?SSkwy\\.LotD\\]\\.esp", "regex", 1, 1],
      ["MPXP1\\.3 \\[PATCH - SSkwy\\.LotD\\]( \\(OCS\\))?\\.esp", "regex", 1, 0],
    ]
  );
  // An inc item reached through an alias (*ENBSeries) is read like any other.
  assert.deepEqual(list.rules[1]!.inc[0], {
    plugin: "../enblocal.ini",
    display: "ENBSeries SE (http://enbdev.com/download_mod_tesskyrimse.htm)",
  });

  const made = await fetchLootMasterlist("fallout4");
  assert.ok(!("failed" in made), JSON.stringify(made));
  assert.deepEqual(
    made.rules.map((r) => [r.name, kind(r.match)]),
    [
      ["Example.esm", "exact"],
      ["Example\\.esm", "regex"],
      ["Other.esp", "exact"],
      ["Weird (Name) [v1.2] + more.esp", "exact"],
      ["Alpha|Beta\\.esp", "regex"],
    ],
    "the regex JavaScript can't read is left out"
  );
});

test("an entry whose name is a regex matches the player's plugins, and the pair is named as the player named them", async () => {
  assert.deepEqual(
    await pairs("skyrimspecialedition", [
      "RUSTIC SOULGEMS - Sorted - ESL.esp",
      "rustic soulgems - unsorted.esp",
      "Old RUSTIC SOULGEMS - Sorted.esp",
      "MLPSoulGems.esp",
      "Kapotun ARMA Reborn.esp",
      "DWKaPoTunRace.esp",
      "nat.esp",
      "VIVID WEATHERSSE.ESP",
    ]),
    [
      ["RUSTIC SOULGEMS - Sorted - ESL.esp", "MLPSoulGems.esp", "incompatible"],
      ["rustic soulgems - unsorted.esp", "MLPSoulGems.esp", "incompatible"],
      // Anchored at both ends, as LOOT anchors it: "Old RUSTIC SOULGEMS - Sorted.esp" doesn't match.
      ["Kapotun ARMA Reborn.esp", "DWKaPoTunRace.esp", "informational"],
      ["nat.esp", "VIVID WEATHERSSE.ESP", "incompatible"],
    ]
  );
  const r = await checkKnownConflicts({
    gameId: "skyrimspecialedition",
    modIds: ["RUSTIC SOULGEMS - Sorted - ESL.esp", "MLPSoulGems.esp", "Kapotun ARMA Reborn.esp", "DWKaPoTunRace.esp"],
  });
  assert.deepEqual(
    r.conflicts.map((c) => c.description),
    [
      `LOOT masterlist flags RUSTIC SOULGEMS - Sorted - ESL.esp and MLPSoulGems.esp ("MultiLayer Parallax Soul Gems") as incompatible.`,
      `LOOT masterlist flags Kapotun ARMA Reborn.esp and DWKaPoTunRace.esp ${UNCHECKED} \`version("DWKaPoTunRace.esp", >=, "2.0")\`.`,
    ]
  );
});

test("every entry that matches a plugin counts, in file order, and a pair found twice is reported once", async () => {
  // A regex entry, then an exact one further down the file.
  assert.deepEqual(
    await pairs("skyrimspecialedition", [
      "Complete Crafting Overhaul_Remastered.esp",
      "aMidianBorn_Book of Silence.esp",
      "aMidianBorn_ContentAddonLight.esp",
    ]),
    [
      ["aMidianBorn_ContentAddonLight.esp", "aMidianBorn_Book of Silence.esp", "incompatible"],
      ["aMidianBorn_ContentAddonLight.esp", "Complete Crafting Overhaul_Remastered.esp", "incompatible"],
    ]
  );
  // Three regex entries match the first plugin; two of them match the second.
  assert.deepEqual(
    await pairs("skyrimspecialedition", [
      "MPXP1.3 [PATCH - SSkwy.LotD].esp",
      "MPXP1.3 [PATCH - DBPT.SSkwy.LotD].esp",
      "BluePalaceTerrace.esp",
      "Open Cities Skyrim.esp",
      "Solitude Skyway SE - Legacy of the Dragonborn Patch.esp",
    ]),
    [
      ["MPXP1.3 [PATCH - SSkwy.LotD].esp", "Solitude Skyway SE - Legacy of the Dragonborn Patch.esp", "incompatible"],
      ["MPXP1.3 [PATCH - SSkwy.LotD].esp", "Open Cities Skyrim.esp", "incompatible"],
      ["MPXP1.3 [PATCH - SSkwy.LotD].esp", "BluePalaceTerrace.esp", "incompatible"],
      ["MPXP1.3 [PATCH - DBPT.SSkwy.LotD].esp", "Solitude Skyway SE - Legacy of the Dragonborn Patch.esp", "incompatible"],
      ["MPXP1.3 [PATCH - DBPT.SSkwy.LotD].esp", "Open Cities Skyrim.esp", "incompatible"],
    ]
  );
  // Example.esm and Other.esp are paired by the exact entry, the regex Example\.esm and Other.esp's own entry.
  assert.deepEqual(await pairs("fallout4", ["Example.esm", "Other.esp", "Second.esp"]), [
    ["Example.esm", "Other.esp", "incompatible"],
    ["Example.esm", "Second.esp", "incompatible"],
  ]);
});

test("a name with brackets but none of : \\ * ? | is exact, and a regex is anchored as LOOT anchors it", async () => {
  assert.deepEqual(await pairs("fallout4", ["Weird (Name) [v1.2] + more.esp", "Other.esp"]), [
    ["Weird (Name) [v1.2] + more.esp", "Other.esp", "incompatible"],
  ]);
  // ^Alpha|Beta\.esp$ is "starts with Alpha" or "ends with Beta.esp", as in LOOT, not one or the other exactly.
  assert.deepEqual(await pairs("fallout4", ["Alpha Patch.esp", "Other.esp"]), [
    ["Alpha Patch.esp", "Other.esp", "incompatible"],
  ]);
});
