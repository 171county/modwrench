import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appIdentity, createHttpClient, getEnv, log, ModWrenchError } from "@modwrench/core";
import { adultContentAllowed, applyAdultPolicy } from "./adult.js";

const APP = appIdentity(import.meta.url);

/**
 * Register the Nexus Mods tools that need no key: public reads through the v2
 * GraphQL API. They are on for everyone. The tools that act for a person's own
 * Nexus account are registerNexusTools, in register.ts.
 */
export function registerNexusPublicTools(server: McpServer): { toolCount: number; baseUrl: string } {
  // No authHeaders: nothing about the person goes with these requests.
  const httpClient = createHttpClient({
    baseUrl: "https://api.nexusmods.com",
    userAgent: APP.userAgent,
    defaultHeaders: { ...APP.headers },
    errorCodePrefix: "nexus",
  });

  // The v2 GraphQL endpoint. Nexus Mods' support pointed ModWrench at it, and its
  // reference says: "Most of GraphQL V2 is accessible without authentication".
  // So these requests carry no key and no token: only the Application-Name and
  // Application-Version headers Nexus's API policy asks every application to send.
  const NEXUS_GRAPHQL_URL = getEnv(
    "NEXUS_GRAPHQL_URL",
    "https://api.nexusmods.com/v2/graphql"
  );

  // The adult flag on the v2 `mods` node. This name must match the schema
  // exactly: GraphQL rejects an unknown field at validation time, which fails
  // the whole query rather than just omitting the value.
  //
  // It matters because the filter in @modwrench/core decides by reading a flag
  // off the record. If the query does not ask for the flag, nothing is flagged,
  // and the filter silently passes every adult mod through — which is exactly
  // what this tool did before. Asking for the field is the whole fix.
  // `adult` is deprecated in the v2 schema "in favour of adult_content"; the
  // reference lists `adultContent` on Mod and in ModsFilter.
  const GQL_ADULT_FIELD = "adultContent";

  /** A GraphQL validation failure caused by GQL_ADULT_FIELD not existing. */
  function isUnknownAdultFieldError(err: unknown): boolean {
    if (!(err instanceof ModWrenchError) || err.code !== "nexus_graphql_error") {
      return false;
    }
    const msg = err.message.toLowerCase();
    return (
      msg.includes(GQL_ADULT_FIELD.toLowerCase()) &&
      (msg.includes("cannot query field") ||
        msg.includes("unknown field") ||
        msg.includes("undefined field") ||
        msg.includes("doesn't exist") ||
        msg.includes("does not exist"))
    );
  }

  async function nexusGraphQL<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    log("debug", "nexus.graphql", { variables });
    const res = await httpClient.request<{
      data?: T;
      errors?: Array<{ message: string }>;
    }>(NEXUS_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.errors && res.errors.length > 0) {
      throw new ModWrenchError(
        "nexus_graphql_error",
        `Nexus GraphQL error: ${res.errors.map((e) => e.message).join("; ")}`
      );
    }
    if (!res.data) {
      throw new ModWrenchError(
        "nexus_graphql_empty",
        "Nexus GraphQL returned no data."
      );
    }
    return applyAdultPolicy(res.data, "graphql");
  }

  // Full-text mod search. The v1 REST API has none, so this is the v2 `mods`
  // query, the same backend as the website's search box.
  server.registerTool(
    "nexus_search",
    {
      title: "Search Nexus mods",
      description: "Full-text search for mods across Nexus Mods by free-text term, optionally scoped to a single game. Returns matching mods with name, author, game, mod ID, summary, download/endorsement counts, and a nexusmods.com page URL. This is the only Nexus tool with real keyword search.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Free-text search term (matched against mod names, e.g. 'inventory sorter')."),
        game_domain: z
          .string()
          .optional()
          .describe("Optional game domain to scope the search (e.g. 'skyrimspecialedition'). Omit to search all games. Use nexus_list_games to find domains."),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("Max number of hits to return. Default 10, max 50."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, game_domain, limit }) => {
      const count = limit ?? 10;
      // Build the ModsFilter object in JS: always filter by name (wildcard
      // full-text), and add a gameDomainName equality clause only when a game
      // is supplied. Passing the filter as a typed $filter variable keeps the
      // query string valid (GraphQL has no inline conditionals).
      const filter: {
        name: { value: string; op: "WILDCARD" };
        gameDomainName?: Array<{ value: string; op: "EQUALS" }>;
      } = { name: { value: query, op: "WILDCARD" } };
      if (game_domain) {
        filter.gameDomainName = [{ value: game_domain, op: "EQUALS" }];
      }
      // Ask for the adult flag only when it will be used. The filter runs on
      // whatever the response carries, so without this field every adult mod
      // passed straight through — this tool was the one hole in the filter.
      const buildQuery = (withAdultField: boolean): string =>
        `query ModWrenchSearch($filter: ModsFilter, $count: Int!) {
  mods(
    filter: $filter
    count: $count
    sort: [{ relevance: { direction: DESC } }]
  ) {
    totalCount
    nodes {
      modId
      name
      summary
      author
      uploader { name }
      game { domainName name }
      downloads
      endorsements${withAdultField ? `\n      ${GQL_ADULT_FIELD}` : ""}
    }
  }
}`;

      type SearchData = {
        mods: {
          totalCount: number;
          nodes: Array<{
            modId: number;
            name: string;
            summary: string;
            author: string;
            uploader: { name: string } | null;
            game: { domainName: string; name: string } | null;
            downloads: number;
            endorsements: number;
          }>;
        };
      };

      let data: SearchData;
      if (adultContentAllowed()) {
        // Opted in, so there is nothing to filter and no reason to ask for the
        // flag at all.
        data = await nexusGraphQL<SearchData>(buildQuery(false), { filter, count });
      } else {
        try {
          data = await nexusGraphQL<SearchData>(buildQuery(true), { filter, count });
        } catch (err) {
          if (!isUnknownAdultFieldError(err)) throw err;
          // The schema has no field by that name, so results from this endpoint
          // cannot be checked. Nexus puts the filtering duty on API consumers,
          // so this fails closed: no results rather than unchecked results.
          // The alternative — returning them with a warning — is still
          // returning them.
          log("error", "nexus.search_adult_field_unknown", {
            field: GQL_ADULT_FIELD,
          });
          throw new ModWrenchError(
            "nexus_adult_unverifiable",
            `Nexus search is unavailable. ModWrench asks the v2 GraphQL API for a "${GQL_ADULT_FIELD}" field so it can filter adult-tagged mods, and this schema has no such field. Rather than hand back results it cannot check — Nexus requires third-party tools to filter what they return — search is disabled instead. To fix: set GQL_ADULT_FIELD in packages/nexus/src/public.ts to the schema's real adult field name. To accept unfiltered search results deliberately, set NEXUS_ALLOW_ADULT_CONTENT=true. Every other Nexus tool is unaffected.`
          );
        }
      }

      const hits = data.mods.nodes.map((m) => ({
        mod_id: m.modId,
        name: m.name,
        summary: m.summary,
        author: m.author || m.uploader?.name || "",
        game: m.game?.name ?? "",
        game_domain: m.game?.domainName ?? "",
        downloads: m.downloads,
        endorsements: m.endorsements,
        url: m.game
          ? `https://www.nexusmods.com/${m.game.domainName}/mods/${m.modId}`
          : "",
      }));

      return {
        content: [
          {
            type: "text",
            text: `Found ${data.mods.totalCount} total match(es) for "${query}"${
              game_domain ? ` in ${game_domain}` : ""
            }; showing ${hits.length}:\n\n${JSON.stringify(hits, null, 2)}`,
          },
        ],
      };
    }
  );

  return { toolCount: 1, baseUrl: NEXUS_GRAPHQL_URL };
}
