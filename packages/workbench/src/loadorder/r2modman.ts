import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { load as yamlLoad } from "js-yaml";
import { pathExists } from "../detect/os.js";
import type { GameDef } from "../detect/games.js";
import type { LoadOrderResult, LoadOrderMod } from "./types.js";

function r2modmanRootCandidates(): string[] {
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return [
        process.env.APPDATA
          ? join(process.env.APPDATA, "r2modmanPlus-local")
          : "",
      ].filter(Boolean);
    case "darwin":
      return [
        join(home, "Library", "Application Support", "r2modmanPlus-local"),
      ];
    default:
      return [
        join(home, ".config", "r2modmanPlus-local"),
        join(
          home,
          ".var",
          "app",
          "com.kalindudc.r2modmanPlus",
          "config",
          "r2modmanPlus-local"
        ),
      ];
  }
}

function findR2modmanRoot(): string | null {
  for (const candidate of r2modmanRootCandidates()) {
    if (pathExists(candidate)) return candidate;
  }
  return null;
}

// r2modman's mods.yml is a YAML sequence of objects, one per installed mod.
// We type only the fields we care about; the file can carry more (Files,
// Icon, etc.) and we ignore them.
type R2ManifestEntry = {
  ManifestVersion?: number;
  AuthorName?: string;
  Name?: string;
  DisplayName?: string;
  Description?: string;
  Version?: string | { Major?: number; Minor?: number; Patch?: number };
  Url?: string;
  Enabled?: boolean;
  DependencyString?: string;
};

function formatVersion(
  v: R2ManifestEntry["Version"]
): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const parts = [v.Major ?? 0, v.Minor ?? 0, v.Patch ?? 0];
    return parts.join(".");
  }
  return undefined;
}

/**
 * Read the load order for a game's r2modman profile. r2modman profiles live
 * at <root>/<gameFolder>/profiles/<profile>/mods.yml. Active profile isn't
 * recorded in disk state (it's a UI session value), so we default to the
 * first profile alphabetically (typically "Default") unless one is named.
 */
export function readR2modmanLoadOrder(
  game: GameDef,
  opts: { profileName?: string }
): LoadOrderResult | null {
  const folder = game.r2modmanFolder;
  if (!folder) return null;

  const root = findR2modmanRoot();
  if (!root) return null;

  const gameDir = join(root, folder);
  const profilesDir = join(gameDir, "profiles");
  if (!pathExists(profilesDir)) return null;

  let profile = opts.profileName;
  if (!profile) {
    try {
      const profiles = readdirSync(profilesDir).sort();
      profile = profiles[0];
    } catch {
      return null;
    }
  }
  if (!profile) return null;

  const profileDir = join(profilesDir, profile);
  const manifestPath = join(profileDir, "mods.yml");
  if (!pathExists(manifestPath)) return null;

  let entries: R2ManifestEntry[] = [];
  try {
    const parsed = yamlLoad(readFileSync(manifestPath, "utf8"));
    if (Array.isArray(parsed)) entries = parsed as R2ManifestEntry[];
  } catch {
    return null;
  }

  const mods: LoadOrderMod[] = entries.map((e, i) => {
    const author = e.AuthorName;
    const displayName = e.DisplayName ?? e.Name ?? "(unnamed)";
    // Thunderstore's canonical mod id is "Author-ModName". Reconstruct it
    // from the manifest fields when possible — this is what downstream tools
    // need to resolve attribution.
    const sourceModId =
      author && e.Name ? `${author}-${e.Name}` : e.Name ?? undefined;
    const mod: LoadOrderMod = {
      name: displayName,
      enabled: e.Enabled ?? true,
      loadOrderIndex: i,
      sourcePlatform: "thunderstore",
    };
    const version = formatVersion(e.Version);
    if (version) mod.version = version;
    if (author) mod.author = author;
    if (sourceModId) mod.sourceModId = sourceModId;
    return mod;
  });

  return {
    modManager: "r2modman",
    profile,
    sourcePath: profileDir,
    mods,
    enabledCount: mods.filter((m) => m.enabled).length,
    totalCount: mods.length,
  };
}
