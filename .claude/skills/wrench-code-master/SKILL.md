---
name: wrench-code-master
description: The umbrella's coding conventions, distilled from the actual code in packages/core and the platform packages. Manual triggers with "code master", "standards check", "review for conventions", or "code quality check".
allowed-tools: Read, Grep, Glob
---

# Wrench Code Master

The wrench portfolio's coding standards. Anchored to the real patterns in
`packages/core/src/` and the platform packages, not to generic style guides.
Use this when writing new code, reviewing a diff for conventions, or
answering "is this the wrench way to do it?"

## What loads me

I am substrate. I load myself. No prerequisites.

`wrench-cerebral` invokes me as step 3 of its boot sequence. I am usable
standalone for a quick standards check.

## The conventions

### Tool naming

- **Platform tools:** `<platform>_<verb>_<noun>`. Lowercase, underscore-
  separated. Singular nouns unless the operation is intrinsically plural
  (a list, a search). Examples: `nexus_get_mod`, `roblox_list_datastores`,
  `modrinth_search`, `thunderstore_top_mods`.
- **Meta-tools:** `<wrench>_<verb>_<noun>`. ModWrench uses `mw_`
  (`mw_detect_environment`, `mw_parse_crashlog`). MyneWrench uses `myne_`.
  DefWrench uses `def_`. FlyOnWallWrench uses `fow_`. The prefix is the
  product, not the company.
- Generic verbs at the platform layer are forbidden — `get_mod` would be
  ambiguous in the meta-server namespace.

### Write tools

The three rules from playbook §4 are non-negotiable.

1. **`confirm: true` gate.** The tool's zod schema includes a `confirm`
   boolean (optional, default false). When `confirm !== true`, return a
   structured preview and perform no upstream call. Only on a re-call with
   `confirm: true` does the handler act.
2. **Retry-disabled write client.** Instantiate a second HTTP client via
   `createHttpClient({ ..., retry: { maxAttempts: 1 } })` and use it
   exclusively for write paths. Auto-retrying a non-idempotent write on a
   transient 5xx can publish twice, send twice, upload twice.
3. **`WRITE ACTION` description prefix.** The tool's MCP description starts
   with `WRITE ACTION —`, then a one-sentence statement of the upstream
   consequence in plain language ("goes LIVE to players immediately,"
   "sends data to your live game servers"). Then how the model should
   behave: show the preview, get a yes, re-call with `confirm: true`.

Canonical reference: `mynewrench/packages/roblox/src/register.ts`
(`roblox_send_message`, `roblox_publish_place`).

Preview shape: structured prose, not a serialized payload. List the inputs.
Name the destination concretely ("universe 12345, topic `live-config`").
End with the exact re-call instruction. A good preview is something the
creator can read aloud and recognize before approving.

### Error envelope

Throw `McpwrenchError` from `@mcpwrench/core`. Three fields the caller
relies on:

- `code` — `<platform>_<reason>`, lowercase, underscore-separated.
  Standard reasons: `http_error`, `network_error`, `retries_exhausted`.
  New per-platform codes follow the same pattern.
- `status` — the upstream HTTP status when the failure was HTTP.
- `meta.body` — first 500 bytes of the response body. `meta.url` — the URL
  that failed.

The HTTP client constructs these automatically when given
`errorCodePrefix: "<platform>"`. See `packages/core/src/http.ts`.

Let `McpwrenchError` propagate. The MCP SDK formats thrown errors into
structured tool-error responses the LLM can read. Catch only to add context
("while fetching mod 12345") — never to swallow.

### Credential resolution

Every platform loads credentials through `loadCredential()` in
`packages/core/src/auth.ts`. The chain:

1. OS keychain (`getStoredToken()`, service name `modwrench-<service>`).
2. Env var fallback (e.g. `NEXUS_API_KEY`, `ROBLOX_API_KEY`).
3. Fail loud — name the missing env var and include the platform's
   `authHint` pointing at `<wrench>-<platform> auth login`.

The returned `Credential` is a discriminated union (`source: "keychain"` vs
`source: "env"`). The platform package branches on `source` to choose the
auth header shape (Bearer vs. `apikey` vs. `x-api-key` vs. ...). Core does
not know upstream-specific header quirks.

Never persist credentials to repo files. `.env` is gitignored,
developer-local, and is not a deployment mechanism.

### Test pattern

Tests are `fetch`-mocked, not network-hitting. Each tool test asserts the
shape the platform actually sends and the envelope the caller receives.

Reference: `packages/thunderstore/test/register.test.ts`. The pattern:

1. Mock `globalThis.fetch` to return a canned `Response`.
2. Invoke the tool's handler with realistic inputs.
3. Assert on the captured `fetch` call:
   - **URL shape** — path, query string, no leaked secrets in the URL.
   - **Auth header** — Bearer / apikey / etc. correct for the credential
     source, present when expected, absent when the API needs none
     (Thunderstore reads, Modrinth public).
   - **Query params** — every optional parameter the schema accepts,
     verified both present and absent.
4. Assert on the result — attribution fields present, error envelope
   shape on failure paths (`code`, `status`, `meta.body`).

Write-tool tests additionally assert the `confirm: false` preview path
does not call `fetch` at all, and the `confirm: true` path calls it
exactly once.

### Style

- **No emojis in committed files** unless the user explicitly asks. This
  includes code comments, READMEs, changelogs, commit messages, and skill
  bodies.
- **Direct, concrete prose.** Match the voice of `docs/playbook.md` and
  the root `README.md`. State the rule, give a one-sentence reason, move
  on. No marketing language ("powerful," "seamless," "amazing"). No
  preachy framing. No exclamation points.
- **Comments where the WHY isn't obvious from well-named code.** A comment
  that restates what the next line does is noise. A comment that names a
  constraint (the libsecret-unavailable Linux case, the
  non-idempotent-write rationale, the RFC 9110 §10.2.3 Retry-After
  parsing) earns its keep. See the top-of-file blocks in
  `packages/core/src/http.ts` and `packages/core/src/auth.ts` for the
  voice.
- **No fake tools.** If the upstream API doesn't support the operation,
  the tool does not exist. The UEFN package in MyneWrench
  (`mynewrench/packages/uefn/src/register.ts`) is the canonical
  placeholder shape — fully scaffolded, zero tools registered, top-of-file
  comment names exactly what's blocked. See `brain-honest-blocker` for
  when this applies.

### Logging

Structured JSON to stderr, never stdout. Stdout is reserved for MCP
protocol traffic. Use the `log()` helper from `@mcpwrench/core`; do not
`console.log`. A stray `console.log` in a platform package corrupts the
MCP stream and breaks the client silently.

## Operating notes

- This skill states conventions. It does not auto-fix code. Pair with
  `brain-trust-check` for trust-posture audits, `brain-fail-loud` for
  silent-fallback conversions, `brain-attribution-check` for attribution
  audits.
- When a convention in this skill disagrees with code that's already in
  `main`, the code wins. Update this skill (and the playbook) via PR.
- When reviewing a diff, walk the conventions in order: naming, write
  discipline, error envelope, credential chain, tests, style. Most
  convention failures cluster in one of the first three.
