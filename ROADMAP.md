# Roadmap

Where ModWrench is going next, so an issue or a pull request can be checked against it.
These are plans, not promises: [CHANGELOG.md](CHANGELOG.md) says what has shipped, and
[TRUST.md](TRUST.md) says what each tool does today. If something here is wrong or you'd
order it differently, [open an issue](https://github.com/171county/modwrench/issues).

## Before 0.3.0 is released

The code is on `main`, and none of it is on npm yet. Two checks it hasn't had:

- **A real game install.** Nothing has run against a real Skyrim Special Edition or
  Fallout 4 folder; the tests build their own.
- **Real clients.** The pages have been drawn only in a stand-in for an MCP Apps host. Each
  one should be opened in the clients that support MCP Apps, with the results written into
  TRUST.md.

## After 0.3.0

- **More of LOOT's masterlist.** The conflict check reads only the masterlist's
  incompatibility entries (`inc`), and reports one that LOOT applies only under a condition
  as informational, since ModWrench doesn't check conditions yet. The same file also
  carries LOOT's messages for a plugin, its requirements (`req`) and its dirty-plugin
  records (`dirty`). The plan, in three stages:
  1. **Conditions.** An evaluator for LOOT's conditions that answers true, false or
     "unknown" (a fact ModWrench doesn't have, or a function it doesn't support yet). A note
     is shown only when its condition is true. This replaces the earlier plan to skip any
     condition with a function ModWrench doesn't support. Both conflict tools then honour
     `inc` conditions. LOOT's messages appear in `mw_diagnose_crash` only, capped, and
     labelled as LOOT's notes, not as evidence about the crash.
  2. **Requirements.** A separate LOOT tool that you choose to run, which fetches the list
     and checks `req` entries against the install. The Doctors stay offline and get no
     switch for it. The tool opens only the paths an allow-list permits, inside the game's
     folders, whatever path the masterlist names.
  3. **Dirty plugins.** Matching a `dirty` record needs the plugin's checksum (CRC), so this
     waits for the real-install check above.

  In every stage LOOT's "error" is shown as a warning, never as a ModWrench "problem", and
  LOOT's text is shown in English only.
- **The pages:** mod names cut at 120 characters, the load-order page titled
  "Dependencies", plugin names cut off at phone width, and download counts that show "—".

## Wave 2

Four tools, built after 0.3.0 on a branch of their own. The same rules hold for each: read-only
on your computer, nothing written or kept beyond the session, every claim names its source, a
full text answer first and a page only as an extra, and any network request made by the server,
never by a page.

- **Pulse: "what has changed for the mods I run?"** Built for Thunderstore mods in r2modman
  profiles, with a page: `mw_pulse` says which mods have updates, which their authors have
  deprecated and which Thunderstore no longer has. It asks once before it sends anything, with
  the exact number of requests and the host, and it never runs on its own
  ([TRUST.md](TRUST.md#pulse-what-it-reads-and-sends) says what it sends). Next: Nexus mods,
  from the mod IDs and versions that Mod Organizer 2 (`meta.ini`) and Vortex record, once how
  ModWrench reaches Nexus is settled; then mod.io.
- **Trust Card: "who made this, and is it what it says?"** Built: `mw_trust_card` shows one
  mod's author, uploader, platform and page, versions, dates, the platform's own counts and its
  permissions where the platform gives them. Facts with their sources, and no score: ModWrench
  doesn't judge someone's mod. Next: LOOT's notes about the mod, once LOOT's conditions are
  answered (stage 1 of the LOOT plan).
- **Crew Check: "do we all have the same mods?"** Built: `mw_crew_check` gives each player a
  short list of their mods and versions to paste into the chat, and compares the lists. No
  network at all.
- **Deck faces.** Built: the deck page lists the five jobs (crash, setup, patch, updates, crew),
  each with how it last came out in this session as a verdict and counts, and an Ask button
  that puts the job's question into the chat. Held in memory only, and gone when the server
  stops.

## Open questions

- **How ModWrench reaches Nexus Mods.** Whether the read tools can move to Nexus's v2
  GraphQL API, so that no personal API key is needed, and whether endorsing a mod goes
  through OAuth as a registered application. This is being worked out with Nexus Mods
  support.
- **ChatGPT.** Whether the local tools work in ChatGPT's desktop app and Codex hasn't been
  tested, so the README doesn't list them.
