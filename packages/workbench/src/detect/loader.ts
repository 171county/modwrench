import { join } from "node:path";
import { pathExists } from "./os.js";
import type { GameDef, ModLoader } from "./games.js";

/**
 * Identify the mod loader installed for a given game by file presence. First
 * match wins — KNOWN_GAMES orders the checks so the most specific loader is
 * tried first (e.g. IL2CPP BepInEx before Mono BepInEx for the same game).
 *
 * Returns "none" if no loader signature is found. That's still a useful
 * answer — it tells the LLM the user's setup is vanilla, which changes how
 * crash diagnosis should proceed.
 */
export function detectModLoader(installDir: string, game: GameDef): ModLoader {
  for (const check of game.loaderChecks) {
    const allPresent = check.files.every((rel) =>
      pathExists(join(installDir, rel))
    );
    if (allPresent) return check.loader;
  }
  return "none";
}
