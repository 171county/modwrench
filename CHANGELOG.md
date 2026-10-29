# Changelog

All notable changes to ModWrench will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once a 1.0 is published.

This document is maintained by hand.

---

## [Unreleased]

## [0.3.1] — unreleased

Patch Day for GTA V, the ModWrench logo as the server's icon, the trademark
policy, a GTA V skin and two recoloured ones, on top of the 0.3.0 beta.

### Added
- **Patch Day for GTA V: "is it safe to update GTA V?"** `mw_patch_day` now
  takes `gta5` (Legacy) and `gta5enhanced` (Enhanced), or a `gamePath` holding
  `GTA5.exe` or `GTA5_Enhanced.exe`, and finds either edition in Steam when no
  Skyrim or Fallout 4 is there. It reads the game's version, `ScriptHookV.dll`'s
  version (which carries the Legacy and Enhanced versions the build supports) and
  Script Hook V's log from the last launch, and says go, check or wait: a game
  newer than the build, a build from before Enhanced on Enhanced, a log that
  says "FATAL: Unknown game version" (which counts even when the version
  numbers match: an update can keep the number), or a Steam update waiting are
  each a wait (a waiting update is a check when Script Hook V already supports
  a newer version than the game). The answer keeps no folder and no script
  name from the log. The Patch Day page draws it with Script Hook V and its log
  in place of plugins. ScriptHookVDotNet, RAGE Plugin Hook, the ASI loader and
  the mods folder are not checked yet. Built from logs players have posted; not
  yet run on a real GTA V install. See TRUST.md ("GTA V").
- **A GTA V skin.** The pages that wear game skins (mods, dependencies, crash
  log, conflicts, Pulse and the deck) get a fifth swatch: a trainer-menu
  banner in a sunset gradient, GTA V's HUD red, cash green and
  mission-passed gold, square corners and a white selected tab. Its headings
  use Pricedown if you have it installed, then Impact; like the other skins it
  loads no font and makes no network request. `nexus_trending` for GTA V
  (`gta5` or `gta5enhanced`) opens in it, the deck lists GTA V with the other
  flagship games, and `mw_deck` takes `theme: "gta"`.
- **ModWrench's logo in VS Code and other MCP clients.** The server's
  initialize reply carries the logo (`serverInfo.icons`), the website's 128 px
  PNG embedded as a `data:` image, so a client that shows it fetches nothing.
  VS Code shows it in its MCP server list and tool picker once the server has
  started; its install page, opened from a link before the server has ever
  run, still shows VS Code's generic icon. A test keeps the embedded image
  identical to `site/public/media/logo.png`.
- **A trademark policy.** [TRADEMARKS.md](TRADEMARKS.md) says how the ModWrench
  name and logo may be used: the MIT license covers the code, not the name.
  Saying what's true ("works with ModWrench", "based on ModWrench") needs no
  permission; a fork gets its own name, and the `@modwrench` npm scope stays
  with this project. The README, the CLI package's README and the website
  mark the name ModWrench™ and link to the policy.

### Changed
- **Skyrim and Lethal Company no longer look like Valheim and Fallout.** Skyrim
  was gold on brown, like Valheim, and Lethal Company green on black, like
  Fallout; the fonts that set them apart aren't loaded (no page fetches
  anything), so they differed only in small details. Skyrim is now cold steel
  and frost blue with a dragonstone-gold edge, and Lethal Company the hazard
  orange of the in-game helmet display, with the terminal green kept for
  "ok". The main and secondary text in both keep a contrast of at least 4.5
  to 1 on every panel.

## [0.3.0] — unreleased

The workbench learns to answer three questions on its own: "is it safe to
update?" (Patch Day), "why did my game crash?" (Crash Whisperer) and "is my
setup ready?" (the Doctors), each with a page for clients that support MCP
Apps, and Patch Day and the Doctors read Fallout 4 as well as Skyrim. The older
panels move from MCP-UI to MCP Apps pages, so a client that can't draw a page
gets the text answer and nothing else. Feedback for the maintainers now has a
command of its own, which drafts an issue for you to post and sends nothing. None
of this has been run inside a real MCP client or against a real game install
yet; [TRUST.md](TRUST.md) says what each tool reads and where it is unsure.

### Added
- **Nexus Mods works without a key.** Eight Nexus tools now ask Nexus's v2
  GraphQL API, which Nexus documents as open without authentication for most
  of it, and send no key or token: `nexus_search`, `nexus_list_games`,
  `nexus_get_game`, `nexus_get_mod`, `nexus_latest_added`,
  `nexus_latest_updated`, `nexus_updated` and `nexus_md5_search`. They are on
  for everyone, as "Nexus Mods" on the deck. The account tools stay on the v1
  API with your key and come on only when one is stored, as "Nexus Mods
  account": `nexus_validate_key`, `nexus_trending`, `nexus_mod_files`,
  `nexus_get_file`, `nexus_file_preview`, `nexus_mod_changelogs` and
  `nexus_endorse_mod`. The answers change shape a little: `nexus_list_games`
  no longer takes `include_unapproved` (GraphQL has no such filter),
  `nexus_updated` lists the 100 most recently updated mods in the window with
  their names, and the total, rather than every mod's id, `nexus_md5_search`
  no longer needs a game (Nexus looks the hash up across all games; a game you
  name keeps only its matches), and the tools return snake_case fields with
  each mod's page address. The standalone `@modwrench/nexus` server now starts
  without a key, with the public tools only. Built from Nexus's published
  GraphQL reference, then run against the live API on 2026-10-29 in MCP
  Inspector on Windows 11: all eight answered, with no key stored. A list
  that withheld adult-tagged mods now says how many (that run's
  updated-in-the-last-day list showed 68 of the newest 100), and an unknown
  game domain, which Nexus answers with a "Game not found" error, gets
  ModWrench's plain "no game with that domain name".
- **Copy buttons on the website's install steps.** Every command and config in
  the Install section has a Copy button, so the apps without a one-click link
  (Claude Desktop, Claude Code, Codex, Antigravity, Devin and the rest) take a
  copy and a paste. The site's browser check copies one and checks the
  clipboard holds exactly the command shown.
- **The website has its own trust page, the ModWrench logo and a tab icon.**
  Its trust links opened TRUST.md on GitHub; they now open `/trust`, which
  `npm run site:build` makes from TRUST.md every time it builds the site
  (with `marked`, a new build-only dev dependency), so the site and the
  repository can't make different promises. The page keeps TRUST.md's
  section links and links to the file on GitHub, where every change to it is
  recorded. A test checks every one of its links has its heading and that it
  runs no script, and the site's browser check opens it from the home page at
  phone and desktop widths. The header shows the logo, and the browser tab a
  small icon made to stay readable at 16 pixels.
- **The website's Install section is a "pick your app" list.** Claude
  Desktop, Claude Code, VS Code, Cursor, Codex, Antigravity, Devin, and Cline,
  Windsurf and other apps each get their own steps, taken from that app's
  documentation (checked 2026-10-24), and a tag saying whether the app draws
  ModWrench's pages or shows text answers. VS Code and Cursor get one-click
  install links, and a test checks that both carry exactly ModWrench's command.
  The page says which apps ModWrench has actually been run in, and that Devin
  in the cloud can't see the games on your PC.
- **The website's source is in the repo, and its Try section works in your
  browser.** `site/` holds the static site deployed to
  modwrench.171county.workers.dev; `npm run site:build` bundles it into
  `site/dist`. The new Try section runs two pieces of ModWrench's own code on
  the page: Crash Whisperer's reading of a pasted or chosen crash log (what
  happened, the leads with their strength and reasons, and the four help posts
  with a Copy button each), with no install check and no other logs compared,
  and Crew Check's comparison of 2 to 16 pasted crew lists. A Try a sample log
  button reads a made-up Skyrim crash from the tests, bundled into the script.
  Nothing is sent:
  the site's Content-Security-Policy now allows its own script and still has
  no `connect-src`, so the browser refuses any request the page might make.
  Node's built-in modules are swapped for stubs in the browser build, and
  `site/test` runs the bundle with no Node behind it to show none is reached.
  TRUST.md has a section on the website. Crew Check's comparison is now
  `compareCrewLists`, which `mw_crew_check` calls with your profile first and
  the website calls without one.
- **`mw_diagnose_crash` shows LOOT's notes on the plugins the crash log lists.**
  With a `gameId`, the answer has a `lootNotes` part beside the known conflicts:
  the messages LOOT's masterlist has for those plugins (`msg`), each shown only
  when it has no condition or its condition is true, at most 10 (LOOT's warnings
  and errors first, with the number left out), and labelled as LOOT's notes,
  general advice about the plugins and not evidence about the crash. LOOT's
  "error" is shown as a warning. The text is LOOT's English, with its
  substitutions (`{0}`) filled in, as one plain line of at most 300 characters,
  as for the conflicts' notes. `mw_check_known_conflicts` doesn't show them.
- **`mw_loot_requirements`: what LOOT's masterlist says your active plugins
  need.** A tool of its own, for Skyrim Special Edition and Fallout 4, that you
  choose to run: it fetches LOOT's list the way the conflict tools do, reads the
  active plugins the way the Doctors do (Mod Organizer 2's profile, or the
  game's own `plugins.txt`), and for each file LOOT lists as required by one of
  them (`req`) says present, missing or unknown, with LOOT's name and note for
  it, as LOOT's record. A requirement LOOT applies only under a condition is
  checked when the condition is true, left out when it is false, and unknown,
  quoting the condition, when ModWrench can't tell. LOOT's errors are warnings.
  It only looks for whether a file is there, with `lstat`, never opening one,
  and only where an allow-list permits, whatever path the masterlist names:
  below the game's Data folder, or directly in the game's folder for one
  leading `../`, with one of the file endings LOOT's requirements use, and with
  Mod Organizer 2 in each enabled mod's folder and Overwrite as well. A link or
  junction on the way isn't followed. It says missing only when that proves
  it: on Windows, with every folder that could hold the file looked in. Off
  Windows, where names that differ in capitals are different files, and for a
  file in the game's folder under Mod Organizer 2, it says unknown. The Doctors
  stay offline. With MO2 the game folder is the one MO2's settings name
  (`gamePath`), which for Wabbajack's lists is a copy beside the instance.
  [TRUST.md](TRUST.md#loot-requirements-what-it-opens) lists every path it may
  look at.
- **Pulse: `mw_pulse` — "what has changed for the mods I run?"** It reads the
  switched-on mods in an r2modman profile and checks each one against
  Thunderstore: which have an update, which their authors have marked
  deprecated, and which Thunderstore no longer has, each named with its author
  and page. **It asks first:** called without `confirm`, it sends nothing and
  answers with how many requests a check would make and to which host; only a
  second call with `confirm=true` sends them, one per mod, each carrying only
  that mod's Thunderstore name. At most 200 mods in a run, four requests at a
  time, through the same client and the same `THUNDERSTORE_BASE_URL` as the
  Thunderstore tools; it never runs on its own and keeps nothing. Thunderstore
  games only so far: mods from Nexus Mods and mod.io aren't checked yet.
  [TRUST.md](TRUST.md#pulse-what-it-reads-and-sends) says what it reads and
  sends.
- **The Pulse page.** In clients that draw MCP Apps pages, `mw_pulse` points at
  `ui://modwrench/pulse`. Before a check it shows what one would send, with a
  Check now button that makes the confirmed call when you press it; after a
  check it lists updates first, with an Open button for each mod's Thunderstore
  page where your client can open links, and a Check again button. The page
  itself makes no network request.
- **Trust Card: `mw_trust_card` — "who made this mod, and is it what it says?"**
  One mod's record on Nexus Mods, mod.io or Thunderstore, one fact to a line:
  author, who uploaded it and whether that is someone else, where it lives,
  latest version, first published and last updated, deprecated, the platform's
  own download and endorsement or rating numbers, and what the platform says
  about permissions. Facts only, each from the platform, and no score of
  ModWrench's own. [TRUST.md](TRUST.md#trust-card-what-it-shows) says what it
  asks for.
- **`mw_query_mod_metadata` looks Thunderstore mods up**, by platform
  `thunderstore` and the mod's full `Owner-ModName`, with no credential. Its
  records also carry when a mod was first published, who uploaded it (Nexus)
  and whether it is deprecated (Thunderstore).
- **Crew Check: `mw_crew_check` — "do we all have the same mods?"** For co-op
  Thunderstore games. With no lists it makes your crew list: one line per
  switched-on mod in your r2modman profile with its Thunderstore name and
  version, and nothing else, for you to share. With your crewmates' lists pasted
  in, it names the mods some players don't have and the mods on different
  versions. No network at all. A pasted list is read only where a line is
  exactly a name and a version, with caps on how much is read, and the answer
  says what was left unread.
  [TRUST.md](TRUST.md#crew-check-what-it-reads-and-compares) has the details.
- **Deck faces.** The deck page and `mw_deck` list five jobs (Crash Whisperer,
  the Doctors, Patch Day, Pulse and Crew Check), each with how it last came out
  in this session: one line built from the job's verdict and counts alone, never
  a name or a path, held in memory and gone when the server stops. Each row's
  Ask puts that job's fixed question into the chat. `@modwrench/workbench`
  exports `deckFaces` and `FACE_JOBS`.
  [TRUST.md](TRUST.md#the-deck-page) says what the rows hold.

- **Patch Day: `mw_patch_day` and the `/mw-patch` slash command — "is it safe to
  update?"** Before or right after a Skyrim Special Edition / Anniversary Edition
  patch, it reads the game's version, the SKSE build and its DLL, the Address
  Library file, and every SKSE plugin DLL — the game's `Data/SKSE/Plugins`, plus
  each enabled Mod Organizer 2 mod and the Overwrite folder, wherever the
  instance's `ModOrganizer.ini` puts them, with MO2's priority rules — applies
  SKSE's own published compatibility rules, and answers **go / check / wait**
  with a reason per plugin. `targetVersion` asks the same question about a patch
  that isn't installed yet, and says to put the new SKSE build in after the
  update, since SKSE's loader starts only the game version its build was made
  for. Steam's appmanifest (is an update waiting?) and SKSE's own `skse64.log`
  (written since the last patch? did SKSE refuse anything the file check
  passed?) are read when present and cross-checked against the prediction.

  Every result says how sure it is. `basis` is `skse-source` where the rule comes
  from SKSE's published source for that game version — SKSE 2.0.20 for 1.5.97,
  2.2.8 for 1.6.x, 2.3.0 for 1.7.99 and 2.3.1 for 1.7.104, including 2.3.1's
  rule for Address Library plugins built before the format change — and the
  refusal carries SKSE's own log text; and `inferred` for everything else, such
  as a game version no published SKSE build was made for. It never says "safe":
  a go means the checks that can run from files passed, and it can't prove the
  game runs.

  It keeps the workbench's promises. DLLs are read as bytes by a small built-in
  PE reader — never loaded or executed, and with nothing Windows-specific, so it
  behaves the same on Linux and the Steam Deck. No network, nothing written or
  kept, and no folder path appears in the result (file names and mod folder
  names do). [TRUST.md](TRUST.md#patch-day-what-it-opens) lists exactly what it
  opens.

  Tested against real folders on disk and, for the binary reader, against files
  a real toolchain built; the repo's read-only scan still passes. Not tested
  against a real SKSE install or a real game executable — see the limits in
  TRUST.md.

  **The answer is plain text first.** A few lines any client can show and a
  model can read: the verdict, how sure it is, which plugins need attention
  (worst first, each with what its reason rests on) and what to do next. The
  full report rides along as structured content for clients that can draw the
  page (see Changed below), including a `confidence` field
  that says whether the verdict rests on SKSE's own log from a launch, on the
  files read against SKSE's rules, or on a prediction (a what-if, or a game
  version no published SKSE build was made for). When SKSE's own log refused a
  plugin the file check had passed, that leads the answer. A run that can't
  happen — an unsupported game, a version that isn't one — comes back flagged as
  an error, with the reason and the games it covers. File and mod folder names
  are flattened to one line and cut short in the text, and flattened the same
  way in the structured report, so a plugin can't name itself "Next steps: …"
  and pass as part of the answer.

  **A page for clients that support
  [MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html):**
  the verdict, how sure it is, the plugins that need attention, a Re-check button
  and a "what if I update to…" box. The client fetches the page only if it can
  draw it, so a client that can't gets the text and nothing else — no markup in
  the conversation. The page makes no network requests and keeps nothing, and
  everything from your machine goes onto it as text, never as markup; see
  [TRUST.md](TRUST.md#the-patch-day-page). `MODWRENCH_UI=off` switches it off.
  It was exercised in a real browser against a stand-in for an MCP Apps host and
  has not yet been run inside a real client.

- **Crash Whisperer: `mw_crash_whisperer`, and `/mw-crash` rebuilt around it —
  "why did my game crash?"** Call it with nothing and it reads the newest crash
  log the loggers wrote (or the one you paste or point at), says in plain words
  what happened, and ranks the names the log points at, each with its reasons and
  a label for what each reason rests on: `log` (the log says so), `install` (your
  files say so), `rule` (a published rule, such as SKSE's own check) or `guess`
  (ModWrench's own inference). A ranking is a **lead**, scored strong, possible or
  faint, never a verdict; the answer never calls anything safe, guilty or
  certain, and counts how many of its statements rest on each basis. It reads
  Crash Logger SSE, Buffout 4, NetScriptFramework and BepInEx logs, checks the
  setup for the usual causes (for Skyrim Special Edition it reuses Patch Day's
  reading of the install, so it can say that a plugin the log names is gone, where
  it came from, or that SKSE's own rule refuses it on your game version; for
  BepInEx it reads the load problems the log itself records), and compares up to
  ten (five by default) of your other recent Crash Logger SSE and Buffout 4 crash
  logs to see whether the same name keeps coming up.

  It writes the post you'd put on a forum, a GitHub issue or Discord, or send to
  the mod's author, each sized for its place. Besides the call stack, a post
  carries what the log names: the objects the logger lists (or, marked weaker,
  prints beside the registers and stack) with the plugins that changed them, the
  game files, Papyrus functions and object types named in the registers and
  stack, a NetScriptFramework log's DLL list, the Address Library id the logger
  gives each game frame, and BepInEx's, Unity's and each plugin's version, and
  its title gives where the game stopped (`SkyrimSE.exe+D6DDDA`). When the game
  stopped at an address in no module, the post gives that address and the first
  frame the log can place, and it says what a well-known DLL that isn't a mod is
  (Mod Organizer 2's usvfs, NVIDIA FleX). A log with no plugin list, or one its
  logger couldn't write, is posted as that, never as "0 plugins", and one its
  logger couldn't write leaves a blank for your load order. A faint lead is not
  named as the mod involved and gets no message to its author, and a BepInEx
  error is not called a crash. Names keep their spelling, except that square
  brackets show as round ones, angle brackets and backticks as look-alikes, `@`
  as `(at)` and a run of spaces as one, and each post but the short Discord one
  says so.
  **The account name, computer name,
  folders, network addresses, email addresses, keys and account IDs it recognises
  are taken out of the log first**, before anything else reads it, and each post
  is checked again at the end; the answer says how many of each were removed,
  never what they were. A spelled-out email address has to end in letters, as a
  real domain does, so a processor's `CPU @ 4.10GHz` is not taken for one. It
  recognises by shape, so it is not a guarantee, and
  [TRUST.md](TRUST.md#crash-whisperer-what-it-opens) lists plainly what it does
  not catch (a mod named after you, relative paths, a first name on its own, an
  address written as one number or shaped like a version number, a password
  with spaces and no quotes, the unlabelled key of a shape it doesn't know),
  with a test behind each item. It also lists the flows it can't help with: a
  log you paste into the chat, or a path you type, has already reached your AI
  as you typed it, and the log file on your disk is never cleaned, so share a
  help post and not the file. Reading the
  file from disk, which is what it does by default, is the private way to use it.
  `/mw-crash` says so when you paste. A log over 12 MB is read at both ends in
  the same text encoding, each cut at a whole line, and the answer says how much
  it read. The log and the other recent logs share one 20-second cleaning
  allowance per call: when it runs out, the lines of the log not yet reached are
  dropped rather than passed along, the recent logs not yet compared are left
  unread, and the answer says so.

  It follows Patch Day's shape: a short plain-text answer for every client, the
  full report as structured content and a page for clients that support MCP Apps
  (the leads and what each rests on, the checks, the call stack, the four posts
  with Copy buttons, a box to paste a log into). The page makes no network
  requests and keeps nothing; names from your machine go onto it as text, never
  as markup. Local and read-only: nothing written or kept, no network.

  Tested end to end on logs in all four formats, with a made-up person's name,
  computer, folders, addresses and keys planted in each, and planted again in
  30 places across the four formats where a log's own words reach the answer,
  then looked for in all 15 strings a call returns; several hundred further
  spellings of keys, labels, paths, addresses and names run through the
  cleaning rules, a speed-up that skips rules proved to change no answer; and
  the cleaning, the large-file reading and the help posts broken on purpose,
  rule by rule, to confirm a test fails each time. The readers are also checked
  against real logs that people published, in all four formats (Crash Logger SSE
  v1.11.1 and v1.20.1, Buffout 4 v1.26.2 and v1.36.0, NetScriptFramework, BepInEx
  5.4.21; cut down, personal details replaced). The page was exercised
  in a real browser against a stand-in for an MCP Apps host, including hostile
  mod names and a log full of personal details; it has not been run inside a real
  client. **It has not been run against a real install.** Where Buffout 4 writes
  its logs is checked only in part.

- **The Doctors: `mw_doctor` and the `/mw-doctor` slash command — "is my setup
  ready?"** A read-only health check for the boring causes behind many "my mods
  keep breaking" threads, which very often aren't the mods. The **Setup Doctor**
  looks at whether the game and Mod Organizer 2 sit in a folder Windows protects
  or syncs (Program Files, OneDrive, Desktop, Documents, Downloads) or on a drive
  short of space, and, for Skyrim Special Edition and Anniversary Edition, at the
  plugin list: plugins whose masters are missing, switched off or loaded after
  them (read from each plugin's header), the limit of 254 full and 4,096 light
  plugins, entries for plugin files that are gone, Mod Organizer 2's list and the
  game's own `plugins.txt` disagreeing, files piling up in MO2's Overwrite folder
  that beat every mod, and crash loggers (none, two that fight, or .NET Script
  Framework on a game version it can't log). The **Deck Doctor**, on Linux and the
  Steam Deck, looks at which Steam holds the game (regular or Flatpak), whether
  Proton has made the game's prefix, whether Proton is told to load BepInEx's
  `winhttp` (in the launch options or the prefix's `user.reg`), which app opens
  `nxm://` links, whether a Steam library sits on an NTFS, FAT32 or exFAT drive, and
  folder names that differ only by capital letters. A `gamePath` is taken as the
  game's folder only when it holds the game's executable, for every game the Doctors
  know (BONEWORKS's may sit one folder down, as Steam installs it); where a
  store's copy has no confirmed executable name (Valheim's from the Microsoft Store
  and the Mac App Store, Dyson Sphere Program's from the Microsoft Store and
  WeGame), a folder without one is checked with a warning, so the report can't
  read clear.

  Every finding says what it rests on, the same way Patch Day and Crash Whisperer
  do: `install` (your files), `rule` (another tool's own documentation, with the
  page named) or `guess` (ModWrench's rule of thumb, such as "under 5 GB free is
  tight"). The verdict is clear, attention or problems, and it is never "safe": a
  clear report means the checks that can run from files passed. A run that stopped
  short reads attention, never clear, and says what was skipped. That covers a
  `plugins.txt` or a folder that is there but couldn't be opened (told apart
  from one that isn't there), the time allowance, a folder walk that reached its
  entry limit, a Mod Organizer 2 instance or profile that was asked for or found
  but couldn't be read, and a check that hit an error. The report also says
  what it can't see from files: antivirus and Smart App Control, the pagefile,
  MO2's live virtual file system, settings a mod manager applies only when it
  launches the game.

  It keeps the workbench's promises. No network, no program started, nothing
  written or kept, and no folder path in the answer (a test fails if one appears;
  names are flattened to one line and cut short). The one file it reads that holds
  other personal settings, Steam's `localconfig.vdf`, is read for a single value
  and only a yes or no comes out: the launch options' text is never returned.
  [TRUST.md](TRUST.md#the-doctors-what-they-open) lists exactly what it opens,
  file by file, and where it is unsure.

  **The answer is plain text first,** as with Patch Day and Crash Whisperer: a short
  answer any client can show (what needs fixing worst first, each line with what it
  rests on, what is fine, what it can't see, what to do next), the full report as
  structured content for clients that say they can draw pages, and a page for those
  that support MCP Apps: the verdict, the findings, Re-check, Copy summary, Ask about
  this and, on Linux, a choice of which checks to run. The page makes no network
  requests and keeps nothing; names from your machine go onto it as text, never as
  markup. `MODWRENCH_UI=off` and `MODWRENCH_STRUCTURED` apply to it as to the others.

  **It has not been run against a real install.** The rules come from the pages each
  finding names and were read and summarised by AI models, so a rule can be stated
  more strongly or more weakly than its page does, and a few facts don't come from
  documentation, which TRUST.md lists: the file names Crash Logger SSE and Trainwreck
  install under (from their build files, and seen in crash logs players posted),
  whether an exFAT drive can hold a Proton prefix (FAT32 has Valve's answer; exFAT
  is ModWrench's inference), and whether a file the game loads without listing it
  could be read as a switched-off master. Where its sources
  disagree (when a missing master crashes the game, on launch or during play) it says
  "likely" and not when. Tested on constructed installs, including a stand-in Steam,
  Mod Organizer 2 and Proton prefix, with 309 tests in eight files and the Doctors'
  rules broken on purpose, 43 ways and then 7 more for Vortex and Fallout 4, to
  confirm a test fails each time. The page was
  exercised in a real browser against a stand-in for an MCP Apps host, including
  hostile plugin and mod names. None of it has been run inside a real MCP client, on
  Windows or macOS, or against a real game folder.

- **Crash Whisperer and the Doctors point at each other.** When no name stands out in
  a crash log from a game the Doctors' plugin checks cover, one of Crash Whisperer's
  next steps is to run the Doctors (`/mw-doctor`), which check the setup problems a
  crash log may not name: a master that is missing, switched off or loaded late, a
  load order past the plugin limit, two crash loggers at once. A log whose list of
  loaded modules shows more than one crash logger gets a note (a documented rule when
  Crash Logger SSE is one of them, ModWrench's guess for any other pair). The Doctors,
  for their part, say that Crash Whisperer (`/mw-crash`) reads the log when a crash
  logger it reads is installed, and every report for a game whose logs Crash Whisperer
  reads says, among its limits, that files can't show why a game crashed and that
  Crash Whisperer reads the crash log. The help-packet step now always keeps its place
  at the end of Crash Whisperer's steps, and a game updated since the crash keeps its
  Patch Day step however many others there are.

- **Fallout 4 in Patch Day and the Doctors.** `mw_patch_day` reads Fallout 4 and F4SE
  the way it reads Skyrim and SKSE: the game's version, the F4SE loader and DLL for
  that version (the GOG build for a GOG copy, from 1.10.980 on), the Address Library file, every plugin
  in `Data/F4SE/Plugins` (and Mod Organizer 2's), and `f4se.log`, judged by F4SE's own
  published rules at each release (`f4se-source`): 0.6.23 for 1.10.163, which asks
  each plugin's own code; 0.7.0 to 0.7.4 for the Next-Gen update to 1.11.137; and
  0.7.5 on, which count only the 1.11.137 Address Library and game layout, so a plugin
  that declares only the 1.10.980 ones is held to the versions it lists. The Microsoft
  Store and Epic copies, which F4SE's loader refuses, are a check that says so. The
  Setup Doctor's plugin checks now cover Fallout 4 too (its eight base plugins,
  `Fallout4.ccc`, `plugins.txt` for each store's copy, the Microsoft Store copy's DLC
  folders beside the game's, and the plugin limits from libloadorder, the library LOOT
  uses, which let a list with no light plugin switched on hold 255 full plugins rather
  than 254), with Fallout 4's crash loggers: none, two at once, Buffout 4 on the
  Anniversary Edition (its NG page says it isn't supported), Buffout 4 AE's crash
  logger before 1.11.137 (its own page says it is made for 1.11.137 and later), and
  Addictol alongside a Buffout 4 build (Addictol's page says not to). Crash
  Whisperer's pointer to the Doctors covers Fallout 4 logs as well, and for those it
  is `/mw-doctor fallout4`, since `/mw-doctor` alone checks Skyrim Special Edition. With no game named,
  `mw_patch_day` checks the one whose executable is in `gamePath`, or else the first
  installed in a Steam library, Skyrim before Fallout 4, and its answer names the
  other when both are there; `/mw-patch` takes the game too. Built from F4SE's source
  and constructed installs; not run against a real one.
- **The Doctors check Vortex's staging folder.** Vortex deploys mods to Skyrim Special
  Edition and Fallout 4 with hard links, which work only within one drive, and keeps
  where its staging folder is in its own database. While it has mods deployed it also
  writes a deployment record into the game's `Data` folder, and on Windows the Setup
  Doctor now reads the start of it (the game, the method and the staging folder; any
  of the file list it takes in is cut off unused) and checks the staging folder: on
  the game's drive when Vortex uses hard links or its move method (a documented rule
  from Vortex's wiki), not under Program Files, OneDrive or a user folder (Vortex's
  own error message says OneDrive can't deal with hard links), and with room on its
  drive. A record that names a folder that isn't there, or one on another computer,
  which isn't opened, says so, and a method other than the four ModWrench knows is not
  repeated. A record with no game in it, as Vortex wrote before 2021, counts as this
  game's, as it does for Vortex. Without a record, or with one that names another game
  or doesn't name a staging folder, the report lists the staging folder as something
  it couldn't check, and says which.

- **`/mw-critique` and `mw_critique`: feedback for the maintainers, posted by
  you.** Tell your AI client what went wrong, what you'd like or what you think,
  and it drafts a GitHub issue with what a maintainer needs to reproduce it filled
  in: ModWrench's version, the connectors that are on, the AI client as it named
  itself, the operating system and Node's version. The personal details it
  recognises in your words, and in the name your client gave, are taken out first,
  as in Crash Whisperer's help posts, before the draft is cut to length. **It
  sends nothing:** ModWrench makes no network request, and the answer ends with a
  link that opens the repository's new feedback form on GitHub with the draft
  filled in, which posts only when you press its button.
  [TRUST.md](TRUST.md#feedback-what-mw-critique-reads-and-sends) lists what goes
  in.
- **The server tells your AI client which tool answers which question.** With 53
  tools to choose from, `@modwrench/cli` now sends MCP's `instructions` when a
  client connects: "why did my game crash" is `mw_crash_whisperer`, "is my setup
  OK" is `mw_doctor`, "is it safe to update" is `mw_patch_day`, and endorsing a
  mod waits for the user's yes. A client may give these to the model or ignore
  them; a test checks that every tool they name exists.

### Changed
- **The startup log line says how long starting took.** `modwrench.started`
  now carries `loaded_ms`, the time from the process starting to all of
  ModWrench's code being loaded, and `ready_ms`, the time to being ready for
  the AI app, so a slow start can be traced to loading the code (Windows reads
  and scans each of the roughly 360 files) or to what comes after. It is
  written to the server's own log, on your computer, like the rest of the line.
- **Releases can move `latest` onto the tried beta.** A latest release of a
  version a beta run already published runs `npm dist-tag add` on it instead of
  skipping it, so what becomes `latest` is the very files that were tried. With
  trusted publishing this needs npm 11.21.0 (already pinned) and "npm dist-tag"
  ticked as an allowed action next to "npm publish". The release build no longer
  uses a download cache. The workflows move to the Node 24 versions of GitHub's
  actions (`actions/checkout@v7`, `actions/setup-node@v7`,
  `gitleaks/gitleaks-action@v3`), ahead of GitHub removing Node 20 from its
  runners.
- **The first runs in real AI apps are written down.** On 2026-10-25, on
  Windows 11, Claude Desktop called `mw_crash_whisperer` on its own and drew
  its page in the chat, MCP Inspector v2.12 drew the Crash Whisperer and deck
  pages, and Cline used ModWrench as text. TRUST.md, the README and the website
  now say so, and still say which pages haven't run in a real app. The website's
  Cline panel says that coding agents may open a crash log themselves, and how
  to keep it out of the chat.
- **An AI asked "why did my game crash?" is pointed at Crash Whisperer, and at
  the log's path.** In a test in Cline, the AI read the crash log into the
  conversation itself and then called `mw_diagnose_crash`, because the two
  lower-level crash tools listed the same trigger phrases as
  `mw_crash_whisperer`. Now `mw_parse_crashlog` and `mw_diagnose_crash` call
  themselves lower-level and name `mw_crash_whisperer` for that question, and
  `mw_crash_whisperer` asks for a named log file as `logPath` rather than read
  into the chat first, since it takes out the personal details it recognises
  before anything reads the log. A test holds all three descriptions to that.
- **The conflict tools answer LOOT's conditions.** An incompatibility entry LOOT
  applies only under a condition came back as `informational`, whatever the
  condition said. ModWrench now reads LOOT's conditions (`not`, `and`, `or`,
  brackets and LOOT's functions) and answers each one true, false or unknown
  from the plugins it knows are active: true is reported as incompatible, false
  isn't reported, and unknown stays `informational`, quoting the condition. It
  can answer `active()` and `many_active()`, and `file()` and `many()` when they
  are true of active plugins. Anything that needs the game's files, such as
  `checksum()`, `version()`, `readable()` or `is_master()`, is unknown, since
  these tools don't read them; so is a condition it can't parse, one over 2,000
  characters or nested more than 16 deep, and a regex that JavaScript could take
  for ever on (LOOT's own regex engine can't). In LOOT's v0.29 lists for all
  seven games, every one of the 5,529 conditions parses. In
  `mw_check_known_conflicts` a plugin you name is taken to be active, and one you
  don't name isn't taken to be inactive, since the list may be partial. In
  `mw_diagnose_crash` the plugins the log lists are active, and the rest are
  inactive only when the log says how many plugins it lists and lists that many
  (Crash Logger SSE's `Total:` line, NetScriptFramework's `Game plugins (N)`), so
  a log cut short or pasted in part doesn't make a plugin look switched off. The
  parsed log now carries that count as `pluginTotal`.

- **The older panels are MCP Apps pages now, and text-only clients no longer
  get HTML.** Fourteen tools put an MCP-UI panel, about 28 KB of HTML, into
  every answer, and a client that couldn't draw it pasted it into the
  conversation (see 0.2.3). They now point at one of five pages instead (mods,
  dependencies and load order, crash log, conflicts, deck), which only clients
  that support MCP Apps fetch, and send the page's data as structured content
  only to those clients. Every other client gets the same text answer as
  before and nothing else; a client that drew MCP-UI panels but doesn't
  support MCP Apps now shows the text answer only. `MODWRENCH_UI=off` now
  means no pages and no structured data (unless `MODWRENCH_STRUCTURED=always`)
  rather than a stub of about 130 bytes in place of each panel.
  `@modwrench/remote` keeps a session per client, so it decides the same way
  (see the entry below on remote sessions). With `MODWRENCH_STRUCTURED=never`
  no tool points at a page at all, since without its data a page could only
  repeat the text answer. The pages
  keep the four game skins, make no network requests and keep nothing; see
  [TRUST.md](TRUST.md#the-other-pages). The README's two pictures are
  retaken from the new pages. Like the three newer pages, they were checked in a
  stand-in for an MCP Apps host, not yet in a real client.
- `nexus_trending`, `modio_list_mods`, `modio_search_mods`,
  `thunderstore_list_mods`, `thunderstore_search_mods`, `thunderstore_top_mods`
  and `mw_query_mod_metadata` no longer put an MCP-UI panel (about 28 KB of
  HTML) in every answer. In clients that support MCP Apps they point at the
  Mods page (`ui://modwrench/mods`). It shows each mod's author, platform and
  page address, and can ask the client to open a mod's page on nexusmods.com,
  mod.io or thunderstore.io. Other clients get the text answer only,
  unchanged. With `MODWRENCH_UI=off` there is no page and no structured data.
- **The dependency and load-order tools answer with a page instead of embedded
  HTML.** `thunderstore_mod_dependencies`, `thunderstore_resolve_dependencies`
  and `mw_read_load_order` now point at one MCP Apps page,
  `ui://modwrench/deps`, which only clients that draw pages fetch; they send
  its data as structured content only to those clients. Text-only clients get
  the same text answer as before and no HTML. `ui://modwrench/order` is
  retired. The page shows a mod's author when the manager knows it
  (r2modman), shows an entry whose enable state isn't known (Vortex) as `?`
  rather than ON and, when no state is known, says so instead of counting none
  as enabled, shows Vortex's warning, shows a Mod Organizer 2 profile's mod
  folders when it lists no plugins (rather than an empty load order under a
  count of enabled mods), says when a resolved dependency tree
  couldn't resolve every reference or stopped at its depth or size limit, and
  shows why a load order couldn't be read (that case had no panel before). It
  never receives the folder the load order was read from.
- **`mw_parse_crashlog` and `mw_diagnose_crash` show their crash on an MCP Apps
  page instead of an embedded MCP-UI panel.** Their text answer is unchanged.
  Clients that support MCP Apps fetch the Crash log page
  (`ui://modwrench/crash`) once and are sent the parsed crash as structured
  data. Every other client gets the text answer alone, with no HTML in the
  result. `MODWRENCH_UI=off` turns off the page and its data. The page's single
  Ask about this button replaces "Ask AI to diagnose" and sends a fixed
  sentence with nothing from the log in it. The "Parse a crashlog" and "Try
  another log" buttons, which ran the tool with no arguments, are gone. A cut
  list now says "first 32 of N". Each plugin stays on one line. Section text
  loses characters that print nothing or flip text direction.
- `mw_check_known_conflicts` no longer embeds the MCP-UI conflicts panel. In
  MCP Apps clients it points at the Conflicts page (`ui://modwrench/conflicts`)
  and sends the conflicts as structured data; text-only clients get the same
  JSON text and nothing else. The page shows a patch's mod id as text: the old
  Patch button, which posted a prompt holding masterlist text, is gone, and a
  warning that repeats LOOT's reason is shown once.
- **`mw_deck` is an MCP Apps page now** (`ui://modwrench/deck`). Clients that
  support MCP Apps draw it; every other client gets the same connector list as
  text and no HTML (it used to embed about 28 KB of MCP-UI panel in every
  answer). The text answer is unchanged. The rows that ran a tool and the game
  tiles that posted a prompt are replaced by **Ask** buttons, shown only when
  your client takes messages from a page, which put a fixed sentence in the
  chat. `view` is kept for compatibility; the page always shows the deck.
- **`mw_patch_day` and `mw_crash_whisperer` send the structured report only to
  clients that say they can draw pages.** Some clients hand the model the
  structured result *instead of* the text (Codex's source, read on 2026-10-02,
  passes a result's structured content to the model and ignores the text), so
  sending the report to every client turned a ten-line answer into a long one. A client that declares MCP Apps support when it connects gets the
  report, as long as the tool has its page: with `MODWRENCH_UI=off`, or when the
  page couldn't be registered, it gets the text like everyone else. The same
  applies to `mw_doctor`. Every other client gets the plain text. Set
  `MODWRENCH_STRUCTURED=always` to send it to every client (for a script or an
  agent that reads the report) or `never` to send it to none. A run that can't
  happen is still flagged as an error for every client.
- The three crash-log readers now read the layouts the loggers really write, which
  also improves `mw_parse_crashlog` and `mw_diagnose_crash`. Crash Logger SSE:
  call-stack rows with padded frame numbers (`[ 0]`) and the `[P]`/`[S]` source
  tag, the newer `CALL STACK ([P]robable / [S]tack scan):` heading, the crash
  time, the address an access violation touched, and symbols after the
  disassembly; a frame found by scanning stack memory is marked as the weaker
  signal it is. BepInEx: the stack traces Unity prints without an "at", return
  types and `(wrapper …)` prefixes on patched methods, and which mod a frame
  belongs to by its namespace. NetScriptFramework: the layout its own source
  writes (the `Unhandled native exception occurred at` line, the
  `FrameworkName:` header and the braced `Probable callstack` and `Game plugins`
  groups), which wasn't recognised before. Crash Logger SSE v1.20 and later: the
  quoted plugin name in relevant-object rows (`("Skyrim.esm")`), which had made
  the game's own master a lead. BepInEx 5: a failed load (`Error loading [X] :
  message`).
- The Workbench now has 9 tools (53 in total, with `mw_critique`), and there are 8 slash commands.
  `/modwrench` mentions the update check, `/mw-crash` now asks for Crash
  Whisperer, and `/mw-doctor` asks for the Doctors.
- The release workflows stop, publishing nothing, when the repository is private.
  npm provenance needs a public source repository, and TRUST.md promises that the
  source is public and that every release can be checked against it.
- Steam detection on Linux also looks in the Flatpak build's current folder,
  `~/.var/app/com.valvesoftware.Steam/.local/share/Steam`. It looked only in the
  older `data/Steam` folder there, which not every Flatpak install has, so a
  Flatpak Steam without it could be missed by `mw_detect_environment` and the
  tools built on it.

### Removed
- **MCP-UI embedded resources.** No tool puts a `ui://` resource inside its
  answer any more, and `ui://modwrench/order` is retired (the load order is on
  `ui://modwrench/deps`). From `@modwrench/ui`: `createUIResource`,
  `UIResourceBlock`, `renderShell`, `ShellOptions`, `ShellView`, `renderDeck`,
  `renderMods`, `renderCrash`, `renderConflicts`, `renderDeps` and their data
  types (`Connector`, `DeckData`, `ModCard`, `ModsData`, `CrashData`,
  `ConflictItem`, `ConflictsData`, `DepsData`), and `resolveTheme`. `esc` and
  `panelsDisabled` are still exported.
- The panels' tab bar.
- From the mods panel: the enable/disable toggle (it changed nothing) and the
  empty state's 'Search mods' button (a tool call with no arguments).
- The conflicts panel's Patch prompt button.

### Fixed
- **Nexus search asks for `adultContent`.** Nexus's v2 GraphQL reference marks
  the `adult` field search used as deprecated, in favour of `adultContent`.
  Search would have switched itself off (it refuses to return results it
  cannot check) once Nexus removed the old field. Every public Nexus tool that
  returns mods now asks for `adultContent` and fails closed the same way.
- **A mod file named with an `@` and a version stays in the answer.** Crash
  Whisperer took `MyMod@1.2.3.dll` for an email address and removed it, so a
  crash log naming a versioned mod lost the one name a helper needs. As the help
  posts write it, `MyMod(at)1.2.3.dll`, the word after the name went too. A
  version made of numbers may now sit between the `@` and the file ending, and
  the name stays. Real addresses still go, `jane.doe@mail2.example.com`
  included. Found first in MyneWrench's copy of the same check, on Minecraft
  mod files.
- **Crash Whisperer says when a log has lost its line breaks.** A log pasted
  into a box that holds one line (MCP Inspector's text field does this) arrives
  as one long line, and Crash Whisperer answered that it couldn't find a crash
  in it. A log of three lines or fewer that still names three or more of a
  log's sections or entries is now refused with what happened and what to do:
  give the file in `logPath`, or paste it somewhere that keeps the line breaks.
  A log whose line breaks are lone carriage returns is read like any other.
- **The Mods page shows a long mod name whole.** It cut every name at 120
  characters, shorter than the 128 Thunderstore allows. The cut is now at 300,
  against hostile input only, and a long name wraps.
- **The load-order page is no longer labelled "Dependencies".** One page draws
  both a Thunderstore mod's dependencies and the load order `mw_read_load_order`
  reads, and its label said "Dependencies" over either. The label now says
  "Dependencies", "Load order" or "Mod folders" for what is drawn, and the
  page's title is "Dependencies and load order".
- **Long plugin names wrap on the load-order page.** Each name was held to one
  line and cut with an ellipsis, so at phone width most of a long plugin name
  was lost, and a plugin file name with no spaces ran under the ON/OFF flag and
  out of the list. Names and plugin files now wrap inside the row, on the
  dependency lists too.
- **Download counts on the Mods page for Nexus trending and Thunderstore search
  and top mods.** They showed "—". `nexus_trending` read a `downloads` field
  that Nexus's v1 API doesn't send (it sends `mod_downloads`), and
  `thunderstore_search_mods` and `thunderstore_top_mods` never added up their
  versions' downloads. Those two tools' text answers now carry `total_downloads`, as
  `thunderstore_list_mods`' always has. mod.io and `mw_query_mod_metadata` were
  already right, and a mod a platform gives no count for still shows "—".
- **A profile name can't climb out of the profiles folder.** `profileName` is
  joined onto Mod Organizer 2's or r2modman's profiles folder, so a name like
  `../../somewhere` read a profile's `mods.yml`, `plugins.txt` and `modlist.txt`
  from outside it. Every tool that takes one (`mw_read_load_order`,
  `mw_patch_day`, `mw_crash_whisperer`, `mw_doctor`, `mw_loot_requirements`,
  `mw_pulse` and `mw_crew_check`) now refuses a `profileName` that isn't one folder name (empty,
  `.` or `..`, or holding `/`, `\` or a NUL character) before anything is
  opened, with an answer that names the argument and doesn't repeat it. A
  `selected_profile` in `ModOrganizer.ini` that isn't one folder name is treated
  as missing.
- **A LOOT entry whose plugin name is a regex gets the same guard as a regex in
  a condition.** The conflict tools ran a fetched name like `(a+)+\.esp` as it
  came, and JavaScript can take for ever on one like that. Such an entry is now
  skipped and matches no plugin. Every regex name in LOOT's v0.29 lists for all
  seven games passes the guard.

- **A tool or slash command whose arguments are all optional answers when a client
  leaves the arguments out.** Before version 1.32.0, the MCP SDK checked a
  `tools/call` or `prompts/get` request that had no `arguments` field against the
  tool's argument list and failed it before ModWrench saw it, so a client that
  called `mw_doctor`, `mw_crash_whisperer` or `/mw-doctor` that way got an
  "invalid arguments" error instead of an answer. ModWrench now needs SDK 1.32.0
  or later, which reads a missing `arguments` as none given. A tool or command
  that needs an argument still says it's missing.
- **Workbench tools no longer open network paths.** A path argument that named
  another computer or a device (`\\server\share\…`, `//server/share`,
  `\\?\UNC\…`, `\\.\…`) went straight to the filesystem. On Windows, opening one
  connects to that computer over SMB and tries to sign in with your Windows
  account, while the tools say they make no network request. Every workbench
  tool now refuses such a path before anything opens it, and the answer doesn't
  repeat it. `\\?\C:\…` local long paths still work, unless a `..` in one
  climbs off its drive (Node opens `\\?\C:\..\UNC\…` as a network path). A
  folder that a Mod Organizer 2 instance's own `ModOrganizer.ini`,
  `modlist.txt` or profile name leads to on another computer isn't opened
  either. This covers the older
  `mw_parse_crashlog`, `mw_diagnose_crash` and `mw_read_load_order` too, and
  `gameId` in `mw_check_known_conflicts` and `mw_diagnose_crash`.
- **An unexpected error no longer carries a folder path.** A file another
  program held open (`EBUSY`), or one your account couldn't read (`EPERM`), made
  Node throw an error whose message is the full path, user name included, and
  the SDK passed that message to the client as the answer. Every workbench tool
  now answers such an error with its name and the error code only.
- **`mw_read_load_order` finds a Mod Organizer 2 profile where the instance
  keeps its profiles.** It looked only in the instance's own `profiles` folder,
  so an instance whose `ModOrganizer.ini` puts its profiles somewhere else
  (`profiles_directory`, or a `base_directory` elsewhere) read as having no such
  profile. The setting is read the way MO2 reads it, by the code Patch Day and
  the Doctors use for the mods and Overwrite folders: a path MO2 wrote in quotes
  or with its backslashes doubled is understood, a relative one starts from a
  portable instance's folder, and on Linux a folder is found whatever the
  capitals in its name, as Wine finds it.
- **Crash logs are read more fully, checked against twelve published logs.**
  Buffout 4 v1.36 plugin rows written with no space (`[00]Fallout4.esm`) are
  read, where a 106-plugin list came out empty. A log with no plugin list, or
  one whose logger failed to write it (`PLUGINS:` then `ERROR`), is now told
  apart from an empty one (`pluginList`). NetScriptFramework's "Possible
  relevant objects", crash time and framework version are read, and a call stack
  that is really raw stack memory is marked as a scan, without values that can't
  be return addresses. Objects that Crash Logger SSE before v1.20 and Buffout 4
  print under registers and stack slots are read as weaker evidence than a
  relevant-objects list (`origin`), and NetScriptFramework's are read as register
  or stack objects too: its list is every object it found there, and the number
  before each is how far from the registers it was found, not how relevant it is.
  Crash Logger SSE v1.20's relevant objects keep their kind and in-game name, and
  an object it lists at several stack slots is read once.
  Register types (and the R8 and R9 registers,
  which were dropped), Address Library ids on frames, the loaded modules for
  every format, the game files and Papyrus functions the stack names, and
  BepInEx's own version and each plugin's version are kept. A game file whose
  path has an empty folder in it (two slashes in a row) is left out, because a
  network share can hide there. A BepInEx log now says whether its last error is
  a real exception and how much the log went on after it (`lastError`). The name
  of the player's own character is left out of the objects read. This changes
  what `mw_parse_crashlog` and `mw_diagnose_crash` return too; `mw_diagnose_crash`
  lists an object found beside a register or in stack memory, or the player's own
  character, after the mods on the call stack, and says which it is.
- **Crash Whisperer reads more of what a log shows, and its advice fits the
  crash.** It no longer tells you to remove a library other mods need (RaceMenu's
  skee64.dll, JContainers, PapyrusUtil): it says so and points at the mod that
  may have called it, which the ranking now scores like the first mod code. It
  names the mod behind a few well-known DLLs, weighs an object by where the
  logger found it (its own list, beside a register, in stack memory, or the
  player's own character), names the plugin a Papyrus script in the log is
  named like as a guess, and says what the game was working with: objects, game
  files, the kinds of object in the registers and Papyrus functions. A crash at
  an address in no module says so and names the first frame the log can place;
  a crash inside NVIDIA FleX suggests turning Fallout 4's Weapon Debris off; a
  d3d11.dll the module list names twice is no longer called Windows' graphics
  layer. A BepInEx log whose last error isn't an exception, or that went on
  after it, is no longer called a crash, and a repeated error shows its message
  without calling Unity's own log a mod. With no lead, the steps start from what
  the log shows and size the halving to the load order, an older Crash Logger
  SSE log's empty-pointer read is explained from its instruction and registers,
  and a NetScriptFramework log's module list is read at last. The Crash
  Whisperer page says where the game stopped, the mod behind a DLL and what the
  game was working with as the answer does.
- **Crash Whisperer says when a crash was in Havok code, and no longer
  contradicts itself about objects.** With no lead stronger than faint, a Havok
  class at the top of the call stack or in a register (hknp and hkp for physics;
  hkb, hka or BShkb for animation) is named in the headline, with a step to look
  at physics or animation mods first. For Skyrim the animation step also says to
  run Nemesis or Pandora again. A crash site ModWrench already names, such as
  NVIDIA FleX, keeps its own advice instead. A log that lists object types in
  its registers but no game objects no longer says it "lists no objects the game
  was working with": the answer and the posts now say the log names no object
  from a mod's plugin.
- **`mw_read_load_order` reads r2modman profiles again.** It looked for
  PascalCase keys (`AuthorName`, `Name`, `Version`, `Enabled`) that r2modman
  never writes to `mods.yml`; r2modman writes its own camelCase field names
  (`authorName`, `displayName`, `versionNumber`, `enabled`). Every mod came back
  as "(unnamed)", switched on, with no version or author. Mods now carry their
  name, author, version and Thunderstore id (r2modman's `name`, already
  `Author-ModName`), and a mod is switched on only when r2modman says so. The
  `icon` path some r2modman versions write, which holds the player's user name,
  is still never read. Checked against a public 87-mod Lethal Company profile.
  On Linux and the Steam Deck it also looked for r2modman's Flatpak under an id
  that doesn't exist (`com.kalindudc.r2modmanPlus`); it now uses r2modman's own,
  `io.github.ebkr.r2modman`, as environment detection already did.
- **`@modwrench/remote` sends page data to clients that draw pages.** It used
  to start a fresh server for every request, so the one answering a tool call
  never saw the client's `initialize` and sent a page's data to no one unless
  `MODWRENCH_STRUCTURED=always`. It now keeps a session per client (the
  protocol's `Mcp-Session-Id`), in memory only: closed when the client sends
  `DELETE /mcp`, after 24 hours unused, or when a 101st session opens and it
  is the least recently used. As with the stdio server, a client that declares
  MCP Apps support gets the Thunderstore pages' data and every other client gets
  the text alone. A request without a session ID that isn't `initialize` gets
  400 (an empty header counts as none), and an unknown session ID 404, as the
  transport specification says; a client that doesn't send the session header
  back, which worked before, now gets that 400, and a client whose session was
  closed gets "Session not found" until it reconnects. The 100-session limit is
  shared by everyone who can reach the server.
- **`@modwrench/remote` answers a bad request body with a short JSON error.** A
  body that wasn't JSON, was over the size limit, or used an encoding the
  server doesn't take got Express's HTML error page, with the stack trace and
  the server's folder paths, and the same stack went to the server's console.
  It now gets a JSON-RPC error: `-32700 Parse error` (400) for a body that
  isn't JSON, `-32600 Request body too large` (413), `-32600 Invalid Request`
  for the other rejected bodies, and `-32603 Internal server error` (500) for
  anything else, with no stack trace or path.
- **`@modwrench/remote` checks which web page a request came from.** The
  transport specification says a server must check the `Origin` header a
  browser adds, and answer 403 to one it doesn't accept, so that a web site
  can't reach the server through your browser (DNS rebinding); it wasn't
  checked. A request from a page is now answered only when the page is on the
  same computer and the server listens on `127.0.0.1`, `localhost` or `::1`, or
  when `MODWRENCH_ALLOWED_ORIGINS` (comma-separated, exact origins such as
  `https://app.example.com`) lists it, in place of that default. Any other gets
  403 `Invalid Origin` before its body is read or a session is looked at. A
  request with no `Origin`, which is what programs other than browsers send, is
  answered as before, and the `Host` check (`MODWRENCH_ALLOWED_HOSTS`) still
  applies. A client that sends an `Origin` the server doesn't accept, which
  worked in 0.2.4, now gets that 403 until its origin is listed. Claude's custom
  connectors have been reported to send one (`https://claude.ai`, and once
  `https://claude.ai/`), so a server they use needs
  `MODWRENCH_ALLOWED_ORIGINS=https://claude.ai,https://claude.ai/`. `GET /mcp`
  still gets 405, now with the `Allow: POST, DELETE` header HTTP requires.
- **`mw_detect_environment` finds MelonLoader for BONEWORKS.** It looked for
  `MelonLoader/MelonLoader.dll` in Steam's install folder for the game, but the
  game sits one folder down (`BONEWORKS\BONEWORKS`), and MelonLoader goes beside
  it; from 0.6 on, its build for a game like this one is in `MelonLoader/net6`.
  So a Steam copy with MelonLoader read as having no loader. Both layouts are
  now looked for in the game's own folder. An install r2modman manages still
  reads as none, because r2modman keeps MelonLoader in its profile.
- **The known-conflict check reads LOOT's current masterlist.**
  `mw_check_known_conflicts`, and `mw_diagnose_crash` with a `gameId`, fetched
  the masterlists' `v0.26` branch. LOOT 0.29.0 moved its users to `v0.29` in
  April, and `v0.26` has had no new entries since: Skyrim Special Edition's has
  799 incompatibility entries on `v0.29` and 725 on `v0.26` (Fallout 4's are the
  same on both). `LOOT_BRANCH` now defaults to `v0.29`, the branch LOOT reads,
  and `.env.example` no longer suggests `master`, which Skyrim Special Edition,
  Fallout 4 and Starfield don't have. Skyrim VR and Fallout 4 VR asked for lists
  that exist on neither branch, so the LOOT check always failed for them; they
  now read Skyrim Special Edition's and Fallout 4's, as LOOT does. The fetch
  had no time limit, so a stalled connection held up the answer, crash
  diagnosis included, until the client gave up, and no size limit; it now gives
  up after 30 seconds, and stops reading a list over 8 MB (the largest, Oblivion's,
  is 1.2 MB) rather than parse part of one. Either way the answer says which
  happened, and the check uses the community data only, as it does when GitHub
  can't be reached. An entry LOOT applies only under a condition (47 of Skyrim
  Special Edition's 799 and 8 of Fallout 4's 217), such as 3DNPC's with Open
  Cities when their patch isn't active, was reported as incompatible whatever
  the condition said; it now comes back as `informational`, quoting LOOT's
  condition and saying ModWrench doesn't check it yet. A description now carries
  LOOT's name for the other file (`display`) and its note (`detail`, in English),
  as one plain line of at most 300 characters. It used to read a `msg` field
  that LOOT's entries don't have, so every description was the same sentence.
  Entries whose plugin name is a regex, such as
  `RUSTIC SOULGEMS - (Sorted|Unsorted)( - ESL)?( - GIST)?\.esp`, were never
  matched; they hold 117 of Skyrim Special Edition's 799 and 22 of Fallout 4's
  217. They are now read as LOOT reads them, and every entry that matches a
  plugin counts, as in LOOT. A conflict names the two plugins as you or the
  crash log wrote them, never by LOOT's regex or its spelling.

### Security
- **Dependencies brought up to date; `npm audit` finds nothing.** zod, which
  checks every tool's input, moves from 3 to 4 (4.6.6 or later), because zod 3
  can run out of memory validating an oversized list
  ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)) and
  has no fixed 3.x release. The MCP SDK supports zod 4, and the tools' inputs and
  descriptions are unchanged. The web-server libraries the MCP SDK brings in
  (`body-parser`, `proxy-addr`, `hono`, `@hono/node-server`, `ip-address`,
  `fast-uri`) get their fixed versions in the lockfile. Those matter to `@modwrench/remote`, the HTTP
  server; the local server doesn't listen on the network.

## [0.2.4] — 2026-09-15

A metadata release: nothing inside the server changed. Everything here is
about what the packages look like from the outside, because that is what a
stranger sees first, and it was wrong.

### Fixed
- **Six published package descriptions showed mojibake on npm.** The em-dash
  in `@modwrench/cli`, `@modwrench/core`, `@modwrench/nexus`,
  `@modwrench/modio`, `@modwrench/thunderstore` and `@modwrench/workbench`
  had been double-encoded — UTF-8 bytes read back as Windows-1252 and saved
  as UTF-8 again — so npm rendered a three-character mojibake where each
  em-dash should be, on every package page. A description is baked into the
  published tarball and a published version cannot be overwritten, so a
  release was the only way to ship the fix. All six now carry the em-dash as
  the JSON escape `\u2014`, which no editor codepage can re-encode.
- **The release gate now catches it before it can happen again.**
  `check-publishable.mjs` already refused phantom dependencies and internal
  version drift; it now also refuses double-encoded text. The check runs on
  every release before npm publish — the only place this defect class is still
  fixable.

  It does not search for a signature. Searching for the `â€` that 0.2.3
  produced would only ever catch `U+2000`–`U+203F`, because that string is the
  Windows-1252 rendering of the UTF-8 lead pair those codepoints share — so the
  em-dash family would be caught while an accented letter, `©`, an arrow, `™`
  and every emoji went through untouched. Instead the gate *undoes* the
  transform: it re-encodes the text as Windows-1252 and decodes the result as
  strict UTF-8. If that succeeds and yields different text, the text is what a
  mangled round-trip produces, whatever character it started as. A correct
  em-dash is a single Windows-1252 byte, which is not valid UTF-8 on its own, so
  the decode fails and the text is left alone.

  The gate now also covers the surfaces that were never checked: every
  package's `keywords`, `server.json`'s title, and every `README.md` that
  ships. That last one matters most — npm puts a package's README in the
  tarball whatever its `files` allowlist says and renders it as the entire body
  of the package page, so checking only the one-line description guarded the
  smallest public surface and waved through the largest.

  36 tests cover it, one per double-encoding family in both directions: each
  must be caught when mangled and left alone when correct.

- **The GitHub release step is re-runnable.** `gh release create` has no upsert
  flag and fails outright when the release already exists, so re-running the
  workflow — the recovery the registry job's own error message tells you to
  perform — would have failed on a step that had already succeeded. It now
  checks first and edits or creates, the same shape the npm publish loop
  already used.

### Added
- **npm keywords, on all eight packages.** None of them had a `keywords`
  field, so npm search could not find any of them by the words a modder or
  an MCP user would actually type.
- **GitHub Releases.** Tags `v0.1.0` through `v0.2.3` were pushed, but
  release.yml published only to npm and the MCP registry, so the Releases
  page stayed empty the whole time. A new job, gated on a tag push and on
  npm succeeding, extracts this CHANGELOG's section for the tagged version
  and publishes it as the release body. A tag whose version has no CHANGELOG
  section fails the release instead of shipping auto-generated notes.

### Changed
- **The README status line no longer names a version.** It read "Early —
  v0.2.1" against packages at 0.2.3 — a line that goes stale the moment it
  is written. It now reads "Early — pre-1.0", which cannot drift. The top of
  the page now carries CI, npm and license badges as well.

## [0.2.3] — 2026-09-15

### Added
- **`MODWRENCH_UI=off` turns the MCP-UI panels off.** Found by running ModWrench
  in Cline, where the answer was excellent — an 11-package Thunderstore
  dependency tree with install order and nine authors credited — and roughly
  28kb of panel source had been pasted into the transcript ahead of it.

  That is the real failure mode for MCP-UI today, and not the one expected. A
  client that does not support `ui://` resources does not quietly ignore them;
  it puts the HTML into the conversation as text, so the model reads markup and
  minified JavaScript it can do nothing with. Measured: one panel is 27.6kb,
  about 8,820 tokens, near 7% of a 128k context window — and a four-tool answer
  spends over a quarter of the window on markup that was never drawn.

  `MODWRENCH_UI=off` (also `0`, `false`, `none`) shrinks the payload to 129
  bytes, a 219x reduction, taking that 28% down to 0.13%. The block keeps its
  shape — same type, uri, mimeType and meta — with only the HTML swapped for one
  line naming the variable that caused it, so a user who forgot they set it can
  work out why the UI vanished. Panels remain on by default; this is opt-out.

### Changed
- **The README now shows the panel before describing it,** with both views above
  the fold, rendered from the published package rather than a working tree.
- **VS Code is documented, with the right config key.** The install section did
  not mention it, and the JSON it gave uses `mcpServers` — VS Code's native MCP
  config uses `servers`, so a VS Code user copying that block would have got a
  config that silently does nothing.

### Fixed
- **The npm visibility guard waits as long as npm says.** Three releases measured
  the lag against a 150-second window: 0.2.0 failed, 0.2.1 passed, 0.2.2 failed.
  npm states "may take a few minutes" on every publish, so the window is now ten
  minutes to match. `@modwrench/cli` publishes last of the eight, which puts it
  at the back of the propagation queue every release.

## [0.2.2] — 2026-09-15

### Fixed
- **`modwrench --help` silently started the MCP server.** It fell through to
  the boot path: the server came up on stdio, wrote one JSON log line, and sat
  waiting for a client that was never going to speak. The most obvious command
  a new user can type made the tool look broken inside ten seconds, and every
  other unrecognized argument did the same. `--help`, `-h` and `help` now print
  usage and exit 0; any other unrecognized argument names itself back and exits
  1 with the same text. An MCP client launches this with no arguments at all,
  so anything in `argv[2]` came from a person at a prompt.

  The usage text leads with the fact that ModWrench is a server an AI client
  starts, not a program you run yourself — without that, someone who has not
  met MCP runs the bare command, sees nothing happen, and concludes it does not
  work. Five tests cover it, spawning the real entry point. The load-bearing
  one asserts that no arguments still boots the server and completes an
  `initialize` handshake, because the two halves of this fix pull in opposite
  directions and widening the guard too far would break every client at once.

## [0.2.1] — 2026-09-15

An audit of the published 0.2.0 tarballs against README.md and TRUST.md found
eleven places where the two disagreed. Every one of them ran the same direction:
the documents promised more than the code delivered, never less. Four were code
defects and are fixed; seven were overclaims and the claims are now scoped to
what the code actually does.

### Fixed
- **`auth status modio` reported a working setup as broken.** `auth key` stores
  a raw API key; `authStatus` checked for a credential with the JSON reader,
  which threw on every raw key, was swallowed, and printed "Not signed in" with
  exit 1 on a credential that had stored correctly. It then pointed users at
  `auth login modio` — undocumented, and itself requiring the key they had just
  stored. The one verification step the README offers now works. `@modwrench/nexus`
  already had the correct pattern; mod.io now mirrors it.
- **`nexus_file_preview` never passed through the adult-content filter.** The
  tool follows a CDN URL Nexus names at runtime, so it leaves the shared request
  path and the policy was never applied to what it returned. Filtering that
  response would not have helped — an archive listing carries no adult flag, so
  the filter is structurally a no-op on it. The flag is on the mod record, so
  the tool now checks that first and refuses rather than returning an
  adult-tagged mod's archive listing unlabelled.
- **The withheld-content notice was generated and then discarded.** The filter
  replaces a flagged record with a marker carrying its own explanation;
  `mw_query_mod_metadata` handed that straight to the normalizer, which builds
  from named fields only. The result was `found: true` with name and author
  `undefined` and a page URL ending in `/undefined` — success reported for a
  request that had actually been withheld. It now reports the withholding, with
  the reason.
- **The three mod.io discovery tools dropped the link back to the author.**
  `modio_list_mods`, `modio_search_mods` and `modio_popular` hand-build their
  summaries and never copied `profile_url` across, so the assistant could not
  cite an author's page even when asked. The UI card had the same gap.

### Changed — documentation corrected to match the code
- **The adult-filter guarantee is now scoped.** TRUST.md claimed every Nexus
  tool fails closed when it cannot verify the flag. Two do. The rest rely on the
  flag being present, and some endpoints return records that carry no flag at
  all — changelogs, update lists, file records. A new section names each one in
  a table instead of implying a guarantee the code cannot keep.
- **The destination table was short by one.** `nexus_file_preview` contacts a
  Nexus CDN host chosen at runtime. The README disclosed it; the TRUST.md table
  that claims to be complete did not.
- **"Watch every byte it sends" was not true of the auth path.** Base URLs are
  overridable for the tool paths, but `nexus/auth.ts` and `modio/auth.ts` use
  hardcoded hosts — so the one request carrying your freshly-pasted credential
  is the one request the documented proxy technique cannot intercept. Named,
  along with two other paths no variable controls.
- **GitHub learns which game you mod.** TRUST.md said `raw.githubusercontent.com`
  receives your IP "and nothing else". The masterlist URL contains the game name.
- **The page's own verification recipe returned four hosts it never mentioned.**
  They are a User-Agent string, a policy link and two "where to get your key"
  links — text, not connections — but a reader following the instruction hit the
  page's own "that is a bug in this page" condition on the first try. All nine
  hits are now accounted for, and a second grep finds requests built from
  runtime values, which a literal-matching grep cannot see.
- **The attribution promise is scoped to what can carry attribution.** Platform
  outputs carry author, platform and link. The crash and conflict tools work
  from plugin filenames on the user's own disk and cannot attribute them without
  a network lookup per suspect — so they are named as the gap they are, in the
  section mod authors read.
- **Two shipped surfaces were undisclosed:** the bundled community conflict list
  (which ships empty) and the five slash commands.
- **Stale version references.** The README said v0.1.1 and TRUST.md's pinning
  example pinned `0.1.0` — two releases behind, and before the adult-filter fix
  the same document described as shipped.

## [0.2.0] — 2026-09-12

Documentation was audited against the source, and the code was changed where a
claim could not be made true otherwise. Nothing here alters what the tools do.

### Fixed
- **Adult-content filtering did not cover every path to Nexus.** Nexus's terms
  put the filtering duty on API consumers, and TRUST.md promised the filter
  "covers every Nexus tool — including any added later". It did not.
  `@modwrench/workbench` builds its own Nexus REST client for
  `mw_query_mod_metadata` and returned responses unfiltered, so a direct id
  lookup surfaced in full what `@modwrench/nexus` would have withheld. The
  policy moved to `@modwrench/core` — one implementation, both callers — and the
  Workbench client now applies it. `packages/nexus/src/adult.ts` re-exports it,
  so existing imports and tests are unchanged. Guarded by four new tests,
  including a source-level check that fails if that client is ever rebuilt
  without the filter.
- **`nexus_search` now asks Nexus for the adult flag.** It runs on the v2
  GraphQL endpoint and its selection set omitted the field entirely, so the
  filter had nothing to read and passed every adult-tagged mod through — on the
  only Nexus tool with real keyword search. The field is requested when
  filtering is active, and omitted when the operator has opted in. If the schema
  rejects it, the tool **fails closed**: it returns an error naming the fix
  rather than results it cannot check, because returning unchecked results with
  a warning is still returning them. Five new tests cover the request shape, the
  filtering, the fail-closed path, the opt-in path, and that an unrelated
  GraphQL error is not misread as a missing field.
- **Disclosed a sixth network destination.** `nexus_file_preview` follows the
  `content_preview_link` the Nexus API returns — a CDN host rather than a fixed
  endpoint, and the only request in the tree to a host not known ahead of time.
  It carries no credential. Three documents claimed a complete list and omitted
  it.
- **Corrected "never writes it anywhere" and "read once at start-up."** `auth
  key`, `auth login` and `auth logout` write to the credential manager, and
  credentials are read at platform activation — which `mw_activate_platform` can
  trigger mid-session — while `mw_query_mod_metadata` re-reads per call.
- **Scoped the environment-variable claim.** `auth login nexus` reads
  `NEXUS_OAUTH_CLIENT_ID` and `NEXUS_OAUTH_CLIENT_SECRET` from the environment.
  Those are OAuth application credentials issued to an application operator, not
  a user's account key — so the docs say that, instead of an absolute one grep
  falsifies.

- **`@modwrench/core` no longer reads a `.env` file.** It called dotenv's
  `config()` at import time, locating the target by walking up from the
  installed package for a `package.json` with a `workspaces` array — so
  installed inside another monorepo it could read that project's `.env` into
  ModWrench's process. No credential ever came from it, but README said "there
  is no `.env` or file fallback". Removed, along with the `dotenv` dependency.
- **Removed `getSecret()` from `@modwrench/core`.** An exported
  secret-from-environment reader that nothing called. **Breaking change to the
  public API of `@modwrench/core`**; no package in this repo used it.
  Credentials now come from the OS credential manager and structurally cannot
  come from anywhere else.
- **Corrected every "read-only" claim.** `nexus_endorse_mod` POSTs an
  endorsement to Nexus. Six documents said the project performs no writes,
  including a draft letter to Nexus Mods stating "no such call exists in the
  code". The tool itself was always gated and documented in TRUST.md; the other
  documents had not caught up.
- **Corrected every tool count.** Actual: nexus 15, mod.io 17, Thunderstore 9,
  workbench 6, cli 2 — 49, of which 48 read.
- **Removed the README demo transcript.** It named three real mods and three
  real authors, attached invented download and endorsement figures, and claimed
  their work was CC-licensed.
- **Dropped the claim that ModWrench never ranks mods.** Four tools surface a
  platform's own popularity and rating figures. TRUST.md now says so.
- **`@modwrench/remote` is published to npm.** TRUST.md said it was not.
- **Corrected the credential-lifetime claim** in `.env.example` and on the npm
  package page: the credential is read once at start-up and held until the
  process exits, not "no longer than the request that uses them".
- **Relicensed note:** the project is MIT from 0.1.0 onward. The 0.0.1 entry
  below records Apache 2.0, which was accurate at the time.
- **ui tests are typechecked.** `tsconfig.json` covered only `src/`, and `npm
  test` runs through tsx, which strips types without checking them — so test
  fixtures had drifted from the exported types. Added
  `packages/ui/tsconfig.typecheck.json` and fixed the drift it found.

### Removed

- **Twelve documentation files, 2,776 lines.** VISION, ROADMAP, RELEASE and the
  whole of `docs/`. They were internal strategy, unbuilt plans, superseded
  design notes, and in several cases claims the code contradicted. Volume was
  the defect: 4,002 lines of markdown for a 0.1.1 project is 4,002 lines that
  can drift. Git retains all of them.
- **`.claude/skills/`** — thirteen files of cross-product authoring tooling that
  did not belong in this repository.

### Changed

- **README rewritten**, 340 lines to 111: what it is, what it does, how to use
  it, what it connects to, and the one thing it writes. The host table is
  generated from the URLs actually requested in `packages/*/src`.
- **CONTRIBUTING rewritten**, 233 lines to 75.
- **TRUST.md** corrected in three places and re-verified against the code.

## [0.1.1] — 2026-09-12

The real 0.1.x cut: keychain-only credentials, native-modding scope (CurseForge and Minecraft
support removed), the stateless `@modwrench/ui` MCP-UI package, `nexus_endorse_mod` (first
write action, explicit opt-in), adult-content filtering on Nexus, recursive dependency
resolver with crash-to-culprit correlation, Linux/Steam Deck detection fixes, TRUST.md, and
the tag-gated release workflow with npm provenance. Published by CI from the `v0.1.1` tag.

## [0.1.0] — 2026-09-12 (superseded)

Published in error from a stale checkout within the hour before 0.1.1; superseded
immediately. If you installed `@modwrench/*@0.1.0`, upgrade to 0.1.1.

### Removed

- **CurseForge platform removed from ModWrench.** `@modwrench/curseforge` and all CurseForge wiring were pulled out — CurseForge is a Minecraft-centric host and is out of scope for ModWrench.
- **Minecraft support removed from the Workbench.** The Minecraft crash-report parser and the Forge/Fabric/NeoForge loader + `minecraft` game-family detection were removed as out of scope. ModWrench's local diagnostics now target the Bethesda Creation Engine and Unity/BepInEx families only. Final platform lineup: Nexus, mod.io, Thunderstore, and the local Workbench.

### Added

- **CurseForge platform added** ([packages/curseforge/](packages/curseforge/)) — 10 read-only tools, authenticated via `CURSEFORGE_API_KEY` (free from console.curseforge.com) sent in the `x-api-key` header. (2026-06-25)
- **v2.5 Dynamic Catalog foundation** — `MetaCatalog` class in `@modwrench/cli` plus the `mw_activate_platform` meta-tool. Platforms now register through the catalog rather than inline. Failed activations (e.g. missing credentials) stay dormant rather than disappearing — the LLM can retry via `mw_activate_platform` once the user adds credentials in another terminal, no server restart needed. McpServer declares `listChanged: true` capability and `MetaCatalog.activate` emits `notifications/tools/list_changed` on state changes so MCP clients re-fetch automatically. Idempotent: re-activating a live platform returns `alreadyActive: true` with no side effects. 13 catalog-orchestration tests cover smoke, credential-success/fail paths, idempotency, notification gating, retry-after-cred-set, and listActive/listFailed snapshots. Auto-activation policy refinement (selective activation based on `detectEnvironment()` rather than activate-all) deferred to v2.5.1.
- **Remote Streamable HTTP MVP** ([packages/remote/](packages/remote/)) — `@modwrench/remote` exposes a `/mcp` endpoint for remote-capable clients such as ChatGPT developer-mode apps. The MVP is intentionally public-read-only: Thunderstore only (7 tools), with no Nexus/mod.io credential loading and no workbench filesystem tools. Includes a health descriptor and HTTP MCP smoke tests.
- **`./detect` export from `@modwrench/workbench`** — `detectEnvironment()` extracted as a standalone function (the same logic that powers `mw_detect_environment`'s handler), now importable from `@modwrench/workbench/detect`. Used by the meta-server for future auto-activation decisions.
- **CurseForge platform package** ([packages/curseforge/](packages/curseforge/)) — 10 read-only tools (game/category discovery, mod search, mod details, file listings, changelogs, dependency lookups). Requires `CURSEFORGE_API_KEY` (free from console.curseforge.com), sent via the `x-api-key` header.
- **Thunderstore platform package** ([packages/thunderstore/](packages/thunderstore/)) — 7 read-only tools for Unity co-op modding (Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS, and 270+ communities). No credentials required — anonymous public REST API.
- **`@modwrench/workbench` package** — 5 atomic tools (`mw_detect_environment`, `mw_read_load_order`, `mw_parse_crashlog`, `mw_query_mod_metadata`, `mw_check_known_conflicts`) that compose with the v1 platform packages into a conversational diagnostic experience. Closes the v1→v2 chain end-to-end.
- **Shared HTTP client** ([packages/core/src/http.ts](packages/core/src/http.ts)) — `createHttpClient()` factory with 429 + Retry-After handling, exponential backoff on 5xx, per-client concurrency cap (default 4), and structured error envelopes. Refactored every platform package and workbench's metadata clients to use it.
- **`modwrench` meta-CLI** with `auth <action> <platform>` subcommand routing and `--version` / `-v` flags. Composes every installed `@modwrench/*` platform into one MCP entry.
- **`SECURITY.md`** — vulnerability disclosure policy, scope, credential-handling rules, 90-day coordinated disclosure timeline.
- **`ROADMAP.md`** — canonical "where this is going" doc covering v2.5 dynamic catalog, v2.6 local toolchain integrations, v3 publishing, and deferred items.
- **Dynamic catalog architecture spec** — design for boot-time auto-activation of platforms based on workbench detection, plus an `mw_activate_platform` meta-tool for runtime opt-in. Trigger for build is the 4th platform.
- **Contributor walkthrough** — step-by-step guide for adding a new `@modwrench/<platform>` package, with trust-posture non-negotiables.
- **Remote deployment docs** — current MVP scope, local run instructions, remote client URL shape, and remaining hosted-auth work.
- **Steam Deck / headless Linux keychain fallback** — `getStoredToken` now classifies errors as `no-entry` vs `unavailable`, emits a one-time warning when libsecret/D-Bus is missing, and `loadCredential`'s error message explains the real cause. New `getKeychainStatus()` export.
- **Gitleaks workflow** ([.github/workflows/gitleaks.yml](.github/workflows/gitleaks.yml)) with custom Nexus + mod.io key patterns covering the gap where GitHub's free secret scanning has no partner pattern for those providers.
- **CI test step** running `npm test` across all workspaces on Node 20 + 22.
- **Conflict database scaffolding** ([packages/workbench/data/conflicts/](packages/workbench/data/conflicts/)) — empty seed JSON files for Skyrim SE, Fallout 4, Lethal Company plus a documentation README. Awaits community PRs.
- **Test suites across all workspaces** — 126 tests total: core (18), nexus (10), modio (9), thunderstore (10), curseforge (10), workbench (55), remote (2), cli (13). Each platform's tests verify auth-header routing, URL shapes, query params, pagination, and error envelopes.

### Removed

- **Modrinth platform removed** — Modrinth (the open-source Minecraft hub) is out of scope for ModWrench, which targets native game modding. ModWrench no longer ships `@modwrench/modrinth`. (2026-06-25)

### Changed

- **Public docs narrowed to ModWrench scope** so README and ROADMAP focus on the current product, shipped packages, and planned ModWrench toolchains.
- **Workspace order** in root `package.json` made explicit (not glob-based) so each workspace's dependencies build before their dependents.
- **README** repositioned to surface workbench diagnostics alongside platform tools; v2 marked shipped; stdio npm install documented for local clients; ChatGPT support clarified as the remote public-tool MVP.
- **CONTRIBUTING.md** false claim about `core` having rate-limit-aware helpers corrected; `CONTRIBUTORS.md` auto-generation softened to "git shortlog as source of truth for now."
- **Auth hint messages** unified to the meta-CLI form (`modwrench auth login <platform>`) across every user-facing string.
- **LOOT masterlist branch** pinned from `master` to `v0.26` (stable maintenance branch — community entries continue to flow, schema stays frozen).
- **Workbench wiring prompt reorganized** out of the repo root: `WIRING-PROMPT_MCP-ModWrench-Workbench.md` → `docs/wiring-prompts/workbench.md`.

### Fixed

- **CLI `--version`** now reads from `package.json` instead of a hardcoded literal.
- **CI ordering** swapped so `build` runs before `typecheck` — workspace dependents need `.d.ts` files from their dependencies to typecheck on a fresh clone.
- **Workbench test glob** dropped `**` (Node 20's `--test` only handles single-star globs natively).
- **Crashlog `likelySource`** preserves multi-word plugin names (regression: `JKs Whiterun Outskirts.esp` was being truncated to `Outskirts.esp`).
- **README footer link** broken `github.com/<your-username>/modwrench` placeholder replaced with the real repo URL.
- **Duplicate `.env.example.txt`** removed (kept `.env.example` as the standard dotenv convention).

### Security

- `qs` bumped from 6.15.1 to 6.15.2 (CVE: DoS via `qs.stringify` on null/undefined entries in comma-format arrays — moderate severity, transitive dependency).

---

## [0.0.1] — 2026-05-17

Initial public release on GitHub. Single squashed commit (`2d46d24`) after orphan-branch reset to purge the pre-public history that contained accidentally-committed API credentials.

### Included at initial release

- `@modwrench/nexus` — 12 read-only tools for Nexus Mods. OAuth (PKCE) + API key fallback.
- `@modwrench/modio` — 11 read-only tools for mod.io. OAuth (email code) + API key fallback.
- `@modwrench/cli` — meta-server composing every installed platform under one MCP entry.
- `@modwrench/core` — shared library: keychain integration via `@napi-rs/keyring`, env helpers, structured logger to stderr, credential resolution chain (keychain → env → fail-with-hint), `ModWrenchError` envelope.
- `LICENSE` (Apache 2.0), `CONTRIBUTING.md` (DCO sign-off model), three GitHub issue templates, PR template, basic CI workflow on Node 20 + 22.
- Trust posture documented in README: six non-negotiables (no telemetry, no personal data, attribution preserved, permissions respected, rate limits honored, read-only default).
