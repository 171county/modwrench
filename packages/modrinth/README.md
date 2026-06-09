# @modwrench/modrinth

ModWrench's Modrinth platform package. Read-only MCP tools for discovering and inspecting Minecraft mods, modpacks, plugins, datapacks, resource packs, and shaders on Modrinth.

Modrinth is the open-source Minecraft modding platform. Reads use the public REST API and do not require credentials.

## Tools

- `modrinth_search` - full-text search with project type, loader, game version, and category facets
- `modrinth_get_project` - inspect a project by ID or slug
- `modrinth_get_versions` - list project versions with optional loader and game-version filters
- `modrinth_get_version` - inspect a specific version
- `modrinth_list_categories` - list category metadata for filters
- `modrinth_list_loaders` - list supported loaders
- `modrinth_list_game_versions` - list Minecraft versions, optionally release-only

## Auth

Read-only public API - no credentials required. If write/publishing support lands later, it should use Modrinth PAT/OAuth flows with explicit user consent.

## Usage

Standalone:

```bash
npx @modwrench/modrinth
```

Or composed into the meta-server via `@modwrench/cli`. See [the project README](../../README.md) for full setup.
