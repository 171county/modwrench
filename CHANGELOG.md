# Changelog

All notable changes to ModWrench will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once a 1.0 is published.

This document is currently maintained by hand. When [release-please](https://github.com/googleapis/release-please) is set up alongside the npm publish pipeline, it will take over generating changelog entries from conventional commits.

---

## [0.2.3] — 2026-09-15

### Added
- **`MODWRENCH_UI=off` turns the MCP-UI panels off.** Found by running ModWrench
  in Cline, where the answer was excellent — an 11-package Thunderstore
  dependency tree with install order and nine authors credited — and roughly
  28kb of panel source had been pasted into the transcript ahead of it.

  That is the real failure mode for MCP-UI today, and not the one expected. A
  client that does not support `ui://` resources does not quietly ignore them;
  it puts the HTML into the conversation as text, so the model reads markup and
  minified JavaScript it can do nothing with. Measured: one panel is 27.6kb,
  about 8,820 tokens, near 7% of a 128k context window — and a four-tool answer
  spends over a quarter of the window on markup that was never drawn.

  `MODWRENCH_UI=off` (also `0`, `false`, `none`) shrinks the payload to 129
  bytes, a 219x reduction, taking that 28% down to 0.13%. The block keeps its
  shape — same type, uri, mimeType and meta — with only the HTML swapped for one
  line naming the variable that caused it, so a user who forgot they set it can
  work out why the UI vanished. Panels remain on by default; this is opt-out.

### Changed
- **The README now shows the panel before describing it,** with both views above
  the fold, rendered from the published package rather than a working tree.
- **VS Code is documented, with the right config key.** The install section did
  not mention it, and the JSON it gave uses `mcpServers` — VS Code's native MCP
  config uses `servers`, so a VS Code user copying that block would have got a
  config that silently does nothing.

### Fixed
- **The npm visibility guard waits as long as npm says.** Three releases measured
  the lag against a 150-second window: 0.2.0 failed, 0.2.1 passed, 0.2.2 failed.
  npm states "may take a few minutes" on every publish, so the window is now ten
  minutes to match. `@modwrench/cli` publishes last of the eight, which puts it
  at the back of the propagation queue every release.

## [0.2.2] — 2026-09-15

### Fixed
- **`modwrench --help` silently started the MCP server.** It fell through to
  the boot path: the server came up on stdio, wrote one JSON log line, and sat
  waiting for a client that was never going to speak. The most obvious command
  a new user can type made the tool look broken inside ten seconds, and every
  other unrecognized argument did the same. `--help`, `-h` and `help` now print
  usage and exit 0; any other unrecognized argument names itself back and exits
  1 with the same text. An MCP client launches this with no arguments at all,
  so anything in `argv[2]` came from a person at a prompt.

  The usage text leads with the fact that ModWrench is a server an AI client
  starts, not a program you run yourself — without that, someone who has not
  met MCP runs the bare command, sees nothing happen, and concludes it does not
  work. Five tests cover it, spawning the real entry point. The load-bearing
  one asserts that no arguments still boots the server and completes an
  `initialize` handshake, because the two halves of this fix pull in opposite
  directions and widening the guard too far would break every client at once.

## [0.2.1] — 2026-09-15

An audit of the published 0.2.0 tarballs against README.md and TRUST.md found
eleven places where the two disagreed. Every one of them ran the same direction:
the documents promised more than the code delivered, never less. Four were code
defects and are fixed; seven were overclaims and the claims are now scoped to
what the code actually does.

### Fixed
- **`auth status modio` reported a working setup as broken.** `auth key` stores
  a raw API key; `authStatus` checked for a credential with the JSON reader,
  which threw on every raw key, was swallowed, and printed "Not signed in" with
  exit 1 on a credential that had stored correctly. It then pointed users at
  `auth login modio` — undocumented, and itself requiring the key they had just
  stored. The one verification step the README offers now works. `@modwrench/nexus`
  already had the correct pattern; mod.io now mirrors it.
- **`nexus_file_preview` never passed through the adult-content filter.** The
  tool follows a CDN URL Nexus names at runtime, so it leaves the shared request
  path and the policy was never applied to what it returned. Filtering that
  response would not have helped — an archive listing carries no adult flag, so
  the filter is structurally a no-op on it. The flag is on the mod record, so
  the tool now checks that first and refuses rather than returning an
  adult-tagged mod's archive listing unlabelled.
- **The withheld-content notice was generated and then discarded.** The filter
  replaces a flagged record with a marker carrying its own explanation;
  `mw_query_mod_metadata` handed that straight to the normalizer, which builds
  from named fields only. The result was `found: true` with name and author
  `undefined` and a page URL ending in `/undefined` — success reported for a
  request that had actually been withheld. It now reports the withholding, with
  the reason.
- **The three mod.io discovery tools dropped the link back to the author.**
  `modio_list_mods`, `modio_search_mods` and `modio_popular` hand-build their
  summaries and never copied `profile_url` across, so the assistant could not
  cite an author's page even when asked. The UI card had the same gap.

### Changed — documentation corrected to match the code
- **The adult-filter guarantee is now scoped.** TRUST.md claimed every Nexus
  tool fails closed when it cannot verify the flag. Two do. The rest rely on the
  flag being present, and some endpoints return records that carry no flag at
  all — changelogs, update lists, file records. A new section names each one in
  a table instead of implying a guarantee the code cannot keep.
- **The destination table was short by one.** `nexus_file_preview` contacts a
  Nexus CDN host chosen at runtime. The README disclosed it; the TRUST.md table
  that claims to be complete did not.
- **"Watch every byte it sends" was not true of the auth path.** Base URLs are
  overridable for the tool paths, but `nexus/auth.ts` and `modio/auth.ts` use
  hardcoded hosts — so the one request carrying your freshly-pasted credential
  is the one request the documented proxy technique cannot intercept. Named,
  along with two other paths no variable controls.
- **GitHub learns which game you mod.** TRUST.md said `raw.githubusercontent.com`
  receives your IP "and nothing else". The masterlist URL contains the game name.
- **The page's own verification recipe returned four hosts it never mentioned.**
  They are a User-Agent string, a policy link and two "where to get your key"
  links — text, not connections — but a reader following the instruction hit the
  page's own "that is a bug in this page" condition on the first try. All nine
  hits are now accounted for, and a second grep finds requests built from
  runtime values, which a literal-matching grep cannot see.
- **The attribution promise is scoped to what can carry attribution.** Platform
  outputs carry author, platform and link. The crash and conflict tools work
  from plugin filenames on the user's own disk and cannot attribute them without
  a network lookup per suspect — so they are named as the gap they are, in the
  section mod authors read.
- **Two shipped surfaces were undisclosed:** the bundled community conflict list
  (which ships empty) and the five slash commands.
- **Stale version references.** The README said v0.1.1 and TRUST.md's pinning
  example pinned `0.1.0` — two releases behind, and before the adult-filter fix
  the same document described as shipped.

## [0.2.0] — 2026-09-12

Documentation was audited against the source, and the code was changed where a
claim could not be made true otherwise. Nothing here alters what the tools do.

### Fixed
- **Adult-content filtering did not cover every path to Nexus.** Nexus's terms
  put the filtering duty on API consumers, and TRUST.md promised the filter
  "covers every Nexus tool — including any added later". It did not.
  `@modwrench/workbench` builds its own Nexus REST client for
  `mw_query_mod_metadata` and returned responses unfiltered, so a direct id
  lookup surfaced in full what `@modwrench/nexus` would have withheld. The
  policy moved to `@modwrench/core` — one implementation, both callers — and the
  Workbench client now applies it. `packages/nexus/src/adult.ts` re-exports it,
  so existing imports and tests are unchanged. Guarded by four new tests,
  including a source-level check that fails if that client is ever rebuilt
  without the filter.
- **`nexus_search` now asks Nexus for the adult flag.** It runs on the v2
  GraphQL endpoint and its selection set omitted the field entirely, so the
  filter had nothing to read and passed every adult-tagged mod through — on the
  only Nexus tool with real keyword search. The field is requested when
  filtering is active, and omitted when the operator has opted in. If the schema
  rejects it, the tool **fails closed**: it returns an error naming the fix
  rather than results it cannot check, because returning unchecked results with
  a warning is still returning them. Five new tests cover the request shape, the
  filtering, the fail-closed path, the opt-in path, and that an unrelated
  GraphQL error is not misread as a missing field.
- **Disclosed a sixth network destination.** `nexus_file_preview` follows the
  `content_preview_link` the Nexus API returns — a CDN host rather than a fixed
  endpoint, and the only request in the tree to a host not known ahead of time.
  It carries no credential. Three documents claimed a complete list and omitted
  it.
- **Corrected "never writes it anywhere" and "read once at start-up."** `auth
  key`, `auth login` and `auth logout` write to the credential manager, and
  credentials are read at platform activation — which `mw_activate_platform` can
  trigger mid-session — while `mw_query_mod_metadata` re-reads per call.
- **Scoped the environment-variable claim.** `auth login nexus` reads
  `NEXUS_OAUTH_CLIENT_ID` and `NEXUS_OAUTH_CLIENT_SECRET` from the environment.
  Those are OAuth application credentials issued to an application operator, not
  a user's account key — so the docs say that, instead of an absolute one grep
  falsifies.

- **`@modwrench/core` no longer reads a `.env` file.** It called dotenv's
  `config()` at import time, locating the target by walking up from the
  installed package for a `package.json` with a `workspaces` array — so
  installed inside another monorepo it could read that project's `.env` into
  ModWrench's process. No credential ever came from it, but README said "there
  is no `.env` or file fallback". Removed, along with the `dotenv` dependency.
- **Removed `getSecret()` from `@modwrench/core`.** An exported
  secret-from-environment reader that nothing called. **Breaking change to the
  public API of `@modwrench/core`**; no package in this repo used it.
  Credentials now come from the OS credential manager and structurally cannot
  come from anywhere else.
- **Corrected every "read-only" claim.** `nexus_endorse_mod` POSTs an
  endorsement to Nexus. Six documents said the project performs no writes,
  including a draft letter to Nexus Mods stating "no such call exists in the
  code". The tool itself was always gated and documented in TRUST.md; the other
  documents had not caught up.
- **Corrected every tool count.** Actual: nexus 15, mod.io 17, Thunderstore 9,
  workbench 6, cli 2 — 49, of which 48 read.
- **Removed the README demo transcript.** It named three real mods and three
  real authors, attached invented download and endorsement figures, and claimed
  their work was CC-licensed.
- **Dropped the claim that ModWrench never ranks mods.** Four tools surface a
  platform's own popularity and rating figures. TRUST.md now says so.
- **`@modwrench/remote` is published to npm.** TRUST.md said it was not.
- **Corrected the credential-lifetime claim** in `.env.example` and on the npm
  package page: the credential is read once at start-up and held until the
  process exits, not "no longer than the request that uses them".
- **Relicensed note:** the project is MIT from 0.1.0 onward. The 0.0.1 entry
  below records Apache 2.0, which was accurate at the time.
- **ui tests are typechecked.** `tsconfig.json` covered only `src/`, and `npm
  test` runs through tsx, which strips types without checking them — so test
  fixtures had drifted from the exported types. Added
  `packages/ui/tsconfig.typecheck.json` and fixed the drift it found.

### Removed

- **Twelve documentation files, 2,776 lines.** VISION, ROADMAP, RELEASE and the
  whole of `docs/`. They were internal strategy, unbuilt plans, superseded
  design notes, and in several cases claims the code contradicted. Volume was
  the defect: 4,002 lines of markdown for a 0.1.1 project is 4,002 lines that
  can drift. Git retains all of them.
- **`.claude/skills/`** — thirteen files of cross-product authoring tooling that
  did not belong in this repository.

### Changed

- **README rewritten**, 340 lines to 111: what it is, what it does, how to use
  it, what it connects to, and the one thing it writes. The host table is
  generated from the URLs actually requested in `packages/*/src`.
- **CONTRIBUTING rewritten**, 233 lines to 75.
- **TRUST.md** corrected in three places and re-verified against the code.

## [0.1.1] — 2026-09-12

The real 0.1.x cut: keychain-only credentials, native-modding scope (CurseForge and Minecraft
support removed), the stateless `@modwrench/ui` MCP-UI package, `nexus_endorse_mod` (first
write action, explicit opt-in), adult-content filtering on Nexus, recursive dependency
resolver with crash-to-culprit correlation, Linux/Steam Deck detection fixes, TRUST.md, and
the tag-gated release workflow with npm provenance. Published by CI from the `v0.1.1` tag.

## [0.1.0] — 2026-09-12 (superseded)

Published in error from a stale checkout within the hour before 0.1.1; superseded
immediately. If you installed `@modwrench/*@0.1.0`, upgrade to 0.1.1.

### Removed

- **CurseForge platform removed from ModWrench.** `@modwrench/curseforge` and all CurseForge wiring were pulled out — CurseForge is a Minecraft-centric host and is out of scope for ModWrench.
- **Minecraft support removed from the Workbench.** The Minecraft crash-report parser and the Forge/Fabric/NeoForge loader + `minecraft` game-family detection were removed as out of scope. ModWrench's local diagnostics now target the Bethesda Creation Engine and Unity/BepInEx families only. Final platform lineup: Nexus, mod.io, Thunderstore, and the local Workbench.

### Added

- **CurseForge platform added** ([packages/curseforge/](packages/curseforge/)) — 10 read-only tools, authenticated via `CURSEFORGE_API_KEY` (free from console.curseforge.com) sent in the `x-api-key` header. (2026-06-25)
- **v2.5 Dynamic Catalog foundation** — `MetaCatalog` class in `@modwrench/cli` plus the `mw_activate_platform` meta-tool. Platforms now register through the catalog rather than inline. Failed activations (e.g. missing credentials) stay dormant rather than disappearing — the LLM can retry via `mw_activate_platform` once the user adds credentials in another terminal, no server restart needed. McpServer declares `listChanged: true` capability and `MetaCatalog.activate` emits `notifications/tools/list_changed` on state changes so MCP clients re-fetch automatically. Idempotent: re-activating a live platform returns `alreadyActive: true` with no side effects. 13 catalog-orchestration tests cover smoke, credential-success/fail paths, idempotency, notification gating, retry-after-cred-set, and listActive/listFailed snapshots. Auto-activation policy refinement (selective activation based on `detectEnvironment()` rather than activate-all) deferred to v2.5.1.
- **Remote Streamable HTTP MVP** ([packages/remote/](packages/remote/)) — `@modwrench/remote` exposes a `/mcp` endpoint for remote-capable clients such as ChatGPT developer-mode apps. The MVP is intentionally public-read-only: Thunderstore only (7 tools), with no Nexus/mod.io credential loading and no workbench filesystem tools. Includes a health descriptor and HTTP MCP smoke tests.
- **`./detect` export from `@modwrench/workbench`** — `detectEnvironment()` extracted as a standalone function (the same logic that powers `mw_detect_environment`'s handler), now importable from `@modwrench/workbench/detect`. Used by the meta-server for future auto-activation decisions.
- **CurseForge platform package** ([packages/curseforge/](packages/curseforge/)) — 10 read-only tools (game/category discovery, mod search, mod details, file listings, changelogs, dependency lookups). Requires `CURSEFORGE_API_KEY` (free from console.curseforge.com), sent via the `x-api-key` header.
- **Thunderstore platform package** ([packages/thunderstore/](packages/thunderstore/)) — 7 read-only tools for Unity co-op modding (Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS, and 270+ communities). No credentials required — anonymous public REST API.
- **`@modwrench/workbench` package** — 5 atomic tools (`mw_detect_environment`, `mw_read_load_order`, `mw_parse_crashlog`, `mw_query_mod_metadata`, `mw_check_known_conflicts`) that compose with the v1 platform packages into a conversational diagnostic experience. Closes the v1→v2 chain end-to-end.
- **Shared HTTP client** ([packages/core/src/http.ts](packages/core/src/http.ts)) — `createHttpClient()` factory with 429 + Retry-After handling, exponential backoff on 5xx, per-client concurrency cap (default 4), and structured error envelopes. Refactored every platform package and workbench's metadata clients to use it.
- **`modwrench` meta-CLI** with `auth <action> <platform>` subcommand routing and `--version` / `-v` flags. Composes every installed `@modwrench/*` platform into one MCP entry.
- **`SECURITY.md`** — vulnerability disclosure policy, scope, credential-handling rules, 90-day coordinated disclosure timeline.
- **`ROADMAP.md`** — canonical "where this is going" doc covering v2.5 dynamic catalog, v2.6 local toolchain integrations, v3 publishing, and deferred items.
- **Dynamic catalog architecture spec** — design for boot-time auto-activation of platforms based on workbench detection, plus an `mw_activate_platform` meta-tool for runtime opt-in. Trigger for build is the 4th platform.
- **Contributor walkthrough** — step-by-step guide for adding a new `@modwrench/<platform>` package, with trust-posture non-negotiables.
- **Remote deployment docs** — current MVP scope, local run instructions, remote client URL shape, and remaining hosted-auth work.
- **Steam Deck / headless Linux keychain fallback** — `getStoredToken` now classifies errors as `no-entry` vs `unavailable`, emits a one-time warning when libsecret/D-Bus is missing, and `loadCredential`'s error message explains the real cause. New `getKeychainStatus()` export.
- **Gitleaks workflow** ([.github/workflows/gitleaks.yml](.github/workflows/gitleaks.yml)) with custom Nexus + mod.io key patterns covering the gap where GitHub's free secret scanning has no partner pattern for those providers.
- **CI test step** running `npm test` across all workspaces on Node 20 + 22.
- **Conflict database scaffolding** ([packages/workbench/data/conflicts/](packages/workbench/data/conflicts/)) — empty seed JSON files for Skyrim SE, Fallout 4, Lethal Company plus a documentation README. Awaits community PRs.
- **Test suites across all workspaces** — 126 tests total: core (18), nexus (10), modio (9), thunderstore (10), curseforge (10), workbench (55), remote (2), cli (13). Each platform's tests verify auth-header routing, URL shapes, query params, pagination, and error envelopes.

### Removed

- **Modrinth platform removed** — Modrinth (the open-source Minecraft hub) is out of scope for ModWrench, which targets native game modding. ModWrench no longer ships `@modwrench/modrinth`. (2026-06-25)

### Changed

- **Public docs narrowed to ModWrench scope** so README and ROADMAP focus on the current product, shipped packages, and planned ModWrench toolchains.
- **Workspace order** in root `package.json` made explicit (not glob-based) so each workspace's dependencies build before their dependents.
- **README** repositioned to surface workbench diagnostics alongside platform tools; v2 marked shipped; stdio npm install documented for local clients; ChatGPT support clarified as the remote public-tool MVP.
- **CONTRIBUTING.md** false claim about `core` having rate-limit-aware helpers corrected; `CONTRIBUTORS.md` auto-generation softened to "git shortlog as source of truth for now."
- **Auth hint messages** unified to the meta-CLI form (`modwrench auth login <platform>`) across every user-facing string.
- **LOOT masterlist branch** pinned from `master` to `v0.26` (stable maintenance branch — community entries continue to flow, schema stays frozen).
- **Workbench wiring prompt reorganized** out of the repo root: `WIRING-PROMPT_MCP-ModWrench-Workbench.md` → `docs/wiring-prompts/workbench.md`.

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
- `@modwrench/core` — shared library: keychain integration via `@napi-rs/keyring`, env helpers, structured logger to stderr, credential resolution chain (keychain → env → fail-with-hint), `ModWrenchError` envelope.
- `LICENSE` (Apache 2.0), `CONTRIBUTING.md` (DCO sign-off model), three GitHub issue templates, PR template, basic CI workflow on Node 20 + 22.
- Trust posture documented in README: six non-negotiables (no telemetry, no personal data, attribution preserved, permissions respected, rate limits honored, read-only default).
