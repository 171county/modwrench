import type { CallStackFrame, CrashlogParseResult, LoadedPlugin } from "../crashlog/types.js";
import type { ErrorEvent } from "./bepinex-scan.js";
import { KIND_PHRASE, classifyModule, isOfficialPlugin, moduleBase, splitModule } from "./explain.js";
import type { Evidence, Frame, Lead, ModuleKind, Strength } from "./types.js";

// ─── Which names to look at first ────────────────────────────────────────────
// A crash log doesn't name a culprit. It records where the game stopped (the top of
// the call stack), what was running underneath, and what the game was working with
// at the time. This turns that into a short list ordered by how directly each name
// is involved, and says why, so a person can see for themselves how thin or thick
// the evidence is.
//
// How the order is made (every number below is ModWrench's own choice, which is why
// the list is labelled a guess and never a finding):
//
//   a mod's code is the place the game stopped                      +80
//   the C++ exception was thrown from its code                      +60
//   the first mod code on the call stack, near the top              +40   (+25 if further down)
//   other mod code on the stack, near the top                       +15   (+5 if further down)
//   each further frame of the same mod                              +5    (up to +15)
//   only seen in the frames found by scanning stack memory          +8
//   the crash logger lists a plugin's object as involved            +35   (+5 per extra, up to +15)
//   a plugin and a DLL share a name (probably one mod)              +20
//   BepInEx logged the error under that mod's name                  +30
//   named in other errors BepInEx logged                            +10   (up to +25, as the count grows)
//   the same name was a lead in another recent crash                +10   (up to +30)
//   the player's own files flag it for this game version            +15
//
// 75 or more is a strong lead, 35 or more a possible one, the rest faint. Names that
// belong to the game, Windows, a driver, an overlay or the runtime never become leads,
// and neither do the plugins that ship with the game.

export const STRONG_AT = 75;
export const POSSIBLE_AT = 35;

const MAX_LEADS = 8;

export type InstallNote = NonNullable<Lead["install"]>;

export type RankOptions = {
  /** What the player's install says about a file, looked up by file name. */
  install?: (file: string) => InstallNote | undefined;
  /** For each of the player's other recent crash logs, the keys of the names that were leads in it. */
  recent?: ReadonlyArray<ReadonlySet<string>>;
  /** Every error a BepInEx log recorded, so a mod named in many of them can be told from one named once. */
  events?: ReadonlyArray<ErrorEvent>;
  /** The module Crash Logger found a C++ exception was thrown from. */
  thrownBy?: string;
};

type Candidate = {
  key: string;
  /** Every spelling this candidate answers to: its own, and the other's once a DLL and a plugin are matched up. */
  keys: Set<string>;
  display: string;
  dlls: string[];
  plugins: string[];
  /** Positions in the call stack of unwound frames, top first. */
  positions: number[];
  /** Positions of frames found only by scanning stack memory. */
  scanned: number[];
  functions: string[];
  formIds: string[];
  objects: number;
  loggedBy: boolean;
  thrown: boolean;
  errorsNamed: number;
};

const EXTENSION = /\.(?:dll|esp|esm|esl|asi)$/i;

/** A name reduced to what two spellings of it share: "JKs Whiterun Outskirts.esp" and "JKsWhiterunOutskirts.dll". */
export function leadKey(name: string): string {
  return moduleBase(name.replace(EXTENSION, "")).replace(/[^a-z0-9]/g, "");
}

function push<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

function describeFrames(positions: number[], frames: CallStackFrame[]): string {
  const shown = positions.slice(0, 5).map((p) => frames[p]?.index ?? p);
  const more = positions.length > shown.length ? ` and ${positions.length - shown.length} more` : "";
  return `${shown.join(", ")}${more}`;
}

/** A symbol without the IL offset Mono appends, and short enough to quote. */
export function cleanFunction(fn: string, max = 90): string {
  const text = fn.replace(/\s*\[0x[0-9a-f]+\](?:\s+in\s+.*)?$/i, "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function matchPlugin(key: string, plugins: LoadedPlugin[]): LoadedPlugin | undefined {
  if (key.length < 3) return undefined;
  return plugins.find((p) => {
    const other = leadKey(p.name);
    if (other === key) return true;
    return key.length >= 5 && other.length >= 5 && (other.startsWith(key) || key.startsWith(other));
  });
}

/**
 * What kind of code a frame's module is. In a BepInEx log a frame is a namespace, which only
 * belongs to a mod if it matches a plugin BepInEx loaded; any other namespace is the game's own
 * classes or a library, and ModWrench can't tell which.
 */
export function frameKind(module: string, bepinexPlugins?: LoadedPlugin[]): ModuleKind {
  const kind = classifyModule(module);
  if (kind === "mod" && bepinexPlugins && !matchPlugin(leadKey(module), bepinexPlugins)) return "unknown";
  return kind;
}

export function toFrame(frame: CallStackFrame, fallbackIndex: number, bepinexPlugins?: LoadedPlugin[]): Frame {
  const { name, offset } = splitModule(frame.module);
  // A BepInEx frame's "offset" is the file position the runtime printed, which says nothing about where in a module it is.
  const off = bepinexPlugins !== undefined ? undefined : (frame.offset ?? offset);
  return {
    index: frame.index ?? fallbackIndex,
    module: name,
    ...(off ? { offset: off } : {}),
    ...(frame.function ? { function: cleanFunction(frame.function, 120) } : {}),
    kind: frameKind(name, bepinexPlugins),
    ...(frame.source === "scan" ? { scan: true as const } : {}),
  };
}

const GENERIC_SOURCE = /^(?:unity ?log|bepinex|console|unity|harmony|mono|chainloader|preloader)$/i;

/** The name BepInEx gave the log source when it logged the error: "Error:SomePlugin: ..." -> "SomePlugin". */
function errorSource(parsed: CrashlogParseResult): string | undefined {
  if (parsed.detectedType !== "bepinex") return undefined;
  const source = /^(?:Fatal|Error):([^:]+):/.exec(parsed.exception.description ?? "")?.[1]?.trim();
  if (!source) return undefined;
  return GENERIC_SOURCE.test(source) ? undefined : source;
}

/** The leads for one crash, strongest first. Pure: what to look up about the install comes in through `options`. */
export function rankLeads(parsed: CrashlogParseResult, options: RankOptions = {}): Lead[] {
  return rankWithKeys(parsed, options).map((r) => r.lead);
}

/** The same leads, each with the keys it answers to, so other crash logs can be checked for the same name. */
export function rankWithKeys(parsed: CrashlogParseResult, options: RankOptions = {}): Array<{ lead: Lead; keys: string[] }> {
  const frames = parsed.callStack ?? [];
  const plugins = parsed.loadedPlugins ?? [];
  const candidates = new Map<string, Candidate>();
  const isBepInEx = parsed.detectedType === "bepinex";

  const candidate = (key: string, display: string): Candidate => {
    let c = candidates.get(key);
    if (!c) {
      c = {
        key,
        keys: new Set([key]),
        display,
        dlls: [],
        plugins: [],
        positions: [],
        scanned: [],
        functions: [],
        formIds: [],
        objects: 0,
        loggedBy: false,
        thrown: false,
        errorsNamed: 0,
      };
      candidates.set(key, c);
    }
    return c;
  };

  // 1. Mod code on the call stack.
  let firstModPosition = -1;
  frames.forEach((frame, position) => {
    const { name: module } = splitModule(frame.module?.trim() ?? "");
    if (!module || classifyModule(module) !== "mod") return;
    // A BepInEx frame is a namespace: it only counts when it is one of the plugins that loaded.
    const owner = isBepInEx ? matchPlugin(leadKey(module), plugins) : undefined;
    if (isBepInEx && !owner) return;
    const scan = frame.source === "scan";
    if (!scan && firstModPosition === -1) firstModPosition = position;
    const c = candidate(leadKey(owner?.name ?? module), owner?.name ?? module);
    if (isBepInEx) push(c.plugins, owner?.name ?? module);
    else push(c.dlls, module);
    (scan ? c.scanned : c.positions).push(position);
    if (!scan && frame.function) push(c.functions, frame.function);
  });

  // 2. Plugins the crash logger lists among the objects involved. The game's own plugins are in every log.
  for (const ref of parsed.suspectedRefs ?? []) {
    const source = ref.likelySource?.trim();
    if (!source || isOfficialPlugin(source)) continue;
    const c = candidate(leadKey(source), source);
    push(c.plugins, source);
    c.objects++;
    push(c.formIds, ref.value);
  }

  // 3. The mod BepInEx says logged the error, and the mods named in the other errors.
  const logged = errorSource(parsed);
  if (logged) {
    const owner = matchPlugin(leadKey(logged), plugins);
    const c = candidate(leadKey(owner?.name ?? logged), owner?.name ?? logged);
    push(c.plugins, owner?.name ?? logged);
    c.loggedBy = true;
  }
  if (isBepInEx && options.events) {
    for (const event of options.events) {
      const named = new Set<string>();
      const names = [...event.modules, ...(event.source && !GENERIC_SOURCE.test(event.source) ? [event.source] : [])];
      for (const name of names) {
        const owner = matchPlugin(leadKey(name), plugins);
        if (!owner || classifyModule(owner.name) !== "mod") continue;
        const key = leadKey(owner.name);
        if (named.has(key)) continue;
        named.add(key);
        const c = candidate(key, owner.name);
        push(c.plugins, owner.name);
        c.errorsNamed++;
      }
    }
  }

  // 4. The module Crash Logger found a C++ exception was thrown from.
  if (options.thrownBy) {
    const { name } = splitModule(options.thrownBy);
    if (name && classifyModule(name) === "mod") {
      const c = candidate(leadKey(name), name);
      push(c.dlls, name);
      c.thrown = true;
    }
  }

  // 4b. A DLL and a plugin whose names begin the same way are probably one mod ("CitiesOfTheNorth.dll", "Cities of the North - Whiterun.esp").
  // Eight characters or more, so short names don't pair up by accident.
  if (!isBepInEx) {
    for (const dll of [...candidates.values()].filter((c) => c.dlls.length > 0 && c.plugins.length === 0)) {
      for (const plugin of [...candidates.values()].filter((c) => c.plugins.length > 0 && c.dlls.length === 0)) {
        const [short, long] = dll.key.length <= plugin.key.length ? [dll.key, plugin.key] : [plugin.key, dll.key];
        if (short.length < 8 || !long.startsWith(short)) continue;
        plugin.plugins.forEach((name) => push(dll.plugins, name));
        plugin.formIds.forEach((id) => push(dll.formIds, id));
        dll.objects += plugin.objects;
        dll.loggedBy = dll.loggedBy || plugin.loggedBy;
        plugin.keys.forEach((k) => dll.keys.add(k));
        candidates.delete(plugin.key);
      }
    }
  }

  const totalErrors = options.events?.length ?? 0;

  // 5. Score and explain each.
  const leads: Array<{ lead: Lead; keys: string[] }> = [];
  for (const c of candidates.values()) {
    const evidence: Evidence[] = [];
    let score = 0;
    const named = c.dlls[0] ?? c.plugins[0] ?? c.display;

    if (c.positions.length > 0) {
      const top = c.positions[0]!;
      const topIndex = frames[top]?.index ?? top;
      if (top === 0) {
        score += 80;
        evidence.push({
          text: `The game stopped inside ${named}: it was the code running at the moment of the crash (frame ${topIndex}).`,
          basis: "log",
        });
      } else if (top === firstModPosition) {
        score += top <= 4 ? 40 : 25;
        const above = frames[top - 1];
        const aboveWho = above ? KIND_PHRASE[frameKind(above.module, isBepInEx ? plugins : undefined)] : "the top of the stack";
        evidence.push({
          text: `It is the first mod code on the call stack (frame ${topIndex}), right underneath ${aboveWho}.`,
          basis: "log",
        });
      } else {
        score += top <= 9 ? 15 : 5;
        evidence.push({ text: `It appears on the call stack (frame ${topIndex}), below other mod code.`, basis: "log" });
      }
      if (c.positions.length > 1) {
        score += Math.min(15, 5 * (c.positions.length - 1));
        evidence.push({ text: `It shows up in ${c.positions.length} frames (${describeFrames(c.positions, frames)}).`, basis: "log" });
      }
      const fn = c.functions[0];
      if (fn) evidence.push({ text: `The code running there is ${cleanFunction(fn)}.`, basis: "log" });
    } else if (c.scanned.length > 0) {
      score += 8;
      evidence.push({
        text:
          `It turns up only when the crash logger scans the stack's raw memory (frame ${frames[c.scanned[0]!]?.index ?? c.scanned[0]}). ` +
          "That is weaker evidence than an unwound frame, because stack memory also holds leftovers.",
        basis: "log",
      });
    }

    if (c.thrown) {
      score += 60;
      evidence.push({ text: `The crash logger found the C++ exception was thrown from ${named}'s code.`, basis: "log" });
    }

    if (c.objects > 0) {
      score += 35 + Math.min(15, 5 * (c.objects - 1));
      const id = c.formIds[0] ? ` (for example ${c.formIds[0]})` : "";
      evidence.push({
        text:
          `The crash logger lists ${c.objects === 1 ? "an object" : `${c.objects} objects`} from ${c.plugins[0] ?? named} among those involved${id}. ` +
          "That is the logger's own guess about what the game was working with.",
        basis: "log",
      });
    }

    if (c.loggedBy) {
      score += 35;
      evidence.push({
        text: `BepInEx recorded the error under the name "${c.plugins[0] ?? named}", so the mod itself reported it.`,
        basis: "log",
      });
    }

    if (c.errorsNamed > 0) {
      score += Math.min(25, 10 + 5 * Math.floor(Math.log2(c.errorsNamed)));
      evidence.push({
        text:
          `It is named in ${c.errorsNamed} of the ${totalErrors} error${totalErrors === 1 ? "" : "s"} BepInEx logged. ` +
          (c.errorsNamed > 1 ? "The same name coming up again and again points at it more than a single error would." : "That is one error, so it says little by itself."),
        basis: "log",
      });
    }

    if (c.dlls.length > 0 && c.plugins.length > 0 && !isBepInEx) {
      score += 20;
      evidence.push({
        text: `${c.dlls[0]} and ${c.plugins[0]} share a name, so they are probably the same mod. That is a name match, not proof.`,
        basis: "guess",
      });
    }

    const files = [...c.dlls, ...c.plugins];
    const install = options.install ? lookupInstall(files, options.install) : undefined;
    if (install?.flagged) {
      score += install.flagged.status === "broken" ? 15 : 8;
      evidence.push({
        text: `Checked against the game version you have installed, this plugin is flagged: ${install.flagged.reason}.`,
        basis: install.flagged.basis === "inferred" ? "guess" : "rule",
      });
    }
    if (install && !install.present && c.dlls.length > 0) {
      evidence.push({
        text: `${c.dlls[0]} isn't in your plugin folders any more, so it was removed or renamed after this crash.`,
        basis: "install",
      });
    }

    let recurrence: Lead["recurrence"];
    if (options.recent && options.recent.length > 0) {
      const of = options.recent.length;
      const logs = options.recent.filter((keys) => [...c.keys].some((k) => keys.has(k))).length;
      if (logs > 0) {
        score += Math.min(30, 10 * logs);
        recurrence = { logs, of };
        evidence.push({
          text: `It is also a lead in ${logs} of your ${of} other recent crash log${of === 1 ? "" : "s"}. The same name coming up again and again is much stronger than any one log.`,
          basis: "log",
        });
      }
    }

    const strength: Strength = score >= STRONG_AT ? "strong" : score >= POSSIBLE_AT ? "possible" : "faint";
    leads.push({
      lead: {
        rank: 0,
        name: named,
        files,
        strength,
        summary: summarise(c, recurrence),
        evidence,
        ...(install ? { install } : {}),
        ...(recurrence ? { recurrence } : {}),
        score,
      },
      keys: [...c.keys],
    });
  }

  leads.sort((a, b) => b.lead.score - a.lead.score || a.lead.name.localeCompare(b.lead.name));
  leads.forEach((entry, i) => {
    entry.lead.rank = i + 1;
  });
  return leads.slice(0, MAX_LEADS);
}

function lookupInstall(files: string[], find: (file: string) => InstallNote | undefined): InstallNote | undefined {
  for (const file of files) {
    if (!/\.dll$/i.test(file)) continue;
    const found = find(file);
    if (found) return found;
  }
  return undefined;
}

function summarise(c: Candidate, recurrence: Lead["recurrence"]): string {
  const top = c.positions[0] ?? -1;
  let line: string;
  if (c.thrown) line = "The crash logger found the exception was thrown from its code.";
  else if (top === 0) line = "The game stopped inside it.";
  else if (top >= 0 && c.objects > 0) line = "It is on the call stack, and the game was working with its data.";
  else if (top >= 0 && top <= 4) line = "The first mod code on the call stack.";
  else if (top >= 0) line = "It appears further down the call stack.";
  else if (c.loggedBy) line = "BepInEx logged the error under its name.";
  else if (c.errorsNamed > 1) line = `Named in ${c.errorsNamed} of the errors BepInEx logged.`;
  else if (c.scanned.length > 0 && c.objects === 0) line = "It only turns up in a scan of the stack's raw memory.";
  else if (c.errorsNamed === 1) line = "Named in one error BepInEx logged.";
  else line = "The game was working with an object from it.";
  if (recurrence) line += ` It also came up in ${recurrence.logs} of your other ${recurrence.of} recent crash${recurrence.of === 1 ? "" : "es"}.`;
  return line;
}
