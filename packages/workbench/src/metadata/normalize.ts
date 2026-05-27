import type { NormalizedMod, ModPermissions } from "./types.js";

// Best-effort response normalization. The wiring prompt's permissions matrix
// (modificationAllowed / assetReuseAllowed / conversionAllowed) is NOT fully
// exposed by either platform's public API — those flags are set per-mod on
// the page itself. We honor the spec shape but mark fields null when unknown
// and surface a note so the LLM doesn't fabricate certainty.

const PERMISSIONS_NOTE =
  "Author permissions (modification, asset reuse, conversion) are set on the " +
  "mod's page and may not be fully exposed via API. Always confirm via " +
  "pageUrl before reusing assets or republishing.";

function unknownPermissions(): ModPermissions {
  return {
    modificationAllowed: null,
    assetReuseAllowed: null,
    conversionAllowed: null,
    note: PERMISSIONS_NOTE,
  };
}

// ─── Nexus ────────────────────────────────────────────────────────────────────

// Nexus mod response — subset of fields we care about. Lots of additional
// fields exist (uid, user, picture_url, etc.); ignored here on purpose.
type NexusModResponse = {
  mod_id: number;
  domain_name: string;
  name: string;
  summary?: string;
  description?: string;
  version?: string;
  author: string;
  uploaded_by?: string;
  uploaded_users_profile_url?: string;
  mod_downloads?: number;
  endorsement_count?: number;
  updated_timestamp?: number;
  updated_time?: string;
};

export function normalizeNexusMod(
  mod: NexusModResponse,
  gameDomain: string
): NormalizedMod {
  const idStr = String(mod.mod_id);
  const pageUrl = `https://www.nexusmods.com/${gameDomain}/mods/${idStr}`;
  const out: NormalizedMod = {
    id: idStr,
    name: mod.name,
    platform: "nexus",
    pageUrl,
    attribution: {
      author: mod.author,
      sourcePlatform: "nexus",
      sourceModId: idStr,
      pageUrl,
    },
    permissions: unknownPermissions(),
  };
  if (mod.version) out.version = mod.version;
  if (mod.summary) out.summary = mod.summary;
  if (mod.description) out.description = mod.description;
  if (mod.mod_downloads !== undefined) out.downloadCount = mod.mod_downloads;
  if (mod.endorsement_count !== undefined) out.endorsements = mod.endorsement_count;
  if (mod.updated_time) out.lastUpdated = mod.updated_time;
  else if (mod.updated_timestamp) {
    out.lastUpdated = new Date(mod.updated_timestamp * 1000).toISOString();
  }
  return out;
}

// ─── mod.io ───────────────────────────────────────────────────────────────────

type ModioModResponse = {
  id: number;
  game_id: number;
  name: string;
  name_id: string;
  summary?: string;
  description?: string;
  description_plaintext?: string;
  profile_url?: string;
  date_updated?: number;
  submitted_by?: { username?: string; profile_url?: string };
  modfile?: { version?: string };
  stats?: {
    downloads_total?: number;
    ratings_total?: number;
    ratings_positive?: number;
  };
};

export function normalizeModioMod(mod: ModioModResponse): NormalizedMod {
  const idStr = String(mod.id);
  const pageUrl = mod.profile_url ?? `https://mod.io/g/${mod.game_id}/m/${mod.name_id}`;
  const author = mod.submitted_by?.username ?? "(unknown)";
  const out: NormalizedMod = {
    id: idStr,
    name: mod.name,
    platform: "modio",
    pageUrl,
    attribution: {
      author,
      sourcePlatform: "modio",
      sourceModId: idStr,
      pageUrl,
    },
    permissions: unknownPermissions(),
  };
  if (mod.modfile?.version) out.version = mod.modfile.version;
  if (mod.summary) out.summary = mod.summary;
  // Prefer plaintext when available — it's friendlier for LLM ingestion than
  // the HTML-laden description field.
  if (mod.description_plaintext) out.description = mod.description_plaintext;
  else if (mod.description) out.description = mod.description;
  if (mod.stats?.downloads_total !== undefined) {
    out.downloadCount = mod.stats.downloads_total;
  }
  if (mod.stats?.ratings_positive !== undefined) {
    out.endorsements = mod.stats.ratings_positive;
  }
  if (mod.date_updated) {
    out.lastUpdated = new Date(mod.date_updated * 1000).toISOString();
  }
  return out;
}

export type { NexusModResponse, ModioModResponse };
