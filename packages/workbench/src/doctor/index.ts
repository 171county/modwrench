import { isAbsolute, relative, resolve, sep } from "node:path";
import { KNOWN_GAMES, findGameById, type GameDef } from "../detect/games.js";
import { detectOs, detectSteamDeck } from "../detect/os.js";
import { readFileVersion } from "../patchday/pe.js";
import { runDeckChecks } from "./deck.js";
import { Budget, isDir, isFile, resolveCI } from "./fsutil.js";
import { createGuard } from "./guard.js";
import { judgeCrashLoggers } from "./loggers.js";
import { judgeLocation, judgeMyGames, judgeRoom, type Place, type Room } from "./location.js";
import { discoverMo2, type Mo2Facts } from "./mo2facts.js";
import { judgeOverwrite, scanOverwrite } from "./overwrite.js";
import { checkPlugins } from "./setup-plugins.js";
import { discoverSteam, type SteamFacts } from "./steam.js";
import {
  SEVERITY,
  platformName,
  type DoctorArea,
  type DoctorError,
  type DoctorFinding,
  type DoctorOptions,
  type DoctorPlatform,
  type DoctorReport,
  type DoctorResult,
  type NotChecked,
} from "./types.js";

export type { DoctorFinding, DoctorOptions, DoctorReport, DoctorResult, DoctorError, NotChecked } from "./types.js";

// ─── The Doctors ─────────────────────────────────────────────────────────────
// "Why do my mods keep breaking?" is very often not the mods. This runs the boring
// checks behind many support threads, all from files, and says what each one rests on.
// Local and read-only: no network, no process started, nothing written or kept.
// What it can't see is listed in the report rather than skipped over.

/** The games the Doctors know about. Plugin checks exist for Skyrim Special Edition so far. */
export const DOCTOR_GAMES: string[] = KNOWN_GAMES.map((g) => g.gameId);

const SKYRIM_SE = "skyrimspecialedition";
/** Skyrim SE's game folder is the one that holds this, as Patch Day and MO2 (GameSkyrimSE's binaryName) both know it. */
const SKYRIM_SE_EXE = "SkyrimSE.exe";

/** Is `child` the same folder as `parent`, or somewhere below it? */
function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function fail(error: string, hint?: string): DoctorError {
  return { ok: false, error, ...(hint ? { hint } : {}), supportedGames: DOCTOR_GAMES };
}

/** What ModWrench can't see from here, for this game on this system. */
function notChecked(platform: DoctorPlatform, def: GameDef, ranSetup: boolean, ranDeck: boolean, mo2: Mo2Facts): NotChecked[] {
  const out: NotChecked[] = [];
  if (platform === "windows" && ranSetup) {
    out.push(
      {
        what: "Smart App Control, Defender or other antivirus blocking or quarantining script-extender DLLs and tools",
        why: "That state lives in Windows settings and security software, which ModWrench doesn't read. If a DLL keeps disappearing or a tool won't start, check the security history.",
      },
      {
        what: "How big the pagefile is",
        why: "Windows keeps it in the registry. Wabbajack's FAQ says never to switch it off and to allow a maximum of at least 20 GB.",
      },
      { what: "Whether nxm:// links open your mod manager", why: "Windows keeps that in the registry." }
    );
    if (def.family === "bethesda") {
      out.push({
        what: "Vortex's staging folder, and whether it is on the same drive as the game",
        why: "Vortex keeps that in a database ModWrench can't read yet.",
      });
    }
  }
  if (mo2.used) {
    out.push({
      what: "What Mod Organizer 2's virtual file system shows the game while it runs",
      why: "That view exists only inside a running MO2. This reads MO2's profile and mod folders on disk instead.",
    });
  }
  if (ranDeck) {
    out.push(
      {
        what: "Settings a mod manager applies only when it launches the game",
        why: "Only Steam's launch options and the prefix's registry file are read. An override a manager puts in its own environment can't be seen from files.",
      },
      { what: "r2modman's own Proton setting (Native, Proton or Auto)", why: "It lives in r2modman's settings, which ModWrench doesn't read." },
      { what: "Games installed outside Steam (GOG, Epic, Heroic, Lutris)", why: "Only Steam libraries are searched. Pass gamePath to point at one." },
      { what: "Whether Flatpak apps have the folder permissions they need", why: "Permission overrides live in Flatpak's own configuration." }
    );
  }
  if (def.family === "bethesda" && def.gameId !== SKYRIM_SE) {
    out.push({
      what: `Plugin limits, masters and crash loggers for ${def.displayName}`,
      why: "The plugin checks are built for Skyrim Special Edition so far.",
    });
  }
  if (def.loaderChecks.some((c) => c.loader === "melonloader")) {
    out.push({ what: "MelonLoader's loader override under Proton", why: "Only BepInEx's override is checked so far." });
  }
  out.push({ what: "Whether the game starts", why: "Nothing here runs the game." });
  return out;
}

export function runDoctor(options: DoctorOptions = {}): DoctorResult {
  const gameId = options.gameId ?? SKYRIM_SE;
  const def = findGameById(gameId);
  if (!def) {
    return fail(`The Doctors don't know "${gameId}".`, `They know: ${DOCTOR_GAMES.join(", ")}.`);
  }
  const platform = options.platform ?? detectOs();
  const want = options.area ?? "all";
  const ranSetup = want === "all" || want === "setup";
  const ranDeck = want === "deck" || (want === "all" && platform === "linux");
  const budget = new Budget(options.budgetMs ?? 8000);
  const steamDeck = platform === "linux" && options.platform === undefined ? detectSteamDeck() : false;

  // No single check may take the whole report down: a file that can't be read, or something
  // unexpected inside one check, leaves that check out and says so in the report.
  const { step, stopped } = createGuard();

  const findings: DoctorFinding[] = [];

  // Where the game is.
  const noSteam: SteamFacts = { installs: [], chosen: null, app: null };
  const steam = step("Finding Steam", () => discoverSteam(platform, def.steamAppId)) ?? noSteam;
  const gameArea: DoctorArea = ranSetup ? "setup" : "deck";
  let gameDir: string | null = null;
  if (options.gamePath !== undefined && options.gamePath.trim() !== "") {
    const given = resolve(options.gamePath);
    // The plugin checks read Data and plugins.txt from this folder, so a folder that isn't the game's own (its Data
    // folder, the library above it) would read as a game with nothing installed. Skyrim SE's folder is known by its
    // executable. The other games don't have theirs on record yet, so for them any folder is taken as given.
    const exe = def.gameId === SKYRIM_SE ? resolveCI(given, SKYRIM_SE_EXE) : null;
    if (!isDir(given)) {
      findings.push({
        id: "setup.game",
        area: gameArea,
        status: "problem",
        title: "That game folder isn't there",
        detail: "gamePath doesn't point at a folder that exists.",
        fix: "Give the folder that holds the game's executable.",
        basis: "install",
      });
    } else if (def.gameId === SKYRIM_SE && (exe === null || !isFile(exe))) {
      findings.push({
        id: "setup.game",
        area: gameArea,
        status: "problem",
        title: "That folder isn't the game's folder",
        detail: `gamePath points at a folder with no ${SKYRIM_SE_EXE} in it, so it isn't the game's own folder, and nothing in it was checked as the game.`,
        fix: `Give the folder that holds ${SKYRIM_SE_EXE}: the game's own folder, not its Data folder or the library folder above it.`,
        basis: "install",
      });
    } else {
      gameDir = given;
    }
  } else if (steam.app !== null) {
    gameDir = steam.app.installDir;
  } else {
    findings.push({
      id: "setup.game",
      area: gameArea,
      status: "problem",
      title: `Couldn't find ${def.displayName}`,
      detail: steam.installs.length === 0 ? "No Steam install was found, and no gamePath was given." : `It isn't in any library of the Steam install${steam.installs.length === 1 ? "" : "s"} ModWrench found.`,
      fix:
        "If it's a GOG or Epic copy, or sits somewhere unusual, pass gamePath (the folder that holds the game)." +
        (steam.installs.length === 0
          ? " ModWrench looks for Steam only in its default folders: if Steam is installed somewhere else, such as another drive, set STEAM_ROOT in the MCP server's environment to Steam's folder."
          : ""),
      basis: "install",
    });
  }

  // Mod Organizer 2, for the games it manages.
  const libraries = steam.chosen?.libraries ?? [];
  let mo2: Mo2Facts = { used: false, reason: ranSetup ? "Mod Organizer 2 isn't used for this game" : "Setup checks weren't asked for" };
  if (ranSetup && def.family === "bethesda") {
    const wanted = {
      ...(options.mo2InstancePath !== undefined ? { mo2InstancePath: options.mo2InstancePath } : {}),
      ...(options.profileName !== undefined ? { profileName: options.profileName } : {}),
    };
    const read = step("Reading Mod Organizer 2", () => discoverMo2(def, libraries, wanted, platform));
    mo2 = read ?? { used: false, reason: "Mod Organizer 2's files couldn't be read" };
    // MO2 named in the arguments, or found and then unreadable, is a part of the install that wasn't read: the plugin
    // checks would otherwise judge the game's own list as if it were the one MO2 plays. (A step that stopped is listed already.)
    const asked = options.mo2InstancePath !== undefined || options.profileName !== undefined;
    if (read !== undefined && !read.used && (asked || read.missed === true)) {
      const pluginChecks = def.gameId === SKYRIM_SE && gameDir !== null;
      findings.push({
        id: "setup.mo2",
        area: "setup",
        status: "warn",
        title: "Mod Organizer 2 couldn't be read",
        detail:
          `Mod Organizer 2 ${asked ? "was asked for, but it " : ""}wasn't read: ${read.reason}. ` +
          `What MO2 loads wasn't checked${pluginChecks ? ", and the plugin checks read the game's own plugins.txt instead" : ""}.`,
        fix: "Check that mo2InstancePath is the folder that holds ModOrganizer.ini, that profileName is one of the folders in its profiles folder, and that MO2 isn't holding the profile's files open; then run this again.",
        basis: "install",
      });
    }
  }

  let looked: DoctorReport["looked"]["plugins"];
  /** What wasn't read or wasn't read all the way, in words. Anything here keeps the verdict off "clear". */
  const skipped: string[] = [];
  let pluginsChecked = false;

  if (ranSetup) {
    // Where it lives and how much room is left.
    step("Where the game and Mod Organizer 2 live", () => {
      const places: Place[] = [];
      if (gameDir !== null) places.push({ what: "game", path: gameDir });
      if (mo2.instance !== undefined) places.push({ what: "mo2", path: mo2.instance });
      // The mods folder is its own place only when it isn't inside the instance: people with a big list keep it elsewhere.
      if (mo2.modsDir && (mo2.instance === undefined || !isInside(mo2.modsDir, mo2.instance))) places.push({ what: "mo2-mods", path: mo2.modsDir });
      const location = judgeLocation(places, platform);
      if (location !== null) findings.push(location);
    });

    step("Room left on the drives", () => {
      const rooms: Room[] = [];
      if (gameDir !== null) rooms.push({ label: "the game's drive", path: gameDir });
      if (mo2.modsDir) rooms.push({ label: "MO2's mods drive", path: mo2.modsDir });
      const room = judgeRoom(rooms);
      if (room !== null) findings.push(room);
    });

    if (def.gameId === SKYRIM_SE && gameDir !== null) {
      const dir = gameDir;
      const check = step("The plugin list", () => checkPlugins({ gameDir: dir, platform, mo2, libraries, appId: def.steamAppId, budget }));
      if (check !== undefined) {
        findings.push(...check.findings);
        looked = check.plugins;
        skipped.push(...check.skipped);
        pluginsChecked = true;
      }

      const overwrite = mo2.used ? mo2.overwriteDir : null;
      if (overwrite) {
        step("Mod Organizer 2's Overwrite folder", () => {
          const scan = scanOverwrite(overwrite);
          findings.push(judgeOverwrite(scan));
          if (scan.unread > 0) skipped.push("part of MO2's Overwrite folder couldn't be opened");
          if (scan.truncated) skipped.push("MO2's Overwrite folder has too many entries to count them all");
        });
      }

      if (check !== undefined) {
        step("Crash loggers", () => {
          const exe = resolveCI(dir, SKYRIM_SE_EXE);
          findings.push(...judgeCrashLoggers(check.index, exe !== null ? readFileVersion(exe) : null));
        });
      }

      step("The My Games folder", () => {
        const myGames = judgeMyGames(platform, ["Skyrim Special Edition", "Skyrim Special Edition GOG", "Skyrim Special Edition EPIC"]);
        if (myGames !== null) findings.push(myGames);
      });
    }
  }

  if (ranDeck) {
    if (platform !== "linux") {
      findings.push({
        id: "deck.platform",
        area: "deck",
        status: "note",
        title: "The Deck checks are for Linux",
        detail: `This computer runs ${platformName(platform, false)}. The Deck Doctor looks at Proton, Flatpak and Linux drives, none of which apply here.`,
        basis: "install",
      });
    } else {
      const deck = step("The Deck checks", () =>
        runDeckChecks({ def, steam, gameDir, ...(options.mountsText !== undefined ? { mountsText: options.mountsText } : {}) })
      );
      if (deck !== undefined) {
        findings.push(...deck.findings);
        skipped.push(...deck.skipped);
      }
    }
  }

  // The report.
  const ordered = findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY[a.f.status] - SEVERITY[b.f.status] || a.i - b.i)
    .map((x) => x.f);
  const counts = {
    problem: ordered.filter((f) => f.status === "problem").length,
    warn: ordered.filter((f) => f.status === "warn").length,
    note: ordered.filter((f) => f.status === "note").length,
    ok: ordered.filter((f) => f.status === "ok").length,
  };
  // A run that stopped short must not read as a clean bill of health: some folders or plugins
  // weren't read, or a check stopped on an error, so what is missing from the report may matter.
  const complete = skipped.length === 0;
  const cutShort = !complete || stopped.length > 0;
  const verdict = counts.problem > 0 ? "problems" : counts.warn > 0 || cutShort ? "attention" : "clear";
  const s = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const unfinished = "Some checks didn't finish, so this isn't the whole picture.";
  const headline =
    verdict === "problems"
      ? `${s(counts.problem, "problem", "problems")}${counts.warn > 0 ? ` and ${s(counts.warn, "warning", "warnings")}` : ""} found. Start with the first.${cutShort ? " Some checks didn't finish, so there may be more." : ""}`
      : verdict === "attention"
        ? counts.warn > 0
          ? `${s(counts.warn, "warning", "warnings")} worth a look.${cutShort ? ` ${unfinished}` : " Nothing is clearly broken."}`
          : `${unfinished} Nothing wrong turned up in the rest.`
        : "Nothing wrong found in what ModWrench can see. That isn't a promise the game runs.";

  const nextSteps: string[] = [];
  for (const f of ordered) {
    if ((f.status === "problem" || f.status === "warn") && f.fix !== undefined && !nextSteps.includes(f.fix)) nextSteps.push(f.fix);
    if (nextSteps.length >= 5) break;
  }

  const limits = [
    "Everything here is read from files. Nothing runs the game, so a clear report isn't a promise that it starts.",
    'Each finding says what it rests on: "your files" were read directly, a "documented rule" applies a rule from another tool\'s own documentation (the source is named), and "ModWrench\'s guess" is a rule of thumb.',
  ];
  if (mo2.used) limits.push("Mod Organizer 2's virtual file system exists only while MO2 runs, so the plugin checks read MO2's profile and mod folders on disk instead.");
  if (pluginsChecked && !mo2.used) {
    limits.push(
      `The plugin checks looked at the game's own plugins.txt and Data folder, not a Mod Organizer 2 profile: ${mo2.reason}.` +
        (options.mo2InstancePath === undefined ? " If you play through Mod Organizer 2, pass mo2InstancePath (the folder that holds ModOrganizer.ini)." : "")
    );
  }
  if (def.gameId === SKYRIM_SE && ranSetup) {
    limits.push("Plugins are read by their header only, never loaded. Crash loggers are recognised by their usual file names, so one that ships under another name isn't seen.");
  }
  if (!complete) limits.push(`Some folders or plugins were skipped (${skipped.join("; ")}), so the checks that needed them don't cover everything.`);
  if (stopped.length > 0) limits.push("A check stopped on an error while reading your files. It is listed under what ModWrench couldn't check, and this report is missing it.");

  const areas: DoctorArea[] = [...(ranSetup ? (["setup"] as const) : []), ...(ranDeck ? (["deck"] as const) : [])];
  const enabledFolders = (mo2.folders ?? []).filter((f) => f.enabled).length;

  return {
    ok: true,
    game: { id: def.gameId, name: def.displayName },
    platform,
    steamDeck,
    areas,
    verdict,
    headline,
    counts,
    findings: ordered,
    notChecked: [...stopped, ...notChecked(platform, def, ranSetup, ranDeck, mo2)],
    nextSteps,
    limits,
    looked: {
      gameFolder: gameDir !== null,
      steam: steam.chosen?.kind ?? "none",
      mo2: {
        used: mo2.used,
        reason: mo2.reason,
        ...(mo2.profile !== undefined ? { profile: mo2.profile } : {}),
        ...(mo2.used ? { modFolders: enabledFolders } : {}),
      },
      ...(looked !== undefined ? { plugins: looked } : {}),
    },
  };
}
