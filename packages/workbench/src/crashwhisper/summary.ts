import { clean } from "../patchday/summary.js";
import { KIND_PHRASE, formatName, strayAddress } from "./explain.js";
import { plural } from "./text.js";
import type { Basis, Check, ContextObject, CrashWhisperResult, Frame, Lead, Venue } from "./types.js";
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
const OBJECTS_SHOWN = 5;

const BASIS_LABEL: Record<Basis, string> = { log: "log", install: "your files", rule: "rule", guess: "guess" };

/** The last next step, which the answer leaves out when a help packet was asked for along with it. */
export const PACKET_STEP =
  "To ask for help, ask for a help packet for the place you will post (a forum, a GitHub issue, Discord, or the mod's author). ModWrench takes out the personal details it recognises (your user name, folders, addresses, keys), and you can read it before you post.";

function checkLine(c: Check): string {
  const level = c.severity === "problem" ? "PROBLEM" : c.severity === "note" ? "NOTE" : "INFO";
  const fix = c.fix ? ` Fix: ${clean(c.fix, 300)}` : "";
  return `- ${level} [${BASIS_LABEL[c.basis]}] ${clean(c.title, 160)}. ${clean(c.detail, 360)}${fix}`;
}

function leadLines(lead: Lead): string[] {
  const mod = lead.mod ? ` (${clean(lead.mod, 60)})` : "";
  const out = [`${lead.rank}. ${clean(lead.name, 80)}${mod}: ${lead.strength.toUpperCase()}. ${clean(lead.summary, 240)}`];
  for (const e of lead.evidence.slice(0, EVIDENCE_LINES)) out.push(`   - [${BASIS_LABEL[e.basis]}] ${clean(e.text, 360)}`);
  const more = lead.evidence.length - EVIDENCE_LINES;
  if (more > 0) out.push(`   - …and ${plural(more, "more reason", "more reasons")}.`);
  return out;
}

/** An object the game was working with: `Armor "Roughspun Tunic" 0x0003C9FE (in stack memory), from Skyrim.esm, changed by X.esp`. */
function objectWords(o: ContextObject): string {
  const kind = o.kind ? `${clean(o.kind, 40)} ` : "";
  const what = o.player ? `the player's character (${kind}${clean(o.formId, 12)})` : `${kind}${o.name ? `"${clean(o.name, 60)}" ` : ""}${clean(o.formId, 12)}`;
  const where = o.origin === "stack" ? " (in stack memory)" : o.origin === "register" ? " (beside a register)" : "";
  const [first, ...rest] = o.plugins.map((p) => clean(p, 80));
  return `${what}${where}${first ? `, from ${first}${rest.length > 0 ? `, changed by ${rest.join(", ")}` : ""}` : ""}`;
}

/** "SkyrimSE.exe+A0D780, in hkbClipGenerator::unk_A0D770+10": the module, the offset and the function when the log names one. */
function frameWhere(f: Frame): string {
  return `${clean(f.module, 60)}${f.offset ? `+${clean(f.offset, 16)}` : ""}${f.function ? `, in ${clean(f.function, 120)}` : ""}`;
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
  if (c.pluginList === "failed") facts.push("the logger failed to write the plugin list");
  if (c.fileName) facts.push(`file ${clean(c.fileName, 60)}`);
  out.push("", `The log: ${facts.join(" · ")}.`);

  if (c.exception?.plain) out.push(`What happened: ${clean(c.exception.plain, 600)}`);
  if (c.site) {
    const s = c.site;
    const label = c.format === "bepinex" ? "Where the error began" : "Where it stopped";
    if (s.address) {
      const near = c.nearest;
      const nearWords = near ? ` The first frame the log can place is frame ${near.index}, ${frameWhere(near)} (${near.about ? clean(near.about, 120) : KIND_PHRASE[near.kind]}).` : "";
      out.push(`${label}: frame ${s.index}, at ${strayAddress(clean(s.address, 24))}.${nearWords}`);
    } else {
      const whose = s.copies
        ? `Windows' own ${clean(s.module, 60)} or a graphics mod's copy of it: the log lists ${s.copies}`
        : s.about
          ? clean(s.about, 120)
          : KIND_PHRASE[s.kind];
      out.push(`${label}: frame ${s.index}, ${frameWhere(s)} (${whose}).`);
    }
  }

  const ctx = c.context;
  if (ctx) {
    out.push("", "What the log shows the game was working with:");
    if (ctx.objects?.length) out.push(`- Objects: ${ctx.objects.slice(0, OBJECTS_SHOWN).map(objectWords).join("; ")}`);
    if (ctx.types?.length) {
      out.push(`- Object types in the registers: ${ctx.types.map((t) => `${clean(t.type, 60)} (${t.registers.map((x) => clean(x, 8)).join(", ")})`).join(", ")}`);
    }
    if (ctx.files?.length) out.push(`- Files: ${ctx.files.map((f) => clean(f, 120)).join(", ")}`);
    if (ctx.scripts?.length) out.push(`- Papyrus: ${ctx.scripts.map((s) => clean(s, 100)).join(", ")}`);
  }

  if (r.leads.length > 0) {
    out.push("", "Leads (names the log points at, ranked by ModWrench's own scoring; a lead is not a finding):");
    for (const lead of r.leads.slice(0, LEADS_IN_FULL)) out.push(...leadLines(lead));
    const rest = r.leads.slice(LEADS_IN_FULL);
    if (rest.length > 0) {
      out.push(`…and ${plural(rest.length, "more lead", "more leads")}, weaker: ${rest.map((l) => `${clean(l.name, 50)} (${l.strength})`).join(", ")}.`);
    }
  } else if (c.format === "bepinex") {
    out.push("", "Leads: none. No mod that loaded is named in what BepInEx logged.");
  } else {
    out.push(
      "",
      ctx?.objects?.length
        ? "Leads: none. Nothing from a mod was on the call stack, and none of the objects the log lists comes from a mod's plugin."
        : "Leads: none. Nothing from a mod was on the call stack, and the log names no object from a mod's plugin."
    );
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
  } else if (r.install.checked) {
    out.push("", "Checks: nothing in the setup stood out.");
  } else {
    out.push("", "Checks: nothing in the log itself stood out. Your install wasn't checked, so the checks that need it (the game's and plugins' versions) didn't run.");
  }

  const venue = options.packet;
  // The packet asked for is below, so the step that says to ask for one is left out.
  const steps = venue ? r.nextSteps.filter((step) => step !== PACKET_STEP) : r.nextSteps;
  if (steps.length > 0) {
    out.push("", "Next steps:");
    steps.forEach((step, i) => out.push(`${i + 1}. ${clean(step, 500)}`));
  }

  if (r.limits.length > 0) {
    out.push("", "What this can't tell you:");
    for (const limit of r.limits) out.push(`- ${clean(limit, 500)}`);
  }

  out.push("", `Help packets: ${VENUES.join(", ")} are ready, with the personal details ModWrench recognised taken out. ${clean(r.redaction.summary, 400)}`);

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
