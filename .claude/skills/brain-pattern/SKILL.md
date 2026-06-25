---
name: brain-pattern
description: Surface the canonical example of a named pattern from the MCPwrench portfolio so the next implementer can copy from a known-good source instead of guessing. Manual trigger with "show the pattern for X", "how do we do X", "canonical example of Y", "brain pattern", or "what's the write-tool pattern".
allowed-tools: Read, Grep, Glob
---

# Brain: Pattern

## Prerequisites

- Loads `wrench-cerebral` (the substrate skill that wires the cerebral system) if not already active.
- `wrench-playbook` and `wrench-code-master` are the substrate this skill draws from; load them before answering.

## What this skill does

Given a pattern name (or a fuzzy description of one), point the user at the file and the searchable anchor that is the canonical example in the MCPwrench portfolio. Read-only. No edits, no suggestions about whether to use the pattern — that is a separate judgment call.

## How to use it

1. Read the user's request and match it to one of the named patterns below.
2. Open the cited file at the searchable anchor. Read enough context (typically 40-80 lines around the anchor) to answer the user accurately.
3. Answer with: the pattern's one-sentence purpose, the file path, the anchor to grep for, and a short excerpt only if the exact code is load-bearing for the question.
4. If the user is about to write new code, point them at the canonical file so they can copy the shape rather than reinventing it. Do not paraphrase the implementation — direct them to read it.

If the user describes a pattern that is not in the list below, say so honestly. Do not invent a canonical reference. Offer `brain-recall` for cross-repo search instead.

## The named patterns

### write-tool confirm-gate

Every write-side tool requires `confirm: true` from the caller. Without it, the tool returns a preview describing what would happen and does not perform the write. This is the structural enforcement of the "writes always require confirmation" rule from the Playbook.

- File: `mynewrench/packages/roblox/src/register.ts`
- Anchor: grep for `confirm !== true`

### retry-disabled write client

Writes use a second `httpClient` constructed with `maxAttempts: 1`. A retry on a half-applied write can double-publish or corrupt state, so the polite-citizen retry behavior is explicitly turned off on the write path.

- File: `mynewrench/packages/roblox/src/register.ts`
- Anchor: grep for `writeClient` and `maxAttempts: 1`

### read tool with httpClient.request

Reads use the shared `httpClient` from `@mcpwrench/core` directly. No tool-specific HTTP code. The platform package contributes only the URL, query params, and the response shape.

- File: `mynewrench/packages/roblox/src/register.ts`
- Anchor: `roblox_get_universe`

### error envelope (HTTP)

Non-retryable HTTP failures throw `McpwrenchError` with a code prefix per platform (e.g. `nexus_http_error`), status, and a truncated body. This shape is what tool handlers translate into MCP error responses.

- File: `packages/core/src/http.ts`
- Anchor: grep for `McpwrenchError`

### error envelope (network)

Network-level failures (DNS, reset, timeout) throw `McpwrenchError` with the `_network_error` suffix and the original cause attached. This lets callers distinguish "the platform said no" from "we never reached the platform."

- File: `packages/core/src/http.ts`
- Anchor: `_network_error`

### credential resolution chain

Boot-time credential lookup: OS keychain first, then env var, then throw a descriptive error that names the env var and points at `auth login`. The thrown error explicitly says when the keychain itself is unavailable (Steam Deck Game Mode, headless Linux) rather than just "no credential found."

- File: `packages/core/src/auth.ts`
- Anchor: `loadCredential`

### auth header routing (env vs keychain)

The `authHeaders` callback returns either `Authorization: Bearer ...` (keychain-sourced OAuth token) or the platform's API-key header (env-sourced legacy key) by branching on `credential.source`. Routing lives in the platform package because each platform's header name differs.

- File: `mynewrench/packages/roblox/src/register.ts`
- Anchor: `authHeaders`

### fail-loud / honest blocker (no fake tools)

When a platform's API does not yet permit the operation we wanted to expose, the package registers zero tools and the `register.ts` carries a comment explaining what is blocked, by whom, and what would unblock it. We do not ship stub tools that return "not implemented" — the absence is the honest signal.

- File: `mynewrench/packages/uefn/src/register.ts`
- Anchor: `toolCount: 0` (read the comment above it)

### dynamic catalog activation

The CLI meta-server composes whichever platform packages the user has configured into one MCP entry. Activation is boot-time based on environment detection, plus a runtime `activate_platform` meta-tool for opt-in. The catalog is personalized per user, not the union of every platform.

- File: `packages/cli/src/catalog.ts`
- Anchor: `MetaCatalog`

### test scaffold

Each platform package has a `test/register.test.ts` that stubs `httpClient`, asserts the tool's argument shape, and verifies the response is passed through unchanged. The confirm-gate path on write tools has its own dedicated test.

- Files:
  - `mynewrench/packages/roblox/test/register.test.ts`
  - `packages/thunderstore/test/register.test.ts`
- Anchor: `describe(` in either file is the entry point.

## What this skill does not do

- It does not judge whether the pattern is the right fit for the current task — that is the implementer's call.
- It does not edit code. If the user wants to apply a pattern, they invoke their normal coding flow after reading the canonical example.
- It does not document new patterns. New patterns are added via `brain-promote` once they have shipped and proven out in at least one wrench.
- It does not cross-reference patterns between repos beyond what is listed above. For "have we done X before," use `brain-recall`.

## Output shape

Keep the answer tight:

```
Pattern: <name>
Purpose: <one sentence>
Canonical: <file path>
Anchor: <grep target or symbol name>
```

Then a short excerpt only when the exact code is load-bearing for the question. If the user has asked a broader question ("how do we structure write tools across the umbrella"), name the two or three patterns that compose into the answer and let the user pull each.
