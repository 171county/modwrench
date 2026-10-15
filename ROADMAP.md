# Roadmap

Where ModWrench is going next, so an issue or a pull request can be checked against it.
These are plans, not promises: [CHANGELOG.md](CHANGELOG.md) says what has shipped, and
[TRUST.md](TRUST.md) says what each tool does today. If something here is wrong or you'd
order it differently, [open an issue](https://github.com/171county/modwrench/issues).

## Still to check from 0.3.0

0.3.0 was released without two checks, and they come first:

- **A real game install.** Nothing has run against a real Skyrim Special Edition or
  Fallout 4 folder; the tests build their own.
- **Real clients.** The pages have been drawn only in a stand-in for an MCP Apps host. Each
  one should be opened in the clients that support MCP Apps, with the results written into
  TRUST.md.

## 0.3.1

- **The Doctors check that a folder is the game's own, for every game.** A `gamePath` for
  Skyrim Special Edition must hold `SkyrimSE.exe`, and one for Fallout 4 `Fallout4.exe`.
  For the other games any existing folder is taken as given. A wrong one then replaces the
  folder Steam found without saying so, can come back "clear", and on Linux can say BepInEx
  isn't installed when it is. Each game will be checked for its own executable, with the
  names Mod Organizer 2's game plugins and Thunderstore's game list use:
  - Skyrim: `TESV.exe`
  - Skyrim VR: `SkyrimVR.exe`
  - Fallout 4 VR: `Fallout4VR.exe`
  - Fallout: New Vegas: `FalloutNV.exe`
  - Fallout 3: `Fallout3.exe`, or `Fallout3ng.exe` for the low-violence copy
  - Starfield: `Starfield.exe`
  - Oblivion: `Oblivion.exe`
  - Lethal Company: `Lethal Company.exe`
  - Valheim: `valheim.exe`, or `valheim.x86_64` for the native Linux build
  - R.E.P.O.: `REPO.exe`
  - Risk of Rain 2: `Risk of Rain 2.exe`
  - Dyson Sphere Program: `DSPGAME.exe`
  - BONEWORKS: `BONEWORKS.exe`, one folder down in `BONEWORKS\BONEWORKS`

  Copies from the Microsoft Store or Game Pass haven't been checked against these names, so
  each one is confirmed before the check turns a folder away, rather than risk refusing a
  real install.
- **BONEWORKS and MelonLoader.** Because the game's executable sits one folder down,
  environment detection may look for MelonLoader one folder too high and always report no
  loader. To be confirmed first.

## After 0.3.0

- **More of LOOT's masterlist.** The conflict check reads only the masterlist's
  incompatibility entries (`inc`). The same file also carries LOOT's messages for a plugin,
  with the conditions they apply under, the dirty-plugin records (`dirty`) and the load-order
  rules (`after`, `req`). The plan is to read them from the file ModWrench already fetches,
  read-only, and to evaluate a condition only when ModWrench supports every function in it,
  skipping the message otherwise.
- **The pages:** mod names cut at 120 characters, the load-order page titled
  "Dependencies", plugin names cut off at phone width, and download counts that show "—".
- **The Doctors:** the places that find Mod Organizer 2's folders read its settings
  separately and can disagree, and an exFAT drive alongside a FAT32 or NTFS one
  is labelled a documented rule where it should be a guess.
- **`@modwrench/remote`:** a refused request doesn't say which methods are allowed, and
  requests aren't checked for the site they came from.
- **Tests:** on Windows, a few of the tests that check no folder path leaks prove nothing.
  Linux and macOS CI still enforce them.

## Open questions

- **How ModWrench reaches Nexus Mods.** Whether the read tools can move to Nexus's v2
  GraphQL API, so that no personal API key is needed, and whether endorsing a mod goes
  through OAuth as a registered application. This is being worked out with Nexus Mods
  support.
- **ChatGPT.** Whether the local tools work in ChatGPT's desktop app and Codex hasn't been
  tested, so the README doesn't list them.
