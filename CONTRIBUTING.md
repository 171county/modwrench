# Contributing

ModWrench is a small project. Issues, fixes and conflict data are all welcome.

## Ways to help

**Tell me what broke.** Bug reports are the most useful thing right now. Include your OS, your mod manager, the game, and what you expected instead.

**Add a known-conflict entry.** `packages/workbench/data/conflicts/` holds community conflict data; its README documents the format. This needs no TypeScript and is the easiest first contribution.

**Add environment detection for a game.** `packages/workbench/src/detect/games.ts` lists the 15 games the local tools recognise. Adding one is a small, well-scoped change.

**Suggest a tool.** Tools are worth adding when a modder would plausibly want them mid-conversation with an AI. If you would use it, say so in an issue.

**Fix the docs.** If something here or in the README or TRUST.md doesn't match the code, that's a bug — the code is the truth and the doc is wrong.

## Setup

Node.js 20 or newer.

```bash
git clone https://github.com/171county/modwrench.git
cd modwrench
npm install
npm run build       # all packages, in dependency order
npm test            # 201 tests across eight workspaces
npm run typecheck
```

Each package lives in `packages/`. `core` holds the shared credential, logging and HTTP code; `nexus`, `modio`, `thunderstore` and `workbench` are the platforms; `cli` composes them into one MCP server; `ui` renders the visual panels; `remote` is the optional HTTP transport.

## Pull requests

1. **Open an issue first** for anything non-trivial, so a PR doesn't land somewhere the project isn't going.
2. **One PR, one concern.**
3. **Tests for new behaviour.** If the suite doesn't already cover it, add a test.
4. **Sign your commits** — see below.
5. **Update the docs** if you change user-visible behaviour. A claim in README.md or TRUST.md that the code no longer supports is a defect.

Anything touching credentials, network destinations, or writes to a platform will get careful review. Those are the claims TRUST.md makes on the project's behalf.

### The DCO sign-off

ModWrench uses the [Developer Certificate of Origin](https://developercertificate.org/) rather than a CLA. Signing a commit affirms you have the right to contribute the code under the project's license.

Add `-s` when you commit:

```bash
git commit -s -m "Add conflict entry for WhateverGame"
```

That appends a `Signed-off-by:` line. That's the whole process — no paperwork, no rights assignment. If you forgot on several commits:

```bash
git rebase --signoff HEAD~N
```

### Review

I'll respond within a few days. If a week passes, nudge me — I probably missed the notification.

## Conduct

Be the kind of person you'd want to collaborate with. Specifically:

- **Be a wrench, not a hammer.** Modders have been burned by enough extractive tooling. Carry that into reviews and issue threads.
- **Respect attribution** — in code, always preserve author metadata; in conduct, credit the people you build on.
- **Disagree with the work, not the person.**
- **Assume the modder knows their craft.** This audience was building things long before AI assistants existed. Don't condescend.

Report conduct problems privately via the [security advisory form](https://github.com/171county/modwrench/security/advisories/new).

## License

By contributing you agree your contributions are licensed under the [MIT License](./LICENSE), the same as the rest of the project. You retain copyright; ModWrench requires no rights transfer.
