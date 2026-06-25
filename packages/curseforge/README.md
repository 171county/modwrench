# @modwrench/curseforge

ModWrench's CurseForge MCP server. Search, browse, and inspect mods on
CurseForge directly from any MCP-compatible AI client.

## Auth

The CurseForge Core API requires an API key, sent on every request in the
`x-api-key` header. Generate one in the [CurseForge developer console](https://console.curseforge.com)
(For Developers → API Keys) and set it in your environment:

```
CURSEFORGE_API_KEY=your-key-here
```

Optional: override the base URL with `CURSEFORGE_BASE_URL` (defaults to
`https://api.curseforge.com`).

## Tools

Read-only tools, all prefixed `curseforge_`:

- `curseforge_list_games` — list supported games (`GET /v1/games`)
- `curseforge_get_game` — single game (`GET /v1/games/{gameId}`)
- `curseforge_list_categories` — classes & categories (`GET /v1/categories`)
- `curseforge_search_mods` — search mods (`GET /v1/mods/search`)
- `curseforge_get_mod` — single mod (`GET /v1/mods/{modId}`)
- `curseforge_get_mod_description` — HTML description (`GET /v1/mods/{modId}/description`)
- `curseforge_list_mod_files` — a mod's files (`GET /v1/mods/{modId}/files`)
- `curseforge_get_mod_file` — single file (`GET /v1/mods/{modId}/files/{fileId}`)
- `curseforge_get_file_changelog` — file changelog (`GET /v1/mods/{modId}/files/{fileId}/changelog`)
- `curseforge_featured_mods` — featured/popular/recent (`POST /v1/mods/featured`)
