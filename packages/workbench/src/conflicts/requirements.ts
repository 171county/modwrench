import { lstatSync, type Stats } from "node:fs";
import { join } from "node:path";
import { findGameById } from "../detect/games.js";
import { detectOs } from "../detect/os.js";
import { Budget, resolveCI } from "../doctor/fsutil.js";
import { PLUGIN_GAMES } from "../doctor/games.js";
import { discoverMo2 } from "../doctor/mo2facts.js";
import { readCreationClubList, readPluginListFile, type ListEntry } from "../doctor/plugins.js";
import { buildIndex, readGamePluginList } from "../doctor/setup-plugins.js";
import { discoverSteam } from "../doctor/steam.js";
import type { DoctorPlatform } from "../doctor/types.js";
import { mo2GamePath } from "../loadorder/mo2.js";
import { clean } from "../patchday/summary.js";
import type { LootFacts, Truth } from "./condition.js";
import { matchesPlugin } from "./index.js";
import { fetchLootMasterlist, type LootIncEntry } from "./loot.js";

// ─── LOOT's requirements, checked against the install ────────────────────────
// LOOT's masterlist says, for some plugins, which files they need (req): a plugin
// ("SkyUI_SE.esp"), a DLL below the Data folder ("SKSE/Plugins/x.dll"), or a file in
// the game's folder ("../skse64_loader.exe"). mw_loot_requirements fetches the list the
// way the conflict tools do, reads the active plugins the way the Doctors do, and says
// of each requirement of an active plugin whether its file is there, missing or unknown.
//
// The path is the masterlist's, which is text fetched from the internet, so it decides
// nothing about where ModWrench looks. A path is looked for only when allowedPlace
// permits it, and only below the game's own folders: the Data folder, or directly in the
// game's folder for a single leading "../". For Mod Organizer 2, whose mods reach the
// game only through its virtual file system, Data's files are looked for in each enabled
// mod's folder and Overwrite as well. Looking is lstat, one name at a time, so a link or
// junction is never followed: one on the way makes the answer unknown, and nothing
// beyond it is touched. No file is opened, read or written, and no program is started.
//
// "Missing" is said only when not finding the file proves it isn't there: every folder
// that could hold it was looked in, nothing on the way was a link or couldn't be opened,
// and the file system matches names whatever their capitals (Windows), since mods don't
// agree on "SKSE" or "skse". Anything short of that is unknown, with the reason.

// The file endings LOOT's requirements use. In its v0.29 lists for all seven games the
// 1,593 req entries end in .esp (774), .dll (452), .exe (268), .esm (77), .esl (8),
// .txt (7), .ini (3), .dds (2), .bsa (1) and .hlsli (1). .ba2 is the archive Fallout 4
// and Starfield use where the older games use .bsa. A path with any other ending isn't
// looked for. The longest of those paths is 67 characters and the deepest has four names.
const ENDINGS = /\.(?:esp|esm|esl|dll|exe|bsa|ba2|ini|txt|dds|hlsli)$/i;
const PLUGIN = /\.(?:esp|esm|esl)$/i;
const MAX_LENGTH = 260;
const MAX_NAMES = 8;
// Windows opens a device, not a file, for these names, whatever ending follows (NUL.dll, COM1.txt).
const DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(?:\.|$)/i;

/** Where a path LOOT names may be looked for: names below the Data folder, or one name in the game's folder. */
export type Place = { from: "data" | "game"; names: string[] };

/**
 * The allow-list: where a path LOOT names may be looked for, or null when it may not. Allowed: names joined by "/",
 * staying in the Data folder, or one leading "../" and then a single file name, for the game's folder. Refused: a path
 * from a root ("/x"), a drive or a stream (any ":"), a backslash (so "\\server\share" and "C:\x"), any other "..", a
 * "." or empty name, a name Windows would trim (one ending in a dot or a space), a device name, a control character
 * (NUL included), a character Windows doesn't allow in a name (* ? " < > |), more than 8 names or 260 characters, and
 * an ending LOOT's requirements don't use.
 */
export function allowedPlace(path: string): Place | null {
  if (path.length > MAX_LENGTH || !ENDINGS.test(path) || /[\\:*?"<>|\p{Cc}]/u.test(path)) return null;
  const names = path.split("/");
  let from: Place["from"] = "data";
  if (names[0] === "..") {
    names.shift();
    if (names.length !== 1) return null;
    from = "game";
  }
  if (names.length > MAX_NAMES) return null;
  // A name ending in a dot is also how "." and ".." are refused.
  for (const name of names) if (name === "" || /[. ]$/.test(name) || DEVICE.test(name)) return null;
  return { from, names };
}

type Look = "there" | "absent" | "link" | "not-a-file" | "unreadable";

/** What is at `names` below `base`, found with lstat one name at a time, so that no link or junction is followed. */
function look(base: string, names: readonly string[]): Look {
  let path = base;
  for (const [i, name] of names.entries()) {
    path = join(path, name);
    let stat: Stats;
    try {
      stat = lstatSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOENT" || code === "ENOTDIR" ? "absent" : "unreadable";
    }
    if (stat.isSymbolicLink()) return "link";
    if (i === names.length - 1) return stat.isFile() ? "there" : "not-a-file";
    if (!stat.isDirectory()) return "absent";
  }
  return "absent";
}

export type RequirementStatus = "present" | "missing" | "unknown";

export type Requirement = {
  /** The active plugin LOOT's record is about, as the plugin list names it. */
  plugin: string;
  /** The file it needs, as LOOT names it. */
  file: string;
  /** LOOT's name for the file and its note, in English, as plain text. */
  display?: string;
  detail?: string;
  status: RequirementStatus;
  /** Why it is missing or unknown, in words. */
  why?: string;
  /** LOOT's condition or constraint, quoted, when it is why the answer is unknown. */
  condition?: string;
};

type Answer = { status: RequirementStatus; why?: string };

const NOT_ALLOWED =
  "ModWrench looks only for a file below the game's Data folder, or directly in the game's folder, with an ending LOOT's requirements use, and LOOT's path isn't one of those, so it wasn't looked for";
const LOOK_WORDS: Record<Exclude<Look, "there" | "absent">, string> = {
  link: "a link or junction is on the way to it, and links aren't followed, since one can lead out of the game's folders",
  "not-a-file": "something by that name is there, but it isn't a plain file",
  unreadable: "a folder on the way couldn't be opened",
};
const CAPITALS = "it isn't there as LOOT spells it, and on this system names that differ only in capital letters are different files, so it may be there under other capitals";
const TIME = "the time allowed ran out before it was looked for";

/** Where Data's files and the game folder's files can come from, and why not finding one there may not prove it missing. */
type Install = {
  game: string;
  /** The folders whose files the game sees in Data, each as a folder and the names below it that lead there. */
  data: Array<{ base: string; lead: string[] }>;
  /** Where a file missing from Data was looked for, in words. */
  dataWhere: string;
  /** Why a file not found in `data` may still be there for the game, or null when not finding it proves it isn't. */
  dataGap: string | null;
  /** The same for the game's folder. */
  gameGap: string | null;
  /** Names are matched whatever their capitals. */
  ignoresCase: boolean;
  /** Lower-case names of the active plugins, whose files are there. */
  active: Set<string>;
};

/** Whether a file LOOT names is there for the game. */
function locate(file: string, install: Install): Answer {
  if (install.active.has(file.toLowerCase())) return { status: "present" };
  const place = allowedPlace(file);
  if (place === null) return { status: "unknown", why: NOT_ALLOWED };
  const folders = place.from === "game" ? [{ base: install.game, lead: [] }] : install.data;
  // LOOT counts a plugin Wrye Bash has hidden by adding .ghost to its name as there.
  const last = place.names[place.names.length - 1]!;
  const spellings = PLUGIN.test(last) ? [place.names, [...place.names.slice(0, -1), `${last}.ghost`]] : [place.names];
  let problem: string | null = null;
  for (const folder of folders) {
    for (const names of spellings) {
      const seen = look(folder.base, [...folder.lead, ...names]);
      if (seen === "there") return { status: "present" };
      if (seen !== "absent") problem ??= LOOK_WORDS[seen];
    }
  }
  const gap = problem ?? (place.from === "game" ? install.gameGap : install.dataGap) ?? (install.ignoresCase ? null : CAPITALS);
  if (gap !== null) return { status: "unknown", why: gap };
  return { status: "missing", why: place.from === "game" ? "it isn't in the game's folder" : install.dataWhere };
}

// ─── The install ─────────────────────────────────────────────────────────────

export type RequirementsOptions = {
  gameId: string;
  profileName?: string;
  /** For tests, as in the Doctors' options: the MO2 instance folder, where MO2's own instance list isn't. */
  mo2InstancePath?: string;
  /** Which system's places to read. Default this one's. Only on Windows do names match whatever their capitals. */
  platform?: DoctorPlatform;
  /** For tests: the time allowed for reading folders and looking for files. Default 8 seconds. */
  budgetMs?: number;
};

export type RequirementsReport = {
  ok: true;
  game: string;
  /** How the active plugins were read: "Mod Organizer 2" or "the game's own plugins.txt". */
  from: string;
  /** The MO2 profile, when MO2 was read. */
  profile?: string;
  activePlugins: number;
  masterlist: { branch: string } | { failed: string };
  requirements: Requirement[];
  limits: string[];
};

export type RequirementsResult = RequirementsReport | { ok: false; reason: string };

const fail = (reason: string): RequirementsResult => ({ ok: false, reason });

/** A plain folder name from modlist.txt, safe to put below the mods folder: no separator, ":", control character, "." or "..". */
const plainName = (name: string): boolean => name !== "." && name !== ".." && !/[\\/:\p{Cc}]/u.test(name);

const ODD_MOD = "a mod the profile switches on has a name that isn't a plain folder name, so its folder wasn't looked in";

const PLUGIN_GAME_IDS = Object.keys(PLUGIN_GAMES);

export async function checkLootRequirements(options: RequirementsOptions): Promise<RequirementsResult> {
  const def = findGameById(options.gameId);
  const game = PLUGIN_GAMES[options.gameId];
  if (def === undefined || game === undefined) {
    return fail(`mw_loot_requirements reads the plugin list of ${PLUGIN_GAME_IDS.join(" and ")} only, so it can't check "${clean(options.gameId, 70)}".`);
  }
  const platform = options.platform ?? detectOs();
  const budget = new Budget(options.budgetMs ?? 8000);

  // Where the game is, and whether Mod Organizer 2 plays it: the Doctors' own readers.
  const steam = discoverSteam(platform, def.steamAppId);
  const libraries = steam.chosen?.libraries ?? [];
  const mo2 = discoverMo2(def, libraries, {
    ...(options.mo2InstancePath !== undefined ? { mo2InstancePath: options.mo2InstancePath } : {}),
    ...(options.profileName !== undefined ? { profileName: options.profileName } : {}),
  });
  const asked = options.profileName !== undefined || options.mo2InstancePath !== undefined;
  if (mo2.missed === true || (asked && !mo2.used)) {
    return fail(`Mod Organizer 2 couldn't be read: ${mo2.reason}. Without its profile, the plugins it switches on and the mods they come from aren't known, so nothing was checked.`);
  }
  // MO2 plays the game folder its settings name, which can be a copy beside the instance rather than Steam's.
  const played = mo2.used ? mo2GamePath(mo2.instance!) : null;
  const gameDir = played ?? steam.app?.installDir ?? null;
  if (gameDir === null) {
    return fail(
      `${def.displayName} wasn't found in a Steam library${steam.installs.length === 0 ? " (no Steam install was found)" : ""}, so there is no install to check. A copy from another store isn't looked for.`
    );
  }

  // The active plugins: the game's own and Creation Club files that are there, and the switched-on entries of the
  // plugin list whose files were found, as the Setup Doctor works them out.
  const index = buildIndex(gameDir, mo2, budget, game);
  let list: ListEntry[] | null | "unreadable";
  if (mo2.used) {
    const file = mo2.profileDir !== undefined ? resolveCI(mo2.profileDir, "plugins.txt") : null;
    list = file === null ? null : readPluginListFile(file);
  } else {
    list = readGamePluginList(platform, libraries, def.steamAppId, gameDir, game);
  }
  if (list === null || list === "unreadable") {
    return fail(
      list === null
        ? "There is no plugin list (plugins.txt) to read yet, so which plugins are active isn't known and nothing was checked."
        : "The plugin list (plugins.txt) is there but couldn't be opened, so which plugins are active isn't known and nothing was checked."
    );
  }
  const ccc = readCreationClubList(gameDir, game.ccc);
  const active: string[] = [];
  const seen = new Set<string>();
  const add = (name: string): void => {
    const lower = name.toLowerCase();
    if (seen.has(lower) || !index.plugins.has(lower)) return;
    seen.add(lower);
    active.push(name);
  };
  for (const name of [...game.base, ...(ccc === "unreadable" ? [] : ccc)]) add(name);
  for (const entry of list) if (entry.enabled) add(entry.name);

  // Where Data's files come from, and what keeps not finding one from proving it missing.
  const data: Install["data"] = [{ base: gameDir, lead: ["Data"] }];
  const dataGaps: string[] = [];
  let gameGap: string | null = null;
  if (mo2.used) {
    if (played === null) dataGaps.push("Mod Organizer 2's settings don't name the game folder it plays in a way ModWrench can follow, so Steam's copy was looked in, and MO2 may play another");
    if (!mo2.modsDir) dataGaps.push("Mod Organizer 2's mods folder wasn't found");
    else {
      for (const folder of mo2.folders ?? []) {
        if (!folder.enabled) continue;
        if (plainName(folder.name)) data.push({ base: mo2.modsDir, lead: [folder.name] });
        else if (!dataGaps.includes(ODD_MOD)) dataGaps.push(ODD_MOD);
      }
    }
    if (mo2.overwriteDir) data.push({ base: mo2.overwriteDir, lead: [] });
    else dataGaps.push("Mod Organizer 2's Overwrite folder wasn't found");
    gameGap =
      "it isn't in the game's folder, but with Mod Organizer 2 a mod can put files there only while the game runs (MO2's Root Builder plugin does), so that doesn't prove it's missing";
  }
  const install: Install = {
    game: gameDir,
    data,
    dataWhere: mo2.used ? "it isn't in the game's Data folder, any enabled mod's folder or Overwrite" : "it isn't in the game's Data folder",
    dataGap: dataGaps.length > 0 ? dataGaps.join("; ") : null,
    gameGap,
    ignoresCase: platform === "windows",
    active: seen,
  };

  const masterlist = await fetchLootMasterlist(def.gameId);
  const limits = LIMITS(mo2.used);
  const report: RequirementsReport = {
    ok: true,
    game: def.displayName,
    from: mo2.used ? "Mod Organizer 2" : "the game's own plugins.txt",
    ...(mo2.profile !== undefined ? { profile: mo2.profile } : {}),
    activePlugins: active.length,
    masterlist: "failed" in masterlist ? { failed: masterlist.failed } : { branch: masterlist.branch },
    requirements: [],
    limits,
  };
  if ("failed" in masterlist) return report;

  // Each file is looked for once, however many requirements and conditions name it.
  const answers = new Map<string, Answer>();
  const find = (file: string): Answer => {
    let answer = answers.get(file);
    if (answer === undefined) {
      answer = budget.expired() ? { status: "unknown", why: TIME } : locate(file, install);
      answers.set(file, answer);
    }
    return answer;
  };
  const truth = (a: Answer): Truth => (a.status === "present" ? true : a.status === "missing" ? false : "unknown");
  const facts: LootFacts = {
    active,
    allActive: index.complete && ccc !== "unreadable",
    exists: (path) => truth(find(path)),
  };

  const done = new Set<string>();
  for (const plugin of active) {
    for (const rule of masterlist.rules) {
      if (!matchesPlugin(rule, plugin)) continue;
      for (const req of rule.req) {
        const key = `${plugin.toLowerCase()}\n${req.plugin.toLowerCase()}`;
        if (done.has(key)) continue;
        const applies = req.when ? req.when(facts) : true;
        if (applies === false) continue;
        done.add(key);
        report.requirements.push({ plugin, file: req.plugin, ...lootText(req), ...judge(req, applies, find, facts) });
      }
    }
  }
  return report;
}

function lootText(req: LootIncEntry): Pick<Requirement, "display" | "detail"> {
  return { ...(req.display ? { display: req.display } : {}), ...(req.detail ? { detail: req.detail } : {}) };
}

/** One requirement's answer: its condition first, then the file, then LOOT's constraint on the file. */
function judge(req: LootIncEntry, applies: Truth, find: (file: string) => Answer, facts: LootFacts): Pick<Requirement, "status" | "why" | "condition"> {
  if (applies === "unknown") {
    return { status: "unknown", why: "LOOT applies it only under a condition ModWrench can't answer", condition: req.condition! };
  }
  const found = find(req.plugin);
  if (found.status !== "present" || !req.must) return found;
  const holds = req.must(facts);
  if (holds === true) return found;
  return holds === false
    ? { status: "missing", why: "it is there, but LOOT counts it only when its constraint holds, and it doesn't", condition: req.constraint! }
    : { status: "unknown", why: "it is there, but LOOT counts it only when its constraint holds, and ModWrench can't tell whether it does", condition: req.constraint! };
}

const LIMITS = (mo2: boolean): string[] => [
  "These are LOOT's records, from LOOT's public masterlist, not ModWrench's own rules. A requirement LOOT doesn't list isn't checked.",
  "Only whether a file is there was looked at, by its name. No file was opened, so a wrong version or a damaged file reads as present.",
  "Only the active plugins' requirements are checked: those the game loads without listing and the switched-on plugins whose files were found.",
  mo2
    ? "Mod Organizer 2's virtual file system exists only while MO2 runs, so the game's Data folder, each enabled mod's folder and Overwrite were looked in instead."
    : "The game's own Data folder was looked in, as Vortex and hand installs put mods there. A portable Mod Organizer 2 instance (such as a Wabbajack list's) isn't looked for on its own: if you play through one, run this again with its folder as mo2InstancePath, since what it supplies isn't in Data.",
];

// ─── The answer ──────────────────────────────────────────────────────────────

const SHOWN = 100;
const ORDER: RequirementStatus[] = ["missing", "unknown", "present"];

/** A name from the player's own files, safe to put in text. */
const nm = (value: string): string => clean(value, 70);

export function summarizeRequirements(result: RequirementsResult): string {
  if (!result.ok) return result.reason;
  const lines: string[] = [];
  const where = result.from === "Mod Organizer 2" ? `Mod Organizer 2's profile ${nm(result.profile ?? "")}` : result.from;
  lines.push(`LOOT's requirements for the ${result.activePlugins} active plugins of ${result.game}, read from ${where}.`);
  if ("failed" in result.masterlist) {
    lines.push(`${result.masterlist.failed} So no requirement was checked.`);
    return lines.join("\n");
  }
  const reqs = result.requirements;
  if (reqs.length === 0) {
    lines.push("LOOT's masterlist lists no requirement for them that applies.");
  } else {
    const count = (s: RequirementStatus): number => reqs.filter((r) => r.status === s).length;
    lines.push(
      `${count("missing")} missing, ${count("unknown")} unknown, ${count("present")} present. ` +
        "Each line is LOOT's record of a file a plugin needs. LOOT calls a missing requirement an error; here it is a warning, to check, not a verdict."
    );
    const sorted = [...reqs].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
    for (const r of sorted.slice(0, SHOWN)) {
      const label = r.status === "missing" ? "Warning, missing" : r.status === "unknown" ? "Unknown" : "Present";
      let line = `- ${label}: LOOT says ${nm(r.plugin)} needs ${clean(r.file, 300)}`;
      if (r.display) line += ` ("${r.display}")`;
      if (r.why) line += `. ${r.why.charAt(0).toUpperCase()}${r.why.slice(1)}`;
      if (r.condition) line += `: \`${r.condition}\``;
      line += ".";
      if (r.detail) line += ` LOOT's note: "${r.detail}"`;
      lines.push(line);
    }
    if (sorted.length > SHOWN) lines.push(`- and ${sorted.length - SHOWN} more, not listed.`);
  }
  lines.push("What this can't tell you:", ...result.limits.map((l) => `- ${l}`));
  return lines.join("\n");
}
