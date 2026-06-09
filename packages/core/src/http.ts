// Shared HTTP client for every MCPwrench platform package. Centralizes the
// concerns that each platform shouldn't re-implement individually:
//
//   - 429 handling with Retry-After parsing (seconds OR HTTP date)
//   - Exponential backoff on transient 5xx errors
//   - Per-client concurrency cap so we never hammer a platform with parallel
//     requests
//   - User-Agent injection
//   - Caller-supplied auth-header callback (keeps Bearer vs apikey routing
//     decisions in the platform package, not in core)
//   - Structured ModWrenchError on non-retryable failures
//
// Design rule: this client is the "polite citizen" tier. It reacts to 429s
// and 5xxs but does NOT do proactive rate-limit window tracking via
// X-RL-* response headers — different platforms expose different shapes for
// those and that's a v2 concern. The current 429-reactive behavior is what
// keeps us off blocklists.

import { ModWrenchError } from "./index.js";

export type RetryConfig = {
  /** Total request attempts (1 = no retry). Default 3. */
  maxAttempts?: number;
  /** First backoff delay in ms when no Retry-After header is present. Default 250. */
  initialDelayMs?: number;
  /** Upper bound for backoff in ms (excluding server-supplied Retry-After). Default 8000. */
  maxDelayMs?: number;
};

export type HttpClientOptions = {
  /** Required. Used as the base for relative paths in request(). */
  baseUrl: string;
  /** Required. Set the User-Agent string for every outbound request. */
  userAgent: string;
  /**
   * Called per request. Return headers like `{ Authorization: "Bearer ..." }`
   * or `{ apikey: "..." }`. Return an empty object if no auth is required
   * (e.g. Thunderstore reads).
   */
  authHeaders?: () => Record<string, string>;
  /** Max concurrent in-flight requests. Default 4. */
  concurrencyLimit?: number;
  /** Tuning for retries. */
  retry?: RetryConfig;
  /** Optional default headers attached to every request (besides UA + auth). */
  defaultHeaders?: Record<string, string>;
  /**
   * Optional override for the error-code prefix in thrown ModWrenchErrors.
   * Defaults to "http". Set to e.g. "nexus" so callers see codes like
   * "nexus_http_error" rather than "http_error".
   */
  errorCodePrefix?: string;
};

export type RequestInit = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * Query string parameters. Undefined/null/empty values are dropped (so
   * platforms can pass optional zod-defaulted args directly).
   */
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  body?: string;
};

export type HttpClient = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  /** Number of requests currently waiting on the concurrency gate. */
  inFlight(): number;
};

// ─── Internals ─────────────────────────────────────────────────────────────

/**
 * Tiny async semaphore that caps concurrent operations. Each acquire() returns
 * a release function; callers must always release in a finally block.
 */
function createGate(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];

  function acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryProceed = () => {
        if (active < limit) {
          active++;
          resolve(() => {
            active--;
            const next = waiters.shift();
            if (next) next();
          });
        } else {
          waiters.push(tryProceed);
        }
      };
      tryProceed();
    });
  }

  return { acquire, inFlight: () => active + waiters.length };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse a Retry-After header value. Per RFC 9110 §10.2.3 the value is either
 * an integer number of seconds or an HTTP-date. Returns delay in ms, or null
 * if the value couldn't be parsed (caller falls back to its own backoff).
 */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  // Seconds (most common — Nexus, mod.io, GitHub all use this form).
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Number(trimmed) * 1000);
  }
  // HTTP-date — preserved per spec even if rarely seen on these APIs.
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

/** Exponential backoff with jitter, clamped to maxDelayMs. */
function computeBackoff(attempt: number, initial: number, max: number): number {
  const expo = initial * Math.pow(2, attempt - 1);
  const jittered = expo * (0.5 + Math.random());
  return Math.min(jittered, max);
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: RequestInit["query"]
): string {
  const full = path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${baseUrl}${path}`;
  if (!query || Object.keys(query).length === 0) return full;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  if (!qs) return full;
  return full.includes("?") ? `${full}&${qs}` : `${full}?${qs}`;
}

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "authorization",
  "client_secret",
  "password",
  "refresh_token",
  "secret",
  "token",
]);

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

// ─── Public factory ────────────────────────────────────────────────────────

export function createHttpClient(opts: HttpClientOptions): HttpClient {
  const concurrency = opts.concurrencyLimit ?? 4;
  const gate = createGate(concurrency);

  const maxAttempts = opts.retry?.maxAttempts ?? 3;
  const initialDelayMs = opts.retry?.initialDelayMs ?? 250;
  const maxDelayMs = opts.retry?.maxDelayMs ?? 8000;
  const errorPrefix = opts.errorCodePrefix ?? "http";

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = buildUrl(opts.baseUrl, path, init.query);
    const safeUrl = redactUrl(url);
    const method = init.method ?? "GET";
    const auth = opts.authHeaders?.() ?? {};
    const headers: Record<string, string> = {
      "User-Agent": opts.userAgent,
      Accept: "application/json",
      ...(opts.defaultHeaders ?? {}),
      ...auth,
      ...(init.headers ?? {}),
    };

    const release = await gate.acquire();
    try {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let response: Response;
        try {
          const fetchInit: globalThis.RequestInit = { method, headers };
          if (init.body !== undefined) fetchInit.body = init.body;
          response = await fetch(url, fetchInit);
        } catch (err) {
          // Network-level failure (DNS, connection reset, etc.). Treat as
          // retryable up to maxAttempts.
          lastError = err;
          if (attempt < maxAttempts) {
            await sleep(computeBackoff(attempt, initialDelayMs, maxDelayMs));
            continue;
          }
          throw new ModWrenchError(
            `${errorPrefix}_network_error`,
            `Network error contacting ${safeUrl}: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err }
          );
        }

        if (response.ok) {
          // Most platform APIs return JSON; some return empty body (204).
          // Treat empty as null so callers can branch on it cleanly.
          const ct = response.headers.get("content-type") ?? "";
          if (response.status === 204 || !ct.includes("json")) {
            // Best-effort: try JSON parse, fall back to raw text in result.
            const txt = await response.text().catch(() => "");
            if (!txt) return null as T;
            try {
              return JSON.parse(txt) as T;
            } catch {
              return txt as unknown as T;
            }
          }
          return (await response.json()) as T;
        }

        // 429 → respect Retry-After if present, else exponential backoff.
        if (response.status === 429 && attempt < maxAttempts) {
          const retryAfter = parseRetryAfter(
            response.headers.get("retry-after")
          );
          const delay =
            retryAfter ?? computeBackoff(attempt, initialDelayMs, maxDelayMs);
          await sleep(delay);
          continue;
        }

        // 5xx → retry with exponential backoff up to maxAttempts.
        if (response.status >= 500 && attempt < maxAttempts) {
          await sleep(computeBackoff(attempt, initialDelayMs, maxDelayMs));
          continue;
        }

        // Non-retryable HTTP error. Read body for diagnostics and throw.
        const body = await response.text().catch(() => "<no body>");
        throw new ModWrenchError(
          `${errorPrefix}_http_error`,
          `HTTP ${response.status} for ${method} ${path}`,
          {
            status: response.status,
            meta: { body: body.slice(0, 500), url: safeUrl },
          }
        );
      }

      // Exhausted retries on the retryable path (429 / 5xx that never
      // recovered). The last response's body isn't useful here so we keep
      // it generic.
      throw new ModWrenchError(
        `${errorPrefix}_retries_exhausted`,
        `Exhausted ${maxAttempts} attempts for ${method} ${path}`,
        { cause: lastError }
      );
    } finally {
      release();
    }
  }

  return {
    request,
    inFlight: gate.inFlight,
  };
}
