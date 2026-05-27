import {
  getEnv,
  log,
  loadCredential,
  type Credential,
} from "@mcpwrench/core";

// Minimal HTTP clients for the platforms we already cover via dedicated MCP
// packages. We re-implement the fetch helpers here rather than depending on
// @modwrench/nexus / @modwrench/modio because that would invert the dep
// direction (workbench is supposed to be the leaner package, and the platform
// packages don't need to know about workbench).
//
// Credentials are loaded best-effort at register time. If neither keychain
// nor env var is set, the corresponding client is null and the metadata tool
// surfaces a clear error pointing at `modwrench-<platform> auth login`.

const USER_AGENT = "ModWrench/0.0.1 (+https://mcpwrench.dev)";

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
  return {
    baseUrl,
    async request<T>(path: string): Promise<T> {
      const url = `${baseUrl}${path}`;
      log("debug", "workbench.nexus.request", { url });
      const auth: Record<string, string> =
        credential.source === "keychain"
          ? { Authorization: `Bearer ${credential.accessToken}` }
          : { apikey: credential.apiKey };
      const response = await fetch(url, {
        headers: {
          ...auth,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Nexus ${response.status} ${path}: ${body.slice(0, 200)}`
        );
      }
      return (await response.json()) as T;
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
  return {
    baseUrl,
    async request<T>(
      path: string,
      query?: Record<string, string | number | undefined>
    ): Promise<T> {
      const params = new URLSearchParams();
      if (credential.source === "env") {
        params.append("api_key", credential.apiKey);
      }
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          if (v !== undefined && v !== null && v !== "") {
            params.append(k, String(v));
          }
        }
      }
      const qs = params.toString();
      const url = `${baseUrl}${path}${qs ? `?${qs}` : ""}`;
      log("debug", "workbench.modio.request", {
        url: url.replace(/api_key=[^&]+/, "api_key=***"),
      });
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      };
      if (credential.source === "keychain") {
        headers.Authorization = `Bearer ${credential.accessToken}`;
      }
      const response = await fetch(url, { headers });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `mod.io ${response.status} ${path}: ${body.slice(0, 200)}`
        );
      }
      return (await response.json()) as T;
    },
  };
}
