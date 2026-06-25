---
name: build-tool
description: Scaffold a new MCP tool inside an existing platform package, with the right read/write pattern and confirm gate for writes. Manual triggers "build a tool", "scaffold a new tool", "add a read tool", "add a write tool", "new tool called X", "register a tool".
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Build: Tool

A tool is one `server.tool(...)` call inside a platform's `register.ts`. The shape depends on whether it's a read tool (safe, idempotent, retries OK) or a write tool (causes upstream side effects, retries dangerous, must require explicit confirmation).

## Prerequisites
- Load `wrench-cerebral` (the substrate entry) before proceeding.
- `wrench-playbook` and `wrench-code-master` set the conventions; `build-platform` is the surrounding context if the package itself is new.

## First question: read or write?

Always ask if not already pinned. The branches diverge significantly.

**Read** — the upstream API returns data without changing state on the server. GET endpoints, lookups, searches. Safe to retry. No confirm gate.

**Write** — the upstream API mutates state. POST/PUT/PATCH/DELETE. Publishes, uploads, deletes, sends. Must use the confirm-gate pattern and the no-retry write client.

If the user can't articulate which it is, the answer is almost always read — most tools are. If they say "publish", "upload", "delete", "create", "send", "post", "modify" — that's a write.

---

## Read tool — template

Drop into `register.ts`. The httpClient is the read client declared at the top of `registerXTools` (default retry, 4 concurrent).

```typescript
server.tool(
  "x_get_thing",
  "Get a thing from X by id. Use x_list_things to discover ids. Returns the full thing record including author, version, and download count.",
  {
    thing_id: z
      .number()
      .int()
      .positive()
      .describe("The numeric thing id. Required."),
    include_versions: z
      .boolean()
      .optional()
      .describe("If true, include version history. Default false — keep responses small."),
  },
  async ({ thing_id, include_versions }) => {
    const thing = await httpClient.request<Record<string, unknown>>(
      `/things/${thing_id}`,
      { query: { include_versions } },
    );
    return {
      content: [{ type: "text", text: JSON.stringify(thing, null, 2) }],
    };
  },
);
```

Rules:

- **Description tells the LLM how to chain.** "Use `x_list_things` to discover ids" is what teaches the model the dependency. Without it the LLM guesses and gets ids wrong.
- **Description states scope/cost.** If the tool paginates server-side, walks many pages, or returns large payloads, say so. The LLM uses this to decide whether to invoke speculatively.
- **Every zod field has `.describe()`.** The MCP SDK ships these to the client as JSON Schema; the LLM uses them for argument selection. Missing descriptions degrade accuracy noticeably.
- **Constrain ids.** `.int().positive()` on numeric ids; `.uuid()` or `.regex(/^[a-z0-9-]+$/)` on slugs. Validate aggressively in zod so handlers stay clean.
- **Increment `toolCount` in the `return` at the bottom of `registerXTools`.**

---

## Write tool — template

Writes are dangerous in three ways: the LLM can invoke them without the user really meaning to, retries can double-execute, and the consequence (a published mod, a deleted record) often can't be undone. The pattern below handles all three.

### Required header: declare a writeClient at the top of `registerXTools`

Once per package, near the top, alongside the read `httpClient`:

```typescript
const writeClient = createHttpClient({
  baseUrl: BASE_URL,
  userAgent: USER_AGENT,
  errorCodePrefix: "x",
  authHeaders: () => /* same shape as httpClient */ ({}),
  retry: { maxAttempts: 1 },         // no retry — 5xx must not double-execute
});
```

`retry: { maxAttempts: 1 }` is the load-bearing line. If the upstream returns 502 mid-publish, retrying would cause a second publish. The canonical declaration lives in `mynewrench/packages/roblox/src/register.ts`.

### The tool

```typescript
server.tool(
  "x_publish_thing",
  "WRITE ACTION — publishes a new version of the thing to X. This is visible to all X users once it succeeds and cannot be undone via this tool. Use x_get_thing first to confirm the target. Requires confirm=true on the second call after reviewing the preview.",
  {
    thing_id: z
      .number()
      .int()
      .positive()
      .describe("The numeric thing id. Use x_get_thing to find."),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .describe("Semver string for the new version, e.g. \"1.2.0\"."),
    payload: z
      .string()
      .describe("The publish payload. Pass the literal string the user provided."),
    confirm: z
      .boolean()
      .optional()
      .describe("Pass true to actually publish. Omit or false to preview only."),
  },
  async ({ thing_id, version, payload, confirm }) => {
    // Preview branch — no network call.
    if (confirm !== true) {
      return {
        content: [
          {
            type: "text",
            text:
              `PREVIEW — no action taken.\n\n` +
              `Would publish:\n` +
              `  thing_id: ${thing_id}\n` +
              `  version:  ${version}\n` +
              `  payload:  ${payload.slice(0, 200)}${payload.length > 200 ? "…" : ""}\n` +
              `  target:   ${BASE_URL}/things/${thing_id}/versions\n\n` +
              `Consequence: publishes a new version visible to all X users. Cannot be undone via this tool.\n\n` +
              `To proceed, call this tool again with the same arguments plus confirm: true.`,
          },
        ],
      };
    }

    // Confirmed branch — single attempt, no retry.
    const result = await writeClient.request<{ version_id: number }>(
      `/things/${thing_id}/versions`,
      {
        method: "POST",
        body: JSON.stringify({ version, payload }),
        headers: { "Content-Type": "application/json" },
      },
    );

    return {
      content: [
        {
          type: "text",
          text: `Published. version_id=${result.version_id}, version=${version}.`,
        },
      ],
    };
  },
);
```

### Write-tool rules (every one is load-bearing)

1. **Description starts with `WRITE ACTION — <consequence>`.** This is the first thing the LLM sees when deciding whether to invoke. The phrasing primes it to surface the preview to the user, not just call.
2. **`confirm: z.boolean().optional()`.** Always optional, never required — the LLM's first call should land in the preview branch.
3. **`confirm !== true` returns a preview with no network call.** The preview must name: inputs, destination, consequence, and the exact re-call instruction. No partial work, no "dry run that uploads to a staging slot" — the preview is a pure formatting operation.
4. **Use the `writeClient` (the one with `retry: { maxAttempts: 1 }`).** Never the read `httpClient`. A 502 mid-write must not get retried.
5. **Return the upstream identifier on success.** Version id, message id, asset id — whatever the platform returns. This gives the user (and the LLM) a handle to verify/check/reverse later.
6. **Confirmation message is short.** One line, the identifier, what was done. No marketing.

---

## Where to put it

Tools are registered in `packages/<platform>/src/register.ts`, between the helper functions and the `return { toolCount, baseUrl }`. Group reads first, writes last, separated by a comment block. Update `toolCount` in the return.

If the platform has no `writeClient` yet and this is the first write tool, declare it near the top of `registerXTools` (see "Required header" above). If the package has no write tools and never will, never declare a `writeClient` — dead code rots.

## After registering

1. Build and typecheck: `npm run build && npm run typecheck` from the package directory.
2. Hand off to `build-test` to scaffold tests. Write tools require **three** specific tests (preview-sends-nothing, confirm performs the action, no-retry-on-5xx) — `build-test` knows the pattern.
3. Smoke test against the standalone bin if possible (see `docs/adding-a-platform.md` § 7 for the stdio JSON-RPC smoke pattern).

## What not to do

- **Don't use the read `httpClient` for writes.** A retried write is a duplicate side effect.
- **Don't skip the preview branch on writes.** Even "small" write tools (rename, tag) must preview first. The cost of an unwanted side effect is much higher than the cost of one extra round-trip.
- **Don't hand-roll fetch.** The shared HTTP client handles Retry-After, 429, exponential backoff, concurrency caps, and User-Agent — re-implementing those per tool is how rate-limit blocklists happen.
- **Don't return raw upstream responses in writes.** Strip to the identifier the user needs. Verbose responses train the LLM to dump them at the user.
- **Don't add a tool whose only consumer is another tool.** If a tool exists purely to set up state for the next tool call, just inline the call. The LLM picks tools by name and dependency hints; intermediate plumbing tools confuse selection.
