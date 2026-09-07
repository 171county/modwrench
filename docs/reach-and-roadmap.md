# ModWrench — Reach & Roadmap

Status: **design / approved direction** (2026-07-13). Complements `docs/ide-extension-plan.md` (the VS Code "Watch Me" panel) and `docs/dynamic-catalog-architecture.md` (the meta-server). This is the plan for how ModWrench *reaches* modders across every AI coding surface, and what it grows into.

> Supersedes the premise in `ide-extension-plan.md` that "MCP already reaches Cursor/VS Code via `mcp.json`, so the extension isn't about reach." Discovery research (below) showed that premise is wrong. See §1.

---

## 1. The reach reality (why this doc exists)

Discovery research (five parallel agents, 2026-07-13, primary sources) corrected a wrong assumption. **An IDE supporting MCP at the host level does not mean an AI-agent _extension_ running inside it can see that MCP.** Every agent brings its own MCP stack and its own config file. Installing a server "at the IDE level" reaches only that IDE's first-party agent — never the other agents beside it. On one machine, in one editor, ModWrench can be visible to one agent and invisible to the next.

| Surface | Its own MCP config | What it reaches |
|---|---|---|
| VS Code native (`servers` key) | `.vscode/mcp.json` + user `mcp.json` | **GitHub Copilot** (+ extensions that opt into the `lm` API) |
| Cursor agent | `.cursor/mcp.json` (`mcpServers`) | Cursor Composer / Chat / Plan only |
| Claude Code (CLI *and* in-IDE) | `claude mcp add` / `.mcp.json` / `~/.claude.json` | Claude Code everywhere — nothing else |
| Cline | `cline_mcp_settings.json` | Cline only |
| Continue | `~/.continue/config.yaml` (YAML) | Continue only |
| Roo Code | own file — **EOL 2026-05-15**, redirects users to Cline | — |
| Kilo Code | own file, migrating to `kilo.jsonc` | Kilo only |
| Windsurf / Antigravity | `mcp_config.json` (`serverUrl` for remote) | their own agents |
| JetBrains / Zed | own again (Zed: `context_servers`) | their own agents |

**The one nuance — VS Code.** It is the only host with a genuine shared MCP registry (GA in VS Code 1.102, June 2025) *and* an extension API any extension can tap: `registerMcpServerDefinitionProvider` to contribute servers, `vscode.lm.tools` / `invokeTool` to consume them. But in practice only GitHub Copilot reliably consumes the registry; the popular third-party agents ignore it and run their own MCP clients. So even VS Code's "shared layer" really only reaches Copilot.

**Implication.** "Easy to connect" is not one install — it is N per-agent wirings. That reframes the flagship deliverable from the webview panel to a **Connector** (§4). Good news: the `mcpServers` JSON shape is roughly standardized and copy-paste portable to most clients, with two holdouts to special-case — VS Code (`servers`) and Zed (`context_servers`).

---

## 2. North star

ModWrench is **not** a bag of platform APIs. It is a **modding co-pilot that closes the diagnose → lookup → fix loop** in the modder's own editor, collapsing the 6–9-app tax (MO2/Vortex + LOOT + xEdit + Wrye Bash + BethINI + Nexus tabs + Buffout/CLASSIC + Discord + wiki + YouTube) into one pane. The magic moment: read the crash → name the suspect → look it up across Nexus/Thunderstore → check its requirements and conflicts → state the fix, in one turn.

**Trust posture** (from the modder-truth research — deadpan, anti-hype, gift-economy): name the real tools respectfully (LOOT, xEdit, Buffout/CLASSIC, Wrye Bash), stay read-only by default, show the reasoning, always attach the source link, and never claim to replace judgment. Restraint is the strategy, not a limitation — this audience distrusts AI that "skips fundamentals."

---

## 3. Transports — local, stateless, two ways

Today ModWrench is stdio-only. `packages/cli/src/index.ts` builds an `McpServer`, activates the dynamic catalog, registers `mw_activate_platform` + `mw_deck` + the five `/` prompts, then `main()` binds a `StdioServerTransport` and calls `server.connect()`. The server construction is already **transport-agnostic** — only `main()` knows the transport. We add a second **local** transport without giving up the first.

- **stdio (default, unchanged).** Zero-config; the client auto-spawns `npx @modwrench/cli`; no port, no attack surface. Reaches Claude Code (here, desktop), Claude Desktop, Cursor, Cline, and every stdio client. Stays the default.
- **local Streamable HTTP (new, opt-in).** A `modwrench serve` subcommand binds `StreamableHTTPServerTransport` on `127.0.0.1:<port>` at `/mcp`, in **stateless** mode. Gives a uniform URL — `http://127.0.0.1:PORT/mcp` — that every island accepts via its remote-server slot. Stateless HTTP *is* the "holds nothing" invariant expressed in the transport: no session, every call a pure function of its input.

**Feasibility confirmed:** the installed `@modelcontextprotocol/sdk@1.29.0` already ships the server Streamable-HTTP transport (`server/streamableHttp.js`, plus `webStandardStreamableHttp.js`). **No SDK bump needed.**

What the HTTP mode needs:

1. **Server factory.** Extract "build a fully-registered `McpServer`" out of the boot block so both `main()` (stdio) and `serve` (HTTP) share one registration path — same tools, same `ui://` resources, same catalog. Fits the existing subcommand dispatch (`--version`, `auth …`) at the top of `index.ts`; add `serve` / `connect` alongside.
2. **Stateless transport.** `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, … })`. ModWrench needs no server-initiated push, so statelessness is free. (The catalog's `tools/list_changed` notification is a no-op in stateless mode — acceptable; clients re-list per request.)
3. **Loopback hardening (non-negotiable).** A `127.0.0.1` port is reachable by any web page the user visits. So: bind loopback only (never `0.0.0.0`), enable the SDK's DNS-rebinding protection (`enableDnsRebindingProtection` + `allowedHosts` / `allowedOrigins`), validate `Origin` / `Host`, and optionally require a local bearer token minted at startup. Same loopback-gating discipline as the phone↔laptop pairing work.
4. **Port + lifecycle.** Default port (e.g. 7333) with fallback on "in use"; write `{ url, pid, token }` to `~/.modwrench/http.json` (loopback lockfile, mirrors Claude Code's `~/.claude/ide/<port>.lock`) so the Connector can register the live URL. Start story: manual `modwrench serve` for the MVP → tray / login-item later.

**Honesty on //UI:** transport is orthogonal to rich rendering. `ui://` resources paint richly only where the client implements the mcp-ui client. Local HTTP buys *reach and uniform config*, not the guaranteed panel — that stays the VS Code panel's job (`ide-extension-plan.md`) or native-`ui://` clients.

---

## 4. The Connector — the flagship "easy to connect"

Because it is N islands, "easy" means ModWrench does the per-agent wiring *for* the user. A `modwrench connect` subcommand (and a `/setup` summon) that:

1. **Detects** which agent surfaces are present — probe the known config paths / CLIs: `~/.claude.json` + `claude` on PATH, `.cursor/`, `.vscode/`, Cline/Continue global storage, Windsurf, etc.
2. **Writes** the correct entry into each one's schema, **idempotent and non-clobbering** (merge; never overwrite the user's other servers; skip if already present):
   - **Claude Code** → `claude mcp add --scope user modwrench -- npx -y @modwrench/cli` (or the HTTP URL via `--transport http`).
   - **Cursor** → merge into `~/.cursor/mcp.json` (`mcpServers`) + emit an "Add to Cursor" deeplink `cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64>`.
   - **VS Code** → merge into `.vscode/mcp.json` / user `mcp.json` (`servers` key, `type` required) + emit the `vscode:mcp/install?<url-encoded json>` deeplink → reaches Copilot.
   - **Cline / Continue / Kilo** → their own files (Continue is YAML with an `mcpServers` *list*).
3. **Reports** what it wired and what it skipped, with copy-paste snippets for anything it couldn't auto-detect.

Two install shapes per target: the **stdio command block** (`npx @modwrench/cli`, auto-spawn, default) or the **local URL** (`http://127.0.0.1:PORT/mcp`, when `serve` is running). The URL path is simpler and uniform; the stdio path needs no running process. The README carries "Add to Cursor" / "Install in VS Code" buttons plus a per-tool snippet table for the manual crowd.

---

## 5. Architecture framing — the load order is the spine

Nearly every modder pain routes through the ordered plugin list: conflicts, missing masters, what-changed, dirty edits, updates, collection diffs all hang off it. Treat **one load-order object** as the central artifact that every diagnostic reads and annotates (`mw_read_load_order` already produces it). This makes ModWrench feel like *one tool*, not many — and makes the load-order / deps view the UI home base. New diagnostics should take a load order *in* and return it *annotated*, not invent parallel data shapes.

---

## 6. Diagnostics roadmap — deepen the local layer

The platform layer is already deep: **nexus 14, mod.io 17, thunderstore 9 tools; ~17 usable with no credentials, 48 with credentials.** Don't over-invest there. Leverage is in the local diagnostics at the exact quoted pain points, ranked by impact × feasibility (all read-only / parse-only):

1. **Loader version-drift oracle** — compare the detected game build against SKSE/F4SE/BepInEx compatibility; flag "your loader won't match this build" *before* launch. THE Fallout-4-next-gen nightmare, pre-empted. Enhances `mw_detect_environment`.
2. **Missing-master checker** — read plugin masters from headers; name the missing / out-of-order master and link the fix. "It's always a missing master." The most-quoted failure in the scene.
3. **Load-order snapshot + diff** — fingerprint an order, diff against a prior snapshot ("what changed since it worked"). A rival's flagship → demand validated.
4. **LOOT masterlist depth** — surface dirty-edit ITM/UDR counts, group membership, soft requirements from what LOOT already emits. No new data source; speaks their language.
5. **Modpack / Collection precheck** — read a Nexus Collection or Wabbajack manifest, diff against what's installed / the local build. Feeds the resolver.
6. **Update / deleted watchlist** — what in your order has an update or was pulled; when a mod is deleted on one platform, find it on another (a safety win — steers people off malware-laden Discord mirrors; lives the gift-economy values).

**Skip (restraint = trust):** reimplementing DynDOLOD / Nemesis / xEdit / Smash engines, editing or resaving saves (`.ess` / `.fos`), BethINI auto-tuning, mod-authoring toolkits (different persona), anything Minecraft / CurseForge (out of scope). ModWrench *reads and reasons over* the real tools' output; it never pretends to replace them.

---

## 7. The //UI — the single pane, not just themed views

The shell's `postMessage` bridge already lets a panel element fire a `tool` intent that re-invokes + re-renders (stateless). Make the panel **click-through**: crash view → "look up this mod" → mod card → "check conflicts" → conflicts view → "read load order" → deps view. The multi-app tax collapsing *inside one panel* is the demo that lands. Five views already exist (deck / mods / crash / conflicts / deps) with four authentic themes — the work is wiring the cross-links, not new chrome. Rendering stays per-client (rich where mcp-ui is implemented; text fallback elsewhere); the VS Code panel guarantees it on that surface.

---

## 8. Distribution / adoption

Reaching the beachhead — the coder / mod-author sliver already in Cursor, VS Code, Claude Code, on GitHub + coder Discords; **not** the GUI-only configurator majority:

- **MCP Registry** — publish the `server.json` to the official registry (preview since Sept 2025); downstream marketplaces (VS Code gallery, Cursor, Windsurf, Smithery, PulseMCP) ingest it. Publish-once source of truth.
- **Nexus "Modding Tools" listing** — the category the existing Claude-Code modding toolkits use to reach this crowd. This is how word spreads in-community.
- **Deeplink buttons + `/setup`** — one-click "Add to Cursor / Install in VS Code" and a summon that runs the Connector.
- **Respect the ethics** — attribution ≠ permission, anti-paid-mods, read-only default. For this audience, trust *is* the distribution channel.

---

## 9. Invariants (unchanged)

- **Keychain-only, read-only credentials.** Tokens live in the OS credential manager (service `modwrench-<platform>`); ModWrench only reads them. Local HTTP never sends creds off-box — it reinforces this.
- **Stateless.** The server holds nothing; the UI is a pure function of tool output. Stateless HTTP makes this literal.
- **No UI fork.** One renderer (`@modwrench/ui` `renderShell()`), many surfaces. Any HTTP / font handling is a transform on output, not a second renderer.
- **Native-modding scope.** Bethesda Creation Engine + Unity/BepInEx. Minecraft / CurseForge and Sims → sibling wrenches, not here.

---

## 10. Phasing

- **P0 — this doc.** Approved direction on paper.
- **P1 — local HTTP host.** `modwrench serve` (stateless Streamable HTTP, loopback + hardening, lockfile). Prove a live `127.0.0.1/mcp` URL handshakes from Claude Code and Cursor. Keep stdio the default.
- **P2 — the Connector.** `modwrench connect` + `/setup`: detect, write per-island (idempotent), report; README deeplink buttons + snippet table.
- **P3 — first new diagnostic + one UI loop.** Loader version-drift oracle (enhances `mw_detect_environment`) + wire one panel cross-link (crash → mod card).
- **P4 — surface + spread.** VS Code "Watch Me" panel (`ide-extension-plan.md`), MCP Registry publish, Nexus "Modding Tools" listing.

---

## Non-goals / open questions

- **Not a hosted remote service** — that would break stateless / keychain-only for the local Workbench. The existing `packages/remote` edge stays public-reads-only (`REMOTE_TOOL_COUNT = 9`), never the local Workbench.
- **Open:** default HTTP port; whether `serve` ships a background/daemon mode in P1 or defers to P4; whether the Connector edits files directly or shells out to each tool's own `add` command where one exists (Claude Code has `claude mcp add`; most others are file-merge).
