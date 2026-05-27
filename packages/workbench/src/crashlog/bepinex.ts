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

function frameFromStackLine(line: string): CallStackFrame | null {
  const match = line.match(STACK_FRAME_REGEX);
  if (!match) return null;
  const symbol = (match[1] ?? "").trim();
  if (!symbol) return null;
  // C# format: Namespace.Class.Method(args) — module is the namespace root.
  const moduleMatch = symbol.match(/^([^.\s]+)\./);
  const frame: CallStackFrame = {
    module: moduleMatch?.[1] ?? "(unknown)",
    function: symbol,
  };
  if (match[2]) frame.offset = match[2].trim();
  return frame;
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
      loadedPlugins.push(entry);
    }
  }

  // Surface the most recent fatal event as the exception; older ones go into
  // rawSections so the LLM can still see them if it asks.
  const primary = fatalEvents[fatalEvents.length - 1];
  const callStack: CallStackFrame[] = [];
  if (primary) {
    for (const stackLine of primary.stackLines) {
      const frame = frameFromStackLine(stackLine);
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

  return {
    detectedType: "bepinex",
    exception,
    callStack,
    loadedPlugins,
    rawSections,
  };
}
