import { readFileSync, readdirSync } from "node:fs";
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
 * a list of these in steamapps/libraryfolders.vdf so games on a second drive
 * are reachable from the same client.
 */
export function findSteamLibraries(steamRoot: string): string[] {
  const libs: string[] = [join(steamRoot, "steamapps")];
  const vdfPath = join(steamRoot, "steamapps", "libraryfolders.vdf");
  if (!pathExists(vdfPath)) return libs;

  let parsed: VdfObject | null;
  try {
    parsed = parseVdf(readFileSync(vdfPath, "utf8"));
  } catch {
    return libs;
  }
  if (!parsed) return libs;

  for (const value of Object.values(parsed)) {
    if (typeof value !== "object") continue;
    const path = value["path"];
    if (typeof path !== "string") continue;
    const steamapps = join(path, "steamapps");
    if (pathExists(steamapps) && !libs.includes(steamapps)) {
      libs.push(steamapps);
    }
  }
  return libs;
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

/**
 * Look up the Proton version used for a specific game by reading the
 * compatdata/<appid> entry. Returns null if no compat prefix exists (game is
 * running natively or hasn't been launched yet).
 */
export function detectProtonForApp(
  steamRoot: string,
  appId: string
): string | null {
  if (process.platform !== "linux") return null;
  const compatdataAppDir = join(steamRoot, "steamapps", "compatdata", appId);
  if (!pathExists(compatdataAppDir)) return null;
  // version.txt inside the prefix names the Proton build that created it.
  const versionFile = join(compatdataAppDir, "version");
  if (pathExists(versionFile)) {
    try {
      return readFileSync(versionFile, "utf8").trim();
    } catch {
      // Fall through.
    }
  }
  return "unknown";
}
