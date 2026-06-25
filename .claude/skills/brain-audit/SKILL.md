---
name: brain-audit
description: Audit the current git diff against the MCPwrench Playbook's trust posture and flag violations with file:line citations. Manual trigger with "audit the diff", "trust posture check", "playbook check", "review for compliance", or "brain audit".
allowed-tools: Read, Grep, Glob, Bash
---

# Brain: Audit

## Prerequisites

- Loads `wrench-cerebral` (the substrate) if not already active.
- Reads from `wrench-playbook` for the rule definitions and `wrench-code-master` for repo conventions.

## What this skill does

Run a fixed checklist against the staged and unstaged diff on the current branch. Report each violation as `file:line — <one-line description>`. No fixes applied. No subjective code-review style commentary. This is the "did we break a Playbook rule" pass; correctness review is `code-review`'s job.

## When to use it

- Before opening a PR.
- After taking a diff from another agent and before merging it down.
- When something feels off and you want a structured second look.

If the diff is empty, say so and stop. Do not audit history.

## The checks

Run them in order. Each check has a command to execute and a rule for what counts as a violation. Cite every violation as `file:line — description`. Group them by check at the end.

### Check 1 — Write without confirm gate

Every new tool whose description contains "WRITE ACTION" (or whose handler calls a `writeClient`) must accept a `confirm` parameter and branch on `confirm !== true` to return a preview rather than perform the write.

Commands:

```bash
git diff --cached --diff-filter=AM -- 'packages/**/register.ts' 'mynewrench/packages/**/register.ts'
git diff --diff-filter=AM -- 'packages/**/register.ts' 'mynewrench/packages/**/register.ts'
```

Then for each new tool registration in the diff that mentions "WRITE ACTION":

```bash
git diff -U30 -- <file> | grep -nE 'confirm: z\.|confirm !== true|writeClient'
```

Violation: a WRITE ACTION tool added with no `confirm !== true` branch in the handler.

### Check 2 — Telemetry / phone-home

The Playbook forbids ModWrench (and every wrench) from phoning home. The only outbound fetches allowed are to the upstream platform APIs declared via `baseUrl` in each `register.ts`.

Commands:

```bash
git diff --diff-filter=AM | grep -nE 'fetch\(|new URL\(|http\.get|axios|got\(' | grep -vE 'baseUrl|opts\.baseUrl'
git diff --diff-filter=AM | grep -niE 'analytics|telemetry|sentry|mixpanel|segment|posthog|amplitude|datadog'
```

Violation: a fetch added that does not target an upstream platform baseUrl declared in the same package, or any import of a telemetry library.

### Check 3 — Credentials in logs or stdout

Credential variables must never be logged, stringified into log lines, or written to stdout. `process.stderr.write` is allowed for structured JSON log records that do not include credential fields.

Commands:

```bash
git diff --diff-filter=AM | grep -nE 'log\(|console\.log|console\.error|stderr\.write|stdout\.write' -A 2 | grep -iE 'token|apikey|api_key|password|secret|credential|bearer|authorization'
git diff --diff-filter=AM | grep -nE 'JSON\.stringify' -A 2 | grep -iE 'credential|token|auth'
```

Violation: any of the above grep hits inside the diff context. Inspect each — false positives are common (a comment naming "token" is fine; logging `cred.access_token` is not).

### Check 4 — Read tool using writeClient (or write tool using read client)

Reads must use the retry-enabled `httpClient`; writes must use the retry-disabled `writeClient`. Mismatches indicate the implementer wired up the wrong client.

Commands:

```bash
git diff --diff-filter=AM -- '**/register.ts' | grep -nE 'name: "[a-z_]+",' -A 50 | grep -nE 'writeClient|httpClient'
```

Violation: a tool with a "read" name (e.g. `_get_`, `_list_`, `_search_`) using `writeClient`, or a tool with a write name (e.g. `_create_`, `_update_`, `_publish_`, `_delete_`) using `httpClient` for the request.

### Check 5 — Marketing language in user-facing strings or docs

The Playbook bans marketing language in committed text. The forbidden list includes "amazing", "powerful", "seamless", "blazing", "revolutionary", "game-changing", "next-generation", "world-class".

Commands:

```bash
git diff --diff-filter=AM -- '*.md' '*.ts' '*.tsx' | grep -niE 'amazing|powerful|seamless|blazing|revolutionary|game-changing|next-generation|world-class|cutting-edge|state-of-the-art'
```

Violation: any hit in added lines. Tighten or remove.

### Check 6 — Emojis in committed files

Emojis are not used in committed `.md` or `.ts` files unless the user has explicitly requested them for a specific surface.

Commands:

```bash
git diff --diff-filter=AM -- '*.md' '*.ts' '*.tsx' '*.json' | grep -nP '^[+]' | grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]'
```

Violation: any added line containing an emoji. Flag for removal. If the user explicitly requested it for that file, note the exception and move on.

### Check 7 — Fake tools without honest-blocker note

If a new platform package ships with `toolCount: 0` (or registers no tools), `register.ts` must carry a comment explaining what is blocked, by whom, and what would unblock it. We do not ship stub tools, and we do not ship silent zero-tool packages.

Commands:

```bash
git diff --diff-filter=AM -- '**/register.ts' | grep -nE 'toolCount: 0|tools: \[\]'
```

Violation: a `toolCount: 0` or empty `tools: []` registration added without a nearby comment block (within 20 lines above) explaining the blocker.

## How to run the audit

1. Run `git status` to confirm there is a diff. If clean, stop.
2. Run each check in order. Capture violations into a list as you go.
3. If a check returns zero hits, write a single line: `Check N: clean.`
4. If a check returns hits, list each violation as `file:line — <description>`.
5. End with a summary: total violations, and which checks were involved.

## Output shape

```
Audit results

Check 1 (confirm gate): <clean or violations>
Check 2 (telemetry): <clean or violations>
Check 3 (creds in logs): <clean or violations>
Check 4 (client mismatch): <clean or violations>
Check 5 (marketing language): <clean or violations>
Check 6 (emojis): <clean or violations>
Check 7 (fake tools): <clean or violations>

Summary: <N> violations across <M> checks.
```

## What this skill does not do

- It does not fix violations. The user (or `simplify` / a follow-up commit) handles fixes.
- It does not block the commit — this is advisory. The user decides whether each violation is real.
- It does not audit logic correctness, performance, or test coverage. Use `code-review` for those.
- It does not run against branches other than the current working tree. Compare-against-main is a separate flow.
