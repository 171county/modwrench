import type {
  CallStackFrame,
  CrashlogParseResult,
  LoadedPlugin,
} from "./types.js";

// NetScriptFramework (Skyrim SE 1.5.97) writes its crash log the way its own source
// (meh321/NetScriptFramework, Framework/CrashLog.cs) lays it out: one line saying where
// it happened, a header of "Key: value" lines, then named groups in braces:
//   Unhandled native exception occurred at 0x7FF6756DF5E2 (SkyrimSE.exe+84F5E2) on thread 17984!
//   FrameworkName: NetScriptFramework
//   ApplicationName: SkyrimSE.exe
//   ApplicationVersion: 1.5.97.0
//   Time: 14 Aug 2022 09:11:36.828
//   Possible relevant objects (4)
//   {
//     [   0]    TESNPC(Name: `X`, FormId: 00000007, File: `Some.esp <- Skyrim.esm`)
//   }
//   Probable callstack
//   {
//     [0]   0x7FF6756DF5E2     (SkyrimSE.exe+84F5E2)          ThirdPersonState::Update_84F490+152
//     [2]   0x1E7255C7700
//   }
//   Registers, Stack, Modules and Plugins (N) (the framework's own .NET plugins) follow. "Game plugins (N)", with
//   rows like "[00] Skyrim.esm" and "[FE 000] Light.esl", isn't in the published source (the game library, which
//   isn't published, adds it); its layout is read from real logs.
// A native crash log names no exception code, only the address.

/** The top-level groups of a braced log, by name, with the lines between their braces, and the header's fields. */
function readGroups(lines: string[]): { fields: Record<string, string>; groups: Array<{ name: string; lines: string[] }> } {
  const fields: Record<string, string> = {};
  const groups: Array<{ name: string; lines: string[] }> = [];
  let depth = 0;
  let last = "";
  let current: { name: string; lines: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (depth === 0) {
      if (line === "{") {
        depth = 1;
        current = { name: last, lines: [] };
        continue;
      }
      const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
      if (kv?.[1] && kv[2] !== undefined) fields[kv[1]] = kv[2].trim();
      if (line) last = line;
      continue;
    }
    if (line === "{") depth++;
    else if (line === "}" && --depth === 0) {
      if (current) groups.push(current);
      current = null;
      continue;
    }
    current?.lines.push(raw);
  }
  if (current) groups.push(current);
  return { fields, groups };
}

function parseBraced(lines: string[]): CrashlogParseResult {
  const { fields, groups } = readGroups(lines);
  const group = (name: RegExp) => groups.find((g) => name.test(g.name))?.lines ?? [];

  const exception: CrashlogParseResult["exception"] = {};
  const info = lines.find((l) => l.trim() !== "")?.trim() ?? "";
  const happened = /^Unhandled (?:native|managed) exception(?: \((\w+)\))? occurred at (0x[0-9A-Fa-f]+)?/.exec(info);
  if (happened) {
    if (happened[1]) exception.type = happened[1];
    if (happened[2]) exception.address = happened[2];
    exception.description = info;
  }

  const callStack: CallStackFrame[] = [];
  for (const raw of group(/^Probable callstack\b/i)) {
    const m = /^\s*\[(\d+)\]\s+0x[0-9A-Fa-f]+(?:\s+\((.+?)\+([0-9A-Fa-f]+)\))?(?:\s+(\S.*?))?\s*$/.exec(raw);
    if (!m?.[1]) continue;
    const frame: CallStackFrame = { index: Number.parseInt(m[1], 10), module: m[2] ?? "(unknown)" };
    if (m[3]) frame.offset = m[3];
    if (m[4]) frame.function = m[4];
    callStack.push(frame);
  }

  const loadedPlugins: LoadedPlugin[] = [];
  for (const raw of group(/^Game plugins\b/i)) {
    const m = /^\s*\[([0-9A-Fa-f]{2}(?: [0-9A-Fa-f]{3})?)\]\s+(.+?)\s*$/.exec(raw);
    if (m?.[1] && m[2]) loadedPlugins.push({ loadIndex: m[1], name: m[2] });
  }

  const rawSections: Record<string, string> = {};
  for (const g of groups) rawSections[g.name.replace(/\s*\(\d+\)$/, "")] = g.lines.join("\n").trim();

  const result: CrashlogParseResult = { detectedType: "netscriptframework", exception, callStack, loadedPlugins, rawSections };
  const app = fields["ApplicationName"];
  const version = fields["ApplicationVersion"];
  if (app && version) result.gameVersion = `${app} v${version}`;
  return result;
}

// An older, simpler layout is still read: labels ending in a colon ("Crash Reason:", "Call Stack:", "Loaded
// Plugins:") and frames like "(0) 0x7FF7B3D2A3F0 (SkyrimSE.exe+1AA3A3F0)". No NetScriptFramework source writes it.

const KV_REGEX = /^([A-Za-z][A-Za-z0-9 ]+):\s*(.*)$/;

export function parseNetScriptFramework(text: string): CrashlogParseResult {
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => /^FrameworkName:|^Unhandled (?:native|managed) exception occurred at /.test(l.trim()))) {
    return parseBraced(lines);
  }

  const fields: Record<string, string> = {};
  const callStack: CallStackFrame[] = [];
  const loadedPlugins: LoadedPlugin[] = [];
  const rawSections: Record<string, string> = {};

  let mode: "header" | "callstack" | "plugins" | "other" = "header";
  let bufferKey: string | null = null;
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (bufferKey) rawSections[bufferKey] = buffer.join("\n").trim();
    bufferKey = null;
    buffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.endsWith(":") && line.length < 60) {
      flushBuffer();
      const label = line.slice(0, -1).trim();
      if (/call.?stack/i.test(label)) mode = "callstack";
      else if (/plugins/i.test(label)) mode = "plugins";
      else {
        mode = "other";
        bufferKey = label;
      }
      continue;
    }

    if (mode === "callstack") {
      const stripped = line.trim();
      if (!stripped) continue;
      const match = stripped.match(
        /^(?:\(\d+\)\s+)?(0x[0-9A-Fa-f]+)\s+\(?([^)\s]+)\)?(?:\s*([+:]\s*\S+))?(?:\s+(.+))?$/
      );
      if (match) {
        // "(SkyrimSE.exe+1AA3A3F0)": the module and its offset come as one token.
        const joined = /^(.+?)\+([0-9A-Fa-f]+)$/.exec(match[2] ?? "");
        const frame: CallStackFrame = {
          module: joined?.[1] ?? match[2] ?? "(unknown)",
        };
        const index = /^\((\d+)\)/.exec(stripped)?.[1];
        if (index !== undefined) frame.index = Number.parseInt(index, 10);
        if (joined?.[2]) frame.offset = joined[2];
        if (match[3]) frame.offset = match[3].replace(/[+:\s]/g, "");
        if (match[4]) frame.function = match[4].trim();
        callStack.push(frame);
      }
      continue;
    }

    if (mode === "plugins") {
      const stripped = line.trim();
      if (!stripped) continue;
      const match = stripped.match(/^\(?([0-9A-F]{2})\)?\s+(.+)$/);
      if (match) {
        loadedPlugins.push({
          loadIndex: match[1],
          name: (match[2] ?? "").trim(),
        });
      }
      continue;
    }

    if (mode === "header") {
      const kv = line.match(KV_REGEX);
      if (kv && kv[1] && kv[2] !== undefined) {
        fields[kv[1].trim()] = kv[2].trim();
        continue;
      }
    }

    if (mode === "other" && bufferKey) {
      buffer.push(raw);
    }
  }
  flushBuffer();

  const exception: CrashlogParseResult["exception"] = {};
  const reason = fields["Crash Reason"];
  if (reason) {
    const typeMatch = reason.match(/^([A-Za-z]+Exception)/);
    if (typeMatch) exception.type = typeMatch[1];
    const addrMatch = reason.match(/(0x[0-9A-Fa-f]+)/);
    if (addrMatch) exception.address = addrMatch[1];
    exception.description = reason;
  }

  const result: CrashlogParseResult = {
    detectedType: "netscriptframework",
    exception,
    callStack,
    loadedPlugins,
    rawSections,
  };
  const version = fields["Version"];
  const app = fields["Application"];
  if (version && app) result.gameVersion = `${app} v${version}`;
  return result;
}
