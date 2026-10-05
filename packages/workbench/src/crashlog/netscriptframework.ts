import type {
  CallStackFrame,
  CrashlogParseResult,
  LoadedModule,
  LoadedPlugin,
  PapyrusFunction,
  SuspectedRef,
} from "./types.js";
import { PLAYER_FORM_IDS } from "./types.js";
import { assetPaths } from "./assets.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

// "Possible relevant objects" rows, as real logs write them:
//   [  11]    TESNPC(Name: `Prisoner`, FormId: 00000007, File: `Skyrim Unbound.esp <- ccbgssse018-shadowrend.esl <- Skyrim.esm`)
//   [ 404]    TESObjectREFR(FormId: D8841320, File: `Skyrim Unbound.esp`, BaseForm: TESObjectCONT(Name: `Large Sack`, ...))
//   [ 238]    BSTriShape(Name: `IronShieldHeavy:0`)
// File lists every plugin that has the record, the last one to change it first. An object it holds (BaseForm, Owner)
// is written after the object's own fields and has its own row; a reference keeps its BaseForm's id, since the two are
// one thing in the game. A row with no FormId is not a game form.
// The number in brackets is not how relevant the object is but how far from the registers it was found
// (Framework/CrashLog.cs): an object in a register is at 0 or 1, one in the stack slot [SP+8*i] at i+2, and an object
// another holds at that one's distance. The list is every object found in the registers and the stack, sorted by that
// number alone, so NetScriptFramework makes no guess about which one matters: a row is a register or a stack object.

function readObjects(rows: string[]): SuspectedRef[] {
  const refs: SuspectedRef[] = [];
  for (const raw of rows) {
    const row = /^\s*\[\s*(\d+)\]\s+([A-Za-z_][\w:<>]*)\((.*)\)\s*$/.exec(raw);
    if (!row?.[1] || !row[2] || row[3] === undefined) continue;
    const own = row[3].split(/,\s*(?:BaseForm|Owner):/)[0] ?? "";
    const id = /\bFormId:\s*([0-9A-Fa-f]{8})\b/.exec(own)?.[1];
    if (!id) continue;
    const origin = Number.parseInt(row[1], 10) <= 1 ? "register" : "stack";
    const ref: SuspectedRef = { type: "formid", value: `0x${id.toUpperCase()}`, origin, kind: row[2] };
    const name = /\bName:\s*`([^`]*)`/.exec(own)?.[1];
    if (name && !PLAYER_FORM_IDS.has(ref.value)) ref.name = name;
    const files = (/\bFile:\s*`([^`]*)`/.exec(own)?.[1] ?? "").split("<-").map((f) => f.trim()).filter(Boolean);
    if (files[0]) {
      ref.likelySource = files[0];
      ref.plugins = files.reverse();
    }
    const base = /\bFormId:\s*([0-9A-Fa-f]{8})\b/.exec(row[3].split(/,\s*BaseForm:/)[1] ?? "")?.[1];
    if (base) ref.base = `0x${base.toUpperCase()}`;
    refs.push(ref);
  }
  return refs;
}

// A Papyrus function in the Registers and Stack groups, as real logs write it:
//   (BSScript::Internal::ScriptFunction*) -> (File: JValue.psc, Type: JValue, Name: GotoState)
//   (BSScript::Internal::CodeTasklet**) -> (Function: BSScript::Internal::ScriptFunction(File: ..., Type: metaSkillMenuScript, Name: load_data))
//   (BSScript::NativeFunction2<Actor, bool, SpellItem*, bool>**) -> (File: <native>, Type: Actor, Name: AddSpell)
// Type is the script, Name the function. The File is sometimes garbled, so it isn't kept; "<native>" means native code.

function readPapyrus(lines: string[]): PapyrusFunction[] {
  const out: PapyrusFunction[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const m of line.matchAll(/\(File: ([^,()]*), Type: ([^,()\s]+), Name: ([^,()\s]+)\)/g)) {
      if (!m[2] || !m[3]) continue;
      const key = `${m[2]}.${m[3]}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ script: m[2], function: m[3], ...(m[1]?.trim() === "<native>" ? { native: true as const } : {}) });
      if (out.length === 8) return out;
    }
  }
  return out;
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

  const rows: Array<{ frame: CallStackFrame; value: bigint }> = [];
  for (const raw of group(/^Probable callstack\b/i)) {
    const m = /^\s*\[(\d+)\]\s+(0x[0-9A-Fa-f]+)(?:\s+\((.+?)\+([0-9A-Fa-f]+)\))?(?:\s+(\S.*?))?\s*$/.exec(raw);
    if (!m?.[1] || !m[2]) continue;
    const frame: CallStackFrame = { index: Number.parseInt(m[1], 10), module: m[3] ?? "(unknown)" };
    if (m[4]) frame.offset = m[4];
    if (m[5]) frame.function = m[5];
    rows.push({ frame, value: BigInt(m[2]) });
  }
  // When it can't unwind the stack, NetScriptFramework lists the stack's raw slots instead: frames 1, 2, ... are then
  // the values at [SP+0], [SP+8], ... (seen in real logs). On x64 Windows every call leaves the callee at least 32 bytes
  // of stack (Microsoft's x64 calling convention), so two return addresses never sit in neighbouring slots: frames 1
  // and 2 matching the first two slots means the list is stack memory, and its frames are marked "scan".
  // Windows maps no user-mode memory below 0x10000 or above 0x7FFFFFFFFFFF (Microsoft, "Virtual address spaces"), so
  // a value outside that can't be where code returns to: such a frame is dropped, except frame 0, where it stopped.
  const slots = group(/^Stack$/).map((raw) => /^\s*\[SP\+[0-9A-Fa-f]+\]\s+(0x[0-9A-Fa-f]+)/.exec(raw)?.[1]);
  const scanned =
    rows.length > 2 && slots[0] !== undefined && slots[1] !== undefined && rows[1]?.value === BigInt(slots[0]) && rows[2]?.value === BigInt(slots[1]);
  const callStack: CallStackFrame[] = [];
  rows.forEach(({ frame, value }, position) => {
    if (position > 0 && (value < 0x10000n || value > 0x7fffffffffffn)) return;
    if (position > 0 && scanned) frame.source = "scan";
    callStack.push(frame);
  });

  const loadedPlugins: LoadedPlugin[] = [];
  for (const raw of group(/^Game plugins\b/i)) {
    const m = /^\s*\[([0-9A-Fa-f]{2}(?: [0-9A-Fa-f]{3})?)\]\s+(.+?)\s*$/.exec(raw);
    if (m?.[1] && m[2]) loadedPlugins.push({ loadIndex: m[1], name: m[2] });
  }

  const rawSections: Record<string, string> = {};
  for (const g of groups) rawSections[g.name.replace(/\s*\(\d+\)$/, "")] = g.lines.join("\n").trim();

  const result: CrashlogParseResult = {
    detectedType: "netscriptframework",
    exception,
    callStack,
    loadedPlugins,
    // Without a "Game plugins" group the log has no plugin list; "Plugins (N)" is the framework's own .NET plugins.
    pluginList: loadedPlugins.length > 0 ? "listed" : "absent",
    rawSections,
  };
  const app = fields["ApplicationName"];
  const version = fields["ApplicationVersion"];
  if (app && version) result.gameVersion = `${app} v${version}`;
  const framework = fields["FrameworkName"];
  const frameworkVersion = fields["FrameworkVersion"];
  if (framework && frameworkVersion) result.loggerVersion = `${framework} v${frameworkVersion}`;
  // "Time: 26 Jan 2024 23:40:39.174", the player's local time, as every real log writes it. Other month names aren't guessed at.
  const time = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}:\d{2}:\d{2})/.exec(fields["Time"] ?? "");
  if (time?.[1] && time[2] && time[3] && time[4]) {
    const month = String(MONTHS.indexOf(time[2]) + 1).padStart(2, "0");
    result.timestamp = `${time[3]}-${month}-${time[1].padStart(2, "0")} ${time[4]}`;
  }
  // "SkyrimSE.exe:      0x7FF747E50000": the name, a colon, and the address it was loaded at.
  const modules: LoadedModule[] = [];
  for (const raw of group(/^Modules$/)) {
    const row = /^\s*(.+?):\s+(0x[0-9A-Fa-f]+)\s*$/.exec(raw);
    if (row?.[1] && row[2]) modules.push({ name: row[1], base: row[2] });
  }
  if (modules.length > 0) result.modules = modules;
  const memory = [...group(/^Registers$/), ...group(/^Stack$/)];
  const assets = assetPaths(memory);
  if (assets.length > 0) result.assetPaths = assets;
  const papyrus = readPapyrus(memory);
  if (papyrus.length > 0) result.papyrus = papyrus;
  const suspectedRefs = readObjects(group(/^Possible relevant objects\b/i));
  if (suspectedRefs.length > 0) result.suspectedRefs = suspectedRefs;
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
    pluginList: loadedPlugins.length > 0 ? "listed" : "absent",
    rawSections,
  };
  const version = fields["Version"];
  const app = fields["Application"];
  if (version && app) result.gameVersion = `${app} v${version}`;
  return result;
}
