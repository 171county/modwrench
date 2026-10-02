import type { PatchDayReport, PatchDayResult, PluginLine } from "./index.js";
import type { RuleBasis } from "./rules.js";

// ─── The answer as plain text ────────────────────────────────────────────────
// Every client gets this, whether or not it can draw a panel. It is what the
// model reads and what a person sees if they expand the tool call: the verdict,
// how sure it is, what needs attention, and what to do, in a few dozen lines
// rather than the full report. The full report travels alongside it as
// structured content for clients that want the detail.
//
// File names and mod folder names come from other people's work (anyone can
// publish a mod called anything), and this text is read by a model. They are
// flattened to one line and cut short so a name can't pose as a section of the
// answer or smuggle in a paragraph.

const FULL_LINES = 40;
const NAMES_ONLY = 120;
const NAME_MAX = 80;
const MAX_DISAGREEMENTS = 10;

/** Control characters, line breaks and the invisible direction/spacing marks that can make a name read as something it isn't. */
function isInvisible(code: number): boolean {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** One line, no invisible characters, at most `max` characters. */
export function clean(value: string, max = NAME_MAX): string {
  let flat = "";
  for (const ch of value) flat += isInvisible(ch.codePointAt(0) ?? 0) ? " " : ch;
  flat = flat.replace(/ {2,}/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : flat;
}

const BASIS_LABEL: Record<RuleBasis, string> = {
  "skse-source": "SKSE's source",
  "field-reports": "field reports",
  inferred: "inferred",
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "game" → "game folder"; "mo2:Some Mod" → 'MO2 mod "Some Mod"'; "mo2:overwrite" → "MO2 overwrite folder". */
function sourceLabel(source: string): string {
  if (source === "game") return "game folder";
  if (source === "mo2:overwrite") return "MO2 overwrite folder";
  if (source.startsWith("mo2:")) return `MO2 mod "${clean(source.slice(4))}"`;
  return clean(source);
}

function problemLine(p: PluginLine): string {
  const named = p.name ? ` ("${clean(p.name)}")` : "";
  const said = p.skseMessage ? ` SKSE says: "${clean(p.skseMessage, 120)}".` : "";
  const reason = clean(p.reason, 300).replace(/\.$/, "");
  return `- ${clean(p.file)}${named}: ${p.status.toUpperCase()} [${BASIS_LABEL[p.basis]}; ${sourceLabel(p.source)}] ${reason}.${said}`;
}

function skseLine(r: PatchDayReport): string {
  const s = r.scriptExtender;
  if (!s.loaderPresent && s.dllsInstalled.length === 0) return "SKSE: not installed";
  if (s.dllPresent) return `SKSE: ${s.version ? `v${s.version}` : "present"} (${s.expectedDll})`;
  return `SKSE: no build for this game version (needs ${s.expectedDll})`;
}

function addressLibraryLine(r: PatchDayReport): string {
  const a = r.addressLibrary;
  if (a.present) return `Address Library: present${a.format !== null ? ` (format ${a.format})` : ""}`;
  if (a.pluginsNeedingIt > 0) return `Address Library: missing (needs ${a.expectedFile})`;
  return "Address Library: no plugin needs it";
}

function logLine(r: PatchDayReport): string {
  if (r.checked.source === "targetVersion") return "SKSE log: not used (it describes the installed version)";
  const l = r.log;
  if (!l || !l.found) return "SKSE log: not found";
  if (!l.fresh) return "SKSE log: older than the last patch, so not used";
  return `SKSE log: from after the last patch (${l.pluginsLoaded} loaded, ${l.refusals.length} refused)`;
}

/** The plain-text answer for a Patch Day result: short enough to read at a glance, complete enough to act on. */
export function summarizePatchDay(result: PatchDayResult): string {
  if (!result.ok) {
    return [
      `Patch Day couldn't run: ${clean(result.error, 300)}`,
      ...(result.hint ? [clean(result.hint, 400)] : []),
      `Games it covers: ${result.supportedGames.join(", ")}.`,
    ].join("\n");
  }
  const r = result;
  const out: string[] = [r.headline, "", `How sure: ${r.confidence.summary}`];

  // SKSE's own log is the strongest evidence there is, so when it contradicts the
  // file check it goes first. Each entry is already a full sentence naming the plugin
  // and quoting what SKSE logged.
  const log = r.log;
  const disagreed = r.checked.source === "installed" && log && log.found && log.fresh ? log.disagreements : [];
  if (disagreed.length > 0) {
    out.push("", `SKSE's own log disagrees with the file check on ${plural(disagreed.length, "plugin", "plugins")}:`);
    for (const d of disagreed.slice(0, MAX_DISAGREEMENTS)) out.push(`- ${clean(d, 320)}`);
    if (disagreed.length > MAX_DISAGREEMENTS) out.push(`…and ${disagreed.length - MAX_DISAGREEMENTS} more.`);
  }

  const problems = r.plugins.problems;
  if (problems.length > 0) {
    out.push("", `Needs attention (${problems.length} of ${plural(r.plugins.total, "plugin", "plugins")}), worst first:`);
    for (const p of problems.slice(0, FULL_LINES)) out.push(problemLine(p));
    const rest = problems.slice(FULL_LINES);
    if (rest.length > 0) {
      const names = rest.slice(0, NAMES_ONLY).map((p) => clean(p.file, 60));
      const unlisted = rest.length - names.length;
      out.push(`…and ${rest.length} more: ${names.join(", ")}${unlisted > 0 ? `, and ${unlisted} not listed` : ""}.`);
    }
    out.push("Every plugin not listed above passed.");
  }

  const setup = [skseLine(r), addressLibraryLine(r)];
  if (r.steam) setup.push(r.steam.updatePending ? "Steam: update waiting" : "Steam: no update waiting");
  setup.push(logLine(r));
  out.push("", `Setup: ${setup.join(" · ")}.`);

  const pinned = r.nextPatch.pinned;
  if (pinned.length > 0) {
    const shown = pinned.slice(0, 8).map((p) => clean(p.file, 60));
    const more = pinned.length > shown.length ? `, and ${pinned.length - shown.length} more` : "";
    out.push(
      `Next patch: ${plural(pinned.length, "plugin is", "plugins are")} pinned to exact game versions (${shown.join(", ")}${more}) and will be refused after the next game update until rebuilt.`
    );
  }

  if (r.nextSteps.length > 0) {
    out.push("", "Next steps:");
    r.nextSteps.forEach((step, i) => out.push(`${i + 1}. ${step}`));
  }

  if (r.limits.length > 0) {
    out.push("", "What this can't tell you:");
    for (const limit of r.limits) out.push(`- ${limit}`);
  }
  return out.join("\n");
}
