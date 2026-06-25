---
name: wrench-playbook
description: Loads the MCPwrench Playbook — the umbrella's cross-product spec — into working memory. Manual triggers with "load the playbook", "wrench playbook", "show me the trust posture", "what are the umbrella conventions", or "playbook check".
allowed-tools: Read, Bash
---

# Wrench Playbook

The MCPwrench Playbook (`docs/playbook.md` in the ModWrench repo) is the
umbrella's shared spec. Every wrench product follows it. This skill puts it
in context.

## What loads me

I am substrate. I load myself. No prerequisites.

`wrench-cerebral` invokes me as step 2 of its boot sequence, but I am usable
standalone whenever someone says "playbook check" or asks about umbrella
conventions.

## What I do

### 1. Locate and read the playbook

Try in this order, stop on first hit:

1. **In-repo:** `docs/playbook.md`. This is the path when the active wrench
   is ModWrench, or when working inside the modwrench monorepo from a
   worktree.
2. **Sibling wrench:** `../modwrench/docs/playbook.md`. MyneWrench,
   DefWrench, and FlyOnWallWrench are commonly checked out as siblings of
   the modwrench repo. This is the path for those.
3. **Raw fallback:** fetch `https://raw.githubusercontent.com/171county/modwrench/main/docs/playbook.md`.
   Use this when neither local path resolves — usually a fresh clone or a
   CI environment. If the network is unreachable, surface a fail-loud
   message naming the two local paths that were tried and stop. Do not
   substitute remembered content.

### 2. Surface the eight sections by name

The playbook is structured. Name the sections so the model has a navigation
index without re-reading the whole file each time someone asks about one
slice.

1. **What MCPwrench is** — umbrella definition, current product line
   (ModWrench, MyneWrench, DefWrench, FlyOnWallWrench), the `@mcpwrench/core`
   dependency rule.
2. **The trust posture** — the six non-negotiable rules: no telemetry, no
   personal data persisted, attribution preserved end-to-end, upstream
   permissions respected, rate limits respected, read by default / write
   with confirmation.
3. **Credential resolution chain** — `loadCredential()` in
   `packages/core/src/auth.ts`: keychain → env var → fail loud with hint.
   Includes the Linux libsecret / Steam Deck Game Mode case.
4. **Read-by-default, publish-with-confirmation** — the three write-tool
   rules: `confirm: true` gate, retry-disabled write client
   (`maxAttempts: 1`), `WRITE ACTION` description prefix.
5. **Error envelope** — `McpwrenchError` with platform-prefixed codes
   (`<platform>_http_error`, `<platform>_network_error`,
   `<platform>_retries_exhausted`), 429 / 5xx / 4xx / network rules from
   `packages/core/src/http.ts`.
6. **Tool naming conventions** — `<platform>_<verb>_<noun>` for platform
   tools, `<wrench>_` prefix for meta-tools (`mw_`, `myne_`, `def_`,
   `fow_`), mandatory `.describe()` on every zod field.
7. **Fail loud philosophy** — no silent fallback, no fake tools when the
   upstream doesn't exist (UEFN is the canonical placeholder).
8. **Adding a new wrench product** — name reservation, distinct audience,
   depend on core, follow this playbook, mirror the repo shape, update the
   umbrella list, link from `CONTRIBUTING.md`, stay Apache 2.0 + DCO.

### 3. State the precedence rule

End the load with one line, verbatim:

> The playbook is the umbrella spec. When code and playbook disagree, the
> code wins and the playbook gets a PR.

The skill `brain-playbook-diff` (when it lands) handles drafting the
reconciling PR.

## Operating notes

- This skill loads documentation. It does not modify the playbook, propose
  changes, or audit code against it. Use `brain-trust-check`,
  `brain-playbook-diff`, or `wrench-code-master` for those.
- If the playbook is in context already from an earlier turn, do not re-read
  the file — name the sections and the precedence rule and stop. Re-reading
  a 400-line document on every invocation burns tokens for no gain.
- The playbook references specific files
  (`packages/core/src/auth.ts`, `packages/core/src/http.ts`,
  `mynewrench/packages/roblox/src/register.ts`,
  `mynewrench/packages/uefn/src/register.ts`). When the user's question is
  about one of those concretely, read the cited file rather than
  paraphrasing the playbook's summary of it.
