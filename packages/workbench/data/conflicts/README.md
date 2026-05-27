# Community Conflict Database

This directory holds per-game JSON files of known mod conflicts that ModWrench's `mw_check_known_conflicts` tool reads at runtime. One file per game, named `<gameId>.json`, top-level array of conflict entries.

For Bethesda games (Skyrim SE/LE/VR, Fallout 3/NV/4, Starfield, Oblivion), the tool **also** fetches the live [LOOT masterlist](https://github.com/loot) and merges its incompatibilities. The files here are the community layer on top of LOOT — non-Bethesda games rely entirely on this layer.

## Entry schema

```json
{
  "modA": "nexus:65876",
  "modB": "nexus:35895",
  "severity": "incompatible",
  "description": "Both mods modify the Whiterun cell record (0x000165A8). Loading both causes a CTD on entering Whiterun. Disable one or use the linked patch.",
  "source": "community",
  "workaround": "JK's Compatibility Patch Hub provides a merged patch.",
  "patchModId": "nexus:75512"
}
```

### Required fields

- `modA`, `modB` — mod identifiers. Either platform-prefixed (`nexus:N`, `modio:N`, `thunderstore:Author-ModName`) or plugin filenames (`Skyrim.esp`)
- `severity` — one of: `incompatible`, `load-order-sensitive`, `patch-available`, `informational`
- `description` — short prose explaining the conflict
- `source` — `community` for PR-submitted entries; `modwrench-curated` is reserved for entries the maintainers vouch for

### Optional fields

- `workaround` — what to do if you must run both
- `patchModId` — a compatibility patch that resolves the conflict (same prefix conventions as modA/modB)

## Submitting a conflict

1. Verify the conflict is real and reproducible — cite the mod page(s) or a forum thread
2. Open a PR adding an entry to the relevant `<gameId>.json`
3. Use the smallest description that's still actionable for someone diagnosing a crash

ModWrench will not include speculative or unverified conflicts. If you're not sure, file an issue first.
