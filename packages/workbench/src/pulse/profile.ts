import { findGameById } from "../detect/games.js";
import { readR2modmanLoadOrder } from "../loadorder/r2modman.js";
import { clean } from "../patchday/summary.js";

// ─── The switched-on Thunderstore mods in an r2modman profile ────────────────
// Shared by Pulse and Crew Check. It reads the profile's mods.yml the way
// mw_read_load_order does, and keeps each switched-on mod whose id has
// Thunderstore's shape, once. Nothing here touches the network.

/** Thunderstore's owner and package names are letters, digits and underscores, joined by one dash. */
export const THUNDERSTORE_NAME = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)$/;

export type ProfileMod = {
  /** The name r2modman shows. */
  name: string;
  /** Thunderstore's "Owner-Name". */
  fullName: string;
  owner: string;
  pkg: string;
  author?: string;
  installed?: string;
};

export type ProfileRead =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** The game's display name. */
      game: string;
      profile: string;
      mods: ProfileMod[];
      /** Switched-on mods whose id isn't a Thunderstore name, cleaned for the answer. */
      notThunderstore: string[];
    };

/** A profile name is one folder name: no separators, and not "." or "..". */
function plainFolderName(value: string): boolean {
  return value !== "" && value !== "." && value !== ".." && !/[\\/\0]/.test(value);
}

/** `tool` names the tool in the answers ("Pulse", "Crew Check"). */
export function readThunderstoreProfile(gameId: string, profileName: string | undefined, tool: string): ProfileRead {
  const game = findGameById(gameId);
  if (!game) return { ok: false, reason: `"${clean(gameId, 60)}" isn't a game ModWrench knows. mw_detect_environment lists the games on this computer.` };
  if (!game.r2modmanFolder) {
    return {
      ok: false,
      reason: `${tool} checks Thunderstore mods in r2modman profiles so far, and ${game.displayName} isn't an r2modman game. Mods from Nexus Mods and mod.io aren't checked yet.`,
    };
  }
  if (profileName !== undefined && !plainFolderName(profileName)) {
    return { ok: false, reason: "profileName must be the name of one r2modman profile, with no slashes, and not . or .." };
  }

  const order = readR2modmanLoadOrder(game, profileName !== undefined ? { profileName } : {});
  if (!order) {
    return {
      ok: false,
      reason:
        profileName !== undefined
          ? `No r2modman profile by that name was found for ${game.displayName}.`
          : `No r2modman profile was found for ${game.displayName} on this computer.`,
    };
  }

  const notThunderstore: string[] = [];
  const seen = new Set<string>();
  const mods: ProfileMod[] = [];
  for (const mod of order.mods) {
    if (mod.enabled !== true) continue;
    const id = mod.sourceModId ?? "";
    const match = THUNDERSTORE_NAME.exec(id);
    if (!match) {
      notThunderstore.push(clean(mod.name));
      continue;
    }
    if (seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    mods.push({
      name: mod.name,
      fullName: id,
      owner: match[1]!,
      pkg: match[2]!,
      ...(mod.author !== undefined ? { author: mod.author } : {}),
      ...(mod.version !== undefined ? { installed: mod.version } : {}),
    });
  }
  return { ok: true, game: game.displayName, profile: order.profile, mods, notThunderstore };
}
