import { loggersNamed } from "../crashlog/loggers.js";
import type { CrashlogParseResult } from "../crashlog/types.js";
import { PLUGIN_CHECK_GAMES } from "../doctor/types.js";
import { clean } from "../patchday/summary.js";
import type { BepInExFacts, LoadProblem } from "./bepinex-scan.js";
import { sameVersion, versionParts, type InstallContext } from "./context.js";
import { classifyModule, splitModule, type GameFacts } from "./explain.js";
import { GENERIC_SOURCE, leadKey, matchPlugin } from "./rank.js";
import { doctorsFor } from "./text.js";
import type { Check, Lead, SystemFacts } from "./types.js";

// ─── The setup checks ────────────────────────────────────────────────────────
// Separate from the ranking of names: these are things a crash log or the player's
// install says about the setup itself, each of which can be the whole answer.
// A crashing game with a refused plugin, an updated game or a full memory has a
// reason that no ranking of names would find.
//
// Every check states what it rests on:
//   "log"      the crash log says so
//   "install"  the player's files say so, or the log and the files disagree
//   "rule"     a documented rule or a tool's own warning applied to those facts
//
// Nothing here is a ranking guess. A check that can't be backed by one of those is not a
// check, with one exception: when the script extender's rule that refuses a plugin is itself
// carried forward from an older game version (Patch Day's "inferred"), the check says "guess".

export type CheckInput = {
  parsed: CrashlogParseResult;
  game: GameFacts;
  system?: SystemFacts;
  leads: readonly Lead[];
  bepinex?: BepInExFacts;
  install: InstallContext;
  /** From the log's SKSE PLUGINS section: lower-case DLL file name to the version the log printed. */
  logPlugins: ReadonlyMap<string, string>;
  /** Module base names the log lists as loaded, lower-case. */
  modules: ReadonlySet<string>;
  /** Names a crash logger warned about in its own banner. */
  warnings: readonly string[];
  /** When the log says the crash happened, "2026-10-01 21:14", in the player's local time. */
  time?: string;
  /** For tests: the clock. */
  now?: number;
};

const RANK = { problem: 0, note: 1, info: 2 } as const;

const gb = (n: number): string => `${Math.round(n * 10) / 10} GB`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The regular (full) plugin slots in use. Light plugins ("FE:…") share one slot between them. */
function regularPlugins(parsed: CrashlogParseResult): number {
  return parsed.loadedPlugins.filter((p) => !/^FE\b/i.test(p.loadIndex ?? "")).length;
}

// Skyrim Special Edition and Fallout 4 address plugins by a one-byte index. 0xFE is shared by every light
// plugin and 0xFF is for objects made while playing, so 0x00 to 0xFD is 254 regular plugins.
const REGULAR_PLUGIN_LIMIT = 254;
const NEAR_LIMIT = 240;
const STALE_AFTER_DAYS = 14;

function bepinexLoadCheck(problem: LoadProblem, index: number): Check {
  const plugin = problem.plugin;
  const base = { id: `bepinex-load-${index + 1}`, basis: "rule" as const };
  switch (problem.kind) {
    case "missing-dependency":
      return {
        ...base,
        severity: "problem",
        title: `${plugin} didn't load: something it needs is missing`,
        detail: `BepInEx reports that ${plugin} has missing dependencies: ${problem.detail}.`,
        fix: "Install the missing mod or mods, at the versions it asks for, then start the game again.",
      };
    case "incompatible-version":
      return {
        ...base,
        severity: "problem",
        title: `${plugin} didn't load: a mod it needs is the wrong version`,
        detail: `BepInEx reports these dependencies are installed with an incompatible version: ${problem.detail}.`,
        fix: `Update (or roll back) the listed mod or mods to the version ${plugin} asks for.`,
      };
    case "incompatible-with":
      return {
        ...base,
        severity: "problem",
        title: `${plugin} didn't load: it says it doesn't work with another mod`,
        detail: `BepInEx reports ${plugin} is incompatible with: ${problem.detail}.`,
        fix: "Remove one of the two. A mod that declares itself incompatible is telling you they shouldn't run together.",
      };
    case "load-error":
      return {
        ...base,
        severity: "problem",
        title: `${plugin} failed to load`,
        detail: `BepInEx logged: ${problem.detail}.`,
        fix: "Look on the mod's page for a build made for your game version, and update BepInEx if the mod asks for a newer one.",
      };
    case "wrong-bepinex":
      return {
        ...base,
        severity: "note",
        title: `${plugin} was built for a different BepInEx version`,
        detail: `BepInEx warns that ${plugin} targets another BepInEx version (${problem.detail}) and might not work until it is updated.`,
        fix: "Update the mod, or BepInEx, so that the two match.",
      };
    case "dependency-not-loaded":
      return {
        ...base,
        severity: "note",
        title: `${plugin} was skipped`,
        detail: `BepInEx skipped ${plugin} because a mod it depends on didn't load. Fix that one first and this one follows.`,
      };
  }
}

export function runChecks(input: CheckInput): Check[] {
  const checks: Check[] = [];
  const { parsed } = input;

  // A tool that interferes with crash reporting: Crash Logger's own list, and its own words.
  const guard = input.warnings.find((w) => /crashguard/i.test(w));
  if (guard || input.modules.has("skyrimcrashguard")) {
    checks.push({
      id: "skyrimcrashguard",
      severity: "problem",
      title: "SkyrimCrashGuard is loaded, and Crash Logger warns about it",
      detail:
        "Crash Logger flags this mod itself. Its warning says SkyrimCrashGuard tries to recover from crashes by doing things that aren't safe, which can corrupt game state and hide or add subtle bugs, " +
        "and that it can get in the way of Crash Logger recording crashes at all. So this log may be incomplete or misleading, and a game that carried on after a crash may have been damaged.",
      basis: "rule",
      fix: "Remove SkyrimCrashGuard, or ask its author for support, then reproduce the crash and read the new log.",
    });
  }

  // More than one crash logger loaded. Crash Logger SSE's page says only one can be active at a time, NetScriptFramework
  // included; for any other pair that is ModWrench's guess. A logger can be loaded with its crash logging switched off in
  // its own settings, which a module list can't show. The Doctors check the same thing from the install.
  const bethesda = ["crashlogger-sse", "buffout4", "netscriptframework"].includes(parsed.detectedType);
  const loggers = bethesda ? loggersNamed(input.modules) : [];
  if (loggers.length >= 2) {
    const sse = loggers.includes("Crash Logger SSE");
    const doctor = PLUGIN_CHECK_GAMES.has(input.game.id ?? "") ? ` The Doctors ${doctorsFor(input.game)} list the crash loggers in your install.` : "";
    checks.push({
      id: "crash-loggers",
      severity: "note",
      title: `More than one crash logger was loaded (${loggers.join(", ")})`,
      detail:
        (sse
          ? "The log's list of loaded modules has them all. Crash Logger SSE's page says only one crash logger can be active at a time, NetScriptFramework included."
          : "The log's list of loaded modules has them all. Crash loggers hook the same crash handler, so two active at once can each miss a crash. No page says exactly this for this pair, so it is ModWrench's guess.") +
        " One whose crash logging is switched off in its own settings doesn't count, and the log can't show that.",
      basis: sse ? "rule" : "guess",
      fix: `Keep one crash logger, and remove the others or switch off their crash logging.${doctor}`,
    });
  }

  // BepInEx's own verdicts on mods it couldn't load.
  if (input.bepinex) {
    input.bepinex.problems.slice(0, 8).forEach((p, i) => checks.push(bepinexLoadCheck(p, i)));
    const more = input.bepinex.problems.length - 8;
    if (more > 0) {
      checks.push({
        id: "bepinex-load-more",
        severity: "info",
        title: `${plural(more, "more load problem", "more load problems")} in the log`,
        detail: "Only the first eight are listed. Fix those and run this again.",
        basis: "log",
      });
    }
  }

  // The engine's plugin limit, counted from the log's own plugin list. Only the Bethesda loggers list Bethesda plugins:
  // a BepInEx log lists the mods it loaded, which have no slots to run out of.
  const regular = bethesda ? regularPlugins(parsed) : 0;
  if (regular >= REGULAR_PLUGIN_LIMIT) {
    checks.push({
      id: "plugin-limit",
      severity: "problem",
      title: `The load order uses all ${REGULAR_PLUGIN_LIMIT} regular plugin slots`,
      detail:
        `The log lists ${regular} regular plugins. The game has ${REGULAR_PLUGIN_LIMIT} regular slots (light plugins share a separate one), so a load order this full can fail to load some of its plugins, and that tends to show up as crashes or missing content.`,
      basis: "rule",
      fix: "Free slots: turn small plugins into light plugins (ESL) where their authors say that is safe, or merge plugins, then try again.",
    });
  } else if (regular >= NEAR_LIMIT) {
    checks.push({
      id: "plugin-limit",
      severity: "note",
      title: `The load order is close to the plugin limit (${regular} of ${REGULAR_PLUGIN_LIMIT})`,
      detail: `The game has ${REGULAR_PLUGIN_LIMIT} regular plugin slots, and the log lists ${regular}. It is not at the limit, but another few plugins would be.`,
      basis: "rule",
    });
  }

  // The game was patched after this crash.
  const loggedVersion = /\bv?(\d+\.\d+\.\d+)/.exec(parsed.gameVersion ?? "")?.[1];
  if (input.install.checked && input.install.gameVersion && loggedVersion) {
    const installed = versionParts(input.install.gameVersion)?.slice(0, 3).join(".");
    const logged = versionParts(loggedVersion)?.slice(0, 3).join(".");
    if (installed && logged && installed !== logged) {
      checks.push({
        id: "game-updated",
        severity: "note",
        title: `The game has been updated since this crash (${loggedVersion} then, ${input.install.gameVersion} now)`,
        detail:
          "This log was written by a different version of the game than the one installed now. Script extender plugins are built for specific game versions, so an update is a common reason things stop working.",
        basis: "install",
        fix: "Run Patch Day to see which plugins match the version you have, and play again before spending time on this log.",
      });
    }
  }

  // A plugin the log points at has been replaced since.
  for (const lead of input.leads.filter((l) => l.strength !== "faint").slice(0, 3)) {
    for (const file of lead.files.filter((f) => /\.dll$/i.test(f))) {
      const logged = input.logPlugins.get(file.toLowerCase());
      const installed = input.install.versions(file);
      if (!logged || !versionParts(logged) || installed.length === 0) continue;
      if (installed.some((v) => sameVersion(logged, v))) continue;
      checks.push({
        id: `plugin-updated-${file.toLowerCase()}`,
        severity: "note",
        title: `${file} has changed since this crash (${logged} then, ${installed[0]} now)`,
        detail: `The log recorded ${file} at ${logged}. The copy in your install reports ${installed[0]}, so it has been updated or replaced since, and the crash may not happen any more.`,
        basis: "install",
        fix: "Play again with the new version before digging further into this log.",
      });
    }
  }

  // A plugin the log points at doesn't match the installed game version.
  for (const lead of input.leads.filter((l) => l.strength !== "faint")) {
    const flagged = lead.install?.flagged;
    if (!flagged) continue;
    const file = lead.files.find((f) => /\.dll$/i.test(f)) ?? lead.name;
    checks.push({
      id: `plugin-flagged-${file.toLowerCase()}`,
      severity: flagged.status === "broken" ? "problem" : "note",
      title: `${file} doesn't line up with your game version`,
      detail: `${flagged.reason}. That comes from the plugin's file and the script extender's rules, not from the crash log, and it may or may not be what crashed.`,
      basis: flagged.basis === "inferred" ? "guess" : "rule",
      fix: "Look on its mod page for a build made for the game version you have. Until there is one, expect it not to work.",
    });
  }

  // Memory, from the log's own figures.
  const high: string[] = [];
  const { system } = input;
  if (system?.vram && system.vram.budget > 0 && system.vram.used / system.vram.budget >= 0.9) {
    high.push(`video memory ${gb(system.vram.used)} of ${gb(system.vram.budget)}`);
  }
  if (system?.ram && system.ram.total > 0 && system.ram.used / system.ram.total >= 0.95) {
    high.push(`system memory ${gb(system.ram.used)} of ${gb(system.ram.total)}`);
  }
  if (high.length > 0) {
    const ease = "use smaller textures or fewer heavy texture and mesh mods, close other programs, and check Windows' page file isn't switched off.";
    // When the game stopped inside a mod's code, that is the better place to start; memory is for a crash that moves around.
    const top = parsed.callStack[0];
    const stoppedInMod = !input.bepinex && top !== undefined && top.source !== "scan" && classifyModule(splitModule(top.module).name) === "mod";
    checks.push({
      id: "memory",
      severity: "note",
      title: "Memory was nearly full when the game crashed",
      detail: stoppedInMod
        ? `The log records ${high.join(" and ")}. A game that runs out of memory can fail almost anywhere, but this time it stopped inside a mod's code, so start with that lead.`
        : `The log records ${high.join(" and ")}. A game that runs out of memory can fail almost anywhere, so this can matter more than any name on the list.`,
      basis: "log",
      fix: stoppedInMod ? `If the crash keeps turning up in different places, rule memory out: ${ease}` : `Rule it out first: ${ease}`,
    });
  }

  // The same error over and over, with what it says. Unity's own log and BepInEx's are no mod, whatever logs through them.
  (input.bepinex?.repeats ?? [])
    .filter((repeat) => repeat.count >= 5)
    .slice(0, 2)
    .forEach((repeat, i) => {
      const generic = GENERIC_SOURCE.test(repeat.source);
      const mod = generic ? undefined : matchPlugin(leadKey(repeat.source), parsed.loadedPlugins);
      const who = generic
        ? `each time from ${repeat.source}, which is the game's or BepInEx's own log, not a mod`
        : mod
          ? `each time involving ${mod.name}, a mod that loaded`
          : `each time involving ${repeat.source}`;
      checks.push({
        id: i === 0 ? "bepinex-repeats" : `bepinex-repeats-${i + 1}`,
        severity: "note",
        title: `The same error was logged ${repeat.count} times`,
        detail:
          `BepInEx logged the same error${repeat.type ? ` (${repeat.type})` : ""} ${repeat.count} times: "${clean(repeat.message, 100)}", ${who}. ` +
          "An error repeated like that is worth a look even when the last error in the log is something else.",
        basis: "log",
        fix: generic
          ? "Read what the message says failed. It doesn't name a mod, so search for it with the game's name to find which mod or setting it comes from."
          : mod
            ? `Disable ${mod.name} and see whether the errors stop; the message may also say what to change.`
            : `Disable ${repeat.source} if it is a mod, and see whether the errors stop.`,
      });
    });

  // A BepInEx log with nothing wrong in it.
  if (input.bepinex && input.bepinex.errorCount === 0) {
    checks.push({
      id: "bepinex-clean",
      severity: "info",
      title: "This BepInEx log has no errors in it",
      detail:
        "BepInEx's log records what the mods wrote while the game was open. A game that closes with no error in it was most likely stopped by something outside the mods' managed code (the game itself, a native crash, or the system), so this file can't say why.",
      basis: "log",
      fix: "Unity keeps its own Player.log, which sometimes says more, and Windows' Event Viewer records application crashes with the time they happened.",
    });
  }

  // A log with no call stack. BepInEx's last error can be a plain message, which never has a stack trace.
  if (parsed.callStack.length === 0 && input.bepinex && input.bepinex.errorCount > 0 && parsed.lastError?.exception === false) {
    checks.push({
      id: "no-call-stack",
      severity: "info",
      title: "The last error is a message, not an exception",
      detail:
        "Code wrote it to the log as an error, but it isn't an exception, so BepInEx has no stack trace to show which code it came from. The leads come from the names the errors were logged under.",
      basis: "log",
    });
  } else if (parsed.callStack.length === 0 && (input.bepinex ? input.bepinex.errorCount > 0 : true)) {
    checks.push({
      id: "no-call-stack",
      severity: "note",
      title: input.bepinex ? "The last error has no stack trace" : "The log has no call stack",
      detail:
        "The call stack is what shows where the game stopped. Without it ModWrench can only go by the rest of the log, so every lead here is weaker than it would be with one.",
      basis: "log",
    });
  }

  // An old log.
  const stamp = input.time ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.time) : null;
  if (input.time && stamp) {
    // The log's clock has no time zone, so it is read as if it were UTC: a day of slack is nothing next to weeks.
    const when = Date.UTC(Number(stamp[1]), Number(stamp[2]) - 1, Number(stamp[3]), Number(stamp[4]), Number(stamp[5]), Number(stamp[6] ?? 0));
    const now = input.now ?? Date.now();
    if (Number.isFinite(when)) {
      const days = Math.floor((now - when) / 86_400_000);
      if (days >= STALE_AFTER_DAYS) {
        checks.push({
          id: "old-log",
          severity: "info",
          title: `This crash is from ${input.time.slice(0, 10)}, about ${plural(days, "day", "days")} ago`,
          detail:
            "If your most recent crash didn't write a log, the logger may not have been loaded that time, and this may not be the crash you are asking about.",
          basis: "log",
        });
      }
    }
  }

  // Worst first, otherwise in the order found.
  return checks
    .map((check, order) => ({ check, order }))
    .sort((a, b) => RANK[a.check.severity] - RANK[b.check.severity] || a.order - b.order)
    .map((entry) => entry.check);
}
