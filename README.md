# ModWrench

**One wrench. Every mod platform. No data kept.**

ModWrench is a Model Context Protocol (MCP) server that lets your AI assistant talk to mod platforms on your behalf. Discover mods, read changelogs, check versions, browse by tag, manage your modding workflow — from inside Claude Desktop, Claude Code, Cursor, ChatGPT, or any MCP-compatible client.

ModWrench is a **bridge**. It holds nothing about you. Your API keys live in your OS keychain. Your conversations stay in your AI client. Nothing is logged, nothing is sent anywhere except the platforms you're already using.

Built by a tinkerer who didn't see this coming. The modding community deserves better tooling than what the platforms ship by default — so here's a wrench.

---

## What it does today

ModWrench currently bridges two of the biggest modding platforms on Earth:

- **Nexus Mods** — 50M+ users, the dominant home for Bethesda games (Skyrim, Fallout, Starfield), plus thousands of other titles
- **mod.io** — the cross-platform UGC backbone for PC, console, and mobile, embedded in hundreds of games

Each platform has its own MCP package (`@modwrench/nexus`, `@modwrench/modio`). Install one, both, or all — same wrench, your choice of attachments.

### Available tools

**Shared across both platforms:**

- Search mods by game, query, or tag
- List supported games
- Pull mod details (description, author, version, downloads, screenshots)
- Read changelogs for any version
- Check a mod's dependencies
- Browse mods by category or popularity
- Resolve mod authors (find every mod by a given creator)

**Nexus-specific:**

- Preview the archive contents of a mod file before downloading
- Read full file metadata (size, version, upload date, virus scan status)
- Surface a mod's permissions (modification, conversion, asset reuse, DP eligibility)

**mod.io-specific:**

- Show the tag taxonomy for any mod.io game (each game has its own)
- Get mod dependencies as a resolved graph
- Surface the mod's monetization status (free / premium / subscription)

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

### ChatGPT (Responses API / Connectors)

ModWrench can run as a remote MCP via Streamable HTTP. See `docs/remote-deployment.md` for the Cloudflare Workers walkthrough (zero infrastructure cost up to a meaningful free tier).

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

### v2 — The compound modder copilot (in progress)

A small set of atomic tools that compose into a conversational diagnostic experience:

- `mw_detect_environment` — auto-detect your OS, game, mod manager (Vortex / MO2 / r2modman / Thunderstore MM / CurseForge App), and mod loader (SKSE / F4SE / BepInEx / Forge / Fabric)
- `mw_read_load_order` — normalize your installed mod list across mod managers
- `mw_parse_crashlog` — parse Crash Logger SSE, Buffout 4, BepInEx exceptions, Minecraft crash reports
- `mw_query_mod_metadata` — wrap the v1 tools with a unified cross-platform shape
- `mw_check_known_conflicts` — read LOOT's masterlist plus community-curated conflict data

The LLM orchestrates these into the compound experience: *"My game keeps crashing, here's the log"* → diagnosis with your specific load order considered.

### v3 — Multi-platform publishing (planned)

The creator side. One mod definition fans out to:

- Nexus Mods
- mod.io
- (later) CurseForge
- (later) Thunderstore
- (later) Bethesda Verified Creator

Inspired by [MC-Publish](https://github.com/Kir-Antipov/mc-publish) (the Minecraft GitHub Action), but conversational rather than CI/CD — because most modders outside the Minecraft community don't live in GitHub Actions YAML.

### v4 and beyond — Adjacent universes

CurseForge, Thunderstore, then Roblox and UEFN. Each lane has its own community, its own API, its own culture. ModWrench expands respectfully or not at all.

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
