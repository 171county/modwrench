import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHttpClient, parseRetryAfter } from "../src/http.js";

// ─── parseRetryAfter — pure unit tests ───────────────────────────────────────

test("parseRetryAfter: returns ms for integer seconds", () => {
  assert.equal(parseRetryAfter("30"), 30000);
  assert.equal(parseRetryAfter("0"), 0);
  assert.equal(parseRetryAfter("1.5"), 1500);
});

test("parseRetryAfter: returns ms for HTTP-date in the future", () => {
  const future = new Date(Date.now() + 60_000).toUTCString();
  const ms = parseRetryAfter(future);
  assert.ok(ms !== null);
  // Allow for clock drift in the test execution window.
  assert.ok(ms >= 50_000 && ms <= 70_000, `got ${ms}`);
});

test("parseRetryAfter: HTTP-date in the past returns 0", () => {
  const past = new Date(Date.now() - 60_000).toUTCString();
  assert.equal(parseRetryAfter(past), 0);
});

test("parseRetryAfter: malformed input returns null", () => {
  assert.equal(parseRetryAfter("garbage"), null);
  assert.equal(parseRetryAfter(""), null);
  assert.equal(parseRetryAfter(null), null);
});

// ─── createHttpClient — fetch-mocked behavioral tests ────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Each test installs its own fetch stub; reset between tests so they don't
  // bleed into each other.
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...(init ?? {}),
  });
}

test("createHttpClient: basic GET returns parsed JSON", async () => {
  globalThis.fetch = async () =>
    makeJsonResponse({ hello: "world" });
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
  });
  const result = await client.request<{ hello: string }>("/thing");
  assert.equal(result.hello, "world");
});

test("createHttpClient: User-Agent header is set", async () => {
  // Collected rather than assigned to a `let`: TypeScript's flow analysis does
  // not see assignments made inside the fetch stub, so a nullable local would
  // still read as null here. An array sidesteps that, and lets the test also
  // assert the request was made exactly once.
  const calls: Headers[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(new Headers(init?.headers));
    return makeJsonResponse({});
  };
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "ModWrench-test/1.0",
  });
  await client.request("/x");
  assert.equal(calls.length, 1, "expected exactly one fetch");
  assert.equal(calls[0].get("user-agent"), "ModWrench-test/1.0");
});

test("createHttpClient: authHeaders callback is invoked per request", async () => {
  let calls = 0;
  let lastAuth: string | null = null;
  globalThis.fetch = async (_url, init) => {
    lastAuth = new Headers(init?.headers).get("authorization");
    return makeJsonResponse({});
  };
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
    authHeaders: () => {
      calls++;
      return { Authorization: `Bearer token-${calls}` };
    },
  });
  await client.request("/a");
  await client.request("/b");
  assert.equal(calls, 2);
  assert.equal(lastAuth, "Bearer token-2");
});

test("createHttpClient: query parameters are appended, falsy values dropped", async () => {
  let capturedUrl = "";
  globalThis.fetch = async (url) => {
    capturedUrl = url.toString();
    return makeJsonResponse({});
  };
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
  });
  await client.request("/things", {
    query: {
      limit: 30,
      cursor: "abc",
      empty: "",
      nope: undefined,
      nada: null,
    },
  });
  // Order may vary, so just check that the right keys are present.
  assert.ok(capturedUrl.includes("limit=30"));
  assert.ok(capturedUrl.includes("cursor=abc"));
  assert.ok(!capturedUrl.includes("empty="));
  assert.ok(!capturedUrl.includes("nope="));
  assert.ok(!capturedUrl.includes("nada="));
});

test("createHttpClient: 429 with Retry-After triggers retry", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) {
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" },
      });
    }
    return makeJsonResponse({ ok: true });
  };
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 5 },
  });
  const result = await client.request<{ ok: boolean }>("/x");
  assert.equal(attempts, 2);
  assert.equal(result.ok, true);
});

test("createHttpClient: 5xx triggers retry with backoff", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts < 3) {
      return new Response("server error", { status: 503 });
    }
    return makeJsonResponse({ recovered: true });
  };
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
    retry: { maxAttempts: 5, initialDelayMs: 1, maxDelayMs: 5 },
  });
  const result = await client.request<{ recovered: boolean }>("/x");
  assert.equal(attempts, 3);
  assert.equal(result.recovered, true);
});

test("createHttpClient: 4xx (non-429) does NOT retry", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response("bad request", { status: 400 });
  };
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
    retry: { maxAttempts: 3, initialDelayMs: 1 },
    errorCodePrefix: "test",
  });
  await assert.rejects(
    () => client.request("/x"),
    (err: Error & { code?: string; status?: number }) => {
      return err.code === "test_http_error" && err.status === 400;
    }
  );
  assert.equal(attempts, 1);
});

test("createHttpClient: HTTP errors redact credential query params", async () => {
  globalThis.fetch = async () => new Response("bad request", { status: 400 });
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
    retry: { maxAttempts: 1 },
    errorCodePrefix: "test",
  });

  await assert.rejects(
    () =>
      client.request("/x", {
        query: {
          api_key: "super-secret",
          q: "lighting",
        },
      }),
    (err: Error & { meta?: Record<string, unknown> }) => {
      const url = String(err.meta?.url ?? "");
      return (
        url.includes("q=lighting") &&
        url.includes("api_key=%5Bredacted%5D") &&
        !url.includes("super-secret")
      );
    }
  );
});

test("createHttpClient: network errors redact credential query params", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
    retry: { maxAttempts: 1 },
    errorCodePrefix: "test",
  });

  await assert.rejects(
    () =>
      client.request("/x", {
        query: {
          access_token: "oauth-secret",
          q: "lighting",
        },
      }),
    (err: Error) =>
      err.message.includes("q=lighting") &&
      err.message.includes("access_token=%5Bredacted%5D") &&
      !err.message.includes("oauth-secret")
  );
});

test("createHttpClient: retries exhausted throws structured error", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response("server error", { status: 502 });
  };
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
    retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 },
    errorCodePrefix: "test",
  });
  await assert.rejects(
    () => client.request("/x"),
    (err: Error & { code?: string }) => {
      // Non-retryable on last attempt — code is _http_error, not _retries_exhausted.
      return err.code === "test_http_error";
    }
  );
  assert.equal(attempts, 2);
});

test("createHttpClient: concurrency cap limits parallel in-flight requests", async () => {
  let concurrentNow = 0;
  let peakConcurrent = 0;
  globalThis.fetch = async () => {
    concurrentNow++;
    peakConcurrent = Math.max(peakConcurrent, concurrentNow);
    // Briefly hold the request so multiple can pile up.
    await new Promise((r) => setTimeout(r, 20));
    concurrentNow--;
    return makeJsonResponse({});
  };
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
    concurrencyLimit: 2,
  });
  // Fire 6 requests at once.
  await Promise.all([
    client.request("/a"),
    client.request("/b"),
    client.request("/c"),
    client.request("/d"),
    client.request("/e"),
    client.request("/f"),
  ]);
  // Cap is 2, so peak in-flight should never exceed 2.
  assert.ok(peakConcurrent <= 2, `peak was ${peakConcurrent}`);
});

test("createHttpClient: network error retries then throws if exhausted", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    throw new TypeError("fetch failed");
  };
  const client = createHttpClient({
    baseUrl: "https://api.example.com",
    userAgent: "test/0",
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
    errorCodePrefix: "test",
  });
  await assert.rejects(
    () => client.request("/x"),
    (err: Error & { code?: string }) => err.code === "test_network_error"
  );
  assert.equal(attempts, 3);
});
