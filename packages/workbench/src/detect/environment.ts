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
  detectProtonForApp,
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
  protonVersion?: string;
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
  const managers: DetectedManager[] = detectInstalledManagers();

  const detectedGames: DetectedGame[] = [];

  if (steamRoot) {
    const libraries = findSteamLibraries(steamRoot);
    for (const game of KNOWN_GAMES) {
      const app = findInstalledApp(libraries, game.steamAppId);
      if (!app) continue;
      const loader = detectModLoader(app.installDir, game);
      const manager = inferManagerForGame(game, managers) ?? "none";
      const proton = detectProtonForApp(steamRoot, game.steamAppId);
      const entry: DetectedGame = {
        gameId: game.gameId,
        gameName: app.name,
        installPath: app.installDir,
        family: game.family,
        modManager: manager,
        modLoader: loader,
      };
      if (proton) entry.protonVersion = proton;
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
