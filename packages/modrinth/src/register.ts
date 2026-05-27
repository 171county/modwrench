import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHttpClient, getEnv, log } from "@mcpwrench/core";

/**
 * Register all Modrinth tools on the given MCP server.
 *
 * Modrinth is the open-source Minecraft modding platform — 75% of ad revenue
 * to creators, REST API with no auth required for reads, strongest cultural
 * goodwill in the modding ecosystem. Same registration shape as
 * @modwrench/thunderstore: anonymous public API, registers as a 'local' kind
 * in the meta-server (always loaded, no credential resolution).
 *
 * When v3 write/publishing support lands, this will be refactored to accept
 * an OAuth token. For now: read-only, no creds, no env required.
 */
export function registerModrinthTools(server: McpServer): {
  toolCount: number;
  baseUrl: string;
} {
  const BASE_URL = getEnv("MODRINTH_BASE_URL", "https://api.modrinth.com");

  // Modrinth's terms of service ask consumers to send a meaningful
  // User-Agent including a contact URL. The MCPwrench convention satisfies
  // that ("ModWrench/<version> (+https://mcpwrench.dev)").
  const httpClient = createHttpClient({
    baseUrl: BASE_URL,
    userAgent: "ModWrench/0.0.1 (+https://mcpwrench.dev)",
    errorCodePrefix: "modrinth",
  });

  async function modrinthRequest<T>(
    path: string,
    query?: Record<string, string | number | undefined>
  ): Promise<T> {
    log("debug", "modrinth.request", { path });
    return httpClient.request<T>(path, query ? { query } : undefined);
  }

  // ─── Tools ────────────────────────────────────────────────────────────────

  // Tool 1: search across the Modrinth catalog
  server.tool(
    "modrinth_search",
    "Full-text search across Modrinth's project catalog (mods, modpacks, plugins, datapacks, resourcepacks, shaders). Supports facets for game_versions, loaders, categories, and project_type. Returns hits with title, description, downloads, latest version, and license.",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Search text. Matches against project title, description, and slug."
        ),
      project_type: z
        .enum([
          "mod",
          "modpack",
          "plugin",
          "datapack",
          "resourcepack",
          "shader",
        ])
        .optional()
        .describe("Filter to a single project type. Default: any."),
      loader: z
        .string()
        .optional()
        .describe(
          "Loader to filter by (e.g. 'fabric', 'forge', 'neoforge', 'quilt'). Use modrinth_list_loaders to discover."
        ),
      game_version: z
        .string()
        .optional()
        .describe("Minecraft version filter (e.g. '1.20.1', '1.21')."),
      category: z
        .string()
        .optional()
        .describe("Category filter (e.g. 'optimization', 'magic')."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max hits per page (1-100). Default 20."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset. Default 0."),
    },
    async ({
      query,
      project_type,
      loader,
      game_version,
      category,
      limit,
      offset,
    }) => {
      // Modrinth's facets parameter is a JSON-encoded nested array. Each inner
      // array is an OR group, and the outer array is an AND. So filtering to
      // (mod AND fabric AND 1.20.1) means three single-element OR groups.
      const facets: string[][] = [];
      if (project_type) facets.push([`project_type:${project_type}`]);
      if (loader) facets.push([`categories:${loader}`]);
      if (game_version) facets.push([`versions:${game_version}`]);
      if (category) facets.push([`categories:${category}`]);

      type SearchHit = {
        project_id: string;
        slug: string;
        author: string;
        title: string;
        description: string;
        categories?: string[];
        downloads: number;
        follows: number;
        latest_version?: string;
        project_type: string;
        license?: string;
        date_created?: string;
        date_modified?: string;
      };
      type SearchResponse = {
        hits: SearchHit[];
        offset: number;
        limit: number;
        total_hits: number;
      };

      const data = await modrinthRequest<SearchResponse>("/v2/search", {
        ...(query ? { query } : {}),
        ...(facets.length > 0 ? { facets: JSON.stringify(facets) } : {}),
        limit: limit ?? 20,
        offset: offset ?? 0,
      });

      const summary = data.hits.map((h) => ({
        id: h.project_id,
        slug: h.slug,
        title: h.title,
        author: h.author,
        type: h.project_type,
        downloads: h.downloads,
        follows: h.follows,
        latest_version: h.latest_version,
        license: h.license,
        last_updated: h.date_modified,
        description: h.description,
        page_url: `https://modrinth.com/${h.project_type}/${h.slug}`,
      }));

      return {
        content: [
          {
            type: "text",
            text: `Showing ${data.hits.length} of ${data.total_hits} matches (offset ${data.offset}):\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 2: get a single project's full details
  server.tool(
    "modrinth_get_project",
    "Get full details for a single Modrinth project (mod, modpack, plugin, etc.) by ID or slug. Returns title, description, body (markdown), downloads, version list, supported loaders, supported Minecraft versions, license, links, and gallery.",
    {
      id_or_slug: z
        .string()
        .describe(
          "Project ID (e.g. 'AANobbMI') or slug (e.g. 'sodium'). Slug is usually easier — it's the readable name in the project's URL."
        ),
    },
    async ({ id_or_slug }) => {
      const project = await modrinthRequest<Record<string, unknown>>(
        `/v2/project/${id_or_slug}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
      };
    }
  );

  // Tool 3: list a project's versions
  server.tool(
    "modrinth_get_versions",
    "List the versions of a project, newest first. Each version includes version_number, name, file URLs, supported loaders, supported game_versions, downloads, and dependencies. Optionally filter by loader or game version.",
    {
      id_or_slug: z.string().describe("Project ID or slug."),
      loaders: z
        .array(z.string())
        .optional()
        .describe(
          "Filter to versions that support specific loaders (e.g. ['fabric'], ['forge','neoforge'])."
        ),
      game_versions: z
        .array(z.string())
        .optional()
        .describe(
          "Filter to versions supporting specific Minecraft versions (e.g. ['1.20.1'])."
        ),
      featured: z
        .boolean()
        .optional()
        .describe(
          "If true, return only featured versions (curated by the author)."
        ),
    },
    async ({ id_or_slug, loaders, game_versions, featured }) => {
      const query: Record<string, string | undefined> = {};
      if (loaders && loaders.length > 0) {
        query["loaders"] = JSON.stringify(loaders);
      }
      if (game_versions && game_versions.length > 0) {
        query["game_versions"] = JSON.stringify(game_versions);
      }
      if (featured !== undefined) {
        query["featured"] = featured ? "true" : "false";
      }

      type Version = {
        id: string;
        project_id: string;
        name: string;
        version_number: string;
        version_type: string;
        loaders: string[];
        game_versions: string[];
        downloads: number;
        date_published: string;
        files: Array<{ url: string; filename: string; size: number; primary: boolean }>;
        dependencies: unknown[];
      };
      const versions = await modrinthRequest<Version[]>(
        `/v2/project/${id_or_slug}/version`,
        query
      );

      const summary = versions.map((v) => ({
        version: v.version_number,
        name: v.name,
        type: v.version_type,
        loaders: v.loaders,
        game_versions: v.game_versions,
        downloads: v.downloads,
        date: v.date_published,
        primary_file: v.files?.find((f) => f.primary)?.filename ?? v.files?.[0]?.filename,
        deps: v.dependencies?.length ?? 0,
      }));

      return {
        content: [
          {
            type: "text",
            text: `${summary.length} versions of ${id_or_slug}:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 4: get a single version's details
  server.tool(
    "modrinth_get_version",
    "Get full details for a single version by ID. Returns file URLs (primary + secondary), checksums, dependencies (with their version IDs), supported loaders/game-versions, changelog, and release date.",
    {
      version_id: z
        .string()
        .describe("Version ID (use modrinth_get_versions to discover)."),
    },
    async ({ version_id }) => {
      const version = await modrinthRequest<Record<string, unknown>>(
        `/v2/version/${version_id}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(version, null, 2) }],
      };
    }
  );

  // Tool 5: list all categories
  server.tool(
    "modrinth_list_categories",
    "List all category tags Modrinth supports. Each entry has a name, icon, applicable project types, and a header (the section it appears under in the search UI). Use category names with modrinth_search's category filter.",
    {},
    async () => {
      type Category = {
        icon: string;
        name: string;
        project_type: string;
        header: string;
      };
      const cats = await modrinthRequest<Category[]>("/v2/tag/category");
      const summary = cats.map((c) => ({
        name: c.name,
        project_type: c.project_type,
        header: c.header,
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

  // Tool 6: list all loaders
  server.tool(
    "modrinth_list_loaders",
    "List all mod loaders Modrinth recognizes — Fabric, Forge, NeoForge, Quilt, Bukkit, Paper, plus modpack/datapack/shader-specific loaders. Use loader names with modrinth_search's loader filter.",
    {},
    async () => {
      type Loader = {
        icon: string;
        name: string;
        supported_project_types: string[];
      };
      const loaders = await modrinthRequest<Loader[]>("/v2/tag/loader");
      const summary = loaders.map((l) => ({
        name: l.name,
        supported_project_types: l.supported_project_types,
      }));
      return {
        content: [
          {
            type: "text",
            text: `${summary.length} loaders:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 7: list all Minecraft game versions
  server.tool(
    "modrinth_list_game_versions",
    "List every Minecraft version Modrinth indexes, newest first. Each entry has version, version_type (release / snapshot / alpha / beta), and date. Use version strings with modrinth_search's game_version filter or modrinth_get_versions' game_versions filter.",
    {
      release_only: z
        .boolean()
        .optional()
        .describe(
          "If true, drop snapshots/alphas/betas — return only release versions. Default false."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results to return (1-100). Default 30."),
    },
    async ({ release_only, limit }) => {
      type GameVersion = {
        version: string;
        version_type: "release" | "snapshot" | "alpha" | "beta";
        date: string;
        major: boolean;
      };
      let versions = await modrinthRequest<GameVersion[]>(
        "/v2/tag/game_version"
      );
      if (release_only) {
        versions = versions.filter((v) => v.version_type === "release");
      }
      const cap = limit ?? 30;
      const summary = versions.slice(0, cap).map((v) => ({
        version: v.version,
        type: v.version_type,
        date: v.date,
        major: v.major,
      }));
      return {
        content: [
          {
            type: "text",
            text: `Showing ${summary.length} of ${versions.length} game versions:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  return { toolCount: 7, baseUrl: BASE_URL };
}
