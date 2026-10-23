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

- **More of LOOT's masterlist.** The conflict check reads the masterlist's
  incompatibility entries (`inc`) and, in `mw_diagnose_crash`, LOOT's messages for a
  plugin (`msg`). The same file also carries its requirements (`req`) and its
  dirty-plugin records (`dirty`). The plan, in three stages:
  1. **Conditions.** Done, not yet released: LOOT's conditions are answered true,
     false or "unknown" from the plugins a tool knows are active, `inc` entries follow
     them in both conflict tools, and `mw_diagnose_crash` shows up to 10 of LOOT's
     messages that have no condition or whose condition is true, labelled as LOOT's notes and not as evidence about
     the crash. [CHANGELOG.md](CHANGELOG.md) has the details.
  2. **Requirements.** Done, not yet released: `mw_loot_requirements`, a separate tool that
     you choose to run, fetches the list and checks the `req` entries of the active plugins
     against the install, saying present, missing or unknown. The Doctors stay offline and
     get no switch for it. It only checks whether a file is there, and only at the paths an
     allow-list permits, inside the game's folders, whatever path the masterlist names.
     [TRUST.md](TRUST.md#loot-requirements-what-it-opens) lists them.
  3. **Dirty plugins.** Matching a `dirty` record needs the plugin's checksum (CRC), so this
     waits for the real-install check above.

  In every stage LOOT's "error" is shown as a warning, never as a ModWrench "problem", and
  LOOT's text is shown in English only.
- **The pages:** mod names cut at 120 characters, the load-order page titled
  "Dependencies", plugin names cut off at phone width, and download counts that show "—".

## Open questions

- **How ModWrench reaches Nexus Mods.** Whether the read tools can move to Nexus's v2
  GraphQL API, so that no personal API key is needed, and whether endorsing a mod goes
  through OAuth as a registered application. This is being worked out with Nexus Mods
  support.
- **ChatGPT.** Whether the local tools work in ChatGPT's desktop app and Codex hasn't been
  tested, so the README doesn't list them.
