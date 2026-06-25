---
name: wrench-cerebral
description: Orchestrator and entry point for any session working on an MCPwrench product (ModWrench, MyneWrench, DefWrench, FlyOnWallWrench). Manual triggers with "wrench cerebral", "load the wrench brain", "start a wrench session", "let's work on modwrench", "let's work on mynewrench", "let's work on defwrench", or "let's work on flyonwallwrench". Also auto-loads when any build-* or brain-* wrench skill is invoked.
allowed-tools: Read, Grep, Glob
---

# Wrench Cerebral

The entry point. When the user starts a session on a wrench product, or when
any other wrench skill (build-* or brain-*) is invoked, this skill runs first
and seeds the working memory.

## What loads me

I am substrate. I load myself. No prerequisites.

## What I do, in order

### 1. Detect the active wrench

Read the repo root's `package.json` and the top of `README.md`.

- `name` starts with `mcpwrench` or contains "ModWrench" in the README first
  heading → active wrench is **modwrench**.
- `name` contains `mynewrench` or the README first heading says MyneWrench →
  **mynewrench**.
- Same pattern for **defwrench** and **flyonwallwrench**.
- If none match, report `none-detected` and continue. A session can be
  productive in a sibling repo or a fresh checkout; the rest of the cerebral
  still applies.

Do not guess from the directory name alone — worktrees and forks rename freely.
The `package.json` `name` field and the README's first heading are the truth.

### 2. Load the umbrella spec

Invoke the **wrench-playbook** substrate skill. It reads `docs/playbook.md`
(or the sibling-repo / raw fallback path) and surfaces the eight sections by
name. The playbook is the umbrella's shared spec — trust posture, credential
chain, write-tool discipline, error envelope, naming, fail-loud philosophy,
new-product checklist. Every other wrench skill assumes the playbook is in
context.

### 3. Load the coding standards

Invoke the **wrench-code-master** substrate skill. It carries the umbrella's
real conventions — tool naming, write-tool description format, error codes,
credential resolution, test pattern, prose style — anchored to the actual
files in `packages/core/` and the platform packages.

### 4. State the 12-skill catalog

Surface the catalog so the model knows what's available without searching.
The substrate is loaded; the rest are invoked by name or by trigger phrase.

**Substrate (this tier — always load first):**

- **wrench-cerebral** — this skill. Orchestrator.
- **wrench-playbook** — the umbrella spec in context.
- **wrench-code-master** — the umbrella's coding conventions.

**Build tier (invoked when shipping):**

- **build-wrench** — scaffold a new wrench product end to end (package layout, workspaces, core dep, license, DCO).
- **build-platform** — scaffold a new `@<wrench>/<platform>` package (register.ts, auth.ts, exports map, tests).
- **build-tool** — register a new tool: read tool or confirmation-gated write tool with the no-retry write client.
- **build-test** — generate the standard fetch-mocked test scaffold for a tool or platform package.

**Brain tier (invoked when reasoning):**

- **brain-pattern** — surface the canonical example of a wrench pattern (write-gate, error envelope, fail-loud blocker, etc.) with the exact file:line to read.
- **brain-audit** — audit the current diff against the Playbook trust posture (writes without confirm, telemetry, credentials in logs, marketing language).
- **brain-recall** — search across all four wrench repos for prior decisions on a topic.
- **brain-research** — route an external research task to Context7 docs / WebSearch / WebFetch / deep-research agent.
- **brain-promote** — propose a proven pattern as a Playbook rule so all four wrenches inherit it.

If a skill in this list isn't on disk yet, say so. The other tiers are being
written in parallel; missing skills are not failures.

### 5. Confirm the loaded state

End with one line, no preamble:

```
Wrench Cerebral — substrate loaded. Active wrench: <name>. 12 skills available.
```

Use the detected name. If detection returned `none-detected`, say so honestly.

## Operating notes

- This skill does no work beyond loading. It does not modify files, run
  commands, or fetch the network. It reads `package.json` and `README.md`,
  invokes two sibling substrate skills, and reports.
- If `docs/playbook.md` is missing in the current repo, wrench-playbook will
  handle the sibling-repo and raw-URL fallbacks. Don't pre-empt that here.
- The user can re-invoke this skill mid-session to reset working memory. That
  is the supported way to recover from a long thread that has drifted.
- Other wrench skills (build-*, brain-*) declare a Prerequisites block. When
  they list `wrench-cerebral` as a prerequisite, this skill ran first.
