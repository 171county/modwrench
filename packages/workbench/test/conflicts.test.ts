import { test } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikePlugin,
  normalizeId,
  findCommunityConflicts,
} from "../src/conflicts/index.js";
import { loadCommunityConflicts } from "../src/conflicts/community.js";
import type { KnownConflict } from "../src/conflicts/types.js";

// ─── Identifier classification ───────────────────────────────────────────────

test("looksLikePlugin: matches .esp/.esm/.esl case-insensitive", () => {
  assert.equal(looksLikePlugin("Skyrim.esp"), true);
  assert.equal(looksLikePlugin("Update.esm"), true);
  assert.equal(looksLikePlugin("SomeESL.esl"), true);
  assert.equal(looksLikePlugin("UPPERCASE.ESP"), true);
});

test("looksLikePlugin: rejects platform-prefixed IDs", () => {
  assert.equal(looksLikePlugin("nexus:12345"), false);
  assert.equal(looksLikePlugin("modio:67890"), false);
  assert.equal(looksLikePlugin("thunderstore:Author-ModName"), false);
});

test("looksLikePlugin: rejects bare IDs and other strings", () => {
  assert.equal(looksLikePlugin("12345"), false);
  assert.equal(looksLikePlugin(""), false);
  assert.equal(looksLikePlugin("not.a.plugin"), false);
});

test("normalizeId: lowercases plugin names", () => {
  assert.equal(normalizeId("Skyrim.esp"), "skyrim.esp");
  assert.equal(normalizeId("JKs Whiterun Outskirts.ESP"), "jks whiterun outskirts.esp");
});

test("normalizeId: preserves platform-prefix IDs case-sensitive on suffix", () => {
  // Thunderstore IDs (Author-ModName) are case-sensitive; we don't lowercase
  // them to avoid breaking matches against curated entries.
  assert.equal(normalizeId("thunderstore:BepInEx-BepInExPack"), "thunderstore:BepInEx-BepInExPack");
  assert.equal(normalizeId("nexus:12345"), "nexus:12345");
});

// ─── Community conflict matching ─────────────────────────────────────────────

const SAMPLE_ENTRIES: KnownConflict[] = [
  {
    modA: "nexus:65876",
    modB: "nexus:35895",
    severity: "incompatible",
    description: "Both modify Whiterun cell",
    source: "community",
  },
  {
    modA: "SkyUI_SE.esp",
    modB: "ConflictingMenu.esp",
    severity: "load-order-sensitive",
    description: "Menu conflict",
    source: "community",
  },
  {
    modA: "thunderstore:Author-ModA",
    modB: "thunderstore:Author-ModB",
    severity: "patch-available",
    description: "Patch available",
    source: "modwrench-curated",
    patchModId: "thunderstore:Author-Patch",
  },
];

test("findCommunityConflicts: matches when both sides of pair present", () => {
  const inputSet = new Set(
    ["nexus:65876", "nexus:35895"].map(normalizeId)
  );
  const found = findCommunityConflicts(SAMPLE_ENTRIES, inputSet);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.severity, "incompatible");
});

test("findCommunityConflicts: no match when only one side of pair present", () => {
  const inputSet = new Set(["nexus:65876"].map(normalizeId));
  const found = findCommunityConflicts(SAMPLE_ENTRIES, inputSet);
  assert.equal(found.length, 0);
});

test("findCommunityConflicts: plugin matches are case-insensitive", () => {
  // User passes plugin filenames in mixed case; matching must succeed.
  const inputSet = new Set(
    ["skyui_se.esp", "conflictingmenu.esp"].map(normalizeId)
  );
  const found = findCommunityConflicts(SAMPLE_ENTRIES, inputSet);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.modA, "SkyUI_SE.esp");
});

test("findCommunityConflicts: surfaces multiple matching pairs from input", () => {
  const inputSet = new Set(
    [
      "nexus:65876",
      "nexus:35895",
      "SkyUI_SE.esp",
      "ConflictingMenu.esp",
    ].map(normalizeId)
  );
  const found = findCommunityConflicts(SAMPLE_ENTRIES, inputSet);
  assert.equal(found.length, 2);
});

test("findCommunityConflicts: preserves patchModId and source attribution", () => {
  const inputSet = new Set(
    ["thunderstore:Author-ModA", "thunderstore:Author-ModB"].map(normalizeId)
  );
  const found = findCommunityConflicts(SAMPLE_ENTRIES, inputSet);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.patchModId, "thunderstore:Author-Patch");
  assert.equal(found[0]?.source, "modwrench-curated");
});

// ─── Bundled community files ─────────────────────────────────────────────────

test("loadCommunityConflicts: known gameId with empty file returns []", () => {
  // Bundled seed files ship as empty arrays; community PRs fill them.
  const entries = loadCommunityConflicts("skyrimspecialedition");
  assert.deepEqual(entries, []);
});

test("loadCommunityConflicts: unknown gameId returns [] (graceful)", () => {
  const entries = loadCommunityConflicts("no-such-game-xyz");
  assert.deepEqual(entries, []);
});
