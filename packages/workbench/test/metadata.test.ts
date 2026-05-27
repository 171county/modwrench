import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNexusMod,
  normalizeModioMod,
} from "../src/metadata/normalize.js";

// ─── Nexus normalization ─────────────────────────────────────────────────────

test("normalizeNexusMod: builds page URL from gameDomain + mod_id", () => {
  const normalized = normalizeNexusMod(
    {
      mod_id: 1840,
      domain_name: "skyrimspecialedition",
      name: "SkyUI",
      author: "SkyUI Team",
    },
    "skyrimspecialedition"
  );
  assert.equal(
    normalized.pageUrl,
    "https://www.nexusmods.com/skyrimspecialedition/mods/1840"
  );
});

test("normalizeNexusMod: attribution block always populated", () => {
  const normalized = normalizeNexusMod(
    {
      mod_id: 1840,
      domain_name: "skyrimspecialedition",
      name: "SkyUI",
      author: "SkyUI Team",
    },
    "skyrimspecialedition"
  );
  assert.equal(normalized.attribution.author, "SkyUI Team");
  assert.equal(normalized.attribution.sourcePlatform, "nexus");
  assert.equal(normalized.attribution.sourceModId, "1840");
  assert.equal(
    normalized.attribution.pageUrl,
    "https://www.nexusmods.com/skyrimspecialedition/mods/1840"
  );
});

test("normalizeNexusMod: permissions block always present with honest note", () => {
  const normalized = normalizeNexusMod(
    {
      mod_id: 1840,
      domain_name: "skyrimspecialedition",
      name: "SkyUI",
      author: "SkyUI Team",
    },
    "skyrimspecialedition"
  );
  assert.ok(normalized.permissions);
  // The wiring prompt's permissions matrix isn't exposed by the Nexus API,
  // so all three flags must be null with the explanatory note. Don't
  // accidentally regress to inferred booleans.
  assert.equal(normalized.permissions?.modificationAllowed, null);
  assert.equal(normalized.permissions?.assetReuseAllowed, null);
  assert.equal(normalized.permissions?.conversionAllowed, null);
  assert.match(normalized.permissions?.note ?? "", /Always confirm via pageUrl/);
});

test("normalizeNexusMod: converts updated_timestamp to ISO string", () => {
  const normalized = normalizeNexusMod(
    {
      mod_id: 1,
      domain_name: "skyrim",
      name: "Test",
      author: "Test",
      updated_timestamp: 1700000000,
    },
    "skyrim"
  );
  // 1700000000 → 2023-11-14T22:13:20.000Z
  assert.match(normalized.lastUpdated ?? "", /^2023-11-14T/);
});

test("normalizeNexusMod: prefers updated_time string over updated_timestamp", () => {
  const normalized = normalizeNexusMod(
    {
      mod_id: 1,
      domain_name: "skyrim",
      name: "Test",
      author: "Test",
      updated_time: "2024-05-01T10:00:00Z",
      updated_timestamp: 1700000000,
    },
    "skyrim"
  );
  assert.equal(normalized.lastUpdated, "2024-05-01T10:00:00Z");
});

// ─── mod.io normalization ────────────────────────────────────────────────────

test("normalizeModioMod: uses profile_url when provided", () => {
  const normalized = normalizeModioMod({
    id: 42,
    game_id: 6195,
    name: "Test Mod",
    name_id: "test-mod",
    profile_url: "https://mod.io/g/lethalcompany/m/test-mod",
  });
  assert.equal(normalized.pageUrl, "https://mod.io/g/lethalcompany/m/test-mod");
});

test("normalizeModioMod: synthesizes page URL when not provided", () => {
  const normalized = normalizeModioMod({
    id: 42,
    game_id: 6195,
    name: "Test Mod",
    name_id: "test-mod",
  });
  assert.equal(normalized.pageUrl, "https://mod.io/g/6195/m/test-mod");
});

test("normalizeModioMod: attribution uses submitted_by.username", () => {
  const normalized = normalizeModioMod({
    id: 42,
    game_id: 6195,
    name: "Test Mod",
    name_id: "test-mod",
    submitted_by: { username: "ModAuthor", profile_url: "..." },
  });
  assert.equal(normalized.attribution.author, "ModAuthor");
  assert.equal(normalized.attribution.sourcePlatform, "modio");
});

test("normalizeModioMod: missing submitted_by falls back to '(unknown)' rather than empty", () => {
  // Trust posture: author is mandatory in attribution. We surface (unknown)
  // explicitly rather than letting the LLM see an empty field that might
  // get stripped or omitted.
  const normalized = normalizeModioMod({
    id: 42,
    game_id: 6195,
    name: "Test Mod",
    name_id: "test-mod",
  });
  assert.equal(normalized.attribution.author, "(unknown)");
});

test("normalizeModioMod: prefers description_plaintext over HTML description", () => {
  const normalized = normalizeModioMod({
    id: 42,
    game_id: 6195,
    name: "Test Mod",
    name_id: "test-mod",
    description: "<p>HTML version</p>",
    description_plaintext: "Plain version",
  });
  assert.equal(normalized.description, "Plain version");
});

test("normalizeModioMod: version pulled from modfile", () => {
  const normalized = normalizeModioMod({
    id: 42,
    game_id: 6195,
    name: "Test Mod",
    name_id: "test-mod",
    modfile: { version: "1.2.3" },
  });
  assert.equal(normalized.version, "1.2.3");
});
