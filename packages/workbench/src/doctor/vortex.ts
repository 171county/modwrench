import { statSync } from "node:fs";
import { isNetworkPath } from "../localpath.js";
import { isDir, readFileBytes, resolveCI } from "./fsutil.js";
import type { DoctorFinding } from "./types.js";

// ─── Vortex's staging folder ─────────────────────────────────────────────────
// Vortex keeps the mods it manages in a staging folder and deploys them into the
// game's Data folder. For Skyrim Special Edition and Fallout 4 that means hard
// links (Vortex's symbolic-link method calls itself incompatible with Bethesda's
// games), and hard links work only within one drive.
//
// Where the staging folder is lives in Vortex's own database, which ModWrench
// doesn't open. But while any mod is deployed, Vortex also writes a deployment
// record into the folder it deploys to, Data\vortex.deployment.json, naming the
// staging folder and the method, and deletes it when nothing is deployed
// (activationStore.ts, saveActivation, in Vortex's source). That record is what
// this reads, and only the start of it: Vortex writes those fields before the
// list of deployed files, which can be long.

/** Vortex's own ids for the games this is read for (its game-skyrimse and game-fallout4 extensions). */
export const VORTEX_GAME_IDS: Readonly<Record<string, string>> = { skyrimspecialedition: "skyrimse", fallout4: "fallout4" };

const RECORD = "vortex.deployment.json";
/** Enough for the fields Vortex writes before "files". */
const HEAD_BYTES = 64 * 1024;

/** Vortex's wiki page on deployment methods: the staging folder must be on the game's drive for hard links. */
export const VORTEX_DEPLOYMENT = "https://github.com/Nexus-Mods/Vortex/wiki/MODDINGWIKI-Users-General-Deployment-Methods";

const METHOD_WORDS: Record<string, string> = {
  hardlink_activator: "hard links",
  symlink_activator: "symbolic links",
  symlink_activator_elevated: "symbolic links",
  move_activator: "its move method",
};

export type VortexRecord =
  | { state: "none" }
  | { state: "unreadable" }
  | { state: "read"; gameId: string | null; method: string | null; staging: string | null };

/** A string field before the file list, as JSON would read it, or null. */
function field(text: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\\\r\\n]|\\\\.)*")`).exec(text);
  if (!match) return null;
  try {
    const value: unknown = JSON.parse(match[1]!);
    return typeof value === "string" && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

/** Vortex's deployment record in the game's Data folder, when there is one. */
export function readVortexRecord(gameDir: string): VortexRecord {
  const data = resolveCI(gameDir, "Data");
  const file = data === null ? null : resolveCI(data, RECORD);
  if (file === null) return { state: "none" };
  const bytes = readFileBytes(file, HEAD_BYTES);
  if (bytes === "missing") return { state: "none" };
  if (bytes === "unreadable") return { state: "unreadable" };
  const head = bytes.toString("utf8");
  // Only what comes before the file list is the record's own; the files' fields are never read.
  const cut = head.search(/"files"\s*:/);
  const top = cut >= 0 ? head.slice(0, cut) : head;
  // A method is Vortex's id for it ("hardlink_activator"); anything else in that field is someone else's text and isn't repeated.
  const method = field(top, "deploymentMethod");
  return { state: "read", gameId: field(top, "gameId"), method: method !== null && METHOD_ID.test(method) ? method : null, staging: field(top, "stagingPath") };
}

/** What Vortex's method ids look like. */
const METHOD_ID = /^[a-z][a-z0-9_-]{0,39}$/i;

function driveOf(path: string): number | null {
  try {
    return statSync(path).dev;
  } catch {
    return null;
  }
}

export type VortexCheck = {
  findings: DoctorFinding[];
  /** The staging folder, when the record names one that is on this computer and there, for the place and room checks. */
  staging: string | null;
  /** The record was read and named a staging folder, whether or not it could be checked. */
  recorded: boolean;
  method: string | null;
  /** What couldn't be read, in words, for the report's limits. */
  skipped: string[];
};

/** Read Vortex's record for this game and judge its staging folder. `drive` is how a folder's drive is told; tests hand in their own. */
export function checkVortex(gameDir: string, vortexGameId: string, drive: (path: string) => number | null = driveOf): VortexCheck {
  const none: VortexCheck = { findings: [], staging: null, recorded: false, method: null, skipped: [] };
  const record = readVortexRecord(gameDir);
  if (record.state === "none") return none;
  if (record.state === "unreadable") {
    return {
      ...none,
      skipped: ["Vortex's deployment record couldn't be opened"],
      findings: [
        {
          id: "setup.vortex-staging",
          area: "setup",
          status: "note",
          title: "Vortex's deployment record couldn't be read",
          detail: "The game's Data folder has a vortex.deployment.json, which says where Vortex's staging folder is, but it couldn't be opened (another program may hold it). Vortex's staging folder wasn't checked.",
          basis: "install",
        },
      ],
    };
  }
  // A record for another game, or one with no game in it, isn't this game's: Vortex names the game it deployed.
  if (record.gameId !== vortexGameId) return none;
  const method = record.method;
  if (record.staging === null) {
    return {
      ...none,
      recorded: false,
      method,
      findings: [
        {
          id: "setup.vortex-staging",
          area: "setup",
          status: "note",
          title: "Vortex's deployment record doesn't name its staging folder",
          detail: "Vortex has mods deployed to this game, but its deployment record in the Data folder doesn't say where the staging folder is (older versions of Vortex didn't write it), so the staging folder wasn't checked.",
          basis: "install",
        },
      ],
    };
  }
  const staging = record.staging;
  if (isNetworkPath(staging)) {
    return {
      ...none,
      recorded: true,
      method,
      findings: [
        {
          id: "setup.vortex-staging",
          area: "setup",
          status: "note",
          title: "Vortex's staging folder is on another computer",
          detail: "Vortex's deployment record puts its staging folder on a network share. ModWrench doesn't open network paths, so it wasn't checked. Hard links can't reach from a share to the game's drive.",
          basis: "install",
        },
      ],
    };
  }
  if (!isDir(staging)) {
    return {
      ...none,
      recorded: true,
      method,
      findings: [
        {
          id: "setup.vortex-staging",
          area: "setup",
          status: "warn",
          title: "The staging folder Vortex's record names isn't there",
          detail:
            "Vortex's deployment record in the Data folder names a staging folder that isn't on this computer now: a drive that isn't connected, or a folder that was moved, renamed or deleted. The mods Vortex deployed are still in the game's Data folder. Vortex looks for its staging folder each time it starts and asks what to do when it can't find it.",
          fix: "Connect the drive, or in Vortex open Settings, then Mods, and point the staging folder at where the mods are now.",
          basis: "install",
        },
      ],
    };
  }

  const data = resolveCI(gameDir, "Data");
  const stagingDrive = drive(staging);
  const dataDrive = data === null ? null : drive(data);
  const sameDrive = stagingDrive !== null && dataDrive !== null ? stagingDrive === dataDrive : null;
  const words = method === null ? null : (METHOD_WORDS[method] ?? null);
  const found = { staging, recorded: true, method, skipped: [] as string[] };

  if (method !== "hardlink_activator") {
    return {
      ...found,
      findings: [
        {
          id: "setup.vortex-staging",
          area: "setup",
          status: "note",
          title: `Vortex deploys this game's mods with ${words ?? "a method ModWrench doesn't know"}`,
          detail:
            (method === null ? "Vortex's deployment record doesn't name a method ModWrench can read. " : `Vortex's deployment record names its method as "${method}". `) +
            "ModWrench checks the same-drive rule only for hard links, which is how Vortex deploys to this game when the staging folder is on the game's drive.",
          basis: "install",
          source: VORTEX_DEPLOYMENT,
        },
      ],
    };
  }
  if (sameDrive === false) {
    return {
      ...found,
      findings: [
        {
          id: "setup.vortex-staging",
          area: "setup",
          status: "problem",
          title: "Vortex's staging folder is on another drive from the game",
          detail:
            "Vortex deploys this game's mods with hard links, and its wiki says the staging folder must be on the same drive as the game's mods folder (its own check says hard links work \"only if mods are installed on the same drive as the game\"). " +
            "Its deployment record says it used hard links, but the staging folder and the game's Data folder are on different drives now, so it can't deploy with hard links again until they share one.",
          fix: "In Vortex, open Settings, then Mods, and move the staging folder to a folder on the game's drive. Vortex moves the mods there for you.",
          basis: "rule",
          source: VORTEX_DEPLOYMENT,
        },
      ],
    };
  }
  if (sameDrive === null) {
    return {
      ...found,
      skipped: ["the drive of Vortex's staging folder or the game's Data folder couldn't be read"],
      findings: [],
    };
  }
  return {
    ...found,
    findings: [
      {
        id: "setup.vortex-staging",
        area: "setup",
        status: "ok",
        title: "Vortex's staging folder is on the game's drive",
        detail: "Vortex deploys this game's mods with hard links, which need the staging folder on the same drive as the game's mods folder, and it is.",
        basis: "rule",
        source: VORTEX_DEPLOYMENT,
      },
    ],
  };
}
