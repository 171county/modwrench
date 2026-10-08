import { CRASH_LOGGERS } from "../crashlog/loggers.js";
import type { FileVersion } from "../patchday/pe.js";
import type { Index } from "./setup-plugins.js";
import type { DoctorFinding } from "./types.js";

// ─── Crash loggers ───────────────────────────────────────────────────────────
// A crash logger writes the log Crash Whisperer reads. Two of them fight over the
// same crash handler, and one of them is too old for the game's current builds, so
// "which loggers are installed" is worth a line. They are told apart by file name
// (crashlog/loggers.ts has the list and where each name comes from):
//   Crash Logger SSE        SKSE/Plugins/CrashLogger.dll
//   Trainwreck              SKSE/Plugins/trainwreck.dll
//   .NET Script Framework   DLLPlugins/NetScriptFramework.Runtime.dll
// A logger that ships under another name isn't recognised, and the finding says so.
// Where Crash Whisperer reads a logger's logs, the finding says so too.

const CRASH_LOGGER_SSE = "https://www.nexusmods.com/skyrimspecialedition/mods/59818";
const NET_SCRIPT_FRAMEWORK = "https://www.nexusmods.com/skyrimspecialedition/mods/21294";
const BUFFOUT4_NG = "https://www.nexusmods.com/fallout4/mods/64880";
const ADDICTOL = "https://www.nexusmods.com/fallout4/mods/84214";

export function installedLoggers(index: Index, game = "skyrimspecialedition"): string[] {
  const out: string[] = [];
  for (const logger of CRASH_LOGGERS) {
    if (logger.game !== game || out.includes(logger.name)) continue;
    const there = logger.folder === "plugins" ? index.skseDlls.has(logger.dll.toLowerCase()) : index.netScript;
    if (there) out.push(logger.name);
  }
  return out;
}

/** Does Crash Whisperer read this logger's logs? */
function readable(name: string): boolean {
  return CRASH_LOGGERS.some((l) => l.name === name && l.readable);
}

export function judgeCrashLoggers(index: Index, game: FileVersion | null, gameId = "skyrimspecialedition"): DoctorFinding[] {
  if (gameId === "fallout4") return judgeFallout4Loggers(index, game);
  const loggers = installedLoggers(index);
  const out: DoctorFinding[] = [];

  if (loggers.length === 0) {
    out.push({
      id: "setup.crash-logger",
      area: "setup",
      status: "note",
      title: "No crash logger found",
      detail:
        "None of Crash Logger SSE, Trainwreck or .NET Script Framework was found among the game's plugins, so after a crash there may be no log for Crash Whisperer (/mw-crash) to read. " +
        "Loggers are recognised by their usual file names; one that ships under another name isn't.",
      fix: "Crash Logger SSE is a widely used one, and one Crash Whisperer reads. It writes a crash log next to the SKSE log in your Documents\\My Games folder.",
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
    const only = loggers[0]!;
    // .NET Script Framework can't log on 1.6 and later (the warning below), so it isn't sent anywhere then.
    const tooOld = only === ".NET Script Framework" && netScriptTooOld(game);
    out.push({
      id: "setup.crash-logger",
      area: "setup",
      status: "ok",
      title: `One crash logger: ${only}`,
      detail: `Only one crash logger was found.${readable(only) && !tooOld ? " After a crash, Crash Whisperer (/mw-crash) reads its log." : ""}`,
      basis: "install",
    });
  }

  if (index.netScript && netScriptTooOld(game)) {
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

/** NetScriptFramework's page says it doesn't work with the Anniversary Edition, which is 1.6 and later. */
function netScriptTooOld(game: FileVersion | null): game is FileVersion {
  return game !== null && game[0] === 1 && game[1] >= 6;
}

// ─── Fallout 4 ───────────────────────────────────────────────────────────────
// Buffout 4 and Buffout 4 NG install Buffout4.dll; Buffout 4 AE (MiniBuff) installs Buffout4AE.dll or MiniBuffAE.dll;
// Addictol's crash logger is AddictolCrashLogger.dll, separate from Addictol itself (Addictol.dll), all in F4SE\Plugins.
// Two facts from the mods' own pages are worth a line: Buffout 4 NG's page says it doesn't support the Anniversary
// Edition (game 1.11 and later), and Addictol's page lists the Buffout 4 builds among the mods that shouldn't be
// enabled alongside it (its own code stops with an error when it finds one, unless that check is switched off).

const BUFFOUTS = ["buffout4.dll", "buffout4ae.dll", "minibuffae.dll"];

function judgeFallout4Loggers(index: Index, game: FileVersion | null): DoctorFinding[] {
  const loggers = installedLoggers(index, "fallout4");
  const out: DoctorFinding[] = [];
  const anniversary = game !== null && game[0] === 1 && game[1] >= 11;
  const buffoutOnAnniversary = anniversary && index.skseDlls.has("buffout4.dll");

  const withAddictol = BUFFOUTS.filter((dll) => index.skseDlls.has(dll));
  if (index.skseDlls.has("addictol.dll") && withAddictol.length > 0) {
    out.push({
      id: "setup.crash-logger-addictol",
      area: "setup",
      status: "problem",
      title: "Addictol and Buffout 4 are both installed",
      detail:
        "Addictol's page lists Buffout 4, Buffout 4 NG and Buffout 4 AE among the mods that shouldn't be enabled alongside it, " +
        "and Addictol's own code stops with an error when it finds one of them, unless that check is switched off in its settings.",
      fix: "Remove one of them, so only Buffout 4 or only Addictol is installed.",
      basis: "rule",
      source: ADDICTOL,
      items: ["Addictol.dll", ...withAddictol.map((dll) => (dll === "buffout4.dll" ? "Buffout4.dll" : dll === "buffout4ae.dll" ? "Buffout4AE.dll" : "MiniBuffAE.dll"))],
    });
  }

  if (loggers.length === 0) {
    out.push({
      id: "setup.crash-logger",
      area: "setup",
      status: "note",
      title: "No crash logger found",
      detail:
        "None of Buffout 4, Buffout 4 AE (MiniBuff) or Addictol's crash logger was found among F4SE's plugins, so after a crash there may be no log for Crash Whisperer (/mw-crash) to read. " +
        "Loggers are recognised by their usual file names; one that ships under another name isn't.",
      fix: "Buffout 4 NG writes crash logs on 1.10.163 and 1.10.984, and Crash Whisperer reads them; for the Anniversary Edition (1.11 and later), its page points to Addictol.",
      basis: "install",
      source: BUFFOUT4_NG,
    });
  } else if (loggers.length >= 2) {
    out.push({
      id: "setup.crash-logger",
      area: "setup",
      status: "warn",
      title: "More than one crash logger",
      detail:
        `Found ${loggers.join(" and ")}. Crash loggers hook the same crash handler, so two active at once can each miss the crash. ` +
        "No page says exactly this for this pair, so treat it as a likely problem rather than a certain one.",
      fix: "Keep one and remove or disable the others.",
      basis: "guess",
      items: loggers,
    });
  } else {
    const only = loggers[0]!;
    out.push({
      id: "setup.crash-logger",
      area: "setup",
      status: "ok",
      title: `One crash logger: ${only}`,
      detail: `Only one crash logger was found.${readable(only) && !buffoutOnAnniversary ? " After a crash, Crash Whisperer (/mw-crash) reads its log." : ""}`,
      basis: "install",
    });
  }

  if (buffoutOnAnniversary) {
    out.push({
      id: "setup.crash-logger-old",
      area: "setup",
      status: "warn",
      title: "Buffout 4 doesn't support this game version",
      detail: `The game is ${game![0]}.${game![1]}.${game![2]}. Buffout 4 NG's page says it doesn't support the Anniversary Edition, which is 1.11 and later, so Buffout 4 can't be counted on to log crashes on this version.`,
      fix: "Buffout 4 NG's page points to Addictol for the latest version of Fallout 4.",
      basis: "rule",
      source: BUFFOUT4_NG,
    });
  }
  return out;
}
