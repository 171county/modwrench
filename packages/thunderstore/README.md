# @modwrench/thunderstore

ModWrench's Thunderstore platform package. Read-only MCP tools for discovering and inspecting mods on Thunderstore — the dominant platform for Unity co-op games (Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS, and 270+ others).

Closes the v2 workbench loop: `mw_read_load_order` parses r2modman profiles locally; Thunderstore's tools enrich each installed mod with author, version, downloads, and current page URL.

## Tools

- `thunderstore_list_communities` — every community (game) on Thunderstore
- `thunderstore_get_community` — single community details
- `thunderstore_list_mods` — mods within a community (paginated summary)
- `thunderstore_get_mod` — single mod's metadata (latest version, total downloads, community listings)
- `thunderstore_search_mods` — substring search within a community
- `thunderstore_mod_versions` — full version history of a specific mod
- `thunderstore_top_mods` — highest-rated mods in a community

## Auth

Read-only public API — no credentials required. Tools work anonymously. When v3 write/publishing support lands, OAuth will be added; until then, no env vars needed.

## Usage

Standalone:
```bash
npx @modwrench/thunderstore
```

Or composed into the meta-server via `@modwrench/cli`. See [the project README](../../README.md) for full setup.
