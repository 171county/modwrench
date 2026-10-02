import type { CrashlogParseResult, CrashlogType } from "../crashlog/types.js";
import type { ModuleKind, SystemFacts } from "./types.js";

// ─── Words for what a crash log says ─────────────────────────────────────────
// A crash log is written in module names and exception codes. This turns them into
// the plain sentence a player can act on, and decides which names on the call stack
// belong to the game, Windows or a driver rather than to a mod.
//
// The lists below are short on purpose. They hold names that are documented and
// stable (Windows' own libraries, the graphics vendors' drivers, the overlays that
// hook every game, the script extenders). Anything not on them is treated as a mod,
// which is what makes a mod the first suspect: a name missing from a list can only
// ever promote someone's mod to a lead, never hide one.

// ─── Which module is whose ───────────────────────────────────────────────────

const GAME =
  /^(?:skyrimse|skyrimvr|skyrim|tesv|fallout4|fallout4vr|falloutnv|falloutlauncher|fallout3|fallout|starfield|oblivion|oblivionremastered|oblivion-win64-shipping|valheim|lethal company|repo|ror2|risk of rain 2|dyson sphere program|boneworks|unityplayer|unitycrashhandler(?:32|64)|gameassembly|assembly-csharp(?:-firstpass)?)$/;

const EXTENDER = /^(?:skse64|skse|sksevr|f4se|f4sevr|nvse|fose|obse64|obse|sfse)(?:_\d+(?:_\d+)*)?(?:_loader)?$/;

const SYSTEM =
  /^(?:kernel32|kernelbase|ntdll|user32|gdi32|gdi32full|win32u|msvcp\d*(?:_\d+)?|vcruntime\d*(?:_\d+)?|ucrtbase|msvcrt|combase|ole32|oleaut32|rpcrt4|sechost|shell32|shlwapi|advapi32|ws2_32|wininet|winhttp|bcrypt|bcryptprimitives|crypt32|imm32|dbghelp|wow64\w*|apphelp|clr|coreclr|clrjit|mscoree|mscorwks|vcomp\d*|concrt\d*|vccorlib\d*|comctl32|uxtheme|dwmapi|setupapi|cfgmgr32|wintrust|msasn1|mswsock|iphlpapi|nsi|kernel\.appcore|ntmarta|powrprof|profapi|cryptsp|rsaenh|bcryptprimitives|mfplat|mf|wldp|windows\.storage|sspicli|secur32|wtsapi32|userenv|netapi32|samcli|wkscli|cryptbase|devobj|msctf|textinputframework|coremessaging|coreuicomponents|oleacc|propsys|shcore|normaliz|urlmon|iertutil|winspool|comdlg32|clbcatq|msimg32|wsock32|dnsapi|winnsi|ncrypt|gpapi|cabinet|ucrtbased|vcruntime140d|msvcp140d)$/;

const GRAPHICS =
  /^(?:nvwgf2umx|nvwgf2um|nvd3dumx?|nvoglv64|nvapi64?|nvcuda|nvlddmkm|nvml|atidxx64|atiumd64|atiumd6a|amdxc64|amdxx64|amdvlk64|aticfx64|atiuxp64|amdihk64|igd\d*\w*umd64|igxelpicd64|igdumdim64|igc64|d3d9|d3d10|d3d10_1|d3d11|d3d12|d3d12core|dxgi|d3dcompiler_\d+e?|dxcore|dxil|vulkan-1|opengl32|dxva2|d3dx9_\d+|d3dx11_\d+|d3d8)$/;

// Overlays and hooks that attach to every game, and the Windows libraries mods replace to get loaded.
const OVERLAY =
  /^(?:gameoverlayrenderer64?|gameoverlayui|rtsshooks64?|rtss|msiafterburner|discordhook64?|discordoverlay\w*|nvspcap64|nvsmartmaxapp\w*|graphics-hook(?:32|64)|obs-?graphics-?capture\w*|reshade\w*|enbseries|enbhelper\w*|dinput8?|dinput|winmm|version|xinput\d_\d|xinput9_1_0|dsound|overwolf\w*|medal\w*|fraps\d*|bdcam\w*|nahimic\w*|sonic\w*overlay|eosoverlay\w*|galaxy(?:64)?|steamclient64?|steam_api64?|bink2w64|binkw64|nvrtc\w*)$/;

const FRAMEWORK =
  /^(?:system(?:\.[\w.]+)?|microsoft(?:\.[\w.]+)?|mscorlib|netstandard|mono(?:\.[\w.]+)?|monomod(?:\.[\w.]+)?|unityengine(?:\.[\w.]+)?|unity(?:\.[\w.]+)?|tmpro|newtonsoft(?:\.[\w.]+)?|bepinex(?:\.[\w.]+)?|0harmony|harmonylib|harmony|il2cppinterop(?:\.[\w.]+)?|il2cppassemblygenerator|steamworks(?:\.[\w.]+)?|facepunch(?:\.[\w.]+)?|netcode(?:\.[\w.]+)?|melonloader(?:\.[\w.]+)?|cecil|mono\.cecil|accessibilitymodule|assembly-csharp-firstpass|<module>)$/;

/** The base name of a module, lower-case, without folders, an attached "+offset" or an extension. */
export function moduleBase(name: string): string {
  const file = name.replace(/\\/g, "/").split("/").pop() ?? name;
  return file
    .replace(/\+[0-9a-f]+$/i, "")
    .replace(/\.(?:dll|exe|asi|so|dylib|sys)$/i, "")
    .trim()
    .toLowerCase();
}

/** "SomeMod.dll+12345" -> its name and its offset, for the older log formats that print them as one token. */
export function splitModule(name: string): { name: string; offset?: string } {
  const m = /^(.+?)\+([0-9A-Fa-f]+)$/.exec(name.trim());
  return m?.[1] && m[2] ? { name: m[1], offset: m[2] } : { name: name.trim() };
}

export function classifyModule(name: string): ModuleKind {
  const base = moduleBase(name);
  // No module at all: an address the logger couldn't place in any DLL, or a namespace that isn't a loaded mod's.
  if (base === "" || base === "(unknown)") return "unknown";
  if (GAME.test(base)) return "game";
  if (EXTENDER.test(base)) return "extender";
  if (SYSTEM.test(base)) return "system";
  if (GRAPHICS.test(base)) return "graphics";
  if (OVERLAY.test(base)) return "overlay";
  if (FRAMEWORK.test(base)) return "framework";
  return "mod";
}

/** How to refer to the owner of a kind of module in a sentence. */
export const KIND_PHRASE: Record<ModuleKind, string> = {
  game: "the game's own code",
  extender: "the script extender",
  system: "Windows",
  graphics: "the graphics layer",
  overlay: "an overlay or loader",
  framework: "the runtime (Unity, .NET or the mod loader)",
  mod: "a mod",
  unknown: "code that isn't from a mod ModWrench can identify",
};

// ─── Exceptions ──────────────────────────────────────────────────────────────

type ExceptionRule = { match: RegExp; plain: string };

// Plain-language meanings of the exception codes Windows and .NET report. Each is the
// documented meaning of the code, put in words a player can use. None says whose fault it is.
const EXCEPTIONS: ExceptionRule[] = [
  {
    match: /ACCESS_VIOLATION|AccessViolationException/i,
    plain:
      "The game tried to use memory it doesn't own. This is the most common kind of crash and, on its own, doesn't say whose fault it was.",
  },
  {
    match: /STACK_OVERFLOW|StackOverflowException/i,
    plain: "The game ran out of room for its function calls, which usually means code calling itself in an endless loop.",
  },
  {
    match: /ILLEGAL_INSTRUCTION/i,
    plain:
      "The processor was told to run something that isn't valid code. It can happen when a plugin's code no longer lines up with the game (after a game update, say) or when a file is damaged.",
  },
  {
    match: /INT_DIVIDE_BY_ZERO|DivideByZeroException/i,
    plain: "Code divided a number by zero.",
  },
  {
    match: /BREAKPOINT/i,
    plain: "Code stopped on purpose: a built-in safety check (an assertion) failed.",
  },
  {
    match: /IN_PAGE_ERROR/i,
    plain:
      "Windows couldn't read part of a file it had loaded into memory. Failing or disconnected storage, or a damaged file, are the usual reasons.",
  },
  {
    match: /PRIV_INSTRUCTION/i,
    plain: "Code tried to run an instruction that programs aren't allowed to run, which points at corrupt code or memory.",
  },
  {
    match: /bad_alloc|OutOfMemoryException|out of memory/i,
    plain:
      "The game asked for memory and couldn't get any. That can be system memory, the Windows page file or video memory, and very large texture or mesh sets are the usual cause.",
  },
  {
    match: /E06D7363|C\+\+ exception/i,
    plain: "A C++ exception that nothing handled.",
  },
  {
    match: /NullReferenceException/i,
    plain: "Code used something that was empty (a null reference).",
  },
  {
    match: /MissingMethodException|MissingFieldException|MissingMemberException/i,
    plain:
      "A mod called code that doesn't exist in the version of the game or of another mod that is installed. It was built for different versions.",
  },
  {
    match: /ReflectionTypeLoadException|TypeLoadException|BadImageFormatException/i,
    plain:
      "A mod couldn't load because something it depends on is missing or is the wrong version. It was built for different versions of the game or of another mod.",
  },
  {
    match: /FileNotFoundException|DllNotFoundException|FileLoadException/i,
    plain: "A mod needs a file or library that isn't there, or that couldn't be loaded.",
  },
  {
    match: /TypeInitializationException/i,
    plain: "A mod's setup code failed while starting. The exception inside it (the inner exception) says why.",
  },
  {
    match: /HarmonyException/i,
    plain: "A mod failed to patch the game's code (through Harmony). The mod was most likely built for another version of the game.",
  },
  {
    match: /IndexOutOfRangeException|ArgumentOutOfRangeException/i,
    plain: "Code asked for an item at a position that doesn't exist.",
  },
  {
    match: /KeyNotFoundException/i,
    plain: "Code looked something up by a name or key that isn't there.",
  },
  {
    match: /InvalidOperationException/i,
    plain: "Code did something that wasn't allowed in its current state (the message says what).",
  },
  {
    match: /InvalidCastException/i,
    plain: "Code treated something as the wrong kind of thing.",
  },
  {
    match: /ArgumentNullException/i,
    plain: "Code was handed nothing where it needed something.",
  },
  {
    match: /NotImplementedException|NotSupportedException/i,
    plain: "Code reached something that was never finished or isn't supported.",
  },
];

export type ExceptionExplanation = { plain: string; basis: "rule" };

export type Fault = { access: "read" | "write" | "execute" | "unknown"; address: string };

/**
 * What touching a particular address means. Windows never maps the first 64 KB of the address space,
 * so an access that low is a pointer that was empty (or an empty pointer plus a small field offset),
 * which is the most common shape of crash there is.
 */
function describeFault(fault: Fault | undefined): string {
  if (!fault) return "";
  let n: bigint;
  try {
    n = BigInt(fault.address);
  } catch {
    return "";
  }
  const where = `0x${n.toString(16).toUpperCase()}`;
  const verb = fault.access === "write" ? "write to" : fault.access === "execute" ? "run code at" : "read from";
  if (n === 0n) {
    return " It was at address 0, which means code followed a pointer that pointed at nothing: something asked for an object that wasn't there.";
  }
  if (n < 0x10000n) {
    return ` It tried to ${verb} address ${where}, just past 0. That usually means code followed an empty pointer to an object and then reached into one of its fields: something asked for an object that wasn't there.`;
  }
  return "";
}

/**
 * What an exception means, in a sentence. Null when the code isn't one of the common ones;
 * the caller then quotes it as written rather than inventing a meaning.
 */
export function explainException(type?: string, description?: string, fault?: Fault): ExceptionExplanation | null {
  const text = `${type ?? ""} ${description ?? ""}`;
  for (const rule of EXCEPTIONS) {
    if (rule.match.test(text)) {
      let plain = rule.plain;
      if (/ACCESS_VIOLATION|AccessViolation/i.test(text)) {
        if (fault) {
          plain += describeFault(fault);
        } else if (/(?:reading|writing|read|write)\D{0,12}0x0+\b/i.test(description ?? "")) {
          // NetScriptFramework words it "reading address 0x0".
          plain += describeFault({ access: /writ/i.test(description ?? "") ? "write" : "read", address: "0x0" });
        }
      }
      return { plain, basis: "rule" };
    }
  }
  return null;
}

// ─── The rest of what a crash logger records ─────────────────────────────────

const GB = String.raw`(\d+(?:\.\d+)?)`;

function pair(text: string): [number, number] | undefined {
  // "14.20 GB/31.92 GB" and "6.20/7.40 GB"
  const m = new RegExp(`${GB}\\s*(?:GB)?\\s*/\\s*${GB}\\s*GB`, "i").exec(text);
  if (!m?.[1] || !m[2]) return undefined;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? [a, b] : undefined;
}

/** Hardware and memory from a log's SYSTEM SPECS section; every field is optional because loggers differ. */
export function readSystem(section: string | undefined): SystemFacts | undefined {
  if (!section) return undefined;
  const facts: SystemFacts = { gpus: [] };
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toUpperCase();
    const value = line.slice(colon + 1).trim();
    if (!value || /unable to determine|failed/i.test(value)) continue;
    if (key === "OS") facts.os = value.slice(0, 120);
    else if (key === "CPU") facts.cpu = value.slice(0, 120);
    else if (/^GPU #\d+$/.test(key)) facts.gpus.push(value.slice(0, 120));
    else if (key === "PHYSICAL MEMORY") {
      const p = pair(value);
      if (p) facts.ram = { used: p[0], total: p[1] };
    } else if (key === "VIRTUAL MEMORY") {
      const p = pair(value);
      if (p) facts.commit = { used: p[0], total: p[1] };
    } else if (key === "GPU MEMORY") {
      const p = pair(value);
      if (p) facts.vram = { used: p[0], budget: p[1] };
    } else if (key === "DETECTED VIRTUAL MACHINE") facts.virtualMachine = value.slice(0, 80);
  }
  const any = facts.os || facts.cpu || facts.gpus.length > 0 || facts.ram || facts.commit || facts.vram;
  return any ? facts : undefined;
}

export type CppException = { type?: string; info?: string; throwLocation?: string; module?: string };

/** Crash Logger SSE's "C++ EXCEPTION:" block: what was thrown, its message, and where it came from. */
export function readCppException(section: string | undefined): CppException | undefined {
  if (!section) return undefined;
  const out: CppException = {};
  for (const raw of section.split(/\r?\n/)) {
    const m = /^\s*(Type|Info|Throw Location|Module):\s*(.+?)\s*$/.exec(raw);
    if (!m?.[1] || !m[2] || /^<.*>$/.test(m[2])) continue;
    const value = m[2].slice(0, 200);
    if (m[1] === "Type") out.type = value;
    else if (m[1] === "Info") out.info = value;
    else if (m[1] === "Throw Location") out.throwLocation = value;
    else out.module = value;
  }
  return out.type || out.info || out.throwLocation || out.module ? out : undefined;
}

// ─── Plugins that come with the game ─────────────────────────────────────────

const OFFICIAL_PLUGINS = new Set([
  "skyrim.esm", "update.esm", "dawnguard.esm", "hearthfires.esm", "dragonborn.esm", "_resourcepack.esl",
  "fallout4.esm", "dlcrobot.esm", "dlcworkshop01.esm", "dlcworkshop02.esm", "dlcworkshop03.esm", "dlccoast.esm", "dlcnukaworld.esm",
  "falloutnv.esm", "fallout3.esm", "oblivion.esm",
]);

/** Skyrim's and Fallout 4's Creation Club files are named like "ccBGSSSE001-Fish.esm" and "ccBGSFO4001-PipBoy(Black).esl". */
const CREATION_CLUB = /^cc[a-z]{2,6}(?:sse|fo4)\d{3}/i;

/** True for the plugins the game and its paid content ship with, which show up in almost every crash log and say nothing about a mod. */
export function isOfficialPlugin(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return OFFICIAL_PLUGINS.has(lower) || CREATION_CLUB.test(lower);
}

// ─── The game ────────────────────────────────────────────────────────────────

export type GameFacts = { name: string; version?: string; id?: string };

const GAMES_BY_EXE: Record<string, { name: string; id: string }> = {
  skyrimse: { name: "Skyrim Special Edition", id: "skyrimspecialedition" },
  skyrimvr: { name: "Skyrim VR", id: "skyrimvr" },
  skyrim: { name: "Skyrim", id: "skyrim" },
  fallout4: { name: "Fallout 4", id: "fallout4" },
  fallout4vr: { name: "Fallout 4 VR", id: "fallout4vr" },
  falloutnv: { name: "Fallout: New Vegas", id: "falloutnv" },
  starfield: { name: "Starfield", id: "starfield" },
};

const GAMES_BY_NAME: Array<{ match: RegExp; name: string; id: string }> = [
  { match: /^skyrim\s+vr\b/i, name: "Skyrim VR", id: "skyrimvr" },
  { match: /^skyrim\s+(?:sse|se|ae|special|anniversary)\b/i, name: "Skyrim Special Edition", id: "skyrimspecialedition" },
  { match: /^fallout\s*4\s*vr\b/i, name: "Fallout 4 VR", id: "fallout4vr" },
  { match: /^fallout\s*4\b/i, name: "Fallout 4", id: "fallout4" },
  { match: /^starfield\b/i, name: "Starfield", id: "starfield" },
  { match: /^lethal company\b/i, name: "Lethal Company", id: "lethalcompany" },
  { match: /^valheim\b/i, name: "Valheim", id: "valheim" },
  { match: /^r\.?e\.?p\.?o\.?\b/i, name: "R.E.P.O.", id: "repo" },
  { match: /^risk of rain 2\b/i, name: "Risk of Rain 2", id: "riskofrain2" },
  { match: /^dyson sphere program\b/i, name: "Dyson Sphere Program", id: "dysonsphereprogram" },
];

/** Which game and version a crash log is from, as far as the log says. */
export function describeGame(parsed: CrashlogParseResult, rawHead: string): GameFacts {
  const line = parsed.gameVersion ?? "";
  const versionMatch = /\bv?(\d+(?:\.\d+){1,3})\s*$/.exec(line);
  const version = versionMatch?.[1];
  const label = line.replace(/\s+v?\d+(?:\.\d+){1,3}\s*$/, "").trim();

  const byName = GAMES_BY_NAME.find((g) => g.match.test(label));
  if (byName) return { name: byName.name, ...(version ? { version } : {}), id: byName.id };

  const exe = GAMES_BY_EXE[moduleBase(label)];
  if (exe) return { name: exe.name, ...(version ? { version } : {}), id: exe.id };

  // BepInEx's first line names the game: "BepInEx 5.4.21.0 - Lethal Company (1/15/2024 2:30:00 PM)".
  if (parsed.detectedType === "bepinex") {
    const named = /BepInEx\s+[\d.]+(?:\.\d+)?\s+-\s+(.+?)\s+\(/.exec(rawHead)?.[1]?.trim();
    if (named) {
      const known = GAMES_BY_NAME.find((g) => g.match.test(named));
      return known ? { name: known.name, id: known.id } : { name: named };
    }
  }
  return { name: label || "an unknown game", ...(version ? { version } : {}) };
}

/** The script extender named by the call stack ("skse64_1_6_1170.dll"), if the stack shows one. */
export function extenderFromFrames(frames: Array<{ module: string }>): string | undefined {
  for (const frame of frames) {
    if (classifyModule(frame.module) === "extender") return frame.module;
  }
  return undefined;
}

export function formatName(format: CrashlogType): string {
  switch (format) {
    case "crashlogger-sse":
      return "Crash Logger SSE";
    case "buffout4":
      return "Buffout 4";
    case "netscriptframework":
      return "NetScriptFramework";
    case "bepinex":
      return "BepInEx";
    default:
      return "an unrecognised crash logger";
  }
}
