// Normalized cross-format crashlog parse output. Every parser emits this
// shape so the downstream LLM-reasoning step doesn't care whether the source
// was Crash Logger SSE, Buffout 4, BepInEx, or NetScriptFramework.
//
// Critical design rule: this module does PARSING only. No diagnosis, no
// suggested causes, no "you should disable mod X" advice. That's the LLM's
// job — we just feed it structured facts.

export type CrashlogType =
  | "crashlogger-sse"
  | "buffout4"
  | "netscriptframework"
  | "bepinex"
  | "unknown";

export type CallStackFrame = {
  index?: number;
  module: string;
  function?: string;
  offset?: string;
  /**
   * "scan" marks a frame Crash Logger SSE found by scanning raw stack memory rather than by
   * unwinding it. Such a frame is a weaker signal: stack memory also holds leftovers.
   */
  source?: "scan";
};

export type LoadedPlugin = {
  name: string;
  loadIndex?: string;
};

export type SuspectedRef = {
  type: string;
  value: string;
  /** Best-effort guess at originating mod. Never present as certainty. */
  likelySource?: string;
};

export type CrashlogParseResult = {
  detectedType: CrashlogType;
  gameVersion?: string;
  loggerVersion?: string;
  timestamp?: string;
  exception: {
    type?: string;
    address?: string;
    description?: string;
    /** For an access violation, the memory it touched, when the log says ("Tried to read memory at 0x8"). */
    fault?: { access: "read" | "write" | "execute" | "unknown"; address: string };
  };
  callStack: CallStackFrame[];
  loadedPlugins: LoadedPlugin[];
  registers?: Record<string, string>;
  suspectedRefs?: SuspectedRef[];
  /** Raw text of each section the parser recognized but didn't structure. */
  rawSections: Record<string, string>;
};
