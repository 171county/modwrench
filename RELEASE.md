# Releasing ModWrench 0.1.0

This release cuts a coherent `0.1.0` line across every package and supersedes the
drifted `0.0.1` packages already on npm. It also finalizes the platform lineup:
**Nexus, mod.io, Thunderstore, and the local Workbench.** Minecraft and CurseForge
were removed — they belong in the sibling a separate project project, not ModWrench.

## Final platform lineup (0.1.0)

| Package | Role |
|---|---|
| `@modwrench/core` | Shared HTTP client, error envelope, OS-credential-manager reads, logging |
| `@modwrench/nexus` | Nexus Mods read tools |
| `@modwrench/modio` | mod.io read tools |
| `@modwrench/thunderstore` | Thunderstore read tools (no credential) |
| `@modwrench/ui` | Stateless MCP-UI: themed deck + mod cards + crashlog panel returned as `ui://` resources (Skyrim/Fallout/Lethal Company/Valheim themes) |
| `@modwrench/workbench` | Local diagnostics: crashlog parse, load order, conflicts, env detect |
| `@modwrench/cli` | Meta-server bundling the above behind one MCP entry |

Removed from ModWrench: `@modwrench/curseforge` and `@modwrench/modrinth` (→ a separate project),
and the Workbench Minecraft crashlog parser (→ a separate project).

## What to verify before publishing

Run the automated gate first — it checks the things a green build cannot, because
npm workspaces resolve every internal package through a local symlink:

```bash
npm run check:release
```

That fails on a phantom dependency (imported but undeclared), on internal version
drift, and on a package missing its `prepack` build hook; with `--registry` it also
warns about any `@modwrench/*` package not yet on npm at the current version. The
`@modwrench/ui` package being unpublished while five other packages depend on it is
exactly the failure this catches.

Then confirm by hand:

- Clean `tsc` build, tests green.
- MCP `initialize` + `tools/list` handshake with no credentials stored returns
  **17 tools and 5 prompts**: 9 Thunderstore + 6 Workbench + `mw_activate_platform`
  + `mw_deck`, and prompts `modwrench`, `mw-find`, `mw-crash`, `mw-conflicts`,
  `mw-order`. Nexus and mod.io correctly report as `skipped`.
- `npm view @modwrench/cli dependencies` after publish shows **no** `curseforge`
  and **no** `modrinth`.

## Preferred path: the Release workflow

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds, tests, runs
the readiness gate, publishes every package to npm in dependency order (skipping
any version already published), and only then updates the MCP registry entry. That
ordering matters: the registry must never advertise a version npm cannot serve.

The manual steps below remain valid for a one-off or for recovering a partial release.

## Pre-flight

```bash
npm whoami            # must own the @modwrench scope
npm login             # if needed; have 2FA/OTP ready
node -v               # >= 20
npm ci && npm run build && npm test   # green tree before publishing
```

## Publish in dependency order

Scoped packages are already marked `publishConfig.access: public`.

```bash
# 1. substrate
npm publish -w @modwrench/core --access public

# 1b. UI toolkit (depends on core; consumed by workbench + cli)
npm publish -w @modwrench/ui --access public

# 2. platform packages (any order; each depends on core AND ui)
npm publish -w @modwrench/nexus         --access public
npm publish -w @modwrench/modio         --access public
npm publish -w @modwrench/thunderstore  --access public
npm publish -w @modwrench/workbench     --access public

# 3. meta-server (depends on all of the above at 0.1.0)
npm publish -w @modwrench/cli --access public
```

If npm 2FA is on, append `--otp=<code>` to each command.

The remote/HTTP transport package is not needed for the `npx` stdio path and can wait:

```bash
# npm publish -w @modwrench/remote --access public
```

## Verify the published result

```bash
npx -y @modwrench/cli --version          # -> 0.1.0
npm view @modwrench/cli dependencies     # -> nexus, modio, thunderstore, workbench, core; NO curseforge/modrinth
```

Then reconnect it in your MCP client (config uses `npx -y @modwrench/cli`).

## Deprecate the superseded packages

```bash
npm deprecate "@modwrench/modrinth@0.0.1"   "Moved to a separate project; not part of ModWrench."
npm deprecate "@modwrench/curseforge@*"      "Not part of ModWrench; CurseForge/Minecraft tooling belongs to a separate project."   # only if a curseforge version was ever published
npm deprecate "@modwrench/cli@0.0.1"        "Superseded by 0.1.0 (platform lineup finalized: Nexus, mod.io, Thunderstore, Workbench). Use @modwrench/cli@latest."
```

`@modwrench/curseforge` was never published to npm, so its deprecate line is a no-op unless you published it manually — included for completeness.

## Pre-packed tarballs

Tarballs for every publishable package are staged alongside this release for offline
inspection (`npm pack` output). To publish a tarball directly instead of from the
workspace: `npm publish ./modwrench-core-0.1.0.tgz --access public` (same order as above).
