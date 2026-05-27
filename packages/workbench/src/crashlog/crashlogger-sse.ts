import type {
  CallStackFrame,
  CrashlogParseResult,
  CrashlogType,
  LoadedPlugin,
  SuspectedRef,
} from "./types.js";

// Shared parser for the FudgyDuff / NG family: Crash Logger SSE and Buffout 4
// emit nearly identical section-based layouts. We split into named sections
// first, then parse each section's content. Game-specific differences (the
// version line, plugin index format) are handled by passing the format.
//
// Section labels seen in real logs:
//   SETTINGS, SYSTEM SPECS, PROBABLE CALL STACK, REGISTERS, STACK, MODULES,
//   PLUGINS, POSSIBLE RELEVANT OBJECTS, RELEVANT OBJECTS, ENB

const SECTION_REGEX = /^[A-Z][A-Z0-9 _\\/-]+:$/;

type SectionMap = Map<string, string[]>;

function splitSections(lines: string[]): {
  preamble: string[];
  sections: SectionMap;
} {
  const sections: SectionMap = new Map();
  const preamble: string[] = [];
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current !== null) {
      sections.set(current, buffer);
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (SECTION_REGEX.test(trimmed)) {
      flush();
      current = trimmed.slice(0, -1).trim(); // strip trailing colon
      continue;
    }
    if (current === null) preamble.push(line);
    else buffer.push(line);
  }
  flush();
  return { preamble, sections };
}

// Preamble: 1-3 lines like:
//   Skyrim SSE v1.6.640.0
//   CrashLoggerSSE v1-12-1
//   Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x... SkyrimSE.exe+...

function parsePreamble(preamble: string[]): {
  gameVersion?: string;
  loggerVersion?: string;
  exception: CrashlogParseResult["exception"];
} {
  let gameVersion: string | undefined;
  let loggerVersion: string | undefined;
  const exception: CrashlogParseResult["exception"] = {};

  for (const raw of preamble) {
    const line = raw.trim();
    if (!line) continue;

    if (/^(Skyrim|Fallout)\b/.test(line) && line.includes(" v")) {
      gameVersion = line;
      continue;
    }
    if (/^(CrashLogger|Buffout)/i.test(line)) {
      loggerVersion = line;
      continue;
    }
    if (line.startsWith("Unhandled exception")) {
      const typeMatch = line.match(/"([^"]+)"/);
      const addrMatch = line.match(/at\s+(0x[0-9A-Fa-f]+)/);
      if (typeMatch) exception.type = typeMatch[1];
      if (addrMatch) exception.address = addrMatch[1];
      exception.description = line;
      continue;
    }
  }

  return { gameVersion, loggerVersion, exception };
}

// Call stack entries look like:
//   [0] 0x7FF7B3D2A3F0 SkyrimSE.exe+1AA3A3F0 -> 0
//   [1] 0x7FFF12345678 SomeMod.dll+12345
// or sometimes with symbol names attached after the offset.

function parseCallStack(section: string[] | undefined): CallStackFrame[] {
  if (!section) return [];
  const frames: CallStackFrame[] = [];
  for (const raw of section) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(
      /^\[(\d+)\]\s+0x[0-9A-Fa-f]+\s+([^\s+]+)(?:\+([0-9A-Fa-f]+))?(?:\s+(.+))?$/
    );
    if (!match) continue;
    const frame: CallStackFrame = {
      index: Number.parseInt(match[1] ?? "0", 10),
      module: match[2] ?? "(unknown)",
    };
    if (match[3]) frame.offset = match[3];
    if (match[4]) {
      // Trailing symbol/note. "-> 0" is the indirection arrow; ignore those.
      const trail = match[4].trim();
      if (trail && !trail.startsWith("->")) frame.function = trail;
    }
    frames.push(frame);
  }
  return frames;
}

// PLUGINS section line shapes:
//   [00]     Skyrim.esm
//   [FE 001] LightPlugin.esl
//   [FF]     SomeOverride.esp

function parsePlugins(section: string[] | undefined): LoadedPlugin[] {
  if (!section) return [];
  const plugins: LoadedPlugin[] = [];
  for (const raw of section) {
    const line = raw.trimEnd();
    if (!line) continue;
    const match = line.match(/^\s*\[([A-F0-9 ]+)\]\s+(.+)$/i);
    if (!match) continue;
    plugins.push({
      loadIndex: (match[1] ?? "").trim(),
      name: (match[2] ?? "").trim(),
    });
  }
  return plugins;
}

// REGISTERS section: "RAX 0xDEADBEEF (type info)" — one per line.

function parseRegisters(section: string[] | undefined): Record<string, string> {
  if (!section) return {};
  const out: Record<string, string> = {};
  for (const raw of section) {
    const line = raw.trim();
    const match = line.match(/^(R[A-Z0-9]{2,4}|XMM\d+|RIP|RBP|RSP)\s+(\S+)/);
    if (match && match[1] && match[2]) out[match[1]] = match[2];
  }
  return out;
}

// POSSIBLE RELEVANT OBJECTS / RELEVANT OBJECTS list FormIDs and their owning
// plugin when the crash logger can identify them. Example line:
//   [ 0]   0x000165A8     SomeESP.esp -> Whiterun
// We extract these as suspectedRefs with the plugin as likelySource.

function parseRelevantObjects(section: string[] | undefined): SuspectedRef[] {
  if (!section) return [];
  const refs: SuspectedRef[] = [];
  for (const raw of section) {
    const line = raw.trim();
    if (!line) continue;
    const idMatch = line.match(/0x([0-9A-Fa-f]{6,8})/);
    if (!idMatch) continue;
    const ref: SuspectedRef = {
      type: "formid",
      value: `0x${idMatch[1]}`,
    };
    // Capture the plugin name as the run of chars from after the FormID up to
    // the .esp/.esm/.esl extension. Plugin names contain spaces, so a
    // non-greedy ".+?" is critical — earlier versions used \S+ and clipped
    // multi-word names like "JKs Whiterun Outskirts.esp" to just "Outskirts.esp".
    const after = line.slice(idMatch.index! + idMatch[0].length);
    const sourceMatch = after.match(/\s+(.+?\.(?:esp|esm|esl))\b/i);
    if (sourceMatch && sourceMatch[1]) ref.likelySource = sourceMatch[1].trim();
    refs.push(ref);
  }
  return refs;
}

// Scan call stack for FormIDs as a fallback when no RELEVANT OBJECTS section
// is present. Best-effort only.

function scanCallStackForFormIds(
  callStack: CallStackFrame[],
  rawCallStack: string[] | undefined
): SuspectedRef[] {
  if (!rawCallStack) return [];
  const refs: SuspectedRef[] = [];
  const seen = new Set<string>();
  for (const line of rawCallStack) {
    const matches = line.matchAll(/0x([0-9A-Fa-f]{6,8})\b/g);
    for (const m of matches) {
      const value = `0x${(m[1] ?? "").toUpperCase()}`;
      // Skip if the value is the exception address — already captured.
      if (value.length < 8) continue;
      if (!seen.has(value)) {
        seen.add(value);
        refs.push({ type: "formid", value });
      }
    }
  }
  // Cap to a sane number — call stacks can be hundreds of frames.
  return refs.slice(0, 30);
}

function rawSectionsFromMap(sections: SectionMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, lines] of sections) {
    out[name] = lines.join("\n").trim();
  }
  return out;
}

export function parseCrashloggerSse(
  text: string,
  variant: Extract<CrashlogType, "crashlogger-sse" | "buffout4">
): CrashlogParseResult {
  const lines = text.split(/\r?\n/);
  const { preamble, sections } = splitSections(lines);
  const { gameVersion, loggerVersion, exception } = parsePreamble(preamble);

  const callStackLines = sections.get("PROBABLE CALL STACK");
  const callStack = parseCallStack(callStackLines);
  const plugins = parsePlugins(sections.get("PLUGINS"));
  const registers = parseRegisters(sections.get("REGISTERS"));

  const relevant =
    sections.get("RELEVANT OBJECTS") ?? sections.get("POSSIBLE RELEVANT OBJECTS");
  let suspectedRefs = parseRelevantObjects(relevant);
  if (suspectedRefs.length === 0) {
    suspectedRefs = scanCallStackForFormIds(callStack, callStackLines);
  }

  const result: CrashlogParseResult = {
    detectedType: variant,
    exception,
    callStack,
    loadedPlugins: plugins,
    rawSections: rawSectionsFromMap(sections),
  };
  if (gameVersion) result.gameVersion = gameVersion;
  if (loggerVersion) result.loggerVersion = loggerVersion;
  if (Object.keys(registers).length > 0) result.registers = registers;
  if (suspectedRefs.length > 0) result.suspectedRefs = suspectedRefs;
  return result;
}
