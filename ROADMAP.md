# ModWrench Roadmap

The full plan, captured here so contributors and prospective users can see where this is going without having to read the chat history.

This document is the source of truth for *where things are going*. For *current capabilities*, see [README.md](README.md). For *trust posture and non-negotiables*, see the relevant section in [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

Status definitions used below:

- **Shipped** — running in `main`, tested, available via `npm install`
- **Scaffolded** — placeholder directory exists in the monorepo; no implementation yet
- **Planned** — design intent, no code or scaffold yet
- **Deferred** — intentionally not on the active path; may revisit later
- **Out of scope** — won't happen under this project

---

## Current state

### v1 — Platform bridge ✅ Shipped

- **`@modwrench/nexus`** — 12 tools, OAuth (PKCE) + API-key fallback, full read coverage
- **`@modwrench/modio`** — 11 tools, OAuth (email code) + API-key fallback, full read coverage
- **`@modwrench/cli`** — meta-server composing every installed platform under one MCP entry; `auth` subcommand dispatcher
- **`@mcpwrench/core`** — shared infrastructure (keychain, env, logging, error envelope, credential resolution)

### v2 — The compound modder workbench ✅ Shipped

`@modwrench/workbench` — 5 atomic tools that compose under LLM reasoning into a conversational diagnostic experience:

- `mw_detect_environment`
- `mw_read_load_order`
- `mw_parse_crashlog`
- `mw_query_mod_metadata`
- `mw_check_known_conflicts`

Test suite: 55 tests, ~0.4s, runs in CI on every PR. See [packages/workbench/test/](packages/workbench/test/) for the fixtures.

`mw_explain` was intentionally not built — the LLM formats responses natively and the wiring prompt marked it optional.

---

## On the active path

### v2.5 — Dynamic catalog architecture 🔜 Planned

As the platform count grows (v3+), the tool catalog gets large. Modern LLM clients pay context cost for tools/list, and a Skyrim modder shouldn't see Lethal Company tools cluttering their picker.

The solution: boot-time auto-activation of platforms based on workbench detection, plus an `mw_activate_platform` meta-tool for runtime opt-in. One MCP entry, personalized catalog per user.

Full architecture spec: [docs/dynamic-catalog-architecture.md](docs/dynamic-catalog-architecture.md).

**Build trigger:** when the 4th platform lands and catalog noise becomes a real concern.

### v3 — Multi-platform publishing 🔜 Planned

The creator-side killer feature. One mod definition fans out to multiple platforms with a single conversational command. Inspired by [MC-Publish](https://github.com/Kir-Antipov/mc-publish) (Minecraft GitHub Action), but conversational rather than CI/CD-bound because most modders outside the Minecraft community don't live in GitHub Actions YAML.

Targets, in roughly this order:

- Nexus + mod.io first (already integrated read-side; adding write paths)
- Thunderstore + Modrinth next (clean APIs, low political baggage)
- CurseForge after that (largest catalog, requires careful positioning)

Permission discipline is non-negotiable: a mod that's flagged "no asset reuse" on Nexus does not get republished anywhere else by ModWrench. Read-the-permissions, refuse-when-blocked is baked into the tool's contract.

Wiring prompt for v3 is the next design doc to draft.

### Platform expansions 🔜 Planned & 📐 Scaffolded

In recommended order:

1. **`@modwrench/thunderstore`** — 📐 Scaffolded ([packages/thunderstore/](packages/thunderstore/))
   - Unlocks the entire Unity co-op community
   - Closes the loop with the existing r2modman load-order parser
   - Smallest API surface; easiest first add
2. **`@modwrench/modrinth`** — 📐 Scaffolded ([packages/modrinth/](packages/modrinth/))
   - Minecraft, the largest modding community by raw user count
   - Best public REST API of any modding platform
   - Doing Modrinth before CurseForge signals values alignment to the Minecraft community
3. **`@modwrench/curseforge`** — 📐 Scaffolded ([packages/curseforge/](packages/curseforge/))
   - Largest catalog (Minecraft + Sims 4 Mod Hub + WoW + ARK + 165k+ creators)
   - Rate-limited gated API; Overwolf trust deficit
   - Added after Modrinth so the positioning is "we serve users wherever the mods live"
4. **`@modwrench/gamebanana`** — Planned (no scaffold yet)
   - Source engine mods, Smash mods, retro communities
   - Opportunistic — do this when those communities ask

---

## Sibling product

### StudioWrench 🔜 Planned (separate product, separate brand)

The MCPwrench umbrella covers multiple products. ModWrench is the first; **StudioWrench** is the second.

StudioWrench targets UGC platforms with creator economies that don't match modder culture:

- Roblox (Open Cloud API, $1B+ paid to creators March 2024–March 2025)
- UEFN / Fortnite Creative (Verse-based programmatic publishing as of January 2026, 58+ creator-millionaires)

Why separate from ModWrench:

- Different audience (Roblox/UEFN creators vs. game modders)
- Different vocabulary ("experiences" / "islands" vs. "mods")
- Different trust expectations (Roblox/Epic have moderation models; modder culture is no-data / no-AI-generation)
- Different competitors (Roblox Studio plugins, UEFN Verse tooling — these are full IDEs)
- Different economics (the paid-tier playbook works for Roblox creators; it would destroy ModWrench's modder trust)

**Reservation status:**

- npm scope `@studiowrench` — claim recommended at the user's earliest convenience
- GitHub org `studiowrench` — claim the name on GitHub even before creating the repo
- Domain `studiowrench.dev` — optional, ~$15/year

No code, no scaffold yet. When work starts, StudioWrench will mirror ModWrench's architecture (`@mcpwrench/core` shared, per-platform packages, meta-server, workbench-style local tooling where applicable) but live under its own brand.

---

## Deferred

### Bethesda Creations / Verified Creator Program

The Verified Creator program carries the 25% creator-share number from the 2015 paid-mods drama and bans generative AI in content. The community treats this program as the canonical "studio trying to capture value they didn't create" story.

ModWrench will not add Creations support purely for completeness. The trigger to revisit is a specific creator-side case where the integration genuinely serves the creator (not the platform). Even then, the positioning must be defensive: "we publish where you publish, we don't endorse the rate."

### LevelDB reader for Vortex

`mw_read_load_order` currently does best-effort folder-scan for Vortex installs because the actual state is stored in a LevelDB key-value store. Adding a LevelDB reader would let workbench return real enable-state and load order for Vortex users.

Not blocking — every Vortex response surfaces an honest `warning` field about the gap. Worth doing eventually; not urgent.

### Remote MCP deployment (Cloudflare Workers)

Streamable-HTTP transport for clients like ChatGPT that don't support stdio. Architecture documented in [docs/remote-deployment.md](docs/remote-deployment.md). Significant work (transport adapter, per-user OAuth at MCP layer, credential adapter, sessions, Workers scaffold, rate limiting). Trust story shifts (server-side token storage instead of OS keychain), so it deserves its own design conversation.

---

## Out of scope

These are commitments to *not* do certain things. Each one is the answer to a specific community wound.

- **Steam Workshop integration** — Valve's terms restrict third-party API clients; embedded in the Steam client itself; not an open ecosystem.
- **Bethesda.net direct integration** — largely subsumed by Creations now; that path is deferred (see above).
- **Patreon integration** — Patreon is not a modding platform; it's a creator income channel. Adding it would invite "ModWrench helps you maximize Patreon" interpretations that conflict with the no-monetization-advocacy posture.
- **Tiered "Pro" version of ModWrench** — instant SaaS-ification signal; modder trust evaporates immediately. ModWrench stays free and complete for users, always. Revenue flows through adjacent layers (studio engagements, hosted-managed, StudioWrench paid tiers, career capital) — never through gating the modder-facing product.
- **Ads in the product** — the Overwolf trap. Not negotiable.
- **Telemetry / usage analytics** — none, ever, even "anonymized." The README's six trust rules are firm.
- **AI-generated mod content** — ModWrench is firmly on the workflow-AI side, not the content-generation side. Crash analysis = yes. Generated textures or dialogue = no.
- **Acquisition by Overwolf or any party with a hostile-to-modders reputation** — pre-committed refusal. The community has watched too many projects die this way.

---

## Active contribution opportunities

The platforms in the [Platform expansions](#platform-expansions--planned---scaffolded) section each have a scaffolded directory and are open for implementation. The existing `@modwrench/nexus` and `@modwrench/modio` are reference implementations — see [docs/adding-a-platform.md](docs/adding-a-platform.md) for the full walkthrough.

Other active areas:

- Conflict database — [packages/workbench/data/conflicts/](packages/workbench/data/conflicts/) accepts community PRs with verified mod incompatibilities. Per-game `<gameId>.json` files.
- KNOWN_GAMES catalog in [packages/workbench/src/detect/games.ts](packages/workbench/src/detect/games.ts) — adding new games is a small drive-by PR.
- Additional crashlog formats in [packages/workbench/src/crashlog/](packages/workbench/src/crashlog/) — if your community uses a logger we don't support yet, the parser pattern is ~150 lines.

---

## How to read this document

If you're a modder considering whether to use ModWrench: read the [v1 / v2 Shipped](#current-state) sections, that's what's available today.

If you're a contributor looking for where to help: read the [Platform expansions](#platform-expansions--planned---scaffolded) and [Active contribution opportunities](#active-contribution-opportunities) sections.

If you're a studio or partner thinking about ModWrench's direction: read the [Out of scope](#out-of-scope) section first — that's the durable shape. Then the [Sibling product](#sibling-product) section if you're StudioWrench-curious.

If you found a bug or want a new feature: open an issue. The roadmap is a plan, not a wall — community input shifts priorities and adds items.
