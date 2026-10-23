import { appIdentity, createHttpClient, getEnv, log, ModWrenchError } from "@modwrench/core";
import { findGameById } from "../detect/games.js";
import { readR2modmanLoadOrder } from "../loadorder/r2modman.js";
import { clean } from "../patchday/summary.js";

// ─── Pulse: what has changed for the mods I run? ─────────────────────────────
// Reads the mods switched on in an r2modman profile and asks Thunderstore for each
// one's latest version. Nothing is sent until the call says confirm: without it the
// answer is the plan, so the person can say yes to the exact number of requests and
// the host first. Each request carries one mod's Thunderstore name and nothing of the
// player's (no profile, folder or installed version). TRUST.md, "Pulse", says the same.

const APP = appIdentity(import.meta.url);

/** The most mods one run asks about. The rest are named as not checked. */
export const PULSE_MAX_MODS = 200;
/** How many requests are in flight at once. */
const CONCURRENCY = 4;
/** Thunderstore's owner and package names are letters, digits and underscores, joined by one dash. */
const THUNDERSTORE_NAME = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export type PulseInput = { gameId: string; profileName?: string; confirm?: boolean };

export type PulseModState =
  /** Thunderstore has a newer version. */
  | "update"
  /** The installed version is the latest. */
  | "current"
  /** The installed version is newer than Thunderstore's latest. */
  | "ahead"
  /** A version isn't three numbers, so they can't be compared. */
  | "cant-compare"
  /** Thunderstore answered that it has no such package. */
  | "gone"
  /** The request failed for another reason. */
  | "failed";

export type PulseMod = {
  /** The name r2modman shows. */
  name: string;
  /** Thunderstore's "Owner-Name". */
  fullName: string;
  author?: string;
  installed?: string;
  latest?: string;
  state: PulseModState;
  /** The author marked the package deprecated. */
  deprecated: boolean;
  pageUrl?: string;
};

export type PulseResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      confirmed: false;
      game: string;
      profile: string;
      host: string;
      /** How many requests a confirmed run would make: one per mod. */
      requests: number;
      notChecked: string[];
    }
  | {
      ok: true;
      confirmed: true;
      game: string;
      profile: string;
      host: string;
      mods: PulseMod[];
      notChecked: string[];
    };

/** A profile name is one folder name: no separators, and not "." or "..". */
function plainFolderName(value: string): boolean {
  return value !== "" && value !== "." && value !== ".." && !/[\\/]/.test(value);
}

/** -1, 0 or 1 for two three-number versions; null when either isn't one. */
export function compareVersions(a: string, b: string): number | null {
  const x = SEMVER.exec(a);
  const y = SEMVER.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

type Candidate = { name: string; fullName: string; owner: string; pkg: string; author?: string; installed?: string };

export async function runPulse(input: PulseInput): Promise<PulseResult> {
  const game = findGameById(input.gameId);
  if (!game) return { ok: false, reason: `"${input.gameId}" isn't a game ModWrench knows. mw_detect_environment lists the games on this computer.` };
  if (!game.r2modmanFolder) {
    return {
      ok: false,
      reason: `Pulse checks Thunderstore mods in r2modman profiles so far, and ${game.displayName} isn't an r2modman game. Mods from Nexus Mods and mod.io aren't checked yet.`,
    };
  }
  if (input.profileName !== undefined && !plainFolderName(input.profileName)) {
    return { ok: false, reason: "profileName must be the name of one r2modman profile, with no slashes, and not . or .." };
  }

  const order = readR2modmanLoadOrder(game, input.profileName !== undefined ? { profileName: input.profileName } : {});
  if (!order) {
    return {
      ok: false,
      reason:
        input.profileName !== undefined
          ? `No r2modman profile by that name was found for ${game.displayName}.`
          : `No r2modman profile was found for ${game.displayName} on this computer.`,
    };
  }

  const notChecked: string[] = [];
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const mod of order.mods) {
    if (mod.enabled !== true) continue;
    const id = mod.sourceModId ?? "";
    const match = THUNDERSTORE_NAME.exec(id);
    if (!match) {
      notChecked.push(`${clean(mod.name)} (not a Thunderstore name)`);
      continue;
    }
    if (seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    candidates.push({
      name: mod.name,
      fullName: id,
      owner: match[1]!,
      pkg: match[2]!,
      ...(mod.author !== undefined ? { author: mod.author } : {}),
      ...(mod.version !== undefined ? { installed: mod.version } : {}),
    });
  }
  const checked = candidates.slice(0, PULSE_MAX_MODS);
  for (const extra of candidates.slice(PULSE_MAX_MODS)) notChecked.push(`${clean(extra.name)} (past the ${PULSE_MAX_MODS}-mod limit for one run)`);

  const baseUrl = getEnv("THUNDERSTORE_BASE_URL", "https://thunderstore.io");
  const host = new URL(baseUrl).host;
  const base = { ok: true as const, game: game.displayName, profile: order.profile, host, notChecked };

  if (input.confirm !== true) return { ...base, confirmed: false, requests: checked.length };

  const http = createHttpClient({
    baseUrl,
    userAgent: APP.userAgent,
    defaultHeaders: APP.headers,
    errorCodePrefix: "thunderstore",
    concurrencyLimit: CONCURRENCY,
  });

  const mods = await Promise.all(
    checked.map(async (c): Promise<PulseMod> => {
      const known = {
        name: c.name,
        fullName: c.fullName,
        ...(c.author !== undefined ? { author: c.author } : {}),
        ...(c.installed !== undefined ? { installed: c.installed } : {}),
      };
      try {
        const pkg = await http.request<{
          latest?: { version_number?: unknown };
          is_deprecated?: unknown;
          package_url?: unknown;
          owner?: unknown;
        }>(`/api/experimental/package/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.pkg)}/`);
        const latest = typeof pkg.latest?.version_number === "string" ? pkg.latest.version_number : undefined;
        const cmp = latest !== undefined && c.installed !== undefined ? compareVersions(c.installed, latest) : null;
        const state: PulseModState =
          latest !== undefined && c.installed === latest ? "current" : cmp === null ? "cant-compare" : cmp < 0 ? "update" : cmp > 0 ? "ahead" : "current";
        return {
          ...known,
          ...(c.author === undefined && typeof pkg.owner === "string" ? { author: pkg.owner } : {}),
          ...(latest !== undefined ? { latest } : {}),
          state,
          deprecated: pkg.is_deprecated === true,
          ...(typeof pkg.package_url === "string" ? { pageUrl: pkg.package_url } : {}),
        };
      } catch (err) {
        const gone = err instanceof ModWrenchError && err.status === 404;
        return { ...known, state: gone ? "gone" : "failed", deprecated: false };
      }
    })
  );

  log("debug", "workbench.pulse", { checked: mods.length, failed: mods.filter((m) => m.state === "failed").length });
  return { ...base, confirmed: true, mods };
}

// ─── The text answer ─────────────────────────────────────────────────────────

/** How many mods each list in the answer names before it says how many more. */
const LIST_CAP = 25;

function capped(lines: string[]): string[] {
  return lines.length <= LIST_CAP ? lines : [...lines.slice(0, LIST_CAP), `…and ${lines.length - LIST_CAP} more`];
}

// Names, authors and versions come from the profile's mods.yml and from Thunderstore, so each is flattened to
// one line and cut short before it goes into the answer: a mod can't name itself "NEXT: ..." and pass as part of it.
function who(m: PulseMod): string {
  return `${clean(m.name)}${m.author ? ` by ${clean(m.author)}` : ""}`;
}

const ver = (v: string | undefined): string => (v === undefined ? "an unknown version" : clean(v, 40));

/** A page link only when it is a plain https address. */
function page(m: PulseMod): string {
  return m.pageUrl && /^https:\/\/[^\s<>"]+$/.test(m.pageUrl) ? ` — ${clean(m.pageUrl, 200)}` : "";
}

export function summarizePulse(result: PulseResult): string {
  if (!result.ok) return result.reason;
  const out: string[] = [];
  const skipped = result.notChecked.length > 0 ? ["", `Not checked (${result.notChecked.length}):`, ...capped(result.notChecked.map((n) => `- ${n}`))] : [];

  if (!result.confirmed) {
    out.push(
      `Pulse for ${result.game}, r2modman profile "${clean(result.profile)}": nothing has been sent yet.`,
      "",
      result.requests === 0
        ? "There are no switched-on Thunderstore mods in this profile to check, so a check would send nothing."
        : `Checking would send ${result.requests} request${result.requests === 1 ? "" : "s"} to ${result.host}, one per switched-on mod, ` +
            "each carrying only that mod's Thunderstore name. Ask the user whether to go ahead, and call mw_pulse again with " +
            "confirm=true only after they say yes."
    );
    return [...out, ...skipped].join("\n");
  }

  const mods = result.mods;
  const updates = mods.filter((m) => m.state === "update");
  const deprecated = mods.filter((m) => m.deprecated);
  const gone = mods.filter((m) => m.state === "gone");
  const failed = mods.filter((m) => m.state === "failed");
  const unclear = mods.filter((m) => m.state === "cant-compare" || m.state === "ahead");

  const parts = [
    `${updates.length} of ${mods.length} ${mods.length === 1 ? "mod has" : "mods have"} an update`,
    ...(deprecated.length > 0 ? [`${deprecated.length} ${deprecated.length === 1 ? "is" : "are"} marked deprecated by ${deprecated.length === 1 ? "its author" : "their authors"}`] : []),
    ...(gone.length > 0 ? [`${gone.length} ${gone.length === 1 ? "is" : "are"} no longer on Thunderstore`] : []),
  ];
  out.push(`Pulse for ${result.game}, r2modman profile "${clean(result.profile)}", checked against ${result.host}: ${parts.join(", ")}.`);

  if (updates.length > 0) out.push("", "Updates:", ...capped(updates.map((m) => `- ${who(m)}: ${ver(m.installed)} → ${ver(m.latest)}${page(m)}`)));
  if (deprecated.length > 0) out.push("", "Marked deprecated by the author:", ...capped(deprecated.map((m) => `- ${who(m)}${page(m)}`)));
  if (gone.length > 0) out.push("", "Thunderstore no longer has these:", ...capped(gone.map((m) => `- ${who(m)} (${clean(m.fullName)})`)));
  if (unclear.length > 0) {
    out.push(
      "",
      "Versions that couldn't be compared:",
      ...capped(
        unclear.map((m) =>
          m.state === "ahead"
            ? `- ${who(m)}: you have ${ver(m.installed)}, newer than Thunderstore's latest ${ver(m.latest)}`
            : `- ${who(m)}: you have ${ver(m.installed)}, Thunderstore's latest is ${ver(m.latest)}`
        )
      )
    );
  }
  if (failed.length > 0) out.push("", `${failed.length} couldn't be checked this time (Thunderstore didn't answer):`, ...capped(failed.map((m) => `- ${who(m)}`)));
  out.push("", "Pulse reads and asks only: it doesn't download, install or change anything, and it can't tell whether an update suits your game version or your other mods.");
  return [...out, ...skipped].join("\n");
}
