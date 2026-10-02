import { closeSync, fstatSync, openSync, readdirSync, readSync, realpathSync, statSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { pathExists } from "../detect/os.js";

// ─── Small, read-only file helpers for the Doctors ───────────────────────────
// Every function here swallows its own errors and says "nothing" instead: a
// folder that can't be opened is a fact for the report, never a crash.

/** Names in a folder, or none when it can't be read. */
export function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
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
 * are different, and mods don't agree on which one to use. Returns null when a step is missing.
 */
export function resolveCI(base: string, ...parts: string[]): string | null {
  let current = base;
  for (const part of parts) {
    const direct = join(current, part);
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

/** The first `max` bytes of a file, or null when it can't be opened. */
export function readBytes(path: string, max: number): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const length = Math.min(fstatSync(fd).size, max);
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = readSync(fd, buf, got, length - got, got);
      if (n === 0) break;
      got += n;
    }
    return got === length ? buf : buf.subarray(0, got);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** A text file, read as UTF-8, or null. */
export function readText(path: string, max = 4 * 1024 * 1024): string | null {
  const bytes = readBytes(path, max);
  return bytes === null ? null : bytes.toString("utf8");
}

/**
 * A list file such as plugins.txt: UTF-8 when it is valid UTF-8, otherwise Windows-1252
 * (which Skyrim writes and which Latin-1 reads correctly for ordinary accented letters).
 * A leading byte-order mark is dropped.
 */
export function decodeListText(bytes: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = bytes.toString("latin1");
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
