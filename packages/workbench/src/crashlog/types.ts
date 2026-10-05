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
   * unwinding it, or a NetScriptFramework frame that is really a raw stack slot because its unwind failed.
   * Such a frame is a weaker signal: stack memory also holds leftovers.
   */
  source?: "scan";
  /**
   * The Address Library id and offset Crash Logger SSE and Buffout 4 write after a game frame
   * ("-> 1242880+0x1FE"). The id stays with a game function across updates, where the offset moves
   * (Skyrim SE and AE number their functions separately).
   */
  addressId?: string;
};

export type LoadedPlugin = {
  name: string;
  loadIndex?: string;
  /** The version the loader printed with the name (BepInEx: "Loading [MoreCompany 1.4.1]"). */
  version?: string;
};

/** A Papyrus function the log shows on the script stack: script "metaSkillMenuScript", function "load_data". */
export type PapyrusFunction = {
  script: string;
  function: string;
  /** The game or a DLL provides it in native code; there is no script behind it ("File: <native>"). */
  native?: true;
};

/** One DLL or EXE from the log's module list, with the address it was loaded at. A name can be listed twice. */
export type LoadedModule = {
  name: string;
  base?: string;
};

export type SuspectedRef = {
  type: string;
  value: string;
  /** Best-effort guess at originating mod. Never present as certainty. */
  likelySource?: string;
  /**
   * Where the logger wrote it: "objects" is its own list of relevant objects; "register" and "stack" are objects it
   * printed beside a register or a stack slot (Crash Logger SSE before v1.20, Buffout 4, and NetScriptFramework, whose
   * list is every object it found there). Those two are weaker evidence: a register or stack slot can still hold an
   * object the crashing code had finished with.
   */
  origin?: "objects" | "register" | "stack";
  /** The kind of object as the logger names it: "TESNPC", "PlayerCharacter", "Armor". */
  kind?: string;
  /** The object's in-game name. Left out for the player's own character, whose name the player chose. */
  name?: string;
  /** Every plugin the logger names for it, in load order: the one that added it first, the last one to change it last. */
  plugins?: string[];
  /** For a reference placed in the world, the FormID of the base object it was placed from (NetScriptFramework's BaseForm). */
  base?: string;
};

/**
 * The player's own records in Skyrim and Fallout 4: the player's base NPC (00000007) and the player's reference
 * (00000014), as the Creation Kit numbers them. Their name is the one the player gave their character.
 */
export const PLAYER_FORM_IDS: ReadonlySet<string> = new Set(["0x00000007", "0x00000014"]);

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
  /**
   * Whether the log carries the game's plugin list. "listed": it does, and loadedPlugins is all of it.
   * "absent": the log has no plugin list (NetScriptFramework logs without a "Game plugins" group, a cut-off log).
   * "failed": the logger began the list and wrote an error instead (Buffout 4's "PLUGINS:" followed by "ERROR").
   * Only "listed" makes an empty loadedPlugins mean no plugins.
   */
  pluginList?: "listed" | "absent" | "failed";
  /** The DLLs and EXEs the log lists as loaded (Crash Logger SSE's and Buffout 4's MODULES, NetScriptFramework's Modules). */
  modules?: LoadedModule[];
  registers?: Record<string, string>;
  /** The type the logger gives the value in each register, as written: "hknpStreamContactSolver*", "void*", "size_t". */
  registerTypes?: Record<string, string>;
  suspectedRefs?: SuspectedRef[];
  /**
   * Game files named in strings in the registers and stack ("textures\terrain\tamriel\skyrim.dds", "Tamriel.32.0.0.BTR"):
   * paths inside the game's data, never folder paths on the player's drive. Each once, registers first, at most 10.
   */
  assetPaths?: string[];
  /** Papyrus functions the registers and stack name (NetScriptFramework), registers first, each once, at most 8. */
  papyrus?: PapyrusFunction[];
  /**
   * BepInEx only, when the log has an error. BepInEx's log runs for the whole session, and exception.description is
   * its last Error or Fatal entry, which need not be an exception or have stopped the game. `exception`: that entry is a
   * real exception (it names an exception type or carries a stack trace). `entriesAfter`: how many entries BepInEx wrote
   * after it; a log that goes on after its last error means the game kept running past it. BepInEx writes no line of its
   * own when the game closes, so no entry can show a clean exit.
   */
  lastError?: { exception: boolean; entriesAfter: number };
  /** Raw text of each section the parser recognized but didn't structure. */
  rawSections: Record<string, string>;
};
