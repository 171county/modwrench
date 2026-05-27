import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVdf } from "../src/detect/vdf.js";

// Steam's libraryfolders.vdf format. Real data has many more keys; this is
// the minimal shape we actually consume.
const LIBRARYFOLDERS_VDF = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"label"\t\t""
\t\t"contentid"\t\t"123456"
\t\t"apps"
\t\t{
\t\t\t"489830"\t\t"10000000"
\t\t\t"377160"\t\t"15000000"
\t\t}
\t}
\t"1"
\t{
\t\t"path"\t\t"D:\\\\SteamLibrary"
\t\t"apps"
\t\t{
\t\t\t"1966720"\t\t"5000000"
\t\t}
\t}
}`;

// Minimal appmanifest_*.acf shape
const APPMANIFEST_ACF = `"AppState"
{
\t"appid"\t\t"489830"
\t"name"\t\t"The Elder Scrolls V: Skyrim Special Edition"
\t"installdir"\t\t"Skyrim Special Edition"
\t"LastUpdated"\t\t"1700000000"
}`;

test("VDF: parses libraryfolders.vdf with nested apps", () => {
  const parsed = parseVdf(LIBRARYFOLDERS_VDF);
  assert.ok(parsed);
  assert.equal(typeof parsed["0"], "object");
  const lib0 = parsed["0"] as Record<string, unknown>;
  assert.equal(lib0["path"], "C:\\Program Files (x86)\\Steam");
});

test("VDF: nested apps dictionary is preserved", () => {
  const parsed = parseVdf(LIBRARYFOLDERS_VDF);
  assert.ok(parsed);
  const lib0 = parsed["0"] as Record<string, unknown>;
  const apps = lib0["apps"] as Record<string, unknown>;
  assert.equal(apps["489830"], "10000000");
});

test("VDF: parses appmanifest .acf", () => {
  const parsed = parseVdf(APPMANIFEST_ACF);
  assert.ok(parsed);
  assert.equal(parsed["appid"], "489830");
  assert.equal(parsed["name"], "The Elder Scrolls V: Skyrim Special Edition");
  assert.equal(parsed["installdir"], "Skyrim Special Edition");
});

test("VDF: handles line comments", () => {
  const text = `"root"
{
\t// a comment
\t"key"\t"value"
\t// another comment
}`;
  const parsed = parseVdf(text);
  assert.equal(parsed?.["key"], "value");
});

test("VDF: returns null on malformed input rather than throwing", () => {
  assert.equal(parseVdf("not valid vdf"), null);
  assert.equal(parseVdf(""), null);
  assert.equal(parseVdf('"unclosed string'), null);
});

test("VDF: handles escaped quotes inside values", () => {
  const text = `"root"
{
\t"quoted"\t"value with \\"escaped\\" quotes"
}`;
  const parsed = parseVdf(text);
  assert.equal(parsed?.["quoted"], 'value with "escaped" quotes');
});
