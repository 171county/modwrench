import { closeSync, openSync, readSync } from "node:fs";
import { decodeListText, decodeWindows1252, readBytes, readFileBytes } from "./fsutil.js";
import { join } from "node:path";

// ─── Reading a plugin's header, and the lists that name plugins ──────────────
// A Skyrim plugin (.esp, .esm, .esl) starts with one record, "TES4", that says
// what the plugin is: a master or not, a light plugin or not, and which other
// plugins it needs loaded first. That is all the Doctor reads, a few hundred
// bytes from the front of each file, so a list of two thousand plugins costs far
// less than opening them properly.
//
// Layout, from UESP's "Skyrim Mod: Mod File Format" and the esplugin library:
//   bytes 0-3    "TES4"
//   bytes 4-7    size of the data that follows the 24-byte record header (u32)
//   bytes 8-11   flags (u32): 0x1 master, 0x80 localized strings, 0x200 light
//   bytes 12-23  form id, version control and form version, unused here
//   then         subrecords, each 4 letters + u16 size + data
//                HEDR (12 bytes), then optionally CNAM, SNAM, and for every master a
//                MAST (zero-terminated file name, in Windows-1252) followed by a DATA subrecord of 8 bytes
// A subrecord bigger than 65,535 bytes is announced by an "XXXX" subrecord that holds the
// real size of the one after it.
//
// Hostile or damaged files must not throw or allocate without bound: everything is
// capped and every failure comes back as a plain `{ problem }`.

const HEADER_BYTES = 24;
const FIRST_READ = 4096;
/** A header with hundreds of masters is a few tens of kilobytes; nothing sane is bigger than this. */
const MAX_DATA = 1024 * 1024;
const MAX_MASTERS = 20_000;

export const FLAG_MASTER = 0x1;
export const FLAG_LOCALIZED = 0x80;
export const FLAG_LIGHT = 0x200;

export type PluginHeader = {
  /** The master flag is set. */
  master: boolean;
  /** The light (ESL) flag is set. */
  light: boolean;
  localized: boolean;
  /** Masters in the order the plugin lists them, as written in the file. */
  masters: string[];
  /** HEDR's version number (1.70 for Skyrim SE, 1.71 for the Anniversary Edition), when it could be read. */
  version: number | null;
};

export type HeaderProblemKind = "empty" | "not-a-plugin" | "truncated" | "too-large" | "unreadable";
export type HeaderProblem = { problem: HeaderProblemKind };

export function isProblem(value: PluginHeader | HeaderProblem): value is HeaderProblem {
  return "problem" in value;
}

/** The TES4 record out of the first bytes of a plugin. */
export function parseTes4(buf: Buffer): PluginHeader | HeaderProblem {
  if (buf.length === 0) return { problem: "empty" };
  if (buf.length < 4 || buf.toString("latin1", 0, 4) !== "TES4") return { problem: "not-a-plugin" };
  if (buf.length < HEADER_BYTES) return { problem: "truncated" };

  const dataSize = buf.readUInt32LE(4);
  if (dataSize > MAX_DATA) return { problem: "too-large" };
  const flags = buf.readUInt32LE(8);
  const end = HEADER_BYTES + dataSize;
  if (buf.length < end) return { problem: "truncated" };

  const masters: string[] = [];
  let version: number | null = null;
  let pos = HEADER_BYTES;
  let nextSize: number | null = null;

  while (pos + 6 <= end) {
    const type = buf.toString("latin1", pos, pos + 4);
    const declared = buf.readUInt16LE(pos + 4);
    pos += 6;
    if (type === "XXXX") {
      if (declared !== 4 || pos + 4 > end) return { problem: "truncated" };
      nextSize = buf.readUInt32LE(pos);
      pos += 4;
      continue;
    }
    const size = nextSize ?? declared;
    nextSize = null;
    if (pos + size > end) return { problem: "truncated" };
    if (type === "MAST") {
      let stop = pos;
      while (stop < pos + size && buf[stop] !== 0) stop++;
      if (masters.length < MAX_MASTERS) masters.push(decodeWindows1252(buf.subarray(pos, stop)));
    } else if (type === "HEDR" && size >= 4) {
      const v = buf.readFloatLE(pos);
      version = Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    }
    pos += size;
  }

  return {
    master: (flags & FLAG_MASTER) !== 0,
    light: (flags & FLAG_LIGHT) !== 0,
    localized: (flags & FLAG_LOCALIZED) !== 0,
    masters,
    version,
  };
}

function readFront(fd: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, got);
    if (n === 0) break;
    got += n;
  }
  return got === length ? buf : buf.subarray(0, got);
}

/** The header of the plugin at `path`. Opens the file read-only and reads only its front. */
export function readPluginHeader(path: string): PluginHeader | HeaderProblem {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return { problem: "unreadable" };
  }
  try {
    let buf = readFront(fd, FIRST_READ);
    if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "TES4") {
      const need = HEADER_BYTES + buf.readUInt32LE(4);
      if (need > buf.length && need <= HEADER_BYTES + MAX_DATA) buf = readFront(fd, need);
    }
    return parseTes4(buf);
  } catch {
    return { problem: "unreadable" };
  } finally {
    closeSync(fd);
  }
}

/** Whether the game counts the plugin as light: the flag, or the .esl extension. */
export function isLight(file: string, header: PluginHeader): boolean {
  return header.light || /\.esl$/i.test(file);
}

// ─── plugins.txt ─────────────────────────────────────────────────────────────
// One plugin per line, in load order. A leading asterisk means switched on. The base
// game's own files and the Creation Club files aren't listed: the game loads them anyway.

export type ListEntry = { name: string; enabled: boolean };

export function parsePluginList(text: string): ListEntry[] {
  const out: ListEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("*")) {
      const name = line.slice(1).trim();
      if (name !== "") out.push({ name, enabled: true });
    } else {
      out.push({ name: line, enabled: false });
    }
  }
  return out;
}

/** A plugins.txt on disk; null when it isn't there, "unreadable" when it is there but couldn't be opened. */
export function readPluginListFile(path: string): ListEntry[] | null | "unreadable" {
  const bytes = readFileBytes(path, 4 * 1024 * 1024);
  if (bytes === "missing") return null;
  return bytes === "unreadable" ? bytes : parsePluginList(decodeListText(bytes));
}

// ─── Plugins that load without being listed ──────────────────────────────────

/** Skyrim Special Edition's own plugins, in the order they load. */
export const SKYRIM_BASE_PLUGINS = ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"];

/** Fallout 4's own plugins, in the order they load (libloadorder's game_settings.rs). */
export const FALLOUT4_BASE_PLUGINS = [
  "Fallout4.esm",
  "DLCRobot.esm",
  "DLCworkshop01.esm",
  "DLCCoast.esm",
  "DLCworkshop02.esm",
  "DLCworkshop03.esm",
  "DLCNukaWorld.esm",
  "DLCUltraHighResolution.esm",
];

/**
 * The Creation Club plugins, as the game's .ccc file lists them (Skyrim.ccc, Fallout4.ccc). It sits in the game
 * folder and names every Creation Club file the game should load; the game loads each one that is installed.
 */
export function readCreationClubList(gameDir: string, file = "Skyrim.ccc"): string[] {
  const bytes = readBytes(join(gameDir, file), 256 * 1024);
  if (bytes === null) return [];
  const names: string[] = [];
  for (const raw of decodeListText(bytes).split(/\r?\n/)) {
    const line = raw.trim();
    if (line !== "" && !line.startsWith("#") && /\.(?:esp|esm|esl)$/i.test(line)) names.push(line);
  }
  return names;
}
