import { namespaceRoot } from "../crashlog/bepinex.js";

// ─── What a BepInEx log says beyond its last error ───────────────────────────
// BepInEx's LogOutput.log is a session log, not a crash dump: a game can close with nothing wrong in
// it, or with hundreds of errors from one mod. Two things in it are worth reading that the crash
// parser doesn't keep:
//
//   - the chainloader's own verdicts on plugins it couldn't load or skipped. These are BepInEx's
//     words (Chainloader.cs in 5.x, BaseChainloader.cs in 6.x: "Could not load [X] because it has
//     missing dependencies: ...") and the most common reason a mod "does nothing";
//   - every logged error, with the mods on its stack, so a name that keeps coming up can be told
//     from one that appeared once.
//
// Read-only and pure: text in, facts out.

export type LoadProblemKind =
  | "missing-dependency"
  | "incompatible-version"
  | "incompatible-with"
  | "load-error"
  | "wrong-bepinex"
  | "dependency-not-loaded";

export type LoadProblem = {
  kind: LoadProblemKind;
  /** The plugin as BepInEx writes it: "Name 1.2.3". */
  plugin: string;
  /** The rest of BepInEx's sentence: the dependencies it wanted, or the error. */
  detail: string;
  level: "Error" | "Warning";
};

export type ErrorEvent = {
  level: "Error" | "Fatal";
  /** The log source BepInEx printed (a plugin's own logger, or "Unity Log"). */
  source: string;
  /** "NullReferenceException", when the message begins with one. */
  type?: string;
  /** The first line of the message, cut to a sensible length. */
  message: string;
  /** Namespace roots on the stack, in order, each once. */
  modules: string[];
};

export type BepInExFacts = {
  /** "BepInEx 5.4.21.0", from the first line. */
  loader?: string;
  /** The game, from the same line. */
  game?: string;
  unity?: string;
  problems: LoadProblem[];
  /** Every logged error, oldest first, up to MAX_EVENTS. */
  events: ErrorEvent[];
  /** All errors seen, which can be more than `events` holds. */
  errorCount: number;
  /** Errors whose type and first mod are the same as another's, most repeated first. */
  repeats: Array<{ key: string; type?: string; source: string; count: number }>;
};

const MAX_EVENTS = 400;
const MAX_PROBLEMS = 60;
const HEADER = /^\[(Message|Info|Warning|Error|Fatal|Debug)\s*:\s*([^\]]*)\]\s*(.*)$/;

const PROBLEM_RULES: Array<{ kind: LoadProblemKind; match: RegExp; level: "Error" | "Warning" }> = [
  {
    kind: "missing-dependency",
    match: /^Could not load \[(.+?)\] because it has missing dependencies: (.+?)(?:\. Install the listed plugin\(s\) and restart the game\.)?$/,
    level: "Error",
  },
  // 6.x only: 5.x reports a dependency that is too old as missing, "(v1.0.0 or newer)".
  {
    kind: "incompatible-version",
    match: /^Could not load \[(.+?)\] because the following dependencies are installed with an incompatible version: (.+?)(?:\. Update the listed plugin\(s\).*)?$/,
    level: "Error",
  },
  { kind: "incompatible-with", match: /^Could not load \[(.+?)\] because it is incompatible with: (.+)$/, level: "Error" },
  // 5.x writes "Error loading [X] : message", 6.x "Error loading [X]: exception".
  { kind: "load-error", match: /^Error loading \[(.+?)\] ?: (.+)$/, level: "Error" },
  {
    kind: "wrong-bepinex",
    match: /^Plugin \[(.+?)\] targets a wrong version of BepInEx \((.+?)\) and might not work until you update/,
    level: "Warning",
  },
  {
    kind: "dependency-not-loaded",
    match: /^Skipping \[(.+?)\] because it has a dependency that was not loaded/,
    level: "Warning",
  },
];

function firstLine(text: string, max = 200): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Facts from a BepInEx log that the crash parser doesn't carry. */
export function scanBepInEx(text: string): BepInExFacts {
  const facts: BepInExFacts = { problems: [], events: [], errorCount: 0, repeats: [] };
  const counts = new Map<string, { type?: string; source: string; count: number }>();

  let current: ErrorEvent | null = null;
  let inTrace = false;

  const close = () => {
    if (!current) return;
    facts.errorCount++;
    if (facts.events.length < MAX_EVENTS) facts.events.push(current);
    const first = current.modules[0] ?? "";
    const key = `${current.type ?? current.message.slice(0, 60)}|${first || current.source}`;
    const held = counts.get(key);
    if (held) held.count++;
    else counts.set(key, { ...(current.type ? { type: current.type } : {}), source: first || current.source, count: 1 });
    current = null;
    inTrace = false;
  };

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const header = HEADER.exec(line);
    if (header) {
      close();
      const level = header[1] ?? "Info";
      const source = (header[2] ?? "").trim();
      const message = header[3] ?? "";

      if (facts.loader === undefined) {
        // "BepInEx 5.4.21.0 - Lethal Company (1/15/2024 2:30:00 PM)"
        const first = /^(BepInEx\s+[\d.]+)\s+-\s+(.+?)\s+\(/.exec(message);
        if (first) {
          facts.loader = first[1];
          facts.game = first[2];
        }
      }
      const unity = /^Running under Unity v?([\d.]+\w*)/.exec(message);
      if (unity?.[1] && facts.unity === undefined) facts.unity = unity[1];

      for (const rule of PROBLEM_RULES) {
        const m = rule.match.exec(message);
        if (m && facts.problems.length < MAX_PROBLEMS) {
          facts.problems.push({
            kind: rule.kind,
            plugin: (m[1] ?? "").trim(),
            detail: firstLine((m[2] ?? "").trim()),
            level: rule.level,
          });
          break;
        }
      }

      if (level === "Error" || level === "Fatal") {
        const type = /^([A-Za-z][\w.]*(?:Exception|Error))\b/.exec(message)?.[1];
        current = {
          level,
          source,
          ...(type ? { type } : {}),
          message: firstLine(message),
          modules: [],
        };
      }
      continue;
    }

    if (!current) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^Stack trace:?$/i.test(trimmed)) {
      inTrace = true;
      continue;
    }
    const at = /^at\s+(.+)$/.exec(trimmed);
    if (!at && !inTrace) continue;
    if (!at && (/^Rethrow as /i.test(trimmed) || /^---/.test(trimmed))) continue;
    const root = namespaceRoot((at?.[1] ?? trimmed).trim());
    if (root && !current.modules.includes(root) && current.modules.length < 24) current.modules.push(root);
  }
  close();

  facts.repeats = [...counts.entries()]
    .filter(([, v]) => v.count > 1)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([key, v]) => ({ key, ...(v.type ? { type: v.type } : {}), source: v.source, count: v.count }));
  return facts;
}
