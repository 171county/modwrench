import { readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { clean } from "../patchday/summary.js";
import { gb } from "../crashwhisper/text.js";
import type { DoctorFinding } from "./types.js";

// ─── What has piled up in Mod Organizer 2's Overwrite folder ─────────────────
// MO2 shows the game a virtual Data folder made of the enabled mods. When a tool
// run through MO2 (xEdit, Pandora, Synthesis, BodySlide, a LOD generator) writes a
// new file there, MO2 can't know which mod it belongs to, so it lands in Overwrite.
// Overwrite sits last in the order with the highest priority: MO2's wiki says its
// files "will always win". Output from a tool run months ago keeps overriding mods
// until somebody notices.
//
// This only looks. It lists the folder, adds up what is in it and sorts it into a
// few piles by where each file sits and what it is called; it moves and deletes nothing.

export type Pile =
  | "xedit"
  | "plugins"
  | "behavior"
  | "lod"
  | "meshes"
  | "textures"
  | "scripts"
  | "dll"
  | "logs"
  | "wrye"
  | "other";

/** How a pile is counted: "1 mesh", "5 meshes". */
const LABEL: Record<Pile, [one: string, many: string]> = {
  xedit: ["xEdit backup or cache file", "xEdit backup and cache files"],
  plugins: ["plugin file", "plugin files"],
  behavior: ["animation behavior file", "animation behavior files"],
  lod: ["LOD file", "LOD files"],
  meshes: ["mesh", "meshes"],
  textures: ["texture", "textures"],
  scripts: ["script", "scripts"],
  dll: ["DLL", "DLLs"],
  logs: ["log", "logs"],
  wrye: ["Wrye Bash file", "Wrye Bash files"],
  other: ["other file", "other files"],
};

/** Piles that only record what a tool did. The rest change what the game loads. */
const HARMLESS: ReadonlySet<Pile> = new Set<Pile>(["xedit", "logs", "wrye"]);

/** Which pile a file belongs to. `rel` is its path inside Overwrite, lower case, with forward slashes. */
export function classify(rel: string): Pile {
  const parts = rel.split("/");
  const first = parts[0] ?? "";
  const name = parts[parts.length - 1] ?? "";
  if (/^[a-z0-9]*edit (?:backups|cache)$/.test(first)) return "xedit";
  if (first === "bash patches" || first === "bashtags" || (first === "docs" && name.startsWith("bashed patch"))) return "wrye";
  if (/\.(?:esp|esm|esl)$/.test(name)) return "plugins";
  if (/\.log$/.test(name) || /_log\.txt$/.test(name) || /\.log\.txt$/.test(name)) return "logs";
  if (first === "nemesis_engine" || first === "pandora_engine" || /\.hkx$/.test(name) || /^animation(?:set)?datasinglefile\.txt$/.test(name)) return "behavior";
  if (/\.(?:btr|bto|bte)$/.test(name) || rel.startsWith("meshes/terrain/") || rel.startsWith("textures/terrain/") || rel.startsWith("textures/dyndolod/")) return "lod";
  if (/\.dll$/.test(name)) return "dll";
  if (first === "scripts" || /\.pex$/.test(name)) return "scripts";
  if (first === "meshes") return "meshes";
  if (first === "textures") return "textures";
  return "other";
}

export type OverwriteScan = {
  files: number;
  bytes: number;
  /** The scan stopped at its limit, so the real totals are higher. */
  truncated: boolean;
  /** Folders in Overwrite, Overwrite itself included, that are there but couldn't be listed. */
  unread: number;
  piles: Partial<Record<Pile, { files: number; bytes: number }>>;
  /** The first entries at the top of the folder, in the order they were listed. */
  top: string[];
  /** Tools the file names and places look like output from. */
  looksLike: string[];
};

const MAX_ENTRIES = 20_000;
const MAX_DEPTH = 16;

/** Read Overwrite. Folders only: nothing is opened for writing and nothing outside `dir` is touched. */
export function scanOverwrite(dir: string, limit = MAX_ENTRIES): OverwriteScan {
  const scan: OverwriteScan = { files: 0, bytes: 0, truncated: false, unread: 0, piles: {}, top: [], looksLike: [] };
  const hints = new Set<string>();
  let seen = 0;
  // A folder that isn't there holds nothing; one that is there but can't be listed holds something unknown.
  const unlisted = (error: unknown): void => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") scan.unread++;
  };

  let topEntries: string[] = [];
  try {
    topEntries = readdirSync(dir);
  } catch (error) {
    unlisted(error);
    return scan;
  }
  scan.top = topEntries.slice(0, 12);

  const stack: Array<{ abs: string; rel: string; depth: number }> = [{ abs: dir, rel: "", depth: 0 }];
  while (stack.length > 0) {
    const { abs, rel, depth } = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch (error) {
      unlisted(error);
      continue;
    }
    for (const entry of entries) {
      if (++seen > limit) {
        scan.truncated = true;
        return finish(scan, hints);
      }
      const childRel = rel === "" ? entry.name.toLowerCase() : `${rel}/${entry.name.toLowerCase()}`;
      const childAbs = join(abs, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) stack.push({ abs: childAbs, rel: childRel, depth: depth + 1 });
        continue;
      }
      let size = 0;
      try {
        size = statSync(childAbs).size;
      } catch {
        // A file that vanished or can't be read still counts as a file.
      }
      const pile = classify(childRel);
      const slot = (scan.piles[pile] ??= { files: 0, bytes: 0 });
      slot.files++;
      slot.bytes += size;
      scan.files++;
      scan.bytes += size;
      note(hints, childRel);
    }
  }
  return finish(scan, hints);
}

function note(hints: Set<string>, rel: string): void {
  if (/^synthesis\.esp$/.test(rel)) hints.add("Synthesis");
  else if (/^bashed patch, \d+\.esp$/.test(rel)) hints.add("Wrye Bash");
  else if (/^(?:dyndolod\.es[mp]|occlusion\.esp)$/.test(rel)) hints.add("DynDOLOD");
  else if (/^[a-z0-9]*edit (?:backups|cache)\//.test(rel)) hints.add("xEdit");
  else if (/\.hkx$/.test(rel) || /^animation(?:set)?datasinglefile\.txt$/.test(rel)) hints.add("an animation behavior tool such as Pandora, Nemesis or FNIS");
  else if (/\.(?:btr|bto)$/.test(rel) || rel.startsWith("textures/dyndolod/")) hints.add("a LOD generator such as DynDOLOD or xLODGen");
}

function finish(scan: OverwriteScan, hints: Set<string>): OverwriteScan {
  scan.looksLike = [...hints];
  return scan;
}

const PILE_ORDER: Pile[] = ["plugins", "behavior", "lod", "meshes", "textures", "scripts", "dll", "other", "xedit", "wrye", "logs"];

function mb(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${gb(bytes / 1024 / 1024 / 1024)} GB`;
  if (bytes < 1024 * 1024) return "under 1 MB";
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

const SOURCE = "https://github.com/ModOrganizer2/modorganizer/wiki/Troubleshooting";

/** What the scan means, as a finding. */
export function judgeOverwrite(scan: OverwriteScan): DoctorFinding {
  // Not read is not empty: nothing is called fine about a folder whose contents are unknown.
  const partial = scan.truncated || scan.unread > 0;
  if (scan.files === 0 && partial) {
    return {
      id: "setup.overwrite",
      area: "setup",
      status: "note",
      title: "Overwrite couldn't be read",
      detail: "MO2's Overwrite folder is there, but what is in it couldn't be read, so it isn't known whether anything in it overrides your mods. Whatever it holds wins over every mod.",
      fix: "Close any program that has the folder open, or check that you can open it, then run this again.",
      basis: "install",
    };
  }
  if (scan.files === 0) {
    return {
      id: "setup.overwrite",
      area: "setup",
      status: "ok",
      title: "Overwrite is empty",
      detail: "Nothing is sitting in MO2's Overwrite folder to override your mods.",
      basis: "install",
    };
  }
  const found = PILE_ORDER.filter((p) => scan.piles[p] !== undefined);
  const affecting = found.filter((p) => !HARMLESS.has(p));
  const piles = found
    .slice(0, 5)
    .map((p) => `${scan.piles[p]!.files} ${scan.piles[p]!.files === 1 ? LABEL[p][0] : LABEL[p][1]}`)
    .join(", ");
  const total = `${partial ? "at least " : ""}${scan.files} ${scan.files === 1 ? "file" : "files"} (${mb(scan.bytes)})`;
  const from = scan.looksLike.length > 0 ? ` It looks like output from ${scan.looksLike.slice(0, 3).join(", ")}.` : "";
  const items = scan.top.map((n) => clean(n, 60));

  if (affecting.length === 0) {
    return {
      id: "setup.overwrite",
      area: "setup",
      status: "note",
      title: "Overwrite holds logs and backups",
      detail: partial
        ? `MO2's Overwrite folder has ${total}: ${piles}, in the part that could be read. Those only record what a tool did, but the rest wasn't read, so whether it changes what the game loads isn't known.${from}`
        : `MO2's Overwrite folder has ${total}: ${piles}. These only record what a tool did, so they don't change what the game loads.${from}`,
      fix: "Clear it out when you like; in MO2, right-click Overwrite to create a mod from it or delete what you don't need.",
      basis: "rule",
      source: SOURCE,
      items,
    };
  }
  return {
    id: "setup.overwrite",
    area: "setup",
    status: "warn",
    title: "Overwrite holds files that beat every mod",
    detail:
      `MO2's Overwrite folder has ${total}: ${piles}. MO2 puts Overwrite last in the order with the highest priority, ` +
      `so whatever is in it wins over every mod, including output from a tool run months ago.${from}`,
    fix:
      "In MO2, right-click Overwrite and choose Create Mod... to keep what you meant to keep as a mod you can switch off, and delete what is stale. " +
      "MO2 leaves the new mod switched off, so switch it on, or the game stops seeing those files. " +
      "Pandora, BodySlide and the LOD generators have an output path setting, so their results go to a mod folder instead.",
    basis: "rule",
    source: SOURCE,
    items,
  };
}
