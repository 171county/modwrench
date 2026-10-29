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
import { adultContentAllowed, applyAdultPolicy } from "./adult.js";

export { registerNexusPublicTools } from "./public.js";

/**
 * Register all Nexus Mods tools on the given MCP server. Returns metadata
 * useful for boot logging. Pure registration — no transport, no side effects
 * beyond the server itself.
 *
 * Used by both the standalone @modwrench/nexus bin and the meta-server in
 * @modwrench/cli that bundles multiple platforms into one MCP entry.
 */
import { MODS_PAGE, modsView, pageData, registerAppPage, type ModRow, type ModsView } from "@modwrench/ui";

const APP = appIdentity(import.meta.url);

type NexusRow = {
  mod_id: number;
  name: string;
  summary?: string;
  author?: string;
  version?: string;
  endorsement_count?: number;
  /** v1's name for a mod's total downloads (the v2 GraphQL API calls it `downloads`). */
  mod_downloads?: number;
};

/** Nexus discovery lists -> the Mods page's data, Skyrim-skinned (Nexus is
 * Bethesda-dominant, so the SkyUI/MO2 look is the natural fit). */
function nexusModsView(query: string, domain: string, rows: NexusRow[]): ModsView {
  const mods: ModRow[] = rows.map((r) => ({
    name: r.name,
    author: r.author ?? "unknown",
    platform: "nexus",
    version: r.version,
    downloads: r.mod_downloads,
    endorsements: r.endorsement_count,
    summary: r.summary,
    pageUrl: `https://www.nexusmods.com/${domain}/mods/${r.mod_id}`,
  }));
  return modsView({ theme: "skyrim", query, mods });
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

  // ─── Tools ──────────────────────────────────────────────────────────────────

  // Tool 1: Validate the API key is good
  server.registerTool(
    "nexus_validate_key",
    {
      title: "Check my Nexus connection",
      description: "Validate the configured Nexus Mods API key and return the associated user profile. Use this to sanity-check the connection.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
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

  // Tool 2: Trending mods for a game
  const modsPage = registerAppPage(server, MODS_PAGE);
  server.registerTool(
    "nexus_trending",
    {
      title: "Trending Nexus mods",
      description: "Get the trending mods for a specific game right now. This is the 'what's hot' list.",
      inputSchema: {
        game_domain: z
          .string()
          .describe("The game's domain name (e.g. 'skyrimspecialedition')."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      ...(modsPage ? { _meta: modsPage } : {}),
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
        ...pageData(server, nexusModsView(`Trending \u00b7 ${game_domain}`, game_domain, mods), modsPage !== undefined),
      };
    }
  );

  // Tool 3: List files for a specific mod
  server.registerTool(
    "nexus_mod_files",
    {
      title: "List a Nexus mod's files",
      description: "List the downloadable files for a specific mod. Useful for seeing version history, file sizes, and file categories.",
      inputSchema: {
        game_domain: z.string().describe("The game's domain name."),
        mod_id: z.number().int().positive().describe("The numeric mod ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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

  // Tool 4: Get a single mod file's details
  server.registerTool(
    "nexus_get_file",
    {
      title: "Get Nexus file details",
      description: "Get details for a single mod file (version, size, category, description, content_preview_link). Use nexus_mod_files first to discover file IDs.",
      inputSchema: {
        game_domain: z.string().describe("The game's domain name."),
        mod_id: z.number().int().positive().describe("The numeric mod ID."),
        file_id: z.number().int().positive().describe("The numeric file ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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

  // Tool 5: Preview a mod file's archive contents
  server.registerTool(
    "nexus_file_preview",
    {
      title: "Peek inside a Nexus archive",
      description: "Inspect the archive structure (folders and files) of a mod file without downloading it. Useful for verifying installation paths or potential conflicts before downloading.",
      inputSchema: {
        game_domain: z.string().describe("The game's domain name."),
        mod_id: z.number().int().positive().describe("The numeric mod ID."),
        file_id: z.number().int().positive().describe("The numeric file ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ game_domain, mod_id, file_id }) => {
      // This tool leaves the shared request path: the preview lives on a CDN
      // URL Nexus names at runtime, so the payload it returns never passes
      // through applyAdultPolicy. Filtering the CDN response would not help
      // either — it is a folder/filename tree carrying no adult flag, so
      // isAdult() is structurally false on it no matter what the mod is.
      //
      // The flag lives on the MOD record. Check that first and refuse, so an
      // adult-tagged mod's archive listing — whose filenames are frequently
      // explicit in themselves — cannot come back unlabelled. nexusRequest
      // applies the policy, so a filtered mod arrives as the redaction marker.
      if (!adultContentAllowed()) {
        const mod = await nexusRequest<Record<string, unknown>>(
          `/games/${game_domain}/mods/${mod_id}.json`
        );
        if ((mod as { filtered?: boolean }).filtered === true) {
          throw new ModWrenchError(
            "nexus_adult_filtered",
            `Mod ${mod_id} (${game_domain}) is flagged as adult content on Nexus Mods, ` +
              `so ModWrench will not return its archive listing. Nexus requires ` +
              `third-party API consumers to filter what they return. To see it, view ` +
              `the mod on nexusmods.com while signed in with adult content enabled, ` +
              `or set NEXUS_ALLOW_ADULT_CONTENT=true to opt in deliberately.`
          );
        }
      }

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

  // Tool 6: Get changelogs for a mod
  server.registerTool(
    "nexus_mod_changelogs",
    {
      title: "Read a Nexus mod's changelog",
      description: "Get the version-by-version changelog map for a mod. Returns an object keyed by version, each value an array of changelog entries.",
      inputSchema: {
        game_domain: z.string().describe("The game's domain name."),
        mod_id: z.number().int().positive().describe("The numeric mod ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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

  // Tool 7: Endorse a mod — the only write action in ModWrench.
  server.registerTool(
    "nexus_endorse_mod",
    {
      title: "Endorse a Nexus mod (write)",
      description:
        "WRITE ACTION. Endorses a mod on Nexus Mods using the signed-in user's own " +
        "account — a public, visible action attributed to them, and the main way a " +
        "mod author gets credit. This is the ONLY tool in ModWrench that changes " +
        "anything on a mod platform; everything else is read-only. " +
        "Nexus requires you to have downloaded the mod before you can endorse it. " +
        "Behave like this: call it once WITHOUT confirm to get a preview, show the " +
        "preview to the user, wait for them to say yes, then re-call with " +
        "confirm=true. Never pass confirm=true on the first call, and never endorse " +
        "a mod the user did not ask you to endorse.",
      inputSchema: {
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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

  return { toolCount: 7, baseUrl: NEXUS_BASE_URL };
}
