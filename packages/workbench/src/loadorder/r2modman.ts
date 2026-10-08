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
        // r2modman's Flatpak (its own manifest is flatpak/io.github.ebkr.r2modman.yaml),
        // the same id detect/manager.ts uses.
        join(
          home,
          ".var",
          "app",
          "io.github.ebkr.r2modman",
          "config",
          "r2modmanPlus-local"
        ),
      ];
  }
}

export function findR2modmanRoot(): string | null {
  for (const candidate of r2modmanRootCandidates()) {
    if (pathExists(candidate)) return candidate;
  }
  return null;
}

// r2modman's mods.yml is a YAML sequence of objects, one per installed mod.
// r2modman writes it with js-yaml straight from its ManifestV2 objects
// (ProfileModList.saveModList), so the keys are that class's camelCase field
// names; name is the Thunderstore id ("Author-ModName") and displayName the
// mod's own name. We type only the fields we care about; the file carries more
// (description, dependencies, icon, etc.) and we ignore them.
type R2ManifestEntry = {
  name?: string;
  authorName?: string;
  displayName?: string;
  versionNumber?: { major?: number; minor?: number; patch?: number };
  enabled?: boolean;
};

function formatVersion(
  v: R2ManifestEntry["versionNumber"]
): string | undefined {
  if (v && typeof v === "object") {
    const parts = [v.major ?? 0, v.minor ?? 0, v.patch ?? 0];
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
    const author = e.authorName;
    const mod: LoadOrderMod = {
      name: e.displayName ?? e.name ?? "(unnamed)",
      // r2modman reads a mod without enabled: true as switched off
      // (ManifestV2.fromJsObject), so this does too.
      enabled: e.enabled === true,
      loadOrderIndex: i,
      sourcePlatform: "thunderstore",
    };
    const version = formatVersion(e.versionNumber);
    if (version) mod.version = version;
    if (author) mod.author = author;
    // name is already Thunderstore's canonical "Author-ModName" id, which is
    // what downstream tools need to resolve attribution.
    if (e.name) mod.sourceModId = e.name;
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
