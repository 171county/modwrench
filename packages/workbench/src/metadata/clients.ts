import {
  createHttpClient,
  getEnv,
  log,
  loadCredential,
  type Credential,
  type HttpClient,
} from "@modwrench/core";

// Minimal HTTP clients for the platforms we already cover via dedicated MCP
// packages. We re-implement at this layer rather than depending on
// @modwrench/nexus / @modwrench/modio because that would invert the dep
// direction (workbench is supposed to be the leaner package, and the platform
// packages don't need to know about workbench).
//
// Both clients use the shared @modwrench/core HTTP client for retry/backoff
// /429 handling /concurrency cap — keeps behavior consistent with what the
// platform packages do. Credentials are loaded best-effort at register time
// via loadCredential; if neither keychain nor env is configured for a given
// platform, the client is null and the metadata tool surfaces a clear error.

const USER_AGENT = "ModWrench/0.1.0 (+https://github.com/171county/modwrench)";

// ─── Nexus ────────────────────────────────────────────────────────────────────

export type NexusClient = {
  baseUrl: string;
  request<T>(path: string): Promise<T>;
};

export function tryCreateNexusClient(): NexusClient | null {
  let credential: Credential;
  try {
    credential = loadCredential({
      service: "nexus",
      envVar: "NEXUS_API_KEY",
      authHint: "no-op",
    });
  } catch {
    return null;
  }
  const baseUrl = getEnv("NEXUS_BASE_URL", "https://api.nexusmods.com/v1");
  const http: HttpClient = createHttpClient({
    baseUrl,
    userAgent: USER_AGENT,
    errorCodePrefix: "nexus",
    authHeaders: (): Record<string, string> => {
      if (credential.source === "keychain") {
        return { Authorization: `Bearer ${credential.accessToken}` };
      }
      return { apikey: credential.apiKey };
    },
  });
  return {
    baseUrl,
    async request<T>(path: string): Promise<T> {
      log("debug", "workbench.nexus.request", { path });
      return http.request<T>(path);
    },
  };
}

// ─── mod.io ───────────────────────────────────────────────────────────────────

export type ModioClient = {
  baseUrl: string;
  request<T>(
    path: string,
    query?: Record<string, string | number | undefined>
  ): Promise<T>;
};

export function tryCreateModioClient(): ModioClient | null {
  let credential: Credential;
  try {
    credential = loadCredential({
      service: "modio",
      envVar: "MODIO_API_KEY",
      authHint: "no-op",
    });
  } catch {
    return null;
  }
  const baseUrl = getEnv("MODIO_BASE_URL", "https://api.mod.io/v1");
  const http: HttpClient = createHttpClient({
    baseUrl,
    userAgent: USER_AGENT,
    errorCodePrefix: "modio",
    authHeaders: (): Record<string, string> => {
      if (credential.source === "keychain") {
        return { Authorization: `Bearer ${credential.accessToken}` };
      }
      return {};
    },
  });
  return {
    baseUrl,
    async request<T>(
      path: string,
      query?: Record<string, string | number | undefined>
    ): Promise<T> {
      const finalQuery: Record<string, string | number | undefined | null> = {
        ...(query ?? {}),
      };
      // mod.io's quirk: legacy API key goes on the query string, not as a
      // header. OAuth tokens use the Authorization header (handled by
      // authHeaders above).
      if (credential.source === "env") {
        finalQuery["api_key"] = credential.apiKey;
      }
      log("debug", "workbench.modio.request", {
        path,
        auth:
          credential.source === "env" ? "api_key (query)" : "Bearer (header)",
      });
      return http.request<T>(path, { query: finalQuery });
    },
  };
}
