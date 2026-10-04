import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gb } from "../crashwhisper/text.js";
import { freeBytes, isDir, listDir } from "./fsutil.js";
import type { DoctorFinding, DoctorPlatform } from "./types.js";

// ─── Where things live, and how much room there is ───────────────────────────
// Three plain facts about the install that cause more trouble than they look like:
// a folder Windows protects or a sync client watches, how much space is left on the
// drive, and, for people whose Documents folder moved into OneDrive, where Skyrim's
// own folder (ini files, saves, SKSE and crash logs) really is.

export type Spot = "program-files" | "onedrive" | "user-folder";

/** What is special about a Windows path. Other systems have no such folders. */
export function spotsOf(path: string, platform: DoctorPlatform): Spot[] {
  if (platform !== "windows") return [];
  const segs = path
    .split(/[\\/]+/)
    .filter((s) => s !== "")
    .map((s) => s.toLowerCase());
  const spots: Spot[] = [];
  if (segs.some((s) => s === "program files" || s === "program files (x86)")) spots.push("program-files");
  if (segs.some((s) => s === "onedrive" || s.startsWith("onedrive -") || s.startsWith("onedrive-"))) spots.push("onedrive");
  const users = segs.indexOf("users");
  const inUser = users >= 0 ? segs[users + 2] : undefined;
  if (inUser !== undefined && ["desktop", "documents", "downloads", "pictures", "videos"].includes(inUser)) spots.push("user-folder");
  return spots;
}

export type Place = { what: "game" | "mo2" | "mo2-mods"; path: string };

const STEP = "https://stepmodifications.org/wiki/Guide:System_Setup_Guide";
const WABBAJACK = "https://wiki.wabbajack.org/user_documentation/Troubleshooting%20FAQ.html";

const SPOT_WORDS: Record<Spot, string> = {
  "program-files": "Program Files",
  onedrive: "a OneDrive folder",
  "user-folder": "one of your user folders (Desktop, Documents, Downloads, Pictures or Videos)",
};

const WHAT_WORDS: Record<Place["what"], string> = { game: "The game", mo2: "Mod Organizer 2's instance", "mo2-mods": "Mod Organizer 2's mods folder" };

export function judgeLocation(places: readonly Place[], platform: DoctorPlatform): DoctorFinding | null {
  // With nothing to look at there is nothing to say; "not in a protected folder" would claim a look that never happened.
  if (platform !== "windows" || places.length === 0) return null;
  const flagged: Array<{ place: Place; spots: Spot[] }> = [];
  for (const place of places) {
    // The user folders matter for where mods live; a game in one is a rarer thing and left alone.
    const spots = spotsOf(place.path, platform).filter((s) => place.what !== "game" || s !== "user-folder");
    if (spots.length > 0) flagged.push({ place, spots });
  }
  if (flagged.length === 0) {
    // Say only what was looked at: the game isn't checked against the user folders, and MO2 only when it was found.
    const said = [
      ...(places.some((p) => p.what === "game") ? ["the game isn't under Program Files or a OneDrive folder"] : []),
      ...(places.some((p) => p.what !== "game") ? ["Mod Organizer 2 isn't under Program Files, a OneDrive folder or one of your user folders"] : []),
    ].join(", and ");
    return {
      id: "setup.location",
      area: "setup",
      status: "ok",
      title: "Not in a protected or synced folder",
      detail: `${said.charAt(0).toUpperCase()}${said.slice(1)}.`,
      basis: "rule",
      source: STEP,
    };
  }
  const items = [...new Set(flagged.map(({ place, spots }) => `${WHAT_WORDS[place.what]}: ${spots.map((s) => SPOT_WORDS[s]).join(" and ")}`))];
  const programFiles = flagged.some((f) => f.spots.includes("program-files"));
  const sentences: string[] = [];
  if (programFiles) {
    sentences.push(
      "Modding guides (STEP, the Modding Wiki) advise keeping the game and the mod tools out of Program Files, because Windows protects it and tools that write there can fail. " +
        "Steam's default library is there, so this is common."
    );
  }
  if (flagged.some((f) => f.spots.includes("onedrive") || f.spots.includes("user-folder"))) {
    sentences.push(
      "Wabbajack's FAQ lists OneDrive, Desktop, Documents, Downloads, Pictures and Videos among the protected folders to keep installs out of."
    );
  }
  return {
    id: "setup.location",
    area: "setup",
    status: "warn",
    title: flagged.length === 1 ? "A folder Windows protects or syncs" : "Folders Windows protects or syncs",
    detail: sentences.join(" "),
    fix: "Move it to a plain folder such as D:\\SteamLibrary or C:\\Games. Steam can move a game between library folders from the game's Properties, under Installed Files.",
    basis: "rule",
    source: programFiles ? STEP : WABBAJACK,
    items,
  };
}

// ─── Room left ───────────────────────────────────────────────────────────────

export type Room = { label: string; path: string };

/** Under this much free space a game update or a big install gets tight. A rule of thumb, not a measurement. */
const TIGHT_BYTES = 5 * 1024 * 1024 * 1024;

function driveOf(path: string): number | null {
  try {
    return statSync(path).dev;
  } catch {
    return null;
  }
}

/** `measure` is how free space is read; tests hand in their own. */
export function judgeRoom(rooms: readonly Room[], measure: (path: string) => number | null = freeBytes): DoctorFinding | null {
  const read = rooms
    .map((r) => ({ label: r.label, free: measure(r.path), dev: driveOf(r.path) }))
    .filter((r): r is { label: string; free: number; dev: number | null } => r.free !== null);
  if (read.length === 0) return null;

  // Two folders on one drive are one line, not two.
  const merged: Array<{ dev: number | null; labels: string[]; free: number }> = [];
  for (const r of read) {
    const same = r.dev === null ? undefined : merged.find((m) => m.dev === r.dev);
    if (same) same.labels.push(r.label);
    else merged.push({ dev: r.dev, labels: [r.label], free: r.free });
  }
  const lines = merged.map((m) => `${m.labels.join(" and ")}: ${gb(m.free / 1024 / 1024 / 1024)} GB free`);
  const tight = merged.filter((m) => m.free < TIGHT_BYTES);
  if (tight.length === 0) {
    return {
      id: "setup.room",
      area: "setup",
      status: "ok",
      title: "Room on the drive",
      detail: `${lines.join("; ")}.`,
      basis: "install",
    };
  }
  return {
    id: "setup.room",
    area: "setup",
    status: "warn",
    title: "Little room left on a drive",
    detail: `${lines.join("; ")}. Under 5 GB is tight for a game update or a large mod install.`,
    fix: "Free some space on that drive before updating the game or installing more.",
    basis: "guess",
    items: lines,
  };
}

// ─── Skyrim's own folder, when Documents lives in OneDrive ───────────────────

/**
 * Where "My Games\<folder>" is. Windows Known Folder Move can put Documents inside OneDrive,
 * and the ini files, saves and the script extender's logs go with it.
 */
export function judgeMyGames(platform: DoctorPlatform, folderNames: readonly string[], home = homedir()): DoctorFinding | null {
  if (platform !== "windows") return null;
  const roots: Array<{ dir: string; oneDrive: boolean }> = [{ dir: join(home, "Documents"), oneDrive: false }];
  for (const name of listDir(home)) {
    if (/^onedrive(?: - .+)?$/i.test(name)) roots.push({ dir: join(home, name, "Documents"), oneDrive: true });
  }
  const hits = roots.filter((r) => folderNames.some((f) => isDir(join(r.dir, "My Games", f))));
  const inOneDrive = hits.some((h) => h.oneDrive);
  if (!inOneDrive) return null;
  const alsoPlain = hits.some((h) => !h.oneDrive);
  return {
    id: "setup.my-games",
    area: "setup",
    status: alsoPlain ? "warn" : "note",
    title: alsoPlain ? "Two copies of the game's My Games folder" : "The game's My Games folder is inside OneDrive",
    detail: alsoPlain
      ? "There is a My Games folder for this game both under Documents and under OneDrive. Which one the game uses depends on where Windows points Documents, so ini edits and logs can end up in the one that isn't read."
      : "Windows has moved Documents into OneDrive, so the game's ini files, saves and its script extender and crash logs are under OneDrive\\Documents\\My Games rather than the Documents folder in your user folder. Look there when a guide says to open Documents\\My Games.",
    basis: "install",
    source: "https://learn.microsoft.com/en-us/sharepoint/redirect-known-folders",
  };
}
