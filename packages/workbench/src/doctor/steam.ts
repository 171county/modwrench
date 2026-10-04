import { homedir } from "node:os";
import { join, sep } from "node:path";
import { findInstalledApp, findSteamLibraries, findSteamRoot, type InstalledApp } from "../detect/steam.js";
import { realPath, resolveCI } from "./fsutil.js";
import type { DoctorPlatform } from "./types.js";

// ─── Which Steam, and where the game is ──────────────────────────────────────
// On Windows and macOS there is one Steam. On Linux there can be several: the
// native one, Valve's own on the Steam Deck, and the Flatpak build, which keeps
// everything under ~/.var/app/com.valvesoftware.Steam. A mod manager and Steam
// have to agree on which one holds the game, so this finds all of them and says
// which one has it.
//
// STEAM_ROOT, when set, wins and is the only one looked at, the same as everywhere
// else in ModWrench.

export type SteamKind = "native" | "flatpak" | "custom";

export type SteamInstall = {
  kind: SteamKind;
  root: string;
  /** The steamapps folders of every library this install knows about. */
  libraries: string[];
};

export type SteamFacts = {
  installs: SteamInstall[];
  /** The install that holds the game, or the first one when none does. */
  chosen: SteamInstall | null;
  app: InstalledApp | null;
};

const FLATPAK_ID = "com.valvesoftware.Steam";

function hasSteamapps(dir: string): boolean {
  return resolveCI(dir, "steamapps") !== null;
}

export function listSteamInstalls(platform: DoctorPlatform): SteamInstall[] {
  const found: Array<{ root: string; kind: SteamKind }> = [];
  const override = process.env.STEAM_ROOT;
  if (override) {
    if (hasSteamapps(override)) found.push({ root: override, kind: "custom" });
  } else if (platform === "linux") {
    const home = homedir();
    const flatpakHome = join(home, ".var", "app", FLATPAK_ID);
    const flatpakReal = realPath(flatpakHome);
    // The Flatpak's own Steam lives at .local/share/Steam under its home; older installs used
    // data/Steam, which can still be there as a link to the same place.
    const candidates = [
      join(home, ".local", "share", "Steam"),
      join(home, ".steam", "steam"),
      join(flatpakHome, ".local", "share", "Steam"),
      join(flatpakHome, "data", "Steam"),
    ];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!hasSteamapps(candidate)) continue;
      const real = realPath(candidate);
      if (seen.has(real)) continue;
      seen.add(real);
      found.push({ root: real, kind: real === flatpakReal || real.startsWith(flatpakReal + sep) ? "flatpak" : "native" });
    }
  } else {
    const root = findSteamRoot();
    if (root) found.push({ root, kind: "native" });
  }
  return found.map((f) => ({ ...f, libraries: findSteamLibraries(f.root) }));
}

export function discoverSteam(platform: DoctorPlatform, appId: string): SteamFacts {
  const installs = listSteamInstalls(platform);
  for (const install of installs) {
    const app = findInstalledApp(install.libraries, appId);
    if (app) return { installs, chosen: install, app };
  }
  return { installs, chosen: installs[0] ?? null, app: null };
}
