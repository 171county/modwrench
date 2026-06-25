import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createHttpClient,
  getEnv,
  log,
  type Credential,
} from "@modwrench/core";

/**
 * Register all CurseForge tools on the given MCP server. Returns metadata
 * useful for boot logging. Pure registration — no transport, no side effects
 * beyond the server itself.
 *
 * Used by both the standalone @modwrench/curseforge bin and the meta-server in
 * @modwrench/cli that bundles multiple platforms into one MCP entry.
 */
export function registerCurseForgeTools(
  server: McpServer,
  credential: Credential
): { toolCount: number; baseUrl: string } {
  const CURSEFORGE_BASE_URL = getEnv(
    "CURSEFORGE_BASE_URL",
    "https://api.curseforge.com"
  );

  // CurseForge wraps every response in a { data } envelope. List endpoints
  // (search, files) add a sibling { pagination } object.
  type CFEnvelope<T> = { data: T };
  type CFPagination = {
    index: number;
    pageSize: number;
    resultCount: number;
    totalCount: number;
  };
  type CFList<T> = { data: T[]; pagination: CFPagination };

  // ─── HTTP helper ────────────────────────────────────────────────────────────
  // Uses the shared @modwrench/core HTTP client for retry/backoff/429 handling
  // /concurrency cap. The CurseForge Core API authenticates with an API key in
  // the `x-api-key` header on every request. The auth-header callback keeps the
  // env-key vs OAuth-Bearer discriminator in this package (where the credential
  // type lives), while the client handles transport-level concerns.

  const httpClient = createHttpClient({
    baseUrl: CURSEFORGE_BASE_URL,
    userAgent: "ModWrench/0.0.1 (+https://github.com/171county/modwrench)",
    errorCodePrefix: "curseforge",
    defaultHeaders: { Accept: "application/json" },
    authHeaders: (): Record<string, string> => {
      // CurseForge issues long-lived API keys (no OAuth flow). The standard
      // path is an env key sent as x-api-key. We still honor a keychain token
      // for forward-compat with the shared Credential union.
      if (credential.source === "keychain") {
        return { Authorization: `Bearer ${credential.accessToken}` };
      }
      return { "x-api-key": credential.apiKey };
    },
  });

  async function cfRequest<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>
  ): Promise<T> {
    log("debug", "curseforge.request", { path });
    return httpClient.request<T>(path, { query });
  }

  async function cfPost<T>(path: string, body: unknown): Promise<T> {
    log("debug", "curseforge.request", { path, method: "POST" });
    return httpClient.request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ─── Tools ──────────────────────────────────────────────────────────────────

  // Tool 1: List games on CurseForge
  server.tool(
    "curseforge_list_games",
    "List the games supported on CurseForge. Returns each game's numeric id (used in other tool calls), name, and slug. Paginated.",
    {
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Zero-based index of the first item to return. Default 0."),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of items to return (1-50). Default 50."),
    },
    async ({ index, page_size }) => {
      const list = await cfRequest<
        CFList<{
          id: number;
          name: string;
          slug: string;
          dateModified: string;
          status: number;
        }>
      >("/v1/games", { index: index ?? 0, pageSize: page_size ?? 50 });

      const summary = list.data.map((g) => ({
        id: g.id,
        slug: g.slug,
        name: g.name,
        status: g.status,
      }));

      return {
        content: [
          {
            type: "text",
            text: `Showing ${list.pagination.resultCount} of ${list.pagination.totalCount} games:\n\n${JSON.stringify(
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
    "curseforge_get_game",
    "Get full details for a single game by its numeric CurseForge id. Use curseforge_list_games to discover ids.",
    {
      game_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge game id."),
    },
    async ({ game_id }) => {
      const game = await cfRequest<CFEnvelope<Record<string, unknown>>>(
        `/v1/games/${game_id}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(game.data, null, 2) }],
      };
    }
  );

  // Tool 3: List categories (and classes) for a game
  server.tool(
    "curseforge_list_categories",
    "List the classes and categories for a game. Pass a game id for all categories, optionally narrow to a single class, or set classes_only to return just the top-level classes (e.g. 'Mods', 'Modpacks', 'Resource Packs'). Category ids feed curseforge_search_mods.",
    {
      game_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge game id."),
      class_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional class id to list categories under that class."),
      classes_only: z
        .boolean()
        .optional()
        .describe("If true (with game_id), return only the top-level classes."),
    },
    async ({ game_id, class_id, classes_only }) => {
      const list = await cfRequest<
        CFEnvelope<
          Array<{
            id: number;
            gameId: number;
            name: string;
            slug: string;
            isClass: boolean;
            classId: number | null;
            parentCategoryId: number | null;
          }>
        >
      >("/v1/categories", {
        gameId: game_id,
        classId: class_id,
        classesOnly: classes_only,
      });

      const summary = list.data.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        isClass: c.isClass,
        classId: c.classId,
        parentCategoryId: c.parentCategoryId,
      }));

      return {
        content: [
          {
            type: "text",
            text: `${summary.length} categories:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 4: Search mods
  server.tool(
    "curseforge_search_mods",
    "Search for mods (projects) on CurseForge by free text, scoped to a game. Optionally filter by class, category, game version, mod loader, slug, and author, and sort the results. Returns id, name, slug, summary, download count, and links. Paginated.",
    {
      game_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge game id (required)."),
      search_filter: z
        .string()
        .optional()
        .describe("Free-text search matched against mod name and author."),
      class_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Filter by class id (e.g. the 'Mods' class). Discover via curseforge_list_categories."),
      category_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Filter by a single category id."),
      game_version: z
        .string()
        .optional()
        .describe("Filter by a game version string (e.g. '1.20.1')."),
      mod_loader_type: z
        .enum(["Any", "Forge", "Cauldron", "LiteLoader", "Fabric", "Quilt", "NeoForge"])
        .optional()
        .describe("Filter by mod loader. Must be coupled with game_version."),
      slug: z
        .string()
        .optional()
        .describe("Filter by slug (coupled with class_id yields a unique result)."),
      sort_field: z
        .enum([
          "Featured",
          "Popularity",
          "LastUpdated",
          "Name",
          "Author",
          "TotalDownloads",
          "Category",
          "GameVersion",
        ])
        .optional()
        .describe("Field to sort by."),
      sort_order: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction. 'asc' or 'desc'."),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Zero-based index of the first item. (index + page_size must be <= 10,000.)"),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of items to return (1-50). Default 25."),
    },
    async ({
      game_id,
      search_filter,
      class_id,
      category_id,
      game_version,
      mod_loader_type,
      slug,
      sort_field,
      sort_order,
      index,
      page_size,
    }) => {
      // CurseForge encodes ModsSearchSortField and ModLoaderType as integers.
      const SORT_FIELDS: Record<string, number> = {
        Featured: 1,
        Popularity: 2,
        LastUpdated: 3,
        Name: 4,
        Author: 5,
        TotalDownloads: 6,
        Category: 7,
        GameVersion: 8,
      };
      const MOD_LOADERS: Record<string, number> = {
        Any: 0,
        Forge: 1,
        Cauldron: 2,
        LiteLoader: 3,
        Fabric: 4,
        Quilt: 5,
        NeoForge: 6,
      };

      const list = await cfRequest<
        CFList<{
          id: number;
          name: string;
          slug: string;
          summary: string;
          downloadCount: number;
          classId: number | null;
          primaryCategoryId: number;
          links: Record<string, string>;
        }>
      >("/v1/mods/search", {
        gameId: game_id,
        searchFilter: search_filter,
        classId: class_id,
        categoryId: category_id,
        gameVersion: game_version,
        modLoaderType:
          mod_loader_type !== undefined ? MOD_LOADERS[mod_loader_type] : undefined,
        slug,
        sortField:
          sort_field !== undefined ? SORT_FIELDS[sort_field] : undefined,
        sortOrder: sort_order,
        index: index ?? 0,
        pageSize: page_size ?? 25,
      });

      const summary = list.data.map((m) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        downloads: m.downloadCount,
        classId: m.classId,
        summary: m.summary,
        url: m.links?.websiteUrl,
      }));

      return {
        content: [
          {
            type: "text",
            text: `Showing ${list.pagination.resultCount} of ${list.pagination.totalCount} matching mods:\n\n${JSON.stringify(
              summary,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // Tool 5: Get a single mod
  server.tool(
    "curseforge_get_mod",
    "Get full details for a single mod (project) by its numeric CurseForge id. Returns name, slug, summary, status, download count, categories, authors, the latest files, and links.",
    {
      mod_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge mod (project) id."),
    },
    async ({ mod_id }) => {
      const mod = await cfRequest<CFEnvelope<Record<string, unknown>>>(
        `/v1/mods/${mod_id}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(mod.data, null, 2) }],
      };
    }
  );

  // Tool 6: Get a mod's HTML description
  server.tool(
    "curseforge_get_mod_description",
    "Get the rendered HTML description (long-form body) for a single mod by id. Complements curseforge_get_mod, which returns only the short summary.",
    {
      mod_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge mod (project) id."),
    },
    async ({ mod_id }) => {
      const res = await cfRequest<CFEnvelope<string>>(
        `/v1/mods/${mod_id}/description`
      );
      return {
        content: [{ type: "text", text: res.data }],
      };
    }
  );

  // Tool 7: List a mod's files
  server.tool(
    "curseforge_list_mod_files",
    "List the downloadable files (releases) for a mod. Supports filtering by game version and mod loader, plus pagination. Returns each file's id, name, release type, size, game versions, and download url.",
    {
      mod_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge mod (project) id."),
      game_version: z
        .string()
        .optional()
        .describe("Filter files by a game version string (e.g. '1.20.1')."),
      mod_loader_type: z
        .enum(["Any", "Forge", "Cauldron", "LiteLoader", "Fabric", "Quilt", "NeoForge"])
        .optional()
        .describe("Filter files by mod loader."),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Zero-based index of the first item. Default 0."),
      page_size: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of items to return (1-50). Default 50."),
    },
    async ({ mod_id, game_version, mod_loader_type, index, page_size }) => {
      const MOD_LOADERS: Record<string, number> = {
        Any: 0,
        Forge: 1,
        Cauldron: 2,
        LiteLoader: 3,
        Fabric: 4,
        Quilt: 5,
        NeoForge: 6,
      };

      const list = await cfRequest<
        CFList<{
          id: number;
          modId: number;
          displayName: string;
          fileName: string;
          releaseType: number;
          fileLength: number;
          fileDate: string;
          gameVersions: string[];
          downloadUrl: string | null;
        }>
      >(`/v1/mods/${mod_id}/files`, {
        gameVersion: game_version,
        modLoaderType:
          mod_loader_type !== undefined ? MOD_LOADERS[mod_loader_type] : undefined,
        index: index ?? 0,
        pageSize: page_size ?? 50,
      });

      return {
        content: [
          {
            type: "text",
            text: `Showing ${list.pagination.resultCount} of ${list.pagination.totalCount} files:\n\n${JSON.stringify(
              list.data,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // Tool 8: Get a single mod file
  server.tool(
    "curseforge_get_mod_file",
    "Get details for a single mod file by mod id and file id. Returns display name, file name, release type, hashes, size, game versions, dependencies, and download url. Use curseforge_list_mod_files first to discover file ids.",
    {
      mod_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge mod (project) id."),
      file_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge file id."),
    },
    async ({ mod_id, file_id }) => {
      const file = await cfRequest<CFEnvelope<Record<string, unknown>>>(
        `/v1/mods/${mod_id}/files/${file_id}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(file.data, null, 2) }],
      };
    }
  );

  // Tool 9: Get a file's changelog
  server.tool(
    "curseforge_get_file_changelog",
    "Get the rendered HTML changelog for a specific mod file by mod id and file id. Useful for seeing what changed in a given release without downloading it.",
    {
      mod_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge mod (project) id."),
      file_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge file id."),
    },
    async ({ mod_id, file_id }) => {
      const res = await cfRequest<CFEnvelope<string>>(
        `/v1/mods/${mod_id}/files/${file_id}/changelog`
      );
      return {
        content: [{ type: "text", text: res.data }],
      };
    }
  );

  // Tool 10: Featured / popular / recently updated mods for a game
  server.tool(
    "curseforge_featured_mods",
    "Get the featured, popular, and recently updated mods for a game. CurseForge returns three curated buckets in one call — the platform's 'what's hot' view. Optionally scope to a game version type and exclude specific mod ids.",
    {
      game_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric CurseForge game id (required)."),
      excluded_mod_ids: z
        .array(z.number().int().positive())
        .optional()
        .describe("Mod ids to exclude from the featured buckets."),
      game_version_type_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional gameVersionTypeId to scope featured results."),
    },
    async ({ game_id, excluded_mod_ids, game_version_type_id }) => {
      const res = await cfPost<
        CFEnvelope<{
          featured: Array<Record<string, unknown>>;
          popular: Array<Record<string, unknown>>;
          recentlyUpdated: Array<Record<string, unknown>>;
        }>
      >("/v1/mods/featured", {
        gameId: game_id,
        excludedModIds: excluded_mod_ids ?? [],
        gameVersionTypeId: game_version_type_id ?? null,
      });

      const slim = (rows: Array<Record<string, unknown>>) =>
        rows.map((m) => ({
          id: m.id,
          name: m.name,
          slug: m.slug,
          downloads: m.downloadCount,
          summary: m.summary,
        }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                featured: slim(res.data.featured ?? []),
                popular: slim(res.data.popular ?? []),
                recentlyUpdated: slim(res.data.recentlyUpdated ?? []),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return { toolCount: 10, baseUrl: CURSEFORGE_BASE_URL };
}
