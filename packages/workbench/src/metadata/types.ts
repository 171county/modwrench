// Normalized cross-platform mod metadata. The wiring prompt is explicit about
// what must NEVER be stripped: author name, source platform, and source mod
// id. Those fields are non-optional on every mod that comes back.
//
// The "Trust Architecture" rule from the wiring prompt:
//   "Attribution preserved end-to-end. Author names, source platforms, and
//   original mod URLs appear in every output that mentions a mod."

export type ModPlatform = "nexus" | "modio" | "thunderstore";

export type ModPermissions = {
  /** Allow modification / patches by other authors. Null = not exposed via API. */
  modificationAllowed: boolean | null;
  /** Allow asset reuse in other mods. Null = not exposed via API. */
  assetReuseAllowed: boolean | null;
  /** Allow conversion to other games. Null = not exposed via API. */
  conversionAllowed: boolean | null;
  /** Human-readable note about why fields may be null. */
  note: string;
};

export type ModAttribution = {
  author: string;
  sourcePlatform: ModPlatform;
  sourceModId: string;
  pageUrl: string;
};

export type NormalizedMod = {
  id: string;
  name: string;
  /** Mandatory attribution block, non-optional and always populated. */
  attribution: ModAttribution;
  platform: ModPlatform;
  version?: string;
  lastUpdated?: string;
  summary?: string;
  description?: string;
  downloadCount?: number;
  endorsements?: number;
  permissions?: ModPermissions;
  pageUrl: string;
};

export type QueryModMetadataInput = {
  modId?: string;
  modName?: string;
  platform?: ModPlatform | "any";
  /**
   * Platform-specific game identifier:
   *   - nexus: domain name string ("skyrimspecialedition")
   *   - modio: numeric game id as a string ("6195")
   * For "any" with a canonical workbench gameId, the lookup resolves per
   * platform via the KNOWN_GAMES catalogue.
   */
  gameId?: string;
};

export type QueryModMetadataResult =
  | { found: true; mod: NormalizedMod; attemptedPlatforms: ModPlatform[] }
  | {
      found: false;
      reason: string;
      attemptedPlatforms: ModPlatform[];
      /** Per-platform diagnostics so the LLM can suggest next steps. */
      platformErrors?: Record<string, string>;
    };
