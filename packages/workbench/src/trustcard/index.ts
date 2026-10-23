import { queryModMetadata } from "../metadata/index.js";
import type { ModPlatform, NormalizedMod, QueryModMetadataResult } from "../metadata/types.js";
import { clean } from "../patchday/summary.js";

// ─── Trust Card: who made this, and is it what it says? ──────────────────────
// One mod's record on its own platform, one fact to a line, each naming where it
// comes from. Facts only: ModWrench adds no score, rating or verdict of its own
// (TRUST.md: "Never rate, rank, or score a mod itself"). The platform's own numbers,
// such as downloads and endorsements, are passed through as the platform's.
// Everything in the record is someone else's text, so each value is cleaned.

export type TrustCardInput = { platform: ModPlatform; modId: string; gameId?: string };

const PLATFORM_NAME: Record<ModPlatform, string> = { nexus: "Nexus Mods", modio: "mod.io", thunderstore: "Thunderstore" };

const day = (iso: string | undefined): string | undefined => {
  if (iso === undefined) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};

const count = (n: number | undefined): string | undefined =>
  n === undefined || !Number.isFinite(n) ? undefined : Math.round(n).toLocaleString("en-US");

/** A plain https address, or nothing. */
const link = (url: string): string => (/^https:\/\/[^\s<>"]+$/.test(url) ? clean(url, 200) : "(no address on record)");

export async function runTrustCard(input: TrustCardInput): Promise<QueryModMetadataResult> {
  // A Nexus game domain goes into the request's path, with the person's key on it: only letters and digits.
  if (input.platform === "nexus" && input.gameId !== undefined && !/^[a-z0-9]{1,64}$/i.test(input.gameId)) {
    return { found: false, reason: "A Nexus gameId is the game's domain, letters and digits only, such as skyrimspecialedition.", attemptedPlatforms: [] };
  }
  return queryModMetadata({ platform: input.platform, modId: input.modId, ...(input.gameId !== undefined ? { gameId: input.gameId } : {}) });
}

export function summarizeTrustCard(result: QueryModMetadataResult, platform: ModPlatform): string {
  if (!result.found) {
    const why = Object.values(result.platformErrors ?? {}).map((e) => clean(e, 300));
    return [`Trust Card: no record found on ${PLATFORM_NAME[platform]}. ${clean(result.reason, 400)}`, ...why.map((w) => `- ${w}`)].join("\n");
  }
  const m: NormalizedMod = result.mod;
  const source = PLATFORM_NAME[m.platform];
  const lines: string[] = [];
  const fact = (label: string, value: string | undefined): void => {
    lines.push(`- ${label}: ${value ?? `not on record at ${source}`}`);
  };

  lines.push(`Trust Card: ${clean(m.name)} — every line is ${source}'s own record. ModWrench adds no score or verdict.`, "");
  fact("Author", clean(m.attribution.author, 80));
  if (m.uploadedBy !== undefined) {
    const uploader = clean(m.uploadedBy, 80);
    lines.push(
      uploader.toLowerCase() === clean(m.attribution.author, 80).toLowerCase()
        ? `- Uploaded by: ${uploader}, the author`
        : `- Uploaded by: ${uploader}, who isn't the author listed. A mod uploaded by someone else than its author can be a permitted re-upload or translation, or a copy: the mod page should say which.`
    );
  }
  fact("Where it lives", `${source}, ${link(m.pageUrl)}`);
  fact("Platform id", clean(m.attribution.sourceModId, 80));
  fact("Latest version", m.version !== undefined ? clean(m.version, 40) : undefined);
  fact("First published", day(m.created));
  fact("Last updated", day(m.lastUpdated));
  if (m.deprecated === true) lines.push(`- Status: its author has marked it deprecated on ${source}`);
  fact("Downloads", count(m.downloadCount));
  fact(m.platform === "thunderstore" ? "Rating" : m.platform === "modio" ? "Positive ratings" : "Endorsements", count(m.endorsements));
  const p = m.permissions;
  const known = p !== undefined && [p.modificationAllowed, p.assetReuseAllowed, p.conversionAllowed].some((v) => v !== null);
  lines.push(
    known
      ? `- Permissions: modification ${p!.modificationAllowed ?? "unknown"}, asset reuse ${p!.assetReuseAllowed ?? "unknown"}, conversion ${p!.conversionAllowed ?? "unknown"}`
      : `- Permissions: ${source}'s API doesn't give them. They are on the mod's page; check there before reusing anything from it.`
  );
  lines.push("", "What this card can't tell you: whether the mod works with your setup, or is safe to run. It shows what the platform records about who made it and where it lives.");
  return lines.join("\n");
}
