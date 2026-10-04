import { closeSync, fstatSync, openSync, readdirSync, readSync, realpathSync, statSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { pathExists } from "../detect/os.js";
import { isNetworkPath } from "../localpath.js";

// ─── Small, read-only file helpers for the Doctors ───────────────────────────
// Every function here swallows its own errors and says "nothing" instead: a
// folder that can't be opened is a fact for the report, never a crash.

/** Names in a folder, or null when it can't be listed: not there, held by another program, or not this account's to read. */
export function readDir(dir: string): string[] | null {
  try {
    return readdirSync(dir);
  } catch {
    return null;
  }
}

/** Names in a folder, or none when it can't be read. */
export function listDir(dir: string): string[] {
  return readDir(dir) ?? [];
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Follow `parts` below `base`, matching each name without regard to case. Windows games
 * come from a case-insensitive world; on Linux a folder called "skse" and one called "SKSE"
 * are different, and mods don't agree on which one to use. Returns null when a step is missing,
 * or would land on another computer (a mod named "..\..\UNC\host\share" under a \\?\C:\ folder).
 */
export function resolveCI(base: string, ...parts: string[]): string | null {
  let current = base;
  for (const part of parts) {
    const direct = join(current, part);
    if (isNetworkPath(direct)) return null;
    if (pathExists(direct)) {
      current = direct;
      continue;
    }
    const wanted = part.toLowerCase();
    const hit = listDir(current).find((name) => name.toLowerCase() === wanted);
    if (hit === undefined) return null;
    current = join(current, hit);
  }
  return current;
}

/** Why a read gave nothing: the file isn't there (or is a folder), or it is there and couldn't be read. */
export type Unread = "missing" | "unreadable";

/** The first `max` bytes of a file, or why there are none. */
export function readFileBytes(path: string, max: number): Buffer | Unread {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error) {
    // A file another program holds (EBUSY) or this account may not read (EPERM, EACCES) is there, just not readable.
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";
  }
  try {
    const stat = fstatSync(fd);
    // Windows opens a folder as if it were a file, and gives it a size of 0.
    if (!stat.isFile()) return "missing";
    const length = Math.min(stat.size, max);
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = readSync(fd, buf, got, length - got, got);
      if (n === 0) break;
      got += n;
    }
    return got === length ? buf : buf.subarray(0, got);
  } catch {
    return "unreadable";
  } finally {
    closeSync(fd);
  }
}

/** The first `max` bytes of a file, or null when it can't be opened or isn't a file. */
export function readBytes(path: string, max: number): Buffer | null {
  const bytes = readFileBytes(path, max);
  return typeof bytes === "string" ? null : bytes;
}

/** A text file, read as UTF-8, or null. */
export function readText(path: string, max = 4 * 1024 * 1024): string | null {
  const bytes = readBytes(path, max);
  return bytes === null ? null : bytes.toString("utf8");
}

/**
 * Windows-1252's characters for the bytes 0x80 to 0x9F, the only ones where it differs from Latin-1.
 * The five it leaves unused keep their byte's value, as in the WHATWG table that libloadorder and
 * esplugin decode with (encoding_rs).
 */
const CP1252_80_9F =
  "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f" +
  "\u0090‘’“”•–—˜™š›œ\u009džŸ";

/**
 * Bytes as Windows-1252, which is how Skyrim writes plugins.txt and the master names in a plugin.
 * Node's own TextDecoder("windows-1252") isn't used: some Node 20 and 22 releases decode it as Latin-1,
 * which turns ’ – … € ™ and the rest of 0x80-0x9F into invisible control characters (nodejs/node#56542).
 */
export function decodeWindows1252(bytes: Buffer): string {
  return bytes.toString("latin1").replace(/[\x80-\x9f]/g, (c) => CP1252_80_9F[c.charCodeAt(0) - 0x80]!);
}

/**
 * A list file such as plugins.txt: UTF-8 when it is valid UTF-8, otherwise Windows-1252
 * (which Skyrim writes, and which libloadorder reads the file as). A leading byte-order mark is dropped.
 */
export function decodeListText(bytes: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = decodeWindows1252(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Free space, in bytes, on the drive that holds `path`. Null when the system won't say. */
export function freeBytes(path: string): number | null {
  try {
    const s = statfsSync(path);
    const free = Number(s.bavail) * Number(s.bsize);
    return Number.isFinite(free) && free >= 0 ? free : null;
  } catch {
    return null;
  }
}

/** The real location of a path, with links followed, or the path as given. */
export function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Wall-clock budget for the heavy reads, so one enormous mod list can't stall a client. */
export class Budget {
  private readonly started = Date.now();
  constructor(private readonly ms: number) {}
  expired(): boolean {
    return Date.now() - this.started > this.ms;
  }
}
