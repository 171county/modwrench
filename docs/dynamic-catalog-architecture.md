# Dynamic Catalog Architecture (v2.5)

**Status: planned. Build trigger: when the 4th platform lands.**

This document captures the design for ModWrench's *dynamic tool catalog* — the architectural move that lets ModWrench grow to 5, 6, 10 platforms without paying linear context cost on every session.

It's not built yet. The current `@modwrench/cli` meta-server uses a static catalog: every installed platform's tools are registered at boot, every session sees the union. That's fine at 3 platforms (workbench + Nexus + mod.io). It won't be fine at 6+.

Future-you (or a contributor) should be able to implement from this doc without re-deriving the problem.

---

## The problem

The MCP protocol's default tool-discovery model is "total discovery." When a client connects, it calls `tools/list` and the server returns the full catalog. The LLM gets every tool's description and JSON Schema in context, every session, and picks from the union when answering.

This works well at small catalog sizes. It scales poorly:

- **Context cost**: at ~10 tools per platform, 5 platforms = ~50 tools = roughly 30-50KB of JSON Schema in context per session, before the user has said anything
- **Picker noise**: an LLM scanning a 70-tool catalog to answer a Skyrim question pays attention cost on Lethal Company tools, Modrinth tools, etc. that have zero relevance
- **User experience**: a Skyrim-only modder shouldn't see r2modman or Minecraft tools in their picker; a Lethal Company modder shouldn't see Bethesda crash-format tools

The naive solutions:

- **Split into multiple MCPs** (`modwrench-bethesda`, `modwrench-unity`, ...) — works, but moves the burden of "which one do I install?" onto the user, fragments cross-platform features like `mw_query_mod_metadata`, and multiplies the configs modders have to maintain in `claude_desktop_config.json`
- **Filter tools client-side** — out of scope for the protocol; clients don't expose hooks for this and shouldn't have to

The right move is server-side: ModWrench should expose *a personalized catalog per user*, sized to that user's actual setup, with a programmatic way to expand it on demand when the LLM needs more.

---

## The MCP protocol mechanism

The MCP spec supports this. Two relevant features:

### `listChanged` capability

A server can declare in its initialize response:

```json
{
  "capabilities": {
    "tools": {
      "listChanged": true
    }
  }
}
```

This tells the client "my tool catalog can change at runtime; re-fetch when I tell you to."

### `notifications/tools/list_changed`

When the server's tool catalog changes (a tool is added, removed, or its schema/description changes meaningfully), it emits:

```json
{
  "method": "notifications/tools/list_changed"
}
```

The client is expected to re-call `tools/list` to fetch the new catalog. Claude Desktop, Cursor, Continue, Cline, and most modern MCP clients implement this correctly.

This means a server can have a genuinely dynamic catalog — register and unregister tools at any point in the session, notify the client, and the LLM picks from the updated set on subsequent turns.

---

## The architecture

A hybrid approach that handles both the common case (boot-time auto-activation) and the edge case (runtime activation when the user pivots).

### Step 1 — Boot-time auto-activation

When `@modwrench/cli` starts:

1. The workbench platform always registers (it's local-filesystem, no credentials, zero cost)
2. The server immediately runs `mw_detect_environment` internally (filesystem reads complete in ~10-50ms, before any client interaction)
3. Based on the detected setup, the server decides which platform packages to activate

Example decision logic:

```
if detected_games has any Bethesda game:
  activate("nexus")
if detected_mod_managers includes "r2modman" or
   any detected_game.family == "unity-coop":
  activate("thunderstore")
if detected_mod_managers includes "curseforge" or
   any detected_game.family == "minecraft":
  activate("modrinth")
  activate("curseforge")
if Patreon/mod.io credential is configured in env or keychain:
  activate("modio")
```

The `activate(platform)` call:
1. Loads the platform's `register` module
2. Resolves the platform's credential (best-effort; if no credential, register fails gracefully and the platform stays dormant)
3. Calls `registerXTools(server, credential)`
4. Records the platform as "active" in the meta-server's state
5. Tools are now in the catalog

Platforms that aren't auto-activated remain dormant. Their packages are installed (npm dependencies), but their tools aren't in the catalog. They cost zero context.

After auto-activation completes, the meta-server initializes the MCP transport, accepts the client's `initialize` call, and reports the personalized catalog via `tools/list`.

### Step 2 — The `mw_activate_platform` meta-tool

A single tool, always registered, that lets the LLM pull in dormant platforms on demand:

```typescript
mw_activate_platform({ name: "modrinth" })
  → { activated: true, toolCount: 8, newTools: [...] }
```

When called:
1. Server checks if the platform is already active (no-op if so)
2. Server loads the platform's `register` module
3. Server resolves credentials (returns clear error if none)
4. Server calls `registerXTools(server, credential)`
5. Server emits `notifications/tools/list_changed`
6. Server returns a structured response naming what was added

The tool description teaches the LLM the pattern. Something like:

> Activate an additional platform's tool set. ModWrench auto-detects which
> platforms you use based on your local setup, but call this if the user asks
> about a platform that wasn't auto-detected (e.g., they're researching a mod
> on a platform they don't have installed). Available platforms: nexus, modio,
> thunderstore, modrinth, curseforge.

LLMs pick up "activation tool" patterns reliably — they already understand "this tool unlocks others."

### Step 3 — Optional: deactivation

A symmetric `mw_deactivate_platform` tool exists but is mostly for completeness. Most sessions never need to shrink the catalog; the server lifecycle ends with the MCP session anyway. Worth implementing for cleanliness but not a priority.

---

## Implementation sketch

### Refactoring per-platform `register` exports

The current shape:

```typescript
export function registerNexusTools(
  server: McpServer,
  credential: Credential
): { toolCount: number; baseUrl: string };
```

This is one-shot — tools are added to the server, can't be removed. For dynamic catalog support, each platform package needs:

```typescript
export function registerNexusTools(
  server: McpServer,
  credential: Credential
): {
  toolCount: number;
  baseUrl: string;
  toolNames: string[];  // for later unregistration
};
```

The MCP SDK supports `server.removeTool(name)` (or equivalent — confirm the exact API at build time). The meta-server tracks which platform owns which tools so it can clean up cleanly on deactivation.

### Meta-server orchestration

Sketch:

```typescript
type PlatformId =
  | "nexus"
  | "modio"
  | "thunderstore"
  | "modrinth"
  | "curseforge"
  | "workbench";

type ActivePlatform = {
  id: PlatformId;
  toolNames: string[];
  baseUrl?: string;
};

class MetaCatalog {
  private active = new Map<PlatformId, ActivePlatform>();

  async activate(id: PlatformId): Promise<{ added: string[]; alreadyActive?: true }> { ... }
  async deactivate(id: PlatformId): Promise<{ removed: string[] }> { ... }
  isActive(id: PlatformId): boolean { ... }
  listActive(): PlatformId[] { ... }
}
```

The `activate` call wraps:
1. Credential resolution (per-platform `loadCredential`)
2. Dynamic import of the platform's `./register`
3. Register call
4. `server.notification("notifications/tools/list_changed")`
5. State update in `MetaCatalog`

### Auto-activation policy at boot

A small ruleset in the meta-server CLI that maps detected setup to platform activations. Concrete sketch:

```typescript
async function autoActivateBasedOnEnvironment(catalog: MetaCatalog) {
  const env = await detectEnvironment();  // workbench's existing function

  if (env.detectedGames.some(g => isBethesda(g.gameId))) {
    await catalog.activate("nexus");
  }

  if (env.detectedGames.some(g => isUnityCoop(g.gameId)) ||
      env.installedModManagers.some(m => m.name === "r2modman")) {
    await catalog.activate("thunderstore");
  }

  if (env.detectedGames.some(g => isMinecraft(g.gameId)) ||
      env.installedModManagers.some(m => m.name === "curseforge")) {
    await catalog.activate("modrinth");
    await catalog.activate("curseforge");
  }

  // mod.io is harder to auto-detect from local setup since it's used as a
  // backend by many games; activate when its credential is present.
  if (hasCredentialFor("modio")) {
    await catalog.activate("modio");
  }
}
```

The classification helpers (`isBethesda`, `isUnityCoop`, `isMinecraft`) are derived from the existing `GameDef.family` field in `packages/workbench/src/detect/games.ts`.

### The meta-tool

A single tool registered at boot, regardless of which platforms are active:

```typescript
server.tool(
  "mw_activate_platform",
  "Activate an additional platform's tool set... [full description]",
  {
    name: z.enum(["nexus", "modio", "thunderstore", "modrinth", "curseforge"])
      .describe("Platform identifier to activate."),
  },
  async ({ name }) => {
    const result = await catalog.activate(name);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);
```

---

## Edge cases and constraints

### Credential availability changes mid-session

The user runs `modwrench auth login nexus` in another terminal during an active MCP session. The new credential is in the keychain but the meta-server doesn't know about it.

**Resolution:** the next `mw_activate_platform({ name: "nexus" })` call re-resolves the credential and succeeds. The LLM picks this up naturally because the activation tool always re-tries the credential resolution. No special signaling needed.

### Clients that don't support `listChanged`

A small number of MCP clients may not handle `notifications/tools/list_changed` correctly. For those:

- The boot-time auto-activation still works (catalog is set before `initialize` returns)
- The runtime `mw_activate_platform` flow degrades to "the tools are registered server-side, but the LLM may not see them until the session restarts"

Detection: the client's `initialize` request includes its capabilities. If the client doesn't claim `tools.listChanged` capability, the meta-server can log a warning and the meta-tool can include a note in its response ("activated, but your client may need to be restarted to see the new tools").

### Per-platform credential failures

A user has Lethal Company installed (Thunderstore would auto-activate) but their Thunderstore credential isn't configured.

**Resolution:** the auto-activation step catches the credential failure, logs to `skipped`, and proceeds. The platform is not in the catalog. The LLM never sees Thunderstore tools, doesn't try to use them, doesn't fail mysteriously. Same warn-and-continue pattern the current static-catalog meta-server already uses.

If the LLM later calls `mw_activate_platform({ name: "thunderstore" })`, the activation re-tries credential resolution. If still missing, it returns a structured error pointing at `modwrench auth login thunderstore` (or equivalent). The LLM can relay this to the user.

### Auto-activation vs. user intent mismatch

The user has Skyrim installed (Nexus auto-activated) but their question is about a Lethal Company mod a friend mentioned. The catalog doesn't include Thunderstore tools.

**Resolution:** the LLM, on seeing it can't answer with the active toolset, calls `mw_activate_platform({ name: "thunderstore" })`. The tool description and the meta-server's overall behavior teach this pattern. The user experience is one extra round-trip, transparent.

The meta-tool's response should be loud-and-helpful: "Activated thunderstore. 8 tools added: thunderstore_search_mods, ..." so the LLM knows what's now in scope.

---

## What this unlocks

A few things beyond the obvious context-cost win:

1. **A Skyrim modder's catalog is genuinely small.** ~18-22 tools (workbench + Nexus + meta-tool). The picker is fast, the LLM's tool selection is sharper, and the cognitive overhead for both LLM and human is minimal.

2. **Platform-scoped trust signaling.** ModWrench can publicly say "your catalog reflects your setup; ModWrench doesn't pile tools on you for platforms you don't use." That's a values statement that resonates with modder culture and competes well against "everything-everywhere" SaaS positioning.

3. **A natural foundation for federation.** Once ModWrench has dynamic catalog support, third parties can build platform-specific extensions (`@<contributor>/skyrim-modlist-export`) that the meta-server can also activate. The activation pattern becomes a community surface, not just a ModWrench-internal mechanic. (This is deferred — security and review story needs careful thought first.)

4. **Easier onboarding of niche platforms.** GameBanana, Bethesda Creations (if ever), or anything specialty can ship as an installed-but-dormant package. Only users who explicitly need it pay the catalog cost.

---

## When to build this

**Trigger:** when the 4th platform lands and at least one of the following happens:

- A real user reports catalog noise ("why are Minecraft tools showing up when I mod Skyrim")
- Tool-picker latency becomes measurable in any major MCP client
- The `tools/list` JSON Schema crosses 30KB

Until then, the static-catalog meta-server is fine and the current architecture supports retrofitting cleanly. The per-platform `register` exports already exist; adding the unregister side and the orchestration layer is bounded work (~1-2 days for a focused build).

**Don't build this prematurely.** With workbench + Nexus + mod.io (28 tools), it's not needed. Build it when the signal arrives.

---

## Open questions to resolve at build time

These don't block planning but need decisions when implementation starts:

- **Exact MCP SDK API for tool removal** — `server.removeTool(name)` is the obvious shape; confirm against the version of `@modelcontextprotocol/sdk` we're on at build time.
- **Notification ordering** — when activating multiple platforms in quick succession at boot, do we send one `list_changed` after all of them or one per platform? Probably one batch.
- **Persisting active set across sessions** — should the meta-server remember "user explicitly activated CurseForge last session, auto-activate again next time"? Probably yes, lightly, via a config file. Defer until a user asks.
- **Capability mismatch graceful degradation** — exact UX for clients that don't support `listChanged`. The meta-tool's response should include a hint when this is the case.

---

*This doc captures intent at the time of planning. The codebase wins if anything here is stale by the time it's implemented; treat this as the "why" and let the implementation decide the "how" where they diverge.*
