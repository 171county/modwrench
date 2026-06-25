# The MCPwrench Playbook

The canonical cross-product spec. Every wrench product under the MCPwrench
umbrella follows the rules in this document.

This doc lives in the ModWrench repo because that's where the umbrella started,
but it is **not** a ModWrench-specific document. Sibling repos (MyneWrench,
DefWrench, FlyOnWallWrench, and any future wrench product) link here from their
own `CONTRIBUTING.md`. When the rules and the code disagree, the code wins and
this doc gets a PR.

If you are about to start a new wrench product, read this end to end first.
If you are adding a tool to an existing wrench, the sections you most often
need are [The trust posture](#2-the-trust-posture),
[Read-by-default, publish-with-confirmation](#4-read-by-default-publish-with-confirmation),
[Tool naming conventions](#6-tool-naming-conventions), and
[Fail loud philosophy](#7-fail-loud-philosophy).

---

## 1. What MCPwrench is

MCPwrench is an umbrella of focused Model Context Protocol servers that bring
creator-platform APIs into AI clients (Claude Desktop, Claude Code, Cursor,
ChatGPT, and any other MCP-compatible host). Each wrench product targets a
distinct audience with its own vocabulary, trust expectations, and platform
mix — but they all sit on the same engineering core and the same trust posture
so that a contributor moving between them finds familiar patterns.

The current product line:

- **ModWrench** — for modders. Wraps Nexus Mods, mod.io, Thunderstore,
  CurseForge, and a local workbench for crashlog parsing and environment
  detection. Audience: people who mod Skyrim, Fallout, Lethal Company,
  Valheim, Minecraft, and the long tail of moddable PC games.
- **MyneWrench** — for Roblox and UEFN creators. Wraps the Roblox Open Cloud
  surface (universes, places, datastores, assets, MessagingService) and is
  ready to wrap UEFN the day Epic ships a public creator-data API.
  Audience: experience developers shipping to Roblox and Fortnite Creative.
- **DefWrench** — for AAA studios. Wraps internal build, telemetry, and
  publishing surfaces that the major engine and platform vendors expose to
  shipped-game teams. Audience: developers inside studios that already pay
  for the underlying tooling.
- **FlyOnWallWrench** — for community comms. Wraps the read-only surfaces
  of community platforms (forums, chat, issue trackers) that a maintainer
  needs to keep a pulse on without sitting in every channel. Audience:
  open-source maintainers, community managers, and small studios who answer
  their own players.

Every wrench product depends on `@mcpwrench/core`. The core is deliberately
small: it provides credential resolution against the OS keychain with an
env-var fallback, a shared HTTP client that handles 429s and 5xxs the same
way everywhere, a structured `McpwrenchError` envelope, structured stderr
logging that never collides with the MCP protocol on stdout, and a couple
of environment helpers. New utilities go into core only after a second wrench
proves they're shared — never on speculation.

A wrench product is an npm scope (`@<wrench>/`) containing one platform
package per upstream service, optional local packages for things that aren't
APIs (e.g. ModWrench's `@modwrench/workbench` reads the filesystem), and a
meta-server package (`@<wrench>/cli`) that composes every installed platform
into one MCP entry. Users install one wrench, configure their AI client once,
and never think about transport plumbing again.

---

## 2. The trust posture

Six rules. They apply to every wrench product equally. PRs that violate any
of them do not merge — not because the contributor is doing something wrong,
but because these rules are the project's foundation and the audience picks
the umbrella partly on this basis.

1. **No telemetry.** No wrench product phones home. No analytics, no usage
   stats, no "improve product" pings. The only network traffic a wrench
   makes is to the upstream platform whose tools the user invoked.

2. **No personal data persisted.** Credentials live in the OS keychain
   (Windows Credential Manager, macOS Keychain, Linux libsecret). Search
   queries, tool inputs, and tool outputs are in-memory only and end when
   the MCP process ends. There is no database, no cache file, no log file.

3. **Attribution preserved end-to-end.** When a tool surfaces content
   created by someone — a mod author, a Roblox experience developer, a
   forum poster — the author name, the source platform, and the canonical
   URL travel with the data. Normalization across platforms is not allowed
   to strip credits. The LLM cannot be helped to omit them.

4. **Upstream permissions respected.** When a platform exposes permission
   flags ("no asset reuse," "no commercial redistribution," etc.), they
   pass through unmodified to the tool output and any wrench-side write
   tool refuses to act against them. Wrench products do not help users
   route around another creator's stated terms.

5. **Rate limits respected.** Wrench products fail politely on someone
   else's infrastructure rather than retrying aggressively. The shared
   HTTP client reacts to 429 responses by sleeping for the duration the
   server requested (Retry-After), and to 5xx with capped exponential
   backoff. We do not invent endpoints, scrape, or thread-pool around a
   platform's published limits.

6. **Read by default; write only with confirmation.** Read tools require
   no extra ceremony — the user asked, the tool answers. Write tools
   (anything that publishes, sends, edits, or modifies upstream state)
   return a preview by default and act only when the caller passes
   `confirm: true`. See section 4 for the full pattern.

These are constraints, not aspirations. A wrench product that breaks one of
them is no longer an MCPwrench product. The umbrella's value to the audience
is precisely that these rules are baked into the code, not promised in a
privacy policy.

---

## 3. Credential resolution chain

Every wrench product loads credentials the same way, through
`loadCredential()` in `packages/core/src/auth.ts`. The chain is:

1. **OS keychain first.** `getStoredToken()` reads the token saved by
   `<wrench>-<platform> auth login`. The token is a `StoredToken` JSON
   blob — `access_token`, optional `refresh_token`, `expires_at`,
   `saved_at` — stored under the service name `modwrench-<service>` so a
   user inspecting their keychain sees a recognizable owner. (The
   `modwrench-` prefix is historical and shared across the umbrella; it
   is not a ModWrench-only namespace.)
2. **Environment variable fallback.** If no keychain entry exists, the
   loader looks at the platform's named env var (`NEXUS_API_KEY`,
   `MODIO_API_KEY`, `ROBLOX_API_KEY`, etc.). This is the developer-local
   testing path and the fallback for systems where the OS keychain is not
   reachable.
3. **Fail loud with a hint.** If neither source has a credential, the
   loader throws an error that names the service, says which env var it
   looked for, and includes the platform's specific `authHint` — usually
   pointing the user at `<wrench>-<platform> auth login`.

The returned `Credential` is a discriminated union — `{ source: "keychain",
accessToken, ... }` or `{ source: "env", apiKey }`. Platform packages branch
on `source` to decide which auth header shape to send (Bearer vs.
platform-specific `apikey` / `x-api-key` / etc.). The shape is intentional:
the platform package owns the routing decision so core doesn't have to know
every upstream's quirks.

One important nuance: on Linux systems where libsecret / D-Bus is unavailable
(Steam Deck Game Mode, headless servers, minimal container images) the
keychain is silently unreachable. `auth.ts` detects this case and the
fail-loud error explicitly says "OS keychain is unavailable" rather than
just "no credential found." This is the difference between a user spending
five minutes fixing their setup and an hour debugging a phantom auth bug.

Wrench products **never** persist credentials to repo-local files. `.env` is
a developer-local convenience for testing. It is gitignored. It is not a
deployment mechanism. If a deployment shape seems to require shipping an
`.env` with secrets, the answer is to wire the OAuth flow or to document
that the deployment runs with env vars injected by the orchestrator.

---

## 4. Read-by-default, publish-with-confirmation

Every wrench product is read-only by default. Write tools exist, but they
follow a discipline that is non-negotiable across the umbrella. Three rules.

**Rule 1: writes require an explicit `confirm: true` parameter.** A write
tool's zod schema includes a `confirm` boolean (optional, default false).
When `confirm` is not exactly `true`, the tool returns a preview of what
it *would* have done and performs no upstream call. Only on a re-call with
`confirm: true` does the tool actually act. The canonical example is
`roblox_send_message` in `mynewrench/packages/roblox/src/register.ts` — the
tool description starts with "WRITE ACTION," explains the consequence
("sends data to your live game servers"), and the handler short-circuits
to a preview branch unless `confirm === true`. Same pattern for
`roblox_publish_place`, which additionally validates the local file exists
during the preview so the user finds out about a typo'd path before they
say yes.

**Rule 2: writes use a separate HTTP client with retries disabled.** The
shared `createHttpClient()` factory in `packages/core/src/http.ts` accepts
a `retry: { maxAttempts: 1 }` option. Write tools instantiate a second
client with that override and use it exclusively. Auto-retrying a
non-idempotent write on a transient 5xx could publish a message twice,
upload a file twice, or send a notification twice. For a deliberate,
confirmation-gated action we'd rather fail loud once and let the user
decide whether to retry. See the `writeClient` declaration in
`mynewrench/packages/roblox/src/register.ts` for the exact shape.

**Rule 3: write tools name themselves loudly.** The tool's MCP description
string starts with `WRITE ACTION` in all caps. The description explains
the upstream consequence in plain language ("goes LIVE to players
immediately," "every server currently subscribed to this topic receives
it"). The description also tells the LLM how to behave: show the creator
the preview, get a yes, then re-call with `confirm: true`. This is how the
model learns the dance — the framework can't enforce a UX it can't see.

The preview itself is structured prose, not a serialized payload. It lists
the inputs the tool will use, names the destination ("universe 12345,
topic `live-config`"), and ends with the exact re-call instruction
("Re-call `roblox_send_message` with `confirm=true` to actually send.").
A good preview is something a creator can read aloud and recognize as
matching their intent before they approve.

Read tools do none of this. They run on the normal retrying client, take
no `confirm` parameter, and act immediately. The discipline is only on the
write side because that's where the irreversible actions live.

---

## 5. Error envelope

Every wrench product surfaces failures through `McpwrenchError`, the shared
error type exported from `@mcpwrench/core`. Three fields matter to the
caller: `code` (a stable identifier like `nexus_http_error`), `status`
(the upstream HTTP status when the failure was an HTTP error), and `meta`
(structured details — for HTTP errors this includes the first 500 bytes of
the response body and the URL that failed). The shape is intentional: an
LLM can read the code and decide whether to retry a different tool, the
human can read the message and the body snippet and understand what
actually went wrong, and our own logs preserve the URL for debugging.

Error codes are platform-prefixed. The shared HTTP client takes an
`errorCodePrefix` option (e.g. `"nexus"`, `"roblox"`, `"modio"`) and uses
it to construct the code: a non-2xx response becomes
`<prefix>_http_error`, a network failure (DNS, connection reset) becomes
`<prefix>_network_error`, and exhausting retries on 429 or 5xx becomes
`<prefix>_retries_exhausted`. This means a caller sees `roblox_http_error`
rather than a generic `http_error` and can branch accordingly. New error
codes within a platform follow the same pattern — `<prefix>_<reason>`,
lowercase, underscore-separated.

The HTTP-handling rules are encoded in `packages/core/src/http.ts` and
every platform package uses them through `createHttpClient()`:

- **429 (rate limited):** Parse the `Retry-After` header (seconds or
  HTTP-date, per RFC 9110 §10.2.3). Sleep that long. Retry, up to
  `maxAttempts`. If `Retry-After` is missing or unparseable, fall back to
  exponential backoff with jitter, capped at `maxDelayMs`. See
  `parseRetryAfter` for the exact parsing.
- **5xx (server error):** Retry with exponential backoff and jitter, up
  to `maxAttempts`. No retry budget is shared across requests — each
  request gets its own retry window, but the per-client concurrency cap
  prevents a thundering herd.
- **4xx other than 429:** No retry. Throw `<prefix>_http_error` with the
  status and body snippet. The caller — usually the LLM — decides what
  to do.
- **Network failures (DNS, connection reset, TLS):** Treated as
  retryable. Same backoff curve as 5xx. After exhausting attempts,
  throw `<prefix>_network_error` preserving the original `cause`.

This client is the "polite citizen" tier. It reacts to what the server
tells it and does not do proactive rate-limit window tracking using
`X-RateLimit-*` style response headers — different platforms expose
different shapes for those and that's a v2 concern. The current
429-reactive behavior is what keeps wrench products off platform
blocklists.

Tool handlers should let `McpwrenchError` propagate. The MCP SDK formats
the thrown error into a structured tool-error response the LLM can read.
Catching errors only to re-throw a different one is almost always wrong;
catching to *add context* (e.g. "while fetching mod 12345") is fine.

---

## 6. Tool naming conventions

Tool names matter because the LLM picks tools by name and description. A
sloppy name leads to a model that calls the wrong tool, and the user pays
for it with a wrong answer or a wasted API call.

**Platform tools follow `<platform>_<verb>_<noun>`.** Lowercase,
underscore-separated, singular nouns unless the operation is intrinsically
plural (a list, a search). Examples that pass:

- `nexus_get_mod`, `nexus_list_games`, `nexus_md5_search`
- `modio_search_mods`, `modio_top_games`, `modio_get_mod`
- `roblox_get_universe`, `roblox_list_datastores`,
  `roblox_get_datastore_entry`
- `thunderstore_list_communities`, `thunderstore_search_mods`
- `modrinth_search`, `modrinth_get_project`, `modrinth_get_versions`

Generic verbs (`get_mod`, `search`) are forbidden at the platform tool
layer — they would be ambiguous inside the meta-server, which composes
every platform's tools into one namespace.

**Meta-tools use the product's short prefix.** Each wrench product owns a
short prefix for tools that aren't tied to one upstream platform. ModWrench
uses `mw_` for the workbench tools (`mw_detect_environment`,
`mw_read_load_order`, `mw_parse_crashlog`, `mw_query_mod_metadata`,
`mw_check_known_conflicts`). MyneWrench uses `myne_` for cross-platform
helpers. DefWrench uses `def_`. FlyOnWallWrench uses `fow_`. The prefix is
the product, not the company — when a meta-tool clearly belongs to one
product's vocabulary, it gets that product's prefix even if the
implementation lives in a shared package.

**Write tools start their description with `WRITE ACTION`.** All caps,
followed by an em-dash, followed by a one-sentence statement of what
changes upstream. Example, verbatim from `roblox_send_message`:

> WRITE ACTION — sends data to your live game servers. Publishes a
> message to a MessagingService topic in a running experience; every
> server currently subscribed to that topic receives it…

This is for the LLM's benefit. The model reads tool descriptions when
deciding what to call; `WRITE ACTION` at the start is a strong signal to
narrate consequences and request confirmation before invoking.

**Descriptions tell the model how to chain.** If a tool's natural caller
needs an ID, the description names the discovery tool: "Use
`roblox_list_datastores` to find datastore names" or "Discover universe
IDs in the Creator Dashboard URL." The LLM learns the dependency from the
text, not from a separate schema.

**Parameter descriptions are mandatory.** Every zod field gets a
`.describe(...)` string. Constrain numeric IDs with `.int().positive()`,
strings with sensible `.min` / `.max`. The MCP SDK exposes the zod schema
to the client as JSON Schema automatically, so a good `.describe` saves
the model from guessing.

---

## 7. Fail loud philosophy

A wrench product is honest about its limits. Two consequences follow.

**No silent fallback.** When a credential is missing, the server fails at
boot with a message that names the missing env var and the auth-login
command. It does not start up "in a degraded mode," it does not register
half the tools, it does not return a friendly stub. The reasoning: an
LLM with stub tools is worse than an LLM with no tools, because the model
will happily call the stub and the user will get a confident wrong answer.

The same applies inside tool handlers. An HTTP error becomes a thrown
`McpwrenchError`, which the SDK surfaces to the model as a structured
tool-error response. The model sees `nexus_http_error: HTTP 403 for GET
/v1/games/skyrim/mods/12345` and can either tell the user (best) or try
something different (also fine). It does not see a fabricated empty
result that it might paraphrase as "I couldn't find that mod, it may have
been removed" — which would be a lie.

**No fake tools when the upstream API doesn't exist.** A wrench product
will not paper over a missing capability with a tool that returns
plausible-looking data. The canonical example is the UEFN package in
MyneWrench — `mynewrench/packages/uefn/src/register.ts` is fully scaffolded
(takes a credential, sets a base URL, logs its status on boot) and
registers exactly zero tools. The top-of-file comment explains why:

> As of 2026, Epic does NOT expose a public REST API for third-party
> tools to read a creator's UEFN island analytics, engagement payouts,
> or item sales. … Until then this package stays a deliberate
> placeholder (toolCount 0).

This is the right shape. The package exists so the wiring matches the
other platforms (so the day Epic ships an API, only one file changes),
the boot log says exactly what's blocked, and the LLM sees no tools and
cannot hallucinate one. Compare to a hypothetical `uefn_get_island_stats`
that returns mock numbers: that would let a creator make business
decisions on fabricated data, which is the worst possible failure mode
for an audience that takes monetization seriously.

The general rule: if the upstream doesn't support the operation, the
wrench product doesn't expose the tool. If the upstream supports it
behind a paywall the user hasn't paid for, the tool exists but the
boot-time credential resolution surfaces a clear paywall hint. If the
upstream supports it but the tool would routinely violate rule 3, 4, or
5 of the trust posture, the tool is not built and an issue captures the
reasoning so the next contributor doesn't re-propose it.

Failing loud is what earns the audience's trust. Quiet degradation is
how every previous tool in this space lost it.

---

## 8. Adding a new wrench product

A new wrench is a product, not a feature. Before writing code:

1. **Name reservation.** Confirm the name is unclaimed across three
   surfaces: the npm scope (`@<wrench>/`), a GitHub repo under the
   umbrella organization, and the matching domain (`<wrench>.dev` or
   `mcpwrench.dev/<wrench>` as the umbrella site grows). If any of the
   three is taken by something unrelated, pick a different name now — it
   is cheaper than renaming later.
2. **Distinct audience.** A new wrench is justified when its audience
   uses different vocabulary, has different trust expectations, or
   answers to different platforms than the existing wrenches. If the
   audience overlaps with an existing wrench, the right shape is a new
   *platform package* inside that wrench, not a new wrench product. See
   `docs/adding-a-platform.md` for the platform-package process.

Once the name and the audience are settled, the engineering shape:

3. **Depend on `@mcpwrench/core`.** Every platform package and the meta
   server depend on core. Do not vendor core. Do not fork it. If core
   is missing something every wrench would need, file an issue against
   the core package and discuss it before adding it.
4. **Follow this playbook.** The six trust rules apply unchanged. The
   credential chain applies unchanged. The HTTP client and error envelope
   apply unchanged. Tool naming uses your product's prefix
   (`<wrench>_` for meta-tools, `<platform>_` for platform tools).
   Read-by-default and write-with-confirmation apply to every write tool
   you ship.
5. **Mirror the existing repo shape.** A meta-server package
   (`@<wrench>/cli`) that composes platforms via each one's
   `./register` export, one platform package per upstream service, an
   optional local package for non-API capabilities. The shape is
   documented in `docs/adding-a-platform.md` and the existing wrench
   repos are the living reference.
6. **Add the product to the umbrella list.** Open a PR against the
   ModWrench repo updating section 1 of this document and the umbrella
   site once it exists. List the product, its audience, and a one-line
   description. Keep it factual.
7. **Link to this playbook from `CONTRIBUTING.md`.** Your repo's
   contributor doc should say "this project follows the MCPwrench
   Playbook" with a link to this file. Repeat in your repo only the
   process notes that are genuinely repo-specific (release cadence,
   issue templates, the maintainer's contact). Do not restate the
   umbrella's trust posture — link to it, so when it changes here it
   changes everywhere.
8. **Stay under the same license.** Apache 2.0 across the umbrella,
   contributor sign-off via DCO, no CLA. The license is part of the
   umbrella's promise to its audience and is not negotiable per
   wrench.

The first PR opening a new wrench will be reviewed primarily against
this playbook — not against the elegance of the code or the size of the
initial tool surface. A four-tool wrench that respects every rule above
is more valuable to the umbrella than a forty-tool wrench that quietly
breaks rule 1 or rule 6.

---

*This document is the umbrella's spec. The code is the truth. When they
disagree, fix one of them — and prefer fixing the doc, because the rules
this doc encodes are the ones the audience already trusts in the
shipping code.*
