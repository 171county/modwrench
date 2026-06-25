---
name: brain-promote
description: When a pattern has proven out in one wrench, propose its addition to the umbrella Playbook so the other three wrenches inherit it. Manual trigger with "promote this pattern", "add to the playbook", "make this an umbrella rule", or "brain promote".
allowed-tools: Read, Grep, Glob, Bash, WebFetch
---

# Brain: Promote

## Prerequisites

- Loads `wrench-cerebral` (the substrate) if not already active.
- Reads from `wrench-playbook` for the Playbook's structure and from `wrench-code-master` for the umbrella's repo layout.
- Pairs with `brain-recall` (to confirm the pattern is not already documented) and `brain-pattern` (to cite the canonical example once promoted).

## What this skill does

Take a pattern that has shipped in at least one wrench and walk it through promotion to the umbrella Playbook (`docs/playbook.md` in this repo). The output is a PR against modwrench with the proposed Playbook edit, plus a checklist of follow-up PRs for the other three wrench repos to adopt the now-canonical pattern.

This is the portfolio-coherence loop. It is what makes the cerebral system more than the sum of four solo brains.

## The procedure

### Step 1 — Confirm the pattern is real

Ask, or verify from context:

- **Which wrench?** Name one of the four: ModWrench, MyneWrench, DefWrench, FlyOnWallWrench.
- **Which file:line?** The canonical example. If the user cannot point at one, the pattern is not ready to promote.
- **How many tests cover it?** A pattern with zero tests is a pattern with zero evidence it works.
- **How long has it shipped?** A pattern released this morning has not proven out yet. Two weeks of green main is a rough floor.

If any of the four answers is missing or weak, say so and stop. Do not promote on vibes.

### Step 2 — Check it is not already documented

Run `brain-recall` against the topic across all four repos. If the Playbook (in any repo) already names the rule, the work is "tighten the wording" or "expand the example," not "add a new section." Adjust the plan.

Also grep this repo's `docs/playbook.md` directly:

```bash
# Use the Grep tool with the pattern name across docs/playbook.md.
```

### Step 3 — Pick the Playbook section

The Playbook organizes rules into a fixed set of sections. Place the new rule in the section that best fits:

- **Trust posture** — user-visible guarantees (no telemetry, attribution, etc.)
- **Credential chain** — how secrets are sourced, stored, and presented to upstream APIs
- **Write discipline** — confirm gates, retry-disabled clients, side-effect handling
- **Error envelope** — `McpwrenchError` shape, code prefixes, status, body truncation
- **Tool naming** — `<platform>_<verb>_<noun>`, read vs write verbs, parameter conventions
- **Fail-loud** — honest blockers, no stub tools, comments-where-tools-would-be
- **Adding a wrench** — the umbrella-level checklist for a new package or product

If the pattern does not fit any of these, the Playbook needs a new section. Flag that explicitly to the user — adding a new section is a bigger conversation than adding a rule under an existing one.

### Step 4 — Draft the addition

One paragraph. Direct voice. The shape:

> **Rule name.** What the rule is, in one sentence. Why it exists, in one sentence. The canonical reference: `<file path>` (anchor: `<grep target>`). Status: shipped in `<wrench>` since `<date>`; adoption pending in the other three.

No marketing language. No "we believe" / "we are committed to" framing — state the rule and move on. If the rule has a known exception (e.g. "reads from public APIs do not require auth headers"), name it in the same paragraph.

### Step 5 — Open the PR against modwrench

This repo's GitHub MCP is available. Open a PR:

- **Branch:** `playbook/promote-<short-pattern-name>`
- **Title:** `playbook: promote <pattern> to umbrella rule`
- **Body:**
  - One paragraph: what is being promoted and why now.
  - The diff (the section addition to `docs/playbook.md`).
  - **Follow-up adoption checklist** — one box per non-modwrench wrench, naming the file each one should update to point at the new umbrella rule:
    - `[ ] MyneWrench — update docs/playbook.md to cite umbrella rule "<rule name>"`
    - `[ ] DefWrench — same`
    - `[ ] FlyOnWallWrench — same`
  - A line stating that this session can only push to modwrench; the other three need separate PRs in their own repos.

If GitHub MCP write access is unavailable for any reason, output the proposed patch (in unified-diff form) and the PR body text, and instruct the user to apply manually.

### Step 6 — Surface the follow-up work

End the response with the checklist again, this time as a chat-visible list so the user can carry it forward in whichever session they next touch each of the other three repos:

```
Follow-up PRs needed (separate sessions, separate repo write access):
- [ ] MyneWrench: link <rule name> from its docs/playbook.md to the modwrench umbrella entry
- [ ] DefWrench: same
- [ ] FlyOnWallWrench: same
```

## Output shape

```
Promotion proposal: <pattern name>

Origin: <wrench>, <file:line>, shipped <date>, <N> tests
Existing coverage: <result from brain-recall — none, or "tightening" target>
Playbook section: <one of the named sections, or "new section needed">

Proposed addition to docs/playbook.md:

> <one-paragraph draft>

PR: <URL once opened, or "unable to open — patch follows"></br>

Follow-up checklist:
- [ ] MyneWrench: ...
- [ ] DefWrench: ...
- [ ] FlyOnWallWrench: ...
```

## What this skill does not do

- Does not promote a pattern that has not shipped. Drafts and proposals belong elsewhere.
- Does not push commits or merge PRs. It opens a PR; the user reviews and merges.
- Does not update the other three wrench repos directly. Cross-repo write access is not in scope for this session.
- Does not rewrite existing Playbook rules without explicit instruction. Adjusting wording on a rule that already exists is a separate, narrower task.
- Does not invent the canonical reference. If the user cannot point at file:line, the pattern is not ready to promote and the skill says so.

## A note on the loop

The promotion loop is what keeps the four wrenches from drifting into four different products that share a logo. Each promotion is small. The cumulative effect, over many promotions, is an umbrella that actually behaves like one.

Promote less than you want to. Each rule in the Playbook is a constraint on every future wrench. The bar is "this has shipped, it works, and the other three would be worse off without it" — not "this is interesting."
