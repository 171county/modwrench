---
name: New platform support
about: Request a mod-hosting platform ModWrench doesn't talk to yet
title: '[platform] '
labels: platform-request
---

## Which platform

<!-- e.g. a platform not yet supported. Already shipped: Nexus Mods, mod.io, CurseForge, Thunderstore. -->

## Why it matters to your modding workflow

<!-- The community using it, the games hosted there, what you'd ask ModWrench to do with it. -->

## Does the platform have a public API?

- [ ] Yes — docs link:
- [ ] No
- [ ] Not sure

## Authentication model

<!-- Optional: how do you currently sign in? API key, OAuth, magic link, account password? -->

## Are you willing to help wire it?

Implementing a platform is well-scoped — copy `packages/modio/`, swap the API client, add to the CLI's `platforms` array. PRs welcome.

- [ ] Yes — I can take this on
- [ ] Yes — but I'd need guidance
- [ ] No, just requesting
