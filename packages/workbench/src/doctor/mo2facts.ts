import { join } from "node:path";
import { detectInstalledManagers, inferManagerForGame } from "../detect/manager.js";
import type { GameDef } from "../detect/games.js";
import { findMo2InstanceForGame, parseIni, readMo2LoadOrder } from "../loadorder/mo2.js";
import { isNetworkPath } from "../localpath.js";
import { isDir, readText, resolveCI } from "./fsutil.js";
import type { DoctorPlatform } from "./types.js";

// ─── Mod Organizer 2, read from its own files ────────────────────────────────
// MO2's virtual file system exists only inside a running MO2, so the Doctors can't
// look at the game's Data folder the way the game sees it. What they can read is
// what MO2 builds that view from: the profile's plugins.txt and modlist.txt, the
// mod folders, and the Overwrite folder. Where those folders are is a setting
// (people with a big mod list often keep it on another drive), so the instance's
// ModOrganizer.ini is read for it before the defaults are tried.

export type Mo2Facts = {
  used: boolean;
  /** Why it was or wasn't read, in words. */
  reason: string;
  /** An instance was found but its profile couldn't be read, so what MO2 loads is unknown. */
  missed?: boolean;
  /** The instance folder. Used to open files; never copied into a report. */
  instance?: string;
  profile?: string;
  profileDir?: string;
  /** The folder the mods live in. Null when it couldn't be found. */
  modsDir?: string | null;
  overwriteDir?: string | null;
  /** Mods in ascending priority: the last one wins. */
  folders?: Array<{ name: string; enabled: boolean }>;
};

/** A path setting from the ini file, made usable here. Null when it can't be mapped to this machine, or names another computer. */
function fromSetting(raw: string | undefined, base: string, platform: DoctorPlatform): string | null {
  if (raw === undefined) return null;
  let value = raw.replace(/%BASE_DIR%/gi, base).trim();
  if (value === "" || isNetworkPath(value)) return null;
  if (platform !== "windows") {
    // Under Wine, a Windows path is a Linux path with a drive letter: Z: is the whole file system.
    const drive = /^([a-zA-Z]):[\\/]/.exec(value);
    if (drive) {
      if (drive[1]!.toLowerCase() !== "z") return null;
      value = value.slice(2);
    }
    value = value.replace(/\\/g, "/");
  }
  return value;
}

function folderSetting(instance: string, key: string, fallback: string, platform: DoctorPlatform): string | null {
  const text = readText(join(instance, "ModOrganizer.ini"), 512 * 1024) ?? "";
  const ini = parseIni(text);
  const section = ini["Settings"] ?? ini["General"] ?? {};
  const base = fromSetting((ini["Settings"] ?? {})["base_directory"], instance, platform) ?? instance;
  const set = fromSetting(section[key] ?? (ini["General"] ?? {})[key], base, platform);
  if (set !== null && isDir(set)) return set;
  const byDefault = resolveCI(base, fallback);
  if (byDefault !== null && isDir(byDefault)) return byDefault;
  return resolveCI(instance, fallback);
}

export function discoverMo2(
  def: GameDef,
  libraries: string[],
  options: { mo2InstancePath?: string; profileName?: string },
  platform: DoctorPlatform
): Mo2Facts {
  const managers = detectInstalledManagers(libraries);
  const wants = options.mo2InstancePath !== undefined || inferManagerForGame(def, managers) === "mo2";
  if (!wants) return { used: false, reason: "Mod Organizer 2 doesn't look like the active manager for this game" };

  const instance = findMo2InstanceForGame(def, options.mo2InstancePath);
  if (!instance) return { used: false, reason: "no Mod Organizer 2 instance for this game was found" };

  let order: ReturnType<typeof readMo2LoadOrder> = null;
  try {
    order = readMo2LoadOrder(def, {
      ...(options.mo2InstancePath !== undefined ? { instancePath: options.mo2InstancePath } : {}),
      ...(options.profileName !== undefined ? { profileName: options.profileName } : {}),
    });
  } catch {
    // A profile file that can't be opened is the same as a profile that isn't there.
    order = null;
  }
  if (!order) {
    return {
      used: false,
      missed: true,
      reason: "found a Mod Organizer 2 instance but couldn't read the profile from it (profileName may be wrong, or its files can't be opened)",
    };
  }

  return {
    used: true,
    reason: "Mod Organizer 2's profile, mod folders and Overwrite folder were read, since MO2 is what loads plugins for this game",
    instance,
    profile: order.profile,
    profileDir: order.sourcePath,
    modsDir: folderSetting(instance, "mod_directory", "mods", platform),
    overwriteDir: folderSetting(instance, "overwrite_directory", "overwrite", platform),
    folders: (order.modFolders ?? []).map((f) => ({ name: f.name, enabled: f.enabled })),
  };
}
