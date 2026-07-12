# ModWrench

**One wrench. Every mod platform. No data kept.**

ModWrench is a Model Context Protocol (MCP) server that lets your AI assistant talk to mod platforms on your behalf. Discover mods, read changelogs, check versions, browse by tag, manage your modding workflow â€” from inside Claude Desktop, Claude Code, Cursor, ChatGPT, or any MCP-compatible client.

ModWrench is a **bridge**. It holds nothing about you. Your API keys live in your OS keychain. Your conversations stay in your AI client. Nothing is logged, nothing is sent anywhere except the platforms you're already using.

Built by a tinkerer who didn't see this coming. The modding community deserves better tooling than what the platforms ship by default â€” so here's a wrench.

---

## What it does today

ModWrench bridges four of the biggest modding platforms on Earth, plus a local workbench for diagnostics:

- **Nexus Mods** â€” 50M+ users, the dominant home for Bethesda games (Skyrim, Fallout, Starfield), plus thousands of other titles
- **mod.io** â€” the cross-platform UGC backbone for PC, console, and mobile, embedded in hundreds of games
- **Thunderstore** â€” 270+ communities, the home of Unity co-op modding (Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS, and more)
- **Workbench** â€” local-filesystem awareness: which games are installed, which mod manager you use, what your load order looks like, and what your crashlog actually says

Each capability is a separate MCP package (`@modwrench/nexus`, `@modwrench/modio`, `@modwrench/thunderstore`, `@modwrench/workbench`). Install one, some, or all â€” same wrench, your choice of attachments. The CLI meta-server (`@modwrench/cli`) composes whichever you've configured into a single MCP entry.

### Available tools

**Nexus + mod.io (platform tools â€” read-only API clients):**

- Search mods by game, query, or tag
- List supported games and tag taxonomies
- Pull mod details (description, author, version, downloads, screenshots, permissions)
- Read changelogs for any version
- Check a mod's dependencies
- Browse mods by category, popularity, or trending
- Nexus-only: archive content preview before download, MD5 reverse-lookup, full file metadata, top-games ranking on mod.io

**Thunderstore (platform tools â€” read-only public API, no auth required):**

- `thunderstore_list_communities` / `thunderstore_get_community` â€” discover the 270+ games on Thunderstore
- `thunderstore_list_mods` / `thunderstore_get_mod` â€” browse and inspect mods in a community
- `thunderstore_search_mods` â€” substring search by name
- `thunderstore_mod_versions` â€” full version history with downloads + dependencies
- `thunderstore_top_mods` â€” highest-rated mods in a community

**Workbench (local diagnostics â€” no credentials required, except `mw_query_mod_metadata`):**

- `mw_detect_environment` â€” find the user's games, mod managers, mod loaders, Proton versions
- `mw_read_load_order` â€” normalize the load order across MO2 / r2modman / Vortex (best-effort)
- `mw_parse_crashlog` â€” structured parse of Crash Logger SSE, Buffout 4, NetScriptFramework, and BepInEx crash logs
- `mw_query_mod_metadata` â€” cross-platform mod lookup with mandatory attribution preserved
- `mw_check_known_conflicts` â€” pairwise conflict checks against LOOT + community database

The LLM picks the right tool based on what you ask. You don't have to remember which tool does what â€” just talk.

---

## How it feels to use

```
You: What are the best lighting overhauls on Skyrim SE that don't require ENB?

Claude: [calls nexus_search_mods, filters by category and ENB-free flag,
         checks changelogs for recent updates]

Claude: Three solid options updated in the last year:

  1. Lux (by LordValeryon) â€” 4.8k endorsements, 1.2M downloads, last
     updated March 2026. ENB-optional. Works with most weather mods.

  2. ELE-LITE (by JawZ) â€” 2.1k endorsements, completely standalone,
     low performance hit. Best for older systems.

  3. Lanterns of Skyrim II (by mannygt) â€” adds world lighting via
     placed lanterns rather than reworking interior lighting. Pairs
     well with either of the above.

  All three are free and CC-licensed. Original authors retain
  attribution and rights.
```

The conversation is the interface. Tool names are internal.

---

## Trust posture (the six rules)

1. **No telemetry.** ModWrench does not phone home. Ever.
2. **No personal data stored, credentials read-only.** You place your token or API key in your OS credential manager (Windows Credential Manager, macOS Keychain, Linux libsecret); ModWrench only ever reads it. It never accepts keys via `.env` or files, never writes them during normal operation, and never holds them in memory longer than the API call that uses them.
3. **Attribution is preserved end-to-end.** Author names, source platform, and original mod URLs appear in every output that mentions a mod. ModWrench will not let the LLM strip credits.
4. **Permissions are read, not bypassed.** When a mod author says "no asset reuse," ModWrench respects it. No tool in this project will help you violate another modder's stated permissions.
5. **Rate limits are respected.** ModWrench fails politely on someone else's infrastructure rather than hammering it.
6. **Read-only by default.** v1 ModWrench reads from platforms. It does not modify your mod manager state, your installed mods, or anything else on disk without an explicit second confirmation. Write-side tooling (publishing, profile changes) is coming, and it will *always* require confirmation.

These are not promises. They are constraints baked into the code. PRs that violate them will not be merged.

---

## Install

You'll need [Node.js 20+](https://nodejs.org/) and an MCP-compatible client.

ModWrench is published on npm as `@modwrench/cli`. The command below pulls the current public package and starts the stdio MCP server.

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

Restart your client, then put your credentials in your OS credential manager — ModWrench only reads them, and never accepts a key via `.env` or a file. For Nexus and mod.io you can run `modwrench auth login nexus` / `modwrench auth login modio` once; the OAuth flow deposits the token into your keychain for you. If you'd rather use an API key (for Nexus or mod.io) instead of OAuth, store it yourself under service `modwrench-<platform>`, account `default`. Either way the credential lives only in your keychain — ModWrench never sees it as a file.

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

### ChatGPT (Responses API / Connectors) - remote MVP

ChatGPT requires a remote MCP server (Streamable HTTP transport) rather than the stdio path the clients above use. ModWrench now includes `@modwrench/remote`, a first remote-safe MVP for public read-only tools: Thunderstore only (7 tools). It does **not** expose Nexus/mod.io credentials or local workbench filesystem tools.

From source:

```bash
npm run build --workspace @modwrench/remote
npm run start --workspace @modwrench/remote
```

Connect remote-capable clients to `/mcp` on the hosted server, for example `https://your-host.example/mcp`. See [docs/remote-deployment.md](docs/remote-deployment.md) for scope, host settings, and what remains before credentialed remote tools are safe.

### Manual install

```bash
npm install -g @modwrench/cli
modwrench --version
modwrench auth login nexus
modwrench auth login modio
```

---

## Where the API keys come from

**Nexus Mods:** Settings â†’ API Access â†’ generate a personal key. Free tier supports the full read API at reasonable rate limits. Premium accounts get higher limits.

**mod.io:** Account settings â†’ API Access â†’ generate a key. Free for all read operations.

ModWrench never asks for your password. Only for the API keys, which you can revoke from each platform any time without uninstalling ModWrench.

---

## Roadmap

ModWrench is structured around several growing waves of capability. v1 and v2 are shipped. The next waves add smarter catalogs, local toolchain awareness, and creator-side publishing.

### v1 â€” Platform bridge (shipped)

mod.io + Nexus Mods. 12 Nexus tools + 11 mod.io tools â€” 23 total, exposed through one MCP entry via `@modwrench/cli` (or as two isolated processes if you prefer). Read-side coverage of discovery, search, metadata, changelogs, archive previews, and reverse-lookup-by-hash on the Nexus side; popular/trending/dependencies/tags on the mod.io side. OAuth shipped on both platforms (read scopes only); writes deferred until the v3 publishing phase.

### v2 â€” The compound modder workbench (shipped)

Five atomic tools (`@modwrench/workbench`) that compose under LLM reasoning into a conversational diagnostic experience. All read-only:

- `mw_detect_environment` â€” detect OS, Steam Deck status, Steam libraries, mod-friendly games (Skyrim SE/LE/VR, Fallout 3/NV/4/4VR, Starfield, Oblivion, Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS), mod managers (Vortex / MO2 / r2modman), mod loaders (SKSE / F4SE / SFSE / NVSE / FOSE / OBSE / BepInEx 5 / BepInEx 6 IL2CPP / MelonLoader), and Proton versions on Linux
- `mw_read_load_order` â€” normalize the user's installed mod list across managers. MO2 (full: `modlist.txt` + `plugins.txt` + active-profile discovery from `ModOrganizer.ini`) and r2modman (full: `mods.yml` with author + version preserved) are first-class; Vortex is best-effort folder scan, with an honest `warning` field because its LevelDB state isn't parsed yet
- `mw_parse_crashlog` â€” structured parsing (no diagnosis â€” that's the LLM's job) of Crash Logger SSE, Buffout 4, NetScriptFramework, and BepInEx exception traces. Extracts exception type/address, call stack, registers, loaded plugins, and FormID-based suspected refs
- `mw_query_mod_metadata` â€” normalized cross-platform mod lookup with **mandatory** attribution (author + sourcePlatform + pageUrl on every result). Nexus + mod.io live today; Thunderstore planned for a later version
- `mw_deck` â€” opens the **ModWrench deck**: a stateless, themed MCP-UI surface (returned as a `ui://` resource) with four flagship-game themes (Skyrim, Fallout, Lethal Company, Valheim). `mw_parse_crashlog` and `mw_query_mod_metadata` also return themed `ui://` views alongside their JSON
- `mw_check_known_conflicts` â€” pairwise conflict checks against LOOT's live masterlist (Bethesda games) and ModWrench's bundled community-curated database (`data/conflicts/<gameId>.json` â€” see [packages/workbench/data/conflicts/README.md](packages/workbench/data/conflicts/README.md) for the contribution schema)

The LLM orchestrates these into the compound experience: *"My Skyrim keeps crashing on the bridge to Whiterun"* â†’ detect environment, read load order, parse the crashlog, look up suspect plugins on Nexus, cross-reference against LOOT's masterlist, return a diagnosis with attribution preserved end-to-end.

The wiring-prompt's sixth tool (`mw_explain`) was intentionally not built â€” the LLM formats responses natively and the wiring prompt explicitly marks it optional.

### v2.6 - Local toolchain integrations (planned)

The next workbench layer connects ModWrench to the tools serious modders already keep open. These start read-only wherever possible: detect installed tools, parse their project/profile state, surface clear next steps, and only write when a toolchain has a safe, explicit confirmation path.

**Bethesda toolchain:**

- xEdit family: xEdit, SSEEdit, FO4Edit, SF1Edit
- Creation Kit
- LOOT
- BodySlide / Outfit Studio
- NifSkope
- DynDOLOD, TexGen, xLODGen
- Wrye Bash and Synthesis
- Nemesis and Pandora

**Unity / BepInEx toolchain:**

- BepInEx 5 and 6
- ILSpy and dnSpyEx
- UnityExplorer
- AssetStudio and AssetRipper
- ThunderKit

**REDengine toolchain:**

- WolvenKit
- REDmod
- RED4ext
- ArchiveXL
- TweakXL

Cyberpunk 2077 is the lead target for this lane. The Witcher side is worth exploring after Cyberpunk workflows are proven, but the first pass stays cheap to prototype and easy to back out of if the maintenance cost gets weird.

### v3 â€” Multi-platform publishing (planned)

The creator side. One mod definition fans out across platforms in a single conversational command. Permission discipline is non-negotiable: a mod flagged "no asset reuse" on its source platform never gets republished elsewhere by ModWrench.

Initial targets:

- Nexus Mods + mod.io (already integrated read-side; adding write paths)
- Thunderstore (Unity co-op) â€” read-side âœ… shipped in [packages/thunderstore/](packages/thunderstore/); write path planned

### v2.5 â€” Dynamic catalog architecture (planned)

As the platform count grows, the tool catalog gets large. ModWrench's answer: boot-time auto-activation of platforms based on what's actually installed on the user's machine, plus an `mw_activate_platform` meta-tool for runtime opt-in. A Skyrim modder sees ~18 tools sized for their setup; a Lethal Company modder sees ~16 sized for theirs â€” not the union of every platform ModWrench could ever support.

One MCP entry, personalized catalog per user. Full architecture spec: [docs/dynamic-catalog-architecture.md](docs/dynamic-catalog-architecture.md).

## Linux & Steam Deck

ModWrench is built in TypeScript on Node.js. It runs natively on Linux and Steam Deck Desktop Mode with no Windows-specific dependencies. v2's environment detection (`mw_detect_environment`) explicitly handles Proton prefix paths and flags Steam Deck Game Mode limitations.

If you mod on Linux or Steam Deck, ModWrench is for you. File issues with Linux-specific behavior â€” those are a priority, not an edge case.

---

## Contributing

ModWrench is built openly and runs on community input. The non-negotiables (above) are firm. Everything else is open for discussion.

**The fastest ways to contribute right now:**

1. **Try it. Tell me what broke.** File an issue. Be specific. Include your OS, your AI client, your modding setup.
2. **Add a known-conflict entry.** `data/conflicts/<gameId>.json` is the file that powers `mw_check_known_conflicts`. PRs welcome with sources cited.
3. **Add a new game's environment detection.** If you mod a game ModWrench doesn't yet know how to find on disk, `packages/core/src/detect/` is where the patterns live.
4. **Suggest tool shapes.** If the existing tool surface doesn't cover the workflow you actually use, open an issue describing the workflow before the tool.
5. **Add a new platform.** Each platform is its own package (`@modwrench/<platform>`). The shape is documented in `docs/adding-a-platform.md`.

**License:** MIT. Contributors retain copyright. ModWrench uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO) â€” sign off your commits with `git commit -s` and you're done. No CLA, no paperwork. See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

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

ModWrench is **early**. v1 shipped (Nexus + mod.io + Thunderstore platforms, 30 read-only tools). v2 shipped (workbench â€” local diagnostics, 5 tools, 55 tests). v2.5 (dynamic catalog) and v3 (multi-platform publishing) are designed but not yet built. See [ROADMAP.md](ROADMAP.md) for what's coming. The roadmap is genuine intent, not a marketing document â€” but software is software and timelines slip.

Try it. Break it. Tell me. That's the whole loop.

---

*ModWrench â€” built by Sean (and the AI assistants he was modding with at the time).*
*MIT license, no telemetry, no lock-in.*
*Project home: [github.com/171county/modwrench](https://github.com/171county/modwrench). Published in the MCP Registry as `io.github.171county/modwrench`.*

