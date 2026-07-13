# ModWrench IDE Extension — the "Watch Me" surface

Status: **roadmap** (not built yet). Foundation shipped: stateless MCP server, `/`-summon prompts, and the `ui://` MCP-UI. This doc is the plan for the flagship surface.

## The premise

MCP **already reaches Cursor and VS Code today** via `mcp.json` — the moment a user installs ModWrench, it's live in Cursor, Cline, Continue, and Claude Code inside VS Code. So the extension is **not** what gets ModWrench into the IDE.

The variable is **rendering**. A `ui://` MCP-UI resource is painted richly only where the host implements the mcp-ui client; otherwise the host shows the JSON/text fallback. The extension's job is to **guarantee the full ModWrench panel** — a real, docked VS Code Webview with the deck / mods / crash / conflicts / load-order views — regardless of the host's MCP-UI support. That is the "Watch Me" moment: ModWrench as a first-class editor panel, not a chat blob.

## Invariants (unchanged by the extension)

- **Keychain-only, read-only credentials.** The extension never stores keys. Tokens stay in the user's OS credential manager; ModWrench only reads them.
- **Stateless.** The webview stays a pure function of tool output. The extension hosts and relays — it adds no runtime state.
- **No UI fork.** The panel renders `@modwrench/ui` `renderShell()` output verbatim. One renderer, many surfaces.

## Architecture (thin host over the existing server)

1. **Transport.** The extension talks to `npx @modwrench/cli` over stdio (its own `StdioClientTransport`, or VS Code's native MCP registration when available). No new server; the same 0.1.0 meta-server.
2. **Webview panel.** When a ModWrench tool returns a `ui://` resource, the extension renders `resource.text` in a CSP-locked Webview. The existing shell `BRIDGE` already posts intents via `window.parent.postMessage({type:'tool'|'prompt'|'link', payload})`; the extension receives them through `webview.onDidReceiveMessage` and routes:
   - `tool` → re-invoke the MCP tool, re-render the panel (stateless refresh).
   - `prompt` → seed the chat / agent with the text.
   - `link` → open externally, **after** the suspicious-link check.
   Honor the `mcpui.dev/ui-preferred-frame-size` meta for sizing.
3. **Commands + `/`-summons.** Contribute palette commands and a status-bar item mapping to the five prompts: `ModWrench: Open Deck`, `Parse Crash Log`, `Check Conflicts`, `Read Load Order`, `Find Mods`. These call `getPrompt` (`modwrench`, `mw-find`, `mw-crash`, `mw-conflicts`, `mw-order`) or the tools directly.
4. **Config helper.** One-click "add ModWrench" that writes/updates the user's MCP config (or uses the host's native registration), so a configurator-adjacent user never hand-edits JSON.

## CSP / fonts note

The shell currently pulls flagship webfonts from Google Fonts via a `<link>`. VS Code Webview CSP is strict — the extension should either allow that origin explicitly or **inline the fonts** to keep the panel fully self-contained (and offline-safe). Leaning toward inlining for the extension build.

## Phasing

- **Phase A — done.** Stateless server + prompts + `ui://` views. The foundation the extension surfaces.
- **Phase B — MVP "Watch Me".** Minimal VS Code extension: Webview host for `ui://`, the five commands, the config helper. Publish to the VS Code Marketplace.
- **Phase C — Cursor parity + polish.** Open VSX publish (Cursor installs from Open VSX), status-bar entry, richer docking, and the optional remote-server path for the web/discovery edge (Nexus/mod.io/Thunderstore reads only — never the local Workbench).

## Non-goals

Not a credential store. Not a state layer. Not a UI fork. If hosts add native `ui://` rendering, the extension's value narrows to commands + docking — which is fine; the foundation still stands on its own.

## Adoption tie-in

The realistic beachhead — the coder / mod-author sliver — already lives in Cursor, VS Code, and Claude Code. This panel is where "oh shit, I can do all of this from my editor instead of launching MO2 + xEdit + a browser + Discord" actually lands.
