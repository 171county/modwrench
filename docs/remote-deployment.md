# Remote Deployment (planned)

**Status: planned, not yet implemented.** This document describes the intended architecture for running ModWrench as a remote MCP server reachable from clients that don't support stdio (e.g. ChatGPT via the Responses API / Connectors). It is not a turnkey walkthrough yet — the code paths described here don't all exist in `main`.

If you want to help land this, the relevant tracking issue is the place to start. Until then, ModWrench runs as a local stdio MCP server in Claude Desktop, Claude Code, Cursor, Continue, Cline, Roo Code, and any other MCP-compatible client.

---

## Why remote deployment matters

A meaningful chunk of would-be ModWrench users live in ChatGPT, not Claude. ChatGPT's Responses API and Connectors product talk to MCP servers over **Streamable HTTP** (the remote MCP transport), not stdio. That's the same shape Anthropic's API supports as of late 2025 — so a remote ModWrench reaches both audiences without code duplication.

The trade-offs vs the local stdio path:

| Property | Local (today) | Remote (planned) |
|---|---|---|
| Credentials | OS keychain | OAuth via the MCP server itself |
| Per-user filesystem reads (workbench tools) | Full access | None (workbench tools are local-only) |
| Cost to operator | None | Hosting (Cloudflare Workers free tier covers low-volume) |
| Client support | Claude Desktop, Cursor, Continue, etc. | ChatGPT, Anthropic API, plus any MCP-aware client |

The workbench tools (`mw_detect_environment`, `mw_read_load_order`, `mw_parse_crashlog`) cannot run remotely — they need access to the user's filesystem. Remote ModWrench is platform-tools-only by design: Nexus + mod.io + (later) CurseForge + Thunderstore.

---

## Target architecture

**Transport.** Streamable HTTP per [MCP spec — Streamable HTTP transport](https://modelcontextprotocol.io/specification/basic/transports#streamable-http). One POST endpoint accepts JSON-RPC requests; the server replies either with a single JSON response or an SSE stream depending on whether the tool produces incremental progress.

**Auth.** Per-user OAuth at the MCP layer. The user connects ChatGPT → ModWrench → "Sign in with Nexus" / "Sign in with mod.io" flows fire from the MCP server itself (not from the user's local machine). Tokens are scoped to the user's session and stored encrypted at rest (KV / D1 / Durable Object — TBD).

**Host.** Cloudflare Workers is the default target:

- Workers AI / MCP support is first-party as of 2025 (`workers-mcp` and Hono-based templates)
- Free tier covers ~100k requests/day, enough for low-traffic launch
- Cold-start latency is friendly to MCP's request/response shape
- No Docker / no VPS / no infra babysitting

Other valid targets (AWS Lambda, Vercel Functions, Fly.io, a plain Node + nginx box) would all work; the deployment glue is per-target but the MCP transport adapter is the same.

**State.** Stateless request handling for tool calls. Per-user OAuth tokens in KV. Optional: shared cache for low-cardinality reads like LOOT masterlists (already in-memory per-process in `@modwrench/workbench`; could be promoted to a shared cache on a remote deploy).

---

## What's missing today

To ship remote ModWrench, this work needs to land. Rough order of dependency:

1. **Streamable HTTP transport adapter** in `@mcpwrench/core` or a new `@mcpwrench/remote` package. Wraps the MCP server's request/response loop in a single POST endpoint with optional SSE upgrade.
2. **Per-platform OAuth in a remote-friendly shape.** The current OAuth flows in `@modwrench/nexus` and `@modwrench/modio` assume a local loopback callback (`http://127.0.0.1:<port>/callback`). Remote deployment needs a stable callback URL (`https://modwrench.example.com/oauth/<platform>/callback`) and server-side credential storage instead of the OS keychain.
3. **Credential adapter abstraction.** `loadCredential` in `@mcpwrench/core` currently reads from keychain + env. It needs a third source: a per-request credential resolver that pulls the active user's token from server-side storage.
4. **Per-user session model.** The MCP spec supports session ids; we need to actually thread one through every tool call so the credential resolver knows which user it's serving.
5. **Workers deployment scaffold.** `wrangler.toml`, the Worker entry, KV namespace setup, OAuth callback routes, and a small admin UI for revoking tokens.
6. **Rate limiting.** Hosted ModWrench needs to be a polite citizen on Nexus and mod.io's API quotas, which means per-user rate caps server-side, not just trust in the upstream limits.
7. **A deployable test harness.** End-to-end smoke test from ChatGPT to the deployed Worker through Nexus's API back to ChatGPT.

None of this is rocket science. It is, however, days of careful work, and it changes the trust story (server-side token storage vs. OS keychain), so it merits a design discussion before code lands.

---

## How to follow / contribute

- **Want to use it?** Subscribe to the tracking issue (TBD — file one if it doesn't exist) and the v2.5+ milestone.
- **Want to help build it?** The cleanest entrypoint is item 1 — the transport adapter. That's pure mechanical wiring and doesn't depend on platform-specific OAuth changes. Open an issue describing your proposed API shape before writing code.
- **Want to host your own remote ModWrench?** Even before the upstream lands, you can fork and add a transport. The MCP SDK supports custom transports; the work is mostly OAuth and storage.

---

## Notes

- This is the only deployment scenario in the ModWrench roadmap where credentials live anywhere except the user's machine. The implementation needs to be obviously trustworthy — open source, encrypted at rest, revocable per-platform, with a clear "delete my data" flow.
- "We host a public ModWrench Worker" is a non-goal for v2.5. Self-hosting is the design point. If a public hosted instance ever happens, it's a separate decision with a separate trust posture.
- The local stdio path (the current shipping product) stays first-class. Remote is additive, not a replacement.
