import { Entry } from "@napi-rs/keyring";

// ─── Keychain storage ─────────────────────────────────────────────────────────
// Tokens land in the OS-native secrets store: Windows Credential Manager,
// macOS Keychain, or Linux libsecret. Service identifiers are prefixed with
// "modwrench-" so a user inspecting their keychain sees a recognizable owner.
//
// On Linux specifically — and especially on Steam Deck Game Mode or headless
// installs — libsecret / D-Bus may not be available. We detect that case and
// surface a clear error message instead of silently sending the user to env
// vars without explanation.

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

// ─── Keychain availability tracking ───────────────────────────────────────────
// Some Linux setups (Steam Deck Game Mode, headless servers, container images
// without libsecret) can't reach the OS keychain. We detect this on the first
// operation and remember the status so subsequent error messages can explain
// the real problem rather than just saying "credential not found."

type KeychainStatus = "unknown" | "available" | "unavailable";
let keychainStatus: KeychainStatus = "unknown";
let unavailableWarningEmitted = false;

/**
 * Public status of the OS keychain integration on this system. Useful for
 * tools that want to surface a clearer error or recommend the env-var path
 * proactively.
 */
export function getKeychainStatus(): KeychainStatus {
  return keychainStatus;
}

/**
 * Classify a keychain error as either "no entry exists" (the keychain works,
 * we just haven't stored anything yet) or "unavailable" (the keychain service
 * itself can't be reached). The distinction matters because the first case
 * is normal and the second case usually means the user is on Steam Deck Game
 * Mode, a headless Linux box, a container, or otherwise lacks libsecret.
 */
function classifyKeychainError(err: unknown): "no-entry" | "unavailable" {
  const msg =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (
    msg.includes("d-bus") ||
    msg.includes("dbus") ||
    msg.includes("libsecret") ||
    msg.includes("schema") ||
    msg.includes("no such file") ||
    msg.includes("could not connect") ||
    msg.includes("not running") ||
    msg.includes("session bus")
  ) {
    return "unavailable";
  }
  return "no-entry";
}

function emitUnavailableWarningOnce(err: unknown): void {
  if (unavailableWarningEmitted) return;
  unavailableWarningEmitted = true;
  // Write directly to stderr — avoid importing log() from index.ts which would
  // create a circular dependency back to this module.
  process.stderr.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      msg: "OS keychain unavailable on this system; falling back to env vars",
      hint:
        "Common on Steam Deck Game Mode, headless Linux, or systems without " +
        "libsecret/D-Bus. Set the platform's API_KEY env var in your .env to " +
        "use the legacy auth path instead.",
      error: err instanceof Error ? err.message : String(err),
    }) + "\n"
  );
}

export function getStoredToken(name: string): StoredToken | null {
  try {
    const entry = new Entry(service(name), KEYCHAIN_ACCOUNT);
    const raw = entry.getPassword();
    keychainStatus = "available";
    if (!raw) return null;
    return JSON.parse(raw) as StoredToken;
  } catch (err) {
    if (classifyKeychainError(err) === "unavailable") {
      keychainStatus = "unavailable";
      emitUnavailableWarningOnce(err);
    }
    return null;
  }
}

export function setStoredToken(name: string, token: StoredToken): void {
  try {
    const entry = new Entry(service(name), KEYCHAIN_ACCOUNT);
    entry.setPassword(JSON.stringify(token));
    keychainStatus = "available";
  } catch (err) {
    if (classifyKeychainError(err) === "unavailable") {
      keychainStatus = "unavailable";
      throw new Error(
        `[mcpwrench/core] Cannot save credential: OS keychain unavailable. ` +
          `This is common on Steam Deck Game Mode, headless Linux, or systems ` +
          `without libsecret/D-Bus. Use the legacy API-key path instead — set ` +
          `the platform's API_KEY env var in your .env. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    throw err;
  }
}

export function deleteStoredToken(name: string): boolean {
  try {
    const entry = new Entry(service(name), KEYCHAIN_ACCOUNT);
    const removed = entry.deletePassword();
    keychainStatus = "available";
    return removed;
  } catch (err) {
    if (classifyKeychainError(err) === "unavailable") {
      keychainStatus = "unavailable";
      emitUnavailableWarningOnce(err);
    }
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
 *
 * If the keychain is unavailable (Steam Deck Game Mode, headless Linux, etc.)
 * the thrown error explicitly says so rather than just reporting "no credential
 * found" — which helps users fix the actual problem.
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

  const keychainNote =
    keychainStatus === "unavailable"
      ? "OS keychain is unavailable on this system (likely libsecret/D-Bus missing — common on Steam Deck Game Mode or headless Linux). "
      : "Tried OS keychain and ";
  throw new Error(
    `[mcpwrench/core] No credential found for "${opts.service}". ` +
      `${keychainNote}env var ${opts.envVar} is not set. ` +
      opts.authHint
  );
}
