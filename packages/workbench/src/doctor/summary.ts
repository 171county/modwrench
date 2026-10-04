import { clean } from "../patchday/summary.js";
import { platformName, type DoctorBasis, type DoctorFinding, type DoctorReport, type DoctorResult, type DoctorStatus } from "./types.js";

// ─── The answer as plain text ────────────────────────────────────────────────
// Every client gets this, whether or not it can draw a panel. It is what the model
// reads and what a person sees if they expand the tool call: the headline, what needs
// attention with what each line rests on, what is fine, and what ModWrench can't see.
// The full report travels alongside it as structured content for clients that want it.
//
// Names come from the player's own files and from other people's mods. They are cleaned
// to one line and cut short, so a mod called something clever can't pose as a new
// section of the answer.

const BASIS: Record<DoctorBasis, string> = {
  install: "your files",
  rule: "documented rule",
  guess: "ModWrench's guess",
};

const HEADINGS: Record<Exclude<DoctorStatus, "ok">, string> = {
  problem: "PROBLEMS",
  warn: "WARNINGS",
  note: "NOTES",
};

const ITEMS_SHOWN = 6;

function findingLines(f: DoctorFinding, full: boolean): string[] {
  const lines = [`- ${clean(f.title, 120)} [${BASIS[f.basis]}]: ${clean(f.detail, 900)}`];
  if (!full) return lines;
  const items = f.items ?? [];
  for (const item of items.slice(0, ITEMS_SHOWN)) lines.push(`    ${clean(item, 160)}`);
  const more = Math.max(0, items.length - ITEMS_SHOWN) + (f.more ?? 0);
  if (more > 0) lines.push(`    and ${more} more.`);
  if (f.fix) lines.push(`  Fix: ${clean(f.fix, 500)}`);
  if (f.source) lines.push(`  Source: ${clean(f.source, 200)}`);
  return lines;
}

export function summarizeDoctor(result: DoctorResult): string {
  if (!result.ok) {
    // The hint for an unknown game already lists the games; say them once.
    return [`The Doctors couldn't run: ${clean(result.error, 300)}`, result.hint ? clean(result.hint, 400) : `Games they know: ${result.supportedGames.join(", ")}.`]
      .filter((l) => l !== "")
      .join("\n");
  }
  return summarizeReport(result);
}

function summarizeReport(r: DoctorReport): string {
  const out: string[] = [];
  out.push(`Doctor: ${clean(r.game.name, 80)} on ${platformName(r.platform, r.steamDeck)}`);
  out.push(clean(r.headline, 300));
  out.push("Read-only: it opened files and changed nothing. Each line says what it rests on.");

  for (const status of ["problem", "warn", "note"] as const) {
    const list = r.findings.filter((f) => f.status === status);
    if (list.length === 0) continue;
    out.push("", `${HEADINGS[status]} (${list.length})`);
    for (const f of list) out.push(...findingLines(f, status !== "note"));
  }

  const fine = r.findings.filter((f) => f.status === "ok");
  if (fine.length > 0) {
    out.push("", `FINE (${fine.length}): ${fine.map((f) => clean(f.title, 80)).join("; ")}`);
  }

  if (r.notChecked.length > 0) {
    out.push("", "NOT CHECKED FROM HERE");
    for (const n of r.notChecked) out.push(`- ${clean(n.what, 200)}: ${clean(n.why, 300)}`);
  }

  if (r.nextSteps.length > 0) {
    out.push("", "NEXT");
    r.nextSteps.forEach((step, i) => out.push(`${i + 1}. ${clean(step, 400)}`));
  }

  out.push("", ...r.limits.map((l) => clean(l, 400)));
  return out.join("\n");
}
