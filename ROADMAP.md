# Roadmap

Where ModWrench is going next, so an issue or a pull request can be checked against it.
These are plans, not promises: [CHANGELOG.md](CHANGELOG.md) says what has shipped, and
[TRUST.md](TRUST.md) says what each tool does today. If something here is wrong or you'd
order it differently, [open an issue](https://github.com/171county/modwrench/issues).

## Now: the 0.3 beta

0.3.0 is on npm as `beta` (`npx -y @modwrench/cli@beta`), and 0.3.1 comes next. Together
they carry Patch Day, Crash Whisperer, the Doctors, Pulse, Crew Check, the Trust Card, LOOT's
conditions and requirements, keyless Nexus search, the pages, and Patch Day for GTA V. The
default install (`@modwrench/cli`, the `latest` tag) is still 0.2.4. Before the beta becomes
the default:

- **A real game install.** Nothing has run against a real Skyrim Special Edition, Fallout 4
  or GTA V folder; the tests build their own. GTA V's checks were built from logs players
  have posted.
- **Real clients.** The Crash Whisperer page has run in Claude Desktop and MCP Inspector,
  and the deck in MCP Inspector and in VS Code's Copilot Chat. The other pages haven't been
  opened in a real client yet. What each client does is written into TRUST.md as it's tried.

## Next

- **GTA V, the rest of it.** Patch Day for GTA V reads Script Hook V. Still to come, in this
  order:
  1. **The Setup Doctor for GTA V:** the right ASI loader for the edition (`dinput8.dll` for
     Legacy, `xinput1_4.dll` for Enhanced) and a leftover `dsound.dll`; plugins that failed
     to load (`asiloader.log`); mods built for the other edition; BattlEye off for Story
     Mode; a plain warning before GTA Online when mods are in place; and the setups other
     tools leave, such as ModDrop V's stash of mods moved out for Online, RageOpenV and
     Onigiri.
  2. **Crash Whisperer for GTA V:** the scripts Script Hook V and ScriptHookVDotNet name in
     their logs when one fails. GTA V writes no crash log of its own, so these are the mod
     loaders' records, and the answer says so.
  3. **Patch Day, more of it:** ScriptHookVDotNet and its Enhanced fork, and RAGE Plugin
     Hook with LSPDFR, which are tied to game versions too.
  4. **The Steam Deck and Linux:** the launch-option override each edition's loader needs.
- **One-click install for Claude Desktop.** A `.mcpb` bundle, so there is no config file to
  edit and no wait for `npx` to fetch the package on first start.
- **Pulse for Nexus mods,** from the mod IDs and versions that Mod Organizer 2 (`meta.ini`)
  and Vortex record; then mod.io.
- **More of LOOT's masterlist:** its dirty-plugin records (`dirty`). Matching one needs the
  plugin's checksum (CRC), so this waits for the real-install check above.
- **The Trust Card with LOOT's notes** about the mod.
- **LCPDFR.com** (LSPDFR's mods), if LCPDFR grants an API key. **GTA5-Mods.com** has no public
  API, and ModWrench doesn't scrape sites, so it is in only if they offer one.

## Watching

- **GTA 6 on PC.** It comes out for PlayStation 5 and Xbox Series on 19 November 2026; a PC
  version hasn't been confirmed (one report says early 2027). GTA 6 support waits for a PC
  release, a Script Hook for it, and Rockstar's rules for modding it. Before then: a warning
  on the website about fake "GTA 6 PC download" and "source leak" sites, a known way to
  spread malware.
- **Node.js 20** reached its end of life on 30 April 2026. ModWrench still runs and is
  tested on it; dropping it is planned for a later release, with a changelog note first.

## Open questions

- **Nexus Mods account features.** The read tools use Nexus's v2 GraphQL API and need no
  key. Whether endorsing a mod and the other account tools move to OAuth, as a registered
  application, is being worked out with Nexus Mods support.
- **ChatGPT.** Whether the local tools work in ChatGPT's desktop app and Codex hasn't been
  tested, so the README doesn't list them.
