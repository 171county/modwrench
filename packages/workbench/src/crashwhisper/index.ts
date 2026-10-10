import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { detectCrashlogType } from "../crashlog/detect.js";
import { parseCrashlog } from "../crashlog/index.js";
import { PLAYER_FORM_IDS, type CrashlogParseResult, type CrashlogType } from "../crashlog/types.js";
import { PLUGIN_CHECK_GAMES } from "../doctor/types.js";
import { clean } from "../patchday/summary.js";
import { scanBepInEx, type BepInExFacts } from "./bepinex-scan.js";
import { runChecks } from "./checks.js";
import { readInstallContext, type InstallContext } from "./context.js";
import {
  KIND_PHRASE,
  describeGame,
  explainException,
  faultFromInstruction,
  gameFiles,
  isFlex,
  moduleBase,
  readCppException,
  readSystem,
  strayAddress,
  type Fault,
  type GameFacts,
} from "./explain.js";
import { CRASH_LOG_GAMES, findCrashLogs, readLogFile, type FoundLog } from "./find.js";
import { buildPackets } from "./packet.js";
import { leadKey, POSSIBLE_AT, rankWithKeys, toFrame, type RankOptions } from "./rank.js";
import { cleaningDeadline, describeRedaction, redact, REDACTION_KINDS, type RedactOptions, type RedactionKind } from "./redact.js";
import { PACKET_STEP } from "./summary.js";
import { basisSentence, doctorsFor, plural, safeName } from "./text.js";
import type {
  Basis,
  Check,
  ContextObject,
  CrashContext,
  CrashWhisperReport,
  CrashWhisperResult,
  Frame,
  Lead,
  SystemFacts,
} from "./types.js";

export { CRASH_LOG_GAMES } from "./find.js";
export { summarizeCrashWhisper } from "./summary.js";
export * from "./types.js";

// ─── Crash Whisperer ─────────────────────────────────────────────────────────
// "My game crashed. Why?" A crash log is written in module names and addresses, and
// the people who can read it are few. This reads one (the newest the loggers wrote,
// or one the player pastes), says in plain words what happened, ranks the names the
// log points at with the reason for each, checks the setup for the usual causes, and
// writes the post to ask for help with, minus the player's name and folders.
//
// It never claims more than the log carries. Every statement says what it rests on
// (the log, the player's files, a documented rule, or ModWrench's own guess), and a
// ranking is a lead, never a verdict.
//
// Local and read-only. The log and the install are read on this computer, nothing is
// written, nothing is stored and ModWrench sends nothing anywhere. The one flow that
// leaves the machine is the answer itself, which goes to the AI model the player is
// talking to. What ModWrench recognises as personal (the player's name and computer
// name, folders, addresses, keys) is taken out of the log before anything else reads
// it. That is pattern matching, not a guarantee: TRUST.md lists what it does not catch.

export type WhisperOptions = {
  /** The crash log's text, when it was pasted. */
  logContent?: string;
  /** A crash log file, when it isn't where the logger normally writes it. */
  logPath?: string;
  /** Which game to look for a log of. Default: whichever game's log is newest. */
  gameId?: string;
  /** The format, when it can't be told from the log itself. */
  logType?: CrashlogType | "auto";
  /** The game's install folder, for a copy ModWrench can't find. Used with gameId. */
  gamePath?: string;
  mo2InstancePath?: string;
  profileName?: string;
  /** Check the log against the player's install (Skyrim Special Edition so far). Default true. */
  checkInstall?: boolean;
  /** How many of the player's other recent crash logs to compare. Default 5; 0 skips it. */
  compareRecent?: number;
  /** Leave the plugin lists out of the help packets. */
  hideNames?: boolean;
  /** For tests: names to take out, and whether to learn this machine's own. */
  redactOptions?: RedactOptions;
  /** For tests: the clock. */
  now?: number;
};

/** The most text taken from a paste: a crash log is tens of kilobytes, and BepInEx logs are the exception. */
const MAX_PASTE = 4_000_000;
const DEFAULT_RECENT = 5;
const MAX_RECENT = 10;
/** The largest log read in full for comparison. */
const MAX_RECENT_BYTES = 4 * 1024 * 1024;

function fail(error: string, hint?: string, looked?: string[]): CrashWhisperResult {
  return { ok: false, error, ...(hint ? { hint } : {}), ...(looked && looked.length > 0 ? { looked } : {}) };
}

const SUPPORTED_FORMATS = "Crash Logger SSE, Buffout 4, NetScriptFramework or BepInEx";

// ─── Reading the log's own sections ──────────────────────────────────────────

function readPluginList(section: string | undefined): Array<{ name: string; version?: string }> {
  if (!section) return [];
  const out: Array<{ name: string; version?: string }> = [];
  for (const raw of section.split(/\r?\n/).slice(0, 800)) {
    const m = /^\s*(.+?\.dll)(?:\s+v?(\S+))?\s*$/i.exec(raw);
    const name = m?.[1]?.replace(/^.*[\\/]/, "").trim();
    if (name) out.push({ name, ...(m?.[2] ? { version: m[2] } : {}) });
  }
  return out;
}

/** Names a crash logger flagged in its own "!!! WARNING: <name> DETECTED !!!" banner. */
function readWarnings(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*!!!\s*WARNING:\s*(.{1,80}?)\s+DETECTED\s*!!!/gm)) {
    if (m[1] && !out.includes(m[1])) out.push(m[1]);
    if (out.length >= 5) break;
  }
  return out;
}

function faultWords(fault: Fault | undefined): string | undefined {
  if (!fault) return undefined;
  const verb = fault.access === "write" ? "writing to" : fault.access === "execute" ? "running code at" : "reading";
  return `${verb} address ${fault.address.replace(/^0x0+(?=[0-9A-Fa-f])/, "0x")}`;
}

/** The same log whatever its line endings: the copy on disk has CRLF, a paste usually arrives with LF. */
const signature = (text: string): string => createHash("sha1").update(text.replace(/\r\n?/g, "\n").trim()).digest("hex");

// ─── Comparing with the other recent logs ────────────────────────────────────

function recentLeadKeys(
  logs: FoundLog[],
  current: { hash: string; abs?: string },
  type: CrashlogType,
  limit: number,
  redactOptions: RedactOptions,
): { sets: ReadonlySet<string>[]; outOfTime: boolean } {
  const out: ReadonlySet<string>[] = [];
  for (const log of logs) {
    if (out.length >= limit) break;
    if (log.abs === current.abs || log.size > MAX_RECENT_BYTES || !/^crash-/i.test(log.name)) continue;
    const read = readLogFile(log.abs, MAX_RECENT_BYTES);
    if (!read) continue;
    if (signature(read.text) === current.hash) continue;
    const cleaned = redact(read.text, redactOptions);
    // The time allowance this call shares ran out: a log cleaned only in part is not compared, and the rest are left unread.
    if (cleaned.report.skippedLines > 0) return { sets: out, outOfTime: true };
    const parsed = parseCrashlog({ logContent: cleaned.text, logType: type });
    if (!parsed.ok || parsed.detectedType !== type) continue;
    const keys = new Set<string>();
    for (const { lead, keys: own } of rankWithKeys(parsed)) {
      if (lead.score >= POSSIBLE_AT) own.forEach((k) => keys.add(k));
    }
    out.push(keys);
  }
  return { sets: out, outOfTime: false };
}

// ─── Words ───────────────────────────────────────────────────────────────────

const SITE_PHRASE: Record<Frame["kind"], string> = {
  game: "the game's own code",
  extender: "the script extender",
  system: "Windows",
  graphics: "the graphics layer",
  overlay: "an overlay or loader",
  framework: "the runtime (Unity, .NET or the mod loader)",
  mod: "a mod's code",
  unknown: "code ModWrench can't place in any module",
};

const lowerFirst = (s: string): string => (s.length > 0 ? `${s[0]!.toLowerCase()}${s.slice(1)}` : s);

/** A lead's name, with the mod a well-known DLL comes with: "skee64.dll (RaceMenu)". */
const leadName = (lead: Lead, max = 80): string => `${clean(lead.name, max)}${lead.mod ? ` (${clean(lead.mod, 60)})` : ""}`;

/** What to turn off or look up for a lead: its mod with the file, "RaceMenu (skee64.dll)", or the file alone. */
const leadTarget = (lead: Lead): string => {
  const file = clean(lead.files[0] ?? lead.name, 80);
  return lead.mod ? `${clean(lead.mod, 60)} (${file})` : file;
};

/** Which part of Havok the game was in, from a Havok class name at the top of the call stack or in a register. */
type HavokHint = { area: "physics" | "animation"; name: string };

// Havok's class names carry its product prefix: hkp and hknp are its physics, hkb its behavior graphs and hka its
// animation (the same prefixes the game's .hkx files use). BShkb is Bethesda's animation graph built on hkb.
const HAVOK: Array<{ re: RegExp; area: HavokHint["area"] }> = [
  { re: /^hk(?:np|p)[A-Z]/, area: "physics" },
  { re: /^(?:hk[ab]|BShkb)[A-Z]/, area: "animation" },
];

function havokHint(frames: Frame[], context: CrashContext | undefined): HavokHint | undefined {
  const names = [...frames.slice(0, 5).map((f) => f.function?.split("::")[0] ?? ""), ...(context?.types ?? []).map((t) => t.type)];
  for (const name of names) {
    const hit = HAVOK.find((h) => h.re.test(name));
    if (hit) return { area: hit.area, name: clean(name, 60) };
  }
  return undefined;
}

/** Where to start when the log shows the game in Havok code and no mod stands out. */
function havokStep(h: HavokHint, game: GameFacts): string {
  const where = `The log shows the game in Havok's ${h.area} code (${h.name}).`;
  return h.area === "physics"
    ? `${where} Look first at mods that add or change collision, ragdolls or physics objects, starting with the ones you added or changed most recently.`
    : `${where} Look first at animation mods, starting with the ones you added or changed most recently.` +
        (/skyrim/i.test(game.id ?? game.name) ? " If you use Nemesis or Pandora, run it again so its behavior files match the animation mods you have now." : "");
}

function headlineFor(a: {
  bepinex: boolean;
  type: string | undefined;
  hasException: boolean;
  site: Frame | undefined;
  nearest: Frame | undefined;
  leads: Lead[];
  frameCount: number;
  problems: number;
  lastError: CrashlogParseResult["lastError"];
  errors: number;
  lastMessage: string | undefined;
  havok: HavokHint | undefined;
}): string {
  let text = headlineCore(a);
  // With no lead stronger than faint, the Havok code it was in is the most the log says about where to look.
  if (a.havok && !a.leads.some((l) => l.strength !== "faint")) text += ` The log shows it was in Havok's ${a.havok.area} code (${a.havok.name}).`;
  // BepInEx's log runs for the whole session: entries after the last error mean the game went on past it.
  const after = a.bepinex ? (a.lastError?.entriesAfter ?? 0) : 0;
  if (after > 0) {
    text += a.lastError?.exception
      ? ` BepInEx wrote ${plural(after, "more entry", "more entries")} after it, so the game went on past this error.`
      : ` BepInEx wrote ${plural(after, "more entry", "more entries")} after it, so the game went on past it, and this log doesn't show the game crashing.`;
  }
  return a.problems > 0
    ? `${text} The checks below found ${a.problems === 1 ? "a problem" : `${a.problems} problems`} in your setup that ${a.problems === 1 ? "is" : "are"} worth fixing first.`
    : text;
}

function headlineCore(a: {
  bepinex: boolean;
  type: string | undefined;
  hasException: boolean;
  site: Frame | undefined;
  nearest: Frame | undefined;
  leads: Lead[];
  frameCount: number;
  lastError: CrashlogParseResult["lastError"];
  errors: number;
  lastMessage: string | undefined;
}): string {
  const what = a.type ? clean(a.type, 80) : a.bepinex ? "an error" : "an unhandled exception";
  // A BepInEx error that isn't an exception is a message some code logged, not something that stopped the game.
  const message = a.lastMessage ? ` ("${clean(a.lastMessage, 100)}")` : "";
  const crashed = !a.bepinex
    ? `The game crashed with ${what}`
    : a.lastError?.exception === false
      ? `BepInEx logged ${plural(a.errors, "error", "errors")}, and the last one isn't an exception${message}`
      : `BepInEx logged ${what}`;
  if (!a.hasException && a.frameCount === 0) {
    return a.bepinex
      ? "This BepInEx log has no errors in it, so it doesn't say why the game closed. Look at the checks below for what it does show."
      : "ModWrench read the log but couldn't find a crash in it. Look at the checks below for what it does show.";
  }
  const [first, second] = a.leads;
  if (first?.strength === "strong" && first.shared) {
    const caller = a.leads.find((l) => l.calls);
    return (
      `${crashed} inside ${leadName(first)}, a library other mods call. ` +
      (caller
        ? `The mod that called it matters too, and the best lead for it is ${leadName(caller)}, a ${caller.strength} lead.`
        : "The call stack doesn't show another mod calling it.")
    );
  }
  if (first?.strength === "strong") {
    return `${crashed}, and the strongest lead is ${leadName(first)}: ${lowerFirst(first.summary)}`;
  }
  if (first?.strength === "possible") {
    return second
      ? `${crashed}. The log doesn't pin it on one name: ${clean(first.name, 80)} is the best lead, then ${clean(second.name, 60)}, and neither is certain.`
      : `${crashed}. The log doesn't pin it firmly on any one name: ${clean(first.name, 80)} is the best lead, but it isn't certain.`;
  }
  if (first) {
    return `${crashed}. Nothing in the log points firmly at any one mod; ${clean(first.name, 80)} is only a faint lead.`;
  }
  if (a.site?.address) {
    const near = a.nearest;
    return (
      `${crashed} at ${strayAddress(clean(a.site.address, 24))}. ` +
      (near ? `The first frame the log can place is ${clean(near.module, 60)} (${near.about ? clean(near.about, 120) : KIND_PHRASE[near.kind]}), frame ${near.index}. ` : "") +
      "No mod code ModWrench can identify is on the call stack, so the log doesn't name a mod."
    );
  }
  if (a.site?.copies) {
    return `${crashed} in ${clean(a.site.module, 60)}, which may be Windows' own or a graphics mod's copy of it (the log lists ${a.site.copies}), with no mod code ModWrench can identify on the call stack, so the log doesn't name a mod.`;
  }
  if (a.site?.about) {
    return `${crashed} in ${clean(a.site.module, 60)} (${clean(a.site.about, 120)}), with no mod code on the call stack, so the log doesn't name a mod.`;
  }
  if (a.site) {
    return `${crashed} in ${SITE_PHRASE[a.site.kind]}, with no mod code on the call stack, so the log doesn't name a mod.`;
  }
  return `${crashed}. The log has no call stack, so ModWrench can't say where it stopped or which mod is involved.`;
}

function nextStepsFor(a: {
  leads: Lead[];
  checks: Check[];
  game: GameFacts;
  install: InstallContext;
  bepinex: boolean;
  site: Frame | undefined;
  /** The mods BepInEx loaded, when its log lists them. */
  mods: string[] | undefined;
  errors: number;
  nearest: Frame | undefined;
  context: CrashContext | undefined;
  /** How many plugins the log lists, when it lists them. */
  pluginCount: number | undefined;
  pluginList: CrashlogParseResult["pluginList"];
  havok: HavokHint | undefined;
}): string[] {
  // Up to five steps, then the help-packet step, which always has a place at the end. A game updated since the
  // crash keeps a place too, for the step that sends it to Patch Day: that is a fact about this install, where the
  // general steps (the Doctors, the halving) are only worth trying.
  const patchDay =
    a.install.checked && a.checks.some((c) => c.id === "game-updated")
      ? "The game was updated after this crash, so run Patch Day to see which plugins don't match the version you have now."
      : undefined;
  const room = patchDay ? 4 : 5;
  const steps: string[] = [];
  const add = (step: string | undefined): void => {
    if (step && !steps.includes(step) && steps.length < room) steps.push(step);
  };
  for (const check of a.checks.filter((c) => c.severity === "problem").slice(0, 2)) add(check.fix);
  // PCGamingWiki's Fallout 4 page: the launcher's Options, Advanced, Weapon Debris switches NVIDIA FleX off.
  if (a.site && isFlex(a.site.module)) {
    add(
      "The game stopped inside NVIDIA FleX, which Fallout 4 uses for its Weapon Debris effect on NVIDIA cards. Turn Weapon Debris off in Fallout 4's launcher (Options, then Advanced, then Weapon Debris: Off) and see whether the crash stops."
    );
  }
  const top = a.leads[0];
  const version = a.game.version ? `game version ${a.game.version}` : "your game version";
  if (top && top.strength !== "faint" && top.shared) {
    const library = leadTarget(top);
    const mod = clean(top.mod ?? top.name, 60);
    const caller = a.leads.find((l) => l.calls);
    add(
      `Don't remove ${library}: other mods need it and stop working without it. The game stopped inside it, but a crash inside a library like this can come from what the mod that called it asked of it, or from a version of it that doesn't match the game.`
    );
    add(
      caller
        ? `Look at ${leadTarget(caller)}, the best lead for the mod that called it, and at ${mod}: check both for updates made for ${version}, and that you have the ${mod} version it asks for.`
        : `Check ${mod} for an update made for ${version}, and the mods that use it too: their pages say which ${mod} version they need.`
    );
  } else if (top && top.strength !== "faint") {
    const target = clean(top.files[0] ?? top.name, 80);
    // A game plugin is switched off in the load order, and a save that used it may not load cleanly without it.
    const plugin = !a.bepinex && !top.files.some((f) => /\.dll$/i.test(f)) && /\.(?:esp|esm|esl)$/i.test(top.files[0] ?? "");
    const after = "try to make the game crash the same way again";
    add(
      a.bepinex
        ? `Turn off ${target} (or move it out of its folder) and play the same way again. If the error stops showing up in the log, that was it; if the same error comes from another name, ${target} was only a bystander.`
        : top.mod
          ? `Turn off ${clean(top.mod, 60)} in your mod manager (${target} comes with it) and ${after}. If the crash is gone, that was it; if it simply moves to another name, ${clean(top.mod, 60)} was only a bystander.`
          : plugin
            ? `Turn off ${target} in your load order and ${after}, on a new game or a copy of your save: taking a plugin out of a game in progress can break that save. If the crash is gone, that was it; if it simply moves to another name, ${target} was only a bystander.`
            : `Turn off ${target} (or move it out of its folder) and ${after}. If the crash is gone, that was it; if it simply moves to another name, ${target} was only a bystander.`
    );
    add(
      `Look at the mod page for ${clean(top.mod ?? top.name, 80)} for a build made for ${version} and for other people reporting this ${a.bepinex ? "error" : "crash"}.`
    );
    // A lead that is only possible leaves room for what else the log shows.
    const files = top.strength === "possible" ? (a.context?.files ?? []) : [];
    if (files.length > 0) {
      add(
        `The log also shows the game handling ${files.slice(0, 3).map((f) => clean(f, 120)).join(", ")}. Your mod manager can show which mod each comes from, and that mod is worth a look too.`
      );
    }
  } else if (a.bepinex && a.errors > 0 && a.mods && a.mods.length > 0 && a.mods.length <= 2) {
    add(
      a.mods.length === 1
        ? `Only one mod is loaded, ${clean(a.mods[0]!, 80)}: turn it off and see whether the errors stop.`
        : "Only two mods are loaded: turn each off in turn and see whether the errors stop."
    );
  } else if (a.bepinex && a.errors > 0) {
    add(
      "No name stands out, so narrow it down by halves: turn off half of your mods and see whether the errors stop, then keep halving whichever half still has them. A mod manager with profiles makes this quick."
    );
  } else {
    // No name stands out. Start from what the log does show, then what changed, and size the halving to the load order.
    const files = a.context?.files ?? [];
    const near = a.nearest;
    if (files.length > 0) {
      add(
        `Start with what the log shows the game was handling: ${files.slice(0, 3).map((f) => clean(f, 120)).join(", ")}. Your mod manager can show which mod each comes from; try without that mod, or reinstall it.`
      );
    }
    if (a.havok) add(havokStep(a.havok, a.game));
    if (files.length === 0 && near) {
      add(
        `The first code the log can place is ${clean(near.module, 60)}${near.about ? ` (${clean(near.about, 120)})` : ""}, frame ${near.index}. It isn't a mod, so it isn't ranked as a lead, but it is where to start: check it is up to date, and name it when you ask for help.`
      );
    }
    add("Think back to what changed just before the crashes began (a mod installed, updated or removed, or a game update) and undo that first.");
    // A setup problem can crash the game without leaving a mod's name in the log, and the Doctors check those from files.
    if (PLUGIN_CHECK_GAMES.has(a.game.id ?? "")) add(DOCTOR_STEP.replace("(/mw-doctor)", doctorsFor(a.game)));
    const rounds = a.pluginCount && a.pluginCount > 1 ? Math.ceil(Math.log2(a.pluginCount)) : 0;
    add(
      "If that doesn't find it, narrow it down by halves: turn off half of your mods and see whether it still crashes, then keep halving whichever half does." +
        (rounds > 0 ? ` With ${a.pluginCount} plugins that is about ${rounds} rounds, so start with the mods you added or changed most recently.` : "") +
        " A mod manager with profiles makes this quick."
    );
  }
  if (a.pluginList === "failed") {
    add("The logger couldn't write your plugin list into this log, so add your load order (your mod manager shows it) when you ask for help.");
  }
  if (patchDay) steps.push(patchDay);
  steps.push(PACKET_STEP);
  return steps;
}

/** The step that sends a crash with no clear lead to the Doctors, as it reads for Skyrim Special Edition. Another game is named in it. */
export const DOCTOR_STEP =
  "Run the Doctors (/mw-doctor). They check setup problems a crash log may not name: a plugin whose master is missing, switched off or loaded after it, a load order past the plugin limit, and two crash loggers at once.";

/** A log too big to read whole: the file's size and how much of its start and end was read. */
type CutInfo = { size: number; head: number; tail: number };

function limitsFor(a: {
  bepinex: boolean;
  install: InstallContext;
  recentExamined: number;
  recentOutOfTime: boolean;
  cut: CutInfo | undefined;
  source: "newest" | "path" | "pasted";
  game: GameFacts;
  looked?: FoundLog;
  skipped: number;
}): string[] {
  const limits = [
    "A crash log records where the game stopped, not why. A lead is a name the log points at, ranked by ModWrench's own scoring; the top lead can still be innocent, and the real cause can be something that isn't on the list.",
    "Reading the log and your install happens on this computer, and ModWrench stores and sends nothing. What this answer says goes to the AI model you are talking to, and so does a help packet if you ask for one. Before anything reads the log, ModWrench takes out the personal details it recognises: your user name and computer name, folders, addresses and keys.",
    "Removal covers what ModWrench recognises, not everything. Mod and file names are kept as the log wrote them, except that a help post shows square brackets as round ones, angle brackets and backticks as look-alikes, the at sign as (at) and a run of spaces as one. A packet includes your hardware (system, processor, graphics card, memory) when the log has it, because memory crashes are common. Read a packet before you post it.",
    "The log file on your disk is left exactly as it is, with everything in it. To share a crash, post a help packet; don't attach or paste the file itself.",
  ];
  if (a.source === "newest" && a.looked) {
    limits.push(
      a.skipped > 0
        ? `No log was given, so ModWrench read the newest it could read (a ${a.game.name} log). ${plural(a.skipped, "newer log", "newer logs")} couldn't be opened or read as a crash log. If you meant a different crash or game, paste the log or pass gameId.`
        : `No log was given, so ModWrench read the newest it found (a ${a.game.name} log). If you meant a different crash or game, paste the log or pass gameId.`
    );
  }
  if (!a.install.checked && a.install.reason) limits.push(a.install.reason);
  if (a.bepinex) {
    limits.push(
      "A BepInEx stack names code by namespace, and a mod's namespace doesn't always resemble its name, so a mod can be missing from the leads. BepInEx's log is also a session log: a game can close with nothing wrong in it."
    );
  } else {
    limits.push(
      "A log can't show missing master files, conflicts between mods' data, or a damaged save. Tools such as LOOT and xEdit are made for those."
    );
  }
  if (a.recentExamined > 0) {
    limits.push(
      `Names were compared across your ${plural(a.recentExamined, "other recent crash log", "other recent crash logs")}. A name can come up every time because it loads every time, not because it crashes the game.`
    );
  }
  if (a.recentOutOfTime) {
    limits.push(
      a.recentExamined === 0
        ? "Cleaning the logs took too long, so your other recent crash logs were not compared."
        : `Cleaning the logs took too long, so only ${plural(a.recentExamined, "other recent crash log was", "other recent crash logs were")} compared; the rest were left unread.`
    );
  }
  if (a.cut) {
    const mb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1048576))} MB`;
    limits.push(
      `The log file is very large (${mb(a.cut.size)}), so only its first ${mb(a.cut.head)} and its last ${mb(a.cut.tail)} were read, each cut at a whole line. What is between them was not read, so nothing from it can be in an answer or a packet.`
    );
  }
  limits.push(
    "The log layouts are read from the loggers' published source code, not from every version in use. If a log of yours is read wrongly, that is worth reporting."
  );
  return limits;
}

// ─── Making the structured answer plain ──────────────────────────────────────

function tidyLead(lead: Lead): Lead {
  return {
    ...lead,
    name: clean(lead.name, 80),
    files: lead.files.map((f) => clean(f, 80)),
    ...(lead.mod ? { mod: clean(lead.mod, 60) } : {}),
    ...(lead.calls ? { calls: clean(lead.calls, 80) } : {}),
    summary: clean(lead.summary, 300),
    evidence: lead.evidence.map((e) => ({ ...e, text: clean(e.text, 420) })),
  };
}

function tidyCheck(check: Check): Check {
  return {
    ...check,
    title: clean(check.title, 180),
    detail: clean(check.detail, 600),
    ...(check.fix ? { fix: clean(check.fix, 420) } : {}),
  };
}

function tidyFrame(frame: Frame): Frame {
  return {
    ...frame,
    module: clean(frame.module, 80),
    ...(frame.offset ? { offset: clean(frame.offset, 16) } : {}),
    ...(frame.function ? { function: clean(frame.function, 120) } : {}),
    ...(frame.about ? { about: clean(frame.about, 120) } : {}),
    ...(frame.address ? { address: clean(frame.address, 24) } : {}),
  };
}

const MAX_CONTEXT = 6;

/** Register types that say nothing about what the game was doing: numbers, untyped pointers and strings. */
const PLAIN_TYPE = /^(?:void|char|wchar_t|size_t|u?int(?:8|16|32|64)?(?:_t)?|[ui](?:8|16|32|64)|bool|float|double)$/i;

/** What the log shows the game was working with: the objects, the kinds of object in the registers, files and Papyrus functions. */
function contextFor(parsed: CrashlogParseResult): CrashContext | undefined {
  const objects: ContextObject[] = (parsed.suspectedRefs ?? [])
    .filter((r) => r.origin !== undefined)
    .slice(0, 8)
    .map((r) => {
      const player = PLAYER_FORM_IDS.has(r.value);
      return {
        formId: clean(r.value, 12),
        ...(r.kind ? { kind: clean(r.kind, 40) } : {}),
        ...(r.name && !player ? { name: clean(r.name, 60) } : {}),
        plugins: (r.plugins ?? (r.likelySource ? [r.likelySource] : [])).map((p) => clean(p, 80)),
        ...(r.origin ? { origin: r.origin } : {}),
        ...(player ? { player: true as const } : {}),
      };
    });
  const byType = new Map<string, string[]>();
  for (const [register, raw] of Object.entries(parsed.registerTypes ?? {})) {
    const type = raw.replace(/[\s*]+$/, "");
    if (!type || PLAIN_TYPE.test(type) || type.length > 60 || /[<>`'(]/.test(type)) continue;
    byType.set(type, [...(byType.get(type) ?? []), register]);
  }
  const types = [...byType].slice(0, MAX_CONTEXT).map(([type, registers]) => ({ type: clean(type, 60), registers: registers.map((r) => clean(r, 8)) }));
  const files = gameFiles(parsed.assetPaths ?? [])
    .slice(0, MAX_CONTEXT)
    .map((f) => clean(f, 120));
  const scripts = (parsed.papyrus ?? []).slice(0, MAX_CONTEXT).map((p) => clean(`${p.script}.${p.function}${p.native ? " (native)" : ""}`, 100));
  const context: CrashContext = {
    ...(objects.length > 0 ? { objects } : {}),
    ...(types.length > 0 ? { types } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(scripts.length > 0 ? { scripts } : {}),
  };
  return Object.keys(context).length > 0 ? context : undefined;
}

function minute(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

// ─── The whole thing ─────────────────────────────────────────────────────────

export function whisper(options: WhisperOptions = {}): CrashWhisperResult {
  const redactOptions = options.redactOptions ?? {};
  let text: string;
  let source: "newest" | "path" | "pasted";
  let fileName: string | undefined;
  let written: string | undefined;
  let abs: string | undefined;
  let cut: CutInfo | undefined;
  let chosen: FoundLog | undefined;
  /** Newer logs passed over because they couldn't be opened or read as any of the formats. */
  let skipped = 0;

  // 1. The log's text.
  if (options.logContent !== undefined && options.logContent.trim() !== "") {
    if (options.logContent.length > MAX_PASTE) {
      return fail(
        `That's too much text to paste (${Math.round(options.logContent.length / 1_000_000)} MB).`,
        "Give logPath instead, and ModWrench will read the file itself, or leave both out and it will look for the newest log."
      );
    }
    text = options.logContent.charCodeAt(0) === 0xfeff ? options.logContent.slice(1) : options.logContent;
    source = "pasted";
  } else if (options.logPath !== undefined && options.logPath.trim() !== "") {
    abs = options.logPath;
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(abs);
    } catch {
      return fail("ModWrench can't open the file at logPath.", "Check the path, or leave logPath out and it will look for the newest crash log.");
    }
    if (!stat.isFile()) {
      return fail("logPath is a folder, not a log file.", "Point it at the log itself, or leave it out and ModWrench will look for the newest one.");
    }
    const read = readLogFile(abs);
    if (!read) return fail("ModWrench couldn't read the file at logPath.");
    text = read.text;
    cut = read.cut ? { size: read.size, head: read.head, tail: read.tail } : undefined;
    source = "path";
    fileName = abs.replace(/^.*[\\/]/, "");
    written = minute(stat.mtimeMs);
  } else {
    const found = findCrashLogs({
      ...(options.gameId !== undefined ? { gameId: options.gameId } : {}),
      ...(options.gamePath !== undefined ? { gamePath: options.gamePath } : {}),
    });
    if (options.gameId !== undefined && !CRASH_LOG_GAMES.includes(options.gameId)) {
      return fail(
        `Crash Whisperer doesn't know where "${clean(options.gameId, 40)}" keeps its logs yet.`,
        `It looks for logs of: ${CRASH_LOG_GAMES.join(", ")}. For another game, paste the log text in logContent.`
      );
    }
    if (found.logs.length === 0) {
      return fail(
        "No crash log found.",
        "Crash Whisperer reads logs written by Crash Logger SSE, Buffout 4, NetScriptFramework and BepInEx. If your game crashed and wrote none, a crash logger for your game is what makes the next one readable. You can also paste a log's text in logContent or give its file in logPath.",
        found.looked
      );
    }
    // The newest log that can be opened and read as one of the formats; a newer one that can't is skipped, and said.
    let read: ReturnType<typeof readLogFile> = null;
    const declared = options.logType !== undefined && options.logType !== "auto";
    for (const log of found.logs) {
      const r = readLogFile(log.abs);
      if (r && r.text.trim() !== "" && (declared || detectCrashlogType(r.text, log.name) !== "unknown")) {
        chosen = log;
        read = r;
        break;
      }
      skipped++;
    }
    if (!chosen || !read) {
      const what = found.logs.length === 1 ? "a crash log but couldn't read it" : `${found.logs.length} crash logs but couldn't read any of them`;
      return fail(`ModWrench found ${what}.`, undefined, found.looked);
    }
    text = read.text;
    cut = read.cut ? { size: read.size, head: read.head, tail: read.tail } : undefined;
    source = "newest";
    abs = chosen.abs;
    fileName = chosen.name;
    written = minute(chosen.mtimeMs);
  }

  if (text.trim().length === 0) return fail("The log is empty.", "Paste the whole log, or pick the file with logPath.");

  const hash = signature(text);

  // 2. Take the person out of it before anything else reads it. The log and the other recent logs share one time allowance.
  const shared: RedactOptions = { ...redactOptions, deadline: cleaningDeadline(redactOptions) };
  const scrubbed = redact(text, shared);
  const clear = scrubbed.text;

  // 3. Read it.
  const result = parseCrashlog({ logContent: clear, ...(options.logType !== undefined ? { logType: options.logType } : {}) });
  if (!result.ok) {
    return fail(
      `This doesn't look like a log Crash Whisperer can read (it handles ${SUPPORTED_FORMATS}).`,
      "If it is one of those, pass logType (crashlogger-sse, buffout4, netscriptframework or bepinex). If the file is only part of a log, paste the whole of it."
    );
  }
  const parsed: CrashlogParseResult = result;

  const bepinex = parsed.detectedType === "bepinex";
  const game = describeGame(parsed, clear.slice(0, 2000));
  const facts: BepInExFacts | undefined = bepinex ? scanBepInEx(clear) : undefined;
  const cpp = readCppException(parsed.rawSections["C++ EXCEPTION"]);
  const system: SystemFacts | undefined = readSystem(parsed.rawSections["SYSTEM SPECS"]);
  const extenders = readPluginList(parsed.rawSections["SKSE PLUGINS"] ?? parsed.rawSections["F4SE PLUGINS"]);
  const logPlugins = new Map(extenders.filter((e) => e.version).map((e) => [e.name.toLowerCase(), e.version!] as const));
  const modules = new Set((parsed.modules ?? []).map((m) => moduleBase(m.name)));
  const warnings = readWarnings(clear);
  const context = contextFor(parsed);

  // 4. The player's install, where it can be read.
  const wantInstall = options.checkInstall !== false;
  const gameId = game.id ?? options.gameId;
  const install: InstallContext = wantInstall
    ? readInstallContext({
        ...(gameId !== undefined ? { gameId } : {}),
        ...(options.gamePath !== undefined ? { gamePath: options.gamePath } : {}),
        ...(options.mo2InstancePath !== undefined ? { mo2InstancePath: options.mo2InstancePath } : {}),
        ...(options.profileName !== undefined ? { profileName: options.profileName } : {}),
      })
    : {
        checked: false,
        reason: "Checking against your install was switched off, so only the log itself was used.",
        note: () => undefined,
        versions: () => [],
        files: new Set(),
        flagged: [],
      };

  // 5. The player's other recent crash logs, to see whether the same name keeps coming up.
  let recent: ReadonlySet<string>[] = [];
  let recentOutOfTime = false;
  const wantRecent = Math.min(MAX_RECENT, Math.max(0, Math.floor(options.compareRecent ?? DEFAULT_RECENT)));
  if (wantRecent > 0 && (parsed.detectedType === "crashlogger-sse" || parsed.detectedType === "buffout4") && game.id) {
    const siblings = findCrashLogs({
      gameId: game.id,
      ...(options.gamePath !== undefined ? { gamePath: options.gamePath } : {}),
    }).logs;
    const compared = recentLeadKeys(siblings, { hash, ...(abs !== undefined ? { abs } : {}) }, parsed.detectedType, wantRecent, shared);
    recent = compared.sets;
    recentOutOfTime = compared.outOfTime;
  }

  // 6. Rank the names.
  const rankOptions: RankOptions = {
    ...(install.checked ? { install: (file: string) => install.note(file) } : {}),
    ...(recent.length > 0 ? { recent } : {}),
    ...(facts ? { events: facts.events } : {}),
    ...(cpp?.module ? { thrownBy: cpp.module } : {}),
  };
  const ranked = rankWithKeys(parsed, rankOptions);
  const leads = ranked.map((r) => tidyLead(r.lead));

  // 7. Where it stopped, and the frames worth showing.
  const plugins = bepinex ? parsed.loadedPlugins : undefined;
  // A graphics library the module list names more than once may be a graphics mod's copy standing in for Windows' own,
  // and a frame doesn't say which copy it is in.
  const listed = new Map<string, number>();
  for (const m of parsed.modules ?? []) listed.set(moduleBase(m.name), (listed.get(moduleBase(m.name)) ?? 0) + 1);
  const allFrames = parsed.callStack.map((f, i): Frame => {
    const frame = toFrame(f, i, plugins);
    const copies = frame.kind === "graphics" ? (listed.get(moduleBase(frame.module)) ?? 0) : 0;
    return copies > 1 ? { ...frame, kind: "unknown", copies } : frame;
  });
  const leadKeys = new Set(ranked.flatMap((r) => r.keys));
  const picked = new Map<number, Frame>();
  const placed = (f: Frame): boolean => f.module !== "" && f.module !== "(unknown)";
  // The frames for a help post's 14 rows. A post folds a run of frames in no module into one row, so the run counts once
  // and the named frames after it still fit.
  let rows = 0;
  for (const [i, f] of allFrames.entries()) {
    if (placed(f) || i === 0 || placed(allFrames[i - 1]!)) {
      if (rows === 14) break;
      rows++;
    }
    picked.set(f.index, f);
  }
  for (const frame of allFrames) {
    if (frame.kind === "mod" && leadKeys.has(leadKey(frame.module)) && !picked.has(frame.index)) picked.set(frame.index, frame);
  }
  const frames = [...picked.values()].sort((a, b) => a.index - b.index).map(tidyFrame);
  // Stopped at an address in no module: say the address, and the first frame the log can place.
  const top = allFrames[0];
  const stray = top && !bepinex && !placed(top) ? parsed.exception.address : undefined;
  const site = top ? tidyFrame(stray ? { ...top, address: stray } : top) : undefined;
  const near = stray ? allFrames.slice(1).find((f) => !f.scan && placed(f)) : undefined;
  const nearest = near ? tidyFrame(near) : undefined;
  // A crash site ModWrench can already name (NVIDIA FleX, MO2's usvfs) says more than the Havok code around it.
  const havok = site?.about ? undefined : havokHint(allFrames, context);

  // 8. What the exception means.
  const type = parsed.exception.type ?? (cpp?.type ? "C++ exception" : undefined);
  // Older Crash Logger SSE logs don't write down the address an access violation touched; the instruction and the
  // registers say it. Only an empty-pointer address is kept: that is the one the plain words have something to say about.
  const derived =
    !parsed.exception.fault && /ACCESS_VIOLATION/i.test(parsed.exception.type ?? "")
      ? faultFromInstruction(parsed.exception.description, parsed.registers)
      : undefined;
  const touched = parsed.exception.fault ?? (derived && BigInt(derived.address) < 0x10000n ? derived : undefined);
  const explained = explainException(parsed.exception.type, parsed.exception.description, touched);
  let plain = explained?.plain;
  if (plain && cpp && /C\+\+|E06D7363/i.test(`${parsed.exception.type ?? ""} ${parsed.exception.description ?? ""}`)) {
    const thrown = [cpp.type ? clean(cpp.type, 80) : undefined, cpp.info ? `"${clean(cpp.info, 140)}"` : undefined].filter(Boolean).join(" ");
    plain += ` It threw ${thrown || "an exception"}${cpp.module ? ` from ${clean(cpp.module, 60)}` : ""}.`;
  }
  if (!plain && type) plain = `The log reports ${clean(type, 80)}, which ModWrench has no plain-language note for.`;

  // 9. Setup checks.
  const checks = runChecks({
    parsed,
    game,
    ...(system ? { system } : {}),
    leads,
    ...(facts ? { bepinex: facts } : {}),
    install,
    logPlugins,
    modules,
    warnings,
    ...(parsed.timestamp ? { time: parsed.timestamp } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  if (options.gameId !== undefined && game.id !== undefined && game.id !== options.gameId) {
    checks.unshift({
      id: "other-game",
      severity: "note",
      title: `This log is from ${game.name}, not ${clean(options.gameId, 40)}`,
      detail: `You asked about ${clean(options.gameId, 40)}, but the log you gave (or the newest found) was written by ${game.name}, so this answer is about ${game.name}.`,
      basis: "log",
    });
  }
  const tidyChecks = checks.map(tidyCheck);

  // 10. The help packets.
  const time = parsed.timestamp?.slice(0, 16);
  const fault = faultWords(touched);
  const { packets, extra } = buildPackets(
    {
      game,
      format: parsed.detectedType,
      ...(parsed.loggerVersion ? { logger: parsed.loggerVersion } : {}),
      ...(time ? { time } : {}),
      ...(type ? { exceptionType: type } : {}),
      ...(plain ? { exceptionPlain: plain } : {}),
      ...(fault ? { fault } : {}),
      ...(site ? { site } : {}),
      ...(nearest ? { nearest } : {}),
      frames,
      frameCount: allFrames.length,
      leads,
      checks: tidyChecks,
      ...(system ? { system } : {}),
      plugins: parsed.loadedPlugins,
      extenders,
      ...(install.checked ? { scriptExtender: install.scriptExtender ?? null } : {}),
      ...(facts?.unity ? { unity: facts.unity } : {}),
      log: parsed,
      hideNames: options.hideNames === true,
    },
    redactOptions
  );

  // 11. What was removed, in total.
  const byKind = {} as Record<RedactionKind, number>;
  for (const kind of REDACTION_KINDS) byKind[kind] = scrubbed.report.byKind[kind] + extra.byKind[kind];
  const total = REDACTION_KINDS.reduce((sum, kind) => sum + byKind[kind], 0);
  // The same word turns up in the log and in each post made from it: the count that matters is the most of any one.
  const leftover = Math.max(scrubbed.report.leftover, extra.leftover);
  const redaction = {
    summary: describeRedaction({ total, byKind, leftover, cutLines: scrubbed.report.cutLines + extra.cutLines, skippedLines: scrubbed.report.skippedLines }),
    total,
    byKind: byKind as Record<string, number>,
    leftover,
  };

  // 12. How sure.
  const basis: Record<Basis, number> = { log: 0, install: 0, rule: 0, guess: 0 };
  for (const lead of leads) for (const e of lead.evidence) basis[e.basis]++;
  for (const check of tidyChecks) basis[check.basis]++;
  if (plain && explained) basis.rule++;
  if (site) basis.log++;
  const partial = allFrames.length === 0 && leads.length === 0;
  const evidence: CrashWhisperReport["confidence"]["evidence"] = partial ? "partial" : install.checked ? "log-and-install" : "log";
  const counts = basisSentence(basis);
  const base =
    evidence === "partial"
      ? "The log is missing the part that shows where the game stopped, so this rests on thin evidence."
      : evidence === "log-and-install"
        ? `From the log, checked against your install${install.gameVersion ? ` (game ${install.gameVersion})` : ""}. The log shows where the game stopped; who is to blame is a ranking ModWrench made from that, so a lead is a lead, not a finding.`
        : "From the log alone. It shows where the game stopped; who is to blame is a ranking ModWrench made from that, so a lead is a lead, not a finding.";

  const exception = plain || type ? { ...(type ? { type: clean(type, 80) } : {}), plain: plain ?? "" } : undefined;

  const report: CrashWhisperReport = {
    ok: true,
    headline: headlineFor({
      bepinex,
      type,
      hasException: Boolean(type || parsed.exception.description),
      site,
      nearest,
      leads,
      frameCount: allFrames.length,
      problems: tidyChecks.filter((c) => c.severity === "problem").length,
      lastError: parsed.lastError,
      errors: facts?.errorCount ?? 0,
      lastMessage: bepinex ? parsed.exception.description?.replace(/^(?:Fatal|Error):[^:]*:\s*/, "").split(/\r?\n/, 1)[0] : undefined,
      havok,
    }),
    confidence: { evidence, summary: `${base} ${counts}`, basis },
    crash: {
      game: {
        name: game.name,
        ...(game.version ? { version: game.version } : {}),
        ...(game.id ? { id: game.id } : {}),
      },
      format: parsed.detectedType,
      ...(parsed.loggerVersion ? { logger: clean(parsed.loggerVersion, 100) } : {}),
      ...(exception ? { exception } : {}),
      ...(site ? { site } : {}),
      ...(nearest ? { nearest } : {}),
      frames,
      ...(context ? { context } : {}),
      pluginCount: parsed.loadedPlugins.length,
      ...(parsed.pluginList ? { pluginList: parsed.pluginList } : {}),
      ...(parsed.timestamp ? { time: parsed.timestamp.slice(0, 16) } : {}),
      ...(written ? { written } : {}),
      ...(fileName ? { fileName: safeName(redact(fileName, redactOptions).text, 80) } : {}),
      source,
    },
    ...(system ? { system } : {}),
    leads,
    checks: tidyChecks,
    packets,
    redaction,
    install: {
      checked: install.checked,
      ...(install.reason ? { reason: install.reason } : {}),
      ...(install.gameVersion ? { gameVersion: install.gameVersion } : {}),
      ...(install.scriptExtender !== undefined ? { scriptExtender: install.scriptExtender } : {}),
      ...(install.modFolders !== undefined ? { modFolders: install.modFolders } : {}),
    },
    recent: { examined: recent.length },
    limits: limitsFor({
      bepinex,
      install,
      recentExamined: recent.length,
      recentOutOfTime,
      cut,
      source,
      game,
      ...(chosen ? { looked: chosen } : {}),
      skipped,
    }),
    nextSteps: nextStepsFor({
      leads,
      checks: tidyChecks,
      game,
      install,
      bepinex,
      site,
      mods: bepinex && parsed.pluginList === "listed" ? parsed.loadedPlugins.map((p) => p.name) : undefined,
      errors: facts?.errorCount ?? 0,
      nearest,
      context,
      pluginCount: parsed.pluginList === "listed" ? parsed.loadedPlugins.length : undefined,
      pluginList: parsed.pluginList,
      havok,
    }),
  };
  return report;
}

