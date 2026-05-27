# ModWrench

**One wrench. Every mod platform. No data kept.**

ModWrench is a Model Context Protocol (MCP) server that lets your AI assistant talk to mod platforms on your behalf. Discover mods, read changelogs, check versions, browse by tag, manage your modding workflow — from inside Claude Desktop, Claude Code, Cursor, ChatGPT, or any MCP-compatible client.

ModWrench is a **bridge**. It holds nothing about you. Your API keys live in your OS keychain. Your conversations stay in your AI client. Nothing is logged, nothing is sent anywhere except the platforms you're already using.

Built by a tinkerer who didn't see this coming. The modding community deserves better tooling than what the platforms ship by default — so here's a wrench.

---

## What it does today

ModWrench bridges three of the biggest modding platforms on Earth, plus a local workbench for diagnostics:

- **Nexus Mods** — 50M+ users, the dominant home for Bethesda games (Skyrim, Fallout, Starfield), plus thousands of other titles
- **mod.io** — the cross-platform UGC backbone for PC, console, and mobile, embedded in hundreds of games
- **Thunderstore** — 270+ communities, the home of Unity co-op modding (Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS, and more)
- **Workbench** — local-filesystem awareness: which games are installed, which mod manager you use, what your load order looks like, and what your crashlog actually says

Each capability is a separate MCP package (`@modwrench/nexus`, `@modwrench/modio`, `@modwrench/thunderstore`, `@modwrench/workbench`). Install one, some, or all — same wrench, your choice of attachments. The CLI meta-server (`@modwrench/cli`) composes whichever you've configured into a single MCP entry.

### Available tools

**Nexus + mod.io (platform tools — read-only API clients):**

- Search mods by game, query, or tag
- List supported games and tag taxonomies
- Pull mod details (description, author, version, downloads, screenshots, permissions)
- Read changelogs for any version
- Check a mod's dependencies
- Browse mods by category, popularity, or trending
- Nexus-only: archive content preview before download, MD5 reverse-lookup, full file metadata, top-games ranking on mod.io

**Thunderstore (platform tools — read-only public API, no auth required):**

- `thunderstore_list_communities` / `thunderstore_get_community` — discover the 270+ games on Thunderstore
- `thunderstore_list_mods` / `thunderstore_get_mod` — browse and inspect mods in a community
- `thunderstore_search_mods` — substring search by name
- `thunderstore_mod_versions` — full version history with downloads + dependencies
- `thunderstore_top_mods` — highest-rated mods in a community

**Workbench (local diagnostics — no credentials required, except `mw_query_mod_metadata`):**

- `mw_detect_environment` — find the user's games, mod managers, mod loaders, Proton versions
- `mw_read_load_order` — normalize the load order across MO2 / r2modman / Vortex (best-effort)
- `mw_parse_crashlog` — structured parse of Crash Logger SSE, Buffout 4, NetScriptFramework, BepInEx, and Minecraft crash-reports
- `mw_query_mod_metadata` — cross-platform mod lookup with mandatory attribution preserved
- `mw_check_known_conflicts` — pairwise conflict checks against LOOT + community database

The LLM picks the right tool based on what you ask. You don't have to remember which tool does what — just talk.

---

## How it feels to use

```
You: What are the best lighting overhauls on Skyrim SE that don't require ENB?

Claude: [calls nexus_search_mods, filters by category and ENB-free flag,
         checks changelogs for recent updates]

Claude: Three solid options updated in the last year:

  1. Lux (by LordValeryon) — 4.8k endorsements, 1.2M downloads, last
     updated March 2026. ENB-optional. Works with most weather mods.

  2. ELE-LITE (by JawZ) — 2.1k endorsements, completely standalone,
     low performance hit. Best for older systems.

  3. Lanterns of Skyrim II (by mannygt) — adds world lighting via
     placed lanterns rather than reworking interior lighting. Pairs
     well with either of the above.

  All three are free and CC-licensed. Original authors retain
  attribution and rights.
```

The conversation is the interface. Tool names are internal.

---

## Trust posture (the six things ModWrench will never do)

1. **No telemetry.** ModWrench does not phone home. Ever.
2. **No personal data stored.** Your API tokens go straight to the OS keychain (Windows Credential Manager, macOS Keychain, Linux libsecret). The tokens never touch ModWrench's process memory longer than the API call that uses them.
3. **Attribution is preserved end-to-end.** Author names, source platform, and original mod URLs appear in every output that mentions a mod. ModWrench will not let the LLM strip credits.
4. **Permissions are read, not bypassed.** When a mod author says "no asset reuse," ModWrench respects it. No tool in this project will help you violate another modder's stated permissions.
5. **Rate limits are respected.** ModWrench fails politely on someone else's infrastructure rather than hammering it.
6. **Read-only by default.** v1 ModWrench reads from platforms. It does not modify your mod manager state, your installed mods, or anything else on disk without an explicit second confirmation. Write-side tooling (publishing, profile changes) is coming, and it will *always* require confirmation.

These are not promises. They are constraints baked into the code. PRs that violate them will not be merged.

---

## Install

You'll need [Node.js 20+](https://nodejs.org/) and an MCP-compatible client.

### Claude Desktop / Claude Code

Add this to your MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows, equivalent path on Linux):

```json
{
  "mcpServers": {
    "modwrench": {
      "command": "npx",
      "args": ["-y", "@modwrench/cli"]
    }
  }
}
```

Restart your client. Run `modwrench auth login nexus` and `modwrench auth login modio` in a terminal once to set up your API keys. Tokens go straight to your keychain — ModWrench never sees them as files.

### Cursor / Continue / Cline / Roo Code

Add to `.cursor/mcp.json` or your client's equivalent:

```json
{
  "mcpServers": {
    "modwrench": {
      "command": "npx",
      "args": ["-y", "@modwrench/cli"]
    }
  }
}
```

### ChatGPT (Responses API / Connectors) — planned

ChatGPT requires a remote MCP server (Streamable HTTP transport) rather than the stdio path the clients above use. That deployment shape is on the roadmap but not yet implemented — see [docs/remote-deployment.md](docs/remote-deployment.md) for the target architecture (Cloudflare Workers, per-user OAuth at the MCP layer, free-tier-friendly) and what's still missing. Subscribe to the v2.5+ tracking issue if you want to know when this ships.

### Manual install

```bash
npm install -g @modwrench/cli
modwrench --version
modwrench auth login nexus
modwrench auth login modio
```

---

## Where the API keys come from

**Nexus Mods:** Settings → API Access → generate a personal key. Free tier supports the full read API at reasonable rate limits. Premium accounts get higher limits.

**mod.io:** Account settings → API Access → generate a key. Free for all read operations.

ModWrench never asks for your password. Only for the API keys, which you can revoke from each platform any time without uninstalling ModWrench.

---

## Roadmap

ModWrench is structured around three growing waves of capability. v1 is shipped. v2 is the next set of work. v3 is the longer-term vision.

### v1 — Platform bridge (shipped)

mod.io + Nexus Mods. 12 Nexus tools + 11 mod.io tools — 23 total, exposed through one MCP entry via `@modwrench/cli` (or as two isolated processes if you prefer). Read-side coverage of discovery, search, metadata, changelogs, archive previews, and reverse-lookup-by-hash on the Nexus side; popular/trending/dependencies/tags on the mod.io side. OAuth shipped on both platforms (read scopes only); writes deferred until the v3 publishing phase.

### v2 — The compound modder workbench (shipped)

Five atomic tools (`@modwrench/workbench`) that compose under LLM reasoning into a conversational diagnostic experience. All read-only:

- `mw_detect_environment` — detect OS, Steam Deck status, Steam libraries, mod-friendly games (Skyrim SE/LE/VR, Fallout 3/NV/4/4VR, Starfield, Oblivion, Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS, Sims 4), mod managers (Vortex / MO2 / r2modman / CurseForge App), mod loaders (SKSE / F4SE / SFSE / NVSE / FOSE / OBSE / BepInEx 5 / BepInEx 6 IL2CPP / MelonLoader), and Proton versions on Linux
- `mw_read_load_order` — normalize the user's installed mod list across managers. MO2 (full: `modlist.txt` + `plugins.txt` + active-profile discovery from `ModOrganizer.ini`) and r2modman (full: `mods.yml` with author + version preserved) are first-class; Vortex is best-effort folder scan, with an honest `warning` field because its LevelDB state isn't parsed yet
- `mw_parse_crashlog` — structured parsing (no diagnosis — that's the LLM's job) of Crash Logger SSE, Buffout 4, NetScriptFramework, BepInEx exception traces, and Minecraft crash-reports. Extracts exception type/address, call stack, registers, loaded plugins, and FormID-based suspected refs
- `mw_query_mod_metadata` — normalized cross-platform mod lookup with **mandatory** attribution (author + sourcePlatform + pageUrl on every result). Nexus + mod.io live today; Thunderstore + CurseForge planned for v3+
- `mw_check_known_conflicts` — pairwise conflict checks against LOOT's live masterlist (Bethesda games) and ModWrench's bundled community-curated database (`data/conflicts/<gameId>.json` — see [packages/workbench/data/conflicts/README.md](packages/workbench/data/conflicts/README.md) for the contribution schema)

The LLM orchestrates these into the compound experience: *"My Skyrim keeps crashing on the bridge to Whiterun"* → detect environment, read load order, parse the crashlog, look up suspect plugins on Nexus, cross-reference against LOOT's masterlist, return a diagnosis with attribution preserved end-to-end.

The wiring-prompt's sixth tool (`mw_explain`) was intentionally not built — the LLM formats responses natively and the wiring prompt explicitly marks it optional.

### v3 — Multi-platform publishing (planned)

The creator side. One mod definition fans out across platforms in a single conversational command. Inspired by [MC-Publish](https://github.com/Kir-Antipov/mc-publish) (the Minecraft GitHub Action), but conversational rather than CI/CD-bound — because most modders outside the Minecraft community don't write GitHub Actions YAML for a living. Permission discipline is non-negotiable: a mod flagged "no asset reuse" on its source platform never gets republished elsewhere by ModWrench.

Initial targets:

- Nexus Mods + mod.io (already integrated read-side; adding write paths)
- Thunderstore (Unity co-op) — read-side ✅ shipped in [packages/thunderstore/](packages/thunderstore/); write path planned
- Modrinth (Minecraft, open source, modder-respected) — [packages/modrinth/](packages/modrinth/) scaffolded
- CurseForge (largest catalog: Minecraft + Sims 4 Mod Hub + WoW + ARK) — [packages/curseforge/](packages/curseforge/) scaffolded
- Bethesda Creations / Verified Creator — deferred (politically sensitive; only if a specific creator-side case justifies it)

### v2.5 — Dynamic catalog architecture (planned)

As the platform count grows, the tool catalog gets large. ModWrench's answer: boot-time auto-activation of platforms based on what's actually installed on the user's machine, plus an `mw_activate_platform` meta-tool for runtime opt-in. A Skyrim modder sees ~18 tools sized for their setup; a Lethal Company modder sees ~16 sized for theirs — not the union of every platform ModWrench could ever support.

One MCP entry, personalized catalog per user. Full architecture spec: [docs/dynamic-catalog-architecture.md](docs/dynamic-catalog-architecture.md).

### Sibling product — StudioWrench (planned, separate brand)

UGC platforms with creator economies (Roblox, UEFN / Fortnite Creative) don't match modder culture. Different vocabulary, different trust expectations, different competitors. Rather than bolt them onto ModWrench, they get their own product under the MCPwrench umbrella: **StudioWrench**. Same engineering foundation (shared `@mcpwrench/core`), separate audience, separate brand.

See [ROADMAP.md](ROADMAP.md) for the canonical roadmap including sibling products, deferred items, and out-of-scope commitments.

---

## Linux & Steam Deck

ModWrench is built in TypeScript on Node.js. It runs natively on Linux and Steam Deck Desktop Mode with no Windows-specific dependencies. v2's environment detection (`mw_detect_environment`) explicitly handles Proton prefix paths and flags Steam Deck Game Mode limitations.

If you mod on Linux or Steam Deck, ModWrench is for you. File issues with Linux-specific behavior — those are a priority, not an edge case.

---

## What ModWrench is NOT

This is the section that prevents surprises later.

**Not a mod manager.** Use Vortex, MO2, r2modman, Thunderstore Mod Manager, or CurseForge App. ModWrench *talks to* the platforms those tools install from. It doesn't replace any of them.

**Not a mod generator.** ModWrench does not write mods, generate art, generate voices, or use generative AI to produce content of any kind. The LLM you connect ModWrench to may do those things on its own; ModWrench provides no tools to assist in that. Your work is your work.

**Not an Overwolf product.** ModWrench is independent, Apache 2.0, no parent company. The "no data kept" rule is non-negotiable in part because it cannot be true under most commercial structures.

**Not a paid-mods enabler.** ModWrench respects whatever monetization a platform allows, but it does not advocate for paid mods. It will publish your free mod, your donation-supported mod, your Patreon-early-access mod, or your Bethesda Verified Creator mod with equal happiness.

**Not a Nexus Mods Premium replacement.** Nexus Premium gets you faster downloads and other site features. ModWrench is a read API client; for serious downloading volume, you still want Premium.

---

## Contributing

ModWrench is built openly and runs on community input. The non-negotiables (above) are firm. Everything else is open for discussion.

**The fastest ways to contribute right now:**

1. **Try it. Tell me what broke.** File an issue. Be specific. Include your OS, your AI client, your modding setup.
2. **Add a known-conflict entry.** `data/conflicts/<gameId>.json` is the file that powers `mw_check_known_conflicts`. PRs welcome with sources cited.
3. **Add a new game's environment detection.** If you mod a game ModWrench doesn't yet know how to find on disk, `packages/core/src/detect/` is where the patterns live.
4. **Suggest tool shapes.** If the existing tool surface doesn't cover the workflow you actually use, open an issue describing the workflow before the tool.
5. **Add a new platform.** Each platform is its own package (`@modwrench/<platform>`). The shape is documented in `docs/adding-a-platform.md`.

**License:** Apache 2.0. Contributors retain copyright. ModWrench uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO) — sign off your commits with `git commit -s` and you're done. No CLA, no paperwork. See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

**Code of conduct:** Be a wrench, not a hammer. Modders have been burned by enough hammers.

---

## Acknowledgements

ModWrench exists because of decades of work by mod authors who shared their craft for free, and because of the platforms that hosted that work even when the economics were marginal.

Particular gratitude to:

- **Nexus Mods** for being the longest-running, most reliable, most modder-respecting platform in the space
- **mod.io** for building a genuinely cross-platform UGC API that any tool can call
- **The Phostwood Crash Log Analyzer** team for the static-analysis baseline ModWrench's v2 compound tool builds on rather than competes with
- **The LOOT team** for the masterlist that powers conflict detection across the Bethesda modding world
- **r2modman / Thunderstore** for showing what a no-ads, community-first mod manager looks like
- **Kir-Antipov's MC-Publish** for proving that cross-platform mod publishing is solvable and pointing the way for v3
- **The Anthropic MCP team** for the protocol that made tools like this possible to build in a weekend

If you build mods, you make the world more interesting. ModWrench's only job is to get out of your way.

---

## Status

ModWrench is **early**. v1 works. v2 is in active development. v3 is sketched. The roadmap above is genuine intent, not a marketing document — but software is software and timelines slip.

Try it. Break it. Tell me. That's the whole loop.

---

*ModWrench — built by Sean (and the AI assistants he was modding with at the time).*
*MIT-style spirit, Apache 2.0 license, no telemetry, no lock-in.*
*Project home: github.com/<your-username>/modwrench · MCP Registry: registry.modelcontextprotocol.io*
