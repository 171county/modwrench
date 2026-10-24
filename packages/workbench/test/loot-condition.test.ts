import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCondition, safeRegex, type LootFacts, type Truth } from "../src/conflicts/condition.js";

// ─── LOOT's conditions, answered true, false or unknown ──────────────────────
// The facts are the plugins known to be active, and whether that is all of them
// (a crash log's whole list) or not (a list someone passed in).

const SOME: LootFacts = { active: ["Skyrim.esm", "A.esp", "Patch_One.esp", "Patch_Two.esp"], allActive: false };
const ALL: LootFacts = { ...SOME, allActive: true };

const answer = (condition: string, facts: LootFacts): Truth => parseCondition(condition)(facts);

/** The answer with a partial list, then with the whole list. */
const both = (condition: string): [Truth, Truth] => [answer(condition, SOME), answer(condition, ALL)];

// ─── Each function ───────────────────────────────────────────────────────────

test("active(): a listed plugin is active; an unlisted one is inactive only when the list is the whole of it", () => {
  assert.deepEqual(both('active("A.esp")'), [true, true]);
  assert.deepEqual(both('active("a.ESP")'), [true, true], "names are compared case-insensitively");
  assert.deepEqual(both('active("Missing.esp")'), ["unknown", false]);
  // A regex (it holds one of : \ * ? |) is matched against the whole name.
  assert.deepEqual(both('active("Patch_.*\\.esp")'), [true, true]);
  assert.deepEqual(both('active("atch_.*\\.esp")'), ["unknown", false], "anchored at the start");
  assert.deepEqual(both('active("Patch_One\\.es")'), ["unknown", false], "anchored at the end");
  assert.deepEqual(both('active("Other_.*\\.esp")'), ["unknown", false]);
  // Brackets and dots alone don't make a regex: this is a name, compared as written.
  assert.deepEqual(both('active("A(.)esp")'), ["unknown", false]);
  // Plugins are never in a folder, and a path in one isn't a fact ModWrench has.
  assert.deepEqual(both('active("Data/A.esp")'), ["unknown", "unknown"]);
});

test("many_active(): more than one active plugin matching the regex", () => {
  assert.deepEqual(both('many_active("Patch_.*\\.esp")'), [true, true]);
  assert.deepEqual(both('many_active("Patch_One\\.esp")'), ["unknown", false]);
  assert.deepEqual(both('many_active("Nothing.*\\.esp")'), ["unknown", false]);
  // A regex always, even without one of LOOT's regex characters: the dot matches any character.
  assert.deepEqual(both('many_active("Patch_...\\.esp")'), [true, true]);
});

test("file() and many(): true for active plugins, never false, since an inactive plugin's file may still be there", () => {
  assert.deepEqual(both('file("A.esp")'), [true, true]);
  assert.deepEqual(both('file("Patch_.*\\.esp")'), [true, true]);
  assert.deepEqual(both('file("Missing.esp")'), ["unknown", "unknown"]);
  assert.deepEqual(both('file("A.bsa")'), ["unknown", "unknown"]);
  assert.deepEqual(both('file("SKSE/Plugins/A.esp")'), ["unknown", "unknown"]);
  assert.deepEqual(both('file("../SkyrimSE.exe")'), ["unknown", "unknown"]);
  assert.deepEqual(both('many("Patch_.*\\.esp")'), [true, true]);
  assert.deepEqual(both('many("Patch_One\\.esp")'), ["unknown", "unknown"]);
});

test("every function that needs the game's files is unknown, even for an active plugin", () => {
  for (const condition of [
    'checksum("A.esp", A05D4081)',
    'version("A.esp", "2.0", >=)',
    'version("A.esp", >=, "2.0")',
    'product_version("../SkyrimSE.exe", "1.6.1170", >=)',
    'filename_version("A(\\d+)\\.esp", "1", ==)',
    'readable("A.esp")',
    'is_executable("../SkyrimSE.exe")',
    'is_master("A.esp")',
    'file_size("A.esp", 1024)',
    'description_contains("A.esp", "test")',
  ]) {
    assert.deepEqual(both(condition), ["unknown", "unknown"], condition);
  }
});

test("a function LOOT doesn't have, or a call with the wrong arguments, is unknown", () => {
  for (const condition of [
    'notfile("A.esp")', // a typo in a real masterlist
    'Active("A.esp")',
    'active("A.esp", "B.esp")',
    "active(A.esp)",
    'many("Patch_(.*\\.esp")', // a regex that doesn't compile
    'active("a\\-b.esp")', // an escape Rust's regexes allow and JavaScript's (with the u flag) don't
  ]) {
    assert.deepEqual(both(condition), ["unknown", "unknown"], condition);
  }
  // Only that call is unknown: the rest still counts.
  assert.equal(answer('notfile("A.esp") or active("A.esp")', SOME), true);
  assert.equal(answer('notfile("A.esp") and active("Missing.esp")', ALL), false);
});

// ─── Combining ───────────────────────────────────────────────────────────────

const T = 'active("A.esp")';
const F = 'active("Missing.esp")';
const U = 'version("A.esp", "1.0", >=)';
const VALUE: Record<string, Truth> = { [T]: true, [F]: false, [U]: "unknown" };

test("not, and, or follow Kleene's logic: false and unknown is false, true or unknown is true, not unknown is unknown", () => {
  const and = (a: Truth, b: Truth): Truth => (a === false || b === false ? false : a === true && b === true ? true : "unknown");
  const or = (a: Truth, b: Truth): Truth => (a === true || b === true ? true : a === false && b === false ? false : "unknown");
  for (const a of [T, F, U]) {
    assert.equal(answer(`not ${a}`, ALL), VALUE[a] === "unknown" ? "unknown" : !VALUE[a]);
    for (const b of [T, F, U]) {
      assert.equal(answer(`${a} and ${b}`, ALL), and(VALUE[a]!, VALUE[b]!), `${a} and ${b}`);
      assert.equal(answer(`${a} or ${b}`, ALL), or(VALUE[a]!, VALUE[b]!), `${a} or ${b}`);
    }
  }
  assert.equal(answer(`${F} and ${U}`, ALL), false);
  assert.equal(answer(`${U} and ${F}`, ALL), false);
  assert.equal(answer(`${T} or ${U}`, ALL), true);
  assert.equal(answer(`${U} or ${T}`, ALL), true);
  assert.equal(answer(`${T} and ${U}`, ALL), "unknown");
  assert.equal(answer(`${F} or ${U}`, ALL), "unknown");
  assert.equal(answer(`not ${U}`, ALL), "unknown");
});

test("and binds tighter than or, brackets group, and not applies to what follows it", () => {
  assert.equal(answer(`${T} or ${F} and ${F}`, ALL), true);
  assert.equal(answer(`(${T} or ${F}) and ${F}`, ALL), false);
  assert.equal(answer(`${F} and ${F} or ${T}`, ALL), true);
  assert.equal(answer(`not ${T} or ${T}`, ALL), true);
  assert.equal(answer(`not (${T} or ${F})`, ALL), false);
  assert.equal(answer(`not(${F})`, ALL), true);
  assert.equal(answer(`not not ${T}`, ALL), true);
  assert.equal(answer(`${T} and ${T} and ${T} and ${F}`, ALL), false);
  assert.equal(answer(`  ${T}\n  and\t${T}  `, ALL), true, "any white space between words");
});

test("LOOT's own conditions from the masterlist slice", () => {
  const trueStorms = 'active("TrueStormsSE.esp") and not active("NAT_TS_Patch_.*\\.esp")';
  assert.equal(answer(trueStorms, { active: ["NAT.esp", "TrueStormsSE.esp"], allActive: true }), true);
  assert.equal(answer(trueStorms, { active: ["NAT.esp", "TrueStormsSE.esp"], allActive: false }), "unknown");
  assert.equal(answer(trueStorms, { active: ["NAT.esp", "TrueStormsSE.esp", "NAT_TS_Patch_Pure.esp"], allActive: false }), false);
  assert.equal(answer(trueStorms, { active: ["NAT.esp"], allActive: false }), "unknown");
  assert.equal(answer(trueStorms, { active: ["NAT.esp"], allActive: true }), false);
  const relighting = 'checksum("RelightingSkyrim_SSE.esp", A05D4081) or checksum("RelightingSkyrim_SSE.esp", C5529E7D)';
  assert.equal(answer(relighting, { active: ["RelightingSkyrim_SSE.esp"], allActive: true }), "unknown");
  const soulGems = 'many("RUSTIC SOULGEMS - (Sorted|Unsorted)( - ESL)?( - GIST)?\\.esp")';
  assert.equal(answer(soulGems, { active: ["RUSTIC SOULGEMS - Sorted.esp", "Rustic Soulgems - Unsorted - ESL.esp"], allActive: false }), true);
  const aMidianBorn = 'not file("aMidianBorn_ContentAddon(Light)?\\.bsa") and not file("textures/AMB Variants/dlc02/x.dds")';
  assert.equal(answer(aMidianBorn, ALL), "unknown");
});

// ─── Input it can't read ─────────────────────────────────────────────────────

test("a condition that doesn't parse is unknown as a whole, whatever its parts would say", () => {
  for (const condition of [
    "",
    "   ",
    `${T} and`,
    `and ${T}`,
    `${T} or or ${T}`,
    `${T} AND ${T}`,
    `(${T}`,
    `${T})`,
    `${T} ${T}`,
    `${T} garbage`,
    'active("A.esp)',
    "active()",
    "active(,)",
    'active("A.esp",)',
    "active",
    "not",
    "()",
    '"A.esp"',
    "`rm -rf`",
    `${T} and \`rm -rf\``,
    `${T};`,
    "\u0000",
  ]) {
    assert.equal(answer(condition, ALL), "unknown", JSON.stringify(condition));
  }
});

test("a condition over 2000 characters, or nested more than 16 deep, isn't read", () => {
  const padded = (n: number) => T + " ".repeat(n - T.length);
  assert.equal(answer(padded(2000), ALL), true);
  assert.equal(answer(padded(2001), ALL), "unknown");
  const nested = (n: number) => "(".repeat(n) + T + ")".repeat(n);
  assert.equal(answer(nested(16), ALL), true);
  assert.equal(answer(nested(17), ALL), "unknown");
  const nots = (n: number) => "not ".repeat(n) + T;
  assert.equal(answer(nots(16), ALL), true);
  assert.equal(answer(nots(17), ALL), "unknown");
  // Far past the limits: no stack overflow, no throw.
  assert.equal(answer("(".repeat(100_000) + T + ")".repeat(100_000), ALL), "unknown");
  assert.equal(answer(`${T} and `.repeat(90) + T, ALL), true, "a long flat list is fine within the length");
});

test("no input makes it throw", () => {
  // A fixed pseudo-random walk over the grammar's own pieces and some that aren't.
  const pieces = ["active(", "file(", "many(", '"A.esp"', '"Patch_.*\\.esp"', '"(a+)+"', ")", "(", ",", " and ", " or ", "not ", ">=", "\\", '"', "x"];
  let seed = 42;
  const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);
  for (let i = 0; i < 5000; i++) {
    let s = "";
    const length = next() % 12;
    for (let j = 0; j < length; j++) s += pieces[next() % pieces.length];
    const v = answer(s, ALL);
    assert.ok(v === true || v === false || v === "unknown", s);
  }
});

// ─── Regexes from the masterlist ─────────────────────────────────────────────

test("a regex JavaScript would take for ever on is never run: nested repeats, back-references, more than three open repeats", () => {
  for (const pattern of ["(a+)+b", "(a*)*b", "(a|aa)+b", "(a?)+b", "((ab)*c)+", "(.*a){2,}", "(a)\\1", "(?<x>a)\\k<x>", ".*.*.*.*x", "a+b+c+d+"]) {
    assert.equal(safeRegex(pattern), null, pattern);
  }
  // LOOT's own patterns: alternatives and optional groups, at most a few open repeats.
  for (const pattern of [
    "RUSTIC SOULGEMS - (Sorted|Unsorted)( - ESL)?( - GIST)?\\.esp",
    "MPXP1\\.3 \\[PATCH - (DBPT\\.)?SSkwy\\.LotD\\]( \\(OCS\\))?\\.esp",
    "NAT_TS_Patch_.*\\.esp",
    "(Aequinoctium|Dolomite|ELFXWeathers|Mythical|NAT|Obsidian|Rustic|Vivid)_TS_Patch_.*\\.esp",
    "skse(?:64)?_loader.exe",
    "03[\\dA-F]{6}_Parallax_Vc\\w*_Snow(_Aam)?\\.ps\\.hlsl",
    "a[(+)]+b", // a bracket in a character class isn't a group
  ]) {
    assert.ok(safeRegex(pattern), pattern);
  }
  // In a condition, such a regex is an unknown, and quick: 40 a's would take (a+)+b minutes to fail.
  const facts: LootFacts = { active: ["a".repeat(40) + ".esp"], allActive: true };
  const started = Date.now();
  assert.equal(answer('active("(a+)+b") or many_active("(a|aa)*c")', facts), "unknown");
  assert.ok(Date.now() - started < 1000);
});

test("a regex is case-insensitive and anchored at both ends, as LOOT anchors it", () => {
  const regex = safeRegex("Patch_.*\\.esp")!;
  assert.equal(regex.test("PATCH_x.ESP"), true);
  assert.equal(regex.test("my Patch_x.esp"), false);
  assert.equal(regex.test("Patch_x.esp.bak"), false);
});
