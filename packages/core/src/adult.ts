// ─── Adult-content policy ─────────────────────────────────────────────────────
// Nexus tags some mods as adult content, and their Terms of Service put the
// filtering duty on API consumers: "Third parties who use our APIs are
// responsible for filtering the content returned."
//
// This lives in core rather than in the Nexus package because two packages now
// talk to Nexus: @modwrench/nexus through its own client, and @modwrench/workbench
// through a second client it builds for mw_query_mod_metadata. That second path
// had no filter at all, which made the project's "never surfaces adult-tagged
// content" claim false. One implementation, both callers, no drift.
//
// Env and stderr are touched directly rather than through index.ts's getEnv()
// and log(), for the same reason auth.ts does: importing index.ts from here
// would be a circular dependency.

/** Keys Nexus uses to mark adult content across v1 REST and v2 GraphQL. */
const ADULT_KEYS = ["contains_adult_content", "adult", "adultContent"];

/**
 * Whether the person running ModWrench has explicitly opted in to seeing adult
 * content. Deliberately an environment variable and not a tool parameter, so a
 * model cannot decide to turn it off.
 */
export function adultContentAllowed(): boolean {
  const raw = (process.env.NEXUS_ALLOW_ADULT_CONTENT ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * True if this looks like a Nexus record flagged as adult content.
 *
 * Note the limit, because it decides what the filter can and cannot do: this
 * reads a flag off the record. A response that does not carry the flag cannot
 * be judged, and is treated as not-adult. Any caller fetching from Nexus must
 * therefore ask for the adult field in the first place.
 */
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
 * Strip adult-flagged records out of a Nexus API payload.
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
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: "nexus.adult_filtered",
        context,
        removed,
      }) + "\n"
    );
  }
  return value;
}
