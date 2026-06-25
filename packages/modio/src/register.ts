import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createHttpClient,
  getEnv,
  log,
  type Credential,
} from "@modwrench/core";

/**
 * Register all mod.io tools on the given MCP server. Returns metadata
 * useful for boot logging. Pure registration — no transport, no side effects
 * beyond the server itself.
 *
 * Used by both the standalone @modwrench/modio bin and the meta-server in
 * @modwrench/cli that bundles multiple platforms into one MCP entry.
 */
export function registerModioTools(
  server: McpServer,
  credential: Credential
): { toolCount: number; baseUrl: string } {
  const MODIO_BASE_URL = getEnv("MODIO_BASE_URL", "https://api.mod.io/v1");

  // mod.io wraps list endpoints in this envelope. Single-item GETs return the
  // object directly without a wrapper.
  type ModioList<T> = {
    data: T[];
    result_count: number;
    result_total: number;
    result_offset: number;
    result_limit: number;
  };

  // ─── HTTP helper ────────────────────────────────────────────────────────────
  // Uses the shared @modwrench/core HTTP client. mod.io's quirk: the legacy
  // API key authenticates via the api_key QUERY parameter (not a header),
  // whereas OAuth tokens go in the Authorization header. We inject the
  // api_key into the query at this layer and let the client handle the
  // OAuth header via authHeaders.

  const httpClient = createHttpClient({
    baseUrl: MODIO_BASE_URL,
    userAgent: "ModWrench/0.0.1 (+https://github.com/171county/modwrench)",
    errorCodePrefix: "modio",
    authHeaders: (): Record<string, string> => {
      if (credential.source === "keychain") {
        return { Authorization: `Bearer ${credential.accessToken}` };
      }
      return {};
    },
  });

  async function modioRequest<T>(
    path: string,
    query?: Record<string, string | number | undefined>
  ): Promise<T> {
    const finalQuery: Record<string, string | number | undefined | null> = {
      ...(query ?? {}),
    };
    if (credential.source === "env") {
      finalQuery["api_key"] = credential.apiKey;
    }
    log("debug", "modio.request", {
      path,
      auth: credential.source === "env" ? "api_key (query)" : "Bearer (header)",
    });
    return httpClient.request<T>(path, { query: finalQuery });
  }

  // ─── Tools ──────────────────────────────────────────────────────────────────

  // Tool 1: List games on mod.io
  server.tool(
    "modio_list_games",
    "List games on mod.io. Returns each game's numeric id (used in other tool calls), name, summary, and mod statistics. Paginated.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (1-100). Default 100."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset. Default 0."),
    },
    async ({ limit, offset }) => {
      const list = await modioRequest<
        ModioList<{
          id: number;
          name: string;
          name_id: string;
          summary: string;
          stats: { mods_count_total: number; subscribers_total: number };
        }>
      >("/games", { _limit: limit ?? 100, _offset: offset ?? 0 });

      const summary = list.data.map((g) => ({
        id: g.id,
        name_id: g.name_id,
        name: g.name,
        mods: g.stats?.mods_count_total,
        subscribers: g.stats?.subscribers_total,
        summary: g.summary,
      }));

      return {
        content: [
          {
            type: "text",
            text: `Showing ${list.result_count} of ${list.result_total} games (offset ${list.result_offset}):\n\n${JSON.stringify(
              summary,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // Tool 2: Get a single game
  server.tool(
    "modio_get_game",
    "Get full details for a single game by its numeric mod.io id. Use modio_list_games to discover ids.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
    },
    async ({ game_id }) => {
      const game = await modioRequest<Record<string, unknown>>(`/games/${game_id}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(game, null, 2),
          },
        ],
      };
    }
  );

  // Tool 3: List mods for a game
  server.tool(
    "modio_list_mods",
    "List mods for a specific game on mod.io. Supports sorting and pagination. Returns mod id, name, summary, submitter, and stats.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      sort: z
        .string()
        .optional()
        .describe(
          "Sort field. Prefix with '-' for descending. Examples: '-popular', '-downloads', '-rating', '-date_updated'."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (1-100). Default 30."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset. Default 0."),
    },
    async ({ game_id, sort, limit, offset }) => {
      const list = await modioRequest<
        ModioList<{
          id: number;
          name: string;
          name_id: string;
          summary: string;
          submitted_by: { username: string };
          stats: {
            downloads_total: number;
            subscribers_total: number;
            ratings_weighted_aggregate: number;
          };
        }>
      >(`/games/${game_id}/mods`, {
        _sort: sort,
        _limit: limit ?? 30,
        _offset: offset ?? 0,
      });

      const summary = list.data.map((m) => ({
        id: m.id,
        name_id: m.name_id,
        name: m.name,
        author: m.submitted_by?.username,
        downloads: m.stats?.downloads_total,
        subscribers: m.stats?.subscribers_total,
        rating: m.stats?.ratings_weighted_aggregate,
        summary: m.summary,
      }));

      return {
        content: [
          {
            type: "text",
            text: `Showing ${list.result_count} of ${list.result_total} mods (offset ${list.result_offset}):\n\n${JSON.stringify(
              summary,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // Tool 4: Get a single mod
  server.tool(
    "modio_get_mod",
    "Get full details for a single mod by game id and mod id. Returns name, summary, description, version, submitter, stats, tags, and more.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      mod_id: z.number().int().positive().describe("The numeric mod.io mod id."),
    },
    async ({ game_id, mod_id }) => {
      const mod = await modioRequest<Record<string, unknown>>(
        `/games/${game_id}/mods/${mod_id}`
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(mod, null, 2),
          },
        ],
      };
    }
  );

  // Tool 5: Search mods
  server.tool(
    "modio_search_mods",
    "Full-text search mods for a game. Combines mod.io's '_q' query with optional name/tags filters and sorting.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      query: z
        .string()
        .optional()
        .describe("Full-text search across name, summary, and description (mod.io '_q' parameter)."),
      name_contains: z
        .string()
        .optional()
        .describe("Filter mods whose name contains this substring (uses mod.io 'name-lk' filter)."),
      sort: z
        .string()
        .optional()
        .describe(
          "Sort field. Prefix with '-' for descending. Examples: '-popular', '-downloads', '-rating'."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (1-100). Default 30."),
    },
    async ({ game_id, query, name_contains, sort, limit }) => {
      const list = await modioRequest<
        ModioList<{
          id: number;
          name: string;
          name_id: string;
          summary: string;
          submitted_by: { username: string };
          stats: { downloads_total: number; ratings_weighted_aggregate: number };
        }>
      >(`/games/${game_id}/mods`, {
        _q: query,
        "name-lk": name_contains ? `*${name_contains}*` : undefined,
        _sort: sort,
        _limit: limit ?? 30,
      });

      const summary = list.data.map((m) => ({
        id: m.id,
        name_id: m.name_id,
        name: m.name,
        author: m.submitted_by?.username,
        downloads: m.stats?.downloads_total,
        rating: m.stats?.ratings_weighted_aggregate,
        summary: m.summary,
      }));

      return {
        content: [
          {
            type: "text",
            text: `Search returned ${list.result_count} of ${list.result_total} matching mods:\n\n${JSON.stringify(
              summary,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // Tool 6: List files for a mod
  server.tool(
    "modio_mod_files",
    "List the downloadable modfiles (versions) for a specific mod. Useful for inspecting version history, file sizes, and platform support.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      mod_id: z.number().int().positive().describe("The numeric mod.io mod id."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (1-100). Default 30."),
    },
    async ({ game_id, mod_id, limit }) => {
      const list = await modioRequest<
        ModioList<{
          id: number;
          filename: string;
          version: string;
          filesize: number;
          date_added: number;
          changelog: string;
          platforms: Array<{ platform: string }>;
        }>
      >(`/games/${game_id}/mods/${mod_id}/files`, {
        _limit: limit ?? 30,
        _sort: "-date_added",
      });

      return {
        content: [
          {
            type: "text",
            text: `Showing ${list.result_count} of ${list.result_total} files:\n\n${JSON.stringify(
              list.data,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // Tool 7: Popular mods for a game
  server.tool(
    "modio_popular",
    "Get the most popular mods for a specific game right now (mod.io's 'popular' sort — their internal popularity score). The mod.io equivalent of nexus_trending.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results (1-100). Default 20."),
    },
    async ({ game_id, limit }) => {
      const list = await modioRequest<
        ModioList<{
          id: number;
          name: string;
          name_id: string;
          summary: string;
          submitted_by: { username: string };
          stats: {
            popularity_rank_position: number;
            downloads_total: number;
            ratings_weighted_aggregate: number;
          };
        }>
      >(`/games/${game_id}/mods`, {
        _sort: "popular",
        _limit: limit ?? 20,
      });

      const summary = list.data.map((m) => ({
        id: m.id,
        name_id: m.name_id,
        name: m.name,
        author: m.submitted_by?.username,
        rank: m.stats?.popularity_rank_position,
        downloads: m.stats?.downloads_total,
        rating: m.stats?.ratings_weighted_aggregate,
        summary: m.summary,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );

  // Tool 8: Get a single modfile's details
  server.tool(
    "modio_get_file",
    "Get details for a single modfile (version) by id. Returns version, filesize, hashes, download URL, platforms, and changelog.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      mod_id: z.number().int().positive().describe("The numeric mod.io mod id."),
      file_id: z.number().int().positive().describe("The numeric modfile id."),
    },
    async ({ game_id, mod_id, file_id }) => {
      const file = await modioRequest<Record<string, unknown>>(
        `/games/${game_id}/mods/${mod_id}/files/${file_id}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(file, null, 2) }],
      };
    }
  );

  // Tool 9: Get a game's tag taxonomy
  server.tool(
    "modio_game_tags",
    "Get the tag taxonomy for a game — the tag categories and the available options in each. Use these tag names with modio_search_mods (via mod.io's 'tags' filter) to narrow results.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
    },
    async ({ game_id }) => {
      const list = await modioRequest<
        ModioList<{
          name: string;
          type: string;
          tags: string[];
          hidden: boolean;
          locked: boolean;
        }>
      >(`/games/${game_id}/tags`);
      return {
        content: [{ type: "text", text: JSON.stringify(list.data, null, 2) }],
      };
    }
  );

  // Tool 10: List a mod's dependencies
  server.tool(
    "modio_mod_dependencies",
    "List the dependencies a mod declares — other mods that must also be installed for this one to work. Essential for resolving install order.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      mod_id: z.number().int().positive().describe("The numeric mod.io mod id."),
      recursive: z
        .boolean()
        .optional()
        .describe("If true, includes transitive dependencies (deps of deps). Default false."),
    },
    async ({ game_id, mod_id, recursive }) => {
      const list = await modioRequest<
        ModioList<{
          mod_id: number;
          name: string;
          name_id: string;
          date_added: number;
          dependency_depth?: number;
        }>
      >(`/games/${game_id}/mods/${mod_id}/dependencies`, {
        recursive: recursive ? "true" : undefined,
      });
      return {
        content: [
          {
            type: "text",
            text: `${list.result_count} dependencies:\n\n${JSON.stringify(list.data, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 11: Top N games ranked server-side (paginates + ranks for you)
  server.tool(
    "modio_top_games",
    "Get the top N games on mod.io ranked by a stat (default: mod count). Server-side paginates the full catalog and ranks, so the answer comes back in a single tool call. Use this instead of modio_list_games when you want a ranked answer like 'top games by mods'.",
    {
      metric: z
        .enum(["mods", "subscribers", "downloads"])
        .optional()
        .describe("Stat to rank by. Default 'mods' (mods_count_total)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of games to return (1-50). Default 10."),
    },
    async ({ metric, limit }) => {
      const rankBy = metric ?? "mods";
      const topN = limit ?? 10;

      type GameStats = {
        mods_count_total?: number;
        mods_subscribers_total?: number;
        mods_downloads_total?: number;
      };
      type Game = {
        id: number;
        name: string;
        name_id: string;
        stats?: GameStats;
      };

      const all: Game[] = [];
      const PAGE_SIZE = 100;
      const MAX_PAGES = 20; // safety cap: 2000 games, well above mod.io's catalog
      let offset = 0;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await modioRequest<ModioList<Game>>("/games", {
          _limit: PAGE_SIZE,
          _offset: offset,
        });
        all.push(...page.data);
        offset += page.result_count;
        if (page.result_count < PAGE_SIZE || offset >= page.result_total) break;
      }

      const rows = all.map((g) => ({
        id: g.id,
        name_id: g.name_id,
        name: g.name,
        mods: g.stats?.mods_count_total ?? 0,
        subscribers: g.stats?.mods_subscribers_total ?? 0,
        downloads: g.stats?.mods_downloads_total ?? 0,
      }));

      const ranked = rows.sort((a, b) => b[rankBy] - a[rankBy]).slice(0, topN);

      return {
        content: [
          {
            type: "text",
            text: `Top ${topN} mod.io games by ${rankBy} (of ${all.length} total in catalog):\n\n${JSON.stringify(
              ranked,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // Tool 12: A mod's comments
  server.tool(
    "modio_mod_comments",
    "List the comments posted on a specific mod. Returns each comment's id, author, date, reply threading, karma, and content. Paginated.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      mod_id: z.number().int().positive().describe("The numeric mod.io mod id."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (1-100). Default 30."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset. Default 0."),
    },
    async ({ game_id, mod_id, limit, offset }) => {
      const list = await modioRequest<
        ModioList<{
          id: number;
          mod_id: number;
          user: { id: number; username: string };
          date_added: number;
          reply_id: number;
          thread_position: string;
          karma: number;
          content: string;
        }>
      >(`/games/${game_id}/mods/${mod_id}/comments`, {
        _limit: limit ?? 30,
        _offset: offset ?? 0,
        _sort: "-date_added",
      });

      const summary = list.data.map((c) => ({
        id: c.id,
        author: c.user?.username,
        date_added: c.date_added,
        thread_position: c.thread_position,
        karma: c.karma,
        content: c.content,
      }));

      return {
        content: [
          {
            type: "text",
            text: `Showing ${list.result_count} of ${list.result_total} comments (offset ${list.result_offset}):\n\n${JSON.stringify(
              summary,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // Tool 13: A single modfile's detail
  server.tool(
    "modio_modfile_detail",
    "Get the detail record for a single modfile (release) of a mod by game id, mod id, and file id. Returns version, filename, filesize, hashes, virus scan status, platforms, download URL, and changelog. Complements modio_mod_files (which lists them).",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      mod_id: z.number().int().positive().describe("The numeric mod.io mod id."),
      file_id: z.number().int().positive().describe("The numeric modfile id."),
    },
    async ({ game_id, mod_id, file_id }) => {
      const file = await modioRequest<Record<string, unknown>>(
        `/games/${game_id}/mods/${mod_id}/files/${file_id}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(file, null, 2) }],
      };
    }
  );

  // Tool 14: A mod's stats
  server.tool(
    "modio_mod_stats",
    "Get the live statistics object for a single mod: popularity rank, download and subscriber totals, and the full ratings breakdown (positive/negative counts, percentage, and weighted aggregate).",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      mod_id: z.number().int().positive().describe("The numeric mod.io mod id."),
    },
    async ({ game_id, mod_id }) => {
      const stats = await modioRequest<Record<string, unknown>>(
        `/games/${game_id}/mods/${mod_id}/stats`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
      };
    }
  );

  // Tool 15: A mod's metadata key-value pairs
  server.tool(
    "modio_mod_metadata_kvp",
    "Get the metadata key-value pairs (KVP) attached to a mod. Authors use these for arbitrary structured data (load order, compatibility flags, custom fields). Returns each metakey and metavalue.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      mod_id: z.number().int().positive().describe("The numeric mod.io mod id."),
    },
    async ({ game_id, mod_id }) => {
      const list = await modioRequest<
        ModioList<{ metakey: string; metavalue: string }>
      >(`/games/${game_id}/mods/${mod_id}/metadatakvp`);
      return {
        content: [
          {
            type: "text",
            text: `${list.result_count} metadata pairs:\n\n${JSON.stringify(list.data, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 16: A mod's tags
  server.tool(
    "modio_mod_tags",
    "List the tags applied to a specific mod (the subset of the game's tag taxonomy the author selected). Returns each tag name and the date it was added.",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      mod_id: z.number().int().positive().describe("The numeric mod.io mod id."),
    },
    async ({ game_id, mod_id }) => {
      const list = await modioRequest<
        ModioList<{ name: string; date_added: number }>
      >(`/games/${game_id}/mods/${mod_id}/tags`);
      return {
        content: [
          {
            type: "text",
            text: `${list.result_count} tags:\n\n${JSON.stringify(list.data, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 17: A mod's event log
  server.tool(
    "modio_mod_events",
    "List the activity events for a mod — the audit log of changes such as file additions, edits, availability changes, and team updates. Returns each event's id, type, actor, and timestamp. Paginated. (modio_mod_dependencies already covers dependency resolution.)",
    {
      game_id: z.number().int().positive().describe("The numeric mod.io game id."),
      mod_id: z.number().int().positive().describe("The numeric mod.io mod id."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results per page (1-100). Default 30."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset. Default 0."),
    },
    async ({ game_id, mod_id, limit, offset }) => {
      const list = await modioRequest<
        ModioList<{
          id: number;
          mod_id: number;
          user_id: number;
          date_added: number;
          event_type: string;
        }>
      >(`/games/${game_id}/mods/${mod_id}/events`, {
        _limit: limit ?? 30,
        _offset: offset ?? 0,
        _sort: "-date_added",
      });

      return {
        content: [
          {
            type: "text",
            text: `Showing ${list.result_count} of ${list.result_total} events (offset ${list.result_offset}):\n\n${JSON.stringify(
              list.data,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  return { toolCount: 17, baseUrl: MODIO_BASE_URL };
}
