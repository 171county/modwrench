import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import { homedir } from "node:os";
import { pathExists } from "../detect/os.js";
import { isDir, readText, resolveCI } from "../doctor/fsutil.js";
import { isNetworkPath } from "../localpath.js";
import { findSteamRoot, findSteamLibraries } from "../detect/steam.js";
import { detectInstalledManagers } from "../detect/manager.js";
import type { GameDef } from "../detect/games.js";
import type { LoadOrderResult, LoadOrderMod } from "./types.js";

// ─── Minimal INI parser ───────────────────────────────────────────────────────
// MO2 stores instance metadata in ModOrganizer.ini. The file is small and
// well-formed Qt-style INI; we only need a few keys, so a tiny parser keeps us
// dep-free.

export function parseIni(text: string): Record<string, Record<string, string>> {
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

/** What a backslash and the character after it stand for to QSettings. Any other character is dropped with its backslash. */
const QT_ESCAPES: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", '"': '"', "?": "?", "'": "'", "\\": "\\" };

/**
 * A value as it reaches MO2 through Qt's QSettings (qsettings.cpp: readIniLine and iniUnescapedStringList).
 * A backslash starts an escape, which is why QSettings doubles the backslashes in a path it writes. Double quotes,
 * which it writes round a value with a comma, semicolon or equals sign in it, are dropped. Outside them a semicolon
 * starts a comment, and a comma makes the value a list, which MO2 reads as no text at all (qmetatype.cpp turns a
 * list into text only when it has one item).
 */
function qtValue(raw: string): string {
  let out = "";
  let quoted = false;
  let wasQuoted = false;
  let kept = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "\\") {
      const code = /^(?:x([0-9a-fA-F]+)|([0-7]+))/.exec(raw.slice(i + 1));
      if (code) {
        // A character by number, hex or octal, as many digits as follow; Qt keeps 16 bits of it.
        out += String.fromCharCode(code[1] !== undefined ? parseInt(code[1].slice(-4), 16) : parseInt(code[2]!.slice(-6), 8) & 0xffff);
        i += code[0].length;
      } else {
        out += QT_ESCAPES[raw[i + 1] ?? ""] ?? "";
        i++;
      }
      kept = out.length;
    } else if (ch === '"') {
      quoted = !quoted;
      wasQuoted = true;
      if (!quoted) while (raw[i + 1] === " " || raw[i + 1] === "\t") i++;
    } else if (!quoted && ch === ";") {
      break;
    } else if (!quoted && ch === ",") {
      return "";
    } else {
      out += ch;
    }
  }
  // Spaces before a comment go, unless the value was quoted or they came from an escape.
  return wasQuoted ? out : out.slice(0, kept) + out.slice(kept).replace(/[ \t]+$/, "");
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

// ─── An instance's folders ────────────────────────────────────────────────────

/**
 * Where an instance keeps its profiles, mods or Overwrite folder, worked out the
 * way MO2 does it (PathSettings in MO2's settings.cpp), as it is spelled on disk.
 * mw_read_load_order, Patch Day and the Doctors all ask here, so they find the
 * same folders. People with big mod lists often keep them on another drive.
 *
 * The [Settings] key counts when it is there, even empty; without it the folder
 * is "%BASE_DIR%/<name>". The same key in [General] is another setting to MO2.
 * %BASE_DIR%, in capitals, stands for base_directory, or the instance folder
 * without one; nothing is replaced inside base_directory itself. Backslashes
 * count as slashes once QSettings has read the value (qtValue). A path from no
 * root is relative to MO2's own program folder, which MO2 makes its working
 * folder (moapplication.cpp): that is the instance folder for a portable
 * instance, the one ModOrganizer.exe sits in, and unknown for any other.
 *
 * Under Wine the settings hold Windows paths and only Z:, the whole file system,
 * can be placed on this machine; null for any other drive. A path from the root
 * is taken to be on Z:, where Linux installers put MO2. Wine finds a name
 * whatever its capitals, and so does this. Null too when the folder isn't there,
 * and, everywhere, for one on another computer (\\host\share), which MO2 would
 * open: Linux would read //host/share as a folder of its own, and on Windows
 * opening it connects to that computer. Past its first 512 KB the ini isn't
 * read, so a setting there goes unseen and MO2's default stands.
 */
export function mo2Folder(
  instancePath: string,
  key: "profiles_directory" | "mod_directory" | "overwrite_directory",
  name: string,
  windows = process.platform === "win32"
): string | null {
  // No readable ini: MO2's defaults.
  const settings = parseIni(readText(join(instancePath, "ModOrganizer.ini"), 512 * 1024) ?? "")["Settings"] ?? {};
  const setting = (k: string): string | undefined => {
    const raw = settings[k];
    return raw === undefined ? undefined : qtValue(raw);
  };
  // The instance folder as MO2 names it; under Wine, Z: holds this machine's whole file system.
  const instance = `${windows ? "" : "Z:"}${resolve(instancePath)}`;
  const base = setting("base_directory") ?? instance;
  let path = (setting(key) ?? `%BASE_DIR%/${name}`).replace(/\\/g, "/").split("%BASE_DIR%").join(base.replace(/\\/g, "/"));
  if (!windows) {
    if (/^[a-zA-Z]:/.test(path) && !/^[zZ]:/.test(path)) return null;
    path = path.replace(/^[zZ]:/, "");
  }
  // A path from no root starts at MO2's own folder, known only for a portable instance. On Windows, "\mods"
  // (no drive) and "C:mods" (no root) depend on where MO2 runs as well, so neither can be told.
  if (windows ? !/^([a-zA-Z]:\/|\/\/)/.test(path) : !isAbsolute(path)) {
    if (/^([a-zA-Z]:|\/)/.test(path) || !pathExists(join(instancePath, "ModOrganizer.exe"))) return null;
    path = join(instancePath, path);
  }
  if (isNetworkPath(path)) return null;
  const root = parse(path).root;
  const found = resolveCI(root, ...path.slice(root.length).split(/[\\/]/).filter((part) => part !== ""));
  return found !== null && isDir(found) ? found : null;
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
  const profiles = mo2Folder(instancePath, "profiles_directory", "profiles");
  if (profiles === null) return null;
  const profileDir = join(profiles, profile);
  // The ini is a file anyone can plant: its profiles folder can name another computer, and a
  // profile named "..\..\UNC\host\share" under a \\?\C:\ folder climbs onto one.
  if (isNetworkPath(profileDir) || !pathExists(profileDir)) return null;

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
