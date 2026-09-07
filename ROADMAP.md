# ModWrench Roadmap

The full plan, captured here so contributors and prospective users can see where this is going without having to read the chat history.

This document is the source of truth for *where things are going*. For *current capabilities*, see [README.md](README.md). For *trust posture and non-negotiables*, see the relevant section in [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

Status definitions used below:

- **Shipped** â€” running in `main`, tested, available via `npm install`
- **Scaffolded** â€” placeholder directory exists in the monorepo; no implementation yet
- **Planned** â€” design intent, no code or scaffold yet
- **Deferred** â€” intentionally not on the active path; may revisit later

---

## Current state

### v1 â€” Platform bridge âœ… Shipped

- **`@modwrench/nexus`** â€” 12 tools, OAuth (PKCE) + API-key fallback, full read coverage
- **`@modwrench/modio`** â€” 11 tools, OAuth (email code) + API-key fallback, full read coverage
- **`@modwrench/cli`** â€” meta-server composing every installed platform under one MCP entry; `auth` subcommand dispatcher
- **`@modwrench/core`** â€” shared infrastructure (keychain, env, logging, error envelope, credential resolution)

### v2 â€” The compound modder workbench âœ… Shipped

`@modwrench/workbench` â€” 5 atomic tools that compose under LLM reasoning into a conversational diagnostic experience:

- `mw_detect_environment`
- `mw_read_load_order`
- `mw_parse_crashlog`
- `mw_query_mod_metadata`
- `mw_check_known_conflicts`

Test suite: 55 tests, ~0.4s, runs in CI on every PR. See [packages/workbench/test/](packages/workbench/test/) for the fixtures.

`mw_explain` was intentionally not built â€” the LLM formats responses natively and the wiring prompt marked it optional.

### Remote MCP MVP - Shipped

`@modwrench/remote` provides a Streamable HTTP MCP server at `/mcp` for remote-capable clients such as ChatGPT developer-mode apps and API workflows. The MVP exposes only remote-safe public read tools: Thunderstore (7 tools). Nexus, mod.io, and workbench filesystem tools remain local-only until the remote auth/session/storage design is implemented.

Docs: [docs/remote-deployment.md](docs/remote-deployment.md).

---

## On the active path

### v2.5 â€” Dynamic catalog architecture âœ… Foundation shipped

The `MetaCatalog` abstraction in `@modwrench/cli` is live. Platforms register through the catalog rather than inline; the catalog tracks active vs failed state and emits `notifications/tools/list_changed` to MCP clients on activation.

Shipped in this round:
- `MetaCatalog` class managing platform activation lifecycle
- `mw_activate_platform` meta-tool letting the LLM activate dormant platforms at runtime (e.g. after the user adds credentials post-boot)
- `listChanged: true` capability declared on the meta-server so clients re-fetch
- Idempotent activation, failed-state tracking with reason, retry on subsequent calls
- 13 catalog-orchestration tests + smoke-tested end-to-end against live API

Planned next (v2.5.x):
- **Auto-activation policy** â€” currently `activateAll()` tries every platform at boot. The v2.5.1 refinement uses workbench's `detectEnvironment()` (already wired via the new `./detect` export) to choose only platforms relevant to the user's setup, reducing tool-catalog noise for users with focused setups.
- **Per-tool unregistration** â€” would let `mw_deactivate_platform` actually remove tools rather than just dropping platform state. Requires each platform's register function to return tool names; deferred until there's clear demand.

Full architecture spec: [docs/dynamic-catalog-architecture.md](docs/dynamic-catalog-architecture.md).

### v2.6 - Local toolchain integrations - Planned

This is the next layer that makes ModWrench feel like a real modder workbench instead of only a platform bridge. The first pass is read-only and local-first: detect installed tools, parse project/profile state, summarize what the tools already know, and leave writes behind explicit confirmations.

#### Bethesda toolchain

High priority. This is the deepest expert-workflow lane and the clearest place for ModWrench to save users from tab-hopping between tools.

- **xEdit family** - xEdit, SSEEdit, FO4Edit, SF1Edit
  - Planned use: detect installs, invoke safe scripts, summarize record-level conflicts, explain what changed without editing plugins by default.
- **Creation Kit**
  - Planned use: detect installation and project context, surface common setup/version issues, help prepare publishable metadata without taking over authoring.
- **LOOT**
  - Planned use: wrap local CLI runs when present, compare local sort output with live masterlist data, explain load-order moves in plain language.
- **BodySlide / Outfit Studio**
  - Planned use: detect presets/projects and explain missing output, path, or dependency problems.
- **NifSkope**
  - Planned use: inspect asset references and common mesh/material path issues.
- **DynDOLOD, TexGen, xLODGen**
  - Planned use: read logs/config outputs and identify common generation failures.
- **Wrye Bash and Synthesis**
  - Planned use: read patch state, surface stale generated patches, and explain dependency chains.
- **Nemesis and Pandora**
  - Planned use: parse behavior-generation logs and connect failures back to installed animation mods.

#### Unity / BepInEx toolchain

High priority. This follows the Thunderstore/r2modman lane already in the workbench.

- **BepInEx 5 and 6**
  - Planned use: deepen current log parsing, detect chainloader/config issues, and explain plugin load failures.
- **ILSpy and dnSpyEx**
  - Planned use: detect tool availability and prepare guided inspection workflows; no binary patching by default.
- **UnityExplorer**
  - Planned use: document-assisted troubleshooting for object/component inspection workflows.
- **AssetStudio and AssetRipper**
  - Planned use: inspect asset projects and catch missing bundle/reference problems.
- **ThunderKit**
  - Planned use: read project metadata, package manifests, and common export/publish failure logs.

#### REDengine toolchain

Medium priority, high flair. Cyberpunk 2077 is the lead target because the tool ecosystem is active and visually recognizable. The Witcher side is a research follow-up after Cyberpunk workflows prove stable.

- **WolvenKit**
  - Planned use: detect projects, read logs/manifests, summarize export/cook/package failures, and connect mod metadata to Nexus/mod.io-style platform records where possible.
- **REDmod**
  - Planned use: inspect local mod deployment state and explain load/deploy failures.
- **RED4ext**
  - Planned use: parse loader logs and dependency/version mismatches.
- **ArchiveXL and TweakXL**
  - Planned use: detect dependency presence, parse config/log failures, and explain common load-order or version mismatches.

The REDengine lane is intentionally cheap to prototype: mostly file/log readers first, no heroic reverse engineering. If it wins attention, expand it. If maintenance gets heavy, it can stay a sharp read-only diagnostic lane.

### v3 â€” Multi-platform publishing ðŸ”œ Planned

The creator-side killer feature. One mod definition fans out to multiple platforms with a single conversational command.

Targets, in roughly this order:

- Nexus + mod.io first (already integrated read-side; adding write paths)
- Thunderstore next (clean API, low political baggage)

Permission discipline is non-negotiable: a mod that's flagged "no asset reuse" on Nexus does not get republished anywhere else by ModWrench. Read-the-permissions, refuse-when-blocked is baked into the tool's contract.

Wiring prompt for v3 is the next design doc to draft.

### Platform expansions ðŸ”œ Planned & ðŸ“ Scaffolded

In recommended order:

1. **`@modwrench/thunderstore`** â€” âœ… Shipped ([packages/thunderstore/](packages/thunderstore/))
   - Unlocks the entire Unity co-op community
   - Closes the loop with the existing r2modman load-order parser
   - 7 tools: list/get communities, list/get/search mods, version history, top mods
   - Read-only public API, no auth required

> Note: Modrinth, CurseForge, and Minecraft support are out of scope. ModWrench targets native game modding (Bethesda Creation Engine + Unity/BepInEx).

---

## Deferred

### LevelDB reader for Vortex

`mw_read_load_order` currently does best-effort folder-scan for Vortex installs because the actual state is stored in a LevelDB key-value store. Adding a LevelDB reader would let workbench return real enable-state and load order for Vortex users.

Not blocking â€” every Vortex response surfaces an honest `warning` field about the gap. Worth doing eventually; not urgent.

### Full remote MCP deployment (Cloudflare Workers / hosted OAuth)

The Streamable HTTP transport MVP is shipped in `@modwrench/remote`, but the full hosted product remains deferred. Remaining work: Worker-safe package split, per-user OAuth at the MCP layer, encrypted token storage, session-aware credential resolution, hosted deployment automation, and rate limiting. Trust story shifts once Nexus/mod.io tokens live server-side, so this deserves its own design conversation.

---

## Active contribution opportunities

The platforms in the [Platform expansions](#platform-expansions--planned---scaffolded) section each have a scaffolded directory and are open for implementation. The existing `@modwrench/nexus` and `@modwrench/modio` are reference implementations â€” see [docs/adding-a-platform.md](docs/adding-a-platform.md) for the full walkthrough.

Other active areas:

- Conflict database â€” [packages/workbench/data/conflicts/](packages/workbench/data/conflicts/) accepts community PRs with verified mod incompatibilities. Per-game `<gameId>.json` files.
- KNOWN_GAMES catalog in [packages/workbench/src/detect/games.ts](packages/workbench/src/detect/games.ts) â€” adding new games is a small drive-by PR.
- Additional crashlog formats in [packages/workbench/src/crashlog/](packages/workbench/src/crashlog/) â€” if your community uses a logger we don't support yet, the parser pattern is ~150 lines.

---

## How to read this document

If you're a modder considering whether to use ModWrench: read the [v1 / v2 Shipped](#current-state) sections, that's what's available today.

If you're a contributor looking for where to help: read the [Platform expansions](#platform-expansions--planned---scaffolded) and [Active contribution opportunities](#active-contribution-opportunities) sections.

If you found a bug or want a new feature: open an issue. The roadmap is a plan, not a wall â€” community input shifts priorities and adds items.

