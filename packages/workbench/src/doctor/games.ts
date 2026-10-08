import { FALLOUT4_BASE_PLUGINS, SKYRIM_BASE_PLUGINS } from "./plugins.js";

// ─── The games the plugin checks know ────────────────────────────────────────
// Skyrim Special Edition and Fallout 4 load plugins the same way: libloadorder,
// the library LOOT uses, treats them alike (an asterisk-marked plugins.txt, the game's
// own plugins and the Creation Club list loading first, masters ahead of the rest,
// the 0x200 light flag). What differs is below: the file names, where plugins.txt
// lives for each store's copy, the script extender's folder, and the page a plugin
// limit is sourced to.

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
    // DynDOLOD's limit page covers the Skyrims; for Fallout 4 the limits are libloadorder's, the library LOOT uses.
    limitSource: "https://github.com/Ortham/libloadorder/blob/743e8c9fcc37ff27808f0d392ce49dac5d948843/src/load_order/mutable.rs",
    // F4SE's SAVE_FOLDER_NAME for each store (f4se_common/f4se_version.h).
    myGames: ["Fallout4", "Fallout4 GOG", "Fallout4 EPIC", "Fallout4 MS"],
  },
};
