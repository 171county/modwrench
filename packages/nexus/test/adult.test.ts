import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  isAdult,
  filterAdultContent,
  adultContentAllowed,
  applyAdultPolicy,
} from "../src/adult.js";

// Nexus's Terms of Service section 16 makes filtering the API consumer's job:
// "Third parties who use our APIs are responsible for filtering the content
// returned." These tests exist so that obligation is verifiable rather than
// asserted — and so it can be checked without anyone having to go looking at
// adult content to confirm the filter works. The fixtures below carry only the
// flag, no actual content.

const ORIGINAL = process.env.NEXUS_ALLOW_ADULT_CONTENT;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXUS_ALLOW_ADULT_CONTENT;
  else process.env.NEXUS_ALLOW_ADULT_CONTENT = ORIGINAL;
});

// ─── Flag detection ───────────────────────────────────────────────────────────

test("isAdult: detects the v1 REST flag", () => {
  assert.equal(isAdult({ mod_id: 1, contains_adult_content: true }), true);
  assert.equal(isAdult({ mod_id: 1, contains_adult_content: false }), false);
});

test("isAdult: detects the GraphQL flag spellings", () => {
  assert.equal(isAdult({ id: 1, adult: true }), true);
  assert.equal(isAdult({ id: 1, adultContent: true }), true);
});

test("isAdult: is not fooled by truthy non-true values", () => {
  // A string "false" or a 0/1 is not a boolean true. Only an explicit true
  // counts, so a schema change cannot silently disable the filter by making
  // the field a string.
  assert.equal(isAdult({ contains_adult_content: "true" }), false);
  assert.equal(isAdult({ contains_adult_content: 1 }), false);
});

test("isAdult: handles junk without throwing", () => {
  assert.equal(isAdult(null), false);
  assert.equal(isAdult(undefined), false);
  assert.equal(isAdult("a string"), false);
  assert.equal(isAdult(42), false);
});

// ─── Filtering shapes the API actually returns ────────────────────────────────

test("filterAdultContent: drops flagged entries from a bare array", () => {
  const payload = [
    { mod_id: 1, name: "Clean A", contains_adult_content: false },
    { mod_id: 2, name: "Flagged", contains_adult_content: true },
    { mod_id: 3, name: "Clean B" },
  ];
  const { value, removed } = filterAdultContent(payload);
  assert.equal(removed, 1);
  assert.equal(value.length, 2);
  assert.deepEqual(
    value.map((m) => m.mod_id),
    [1, 3]
  );
});

test("filterAdultContent: redacts a single flagged mod object", () => {
  const payload = { mod_id: 7, name: "Flagged", contains_adult_content: true };
  const { value, removed } = filterAdultContent(payload);
  assert.equal(removed, 1);
  const out = value as unknown as { filtered?: boolean; reason?: string; name?: string };
  assert.equal(out.filtered, true);
  assert.ok(out.reason?.includes("adult content"));
  // The point of redaction: none of the original record survives.
  assert.equal(out.name, undefined);
});

test("filterAdultContent: filters an array nested inside a wrapper object", () => {
  const payload = {
    total: 3,
    results: [
      { mod_id: 1, name: "Clean" },
      { mod_id: 2, name: "Flagged", adult: true },
      { mod_id: 3, name: "Also clean" },
    ],
  };
  const { value, removed } = filterAdultContent(payload);
  assert.equal(removed, 1);
  assert.equal(value.results.length, 2);
});

test("filterAdultContent: leaves clean payloads untouched", () => {
  const payload = { mod_id: 1, name: "Clean", contains_adult_content: false };
  const { value, removed } = filterAdultContent(payload);
  assert.equal(removed, 0);
  assert.deepEqual(value, payload);
});

test("filterAdultContent: survives deeply nested and irregular data", () => {
  const payload = {
    a: { b: { c: { d: { e: [{ contains_adult_content: true }] } } } },
    n: null,
    s: "string",
    arr: [1, 2, 3],
  };
  assert.doesNotThrow(() => filterAdultContent(payload));
});

// ─── The opt-out is the operator's, not the model's ───────────────────────────

test("adultContentAllowed: defaults to false when unset", () => {
  delete process.env.NEXUS_ALLOW_ADULT_CONTENT;
  assert.equal(adultContentAllowed(), false);
});

test("adultContentAllowed: accepts explicit opt-in spellings", () => {
  for (const v of ["true", "TRUE", "1", "yes"]) {
    process.env.NEXUS_ALLOW_ADULT_CONTENT = v;
    assert.equal(adultContentAllowed(), true, `expected ${v} to opt in`);
  }
});

test("adultContentAllowed: anything else stays filtered", () => {
  for (const v of ["false", "0", "no", "maybe", ""]) {
    process.env.NEXUS_ALLOW_ADULT_CONTENT = v;
    assert.equal(adultContentAllowed(), false, `expected ${v} to stay filtered`);
  }
});

// ─── The policy wrapper ───────────────────────────────────────────────────────

test("applyAdultPolicy: filters by default", () => {
  delete process.env.NEXUS_ALLOW_ADULT_CONTENT;
  const out = applyAdultPolicy(
    [
      { mod_id: 1, name: "Clean" },
      { mod_id: 2, name: "Flagged", contains_adult_content: true },
    ],
    "test"
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.mod_id, 1);
});

test("applyAdultPolicy: passes everything through when the operator opts in", () => {
  process.env.NEXUS_ALLOW_ADULT_CONTENT = "true";
  const payload = [
    { mod_id: 1, name: "Clean" },
    { mod_id: 2, name: "Flagged", contains_adult_content: true },
  ];
  const out = applyAdultPolicy(payload, "test");
  assert.equal(out.length, 2);
});
