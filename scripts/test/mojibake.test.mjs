import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeDoubleEncoded,
  describeDoubleEncoding,
  findDoubleEncoded,
  looksDoubleEncoded,
} from "../lib/mojibake.mjs";

// ─── Why this file exists ────────────────────────────────────────────────────
// 0.2.3 shipped six package descriptions whose em-dash had been saved as UTF-8,
// read back as Windows-1252, and saved as UTF-8 again. npm rendered mojibake on
// six package pages, and because a published version cannot be overwritten,
// the only fix was to publish 0.2.4.
//
// 0.2.4's first guard searched for the literal string "â€". That is the
// Windows-1252 rendering of the UTF-8 lead pair E2 80, which encodes exactly
// U+2000–U+203F — so it caught the em-dash family and nothing else. An accented
// letter, ©, an arrow, ™ and every emoji all mojibake into sequences that guard
// never looked at, and all passed it at exit 0.
//
// The detector under test does not look for a signature at all. It undoes the
// transform and checks whether anything came back. These tests pin both halves
// of that: it must catch every family, and it must never flag correct text —
// because a false positive blocks a release, and a false negative ships a
// permanently broken package page.

/**
 * Produce genuine mojibake: UTF-8 encode, then decode those bytes as
 * Windows-1252. This is the exact accident that happened to 0.2.3, performed
 * deliberately, so the fixtures are real rather than hand-typed guesses.
 */
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

function mangle(text) {
  return [...Buffer.from(text, "utf8")]
    .map((b) => String.fromCodePoint(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : b))
    .join("");
}

// One per double-encoding family. The first three are what the old signature
// caught; everything below the divider is what it missed.
const SAMPLES = [
  ["em dash", "ModWrench — one MCP entry"],
  ["curly apostrophe", "the modder’s workbench"],
  ["ellipsis", "searching…"],
  // ── the families the "â€" signature could not see ──
  ["accented letter", "café"],
  ["copyright", "© 2026"],
  ["degree sign", "90° rotation"],
  ["non-breaking space", "10 MB"],
  ["arrow", "core → ui → cli"],
  ["trademark", "Steam™"],
  ["emoji", "🔧 ModWrench"],
];

for (const [family, correct] of SAMPLES) {
  test(`catches a double-encoded ${family}`, () => {
    const broken = mangle(correct);
    assert.notEqual(broken, correct, `the ${family} fixture did not actually mangle`);
    assert.ok(
      looksDoubleEncoded(broken),
      `a double-encoded ${family} passed the guard — this is the defect class ` +
        `that shipped in 0.2.3, and it is unfixable once published`
    );
  });

  test(`leaves a correctly-encoded ${family} alone`, () => {
    assert.ok(
      !looksDoubleEncoded(correct),
      `correct text was flagged as mojibake (${family}) — a false positive here ` +
        `blocks a release for no reason`
    );
  });

  test(`recovers the original text from a mangled ${family}`, () => {
    assert.equal(
      decodeDoubleEncoded(mangle(correct)),
      correct,
      `the guard detected the ${family} but could not say what it should have been`
    );
  });
}

test("plain ASCII is never flagged", () => {
  for (const s of ["", "ModWrench", "mcp-server", "a - b", "100% ASCII, no escapes"]) {
    assert.equal(decodeDoubleEncoded(s), null, `ASCII string was flagged: ${JSON.stringify(s)}`);
  }
});

test("every description and keyword this repo ships today is clean", async () => {
  // A regression fence around the thing 0.2.4 exists to fix. If someone
  // re-introduces the 0.2.3 defect, this fails in CI rather than on npm.
  const { readFileSync, readdirSync, existsSync } = await import("node:fs");
  const { join, resolve } = await import("node:path");
  const root = resolve(import.meta.dirname, "..", "..");

  for (const dir of readdirSync(join(root, "packages"))) {
    const manifest = join(root, "packages", dir, "package.json");
    if (!existsSync(manifest)) continue;
    const json = JSON.parse(readFileSync(manifest, "utf8"));
    assert.equal(
      describeDoubleEncoding(json.description),
      null,
      `packages/${dir} description is double-encoded`
    );
    for (const kw of json.keywords ?? []) {
      assert.equal(describeDoubleEncoding(kw), null, `packages/${dir} keyword ${kw}`);
    }
    const readme = join(root, "packages", dir, "README.md");
    if (existsSync(readme)) {
      assert.equal(
        describeDoubleEncoding(readFileSync(readme, "utf8")),
        null,
        `packages/${dir}/README.md is double-encoded — npm renders this as the ` +
          `entire body of the package page`
      );
    }
  }

  const server = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));
  assert.equal(describeDoubleEncoding(server.description), null, "server.json description");
  assert.equal(describeDoubleEncoding(server.title), null, "server.json title");
  assert.equal(
    describeDoubleEncoding(readFileSync(join(root, "README.md"), "utf8")),
    null,
    "the repo README is double-encoded"
  );
});

test("a mangled character next to an un-encodable one is still found", () => {
  // The whole-string approach misses this. "→" has no Windows-1252 byte, so
  // encoding the whole string fails and returns "clean" — while the mojibaked
  // "é" sitting beside it is exactly what we are hunting. Scanning run by run
  // is what makes this case work, so it gets its own test.
  const text = `core → ui, ${mangle("café")}`;

  // The crux: taken whole, the string cannot even be encoded, so the
  // whole-string check reports nothing.
  assert.equal(
    decodeDoubleEncoded(text),
    null,
    "precondition failed — this string was supposed to defeat the whole-string check"
  );

  // Run by run, the mangled character is still found. The run is the mangled
  // character alone, since "caf" is ASCII and not part of it.
  const hits = findDoubleEncoded(text);
  assert.equal(hits.length, 1, `expected one mangled run, got ${hits.length}`);
  assert.equal(hits[0].shouldBe, "é");
});

test("the message names both what is there and what it should be", () => {
  // The person reading this is mid-release and cannot overwrite a published
  // version, so the error has to be actionable on sight.
  const message = describeDoubleEncoding(mangle("ModWrench — one MCP entry"));
  assert.ok(message, "no message produced for known mojibake");
  assert.match(message, /should be/, `message does not say what the text should be: ${message}`);
  assert.ok(
    message.includes(JSON.stringify("—")),
    `message does not name the correct character: ${message}`
  );
});

test("multiple mangled runs are all reported, with a cap", () => {
  // One accented character each, so each word contributes exactly one run.
  const many = ["café", "naïve", "piñata", "Zürich", "Bogotá"].map(mangle).join(" and ");
  const hits = findDoubleEncoded(many);
  assert.equal(hits.length, 5, `expected 5 mangled runs, got ${hits.length}`);
  assert.match(
    describeDoubleEncoding(many),
    /\+2 more/,
    "the message should summarise rather than print every run"
  );
});

test("non-strings are handled rather than thrown on", () => {
  // package.json fields are whatever the author typed; a missing description is
  // undefined and a malformed one could be anything.
  for (const value of [undefined, null, 42, {}, [], true]) {
    assert.doesNotThrow(() => looksDoubleEncoded(value), `threw on ${JSON.stringify(value)}`);
    assert.equal(looksDoubleEncoded(value), false);
  }
});
