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

/** The deployment methods Vortex ships, by their ids (its hardlink, symlink and move activator extensions). Only these are named back. */
const METHOD_WORDS: ReadonlyMap<string, string> = new Map([
  ["hardlink_activator", "hard links"],
  ["symlink_activator", "symbolic links"],
  ["symlink_activator_elevated", "symbolic links"],
  ["move_activator", "its move method"],
]);

export type VortexRecord =
  | { state: "none" }
  | { state: "unreadable" }
  | {
      state: "read";
      gameId: string | null;
      /** One of Vortex's method ids, or null. */
      deployMethod: string | null;
      /** The record names a method that isn't one of those. What it says isn't kept. */
      otherMethod: boolean;
      staging: string | null;
    };

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
  // Only what comes before the file list is the record's own: any of the list the read took in is cut off before a field is looked for.
  const cut = head.search(/"files"\s*:/);
  const top = cut >= 0 ? head.slice(0, cut) : head;
  // A method is named back only when it is one of Vortex's own ids; any other text in that field isn't repeated.
  const method = field(top, "deploymentMethod");
  const known = method !== null && METHOD_WORDS.has(method);
  return { state: "read", gameId: field(top, "gameId"), deployMethod: known ? method : null, otherMethod: method !== null && !known, staging: field(top, "stagingPath") };
}

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
  /**
   * What the Data folder held: no record, one that couldn't be opened, one that doesn't name this game, one that
   * doesn't name a staging folder, or one that does.
   */
  record: "none" | "unreadable" | "other-game" | "no-staging" | "named";
  deployMethod: string | null;
  /** What couldn't be read, in words, for the report's limits. */
  skipped: string[];
};

/** Read Vortex's record for this game and judge its staging folder. `drive` is how a folder's drive is told; tests hand in their own. */
export function checkVortex(gameDir: string, vortexGameId: string, drive: (path: string) => number | null = driveOf): VortexCheck {
  const none: VortexCheck = { findings: [], staging: null, recorded: false, record: "none", deployMethod: null, skipped: [] };
  const record = readVortexRecord(gameDir);
  if (record.state === "none") return none;
  if (record.state === "unreadable") {
    return {
      ...none,
      record: "unreadable",
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
  if (record.gameId !== vortexGameId) return { ...none, record: "other-game" };
  const method = record.deployMethod;
  if (record.staging === null) {
    return {
      ...none,
      record: "no-staging",
      recorded: false,
      deployMethod: method,
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
      record: "named",
      recorded: true,
      deployMethod: method,
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
      record: "named",
      recorded: true,
      deployMethod: method,
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
  const words = method === null ? null : (METHOD_WORDS.get(method) ?? null);
  const found = { staging, recorded: true, record: "named" as const, deployMethod: method, skipped: [] as string[] };

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
            (method !== null
              ? `Vortex's deployment record names its method as "${method}". `
              : record.otherMethod
                ? "Vortex's deployment record names a method ModWrench doesn't know (it knows hard links, symbolic links, symbolic links run as administrator, and moving the files), so it isn't repeated here. "
                : "Vortex's deployment record doesn't name a method. ") +
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
