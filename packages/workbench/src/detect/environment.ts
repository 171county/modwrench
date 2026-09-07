import {
  detectOs,
  detectSteamDeck,
  detectGameMode,
  type OsName,
} from "./os.js";
import {
  findSteamRoot,
  findSteamLibraries,
  findInstalledApp,
  listProtonTools,
  findProtonPrefix,
} from "./steam.js";
import { KNOWN_GAMES, type GameDef } from "./games.js";
import { detectModLoader } from "./loader.js";
import {
  detectInstalledManagers,
  inferManagerForGame,
  type DetectedManager,
  type ManagerName,
} from "./manager.js";

export type DetectedGame = {
  gameId: string;
  gameName: string;
  installPath: string;
  family: GameDef["family"];
  modManager: ManagerName | "none";
  modLoader: string;
  /**
   * The Proton distribution this prefix is bound to (e.g. "Proton 9.0",
   * "GE-Proton11-6"). Falls back to the prefix schema version read from
   * compatdata/<appid>/version when config_info is unreadable — that value
   * (e.g. "10.1000-105") is NOT a Proton release number.
   */
  protonVersion?: string;
  /** Absolute path to the Wine prefix; where MO2/Vortex state lives on Linux. */
  protonPrefixPath?: string;
};

export type DetectEnvironmentResult = {
  os: OsName;
  isSteamDeck: boolean;
  steamDeckMode?: "game" | "desktop";
  steamRoot: string | null;
  installedModManagers: Array<{
    name: ManagerName;
    dataPath: string;
    managedGameIds?: string[];
  }>;
  detectedGames: DetectedGame[];
  availableProton?: string[];
};

/**
 * Single-pass detection of the user's modding setup. Pure read-only —
 * filesystem checks plus Steam's libraryfolders.vdf. No network, no writes.
 *
 * Extracted from the original mw_detect_environment tool handler so that
 * @modwrench/cli's MetaCatalog can also drive activation decisions off the
 * same detection logic without duplicating it.
 */
export function detectEnvironment(): DetectEnvironmentResult {
  const os = detectOs();
  const isSteamDeck = detectSteamDeck();
  const isGameMode = detectGameMode();
  const steamRoot = findSteamRoot();
  // Libraries first: on Linux the mod managers live inside Proton prefixes
  // under these libraries, so manager detection depends on having them.
  const libraries = steamRoot ? findSteamLibraries(steamRoot) : [];
  const managers: DetectedManager[] = detectInstalledManagers(libraries);

  const detectedGames: DetectedGame[] = [];

  if (steamRoot) {
    for (const game of KNOWN_GAMES) {
      const app = findInstalledApp(libraries, game.steamAppId);
      if (!app) continue;
      const loader = detectModLoader(app.installDir, game);
      const manager = inferManagerForGame(game, managers) ?? "none";
      const proton = findProtonPrefix(libraries, game.steamAppId);
      const entry: DetectedGame = {
        gameId: game.gameId,
        gameName: app.name,
        installPath: app.installDir,
        family: game.family,
        modManager: manager,
        modLoader: loader,
      };
      if (proton) {
        // Prefer the recognizable Proton distribution name; fall back to the
        // prefix schema version, which is NOT a Proton release number.
        entry.protonVersion =
          proton.protonBuild ?? proton.prefixVersion ?? "unknown";
        entry.protonPrefixPath = proton.prefixPath;
      }
      detectedGames.push(entry);
    }
  }

  const protonTools =
    os === "linux" && steamRoot ? listProtonTools(steamRoot) : [];

  const result: DetectEnvironmentResult = {
    os,
    isSteamDeck,
    steamRoot,
    installedModManagers: managers.map((m) => {
      const entry: { name: ManagerName; dataPath: string; managedGameIds?: string[] } = {
        name: m.name,
        dataPath: m.dataPath,
      };
      if (m.managedGameIds) entry.managedGameIds = m.managedGameIds;
      return entry;
    }),
    detectedGames,
  };

  if (isSteamDeck) result.steamDeckMode = isGameMode ? "game" : "desktop";
  if (protonTools.length > 0) result.availableProton = protonTools;

  return result;
}
