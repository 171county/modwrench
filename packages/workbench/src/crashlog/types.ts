// Normalized cross-format crashlog parse output. Every parser emits this
// shape so the downstream LLM-reasoning step doesn't care whether the source
// was Crash Logger SSE, Buffout 4, BepInEx, NetScriptFramework, or Minecraft.
//
// Critical design rule: this module does PARSING only. No diagnosis, no
// suggested causes, no "you should disable mod X" advice. That's the LLM's
// job — we just feed it structured facts.

export type CrashlogType =
  | "crashlogger-sse"
  | "buffout4"
  | "netscriptframework"
  | "bepinex"
  | "minecraft"
  | "unknown";

export type CallStackFrame = {
  index?: number;
  module: string;
  function?: string;
  offset?: string;
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
  };
  callStack: CallStackFrame[];
  loadedPlugins: LoadedPlugin[];
  registers?: Record<string, string>;
  suspectedRefs?: SuspectedRef[];
  /** Raw text of each section the parser recognized but didn't structure. */
  rawSections: Record<string, string>;
};
