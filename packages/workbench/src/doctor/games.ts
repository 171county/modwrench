import { FALLOUT4_BASE_PLUGINS, SKYRIM_BASE_PLUGINS } from "./plugins.js";

// ─── The games the plugin checks know ────────────────────────────────────────
// Skyrim Special Edition and Fallout 4 load plugins the same way: libloadorder,
// the library LOOT uses, treats them alike (an asterisk-marked plugins.txt, the game's
// own plugins and the Creation Club list loading first, masters ahead of the rest,
// the 0x200 light flag). What differs is below: the file names, where plugins.txt
// lives for each store's copy, the script extender's folder, the Microsoft Store
// copy of Fallout 4's DLC folders, and the page a plugin limit is sourced to.

/**
 * The Microsoft Store's copy of Fallout 4 installs each DLC in a folder of its own beside the game's, and the game
 * reads plugins from their Content\Data folders too. libloadorder's additional_plugins_directories (src/game_settings.rs,
 * at 743e8c9) names them, as "../../<folder>/Content/Data" from the game folder, in this order.
 */
export const MS_STORE_FALLOUT4_DLC: readonly string[] = [
  "Fallout 4- Automatron (PC)",
  "Fallout 4- Nuka-World (PC)",
  "Fallout 4- Wasteland Workshop (PC)",
  "Fallout 4- High Resolution Texture Pack",
  "Fallout 4- Vault-Tec Workshop (PC)",
  "Fallout 4- Far Harbor (PC)",
  "Fallout 4- Contraptions Workshop (PC)",
];

export type PluginGame = {
  id: "skyrimspecialedition" | "fallout4";
  /** The game in a finding: "Over Skyrim's plugin limit". */
  short: string;
  /** The game folder holds this. */
  exe: string;
  /** Data\<xse>\Plugins is the script extender's plugin folder. */
  xse: "SKSE" | "F4SE";
  /** The game's own plugins, in the order they load. */
  base: readonly string[];
  /** The Creation Club list in the game folder. */
  ccc: string;
  /** The folder under %LOCALAPPDATA% that holds plugins.txt, by a file only that store puts in the game folder (libloadorder). */
  listFolder(has: (file: string) => boolean): string;
  /**
   * Other folders the game reads plugins from, in libloadorder's order, each as names below the folder two levels
   * above the game folder. A plugin found in one wins over a copy of the same name in Data, and an earlier one wins.
   */
  extraData?(has: (file: string) => boolean): ReadonlyArray<readonly string[]>;
  /** How many full plugins the game can load, given whether a light plugin is switched on. */
  fullLimit(lightOn: boolean): number;
  /** Where the plugin limits are written down. */
  limitSource: string;
  /** Its folders under Documents\My Games. */
  myGames: readonly string[];
};

export const PLUGIN_GAMES: Readonly<Record<string, PluginGame>> = {
  skyrimspecialedition: {
    id: "skyrimspecialedition",
    short: "Skyrim",
    exe: "SkyrimSE.exe",
    xse: "SKSE",
    base: SKYRIM_BASE_PLUGINS,
    ccc: "Skyrim.ccc",
    // skyrim_se_appdata_folder_name in libloadorder's src/game_settings.rs.
    listFolder: (has) =>
      has("Galaxy64.dll")
        ? "Skyrim Special Edition GOG"
        : has("EOSSDK-Win64-Shipping.dll")
          ? "Skyrim Special Edition EPIC"
          : has("appxmanifest.xml")
            ? "Skyrim Special Edition MS"
            : "Skyrim Special Edition",
    // DynDOLOD's page: 254 full plugins (0x00 to 0xFD), with 0xFE kept for the light ones. It doesn't make that depend
    // on whether a light plugin is switched on, so neither does this.
    fullLimit: () => 254,
    limitSource: "https://dyndolod.info/Messages/Plugin-Limit",
    myGames: ["Skyrim Special Edition", "Skyrim Special Edition GOG", "Skyrim Special Edition EPIC"],
  },
  fallout4: {
    id: "fallout4",
    short: "Fallout 4",
    exe: "Fallout4.exe",
    xse: "F4SE",
    base: FALLOUT4_BASE_PLUGINS,
    ccc: "Fallout4.ccc",
    // As libloadorder picks it (src/game_settings.rs): the Microsoft Store and Epic copies have their own; GOG has none.
    listFolder: (has) => (has("appxmanifest.xml") ? "Fallout4 MS" : has("EOSSDK-Win64-Shipping.dll") ? "Fallout4 EPIC" : "Fallout4"),
    // Only for the Microsoft Store's copy, which libloadorder tells by appxmanifest.xml in the game folder.
    extraData: (has) => (has("appxmanifest.xml") ? MS_STORE_FALLOUT4_DLC.map((dlc) => [dlc, "Content", "Data"]) : []),
    // DynDOLOD's limit page covers the Skyrims; for Fallout 4 the limits are libloadorder's, the library LOOT uses:
    // max_active_full_plugins gives 254 when a light plugin is switched on, which takes 0xFE, and 255 when none is.
    // The 4,096 light plugins are MAX_ACTIVE_LIGHT_PLUGINS in its load_order/writable.rs.
    fullLimit: (lightOn) => (lightOn ? 254 : 255),
    limitSource: "https://github.com/Ortham/libloadorder/blob/743e8c9fcc37ff27808f0d392ce49dac5d948843/src/load_order/mutable.rs",
    // F4SE's SAVE_FOLDER_NAME for each store (f4se_common/f4se_version.h).
    myGames: ["Fallout4", "Fallout4 GOG", "Fallout4 EPIC", "Fallout4 MS"],
  },
};
