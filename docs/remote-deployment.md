# Remote Deployment

**Status: MVP implemented.** ModWrench now has a Streamable HTTP server package at
`@modwrench/remote`. It is the first remote-capable path for clients that cannot
launch local stdio servers, including ChatGPT developer-mode apps and API
workflows that connect to remote MCP servers.

This first cut is intentionally narrow:

- **Included:** Thunderstore public read-only tools (7 tools).
- **Excluded:** Nexus and mod.io credentialed tools.
- **Excluded:** Workbench local filesystem tools.
- **Authentication:** none in the MVP. Only anonymous public API reads are exposed.
- **Transport:** Streamable HTTP at `/mcp`.

That scope is the trust boundary. Nothing in this package stores user tokens,
loads Nexus/mod.io credentials, or reads user files.

---

## Why This Shape

Local stdio is still the main ModWrench experience for Claude Desktop, Claude
Code, Cursor, Continue, Cline, Roo Code, and other editor-style clients. It can
use the user's OS keychain and local filesystem safely because it runs on the
user's machine.

Remote MCP is a different trust story. Once a server is reachable over the
Internet, anything credentialed needs a real user/session/auth model. The MVP
therefore exposes only Thunderstore, whose read API is public and needs no credentials:

| Area | Local `@modwrench/cli` | Remote `@modwrench/remote` |
| --- | --- | --- |
| Transport | stdio | Streamable HTTP |
| Nexus | yes, with local credentials | no |
| mod.io | yes, with local credentials | no |
| Thunderstore | yes | yes |
| Workbench files | yes, local only | no |
| Token storage | OS keychain | none |

---

## Run Locally

From a source checkout:

```bash
npm install
npm run build --workspace @modwrench/remote
npm run start --workspace @modwrench/remote
```

By default the server binds to `127.0.0.1:3000` and serves MCP at:

```text
http://127.0.0.1:3000/mcp
```

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MODWRENCH_REMOTE_HOST` | `127.0.0.1` | Bind host. Use `0.0.0.0` for most hosted environments. |
| `MODWRENCH_REMOTE_PORT` | `3000` | Port. `PORT` is also honored for platform-as-a-service hosts. |
| `MODWRENCH_ALLOWED_HOSTS` | unset | Comma-separated host allowlist for host-header validation. |

The root endpoint returns a small descriptor, and `/health` returns a simple
health check.

---

## Connect From ChatGPT Or Another Remote MCP Client

Deploy the server to a public HTTPS host and point the client at:

```text
https://your-host.example/mcp
```

ChatGPT developer-mode apps support remote MCP servers over streaming HTTP and
can be configured without authentication for public tools. The OpenAI Responses
API remote MCP tool also expects a public MCP server URL.

For Claude Desktop or another local-only MCP client, use a remote proxy such as
`mcp-remote`:

```json
{
  "mcpServers": {
    "modwrench-remote": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-host.example/mcp"]
    }
  }
}
```

---

## Deploy Targets

The MVP is Node-hosted because the existing platform packages depend on the
current Node-oriented `@modwrench/core` module. That keeps the first remote path
small and reuses tested platform registrations.

Good first deploy targets:

- Render, Railway, Fly.io, DigitalOcean App Platform, or similar Node hosts.
- A small VPS behind HTTPS.
- Cloud Run or any container host that can run Node 20+.

Cloudflare Workers remains the preferred long-term low-cost target, but it needs
a Worker-safe split of the public platform HTTP helpers first. The current
`@modwrench/core` module imports Node filesystem, dotenv, and keychain-related
code, so shipping it directly inside a Worker would be messy.

---

## What Is Still Missing

The full remote product still needs:

1. Worker-safe public platform helpers, or a Cloudflare Worker package that does
   not import Node-only core code.
2. Per-user OAuth at the MCP layer for Nexus and mod.io.
3. Encrypted server-side token storage with revocation.
4. Per-user rate limiting.
5. Hosted deployment automation.
6. End-to-end smoke testing against a real hosted URL from ChatGPT.

The important thing: the transport adapter exists now. The rest is the trust and
hosting layer, not a mystery protocol gap.
