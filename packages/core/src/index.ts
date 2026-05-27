import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Locate the workspace root ────────────────────────────────────────────────
// Walk up from this file's location until we find a package.json that declares
// "workspaces" — that's the monorepo root, regardless of where the process was
// launched from. Falls back to process.cwd() if no workspace marker is found
// (which lets the core package work fine even outside a monorepo).

function findWorkspaceRoot(startDir: string): string {
  let current = startDir;
  // Safety bound: don't walk forever even on weird filesystems.
  for (let i = 0; i < 20; i++) {
    const pkgPath = resolve(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg && Array.isArray(pkg.workspaces)) {
          return current;
        }
      } catch {
        // Ignore malformed package.json and keep walking.
      }
    }
    const parent = dirname(current);
    if (parent === current) break; // hit filesystem root
    current = parent;
  }
  return startDir;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = findWorkspaceRoot(HERE);

loadDotenv({ path: resolve(WORKSPACE_ROOT, ".env") });

// ─── Secret & env helpers ─────────────────────────────────────────────────────

/**
 * Retrieve a secret from environment variables.
 * Throws a clear error if the secret is missing — fail fast, fail loud.
 */
export function getSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `[mcpwrench/core] Missing required secret: ${name}. ` +
        `Check your .env file at the workspace root (${WORKSPACE_ROOT}).`
    );
  }
  return value;
}

/**
 * Retrieve an optional environment variable with a fallback default.
 */
export function getEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
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

// ─── Auth & keychain ──────────────────────────────────────────────────────────

export * from "./auth.js";

// ─── Shared HTTP client ───────────────────────────────────────────────────────

export * from "./http.js";

// ─── Error type ───────────────────────────────────────────────────────────────

/**
 * Error type used across MCPwrench servers for predictable error envelopes.
 */
export class McpwrenchError extends Error {
  public readonly code: string;
  public readonly status?: number;
  public readonly meta?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options?: { status?: number; meta?: Record<string, unknown>; cause?: unknown }
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "McpwrenchError";
    this.code = code;
    this.status = options?.status;
    this.meta = options?.meta;
  }
}