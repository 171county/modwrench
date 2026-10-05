import type {
  CallStackFrame,
  CrashlogParseResult,
  CrashlogType,
  LoadedModule,
  LoadedPlugin,
  SuspectedRef,
} from "./types.js";
import { PLAYER_FORM_IDS } from "./types.js";
import { assetPaths } from "./assets.js";

// Shared parser for the FudgyDuff / NG family: Crash Logger SSE and Buffout 4
// emit nearly identical section-based layouts. We split into named sections
// first, then parse each section's content. Game-specific differences (the
// version line, plugin index format) are handled by passing the format.
//
// Section labels seen in real logs:
//   SETTINGS, SYSTEM SPECS, PROBABLE CALL STACK, REGISTERS, STACK, MODULES,
//   PLUGINS, POSSIBLE RELEVANT OBJECTS, RELEVANT OBJECTS, ENB
//
// Crash Logger SSE's own source (alandtse/CrashLoggerSSE, CrashHandler.cpp and
// Analysis.cpp) adds what older sample logs don't show, and all of it is read here:
//   - call stack rows are "\t[ 0] 0x7FF6D0B6E1C0 SkyrimSE.exe+10EE1C0": the frame number is
//     right-aligned to the widest number, so "[ 0]" and "[0]" are both real, and the
//     module name is right-aligned too. A frame with no module prints just its address;
//   - newer builds head the call stack "CALL STACK ([P]robable / [S]tack scan):" and tag each
//     row "[ 0][P]" (unwound) or "[ 3][S]" (found by scanning stack memory);
//   - after the offset a tab introduces the disassembly, then " | symbol" when the logger
//     has the module's PDB;
//   - light plugins are "[FE:001] Name.esl", regular ones "[00]     Name.esm";
//   - since v1.20 a relevant object reads: RDX: (Character*) "Horker" [0x000844B9] ("Skyrim.esm"), and v1.20.1
//     repeats the id after it, v1.22 and later the name and flags;
//   - the first lines are "CRASH TIME: 2026-10-01 21:14:03", the game and logger versions,
//     then the exception, then "Access Violation: Tried to read memory at 0x...".

const SECTION_REGEX = /^[A-Z][A-Z0-9 _\\/+-]+:$/;

/**
 * The section a heading line opens, or null when the line isn't a heading. Newer builds head the
 * call stack "CALL STACK ([P]robable / [S]tack scan):", which is neither plain capitals nor plain
 * punctuation, and it is the same stack as the older "PROBABLE CALL STACK:".
 */
function sectionName(trimmed: string): string | null {
  if (SECTION_REGEX.test(trimmed)) return trimmed.slice(0, -1).trim();
  const stack = /^(PROBABLE |RECONSTRUCTED )?CALL STACK\b[^:]*:$/.exec(trimmed);
  if (stack) return stack[1] ? `${stack[1].trim()} CALL STACK` : "PROBABLE CALL STACK";
  if (/^THREAD CONTEXT\b[^:]*:$/.test(trimmed)) return "THREAD CONTEXT";
  return null;
}

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
    const heading = sectionName(trimmed);
    if (heading !== null) {
      flush();
      current = heading;
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
  timestamp?: string;
  exception: CrashlogParseResult["exception"];
} {
  let gameVersion: string | undefined;
  let loggerVersion: string | undefined;
  let timestamp: string | undefined;
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
    // "CRASH TIME: 2026-10-01 21:14:03", in the player's local time.
    const time = /^CRASH TIME:\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(line);
    if (time) {
      timestamp = `${time[1]} ${time[2]}`;
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
    // "Access Violation: Tried to read memory at 0x000000000008": the address the code touched.
    const fault = /^Access Violation:\s*Tried to (read|write|execute|unknown)\s+memory at (0x[0-9A-Fa-f]+)/i.exec(line);
    if (fault && fault[1] && fault[2] && exception.fault === undefined) {
      exception.fault = { access: fault[1].toLowerCase() as "read" | "write" | "execute" | "unknown", address: fault[2] };
      continue;
    }
  }

  return { gameVersion, loggerVersion, ...(timestamp ? { timestamp } : {}), exception };
}

// Call stack entries look like:
//   [0] 0x7FF7B3D2A3F0 SkyrimSE.exe+1AA3A3F0 -> 0
//   [1] 0x7FFF12345678 SomeMod.dll+12345
// or sometimes with symbol names attached after the offset.

// A row is "[ 0] 0x7FF6... Module.dll+0001234<TAB>mov rax, [rcx] | Some::Symbol". The frame number is
// padded to the widest number ("[ 0]"), and a hybrid call stack adds a source tag ("[ 0][P]").
const FRAME_ROW = /^\[\s*(\d+)\s*\](?:\[([A-Za-z?])\])?\s+0x[0-9A-Fa-f]+(?:\s+(.*))?$/;
const FRAME_MODULE = /^([^\s+]+)(?:\+([0-9A-Fa-f]+))?(?:(\s+)(.+))?$/;

/**
 * The symbol on a call stack row, when the row has one. A tab after the offset introduces the
 * disassembly (and " | symbol" follows it when the logger has the module's PDB); "-> 36517+0x28"
 * is an Address Library id, not a name. Older sample logs put a bare name after the offset.
 */
function frameFunction(separator: string | undefined, trail: string | undefined): string | undefined {
  const text = trail?.trim();
  if (!text) return undefined;
  const bar = text.indexOf(" | ");
  if (bar >= 0) {
    const symbol = text.slice(bar + 3).split(" | params:")[0]?.trim();
    return symbol ? symbol : undefined;
  }
  if (text.startsWith("->") || separator?.includes("\t")) return undefined;
  return text;
}

function parseCallStack(section: string[] | undefined): CallStackFrame[] {
  if (!section) return [];
  const frames: CallStackFrame[] = [];
  for (const raw of section) {
    const line = raw.trim();
    if (!line) continue;
    const match = FRAME_ROW.exec(line);
    if (!match) continue;
    const frame: CallStackFrame = {
      index: Number.parseInt(match[1] ?? "0", 10),
      module: "(unknown)",
    };
    if (match[2]?.toUpperCase() === "S") frame.source = "scan";
    const rest = match[3]?.trim();
    const mod = rest ? FRAME_MODULE.exec(rest) : null;
    if (mod?.[1]) {
      frame.module = mod[1];
      if (mod[2]) frame.offset = mod[2];
      const fn = frameFunction(mod[3], mod[4]);
      if (fn) frame.function = fn;
      // "-> 1242880+0x1FE": the Address Library id of the game function and the offset into it.
      const id = /^->\s*(\d+\+0x[0-9A-Fa-f]+)/.exec(mod[4]?.trim() ?? "")?.[1];
      if (id) frame.addressId = id;
    }
    frames.push(frame);
  }
  return frames;
}

// PLUGINS section line shapes:
//   [00]     Skyrim.esm
//   [FE 001] LightPlugin.esl
//   [FF]     SomeOverride.esp
//   [00]Fallout4.esm         (Buffout 4 v1.36 writes no space after the index; seen in real logs)

function parsePlugins(section: string[] | undefined): LoadedPlugin[] {
  if (!section) return [];
  const plugins: LoadedPlugin[] = [];
  for (const raw of section) {
    const line = raw.trimEnd();
    if (!line) continue;
    const match = line.match(/^\s*\[([A-F0-9 :]+)\]\s*(.+)$/i);
    if (!match) continue;
    plugins.push({
      loadIndex: (match[1] ?? "").trim(),
      name: (match[2] ?? "").trim(),
    });
  }
  return plugins;
}

/**
 * Whether the PLUGINS section holds the list. Each part of the log is printed through a wrapper that, when printing it
 * fails, writes "<part>:" and the error (or "ERROR") under the heading already written (Crash Logger SSE's
 * CrashHandler.cpp); Buffout 4 v1.26 logs show the bare word "ERROR". Such a section has no list in it, which is not
 * the same as having no plugins.
 */
function pluginListState(section: string[] | undefined, plugins: LoadedPlugin[]): CrashlogParseResult["pluginList"] {
  if (plugins.length > 0) return "listed";
  if (section?.some((line) => /^\s*(?:ERROR|print_plugins:.*)\s*$/.test(line))) return "failed";
  return "absent";
}

// REGISTERS section: "RAX 0xDEADBEEF (type info)" — one per line. The type is what the logger made of the value:
// "(size_t) [0]", "(void* -> skee64.dll+01E8668<TAB>add [rax], al)", "(hknpStreamContactSolver*)".

function parseRegisters(section: string[] | undefined): { values: Record<string, string>; types: Record<string, string> } {
  const values: Record<string, string> = {};
  const types: Record<string, string> = {};
  for (const raw of section ?? []) {
    const line = raw.trim();
    // R8 and R9 have one character after the R.
    const match = line.match(/^(R[A-Z0-9]{1,4}|XMM\d+|RIP|RBP|RSP)\s+(\S+)(?:\s+\(([^()]*?)(?:\s*->[^)]*)?\))?/);
    if (!match?.[1] || !match[2]) continue;
    values[match[1]] = match[2];
    const type = match[3]?.trim();
    if (type) types[match[1]] = type;
  }
  return { values, types };
}

// POSSIBLE RELEVANT OBJECTS / RELEVANT OBJECTS list FormIDs and their owning
// plugin when the crash logger can identify them. Example line:
//   [ 0]   0x000165A8     SomeESP.esp -> Whiterun
// We extract these as suspectedRefs with the plugin as likelySource.

function parseRelevantObjects(section: string[] | undefined): SuspectedRef[] {
  if (!section) return [];
  const refs: SuspectedRef[] = [];
  const seen = new Set<string>();
  for (const raw of section) {
    const line = raw.trim();
    if (!line) continue;
    // Not followed by another hex digit: a 12-digit address isn't a FormID with its tail cut off. A bracketed id comes
    // first: "(FormID 0x14 -> PlayerCharacter* 0xA086A080) ... [0x00000014]" starts with a pointer that looks like one.
    const idMatch = /\[0x([0-9A-Fa-f]{6,8})\]/.exec(line) ?? line.match(/0x([0-9A-Fa-f]{6,8})(?![0-9A-Fa-f])/);
    if (!idMatch) continue;
    const ref: SuspectedRef = {
      type: "formid",
      value: `0x${idMatch[1]}`,
    };
    // The same object at several stack slots is one object.
    if (seen.has(ref.value.toUpperCase())) continue;
    seen.add(ref.value.toUpperCase());
    // Since v1.20 the kind and the in-game name come before the id: (Character*) "Snow Fox" [0x001059DD], and the
    // player's (FormID 0x14 -> PlayerCharacter* 0xA086A080) "Prisoner" [0x00000014], whose name the player chose.
    const before = line.slice(0, idMatch.index);
    const kind = /\((?:FormID 0x[0-9A-Fa-f]+ -> )?([A-Za-z_][\w:]*)\*/.exec(before)?.[1];
    if (kind) ref.kind = kind;
    const name = /"([^"]*)"\s*$/.exec(before)?.[1];
    if (name && !PLAYER_FORM_IDS.has(ref.value)) ref.name = name;
    // Capture the plugin name as the run of chars from after the FormID up to
    // the .esp/.esm/.esl extension. Plugin names contain spaces, so a
    // non-greedy ".+?" is critical — earlier versions used \S+ and clipped
    // multi-word names like "JKs Whiterun Outskirts.esp" to just "Outskirts.esp".
    const after = line.slice(idMatch.index! + idMatch[0].length);
    // Crash Logger SSE writes the plugin in brackets after the id, quoted since v1.20 and sometimes followed by more:
    // (Character*) "Horker" [0x000844B9] ("Skyrim.esm"), and the older unquoted (Skyrim.esm).
    const bracketed = after.match(/^\]?\s*\(\s*"?(.+?\.(?:esp|esm|esl))"?\s*\)/i);
    const sourceMatch = bracketed ?? after.match(/\s+(.+?\.(?:esp|esm|esl))\b/i);
    if (sourceMatch && sourceMatch[1]) ref.likelySource = sourceMatch[1].trim();
    ref.origin = "objects";
    refs.push(ref);
  }
  return refs;
}

// Before v1.20 Crash Logger SSE has no list of relevant objects: what it knows about an object is printed right under
// the register or stack slot that holds it, one "Key: value" a tab deeper (CrashHandler.cpp and Introspection.cpp at
// v1.11.1). A game form is printed in this order, each line only when known:
//   File: "Last To Change It.esp"   Modified by: First.esm -> ... -> Last To Change It.esp   Flags: ...
//   Name: "Roughspun Tunic"   EditorID: "..."   FormID: 0x0003C9FE   FormType: Armor (26)
// An object can hold others (an actor and its base record, a mesh node and the reference it belongs to), printed the
// same way, sometimes straight after one another, so the same form turns up many times. Buffout 4 prints fewer keys,
// sorted by name ("File", "Flags", "Form ID"), with no FormType (Buffout 4's Introspection.cpp).

const FORM_LINE = /^\s+(File|Modified by|Flags|Name|EditorID|FormID|Form ID|FormType):\s?(.*)$/;

function readInlineObjects(section: string[] | undefined, origin: "register" | "stack"): SuspectedRef[] {
  const refs: SuspectedRef[] = [];
  let form = new Map<string, string>();
  const close = () => {
    const id = /^0x([0-9A-Fa-f]{8})$/.exec(form.get("FormID") ?? "")?.[1];
    if (id) {
      const ref: SuspectedRef = { type: "formid", value: `0x${id.toUpperCase()}`, origin };
      const kind = form.get("FormType")?.replace(/\s*\(\d+\)$/, "");
      if (kind) ref.kind = kind;
      const name = form.get("Name");
      if (name && !PLAYER_FORM_IDS.has(ref.value)) ref.name = name;
      const file = form.get("File");
      if (file) ref.likelySource = file;
      const plugins = form.get("Modified by")?.split(/\s*->\s*/).filter(Boolean) ?? (file ? [file] : []);
      if (plugins.length > 0) ref.plugins = plugins;
      refs.push(ref);
    }
    form = new Map();
  };
  for (const raw of section ?? []) {
    const line = FORM_LINE.exec(raw.trimEnd());
    // Anything else (the next register or slot, a node's own keys) ends the form being read.
    if (!line?.[1]) {
      close();
      continue;
    }
    const key = line[1] === "Form ID" ? "FormID" : line[1];
    if (form.has(key)) close();
    form.set(key, (line[2] ?? "").trim().replace(/^"(.*)"$/, "$1"));
    if (key === "FormType") close();
  }
  close();
  return refs;
}

/** The objects under the registers, then those under the stack slots, the top of the stack first: each form once, at most 30. */
function inlineObjects(registers: string[] | undefined, stack: string[] | undefined): SuspectedRef[] {
  const seen = new Set<string>();
  return [...readInlineObjects(registers, "register"), ...readInlineObjects(stack, "stack")]
    .filter((ref) => !seen.has(ref.value) && seen.add(ref.value))
    .slice(0, 30);
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

// MODULES section: "XINPUT1_3.dll    0x000000400000", the name and the address it was loaded at.

function parseModules(section: string[] | undefined): LoadedModule[] {
  const modules: LoadedModule[] = [];
  for (const raw of section ?? []) {
    const row = /^\s*(.+?)\s+(0x[0-9A-Fa-f]+)\s*$/.exec(raw);
    if (row?.[1] && row[2]) modules.push({ name: row[1], base: row[2] });
  }
  return modules;
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
  const { gameVersion, loggerVersion, timestamp, exception } = parsePreamble(preamble);

  const callStackLines = sections.get("PROBABLE CALL STACK");
  const callStack = parseCallStack(callStackLines);
  const pluginSection = sections.get("PLUGINS");
  const plugins = parsePlugins(pluginSection);
  const { values: registers, types: registerTypes } = parseRegisters(sections.get("REGISTERS"));

  const relevant =
    sections.get("RELEVANT OBJECTS") ?? sections.get("POSSIBLE RELEVANT OBJECTS");
  let suspectedRefs = parseRelevantObjects(relevant);
  if (suspectedRefs.length === 0) {
    suspectedRefs = inlineObjects(sections.get("REGISTERS"), sections.get("STACK"));
  }
  if (suspectedRefs.length === 0) {
    suspectedRefs = scanCallStackForFormIds(callStack, callStackLines);
  }

  const result: CrashlogParseResult = {
    detectedType: variant,
    exception,
    callStack,
    loadedPlugins: plugins,
    pluginList: pluginListState(pluginSection, plugins),
    rawSections: rawSectionsFromMap(sections),
  };
  if (gameVersion) result.gameVersion = gameVersion;
  if (loggerVersion) result.loggerVersion = loggerVersion;
  if (timestamp) result.timestamp = timestamp;
  if (Object.keys(registers).length > 0) result.registers = registers;
  if (Object.keys(registerTypes).length > 0) result.registerTypes = registerTypes;
  const modules = parseModules(sections.get("MODULES"));
  if (modules.length > 0) result.modules = modules;
  const assets = assetPaths([...(sections.get("REGISTERS") ?? []), ...(sections.get("STACK") ?? [])]);
  if (assets.length > 0) result.assetPaths = assets;
  if (suspectedRefs.length > 0) result.suspectedRefs = suspectedRefs;
  return result;
}
