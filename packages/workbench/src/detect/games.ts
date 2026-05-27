// Catalogue of mod-friendly games we know how to recognize. Keep this list
// pragmatic — coverage of the communities ModWrench targets, not every game
// on Steam. New entries should be drive-by additions, no code changes needed.
//
// gameId follows Nexus's domain_name convention where possible so it can be
// passed straight to nexus_get_game and friends without translation.

export type GameId =
  | "skyrimspecialedition"
  | "skyrim"
  | "skyrimvr"
  | "fallout4"
  | "fallout4vr"
  | "falloutnv"
  | "fallout3"
  | "starfield"
  | "oblivion"
  | "lethalcompany"
  | "valheim"
  | "repo"
  | "riskofrain2"
  | "dysonsphereprogram"
  | "boneworks"
  | "thesims4";

export type GameDef = {
  gameId: GameId;
  steamAppId: string;
  displayName: string;
  family: "bethesda" | "unity-coop" | "minecraft" | "sims" | "other";
  /** Mod loaders the game can use. First match wins during detection. */
  loaderChecks: Array<{
    loader: ModLoader;
    /** Files to look for inside the game's install directory, relative paths. */
    files: string[];
  }>;
  /** Folder name r2modman uses for this game's profiles, if it supports it. */
  r2modmanFolder?: string;
  /** Substrings that may appear in MO2's ModOrganizer.ini gameName field. */
  mo2GameNames?: string[];
};

export function findGameById(gameId: string): GameDef | undefined {
  return KNOWN_GAMES.find((g) => g.gameId === gameId);
}

export type ModLoader =
  | "skse"
  | "f4se"
  | "sfse"
  | "nvse"
  | "fose"
  | "obse"
  | "bepinex-5"
  | "bepinex-6-mono"
  | "bepinex-6-il2cpp"
  | "melonloader"
  | "forge"
  | "fabric"
  | "neoforge"
  | "none";

export const KNOWN_GAMES: GameDef[] = [
  {
    gameId: "skyrimspecialedition",
    steamAppId: "489830",
    displayName: "The Elder Scrolls V: Skyrim Special Edition",
    family: "bethesda",
    loaderChecks: [{ loader: "skse", files: ["skse64_loader.exe"] }],
    mo2GameNames: ["Skyrim Special Edition", "Skyrim SE"],
  },
  {
    gameId: "skyrim",
    steamAppId: "72850",
    displayName: "The Elder Scrolls V: Skyrim",
    family: "bethesda",
    loaderChecks: [{ loader: "skse", files: ["skse_loader.exe"] }],
    mo2GameNames: ["Skyrim", "Skyrim Legendary Edition"],
  },
  {
    gameId: "skyrimvr",
    steamAppId: "611670",
    displayName: "Skyrim VR",
    family: "bethesda",
    loaderChecks: [{ loader: "skse", files: ["sksevr_loader.exe"] }],
    mo2GameNames: ["Skyrim VR"],
  },
  {
    gameId: "fallout4",
    steamAppId: "377160",
    displayName: "Fallout 4",
    family: "bethesda",
    loaderChecks: [{ loader: "f4se", files: ["f4se_loader.exe"] }],
    mo2GameNames: ["Fallout 4"],
  },
  {
    gameId: "fallout4vr",
    steamAppId: "611660",
    displayName: "Fallout 4 VR",
    family: "bethesda",
    loaderChecks: [{ loader: "f4se", files: ["f4sevr_loader.exe"] }],
    mo2GameNames: ["Fallout 4 VR"],
  },
  {
    gameId: "falloutnv",
    steamAppId: "22380",
    displayName: "Fallout: New Vegas",
    family: "bethesda",
    loaderChecks: [{ loader: "nvse", files: ["nvse_loader.exe"] }],
    mo2GameNames: ["New Vegas", "Fallout New Vegas"],
  },
  {
    gameId: "fallout3",
    steamAppId: "22300",
    displayName: "Fallout 3",
    family: "bethesda",
    loaderChecks: [{ loader: "fose", files: ["fose_loader.exe"] }],
    mo2GameNames: ["Fallout 3"],
  },
  {
    gameId: "starfield",
    steamAppId: "1716740",
    displayName: "Starfield",
    family: "bethesda",
    loaderChecks: [{ loader: "sfse", files: ["sfse_loader.exe"] }],
    mo2GameNames: ["Starfield"],
  },
  {
    gameId: "oblivion",
    steamAppId: "22330",
    displayName: "The Elder Scrolls IV: Oblivion",
    family: "bethesda",
    loaderChecks: [{ loader: "obse", files: ["obse_loader.exe"] }],
    mo2GameNames: ["Oblivion"],
  },
  {
    gameId: "lethalcompany",
    steamAppId: "1966720",
    displayName: "Lethal Company",
    family: "unity-coop",
    loaderChecks: [
      {
        loader: "bepinex-5",
        files: ["BepInEx/core/BepInEx.dll", "winhttp.dll"],
      },
    ],
    r2modmanFolder: "LethalCompany",
  },
  {
    gameId: "valheim",
    steamAppId: "892970",
    displayName: "Valheim",
    family: "unity-coop",
    loaderChecks: [
      { loader: "bepinex-5", files: ["BepInEx/core/BepInEx.dll"] },
    ],
    r2modmanFolder: "Valheim",
  },
  {
    gameId: "repo",
    steamAppId: "3241660",
    displayName: "R.E.P.O.",
    family: "unity-coop",
    loaderChecks: [
      {
        loader: "bepinex-6-il2cpp",
        files: ["BepInEx/core/BepInEx.Unity.IL2CPP.dll"],
      },
      { loader: "bepinex-5", files: ["BepInEx/core/BepInEx.dll"] },
    ],
    r2modmanFolder: "REPO",
  },
  {
    gameId: "riskofrain2",
    steamAppId: "632360",
    displayName: "Risk of Rain 2",
    family: "unity-coop",
    loaderChecks: [
      { loader: "bepinex-5", files: ["BepInEx/core/BepInEx.dll"] },
    ],
    r2modmanFolder: "RiskOfRain2",
  },
  {
    gameId: "dysonsphereprogram",
    steamAppId: "1366540",
    displayName: "Dyson Sphere Program",
    family: "unity-coop",
    loaderChecks: [
      { loader: "bepinex-5", files: ["BepInEx/core/BepInEx.dll"] },
    ],
    r2modmanFolder: "DysonSphereProgram",
  },
  {
    gameId: "boneworks",
    steamAppId: "823500",
    displayName: "BONEWORKS",
    family: "unity-coop",
    loaderChecks: [
      { loader: "melonloader", files: ["MelonLoader/MelonLoader.dll"] },
    ],
    r2modmanFolder: "BONEWORKS",
  },
  {
    gameId: "thesims4",
    steamAppId: "1222670",
    displayName: "The Sims 4",
    family: "sims",
    // The Sims 4 has no loader — mods drop into Documents/Electronic Arts/...
    loaderChecks: [],
  },
];
