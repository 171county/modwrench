import type { CrashlogType, LoadedPlugin } from "../crashlog/types.js";
import { formatName, type GameFacts } from "./explain.js";
import { redact, type RedactOptions, type RedactionKind, type RedactionReport, REDACTION_KINDS } from "./redact.js";
import { gb, safeName } from "./text.js";
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
  /** The frames worth printing: the top of the stack and the first frame of each lead. */
  frames: Frame[];
  /** How many frames the log had. */
  frameCount: number;
  leads: Lead[];
  checks: Check[];
  system?: SystemFacts;
  plugins: LoadedPlugin[];
  /** From the log's SKSE PLUGINS section. */
  extenders: Array<{ name: string; version?: string }>;
  scriptExtender?: string | null;
  /** Leave the plugin lists out: only the names the log points at appear. */
  hideNames: boolean;
};

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
};

const PLANS: Plan[] = [
  { plugins: true, extenders: true, frames: 14, evidence: true, leads: 5, checks: "all" },
  { plugins: false, extenders: true, frames: 14, evidence: true, leads: 5, checks: "all" },
  { plugins: false, extenders: false, frames: 12, evidence: true, leads: 4, checks: "all" },
  { plugins: false, extenders: false, frames: 8, evidence: false, leads: 3, checks: "problems" },
  { plugins: false, extenders: false, frames: 5, evidence: false, leads: 2, checks: "none" },
];

const SHORT_PLANS: Plan[] = [
  { plugins: false, extenders: false, frames: 8, evidence: false, leads: 3, checks: "problems" },
  { plugins: false, extenders: false, frames: 6, evidence: false, leads: 2, checks: "none" },
  { plugins: false, extenders: false, frames: 4, evidence: false, leads: 1, checks: "none" },
  { plugins: false, extenders: false, frames: 2, evidence: false, leads: 1, checks: "none" },
];

const BASIS_WORD: Record<Basis, string> = { log: "log", install: "my files", rule: "rule", guess: "guess" };
const FOOTER =
  "Made with ModWrench's Crash Whisperer. Personal details it recognised (folder paths, user and computer names, addresses, keys) were taken out; mod and file names are as the log wrote them.";

// ─── Pieces ──────────────────────────────────────────────────────────────────

function gameLine(g: GameFacts): string {
  return `${safeName(g.name, 60)}${g.version ? ` ${safeName(g.version, 24)}` : ""}`;
}

function frameRow(f: Frame, withFunction = true): string {
  const where = `${safeName(f.module, 60)}${f.offset ? `+${safeName(f.offset, 16)}` : ""}`;
  const fn = withFunction && f.function ? `  ${safeName(f.function, 90)}` : "";
  return `[${f.index}] ${where}${fn}${f.scan ? "  (stack scan)" : ""}`;
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

function pluginRow(p: LoadedPlugin): string {
  return `${p.loadIndex ? `[${safeName(p.loadIndex, 8)}] ` : ""}${safeName(p.name, 80)}`;
}

/** "SkyrimSE.exe+10EE1C0", without the frame number. */
function frameWhere(f: Frame): string {
  return `${safeName(f.module, 60)}${f.offset ? `+${safeName(f.offset, 16)}` : ""}`;
}

function happened(d: PacketData): string {
  const what = d.exceptionType ? safeName(d.exceptionType, 80) : "an unhandled exception";
  const bepinex = d.format === "bepinex";
  const parts = [`${bepinex ? "BepInEx logged" : "The game crashed with"} ${what}.`];
  if (d.exceptionPlain) parts.push(safeName(d.exceptionPlain, 600));
  // The plain-language note already says which address when it is a tiny one.
  if (d.fault && !/\baddress 0x?[0-9A-Fa-f]/.test(d.exceptionPlain ?? "")) parts.push(`It was ${safeName(d.fault, 80)}.`);
  if (d.site) parts.push(`${bepinex ? "The error began" : "It stopped"} at ${frameWhere(d.site)} (frame ${d.site.index}).`);
  if (d.time) parts.push(`The log puts it at ${safeName(d.time, 24)} by its own clock.`);
  return parts.join(" ");
}

function titleFor(d: PacketData, lead: Lead | undefined): string {
  const bepinex = d.format === "bepinex";
  const exception = d.exceptionType ? ` (${safeName(d.exceptionType, 60)})` : "";
  const involving = lead ? ` involving ${safeName(lead.name, 50)}` : "";
  return `${gameLine(d.game)}: ${bepinex ? "error" : "crash"}${involving}${exception}`;
}

function checkLines(d: PacketData, p: Plan, prefix: string): string[] {
  if (p.checks === "none") return [];
  const use = d.checks.filter((c) => (p.checks === "all" ? c.severity !== "info" : c.severity === "problem"));
  return use.slice(0, 8).map((c) => `${prefix}${c.severity === "problem" ? "Problem" : "Note"}: ${safeName(c.title, 140)}. ${safeName(c.detail, 320)}`);
}

function leadLines(d: PacketData, p: Plan, style: "plain" | "markdown"): string[] {
  const out: string[] = [];
  d.leads.slice(0, p.leads).forEach((lead, i) => {
    const name = safeName(lead.name, 80);
    out.push(
      style === "markdown"
        ? `${i + 1}. \`${name}\` (${lead.strength}): ${safeName(lead.summary, 240)}`
        : `${i + 1}. ${name} (${lead.strength} lead): ${safeName(lead.summary, 240)}`
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

function forumBody(d: PacketData, p: Plan): string {
  const lines: string[] = [];
  lines.push("What happened", happened(d), "");

  lines.push("My setup", `Game: ${gameLine(d.game)}`);
  if (d.scriptExtender) lines.push(`Script extender: ${safeName(d.scriptExtender, 60)}`);
  lines.push(`Log written by: ${formatName(d.format)}${d.logger ? ` (${safeName(d.logger, 80)})` : ""}`);
  const system = systemLine(d.system);
  if (system) lines.push(`System: ${system}`);
  lines.push(`Plugins: ${pluginCounts(d.plugins)}`, "");

  if (d.leads.length > 0) {
    lines.push(
      "What the log points at",
      "Ranked by how directly each name sits in the crash. These are leads, not findings.",
      ...leadLines(d, p, "plain"),
      ""
    );
  } else {
    lines.push("What the log points at", "No mod stood out: nothing from a mod was on the call stack or among the objects involved.", "");
  }

  const checks = checkLines(d, p, "- ");
  if (checks.length > 0) lines.push("Setup checks", ...checks, "");

  const shown = d.frames.slice(0, p.frames);
  if (shown.length > 0) {
    lines.push(`Call stack (${shown.length} of ${d.frameCount} frames)`, ...listBlock(shown.map((f) => frameRow(f)), "    "), "");
  }

  if (d.hideNames) {
    lines.push(`Plugin lists left out on purpose (${pluginCounts(d.plugins)}).`, "");
  } else {
    if (p.extenders && d.extenders.length > 0) {
      lines.push(
        `SKSE plugins (${d.extenders.length})`,
        ...listBlock(d.extenders.map((e) => `${safeName(e.name, 80)}${e.version ? ` v${safeName(e.version, 24)}` : ""}`), "    "),
        ""
      );
    }
    if (p.plugins && d.plugins.length > 0) {
      lines.push(`Plugin list (${d.plugins.length})`, ...listBlock(d.plugins.slice(0, 600).map(pluginRow), "    "));
      if (d.plugins.length > 600) lines.push(`    …and ${d.plugins.length - 600} more`);
      lines.push("");
    }
  }

  lines.push("What changed before the first crash: (fill in)", "What I have already tried: (fill in)", "", FOOTER);
  return lines.join("\n");
}

function githubBody(d: PacketData, p: Plan): string {
  const lines: string[] = [];
  lines.push("## Summary", "", happened(d), "");

  lines.push("## Environment", "", `- Game: ${gameLine(d.game)}`);
  if (d.scriptExtender) lines.push(`- Script extender: ${safeName(d.scriptExtender, 60)}`);
  lines.push(`- Log written by: ${formatName(d.format)}${d.logger ? ` (${safeName(d.logger, 80)})` : ""}`);
  const system = systemLine(d.system);
  if (system) lines.push(`- System: ${system}`);
  lines.push(`- Plugins: ${pluginCounts(d.plugins)}`, "");

  lines.push("## What the log points at", "");
  if (d.leads.length > 0) {
    lines.push("Ranked by how directly each name sits in the crash. These are leads, not findings.", "", ...leadLines(d, p, "markdown"), "");
  } else {
    lines.push("No mod stood out: nothing from a mod was on the call stack or among the objects involved.", "");
  }

  const checks = checkLines(d, p, "- ");
  if (checks.length > 0) lines.push("## Setup checks", "", ...checks, "");

  const shown = d.frames.slice(0, p.frames);
  if (shown.length > 0) {
    lines.push(`## Call stack (${shown.length} of ${d.frameCount} frames)`, "", "```", ...shown.map((f) => frameRow(f)), "```", "");
  }

  if (d.hideNames) {
    lines.push(`Plugin lists left out on purpose (${pluginCounts(d.plugins)}).`, "");
  } else {
    if (p.extenders && d.extenders.length > 0) {
      lines.push(
        `<details><summary>SKSE plugins (${d.extenders.length})</summary>`,
        "",
        "```",
        ...d.extenders.map((e) => `${safeName(e.name, 80)}${e.version ? ` v${safeName(e.version, 24)}` : ""}`),
        "```",
        "",
        "</details>",
        ""
      );
    }
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
  const where = d.site ? `${bepinex ? "Began" : "Stopped"} at ${frameWhere(d.site)}. ` : "";
  const top = d.leads.slice(0, p.leads);
  if (top.length > 0) {
    const first = top[0]!;
    const others = top.slice(1).map((l) => `${safeName(l.name, 50)} (${l.strength})`);
    lines.push(
      `${where}Top lead: ${safeName(first.name, 60)} (${first.strength}). ${safeName(first.summary, 160)}${others.length > 0 ? ` Also: ${others.join(", ")}.` : ""}`
    );
  } else if (where) {
    lines.push(`${where}No mod stood out.`);
  }
  const shown = d.frames.slice(0, p.frames);
  if (shown.length > 0) lines.push("```", ...shown.map((f) => frameRow(f)), "```");
  const bits: string[] = [];
  const system = systemLine(d.system);
  if (system) bits.push(system);
  bits.push(`${d.plugins.length} plugins`);
  lines.push(bits.join(" | "));
  const problems = checkLines(d, p, "");
  if (problems.length > 0) lines.push(...problems.slice(0, 2).map((c) => c.slice(0, 220)));
  lines.push("More details if it helps.");
  return lines.join("\n");
}

function authorBody(d: PacketData, p: Plan): string {
  const lead = d.leads[0];
  if (!lead) {
    return [
      "No mod stood out in this log, so there is no author to write to yet.",
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
    `My game stopped and a tool that reads crash logs (ModWrench's Crash Whisperer) points at ${name}. It ranks names by how directly they sit in the crash, so this is a lead and not proof. Tell me if it looks like something else.`,
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

  const shown = d.frames.slice(0, p.frames);
  if (shown.length > 0) lines.push("", `Call stack (${shown.length} of ${d.frameCount} frames):`, ...listBlock(shown.map((f) => frameRow(f)), "    "));

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
  const lead = d.leads[0];
  switch (venue) {
    case "forum":
      return { title: titleFor(d, lead), ...fit(PLANS, BUDGET.forum, (p) => forumBody(d, p)) };
    case "github":
      return { title: titleFor(d, lead), ...fit(PLANS, BUDGET.github, (p) => githubBody(d, p)) };
    case "discord":
      return { title: titleFor(d, lead), ...fit(SHORT_PLANS, BUDGET.discord, (p) => discordBody(d, p)) };
    case "author":
      return {
        title: lead ? `Crash that involves ${safeName(lead.name, 60)} (${gameLine(d.game)})` : "No mod stood out",
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

