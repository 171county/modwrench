import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getEnv, log, McpwrenchError } from "@mcpwrench/core";

/**
 * Register all Thunderstore tools on the given MCP server.
 *
 * Unlike @modwrench/nexus and @modwrench/modio, Thunderstore's public read
 * API requires no authentication — anyone can hit the endpoints anonymously.
 * That means this package registers without a Credential argument and the
 * @modwrench/cli meta-server treats it like the workbench: always loaded.
 *
 * When v3 write support lands, this will be refactored to support OAuth
 * tokens for publishing. For now: read-only, no creds, no env required.
 */
export function registerThunderstoreTools(server: McpServer): {
  toolCount: number;
  baseUrl: string;
} {
  const BASE_URL = getEnv("THUNDERSTORE_BASE_URL", "https://thunderstore.io");
  const USER_AGENT = "ModWrench/0.0.1 (+https://mcpwrench.dev)";

  async function thunderstoreRequest<T>(path: string): Promise<T> {
    const url = `${BASE_URL}${path}`;
    log("debug", "thunderstore.request", { url });

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "<no body>");
      throw new McpwrenchError(
        "thunderstore_http_error",
        `Thunderstore API returned ${response.status} for ${path}`,
        { status: response.status, meta: { body: body.slice(0, 500) } }
      );
    }
    return (await response.json()) as T;
  }

  // ─── Tools ──────────────────────────────────────────────────────────────────

  // Tool 1: list all communities (the Thunderstore name for "game")
  server.tool(
    "thunderstore_list_communities",
    "List all communities (games) supported on Thunderstore — Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS, and many more. Returns each community's identifier (slug used in other tool calls) and display name.",
    {},
    async () => {
      interface Community {
        identifier: string;
        name: string;
        discord_url?: string | null;
        wiki_url?: string | null;
      }
      interface ListResponse {
        pagination: {
          next_link: string | null;
          previous_link: string | null;
        };
        results: Community[];
      }

      // Thunderstore returns ~100 communities per page with a cursor-based
      // pagination.next_link field. We walk every page (typically <5 total).
      const all: Community[] = [];
      let cursor: string | null = "/api/experimental/community/?page=1";
      const MAX_PAGES = 20;
      for (let i = 0; i < MAX_PAGES; i++) {
        if (cursor === null) break;
        const data: ListResponse =
          await thunderstoreRequest<ListResponse>(cursor);
        all.push(...data.results);
        const nextLink: string | null = data.pagination?.next_link ?? null;
        if (nextLink !== null && nextLink.length > 0) {
          const parsed = new URL(nextLink);
          cursor = parsed.pathname + parsed.search;
        } else {
          cursor = null;
        }
      }

      const summary = all.map((c) => ({
        identifier: c.identifier,
        name: c.name,
      }));

      return {
        content: [
          {
            type: "text",
            text: `${summary.length} communities on Thunderstore:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 2: get details for one community
  server.tool(
    "thunderstore_get_community",
    "Get details for a single Thunderstore community (game) by its identifier. Returns name, links (Discord, wiki), and metadata flags. Thunderstore has no single-community detail endpoint — this walks the paginated list and early-exits on match, so cost grows with how late in the list the target is.",
    {
      identifier: z
        .string()
        .describe(
          "Community identifier (slug) — e.g. 'lethal-company', 'valheim', 'risk-of-rain-2'. Use thunderstore_list_communities to discover these."
        ),
    },
    async ({ identifier }) => {
      interface Community {
        identifier: string;
        name: string;
        discord_url?: string | null;
        wiki_url?: string | null;
        require_package_listing_approval?: boolean;
      }
      interface ListResponse {
        pagination: { next_link: string | null; previous_link: string | null };
        results: Community[];
      }

      let cursor: string | null = "/api/experimental/community/?page=1";
      const MAX_PAGES = 20;
      for (let i = 0; i < MAX_PAGES; i++) {
        if (cursor === null) break;
        const data: ListResponse =
          await thunderstoreRequest<ListResponse>(cursor);
        const found = data.results.find((c) => c.identifier === identifier);
        if (found) {
          return {
            content: [
              { type: "text", text: JSON.stringify(found, null, 2) },
            ],
          };
        }
        const nextLink: string | null = data.pagination?.next_link ?? null;
        if (nextLink !== null && nextLink.length > 0) {
          const parsed = new URL(nextLink);
          cursor = parsed.pathname + parsed.search;
        } else {
          cursor = null;
        }
      }

      throw new McpwrenchError(
        "thunderstore_community_not_found",
        `Community "${identifier}" not found. Use thunderstore_list_communities to see all available identifiers.`
      );
    }
  );

  // Tool 3: list mods in a community (paginated, summary view)
  server.tool(
    "thunderstore_list_mods",
    "List mods in a specific Thunderstore community. Returns a summary view per mod (name, author, rating, downloads, latest version). Paginated server-side; default page size is whatever the community returns.",
    {
      community: z
        .string()
        .describe("Community identifier (e.g. 'lethal-company')."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results to return (1-100). Default 30."),
    },
    async ({ community, limit }) => {
      type ModVersion = {
        version_number: string;
        downloads: number;
        date_created: string;
      };
      type Mod = {
        name: string;
        full_name: string;
        owner: string;
        package_url: string;
        rating_score: number;
        is_pinned: boolean;
        is_deprecated: boolean;
        categories: string[];
        versions: ModVersion[];
      };

      // The c/<community>/api/v1/package/ endpoint returns the full list for
      // a community in one shot (no pagination at this endpoint). We slice
      // server-side and return a summary.
      const mods = await thunderstoreRequest<Mod[]>(
        `/c/${community}/api/v1/package/`
      );

      const cap = limit ?? 30;
      const summary = mods.slice(0, cap).map((m) => ({
        name: m.name,
        full_name: m.full_name,
        author: m.owner,
        rating: m.rating_score,
        latest_version: m.versions?.[0]?.version_number,
        total_downloads: (m.versions ?? []).reduce(
          (sum, v) => sum + (v.downloads ?? 0),
          0
        ),
        pinned: m.is_pinned,
        deprecated: m.is_deprecated,
        categories: m.categories,
        page_url: m.package_url,
      }));

      return {
        content: [
          {
            type: "text",
            text: `Showing ${summary.length} of ${mods.length} mods in ${community}:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 4: get full details for one mod
  server.tool(
    "thunderstore_get_mod",
    "Get full details for a single mod by namespace (author) + name. Returns the latest version, total downloads, rating, community_listings (which games the mod is published in), and metadata. Thunderstore mods are identified globally by namespace+name — no community arg is needed at this endpoint.",
    {
      namespace: z
        .string()
        .describe(
          "Mod author/namespace — the part before the dash in a Thunderstore mod's full_name (e.g. 'BepInEx' for 'BepInEx-BepInExPack')."
        ),
      name: z
        .string()
        .describe("Mod name — the part after the dash in full_name."),
    },
    async ({ namespace, name }) => {
      const mod = await thunderstoreRequest<Record<string, unknown>>(
        `/api/experimental/package/${namespace}/${name}/`
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

  // Tool 5: search mods by name within a community
  server.tool(
    "thunderstore_search_mods",
    "Search mods in a Thunderstore community by name substring. Case-insensitive. Returns a summary view per match.",
    {
      community: z.string().describe("Community identifier."),
      query: z
        .string()
        .min(1)
        .describe("Substring to match against mod name (case-insensitive)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results (1-50). Default 20."),
    },
    async ({ community, query, limit }) => {
      type Mod = {
        name: string;
        full_name: string;
        owner: string;
        package_url: string;
        rating_score: number;
        versions: Array<{ version_number: string; downloads: number }>;
      };
      const mods = await thunderstoreRequest<Mod[]>(
        `/c/${community}/api/v1/package/`
      );
      const q = query.toLowerCase();
      const matched = mods.filter((m) => m.name.toLowerCase().includes(q));
      const cap = limit ?? 20;
      const summary = matched.slice(0, cap).map((m) => ({
        name: m.name,
        full_name: m.full_name,
        author: m.owner,
        rating: m.rating_score,
        latest_version: m.versions?.[0]?.version_number,
        page_url: m.package_url,
      }));
      return {
        content: [
          {
            type: "text",
            text: `Matched ${matched.length} mods (showing ${summary.length}):\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 6: list a mod's version history
  server.tool(
    "thunderstore_mod_versions",
    "List the full version history of a specific mod. Each entry includes version number, download count, file size, dependencies, and release date. Newest first. Version history is only available via the community listing endpoint, so a community must be specified — pick any community the mod is published in (use thunderstore_get_mod's community_listings field to discover).",
    {
      community: z
        .string()
        .describe(
          "Community identifier (e.g. 'lethal-company'). Any community where the mod is listed; the version history is identical across communities."
        ),
      namespace: z.string().describe("Mod author/namespace."),
      name: z.string().describe("Mod name."),
    },
    async ({ community, namespace, name }) => {
      type Version = {
        name: string;
        version_number: string;
        description: string;
        download_url: string;
        downloads: number;
        date_created: string;
        file_size: number;
        dependencies: string[];
      };
      type Mod = { full_name: string; versions: Version[] };
      const mods = await thunderstoreRequest<Mod[]>(
        `/c/${community}/api/v1/package/`
      );
      const fullName = `${namespace}-${name}`;
      const mod = mods.find((m) => m.full_name === fullName);
      if (!mod) {
        throw new McpwrenchError(
          "thunderstore_mod_not_found",
          `Mod ${fullName} not found in community ${community}. Try thunderstore_get_mod first to confirm which communities list this mod.`
        );
      }
      const summary = (mod.versions ?? []).map((v) => ({
        version: v.version_number,
        downloads: v.downloads,
        file_size_kb: Math.round((v.file_size ?? 0) / 1024),
        date: v.date_created,
        deps: v.dependencies?.length ?? 0,
      }));
      return {
        content: [
          {
            type: "text",
            text: `${summary.length} versions of ${fullName}:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      };
    }
  );

  // Tool 7: top mods (by rating) in a community
  server.tool(
    "thunderstore_top_mods",
    "Get the highest-rated mods in a Thunderstore community. Sorted by rating_score descending. Use this for 'what's popular' style queries.",
    {
      community: z.string().describe("Community identifier."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of top mods to return (1-50). Default 10."),
    },
    async ({ community, limit }) => {
      type Mod = {
        name: string;
        full_name: string;
        owner: string;
        package_url: string;
        rating_score: number;
        versions: Array<{ version_number: string; downloads: number }>;
      };
      const mods = await thunderstoreRequest<Mod[]>(
        `/c/${community}/api/v1/package/`
      );
      const cap = limit ?? 10;
      const ranked = [...mods]
        .sort((a, b) => (b.rating_score ?? 0) - (a.rating_score ?? 0))
        .slice(0, cap)
        .map((m, i) => ({
          rank: i + 1,
          name: m.name,
          full_name: m.full_name,
          author: m.owner,
          rating: m.rating_score,
          latest_version: m.versions?.[0]?.version_number,
          page_url: m.package_url,
        }));
      return {
        content: [
          {
            type: "text",
            text: `Top ${ranked.length} mods in ${community} by rating:\n\n${JSON.stringify(ranked, null, 2)}`,
          },
        ],
      };
    }
  );

  return { toolCount: 7, baseUrl: BASE_URL };
}
