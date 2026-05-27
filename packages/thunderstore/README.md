# @modwrench/thunderstore

**Status: scaffolded, not yet implemented.**

Thunderstore is the dominant platform for Unity co-op mods (Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, BONEWORKS, Dyson Sphere Program). It's the natural next platform for ModWrench because [`mw_read_load_order`](../workbench/src/loadorder/r2modman.ts) already parses r2modman profiles — and r2modman *is* Thunderstore's local client. Adding the platform package closes the loop: workbench detects what's installed, Thunderstore tells you who made each mod and what version is current.

See [ROADMAP.md](../../ROADMAP.md) for sequencing and the contribution path.
