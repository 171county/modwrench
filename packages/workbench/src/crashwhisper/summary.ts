import { clean } from "../patchday/summary.js";
import { KIND_PHRASE, formatName } from "./explain.js";
import { plural } from "./text.js";
import type { Basis, Check, CrashWhisperResult, Lead, Venue } from "./types.js";
import { VENUES } from "./types.js";

// ─── The answer as plain text ────────────────────────────────────────────────
// Every client gets this, whether or not it can draw a page. It is what the model reads
// and what a person sees if they expand the tool call: what happened, how sure that is,
// which names the log points at and why, what to check, and what to do next, in a screen
// or two. The full report travels beside it as structured content.
//
// Names come from other people's work (a mod can be called anything), and this text is
// read by a model, so every name is flattened to one line and cut short before it goes
// in. A name can't pose as a section of the answer or smuggle in a paragraph.

const LEADS_IN_FULL = 3;
const EVIDENCE_LINES = 4;
const NOTES_SHOWN = 5;
const INFO_SHOWN = 2;

const BASIS_LABEL: Record<Basis, string> = { log: "log", install: "your files", rule: "rule", guess: "guess" };

function checkLine(c: Check): string {
  const level = c.severity === "problem" ? "PROBLEM" : c.severity === "note" ? "NOTE" : "INFO";
  const fix = c.fix ? ` Fix: ${clean(c.fix, 300)}` : "";
  return `- ${level} [${BASIS_LABEL[c.basis]}] ${clean(c.title, 160)}. ${clean(c.detail, 360)}${fix}`;
}

function leadLines(lead: Lead): string[] {
  const out = [`${lead.rank}. ${clean(lead.name, 80)}: ${lead.strength.toUpperCase()}. ${clean(lead.summary, 240)}`];
  for (const e of lead.evidence.slice(0, EVIDENCE_LINES)) out.push(`   - [${BASIS_LABEL[e.basis]}] ${clean(e.text, 360)}`);
  const more = lead.evidence.length - EVIDENCE_LINES;
  if (more > 0) out.push(`   - …and ${plural(more, "more reason", "more reasons")}.`);
  return out;
}

/** A fence long enough that nothing inside the text can close it. */
function fenceFor(text: string): string {
  let longest = 2;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(longest + 1);
}

/** The plain-text answer for a Crash Whisperer result. A help packet is included only when one is asked for. */
export function summarizeCrashWhisper(result: CrashWhisperResult, options: { packet?: Venue } = {}): string {
  if (!result.ok) {
    return [
      `Crash Whisperer couldn't run: ${clean(result.error, 300)}`,
      ...(result.hint ? [clean(result.hint, 500)] : []),
      ...(result.looked && result.looked.length > 0 ? ["Where it looked:", ...result.looked.map((l) => `- ${clean(l, 120)}`)] : []),
    ].join("\n");
  }

  const r = result;
  const out: string[] = [clean(r.headline, 500), "", `How sure: ${clean(r.confidence.summary, 700)}`];

  const c = r.crash;
  const facts: string[] = [`${clean(c.game.name, 60)}${c.game.version ? ` ${clean(c.game.version, 24)}` : ""}`, formatName(c.format)];
  if (c.time) facts.push(`crashed ${clean(c.time, 20)} by the log's clock`);
  if (c.pluginCount > 0) facts.push(plural(c.pluginCount, "plugin loaded", "plugins loaded"));
  if (c.fileName) facts.push(`file ${clean(c.fileName, 60)}`);
  out.push("", `The log: ${facts.join(" · ")}.`);

  if (c.exception?.plain) out.push(`What happened: ${clean(c.exception.plain, 600)}`);
  if (c.site) {
    const where = `${clean(c.site.module, 60)}${c.site.offset ? `+${clean(c.site.offset, 16)}` : ""}`;
    out.push(`${c.format === "bepinex" ? "Where the error began" : "Where it stopped"}: frame ${c.site.index}, ${where} (${KIND_PHRASE[c.site.kind]}).`);
  }

  if (r.leads.length > 0) {
    out.push("", "Leads (names the log points at, ranked by ModWrench's own scoring; a lead is not a finding):");
    for (const lead of r.leads.slice(0, LEADS_IN_FULL)) out.push(...leadLines(lead));
    const rest = r.leads.slice(LEADS_IN_FULL);
    if (rest.length > 0) {
      out.push(`…and ${plural(rest.length, "more lead", "more leads")}, weaker: ${rest.map((l) => `${clean(l.name, 50)} (${l.strength})`).join(", ")}.`);
    }
  } else {
    out.push("", "Leads: none. Nothing from a mod was on the call stack or among the objects the logger lists.");
  }

  const problems = r.checks.filter((k) => k.severity === "problem");
  const notes = r.checks.filter((k) => k.severity === "note");
  const infos = r.checks.filter((k) => k.severity === "info");
  const shown = [...problems, ...notes.slice(0, NOTES_SHOWN), ...infos.slice(0, INFO_SHOWN)];
  if (shown.length > 0) {
    out.push("", `Checks (${shown.length} of ${r.checks.length}):`);
    for (const k of shown) out.push(checkLine(k));
    const hidden = r.checks.length - shown.length;
    if (hidden > 0) out.push(`…and ${plural(hidden, "more check", "more checks")} in the full report.`);
  } else {
    out.push("", "Checks: nothing in the setup stood out.");
  }

  if (r.nextSteps.length > 0) {
    out.push("", "Next steps:");
    r.nextSteps.forEach((step, i) => out.push(`${i + 1}. ${clean(step, 500)}`));
  }

  if (r.limits.length > 0) {
    out.push("", "What this can't tell you:");
    for (const limit of r.limits) out.push(`- ${clean(limit, 500)}`);
  }

  out.push("", `Help packets: ${VENUES.join(", ")} are ready, with the personal details ModWrench recognised taken out. ${clean(r.redaction.summary, 400)}`);

  const venue = options.packet;
  if (venue) {
    const packet = r.packets[venue];
    const fence = fenceFor(packet.text);
    out.push(
      "",
      `Help packet for ${venue} (${packet.where.replace(/\.$/, "")}). Title: ${clean(packet.title, 160)}`,
      ...(packet.trimmed ? ["It was shortened to fit."] : []),
      fence,
      packet.text,
      fence
    );
  } else {
    out.push(`Ask again with packet set to one of them to get its text.`);
  }
  return out.join("\n");
}
