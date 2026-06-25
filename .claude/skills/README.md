# Wrench Cerebral — skills catalog

The portable cognitive layer for the MCPwrench umbrella (ModWrench, MyneWrench, DefWrench, FlyOnWallWrench). Twelve Claude Code skills that travel with the repo and keep work across the four products coherent.

This is the **portable adaptation** of the larger Brain Layer that lives on the maintainer's Windows machine (`D:\Brain\` + Qdrant + Graphiti + PowerShell hooks). The skills here strip the Windows-specific infrastructure and replace it with file-system and repo-relative references so the same cognitive contract — substrate loads first, brain reasons, build produces — works inside a Linux container, in a CI runner, in a fresh checkout, anywhere Claude Code can read a directory.

## How loading works

Three substrate skills always load first. They carry the umbrella spec, the coding conventions, and a catalog of the other nine skills into working memory before any work happens. Any non-substrate skill's `Prerequisites` block names the substrate; invoking a build-* or brain-* skill in a fresh session brings the substrate with it.

The entry point is **wrench-cerebral**. Trigger it explicitly with phrases like:

```
let's work on modwrench
load the wrench brain
start a wrench session
```

Or just invoke any build-* / brain-* skill — its Prerequisites block will pull the substrate.

The user-facing confirmation when substrate has loaded is one line, no preamble:

```
Wrench Cerebral — substrate loaded. Active wrench: <name>. 12 skills available.
```

If the line doesn't appear, the substrate did not actually load — re-invoke `wrench-cerebral` to reset.

## The 12 skills

### Substrate (load first, always)

| Skill | Purpose |
|---|---|
| `wrench-cerebral` | Orchestrator. Detects the active wrench, loads the other two substrate skills, names the catalog. |
| `wrench-playbook` | Reads `docs/playbook.md` (with sibling-repo and raw-URL fallbacks) and surfaces the eight section headings. |
| `wrench-code-master` | The umbrella's coding conventions — naming, write-tool format, error codes, credential resolution, test pattern, prose style. |

### Build tier (action / creation)

| Skill | Purpose |
|---|---|
| `build-wrench` | Scaffold a new wrench product end to end (package layout, workspaces, core dep, license, DCO). |
| `build-platform` | Scaffold a new `@<wrench>/<platform>` package (register.ts, auth.ts, exports map, tests). |
| `build-tool` | Register a new tool — read tool or confirmation-gated write tool with the no-retry write client. |
| `build-test` | Generate the standard fetch-mocked test scaffold for a tool or platform package. |

### Brain tier (knowledge / judgment)

| Skill | Purpose |
|---|---|
| `brain-pattern` | Surface the canonical example of a wrench pattern with the exact file:line to read. |
| `brain-audit` | Audit the current diff against the Playbook trust posture. |
| `brain-recall` | Search across all four wrench repos for prior decisions on a topic. |
| `brain-research` | Route an external research task to Context7 docs / WebSearch / WebFetch / deep-research. |
| `brain-promote` | Propose a proven pattern as a Playbook rule so all four wrenches inherit it. |

## Discovery

Claude Code discovers skills by walking `.claude/skills/<name>/SKILL.md`. Each skill is a folder; each `SKILL.md` carries YAML frontmatter with `name`, `description` (containing the trigger phrases), and `allowed-tools`. The skill body is the instruction Claude follows when the skill is invoked.

To verify discovery, start a new session in this repo and say "load the wrench brain." The substrate should load and report the one-line confirmation. If it doesn't, the `.claude/skills/` directory isn't being walked — check `.gitignore` (this repo allows the directory via `!.claude/skills/`).

## Where the master lives

The canonical source of truth for these skills is in Google Drive: `Cog in the Machine/Wrench Cerebral/`. The copies here are mirrors so the substrate travels with every wrench repo checkout. When the skills change, the workflow is:

1. Edit in the Drive folder (so the master stays current).
2. Mirror into every wrench repo's `.claude/skills/`.
3. Commit + push per repo.

The Drive folder sits next to two siblings:

- `Cog in the Machine/Cog Machine/` — the production Windows-native cognitive skill set with PowerShell hooks and Brain Layer infra (`D:\Brain\`, Qdrant, Graphiti, Ed25519 signing). That set is richer; this set is portable.
- `Cog in the Machine/Wrench to the Brain/` — the running Brain Layer stores (procedural / episodic / semantic / traces) populated on the maintainer's machine.

## Adding a new skill to the set

1. Decide which tier the skill belongs to (substrate / build / brain).
2. Create `.claude/skills/<skill-name>/SKILL.md` with the standard frontmatter and (for non-substrate) a `## Prerequisites` block.
3. Match the prose voice (direct, honest, concrete file/line citations, no emojis, no marketing language).
4. Add the skill to `wrench-cerebral`'s catalog so the orchestrator names it on load.
5. Add a row to this README's catalog table.
6. Mirror to the Drive folder. Commit.

The Playbook's `brain-promote` skill is the right tool when the new skill encodes a pattern that should also become an umbrella rule.

## Voice rules (enforced by `brain-audit`)

- No emojis in committed files.
- No marketing language ("amazing," "powerful," "seamless," "blazing," "revolutionary," etc.).
- State the rule, give a one-sentence reason, move on.
- Cite file:line where it helps; don't cite for citation's sake.
- No preachy moralizing. The rules are the rules — they don't need defending in every section.

These are baked into the skill bodies themselves so the cerebral system enforces them across its own contents, not just against new code.
