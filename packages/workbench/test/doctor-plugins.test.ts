import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FLAG_LIGHT,
  FLAG_LOCALIZED,
  FLAG_MASTER,
  SKYRIM_BASE_PLUGINS,
  isLight,
  isProblem,
  parsePluginList,
  parseTes4,
  readCreationClubList,
  readPluginHeader,
  readPluginListFile,
  type PluginHeader,
} from "../src/doctor/plugins.js";
import { decodeListText, readFileBytes } from "../src/doctor/fsutil.js";
import { lockAway, tes4 } from "./helpers/doctor-world.js";

// ─── Plugin headers and the lists that name plugins ──────────────────────────
// The Doctors read a plugin's first few hundred bytes: the TES4 record, which says
// whether it is a master, whether it is light, and which masters it needs. These
// tests build headers byte by byte, the way the format lays them out, and also feed
// the reader damaged and hostile files, because it is pointed at whatever sits in a
// player's Data folder.

let TMP = "";
before(() => {
  TMP = mkdtempSync(join(tmpdir(), "mw-doctor-plugins-"));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const header = (buf: Buffer): PluginHeader => {
  const h = parseTes4(buf);
  assert.ok(!isProblem(h), `expected a header, got ${JSON.stringify(h)}`);
  return h;
};

// ─── parseTes4 ───────────────────────────────────────────────────────────────

test("a plain plugin: not a master, not light, no masters, and the game's version", () => {
  const h = header(tes4());
  assert.deepEqual(h, { master: false, light: false, localized: false, masters: [], version: 1.7 });
});

test("the flags say master, light and localized, each on its own", () => {
  assert.equal(FLAG_MASTER, 0x1);
  assert.equal(FLAG_LOCALIZED, 0x80);
  assert.equal(FLAG_LIGHT, 0x200);
  assert.equal(header(tes4({ master: true })).master, true);
  assert.equal(header(tes4({ master: true })).light, false);
  assert.equal(header(tes4({ light: true })).light, true);
  assert.equal(header(tes4({ light: true })).master, false);
  assert.equal(header(tes4({ localized: true })).localized, true);
  const all = header(tes4({ master: true, light: true, localized: true }));
  assert.deepEqual([all.master, all.light, all.localized], [true, true, true]);
});

test("masters come back in the order the plugin lists them, with their names as written", () => {
  const h = header(tes4({ masters: ["Skyrim.esm", "Update.esm", "My Mod.esp", "Café Patch.esp"] }));
  assert.deepEqual(h.masters, ["Skyrim.esm", "Update.esm", "My Mod.esp", "Café Patch.esp"]);
});

test("the version number is HEDR's, rounded to two places: 1.70 for Special Edition and 1.71 for the Anniversary Edition", () => {
  assert.equal(header(tes4({ version: 1.7 })).version, 1.7);
  assert.equal(header(tes4({ version: 1.71 })).version, 1.71);
  assert.equal(header(tes4({ version: 0.94 })).version, 0.94);
});

test("a plugin with no HEDR has no version, and a nonsense version is no version either", () => {
  assert.equal(header(tes4({ version: null, masters: ["A.esm"] })).version, null);
  // HEDR whose first four bytes are all ones is a NaN float.
  const bytes = tes4();
  bytes.fill(0xff, 24 + 6, 24 + 6 + 4);
  assert.equal(header(bytes).version, null);
});

test("bytes after the header, the plugin's own records, are left alone", () => {
  const h = header(tes4({ masters: ["Skyrim.esm"], tail: Buffer.from("GRUP____________________rest of the plugin") }));
  assert.deepEqual(h.masters, ["Skyrim.esm"]);
});

test("a master name with no terminator reads up to the end of its subrecord", () => {
  const name = Buffer.from("NoTerminator.esp", "latin1");
  const mast = Buffer.concat([Buffer.from("MAST", "latin1"), Buffer.from([name.length, 0]), name]);
  const head = Buffer.alloc(24);
  head.write("TES4", 0, "latin1");
  head.writeUInt32LE(mast.length, 4);
  assert.deepEqual(header(Buffer.concat([head, mast])).masters, ["NoTerminator.esp"]);
});

test("a subrecord longer than 65,535 bytes is announced by XXXX, and what comes after it is still read", () => {
  const big = 70_000;
  const xxxx = Buffer.alloc(6 + 4);
  xxxx.write("XXXX", 0, "latin1");
  xxxx.writeUInt16LE(4, 4);
  xxxx.writeUInt32LE(big, 6);
  const cnam = Buffer.alloc(6 + big); // CNAM with a declared size of 0; the real size came from XXXX
  cnam.write("CNAM", 0, "latin1");
  cnam.writeUInt16LE(0, 4);
  const mast = Buffer.concat([Buffer.from("MAST", "latin1"), Buffer.from([8, 0]), Buffer.from("Real.esm\0", "latin1").subarray(0, 8)]);
  const data = Buffer.concat([xxxx, cnam, mast]);
  const head = Buffer.alloc(24);
  head.write("TES4", 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  assert.deepEqual(header(Buffer.concat([head, data])).masters, ["Real.esm"]);
});

test("damage comes back as a plain problem and never as a throw", () => {
  assert.deepEqual(parseTes4(Buffer.alloc(0)), { problem: "empty" });
  assert.deepEqual(parseTes4(Buffer.from("TE")), { problem: "not-a-plugin" });
  assert.deepEqual(parseTes4(Buffer.from("MZ\x90\x00 this is an exe")), { problem: "not-a-plugin" });
  assert.deepEqual(parseTes4(Buffer.from("<html>Access denied</html>")), { problem: "not-a-plugin" });
  assert.deepEqual(parseTes4(Buffer.from("TES4\0\0\0\0")), { problem: "truncated" }, "shorter than the 24-byte record header");
  // The header announces more data than the file has.
  const cut = tes4({ masters: ["Skyrim.esm", "Another.esp"] }).subarray(0, 40);
  assert.deepEqual(parseTes4(cut), { problem: "truncated" });
  // A master that runs past the end of the record.
  const bad = tes4({ masters: ["Skyrim.esm"] });
  bad.writeUInt16LE(60_000, 24 + 6 + 12 + 4);
  assert.deepEqual(parseTes4(bad), { problem: "truncated" });
  // XXXX that doesn't say four bytes.
  const x = Buffer.alloc(24 + 6 + 4);
  x.write("TES4", 0, "latin1");
  x.writeUInt32LE(10, 4);
  x.write("XXXX", 24, "latin1");
  x.writeUInt16LE(9, 28);
  assert.deepEqual(parseTes4(x), { problem: "truncated" });
});

test("a header that announces an absurd amount of data is refused, not allocated", () => {
  const head = Buffer.alloc(24);
  head.write("TES4", 0, "latin1");
  head.writeUInt32LE(2 * 1024 * 1024, 4);
  assert.deepEqual(parseTes4(head), { problem: "too-large" });
  head.writeUInt32LE(0xffffffff, 4);
  assert.deepEqual(parseTes4(head), { problem: "too-large" });
});

test("random bytes after a TES4 tag never throw", () => {
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let round = 0; round < 300; round++) {
    const buf = Buffer.alloc(24 + (next() % 200));
    for (let i = 0; i < buf.length; i++) buf[i] = next() & 0xff;
    buf.write("TES4", 0, "latin1");
    if (round % 2 === 0) buf.writeUInt32LE(buf.length - 24, 4);
    const out = parseTes4(buf);
    assert.ok(isProblem(out) || Array.isArray(out.masters));
  }
});

// ─── readPluginHeader, from files ────────────────────────────────────────────

test("a plugin file is read, however many masters it has", () => {
  const dir = join(TMP, "read");
  mkdirSync(dir, { recursive: true });
  const masters = Array.from({ length: 300 }, (_, i) => `Master number ${i + 1}.esp`);
  const big = tes4({ masters });
  assert.ok(big.length > 4096, "the header is bigger than the first read, so the second read is exercised");
  writeFileSync(join(dir, "Big.esp"), big);
  const h = readPluginHeader(join(dir, "Big.esp"));
  assert.ok(!isProblem(h));
  assert.equal(h.masters.length, 300);
  assert.equal(h.masters[299], "Master number 300.esp");

  writeFileSync(join(dir, "Cut.esp"), big.subarray(0, 5000));
  assert.deepEqual(readPluginHeader(join(dir, "Cut.esp")), { problem: "truncated" });
});

test("files that aren't plugins come back as problems: empty, not a plugin, missing, and a folder", () => {
  const dir = join(TMP, "problems");
  mkdirSync(join(dir, "Folder.esp"), { recursive: true });
  writeFileSync(join(dir, "Empty.esp"), "");
  writeFileSync(join(dir, "Text.esp"), "This is not a plugin.");
  assert.deepEqual(readPluginHeader(join(dir, "Empty.esp")), { problem: "empty" });
  assert.deepEqual(readPluginHeader(join(dir, "Text.esp")), { problem: "not-a-plugin" });
  assert.deepEqual(readPluginHeader(join(dir, "Gone.esp")), { problem: "unreadable" });
  assert.deepEqual(readPluginHeader(join(dir, "Folder.esp")), { problem: "unreadable" });
});

test("light means the flag or the .esl name", () => {
  const plain = header(tes4());
  const flagged = header(tes4({ light: true }));
  assert.equal(isLight("A.esp", plain), false);
  assert.equal(isLight("A.esp", flagged), true);
  assert.equal(isLight("A.esl", plain), true);
  assert.equal(isLight("A.ESL", plain), true);
  assert.equal(isLight("A.esm", plain), false);
});

// ─── plugins.txt ─────────────────────────────────────────────────────────────

test("plugins.txt: an asterisk is on, no asterisk is off, comments and blank lines are skipped", () => {
  const text = ["# comment", "*Skyrim.esm", "", "*Mod One.esp", "Mod Two.esp", "  *Spaced.esp  ", "*", "# *Not.esp", ""].join("\r\n");
  assert.deepEqual(parsePluginList(text), [
    { name: "Skyrim.esm", enabled: true },
    { name: "Mod One.esp", enabled: true },
    { name: "Mod Two.esp", enabled: false },
    { name: "Spaced.esp", enabled: true },
  ]);
});

test("plugins.txt: both kinds of line ending", () => {
  assert.equal(parsePluginList("*A.esp\n*B.esp\r\nC.esp\r\n").length, 3);
});

test("a list file is UTF-8 when it is, Windows-1252 when it isn't, and loses a byte-order mark", () => {
  assert.equal(decodeListText(Buffer.from([0xef, 0xbb, 0xbf, 0x2a, 0x41, 0x2e, 0x65, 0x73, 0x70])), "*A.esp", "a UTF-8 byte-order mark is dropped");
  assert.equal(decodeListText(Buffer.from("*Café.esp", "utf8")), "*Café.esp", "valid UTF-8 is kept");
  assert.equal(decodeListText(Buffer.from([0x2a, 0x43, 0x61, 0x66, 0xe9, 0x2e, 0x65, 0x73, 0x70])), "*Café.esp", "a lone é byte is Windows-1252, not an error");
  assert.equal(decodeListText(Buffer.from("")), "");
});

test("Windows-1252's own letters at 0x80 to 0x9F are read as those letters, in a list and in a master's name, not as Latin-1's invisible controls", () => {
  // ’ – … € Š š Ž ž Œ œ ™, the way Windows-1252 writes them.
  const letters = Buffer.from([0x2a, 0x92, 0x96, 0x85, 0x80, 0x8a, 0x9a, 0x8e, 0x9e, 0x8c, 0x9c, 0x99]);
  assert.equal(decodeListText(letters), "*’–…€ŠšŽžŒœ™");
  assert.equal(decodeListText(Buffer.from([0x81, 0x8d, 0x8f, 0x90, 0x9d])), "\u0081\u008d\u008f\u0090\u009d", "the five bytes Windows-1252 leaves unused keep their value");
  const master = Buffer.concat([Buffer.from("Seva", "latin1"), Buffer.from([0x92]), Buffer.from("s ", "latin1"), Buffer.from([0x96]), Buffer.from(" A.esm", "latin1")]);
  assert.deepEqual(header(tes4({ masters: [master] })).masters, ["Seva’s – A.esm"]);
});

test("a plugin list on disk is read, and a missing one is null, not an error", () => {
  const dir = join(TMP, "lists");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Plugins.txt"), Buffer.from([0x23, 0x0a, 0x2a, 0x43, 0x61, 0x66, 0xe9, 0x2e, 0x65, 0x73, 0x70, 0x0d, 0x0a]));
  assert.deepEqual(readPluginListFile(join(dir, "Plugins.txt")), [{ name: "Café.esp", enabled: true }]);
  assert.equal(readPluginListFile(join(dir, "nope.txt")), null);
  mkdirSync(join(dir, "folder.txt"));
  assert.equal(readPluginListFile(join(dir, "folder.txt")), null, "a folder where a file should be");
});

test("a list file that is there but can't be opened is 'unreadable', which is not the same as missing", (t) => {
  const dir = join(TMP, "locked");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "Plugins.txt");
  writeFileSync(file, "*A.esp\r\n");
  assert.equal(readFileBytes(join(dir, "nope.txt"), 100), "missing");
  assert.equal(readFileBytes(dir, 100), "missing", "a folder where a file should be");
  const release = lockAway(file);
  if (release === null) return t.skip("this system reads it anyway (running as root?)");
  try {
    assert.equal(readFileBytes(file, 100), "unreadable");
    assert.equal(readPluginListFile(file), "unreadable");
  } finally {
    release();
  }
  assert.deepEqual(readPluginListFile(file), [{ name: "A.esp", enabled: true }], "and once it is let go, it reads");
});

// ─── Plugins that load without being listed ──────────────────────────────────

test("the game's own plugins, in the order they load", () => {
  assert.deepEqual(SKYRIM_BASE_PLUGINS, ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"]);
});

test("Skyrim.ccc names the Creation Club plugins; anything that isn't a plugin line is ignored", () => {
  const dir = join(TMP, "ccc");
  mkdirSync(dir, { recursive: true });
  assert.deepEqual(readCreationClubList(dir), [], "no file, no list");
  writeFileSync(join(dir, "Skyrim.ccc"), ["# not a plugin", "ccBGSSSE001-Fish.esm", "", "  ccQDRSSE001-SurvivalMode.esl  ", "readme", "ccFSVSSE001-Backpacks.esm"].join("\r\n"));
  assert.deepEqual(readCreationClubList(dir), ["ccBGSSSE001-Fish.esm", "ccQDRSSE001-SurvivalMode.esl", "ccFSVSSE001-Backpacks.esm"]);
});
