import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  appIdentity,
  createHttpClient,
  getEnv,
  log,
  ModWrenchError,
  type Credential,
} from "@modwrench/core";
import { applyAdultPolicy } from "./adult.js";

/**
 * Register all Nexus Mods tools on the given MCP server. Returns metadata
 * useful for boot logging. Pure registration — no transport, no side effects
 * beyond the server itself.
 *
 * Used by both the standalone @modwrench/nexus bin and the meta-server in
 * @modwrench/cli that bundles multiple platforms into one MCP entry.
 */
import { renderShell, createUIResource, type ModCard } from "@modwrench/ui";

const APP = appIdentity(import.meta.url);

type NexusRow = {
  mod_id: number;
  name: string;
  summary?: string;
  author?: string;
  version?: string;
  endorsement_count?: number;
  downloads?: number;
};

/** Nexus discovery lists -> a Skyrim-skinned mods ui:// resource (Nexus is
 * Bethesda-dominant, so the SkyUI/MO2 look is the natural fit). */
function nexusModsUI(query: string, domain: string, rows: NexusRow[]) {
  const mods: ModCard[] = rows.map((r) => ({
    name: r.name,
    author: r.author ?? "unknown",
    platform: "nexus",
    version: r.version,
    downloads: r.downloads,
    endorsements: r.endorsement_count,
    summary: r.summary,
    pageUrl: `https://www.nexusmods.com/${domain}/mods/${r.mod_id}`,
  }));
  return createUIResource({
    uri: "ui://modwrench/mods",
    html: renderShell({ theme: "skyrim", view: "mods", mods: { query, mods } }),
    meta: { "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"] },
  });
}

export function registerNexusTools(
  server: McpServer,
  credential: Credential
): { toolCount: number; baseUrl: string } {
  const NEXUS_BASE_URL = getEnv(
    "NEXUS_BASE_URL",
    "https://api.nexusmods.com/v1"
  );

  // ─── HTTP helper ────────────────────────────────────────────────────────────
  // Uses the shared @modwrench/core HTTP client for retry/backoff/429 handling
  // /concurrency cap. The auth-header callback keeps the Bearer-vs-apikey
  // discriminator in this package (where the credential type lives), while the
  // client handles transport-level concerns.

  // Nexus's API Acceptable Use Policy asks every application to identify
  // itself with Application-Name and Application-Version headers so traffic
  // can be attributed to the app rather than to the individual whose key is
  // in use. Sending blank or impersonating metadata is explicitly listed as
  // unacceptable, so these are not optional.
  //
  // The version is read from this package's own manifest rather than
  
  
  const httpClient = createHttpClient({
    baseUrl: NEXUS_BASE_URL,
    userAgent: APP.userAgent,
    defaultHeaders: {
      ...APP.headers,
    },
    errorCodePrefix: "nexus",
    authHeaders: (): Record<string, string> => {
      if (credential.source === "keychain") {
        return { Authorization: `Bearer ${credential.accessToken}` };
      }
      return { apikey: credential.apiKey };
    },
  });

  async function nexusRequest<T>(path: string): Promise<T> {
    log("debug", "nexus.request", { path });
    const result = await httpClient.request<T>(path);
    return applyAdultPolicy(result, path);
  }

  // GraphQL lives on a separate v2 endpoint (the v1 REST API has no full-text
  // mod search). We POST through the same shared client so retry/backoff/429
  // handling and the apikey/Bearer auth header still apply — buildUrl passes
  // absolute URLs through untouched.
  const NEXUS_GRAPHQL_URL = getEnv(
    "NEXUS_GRAPHQL_URL",
    "https://api.nexusmods.com/v2/graphql"
  );

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
          nexusModsUI(`Trending \u00b7 ${game_domain}`, game_domain, mods),
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
        throw new ModWrenchError(
          "nexus_no_preview",
          `No content preview available for file ${file_id} (mod ${mod_id}, ${game_domain}).`
        );
      }
      const previewRes = await fetch(file.content_preview_link, {
        headers: { "User-Agent": APP.userAgent, ...APP.headers },
      });
      if (!previewRes.ok) {
        throw new ModWrenchError(
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

  // Tool 13: Full-text mod search (GraphQL)
  // The v1 REST API exposes no free-text search, so this uses the Nexus v2
  // GraphQL `mods` query — the same backend the website search box hits.
  server.tool(
    "nexus_search",
    "Full-text search for mods across Nexus Mods by free-text term, optionally scoped to a single game. Returns matching mods with name, author, game, mod ID, summary, download/endorsement counts, and a nexusmods.com page URL. This is the only Nexus tool with real keyword search.",
    {
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
      const gqlQuery = `query ModWrenchSearch($filter: ModsFilter, $count: Int!) {
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
      endorsements
    }
  }
}`;
      const data = await nexusGraphQL<{
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
      }>(gqlQuery, { filter, count });

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

  server.tool(
    "nexus_updated",
    "List every mod for a game updated within a recent window (1d / 1w / 1m). Returns each mod_id with its latest file-update and mod-activity timestamps — the feed a load-order maintainer watches to know exactly what to refresh.",
    {
      game_domain: z
        .string()
        .describe("The game's domain name (e.g. 'skyrimspecialedition')."),
      period: z
        .enum(["1d", "1w", "1m"])
        .optional()
        .describe("Look-back window. Default '1w'."),
    },
    async ({ game_domain, period }) => {
      const p = period ?? "1w";
      const updated = await nexusRequest<
        Array<{
          mod_id: number;
          latest_file_update: number;
          latest_mod_activity: number;
        }>
      >(`/games/${game_domain}/mods/updated.json?period=${p}`);
      return {
        content: [
          {
            type: "text",
            text: `${updated.length} mods updated in the last ${p} for ${game_domain}:\n\n${JSON.stringify(
              updated,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // ─── Write client ───────────────────────────────────────────────────────────
  // Playbook rule 2: writes get their own client with retries disabled. An
  // endorsement is not idempotent in a way we can reason about from here — a
  // transient 5xx that actually succeeded upstream, retried, could toggle state
  // back. Fail loud once and let the person decide.
  const writeClient = createHttpClient({
    baseUrl: NEXUS_BASE_URL,
    userAgent: APP.userAgent,
    defaultHeaders: APP.headers,
    errorCodePrefix: "nexus",
    retry: { maxAttempts: 1 },
    authHeaders: (): Record<string, string> => {
      if (credential.source === "keychain") {
        return { Authorization: `Bearer ${credential.accessToken}` };
      }
      return { apikey: credential.apiKey };
    },
  });

  // Tool 15: Endorse a mod — the only write action in ModWrench.
  server.tool(
    "nexus_endorse_mod",
    "WRITE ACTION. Endorses a mod on Nexus Mods using the signed-in user's own " +
      "account — a public, visible action attributed to them, and the main way a " +
      "mod author gets credit. This is the ONLY tool in ModWrench that changes " +
      "anything on a mod platform; everything else is read-only. " +
      "Nexus requires you to have downloaded the mod before you can endorse it. " +
      "Behave like this: call it once WITHOUT confirm to get a preview, show the " +
      "preview to the user, wait for them to say yes, then re-call with " +
      "confirm=true. Never pass confirm=true on the first call, and never endorse " +
      "a mod the user did not ask you to endorse.",
    {
      game_domain: z
        .string()
        .describe("The game's domain name (e.g. 'skyrimspecialedition')."),
      mod_id: z.number().int().positive().describe("The numeric mod ID."),
      version: z
        .string()
        .describe(
          "The mod version being endorsed — Nexus requires this. Use the " +
            "version reported by nexus_get_mod."
        ),
      confirm: z
        .boolean()
        .optional()
        .describe(
          "Must be exactly true to actually endorse. Omit it first to preview."
        ),
    },
    async ({ game_domain, mod_id, version, confirm }) => {
      const modUrl = `https://www.nexusmods.com/${game_domain}/mods/${mod_id}`;

      // Playbook rule 1: no upstream call at all unless confirm === true.
      if (confirm !== true) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `PREVIEW — nothing has been sent to Nexus.\n\n` +
                `This would endorse mod ${mod_id} (version ${version}) in ` +
                `${game_domain}, as you, on your Nexus account.\n` +
                `${modUrl}\n\n` +
                `The endorsement is public and shows your username. You can undo ` +
                `it later on the mod page. Nexus requires that you have already ` +
                `downloaded this mod.\n\n` +
                `To go ahead, re-call nexus_endorse_mod with confirm=true.`,
            },
          ],
        };
      }

      try {
        await writeClient.request<unknown>(
          `/games/${game_domain}/mods/${mod_id}/endorse.json`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ version }).toString(),
          }
        );
      } catch (err) {
        // 422 is what Nexus returns when it will not save the endorsement. The
        // API spec does not say why, but the usual cause is not having
        // downloaded the mod. Say what we know without inventing a reason.
        const status =
          err instanceof ModWrenchError ? err.status : undefined;
        if (status === 422) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text:
                  `Nexus declined to save the endorsement (422). The most common ` +
                  `cause is not having downloaded this mod yet — Nexus requires ` +
                  `that before you can endorse. Check the version is correct too ` +
                  `(you passed "${version}").\n${modUrl}`,
              },
            ],
          };
        }
        throw err;
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Endorsed mod ${mod_id} (version ${version}) in ${game_domain}.\n` +
              `${modUrl}\n\nThe author can see this. Thanks for crediting them.`,
          },
        ],
      };
    }
  );

  return { toolCount: 15, baseUrl: NEXUS_BASE_URL };
}
