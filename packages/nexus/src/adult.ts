// ─── Adult content filtering ──────────────────────────────────────────────────
// Nexus Mods' Terms of Service (section 16) put the obligation on us, not on
// them:
//
//   "Third parties who use our APIs are responsible for filtering the content
//    returned."
//
// On Nexus itself, adult-tagged content is hidden from logged-out users, off by
// default for logged-in users, and released only behind an age check meeting
// Ofcom's "highly effective age assurance" bar. ModWrench cannot perform age
// assurance, and an MCP server has no way to know who is reading its output —
// the result goes to an AI assistant and from there to a screen we cannot see.
//
// So the default is to filter, and the only way to change that is for the human
// running ModWrench to set an environment variable on their own machine. That
// mirrors the platform's own posture (off unless the account holder turns it on)
// and keeps the decision with a person rather than with a model. Notably, an LLM
// cannot flip this: it is read from the environment at startup, not exposed as a
// tool parameter, precisely so that no amount of prompting can turn it off.
//
// Filtering happens inside the shared request path rather than in each tool, so
// a tool added later inherits it without anyone having to remember.

import { getEnv, log } from "@modwrench/core";

/** Keys Nexus uses to mark adult content across v1 REST and v2 GraphQL. */
const ADULT_KEYS = ["contains_adult_content", "adult", "adultContent"];

/**
 * Whether the person running ModWrench has explicitly opted in to seeing adult
 * content. Read once at module load from the environment — deliberately not a
 * tool parameter, so a model cannot decide to turn it off.
 */
export function adultContentAllowed(): boolean {
  const raw = getEnv("NEXUS_ALLOW_ADULT_CONTENT", "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** True if this looks like a Nexus record flagged as adult content. */
export function isAdult(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ADULT_KEYS.some((key) => record[key] === true);
}

export type FilterResult<T> = {
  /** The response with adult entries removed or redacted. */
  value: T;
  /** How many records were withheld. */
  removed: number;
};

/**
 * Strip adult-flagged records out of a Nexus API response.
 *
 * Handles the three shapes the API actually returns:
 *   - a bare array of mods            -> flagged entries dropped
 *   - a single mod object             -> replaced with a redaction marker
 *   - an object wrapping an array     -> that array filtered in place
 *
 * Returns the count so callers can tell the user something was withheld rather
 * than silently showing them a short list.
 */
export function filterAdultContent<T>(payload: T): FilterResult<T> {
  let removed = 0;

  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 4 || value === null || typeof value !== "object") return value;

    if (Array.isArray(value)) {
      const kept = value.filter((entry) => {
        if (isAdult(entry)) {
          removed += 1;
          return false;
        }
        return true;
      });
      return kept.map((entry) => walk(entry, depth + 1));
    }

    const record = value as Record<string, unknown>;
    if (isAdult(record)) {
      removed += 1;
      return {
        filtered: true,
        reason:
          "This entry is flagged as adult content on Nexus Mods and was withheld " +
          "by ModWrench. Nexus requires third-party API consumers to filter what " +
          "they return. To see it, view the mod on nexusmods.com while signed in " +
          "with adult content enabled on your account.",
      };
    }

    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      out[key] = walk(entry, depth + 1);
    }
    return out;
  };

  const value = walk(payload, 0) as T;
  return { value, removed };
}

/**
 * Apply the filter unless the operator opted out, and log when something was
 * withheld. The count goes to stderr, never the content.
 */
export function applyAdultPolicy<T>(payload: T, context: string): T {
  if (adultContentAllowed()) return payload;
  const { value, removed } = filterAdultContent(payload);
  if (removed > 0) {
    log("info", "nexus.adult_filtered", { context, removed });
  }
  return value;
}
