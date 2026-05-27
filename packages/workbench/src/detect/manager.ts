import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathExists } from "./os.js";
import type { GameDef } from "./games.js";

export type ManagerName =
  | "vortex"
  | "mo2"
  | "r2modman"
  | "thunderstore-mm"
  | "curseforge";

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

function vortexCandidates(): string[] {
  const home = homedir();
  if (process.platform === "win32") {
    return [
      process.env.APPDATA ? join(process.env.APPDATA, "Vortex") : "",
    ].filter(Boolean);
  }
  // Vortex on Linux is unofficial / Wine-only. We check the standard Wine
  // prefix layout as a best effort but don't expect to find much.
  return [join(home, ".config", "Vortex")];
}

function mo2Candidates(): string[] {
  if (process.platform !== "win32") return [];
  // Modern MO2 installs portably; the launcher lives under LocalAppData. The
  // "instances" subdir holds per-game configs.
  return [
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "ModOrganizer")
      : "",
  ].filter(Boolean);
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
        join(home, ".config", "r2modmanPlus-local"),
        // Flatpak install
        join(
          home,
          ".var",
          "app",
          "com.kalindudc.r2modmanPlus",
          "config",
          "r2modmanPlus-local"
        ),
      ];
  }
}

function curseforgeCandidates(): string[] {
  if (process.platform !== "win32") return [];
  return [
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "CurseForge")
      : "",
  ].filter(Boolean);
}

function findFirstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && pathExists(p)) return p;
  }
  return null;
}

/**
 * Detect every mod manager whose state directory is present on this system.
 * Each manager is reported once, with the data path the workbench should read
 * if it ever needs to interrogate state (load order, profiles, etc.).
 *
 * Note: presence ≠ active. A user may have Vortex installed but use MO2 daily.
 * Per-game inference (inferManagerForGame) makes the best guess we can.
 */
export function detectInstalledManagers(): DetectedManager[] {
  const out: DetectedManager[] = [];

  const vortex = findFirstExisting(vortexCandidates());
  if (vortex) {
    out.push({ name: "vortex", dataPath: vortex });
  }

  const mo2 = findFirstExisting(mo2Candidates());
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

  const curse = findFirstExisting(curseforgeCandidates());
  if (curse) {
    out.push({ name: "curseforge", dataPath: curse });
  }

  return out;
}

/**
 * Heuristic guess at which detected manager is most likely managing a given
 * game. Family-based: bethesda games skew Vortex/MO2, unity-coop skews
 * r2modman, sims/minecraft skews CurseForge. Returns null if no detected
 * manager fits the game.
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
    case "minecraft":
    case "sims":
      if (names.has("curseforge")) return "curseforge";
      return null;
    default:
      return null;
  }
}
