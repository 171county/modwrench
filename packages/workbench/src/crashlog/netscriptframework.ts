import type {
  CallStackFrame,
  CrashlogParseResult,
  LoadedPlugin,
} from "./types.js";

// NetScriptFramework crash logs are older Skyrim / Skyrim LE territory. The
// format is line-oriented with explicit field labels rather than the section
// blocks Crash Logger SSE uses. Common fields:
//   NetScriptFramework Crash Log
//   Crash Reason: AccessViolationException reading address 0x0
//   Application: SkyrimSE.exe
//   Version: 1.5.97.0
//   Crashed thread is main thread: True
//
// Then a "Call Stack:" block followed by frames, and "Loaded Plugins:" with
// indexed plugins similar to CL SSE.

const KV_REGEX = /^([A-Za-z][A-Za-z0-9 ]+):\s*(.*)$/;

export function parseNetScriptFramework(text: string): CrashlogParseResult {
  const lines = text.split(/\r?\n/);

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
        const frame: CallStackFrame = {
          module: match[2] ?? "(unknown)",
        };
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
