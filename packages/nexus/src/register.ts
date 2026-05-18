import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getEnv,
  log,
  McpwrenchError,
  type Credential,
} from "@mcpwrench/core";

/**
 * Register all Nexus Mods tools on the given MCP server. Returns metadata
 * useful for boot logging. Pure registration — no transport, no side effects
 * beyond the server itself.
 *
 * Used by both the standalone @modwrench/nexus bin and the meta-server in
 * @modwrench/cli that bundles multiple platforms into one MCP entry.
 */
export function registerNexusTools(
  server: McpServer,
  credential: Credential
): { toolCount: number; baseUrl: string } {
  const NEXUS_BASE_URL = getEnv(
    "NEXUS_BASE_URL",
    "https://api.nexusmods.com/v1"
  );
  const USER_AGENT = "ModWrench/0.0.1 (+https://mcpwrench.dev)";

  // ─── HTTP helper ────────────────────────────────────────────────────────────

  async function nexusRequest<T>(path: string): Promise<T> {
    const url = `${NEXUS_BASE_URL}${path}`;
    log("debug", "nexus.request", { url });

    const authHeaders: Record<string, string> =
      credential.source === "keychain"
        ? { Authorization: `Bearer ${credential.accessToken}` }
        : { apikey: credential.apiKey };

    const response = await fetch(url, {
      headers: {
        ...authHeaders,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "<no body>");
      throw new McpwrenchError(
        "nexus_http_error",
        `Nexus API returned ${response.status} for ${path}`,
        { status: response.status, meta: { body: body.slice(0, 500) } }
      );
    }

    return (await response.json()) as T;
  }

  // ─── Tools ──────────────────────────────────────────────────────────────────

  // Tool 1: Validate the API key is good
  server.tool(
    "nexus_validate_key",
    "Validate the configured Nexus Mods API key and return the associated user profile. Use this to sanity-check the connection.",
    {},
    async () => {
      const data = await nexusRequest<{
        user_id: number;
        name: string;
        email: string;
        is_premium: boolean;
        is_supporter: boolean;
      }>("/users/validate.json");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                user_id: data.user_id,
                name: data.name,
                is_premium: data.is_premium,
                is_supporter: data.is_supporter,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 2: List all games on Nexus
  server.tool(
    "nexus_list_games",
    "List all games supported on Nexus Mods. Returns each game's domain name (used in other tool calls), display name, and mod counts.",
    {
      include_unapproved: z
        .boolean()
        .optional()
        .describe("Include games still pending approval. Default false."),
    },
    async ({ include_unapproved }) => {
      const flag = include_unapproved ? "true" : "false";
      const games = await nexusRequest<
        Array<{
          id: number;
          name: string;
          domain_name: string;
          mods: number;
          downloads: number;
        }>
      >(`/games.json?include_unapproved=${flag}`);

      const summary = games
        .sort((a, b) => b.mods - a.mods)
        .slice(0, 50)
        .map((g) => ({
          domain: g.domain_name,
          name: g.name,
          mods: g.mods,
          downloads: g.downloads,
        }));

      return {
        content: [
          {
            type: "text",
            text: `Top 50 games by mod count (of ${games.length} total):\n\n${JSON.stringify(
              summary,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // Tool 3: Get details for a single mod
  server.tool(
    "nexus_get_mod",
    "Get full details for a single mod by game domain and mod ID. Returns name, summary, author, version, endorsements, downloads, and more.",
    {
      game_domain: z
        .string()
        .describe("The game's domain name (e.g. 'skyrimspecialedition', 'cyberpunk2077'). Use nexus_list_games to find these."),
      mod_id: z.number().int().positive().describe("The numeric mod ID from the Nexus URL."),
    },
    async ({ game_domain, mod_id }) => {
      const mod = await nexusRequest<Record<string, unknown>>(
        `/games/${game_domain}/mods/${mod_id}.json`
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

  // Tool 4: Latest added mods for a game
  server.tool(
    "nexus_latest_added",
    "Get the most recently added mods for a specific game. Useful for discovering brand-new releases.",
    {
      game_domain: z
        .string()
        .describe("The game's domain name (e.g. 'skyrimspecialedition')."),
    },
    async ({ game_domain }) => {
      const mods = await nexusRequest<
        Array<{
          mod_id: number;
          name: string;
          summary: string;
          author: string;
          version: string;
          endorsement_count: number;
        }>
      >(`/games/${game_domain}/mods/latest_added.json`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(mods, null, 2),
          },
        ],
      };
    }
  );

  // Tool 5: Latest updated mods for a game
  server.tool(
    "nexus_latest_updated",
    "Get the most recently updated mods for a specific game. Useful for seeing what's actively maintained.",
    {
      game_domain: z
        .string()
        .describe("The game's domain name (e.g. 'skyrimspecialedition')."),
    },
    async ({ game_domain }) => {
      const mods = await nexusRequest<
        Array<{
          mod_id: number;
          name: string;
          summary: string;
          version: string;
          endorsement_count: number;
          updated_timestamp: number;
        }>
      >(`/games/${game_domain}/mods/latest_updated.json`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(mods, null, 2),
          },
        ],
      };
    }
  );

  // Tool 6: Trending mods for a game
  server.tool(
    "nexus_trending",
    "Get the trending mods for a specific game right now. This is the 'what's hot' list.",
    {
      game_domain: z
        .string()
        .describe("The game's domain name (e.g. 'skyrimspecialedition')."),
    },
    async ({ game_domain }) => {
      const mods = await nexusRequest<
        Array<{
          mod_id: number;
          name: string;
          summary: string;
          author: string;
          endorsement_count: number;
        }>
      >(`/games/${game_domain}/mods/trending.json`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(mods, null, 2),
          },
        ],
      };
    }
  );

  // Tool 7: List files for a specific mod
  server.tool(
    "nexus_mod_files",
    "List the downloadable files for a specific mod. Useful for seeing version history, file sizes, and file categories.",
    {
      game_domain: z.string().describe("The game's domain name."),
      mod_id: z.number().int().positive().describe("The numeric mod ID."),
    },
    async ({ game_domain, mod_id }) => {
      const data = await nexusRequest<{
        files: Array<{
          file_id: number;
          name: string;
          version: string;
          category_name: string;
          size_kb: number;
          uploaded_timestamp: number;
          description: string;
        }>;
      }>(`/games/${game_domain}/mods/${mod_id}/files.json`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data.files, null, 2),
          },
        ],
      };
    }
  );

  // Tool 8: Get a single game's details
  server.tool(
    "nexus_get_game",
    "Get full details for a single game by domain name. Returns categories, file/mod counts, approval status, and metadata.",
    {
      game_domain: z
        .string()
        .describe("The game's domain name (e.g. 'skyrimspecialedition', 'cyberpunk2077')."),
    },
    async ({ game_domain }) => {
      const game = await nexusRequest<Record<string, unknown>>(
        `/games/${game_domain}.json`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(game, null, 2) }],
      };
    }
  );

  // Tool 9: Get a single mod file's details
  server.tool(
    "nexus_get_file",
    "Get details for a single mod file (version, size, category, description, content_preview_link). Use nexus_mod_files first to discover file IDs.",
    {
      game_domain: z.string().describe("The game's domain name."),
      mod_id: z.number().int().positive().describe("The numeric mod ID."),
      file_id: z.number().int().positive().describe("The numeric file ID."),
    },
    async ({ game_domain, mod_id, file_id }) => {
      const file = await nexusRequest<Record<string, unknown>>(
        `/games/${game_domain}/mods/${mod_id}/files/${file_id}.json`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(file, null, 2) }],
      };
    }
  );

  // Tool 10: Preview a mod file's archive contents
  server.tool(
    "nexus_file_preview",
    "Inspect the archive structure (folders and files) of a mod file without downloading it. Useful for verifying installation paths or potential conflicts before downloading.",
    {
      game_domain: z.string().describe("The game's domain name."),
      mod_id: z.number().int().positive().describe("The numeric mod ID."),
      file_id: z.number().int().positive().describe("The numeric file ID."),
    },
    async ({ game_domain, mod_id, file_id }) => {
      // content_preview is served via a CDN URL stored on the file metadata,
      // not as a direct API endpoint. Fetch the file first to get the link,
      // then follow it (no auth header — it's a public S3-style URL).
      const file = await nexusRequest<{ content_preview_link?: string }>(
        `/games/${game_domain}/mods/${mod_id}/files/${file_id}.json`
      );
      if (!file.content_preview_link) {
        throw new McpwrenchError(
          "nexus_no_preview",
          `No content preview available for file ${file_id} (mod ${mod_id}, ${game_domain}).`
        );
      }
      const previewRes = await fetch(file.content_preview_link, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!previewRes.ok) {
        throw new McpwrenchError(
          "nexus_preview_fetch_error",
          `Failed to fetch content preview (${previewRes.status}).`,
          { status: previewRes.status }
        );
      }
      const tree = await previewRes.json();
      return {
        content: [{ type: "text", text: JSON.stringify(tree, null, 2) }],
      };
    }
  );

  // Tool 11: Get changelogs for a mod
  server.tool(
    "nexus_mod_changelogs",
    "Get the version-by-version changelog map for a mod. Returns an object keyed by version, each value an array of changelog entries.",
    {
      game_domain: z.string().describe("The game's domain name."),
      mod_id: z.number().int().positive().describe("The numeric mod ID."),
    },
    async ({ game_domain, mod_id }) => {
      const changelogs = await nexusRequest<Record<string, string[]>>(
        `/games/${game_domain}/mods/${mod_id}/changelogs.json`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(changelogs, null, 2) }],
      };
    }
  );

  // Tool 12: Reverse-lookup a file by MD5 hash
  server.tool(
    "nexus_md5_search",
    "Reverse-lookup a local file's MD5 hash to find which Nexus mod it belongs to. Returns matching mod + file details. Useful for identifying unknown files in a game install.",
    {
      game_domain: z.string().describe("The game's domain name."),
      md5_hash: z
        .string()
        .regex(/^[a-fA-F0-9]{32}$/, "Must be a 32-character hex MD5 hash")
        .describe("The MD5 hash of the file (32 hex characters)."),
    },
    async ({ game_domain, md5_hash }) => {
      const matches = await nexusRequest<unknown[]>(
        `/games/${game_domain}/mods/md5_search/${md5_hash}.json`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
      };
    }
  );

  return { toolCount: 12, baseUrl: NEXUS_BASE_URL };
}
