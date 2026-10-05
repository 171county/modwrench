import type {
  CallStackFrame,
  CrashlogParseResult,
  LoadedPlugin,
} from "./types.js";

// BepInEx LogOutput.log is a streaming log, not a crash dump. We pull the
// fatal/error events with their stack traces and the loaded plugin list that
// BepInEx prints at startup. Multiple crashes can appear in one file; we
// report all of them and let the LLM decide which is current.
//
// Typical event header:
//   [Fatal  : Unity Log] NullReferenceException: Object reference not set...
//   [Error  : SomePlugin] Stack trace follows on subsequent lines indented...
//
// Plugin-loaded lines look like:
//   [Info   : BepInEx] Loading [SomePlugin 1.2.3]

const HEADER_REGEX =
  /^\[(Message|Info|Warning|Error|Fatal|Debug)\s*:\s*([^\]]+)\]\s*(.*)$/;
const PLUGIN_LOAD_REGEX = /Loading \[([^\]]+?)(?:\s+([\d.]+))?\]\s*$/;
const STACK_FRAME_REGEX = /^\s*at\s+(.+?)(?:\s+\(.*\))?\s*(?:in\s+(.+))?$/;

type Event = {
  level: string;
  source: string;
  message: string;
  stackLines: string[];
};

function parseEvents(text: string): Event[] {
  const lines = text.split(/\r?\n/);
  const events: Event[] = [];
  let current: Event | null = null;
  for (const line of lines) {
    const header = line.match(HEADER_REGEX);
    if (header) {
      if (current) events.push(current);
      current = {
        level: header[1] ?? "Info",
        source: (header[2] ?? "").trim(),
        message: header[3] ?? "",
        stackLines: [],
      };
      continue;
    }
    if (current && line.trim()) {
      current.stackLines.push(line);
    }
  }
  if (current) events.push(current);
  return events;
}

/**
 * The namespace a stack symbol belongs to, which is how a mod's code is told apart from the
 * game's and Unity's: "Foo.Bar.Baz (args) (at ...)" is Foo's. Handles the shapes Mono and Unity
 * print: a leading return type ("Object UnityEngine.Object.Instantiate(...)"), "(wrapper
 * dynamic-method)" prefixes on patched methods, and "Class:Method" with a colon.
 */
export function namespaceRoot(symbol: string): string | undefined {
  let s = symbol.trim().replace(/^\(wrapper [^)]*\)\s*/, "");
  const typed = /^[^\s(]+\s+([A-Za-z_][\w`<>+]*(?:[.:][\w`<>+]+)+)\s*[(<]/.exec(s);
  if (typed?.[1]) s = s.slice(s.indexOf(typed[1]));
  return /^([A-Za-z_][\w`<>+]*)[.:]/.exec(s)?.[1];
}

/** A symbol with the file position and IL offset the runtime appends removed. */
function cleanSymbol(symbol: string): string {
  return symbol
    .replace(/\s+\(at [^)]*\)\s*$/, "")
    .replace(/\s*<0x[0-9a-f]+>\s*$/i, "")
    .replace(/\s*\[0x[0-9a-f]+\](?:\s+in\s+.*)?$/i, "")
    .trim();
}

/**
 * One line of a stack trace. A .NET trace line starts "at"; Unity prints its own traces under a
 * "Stack trace:" line with no "at" at all ("Foo.Bar.Baz (args) (at <hash>:0)"), which is what
 * most mod errors look like, so lines are also read that way once a trace has started.
 */
function frameFromStackLine(line: string, inTrace: boolean): CallStackFrame | null {
  const match = line.match(STACK_FRAME_REGEX);
  if (match) {
    const symbol = cleanSymbol((match[1] ?? "").trim());
    if (!symbol) return null;
    const frame: CallStackFrame = {
      module: namespaceRoot(symbol) ?? "(unknown)",
      function: symbol,
    };
    if (match[2]) frame.offset = match[2].trim();
    return frame;
  }
  if (!inTrace) return null;
  const trimmed = line.trim();
  // Markers inside a trace that aren't frames: an inner exception boundary, a separator.
  if (!trimmed || /^Rethrow as /i.test(trimmed) || /^---/.test(trimmed)) return null;
  const symbol = cleanSymbol(trimmed);
  if (!symbol) return null;
  return { module: namespaceRoot(symbol) ?? "(unknown)", function: symbol };
}

export function parseBepInExLog(text: string): CrashlogParseResult {
  const events = parseEvents(text);
  const loadedPlugins: LoadedPlugin[] = [];
  const fatalEvents: Event[] = [];

  for (const ev of events) {
    if (ev.level === "Fatal" || ev.level === "Error") {
      fatalEvents.push(ev);
    }
    const pluginMatch = ev.message.match(PLUGIN_LOAD_REGEX);
    if (pluginMatch) {
      const entry: LoadedPlugin = { name: pluginMatch[1] ?? "(unnamed)" };
      // Don't have an index for BepInEx plugins — they load in dependency
      // order, not by numeric slot.
      if (pluginMatch[2]) entry.version = pluginMatch[2];
      loadedPlugins.push(entry);
    }
  }
  // The first line is "BepInEx 5.4.21.0 - Lethal Company (11/23/2023 9:01:25 PM)": the loader's version, the game, and
  // the time the game's executable was last written (BepInEx.Preloader/Preloader.cs), which is not when the log was.
  const loader = events.find((ev) => ev.source === "BepInEx" && /^BepInEx \S+ - /.test(ev.message))?.message.split(" - ")[0];

  // Surface the most recent fatal event as the exception; older ones go into
  // rawSections so the LLM can still see them if it asks.
  const primary = fatalEvents[fatalEvents.length - 1];
  const callStack: CallStackFrame[] = [];
  if (primary) {
    let inTrace = false;
    for (const stackLine of primary.stackLines) {
      if (/^\s*Stack trace:?\s*$/i.test(stackLine)) {
        inTrace = true;
        continue;
      }
      const frame = frameFromStackLine(stackLine, inTrace);
      if (frame) callStack.push(frame);
    }
  }

  const exception: CrashlogParseResult["exception"] = primary
    ? {
        type: (primary.message.match(/^([A-Za-z.]+Exception)/) ?? [])[1],
        description: `${primary.level}:${primary.source}: ${primary.message}`,
      }
    : {};

  const rawSections: Record<string, string> = {};
  if (fatalEvents.length > 1) {
    rawSections["earlier_fatal_events"] = fatalEvents
      .slice(0, -1)
      .map(
        (e) =>
          `[${e.level}:${e.source}] ${e.message}\n${e.stackLines.join("\n")}`
      )
      .join("\n\n");
  }

  const result: CrashlogParseResult = {
    detectedType: "bepinex",
    exception,
    callStack,
    loadedPlugins,
    // The chainloader logs "N plugins to load" before loading any (BepInEx 5.4.21, Bootstrap/Chainloader.cs), so the
    // list is there even when N is 0.
    pluginList: loadedPlugins.length > 0 || events.some((ev) => /^\d+ plugins? to load$/.test(ev.message.trim())) ? "listed" : "absent",
    rawSections,
  };
  if (loader) result.loggerVersion = loader;
  // An error BepInEx logs need not stop the game (a real Lethal Company log goes on for dozens of entries after its
  // exception), and BepInEx writes nothing when the game closes (Bootstrap/Chainloader.cs, Logging/DiskLogListener.cs
  // at 5.4.21), so what follows the last error is the only sign of whether it stopped the game.
  if (primary) {
    result.lastError = { exception: Boolean(exception.type) || callStack.length > 0, entriesAfter: events.length - 1 - events.indexOf(primary) };
  }
  return result;
}
