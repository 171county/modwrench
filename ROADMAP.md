# Roadmap

Where ModWrench is going next, so an issue or a pull request can be checked against it.
These are plans, not promises: [CHANGELOG.md](CHANGELOG.md) says what has shipped, and
[TRUST.md](TRUST.md) says what each tool does today. If something here is wrong or you'd
order it differently, [open an issue](https://github.com/171county/modwrench/issues).

## Now: the 0.3 beta

0.3.1 is on npm as `beta` (`npx -y @modwrench/cli@beta`), and 0.3.2, with two small
fixes, comes next. The 0.3 betas carry Patch Day, Crash Whisperer, the Doctors, Pulse, Crew
Check, the Trust Card, LOOT's conditions and requirements, keyless Nexus search, the pages,
and Patch Day for GTA V. The default install (`@modwrench/cli`, the `latest` tag) is still
0.2.4. Before the beta becomes the default:

- **A real game install.** Nothing has run against a real Skyrim Special Edition, Fallout 4
  or GTA V folder; the tests build their own. GTA V's checks were built from logs players
  have posted.
- **Real clients.** The Crash Whisperer page has run in Claude Desktop and MCP Inspector,
  and the deck in MCP Inspector and in VS Code's Copilot Chat. The Patch Day page has shown a
  check that couldn't run in VS Code, but not a full report. The other pages haven't been
  opened in a real client yet. What each client does is written into TRUST.md as it's tried.

## Next

- **GTA V, the rest of it.** Patch Day for GTA V reads Script Hook V. Still to come, in this
  order:
  1. **The Setup Doctor for GTA V:** the right ASI loader for the edition (`dinput8.dll` for
     Legacy, `xinput1_4.dll` for Enhanced) and a leftover `dsound.dll`; plugins that failed
     to load (`asiloader.log`); mods built for the other edition; BattlEye off for Story
     Mode; a plain warning before GTA Online when mods are in place; and the setups mod
     managers and loaders leave behind, such as mods moved aside for Online, RageOpenV and
     Onigiri.
  2. **Crash Whisperer for GTA V:** the scripts Script Hook V and ScriptHookVDotNet name in
     their logs when one fails. GTA V writes no crash log of its own, so these are the mod
     loaders' records, and the answer says so.
  3. **Patch Day, more of it:** ScriptHookVDotNet and its Enhanced fork, and RAGE Plugin
     Hook with LSPDFR, which are tied to game versions too.
  4. **The Steam Deck and Linux:** the launch-option override each edition's loader needs.
- **Community feeds,** read-only and asked for first, the way Pulse asks before it checks
  Thunderstore. In this order:
  1. **Steam news:** built as `mw_news`, for the next beta: the announcements and patch notes
     each game's publisher posts on Steam. It's public and needs no key, and Patch Day points
     to it when Steam has an update waiting.
  2. **Tool releases on GitHub:** built into the same tool: the latest releases of LOOT,
     xEdit, Mod Organizer 2, BepInEx, MelonLoader, r2modman and ScriptHookVDotNet.
     CodeWalker isn't in it, because it publishes no GitHub releases; ScriptHookVDotNet's
     Enhanced fork joins once where it releases is confirmed.
  3. **Reddit:** posts about a mod or a game update in that game's modding subreddits,
     linked back to Reddit. Since late 2025 every app needs Reddit's approval before it can
     read anything, so this is built only once Reddit approves ModWrench. Everyone using
     ModWrench would share one limit of 100 requests a minute, and nothing is kept.

  **Discord** isn't planned: reading a server needs a bot that the server invites and that
  runs around the clock, and ModWrench has no service to run one ([TRUST.md](TRUST.md#there-is-no-modwrench-service)).
  It could come back if a mod community wants to host one. **Posting** stays copy and paste:
  Crash Whisperer writes the help post and you post it.
- **Steam Workshop, as a platform of its own.** For RimWorld, Cities: Skylines, Arma 3,
  Project Zomboid, Stellaris, Garry's Mod and many other games, the Workshop is where the
  mods are. In this order:
  1. **What's on your PC,** which needs nothing from anyone: the Workshop items Steam has
     downloaded for each game (under `steamapps/workshop`, listed in the
     `appworkshop_<appid>.acf` file Steam keeps), and whether Steam is waiting to update any
     of them.
  2. **A Workshop mod's public facts,** such as its name, author, last update and
     subscribers, from Steam's public API. Valve's documentation lists no key for it; it
     will be tried against Steam itself before it's built.
  3. **Searching the Workshop,** which needs a free Steam Web API key that each player gets
     from Steam and that ModWrench keeps in the system's keychain, like a Nexus key. Steam's
     terms say a key must not be shared, so there is no ModWrench key for everyone.
- **One-click install for Claude Desktop.** A `.mcpb` bundle, so there is no config file to
  edit and no wait for `npx` to fetch the package on first start.
- **Hand the install to your mod manager.** ModWrench still never changes a game's files:
  where a mod would help, it gives the link your own mod manager or Steam acts on, and you
  click it.
  1. **Thunderstore:** the "Install with Mod Manager" link that r2modman opens and installs
     from. Its exact format is to be confirmed in r2modman's source first.
  2. **Nexus Mods:** a link to the mod's Files tab, where "Mod Manager Download" hands it
     to Vortex or Mod Organizer 2.
  3. **Steam Workshop:** a `steam://` link that opens the mod in the Steam app, where you
     subscribe and Steam downloads it.

  Some AI apps may not open links that don't start with `https://`; there the link is still
  shown, to click or copy.
- **Recipes:** one button for a whole job, like "before I update: Patch Day, then Pulse,
  then the Doctors".
- **Your Play Save:** a snapshot of your setup under your own name, so you can see what
  changed since it last worked. Off until you turn it on, saved only where you choose, and
  never sent anywhere. It would be the first file ModWrench writes on your computer, so
  TRUST.md and the README's "The one thing it writes" change before it ships.
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
