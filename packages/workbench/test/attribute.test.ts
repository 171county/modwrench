import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributeSuspects,
  stripPluginExtension,
  ATTRIBUTION_LOOKUP_CAP,
  type AttributeSearch,
} from "../src/metadata/attribute.js";

// The search is injected — the same pattern as diagnose.test.ts's injected
// conflict checker — so these tests run with no network and no credential.
// What they hold in place is the honesty rules: bounded lookups, withheld
// results never attributed, failures becoming notes instead of tool errors.

test("stripPluginExtension removes .esp/.esm/.esl, case-insensitively", () => {
  assert.equal(stripPluginExtension("SomeMod.esp"), "SomeMod");
  assert.equal(stripPluginExtension("SomeMod.ESM"), "SomeMod");
  assert.equal(stripPluginExtension("SomeMod.esl"), "SomeMod");
  assert.equal(stripPluginExtension("SomePlugin.dll"), "SomePlugin.dll");
  assert.equal(stripPluginExtension(".esp"), "");
});

test("a found suspect is attributed under its ORIGINAL name, with the matched name carried along", async () => {
  const search: AttributeSearch = async (name) => ({
    status: "found",
    author: "AuthorName",
    modId: "12345",
    pageUrl: `https://www.nexusmods.com/skyrimspecialedition/mods/12345`,
    matchedName: `Some ${name}`,
  });
  const r = await attributeSuspects({
    suspectNames: ["SomeMod.esp"],
    gameDomain: "skyrimspecialedition",
    search,
  });
  // Keyed by the original suspect name — the caller must not have to re-derive
  // the stripped form to attach the attribution.
  const a = r.attributed.get("SomeMod.esp");
  assert.ok(a, "attribution missing for SomeMod.esp");
  assert.equal(a.author, "AuthorName");
  assert.equal(a.platform, "nexus");
  assert.equal(a.modId, "12345");
  assert.equal(a.matchedBy, "name-search");
  // matchedName is the honesty field: the model compares it to the suspect
  // name before presenting the link as the author's page.
  assert.equal(a.matchedName, "Some SomeMod");
  assert.ok(a.pageUrl.endsWith("/mods/12345"));
  assert.deepEqual(r.notes, []);
});

test("withheld results are reported in the notes, never attributed", async () => {
  const search: AttributeSearch = async () => ({
    status: "withheld",
    reason: "adult-flagged and filtered",
  });
  const r = await attributeSuspects({
    suspectNames: ["Sus.esp"],
    gameDomain: "fallout4",
    search,
  });
  assert.equal(r.attributed.size, 0);
  assert.ok(r.notes.some((n) => /withheld/.test(n) && /Sus\.esp/.test(n)));
});

test("no-match is silent — absence of attribution says it", async () => {
  const search: AttributeSearch = async () => ({ status: "no-match" });
  const r = await attributeSuspects({
    suspectNames: ["Ghost.esp"],
    gameDomain: "fallout4",
    search,
  });
  assert.equal(r.attributed.size, 0);
  assert.deepEqual(r.notes, []);
});

test("a search error becomes a note, not a tool failure", async () => {
  const search: AttributeSearch = async () => {
    throw new Error("nexus_graphql_error: boom");
  };
  const r = await attributeSuspects({
    suspectNames: ["Broken.esp"],
    gameDomain: "fallout4",
    search,
  });
  assert.equal(r.attributed.size, 0);
  assert.ok(r.notes.some((n) => /Attribution failed for "Broken\.esp"/.test(n)));
});

test("no gameId skips attribution entirely, with a note saying why", async () => {
  let calls = 0;
  const search: AttributeSearch = async () => {
    calls++;
    return { status: "no-match" };
  };
  const r = await attributeSuspects({ suspectNames: ["A.esp"], search });
  assert.equal(calls, 0, "the search must not run without a game domain");
  assert.ok(r.notes.some((n) => /Attribution skipped: no gameId/.test(n)));
});

test("lookups are capped at ATTRIBUTION_LOOKUP_CAP and the overflow is named", async () => {
  const names = Array.from(
    { length: ATTRIBUTION_LOOKUP_CAP + 3 },
    (_, i) => `Mod${i}.esp`
  );
  let calls = 0;
  const search: AttributeSearch = async () => {
    calls++;
    return { status: "no-match" };
  };
  const r = await attributeSuspects({
    suspectNames: names,
    gameDomain: "fallout4",
    search,
  });
  assert.equal(calls, ATTRIBUTION_LOOKUP_CAP);
  assert.ok(
    r.notes.some((n) => /capped at 5/.test(n) && /3 more/.test(n)),
    `expected an overflow note, got: ${r.notes.join(" | ")}`
  );
});

test("duplicate names (case-insensitive, extension-stripped) collapse to one lookup", async () => {
  const seen: string[] = [];
  const search: AttributeSearch = async (name) => {
    seen.push(name);
    return { status: "no-match" };
  };
  await attributeSuspects({
    suspectNames: ["SomeMod.esp", "somemod.ESP", "SomeMod"],
    gameDomain: "fallout4",
    search,
  });
  assert.deepEqual(seen, ["SomeMod"]);
});
