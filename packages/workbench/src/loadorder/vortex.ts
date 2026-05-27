import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathExists } from "../detect/os.js";
import type { GameDef } from "../detect/games.js";
import type { LoadOrderResult, LoadOrderMod } from "./types.js";

// Vortex stores its canonical state in a LevelDB store at
// %APPDATA%/Vortex/state.v2/ — not directly parseable without a LevelDB
// library (which would add ~5MB native deps). Until we add that path, this
// reader does a best-effort directory scan of the per-game mods folder:
//
//   %APPDATA%/Vortex/<gameId>/mods/<mod-folder>/
//
// We return mod folder names with enabled=null and a warning so the LLM
// knows enable-state and load order are unavailable through this view.

function vortexRoot(): string | null {
  if (process.platform === "win32") {
    return process.env.APPDATA ? join(process.env.APPDATA, "Vortex") : null;
  }
  // Vortex on Linux is Wine-only and uncommon; check the standard config
  // location as a courtesy.
  return join(homedir(), ".config", "Vortex");
}

/**
 * Best-effort enumeration of installed mod folders for a game under Vortex.
 * Returns null if Vortex isn't installed or the game has no Vortex data dir.
 */
export function readVortexLoadOrder(game: GameDef): LoadOrderResult | null {
  const root = vortexRoot();
  if (!root || !pathExists(root)) return null;

  const gameDir = join(root, game.gameId);
  const modsDir = join(gameDir, "mods");
  if (!pathExists(modsDir)) return null;

  let entries: string[];
  try {
    entries = readdirSync(modsDir);
  } catch {
    return null;
  }

  const mods: LoadOrderMod[] = [];
  for (const entry of entries) {
    const fullPath = join(modsDir, entry);
    try {
      if (!statSync(fullPath).isDirectory()) continue;
    } catch {
      continue;
    }
    // Vortex names mod folders like "ModName-12345-1-0-1700000000". The
    // numeric run at the end is typically <nexus_mod_id>-<version>-<unixts>.
    // We try a soft parse, but it's best-effort only.
    const nexusIdMatch = entry.match(/-(\d{2,7})-/);
    const mod: LoadOrderMod = {
      name: entry,
      enabled: null,
    };
    if (nexusIdMatch) {
      mod.sourcePlatform = "nexus";
      mod.sourceModId = nexusIdMatch[1];
    }
    mods.push(mod);
  }

  return {
    modManager: "vortex",
    profile: "(unknown)",
    sourcePath: modsDir,
    mods,
    enabledCount: 0,
    totalCount: mods.length,
    warning:
      "Vortex stores enable-state and load order in a LevelDB store (state.v2). " +
      "ModWrench currently lists installed mod folders only — enable/disable " +
      "state is not visible. For full state visibility on Bethesda games, use MO2.",
  };
}
