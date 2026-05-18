## What this changes

<!-- One sentence. -->

## Why

<!-- The workflow this unblocks or the bug it fixes. Link an issue with `Closes #N` if applicable. -->

## How to verify

<!-- Steps a reviewer can run to confirm this works end-to-end. -->

## Checklist

- [ ] Commits are signed off (`git commit -s`) — the DCO bot will block merge otherwise
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] Tool input schemas (zod) include `.describe()` text the AI can reason about
- [ ] No new secrets in code, fixtures, or example configs
- [ ] Attribution preserved on any tool output that names a mod (author, source platform, URL)
