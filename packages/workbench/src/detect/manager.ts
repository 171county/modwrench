import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { pathExists } from "./os.js";
import type { GameDef } from "./games.js";

export type ManagerName =
  | "vortex"
  | "mo2"
  | "r2modman"
  | "thunderstore-mm";

export type DetectedManager = {
  name: ManagerName;
  /** Where the manager's state lives on disk. Useful for downstream tools. */
  dataPath: string;
  /** Game IDs this manager is known to manage on this machine (best-effort). */
  managedGameIds?: string[];
};

// Per-OS candidate locations for each manager's state directory. We scan and
// return the first that exists — none of these are required, and modders
// running unusual setups can still use the workbench tools that don't depend
// on manager state.

/**
 * Candidate `drive_c/users/<user>` directories across every Wine/Proton prefix
 * on this machine.
 *
 * On Linux and Steam Deck, MO2 and Vortex are Windows applications with no
 * native build — they run inside a prefix, so their state lands at a Windows
 * path *inside* that prefix rather than anywhere under $HOME. Checking only
 * ~/.config means finding nothing, always.
 *
 * Proton always names the prefix user `steamuser` regardless of the Linux
 * username; plain Wine (Lutris, Bottles, bare wine) uses the real username.
 * We check both. Prefixes are enumerated rather than guessed: MO2 added as a
 * non-Steam game gets a randomly generated appid, so there is no id to guess.
 */
function winePrefixUserDirs(steamLibraries: string[]): string[] {
  if (process.platform === "win32" || process.platform === "darwin") return [];
  const home = homedir();
  const linuxUser = userInfo().username;
  const out: string[] = [];

  const addPrefix = (pfxRoot: string): void => {
    const users = join(pfxRoot, "drive_c", "users");
    if (!pathExists(users)) return;
    for (const name of ["steamuser", linuxUser]) {
      const dir = join(users, name);
      if (pathExists(dir) && !out.includes(dir)) out.push(dir);
    }
  };

  // Every Steam compatdata prefix, across every library (SD card included).
  for (const lib of steamLibraries) {
    const compatdata = join(lib, "compatdata");
    if (!pathExists(compatdata)) continue;
    try {
      for (const entry of readdirSync(compatdata, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        addPrefix(join(compatdata, entry.name, "pfx"));
      }
    } catch {
      // Unreadable compatdata — skip this library.
    }
  }

  // Non-Steam prefixes.
  if (process.env.WINEPREFIX) addPrefix(process.env.WINEPREFIX);
  addPrefix(join(home, ".wine"));

  return out;
}

function vortexCandidates(steamLibraries: string[]): string[] {
  if (process.platform === "win32") {
    return [
      process.env.APPDATA ? join(process.env.APPDATA, "Vortex") : "",
    ].filter(Boolean);
  }
  // Vortex ships no native Linux or macOS build — it exists only inside a
  // Wine/Proton prefix, where its Electron userData resolves to the Windows
  // %APPDATA%\Vortex path. (~/.config/Vortex is reserved for a future native
  // build that has not shipped; we check it last rather than first.)
  return [
    ...winePrefixUserDirs(steamLibraries).map((u) =>
      join(u, "AppData", "Roaming", "Vortex")
    ),
    join(homedir(), ".config", "Vortex"),
  ];
}

function mo2Candidates(steamLibraries: string[]): string[] {
  if (process.platform === "win32") {
    // Modern MO2 installs portably; the launcher lives under LocalAppData. The
    // "instances" subdir holds per-game configs.
    return [
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, "ModOrganizer")
        : "",
    ].filter(Boolean);
  }
  // MO2 global instances live at Qt's AppLocalDataLocation, which inside a
  // prefix is drive_c/users/<user>/AppData/Local/ModOrganizer.
  return winePrefixUserDirs(steamLibraries).map((u) =>
    join(u, "AppData", "Local", "ModOrganizer")
  );
}

function r2modmanCandidates(): string[] {
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return [
        process.env.APPDATA
          ? join(process.env.APPDATA, "r2modmanPlus-local")
          : "",
      ].filter(Boolean);
    case "darwin":
      return [
        join(home, "Library", "Application Support", "r2modmanPlus-local"),
      ];
    default:
      return [
        // Native install (AppImage, deb, rpm, pacman, tar.gz) — none sandboxed.
        // This is the most common Steam Deck case; AppImage predates the
        // flatpak build and is still widespread.
        join(home, ".config", "r2modmanPlus-local"),
        // Flatpak. The app id is io.github.ebkr.r2modman — note this is NOT
        // on Flathub, it ships from the maintainer's own r2builds remote.
        join(
          home,
          ".var",
          "app",
          "io.github.ebkr.r2modman",
          "config",
          "r2modmanPlus-local"
        ),
      ];
  }
}

function findFirstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && pathExists(p)) return p;
  }
  return null;
}

/** Instance names recorded by the MO2 Linux installer (MO2-LINT), if present. */
function mo2LintInstances(): { dataPath: string; instances: string[] } | null {
  if (process.platform === "win32" || process.platform === "darwin") return null;
  const dir = join(homedir(), ".config", "mo2-lint");
  const state = join(dir, "state.json");
  if (!pathExists(state)) return null;
  try {
    const parsed = JSON.parse(readFileSync(state, "utf8")) as unknown;
    const instances: string[] = [];
    // The installer keeps a registry of the instances it created. Shape has
    // changed across versions, so read defensively: accept either an array or
    // an object keyed by instance name.
    const raw = (parsed as { instances?: unknown })?.instances ?? parsed;
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const name =
          typeof entry === "string"
            ? entry
            : typeof (entry as { name?: unknown })?.name === "string"
              ? (entry as { name: string }).name
              : null;
        if (name) instances.push(name);
      }
    } else if (raw && typeof raw === "object") {
      instances.push(...Object.keys(raw as Record<string, unknown>));
    }
    return { dataPath: dir, instances };
  } catch {
    return null;
  }
}

/**
 * Detect every mod manager whose state directory is present on this system.
 * Each manager is reported once, with the data path the workbench should read
 * if it ever needs to interrogate state (load order, profiles, etc.).
 *
 * `steamLibraries` is the list of steamapps directories from findSteamLibraries.
 * On Linux it is required to find MO2 and Vortex at all, since both live inside
 * Wine/Proton prefixes under those libraries rather than anywhere in $HOME.
 *
 * Note: presence ≠ active. A user may have Vortex installed but use MO2 daily.
 * Per-game inference (inferManagerForGame) makes the best guess we can.
 */
export function detectInstalledManagers(
  steamLibraries: string[] = []
): DetectedManager[] {
  const out: DetectedManager[] = [];

  const vortex = findFirstExisting(vortexCandidates(steamLibraries));
  if (vortex) {
    out.push({ name: "vortex", dataPath: vortex });
  }

  const mo2 = findFirstExisting(mo2Candidates(steamLibraries));
  if (mo2) {
    // List instance subdirs as a clue for which games MO2 might manage.
    const instances: string[] = [];
    try {
      for (const entry of readdirSync(mo2, { withFileTypes: true })) {
        if (entry.isDirectory()) instances.push(entry.name);
      }
    } catch {
      // Ignore unreadable.
    }
    out.push({
      name: "mo2",
      dataPath: mo2,
      managedGameIds: instances,
    });
  } else {
    // Native Linux MO2, installed by MO2-LINT outside any prefix. Its own
    // registry is the only reliable way to find those instances.
    const lint = mo2LintInstances();
    if (lint) {
      out.push({
        name: "mo2",
        dataPath: lint.dataPath,
        managedGameIds: lint.instances,
      });
    }
  }

  const r2 = findFirstExisting(r2modmanCandidates());
  if (r2) {
    const games: string[] = [];
    try {
      for (const entry of readdirSync(r2, { withFileTypes: true })) {
        if (entry.isDirectory()) games.push(entry.name);
      }
    } catch {
      // Ignore unreadable.
    }
    out.push({ name: "r2modman", dataPath: r2, managedGameIds: games });
  }

  return out;
}

/**
 * Heuristic guess at which detected manager is most likely managing a given
 * game. Family-based: bethesda games skew Vortex/MO2, unity-coop skews
 * r2modman. Returns null if no detected manager fits the game.
 */
export function inferManagerForGame(
  game: GameDef,
  managers: DetectedManager[]
): ManagerName | null {
  const names = new Set(managers.map((m) => m.name));
  switch (game.family) {
    case "bethesda": {
      // Prefer MO2 if its instance list mentions this game, else Vortex.
      const mo2 = managers.find((m) => m.name === "mo2");
      if (
        mo2?.managedGameIds?.some((i) =>
          i.toLowerCase().includes(game.gameId.slice(0, 6))
        )
      ) {
        return "mo2";
      }
      if (names.has("vortex")) return "vortex";
      if (names.has("mo2")) return "mo2";
      return null;
    }
    case "unity-coop":
      if (names.has("r2modman")) return "r2modman";
      if (names.has("thunderstore-mm")) return "thunderstore-mm";
      return null;
    default:
      return null;
  }
}
