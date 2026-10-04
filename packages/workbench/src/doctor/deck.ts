import { homedir } from "node:os";
import { join, sep } from "node:path";
import type { GameDef } from "../detect/games.js";
import { readdirSync, statSync, type Dirent } from "node:fs";
import { clean } from "../patchday/summary.js";
import { isDir, realPath, resolveCI } from "./fsutil.js";
import { driveKind, mountFor, parseMounts, readMounts, type MountEntry } from "./mounts.js";
import { findNxmHandler, judgeNxm } from "./nxm.js";
import type { SteamFacts } from "./steam.js";
import { launchOptionsFor, launchOptionsOverrideWinhttp, prefixPrefersNativeWinhttp } from "./steamfiles.js";
import type { DoctorFinding } from "./types.js";

// ─── The Deck Doctor ─────────────────────────────────────────────────────────
// Linux and the Steam Deck run Windows games through Proton, and most of what goes
// wrong there is not the mod: it is which Steam holds the game, whether Proton has made
// the game's prefix, whether BepInEx's loader is allowed to load, which app gets nxm://
// links, what kind of drive the library is on, and folder names that differ only by case.
// Each check reads files. None runs a program.

const R2MODMAN = "https://github.com/ebkr/r2modmanPlus/wiki/Modding-on-a-Steam-Deck-and-Linux";
const BEPINEX_TROUBLESHOOTING = "https://docs.bepinex.dev/articles/user_guide/troubleshooting.html";
const PROTON_NTFS = "https://github.com/ValveSoftware/Proton/wiki/Using-a-NTFS-disk-with-Linux-and-Windows";
const STEAM_RUNTIME_434 = "https://github.com/ValveSoftware/steam-runtime/issues/434";
const FLATHUB_STEAM = "https://github.com/flathub/com.valvesoftware.Steam/wiki/Home";
const UESP_LINUX = "https://en.uesp.net/wiki/Oblivion_Mod:Linux";

const KIND_WORDS = { native: "native", flatpak: "Flatpak", custom: "custom (STEAM_ROOT)" } as const;

export type DeckInput = {
  def: GameDef;
  steam: SteamFacts;
  gameDir: string | null;
  /** For tests: the text of /proc/mounts. */
  mountsText?: string;
};

// ─── Which Steam ─────────────────────────────────────────────────────────────

function steamFinding(steam: SteamFacts): DoctorFinding {
  if (steam.installs.length === 0) {
    return {
      id: "deck.steam",
      area: "deck",
      status: "problem",
      title: "No Steam install found",
      detail:
        "ModWrench looked for Steam in ~/.local/share/Steam, ~/.steam/steam and the Flatpak's folder under ~/.var/app/com.valvesoftware.Steam, and found none with a steamapps folder.",
      fix: "If Steam is somewhere else, set STEAM_ROOT in the MCP server's environment to its folder, or pass gamePath for the game.",
      basis: "install",
    };
  }
  if (steam.installs.length > 1) {
    const where = steam.chosen !== null && steam.app !== null ? ` The game is in the ${KIND_WORDS[steam.chosen.kind]} one.` : " The game wasn't found in either.";
    return {
      id: "deck.steam",
      area: "deck",
      status: "note",
      title: "Two Steam installs",
      detail:
        `Found ${steam.installs.map((i) => KIND_WORDS[i.kind]).join(" and ")} Steam.${where} ` +
        "Each keeps its own launch options and Proton prefixes, so a mod manager and Steam need to be using the same one.",
      fix: "Settings you change in one Steam don't carry to the other. Make sure the manager launches the game through the Steam that holds it.",
      basis: "install",
      items: steam.installs.map((i) => `${KIND_WORDS[i.kind]} Steam, ${i.libraries.length} ${i.libraries.length === 1 ? "library" : "libraries"}`),
    };
  }
  const only = steam.installs[0]!;
  if (only.kind === "flatpak") {
    const flatpakHome = realPath(join(homedir(), ".var", "app", "com.valvesoftware.Steam"));
    const outside = only.libraries.filter((l) => {
      const real = realPath(l);
      return real !== flatpakHome && !real.startsWith(flatpakHome + sep);
    });
    if (outside.length > 0) {
      return {
        id: "deck.steam",
        area: "deck",
        status: "note",
        title: "Flatpak Steam with a library on another drive",
        detail:
          `Steam is the Flatpak build, and ${outside.length === 1 ? "one of its libraries is" : `${outside.length} of its libraries are`} outside its own folder. ` +
          "Flatpak Steam only sees folders it has been given access to, so a game library elsewhere needs permission. ModWrench can't see Flatpak's permission settings from here.",
        fix: "If Steam can't see that library, grant it: flatpak override --user --filesystem=/path/to/library com.valvesoftware.Steam",
        basis: "rule",
        source: FLATHUB_STEAM,
      };
    }
  }
  return {
    id: "deck.steam",
    area: "deck",
    status: "ok",
    title: `Steam: ${KIND_WORDS[only.kind]}`,
    detail: `One Steam install was found (${KIND_WORDS[only.kind]}), with ${only.libraries.length} ${only.libraries.length === 1 ? "library" : "libraries"}.`,
    basis: "install",
  };
}

// ─── The prefix ──────────────────────────────────────────────────────────────

function findPrefix(steam: SteamFacts, appId: string): string | null {
  const libraries = steam.app !== null ? [steam.app.libraryPath, ...(steam.chosen?.libraries ?? [])] : (steam.chosen?.libraries ?? []);
  let best: { dir: string; mtime: number } | null = null;
  for (const lib of new Set(libraries)) {
    const dir = join(lib, "compatdata", appId, "pfx");
    if (!isDir(dir)) continue;
    let mtime = 0;
    try {
      mtime = statSync(join(lib, "compatdata", appId, "pfx.lock")).mtimeMs;
    } catch {
      // No lock file: the prefix still counts, just with no timestamp.
    }
    if (best === null || mtime > best.mtime) best = { dir, mtime };
  }
  return best?.dir ?? null;
}

function prefixFinding(prefix: string | null, def: GameDef): DoctorFinding {
  if (prefix === null) {
    return {
      id: "deck.prefix",
      area: "deck",
      status: "warn",
      title: "No Proton prefix for this game yet",
      detail:
        `Steam makes ${def.displayName}'s Proton prefix the first time the game runs. There isn't one in any library yet, ` +
        "and managers that add their settings to the prefix (r2modman writes into its user.reg) need it to exist.",
      fix: "Start the game once from Steam, let it reach the menu, then quit and run this again.",
      basis: "rule",
      source: R2MODMAN,
    };
  }
  if (resolveCI(prefix, "user.reg") === null) {
    return {
      id: "deck.prefix",
      area: "deck",
      status: "warn",
      title: "The Proton prefix isn't fully set up",
      detail: "The game's prefix folder exists but has no user.reg, which is what a prefix that Proton hasn't finished creating looks like. r2modman's launcher edits that file and reports an error when it is missing.",
      fix: "Start the game once from Steam and let it reach the menu.",
      basis: "rule",
      source: R2MODMAN,
    };
  }
  return {
    id: "deck.prefix",
    area: "deck",
    status: "ok",
    title: "The game has a Proton prefix",
    detail: "Steam has created the game's Proton prefix and it has its registry files.",
    basis: "install",
  };
}

// ─── BepInEx under Proton ────────────────────────────────────────────────────

function usesBepInEx(def: GameDef): boolean {
  return def.loaderChecks.some((c) => c.loader.startsWith("bepinex"));
}

function bepinexFinding(args: { gameDir: string; prefix: string | null; steam: SteamFacts; def: GameDef }): DoctorFinding {
  const { gameDir, prefix, steam, def } = args;
  const loader = resolveCI(gameDir, "winhttp.dll") !== null;
  if (!loader) {
    return {
      id: "deck.bepinex-override",
      area: "deck",
      status: "note",
      title: "BepInEx's loader isn't in the game folder",
      detail:
        "There is no winhttp.dll next to the game, so BepInEx isn't installed there and the game starts without mods. " +
        "As far as r2modman's code shows, it copies BepInEx's files into the game folder when you start the game from it; a manual install puts them there yourself.",
      basis: "install",
      source: R2MODMAN,
    };
  }
  const inLaunch = (steam.chosen !== null ? launchOptionsFor(steam.chosen.root, def.steamAppId) : []).some(launchOptionsOverrideWinhttp);
  const inPrefix = prefix !== null && prefixPrefersNativeWinhttp(prefix) === true;
  if (inLaunch || inPrefix) {
    return {
      id: "deck.bepinex-override",
      area: "deck",
      status: "ok",
      title: "Proton is told to load BepInEx",
      detail: `The winhttp override is set ${inLaunch && inPrefix ? "in the game's Steam launch options and in its Proton prefix" : inLaunch ? "in the game's Steam launch options" : "in the game's Proton prefix"}, so Proton prefers the winhttp.dll in the game folder, which is BepInEx's loader.`,
      basis: "rule",
      source: R2MODMAN,
    };
  }
  const ran = resolveCI(gameDir, "BepInEx", "LogOutput.log") !== null;
  const how =
    "Under Proton, Wine's own winhttp.dll loads instead of BepInEx's unless it is told to prefer the one in the game folder. " +
    "Neither the game's Steam launch options nor its prefix's user.reg has that override.";
  if (ran) {
    return {
      id: "deck.bepinex-override",
      area: "deck",
      status: "warn",
      title: "No winhttp override set, though BepInEx has run here",
      detail: `${how} BepInEx has produced a log in this folder before, so it worked at some point; if mods stopped loading, this is the first thing to check. A manager that sets the override only for the game it starts can't be seen from files.`,
      fix: 'Set the game\'s Steam launch options to: WINEDLLOVERRIDES="winhttp=n,b" %command%',
      basis: "rule",
      source: R2MODMAN,
    };
  }
  return {
    id: "deck.bepinex-override",
    area: "deck",
    status: "problem",
    title: "BepInEx's loader is there but Proton isn't told to use it",
    detail:
      `${how} The game will start without mods; BepInEx's own troubleshooting page describes the sign as no BepInEx console and no BepInEx/config/BepInEx.cfg. ` +
      "r2modman writes this override into the prefix when it launches the game, so starting the game once from r2modman also clears this.",
    fix: 'In Steam, set the game\'s launch options to: WINEDLLOVERRIDES="winhttp=n,b" %command%',
    basis: "rule",
    source: BEPINEX_TROUBLESHOOTING,
  };
}

// ─── The drive ───────────────────────────────────────────────────────────────

export function driveFinding(steam: SteamFacts, mounts: readonly MountEntry[] | null): DoctorFinding | null {
  if (mounts === null || steam.chosen === null) return null;
  const gameLibrary = steam.app?.libraryPath ?? null;
  const rows = steam.chosen.libraries.map((lib) => {
    const mount = mountFor(mounts, realPath(lib));
    return { lib, type: mount?.type ?? null, kind: mount === null ? ("other" as const) : driveKind(mount.type), game: lib === gameLibrary };
  });
  const risky = rows.filter((r) => r.kind !== "other");
  if (risky.length === 0) {
    const types = [...new Set(rows.map((r) => r.type).filter((t): t is string => t !== null))];
    return {
      id: "deck.library-drive",
      area: "deck",
      status: "ok",
      title: "Steam libraries are on Linux filesystems",
      detail: `${rows.length} ${rows.length === 1 ? "library" : "libraries"} checked${types.length > 0 ? ` (${types.slice(0, 4).join(", ")})` : ""}.`,
      basis: "install",
    };
  }
  const withGame = risky.some((r) => r.game);
  const ntfsLike = risky.some((r) => r.kind === "ntfs" || r.kind === "fuseblk");
  const types = [...new Set(risky.map((r) => r.type!))];
  const sentences = [
    `${risky.length === 1 ? "A Steam library" : `${risky.length} Steam libraries`} ${withGame ? "(including the one with this game) " : ""}${risky.length === 1 ? "sits" : "sit"} on ${types.join(" and ")}.`,
  ];
  if (ntfsLike) {
    sentences.push(
      "Valve's Proton wiki discourages NTFS libraries (it says it isn't an official Valve guide), and a Steam runtime maintainer has said they are less robust than a Linux filesystem and that Proton needs symlinks. " +
        "ntfs-3g shows up as fuseblk, as do some other drivers."
    );
  }
  if (risky.some((r) => r.kind === "fat")) {
    sentences.push("exFAT and FAT drives can't hold the symlinks a Proton prefix uses. That is an inference; no Valve page says it.");
  }
  return {
    id: "deck.library-drive",
    area: "deck",
    status: withGame ? "warn" : "note",
    title: "A Steam library on an NTFS, exFAT or FAT drive",
    detail: sentences.join(" "),
    fix: "Keep Proton games on an ext4, btrfs or xfs drive. The Proton wiki's workaround for a shared drive is to link the game's compatdata folder onto a Linux filesystem.",
    basis: ntfsLike ? "rule" : "guess",
    source: ntfsLike ? PROTON_NTFS : STEAM_RUNTIME_434,
  };
}

// ─── Folder names that differ only by case ───────────────────────────────────

const MAX_LISTED = 30_000;

/**
 * Folders where two names differ only by capital letters. Paths are relative to `root`, with forward slashes.
 * `unread` counts folders that are there but couldn't be listed, so what is in them wasn't compared.
 */
export function findCaseClashes(root: string, depth = 2, maxListed = MAX_LISTED): { clashes: string[]; truncated: boolean; unread: number } {
  const clashes: string[] = [];
  let seen = 0;
  let truncated = false;
  let unread = 0;
  const entriesOf = (abs: string): Dirent[] => {
    try {
      return readdirSync(abs, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") unread++;
      return [];
    }
  };
  const walk = (abs: string, rel: string, level: number): void => {
    const entries = entriesOf(abs);
    seen += entries.length;
    if (seen > maxListed) {
      truncated = true;
      return;
    }
    const groups = new Map<string, string[]>();
    for (const e of entries) {
      const key = e.name.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), e.name]);
    }
    for (const group of groups.values()) {
      if (group.length > 1) clashes.push(`${rel === "" ? "" : rel + "/"}${group.map((n) => clean(n, 40)).join(" and ")}`);
    }
    if (level >= depth) return;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      walk(join(abs, e.name), rel === "" ? e.name : `${rel}/${e.name}`, level + 1);
      if (truncated) return;
    }
  };
  walk(root, "", 0);
  return { clashes, truncated, unread };
}

/** The case-clash finding, and why the folder wasn't all compared when it wasn't. */
function caseFinding(def: GameDef, gameDir: string): { finding: DoctorFinding; skipped: string | null } | null {
  const root = def.family === "bethesda" ? resolveCI(gameDir, "Data") : resolveCI(gameDir, "BepInEx", "plugins");
  if (root === null) return null;
  const folder = def.family === "bethesda" ? "Data" : "BepInEx plugins";
  const { clashes, truncated, unread } = findCaseClashes(root);
  const skipped = truncated
    ? `the game's ${folder} folder is too large to compare every name for case clashes`
    : unread > 0
      ? `part of the game's ${folder} folder couldn't be opened to compare names for case clashes`
      : null;
  if (clashes.length === 0) {
    return {
      skipped,
      finding: {
        id: "deck.case-clashes",
        area: "deck",
        // Only a folder that was read all the way is called fine.
        status: skipped === null ? "ok" : "note",
        title: skipped === null ? "No folder names that differ only by case" : "No case clashes in the part that could be read",
        detail: `Looked two levels into the game's ${folder} folder${truncated ? " (it is very large, so not all of it)" : unread > 0 ? " (some of it couldn't be opened)" : ""}.`,
        basis: "install",
      },
    };
  }
  const shown = clashes.slice(0, 8);
  return {
    skipped,
    finding: {
      id: "deck.case-clashes",
      area: "deck",
      status: "warn",
      title: "Folders that differ only by capital letters",
      detail:
        "Linux treats Meshes and meshes as two folders; Wine, and so the game, sees one of them, and what is in the other can be out of reach. It happens when archives are unpacked by hand.",
      fix: "Merge the contents into one folder and remove the other. Limo has a Case Matching Deployer that fixes names for you.",
      basis: "rule",
      source: UESP_LINUX,
      items: shown,
      ...(clashes.length > shown.length ? { more: clashes.length - shown.length } : {}),
    },
  };
}

// ─── Everything ──────────────────────────────────────────────────────────────

/** The Deck findings, and what they couldn't read, in words. */
export function runDeckChecks(input: DeckInput): { findings: DoctorFinding[]; skipped: string[] } {
  const { def, steam, gameDir } = input;
  const out: DoctorFinding[] = [steamFinding(steam)];
  const skipped: string[] = [];
  const prefix = findPrefix(steam, def.steamAppId);
  if (gameDir !== null || prefix !== null) out.push(prefixFinding(prefix, def));
  if (gameDir !== null && usesBepInEx(def)) out.push(bepinexFinding({ gameDir, prefix, steam, def }));
  if (def.family === "bethesda") out.push(judgeNxm(findNxmHandler()));
  const mounts = input.mountsText !== undefined ? parseMounts(input.mountsText) : readMounts();
  const drive = driveFinding(steam, mounts);
  if (drive !== null) out.push(drive);
  if (gameDir !== null) {
    const clashes = caseFinding(def, gameDir);
    if (clashes !== null) {
      out.push(clashes.finding);
      if (clashes.skipped !== null) skipped.push(clashes.skipped);
    }
  }
  return { findings: out, skipped };
}
