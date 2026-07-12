// Normalized cross-manager load-order shape. Each parser returns this so
// downstream tools (mw_check_known_conflicts, mw_query_mod_metadata, etc.)
// don't care whether the user is on Vortex / MO2 / r2modman.

export type SourcePlatform =
  | "nexus"
  | "modio"
  | "thunderstore"
  | "unknown";

export type LoadOrderMod = {
  name: string;
  enabled: boolean | null;
  loadOrderIndex?: number;
  pluginFile?: string;
  version?: string;
  sourcePlatform?: SourcePlatform;
  sourceModId?: string;
  author?: string;
  installedAt?: string;
};

export type LoadOrderResult = {
  modManager: "vortex" | "mo2" | "r2modman";
  profile: string;
  /** Absolute path of the manager-specific state directory we read from. */
  sourcePath: string;
  mods: LoadOrderMod[];
  /** Bethesda mod-folder list (MO2 only). Null for Unity / Vortex. */
  modFolders?: Array<{
    name: string;
    enabled: boolean;
    modlistIndex: number;
  }>;
  enabledCount: number;
  totalCount: number;
  /** Honest about limitations — Vortex's LevelDB state can't be parsed yet. */
  warning?: string;
};
