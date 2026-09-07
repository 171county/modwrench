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
 * tools that want to surface a clearer error when the credential manager
 * can't be reached.
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
      msg: "OS credential manager unavailable on this system",
      hint:
        "Common on Steam Deck Game Mode, headless Linux, or systems without " +
        "libsecret/D-Bus. ModWrench reads credentials only from the OS " +
        "credential manager, so a working Secret Service (e.g. gnome-keyring) " +
        "is required — there is no env-var or file-based credential path.",
      error: err instanceof Error ? err.message : String(err),
    }) + "\n"
  );
}

/**
 * Read a raw secret string from the OS credential manager without interpreting
 * it. Returns the stored value as-is — an OAuth-token JSON blob written by the
 * assisted `auth login` helper, or a raw API key the user pasted in — or null
 * if nothing is stored / the credential manager is unavailable.
 */
export function getRawSecret(name: string): string | null {
  try {
    const entry = new Entry(service(name), KEYCHAIN_ACCOUNT);
    const raw = entry.getPassword();
    keychainStatus = "available";
    return raw && raw.trim() !== "" ? raw : null;
  } catch (err) {
    if (classifyKeychainError(err) === "unavailable") {
      keychainStatus = "unavailable";
      emitUnavailableWarningOnce(err);
    }
    return null;
  }
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
        `[modwrench/core] Cannot save credential: OS credential manager ` +
          `unavailable. This is common on Steam Deck Game Mode, headless Linux, ` +
          `or systems without libsecret/D-Bus. ModWrench stores and reads ` +
          `credentials only in the OS credential manager, so a working Secret ` +
          `Service (e.g. gnome-keyring) is required. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    throw err;
  }
}

/**
 * Persist a raw credential string — a personal API key — under a service entry.
 *
 * Stored verbatim, NOT JSON-wrapped. That is precisely what makes
 * loadCredential() resolve it as `source: "apikey"`, so callers send the
 * platform's own key header rather than an OAuth Bearer token. OAuth tokens
 * take the setStoredToken() path instead; the two must not be mixed up or the
 * wrong auth header goes on the wire.
 */
export function setRawSecret(name: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error("[modwrench/core] Refusing to store an empty credential.");
  }
  try {
    const entry = new Entry(service(name), KEYCHAIN_ACCOUNT);
    entry.setPassword(trimmed);
    keychainStatus = "available";
  } catch (err) {
    if (classifyKeychainError(err) === "unavailable") {
      keychainStatus = "unavailable";
      throw new Error(
        `[modwrench/core] Cannot save credential: OS credential manager ` +
          `unavailable. This is common on Steam Deck Game Mode, headless Linux, ` +
          `or systems without libsecret/D-Bus. ModWrench stores and reads ` +
          `credentials only in the OS credential manager, so a working Secret ` +
          `Service (e.g. gnome-keyring) is required. ` +
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
      // An OAuth token JSON the user stored in their OS credential manager,
      // typically written there by the optional `auth login` helper.
      source: "keychain";
      accessToken: string;
      refreshToken?: string;
      expiresAt: number | null;
    }
  | {
      // A raw API key / token the user pasted directly into their OS
      // credential manager. ModWrench reads it and sends it; it never stores
      // or interprets it beyond trimming surrounding whitespace.
      source: "apikey";
      apiKey: string;
    };

/**
 * Resolve a credential from the OS credential manager — and ONLY from the OS
 * credential manager. ModWrench never reads a credential from an env var, a
 * .env file, or anywhere else on disk. The user places their token or API key
 * in their OS store (Windows Credential Manager, macOS Keychain, Linux
 * libsecret); ModWrench reads it, sends it, and holds it no longer than the
 * request that uses it.
 *
 * The stored value is auto-detected: an OAuth-token JSON blob (written by the
 * optional `auth login` helper) resolves to `source: "keychain"`; anything
 * else is treated as a raw API key and resolves to `source: "apikey"`. Callers
 * branch on `source` to decide which auth header (Bearer vs platform-specific)
 * to send.
 *
 * If nothing is stored, or the credential manager is unavailable (Steam Deck
 * Game Mode, headless Linux, etc.), the thrown error explains exactly where to
 * put the credential rather than just reporting "not found."
 */
export function loadCredential(opts: {
  service: string;
  authHint: string;
}): Credential {
  const raw = getRawSecret(opts.service);
  if (!raw) {
    const keychainNote =
      keychainStatus === "unavailable"
        ? `The OS credential manager is unavailable on this system (libsecret/` +
          `D-Bus missing — common on Steam Deck Game Mode or headless Linux). ` +
          `ModWrench reads credentials only from the OS credential manager, so ` +
          `a working Secret Service (e.g. gnome-keyring) is required. `
        : `No credential found in your OS credential manager for ` +
          `"${opts.service}" (service "${service(opts.service)}", account ` +
          `"${KEYCHAIN_ACCOUNT}"). Store your ${opts.service} token or API key ` +
          `there, then retry. `;
    throw new Error(`[modwrench/core] ${keychainNote}${opts.authHint}`);
  }

  // OAuth-token JSON (from `auth login`) vs a raw pasted API key. Parse and
  // look for an access_token; otherwise treat the whole string as the key.
  try {
    const parsed = JSON.parse(raw) as Partial<StoredToken>;
    if (
      parsed &&
      typeof parsed.access_token === "string" &&
      parsed.access_token.trim() !== ""
    ) {
      return {
        source: "keychain",
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token,
        expiresAt: parsed.expires_at ?? null,
      };
    }
  } catch {
    // Not JSON — fall through and treat the raw string as an API key.
  }
  return { source: "apikey", apiKey: raw.trim() };
}
