import { homedir } from "node:os";
import { join } from "node:path";
import { clean } from "../patchday/summary.js";
import { Budget, listDir, resolveCI } from "./fsutil.js";
import type { Mo2Facts } from "./mo2facts.js";
import {
  SKYRIM_BASE_PLUGINS,
  isLight,
  isProblem,
  readCreationClubList,
  readPluginHeader,
  readPluginListFile,
  type HeaderProblemKind,
  type ListEntry,
  type PluginHeader,
} from "./plugins.js";
import type { DoctorFinding, DoctorPlatform, DoctorReport } from "./types.js";

// ─── The plugin list ─────────────────────────────────────────────────────────
// Skyrim loads the plugins in plugins.txt, in that order, after its own files and
// the Creation Club files. A handful of facts about that list explain a great many
// crashes: more plugins than the game can hold, a plugin whose master isn't there,
// is switched off, or loads after it, and files that aren't plugins at all.
//
// This works out what the game would load from files alone. For a Mod Organizer 2
// user that means the profile's list and the plugin files in the enabled mod folders
// and Overwrite on top of the game's Data folder; for everyone else, the game's own
// plugins.txt and the Data folder. It opens each plugin only far enough to read its
// header. It writes nothing.

export const FULL_LIMIT = 254;
export const LIGHT_LIMIT = 4096;

const LIMIT_SOURCE = "https://dyndolod.info/Messages/Plugin-Limit";
const LOAD_ORDER_SOURCE = "https://loot.readthedocs.io/en/latest/app/sorting.html";

type Found = { abs: string; source: string };

/** Everything the game would find: plugin files and the pieces other checks look for. */
export type Index = {
  /** Lower-case file name to the file that wins. */
  plugins: Map<string, Found>;
  /** Lower-case names of the DLLs in SKSE's Plugins folders. */
  skseDlls: Set<string>;
  /** NetScriptFramework's runtime is installed. */
  netScript: boolean;
  /** Enabled MO2 mods whose folder wasn't there. */
  missingMods: string[];
  /** The whole picture was read: nothing was skipped for want of a folder or for time. */
  complete: boolean;
};

function addRoot(dir: string, source: string, index: Index): void {
  for (const name of listDir(dir)) {
    const lower = name.toLowerCase();
    if (/\.(?:esp|esm|esl)$/.test(lower)) {
      index.plugins.set(lower, { abs: join(dir, name), source });
    } else if (lower === "skse") {
      const plugins = resolveCI(dir, name, "Plugins");
      if (plugins !== null) {
        for (const file of listDir(plugins)) if (/\.dll$/i.test(file)) index.skseDlls.add(file.toLowerCase());
      }
    } else if (lower === "dllplugins") {
      if (resolveCI(dir, name, "NetScriptFramework.Runtime.dll") !== null) index.netScript = true;
    }
  }
}

export function buildIndex(gameDir: string, mo2: Mo2Facts, budget: Budget): Index {
  const index: Index = { plugins: new Map(), skseDlls: new Set(), netScript: false, missingMods: [], complete: true };
  const data = resolveCI(gameDir, "Data");
  if (data !== null) addRoot(data, "game folder", index);
  if (mo2.used) {
    if (mo2.modsDir === null || mo2.modsDir === undefined) {
      index.complete = false;
    } else {
      for (const folder of mo2.folders ?? []) {
        if (!folder.enabled) continue;
        if (budget.expired()) {
          index.complete = false;
          break;
        }
        const dir = resolveCI(mo2.modsDir, folder.name);
        if (dir === null) index.missingMods.push(folder.name);
        else addRoot(dir, `mo2:${folder.name}`, index);
      }
    }
    if (mo2.overwriteDir) addRoot(mo2.overwriteDir, "mo2:overwrite", index);
  }
  return index;
}

// ─── The game's own plugins.txt ──────────────────────────────────────────────

const DOCUMENT_FOLDERS = ["Skyrim Special Edition", "Skyrim Special Edition GOG", "Skyrim Special Edition EPIC"];

/** Where Skyrim keeps plugins.txt: the Windows profile, or, under Proton, the game's prefix. */
export function readGamePluginList(platform: DoctorPlatform, libraries: readonly string[], appId: string): ListEntry[] | null {
  const bases: string[] = [];
  if (platform === "windows") {
    bases.push(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"));
  } else if (platform === "linux") {
    for (const lib of libraries) {
      bases.push(join(lib, "compatdata", appId, "pfx", "drive_c", "users", "steamuser", "AppData", "Local"));
    }
  }
  for (const base of bases) {
    for (const folder of DOCUMENT_FOLDERS) {
      const file = resolveCI(base, folder, "Plugins.txt");
      if (file === null) continue;
      const list = readPluginListFile(file);
      if (list !== null) return list;
    }
  }
  return null;
}

// ─── One row per plugin the game would load ──────────────────────────────────

type Row = {
  name: string;
  lower: string;
  /** Loads without being listed: the game's own files and the Creation Club. */
  implicit: boolean;
  /** The file was found. */
  found: boolean;
  header: PluginHeader | null;
  problem: HeaderProblemKind | null;
};

const PROBLEM_WORDS: Record<HeaderProblemKind, string> = {
  empty: "an empty file",
  "not-a-plugin": "not a plugin file",
  truncated: "cut short",
  "too-large": "has an unusually large header",
  unreadable: "couldn't be opened",
};

/** A name from the player's own files, safe to put in text. */
const nm = (value: string): string => clean(value, 70);

export function limitFinding(full: number, light: number, implicit: number): DoctorFinding {
  const counts = `${full} of ${FULL_LIMIT} full plugins and ${light} of ${LIGHT_LIMIT} light plugins are switched on, counting the ${implicit} game and Creation Club files that load without being listed.`;
  const rule = `Skyrim can load ${FULL_LIMIT} full plugins and ${LIGHT_LIMIT} light ones; a light plugin is one flagged ESL or named .esl.`;
  if (full > FULL_LIMIT || light > LIGHT_LIMIT) {
    return {
      id: "setup.plugin-limit",
      area: "setup",
      status: "problem",
      title: "Over Skyrim's plugin limit",
      detail: `${counts} ${rule} The game can't load more than that.`,
      fix: "Switch off or remove plugins until you are under the limit. Merging plugins, or flagging small ones as light, are the usual ways to make room.",
      basis: "rule",
      source: LIMIT_SOURCE,
    };
  }
  if (full >= FULL_LIMIT - 14 || light >= LIGHT_LIMIT - 96) {
    return {
      id: "setup.plugin-limit",
      area: "setup",
      status: "warn",
      title: "Close to Skyrim's plugin limit",
      detail: `${counts} ${rule}`,
      fix: "Leave yourself some room before adding more: the next few plugins will hit the limit.",
      basis: "rule",
      source: LIMIT_SOURCE,
    };
  }
  return {
    id: "setup.plugin-limit",
    area: "setup",
    status: "ok",
    title: "Plugin count is within Skyrim's limits",
    detail: counts,
    basis: "rule",
    source: LIMIT_SOURCE,
  };
}

/** How the plugin sorts: master-flagged files load before the rest. Files named like masters but not flagged are left alone. */
function orderClass(row: Row): "flagged" | "plain" | "unsure" {
  if (row.header === null) return "unsure";
  if (row.header.master) return "flagged";
  return /\.(?:esm|esl)$/i.test(row.name) ? "unsure" : "plain";
}

type Need = { plugin: string; master: string };

function cap<T>(list: readonly T[], max: number): { shown: T[]; more: number } {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

function masterFindings(rows: readonly Row[], index: Index, withMods: boolean): DoctorFinding[] {
  const position = new Map<string, number>();
  rows.forEach((r, i) => position.set(r.lower, i));
  const byName = new Map(rows.map((r) => [r.lower, r] as const));

  const missing: Need[] = [];
  const off: Need[] = [];
  const late: Need[] = [];
  for (const row of rows) {
    if (row.implicit || row.header === null) continue;
    for (const master of row.header.masters) {
      const lower = master.toLowerCase();
      if (lower === row.lower) continue;
      const target = byName.get(lower);
      if (target === undefined || !target.found) {
        // Installed somewhere but not switched on, or not installed at all.
        if (target === undefined && index.plugins.has(lower)) off.push({ plugin: row.name, master });
        else missing.push({ plugin: row.name, master });
        continue;
      }
      const a = orderClass(row);
      const b = orderClass(target);
      if (a === b && a !== "unsure" && position.get(lower)! > position.get(row.lower)!) late.push({ plugin: row.name, master });
    }
  }

  const out: DoctorFinding[] = [];
  const asItems = (needs: Need[]) => cap(needs.map((n) => `${nm(n.plugin)} needs ${nm(n.master)}`), 8);
  const affected = (needs: Need[]) => new Set(needs.map((n) => n.plugin)).size;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (missing.length > 0) {
    const shown = asItems(missing);
    const lostMasters = new Set(missing.map((n) => n.master.toLowerCase())).size;
    const hedge = index.complete ? "" : " Some mod folders couldn't be read, so a master may be in one of them.";
    out.push({
      id: "setup.masters-missing",
      area: "setup",
      status: index.complete ? "problem" : "warn",
      title: "Plugins whose masters aren't installed",
      detail:
        `${plural(affected(missing), "switched-on plugin needs", "switched-on plugins need")} ${plural(lostMasters, "file", "files")} ` +
        `${lostMasters === 1 ? "that isn't" : "that aren't"} in the game folder${withMods ? " or any enabled mod" : ""}. A plugin whose master is missing is likely to crash the game, on launch or later.${hedge}`,
      fix: "Install the missing master, or switch off the plugin that needs it. LOOT also lists missing masters.",
      basis: "install",
      source: LOAD_ORDER_SOURCE,
      items: shown.shown,
      ...(shown.more > 0 ? { more: shown.more } : {}),
    });
  }
  if (off.length > 0) {
    const shown = asItems(off);
    out.push({
      id: "setup.masters-off",
      area: "setup",
      status: "problem",
      title: "Plugins whose masters are switched off",
      detail:
        `${plural(affected(off), "plugin needs", "plugins need")} a master that is installed but isn't switched on in your list. ` +
        "A plugin loaded without its master is likely to crash the game, on launch or later.",
      fix: "Switch the master on, or switch off the plugin that needs it.",
      basis: "install",
      source: LOAD_ORDER_SOURCE,
      items: shown.shown,
      ...(shown.more > 0 ? { more: shown.more } : {}),
    });
  }
  if (late.length > 0) {
    const shown = asItems(late);
    out.push({
      id: "setup.masters-late",
      area: "setup",
      status: "problem",
      title: "Masters that load after the plugin that needs them",
      detail:
        `${plural(affected(late), "plugin is", "plugins are")} listed before ${plural(new Set(late.map((n) => n.master.toLowerCase())).size, "master", "masters")} it needs. ` +
        "A master has to load first, and the game is likely to crash when it doesn't.",
      fix: "Sort the load order. LOOT does this, and in Mod Organizer 2 it can be run from inside MO2.",
      basis: "install",
      source: LOAD_ORDER_SOURCE,
      items: shown.shown,
      ...(shown.more > 0 ? { more: shown.more } : {}),
    });
  }
  return out;
}

export type PluginCheck = {
  findings: DoctorFinding[];
  plugins?: NonNullable<DoctorReport["looked"]["plugins"]>;
  index: Index;
};

export type PluginCheckInput = {
  gameDir: string;
  platform: DoctorPlatform;
  mo2: Mo2Facts;
  libraries: readonly string[];
  appId: string;
  budget: Budget;
};

const enabledNames = (list: readonly ListEntry[]): Set<string> => new Set(list.filter((e) => e.enabled).map((e) => e.name.toLowerCase()));

export function checkPlugins(input: PluginCheckInput): PluginCheck {
  const { gameDir, platform, mo2, libraries, appId, budget } = input;
  const index = buildIndex(gameDir, mo2, budget);
  const findings: DoctorFinding[] = [];

  const gameList = readGamePluginList(platform, libraries, appId);
  let list: ListEntry[] | null = gameList;
  if (mo2.used && mo2.profileDir !== undefined) {
    const file = resolveCI(mo2.profileDir, "plugins.txt");
    list = file === null ? null : readPluginListFile(file);
  }
  if (list === null) {
    findings.push({
      id: "setup.plugin-list",
      area: "setup",
      status: "note",
      title: "No plugin list found",
      detail: "There is no plugins.txt to read yet. Skyrim creates it the first time the launcher or a mod manager runs, so there is nothing to check for limits or masters.",
      basis: "install",
    });
    return { findings, index };
  }

  const implicitNames = [...new Set([...SKYRIM_BASE_PLUGINS, ...readCreationClubList(gameDir)])];
  const implicitLower = new Set(implicitNames.map((n) => n.toLowerCase()));

  const rows: Row[] = [];
  let unread = 0;
  const addRow = (name: string, implicit: boolean): void => {
    const lower = name.toLowerCase();
    const found = index.plugins.get(lower);
    const row: Row = { name, lower, implicit, found: found !== undefined, header: null, problem: null };
    if (found !== undefined) {
      if (budget.expired()) {
        unread++;
      } else {
        const header = readPluginHeader(found.abs);
        if (isProblem(header)) row.problem = header.problem;
        else row.header = header;
      }
    }
    rows.push(row);
  };
  for (const name of implicitNames) if (index.plugins.has(name.toLowerCase())) addRow(name, true);
  const seen = new Set<string>();
  for (const entry of list) {
    const lower = entry.name.toLowerCase();
    if (implicitLower.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    if (entry.enabled) addRow(entry.name, false);
  }

  const listed = rows.filter((r) => !r.implicit);
  const complete = index.complete && unread === 0;
  const looked = {
    listed: list.length,
    active: rows.length,
    read: rows.filter((r) => r.header !== null).length,
    unreadable: rows.filter((r) => r.problem !== null).length,
    complete,
  };

  // When most of what the list names isn't anywhere ModWrench looked, the likely reason is that the
  // mods live somewhere it didn't see, not that they are all missing. Say that instead of a wall of
  // problems that aren't real.
  const foundListed = listed.filter((r) => r.found).length;
  if (listed.length >= 5 && foundListed / listed.length < 0.5) {
    findings.push({
      id: "setup.plugin-list",
      area: "setup",
      status: "note",
      title: "Most of your plugins aren't where ModWrench looked",
      detail: mo2.used
        ? `Your list switches on ${listed.length} plugins, but only ${foundListed} are in the mod folders that were read. The mods folder may be set to somewhere else in MO2, or this may be the wrong profile.`
        : `Your list switches on ${listed.length} plugins, but only ${foundListed} are in the game's Data folder. That is how it looks when the mods live in a Mod Organizer 2 instance ModWrench didn't find.`,
      fix: mo2.used ? "Pass profileName for the profile you play, or check MO2's mods folder setting." : "If you use Mod Organizer 2, pass mo2InstancePath (the folder with ModOrganizer.ini) and run this again.",
      basis: "install",
    });
    return { findings, plugins: { ...looked, complete: false }, index };
  }

  const full = rows.filter((r) => r.header !== null && !isLight(r.name, r.header)).length;
  const light = rows.filter((r) => r.header !== null && isLight(r.name, r.header)).length;
  const implicitCount = rows.filter((r) => r.implicit).length;
  const located = rows.filter((r) => r.found).length;
  if (unread > 0 && full <= FULL_LIMIT && light <= LIGHT_LIMIT) {
    // Whether a plugin is light is in its header. With some headers unread the counts are only a floor,
    // and "within the limits" would claim more than was looked at. Over the limit already is still certain.
    findings.push({
      id: "setup.plugin-limit",
      area: "setup",
      status: "note",
      title: "Plugin count not fully checked",
      detail:
        `${unread === located ? `None of the ${located} switched-on plugins ModWrench found were opened` : `${unread} of the ${located} switched-on plugins ModWrench found weren't opened`} in the time allowed, ` +
        `and whether a plugin is full or light is in its header, so it can't say whether the list is within Skyrim's ${FULL_LIMIT} full and ${LIGHT_LIMIT} light limits.` +
        (unread === located
          ? ""
          : ` ${located - unread === 1 ? "The 1 it did open comes" : `The ${located - unread} it did open come`} to ${full} full and ${light} light, so the real totals are at least that.`),
      fix: "Run it again. If it keeps stopping short, the plugins or mod folders may be on a slow or network drive.",
      basis: "install",
      source: LIMIT_SOURCE,
    });
  } else {
    findings.push(limitFinding(full, light, implicitCount));
  }

  findings.push(...masterFindings(rows, index, mo2.used));
  if (findings.every((f) => !f.id.startsWith("setup.masters"))) {
    findings.push({
      id: "setup.masters",
      area: "setup",
      status: complete ? "ok" : "note",
      title: complete ? "Every master is installed, switched on and in order" : looked.read === 0 ? "Masters weren't checked" : "No master problems in what could be read",
      detail: complete
        ? `All ${looked.read} readable plugins have the masters they list, loaded before them.`
        : looked.read === 0
          ? "No plugin could be opened in the time allowed, so there was nothing to check the masters of."
          : "Some folders or plugins couldn't be read in the time allowed, so this isn't the whole list.",
      basis: "install",
      source: LOAD_ORDER_SOURCE,
    });
  }

  const broken = rows.filter((r) => r.problem !== null);
  if (broken.length > 0) {
    const shown = cap(broken.map((r) => `${nm(r.name)} (${PROBLEM_WORDS[r.problem!]})`), 8);
    findings.push({
      id: "setup.plugin-files",
      area: "setup",
      status: "warn",
      title: "Switched-on plugins that don't open as plugins",
      detail: "These files are in your list but don't start with a plugin header. A failed download or a damaged file looks like this, and the game can't load them.",
      fix: "Download or install the mod again, or switch the plugin off.",
      basis: "install",
      items: shown.shown,
      ...(shown.more > 0 ? { more: shown.more } : {}),
    });
  }

  const stale = listed.filter((r) => !r.found);
  if (index.complete && stale.length > 0) {
    const shown = cap(stale.map((r) => nm(r.name)), 8);
    findings.push({
      id: "setup.plugin-stale",
      area: "setup",
      status: "note",
      title: "Switched-on plugins whose files aren't there",
      detail:
        stale.length === 1
          ? "1 entry in your list points at a plugin file that isn't in the game folder or any enabled mod. The game skips it, so it is harmless, but the list is out of date."
          : `${stale.length} entries in your list point at plugin files that aren't in the game folder or any enabled mod. The game skips them, so they are harmless, but the list is out of date.`,
      fix: "They usually belong to mods that were removed. Mod Organizer 2 and Vortex clear them on a refresh.",
      basis: "install",
      items: shown.shown,
      ...(shown.more > 0 ? { more: shown.more } : {}),
    });
  }

  if (index.missingMods.length > 0) {
    const shown = cap(index.missingMods.map(nm), 6);
    findings.push({
      id: "setup.mods-missing",
      area: "setup",
      status: "note",
      title: "Enabled mods whose folders aren't there",
      detail:
        index.missingMods.length === 1
          ? "MO2's profile switches on 1 mod that has no folder in the mods folder, so none of its files load."
          : `MO2's profile switches on ${index.missingMods.length} mods that have no folder in the mods folder, so none of their files load.`,
      fix: "Reinstall them, or remove them from the list in MO2.",
      basis: "install",
      items: shown.shown,
      ...(shown.more > 0 ? { more: shown.more } : {}),
    });
  }

  if (mo2.used && gameList !== null && list !== gameList) {
    const mine = enabledNames(list);
    const theirs = enabledNames(gameList);
    const only = (a: Set<string>, b: Set<string>) => [...a].filter((n) => !b.has(n) && !implicitLower.has(n));
    const inMo2 = only(mine, theirs);
    const inGame = only(theirs, mine);
    if (inMo2.length + inGame.length > 0) {
      findings.push({
        id: "setup.plugin-drift",
        area: "setup",
        status: "note",
        title: "MO2's list and the game's own plugins.txt differ",
        detail:
          `${inMo2.length} ${inMo2.length === 1 ? "plugin is" : "plugins are"} switched on only in MO2's profile and ${inGame.length} only in the game's own list. ` +
          "MO2 uses its profile for what it launches; anything started outside MO2 (Steam, the SKSE loader on its own, LOOT outside MO2) reads the game's list. " +
          "That is normal if you always start the game from MO2.",
        basis: "install",
      });
    }
  }

  return { findings, plugins: looked, index };
}
