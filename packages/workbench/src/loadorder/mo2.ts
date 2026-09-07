import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathExists } from "../detect/os.js";
import { findSteamRoot, findSteamLibraries } from "../detect/steam.js";
import { detectInstalledManagers } from "../detect/manager.js";
import type { GameDef } from "../detect/games.js";
import type { LoadOrderResult, LoadOrderMod } from "./types.js";

// ─── Minimal INI parser ───────────────────────────────────────────────────────
// MO2 stores instance metadata in ModOrganizer.ini. The file is small and
// well-formed Qt-style INI; we only need a few keys, so a tiny parser keeps us
// dep-free.

function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = "_default";
  out[section] = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Qt's @ByteArray(...) wrapper appears around some values. Unwrap it.
    const qtMatch = value.match(/^@ByteArray\((.*)\)$/);
    if (qtMatch) value = qtMatch[1] ?? value;
    (out[section] ??= {})[key] = value;
  }
  return out;
}

// ─── Instance discovery ───────────────────────────────────────────────────────

/**
 * Where MO2 keeps its global instances.
 *
 * On Windows this is %LOCALAPPDATA%\ModOrganizer. On Linux and Steam Deck MO2
 * runs inside a Wine/Proton prefix, so the same directory sits at a Windows
 * path inside that prefix — there is nothing under $HOME to find. Rather than
 * duplicate the prefix-scanning logic, reuse the detector, which already
 * enumerates every Steam library (SD card included) and both prefix user
 * names, and reports MO2's real data path.
 */
function defaultMo2InstancesRoot(): string | null {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (!local) return null;
    return join(local, "ModOrganizer");
  }
  const steamRoot = findSteamRoot();
  const libraries = steamRoot ? findSteamLibraries(steamRoot) : [];
  const mo2 = detectInstalledManagers(libraries).find((m) => m.name === "mo2");
  return mo2?.dataPath ?? null;
}

function readInstanceGameName(instancePath: string): string | null {
  const iniPath = join(instancePath, "ModOrganizer.ini");
  if (!pathExists(iniPath)) return null;
  try {
    const ini = parseIni(readFileSync(iniPath, "utf8"));
    const general = ini["General"] ?? {};
    return general["gameName"] ?? null;
  } catch {
    return null;
  }
}

function readInstanceActiveProfile(instancePath: string): string | null {
  const iniPath = join(instancePath, "ModOrganizer.ini");
  if (!pathExists(iniPath)) return null;
  try {
    const ini = parseIni(readFileSync(iniPath, "utf8"));
    const general = ini["General"] ?? {};
    return general["selected_profile"] ?? general["profile"] ?? null;
  } catch {
    return null;
  }
}

/**
 * Find the MO2 instance directory for a given game. Walks the default
 * instances root, reads each ModOrganizer.ini, and matches gameName against
 * the game's known MO2 name aliases.
 *
 * Returns null if MO2 isn't installed or no matching instance is found.
 */
export function findMo2InstanceForGame(
  game: GameDef,
  explicitPath?: string
): string | null {
  if (explicitPath) {
    return pathExists(join(explicitPath, "ModOrganizer.ini"))
      ? explicitPath
      : null;
  }
  const root = defaultMo2InstancesRoot();
  if (!root || !pathExists(root)) return null;
  const aliases = (game.mo2GameNames ?? []).map((n) => n.toLowerCase());
  if (aliases.length === 0) return null;

  let candidates: string[];
  try {
    candidates = readdirSync(root).map((name) => join(root, name));
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isDirectory()) continue;
    } catch {
      continue;
    }
    const gameName = readInstanceGameName(candidate);
    if (!gameName) continue;
    if (aliases.includes(gameName.toLowerCase())) return candidate;
  }
  return null;
}

// ─── modlist.txt / plugins.txt parsing ────────────────────────────────────────

type ModlistEntry = { name: string; enabled: boolean };

function parseModlist(text: string): ModlistEntry[] {
  // modlist.txt is LIFO: top line is highest-priority. We reverse so index 0
  // is the lowest-priority mod and indices grow with priority — easier to
  // reason about as "load order index."
  const lines = text.split(/\r?\n/);
  const entries: ModlistEntry[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const prefix = line[0];
    const name = line.slice(1);
    // Separators (---xxx_separator) and backup markers can be skipped — they
    // aren't real mods. MO2 marks them with name ending "_separator".
    if (name.endsWith("_separator")) continue;
    if (prefix === "+") entries.push({ name, enabled: true });
    else if (prefix === "-") entries.push({ name, enabled: false });
    // Other prefixes (*) are markers we don't care about.
  }
  return entries.reverse();
}

type PluginEntry = { name: string; enabled: boolean };

function parsePlugins(text: string): PluginEntry[] {
  const out: PluginEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("*")) out.push({ name: line.slice(1), enabled: true });
    else out.push({ name: line, enabled: false });
  }
  return out;
}

/**
 * Read the load order for a game's active MO2 instance + profile. For
 * Bethesda games, the primary mods[] entries are .esp/.esl/.esm plugins from
 * plugins.txt (in load order). The mod-folder view from modlist.txt is
 * returned as modFolders[] so the LLM can map plugin → mod when needed.
 */
export function readMo2LoadOrder(
  game: GameDef,
  opts: { instancePath?: string; profileName?: string }
): LoadOrderResult | null {
  const instancePath = findMo2InstanceForGame(game, opts.instancePath);
  if (!instancePath) return null;

  const profile =
    opts.profileName ?? readInstanceActiveProfile(instancePath) ?? "Default";
  const profileDir = join(instancePath, "profiles", profile);
  if (!pathExists(profileDir)) return null;

  const modlistPath = join(profileDir, "modlist.txt");
  const pluginsPath = join(profileDir, "plugins.txt");

  let modFolders: Array<{ name: string; enabled: boolean; modlistIndex: number }> = [];
  if (pathExists(modlistPath)) {
    const entries = parseModlist(readFileSync(modlistPath, "utf8"));
    modFolders = entries.map((e, i) => ({
      name: e.name,
      enabled: e.enabled,
      modlistIndex: i,
    }));
  }

  const mods: LoadOrderMod[] = [];
  if (pathExists(pluginsPath)) {
    const plugins = parsePlugins(readFileSync(pluginsPath, "utf8"));
    for (let i = 0; i < plugins.length; i++) {
      const p = plugins[i]!;
      mods.push({
        name: p.name,
        enabled: p.enabled,
        loadOrderIndex: i,
        pluginFile: p.name,
      });
    }
  }

  const totalCount = mods.length || modFolders.length;
  const enabledCount =
    mods.length > 0
      ? mods.filter((m) => m.enabled).length
      : modFolders.filter((f) => f.enabled).length;

  return {
    modManager: "mo2",
    profile,
    sourcePath: profileDir,
    mods,
    modFolders,
    enabledCount,
    totalCount,
  };
}
