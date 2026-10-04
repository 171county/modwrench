import type { CrashlogType } from "../crashlog/types.js";
import type { RuleBasis } from "../patchday/rules.js";

// ─── What Crash Whisperer says, and how it labels how sure it is ─────────────
// Every statement carries a basis, so a reader can tell a fact in the log from a
// ranking ModWrench made up:
//
//   "log"     the crash log says so (what crashed, where, what was loaded)
//   "install" the player's own files say so (what is installed, what version)
//   "rule"    a published rule or documented behaviour applied to those facts:
//             what a Windows exception code means, SKSE's own compatibility check,
//             BepInEx's own load messages, a crash logger's own warning
//   "guess"   ModWrench's own inference: the ranking, name matching, patterns
//
// A "guess" is a lead. It is never written as a finding.

export type Basis = "log" | "install" | "rule" | "guess";

export const BASIS_ORDER: readonly Basis[] = ["log", "install", "rule", "guess"];

export type Evidence = {
  text: string;
  basis: Basis;
};

export type Strength = "strong" | "possible" | "faint";

/** What kind of module a name is, so a crash inside Windows isn't blamed on a mod. */
export type ModuleKind = "game" | "extender" | "system" | "graphics" | "overlay" | "framework" | "mod" | "unknown";

export type Lead = {
  /** 1 is the lead to look at first. */
  rank: number;
  /** What to call it: the DLL name, the plugin name, or the mod's namespace. */
  name: string;
  /** Every file that points at it: a DLL on the call stack, a plugin the game was working with. */
  files: string[];
  strength: Strength;
  /** The main reason, in one line. */
  summary: string;
  evidence: Evidence[];
  /** What the player's install says about it, when the install was read. */
  install?: {
    /** Where it comes from: "game folder", or the Mod Organizer 2 mod it sits in. */
    source?: string;
    /** The version stamped into the DLL, which isn't always the mod's own version number. */
    version?: string;
    /** The name the plugin gives itself. */
    declaredName?: string;
    present: boolean;
    flagged?: { status: "broken" | "unclear"; reason: string; basis: RuleBasis };
  };
  /** How many of the other recent crash logs name it as a lead too. */
  recurrence?: { logs: number; of: number };
  /** The ranking score. Kept for tests and for ordering; not shown to the player. */
  score: number;
};

export type CheckSeverity = "problem" | "note" | "info";

export type Check = {
  id: string;
  severity: CheckSeverity;
  title: string;
  detail: string;
  basis: Basis;
  /** What to do about it, when there is something to do. */
  fix?: string;
};

export type Venue = "forum" | "github" | "discord" | "author";

export const VENUES: readonly Venue[] = ["forum", "github", "discord", "author"];

export type HelpPacket = {
  venue: Venue;
  /** Where it is meant to be posted, in a few words. */
  where: string;
  /** A suggested title for the post. */
  title: string;
  /** The packet, already redacted. This is exactly what would be posted. */
  text: string;
  chars: number;
  /** True when it was cut to fit the place it is meant for. */
  trimmed: boolean;
};

/** Hardware and memory figures from the log's SYSTEM SPECS, when it has them. Memory is in GB: used first, then total. */
export type SystemFacts = {
  os?: string;
  cpu?: string;
  gpus: string[];
  ram?: { used: number; total: number };
  /** Windows' commit charge: RAM plus the page file. */
  commit?: { used: number; total: number };
  vram?: { used: number; budget: number };
  virtualMachine?: string;
};

export type Frame = {
  index: number;
  module: string;
  offset?: string;
  function?: string;
  kind: ModuleKind;
  /** Found by scanning stack memory rather than unwinding it: weaker evidence, because stack memory also holds leftovers. */
  scan?: true;
};

export type CrashWhisperReport = {
  ok: true;
  /** Two sentences: what happened and where to look. */
  headline: string;
  confidence: {
    /** "log": from the crash log alone. "log-and-install": the log, checked against the player's files. "partial": the log was missing the parts that matter. */
    evidence: "log" | "log-and-install" | "partial";
    summary: string;
    /** How many of the statements in this answer rest on each basis. */
    basis: Record<Basis, number>;
  };
  crash: {
    game: { name: string; version?: string; id?: string };
    format: CrashlogType;
    logger?: string;
    exception?: { type?: string; plain: string };
    /** Where it stopped: the top of the call stack. */
    site?: Frame;
    frames: Frame[];
    pluginCount: number;
    /** When the crash happened, as the log itself states it (the player's local time), to the minute. */
    time?: string;
    /** When the log file was last written, to the minute, when it was read from disk. */
    written?: string;
    /** The log's file name, never its folders. */
    fileName?: string;
    source: "newest" | "path" | "pasted";
  };
  /** Hardware and memory, when the log has them. Part of what a help packet includes. */
  system?: SystemFacts;
  leads: Lead[];
  checks: Check[];
  /** One packet per place it might be posted. All are redacted. */
  packets: Record<Venue, HelpPacket>;
  redaction: {
    summary: string;
    total: number;
    byKind: Record<string, number>;
    leftover: number;
  };
  install: {
    checked: boolean;
    /** Why not, when it wasn't. */
    reason?: string;
    gameVersion?: string;
    scriptExtender?: string | null;
    /** The player's mod folders the plugin files came from, never their paths. */
    modFolders?: number;
  };
  /** How many other recent crash logs were read to see whether the same name keeps coming up. */
  recent: { examined: number };
  limits: string[];
  nextSteps: string[];
};

export type CrashWhisperError = {
  ok: false;
  error: string;
  hint?: string;
  /** Where it looked for a crash log, described without the player's folders. */
  looked?: string[];
};

export type CrashWhisperResult = CrashWhisperReport | CrashWhisperError;
