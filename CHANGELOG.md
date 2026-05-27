# Changelog

All notable changes to ModWrench will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once a 1.0 is published.

This document is currently maintained by hand. When [release-please](https://github.com/googleapis/release-please) is set up alongside the npm publish pipeline (see [ROADMAP.md](ROADMAP.md)), it will take over generating changelog entries from conventional commits.

---

## [Unreleased]

Everything since 0.0.1 is currently shipping to `main` without version tags. The next published release will collect these entries under a real version heading.

### Added

- **v2.5 Dynamic Catalog foundation** — `MetaCatalog` class in `@modwrench/cli` plus the `mw_activate_platform` meta-tool. Platforms now register through the catalog rather than inline. Failed activations (e.g. missing credentials) stay dormant rather than disappearing — the LLM can retry via `mw_activate_platform` once the user adds credentials in another terminal, no server restart needed. McpServer declares `listChanged: true` capability and `MetaCatalog.activate` emits `notifications/tools/list_changed` on state changes so MCP clients re-fetch automatically. Idempotent: re-activating a live platform returns `alreadyActive: true` with no side effects. 13 catalog-orchestration tests cover smoke, credential-success/fail paths, idempotency, notification gating, retry-after-cred-set, and listActive/listFailed snapshots. Auto-activation policy refinement (selective activation based on `detectEnvironment()` rather than activate-all) deferred to v2.5.1.
- **`./detect` export from `@modwrench/workbench`** — `detectEnvironment()` extracted as a standalone function (the same logic that powers `mw_detect_environment`'s handler), now importable from `@modwrench/workbench/detect`. Used by the meta-server for future auto-activation decisions.
- **Modrinth platform package** ([packages/modrinth/](packages/modrinth/)) — 7 read-only tools for the open-source Minecraft hub (mods, modpacks, plugins, datapacks, resourcepacks, shaders): `modrinth_search` with project-type/loader/game-version/category facets, `modrinth_get_project`, `modrinth_get_versions` (with loader and game-version filters), `modrinth_get_version`, `modrinth_list_categories`, `modrinth_list_loaders`, `modrinth_list_game_versions`. No credentials required — anonymous public REST API. Closes the platform-expansion second slot per ROADMAP.
- **CurseForge platform scaffold** ([packages/curseforge/](packages/curseforge/)) — placeholder package.json for the v3 expansion.
- **Thunderstore platform package** ([packages/thunderstore/](packages/thunderstore/)) — 7 read-only tools for Unity co-op modding (Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS, and 270+ communities). No credentials required — anonymous public REST API.
- **`@modwrench/workbench` package** — 5 atomic tools (`mw_detect_environment`, `mw_read_load_order`, `mw_parse_crashlog`, `mw_query_mod_metadata`, `mw_check_known_conflicts`) that compose with the v1 platform packages into a conversational diagnostic experience. Closes the v1→v2 chain end-to-end.
- **Shared HTTP client** ([packages/core/src/http.ts](packages/core/src/http.ts)) — `createHttpClient()` factory with 429 + Retry-After handling, exponential backoff on 5xx, per-client concurrency cap (default 4), and structured error envelopes. Refactored every platform package and workbench's metadata clients to use it.
- **`modwrench` meta-CLI** with `auth <action> <platform>` subcommand routing and `--version` / `-v` flags. Composes every installed `@modwrench/*` platform into one MCP entry.
- **`SECURITY.md`** — vulnerability disclosure policy, scope, credential-handling rules, 90-day coordinated disclosure timeline.
- **`ROADMAP.md`** — canonical "where this is going" doc covering v2.5 dynamic catalog, v3 publishing, sibling product (StudioWrench), deferred items, and out-of-scope commitments.
- **Dynamic catalog architecture spec** ([docs/dynamic-catalog-architecture.md](docs/dynamic-catalog-architecture.md)) — design for boot-time auto-activation of platforms based on workbench detection, plus an `mw_activate_platform` meta-tool for runtime opt-in. Trigger for build is the 4th platform.
- **Contributor walkthrough** ([docs/adding-a-platform.md](docs/adding-a-platform.md)) — step-by-step guide for adding a new `@modwrench/<platform>` package, with trust-posture non-negotiables.
- **Remote deployment planning** ([docs/remote-deployment.md](docs/remote-deployment.md)) — honest "planned, not yet implemented" doc for Cloudflare Workers / Streamable HTTP transport for ChatGPT-compatible clients.
- **Steam Deck / headless Linux keychain fallback** — `getStoredToken` now classifies errors as `no-entry` vs `unavailable`, emits a one-time warning when libsecret/D-Bus is missing, and `loadCredential`'s error message explains the real cause. New `getKeychainStatus()` export.
- **Gitleaks workflow** ([.github/workflows/gitleaks.yml](.github/workflows/gitleaks.yml)) with custom Nexus + mod.io key patterns covering the gap where GitHub's free secret scanning has no partner pattern for those providers.
- **CI test step** running `npm test` across all workspaces on Node 20 + 22.
- **Conflict database scaffolding** ([packages/workbench/data/conflicts/](packages/workbench/data/conflicts/)) — empty seed JSON files for Skyrim SE, Fallout 4, Lethal Company plus a documentation README. Awaits community PRs.
- **Test suites across all workspaces** — 98 tests total: core (14), nexus (10), modio (9), thunderstore (10), workbench (55). Each platform's tests verify auth-header routing, URL shapes, query params, pagination, and error envelopes.

### Changed

- **Sibling product renamed** from `Copilot` to `Workbench` then `CreatorWrench` to `StudioWrench` (Microsoft trademark enforcement on "Copilot" branding; "Studio" maps better to Roblox Studio / UEFN audience).
- **Workspace order** in root `package.json` made explicit (not glob-based) so each workspace's dependencies build before their dependents.
- **README** repositioned to surface workbench diagnostics alongside platform tools; v2 marked shipped; ChatGPT support clarified as planned; install section now carries a "private alpha — install from source" callout until the npm publish pipeline lands.
- **CONTRIBUTING.md** false claim about `core` having rate-limit-aware helpers corrected; `CONTRIBUTORS.md` auto-generation softened to "git shortlog as source of truth for now."
- **Auth hint messages** unified to the meta-CLI form (`modwrench auth login <platform>`) across every user-facing string.
- **LOOT masterlist branch** pinned from `master` to `v0.26` (stable maintenance branch — community entries continue to flow, schema stays frozen).
- **Design docs reorganized** out of the repo root: `WIRING-PROMPT_MCP-ModWrench-Workbench.md` → `docs/wiring-prompts/workbench.md`, `ModWrench-Comms-Playbook.md` → `docs/comms-playbook.md`, `Modder-Ecosystem-Research_2026-05-17.md` → `docs/research/modder-ecosystem-2026-05.md`. All renames via `git mv` so history follows.

### Fixed

- **CLI `--version`** now reads from `package.json` instead of a hardcoded literal.
- **CI ordering** swapped so `build` runs before `typecheck` — workspace dependents need `.d.ts` files from their dependencies to typecheck on a fresh clone.
- **Workbench test glob** dropped `**` (Node 20's `--test` only handles single-star globs natively).
- **Crashlog `likelySource`** preserves multi-word plugin names (regression: `JKs Whiterun Outskirts.esp` was being truncated to `Outskirts.esp`).
- **README footer link** broken `github.com/<your-username>/modwrench` placeholder replaced with the real repo URL.
- **Duplicate `.env.example.txt`** removed (kept `.env.example` as the standard dotenv convention).

### Security

- `qs` bumped from 6.15.1 to 6.15.2 (CVE: DoS via `qs.stringify` on null/undefined entries in comma-format arrays — moderate severity, transitive dependency).

---

## [0.0.1] — 2026-05-17

Initial public release on GitHub. Single squashed commit (`2d46d24`) after orphan-branch reset to purge the pre-public history that contained accidentally-committed API credentials.

### Included at initial release

- `@modwrench/nexus` — 12 read-only tools for Nexus Mods. OAuth (PKCE) + API key fallback.
- `@modwrench/modio` — 11 read-only tools for mod.io. OAuth (email code) + API key fallback.
- `@modwrench/cli` — meta-server composing every installed platform under one MCP entry.
- `@mcpwrench/core` — shared library: keychain integration via `@napi-rs/keyring`, env helpers, structured logger to stderr, credential resolution chain (keychain → env → fail-with-hint), `McpwrenchError` envelope.
- `LICENSE` (Apache 2.0), `CONTRIBUTING.md` (DCO sign-off model), three GitHub issue templates, PR template, basic CI workflow on Node 20 + 22.
- Trust posture documented in README: six non-negotiables (no telemetry, no personal data, attribution preserved, permissions respected, rate limits honored, read-only default).
