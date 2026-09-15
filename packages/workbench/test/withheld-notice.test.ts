import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterAdultContent } from "@modwrench/core";
import { normalizeNexusMod } from "../src/metadata/normalize.js";

// ─── The withheld-content notice has to reach the caller ─────────────────────
// TRUST.md promises adult-tagged entries are "replaced with a short notice when
// you ask for one directly". The filter does produce that notice — it swaps the
// whole record for { filtered: true, reason: "..." }. The notice was then
// thrown away one call later.
//
// mw_query_mod_metadata handed the marker straight to normalizeNexusMod(),
// which builds a fresh object from named fields only — mod.mod_id, mod.name,
// mod.author — and never reads `filtered` or `reason`. The result was
// found: true with name and author undefined and a pageUrl ending in
// "/undefined": the tool reported SUCCESS for a request it had actually
// withheld, and the promised notice never reached anyone. A modder debugging
// that sees a broken lookup, not a policy decision.
//
// No adult content leaked — the filter itself worked. The disclosure was the
// casualty. These tests pin both halves: that the marker really is shaped the
// way the guard expects, and that the guard runs before normalization.

const INDEX = new URL("../src/metadata/index.ts", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1"
);

test("an adult-tagged record really does become a marker carrying its own reason", () => {
  const { value } = filterAdultContent({
    mod_id: 1234,
    name: "Some Mod",
    author: "Someone",
    contains_adult_content: true,
  });

  const marker = value as { filtered?: boolean; reason?: string };
  assert.equal(marker.filtered, true, "the filter no longer marks withheld records");
  assert.ok(
    typeof marker.reason === "string" && marker.reason.length > 0,
    "the marker carries no reason text — there is no notice left to surface"
  );
  assert.equal(
    (value as { name?: string }).name,
    undefined,
    "the marker still carries the original fields — the guard below keys off their absence"
  );
});

test("normalizing the marker produces the garbage result this guard exists to prevent", () => {
  // Demonstrates the original failure directly, so the reason for the guard in
  // index.ts is visible rather than folklore.
  const { value } = filterAdultContent({
    mod_id: 1234,
    name: "Some Mod",
    author: "Someone",
    contains_adult_content: true,
  });

  const normalized = normalizeNexusMod(
    value as never,
    "skyrimspecialedition"
  );

  assert.equal(normalized.name, undefined, "expected the marker to normalize to an empty card");
  assert.equal(normalized.attribution.author, undefined);
  assert.match(
    normalized.pageUrl,
    /\/undefined$/,
    "expected the broken pageUrl — if normalization ever handles the marker itself, " +
      "this test should be revisited rather than deleted"
  );
});

test("mw_query_mod_metadata checks for the marker before normalizing", () => {
  const src = readFileSync(INDEX, "utf8");
  assert.ok(src.length > 0, "metadata/index.ts was not read");

  const markerAt = src.indexOf("filtered === true");
  const normalizeAt = src.indexOf("normalizeNexusMod(raw");

  assert.ok(
    markerAt > -1,
    "the redaction marker is no longer checked — a withheld mod will report " +
      "found:true with undefined fields again"
  );
  assert.ok(
    markerAt < normalizeAt,
    "the marker check runs after normalizeNexusMod — it has to run first, or the " +
      "marker is already destroyed by the time it is inspected"
  );

  // The notice is the promise. Returning found:false without it would fix the
  // garbage card but still drop the disclosure TRUST.md commits to.
  const guard = src.slice(markerAt, normalizeAt);
  assert.match(
    guard,
    /marker\.reason/,
    "the guard no longer surfaces the marker's reason text — the notice TRUST.md " +
      "promises is being dropped again"
  );
  assert.match(
    guard,
    /found: false/,
    "the guard no longer reports found:false — reporting success for a withheld " +
      "request is the behavior this replaced"
  );
});
