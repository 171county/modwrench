import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseVdf, type VdfObject } from "./vdf.js";
import { pathExists } from "./os.js";

/**
 * Candidate Steam install roots for the current OS. We try defaults rather
 * than touching the Windows registry — covers 99% of installs and keeps the
 * workbench dependency-free. Power users with a non-default Steam root can
 * override via STEAM_ROOT env var.
 */
function steamRootCandidates(): string[] {
  const override = process.env.STEAM_ROOT;
  if (override) return [override];

  const home = homedir();
  switch (process.platform) {
    case "win32":
      return [
        "C:\\Program Files (x86)\\Steam",
        "C:\\Program Files\\Steam",
        process.env.ProgramFiles ? join(process.env.ProgramFiles, "Steam") : "",
        process.env["ProgramFiles(x86)"]
          ? join(process.env["ProgramFiles(x86)"]!, "Steam")
          : "",
      ].filter(Boolean);
    case "darwin":
      return [join(home, "Library", "Application Support", "Steam")];
    default:
      return [
        join(home, ".steam", "steam"),
        join(home, ".local", "share", "Steam"),
        // Flatpak Steam
        join(home, ".var", "app", "com.valvesoftware.Steam", "data", "Steam"),
      ];
  }
}

export function findSteamRoot(): string | null {
  for (const candidate of steamRootCandidates()) {
    if (pathExists(candidate) && pathExists(join(candidate, "steamapps"))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolve all Steam library folders configured for this install. Steam keeps
 * a list of these in steamapps/libraryfolders.vdf so games on a second drive —
 * or a Steam Deck's microSD card — are reachable from the same client.
 *
 * Two format quirks matter and both appear in the wild:
 *   - Newer Steam maps each numeric key to an object with a "path" key; older
 *     Steam maps it directly to the path as a bare string.
 *   - Steam matches library folder names case-insensitively, and legacy
 *     installs use "SteamApps" rather than "steamapps".
 */
export function findSteamLibraries(steamRoot: string): string[] {
  const libs: string[] = [];
  const primary = resolveSteamappsDir(steamRoot);
  if (primary) libs.push(primary);

  const vdfPath = primary ? join(primary, "libraryfolders.vdf") : null;
  if (!vdfPath || !pathExists(vdfPath)) return libs;

  let parsed: VdfObject | null;
  try {
    parsed = parseVdf(readFileSync(vdfPath, "utf8"));
  } catch {
    return libs;
  }
  if (!parsed) return libs;

  for (const value of Object.values(parsed)) {
    // Newer Steam: { path: "..." }. Older Steam: the path as a bare string.
    const path =
      typeof value === "string"
        ? value
        : typeof value === "object" && typeof value["path"] === "string"
          ? value["path"]
          : null;
    if (!path) continue;
    const steamapps = resolveSteamappsDir(path);
    if (steamapps && !libs.includes(steamapps)) libs.push(steamapps);
  }
  return libs;
}

/**
 * Find the steamapps directory under a library root, matching the directory
 * name case-insensitively. Legacy installs use "SteamApps"; Steam itself
 * resolves these case-insensitively, so a case-sensitive filesystem plus a
 * hardcoded lowercase name silently loses the whole library.
 */
function resolveSteamappsDir(libraryRoot: string): string | null {
  const direct = join(libraryRoot, "steamapps");
  if (pathExists(direct)) return direct;
  try {
    for (const entry of readdirSync(libraryRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.toLowerCase() === "steamapps") {
        return join(libraryRoot, entry.name);
      }
    }
  } catch {
    // Unreadable library root — skip it.
  }
  return null;
}

export type InstalledApp = {
  appId: string;
  name: string;
  installDir: string; // absolute path
  libraryPath: string; // the steamapps dir this app lives under
};

/**
 * Find an installed Steam app by its numeric appid. Walks every configured
 * library until it finds a matching appmanifest_<appid>.acf. Returns null if
 * the app isn't installed anywhere.
 */
export function findInstalledApp(
  libraryPaths: string[],
  appId: string
): InstalledApp | null {
  for (const lib of libraryPaths) {
    const manifestPath = join(lib, `appmanifest_${appId}.acf`);
    if (!pathExists(manifestPath)) continue;
    let parsed: VdfObject | null;
    try {
      parsed = parseVdf(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (!parsed) continue;
    const name = typeof parsed["name"] === "string" ? parsed["name"] : appId;
    const installDirName =
      typeof parsed["installdir"] === "string" ? parsed["installdir"] : null;
    if (!installDirName) continue;
    const installDir = join(lib, "common", installDirName);
    if (!pathExists(installDir)) continue;
    return { appId, name, installDir, libraryPath: lib };
  }
  return null;
}

/**
 * List Proton tools available to the Steam install — both bundled and any
 * user-installed (GE-Proton, etc.) under compatibilitytools.d. Only relevant
 * on Linux; returns empty array on other platforms.
 */
export function listProtonTools(steamRoot: string): string[] {
  if (process.platform !== "linux") return [];
  const out: string[] = [];
  const compatDir = join(steamRoot, "compatibilitytools.d");
  if (pathExists(compatDir)) {
    try {
      for (const entry of readdirSync(compatDir)) {
        if (entry.startsWith("Proton") || entry.startsWith("GE-Proton")) {
          out.push(entry);
        }
      }
    } catch {
      // Ignore unreadable directory.
    }
  }
  return out;
}

export type ProtonPrefix = {
  /** The compatdata/<appid> directory Steam actually used. */
  compatDataPath: string;
  /** The Wine prefix inside it. */
  prefixPath: string;
  /**
   * Contents of compatdata/<appid>/version.
   *
   * This is a PREFIX SCHEMA version, not a Proton release — Proton 10.0-4
   * writes "10.1000-105", and custom runners write names like "GE-Proton11-6".
   * Proton only ever compares it for equality to decide whether to run prefix
   * upgrade steps. Never parse it as <major>.<minor>-<patch>.
   */
  prefixVersion: string | null;
  /**
   * The Proton installation the prefix is bound to, derived from line 2 of
   * config_info (the fonts directory inside the Proton distribution). This is
   * the value a user would recognize as "which Proton" — e.g. "Proton 9.0".
   */
  protonBuild: string | null;
};

/** Pull the Proton distribution name out of a config_info fonts path. */
function protonNameFromFontsDir(fontsDir: string): string | null {
  // Valve builds live under steamapps/common/<name>/files/share/fonts/, while
  // community runners (GE-Proton, Proton-CachyOS) install to
  // compatibilitytools.d/<name>/files/share/fonts/. Both shapes must resolve —
  // GE-Proton is what a large share of Linux and Steam Deck modders run.
  // Split on both separators without a regex so the backslash case is exact.
  const BACKSLASH = String.fromCharCode(92);
  const parts = fontsDir
    .split("/")
    .flatMap((p) => p.split(BACKSLASH))
    .filter((p) => p.length > 0);
  const filesIdx = parts.lastIndexOf("files");
  if (filesIdx >= 2) {
    const parent = parts[filesIdx - 2];
    if (parent === "common" || parent === "compatibilitytools.d") {
      return parts[filesIdx - 1] ?? null;
    }
  }
  return null;
}

/**
 * Locate the Proton prefix for a game and describe it.
 *
 * Steam stores a game's prefix under the SAME library the game is installed in
 * — `<library>/steamapps/compatdata/<appid>` — not under the primary Steam
 * root. Looking only under the primary root silently loses every game on a
 * second drive or a Steam Deck's microSD card, which is where Deck users put
 * most of their library.
 *
 * A prefix and its game can also end up in different libraries, so this scans
 * every configured library rather than assuming co-location. When more than one
 * candidate exists, the most recently used wins: pfx.lock is touched on every
 * launch, so its mtime is the tiebreaker. We require pfx.lock rather than just
 * pfx because the pfx directory is incomplete until the game has run once.
 */
export function findProtonPrefix(
  libraryPaths: string[],
  appId: string
): ProtonPrefix | null {
  if (process.platform !== "linux") return null;

  const candidates: { dir: string; mtime: number }[] = [];
  for (const lib of libraryPaths) {
    const dir = join(lib, "compatdata", appId);
    const lock = join(dir, "pfx.lock");
    const pfx = join(dir, "pfx");
    if (!pathExists(pfx)) continue;
    let mtime = 0;
    try {
      if (pathExists(lock)) mtime = statSync(lock).mtimeMs;
    } catch {
      // Unreadable lock — keep the candidate, just without a timestamp.
    }
    candidates.push({ dir, mtime });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  const compatDataPath = candidates[0]!.dir;

  let prefixVersion: string | null = null;
  const versionFile = join(compatDataPath, "version");
  if (pathExists(versionFile)) {
    try {
      prefixVersion = readFileSync(versionFile, "utf8").split("\n")[0]?.trim() ?? null;
    } catch {
      // Leave null.
    }
  }

  let protonBuild: string | null = null;
  const configInfo = join(compatDataPath, "config_info");
  if (pathExists(configInfo)) {
    try {
      // Line 1 is the prefix version; line 2 is the Proton dist's fonts dir.
      const fontsDir = readFileSync(configInfo, "utf8").split("\n")[1]?.trim();
      if (fontsDir) protonBuild = protonNameFromFontsDir(fontsDir);
    } catch {
      // Leave null.
    }
  }

  return {
    compatDataPath,
    prefixPath: join(compatDataPath, "pfx"),
    prefixVersion,
    protonBuild,
  };
}
