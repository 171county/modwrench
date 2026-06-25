---
name: build-wrench
description: Scaffold a new wrench product under the MCPwrench umbrella from zero. Manual triggers "scaffold a new wrench", "create a wrench product", "build a wrench", "new wrench called X", "start a new wrench".
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Build: Wrench

A wrench is a vertical product under the MCPwrench umbrella (ModWrench, MyneWrench, DefWrench, FlyOnWallWrench). Each wrench is its own repo, its own npm scope, its own audience. They share only the substrate (`@mcpwrench/core`) and the playbook.

## Prerequisites
- Load `wrench-cerebral` (the substrate entry) before proceeding.
- `wrench-playbook` and `wrench-code-master` are the operating context — defer to them on voice, trust posture, and code conventions.

## When this fires

The user wants a brand-new wrench product (not a new platform inside an existing wrench, and not a new tool inside a platform). If they're adding a platform, hand off to `build-platform`. If they're adding a tool, hand off to `build-tool`.

## What to ask first

Don't scaffold until these are pinned:

1. **Wrench name.** One word, modder/dev vernacular, ends with "Wrench". Examples: ModWrench, MyneWrench, DefWrench, FlyOnWallWrench. The lowercase form is the npm scope and repo name.
2. **Audience.** Who uses this? "Modders" is too broad — "Skyrim load-order debuggers" or "Roblox studio publishers" or "incident-response SREs" is the altitude. The audience determines tool surface and trust posture.
3. **Why now.** One sentence on the gap this fills. If you can't answer this, the wrench probably shouldn't exist yet.
4. **First platform.** Which API gets wired first? A wrench with zero platforms ships nothing. Pick one and scaffold it via `build-platform` immediately after the skeleton is in place.

## File layout

The shape mirrors `modwrench/` and `mynewrench/`. Copy it; don't invent.

```
<wrench>/
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE                     # Apache 2.0, verbatim
├── SECURITY.md
├── ROADMAP.md
├── VISION.md                   # optional — start with README if scope is small
├── package.json                # workspaces root
├── package-lock.json
├── tsconfig.base.json
├── docs/
│   ├── playbook.md             # link to the umbrella playbook
│   └── adding-a-platform.md    # wrench-specific addendum to the umbrella guide
└── packages/
    ├── <first-platform>/
    └── cli/                    # meta-server composing every platform
```

The `packages/core/` lives in the umbrella, not in the wrench. Wrenches depend on `@mcpwrench/core` from npm.

## Root `package.json`

```json
{
  "name": "<wrench>",
  "version": "0.0.1",
  "private": true,
  "description": "<wrench> — <one-sentence purpose>. Under the MCPwrench umbrella.",
  "type": "module",
  "workspaces": [
    "packages/<first-platform>",
    "packages/cli"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "dev": "npm run dev --workspaces --if-present",
    "clean": "npm run clean --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present"
  },
  "engines": { "node": ">=20.0.0" },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

Workspaces order is explicit (not glob). npm builds in array order; CLI must come last because it imports `./register` types from every platform.

## Name reservation (do this before writing code)

1. **npm scope.** Reserve `@<wrench>` on npm. If taken, pick a different name — collisions don't merge.
2. **GitHub repo.** Create `github.com/<owner>/<wrench>` (or under the user's existing org). Set Apache 2.0 license, default branch `main`, DCO required on PRs.
3. **Domain (optional).** `<wrench>.dev` if available. The User-Agent string each platform sends references the umbrella domain (`+https://mcpwrench.dev`) so per-wrench domains are nice-to-have, not required.
4. **Umbrella registry.** Add the new wrench to the umbrella's product list (the MCPwrench monorepo's README / playbook section listing siblings). Don't ship until it's listed.

## Boilerplate files

- **LICENSE** — verbatim Apache 2.0. Pull from `modwrench/LICENSE`.
- **CONTRIBUTING.md** — DCO required (`git commit -s`), no CLA, link to the umbrella playbook for trust posture.
- **SECURITY.md** — vulnerability disclosure policy, 90-day coordinated disclosure, scope statement. Mirror `modwrench/SECURITY.md`.
- **README.md** — match the voice of `modwrench/README.md`: one-line tagline, "what it does today", "trust posture" (the six non-negotiables — restate them; they apply to every wrench), install, roadmap, "what this is NOT". No marketing language. Concrete examples of a conversation against the wrench's tools.
- **CHANGELOG.md** — Keep a Changelog format, hand-maintained until release-please is wired.
- **ROADMAP.md** — v1 (the first platform), v2 (compound tools if any), v3 (writes). Be honest about what's planned vs shipped.

## Voice rules for the README

Read `modwrench/README.md` once and mirror it. Specifically:

- One-line opener that sounds like a person, not a brand. "One wrench. Every mod platform. No data kept." is the bar.
- "What this is NOT" section — prevents surprises and downstream issues.
- "Trust posture" section restating the six umbrella commitments (no telemetry, no persisted user data, attribution preserved, permissions respected, rate limits honored, read-only by default). These are non-negotiable across every wrench.
- Acknowledgements section — credit the platforms, the communities, the tools you built on.

## After the skeleton lands

1. Hand off to `build-platform` to scaffold the first platform package.
2. Wire `packages/cli/` to compose the platform into a meta-server (mirror `modwrench/packages/cli/src/index.ts`).
3. Run `npm install && npm run build && npm run typecheck` at the workspace root. Fix until green.
4. Commit with DCO: `git commit -s -m "init: scaffold <wrench> skeleton"`.

## What not to do

- Don't fork `modwrench/` wholesale. Copy the shape, not the modder-specific content.
- Don't skip the trust-posture section in the README. Every wrench inherits the six non-negotiables — restating them is the contract with the user.
- Don't add a platform inline in the skeleton commit. Skeleton first, platform via `build-platform` second. Smaller PRs review faster.
- Don't reserve a name you're not going to ship within a quarter. Squatting on npm scopes is rude.
