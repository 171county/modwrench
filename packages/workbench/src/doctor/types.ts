// ─── What the Doctors say ────────────────────────────────────────────────────
// One report, two kinds of check. Setup checks look at the install itself: the
// plugin list, the masters each plugin needs, Mod Organizer 2's Overwrite folder,
// where things live and how much room is left. Deck checks look at the Linux and
// Steam Deck side: which Steam, the Proton prefix, the BepInEx launch override,
// the nxm:// handler, the drive the library sits on and folder-name case clashes.
//
// Every finding says what it rests on, the same way Patch Day and Crash Whisperer
// do, so nobody has to take a verdict on trust:
//   install  read from your own files
//   rule     a documented rule applied to what the files show (the finding names its source)
//   guess    ModWrench's own rule of thumb
//
// Nothing in a report is a folder. Findings name files and mod folders the way the
// player named them, never where they sit on disk, because the report goes to
// whatever AI the player's editor runs.

export type DoctorStatus = "problem" | "warn" | "note" | "ok";
export type DoctorBasis = "install" | "rule" | "guess";
export type DoctorArea = "setup" | "deck";
export type DoctorPlatform = "windows" | "macos" | "linux";

export type DoctorFinding = {
  /** Stable, for tests and for pages: "setup.masters", "deck.nxm-handler". */
  id: string;
  area: DoctorArea;
  status: DoctorStatus;
  /** One short line. */
  title: string;
  /** What was seen, in a few plain sentences. */
  detail: string;
  /** The one next step, when there is one. */
  fix?: string;
  basis: DoctorBasis;
  /** The page a rule comes from. Shown as text, never fetched. */
  source?: string;
  /** The names or numbers behind the finding. File names are the player's own words. */
  items?: string[];
  /** How many more there were than `items` lists. */
  more?: number;
};

export type NotChecked = { what: string; why: string };

export type DoctorVerdict = "clear" | "attention" | "problems";

export type DoctorReport = {
  ok: true;
  game: { id: string; name: string };
  platform: DoctorPlatform;
  steamDeck: boolean;
  /** Which kinds of check ran. */
  areas: DoctorArea[];
  verdict: DoctorVerdict;
  /** One line, in plain words. */
  headline: string;
  counts: { problem: number; warn: number; note: number; ok: number };
  /** Everything that was checked, worst first. */
  findings: DoctorFinding[];
  /** What ModWrench can't see from here, and why. */
  notChecked: NotChecked[];
  nextSteps: string[];
  limits: string[];
  /** What it opened, in words. No folders. */
  looked: {
    gameFolder: boolean;
    steam: "native" | "flatpak" | "custom" | "none";
    mo2: { used: boolean; reason: string; profile?: string; modFolders?: number };
    plugins?: { listed: number; active: number; read: number; unreadable: number; complete: boolean };
    /** Vortex's deployment record, when it was looked for (Windows): whether it named a staging folder, and the method it names. */
    vortex?: { record: boolean; method?: string };
  };
};

export type DoctorError = { ok: false; error: string; hint?: string; supportedGames: string[] };
export type DoctorResult = DoctorReport | DoctorError;

export type DoctorOptions = {
  /** Canonical game id. Default "skyrimspecialedition". */
  gameId?: string;
  /** Which checks to run. Default "all": Setup always, Deck on Linux. */
  area?: "all" | "setup" | "deck";
  /** The folder that holds the game, when it isn't in a Steam library ModWrench can find. */
  gamePath?: string;
  mo2InstancePath?: string;
  profileName?: string;
  /** For tests: act as another OS. The tool never passes it. */
  platform?: DoctorPlatform;
  /** For tests: stand-in for the text of /proc/mounts. The tool never passes it. */
  mountsText?: string;
  /** For tests: how long the heavy reads may run, in milliseconds. */
  budgetMs?: number;
};

export const SEVERITY: Record<DoctorStatus, number> = { problem: 0, warn: 1, note: 2, ok: 3 };

/** The games the Setup Doctor's plugin checks (masters, plugin limits, crash loggers) cover, by game id. */
export const PLUGIN_CHECK_GAMES: ReadonlySet<string> = new Set(["skyrimspecialedition", "fallout4"]);

/** "Windows", "Linux", "Steam Deck" or "macOS", for people. */
export function platformName(platform: DoctorPlatform, steamDeck: boolean): string {
  if (platform === "linux") return steamDeck ? "Steam Deck" : "Linux";
  return platform === "windows" ? "Windows" : "macOS";
}
