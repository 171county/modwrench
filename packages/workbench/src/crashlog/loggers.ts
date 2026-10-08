// ─── Crash loggers, by the DLL each one installs ─────────────────────────────
// Crash Whisperer looks for these in a crash log's list of loaded modules, and the
// Doctors look for them among the game's script extender plugins. Each name comes
// from the logger's own build files or source, and most have also been seen in real
// crash logs:
//   CrashLogger.dll                 Crash Logger SSE: its CMake files; seen in real logs' module lists
//   trainwreck.dll                  Trainwreck: its author's API header; seen in a real log
//   NetScriptFramework.Runtime.dll  .NET Script Framework, which sits in Data\DLLPlugins; seen in a real log
//   Buffout4.dll                    Buffout 4 and Buffout 4 NG: their CMake files
//   Buffout4AE.dll, MiniBuffAE.dll  Buffout 4 AE (MiniBuff): its build file; Addictol's source checks both names
//   AddictolCrashLogger.dll         Addictol's crash logger: its build files
// A logger that ships under another name isn't recognised, and whatever uses this says so.

export type CrashLogger = {
  /** What players call it. */
  name: string;
  /** The game it is made for, by ModWrench's game id. */
  game: "skyrimspecialedition" | "fallout4";
  /** The DLL it installs, spelled the way it ships. */
  dll: string;
  /** Where the DLL goes: the script extender's plugin folder, or Data\DLLPlugins. */
  folder: "plugins" | "dllplugins";
  /** Crash Whisperer reads the logs it writes. */
  readable: boolean;
};

export const CRASH_LOGGERS: readonly CrashLogger[] = [
  { name: "Crash Logger SSE", game: "skyrimspecialedition", dll: "CrashLogger.dll", folder: "plugins", readable: true },
  { name: "Trainwreck", game: "skyrimspecialedition", dll: "trainwreck.dll", folder: "plugins", readable: false },
  { name: ".NET Script Framework", game: "skyrimspecialedition", dll: "NetScriptFramework.Runtime.dll", folder: "dllplugins", readable: true },
  { name: "Buffout 4", game: "fallout4", dll: "Buffout4.dll", folder: "plugins", readable: true },
  { name: "Buffout 4 AE (MiniBuff)", game: "fallout4", dll: "Buffout4AE.dll", folder: "plugins", readable: false },
  { name: "Buffout 4 AE (MiniBuff)", game: "fallout4", dll: "MiniBuffAE.dll", folder: "plugins", readable: false },
  { name: "Addictol Crash Logger", game: "fallout4", dll: "AddictolCrashLogger.dll", folder: "plugins", readable: false },
];

/** The loggers whose DLL is among `names` (lower-case file names, with or without ".dll"), each named once, in table order. */
export function loggersNamed(names: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const logger of CRASH_LOGGERS) {
    const file = logger.dll.toLowerCase();
    const hit = names.has(file) || names.has(file.replace(/\.dll$/, ""));
    if (hit && !out.includes(logger.name)) out.push(logger.name);
  }
  return out;
}
