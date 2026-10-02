import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { pathExists } from "../detect/os.js";
import { findGameById } from "../detect/games.js";
import { findInstalledApp, findSteamLibraries, findSteamRoot } from "../detect/steam.js";
import { findR2modmanRoot } from "../loadorder/r2modman.js";

// ─── Finding the crash log ───────────────────────────────────────────────────
// Most players don't know where their crash log is, and the answer differs for
// every logger. This looks in the places the loggers write, newest file first, so
// "my game just crashed" needs no path. Read-only: it lists folders and opens the
// newest files; it writes nothing and keeps nothing.
//
// What it finds carries a full path, because it has to open the file. The path
// stays inside this package: results name the file, never the folders.

export type FoundLog = {
  /** Used to open the file. Never copied into a result. */
  abs: string;
  /** The file's own name, for the answer. */
  name: string;
  mtimeMs: number;
  size: number;
  gameId: string;
};

type Spec = {
  gameId: string;
  /** For the plain-words account of where it looked. */
  name: string;
  /**
   * Crash Logger SSE and Buffout 4 write "crash-<date>.log" next to the script extender's own log,
   * under Documents\My Games\<folder>\<sub>. GOG and Epic copies keep Documents under another folder name.
   */
  documents?: { folders: string[]; sub: string };
  /** Logs inside the install folder: folder parts below it, and the file names that count. */
  inGame?: Array<{ parts: string[]; pattern: RegExp }>;
  /** BepInEx's LogOutput.log: in the game folder, or in one of r2modman's profiles. */
  bepinex?: boolean;
};

const CRASH_FILE = /^crash-.*\.log$/i;

const SPECS: Spec[] = [
  {
    gameId: "skyrimspecialedition",
    name: "Skyrim Special Edition",
    documents: { folders: ["Skyrim Special Edition", "Skyrim Special Edition GOG"], sub: "SKSE" },
    // NetScriptFramework's crash folder is written from memory, not checked against its source.
    inGame: [{ parts: ["Data", "NetScriptFramework", "Crash"], pattern: /\.(?:txt|log)$/i }],
  },
  { gameId: "skyrimvr", name: "Skyrim VR", documents: { folders: ["Skyrim VR"], sub: "SKSE" } },
  {
    gameId: "fallout4",
    name: "Fallout 4",
    documents: { folders: ["Fallout4", "Fallout4 GOG", "Fallout4 EPIC"], sub: "F4SE" },
    // Where Buffout 4 keeps its logs has been checked only in part, so both likely places are read.
    inGame: [{ parts: ["Data", "F4SE", "Plugins"], pattern: CRASH_FILE }],
  },
  { gameId: "fallout4vr", name: "Fallout 4 VR", documents: { folders: ["Fallout4VR"], sub: "F4SE" } },
  { gameId: "lethalcompany", name: "Lethal Company", bepinex: true },
  { gameId: "valheim", name: "Valheim", bepinex: true },
  { gameId: "repo", name: "R.E.P.O.", bepinex: true },
  { gameId: "riskofrain2", name: "Risk of Rain 2", bepinex: true },
  { gameId: "dysonsphereprogram", name: "Dyson Sphere Program", bepinex: true },
];

/** The games Crash Whisperer knows where to look for a log. */
export const CRASH_LOG_GAMES: string[] = SPECS.map((s) => s.gameId);

const MAX_PER_FOLDER = 400;
const KEEP_PER_GAME = 40;

/** A path under `base`, ignoring letter case: Windows tools don't care and Linux filesystems do. */
function child(base: string, name: string): string | null {
  const direct = join(base, name);
  if (pathExists(direct)) return direct;
  try {
    const match = readdirSync(base).find((n) => n.toLowerCase() === name.toLowerCase());
    return match === undefined ? null : join(base, match);
  } catch {
    return null;
  }
}

function resolveParts(base: string, parts: string[]): string | null {
  let current: string | null = base;
  for (const part of parts) {
    if (current === null) return null;
    current = child(current, part);
  }
  return current;
}

/** The "Documents" folders to look in: the player's own, and on Linux the one inside the game's Proton prefix. */
function documentsRoots(steamapps: string | null, appId: string): string[] {
  const roots: string[] = [];
  if (process.platform === "win32") {
    const home = homedir();
    roots.push(join(home, "Documents"), join(home, "OneDrive", "Documents"));
  } else if (steamapps) {
    // Proton keeps Documents inside the game's own Wine prefix, under the user "steamuser".
    roots.push(join(steamapps, "compatdata", appId, "pfx", "drive_c", "users", "steamuser", "Documents"));
  }
  return roots;
}

function listFiles(dir: string, pattern: RegExp, gameId: string): FoundLog[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: FoundLog[] = [];
  for (const name of names.slice(0, MAX_PER_FOLDER)) {
    if (!pattern.test(name)) continue;
    const abs = join(dir, name);
    try {
      const stat = statSync(abs);
      if (!stat.isFile()) continue;
      out.push({ abs, name, mtimeMs: stat.mtimeMs, size: stat.size, gameId });
    } catch {
      // Gone between the listing and the stat: skip it.
    }
  }
  return out;
}

export type FindOptions = {
  /** Only this game. Default: every game it knows. */
  gameId?: string;
  /** The game's install folder, for a copy ModWrench can't find on its own. Used with gameId. */
  gamePath?: string;
};

export type FindResult = {
  /** Newest first. */
  logs: FoundLog[];
  /** What was searched, in words and without folders, for an answer that says where it looked. */
  looked: string[];
};

export function findCrashLogs(options: FindOptions = {}): FindResult {
  const specs = options.gameId ? SPECS.filter((s) => s.gameId === options.gameId) : SPECS;
  const steamRoot = findSteamRoot();
  const libraries = steamRoot ? findSteamLibraries(steamRoot) : [];
  const all: FoundLog[] = [];
  const looked: string[] = [];

  for (const spec of specs) {
    const def = findGameById(spec.gameId);
    let gameDir: string | null = null;
    let steamapps: string | null = null;
    if (options.gamePath && options.gameId === spec.gameId) {
      gameDir = options.gamePath;
    } else if (def) {
      const app = findInstalledApp(libraries, def.steamAppId);
      if (app) gameDir = app.installDir;
    }
    if (gameDir && basename(dirname(gameDir)).toLowerCase() === "common") steamapps = dirname(dirname(gameDir));
    else if (def && libraries.length > 0) steamapps = libraries.find((lib) => pathExists(join(lib, "compatdata", def.steamAppId))) ?? null;

    const found: FoundLog[] = [];

    if (spec.documents) {
      for (const docs of documentsRoots(steamapps, def?.steamAppId ?? "")) {
        const myGames = child(docs, "My Games");
        if (!myGames) continue;
        for (const folder of spec.documents.folders) {
          const base = child(myGames, folder);
          const sub = base ? child(base, spec.documents.sub) : null;
          if (!sub) continue;
          found.push(...listFiles(sub, CRASH_FILE, spec.gameId));
          // A logger version may keep its logs one folder down, so that is read too.
          const nested = child(sub, "Crashlogs");
          if (nested) found.push(...listFiles(nested, CRASH_FILE, spec.gameId));
        }
      }
    }

    if (spec.inGame && gameDir) {
      for (const where of spec.inGame) {
        const dir = resolveParts(gameDir, where.parts);
        if (dir) found.push(...listFiles(dir, where.pattern, spec.gameId));
      }
    }

    if (spec.bepinex) {
      const targets: string[] = [];
      if (gameDir) {
        const inGame = resolveParts(gameDir, ["BepInEx", "LogOutput.log"]);
        if (inGame) targets.push(inGame);
      }
      const r2 = findR2modmanRoot();
      const folder = def?.r2modmanFolder;
      if (r2 && folder) {
        const profiles = resolveParts(r2, [folder, "profiles"]);
        let names: string[] = [];
        try {
          names = profiles ? readdirSync(profiles).slice(0, 40) : [];
        } catch {
          names = [];
        }
        for (const profile of names) {
          const log = profiles ? resolveParts(profiles, [profile, "BepInEx", "LogOutput.log"]) : null;
          if (log) targets.push(log);
        }
      }
      for (const abs of targets) {
        try {
          const stat = statSync(abs);
          if (stat.isFile()) found.push({ abs, name: basename(abs), mtimeMs: stat.mtimeMs, size: stat.size, gameId: spec.gameId });
        } catch {
          // Unreadable: skip it.
        }
      }
    }

    found.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const kept = found.slice(0, KEEP_PER_GAME);
    all.push(...kept);
    looked.push(
      kept.length === 0
        ? `${spec.name}: no log found`
        : `${spec.name}: ${kept.length} log${kept.length === 1 ? "" : "s"} found`
    );
  }

  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { logs: all, looked };
}

// ─── Reading it ──────────────────────────────────────────────────────────────

/**
 * Past this size only the beginning (a quarter of it) and the end (the rest) are read: a BepInEx log can run to hundreds of
 * megabytes.
 */
const MAX_WHOLE = 12 * 1024 * 1024;

/** What was read of a log: all of it, or (cut) its first `head` bytes and last `tail` bytes of a file of `size` bytes. */
export type ReadLog = { text: string; size: number; cut: boolean; head: number; tail: number };

function readRange(fd: number, start: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, start + got);
    if (n === 0) break;
    got += n;
  }
  return buf.subarray(0, got);
}

type Encoding = "utf8" | "utf16le" | "utf16be";

/**
 * How a log is written, from its first bytes: a byte-order mark says so, and so does a lot of zero bytes sitting at every
 * second position (UTF-16 text that is mostly plain letters, written by a tool that left the mark off). A UTF-8 log has none.
 */
function encodingOf(bytes: Buffer): { encoding: Encoding; skip: number } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: "utf16le", skip: 2 };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: "utf16be", skip: 2 };
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: "utf8", skip: 3 };
  const sample = Math.min(bytes.length, 4096) & ~1;
  if (sample >= 8) {
    let even = 0;
    let odd = 0;
    for (let i = 0; i < sample; i++) if (bytes[i] === 0) (i % 2 === 0 ? even++ : odd++);
    const zeros = even + odd;
    if (zeros >= sample * 0.2) {
      if (odd >= zeros * 0.85) return { encoding: "utf16le", skip: 0 };
      if (even >= zeros * 0.85) return { encoding: "utf16be", skip: 0 };
    }
  }
  return { encoding: "utf8", skip: 0 };
}

function decodeAs(encoding: Encoding, bytes: Buffer): string {
  if (encoding === "utf8") return bytes.toString("utf8");
  // Whole 16-bit characters only: a half character at the end is a cut, not text.
  const even = bytes.subarray(0, bytes.length - (bytes.length % 2));
  if (encoding === "utf16le") return even.toString("utf16le");
  const swapped = Buffer.from(even);
  swapped.swap16();
  return swapped.toString("utf16le");
}

/** Decode a log the way Windows tools write it: UTF-8, sometimes with a byte-order mark, sometimes UTF-16. */
export function decodeLog(bytes: Buffer): string {
  const { encoding, skip } = encodingOf(bytes);
  return decodeAs(encoding, bytes.subarray(skip));
}

const LINE_BREAK = /[\r\n  \u0085]/;

function lastBreak(text: string): number {
  return Math.max(
    text.lastIndexOf("\n"),
    text.lastIndexOf("\r"),
    text.lastIndexOf(" "),
    text.lastIndexOf(" "),
    text.lastIndexOf("\u0085")
  );
}

/**
 * The text of a log file, or null if it can't be read. A very large file is read at its beginning and its end, in the
 * same encoding as the beginning, and each piece keeps whole lines only: a line cut in half could be half a path or half a key.
 */
export function readLogFile(path: string, whole = MAX_WHOLE): ReadLog | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    if (size <= whole) return { text: decodeLog(readRange(fd, 0, size)), size, cut: false, head: size, tail: 0 };

    const headLen = Math.floor(whole / 4) & ~1;
    const tailLen = (whole - headLen) & ~1;
    const headBytes = readRange(fd, 0, headLen);
    const { encoding, skip } = encodingOf(headBytes);
    const unit = encoding === "utf8" ? 1 : 2;

    // The head ends wherever the byte count ran out. Keep it up to its last line break.
    const headText = decodeAs(encoding, headBytes.subarray(skip));
    const headEnd = lastBreak(headText);
    const head = headEnd >= 0 ? headText.slice(0, headEnd + 1) : "";

    // The tail starts on a whole character (an even distance from the start of a UTF-16 file) and one character early, so a
    // start that lands exactly on a line break is known to.
    let tailStart = size - tailLen;
    if (unit === 2 && tailStart % 2 !== 0) tailStart += 1;
    const lead = Math.max(tailStart - unit, 0);
    const tailText = decodeAs(encoding, readRange(fd, lead, size - lead));
    let tail: string;
    if (lead < tailStart && LINE_BREAK.test(tailText[0] ?? "")) {
      tail = tailText.slice(1);
    } else {
      const firstBreak = LINE_BREAK.exec(tailText);
      tail = firstBreak ? tailText.slice(firstBreak.index + 1) : "";
    }
    return { text: `${head}\n${tail}`, size, cut: true, head: headLen, tail: tailLen };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
