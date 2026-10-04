import type { FileVersion } from "../patchday/pe.js";
import type { Index } from "./setup-plugins.js";
import type { DoctorFinding } from "./types.js";

// ─── Crash loggers ───────────────────────────────────────────────────────────
// A crash logger writes the log Crash Whisperer reads. Two of them fight over the
// same crash handler, and one of them is too old for the game's current builds, so
// "which loggers are installed" is worth a line. They are told apart by file name:
//   Crash Logger SSE        SKSE/Plugins/CrashLogger.dll
//   Trainwreck              SKSE/Plugins/trainwreck.dll
//   .NET Script Framework   DLLPlugins/NetScriptFramework.Runtime.dll
// A logger that ships under another name isn't recognised, and the finding says so.

const CRASH_LOGGER_SSE = "https://www.nexusmods.com/skyrimspecialedition/mods/59818";
const NET_SCRIPT_FRAMEWORK = "https://www.nexusmods.com/skyrimspecialedition/mods/21294";

export function installedLoggers(index: Index): string[] {
  const out: string[] = [];
  if (index.skseDlls.has("crashlogger.dll")) out.push("Crash Logger SSE");
  if (index.skseDlls.has("trainwreck.dll")) out.push("Trainwreck");
  if (index.netScript) out.push(".NET Script Framework");
  return out;
}

export function judgeCrashLoggers(index: Index, game: FileVersion | null): DoctorFinding[] {
  const loggers = installedLoggers(index);
  const out: DoctorFinding[] = [];

  if (loggers.length === 0) {
    out.push({
      id: "setup.crash-logger",
      area: "setup",
      status: "note",
      title: "No crash logger found",
      detail:
        "None of Crash Logger SSE, Trainwreck or .NET Script Framework was found among the game's plugins, so after a crash there may be no log to read. " +
        "Loggers are recognised by their usual file names; one that ships under another name isn't.",
      fix: "Crash Logger SSE is a widely used one. It writes a crash log next to the SKSE log in your Documents\\My Games folder.",
      basis: "install",
      source: CRASH_LOGGER_SSE,
    });
    return out;
  }

  if (loggers.length >= 2) {
    const withSse = loggers.includes("Crash Logger SSE");
    out.push({
      id: "setup.crash-logger",
      area: "setup",
      status: "warn",
      title: "More than one crash logger",
      detail:
        `Found ${loggers.join(" and ")}. ` +
        (withSse
          ? "Crash Logger SSE's page says only one crash logger can be active at a time, NetScriptFramework included, and adds \"disable crash dumps in the config\"."
          : "Crash loggers hook the same crash handler, so two active at once can each miss the crash. No page says exactly this for this pair, so treat it as a likely problem rather than a certain one."),
      fix: "Keep one and remove or disable the others.",
      basis: withSse ? "rule" : "guess",
      ...(withSse ? { source: CRASH_LOGGER_SSE } : {}),
      items: loggers,
    });
  } else {
    out.push({
      id: "setup.crash-logger",
      area: "setup",
      status: "ok",
      title: `One crash logger: ${loggers[0]}`,
      detail: "Only one crash logger was found.",
      basis: "install",
    });
  }

  if (index.netScript && game !== null && game[0] === 1 && game[1] >= 6) {
    out.push({
      id: "setup.crash-logger-old",
      area: "setup",
      status: "warn",
      title: ".NET Script Framework is too old for this game version",
      detail: `The game is ${game[0]}.${game[1]}.${game[2]}. NetScriptFramework's page says it isn't compatible with the Anniversary Edition, which is 1.6.x and later, so it can't log crashes on this version.`,
      fix: "Use a crash logger made for 1.6 and later, such as Crash Logger SSE, and remove NetScriptFramework unless a mod needs it.",
      basis: "rule",
      source: NET_SCRIPT_FRAMEWORK,
    });
  }
  return out;
}
