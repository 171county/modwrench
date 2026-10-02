import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { parseCrashlog } from "../crashlog/index.js";
import type { CrashlogParseResult, CrashlogType } from "../crashlog/types.js";
import { clean } from "../patchday/summary.js";
import { scanBepInEx, type BepInExFacts } from "./bepinex-scan.js";
import { runChecks } from "./checks.js";
import { readInstallContext, type InstallContext } from "./context.js";
import {
  describeGame,
  explainException,
  moduleBase,
  readCppException,
  readSystem,
  type Fault,
  type GameFacts,
} from "./explain.js";
import { CRASH_LOG_GAMES, findCrashLogs, readLogFile, type FoundLog } from "./find.js";
import { buildPackets } from "./packet.js";
import { leadKey, POSSIBLE_AT, rankWithKeys, toFrame, type RankOptions } from "./rank.js";
import { describeRedaction, redact, REDACTION_KINDS, type RedactOptions, type RedactionKind } from "./redact.js";
import { basisSentence, plural, safeName } from "./text.js";
import type {
  Basis,
  Check,
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

function readModules(section: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!section) return out;
  for (const raw of section.split(/\r?\n/).slice(0, 4000)) {
    const first = /^\s*(\S+)/.exec(raw)?.[1];
    if (first) out.add(moduleBase(first.replace(/^.*[\\/]/, "")));
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

const signature = (text: string): string => createHash("sha1").update(text.trim()).digest("hex");

// ─── Comparing with the other recent logs ────────────────────────────────────

function recentLeadKeys(
  logs: FoundLog[],
  current: { hash: string; abs?: string },
  type: CrashlogType,
  limit: number,
  redactOptions: RedactOptions,
): ReadonlySet<string>[] {
  const out: ReadonlySet<string>[] = [];
  for (const log of logs) {
    if (out.length >= limit) break;
    if (log.abs === current.abs || log.size > MAX_RECENT_BYTES || !/^crash-/i.test(log.name)) continue;
    const read = readLogFile(log.abs, MAX_RECENT_BYTES);
    if (!read) continue;
    if (signature(read.text) === current.hash) continue;
    const parsed = parseCrashlog({ logContent: redact(read.text, redactOptions).text, logType: type });
    if (!parsed.ok || parsed.detectedType !== type) continue;
    const keys = new Set<string>();
    for (const { lead, keys: own } of rankWithKeys(parsed)) {
      if (lead.score >= POSSIBLE_AT) own.forEach((k) => keys.add(k));
    }
    out.push(keys);
  }
  return out;
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

function headlineFor(a: {
  bepinex: boolean;
  type: string | undefined;
  hasException: boolean;
  site: Frame | undefined;
  leads: Lead[];
  frameCount: number;
  problems: number;
}): string {
  const text = headlineCore(a);
  return a.problems > 0
    ? `${text} The checks below found ${a.problems === 1 ? "a problem" : `${a.problems} problems`} in your setup that ${a.problems === 1 ? "is" : "are"} worth fixing first.`
    : text;
}

function headlineCore(a: {
  bepinex: boolean;
  type: string | undefined;
  hasException: boolean;
  site: Frame | undefined;
  leads: Lead[];
  frameCount: number;
}): string {
  const what = a.type ? clean(a.type, 80) : "an unhandled exception";
  const crashed = a.bepinex ? `BepInEx logged ${what}` : `The game crashed with ${what}`;
  if (!a.hasException && a.frameCount === 0) {
    return a.bepinex
      ? "This BepInEx log has no errors in it, so it doesn't say why the game closed. Look at the checks below for what it does show."
      : "ModWrench read the log but couldn't find a crash in it. Look at the checks below for what it does show.";
  }
  const [first, second] = a.leads;
  if (first?.strength === "strong") {
    return `${crashed}, and the strongest lead is ${clean(first.name, 80)}: ${lowerFirst(first.summary)}`;
  }
  if (first?.strength === "possible") {
    return second
      ? `${crashed}. The log doesn't pin it on one name: ${clean(first.name, 80)} is the best lead, then ${clean(second.name, 60)}, and neither is certain.`
      : `${crashed}. The log doesn't pin it firmly on any one name: ${clean(first.name, 80)} is the best lead, but it isn't certain.`;
  }
  if (first) {
    return `${crashed}. Nothing in the log points firmly at any one mod; ${clean(first.name, 80)} is only a faint lead.`;
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
}): string[] {
  const steps: string[] = [];
  const add = (step: string | undefined): void => {
    if (step && !steps.includes(step) && steps.length < 5) steps.push(step);
  };
  for (const check of a.checks.filter((c) => c.severity === "problem").slice(0, 2)) add(check.fix);
  const top = a.leads[0];
  if (top && top.strength !== "faint") {
    const target = top.files[0] ?? top.name;
    add(
      `Turn off ${clean(target, 80)} (or move it out of its folder) and try to make the game crash the same way again. If the crash is gone, that was it; if it simply moves to another name, ${clean(target, 80)} was only a bystander.`
    );
    add(
      `Look at ${clean(top.name, 80)}'s mod page for a build made for ${a.game.version ? `game version ${a.game.version}` : "your game version"} and for other people reporting this crash.`
    );
  } else {
    add(
      "No name stands out, so narrow it down by halves: turn off half of your mods and see whether it still crashes, then keep halving whichever half does. A mod manager with profiles makes this quick."
    );
  }
  if (a.install.checked && a.checks.some((c) => c.id === "game-updated")) {
    add("The game was updated after this crash, so run Patch Day to see which plugins don't match the version you have now.");
  }
  add(
    "To ask for help, ask for a help packet for the place you will post (a forum, a GitHub issue, Discord, or the mod's author). ModWrench takes out the personal details it recognises (your user name, folders, addresses, keys), and you can read it before you post."
  );
  return steps;
}

/** A log too big to read whole: the file's size and how much of its start and end was read. */
type CutInfo = { size: number; head: number; tail: number };

function limitsFor(a: {
  bepinex: boolean;
  install: InstallContext;
  recentExamined: number;
  cut: CutInfo | undefined;
  source: "newest" | "path" | "pasted";
  game: GameFacts;
  looked?: FoundLog;
}): string[] {
  const limits = [
    "A crash log records where the game stopped, not why. A lead is a name the log points at, ranked by ModWrench's own scoring; the top lead can still be innocent, and the real cause can be something that isn't on the list.",
    "Reading the log and your install happens on this computer, and ModWrench stores and sends nothing. What this answer says goes to the AI model you are talking to, and so does a help packet if you ask for one. Before anything reads the log, ModWrench takes out the personal details it recognises: your user name and computer name, folders, addresses and keys.",
    "Removal covers what ModWrench recognises, not everything. Mod and file names are kept as the log wrote them, and a packet includes your hardware (system, processor, graphics card, memory) when the log has it, because memory crashes are common. Read a packet before you post it.",
    "The log file on your disk is left exactly as it is, with everything in it. To share a crash, post a help packet; don't attach or paste the file itself.",
  ];
  if (a.source === "newest" && a.looked) {
    limits.push(
      `No log was given, so ModWrench read the newest it found (a ${a.game.name} log). If you meant a different crash or game, paste the log or pass gameId.`
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
  };
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
    chosen = found.logs[0];
    if (!chosen) {
      return fail(
        "No crash log found.",
        "Crash Whisperer reads logs written by Crash Logger SSE, Buffout 4, NetScriptFramework and BepInEx. If your game crashed and wrote none, a crash logger for your game is what makes the next one readable. You can also paste a log's text in logContent or give its file in logPath.",
        found.looked
      );
    }
    const read = readLogFile(chosen.abs);
    if (!read) return fail("ModWrench found a crash log but couldn't read it.", undefined, found.looked);
    text = read.text;
    cut = read.cut ? { size: read.size, head: read.head, tail: read.tail } : undefined;
    source = "newest";
    abs = chosen.abs;
    fileName = chosen.name;
    written = minute(chosen.mtimeMs);
  }

  if (text.trim().length === 0) return fail("The log is empty.", "Paste the whole log, or pick the file with logPath.");

  const hash = signature(text);

  // 2. Take the person out of it before anything else reads it.
  const scrubbed = redact(text, redactOptions);
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
  const modules = readModules(parsed.rawSections["MODULES"]);
  const warnings = readWarnings(clear);

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
  const wantRecent = Math.min(MAX_RECENT, Math.max(0, Math.floor(options.compareRecent ?? DEFAULT_RECENT)));
  if (wantRecent > 0 && (parsed.detectedType === "crashlogger-sse" || parsed.detectedType === "buffout4") && game.id) {
    const siblings = findCrashLogs({
      gameId: game.id,
      ...(options.gamePath !== undefined ? { gamePath: options.gamePath } : {}),
    }).logs;
    recent = recentLeadKeys(siblings, { hash, ...(abs !== undefined ? { abs } : {}) }, parsed.detectedType, wantRecent, redactOptions);
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
  const allFrames = parsed.callStack.map((f, i) => toFrame(f, i, plugins));
  const leadKeys = new Set(ranked.flatMap((r) => r.keys));
  const picked = new Map<number, Frame>();
  allFrames.slice(0, 12).forEach((f) => picked.set(f.index, f));
  for (const frame of allFrames) {
    if (frame.kind === "mod" && leadKeys.has(leadKey(frame.module)) && !picked.has(frame.index)) picked.set(frame.index, frame);
  }
  const frames = [...picked.values()].sort((a, b) => a.index - b.index).map(tidyFrame);
  const site = allFrames[0] ? tidyFrame(allFrames[0]) : undefined;

  // 8. What the exception means.
  const type = parsed.exception.type ?? (cpp?.type ? "C++ exception" : undefined);
  const explained = explainException(parsed.exception.type, parsed.exception.description, parsed.exception.fault);
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
  const fault = faultWords(parsed.exception.fault);
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
      frames,
      frameCount: allFrames.length,
      leads,
      checks: tidyChecks,
      ...(system ? { system } : {}),
      plugins: parsed.loadedPlugins,
      extenders,
      ...(install.checked ? { scriptExtender: install.scriptExtender ?? null } : {}),
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
      leads,
      frameCount: allFrames.length,
      problems: tidyChecks.filter((c) => c.severity === "problem").length,
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
      frames,
      pluginCount: parsed.loadedPlugins.length,
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
      cut,
      source,
      game,
      ...(chosen ? { looked: chosen } : {}),
    }),
    nextSteps: nextStepsFor({ leads, checks: tidyChecks, game, install, bepinex }),
  };
  return report;
}

