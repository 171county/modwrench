import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatPacked,
  inspectSksePlugin,
  packVersion,
  parseSkseVersionData,
  parseVersionText,
  unpackVersion,
  SKSE_PLUGIN_VERSION_SIZE,
} from "../src/patchday/skse.js";
import {
  buildPe,
  exportDirectoryOffset,
  pointExportAt,
  REAL_PLUGIN,
  skseVersionData,
} from "./helpers/pe-builder.js";

const scratch = mkdtempSync(join(tmpdir(), "mw-skse-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
const write = (bytes: Buffer): string => {
  const path = join(scratch, `p${counter++}.dll`);
  writeFileSync(path, bytes);
  return path;
};

// ─── Version arithmetic ──────────────────────────────────────────────────────

test("a game version packs the way SKSE packs it", () => {
  // MAKE_EXE_VERSION_EX: 8 bits major, 8 minor, 12 build, 4 revision.
  assert.equal(packVersion(1, 6, 1170), 0x01064920);
  assert.equal(packVersion(1, 5, 97), 0x01050610);
  assert.equal(packVersion(1, 7, 104, 0), 0x01070680);
  assert.equal(packVersion(1, 6, 1179, 3), 0x010649b3);
  assert.equal(packVersion(2, 2, 6), 0x02020060);
});

test("packing and unpacking are inverses, and the packed value stays unsigned", () => {
  const versions: Array<[number, number, number, number]> = [
    [1, 6, 1170, 0],
    [255, 255, 4095, 15],
    [2, 2, 6, 0],
  ];
  for (const v of versions) {
    const packed = packVersion(...v);
    assert.ok(packed >= 0, "a high major version must not go negative");
    assert.deepEqual(unpackVersion(packed), v);
  }
  assert.equal(formatPacked(packVersion(1, 7, 104)), "1.7.104.0");
});

test("version text parses to the same packed value, and rejects what isn't a version", () => {
  assert.equal(parseVersionText("1.7.104"), packVersion(1, 7, 104));
  assert.equal(parseVersionText("1.7.104.0"), packVersion(1, 7, 104));
  assert.equal(parseVersionText("  v1.6.1170  "), packVersion(1, 6, 1170));
  for (const bad of ["", "1.7", "abc", "1.7.104.99", "256.0.0", "1.7.5000", "1.7.x", "1..2"]) {
    assert.equal(parseVersionText(bad), null, `"${bad}" should not parse`);
  }
});

// ─── The version-data struct ─────────────────────────────────────────────────

test("the struct is 848 bytes and every field is read from its offset", () => {
  assert.equal(SKSE_PLUGIN_VERSION_SIZE, 848);
  const blob = skseVersionData({
    dataVersion: 1,
    pluginVersion: 0x01020304,
    name: "My Plugin",
    author: "Someone",
    versionIndependenceEx: 3,
    versionIndependence: 5,
    compatibleVersions: [packVersion(1, 6, 1170), packVersion(1, 6, 1179)],
    seVersionRequired: packVersion(2, 2, 6),
  });
  assert.deepEqual(parseSkseVersionData(blob), {
    dataVersion: 1,
    pluginVersion: 0x01020304,
    name: "My Plugin",
    author: "Someone",
    versionIndependenceEx: 3,
    versionIndependence: 5,
    compatibleVersions: [packVersion(1, 6, 1170), packVersion(1, 6, 1179)],
    seVersionRequired: packVersion(2, 2, 6),
  });
});

test("the compatible-versions list ends at its first zero, as SKSE reads it", () => {
  const blob = skseVersionData({ compatibleVersions: [5, 6] });
  blob.writeUInt32LE(99, 780 + 3 * 4); // junk after the terminator
  assert.deepEqual(parseSkseVersionData(blob)!.compatibleVersions, [5, 6]);
});

test("a name that fills its whole field, with no terminator, is read to the field's end and no further", () => {
  const blob = skseVersionData({});
  blob.fill(0x41, 8, 264); // 256 'A's, no NUL
  blob.write("never-part-of-the-name", 264, "latin1"); // the author field follows immediately
  const parsed = parseSkseVersionData(blob)!;
  assert.equal(parsed.name, "A".repeat(256));
  assert.equal(parsed.author, "never-part-of-the-name");
});

test("a buffer shorter than the struct is not parsed", () => {
  assert.equal(parseSkseVersionData(Buffer.alloc(847)), null);
});

// ─── Reading a whole DLL ─────────────────────────────────────────────────────

test("a plugin DLL reports its exports and its declarations", () => {
  const info = inspectSksePlugin(
    write(
      buildPe({
        exports: [
          { name: "SKSEPlugin_Version", data: skseVersionData({ name: "Modern", versionIndependence: 5 }) },
          { name: "SKSEPlugin_Load" },
        ],
      })
    )
  );
  assert.equal(info.readable, true);
  assert.equal(info.is64, true);
  assert.deepEqual(info.exports, { version: true, query: false, load: true, preload: false });
  assert.equal(info.versionData?.name, "Modern");
  assert.equal(info.versionData?.versionIndependence, 5);
});

test("the real-toolchain plugin reads the same way", () => {
  const info = inspectSksePlugin(REAL_PLUGIN);
  assert.equal(info.versionData?.name, "RealToolchainPlugin");
  assert.equal(info.versionData?.seVersionRequired, packVersion(2, 2, 6));
});

test("a legacy plugin shows its SE-era entry points and no version data", () => {
  const info = inspectSksePlugin(
    write(buildPe({ exports: [{ name: "SKSEPlugin_Query" }, { name: "SKSEPlugin_Load" }] }))
  );
  assert.deepEqual(info.exports, { version: false, query: true, load: true, preload: false });
  assert.equal(info.versionData, undefined);
});

test("a preload-only plugin is seen as having a preload entry point", () => {
  const info = inspectSksePlugin(write(buildPe({ exports: [{ name: "SKSEPlugin_Preload" }] })));
  assert.deepEqual(info.exports, { version: false, query: false, load: false, preload: true });
});

test("a 32-bit DLL is reported as 32-bit without reading further", () => {
  const info = inspectSksePlugin(write(buildPe({ is64: false, exports: [{ name: "SKSEPlugin_Load" }] })));
  assert.equal(info.readable, true);
  assert.equal(info.is64, false);
  assert.deepEqual(info.exports, { version: false, query: false, load: false, preload: false });
});

test("a file that isn't a DLL is unreadable, with the reason", () => {
  const info = inspectSksePlugin(write(Buffer.from("not a dll")));
  assert.equal(info.readable, false);
  assert.match(info.problem ?? "", /MZ/);
});

test("a DLL with a damaged export table is unreadable, not 'exports nothing'", () => {
  // Treating damage as "no exports" would let a broken plugin pass as a harmless support library.
  const bytes = buildPe({ exports: [{ name: "SKSEPlugin_Load" }] });
  bytes.writeUInt32LE(0xfffffff0, exportDirectoryOffset(bytes) + 24);
  const info = inspectSksePlugin(write(bytes));
  assert.equal(info.readable, false);
  assert.equal(info.problem, "damaged export table");
});

test("a version-data export that points outside the file is reported, not trusted", () => {
  const bytes = buildPe({ exports: [{ name: "SKSEPlugin_Version", data: skseVersionData({}) }] });
  pointExportAt(bytes, 0, 0x7ffff000);
  const info = inspectSksePlugin(write(bytes));
  assert.equal(info.readable, true);
  assert.equal(info.exports.version, true);
  assert.equal(info.versionData, undefined);
  assert.match(info.problem ?? "", /points outside the file/);
});

test("a short blob under the version-data name is read as whatever the section holds, and never throws", () => {
  // 10 bytes where 848 are expected: the rest is the section's own padding and
  // the export table behind it. The struct that results is nonsense, which
  // SKSE's own checks would then refuse; the reader's job is only to not fall over.
  const info = inspectSksePlugin(
    write(buildPe({ exports: [{ name: "SKSEPlugin_Version", data: Buffer.alloc(10, 1) }] }))
  );
  assert.equal(info.exports.version, true);
  assert.equal(info.versionData?.dataVersion, 0x01010101);
});
