// Builds small, valid Windows PE images for tests: DOS + PE headers, a code
// stub, an export table, and an optional VS_VERSIONINFO resource. That is every
// structure Patch Day reads, and it lets the tests make "a plugin that
// declares X" or "a game that is version Y" without shipping game files.
//
// A builder and a parser written by the same person can agree with each other
// and both be wrong. Two things guard against that: the committed fixtures in
// test/fixtures/patchday/ were produced by a real toolchain (clang + lld-link),
// and the PE tests assert this builder and those files read back identically.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "patchday");

// Two binaries a real toolchain (clang + lld-link) produced; see
// fixtures/patchday/README.md. The repository stores them as base64 text, so it
// holds no executable files, and they are written out here to a private temp
// folder (removed when the test process exits) because the code under test
// reads files from disk.
const scratch = mkdtempSync(join(tmpdir(), "mw-patchday-fixtures-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

function materialise(name: string): string {
  const path = join(scratch, name);
  writeFileSync(path, Buffer.from(readFileSync(join(FIXTURES, `${name}.b64`), "utf8"), "base64"));
  return path;
}

export const REAL_PLUGIN = materialise("real-plugin.dll");
export const REAL_GAME_EXE = materialise("real-game-1.6.1170.exe");

export type PeSpec = {
  /** PE32+ (64-bit, default) or PE32 (a Skyrim LE-era plugin). */
  is64?: boolean;
  /**
   * Named exports. With `data`, the export is a data symbol whose bytes are
   * placed in .rdata (how SKSEPlugin_Version is exported); without it, it
   * points at a one-byte code stub. With `forward` ("other.dll.Name"), the export
   * is a forwarder: its address points at that text inside the export table.
   */
  exports?: Array<{ name: string; data?: Buffer; forward?: string }>;
  /** Adds a VS_VERSIONINFO resource carrying this file version. */
  version?: [number, number, number, number];
};

const FILE_ALIGN = 0x200;
const SECTION_ALIGN = 0x1000;

const alignUp = (n: number, to: number): number => Math.ceil(n / to) * to;

/** The 848-byte SKSEPluginVersionData struct, field for field. */
export function skseVersionData(opts: {
  dataVersion?: number;
  pluginVersion?: number;
  name?: string;
  author?: string;
  versionIndependenceEx?: number;
  versionIndependence?: number;
  compatibleVersions?: number[];
  seVersionRequired?: number;
}): Buffer {
  const b = Buffer.alloc(848);
  b.writeUInt32LE(opts.dataVersion ?? 1, 0);
  b.writeUInt32LE(opts.pluginVersion ?? 0x01000000, 4);
  b.write(opts.name ?? "TestPlugin", 8, 255, "latin1");
  b.write(opts.author ?? "tests", 264, 255, "latin1");
  b.writeUInt32LE(opts.versionIndependenceEx ?? 0, 772);
  b.writeUInt32LE(opts.versionIndependence ?? 0, 776);
  (opts.compatibleVersions ?? []).slice(0, 16).forEach((v, i) => b.writeUInt32LE(v, 780 + i * 4));
  b.writeUInt32LE(opts.seVersionRequired ?? 0, 844);
  return b;
}

function exportSection(
  baseRva: number,
  dllName: string,
  exports: NonNullable<PeSpec["exports"]>,
  codeRva: number
): { bytes: Buffer; dirRva: number; dirSize: number } {
  const sorted = [...exports].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const n = sorted.length;

  // Data blobs first, like lld lays them out; the export table follows. The
  // declared export-directory range then covers only the table and its
  // strings, exactly as a linker declares it.
  let cursor = 0;
  const blobs: Array<{ at: number; data: Buffer }> = [];
  const rvas = sorted.map((e) => {
    if (!e.data) return codeRva;
    cursor = alignUp(cursor, 16);
    blobs.push({ at: cursor, data: e.data });
    const rva = baseRva + cursor;
    cursor += e.data.length;
    return rva;
  });

  const dirAt = alignUp(cursor, 16);
  const eatAt = dirAt + 40;
  const nameTableAt = eatAt + n * 4;
  const ordinalAt = nameTableAt + n * 4;
  const stringsAt = ordinalAt + n * 2;
  const dllNameAt = stringsAt;
  let strCursor = dllNameAt + dllName.length + 1;
  const nameAt = sorted.map((e) => {
    const at = strCursor;
    strCursor += e.name.length + 1;
    return at;
  });
  const forwardAt = sorted.map((e) => {
    if (e.forward === undefined) return -1;
    const at = strCursor;
    strCursor += e.forward.length + 1;
    return at;
  });
  const total = strCursor;

  const bytes = Buffer.alloc(total);
  for (const blob of blobs) blob.data.copy(bytes, blob.at);
  bytes.writeUInt32LE(baseRva + dllNameAt, dirAt + 12); // Name
  bytes.writeUInt32LE(1, dirAt + 16); // Base
  bytes.writeUInt32LE(n, dirAt + 20); // NumberOfFunctions
  bytes.writeUInt32LE(n, dirAt + 24); // NumberOfNames
  bytes.writeUInt32LE(baseRva + eatAt, dirAt + 28);
  bytes.writeUInt32LE(baseRva + nameTableAt, dirAt + 32);
  bytes.writeUInt32LE(baseRva + ordinalAt, dirAt + 36);
  sorted.forEach((e, i) => {
    bytes.writeUInt32LE(forwardAt[i]! >= 0 ? baseRva + forwardAt[i]! : rvas[i]!, eatAt + i * 4);
    if (forwardAt[i]! >= 0) bytes.write(e.forward!, forwardAt[i]!, "latin1");
    bytes.writeUInt32LE(baseRva + nameAt[i]!, nameTableAt + i * 4);
    bytes.writeUInt16LE(i, ordinalAt + i * 2);
    bytes.write(e.name, nameAt[i]!, "latin1");
  });
  bytes.write(dllName, dllNameAt, "latin1");
  return { bytes, dirRva: baseRva + dirAt, dirSize: total - dirAt };
}

function resourceSection(baseRva: number, version: [number, number, number, number]): Buffer {
  // VS_VERSIONINFO: header, the key "VS_VERSION_INFO" in UTF-16, padding to a
  // 4-byte boundary, then VS_FIXEDFILEINFO.
  const info = Buffer.alloc(92);
  info.writeUInt16LE(92, 0); // wLength
  info.writeUInt16LE(52, 2); // wValueLength
  info.write("VS_VERSION_INFO", 6, "utf16le");
  const fixed = 40;
  const [major, minor, build, revision] = version;
  const ms = ((major << 16) | minor) >>> 0;
  const ls = ((build << 16) | revision) >>> 0;
  info.writeUInt32LE(0xfeef04bd, fixed);
  info.writeUInt32LE(0x00010000, fixed + 4);
  info.writeUInt32LE(ms, fixed + 8);
  info.writeUInt32LE(ls, fixed + 12);
  info.writeUInt32LE(ms, fixed + 16);
  info.writeUInt32LE(ls, fixed + 20);
  info.writeUInt32LE(0x3f, fixed + 24);
  info.writeUInt32LE(0x40004, fixed + 32);
  info.writeUInt32LE(1, fixed + 36);

  // Directory tree: type (RT_VERSION = 16) → name (1) → language (0x409) → data.
  const out = Buffer.alloc(88 + info.length);
  const dir = (at: number, id: number, target: number): void => {
    out.writeUInt16LE(1, at + 14); // one ID entry
    out.writeUInt32LE(id, at + 16);
    out.writeUInt32LE(target, at + 20);
  };
  dir(0, 16, (0x80000000 | 24) >>> 0);
  dir(24, 1, (0x80000000 | 48) >>> 0);
  dir(48, 0x409, 72);
  out.writeUInt32LE(baseRva + 88, 72); // OffsetToData (an RVA)
  out.writeUInt32LE(info.length, 76); // Size
  info.copy(out, 88);
  return out;
}

export function buildPe(spec: PeSpec = {}): Buffer {
  const is64 = spec.is64 ?? true;
  const optionalSize = is64 ? 240 : 224;
  const hasVersion = spec.version !== undefined;
  const sectionCount = 2 + (hasVersion ? 1 : 0);
  const headersSize = alignUp(0x80 + 24 + optionalSize + sectionCount * 40, FILE_ALIGN);

  const textRva = SECTION_ALIGN;
  const text = Buffer.alloc(FILE_ALIGN);
  text[0] = 0xc3; // ret

  const rdataRva = textRva + SECTION_ALIGN;
  const exp = exportSection(rdataRva, "test.dll", spec.exports ?? [], textRva);
  const rdata = Buffer.alloc(alignUp(exp.bytes.length, FILE_ALIGN));
  exp.bytes.copy(rdata);

  const rsrcRva = rdataRva + alignUp(rdata.length, SECTION_ALIGN);
  const rsrcRaw = hasVersion ? resourceSection(rsrcRva, spec.version!) : Buffer.alloc(0);
  const rsrc = Buffer.alloc(alignUp(rsrcRaw.length, FILE_ALIGN));
  rsrcRaw.copy(rsrc);

  const sections: Array<{ name: string; rva: number; data: Buffer; flags: number; virtual: number }> = [
    { name: ".text", rva: textRva, data: text, flags: 0x60000020, virtual: 1 },
    { name: ".rdata", rva: rdataRva, data: rdata, flags: 0x40000040, virtual: exp.bytes.length },
  ];
  if (hasVersion) {
    sections.push({ name: ".rsrc", rva: rsrcRva, data: rsrc, flags: 0x40000040, virtual: rsrcRaw.length });
  }

  const file = Buffer.alloc(headersSize + sections.reduce((n, s) => n + s.data.length, 0));
  file.write("MZ", 0, "latin1");
  file.writeUInt32LE(0x80, 0x3c);
  file.write("PE\\0\\0", 0x80, "latin1");
  const coff = 0x84;
  file.writeUInt16LE(is64 ? 0x8664 : 0x14c, coff);
  file.writeUInt16LE(sectionCount, coff + 2);
  file.writeUInt16LE(optionalSize, coff + 16);
  file.writeUInt16LE(is64 ? 0x2022 : 0x2102, coff + 18);

  const opt = coff + 20;
  const lastEnd = sections[sections.length - 1]!;
  const imageSize = lastEnd.rva + alignUp(lastEnd.virtual, SECTION_ALIGN);
  file.writeUInt16LE(is64 ? 0x20b : 0x10b, opt);
  file.writeUInt32LE(textRva, opt + 20); // BaseOfCode
  file.writeUInt32LE(SECTION_ALIGN, opt + 32); // SectionAlignment
  file.writeUInt32LE(FILE_ALIGN, opt + 36); // FileAlignment
  file.writeUInt32LE(imageSize, opt + 56); // SizeOfImage
  file.writeUInt32LE(headersSize, opt + 60); // SizeOfHeaders
  file.writeUInt16LE(2, opt + 68); // Subsystem: GUI
  file.writeUInt32LE(16, opt + (is64 ? 108 : 92)); // NumberOfRvaAndSizes
  const dirs = opt + (is64 ? 112 : 96);
  if ((spec.exports ?? []).length > 0) {
    file.writeUInt32LE(exp.dirRva, dirs);
    file.writeUInt32LE(exp.dirSize, dirs + 4);
  }
  if (hasVersion) {
    file.writeUInt32LE(rsrcRva, dirs + 16);
    file.writeUInt32LE(rsrcRaw.length, dirs + 20);
  }

  let rawAt = headersSize;
  sections.forEach((s, i) => {
    const h = opt + optionalSize + i * 40;
    file.write(s.name, h, "latin1");
    file.writeUInt32LE(s.virtual, h + 8);
    file.writeUInt32LE(s.rva, h + 12);
    file.writeUInt32LE(s.data.length, h + 16);
    file.writeUInt32LE(rawAt, h + 20);
    file.writeUInt32LE(s.flags, h + 36);
    s.data.copy(file, rawAt);
    rawAt += s.data.length;
  });
  return file;
}

// ─── Corrupting a built image ────────────────────────────────────────────────
// Damaged-file tests start from a valid image and break one field, so what
// they prove is that exactly that field is what the reader refuses.

type Section = { header: number; virtualAddress: number; rawOffset: number; rawSize: number };

/** Locate a section of an image made by `buildPe`. */
export function sectionOf(file: Buffer, name: string): Section {
  const count = file.readUInt16LE(0x84 + 2);
  const optionalSize = file.readUInt16LE(0x84 + 16);
  for (let i = 0; i < count; i++) {
    const header = 0x84 + 20 + optionalSize + i * 40;
    if (file.toString("latin1", header, header + 8).replace(/\\0+$/, "") === name) {
      return {
        header,
        virtualAddress: file.readUInt32LE(header + 12),
        rawSize: file.readUInt32LE(header + 16),
        rawOffset: file.readUInt32LE(header + 20),
      };
    }
  }
  throw new Error(`no section named ${name}`);
}

function fileOffsetOf(file: Buffer, rva: number): number {
  const count = file.readUInt16LE(0x84 + 2);
  const optionalSize = file.readUInt16LE(0x84 + 16);
  for (let i = 0; i < count; i++) {
    const h = 0x84 + 20 + optionalSize + i * 40;
    const va = file.readUInt32LE(h + 12);
    const raw = file.readUInt32LE(h + 16);
    if (rva >= va && rva < va + raw) return file.readUInt32LE(h + 20) + (rva - va);
  }
  throw new Error(`address ${rva.toString(16)} is in no section`);
}

/** Where the export directory (the 40-byte header) sits in the file. */
export function exportDirectoryOffset(file: Buffer): number {
  const is64 = file.readUInt16LE(0x84 + 20) === 0x20b;
  return fileOffsetOf(file, file.readUInt32LE(0x84 + 20 + (is64 ? 112 : 96)));
}

/** Make the export at sorted position `index` point at `rva`. */
export function pointExportAt(file: Buffer, index: number, rva: number): void {
  const dir = exportDirectoryOffset(file);
  file.writeUInt32LE(rva, fileOffsetOf(file, file.readUInt32LE(dir + 28)) + index * 4);
}
