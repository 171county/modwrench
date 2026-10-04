import { chmodSync, closeSync, constants, mkdirSync, openSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP_ID, type Sandbox, type World } from "./world.js";

// ─── Building a player's install for the Doctors ─────────────────────────────
// Real folders on disk, laid out the way the files really are: plugins with real
// TES4 headers, a plugins.txt where the game keeps it (in the Windows profile or in
// the Proton prefix), a Mod Organizer 2 instance with its ini, profile, mod folders
// and Overwrite. Nothing here is a stand-in for the code under test; the Doctors read
// exactly what these helpers write.

// ─── Plugins ─────────────────────────────────────────────────────────────────

export type PluginSpec = {
  master?: boolean;
  light?: boolean;
  localized?: boolean;
  /** Masters, in the order the plugin lists them. A Buffer is written as it is, for names in Windows-1252. */
  masters?: Array<string | Buffer>;
  /** HEDR's version number. 1.7 by default; null leaves HEDR out. */
  version?: number | null;
  /** Bytes after the header, standing in for the plugin's own records. */
  tail?: Buffer;
};

function sub(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(6);
  head.write(type, 0, "latin1");
  head.writeUInt16LE(data.length, 4);
  return Buffer.concat([head, data]);
}

/** A plugin as it starts: the 24-byte TES4 record header, HEDR, then a MAST and a DATA per master. */
export function tes4(spec: PluginSpec = {}): Buffer {
  const parts: Buffer[] = [];
  if (spec.version !== null) {
    const hedr = Buffer.alloc(12);
    hedr.writeFloatLE(spec.version ?? 1.7, 0);
    hedr.writeUInt32LE(0, 4);
    hedr.writeUInt32LE(0x800, 8);
    parts.push(sub("HEDR", hedr));
  }
  for (const master of spec.masters ?? []) {
    parts.push(sub("MAST", Buffer.concat([Buffer.isBuffer(master) ? master : Buffer.from(master, "latin1"), Buffer.from([0])])));
    parts.push(sub("DATA", Buffer.alloc(8)));
  }
  const data = Buffer.concat(parts);
  const head = Buffer.alloc(24);
  head.write("TES4", 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  head.writeUInt32LE((spec.master ? 0x1 : 0) | (spec.localized ? 0x80 : 0) | (spec.light ? 0x200 : 0), 8);
  return Buffer.concat([head, data, spec.tail ?? Buffer.alloc(0)]);
}

/**
 * Make a file or folder that is there impossible to open, the way a program holding it or a deny-read permission
 * does, and return how to undo it. Null when this system reads it anyway (a root user ignores permissions).
 */
export function lockAway(path: string): (() => void) | null {
  if (process.platform === "win32") {
    // A handle that shares nothing: Windows then answers every other open of it with EBUSY, as when a tool holds it.
    // 0x10000000 is libuv's UV_FS_O_EXLOCK, which Node passes on but doesn't name.
    const fd = openSync(path, constants.O_RDONLY | 0x10000000);
    return () => closeSync(fd);
  }
  const mode = statSync(path).mode & 0o7777;
  chmodSync(path, 0);
  const undo = (): void => chmodSync(path, mode);
  try {
    if (statSync(path).isDirectory()) readdirSync(path);
    else closeSync(openSync(path, "r"));
  } catch {
    return undo;
  }
  undo();
  return null;
}

/** Write a file at a path below `root`, making the folders on the way. */
export function putRel(root: string, rel: string, bytes: Buffer | string): void {
  const file = join(root, ...rel.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

// ─── The game ────────────────────────────────────────────────────────────────

export const BASE_PLUGINS = ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"];

/** The game's own plugins, in its Data folder, as the master files they are. */
export function putBasePlugins(w: World): void {
  const data = join(w.gameDir, "Data");
  for (const name of BASE_PLUGINS) putRel(data, name, tes4({ master: true }));
}

export const dataOf = (w: World): string => join(w.gameDir, "Data");

/** Where the game keeps plugins.txt on Windows: in the profile's AppData\Local, which the sandbox points LOCALAPPDATA at. */
export function windowsPluginsTxt(sandbox: Sandbox, text: string | Buffer, folder = "Skyrim Special Edition"): string {
  const local = process.env.LOCALAPPDATA ?? join(sandbox.home, "AppData", "Local");
  const file = join(local, folder, "Plugins.txt");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/** Where it lives under Proton: in the game's prefix, inside the Steam library. */
export function protonPluginsTxt(w: World, text: string | Buffer): string {
  const file = join(w.steamapps, "compatdata", APP_ID, "pfx", "drive_c", "users", "steamuser", "AppData", "Local", "Skyrim Special Edition", "Plugins.txt");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/** plugins.txt text: "*Name" for a plugin that is on, "Name" for one that is off. */
export const listText = (lines: string[], eol = "\r\n"): string => ["# This file is used by Skyrim to keep track of your downloaded content.", ...lines, ""].join(eol);

// ─── Mod Organizer 2 ─────────────────────────────────────────────────────────

export type Mo2Spec = {
  /** Folder name under the world's root. */
  folder?: string;
  profile?: string;
  /** modlist.txt lines, highest priority first, as MO2 writes them ("+Mod", "-Mod"). */
  modlist: string[];
  /** The profile's plugins.txt lines. Left out: no plugins.txt in the profile. */
  plugins?: string[];
  /** Mod folder name to files (relative paths, forward slashes). */
  mods?: Record<string, Record<string, Buffer | string>>;
  /** Files in the Overwrite folder. Left out: Overwrite exists and is empty. */
  overwrite?: Record<string, Buffer | string>;
  /** Extra lines for ModOrganizer.ini, after [General]. */
  ini?: string;
  /** Where the mods live, when it isn't the instance's own mods folder. Written to the ini as mod_directory. */
  modsAt?: string;
  /** Where Overwrite lives, when it isn't the instance's own overwrite folder. */
  overwriteAt?: string;
};

export type Mo2Instance = { instance: string; mods: string; overwrite: string; profileDir: string };

/** An MO2 instance. Returns where its pieces are, so a test can add to them. */
export function makeMo2(w: World, o: Mo2Spec): Mo2Instance {
  const instance = join(w.root, o.folder ?? "mo2");
  const profile = o.profile ?? "Default";
  const profileDir = join(instance, "profiles", profile);
  mkdirSync(profileDir, { recursive: true });
  const settings: string[] = [];
  if (o.modsAt !== undefined) settings.push(`mod_directory=${o.modsAt}`);
  if (o.overwriteAt !== undefined) settings.push(`overwrite_directory=${o.overwriteAt}`);
  writeFileSync(
    join(instance, "ModOrganizer.ini"),
    [
      "[General]",
      "gameName=Skyrim Special Edition",
      `selected_profile=@ByteArray(${profile})`,
      ...(settings.length > 0 ? ["", "[Settings]", ...settings] : []),
      ...(o.ini !== undefined ? [o.ini] : []),
      "",
    ].join("\n")
  );
  writeFileSync(join(profileDir, "modlist.txt"), ["# This file was automatically generated by Mod Organizer.", ...o.modlist, ""].join("\n"));
  if (o.plugins !== undefined) writeFileSync(join(profileDir, "plugins.txt"), listText(o.plugins));
  const mods = o.modsAt !== undefined ? o.modsAt : join(instance, "mods");
  mkdirSync(mods, { recursive: true });
  for (const [mod, files] of Object.entries(o.mods ?? {})) {
    mkdirSync(join(mods, mod), { recursive: true });
    for (const [rel, bytes] of Object.entries(files)) putRel(join(mods, mod), rel, bytes);
  }
  const overwrite = o.overwriteAt !== undefined ? o.overwriteAt : join(instance, "overwrite");
  mkdirSync(overwrite, { recursive: true });
  for (const [rel, bytes] of Object.entries(o.overwrite ?? {})) putRel(overwrite, rel, bytes);
  return { instance, mods, overwrite, profileDir };
}

// ─── Steam, Proton and the desktop: what the Deck Doctor reads ───────────────

/** Valve's text format writes a quote as \" and a backslash as \\. */
const vdfString = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

export type SteamGame = { appId: string; dir: string; name?: string };

/**
 * A Steam install at `root`: its steamapps folder, the libraries it lists in libraryfolders.vdf,
 * and, when `game` is given, that game's manifest and install folder.
 */
export function makeSteam(root: string, o: { game?: SteamGame; libraries?: string[] } = {}): { root: string; steamapps: string; gameDir: string | null } {
  const steamapps = join(root, "steamapps");
  mkdirSync(steamapps, { recursive: true });
  if (o.libraries !== undefined) {
    const entries = o.libraries.map((lib, i) => `\t"${i + 1}"\n\t{\n\t\t"path"\t\t"${vdfString(lib)}"\n\t}`);
    writeFileSync(join(steamapps, "libraryfolders.vdf"), ['"libraryfolders"', "{", ...entries, "}", ""].join("\n"));
  }
  let gameDir: string | null = null;
  if (o.game !== undefined) {
    gameDir = join(steamapps, "common", o.game.dir);
    mkdirSync(gameDir, { recursive: true });
    writeFileSync(
      join(steamapps, `appmanifest_${o.game.appId}.acf`),
      ['"AppState"', "{", `\t"appid"\t\t"${o.game.appId}"`, `\t"name"\t\t"${vdfString(o.game.name ?? o.game.dir)}"`, '\t"StateFlags"\t\t"4"', `\t"installdir"\t\t"${vdfString(o.game.dir)}"`, "}", ""].join("\n")
    );
  }
  return { root, steamapps, gameDir };
}

/** Lethal Company, a BepInEx game: its Steam id and the folder Steam installs it into. */
export const LETHAL: SteamGame = { appId: "1966720", dir: "Lethal Company", name: "Lethal Company" };

/** The Proton prefix Steam makes for a game: compatdata/<appId>/pfx, with user.reg when `userReg` is given (its text). */
export function makePrefix(steamapps: string, appId: string, o: { userReg?: string; lock?: boolean } = {}): string {
  const compat = join(steamapps, "compatdata", appId);
  const pfx = join(compat, "pfx");
  mkdirSync(pfx, { recursive: true });
  if (o.userReg !== undefined) writeFileSync(join(pfx, "user.reg"), o.userReg);
  if (o.lock) writeFileSync(join(compat, "pfx.lock"), "");
  return pfx;
}

/** A Wine user.reg whose DllOverrides section sets `winhttp` to `value`, as winecfg and r2modman write it. */
export function userRegWith(winhttp: string | null): string {
  return [
    "WINE REGISTRY Version 2",
    ";; All keys relative to \\\\User\\\\S-1-5-21-0-0-0-1000",
    "",
    "[Software\\\\Wine\\\\DllOverrides] 1700000000",
    "#time=1d9a0b0c0d0e0f0",
    ...(winhttp !== null ? [`"winhttp"="${winhttp}"`] : []),
    '"d3d11"="native,builtin"',
    "",
    "[Software\\\\Wine\\\\Fonts] 1700000000",
    "#time=1d9a0b0c0d0e0f1",
    // The same key in another section means nothing to the loader.
    '"winhttp"="native,builtin"',
    "",
  ].join("\n");
}

/** Write a Steam account's localconfig.vdf with `launchOptions` for each app given. */
export function putLaunchOptions(steamRoot: string, account: string, options: Record<string, string>): string {
  const apps = Object.entries(options).map(([appId, text]) => `\t\t\t\t\t"${appId}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t"${vdfString(text)}"\n\t\t\t\t\t}`);
  const file = join(steamRoot, "userdata", account, "config", "localconfig.vdf");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      '"UserLocalConfigStore"',
      "{",
      '\t"Software"',
      "\t{",
      '\t\t"Valve"',
      "\t\t{",
      '\t\t\t"Steam"',
      "\t\t\t{",
      '\t\t\t\t"apps"',
      "\t\t\t\t{",
      ...apps,
      "\t\t\t\t}",
      "\t\t\t}",
      "\t\t}",
      "\t}",
      "}",
      "",
    ].join("\n")
  );
  return file;
}

/** A launcher file: the .desktop file a mod manager installs to say how to open nxm:// links. */
export function putDesktop(dir: string, id: string, entry: Record<string, string>): string {
  const file = join(dir, id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, ["[Desktop Entry]", "Type=Application", ...Object.entries(entry).map(([k, v]) => `${k}=${v}`), ""].join("\n"));
  return file;
}

/** A mimeapps.list or mimeinfo.cache: sections of "type=id;id;" lines. */
export function putMimeList(file: string, sections: Record<string, Record<string, string[]>>): string {
  mkdirSync(dirname(file), { recursive: true });
  const lines: string[] = [];
  for (const [section, types] of Object.entries(sections)) {
    lines.push(`[${section}]`);
    for (const [type, ids] of Object.entries(types)) lines.push(`${type}=${ids.join(";")};`);
    lines.push("");
  }
  writeFileSync(file, lines.join("\n"));
  return file;
}

export const NXM = "x-scheme-handler/nxm";
