import { closeSync, fstatSync, openSync, readSync } from "node:fs";

// ─── A small, read-only Windows PE reader ────────────────────────────────────
// Patch Day needs three facts that live inside .exe / .dll files: the game's
// version (a resource), whether a plugin exports the symbols SKSE looks for,
// and the data those symbols point at. Windows APIs read these; on Linux and
// Steam Deck there is no such API, so this parses the format directly.
//
// Read-only by construction: the file is opened with "r" and only readSync is
// ever called. It reads headers and a few small tables, never the whole file —
// SkyrimSE.exe is tens of megabytes and we want a few hundred bytes of it.
//
// Hostile or truncated input must not throw past this module or allocate
// without bound: every count and length is capped, and every failure comes
// back as a plain `{ problem }` the caller can show.

const MAX_CHUNK = 4 * 1024 * 1024;
const MAX_EXPORTS = 20_000;
const MAX_SECTIONS = 96; // the Windows loader's own limit

export type PeSection = {
  virtualAddress: number;
  virtualSize: number;
  rawOffset: number;
  rawSize: number;
};

export type PeProblem = { problem: string };

/** Four-part file version, e.g. 1.6.1170.0 as [1, 6, 1170, 0]. */
export type FileVersion = [number, number, number, number];

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, position + got);
    if (n === 0) break;
    got += n;
  }
  return got === length ? buf : buf.subarray(0, got);
}

export class PeFile {
  private constructor(
    private readonly fd: number,
    readonly machine: number,
    readonly is64: boolean,
    private readonly sections: PeSection[],
    private readonly sizeOfHeaders: number,
    private readonly exportDir: { rva: number; size: number } | null,
    private readonly resourceDir: { rva: number; size: number } | null
  ) {}

  /** Open and parse the headers. Caller must `close()` a successful result. */
  static open(path: string): PeFile | PeProblem {
    let fd: number;
    try {
      fd = openSync(path, "r");
    } catch (err) {
      return { problem: `cannot open file (${errCode(err)})` };
    }
    try {
      const parsed = PeFile.parse(fd);
      if ("problem" in parsed) closeSync(fd);
      return parsed;
    } catch (err) {
      closeSync(fd);
      return { problem: `cannot read file (${errCode(err)})` };
    }
  }

  private static parse(fd: number): PeFile | PeProblem {
    const size = fstatSync(fd).size;
    const dos = readAt(fd, 0, 64);
    if (dos.length < 64 || dos.readUInt16LE(0) !== 0x5a4d) {
      return { problem: "not a Windows executable (no MZ header)" };
    }
    const peOffset = dos.readUInt32LE(0x3c);
    if (peOffset < 64 || peOffset > size - 24) {
      return { problem: "damaged PE header offset" };
    }
    const head = readAt(fd, peOffset, 24);
    if (head.length < 24 || head.readUInt32LE(0) !== 0x00004550) {
      return { problem: "no PE signature" };
    }
    const machine = head.readUInt16LE(4);
    const sectionCount = head.readUInt16LE(6);
    const optionalSize = head.readUInt16LE(20);
    if (sectionCount > MAX_SECTIONS || optionalSize < 96 || optionalSize > 1024) {
      return { problem: "damaged PE header" };
    }
    const tableBytes = optionalSize + sectionCount * 40;
    const rest = readAt(fd, peOffset + 24, tableBytes);
    if (rest.length < tableBytes) return { problem: "truncated PE header" };

    const magic = rest.readUInt16LE(0);
    if (magic !== 0x20b && magic !== 0x10b) {
      return { problem: "unknown PE optional-header format" };
    }
    const is64 = magic === 0x20b;
    const sizeOfHeaders = rest.readUInt32LE(60);
    const dirCount = rest.readUInt32LE(is64 ? 108 : 92);
    const dirBase = is64 ? 112 : 96;
    const dir = (index: number): { rva: number; size: number } | null => {
      if (index >= dirCount || dirBase + index * 8 + 8 > optionalSize) return null;
      const rva = rest.readUInt32LE(dirBase + index * 8);
      const dirSize = rest.readUInt32LE(dirBase + index * 8 + 4);
      return rva === 0 ? null : { rva, size: dirSize };
    };

    const sections: PeSection[] = [];
    for (let i = 0; i < sectionCount; i++) {
      const at = optionalSize + i * 40;
      sections.push({
        virtualSize: rest.readUInt32LE(at + 8),
        virtualAddress: rest.readUInt32LE(at + 12),
        rawSize: rest.readUInt32LE(at + 16),
        rawOffset: rest.readUInt32LE(at + 20),
      });
    }
    return new PeFile(fd, machine, is64, sections, sizeOfHeaders, dir(0), dir(2));
  }

  close(): void {
    try {
      closeSync(this.fd);
    } catch {
      // Nothing useful to do; the descriptor is released with the process.
    }
  }

  /**
   * Read `length` bytes at a relative virtual address, the way the Windows
   * loader would map them: bytes the file doesn't hold (a section's zero-filled
   * tail) read as zero. Returns null when the address maps to nothing.
   */
  readRva(rva: number, length: number): Buffer | null {
    if (length <= 0 || length > MAX_CHUNK) return null;
    for (const s of this.sections) {
      const span = Math.max(s.virtualSize, s.rawSize);
      if (rva < s.virtualAddress || rva >= s.virtualAddress + span) continue;
      const delta = rva - s.virtualAddress;
      const out = Buffer.alloc(length);
      const want = Math.min(length, Math.max(0, s.rawSize - delta));
      if (want > 0) readAt(this.fd, s.rawOffset + delta, want).copy(out);
      return out;
    }
    if (rva < this.sizeOfHeaders) {
      const out = Buffer.alloc(length);
      readAt(this.fd, rva, length).copy(out);
      return out;
    }
    return null;
  }

  /**
   * Named exports as name → RVA. Forwarded exports (which have no code or data
   * of their own) are left out. Returns null when the table is damaged or
   * implausibly large; an image with no export table returns an empty map.
   */
  exports(): Map<string, number> | null {
    const out = new Map<string, number>();
    if (!this.exportDir) return out;
    const dir = this.readRva(this.exportDir.rva, 40);
    if (!dir) return null;
    const functionCount = dir.readUInt32LE(20);
    const nameCount = dir.readUInt32LE(24);
    if (functionCount > MAX_EXPORTS || nameCount > MAX_EXPORTS) return null;
    if (nameCount === 0 || functionCount === 0) return out;

    const functions = this.readRva(dir.readUInt32LE(28), functionCount * 4);
    const names = this.readRva(dir.readUInt32LE(32), nameCount * 4);
    const ordinals = this.readRva(dir.readUInt32LE(36), nameCount * 2);
    if (!functions || !names || !ordinals) return null;

    const dirStart = this.exportDir.rva;
    const dirEnd = dirStart + this.exportDir.size;
    for (let i = 0; i < nameCount; i++) {
      const ordinalIndex = ordinals.readUInt16LE(i * 2);
      if (ordinalIndex >= functionCount) continue;
      const functionRva = functions.readUInt32LE(ordinalIndex * 4);
      if (functionRva >= dirStart && functionRva < dirEnd) continue; // forwarder
      const raw = this.readRva(names.readUInt32LE(i * 4), 128);
      if (!raw) continue;
      const end = raw.indexOf(0);
      out.set(raw.toString("latin1", 0, end === -1 ? raw.length : end), functionRva);
    }
    return out;
  }

  /**
   * The file version from the VS_VERSIONINFO resource (the same fixed-info
   * block Windows' GetFileVersionInfo returns, and the one SKSE reads to name
   * the DLL it injects). Null when there is no version resource.
   */
  fileVersion(): FileVersion | null {
    if (!this.resourceDir) return null;
    const base = this.resourceDir.rva;
    const entries = (offset: number): Array<{ id: number; named: boolean; target: number }> => {
      const head = this.readRva(base + offset, 16);
      if (!head) return [];
      const count = head.readUInt16LE(12) + head.readUInt16LE(14);
      if (count === 0 || count > 512) return [];
      const raw = this.readRva(base + offset + 16, count * 8);
      if (!raw) return [];
      const list = [];
      for (let i = 0; i < count; i++) {
        const name = raw.readUInt32LE(i * 8);
        list.push({
          id: name & 0x7fffffff,
          named: (name & 0x80000000) !== 0,
          target: raw.readUInt32LE(i * 8 + 4),
        });
      }
      return list;
    };
    const isDir = (target: number): boolean => (target & 0x80000000) !== 0;
    const RT_VERSION = 16;

    const type = entries(0).find((e) => !e.named && e.id === RT_VERSION);
    if (!type || !isDir(type.target)) return null;
    const name = entries(type.target & 0x7fffffff)[0];
    if (!name || !isDir(name.target)) return null;
    const language = entries(name.target & 0x7fffffff)[0];
    if (!language || isDir(language.target)) return null;

    const data = this.readRva(base + language.target, 16);
    if (!data) return null;
    const blob = this.readRva(data.readUInt32LE(0), Math.min(Math.max(data.readUInt32LE(4), 0), 512));
    if (!blob) return null;
    // VS_FIXEDFILEINFO follows the VS_VERSIONINFO header and key string, 4-byte
    // aligned, and starts with the signature 0xFEEF04BD.
    for (let at = 0; at + 24 <= blob.length; at += 4) {
      if (blob.readUInt32LE(at) !== 0xfeef04bd) continue;
      let ms = blob.readUInt32LE(at + 8);
      let ls = blob.readUInt32LE(at + 12);
      if (ms === 0 && ls === 0) {
        ms = blob.readUInt32LE(at + 16);
        ls = blob.readUInt32LE(at + 20);
      }
      return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff];
    }
    return null;
  }
}

function errCode(err: unknown): string {
  return err instanceof Error && "code" in err && typeof err.code === "string"
    ? err.code
    : "unreadable";
}

/** The first `length` bytes of a file, or null if it can't be read or is shorter than that. */
export function readFirstBytes(path: string, length: number): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const buf = readAt(fd, 0, length);
    return buf.length === length ? buf : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** The file version of an .exe or .dll, or null if it can't be read. */
export function readFileVersion(path: string): FileVersion | null {
  const pe = PeFile.open(path);
  if ("problem" in pe) return null;
  try {
    return pe.fileVersion();
  } finally {
    pe.close();
  }
}
