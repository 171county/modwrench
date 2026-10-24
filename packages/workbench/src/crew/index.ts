import { clean } from "../patchday/summary.js";
import { readThunderstoreProfile, THUNDERSTORE_NAME } from "../pulse/profile.js";

// ─── Crew Check: do we all have the same mods? ───────────────────────────────
// For co-op games, where a crewmate on another version of a mod is a common reason a
// lobby breaks. With no lists, it answers with this player's own crew list: the
// Thunderstore name and version of each switched-on mod in their r2modman profile,
// to share with the crew. With the crew's lists pasted in, it compares them with this
// player's profile. No network at all. A pasted list is someone else's text, so it is
// read line by line against a strict shape, with caps, and every name that goes into
// the answer is cleaned (TRUST.md, "Crew Check", says the same).

export const CREW_LIST_HEADER = "ModWrench crew list 1";
/** The most crewmates' lists one comparison reads. */
export const CREW_MAX_LISTS = 16;
/** The most mod lines read from one list; the rest are counted and left unread. */
export const CREW_MAX_LINES = 500;
/** How long a pasted list may be, in characters. */
export const CREW_MAX_CHARS = 64 * 1024;
/** A version as r2modman records it: up to four numbers, or "?" when it isn't known. */
const VERSION = /^(?:\d{1,9}(?:\.\d{1,9}){0,3}|\?)$/;

export type CrewList = { name?: string; list: string };
export type CrewInput = { gameId: string; profileName?: string; crewLists?: CrewList[] };

/** One crewmate's list as read: lower-cased id → [id as written, version]. */
type ParsedList = {
  label: string;
  /** The game the list's header names, when it has one. */
  game?: string;
  mods: Map<string, { id: string; version: string }>;
  /** Lines that weren't a mod, a header, a blank or a code fence. */
  unread: number;
  /** Mod lines past CREW_MAX_LINES. */
  overflow: number;
};

export type CrewResult =
  | { ok: false; reason: string }
  | { ok: true; mode: "export"; game: string; profile: string; list: string; count: number; notThunderstore: string[] }
  | {
      ok: true;
      mode: "compare";
      game: string;
      profile: string;
      players: string[];
      /** Mods some players have and others don't. */
      missing: Array<{ id: string; has: string[]; lacks: string[] }>;
      /** Mods everyone has, at more than one version. */
      versions: Array<{ id: string; byPlayer: Array<[player: string, version: string]> }>;
      same: number;
      warnings: string[];
    };

/** The list a player shares: a header naming the game and the count, then one "Owner-Name version" line per mod. */
export function crewList(game: string, mods: Array<{ fullName: string; installed?: string }>): string {
  const lines = mods.map((m) => `${m.fullName} ${m.installed !== undefined && VERSION.test(m.installed) ? m.installed : "?"}`);
  return [`${CREW_LIST_HEADER} · ${game} · ${mods.length} mod${mods.length === 1 ? "" : "s"}`, ...lines].join("\n");
}

export function parseCrewList(text: string, label: string): ParsedList {
  const parsed: ParsedList = { label, mods: new Map(), unread: 0, overflow: 0 };
  let read = 0;
  for (const raw of text.slice(0, CREW_MAX_CHARS).split(/\r?\n/)) {
    // A chat may add a bullet or quote mark in front of each line, or wrap the list in a code fence.
    const line = raw.trim().replace(/^(?:[-*>•]\s*)+/, "");
    if (line === "" || line.startsWith("```")) continue;
    if (line.startsWith(CREW_LIST_HEADER)) {
      const game = line.split("·")[1]?.trim();
      if (game) parsed.game = clean(game, 60);
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length !== 2 || !THUNDERSTORE_NAME.test(parts[0]!) || !VERSION.test(parts[1]!)) {
      parsed.unread++;
      continue;
    }
    if (read >= CREW_MAX_LINES) {
      parsed.overflow++;
      continue;
    }
    read++;
    parsed.mods.set(parts[0]!.toLowerCase(), { id: parts[0]!, version: parts[1]! });
  }
  return parsed;
}

export function runCrewCheck(input: CrewInput): CrewResult {
  const read = readThunderstoreProfile(input.gameId, input.profileName, "Crew Check");
  if (!read.ok) return read;

  const lists = input.crewLists ?? [];
  if (lists.length === 0) {
    return {
      ok: true,
      mode: "export",
      game: read.game,
      profile: read.profile,
      list: crewList(read.game, read.mods),
      count: read.mods.length,
      notThunderstore: read.notThunderstore,
    };
  }

  const warnings: string[] = [];
  if (lists.length > CREW_MAX_LISTS) warnings.push(`Only the first ${CREW_MAX_LISTS} of the ${lists.length} lists were compared.`);
  const mine: ParsedList = {
    label: "You",
    mods: new Map(read.mods.map((m) => [m.fullName.toLowerCase(), { id: m.fullName, version: m.installed !== undefined && VERSION.test(m.installed) ? m.installed : "?" }])),
    unread: 0,
    overflow: 0,
  };
  const crew = lists.slice(0, CREW_MAX_LISTS).map((l, i) => {
    const name = l.name !== undefined ? clean(l.name, 40) : "";
    return parseCrewList(l.list, name !== "" && name.toLowerCase() !== "you" ? name : `Crewmate ${i + 1}`);
  });
  for (const c of crew) {
    if (c.mods.size === 0) warnings.push(`${c.label}'s list had no mod lines ModWrench could read.`);
    if (c.game !== undefined && c.game !== read.game) warnings.push(`${c.label}'s list is for ${c.game}, not ${read.game}.`);
    if (c.unread > 0) warnings.push(`${c.label}'s list had ${c.unread} line${c.unread === 1 ? "" : "s"} that weren't a mod and a version, left unread.`);
    if (c.overflow > 0) warnings.push(`${c.label}'s list had more than ${CREW_MAX_LINES} mods; the last ${c.overflow} weren't read.`);
  }

  const everyone = [mine, ...crew];
  const ids = new Map<string, string>();
  for (const p of everyone) for (const [key, m] of p.mods) if (!ids.has(key)) ids.set(key, m.id);

  const missing: Array<{ id: string; has: string[]; lacks: string[] }> = [];
  const versions: Array<{ id: string; byPlayer: Array<[string, string]> }> = [];
  let same = 0;
  for (const [key, id] of [...ids].sort((a, b) => a[1].localeCompare(b[1]))) {
    const has = everyone.filter((p) => p.mods.has(key));
    if (has.length < everyone.length) {
      missing.push({ id, has: has.map((p) => p.label), lacks: everyone.filter((p) => !p.mods.has(key)).map((p) => p.label) });
      continue;
    }
    const byPlayer = has.map((p): [string, string] => [p.label, p.mods.get(key)!.version]);
    if (new Set(byPlayer.map(([, v]) => v)).size > 1) versions.push({ id, byPlayer });
    else same++;
  }

  return { ok: true, mode: "compare", game: read.game, profile: read.profile, players: everyone.map((p) => p.label), missing, versions, same, warnings };
}

// ─── The text answer ─────────────────────────────────────────────────────────

const LIST_CAP = 25;

function capped(lines: string[]): string[] {
  return lines.length <= LIST_CAP ? lines : [...lines.slice(0, LIST_CAP), `…and ${lines.length - LIST_CAP} more`];
}

function names(labels: string[]): string {
  return labels.length <= 2 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function summarizeCrewCheck(result: CrewResult): string {
  if (!result.ok) return result.reason;
  if (result.mode === "export") {
    const out = [
      `Your crew list for ${result.game}, r2modman profile "${clean(result.profile)}": ${result.count} switched-on Thunderstore mod${result.count === 1 ? "" : "s"}.`,
      "Show it to the user to share with their crew. It holds only each mod's Thunderstore name and version: no folder, profile or account. " +
        "When crewmates paste their own lists back, call mw_crew_check again with them in crewLists to compare.",
      "",
      "```",
      result.list,
      "```",
    ];
    if (result.notThunderstore.length > 0) {
      out.push("", `Left out, because their ids aren't Thunderstore names (${result.notThunderstore.length}):`, ...capped(result.notThunderstore.map((n) => `- ${n}`)));
    }
    return out.join("\n");
  }

  const crewCount = result.players.length - 1;
  const clash = result.missing.length + result.versions.length;
  const out = [
    clash === 0
      ? `Crew Check for ${result.game}: you and ${crewCount === 1 ? "your crewmate have" : `your ${crewCount} crewmates all have`} the same ${result.same} mod${result.same === 1 ? "" : "s"} at the same versions.`
      : `Crew Check for ${result.game}: ${result.missing.length} mod${result.missing.length === 1 ? " isn't" : "s aren't"} on everyone's list, and ${result.versions.length} ${result.versions.length === 1 ? "is" : "are"} on different versions. ${result.same} match.`,
  ];
  if (result.missing.length > 0) {
    out.push("", "Not on everyone's list:", ...capped(result.missing.map((m) => `- ${m.id}: ${names(m.has)} ${m.has.length === 1 ? "has" : "have"} it; ${names(m.lacks)} ${m.lacks.length === 1 && m.lacks[0] !== "You" ? "doesn't" : "don't"}`)));
  }
  if (result.versions.length > 0) {
    out.push("", "Different versions:", ...capped(result.versions.map((v) => `- ${v.id}: ${v.byPlayer.map(([p, ver]) => `${p} ${ver}`).join(", ")}`)));
  }
  if (result.warnings.length > 0) out.push("", ...result.warnings.map((w) => `Note: ${w}`));
  out.push("", "Crew Check compares the lists only: it doesn't download, install or change anything. In most co-op lobbies everyone needs the same mods at the same versions, but some mods are client-side only.");
  return out.join("\n");
}
