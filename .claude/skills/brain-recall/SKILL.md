---
name: brain-recall
description: Search across all MCPwrench portfolio repos (ModWrench, MyneWrench, DefWrench, FlyOnWallWrench) for prior decisions on a topic and return where, when, and what was decided. Manual trigger with "have we done X before", "find prior decisions on X", "brain recall X", or "cross-repo search".
allowed-tools: Read, Grep, Glob, Bash, WebFetch
---

# Brain: Recall

## Prerequisites

- Loads `wrench-cerebral` (the substrate) if not already active.
- Reads from `wrench-playbook` for what counts as a "decision" and `wrench-code-master` for the umbrella repo layout.

## What this skill does

Given a topic — e.g. "binary upload", "confirm-gate write tool", "OAuth PKCE", "rate limit handling", "Steam Deck keychain fallback" — search across the four wrench repos and report: which wrench has touched this topic, in which file, what was decided, and on what date.

Read-only. Cross-repo reference only. No clones, no writes, no pushes.

## The four repos

- **ModWrench** — `github.com/171county/modwrench` (this checkout; native game modding)
- **MyneWrench** — `github.com/171county/mynewrench` (UGC platforms — Roblox, UEFN)
- **DefWrench** — `github.com/171county/defwrench` (defensive / security tooling under the wrench banner)
- **FlyOnWallWrench** — `github.com/171county/flyonwallwrench` (passive listening / observation tier)

The current session's GitHub MCP integration is scoped to `171county/modwrench` only. So the recall procedure splits by repo:

- For ModWrench (this checkout): `Grep` and `Bash` on the local working tree.
- For MyneWrench, DefWrench, FlyOnWallWrench: `WebFetch` on `https://raw.githubusercontent.com/171county/<repo>/main/<path>` for a known list of files, then in-memory grep on the fetched text.

## The procedure

1. **Restate the topic.** One sentence. If the request is vague ("tell me about auth"), narrow it with the user before searching.

2. **Local pass — modwrench.** Run targeted searches:

   ```bash
   git log --all --oneline --grep '<topic keyword>'
   git log --all -p -S '<distinctive code or phrase>' -- '*.ts' '*.md'
   ```

   Plus a content grep:

   ```bash
   # Use the Grep tool with the topic as the pattern, over docs/, packages/, CHANGELOG.md, ROADMAP.md.
   ```

3. **Cross-repo pass — the other three wrenches.** For each of `mynewrench`, `defwrench`, `flyonwallwrench`, fetch this canonical set in parallel and grep their content for the topic:

   - `https://raw.githubusercontent.com/171county/<repo>/main/README.md`
   - `https://raw.githubusercontent.com/171county/<repo>/main/CHANGELOG.md`
   - `https://raw.githubusercontent.com/171county/<repo>/main/ROADMAP.md`
   - `https://raw.githubusercontent.com/171county/<repo>/main/docs/playbook.md`
   - `https://raw.githubusercontent.com/171county/<repo>/main/docs/adding-a-platform.md` (if present)

   If a fetch returns 404, that file does not exist on `main` — note it and move on.

4. **Synthesize.** For each hit, report:

   - **Wrench:** which of the four
   - **File:** path (and URL if remote)
   - **Decision:** the one-sentence outcome
   - **Date:** the CHANGELOG entry date if available, or the commit date from `git log` for local hits, or "undated" if neither is recoverable
   - **Excerpt:** 1–3 lines of the actual text so the user can verify

5. **State the limits.** Explicitly tell the user what you could not check:

   - PR discussions and commit history beyond what is on `main` for the three non-modwrench repos (no MCP access).
   - Private notes, draft branches, or repos not in this list.
   - Anything indexed only in the substrate skills (`wrench-cerebral` etc.) — those are searchable separately.

## Output shape

```
Topic: <restated>

Findings:

1. <Wrench> — <file>
   Decision: <one sentence>
   Date: <YYYY-MM-DD or "undated">
   Excerpt: "<1-3 lines>"

2. ...

Not checked:
- <repo or surface> — <why>
```

If there are no findings, say so plainly. Do not invent decisions. "We have not made a recorded decision on this topic across the four wrenches" is a useful, honest result.

## What counts as a decision

- A CHANGELOG entry that ships behavior under this topic.
- A ROADMAP entry that commits or defers the topic with reasoning.
- A docs/playbook.md section that names a rule on the topic.
- A merged PR or commit with a message that decides the topic.
- A code comment that explicitly names a tradeoff (e.g. "we use X here because Y; not Z because Z breaks W").

What does not count: a tool's name including a related word, a passing mention in a README paragraph, or a TODO comment. Note those as "mentions" if they help context, but do not promote them to "decisions."

## What this skill does not do

- Does not clone repos. WebFetch only for non-modwrench wrenches.
- Does not perform writes, open issues, or push commits.
- Does not search GitHub Issues or PRs on the non-modwrench repos (no MCP access in this session). If the user needs that, point them at the GitHub UI and offer to draft the search query.
- Does not synthesize decisions across wrenches into a new rule — that is `brain-promote`'s job.
