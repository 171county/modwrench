import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Env helpers ───────────────────────────────────────────────────────
//
// There is deliberately no secret-from-environment helper in this file.
// Credentials come from the OS credential manager and from nowhere else — see
// auth.ts, which is the whole credential path.
//
// This module used to export getSecret() ("retrieve a secret from environment
// variables") and to call dotenv's config() at import time, which read a .env
// file off the user's disk every time any ModWrench package loaded. Nothing
// consumed either one, so no credential ever actually came from them — but a
// guarantee that holds only because nobody calls the wrong function is not a
// guarantee. Both are gone, and dotenv is no longer a dependency, so "keychain
// only, no file, no env var" is now structural rather than incidental.
//
// getEnv() below is for NON-SECRET operational config only: base URLs, ports,
// host bindings. Never route a credential through it.

/**
 * Retrieve an optional environment variable with a fallback default.
 */
export function getEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

const SENSITIVE_TEXT_KEYS = [
  "access_token",
  "api_key",
  "apikey",
  "authorization",
  "client_secret",
  "password",
  "refresh_token",
  "secret",
  "security_code",
  "token",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSensitiveText(value: string): string {
  let redacted = value;
  for (const key of SENSITIVE_TEXT_KEYS) {
    const escaped = escapeRegExp(key);
    redacted = redacted.replace(
      new RegExp(`("${escaped}"\\s*:\\s*")([^"]*)(")`, "gi"),
      "$1[redacted]$3"
    );
    redacted = redacted.replace(
      new RegExp(`(\\b${escaped}\\b\\s*[=:]\\s*)([^&\\s"']+)`, "gi"),
      "$1[redacted]"
    );
  }
  return redacted;
}

// ─── Logging ──────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevel = (getEnv("LOG_LEVEL", "info") as LogLevel) ?? "info";

/**
 * Minimal structured logger. Writes JSON to stderr so it never interferes
 * with MCP stdio protocol traffic (which uses stdout).
 */
export function log(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel]) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(meta ?? {}),
  };
  process.stderr.write(JSON.stringify(entry) + "\n");
}

// ─── Application identity ─────────────────────────────────────────────────────
// Nexus's API Acceptable Use Policy requires an application to identify itself
// with Application-Name and Application-Version headers, and lists blank or
// impersonating request metadata as unacceptable. mod.io's API Access Terms
// carry a similar identification requirement.
//
// The version is resolved from the calling package's own manifest rather than
// written as a literal, because literals drift: every platform package was
// still announcing itself as 0.0.1 one release after 0.1.0 shipped.

/**
 * Build the User-Agent and application-identification headers for an outbound
 * request, resolving the version from the calling package's package.json.
 *
 * Pass `import.meta.url` from the calling module. Walks upward until it finds a
 * package.json belonging to this project, so it does not care how deeply nested
 * the calling file is inside dist/.
 */
export function appIdentity(importMetaUrl: string): {
  userAgent: string;
  headers: Record<string, string>;
} {
  let version = "0.0.0";
  try {
    let dir = dirname(fileURLToPath(importMetaUrl));
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(dir, "package.json");
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name?.startsWith("@modwrench/") && pkg.version) {
          version = pkg.version;
          break;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Fall through to the placeholder rather than failing a request over it.
  }
  return {
    userAgent: `ModWrench/${version} (+https://github.com/171county/modwrench)`,
    headers: {
      "Application-Name": "ModWrench",
      "Application-Version": version,
    },
  };
}

// ─── Auth & keychain ──────────────────────────────────────────────────────────

export * from "./adult.js";

export * from "./auth.js";

// ─── Shared HTTP client ───────────────────────────────────────────────────────

export * from "./http.js";

// ─── Error type ───────────────────────────────────────────────────────────────

/**
 * Error type used across ModWrench servers for predictable error envelopes.
 */
export class ModWrenchError extends Error {
  public readonly code: string;
  public readonly status?: number;
  public readonly meta?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options?: { status?: number; meta?: Record<string, unknown>; cause?: unknown }
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "ModWrenchError";
    this.code = code;
    this.status = options?.status;
    this.meta = options?.meta;
  }
}
