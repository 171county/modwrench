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
// example of. Every other repo answers 404, as GitHub does for a list that
// doesn't exist.

// The branch is read from LOOT_BRANCH when the module loads, so it's cleared first.
delete process.env["LOOT_BRANCH"];
const { checkKnownConflicts } = await import("../src/conflicts/index.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const SKYRIM = readFileSync(resolve(HERE, "fixtures", "loot-skyrimse-v0.29.yaml"), "utf8");
const FALLOUT = [
  "plugins:",
  "  - name: 'Example.esm'",
  "    inc: [ 'Other.esp' ]",
].join("\n");

const requested: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  requested.push(url);
  if (url.includes("/loot/skyrimse/")) return new Response(SKYRIM, { status: 200 });
  if (url.includes("/loot/fallout4/")) return new Response(FALLOUT, { status: 200 });
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
