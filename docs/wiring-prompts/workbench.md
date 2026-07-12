# Wiring Prompt: ModWrench — The Modder Workbench Compound Tool

## What This Is

The orchestration layer for ModWrench's flagship user-side feature: a conversational "modder workbench" that diagnoses crashes, explains load-order conflicts, validates mod compatibility, and respects Linux/Steam-Deck environments — all from inside the user's normal AI client (Claude Desktop, Claude Code, Cursor, ChatGPT via remote MCP).

This is NOT one tool. It is a small set of atomic MCP tools that compose under the LLM's reasoning. The "compound feel" comes from the orchestration the LLM does naturally, not from a workflow hardcoded into the server. This is the Code Mode pattern: expose primitives, let the model write the workflow.

The user types ONE thing — "my game keeps crashing on the bridge to Whiterun" — and gets a full diagnostic conversation that pulls crash logs, cross-references their load order against Nexus and mod.io, identifies known-bad mod combinations, and proposes a test plan. No keyword routing on the user side, no menu of "which tool do I pick." Just talk.

## License & Positioning

- ModWrench core: Apache 2.0
- ModWrench reads no personal data; all auth tokens stay in OS keychain (Windows Credential Manager, macOS Keychain, Linux libsecret via `@napi-rs/keyring`)
- Crash logs and load orders are processed in-memory and never persisted by ModWrench
- The user's AI client (Claude, ChatGPT) sees the conversation; ModWrench does not
- Attribution metadata is preserved on every tool output — mod author names, source platform, and original mod ID are surfaced in every reply

## Atomic Tools — The MCP Server Surface

These are the building blocks. None of them are the "compound command" by themselves. The compound experience emerges from the LLM chaining them.

### Tool 1 — `mw_detect_environment`

**Purpose:** Figure out where the modder is and what game they're modding before doing anything else.

```typescript
interface DetectEnvironmentInput {
  // No input — environment is auto-detected
}

interface DetectEnvironmentOutput {
  os: "windows" | "macos" | "linux";
  isSteamDeck: boolean;
  detectedGames: Array<{
    gameId: string;            // "skyrimspecialedition", "fallout4", "lethalcompany"
    gameName: string;
    installPath: string;
    modManager?: "vortex" | "mo2" | "r2modman" | "thunderstore-mm" | "none";
    modManagerProfile?: string; // active profile name if applicable
    modLoader?: "skse" | "f4se" | "bepinex-5" | "bepinex-6" | "melonloader" | "none";
    modLoaderVersion?: string;
  }>;
  protonVersion?: string;      // only on Linux/Steam Deck
}
```

**Why this matters:** The modding tool universe is wildly different across Bethesda / Unity-co-op. The compound workbench has to know which universe it's in before it can be useful. On Steam Deck, this also flags Proton-specific issues (force-proton workarounds, etc.) that wouldn't apply on bare Windows.

**Implementation notes:**
- On Windows: scan Steam's `libraryfolders.vdf`, registry, plus standard Bethesda Launcher / GOG paths
- On Linux: scan `~/.steam/steam/steamapps/`, Flatpak Steam locations, native installs
- On Steam Deck: check `/etc/os-release` for `steamdeck` ID, then add `isSteamDeck: true`
- Mod manager detection: look for known directory structures (Vortex: `%APPDATA%/Vortex`, MO2: `mods/`, `profiles/`, `mods.txt` in instance dir, r2modman: `%APPDATA%/r2modmanPlus-local`)
- Mod loader detection: file presence checks (`SKSE64_loader.exe`, `BepInEx/core/BepInEx.dll`, etc.)

### Tool 2 — `mw_read_load_order`

**Purpose:** Read the user's current mod list from whichever manager they use, in a normalized format.

```typescript
interface ReadLoadOrderInput {
  gameId: string;
  modManager?: "vortex" | "mo2" | "r2modman" | "auto"; // default auto
  profileName?: string;        // null = active profile
}

interface ReadLoadOrderOutput {
  modManager: string;
  profile: string;
  mods: Array<{
    name: string;
    enabled: boolean;
    loadOrderIndex?: number;   // for Bethesda games; undefined for Unity
    pluginFile?: string;       // .esp/.esl/.esm name for Bethesda
    version?: string;
    sourcePlatform?: "nexus" | "modio" | "thunderstore" | "unknown";
    sourceModId?: string;       // platform-specific ID, supports attribution
    author?: string;            // PRESERVED — never strip
    installedAt?: string;       // ISO timestamp
  }>;
  enabledCount: number;
  totalCount: number;
}
```

**Why this matters:** The compound workbench can't reason about "your load order" without reading it. The normalized format means downstream tools don't care whether the user is on Vortex, MO2, or r2modman. Attribution (`author`, `sourcePlatform`, `sourceModId`) is mandatory in every entry — this is the trust position made concrete.

**Implementation notes:**
- Vortex: parse `%APPDATA%/Vortex/state.v2/persistent.json` (JSON)
- MO2: parse `modlist.txt`, `plugins.txt`, `loadorder.txt` in the instance's `profiles/<profile>/` directory
- r2modman: read `%APPDATA%/r2modmanPlus-local/<game>/profiles/<profile>/mods.yml`
- Each loader has slightly different state file formats — handle the variations cleanly, fail loudly with a useful error if the format is unknown
- Never modify these files; this tool is read-only

### Tool 3 — `mw_parse_crashlog`

**Purpose:** Read a crash log (Bethesda Crash Logger SSE, Buffout 4, NetScriptFramework, or BepInEx exception) and extract structured information without trying to diagnose it.

```typescript
interface ParseCrashlogInput {
  logContent?: string;          // either provide content directly
  logPath?: string;             // or a path to read
  logType?: "auto" | "crashlogger-sse" | "buffout4" | "netscriptframework" | "bepinex";
}

interface ParseCrashlogOutput {
  detectedType: string;
  gameVersion?: string;
  loggerVersion?: string;
  timestamp?: string;
  exception: {
    type?: string;              // EXCEPTION_ACCESS_VIOLATION, NullPointerException, etc.
    address?: string;
    description?: string;
  };
  callStack: Array<{
    module: string;             // SkyrimSE.exe, plugin.dll, etc.
    function?: string;
    offset?: string;
  }>;
  loadedPlugins: Array<{        // for Bethesda: what was loaded at crash time
    name: string;
    loadIndex?: string;
  }>;
  registers?: Record<string, string>;
  suspectedRefs?: Array<{       // FormIDs, mod-specific identifiers found in stack
    type: string;
    value: string;
    likelySource?: string;      // best guess at originating mod
  }>;
  rawSections: Record<string, string>;
}
```

**Why this matters:** Static crash analyzers (Phostwood's, Skyrim Crash Decoder, CLAS/CLASSIC) do pattern-matching. This tool does *parsing only* — extract the structured data, then let the LLM reason about what it means in the context of the user's specific load order. That separation is the whole differentiator.

**Implementation notes:**
- Crash Logger SSE format: parse `Documents\My Games\Skyrim Special Edition\SKSE\crash-YYYY-MM-DD-HH-MM-SS.log`
- Buffout 4 format: parse `Documents\My Games\Fallout4\F4SE\crash-*.log`
- BepInEx exceptions: parse `BepInEx/LogOutput.log` for fatal exception traces
- Always emit `detectedType` so the LLM can adapt its reasoning to the format
- `suspectedRefs.likelySource` is a soft guess only — never present as certainty

### Tool 4 — `mw_query_mod_metadata`

**Purpose:** Get information about a specific mod from its source platform. Supports cross-platform queries.

```typescript
interface QueryModMetadataInput {
  modId?: string;
  modName?: string;             // fuzzy match if id unknown
  platform?: "nexus" | "modio" | "thunderstore" | "any";
  gameId?: string;              // recommended for fuzzy name matches
}

interface QueryModMetadataOutput {
  found: boolean;
  mod?: {
    id: string;
    name: string;
    author: string;             // attribution preserved
    platform: string;
    version: string;
    lastUpdated: string;
    description: string;
    knownIncompatibilities?: string[];
    requiredDependencies?: string[];
    sksePluginVersion?: string; // Bethesda-specific
    bepinexVersion?: string;    // Unity-specific
    permissions?: {              // Nexus permission flags, normalized
      modificationAllowed: boolean;
      assetReuseAllowed: boolean;
      conversionAllowed: boolean;
    };
    downloadCount?: number;
    endorsements?: number;
    pageUrl: string;
  };
}
```

**Why this matters:** The compound workbench frequently needs to ask "what is this mod, who made it, what's it known to conflict with?" This is the answer-source. **Critically, this tool surfaces author and permissions metadata on every reply** — that's how trust gets baked into the chain.

**Implementation notes:**
- Hits the Nexus / mod.io / Thunderstore APIs your existing tools already wrap. Just normalize the response shape.
- Cache aggressively (24-hour TTL is fine for description, version metadata); never cache user-specific data
- Respect platform rate limits cleanly; fail with a useful message rather than retrying silently

### Tool 5 — `mw_check_known_conflicts`

**Purpose:** Look up community-known incompatibility patterns between mods.

```typescript
interface CheckKnownConflictsInput {
  gameId: string;
  modIds: string[];             // list to check pairwise
}

interface CheckKnownConflictsOutput {
  conflicts: Array<{
    modA: string;
    modB: string;
    severity: "incompatible" | "load-order-sensitive" | "patch-available" | "informational";
    description: string;
    source: "loot-masterlist" | "community" | "modwrench-curated";
    workaround?: string;
    patchModId?: string;
  }>;
}
```

**Why this matters:** LOOT's masterlist is community-curated knowledge that lives in plain text files in a GitHub repo. ModWrench can read that file directly (no API key needed, just HTTPS fetch) and use it as the seed conflict database for Bethesda games. For non-Bethesda games (Unity), there's no equivalent yet — start by maintaining a small curated JSON file in your repo and let the community contribute via PRs. That contribution loop itself becomes a moat over time.

**Implementation notes:**
- LOOT masterlist URL pattern: `https://raw.githubusercontent.com/loot/<game>/v0.21/masterlist.yaml`
- Parse the YAML, index by plugin name, expose to this tool
- Build the cross-game conflict file as `data/conflicts/<gameId>.json` in the ModWrench repo
- This is also the file that v3+ community contributions land in — first PR from a non-author contributor is your first signal that the project has a community

### Tool 6 — `mw_explain` (the optional unifier)

**Purpose:** A meta-tool that the LLM uses to bundle multiple findings into a single human-readable explanation, with attribution preserved.

```typescript
interface ExplainInput {
  context: "crash-diagnosis" | "load-order-issue" | "compatibility-check" | "environment-summary";
  findings: Array<{
    severity: "critical" | "warning" | "informational" | "success";
    title: string;
    detail: string;
    relatedMods?: Array<{ name: string; author: string; pageUrl: string }>;
    suggestedAction?: string;
  }>;
}

interface ExplainOutput {
  markdownSummary: string;      // formatted for chat display
}
```

**Why this matters:** Optional but valuable. The LLM can do this formatting itself, but giving it a structured way to bundle findings means the output is consistently formatted across users. **Attribution is mandatory in `relatedMods` — never let the LLM strip author names.**

---

## The "Compound Command" Experience

The user does not invoke tools manually. They just talk. Here's what the conversation feels like:

```
User: my Skyrim keeps crashing in Whiterun, here's the crash log
       [pastes Crash Logger SSE log]

LLM: [internally calls mw_detect_environment]
LLM: [internally calls mw_parse_crashlog with the pasted content]
LLM: [internally calls mw_read_load_order to get the user's active mods]
LLM: [internally calls mw_query_mod_metadata for the suspect mods identified
      in the crashlog's loadedPlugins + suspectedRefs sections]
LLM: [internally calls mw_check_known_conflicts on the relevant mod pairs]
LLM: [composes a reply]

LLM response:
  "This looks like a navmesh conflict in Whiterun. Your crashlog shows
   the access violation at SkyrimSE.exe + 0x1a3f, with `JK's Whiterun
   Outskirts.esp` (by Jkrojmal) and `Cities of the North - Whiterun.esp`
   (by SoldierofWar) both loaded and modifying the same cell.
   
   This is a known incompatibility — LOOT's masterlist flags it, and
   both authors have patch suggestions on their Nexus pages.
   
   To test: disable Cities of the North - Whiterun temporarily and
   reload your save outside Whiterun. If the crash stops, the patch
   from JK's Compatibility Patch Hub (also by Jkrojmal, on Nexus)
   resolves this combination cleanly.
   
   Attribution: this analysis used LOOT's masterlist and metadata
   from Nexus Mods. Original mod authors retain all rights."
```

The user's experience is a *conversation* with what feels like a single expert. The implementation is six atomic tools the LLM chains.

This is the architectural point: **don't bake the workflow into a single super-tool.** A super-tool is brittle, doesn't generalize across games, and traps you in workflow maintenance. Atomic tools generalize naturally because the LLM rewrites the workflow per query.

---

## Implementation Order

If you build these in this order, every step adds visible value:

1. **`mw_detect_environment`** first — this also doubles as the project's "is it installed correctly?" smoke test
2. **`mw_read_load_order`** for Vortex + MO2 first (covers ~95% of Bethesda modders), then r2modman (covers Unity)
3. **`mw_parse_crashlog`** for Crash Logger SSE first (largest user base), then Buffout 4, then BepInEx
4. **`mw_query_mod_metadata`** — wrap your existing 14 Nexus/mod.io tools here, just normalize the response shape
5. **`mw_check_known_conflicts`** — fetch the LOOT masterlist, parse the YAML, expose. The community-curated JSON file comes later.
6. **`mw_explain`** — last, optional, can be omitted entirely if the LLM formats well on its own

Each step is shippable on its own. After step 3, you already have something nobody else has: an LLM that reads your Skyrim crash log + your actual load order and reasons across them.

---

## Linux / Steam Deck Considerations

This is a real audience and growing. The compound workbench has to behave correctly on these systems or the Steam Deck modding subreddit will rage at you on day one.

- **Path detection** must handle Proton prefix paths (`compatdata/<appid>/pfx/drive_c/...`) not just native Windows paths
- **Mod manager preference** on Linux skews to r2modman (native AppImage build) — Vortex doesn't run cleanly. Don't assume Vortex exists.
- **BepInEx on Linux** needs `WINEDLLOVERRIDES="winhttp=n,b"` or the `--doorstop-enable` flag set via Steam launch options. If you detect a Linux BepInEx setup that's *not* configured this way, surface that as a likely problem before the user even asks.
- **Steam Deck Game Mode** can't run mod managers directly. If you detect Game Mode (vs Desktop Mode), recommend Desktop Mode for ModWrench operations.
- **Filesystem case sensitivity** matters on Linux ext4 but not on Windows NTFS. A mod with `Textures/...` vs `textures/...` in its zip will silently fail on Linux. Flag this in `mw_parse_crashlog` if you see file-not-found errors that look like case issues.

---

## Trust Architecture (Non-Negotiables)

These are not optional. If ModWrench violates any of these, the community will notice within days.

1. **No telemetry, ever.** No anonymous usage stats, no "improve product" pings. The README should say this explicitly.
2. **No personal data stored.** API tokens live in the OS keychain. Load orders, crash logs, queries are all in-memory only.
3. **Attribution preserved end-to-end.** Author names, source platforms, and original mod URLs appear in every output that mentions a mod. The LLM is instructed to never strip these.
4. **Permissions are read, not bypassed.** When `mw_query_mod_metadata` returns `permissions.modificationAllowed: false`, downstream tools (especially future publishing tools) must refuse to act on that mod.
5. **Rate limits respected.** Failing politely beats failing fast on someone else's infrastructure.
6. **Read-only by default.** None of the v1 tools modify the user's mod manager state. That's a deliberate posture — earn trust on the read side first, then add write tools later (and even then, always with explicit confirmation).

---

## What This Unlocks

After this compound tool ships:

- ModWrench is no longer "a Nexus and mod.io MCP." It's "the AI modding workbench."
- The category name shifts. You're not competing with Vortex (a mod manager); you're competing with the *absence* of a modder workbench. There is no competitor in that space.
- Later features (multi-platform publishing, richer local tool integrations, profile-safe write actions) become natural extensions of the same conversational surface.
- Steam Deck / Linux modders get a first-class experience that Vortex doesn't offer them.
- A user's first interaction with ModWrench answers a real, painful question on the first conversation. That's how word-of-mouth happens in modding communities — the GamerPoets YouTube channel will mention you, and that's the inflection point.

---

## Naming the Compound Tool

**Decision (May 2026):** the v2 package is `@modwrench/workbench`. The word "Copilot" was the original working title but was retired before any public push due to active Microsoft trademark enforcement on "Copilot" branding across AI tooling. Workbench reads cleanly with the wrench/tools aesthetic, names a *place where work happens* rather than an AI personality, and stays defensible as descriptive use if ever challenged.

From a *marketing* perspective, users still don't need to learn the package name. The atomic tools (`mw_detect_environment` etc.) are internal; the *experience* doesn't need a brand label. Users will call it "ModWrench" in casual usage and that's exactly right — "Workbench" is the engineering label, "ModWrench" is the product.

---

## Sources & Anchors

- Vortex state format: Nexus Mods Vortex source on GitHub, `extensions/` directory
- MO2 state format: ModOrganizer2/modorganizer GitHub repo, `src/profile.cpp`
- r2modman state format: `ebkr/r2modmanPlus`, `src/r2mm/manager/installing/`
- Crash Logger SSE format: `Documents\My Games\Skyrim Special Edition\SKSE\crash-*.log` examples on Nexus
- LOOT masterlist: `https://github.com/loot/skyrimse` (and equivalents for other games)
- BepInEx log format: BepInEx 5.x and 6.x release notes on GitHub
- Phostwood's Crash Log Analyzer: `phostwood.github.io/crash-analyzer` (reference for what pattern-matching covers; ModWrench's edge is reasoning *beyond* the patterns)

---

*Wiring prompt for ModWrench's compound modder-workbench tool. Atomic tools + LLM orchestration = compound experience. Style-matched to existing WIRING-PROMPT_* files in the ModWrench project.*
