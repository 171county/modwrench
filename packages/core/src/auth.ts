import { Entry } from "@napi-rs/keyring";

// ─── Keychain storage ─────────────────────────────────────────────────────────
// Tokens land in the OS-native secrets store: Windows Credential Manager,
// macOS Keychain, or Linux libsecret. Service identifiers are prefixed with
// "modwrench-" so a user inspecting their keychain sees a recognizable owner.

const KEYCHAIN_ACCOUNT = "default";

function service(name: string): string {
  return `modwrench-${name}`;
}

/**
 * Token shape persisted in the OS keychain after an OAuth flow.
 * Stored as a JSON-stringified string under one keychain entry per service.
 */
export type StoredToken = {
  access_token: string;
  refresh_token?: string;
  expires_at: number | null; // unix ms, null if non-expiring
  saved_at: number; // unix ms
};

export function getStoredToken(name: string): StoredToken | null {
  try {
    const entry = new Entry(service(name), KEYCHAIN_ACCOUNT);
    const raw = entry.getPassword();
    if (!raw) return null;
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

export function setStoredToken(name: string, token: StoredToken): void {
  const entry = new Entry(service(name), KEYCHAIN_ACCOUNT);
  entry.setPassword(JSON.stringify(token));
}

export function deleteStoredToken(name: string): boolean {
  try {
    const entry = new Entry(service(name), KEYCHAIN_ACCOUNT);
    return entry.deletePassword();
  } catch {
    return false;
  }
}

// ─── Credential resolution ────────────────────────────────────────────────────
// Boot-time fallback chain. Servers call loadCredential() to figure out how
// they should authenticate to their upstream API.

export type Credential =
  | {
      source: "keychain";
      accessToken: string;
      refreshToken?: string;
      expiresAt: number | null;
    }
  | { source: "env"; apiKey: string };

/**
 * Resolve a credential by trying the OS keychain first, then an env var, then
 * failing with a hint that points the user at `auth login`. The shape of the
 * returned credential differs by source — callers should branch on `source`
 * to decide which auth header (Bearer vs platform-specific) to send.
 */
export function loadCredential(opts: {
  service: string;
  envVar: string;
  authHint: string;
}): Credential {
  const stored = getStoredToken(opts.service);
  if (stored && stored.access_token) {
    return {
      source: "keychain",
      accessToken: stored.access_token,
      refreshToken: stored.refresh_token,
      expiresAt: stored.expires_at,
    };
  }

  const env = process.env[opts.envVar];
  if (env && env.trim() !== "") {
    return { source: "env", apiKey: env };
  }

  throw new Error(
    `[mcpwrench/core] No credential found for "${opts.service}". ` +
      `Tried OS keychain and env var ${opts.envVar}. ` +
      opts.authHint
  );
}
