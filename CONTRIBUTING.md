# Contributing to ModWrench

Welcome. ModWrench runs on community input, and there are a lot of ways to help that don't require writing TypeScript.

This doc covers the mechanics. The vibe is in the [README](./README.md): *be a wrench, not a hammer*. Modders have been burned by enough hammers.

---

## Quick links

- **Found a bug?** → [File a bug report](../../issues/new?template=bug_report.md)
- **Want a feature?** → [File a feature request](../../issues/new?template=feature_request.md)
- **Want a platform supported?** → [File a platform request](../../issues/new?template=platform_request.md)
- **Just have a question?** → [Start a Discussion](../../discussions)

---

## Ways to contribute

In rough order from easiest to most involved:

### 1. Try it and tell me what broke

The fastest contribution. File an issue. Be specific. Include:

- Your operating system (Windows / macOS / Linux distro / Steam Deck)
- Your AI client (Claude Desktop / Claude Code / Cursor / ChatGPT / other)
- The exact command or query that broke
- What happened vs. what you expected
- Any error message in full (redact API keys if they appear — they shouldn't, but always check)

A good bug report saves hours of guesswork.

### 2. Add a known-conflict entry

`data/conflicts/<gameId>.json` is the file that powers the `mw_check_known_conflicts` tool. Adding a known mod incompatibility is one of the highest-value contributions you can make without touching any code.

**Format:**

```json
{
  "modA": "nexus:65876",
  "modB": "nexus:35895",
  "severity": "incompatible",
  "description": "Both mods modify the Whiterun cell record (0x000165A8). Loading both causes a CTD on entering Whiterun. Disable one or use the patch from <author>.",
  "source": "community",
  "workaround": "JK's Compatibility Patch Hub provides a merged patch (nexus:75512)",
  "patchModId": "nexus:75512"
}
```

**Severity levels:**

- `incompatible` — game crashes or major systems break when both are loaded
- `load-order-sensitive` — works if loaded in a specific order; needs documentation
- `patch-available` — known to conflict, but a community patch resolves it
- `informational` — interaction worth noting but doesn't break gameplay

**PR requirements:** include a link to where you learned of the conflict (a Reddit thread, a Nexus comment, the LOOT masterlist, etc.) in the PR description. Hearsay without a source is not enough.

### 3. Add environment detection for a new game

If you mod a game ModWrench doesn't yet recognize, you can teach it where to look. The file is `packages/core/src/detect/<gameId>.ts`. Each game's detection module exports a function that returns the install path, mod manager (if any), and mod loader (if any).

Look at `packages/core/src/detect/skyrimspecialedition.ts` for a worked example.

### 4. Suggest tool shapes

If the existing tools per platform don't cover the workflow you actually use, **open an issue describing the workflow before suggesting the tool**. Workflows generalize across games; tools don't. Describing the workflow gives ModWrench a chance to find the right tool shape rather than building one that only fits your case.

### 5. Add a new platform

Each platform is its own package (`@modwrench/<platform>`). The shape is documented in `docs/adding-a-platform.md` *(coming soon — file an issue if you want to take this on and the doc isn't there yet)*.

Strong candidate platforms (in rough order of community demand):

- CurseForge (largest catalog, well-documented API)
- Thunderstore (Unity co-op community, simple API)
- Modrinth (open-source-friendly platform, shipped read-side)

### 6. Improve docs

Documentation improvements are always welcome. Typo fixes, clarifications, examples — all welcome PRs. Don't ask permission, just open the PR.

### 7. Code contributions

PRs are welcome. See "Development setup" below.

---

## Architecture you should know before contributing

ModWrench has six non-negotiables baked into the architecture. PRs that violate any of them won't be merged — not because the contributor is doing something wrong, but because these rules are the project's foundation.

1. **No telemetry, ever.** No analytics, no usage stats, no "improve product" pings.
2. **No personal data stored.** API tokens go straight to OS keychain. Everything else is in-memory only.
3. **Attribution preserved end-to-end.** Author names, source platforms, and mod URLs survive every operation. Tools that surface mod info must include attribution.
4. **Permissions respected.** When a mod author sets restrictive permissions, downstream tools honor them.
5. **Rate limits respected.** Fail politely on someone else's infrastructure rather than retrying aggressively.
6. **Read-only by default.** Any tool that writes to the user's mod manager state, publishes to a platform, or modifies anything on disk requires explicit confirmation in the tool's design.

These aren't suggestions. They're constraints.

If you have a use case that seems to require violating one of these, open a Discussion first. There's usually a different way to solve the problem that respects the constraints.

---

## Development setup

```bash
# Clone
git clone https://github.com/<your-username>/modwrench.git
cd modwrench

# Install (uses npm workspaces)
npm install

# Build all packages
npm run build

# Run tests
npm test

# Run typechecks
npm run typecheck
```

You'll need Node.js 20+. ModWrench is intentionally portable — no Windows-specific dependencies, no native binaries that block Linux builds.

### Adding a tool to an existing platform

1. Add the tool implementation in `packages/<platform>/src/tools/<tool-name>.ts`
2. Register it in the tool index `packages/<platform>/src/tools/index.ts`
3. Add a test in `packages/<platform>/src/tools/<tool-name>.test.ts`
4. Update the README's tool list if it's a notable new capability

Tool implementations should:

- Use the shared `core` package's auth chain rather than reading tokens directly
- Surface attribution metadata in outputs that reference mods
- Return clear, structured errors rather than throwing in unexpected ways
- Respect platform rate limits — for now this means failing politely on `429` responses and not retrying aggressively. A shared rate-limit-aware HTTP client in `@modwrench/core` is on the roadmap (see [ROADMAP.md](ROADMAP.md)); until it lands, each platform package handles its own `fetch` and should respect any `Retry-After` header it sees

### Testing manually with Claude Desktop or Claude Code

While developing, point your AI client at the local build:

```json
{
  "mcpServers": {
    "modwrench-dev": {
      "command": "node",
      "args": ["/absolute/path/to/modwrench/packages/cli/dist/index.js"]
    }
  }
}
```

Rebuild after each change (`npm run build`) and restart the AI client.

---

## Submitting a PR

1. **Open an issue first** for anything non-trivial. This avoids the disappointment of a PR that doesn't match what the project needs.
2. **One PR, one concern.** Don't bundle unrelated changes.
3. **Tests for new behavior.** If the existing test suite doesn't cover what you're adding, add tests.
4. **Sign your commits.** ModWrench uses the Developer Certificate of Origin (DCO) instead of a CLA — see below.
5. **Update docs** if your change affects user-visible behavior.

### The DCO sign-off

ModWrench uses the [Developer Certificate of Origin](https://developercertificate.org/) — a lightweight alternative to a CLA. By signing your commits with `-s`, you're affirming that you have the right to contribute the code under the project's license.

In practice: add `-s` to your commit command:

```bash
git commit -s -m "Add support for the WhateverGame conflict file"
```

This appends a `Signed-off-by: Your Name <your@email>` line to the commit. That's the whole DCO process. No paperwork, no CLA repository, no rights assignment.

If you have many commits in a PR and forgot to sign them, you can fix them all with:

```bash
git rebase --signoff HEAD~N  # where N is the number of commits to sign
```

### PR review

I (the maintainer) will respond to PRs within a few days. Possible responses:

- **Merge as-is** — straightforward, fits the project
- **Suggested changes** — minor adjustments, usually mechanical
- **Discussion needed** — the change touches architecture or one of the six non-negotiables; let's talk in the PR comments
- **Decline with reason** — rare but possible if the change conflicts with project direction

I aim to never leave a PR unanswered for more than a week. If I do, please nudge me — assume good intent (I probably just missed the notification).

---

## Code of conduct

The full version: be the kind of person you'd want to collaborate with.

The wrench-specific version:

- **Be a wrench, not a hammer.** Modders have been burned by enough hammers — extractive platforms, predatory monetization, AI generators that strip credit. ModWrench is supposed to be the antithesis of those. Carry that energy into PR reviews, issue threads, and Discussions.
- **Respect attribution.** This applies in code (always preserve author metadata) and in conduct (credit other contributors, link to their PRs/issues when you build on their work).
- **Disagree with the work, not the person.** Code review can be direct without being hostile.
- **Assume the modder knows their craft.** ModWrench serves an audience that has been building things for years before AI assistants existed. Don't condescend.

Reports of code-of-conduct issues can be sent privately to the maintainer (contact in the README footer).

---

## Recognition

Contributors are credited in commit history (every merged PR appears under your name in `git log`) and in release notes once we ship to npm. A standalone `CONTRIBUTORS.md` will be added when the contributor count makes it useful — likely via [all-contributors](https://allcontributors.org/) automation. For now `git shortlog -sne` is the source of truth.

If you contributed something significant and don't see your name, file an issue — it's an oversight, not a slight.

---

## License

By contributing, you agree that your contributions will be licensed under [Apache License 2.0](./LICENSE) — the same license as the rest of the project. The DCO sign-off on each commit is your affirmation of this.

You retain copyright to your contributions. ModWrench does not require any rights transfer or assignment.

---

*Thanks for being here. Modders make the world more interesting; tooling that respects them is overdue.*
