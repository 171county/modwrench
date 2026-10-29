import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appIdentity, createHttpClient, getEnv, log, ModWrenchError } from "@modwrench/core";
import { adultContentAllowed, applyAdultPolicy, filterAdultContent } from "./adult.js";

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
    variables: Record<string, unknown>,
    policy = true
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
    return policy ? applyAdultPolicy(res.data, "graphql") : res.data;
  }

  /** The adult flag, asked for only when it will be used to filter. */
  const adultField = (): string => (adultContentAllowed() ? "" : `\n      ${GQL_ADULT_FIELD}`);

  /**
   * A read whose selection asks for the adult flag. If the schema has dropped the
   * field, the answer can't be checked, so it fails closed, as search does.
   */
  async function modRead<T>(query: string, variables: Record<string, unknown>, policy = true): Promise<T> {
    try {
      return await nexusGraphQL<T>(query, variables, policy);
    } catch (err) {
      if (!isUnknownAdultFieldError(err)) throw err;
      log("error", "nexus.adult_field_unknown", { field: GQL_ADULT_FIELD });
      throw new ModWrenchError(
        "nexus_adult_unverifiable",
        `Nexus's GraphQL API has no "${GQL_ADULT_FIELD}" field, which ModWrench reads to withhold adult-tagged mods, so this answer can't be checked and isn't returned. Nexus requires third-party tools to filter what they return. To fix: set GQL_ADULT_FIELD in packages/nexus/src/public.ts to the schema's adult field name. To accept unfiltered answers deliberately, set NEXUS_ALLOW_ADULT_CONTENT=true.`
      );
    }
  }

  /** A list's mods with the adult-tagged ones taken out, and how many were, so the answer can say so. */
  function allowed<T>(nodes: T[]): { kept: T[]; withheld: number } {
    if (adultContentAllowed()) return { kept: nodes, withheld: 0 };
    const { value, removed } = filterAdultContent(nodes);
    if (removed > 0) log("info", "nexus.adult_filtered", { context: "graphql", removed });
    return { kept: value, withheld: removed };
  }
  const withheldNote = (n: number): string =>
    n === 1 ? "1 adult-tagged mod was withheld." : `${n} adult-tagged mods were withheld.`;

  type GqlMod = {
    modId: number;
    name: string;
    summary?: string;
    version?: string;
    author?: string | null;
    uploader?: { name: string } | null;
    createdAt?: string;
    updatedAt?: string;
    downloads?: number;
    endorsements?: number;
    game?: { domainName: string; name: string } | null;
  };

  // The fields every list of mods asks for. `uploader` is limited to the name:
  // the docs mark other User fields as protected.
  const LIST_FIELDS = `modId
      name
      summary
      version
      author
      uploader { name }
      createdAt
      updatedAt
      downloads
      endorsements
      game { domainName name }`;

  const modUrl = (domain: string, modId: number): string => `https://www.nexusmods.com/${domain}/mods/${modId}`;

  /** A mod from a list, in the shape the tools return. A withheld entry has already been taken out. */
  function row(m: GqlMod, domain: string): Record<string, unknown> {
    const game = m.game?.domainName ?? domain;
    return {
      mod_id: m.modId,
      name: m.name,
      summary: m.summary ?? "",
      version: m.version ?? "",
      author: m.author || m.uploader?.name || "",
      downloads: m.downloads,
      endorsements: m.endorsements,
      created_at: m.createdAt,
      updated_at: m.updatedAt,
      url: modUrl(game, m.modId),
    };
  }

  const gameDomain = z.string().min(1).describe("The game's domain name (e.g. 'skyrimspecialedition'). Use nexus_list_games to find these.");
  const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

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
        data = await nexusGraphQL<SearchData>(buildQuery(false), { filter, count }, false);
      } else {
        try {
          data = await nexusGraphQL<SearchData>(buildQuery(true), { filter, count }, false);
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

      const { kept, withheld } = allowed(data.mods.nodes);
      const hits = kept.map((m) => ({
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
            }; showing ${hits.length}${
              withheld > 0 ? ` (${withheld} more ${withheld === 1 ? "is" : "are"} adult-tagged and withheld)` : ""
            }:\n\n${JSON.stringify(hits, null, 2)}`,
          },
        ],
      };
    }
  );


  // The games on Nexus, by number of mods.
  server.registerTool(
    "nexus_list_games",
    {
      title: "List Nexus games",
      description: "List the games on Nexus Mods with the most mods: each game's domain name (used by the other Nexus tools), display name, mod count and download count. No Nexus key needed.",
      annotations: READ,
    },
    async () => {
      const data = await nexusGraphQL<{
        games: { totalCount: number; nodes: Array<{ id: number; domainName: string; name: string; modCount?: number | null; downloadCount?: string | number | null }> };
      }>(
        `query ModWrenchGames($count: Int!) {
  games(count: $count, sort: [{ mods: { direction: DESC } }]) {
    totalCount
    nodes { id domainName name modCount downloadCount }
  }
}`,
        { count: 50 }
      );
      const games = data.games.nodes.map((g) => ({ domain: g.domainName, name: g.name, mods: g.modCount, downloads: g.downloadCount }));
      return {
        content: [
          { type: "text" as const, text: `The ${games.length} games with the most mods (of ${data.games.totalCount} on Nexus):\n\n${JSON.stringify(games, null, 2)}` },
        ],
      };
    }
  );

  // One game's details.
  server.registerTool(
    "nexus_get_game",
    {
      title: "Get Nexus game details",
      description: "Get one game's details on Nexus Mods by domain name: its name, genre, mod, download and collection counts, when it was approved, and its forum link. No Nexus key needed.",
      inputSchema: { game_domain: gameDomain },
      annotations: READ,
    },
    async ({ game_domain }) => {
      type GameData = {
        game: {
          id: number;
          domainName: string;
          name: string;
          genre?: string | null;
          modCount?: number | null;
          downloadCount?: string | number | null;
          uniqueDownloadCount?: string | number | null;
          collectionCount?: number | null;
          approvedAt?: string | null;
          forumUrl?: string | null;
          supportsVortex?: boolean;
        } | null;
      };
      const notFound = () =>
        new ModWrenchError("nexus_not_found", `Nexus has no game with the domain name "${game_domain}". Use nexus_list_games to find it.`);
      let data: GameData;
      try {
        data = await nexusGraphQL<GameData>(
          `query ModWrenchGame($domain: String!) {
  game(domainName: $domain) {
    id domainName name genre modCount downloadCount uniqueDownloadCount collectionCount approvedAt forumUrl supportsVortex
  }
}`,
          { domain: game_domain }
        );
      } catch (err) {
        // Nexus answers an unknown domain with an error ("Game not found…") rather than a null game.
        if (err instanceof ModWrenchError && err.code === "nexus_graphql_error" && /game not found/i.test(err.message)) throw notFound();
        throw err;
      }
      const g = data.game;
      if (!g) throw notFound();
      const game = {
        id: g.id,
        domain: g.domainName,
        name: g.name,
        genre: g.genre,
        mods: g.modCount,
        downloads: g.downloadCount,
        unique_downloads: g.uniqueDownloadCount,
        collections: g.collectionCount,
        approved_at: g.approvedAt,
        forum_url: g.forumUrl,
        supports_vortex: g.supportsVortex,
        url: `https://www.nexusmods.com/${g.domainName}`,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(game, null, 2) }] };
    }
  );

  // One mod's details.
  server.registerTool(
    "nexus_get_mod",
    {
      title: "Get Nexus mod details",
      description: "Get full details for one mod by game domain and mod ID: name, summary, description, author, version, category, status, download and endorsement counts, and when it was created and last updated. No Nexus key needed.",
      inputSchema: {
        game_domain: gameDomain,
        mod_id: z.number().int().positive().describe("The numeric mod ID from the Nexus URL."),
      },
      annotations: READ,
    },
    async ({ game_domain, mod_id }) => {
      // The policy is applied to the one mod below, so a withheld mod is said to
      // be withheld rather than reported as missing.
      const data = await modRead<{
        legacyModsByDomain: { nodes: Array<GqlMod & { uid?: string; description?: string; category?: string; status?: string; fileSize?: number | null; pictureUrl?: string | null }> };
      }>(
        `query ModWrenchMod($ids: [CompositeDomainWithIdInput!]!) {
  legacyModsByDomain(ids: $ids) {
    nodes {
      ${LIST_FIELDS}
      uid
      description
      category
      status
      fileSize
      pictureUrl${adultField()}
    }
  }
}`,
        { ids: [{ gameDomain: game_domain, modId: mod_id }] },
        false
      );
      const m = data.legacyModsByDomain.nodes[0];
      if (!m) throw new ModWrenchError("nexus_not_found", `Nexus returned no mod ${mod_id} for ${game_domain}. It may not exist, or may be hidden or removed.`);
      const checked = applyAdultPolicy(m as unknown as Record<string, unknown>, "graphql:mod");
      if ((checked as { filtered?: boolean }).filtered === true) {
        return { content: [{ type: "text" as const, text: JSON.stringify(checked, null, 2) }] };
      }
      const mod = {
        ...row(m, game_domain),
        uid: m.uid,
        description: m.description,
        category: m.category,
        status: m.status,
        file_size_kb: m.fileSize,
        picture_url: m.pictureUrl,
        game: m.game?.name,
        game_domain: m.game?.domainName ?? game_domain,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(mod, null, 2) }] };
    }
  );

  /** The newest or most recently updated mods of a game. */
  const recent = async (game_domain: string, by: "createdAt" | "updatedAt"): Promise<string> => {
    const data = await modRead<{ mods: { nodes: GqlMod[] } }>(
      `query ModWrenchRecent($filter: ModsFilter, $count: Int!) {
  mods(filter: $filter, count: $count, sort: [{ ${by}: { direction: DESC } }]) {
    nodes {
      ${LIST_FIELDS}${adultField()}
    }
  }
}`,
      { filter: { gameDomainName: [{ value: game_domain, op: "EQUALS" }] }, count: 10 },
      false
    );
    const { kept, withheld } = allowed(data.mods.nodes);
    const json = JSON.stringify(kept.map((m) => row(m, game_domain)), null, 2);
    return withheld > 0 ? `${withheldNote(withheld)}\n\n${json}` : json;
  };

  server.registerTool(
    "nexus_latest_added",
    {
      title: "Newest Nexus mods",
      description: "Get the 10 mods most recently added for a game. Useful for discovering brand-new releases. No Nexus key needed.",
      inputSchema: { game_domain: gameDomain },
      annotations: READ,
    },
    async ({ game_domain }) => ({
      content: [{ type: "text" as const, text: await recent(game_domain, "createdAt") }],
    })
  );

  server.registerTool(
    "nexus_latest_updated",
    {
      title: "Recently updated Nexus mods",
      description: "Get the 10 mods most recently updated for a game. Useful for seeing what's actively maintained. No Nexus key needed.",
      inputSchema: { game_domain: gameDomain },
      annotations: READ,
    },
    async ({ game_domain }) => ({
      content: [{ type: "text" as const, text: await recent(game_domain, "updatedAt") }],
    })
  );

  // Mods updated within a window. The filter takes a unix timestamp as a string.
  const PERIOD_SECONDS = { "1d": 86_400, "1w": 7 * 86_400, "1m": 30 * 86_400 } as const;
  const UPDATED_COUNT = 100;
  server.registerTool(
    "nexus_updated",
    {
      title: "Nexus mods updated recently",
      description: `List the mods for a game updated within a recent window (1d / 1w / 1m), newest first, up to ${UPDATED_COUNT}, with how many there are in all. Each comes with its mod_id, name, version and when it was updated: the feed a load-order maintainer watches to know what to refresh. No Nexus key needed.`,
      inputSchema: {
        game_domain: gameDomain,
        period: z.enum(["1d", "1w", "1m"]).optional().describe("Look-back window. Default '1w'."),
      },
      annotations: READ,
    },
    async ({ game_domain, period }) => {
      const p = period ?? "1w";
      const since = Math.floor(Date.now() / 1000) - PERIOD_SECONDS[p];
      const data = await modRead<{ mods: { totalCount: number; nodes: GqlMod[] } }>(
        `query ModWrenchUpdated($filter: ModsFilter, $count: Int!) {
  mods(filter: $filter, count: $count, sort: [{ updatedAt: { direction: DESC } }]) {
    totalCount
    nodes {
      ${LIST_FIELDS}${adultField()}
    }
  }
}`,
        {
          filter: {
            gameDomainName: [{ value: game_domain, op: "EQUALS" }],
            updatedAt: [{ value: String(since), op: "GTE" }],
          },
          count: UPDATED_COUNT,
        },
        false
      );
      const { kept, withheld } = allowed(data.mods.nodes);
      const mods = kept.map((m) => row(m, game_domain));
      const total = data.mods.totalCount;
      const fetched = data.mods.nodes.length;
      const shown =
        withheld > 0
          ? `; of the newest ${fetched}, ${withheld} ${withheld === 1 ? "is" : "are"} adult-tagged and withheld, so ${mods.length} ${mods.length === 1 ? "is" : "are"} shown`
          : total > mods.length
            ? `; showing the newest ${mods.length}`
            : "";
      return {
        content: [
          { type: "text" as const, text: `${total} mods updated in the last ${p} for ${game_domain}${shown}:\n\n${JSON.stringify(mods, null, 2)}` },
        ],
      };
    }
  );

  // Which mod a file belongs to, by its MD5.
  server.registerTool(
    "nexus_md5_search",
    {
      title: "Identify a local file by MD5",
      description: "Look up a file's MD5 hash to find which Nexus mod and file it belongs to. Returns each match with the file's name, version and category and the mod's name, version, author and page. Useful for identifying unknown files in a game install. No Nexus key needed.",
      inputSchema: {
        md5_hash: z.string().regex(/^[a-fA-F0-9]{32}$/, "Must be a 32-character hex MD5 hash").describe("The MD5 hash of the file (32 hex characters)."),
        game_domain: z.string().min(1).optional().describe("Optional: keep only matches from this game (e.g. 'skyrimspecialedition')."),
      },
      annotations: READ,
    },
    async ({ md5_hash, game_domain }) => {
      type Hit = {
        md5: string;
        fileName: string;
        fileSize?: string | number;
        modFile?: {
          fileId: number;
          name: string;
          version: string;
          category?: string;
          size?: number;
          date?: number;
          mod?: GqlMod | null;
        } | null;
      };
      // The policy is applied to each match below, so a withheld one is said to be withheld.
      const data = await modRead<{ fileHash: Hit[] }>(
        `query ModWrenchMd5($md5: String!) {
  fileHash(md5: $md5) {
    md5
    fileName
    fileSize
    modFile {
      fileId
      name
      version
      category
      size
      date
      mod {
        ${LIST_FIELDS}${adultField()}
      }
    }
  }
}`,
        { md5: md5_hash.toLowerCase() },
        false
      );
      const hits = (data.fileHash ?? [])
        .filter((h) => !game_domain || h.modFile?.mod?.game?.domainName === game_domain)
        .map((h) => {
          const mod = h.modFile?.mod ?? null;
          const checked = mod ? applyAdultPolicy(mod as unknown as Record<string, unknown>, "graphql:md5") : null;
          const withheld = (checked as { filtered?: boolean } | null)?.filtered === true;
          return {
            md5: h.md5,
            file_name: h.fileName,
            file_size: h.fileSize,
            ...(h.modFile
              ? {
                  file: {
                    file_id: h.modFile.fileId,
                    name: h.modFile.name,
                    version: h.modFile.version,
                    category: h.modFile.category,
                    size_kb: h.modFile.size,
                    uploaded: h.modFile.date,
                  },
                }
              : {}),
            ...(mod ? { mod: withheld ? checked : { ...row(mod, mod.game?.domainName ?? ""), game: mod.game?.name, game_domain: mod.game?.domainName } } : {}),
          };
        });
      const scope = game_domain ? ` in ${game_domain}` : "";
      return {
        content: [
          {
            type: "text" as const,
            text: hits.length === 0 ? `Nexus knows no file with MD5 ${md5_hash}${scope}.` : `${hits.length} match(es) for MD5 ${md5_hash}${scope}:\n\n${JSON.stringify(hits, null, 2)}`,
          },
        ],
      };
    }
  );

  return { toolCount: 8, baseUrl: NEXUS_GRAPHQL_URL };
}
