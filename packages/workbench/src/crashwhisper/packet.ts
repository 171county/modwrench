import { PLAYER_FORM_IDS, type CrashlogParseResult, type CrashlogType, type LoadedPlugin, type SuspectedRef } from "../crashlog/types.js";
import { KIND_PHRASE, classifyModule, formatName, gameFiles, strayAddress, type GameFacts } from "./explain.js";
import { redact, type RedactOptions, type RedactionKind, type RedactionReport, REDACTION_KINDS } from "./redact.js";
import { gb, plural, safeName } from "./text.js";
import { VENUES, type Basis, type Check, type Frame, type HelpPacket, type Lead, type SystemFacts, type Venue } from "./types.js";

// ─── The Help Packet ─────────────────────────────────────────────────────────
// Getting help with a crash means posting something: in a forum thread, in a GitHub
// issue, in a Discord channel, or in a message to the mod's author. Each place wants a
// different amount of it in a different shape, and each helper wants the same few
// facts first (the game and its version, what crashed, where, and what else was
// loaded). This writes that post once per place, from what the log says, with the
// personal details already taken out and the player's own blanks left to fill in.
//
// The text is built from the log's facts, never copied from it, so names come through
// one at a time and short. Square brackets, angle brackets, backticks and "@" in a name
// are swapped for look-alikes: a mod can be called anything, and a post must not turn
// into markup, a ping or a broken code block because of one. The finished text goes
// through the redactor once more as a last check.

export type PacketData = {
  game: GameFacts;
  format: CrashlogType;
  /** The logger's own version line. */
  logger?: string;
  /** When the log says it happened, in the player's local time. */
  time?: string;
  exceptionType?: string;
  exceptionPlain?: string;
  /** The memory the access touched, in words: "reading address 0x8". */
  fault?: string;
  /** Where it stopped. */
  site?: Frame;
  /** When the site is in no module the log lists: the first frame under it that is in one. */
  nearest?: Frame;
  /** The frames worth printing: the top of the stack and the first frame of each lead. */
  frames: Frame[];
  /** How many frames the log had. */
  frameCount: number;
  leads: Lead[];
  checks: Check[];
  system?: SystemFacts;
  plugins: LoadedPlugin[];
  /** From the log's SKSE PLUGINS or F4SE PLUGINS section. */
  extenders: Array<{ name: string; version?: string }>;
  scriptExtender?: string | null;
  /** Unity's version, from a BepInEx log. */
  unity?: string;
  /** More of what the parser read, uncleaned: every name in it goes through safeName where it is printed. */
  log?: LogFacts;
  /** Leave the plugin lists out: only the names the log points at appear, including every plugin that changed an object it names. */
  hideNames: boolean;
};

/**
 * Whether the log has its plugin list; the objects, game files, register types and Papyrus functions it names; its
 * module list; the Address Library id of each frame; and, for BepInEx, whether its last error is an exception.
 */
export type LogFacts = Pick<
  CrashlogParseResult,
  "pluginList" | "modules" | "registerTypes" | "suspectedRefs" | "assetPaths" | "papyrus" | "lastError" | "callStack"
>;

const WHERE: Record<Venue, string> = {
  forum: "A forum thread: a mod page's comments, or a Reddit, Bethesda or Steam thread.",
  github: "A GitHub issue on the mod's repository.",
  discord: "A Discord help channel, as a single message.",
  author: "A message to the author of the mod the log points at.",
};

/** The most each place takes comfortably. Discord's limit is 2,000 characters for most people. */
const BUDGET: Record<Venue, number> = { forum: 24_000, github: 30_000, discord: 1_900, author: 4_000 };

type Plan = {
  plugins: boolean;
  extenders: boolean;
  frames: number;
  evidence: boolean;
  leads: number;
  checks: "all" | "problems" | "none";
  /** The objects, game files, register types and Papyrus functions the log names. */
  context: boolean;
};

const PLANS: Plan[] = [
  { plugins: true, extenders: true, frames: 14, evidence: true, leads: 5, checks: "all", context: true },
  { plugins: false, extenders: true, frames: 14, evidence: true, leads: 5, checks: "all", context: true },
  { plugins: false, extenders: false, frames: 12, evidence: true, leads: 4, checks: "all", context: true },
  { plugins: false, extenders: false, frames: 8, evidence: false, leads: 3, checks: "problems", context: true },
  { plugins: false, extenders: false, frames: 5, evidence: false, leads: 2, checks: "none", context: false },
];

const SHORT_PLANS: Plan[] = [
  { plugins: false, extenders: false, frames: 8, evidence: false, leads: 3, checks: "problems", context: true },
  { plugins: false, extenders: false, frames: 6, evidence: false, leads: 2, checks: "none", context: true },
  { plugins: false, extenders: false, frames: 4, evidence: false, leads: 1, checks: "none", context: false },
  { plugins: false, extenders: false, frames: 2, evidence: false, leads: 1, checks: "none", context: false },
];

const BASIS_WORD: Record<Basis, string> = { log: "log", install: "my files", rule: "rule", guess: "guess" };
const FOOTER =
  "Made with ModWrench's Crash Whisperer. Personal details it recognised (folder paths, user and computer names, addresses, keys) were taken out. Mod and file names are as the log wrote them, except that square brackets are shown as round ones, angle brackets and backticks as look-alikes, the at sign as (at), and runs of spaces as one space, so that no name can turn into markup or a ping.";

// ─── Pieces ──────────────────────────────────────────────────────────────────

function gameLine(g: GameFacts): string {
  return `${safeName(g.name, 60)}${g.version ? ` ${safeName(g.version, 24)}` : ""}`;
}

/** What the parsers call a frame the logger placed in no module. */
const NO_MODULE = "(unknown)";

function frameRow(f: Frame, withFunction = true, addressId?: string): string {
  const where = f.module === NO_MODULE ? "(an address in no module)" : `${safeName(f.module, 60)}${f.offset ? `+${safeName(f.offset, 16)}` : ""}`;
  const id = addressId ? ` -> ${safeName(addressId, 30)}` : "";
  const fn = withFunction && f.function ? `  ${safeName(f.function, 90)}` : "";
  return `[${f.index}] ${where}${id}${fn}${f.scan ? "  (stack scan)" : ""}`;
}

/** What ModWrench knows a frame's module to be ("Mod Organizer 2's virtual file system"), or that the log lists two of its name. */
function moduleWords(f: Frame): string | undefined {
  if (f.copies) return `Windows' own ${safeName(f.module, 60)} or a graphics mod's copy of it: the log lists ${f.copies}`;
  return f.about ? safeName(f.about, 120) : undefined;
}

/**
 * The call stack's rows. A game frame keeps the Address Library id the logger wrote after it ("-> 1242880+0x1FE"),
 * which helpers look a function up by. A run of frames in no module, often values left on the stack, is one row.
 * The first frame of a module ModWrench knows says what that module is.
 */
function stackRows(d: PacketData, shown: Frame[]): string[] {
  const ids = new Map<number, string>();
  (d.log?.callStack ?? []).forEach((f, i) => {
    if (f.addressId) ids.set(f.index ?? i, f.addressId);
  });
  const rows: string[] = [];
  const told = new Set<string>();
  for (let i = 0; i < shown.length; i++) {
    const f = shown[i]!;
    let end = i;
    while (f.module === NO_MODULE && shown[end + 1]?.module === NO_MODULE) end++;
    if (end === i) {
      const words = told.has(f.module.toLowerCase()) ? undefined : moduleWords(f);
      if (words) told.add(f.module.toLowerCase());
      rows.push(`${frameRow(f, true, ids.get(f.index))}${words ? `  (${words})` : ""}`);
      continue;
    }
    const run = shown.slice(i, end + 1);
    rows.push(`[${f.index}]-[${shown[end]!.index}] (${run.length} addresses in no module)${run.every((r) => r.scan) ? "  (stack scan)" : ""}`);
    i = end;
  }
  return rows;
}

/** The frames that fill this many rows of the call stack, a run of frames in no module being one row, as stackRows prints it. */
function shownFrames(d: PacketData, rows: number): Frame[] {
  const out: Frame[] = [];
  let used = 0;
  for (const f of d.frames) {
    if (f.module !== NO_MODULE || out[out.length - 1]?.module !== NO_MODULE) {
      if (used === rows) break;
      used++;
    }
    out.push(f);
  }
  return out;
}

function systemLine(s: SystemFacts | undefined): string | undefined {
  if (!s) return undefined;
  const parts: string[] = [];
  if (s.os) parts.push(safeName(s.os, 70));
  if (s.cpu) parts.push(safeName(s.cpu, 70));
  for (const gpu of s.gpus.slice(0, 2)) parts.push(safeName(gpu, 70));
  if (s.ram) parts.push(`RAM ${gb(s.ram.used)}/${gb(s.ram.total)} GB`);
  if (s.vram) parts.push(`VRAM ${gb(s.vram.used)}/${gb(s.vram.budget)} GB`);
  if (s.commit) parts.push(`commit ${gb(s.commit.used)}/${gb(s.commit.total)} GB`);
  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function pluginCounts(plugins: LoadedPlugin[]): string {
  const light = plugins.filter((p) => /^FE\b/i.test(p.loadIndex ?? "")).length;
  return `${plugins.length} loaded${light > 0 ? ` (${light} light)` : ""}`;
}

/** The plugin count, or why there is none: an empty list is "no plugins" only when the log carries the list. */
function pluginSummary(d: PacketData): string {
  if (d.log?.pluginList === "absent") return "this log doesn't list them";
  if (d.log?.pluginList === "failed") return `${formatName(d.format)} couldn't write the list in this log. My load order: (fill in)`;
  return pluginCounts(d.plugins);
}

const pluginListed = (d: PacketData): boolean => d.log?.pluginList === undefined || d.log.pluginList === "listed";

function pluginRow(p: LoadedPlugin): string {
  return `${p.loadIndex ? `[${safeName(p.loadIndex, 8)}] ` : ""}${safeName(p.name, 80)}${p.version ? ` v${safeName(p.version, 24)}` : ""}`;
}

/** Fallout 4's script extender is F4SE; the list Crash Logger SSE writes is SKSE's. */
function extenderTitle(d: PacketData): string {
  return `${/^fallout4/.test(d.game.id ?? "") ? "F4SE" : "SKSE"} plugins (${d.extenders.length})`;
}

/**
 * A NetScriptFramework log has no list of script extender plugins. Its module list stands in, without the Windows
 * libraries ModWrench knows, with each DLL's load address (a DLL loaded at its own preferred address, as an ENB
 * d3d11.dll often is, shows a round one such as 0x180000000).
 */
function moduleList(d: PacketData): { title: string; rows: string[] } | undefined {
  const all = d.log?.modules ?? [];
  if (d.extenders.length > 0 || all.length === 0) return undefined;
  const shown = all.filter((m) => classifyModule(m.name) !== "system");
  return {
    title: `DLLs loaded (${shown.length} of ${all.length}; the Windows libraries ModWrench knows are left out)`,
    rows: shown.map((m) => `${safeName(m.name, 80)}${m.base ? ` ${safeName(m.base, 20)}` : ""}`),
  };
}

/** "SkyrimSE.exe+10EE1C0", without the frame number. */
function frameWhere(f: Frame): string {
  if (f.module === NO_MODULE) return "an address in no module";
  return `${safeName(f.module, 60)}${f.offset ? `+${safeName(f.offset, 16)}` : ""}`;
}

/** The top lead, unless it is faint: a faint lead is no clear name, so no title or author post is built on it. */
function clearLead(d: PacketData): Lead | undefined {
  const lead = d.leads[0];
  return lead && lead.strength !== "faint" ? lead : undefined;
}

/** Plain C types say nothing about what the code was working on; a class name ("hknpStreamContactSolver*") can. */
const PLAIN_TYPE = /^(?:void\*|size_t|char\*)$/;

type Section = { title: string; label: string; rows: string[] };

function objectRow(r: SuspectedRef): string {
  const what = [safeName(r.value, 12), r.kind ? safeName(r.kind, 40) : "", r.name ? `"${safeName(r.name, 60)}"` : ""].filter((x) => x !== "");
  const notes = [
    PLAYER_FORM_IDS.has(r.value) ? "the player" : "",
    r.origin === "register" ? "in a register" : r.origin === "stack" ? "on the stack" : "",
  ].filter((x) => x !== "");
  const plugins = (r.plugins ?? (r.likelySource ? [r.likelySource] : [])).map((name) => safeName(name, 80));
  return `${what.join(" ")}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}${plugins.length > 0 ? `: ${plugins.join(", ")}` : ""}`;
}

/** What the log says the game was working on: the objects, game files, register types and Papyrus functions it names. */
function contextSections(d: PacketData): Section[] {
  const log = d.log;
  if (!log) return [];
  const out: Section[] = [];
  const refs = (log.suspectedRefs ?? []).filter((r) => r.origin !== undefined);
  if (refs.length > 0) {
    out.push({
      title: refs.every((r) => r.origin === "objects")
        ? "Objects the logger lists as possibly involved (plugins in load order: the last one changed it last)"
        : "Objects the logger printed beside the registers and stack (weaker: the game may have finished with them; plugins in load order: the last one changed it last)",
      label: "Objects",
      rows: refs.slice(0, 10).map(objectRow),
    });
  }
  const files = gameFiles(log.assetPaths ?? []);
  if (files.length > 0) {
    out.push({ title: "Game files named in the registers and stack", label: "Files", rows: files.map((a) => safeName(a, 120)) });
  }
  const types = Object.entries(log.registerTypes ?? {}).filter(([, type]) => !PLAIN_TYPE.test(type));
  if (types.length > 0) {
    out.push({ title: "Object types in the registers", label: "Types", rows: types.map(([reg, type]) => `${safeName(reg, 8)} ${safeName(type, 80)}`) });
  }
  if (log.papyrus && log.papyrus.length > 0) {
    out.push({
      title: "Papyrus functions named in the registers and stack",
      label: "Papyrus",
      rows: log.papyrus.map((f) => `${safeName(f.script, 60)}.${safeName(f.function, 60)}${f.native ? " (native)" : ""}`),
    });
  }
  return out;
}

function happened(d: PacketData): string {
  const bepinex = d.format === "bepinex";
  const what = d.exceptionType ? safeName(d.exceptionType, 80) : bepinex ? "an error" : "an unhandled exception";
  // BepInEx's log runs for the whole session: its last error need not be an exception, and the game can go on past it.
  const lastError = bepinex ? d.log?.lastError : undefined;
  const parts = [
    lastError?.exception === false
      ? "BepInEx logged an error that is not an exception: it names no exception type and has no stack trace."
      : bepinex && d.log && !lastError && !d.exceptionType
        ? "This BepInEx log has no errors in it, so it doesn't say why the game closed."
        : `${bepinex ? "BepInEx logged" : "The game crashed with"} ${what}.`,
  ];
  if (d.exceptionPlain) parts.push(safeName(d.exceptionPlain, 600));
  // The plain-language note already says which address when it is a tiny one.
  if (d.fault && !/\baddress 0x?[0-9A-Fa-f]/.test(d.exceptionPlain ?? "")) parts.push(`It was ${safeName(d.fault, 80)}.`);
  if (d.site) {
    const words = moduleWords(d.site);
    parts.push(
      d.site.address
        ? `It stopped at frame ${d.site.index}, at ${strayAddress(safeName(d.site.address, 24))}.`
        : `${bepinex ? "The error began" : "It stopped"} at ${frameWhere(d.site)} (frame ${d.site.index})${words ? `, in ${words}` : ""}.`
    );
  }
  if (d.nearest) {
    parts.push(
      `The first frame the log can place is frame ${d.nearest.index}, ${frameWhere(d.nearest)} (${moduleWords(d.nearest) ?? KIND_PHRASE[d.nearest.kind]}).`
    );
  }
  if (lastError && lastError.entriesAfter > 0) {
    parts.push(`BepInEx wrote ${plural(lastError.entriesAfter, "more entry", "more entries")} after it, so the game went on running past it.`);
  }
  if (d.time) parts.push(`The log puts it at ${safeName(d.time, 24)} by its own clock.`);
  return parts.join(" ");
}

function titleFor(d: PacketData): string {
  const bepinex = d.format === "bepinex";
  const exception = d.exceptionType ? ` (${safeName(d.exceptionType, 60)})` : "";
  // Helpers search for a crash by the address it stopped at ("SkyrimSE.exe+D6DDDA"). A BepInEx frame has none.
  const site = !bepinex && d.site && d.site.module !== NO_MODULE ? d.site : undefined;
  const at = site ? ` at ${frameWhere(site)}` : "";
  // The lead is left out when the address already names it.
  const lead = clearLead(d);
  const named = lead && !(site && lead.files.some((f) => f.toLowerCase() === site.module.toLowerCase())) ? lead : undefined;
  const involving = named ? ` involving ${safeName(named.name, 50)}` : "";
  return `${gameLine(d.game)}: ${bepinex ? "error" : "crash"}${at}${involving}${exception}`;
}

function checkLines(d: PacketData, p: Plan, prefix: string): string[] {
  if (p.checks === "none") return [];
  const use = d.checks.filter((c) => (p.checks === "all" ? c.severity !== "info" : c.severity === "problem"));
  return use.slice(0, 8).map((c) => `${prefix}${c.severity === "problem" ? "Problem" : "Note"}: ${safeName(c.title, 140)}. ${safeName(c.detail, 320)}`);
}

/** Why no name stood out, from what the log has: a BepInEx log names mods by namespace, and not every log lists objects. */
function noLead(d: PacketData): string {
  if (d.format === "bepinex") return "No mod stood out: no mod that loaded is named in what BepInEx logged.";
  return (d.log?.suspectedRefs ?? []).some((r) => r.origin !== undefined)
    ? "No mod stood out: nothing from a mod was on the call stack, and none of the objects the log lists comes from a mod's plugin."
    : "No mod stood out: nothing from a mod was on the call stack, and the log lists no objects the game was working with.";
}

/** " (RaceMenu)": the mod a well-known DLL comes with, to put after its name. */
const modNote = (lead: Lead): string => (lead.mod ? ` (${safeName(lead.mod, 60)})` : "");

function leadLines(d: PacketData, p: Plan, style: "plain" | "markdown"): string[] {
  const out: string[] = [];
  d.leads.slice(0, p.leads).forEach((lead, i) => {
    const name = safeName(lead.name, 80);
    out.push(
      style === "markdown"
        ? `${i + 1}. \`${name}\`${modNote(lead)} (${lead.strength}): ${safeName(lead.summary, 240)}`
        : `${i + 1}. ${name}${modNote(lead)} (${lead.strength} lead): ${safeName(lead.summary, 240)}`
    );
    if (p.evidence) {
      for (const e of lead.evidence.slice(0, 5)) out.push(`   - (${BASIS_WORD[e.basis]}) ${safeName(e.text, 300)}`);
    }
  });
  return out;
}

function listBlock(rows: string[], indent: string): string[] {
  return rows.map((r) => `${indent}${r}`);
}

// ─── Each place ──────────────────────────────────────────────────────────────

/** What a post calls what happened: BepInEx logs an error, which need not have stopped the game. */
const eventWord = (d: PacketData): string => (d.format === "bepinex" ? "error" : "crash");

function forumBody(d: PacketData, p: Plan): string {
  const lines: string[] = [];
  lines.push("What happened", happened(d), "");

  lines.push("My setup", `Game: ${gameLine(d.game)}`);
  if (d.scriptExtender) lines.push(`Script extender: ${safeName(d.scriptExtender, 60)}`);
  lines.push(`Log written by: ${formatName(d.format)}${d.logger ? ` (${safeName(d.logger, 80)})` : ""}`);
  if (d.unity) lines.push(`Unity: ${safeName(d.unity, 40)}`);
  const system = systemLine(d.system);
  if (system) lines.push(`System: ${system}`);
  lines.push(`Plugins: ${pluginSummary(d)}`, "");

  if (d.leads.length > 0) {
    lines.push(
      "What the log points at",
      `Ranked by how directly each name sits in the ${eventWord(d)}. These are leads, not findings.`,
      ...leadLines(d, p, "plain"),
      ""
    );
  } else {
    lines.push("What the log points at", noLead(d), "");
  }

  const checks = checkLines(d, p, "- ");
  if (checks.length > 0) lines.push("Setup checks", ...checks, "");

  const shown = shownFrames(d, p.frames);
  if (shown.length > 0) {
    lines.push(`Call stack (${shown.length} of ${d.frameCount} frames)`, ...listBlock(stackRows(d, shown), "    "), "");
  }
  if (p.context) for (const section of contextSections(d)) lines.push(section.title, ...listBlock(section.rows, "    "), "");

  if (d.hideNames) {
    lines.push(`Plugin lists left out on purpose${pluginListed(d) ? ` (${pluginCounts(d.plugins)})` : ""}.`, "");
  } else {
    if (p.extenders && d.extenders.length > 0) {
      lines.push(
        extenderTitle(d),
        ...listBlock(d.extenders.map((e) => `${safeName(e.name, 80)}${e.version ? ` v${safeName(e.version, 24)}` : ""}`), "    "),
        ""
      );
    }
    const modules = moduleList(d);
    if (p.extenders && modules) lines.push(modules.title, ...listBlock(modules.rows, "    "), "");
    if (p.plugins && d.plugins.length > 0) {
      lines.push(`Plugin list (${d.plugins.length})`, ...listBlock(d.plugins.slice(0, 600).map(pluginRow), "    "));
      if (d.plugins.length > 600) lines.push(`    …and ${d.plugins.length - 600} more`);
      lines.push("");
    }
  }

  lines.push(`What changed before the first ${eventWord(d)}: (fill in)`, "What I have already tried: (fill in)", "", FOOTER);
  return lines.join("\n");
}

function githubBody(d: PacketData, p: Plan): string {
  const lines: string[] = [];
  lines.push("## Summary", "", happened(d), "");

  lines.push("## Environment", "", `- Game: ${gameLine(d.game)}`);
  if (d.scriptExtender) lines.push(`- Script extender: ${safeName(d.scriptExtender, 60)}`);
  lines.push(`- Log written by: ${formatName(d.format)}${d.logger ? ` (${safeName(d.logger, 80)})` : ""}`);
  if (d.unity) lines.push(`- Unity: ${safeName(d.unity, 40)}`);
  const system = systemLine(d.system);
  if (system) lines.push(`- System: ${system}`);
  lines.push(`- Plugins: ${pluginSummary(d)}`, "");

  lines.push("## What the log points at", "");
  if (d.leads.length > 0) {
    lines.push(`Ranked by how directly each name sits in the ${eventWord(d)}. These are leads, not findings.`, "", ...leadLines(d, p, "markdown"), "");
  } else {
    lines.push(noLead(d), "");
  }

  const checks = checkLines(d, p, "- ");
  if (checks.length > 0) lines.push("## Setup checks", "", ...checks, "");

  const shown = shownFrames(d, p.frames);
  if (shown.length > 0) {
    lines.push(`## Call stack (${shown.length} of ${d.frameCount} frames)`, "", "```", ...stackRows(d, shown), "```", "");
  }
  if (p.context) for (const section of contextSections(d)) lines.push(`## ${section.title}`, "", "```", ...section.rows, "```", "");

  if (d.hideNames) {
    lines.push(`Plugin lists left out on purpose${pluginListed(d) ? ` (${pluginCounts(d.plugins)})` : ""}.`, "");
  } else {
    if (p.extenders && d.extenders.length > 0) {
      lines.push(
        `<details><summary>${extenderTitle(d)}</summary>`,
        "",
        "```",
        ...d.extenders.map((e) => `${safeName(e.name, 80)}${e.version ? ` v${safeName(e.version, 24)}` : ""}`),
        "```",
        "",
        "</details>",
        ""
      );
    }
    const modules = moduleList(d);
    if (p.extenders && modules) lines.push(`<details><summary>${modules.title}</summary>`, "", "```", ...modules.rows, "```", "", "</details>", "");
    if (p.plugins && d.plugins.length > 0) {
      lines.push(
        `<details><summary>Plugin list (${d.plugins.length})</summary>`,
        "",
        "```",
        ...d.plugins.slice(0, 600).map(pluginRow),
        ...(d.plugins.length > 600 ? [`…and ${d.plugins.length - 600} more`] : []),
        "```",
        "",
        "</details>",
        ""
      );
    }
  }

  lines.push("## Steps to reproduce", "", "(fill in)", "", "## What I expected", "", "(fill in)", "", "---", FOOTER);
  return lines.join("\n");
}

function discordBody(d: PacketData, p: Plan): string {
  const lines: string[] = [];
  const bepinex = d.format === "bepinex";
  lines.push(`**${gameLine(d.game)} ${bepinex ? "error" : "crash"}**${d.exceptionType ? ` (${safeName(d.exceptionType, 60)})` : ""}`);
  const where = d.site
    ? `${bepinex ? "Began" : "Stopped"} at ${d.site.address ? `${safeName(d.site.address, 24)}, an address in no module` : frameWhere(d.site)}. `
    : "";
  const top = d.leads.slice(0, p.leads);
  if (top.length > 0) {
    const first = top[0]!;
    const others = top.slice(1).map((l) => `${safeName(l.name, 50)}${modNote(l)} (${l.strength})`);
    lines.push(
      `${where}Top lead: ${safeName(first.name, 60)}${modNote(first)} (${first.strength}). ${safeName(first.summary, 160)}${others.length > 0 ? ` Also: ${others.join(", ")}.` : ""}`
    );
  } else if (where) {
    lines.push(`${where}No mod stood out.`);
  }
  const shown = shownFrames(d, p.frames);
  if (shown.length > 0) lines.push("```", ...stackRows(d, shown), "```");
  // In code, so a type's "*", or a backslash or "_" in a path, can't turn into Discord formatting. safeName leaves no backtick.
  if (p.context) for (const section of contextSections(d)) lines.push(`${section.label}: \`${section.rows.slice(0, 3).join("; ")}\``);
  const bits: string[] = [];
  const system = systemLine(d.system);
  if (system) bits.push(system);
  bits.push(
    d.log?.pluginList === "absent"
      ? "no plugin list in the log"
      : d.log?.pluginList === "failed"
        ? "the logger couldn't write the plugin list"
        : plural(d.plugins.length, "plugin", "plugins")
  );
  lines.push(bits.join(" | "));
  const problems = checkLines(d, p, "");
  if (problems.length > 0) lines.push(...problems.slice(0, 2).map((c) => c.slice(0, 220)));
  lines.push("More details if it helps.");
  return lines.join("\n");
}

/**
 * The game stopped inside a library other mods call (RaceMenu's skee64.dll): the crash can come from what the mod that
 * called it asked of it, so the post names that mod, when the ranking found one, rather than present the library as the cause.
 */
function sharedIntro(d: PacketData, lead: Lead): string {
  const caller = d.leads.find((l) => l.calls);
  return (
    `My game stopped inside ${safeName(lead.name, 80)}${modNote(lead)}, a library other mods call. ` +
    (caller
      ? `A tool that reads crash logs (ModWrench's Crash Whisperer) names ${safeName(caller.name, 80)}${modNote(caller)}, a ${caller.strength} lead, as the mod that may have called it: a crash inside a library like this can come from what the mod calling it asked of it.`
      : "A tool that reads crash logs (ModWrench's Crash Whisperer) points there, but a crash inside a library like this can come from what the mod calling it asked of it. The call stack doesn't show which mod called it.") +
    " These are leads and not proof. Tell me if it looks like something else."
  );
}

function authorBody(d: PacketData, p: Plan): string {
  const lead = clearLead(d);
  if (!lead) {
    const faint = d.leads[0];
    return [
      faint
        ? `No mod stood out clearly in this log: ${safeName(faint.name, 80)} is only a faint lead, so there is no author to write to yet.`
        : "No mod stood out in this log, so there is no author to write to yet.",
      "Narrow it down first (see the next steps), then ask again once one mod is the likely cause.",
      "",
      FOOTER,
    ].join("\n");
  }
  const lines: string[] = [];
  const name = safeName(lead.name, 80);
  lines.push(
    "Hello,",
    "",
    d.format === "bepinex"
      ? `BepInEx logged an error in my game, and a tool that reads logs (ModWrench's Crash Whisperer) points at ${name}. It ranks names by how directly they sit in the error, so this is a lead and not proof. Tell me if it looks like something else.`
      : lead.shared
        ? sharedIntro(d, lead)
        : `My game stopped and a tool that reads crash logs (ModWrench's Crash Whisperer) points at ${name}${modNote(lead)}. It ranks names by how directly they sit in the crash, so this is a lead and not proof. Tell me if it looks like something else.`,
    "",
    `Game: ${gameLine(d.game)}`
  );
  const files = lead.files.map((f) => safeName(f, 80)).join(", ");
  lines.push(`Your files: ${files}`);
  lines.push(`What the log shows: ${happened(d)}`);

  const mine = d.frames.filter((f) => lead.files.some((file) => file.toLowerCase() === f.module.toLowerCase()) || (f.kind === "mod" && safeName(f.module).toLowerCase() === name.toLowerCase()));
  const inCode = mine[0];
  if (inCode) {
    lines.push(`In your code: ${inCode.function ? `${safeName(inCode.function, 90)} ` : ""}(${safeName(inCode.module, 60)}${inCode.offset ? `+${safeName(inCode.offset, 16)}` : ""}, frame ${inCode.index})`);
  }
  const others = [...new Set(d.frames.filter((f) => f.kind === "mod" && f !== inCode && !mine.includes(f)).map((f) => safeName(f.module, 60)))].slice(0, 6);
  if (others.length > 0) lines.push(`Other mod code on the call stack: ${others.join(", ")}`);
  const system = systemLine(d.system);
  if (system) lines.push(`System: ${system}`);

  lines.push("", "Why it was named:");
  for (const e of lead.evidence.slice(0, 5)) lines.push(`- (${BASIS_WORD[e.basis]}) ${safeName(e.text, 300)}`);

  const shown = shownFrames(d, p.frames);
  if (shown.length > 0) lines.push("", `Call stack (${shown.length} of ${d.frameCount} frames):`, ...listBlock(stackRows(d, shown), "    "));
  if (p.context) for (const section of contextSections(d)) lines.push("", `${section.title}:`, ...listBlock(section.rows, "    "));

  lines.push(
    "",
    "What I was doing when it happened: (fill in)",
    "Does it happen every time: (fill in)",
    "",
    "I can share more details if that helps. Thank you.",
    "",
    FOOTER
  );
  return lines.join("\n");
}

// ─── Fitting each place ──────────────────────────────────────────────────────

type Built = { title: string; body: string; level: number };

function fit(plans: Plan[], budget: number, render: (p: Plan) => string): { body: string; level: number } {
  let last = "";
  for (let level = 0; level < plans.length; level++) {
    last = render(plans[level]!);
    if (last.length <= budget) return { body: last, level };
  }
  return { body: `${last.slice(0, budget - 1)}…`, level: plans.length };
}

function build(venue: Venue, d: PacketData): Built {
  const lead = clearLead(d);
  switch (venue) {
    case "forum":
      return { title: titleFor(d), ...fit(PLANS, BUDGET.forum, (p) => forumBody(d, p)) };
    case "github":
      return { title: titleFor(d), ...fit(PLANS, BUDGET.github, (p) => githubBody(d, p)) };
    case "discord":
      return { title: titleFor(d), ...fit(SHORT_PLANS, BUDGET.discord, (p) => discordBody(d, p)) };
    case "author":
      return {
        title: lead ? `${d.format === "bepinex" ? "Error" : "Crash"} that involves ${safeName(lead.name, 60)} (${gameLine(d.game)})` : "No mod stood out",
        ...fit(PLANS.slice(2), BUDGET.author, (p) => authorBody(d, p)),
      };
  }
}

function emptyKinds(): Record<RedactionKind, number> {
  return { user: 0, machine: 0, path: 0, network: 0, contact: 0, secret: 0, id: 0 };
}

export type PacketsResult = {
  packets: Record<Venue, HelpPacket>;
  /** What the last check removed. It should be nothing, because the text is built from names that were taken out of the log already. */
  extra: RedactionReport;
};

/** One packet per place, each already through a last redaction. */
export function buildPackets(data: PacketData, redactOptions: RedactOptions = {}): PacketsResult {
  const byKind = emptyKinds();
  let leftover = 0;
  let cutLines = 0;
  const packets = {} as Record<Venue, HelpPacket>;
  for (const venue of VENUES) {
    const built = build(venue, data);
    const checkedTitle = redact(built.title, redactOptions);
    const checked = redact(built.body, redactOptions);
    for (const kind of REDACTION_KINDS) byKind[kind] += checked.report.byKind[kind] + checkedTitle.report.byKind[kind];
    // The same word shows in several posts: say how many the worst post has, not the sum of them all.
    leftover = Math.max(leftover, checked.report.leftover, checkedTitle.report.leftover);
    cutLines += checked.report.cutLines;
    packets[venue] = {
      venue,
      where: WHERE[venue],
      title: checkedTitle.text,
      text: checked.text,
      chars: checked.text.length,
      trimmed: built.level > 0,
    };
  }
  const total = REDACTION_KINDS.reduce((sum, kind) => sum + byKind[kind], 0);
  return { packets, extra: { total, byKind, leftover, cutLines, skippedLines: 0 } };
}

