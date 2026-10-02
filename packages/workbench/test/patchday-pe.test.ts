import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PeFile, readFileVersion, readFirstBytes } from "../src/patchday/pe.js";
import { parseSkseVersionData } from "../src/patchday/skse.js";
import {
  buildPe,
  exportDirectoryOffset,
  REAL_GAME_EXE,
  REAL_PLUGIN,
  sectionOf,
  skseVersionData,
} from "./helpers/pe-builder.js";

// The PE reader is the one piece of Patch Day that has to be right about a
// binary format. It is checked three ways: against files a real toolchain built
// (test/fixtures/patchday), against files the helper builds, and against damaged
// input that must come back as a plain problem rather than an exception.

const scratch = mkdtempSync(join(tmpdir(), "mw-pe-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function write(bytes: Buffer): string {
  const path = join(scratch, `f${counter++}.bin`);
  writeFileSync(path, bytes);
  return path;
}

function open(path: string): PeFile {
  const pe = PeFile.open(path);
  assert.ok(!("problem" in pe), "problem" in pe ? pe.problem : "");
  return pe as PeFile;
}

// ─── Real toolchain output ───────────────────────────────────────────────────

test("reads the file version out of an executable a real toolchain built", () => {
  assert.deepEqual(readFileVersion(REAL_GAME_EXE), [1, 6, 1170, 0]);
});

test("reads a real DLL's exports and the version data they point at", () => {
  const pe = open(REAL_PLUGIN);
  try {
    assert.equal(pe.is64, true);
    assert.equal(pe.machine, 0x8664);
    const exports = pe.exports()!;
    assert.deepEqual([...exports.keys()].sort(), ["SKSEPlugin_Load", "SKSEPlugin_Version"]);

    const data = parseSkseVersionData(pe.readRva(exports.get("SKSEPlugin_Version")!, 848)!)!;
    assert.equal(data.dataVersion, 1);
    assert.equal(data.pluginVersion, 0x01020300);
    assert.equal(data.name, "RealToolchainPlugin");
    assert.equal(data.author, "fixture");
    assert.equal(data.versionIndependence, 1 | 4);
    assert.equal(data.versionIndependenceEx, 2);
    assert.deepEqual(data.compatibleVersions, []);
    assert.equal(data.seVersionRequired, 0x02020060);
  } finally {
    pe.close();
  }
});

// ─── Files the helper builds ─────────────────────────────────────────────────

test("a helper-built executable reads back every version it is given", () => {
  for (const version of [
    [1, 6, 1170, 0],
    [1, 7, 104, 0],
    [1, 5, 97, 0],
    [2, 2, 6, 0],
    [1, 6, 1179, 3],
  ] as Array<[number, number, number, number]>) {
    assert.deepEqual(readFileVersion(write(buildPe({ version }))), version);
  }
});

test("the helper and the real toolchain agree on what a version-data export looks like", () => {
  // If the helper and the parser were both wrong in the same way they would
  // still agree with each other; agreeing with a real linker's output is the check.
  const built = open(
    write(
      buildPe({
        exports: [
          {
            name: "SKSEPlugin_Version",
            data: skseVersionData({
              name: "RealToolchainPlugin",
              author: "fixture",
              pluginVersion: 0x01020300,
              versionIndependence: 5,
              versionIndependenceEx: 2,
              seVersionRequired: 0x02020060,
            }),
          },
          { name: "SKSEPlugin_Load" },
        ],
      })
    )
  );
  const real = open(REAL_PLUGIN);
  try {
    const read = (pe: PeFile) =>
      parseSkseVersionData(pe.readRva(pe.exports()!.get("SKSEPlugin_Version")!, 848)!);
    assert.deepEqual(read(built), read(real));
    assert.deepEqual([...built.exports()!.keys()].sort(), [...real.exports()!.keys()].sort());
  } finally {
    built.close();
    real.close();
  }
});

test("a data export reads back byte for byte; a code export points at code", () => {
  const blob = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff));
  const pe = open(write(buildPe({ exports: [{ name: "Data", data: blob }, { name: "Code" }] })));
  try {
    const exports = pe.exports()!;
    assert.deepEqual(pe.readRva(exports.get("Data")!, blob.length), blob);
    assert.equal(pe.readRva(exports.get("Code")!, 1)![0], 0xc3);
  } finally {
    pe.close();
  }
});

test("bytes the file doesn't hold at the end of a section read as zero, as the Windows loader maps them", () => {
  const bytes = buildPe({ exports: [{ name: "X" }] });
  const rdata = sectionOf(bytes, ".rdata");
  // Mark the last four bytes the file holds for the section, then declare the
  // section larger in memory than on disk — the shape of a section with
  // uninitialised data at its end.
  bytes.fill(0xaa, rdata.rawOffset + rdata.rawSize - 4, rdata.rawOffset + rdata.rawSize);
  bytes.writeUInt32LE(rdata.rawSize + 0x1000, rdata.header + 8);
  const pe = open(write(bytes));
  try {
    const edge = pe.readRva(rdata.virtualAddress + rdata.rawSize - 4, 8)!;
    assert.deepEqual([...edge], [0xaa, 0xaa, 0xaa, 0xaa, 0, 0, 0, 0]);
    assert.equal(
      pe.readRva(rdata.virtualAddress + rdata.rawSize + 0x1000, 4),
      null,
      "past the declared size there is nothing"
    );
    assert.equal(pe.readRva(0x7ffff000, 4), null, "an address that maps to nothing returns null");
  } finally {
    pe.close();
  }
});

test("a read of zero or absurd length returns null instead of allocating", () => {
  const pe = open(write(buildPe({ exports: [{ name: "X" }] })));
  try {
    assert.equal(pe.readRva(0x2000, 0), null);
    assert.equal(pe.readRva(0x2000, -5), null);
    assert.equal(pe.readRva(0x2000, 64 * 1024 * 1024), null);
  } finally {
    pe.close();
  }
});

test("a forwarded export has no code or data of its own and is left out", () => {
  const pe = open(
    write(buildPe({ exports: [{ name: "Real" }, { name: "Fwd", forward: "other.dll.Real" }] }))
  );
  try {
    assert.deepEqual([...pe.exports()!.keys()], ["Real"]);
  } finally {
    pe.close();
  }
});

test("an image with no export table has no exports, and one with no version resource has no version", () => {
  const pe = open(write(buildPe()));
  try {
    assert.equal(pe.exports()!.size, 0);
    assert.equal(pe.fileVersion(), null);
  } finally {
    pe.close();
  }
});

test("a 32-bit image is recognised as 32-bit", () => {
  const pe = open(write(buildPe({ is64: false, exports: [{ name: "SKSEPlugin_Load" }] })));
  try {
    assert.equal(pe.is64, false);
    assert.equal(pe.machine, 0x14c);
    assert.deepEqual([...pe.exports()!.keys()], ["SKSEPlugin_Load"]);
  } finally {
    pe.close();
  }
});

test("a 32-bit executable's version reads the same way", () => {
  assert.deepEqual(readFileVersion(write(buildPe({ is64: false, version: [1, 9, 32, 0] }))), [1, 9, 32, 0]);
});

// ─── Damaged and hostile input ───────────────────────────────────────────────

test("input that isn't a PE comes back as a problem, never an exception", () => {
  const good = buildPe({ exports: [{ name: "X" }] });
  const smashedSignature = Buffer.from(good);
  smashedSignature[0x80] = 0;
  const cases: Array<[string, Buffer, RegExp]> = [
    ["empty file", Buffer.alloc(0), /MZ/],
    ["text file", Buffer.from("just some text, nothing to see here"), /MZ/],
    [
      "MZ but PE offset past the end",
      Buffer.concat([Buffer.from("MZ"), Buffer.alloc(0x3a), Buffer.from([0xff, 0xff, 0, 0])]),
      /offset/,
    ],
    ["PE signature smashed", smashedSignature, /signature/],
    ["cut off in the section table", good.subarray(0, 0x120), /truncated/],
  ];
  for (const [label, bytes, expected] of cases) {
    const result = PeFile.open(write(bytes));
    assert.ok("problem" in result, `${label} should be a problem`);
    assert.match(result.problem, expected, label);
  }
});

test("a missing file and a directory are problems too", () => {
  const missing = PeFile.open(join(scratch, "nope.dll"));
  assert.ok("problem" in missing);
  assert.match(missing.problem, /ENOENT/);

  const dir = join(scratch, "adir");
  mkdirSync(dir);
  const result = PeFile.open(dir);
  assert.ok("problem" in result);
  assert.equal(readFileVersion(dir), null);
});

test("an export count no real DLL has is refused rather than read", () => {
  // Four billion is stopped by the read-size limit as well; a hundred thousand is
  // small enough to be read, so only the export-count cap itself stops it.
  for (const count of [0xfffffff0, 100_000]) {
    for (const field of [20, 24]) {
      // NumberOfFunctions, then NumberOfNames.
      const bytes = buildPe({ exports: [{ name: "A" }, { name: "B" }] });
      bytes.writeUInt32LE(count, exportDirectoryOffset(bytes) + field);
      const pe = open(write(bytes));
      try {
        assert.equal(pe.exports(), null, `${count} at +${field}`);
      } finally {
        pe.close();
      }
    }
  }
});

test("an export table whose arrays point at nothing is damaged, not empty", () => {
  for (const field of [28, 32, 36]) {
    // AddressOfFunctions, AddressOfNames, AddressOfNameOrdinals.
    const bytes = buildPe({ exports: [{ name: "A" }] });
    bytes.writeUInt32LE(0x7ffff000, exportDirectoryOffset(bytes) + field);
    const pe = open(write(bytes));
    try {
      assert.equal(pe.exports(), null, `field at +${field}`);
    } finally {
      pe.close();
    }
  }
});

test("a damaged resource tree gives no version rather than a wrong one", () => {
  const bytes = buildPe({ version: [1, 6, 1170, 0] });
  const rsrc = sectionOf(bytes, ".rsrc");
  // Point the type entry's subdirectory far outside the section.
  bytes.writeUInt32LE((0x80000000 | 0x7fff0000) >>> 0, rsrc.rawOffset + 20);
  assert.equal(readFileVersion(write(bytes)), null);
});

test("a version resource with no fixed-file-info block gives no version", () => {
  const bytes = buildPe({ version: [1, 6, 1170, 0] });
  const rsrc = sectionOf(bytes, ".rsrc");
  // The VS_FIXEDFILEINFO signature sits at 88 + 40 into the section; break it.
  bytes.writeUInt32LE(0, rsrc.rawOffset + 88 + 40);
  assert.equal(readFileVersion(write(bytes)), null);
});

test("readFirstBytes returns the head of a file, or null when there isn't enough", () => {
  const path = write(Buffer.from([1, 2, 3, 4, 5, 6]));
  assert.deepEqual([...readFirstBytes(path, 4)!], [1, 2, 3, 4]);
  assert.equal(readFirstBytes(path, 7), null);
  assert.equal(readFirstBytes(join(scratch, "nope"), 1), null);
});
