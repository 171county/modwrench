// Opt-in attribution for crash-suspect names.
//
// README names this gap plainly: the crash tools can name a mod without linking
// to its author, because they work from plugin filenames and ModWrench does not
// know which platform a given .esp came from. Closing it fully would mean a
// network lookup for every suspect in a diagnostic that otherwise touches
// nothing — so this is OPT-IN (attributeSuspects: true on mw_diagnose_crash),
// bounded (ATTRIBUTION_LOOKUP_CAP lookups), Nexus-only (the dominant home for
// the Bethesda games crash logs come from), and honest about being a name
// search: every attribution carries the matched mod's name and matchedBy:
// "name-search", so the model can sanity-check the pairing before presenting
// it as the author's page.
//
// Pure where it can be: attributeSuspects() takes an injected search function
// (the same pattern as correlateCrash's injected conflict checker), so the
// orchestration unit-tests without a network. The real Nexus search lives here
// too, built on workbench's own thin client — the dependency-direction rule in
// clients.ts is why this does not import @modwrench/nexus.

import { ModWrenchError, adultContentAllowed } from "@modwrench/core";
import { tryCreateNexusClient } from "./clients.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SuspectAttribution = {
  author: string;
  platform: "nexus";
  modId: string;
  pageUrl: string;
  /** Name of the mod the search matched — compare against the suspect name. */
  matchedName: string;
  /** How the match was found. A name search is a best guess, and says so. */
  matchedBy: "name-search";
};

export type AttributeSearchResult =
  | {
      status: "found";
      author: string;
      modId: string;
      pageUrl: string;
      matchedName: string;
    }
  | { status: "no-match" }
  | { status: "withheld"; reason: string }
  | { status: "error"; message: string };

export type AttributeSearch = (
  modName: string,
  gameDomain: string
) => Promise<AttributeSearchResult>;

/** Bound on network lookups per diagnosis. Stated in the tool description. */
export const ATTRIBUTION_LOOKUP_CAP = 5;

// ─── Orchestration (pure — injected search, unit-testable) ────────────────────

const PLUGIN_EXTENSION = /\.(esp|esm|esl)$/i;

/** "SomeArmorMod.esp" -> "SomeArmorMod". DLLs and exotics pass through as-is. */
export function stripPluginExtension(name: string): string {
  return name.replace(PLUGIN_EXTENSION, "").trim();
}

export async function attributeSuspects(opts: {
  suspectNames: string[];
  gameDomain?: string;
  search: AttributeSearch;
  cap?: number;
}): Promise<{ attributed: Map<string, SuspectAttribution>; notes: string[] }> {
  const notes: string[] = [];
  const attributed = new Map<string, SuspectAttribution>();

  if (opts.gameDomain === undefined) {
    notes.push(
      "Attribution skipped: no gameId. The Nexus lookup is scoped by game " +
        "domain — pass gameId (e.g. skyrimspecialedition) to attribute suspects."
    );
    return { attributed, notes };
  }

  // Unique name candidates, extension stripped. The map is keyed by the
  // ORIGINAL suspect name so the caller can attach attribution without
  // re-deriving the stripped form.
  const candidates: Array<{ original: string; modName: string }> = [];
  const seen = new Set<string>();
  for (const name of opts.suspectNames) {
    const modName = stripPluginExtension(name);
    if (!modName) continue;
    const key = modName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ original: name, modName });
  }

  const cap = opts.cap ?? ATTRIBUTION_LOOKUP_CAP;
  const limited = candidates.slice(0, cap);
  if (candidates.length > cap) {
    notes.push(
      `Attribution capped at ${cap} lookups — ${candidates.length - cap} more ` +
        `suspect(s) left unattributed to bound the network cost.`
    );
  }

  for (const c of limited) {
    let res: AttributeSearchResult;
    try {
      res = await opts.search(c.modName, opts.gameDomain);
    } catch (err) {
      res = {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    if (res.status === "found") {
      attributed.set(c.original, {
        author: res.author,
        platform: "nexus",
        modId: res.modId,
        pageUrl: res.pageUrl,
        matchedName: res.matchedName,
        matchedBy: "name-search",
      });
    } else if (res.status === "withheld") {
      notes.push(`"${c.original}": best name match(es) withheld — ${res.reason}`);
    } else if (res.status === "error") {
      notes.push(`Attribution failed for "${c.original}": ${res.message}`);
    }
    // no-match: no attribution, no note — absence says it.
  }

  return { attributed, notes };
}

// ─── The real search: Nexus v2 GraphQL, name-scoped to the game ───────────────

// The adult flag on the v2 `mods` node — same field name, and same reasoning,
// as the search tool in @modwrench/nexus: the filter decides by reading a flag
// off the record, so the query must ask for it or nothing is ever flagged.
const GQL_ADULT_FIELD = "adult";

const buildAttributionQuery = (withAdultField: boolean): string =>
  `query ModWrenchAttribution($filter: ModsFilter, $count: Int!) {
  mods(
    filter: $filter
    count: $count
    sort: [{ relevance: { direction: DESC } }]
  ) {
    totalCount
    nodes {
      modId
      name
      author
      uploader { name }
${withAdultField ? `      ${GQL_ADULT_FIELD}\n` : ""}    }
  }
}`;

type AttributionData = {
  mods: {
    totalCount: number;
    nodes: Array<{
      modId: number;
      name: string;
      author: string | null;
      uploader: { name: string } | null;
    }>;
  };
};

/** A GraphQL validation failure caused by GQL_ADULT_FIELD not existing. */
function isUnknownAdultFieldError(err: unknown): boolean {
  if (!(err instanceof ModWrenchError) || err.code !== "nexus_graphql_error") {
    return false;
  }
  const msg = err.message.toLowerCase();
  return (
    msg.includes(GQL_ADULT_FIELD) &&
    (msg.includes("cannot query field") ||
      msg.includes("unknown field") ||
      msg.includes("undefined field") ||
      msg.includes("doesn't exist") ||
      msg.includes("does not exist"))
  );
}

/**
 * Build the Nexus name-search used for attribution. Returns null when no Nexus
 * credential is stored — the caller then reports attribution as skipped, and
 * nothing is ever attempted unauthenticated.
 */
export function createNexusNameSearch(): AttributeSearch | null {
  const client = tryCreateNexusClient();
  if (!client) return null;

  return async (modName, gameDomain) => {
    const filter = {
      name: { value: modName, op: "WILDCARD" },
      gameDomainName: [{ value: gameDomain, op: "EQUALS" }],
    };
    try {
      // count 1 — the top relevance match only. totalCount then distinguishes
      // "nothing matched" (0) from "matched but withheld" (>0 with no
      // surviving node after the client's adult filter), which the client
      // applies to every GraphQL response just as it does to every v1 one.
      const data = await client.graphql<AttributionData>(
        adultContentAllowed()
          ? buildAttributionQuery(false)
          : buildAttributionQuery(true),
        { filter, count: 1 }
      );
      const node = data.mods.nodes[0];
      if (node) {
        return {
          status: "found",
          author: node.author ?? node.uploader?.name ?? "unknown",
          modId: String(node.modId),
          pageUrl: `https://www.nexusmods.com/${gameDomain}/mods/${node.modId}`,
          matchedName: node.name,
        };
      }
      if (data.mods.totalCount > 0) {
        return {
          status: "withheld",
          reason:
            "the match was flagged as adult content on Nexus and was filtered. " +
            "Nexus requires API consumers to filter; set NEXUS_ALLOW_ADULT_CONTENT " +
            "if seeing it is what you want.",
        };
      }
      return { status: "no-match" };
    } catch (err) {
      if (isUnknownAdultFieldError(err)) {
        return {
          status: "withheld",
          reason:
            "Nexus's search schema does not expose the adult-content flag, so " +
            "results cannot be checked — ModWrench withholds them rather than " +
            "attribute unchecked.",
        };
      }
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
