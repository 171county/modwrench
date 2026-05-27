import type {
  CallStackFrame,
  CrashlogParseResult,
  LoadedPlugin,
} from "./types.js";

// Minecraft crash-report format:
//   ---- Minecraft Crash Report ----
//   // <funny line>
//
//   Time: 2024-01-15 14:30:00
//   Description: Rendering screen
//
//   <java exception>
//   <java stack trace>
//
//   A detailed walkthrough of the error, its code path and all known details is as follows:
//   ---------------------------------------------------------------------------------------
//
//   -- Head --
//   ...
//   -- Affected level --
//   ...
//   -- System Details --
//   ...
//   -- Mods Loaded --     (Forge/NeoForge)
//   ...

const DASH_SECTION_REGEX = /^-- (.+) --$/;
const JAVA_FRAME_REGEX = /^\s*at\s+([^\s(]+)\.([^.\s(]+)\(([^)]*)\)/;

function splitDashSections(lines: string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  let buffer: string[] = [];
  for (const line of lines) {
    const match = line.match(DASH_SECTION_REGEX);
    if (match && match[1]) {
      if (current) sections.set(current, buffer);
      current = match[1].trim();
      buffer = [];
      continue;
    }
    if (current) buffer.push(line);
  }
  if (current) sections.set(current, buffer);
  return sections;
}

function parseJavaFrames(lines: string[]): CallStackFrame[] {
  const frames: CallStackFrame[] = [];
  for (const raw of lines) {
    const match = raw.match(JAVA_FRAME_REGEX);
    if (!match) continue;
    const fqcn = match[1] ?? "";
    const method = match[2] ?? "";
    const source = match[3] ?? "";
    const frame: CallStackFrame = {
      module: fqcn.split(".")[0] ?? "(unknown)",
      function: `${fqcn}.${method}`,
    };
    if (source) frame.offset = source;
    frames.push(frame);
  }
  return frames;
}

function parseModsLoaded(lines: string[]): LoadedPlugin[] {
  const out: LoadedPlugin[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("Details:")) continue;
    // Forge format: "| ModName | mod_id | 1.0.0 | mod_filename.jar | ... |"
    if (line.startsWith("|")) {
      const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        const entry: LoadedPlugin = { name: parts[1] ?? parts[0] ?? "(unnamed)" };
        out.push(entry);
        continue;
      }
    }
    // Fabric / older Forge:  "modname-1.2.3.jar"
    if (line.endsWith(".jar")) {
      out.push({ name: line });
    }
  }
  return out;
}

export function parseMinecraftCrashReport(text: string): CrashlogParseResult {
  const lines = text.split(/\r?\n/);
  const sections = splitDashSections(lines);

  // Time + Description live before any -- section --
  const headerLines: string[] = [];
  for (const line of lines) {
    if (DASH_SECTION_REGEX.test(line)) break;
    headerLines.push(line);
  }

  let timestamp: string | undefined;
  let description: string | undefined;
  for (const raw of headerLines) {
    const line = raw.trim();
    if (line.startsWith("Time:")) timestamp = line.slice(5).trim();
    if (line.startsWith("Description:")) description = line.slice(12).trim();
  }

  // Java exception starts somewhere after Description and before "-- Head --"
  // First line that isn't "Time:" / "Description:" / blank / a comment is the
  // exception summary; subsequent indented "at ..." lines are frames.
  const exceptionType = (() => {
    for (const raw of headerLines) {
      const line = raw.trim();
      if (!line || line.startsWith("//")) continue;
      if (line.startsWith("Time:") || line.startsWith("Description:")) continue;
      if (line.startsWith("at ")) continue;
      const m = line.match(/^([\w.$]+(?:Exception|Error|Throwable))/);
      if (m && m[1]) return m[1];
    }
    return undefined;
  })();

  const callStack = parseJavaFrames(headerLines);

  const modsSection =
    sections.get("Mods Loaded") ?? sections.get("Mods Detected");
  const loadedPlugins = modsSection ? parseModsLoaded(modsSection) : [];

  const rawSections: Record<string, string> = {};
  for (const [name, content] of sections) {
    rawSections[name] = content.join("\n").trim();
  }

  const exception: CrashlogParseResult["exception"] = {};
  if (exceptionType) exception.type = exceptionType;
  if (description) exception.description = description;

  const result: CrashlogParseResult = {
    detectedType: "minecraft",
    exception,
    callStack,
    loadedPlugins,
    rawSections,
  };
  if (timestamp) result.timestamp = timestamp;
  return result;
}
