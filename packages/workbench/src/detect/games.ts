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
  | "boneworks";

export type GameDef = {
  gameId: GameId;
  steamAppId: string;
  displayName: string;
  family: "bethesda" | "unity-coop" | "other";
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
  /**
   * The game's executable, as a path below the folder a player gives (forward slashes): a name for each store's copy
   * or platform build that has one on record. The Doctors take a gamePath as the game's own folder only when it holds
   * one of these; with exeUnconfirmed set, a folder without one is taken with a warning. A name ending in ".app" is a
   * macOS app bundle, which is a folder.
   */
  exeNames: string[];
  /**
   * The store copies whose executable isn't confirmed, such as "the Microsoft Store copy": a folder without one of
   * exeNames may still be the game's.
   */
  exeUnconfirmed?: string;
  /** A sentence for the fix text, for a store that puts the executable in a folder below the one it creates. */
  exeFolderHint?: string;
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
  | "none";

export const KNOWN_GAMES: GameDef[] = [
  {
    gameId: "skyrimspecialedition",
    steamAppId: "489830",
    displayName: "The Elder Scrolls V: Skyrim Special Edition",
    family: "bethesda",
    loaderChecks: [{ loader: "skse", files: ["skse64_loader.exe"] }],
    mo2GameNames: ["Skyrim Special Edition", "Skyrim SE"],
    exeNames: ["SkyrimSE.exe"],
    exeFolderHint: "The Microsoft Store copy keeps it in its Content folder.",
  },
  {
    gameId: "skyrim",
    steamAppId: "72850",
    displayName: "The Elder Scrolls V: Skyrim",
    family: "bethesda",
    loaderChecks: [{ loader: "skse", files: ["skse_loader.exe"] }],
    mo2GameNames: ["Skyrim", "Skyrim Legendary Edition"],
    exeNames: ["TESV.exe"],
  },
  {
    gameId: "skyrimvr",
    steamAppId: "611670",
    displayName: "Skyrim VR",
    family: "bethesda",
    loaderChecks: [{ loader: "skse", files: ["sksevr_loader.exe"] }],
    mo2GameNames: ["Skyrim VR"],
    exeNames: ["SkyrimVR.exe"],
  },
  {
    gameId: "fallout4",
    steamAppId: "377160",
    displayName: "Fallout 4",
    family: "bethesda",
    loaderChecks: [{ loader: "f4se", files: ["f4se_loader.exe"] }],
    mo2GameNames: ["Fallout 4"],
    exeNames: ["Fallout4.exe"],
    exeFolderHint: "The Microsoft Store copy keeps it in its Content folder.",
  },
  {
    gameId: "fallout4vr",
    steamAppId: "611660",
    displayName: "Fallout 4 VR",
    family: "bethesda",
    loaderChecks: [{ loader: "f4se", files: ["f4sevr_loader.exe"] }],
    mo2GameNames: ["Fallout 4 VR"],
    exeNames: ["Fallout4VR.exe"],
  },
  {
    gameId: "falloutnv",
    steamAppId: "22380",
    displayName: "Fallout: New Vegas",
    family: "bethesda",
    loaderChecks: [{ loader: "nvse", files: ["nvse_loader.exe"] }],
    mo2GameNames: ["New Vegas", "Fallout New Vegas"],
    exeNames: ["FalloutNV.exe"],
    exeFolderHint:
      "The Epic and Microsoft Store copies keep it in a language folder, such as Fallout New Vegas English, which for the Microsoft Store is inside its Content folder.",
  },
  {
    gameId: "fallout3",
    steamAppId: "22300",
    displayName: "Fallout 3",
    family: "bethesda",
    loaderChecks: [{ loader: "fose", files: ["fose_loader.exe"] }],
    mo2GameNames: ["Fallout 3"],
    // Mod Organizer 2, Vortex and FOSE also look for Fallout3ng.exe, the German low-violence copy's name; which copies
    // have it isn't confirmed.
    exeNames: ["Fallout3.exe", "Fallout3ng.exe"],
    exeFolderHint:
      "The Epic and Microsoft Store copies keep it in a language folder, such as Fallout 3 GOTY English, which for the Microsoft Store is inside its Content folder.",
  },
  {
    gameId: "starfield",
    steamAppId: "1716740",
    displayName: "Starfield",
    family: "bethesda",
    loaderChecks: [{ loader: "sfse", files: ["sfse_loader.exe"] }],
    mo2GameNames: ["Starfield"],
    exeNames: ["Starfield.exe"],
    exeFolderHint: "The Microsoft Store copy keeps it in its Content folder.",
  },
  {
    gameId: "oblivion",
    steamAppId: "22330",
    displayName: "The Elder Scrolls IV: Oblivion",
    family: "bethesda",
    loaderChecks: [{ loader: "obse", files: ["obse_loader.exe"] }],
    mo2GameNames: ["Oblivion"],
    exeNames: ["Oblivion.exe"],
    exeFolderHint:
      "The Epic and Microsoft Store copies keep it in a language folder, such as Oblivion GOTY English, which for the Microsoft Store is inside its Content folder.",
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
    exeNames: ["Lethal Company.exe"],
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
    // The Windows, native Linux and macOS builds, as Steam launches them. That the Microsoft Store copy has valheim.exe
    // too rests on the Valheim wiki alone, and the Mac App Store copy's name wasn't found.
    exeNames: ["valheim.exe", "valheim.x86_64", "valheim.app"],
    exeUnconfirmed: "the Microsoft Store and Mac App Store copies",
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
    exeNames: ["REPO.exe"],
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
    exeNames: ["Risk of Rain 2.exe"],
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
    // "Dyson Sphere Program.exe" is the Microsoft Store copy's, as modders report it; neither Microsoft nor the
    // developer says so.
    exeNames: ["DSPGAME.exe", "Dyson Sphere Program.exe"],
    exeUnconfirmed: "the Microsoft Store and WeGame copies",
  },
  {
    gameId: "boneworks",
    steamAppId: "823500",
    displayName: "BONEWORKS",
    family: "unity-coop",
    // MelonLoader goes beside the game's executable (it takes the folder the running game is in), which is one folder
    // down in Steam's install folder. From 0.6 on, the build an IL2CPP game such as this one loads is in
    // MelonLoader/net6 (MelonLoader.csproj puts each framework's build in a folder of its own); 0.5 had
    // MelonLoader/MelonLoader.dll. r2modman keeps MelonLoader in its own profile and starts the game pointed at it,
    // so an install it manages still isn't seen from the game folder.
    loaderChecks: [
      { loader: "melonloader", files: ["BONEWORKS/MelonLoader/net6/MelonLoader.dll"] },
      { loader: "melonloader", files: ["BONEWORKS/MelonLoader/MelonLoader.dll"] },
    ],
    r2modmanFolder: "BONEWORKS",
    // Steam's install folder holds the game one folder down (Steam launches BONEWORKS\BONEWORKS.exe), and either
    // folder is taken as the game's. The Oculus copy's executable has a name of its own.
    exeNames: ["BONEWORKS.exe", "BONEWORKS/BONEWORKS.exe", "Boneworks_Oculus_Windows64.exe"],
  },
];
