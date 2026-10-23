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

## Open questions

- **How ModWrench reaches Nexus Mods.** Whether the read tools can move to Nexus's v2
  GraphQL API, so that no personal API key is needed, and whether endorsing a mod goes
  through OAuth as a registered application. This is being worked out with Nexus Mods
  support.
- **ChatGPT.** Whether the local tools work in ChatGPT's desktop app and Codex hasn't been
  tested, so the README doesn't list them.
