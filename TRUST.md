# What ModWrench does, and what it won't

Every claim on this page was checked against the code before it was written here, and every one of them is something you can verify yourself. The last section shows you how.

Where a claim needed a caveat to stay true, the caveat is here instead of being left out. A list like this is only worth anything if the awkward parts are on it.

---

## What ModWrench will never do

- **Never download, install, or delete a mod.** No tool does it. There is no download code in this repository.
- **Never modify your load order, your mod files, or your game files.** Every local tool opens files read-only. There is not a single filesystem write call in the workbench package.
- **Never open a network path handed to a tool.** Every workbench tool refuses a path argument that names another computer or a device, meaning anything that starts with two slashes or backslashes, such as `\\server\share\crash.log`, `//server/share`, `\\?\UNC\…` or `\\.\pipe\…`. It refuses before anything opens it, because on Windows opening one connects to that computer and tries to sign in to it with your Windows account. That covers `logPath`, `gamePath`, `mo2InstancePath` and `instancePath`, and `gameId` in `mw_check_known_conflicts` and `mw_diagnose_crash`, where the game id becomes part of a file name. The answer names the argument and doesn't repeat the path. The long spelling of a local drive, `\\?\C:\…`, still works, unless a `..` in it climbs off the drive: Node opens `\\?\C:\..\UNC\server\share` as `\\?\UNC\server\share`, so that is refused too. A Mod Organizer 2 instance's own files get the same check: a folder its `ModOrganizer.ini` puts on another computer, or a mod or profile name in it or its `modlist.txt` that climbs onto one, is treated as missing and never opened. What it can't catch: a drive letter you mapped to a network share, or a link on a local drive that points at one. Those are read like any other folder.
- **One write action, and only on your say-so.** ModWrench can endorse a mod on Nexus — crediting its author — when you ask it to. It asks first, every time, and shows you exactly what it will do before it does anything. Nothing else writes: no votes, no ratings, no comments, no subscriptions, no uploads. Details below.
- **Never generate mod content.** ModWrench reads and explains. It produces no assets, no code, no voices, no text intended to ship inside anyone's mod.
- **Never rate, rank, or score a mod itself.** It will tell you what a mod is and what it does, and it will not review someone's work back at them. It does pass through a platform's *own* published figures — Nexus trending, mod.io popular, Thunderstore top-rated — because those are the platform's numbers, not ModWrench's opinion.
- **Never send anything to the maintainer.** There is no analytics SDK, no crash reporting, no telemetry, no phone-home. No network destination in this codebase belongs to us. `/mw-critique` drafts feedback for you to post yourself, and sends nothing either (see [Feedback](#feedback-what-mw-critique-reads-and-sends)).
- **Never store your data.** Nothing is written to disk. There is no database and no cache of your data — the only thing held in memory is LOOT's public masterlist, and it dies with the process.
- **Never ask for a password.** ModWrench never sees or handles your platform password.
- **Filter adult-tagged Nexus content by default**, unless you explicitly enable it yourself. Every Nexus response passes through the filter, which drops what the adult flag marks. The filter reads that flag off the record, so where a response carries no flag it cannot judge it — see [the limits of the adult filter](#the-limits-of-the-adult-filter) below, which says exactly which tools fail closed and which do not. This is the one promise on this page with a real edge, and it is spelled out rather than rounded up.

## There is no ModWrench service

There is no account, no login to us, no server we operate. Nothing you do reaches a machine we control, because there is no such machine. ModWrench is a program your editor starts on your computer and stops when you close it.

Two clarifications so that is exact rather than merely reassuring:

1. The repo includes an optional HTTP transport package (`@modwrench/remote`), which is published to npm and which **you** may choose to run — on your own machine or your own host. It defaults to binding `127.0.0.1`, keeps one server per client session, and exposes only the public Thunderstore tools and the two pages five of them point at (`ui://modwrench/mods` and `ui://modwrench/deps`): it holds no credential and touches no files. A session is the protocol's own (the `Mcp-Session-Id` header): it lives in memory only, holds only what the client sent when it started (its name, its version and what it supports) and the server answering it, is closed when the client ends it or after 24 hours unused, and at most 100 are open at once (opening one more closes the least recently used). A client whose session was closed gets "Session not found" until it reconnects. The limit of 100 is shared by everyone who can reach the server: bound to `127.0.0.1`, as it is by default, that is only your own machine, but on a server others can reach, anyone can open sessions and push the oldest out. Because the server answering a tool call saw the client's start-up, it sends the pages' data only to clients that draw pages, as the local server does. Nobody runs an instance of it for you.
2. `modwrench auth login nexus` briefly opens a listener on `127.0.0.1` to catch the OAuth redirect from your browser. It closes the moment login completes or after five minutes.

The ModWrench *package* is listed on npm and the MCP server registry. That registers the software. It does not register you.

## Every place ModWrench connects

The complete list, from the shipped code:

| Destination | When | Why |
|---|---|---|
| `api.nexusmods.com` | Nexus tools; crash-suspect attribution (opt-in) | Mod data; author links for named suspects |
| `users.nexusmods.com` | `auth login nexus` only | OAuth |
| `api.mod.io` | mod.io tools | Mod data |
| `thunderstore.io` | Thunderstore tools | Mod data |
| `raw.githubusercontent.com` | Conflict tools | LOOT's public masterlist |
| a Nexus CDN host | `nexus_file_preview` only | The archive listing for one file |

Two of those need naming properly rather than being left to the table.

**The CDN host is the only destination here that is not a fixed address.** `nexus_file_preview` reads a file's `content_preview_link` — a URL Nexus supplies at runtime — and follows it. ModWrench does not choose that host and cannot list it in advance, because Nexus decides it per file. The request carries no credential.

**`raw.githubusercontent.com` learns which game you are modding.** The masterlist URL contains the game: `raw.githubusercontent.com/loot/<game>/…/masterlist.yaml`, where `<game>` is `skyrimse`, `fallout4`, `starfield` and so on. So GitHub receives your IP address, that game name, and a User-Agent identifying ModWrench and its version. No mod data, no credentials, no file paths — but the game name is real and this page previously said "nothing else", which was not accurate.

Platform base URLs are environment variables you can override, so you can point most of ModWrench at a proxy and watch what it sends. Three paths do not honour those variables, and the first is the one you would most want to watch:

- **The auth requests carry your credential and cannot be redirected.** `nexus/auth.ts` and `modio/auth.ts` use hardcoded hosts, so the request that validates your freshly-pasted key goes to Nexus or mod.io and nowhere else — but you cannot point it at a proxy to confirm that for yourself. To verify it, read those two files or watch the connection at the network layer.
- `nexus_search` reads `NEXUS_GRAPHQL_URL`, a separate variable from `NEXUS_BASE_URL`.
- `nexus_file_preview` follows the CDN URL above, which no variable controls.

## Your credentials

**Read only from your OS credential manager.** Windows Credential Manager, macOS Keychain, or Linux libsecret. The credential loader has no environment-variable fallback and no file fallback — if nothing is in the keychain, the tool fails with an error rather than looking somewhere else.

**Stored only there.** Written when you run `auth key` or `auth login`, removed when you run `auth logout`, never copied to a file.

**Held in memory for as long as the server runs.** Not "only for the duration of the request" — that would be a nicer sentence and it is not what the code does. The credential is read once at startup and lives in the process until it exits.

**Not logged.** No log line in the codebase includes a key or token, and logs go to stderr, never to a file. Credential-bearing URL parameters are stripped from HTTP error messages, and the auth commands run upstream error bodies through a redactor before printing. To be precise rather than flattering: redaction is applied at those specific points, not as a blanket filter over every possible output path.

**No `.env` is read at all.** ModWrench used to load one at startup for non-secret settings; that code was removed, along with its `dotenv` dependency, so there is no file-reading path left in the credential library to argue about. Non-secret operational settings — log level, API base-URL overrides, Steam root, the adult-content switch below — are plain environment variables you set in your MCP client's config.

## The one thing ModWrench can write

ModWrench has exactly one action that changes anything outside your machine: **endorsing a mod on Nexus.**

It exists because endorsements are how mod authors get credited, and because a tool that helps you find the mod that fixed your crash should be able to say thanks to the person who made it. It gives authors something rather than taking a page visit away.

**It cannot happen by accident.** The tool performs no network call at all unless you have confirmed. Ask for an endorsement and the first thing that comes back is a preview — which mod, which version, that it is public and shows your username. Only a second, explicitly confirmed call actually sends it. There is a test asserting that the unconfirmed path touches the network zero times, because "it asks first" is worth guarding rather than promising.

Two more details, since they are the kind of thing worth knowing:

- The write path **does not retry**. A normal read that fails is retried a few times; an endorsement that fails is reported to you once. Retrying a write you cannot see the result of is how things get done twice.
- You can undo it any time on the mod page. ModWrench does not need to be involved.

**A correction, because an earlier version of this page got it wrong.** It said the Nexus OAuth scope is read-only "so it could not write even if asked." That was misleading. A Nexus personal API key — the credential most people will use — carries your full account permissions and has no scope restriction at all. The reason ModWrench did not write was that no write code existed, not that the credential forbade it. Now one write exists, it is gated as described, and this paragraph is here rather than deleted because a trust document that quietly fixes its own mistakes is not one.

## Adult content

Nexus tags some mods as adult content. On their own site that content is hidden from signed-out visitors, off by default for signed-in ones, and released only after an age check. Their Terms of Service put the same duty on tools like this one, in a single sentence: *"Third parties who use our APIs are responsible for filtering the content returned."*

**ModWrench filters it out by default.** Adult-tagged entries are dropped from lists, and a direct lookup of one comes back as a short notice saying it was withheld and why. The filter lives in `@modwrench/core` and sits in the shared request path of both packages that talk to Nexus — `@modwrench/nexus` and the Workbench's own client — so a tool that goes through that path inherits it. A tool that makes its own request does not; see the limits below.

### The limits of the adult filter

The filter decides by reading a flag off each record. That single fact sets the whole boundary, so here is exactly where it holds and where it cannot.

**Where a request can be checked, ModWrench refuses rather than guess.** Two tools are built to fail closed:

- `nexus_search` runs against the v2 GraphQL endpoint and asks for the adult field explicitly. If Nexus renames or removes it, the query fails validation and search **refuses to return results at all** rather than hand you a list it cannot check. You get an error naming the problem and the one-line fix.
- `nexus_file_preview` follows a CDN URL to get an archive's folder listing. That listing carries no flag of its own — filtering it would be a guaranteed no-op — so the tool checks the *mod* record first and refuses outright if the mod is adult-tagged.

**Where a response carries no flag, the filter cannot judge it, and it passes through.** This is the honest edge, and it is not hypothetical. Some v1 REST endpoints return records that are not mod records and so carry no `contains_adult_content`:

| Tool | Returns | Filtered? |
|---|---|---|
| `nexus_mod_changelogs` | a map of version → changelog text | **no** — strings carry no flag |
| `nexus_updated` | mod IDs and timestamps | **no** — no flag on the record |
| `nexus_mod_files`, `nexus_get_file` | file records | **no** — the flag is on the mod, not the file |

So for an adult-tagged mod, its author-written changelog text can reach you unfiltered and unlabelled. No images, no description, no listing — but text the author wrote, and it will not be marked. Every tool that returns a mod record *is* filtered, and that is most of them.

That is a deliberate choice about which way to fail where the choice exists. Returning unchecked results with a warning attached is still returning them, and the duty Nexus places on third-party tools is to filter, not to caveat. Where a record carries nothing to check, saying so plainly is better than implying a guarantee that the code cannot keep.

*(An earlier version of this page said the filter "covers every Nexus tool — including any added later." That was false twice over. `nexus_search` never asked for the flag, so the filter was a guaranteed no-op on the only tool with real keyword search. And `mw_query_mod_metadata` in the Workbench package reached Nexus through a second client with no filter on it at all. Both are fixed, and both now have tests — including one that asserts the search request itself still contains the field, because a response-level test would have passed throughout the entire period this was broken.)*

If you want it, you turn it on yourself, on your own machine:

```
NEXUS_ALLOW_ADULT_CONTENT=true
```

Two deliberate choices worth stating. It is an **environment variable, not a tool parameter** — which means the AI cannot switch it off no matter what it is asked to do; only the person running ModWrench can. And ModWrench performs no age verification, so the default is the conservative one rather than a guess about who is reading.

## Patch Day: what it opens

`mw_patch_day` ("is it safe to update?") reads more of your game folder than the other local tools, so here is exactly what it touches. It covers Skyrim Special Edition and Anniversary Edition with SKSE, and Fallout 4 with F4SE; the list below is for Skyrim, and [Fallout 4](#fallout-4) follows it.

It opens, read-only:

- the game's executable, SKSE's DLL for that game version and SKSE's loader (`skse64_loader.exe`), to read the version number each file carries. With no `skse64_loader.exe`, the game's launcher, `SkyrimSELauncher.exe`, is read the same way: Steam Deck guides rename the loader to it so that Steam's Play button starts SKSE, and it is taken for the loader when it carries SKSE's version stamp;
- every `.dll` directly inside `Data/SKSE/Plugins` — in the game folder, and, when Mod Organizer 2 is the active manager or you give it an instance, in each enabled mod and the Overwrite folder, wherever the instance's settings put them — reading the file's header (including the build time the linker wrote, which SKSE 2.3.1 checks), its export table, and the 848-byte version block a plugin publishes for SKSE;
- the first four bytes of the Address Library file, which hold its format number;
- Steam's library list (`libraryfolders.vdf`) and the game's `appmanifest_<appid>.acf`, to find the game when you don't pass `gamePath` and to see whether an update is waiting;
- for Mod Organizer 2: `ModOrganizer.ini` in each instance MO2 keeps (on Linux, inside its Wine prefix: it looks in each Steam Proton prefix for MO2's folder, and reads `~/.config/mo2-lint/state.json`, the MO2 Linux installer's list of instances, when there is none), to find this game's instance and where it keeps its profiles, mods and Overwrite folder; then the profile's `modlist.txt` and `plugins.txt`;
- to tell whether Mod Organizer 2 is the active manager: whether Vortex's folder exists, and the folder names in r2modman's (`%APPDATA%\Vortex` and `%APPDATA%\r2modmanPlus-local` on Windows; on Linux Vortex's inside each Wine or Proton prefix or under `~/.config`, and r2modman's under `~/.config` or in its Flatpak folder; on macOS r2modman's under `~/Library/Application Support`). On Linux, finding the prefixes lists the folders in each Steam library's `compatdata`;
- SKSE's own log, `skse64.log`, if it is in the usual place or you pass its path (the first 8 MB at most). On Windows the usual place is `My Games` under your Documents folder, or under the Documents folder inside OneDrive, the same folders [Crash Whisperer](#crash-whisperer-what-it-opens) looks in.

**It never runs any of it.** A DLL is read as bytes: nothing is loaded, executed or called into. It writes nothing, makes no network request, and keeps nothing — no cache, and the result lives in memory until your AI client has it. The repository's read-only scan covers it like the rest of the workbench.

**What goes back to your AI client:** file names and Mod Organizer 2 mod-folder names, the name each plugin declares for itself, game and SKSE version numbers, Steam build numbers and the last-update date, and — if SKSE's log is read — the file name and SKSE's own status text for each plugin it refused, never the name a plugin declares in that log and never a folder. **No folder path is returned**, not even in an error, and a test fails if one appears. If a file can't be opened, because another program holds it or your account can't read it, the answer names the tool and the error code, such as `EBUSY` or `EPERM`, and leaves out the system's error text, which carries the full path. Every workbench tool answers an unexpected error this way. Every name from your files reaches the structured report the way it reaches the text: flattened to one line, with invisible characters removed. That is stricter than `mw_detect_environment`, which does return paths. A list of the plugins you run can still say a lot about what you play, so it is on this page.

The limits, because the awkward parts belong here:

- **The rules are SKSE's own where SKSE has published the source for your game version** ([ianpatt/skse64](https://github.com/ianpatt/skse64)): SKSE 2.0.20 for Skyrim 1.5.97, 2.2.8 for 1.6.x (its plugin checks are the same as 2.2.6's and 2.2.7's), 2.3.0 for 1.7.99 and 2.3.1 for 1.7.104. That includes SKSE 2.3.1's Address Library rule: an Address Library plugin that doesn't declare the format used from 1.7.99 on and was built before 2025-05-26 is refused on 1.7.104 ("must be recompiled for new address library") unless it lists that version. SKSE 2.3.0 doesn't check this, so on 1.7.99 such a plugin is flagged as `inferred`: SKSE loads it, and it then has to read the new format. On 1.5.97 each plugin's own code also decides whether it accepts the game version, which files can't show, and the answer says so. For a game version no published SKSE build was made for, the nearest build's rules are carried forward, every result there is `inferred` (except the refusal of a 32-bit Skyrim LE plugin on 1.6 or later, which stays `skse-source`), and a go needs SKSE's own log from a launch since the patch with nothing refused. Every result is labelled with its `basis`: `skse-source` where the rule is SKSE's, `inferred` where it isn't.
- **SKSE's loader starts only the game version its build was made for.** So for a patch that isn't installed yet, the tool says to put the new SKSE build in after the update, not before; and a loader from another SKSE build than the DLL for your game version, or an SKSE DLL with no loader next to it, is a check, not a go.
- **If Mod Organizer 2 loads plugins for the game but can't be read** — no such profile, a profile file that can't be opened, or a mods folder that isn't where the instance's settings say — the answer says so and is a check, not a go, since the plugins installed through MO2 weren't checked.
- **A plugin that passes SKSE's version check can still crash** if the game code it hooks has changed. That cannot be seen from files.
- **A go is not "safe".** It means every check that can be run from files passed. The verdicts are go, check and wait — the tool never calls a result safe, and a test holds the headlines and per-plugin reasons to that.
- **It was built from SKSE's source, public reports and constructed test folders — not yet run against a real Skyrim install.** If a result is wrong on yours, that is a bug worth reporting, and the log lines it quotes are the evidence.
- **Two games for now:** Skyrim Special Edition and Anniversary Edition, and Fallout 4. Anything else is refused with a message rather than guessed at.

#### Fallout 4

For Fallout 4 it opens the same kinds of file in F4SE's places: `Fallout4.exe`, F4SE's loader (`f4se_loader.exe`, or `Fallout4Launcher.exe` when it carries F4SE's version stamp) and its DLL for the game version (`f4se_1_11_240.dll`, or `f4se_1_11_240_gog.dll` for a GOG copy), every `.dll` directly inside `Data/F4SE/Plugins` in the game folder and in Mod Organizer 2's enabled mods and Overwrite, with the 1,116-byte version block a plugin publishes for F4SE, whether the Address Library file is there (`version-<game version>-0.bin`; its contents aren't read, because Fallout 4's begins with a count, not a format number), Steam's `appmanifest_377160.acf`, and F4SE's own log, `f4se.log`, under `My Games\Fallout4\F4SE`. It also looks for three file names in the game folder, without opening them: `Galaxy64.dll` (a GOG copy), and `appxmanifest.xml` and `EOSSDK-Win64-Shipping.dll` (the Microsoft Store and Epic copies, which F4SE's loader refuses, and the answer says so).

- **The rules are F4SE's own, from its published source ([ianpatt/f4se](https://github.com/ianpatt/f4se)) at each release's tag,** labelled `f4se-source`: 0.6.23 for 1.10.163, which loads every DLL that exports `F4SEPlugin_Query` and `F4SEPlugin_Load` and asks the plugin's own code whether it accepts the game (which files can't show, and the answer says so); 0.7.0 to 0.7.4 for 1.10.980 to 1.11.137, which load only plugins that carry version data and count the 1.10.980 Address Library and game layout as version-independent; and 0.7.5 to 0.7.9 for 1.11.159 to 1.11.240, which count only the 1.11.137 ones, so a plugin that declares only the 1.10.980 ones is held to the game versions it lists. A game version no published F4SE build was made for gets the rules of the nearest build before it, labelled `inferred`.
- **GOG is told by a file, not the way F4SE tells it.** F4SE's loader looks at whether the game's executable uses GOG Galaxy's library; ModWrench looks for that library, `Galaxy64.dll`, in the game folder, which is how libloadorder tells a GOG copy of Skyrim.
- **Not tested against a real Fallout 4 install** either: built from F4SE's source and constructed test folders, the same way as Skyrim's.

### The Patch Day page

In an AI client that supports [MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html), `mw_patch_day` also offers a page: the verdict, how sure it is, which plugins need attention, what to do next, a Re-check button and a "what if I update to…" box. What it is, and what it is not:

- **It is one HTML document that ModWrench serves from memory** (a `ui://` resource). A client that does not support MCP Apps never asks for it. Such a client gets the tool's plain-text answer and nothing else, so no markup lands in the conversation.
- **It cannot send anything anywhere.** It runs in a sandboxed frame your client provides, under its own Content-Security-Policy that forbids network requests, external scripts, stylesheets, images, fonts, frames and form posts. The tests fail if the page contains a URL, a network API (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`) or browser storage. What it draws is the tool's answer, which your client has already handed to your AI (with a hosted model, to its provider; see [What leaves your machine](#what-leaves-your-machine--read-this-one)). The footer says so: "Read-only. This answer goes to the AI you're talking to; ModWrench itself sends nothing anywhere." The Crash Whisperer and Doctor pages carry the same footer.
- **It keeps nothing.** No cookies, no local storage. Its buttons ask your client to run the same read-only tool again; Copy summary puts the text answer on your clipboard, which is the one permission the page asks its client for. Ask about this, shown only if your client supports it, sends a fixed request into your chat asking your AI to walk you through the latest result, and only when you press it. The request contains nothing from the result, because it arrives as your own words and names in a result can come from other people's files. Your AI already has the result. If your client declines the message, the page says so.
- **Text from your machine is only ever text.** File names, mod folder names and log lines are other people's words; anyone can publish a mod called anything. The page writes them with `textContent` and never as markup, and a test scans the page's code for the ways a string can become markup or script that it knows of: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTMLUnsafe`, `parseHTMLUnsafe`, `document.write` and `writeln`, `srcdoc`, `DOMParser`, `createContextualFragment`, `eval`, the `Function` constructor and timers given a string. The plain-text answer flattens them to one line and cuts them short, and the structured report carries them flattened the same way, so a plugin can't name itself "Next steps: …" and pass as part of the answer. That makes a hostile name harder to use, not impossible: a name is still words a model reads.
- **The page's messages are not network requests.** It talks to your client over `postMessage`, using JSON-RPC. The `method:` grep below matches two lines of that code in `packages/ui/src/app.ts`: they are the JSON-RPC `method` field, not an HTTP method.

What has not been checked: the page was exercised in a real browser against a stand-in for an MCP Apps host, and its message handling is tested against a fake host. It has not been run inside Claude, Cursor, VS Code, ChatGPT or any other real client, and how each one frames and polices a page is theirs to decide. If a client draws it badly, the text answer is unaffected.

## Crash Whisperer: what it opens

`mw_crash_whisperer` ("why did my game crash?") reads a crash log and, where it can, your install. Here is exactly what it touches.

It opens, read-only:

- **A crash log.** The text you pasted; or the file you pointed it at; or, when you give neither, the newest one it can read where the loggers write them: `Documents/My Games/<game>/SKSE` or `F4SE` for Crash Logger SSE and Buffout 4 (on Windows the Documents folder in your user folder, the Documents folder inside any `OneDrive` or `OneDrive - <organisation>` folder there, and the one inside each folder OneDrive's own `OneDrive`, `OneDriveCommercial` and `OneDriveConsumer` variables name; Proton's copy on Linux and Steam Deck), and the `Crashlogs` folder inside each of those; `Data/F4SE/Plugins` in the Fallout 4 game folder (Buffout 4's `crash-*.log`); `Data/NetScriptFramework/Crash` in the game folder (NetScriptFramework's `Crash_<date>.txt`); and `BepInEx/LogOutput.log` in the game folder or in an r2modman profile (the first 40 profile folders in the order the folder lists them, not the newest). To find each game's folder it reads Steam's library list and the `appmanifest` of every game it knows (only the named game's when you name one). In each folder it keeps the 400 newest matching files by date, and for each game the 40 newest of those. A newer log that can't be opened or read as one of the four formats is passed over for the next, and the answer says how many it passed over. A Documents folder Windows moved somewhere other than OneDrive isn't found: give `logPath`. A log over 12 MB is read at its first 3 MB and its last 9 MB, in the same text encoding at both ends and each cut at a whole line; the part in between is never read, and the answer says how much was.
- **Your other recent crash logs**, when the log is a Crash Logger SSE or Buffout 4 one of a game ModWrench knows: other files named `crash-*` of 4 MB or less from those same places, up to five by default (`compareRecent`; ten at most; 0 turns it off), each read in memory to see whether the same names keep coming up. A name counts as recurring when it was a possible or strong lead in the other log. NetScriptFramework and BepInEx logs are not compared. What comes out of them is a count and which names recurred.
- **Your install, for Skyrim Special Edition** (`checkInstall`, on by default): the same reading [Patch Day](#patch-day-what-it-opens) does, all of it. The game's executable, SKSE's DLL and SKSE's loader for their version numbers; each plugin DLL in `Data/SKSE/Plugins` (the game folder, each enabled Mod Organizer 2 mod and the Overwrite folder, wherever the instance's settings put them); the Address Library file's first four bytes; Steam's library list and the game's `appmanifest`; Mod Organizer 2's `ModOrganizer.ini` and the profile's `modlist.txt` and `plugins.txt`; and SKSE's own log, `skse64.log`, when there is one (the first 8 MB at most). That is how it can say that a plugin the log names is no longer installed, where it came from, or that SKSE's own rule refuses it on your game version. None of those files is returned: what comes out is file names, mod folder names and version numbers.

**It never runs any of it.** A DLL is read as bytes: nothing is loaded or executed. It writes nothing, makes no network request, and keeps nothing; the result lives in memory until your AI client has it. The repository's read-only scan covers it like the rest of the workbench, and a test checks that reading a log, the install and the other recent logs creates, changes and deletes nothing.

**What it recognises comes out first.** Before anything else reads the log, a copy of its text is cleaned. It recognises, and replaces:

- the account and computer name your operating system reports, and the name on a labelled line: a computer, host, PC or machine name, or a user, account, login or profile name, given after `:` or `=` (`Computer Name: …`, `USERNAME=…`), and the name after `USER=`, `LOGNAME=` or `logged in as` (one word, or the whole of your account's name when it has several). Those names also go wherever else the log has them, whatever the capitalisation and in their joined, abbreviated and composed forms (`jane-doe`, `JaneDoe`, `jane_q_doe`, `J.Doe`, `Doe, Jane`, an accented letter written either way, a Windows short name like `JANEDO~1`, `DOMAIN\jane`). Windows' own default computer names (`DESKTOP-4F9K2LQ`) go too;
- folder paths, in the forms logs use: Windows drive and network-share paths (WebDAV shares like `\\server@SSL\DavWWWRoot` included), `smb://` and other share addresses, `file:` addresses, `\\?\` and `\Device\` paths, Linux, Steam Deck, Proton, WSL, Cygwin and macOS home folders, `~`, `$HOME`, `%USERPROFILE%`, `%HOMEDRIVE%%HOMEPATH%` and the other Windows folder variables (`%APPDATA%`, `%LOCALAPPDATA%`, `%TEMP%` and so on), and paths with their separators percent-encoded. The folders go and the file name stays; a path that doesn't end in a file name loses the rest of its line;
- network addresses: an IPv4 address with a port, in a private range or with a prefix length (`/24`); otherwise one with an address word such as `server`, `host`, `peer` or `IP` just before it, or one whose first number is 11 or more and whose last isn't 0, unless a version word is just before it (`v`, `ver`, `version`, `rev`, `revision`, `build`, `release`) or `version`, `build` or `release` just after it. Loopback addresses (`127.0.0.1`) are nobody's and stay. Also IPv6 in its ordinary spellings, hardware addresses written with `:` or `-`, and the names a private network (`.local`, `.lan`, `.internal`, `home.arpa`) or a dynamic-DNS service gives a machine;
- email addresses, also percent-encoded (`jane%40example.com`) or spelled out (`jane [at] example [dot] com`), and git addresses (`git@host:owner/repo`). A spelled-out address has to end in letters, as a real domain does, so a processor's `CPU @ 4.10GHz`, which the help posts write `CPU (at) 4.10GHz`, is not taken for one. A file name with an `@` and a file ending straight after it (`icon@2x.png`, `Preloader@ver2.dll`) is a file name and stays;
- keys, tokens and passwords: the shapes the common services use (GitHub, Discord and Slack webhooks, Google, AWS, npm, Thunderstore and so on), the value after a label that says what it is (`STEAM_TOKEN`, `db_password`, `NexusApiKey`), in headers, cookies, web addresses, command lines, config files and markup, and whole private-key blocks, even with a line from another program in the middle when the block's END line is within 400 lines of its start. That line is kept only if it can't pass for part of the key, and many log lines can (`[Info   : MoreCompany] Loaded 12 cosmetics`, `[Info   :   BepInEx] Loading [Some Mod 1.0.0]`): those go with the key, even when one is a line a helper would want;
- account IDs: Steam's three spellings of an account, Windows account SIDs, Discord user IDs, and a value with a digit in it after a label that says it is an ID, a serial number or a product key (after `:` or `=`, a value of six characters or more, as in `account id: 52079950`; after a label and only a space, eight or more, as in `steam id 52079950`).

Characters that print nothing (control and format characters, and the blank fillers and marks ModWrench knows of) are dropped, so one can't be slipped inside a word to hide it. Each recognised thing becomes a plain label (`REDACTED-USER`, `REDACTED-PATH` and so on), and the answer says how many of each, never what they were. The log and your other recent crash logs share one 20-second allowance for cleaning in each call: if it runs out, the lines of the log it hadn't reached are dropped, never passed along unchecked, the other logs not yet compared are left unread, and the answer says so. The ranking, the checks, the text answer and the help posts are all built from the cleaned copy, and each help post is checked again, whole, at the end.

How that has been checked: a test plants a made-up person's name, computer, folders, addresses and keys into logs of all four formats and fails if any of it turns up in anything the tool returns. More tests put the same plants in 31 places across the four formats where a log's own words reach the answer (the logger's version line, the hardware lines, function names on the call stack, an exception's message, a plugin's name, an object's name or plugin, a DLL's name, a game file or Papyrus script named on the stack, a register's type, Unity's version and so on) and look for them in the 15 strings a call hands back: the structured report, read value by value and as written; the text answer; and each help post, its title, and the text answer with that post. Other tests run several hundred more spellings through the cleaning rules. The cleaning and the log reading were also checked by breaking their rules on purpose and confirming a test fails. **It is pattern matching, not a guarantee.** A different person trying hard will find a form it misses.

What that does not cover, because the awkward parts belong here. Where a test can pin an item, one does: it fails if the thing starts being covered, so this list can't go stale quietly.

- **A name it can't know is yours.** It removes your account and computer name and anything shaped like a path, address, email or key. It cannot know that a mod called "Jane's Followers" is personal, or that a plugin's name says something about you. Names are kept as written, because a helper needs them. In the help posts a name's square brackets are shown as round ones, its angle brackets and backticks as look-alikes (‹ › and '), an `@` as `(at)`, and a run of spaces as one space, so that no name can turn into markup, a code block or a ping; the last line of each post but the short Discord one says so. The help posts are shown whole so you can read them before you post.
- **Parts of your name.** When your account name has several words, the whole name and its joined forms go, but a first or last name on its own is removed only inside a path or on a labelled line. A name under three characters (under two for a name written only in Chinese, Japanese, Korean or Thai characters), or one made only of digits and under eight of them, is removed only inside a path or on a labelled line. An account named for a common word (`Admin`, `Steam`, `Games`) is removed only inside a path, because replacing those everywhere would damage the log. The labelled lines are the ones listed above; other labels, even ones about an account (`login:`, `Account:`), are not read, so a short name after them stays. A name a labelled line gives is looked for in the rest of the log only if it is 64 characters or shorter and among the first 16 such names, and only when it is all that follows the label on its line (up to a `,`, `;` or `|`): with more after it (`User Name: Jane Doe (Administrator)`, or a second label such as `Computer Name: …` after it), it is removed on that line only. A name inside a longer word (a file called `JaneArmor.esp` or `JaneDoeArmor.esp`) is left alone and counted, in any of the spellings above, and the answer says so, so you can look.
- **Secrets it can't tell are secrets.** A key with no label and no shape ModWrench knows is caught only if it is long (about 80 characters or more), mixed-case and has a digit in it; a long run of letters alone is left, and so is a long name made of words. Written as a plain `label: value` line, the words `pass`, `key`, `pin`, `cred`, `otp`, `sig`, `signature`, `licence`, `sas` and `webhook` are not treated as saying "secret", because they are also ordinary words in logs. (`key`, `pass`, `otp`, `sig` and `signature` are still removed in a web address's query string, and `pass` after a command-line flag. `key` followed by a space and then a long hex value or a token with a digit in it, as in `key 0123…` or `key = 0123…`, is removed too; written `key: 0123…` or `key=0123…`, the value stays, because logs write settings and Unity's asset keys that way, unless `?`, `&` or `;` is just before `key=`, as in a query string.) A password with spaces in it and no quotes loses only its first word (a quoted one goes whole), a secret on the line after its label stays, and so does the value after a one-letter flag such as `-p`. A private-key block whose END line is not within 400 lines of its start (a key the log cut off) ends at the first line that isn't part of a key, so key lines after a line from another program stay unless they are long enough to be caught on their own. A Thunderstore token is caught by its shape (`tss_` and 36 letters and digits, the way Thunderstore's own code makes one). Nexus Mods publishes no format for its API keys, so one is caught by its label, or as a long mixed-case token with a digit in it, not by how it looks.
- **Paths it doesn't recognise.** A Linux or macOS path written directly against a letter, digit, underscore, dot, tilde, dollar sign or hyphen (`foo/home/jane/mods/x.dll`) isn't read as a path, and nor is a rooted one whose first folder isn't one it knows (`/data/jane/mods/x.dll`, `/tmp/jane/y.dll`). Your account name inside them is still removed, but the other folders in them stay. Relative paths (`../Mods/x.dll`), drive-relative ones (`D:Mods\x.dll`) and a path a log wrapped across two lines are left as they are.
- **Addresses and IDs in other spellings.** An address written as one decimal, hexadecimal or octal number, a hardware address with no separators, a phone number, and the public name of a server a mod connected to (`play.example-game.com`) are kept. So is a dotted IPv4 address with no port, outside the private ranges and with no address word just before it, when its first number is under 11 or its last is 0 (`no answer from relay at 5.45.12.7`, `seen at 93.184.216.0`). A public one without a port is also kept just after a version word (`server version 203.0.113.45`, `rev 203.0.113.45`) or just before `build`, `version` or `release` (`203.0.113.45 build`). Both rules are there because that is how version numbers look in real logs (`BepInEx 5.4.21.0`, `Loading [Better Item Scan 3.0.0.2]`). An ID after a label and only a space stays when it is under eight characters (`steam id 1234567`), because logs print a game's own Steam number that way (`steamid 892970`), and one after a label and `:` or `=` when it is under six (`account id: 12345`).
- **Long lines and big files.** A line over 6,000 characters is cut before it is checked (the cut is counted and said). The cut falls at a space near the 6,000th character, or else just before the address or word it would split, so a line that is one long word is dropped whole. A log over 12 MB is read at its start and its end only.
- **The log file itself.** Nothing is done to the file: it stays on your disk exactly as the game wrote it, with everything in it. To share a crash, post a help post; don't attach the file.
- **Hardware.** The help posts and the structured report include the hardware lines the log's own system specs carry (operating system, processor, graphics card, memory), because the first thing a helper asks for is those. The crash time is in them too. That is information about your machine, in a post you choose to make.
- **What else the log names.** The help posts also carry what the log names besides the call stack: the objects it lists or prints beside the registers and stack, with their in-game names and the plugins that changed them; the game files and Papyrus functions named in the registers and stack; the object types in the registers; a NetScriptFramework log's DLL list with the address each was loaded at (without the Windows libraries ModWrench knows); and BepInEx's, Unity's and each BepInEx plugin's version. Your own character is marked as the player and never named. A name you gave something in the game yourself, such as a renamed follower or an enchanted item, shows as written, like a mod's name. Leaving your plugin lists out of the posts takes the DLL list and each plugin's version with them, but not the objects, game files, object types and Papyrus functions, nor the plugins that changed those objects.

**What goes back to your AI client.** A short plain-text answer: what happened, what the log shows the game was working with (up to five of the objects it names, with their in-game names and the plugins that changed them, and the game files, object types and Papyrus functions it names), the names the log points at with their reasons, setup checks, next steps, what it can't tell you, and, when you ask for one, a help post. Not the log itself, and no folder path, not even in an error (a test fails if one appears). The structured report behind the page goes only to a client that says it can draw pages, and only while the page is on (not with `MODWRENCH_UI=off`), or when you set `MODWRENCH_STRUCTURED=always`. Both are built from the cleaned copy.

**A log you paste into the chat has already gone.** Whatever you type into your AI client reaches its provider before ModWrench can touch it, so the cleaning can't help with that copy. Leave the log out and let `mw_crash_whisperer` (or `/mw-crash` with nothing after it) read the file: then what ModWrench recognises is gone before the AI sees anything. The slash command says this when you paste. A file path you type after `/mw-crash` reaches the AI as you typed it, as does anything you say in the chat.

**What each statement rests on.** Every statement in the answer is labelled `log` (the log itself says it), `install` (your files say it), `rule` (a published rule, such as SKSE's own compatibility check) or `guess` (ModWrench's own inference, a name match for example), and the answer counts how many rest on each. Names the log points at are **leads**, scored strong, possible or faint by ModWrench's own rules. A lead is not a finding. An object the logger lists counts for less when the logger only printed it beside a register (Crash Logger SSE before v1.20, Buffout 4, and NetScriptFramework, whose list is every object it found in the registers and stack) or found it in stack memory, and the player's own character counts for little, because it is in use the whole time you play. When the game stopped inside a library other mods call (RaceMenu's skee64.dll, JContainers, PapyrusUtil), the answer says not to remove it, and ranks the first other mod code under it on the call stack, or, when there is none, a plugin that a Papyrus script in the log is named like (labelled a guess), as the mod that may have called it. A test holds the answer to never calling anything safe, guilty or certain.

The limits:

- **It was built from the crash loggers' published source and checked against real logs that people published: Crash Logger SSE (v1.11.1 and v1.20.1), Buffout 4 (v1.26.2 and v1.36.0), NetScriptFramework and BepInEx 5.4.21, cut down and with personal details replaced. It has not been run against a real install.** If a result is wrong on yours, that is a bug worth reporting, and the log lines it quotes are the evidence.
- **Where Buffout 4 writes its logs has been checked only in part**, so both likely places are read. NetScriptFramework writes to `Data/NetScriptFramework/Crash` unless its config moves it (checked in its source). A log kept somewhere else needs `logPath`.
- **On a Skyrim version no published SKSE build was made for** (anything but 1.5.97, 1.6.x, 1.7.99 and 1.7.104), the install check is a prediction, as in [Patch Day](#patch-day-what-it-opens).
- **The setup checks cover Skyrim Special Edition and BepInEx load problems.** For other games the log is read and nothing is checked against your files. It does not yet check for missing masters, a second crash logger running beside the first, a crash logger too old for your game, or a list of known conflicts.
- **A few DLLs are named by what they are.** A short table, each entry taken from the mod's own source or a public page and named in the code, says which mod a well-known DLL comes with (RaceMenu, JContainers, PapyrusUtil, OBody, PureDark's upscaler) and what a few DLLs that aren't mods are (Mod Organizer 2's usvfs, and NVIDIA FleX, for which it suggests turning Fallout 4's Weapon Debris off). Any other DLL is named by its file only.
- **A BepInEx log is a session log.** Its last error is not called a crash: the answer says whether it was an exception and, when BepInEx wrote entries after it, how many, which means the game went on past it. BepInEx writes no line of its own when the game closes and writes its file out every couple of seconds, so a hard crash can lose its last entries.
- **A crash log names what was running when the game stopped, not always what caused it.** A lead can be wrong, and will be.

### The Crash Whisperer page

`mw_crash_whisperer` offers a page in clients that support MCP Apps, built the same way as [the Patch Day page](#the-patch-day-page) and held to the same tests: one HTML document served from memory that a client fetches only if it can draw it; a Content-Security-Policy that forbids every network request; no storage; every name from your machine written as text and never as markup. What it adds:

- **Copy** buttons put a help post on your clipboard, the one permission the page asks its client for. The page cannot post anywhere.
- **A box to paste a log into.** What you paste goes to ModWrench through your client, and ModWrench takes out what it recognises before reading it. Whether your client also shows a tool call to its model is up to the client. It takes up to 4,000,000 characters, as much as the tool accepts. A longer log isn't sent: the page says so and points you at reading the newest log from disk instead.
- **Two check boxes**: compare with your other recent crashes or not (shown only for Crash Logger SSE and Buffout 4 logs of a game ModWrench knows, the only ones the comparison reads), and leave your plugin lists out of the help posts or not (the leads, the call stack, and the objects, game files and Papyrus functions the log names, with the plugins that changed those objects, stay in). They ask your client to run the same read-only tool again.
- **Ask about this**, shown only if your client supports it, sends a fixed request into your chat asking your AI to walk you through the latest result, with nothing from the result in it, and only when you press it. If your client declines the message, the page says so.

It has been exercised in a real browser against a stand-in for an MCP Apps host. It has not been run inside Claude, Cursor, VS Code, ChatGPT or any other real client.

## The Doctors: what they open

`mw_doctor` ("is my setup ready?") is a health check for the boring causes behind many "my mods keep breaking" threads. It has two halves: the **Setup Doctor** (where the game and Mod Organizer 2 live, the plugin list, MO2's Overwrite folder, crash loggers) and the **Deck Doctor** (Steam, Proton and `nxm://` links on Linux and the Steam Deck). It reads more of your install than most local tools, so here is exactly what it touches.

It opens, read-only:

*Both halves*

- **Steam's own files, to find the game:** the Steam folder (on Linux `~/.local/share/Steam`, `~/.steam/steam` and the Flatpak build's folder under `~/.var/app/com.valvesoftware.Steam`, or `STEAM_ROOT` when you set it; on Windows `Steam` under `C:\Program Files (x86)` or `C:\Program Files`; on macOS the usual one), its library list (`libraryfolders.vdf`) and the game's `appmanifest_<appid>.acf`. A Steam installed anywhere else is found only through `STEAM_ROOT`, and when no Steam is found the answer says so. Or the folder you pass as `gamePath`: for Skyrim Special Edition that folder has to hold `SkyrimSE.exe`, the same check Patch Day makes. A folder without it, such as the game's `Data` folder or the library folder above it, is reported as not the game's folder, and nothing in it is read as the game. For the other games any existing folder is taken as given.
- **On Linux, `/etc/os-release`,** to tell whether this is a Steam Deck.

*The Setup Doctor*

- **The names in the game's `Data` folder** and at the top of each enabled Mod Organizer 2 mod's folder, to find plugin files (`.esp`, `.esm`, `.esl`), the names of the DLLs in `SKSE/Plugins` (or `F4SE/Plugins` for Fallout 4), and whether `DLLPlugins/NetScriptFramework.Runtime.dll` is there. The DLLs themselves are not opened.
- **The front of each plugin the game would load:** the first 4,096 bytes of the file, or a little more when its header says it is longer (never past about 1 MB), to read three things from the plugin's header: whether it is flagged as a master, whether it is flagged light, and the list of masters it names. The rest of the file is never read.
- **The plugin lists:** the game's own `plugins.txt` (under `%LOCALAPPDATA%` on Windows, in the game's Proton prefix on Linux), in the folder for the edition installed, picked the way libloadorder picks it: `Skyrim Special Edition GOG`, `... EPIC` or `... MS` when the game folder holds `Galaxy64.dll`, `EOSSDK-Win64-Shipping.dll` or `appxmanifest.xml`, and `Skyrim Special Edition` otherwise; for Fallout 4, `Fallout4 MS` or `Fallout4 EPIC` for those copies and `Fallout4` otherwise, GOG included. It also reads `Skyrim.ccc` (or `Fallout4.ccc`) in the game folder, which names the Creation Club plugins, and, for Mod Organizer 2, the profile's `plugins.txt` and `modlist.txt`. A `plugins.txt` is read as UTF-8 when it is valid UTF-8 and otherwise as Windows-1252, the encoding the game writes it in and libloadorder reads it as; the master names in a plugin's header are read as Windows-1252, as esplugin reads them. A name with ’, –, € or ™ in it therefore matches its file.
- **Mod Organizer 2's settings:** `ModOrganizer.ini` in each instance MO2 keeps (on Linux, inside its Wine prefix, or the instances `~/.config/mo2-lint/state.json` lists when there is none), to find the one for this game and where it keeps its mods and Overwrite folders; or the instance you pass as `mo2InstancePath`. Without Mod Organizer 2, none of this is read, though to tell whether MO2 is the active manager it always looks at Vortex's and r2modman's folders, as [Patch Day](#patch-day-what-it-opens) does. When Mod Organizer 2 wasn't read and the plugin checks ran, a line in the answer says they looked at the game's own `plugins.txt` and `Data` folder instead, and why MO2 wasn't read. An instance or profile you named that couldn't be used is also a warning, and so is an instance it found whose profile couldn't be opened.
- **The Overwrite folder:** every folder and file name in it and each file's size, down 16 levels and to 20,000 entries at most. No file in it is opened.
- **Vortex's deployment record,** on Windows, for Skyrim Special Edition and Fallout 4: the first 64 KB of `Data\vortex.deployment.json`, which Vortex writes while it has mods deployed, for three fields, the game, the deployment method and where Vortex's staging folder is. The list of deployed files after them is never read. The staging folder it names is then checked like Mod Organizer 2's folders: which drive it is on, compared with the game's `Data` folder for the hard-link rule, whether its path is under Program Files, OneDrive or one of your user folders, and how much room its drive has. Nothing in it is listed or opened, and one on another computer isn't opened at all. A method name in the record that doesn't look like one of Vortex's is not repeated in the answer.
- **The game's executable,** read as bytes the way Patch Day does, for its version number.
- **Room and place:** how much space is free on the drive that holds the game and the one that holds MO2's mods, and which drive each is on. On Windows it also reads the *text* of those folders' paths, to see whether they sit under Program Files, OneDrive or one of your user folders, and lists the names in your user folder to find a OneDrive folder, then checks whether a `My Games` folder for the game is under your Documents or the one in OneDrive. No Windows setting or registry key is read.

*The Deck Doctor (on Linux and the Steam Deck. On any other system it doesn't run, and if you ask for it alone it says so in one line, after the same Steam lookup both halves start with)*

- **The game's Proton prefix:** whether `compatdata/<appid>/pfx` is there, when its `pfx.lock` was last touched, and, for BepInEx games, its `user.reg` registry file (up to 16 MB), of which only the one `winhttp` line under `DllOverrides` is looked at.
- **The game's Steam launch options, for BepInEx games.** Steam keeps them in `userdata/<Steam ID>/config/localconfig.vdf`, one for each Steam account that has signed in on this computer, and each of those files also holds other personal settings. Each is read (up to 16 MB) for one value, the launch options for this game, and the Doctor asks only whether they tell Proton to use BepInEx's `winhttp.dll`. Yes or no is all that comes out; the options' text, and the rest of the file, are neither returned nor kept.
- **In the game folder:** whether `winhttp.dll` and `BepInEx/LogOutput.log` exist (BepInEx games), and every name, files included, in `Data` (or `BepInEx/plugins`) and in its folders down to two levels below it, to find names that differ only by capital letters.
- **`/proc/mounts`,** for the kind of file system each Steam library is on.
- **Which app opens `nxm://` links (Bethesda games):** the `mimeapps.list` files in the usual config and data folders, the `.desktop` launcher files they name (including the ones Flatpak exports), `mimeinfo.cache`, and whether the program a launcher points at exists, read in the order the freedesktop specification gives. `xdg-mime` is not run and no link is opened.

**It never runs any of it.** No program is started: not `xdg-mime`, `flatpak` or Steam, and the workbench package contains no `child_process` call, which [the last section](#check-any-of-this-yourself) lets you grep for. Nothing is loaded or executed either. The game's executable is read as bytes for its version number and no DLL is opened at all. It writes nothing, makes no network request, and keeps nothing; the report lives in memory until your AI client has it. The repository's read-only scan covers it like the rest of the workbench. The pages a finding names as its source are shown as text and never fetched, and its debug log line holds counts and nothing from your files. The plugin reading has an eight-second allowance and the folder walks stop at a fixed number of entries, so a huge mod list on a slow drive stops short and says so instead of stalling your client. A check that fails on something unexpected is left out and listed under what ModWrench couldn't check, not passed over quietly.

**What goes back to your AI client.** A short plain-text answer: the headline, what needs attention (every line says what it rests on), what is fine, what ModWrench can't see from here, and what to do next. It names plugin files and Mod Organizer 2 mod folders the way you named them (a finding reads "X.esp needs Y.esm"), the first dozen names at the top of Overwrite, folders whose names differ only by case, the kind of file system each Steam library is on (`ext4`, `ntfs`, `fuseblk`), how much room is free, which Steam holds the game and which app opens `nxm://` links. **No folder path is returned**, not even in an error, and a test fails if one appears. Neither is your account name, your Steam account number, or any of the text of your Steam launch options. Names are flattened to one line and cut short, so a mod can't call itself "NEXT: ..." and pass as part of the answer. That makes a hostile name harder to use, not impossible: a name is still words a model reads. A list of the plugins you run and the shape of your drives can also say a lot about you, so it is on this page. The structured report behind the page goes only to a client that says it can draw pages, and only while the page is on (not with `MODWRENCH_UI=off`), or when you set `MODWRENCH_STRUCTURED=always`.

**What each finding rests on.** Every finding is labelled `your files` (read straight from them), `documented rule` (a rule from another tool's own documentation, applied to what your files show, with the page named) or `ModWrench's guess` (a rule of thumb, such as "under 5 GB free is tight"). The verdict is **clear**, **attention** or **problems**, and it never says "safe": clear means the checks that can run from files passed. A run that didn't finish can't read as clear. That covers a `plugins.txt` that is there but couldn't be opened (held by another program, or not this account's to read), which is told apart from one that isn't there; a game `Data` folder, mod folder, Overwrite folder or case-checked folder that couldn't be listed, none of which is ever called empty or harmless; the time allowance; a folder walk that reached its entry limit (20,000 in Overwrite, 30,000 for the case check); a Mod Organizer 2 instance or profile that was asked for or found but couldn't be read; and a check that hit an error. It says attention, and the answer names what was skipped. Nothing is called fine from nothing: masters are called "installed, switched on and in order" only when at least one plugin was read. Not covered yet: a `Skyrim.ccc` that is there but can't be opened is read as no Creation Club list, and the Deck Doctor reads a `user.reg`, `localconfig.vdf` or link-handler file it can't open as one that isn't there.

The limits, because the awkward parts belong here:

- **It was built from public documentation and constructed test installs. It has not been run against a real install.** The rules come from the pages each finding names, such as DynDOLOD's plugin-limit page, LOOT's documentation, Wabbajack's and STEP's guides, Mod Organizer 2's wiki, r2modman's wiki, BepInEx's troubleshooting page, Valve's Proton wiki and the crash loggers' Nexus pages. A plugin's header is read the way UESP's file-format page and the esplugin library describe it. Those pages were read and summarised by AI models that helped build ModWrench, not checked by someone against a running setup, so a rule can be stated more strongly or more weakly than its page does. Each finding names its page so you can check it. If a finding is wrong on your install, that is a bug worth reporting.
- **Where its sources disagree, it says "likely".** For a master that is missing, switched off or loaded late, LOOT's documentation says the game crashes on launch and the Modding Wiki says during play, so the answer says "likely to crash" and not when.
- **"Loaded late" is judged on the order the game loads, as libloadorder works it out.** A `.esm` or `.esl` counts as a master with or without the master flag, and masters load before other plugins. A plugin a master needs is loaded just before that master, so it isn't late even if it is listed after the master that needs it. A plugin is reported only when its master still loads after it. A `.esp` whose header couldn't be read isn't judged.
- **A few facts don't come from documentation, and the findings say so.** Crash Logger SSE is recognised as `CrashLogger.dll`, a name taken from its build files, and Trainwreck as `trainwreck.dll`, from its author's API header, both in `SKSE/Plugins`. Neither logger's documentation gives the name, though both names show up in crash logs players have posted. A logger that ships under another name isn't seen, and the "no crash logger" note says that. For FAT32 there is an answer from Valve: a Valve staff member wrote on Proton's issue tracker that Proton won't support FAT32, because it can't hold symlinks and caps a file at 4 GB, so that finding is a documented rule with the comment as its source. No Valve page says the same of exFAT, which can't hold symlinks either; that exFAT won't work is ModWrench's own inference, and the finding is labelled a guess. "Two crash loggers fight" is a documented rule for Crash Logger SSE (its page says only one can be active, NetScriptFramework included) and a guess for any other pair.
- **A file the game loads without listing it could be misread.** ModWrench knows the base game's five plugin files and the Creation Club files `Skyrim.ccc` names. Any other file the game loads on its own would look like a plugin that is installed but switched off, so a plugin that names it as a master would be reported as having a master that is switched off. `_ResourcePack.esl` is not one: `Skyrim.ccc` names it (Wrye Bash's built-in copy of that list does, and so does one a Mod Organizer 2 user posted), though that has not been checked against a real game folder.
- **The plugin checks cover Skyrim Special Edition and Anniversary Edition, and Fallout 4.** Fallout 4's base plugins and limits are the ones libloadorder (the library LOOT uses) gives it, and its limit finding names libloadorder's source, since the plugin-limit page the Skyrim finding names covers only the Skyrims. Its crash loggers are Buffout 4 and Buffout 4 NG (`Buffout4.dll`), Buffout 4 AE, also called MiniBuff (`Buffout4AE.dll` or `MiniBuffAE.dll`), and Addictol's crash logger (`AddictolCrashLogger.dll`); two findings rest on those mods' own pages: Buffout 4 NG's says it doesn't support the Anniversary Edition (1.11 and later), and Addictol's lists the Buffout 4 builds among the mods that shouldn't run alongside it (Addictol's own code stops with an error when it finds one). For other games the Doctors check where things live, free space and, on Linux, the Deck side, and the report lists what it didn't do.
- **It reads Mod Organizer 2's folders on disk, not what MO2 shows the game.** That view exists only while MO2 runs.
- **What files can't show:** antivirus and Smart App Control, the pagefile, Vortex's staging folder while Vortex has nothing deployed (Vortex's own database isn't read), what `nxm://` does on Windows, anything a mod manager sets only in the environment of the game it starts, r2modman's Native or Proton setting, games outside Steam's libraries (unless you pass `gamePath`), and Flatpak's permission overrides. The report lists the ones that apply under "not checked from here" every time.
- **`nxm://` follows the freedesktop files** the way the specification orders them. A browser can keep its own choice of app for a link type, which those files don't show.
- **The place check reads a path's text.** A link that points somewhere else isn't followed.
- **The counts can be a floor.** If time runs out, a folder can't be listed, or a plugin's header can't be opened or read to its end, the plugin-limit finding says it wasn't fully checked, says why, and gives what it did count, rather than "within the limits".
- **It has only been run on Linux so far.** Its Windows behaviour is tested by giving the code Windows-style paths as text, which tests its rules, not that Windows hands it what it expects.

### The Doctor page

`mw_doctor` offers a page in clients that support MCP Apps, built the same way as [the Patch Day page](#the-patch-day-page) and held to the same tests: one HTML document served from memory that a client fetches only if it can draw it; a Content-Security-Policy that forbids every network request; no storage; every name from your machine written as text and never as markup. What it adds:

- **The verdict and the findings, worst first,** each with what it rests on and its source named as text. The checks that came out fine are folded away.
- **Re-check** asks your client to run the same read-only tool again. On Linux a **Look at** box chooses everything, setup only or the Deck side only.
- **Copy summary** puts the plain-text answer on your clipboard, the one permission the page asks its client for.
- **Ask about this**, shown only if your client supports it, sends a fixed request into your chat asking your AI to walk you through the latest result, with nothing from the result in it, and only when you press it. If your client declines the message, the page says so.
- **What it can't see,** **how to read the labels** and **where it looked** (counts, kinds and the name of the Mod Organizer 2 profile, never folders) are one click down.

It has been exercised in a real browser against a stand-in for an MCP Apps host, including hostile plugin and mod names. It has not been run inside Claude, Cursor, VS Code, ChatGPT or any other real client.

## The other pages

Five more pages replace the MCP-UI panels that fourteen tools used to put in every answer, whether or not the client could draw them. In a client that supports MCP Apps each of these tools points at a page; every other client gets the tool's text answer, unchanged, and no HTML. They are built like [the Patch Day page](#the-patch-day-page) and held to the same tests: one HTML document that ModWrench serves from memory and a client fetches only if it can draw it, a Content-Security-Policy that forbids every network request, no storage, and everything from a result written with `textContent`, never as markup. They wear the four game skins, and the skin swatches change only how the page looks. None of them asks your client for a permission (none has a Copy button). Their footer says: "Read-only. This answer goes to the AI you're talking to; this page makes no network request and keeps nothing." The data a page draws goes to it as structured data only for a client that says it can draw pages, and only while pages are on (not with `MODWRENCH_UI=off`), or when you set `MODWRENCH_STRUCTURED=always`. `@modwrench/remote` keeps a session per client, so it decides the same way (see [above](#there-is-no-modwrench-service)). With `MODWRENCH_STRUCTURED=never` no tool points at a page at all.

### The Mods page

`nexus_trending`, `modio_list_mods`, `modio_search_mods`, `thunderstore_list_mods`, `thunderstore_search_mods`, `thunderstore_top_mods` and `mw_query_mod_metadata` point at one page, `ui://modwrench/mods`, in clients that support MCP Apps. Other clients get the same text answer as before and no HTML. The page meets the same tests as the Patch Day page. Its own Content-Security-Policy forbids every network request, it stores nothing, and it asks your client for no permission. Every name, author, summary and address from Nexus Mods, mod.io or Thunderstore goes on the page as text, never as markup.

Every row shows the mod's author, platform and page address as text, whatever the address is. **Open** appears only when your client says it can open links, and only for an `https` address on nexusmods.com, mod.io or thunderstore.io (or a name under one of them) with no port but the default. The page itself makes this check, and that check is where it names those three sites. Pressing Open asks your client to open exactly that address (`ui/open-link`). Your client decides, and may ask you first. Any other address, such as one from a Thunderstore mirror set with `THUNDERSTORE_BASE_URL`, is shown as text only. This has been checked in a stand-in host, not yet in a real client.

### Dependencies and load order

`ui://modwrench/deps`, for `thunderstore_mod_dependencies`, `thunderstore_resolve_dependencies` and `mw_read_load_order`. Read-only, with no buttons except the skin swatches: it never asks your client to call a tool, send a message or open a link. Names come from Thunderstore or from your mod manager's files and go on the page as text only. The page gets each load-order entry's name, place, enable state, version, source platform, plugin file and author, and never the folder the list was read from (the chat answer still includes it, as before). When a Mod Organizer 2 profile lists no plugins, the page gets the profile's mod folders instead (each folder's name, place and whether it is on) and says that is what they are. When no entry's enable state is known, as with Vortex, the page says so rather than counting none as enabled. When a list was cut to 200 entries, or a dependency walk couldn't resolve every reference or stopped at its depth or size limit, the page says so.

### The Crash log page

In a client that supports MCP Apps, `mw_parse_crashlog` and `mw_diagnose_crash` also point at a page that draws the parsed crash: the exception, the first 32 frames of the call stack, the first 32 registers, the first 60 plugins, the first 10 suspected references, and the log's other sections, each cut to 60 lines. For `mw_diagnose_crash` it shows only the parsed crash. The suspects and the known-conflict check stay in the text answer. It follows the same rules as the Patch Day page: one document served from memory, a Content-Security-Policy that forbids every network request, nothing kept, and everything from the log written as text, never as markup. One-line fields are flattened and cut, and the raw sections lose characters that print nothing or flip text direction. The page asks your client for no permission (it has no Copy button). Ask about this appears only if your client supports it, and only after a crash is drawn. When you press it, it sends one fixed request into your chat, with nothing from the log in it. When a log couldn't be parsed, the page shows the reason, and like the text answer that reason repeats the `logPath` you passed. Clients that don't support MCP Apps get the text answer and nothing else.

### Conflicts

`ui://modwrench/conflicts`, for `mw_check_known_conflicts`: each known conflict with its severity, the two mods, the description, the workaround, a patch's mod id (as text) and where the entry comes from (LOOT's masterlist, the community list or ModWrench's curated list), plus the LOOT and community source status and any warnings. Mod names and descriptions are LOOT's or contributors' text and go on the page as text only. The page has no buttons beyond the skin swatches and asks your client for nothing: no tool calls, no messages, no links, no permissions.

### The deck page

`ui://modwrench/deck`, for `mw_deck`, shows which platforms are connected and the four flagship games, in the four game skins. Like the other pages it is one HTML document served from memory, under a Content-Security-Policy that forbids every network request, and it keeps nothing. It asks your client for no permission. Apart from the skin swatches, which change only how the page looks, its only control is **Ask**, shown only if your client takes messages from a page. Pressing it puts one of a fixed set of sentences written into the page into your chat (for example "Show me the Thunderstore communities."), chosen by the row's platform or game id. Nothing from the result is ever in the message, and a platform or game the page doesn't know gets no Ask. The button's tooltip and its accessible name give the sentence before you press it; the button itself reads only "Ask" (or "Ask to detect my setup" when nothing is connected), so where no tooltip appears, as on a touch screen, the page doesn't show the sentence before it is sent. The page never asks your client to run a tool or open a link. Clients that don't support MCP Apps get the connector list as text and nothing else.

What has not been checked: these five pages were exercised in a real browser against a stand-in for an MCP Apps host, and their message handling is tested against a fake host. They have not been run inside Claude, Cursor, VS Code, ChatGPT or any other real client.

## Feedback: what /mw-critique reads and sends

`/mw-critique` and its tool, `mw_critique`, turn what you want to tell the maintainers into a GitHub issue for you to post. **It sends nothing.** ModWrench makes no network request for it: the answer is text your AI client shows you, ending in a link. The link opens GitHub's form for the repository's feedback template in your browser, with the draft filled in through the query parameters GitHub documents for issue forms. GitHub gets the draft only if you open the link and press the form's button, from your browser and as you, the way any issue is posted.

What goes into the draft:

- **Your words, as your AI client passed them,** after the cleaning Crash Whisperer's help posts get: the account and computer names, folder paths, network and email addresses, keys and account IDs it recognises are taken out, and the answer says how many of each, never what they were. The limits listed for [Crash Whisperer](#crash-whisperer-what-it-opens) apply here too. One matters more here than in a log: a folder path with a space in it takes the rest of its line with it, because the cleaning can't tell where such a path ends, so a sentence that goes on after a path loses its end.
- **Your setup, from what ModWrench knows without asking:** its own version, the connectors that are on, the name and version your AI client gave when it connected, the operating system (Windows, macOS or Linux, and on Linux whether `/etc/os-release` says this is a Steam Deck), the processor architecture, Node's version, and whether `MODWRENCH_UI` and `MODWRENCH_STRUCTURED` change the pages. No folder, account name, computer name or file of yours goes in. The one file it opens is `/etc/os-release`, on Linux.

Read the draft before you post it: an issue is public.

## What leaves your machine — read this one

This is the part most tools would leave out.

ModWrench hands its results to the AI client you connected it to. If that client runs a hosted model, **the results go to that provider.** That is how every MCP server works, but it matters more here because of what these particular tools read:

- **`mw_parse_crashlog` and `mw_diagnose_crash` return crash logs close to verbatim.** For Crash Logger SSE and Buffout 4, every named section is passed through as raw text so the model can actually read it. `mw_diagnose_crash` returns the whole parsed log plus the correlation. `mw_crash_whisperer` is the one that cleans first: see [Crash Whisperer](#crash-whisperer-what-it-opens). The objects they list leave out the name of the player's own character (the records 00000007 and 00000014), but the raw sections still carry it. In a client that draws MCP Apps pages, the same parsed log also goes to the Crash log page as structured data (each raw section cut to 60 lines). Other clients get the text only.
- **Paths with your username in them do go out.** `mw_detect_environment` returns your mod manager's data folder, Steam root, game install paths, and Proton prefix. `mw_read_load_order` returns the profile folder it read. On Windows those live under `C:\Users\<you>\`; on Linux and Steam Deck under `/home/<you>/`.
- Crash logs may carry paths of their own, depending on which crash logger and which mods produced them. That part is up to the log, not to ModWrench.
- **`mw_crash_whisperer` takes out what it recognises of your name, computer name, folders, addresses and keys from the log before it reads it**, and returns a short answer rather than the log. It names the plugins the log points at, and the help posts it writes list your plugins unless you ask it not to; even then they name the plugins that changed the objects the log names. A log you paste into the chat yourself has already gone. See [Crash Whisperer](#crash-whisperer-what-it-opens).
- **`mw_patch_day` names your plugins** — every SKSE plugin's file name, the Mod Organizer 2 mod folder it came from, and the name it declares for itself — but returns no folder paths. See [Patch Day](#patch-day-what-it-opens).
- **`mw_doctor` names the plugins and mod folders its findings are about** (a plugin and the master it needs, say), the first dozen names at the top of Mod Organizer 2's Overwrite folder, which kind of drive your Steam libraries sit on and how much room is free. It returns no folder paths, no account name or Steam account number, and none of the text of your Steam launch options. See [the Doctors](#the-doctors-what-they-open).

ModWrench keeps none of it — nothing written, nothing cached, nothing uploaded. But it cannot control what your AI client does with a tool result, and it cannot un-send it. If that matters to you, use a local model, or don't point the crash tools at anything you would not paste into a chat window.

## For mod authors

If you make mods, ModWrench touches your work. So, plainly:

- It **describes** mods. It does not **review** them. No ratings, no scores, no rankings, no "best mod for X."
- It links back to your mod page. It is meant to send people to you, not to stand in front of you.
- It never redistributes your files. It has no download code at all.
- It can **endorse** your mod when a user asks it to — the one write it performs, and it exists to credit you.
- It never republishes your catalogue. Every request is per-user and on demand; there is no mirror and no bulk fetch.

One thing it does that you should know about, because it is the part you might object to: **`mw_diagnose_crash` can name a specific mod as the likely cause of a crash.** That is an automated tool making a negative statement about your work, to a user, without you in the room.

**`mw_crash_whisperer` does the same, with more care about how it says it.** It ranks the mod names a crash log points at and says why, so it too can put your mod's name in front of a user as a lead. It calls that a lead, never a verdict or a culprit; it labels every reason as coming from the log, the player's files, a published rule or its own guess, and says plainly that a lead can be wrong; and the post it writes for a mod's author gives you the facts a bug report needs (the game version, what the log shows, where the stack enters your code, the call stack, and why your mod was named) with the player's name and folders taken out where ModWrench recognises them, so you aren't normally handed someone's home folder along with their problem. If you think the wording still does your work a disservice, tell us.

**`mw_doctor` can put your plugin's file name in front of a user too, for a different reason.** It doesn't say a mod caused a crash. It reports facts about the player's own setup, such as a plugin that names a master that isn't installed, a list over the game's plugin limit, or files piling up in Mod Organizer 2's Overwrite folder, so a finding can read "YourMod.esp needs Another.esm". It states what the player's files show, never a judgement of your work, labels what each statement rests on, and names the page a rule comes from. If one of its findings treats a plugin of yours unfairly, [open an issue](https://github.com/171county/modwrench/issues).

We think the honest mitigations for `mw_diagnose_crash` are: it is a heuristic and says so, it reports what it correlated rather than pronouncing a verdict, the user is told to verify, and — when the user explicitly opts in — it can link the named mod back to its author's Nexus page so the user can reach them. If you think that is not enough, [open an issue](https://github.com/171county/modwrench/issues) — that objection is legitimate and we would rather hear it from you than about you.

## What ModWrench is bad at

- **Crash diagnosis is a heuristic, not an authority.** It correlates a parsed crash log against your installed mods and known conflicts. It can be confidently wrong, and it will be. Crash Whisperer's ranking is ModWrench's own scoring of what a log shows, not a measurement; treat the top lead as the first thing to check, and the labels on its reasons as the guide to how far to trust it.
- **Coverage is a fixed list.** Local diagnostics know 15 games — 9 Bethesda Creation Engine titles (Skyrim SE/LE/VR, Fallout 4, Fallout 4 VR, Fallout: New Vegas, Fallout 3, Starfield, Oblivion) and 6 Unity/BepInEx titles (Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS). Your game may not be there.
- **Four crash log formats:** Crash Logger SSE, Buffout 4, NetScriptFramework, BepInEx. An unrecognized format returns a clear error, not a guess.
- **Three mod managers:** MO2 and r2modman properly; Vortex only well enough to notice it exists.
- **Patch Day covers one game.** Skyrim Special Edition and Anniversary Edition with SKSE; Fallout 4 is next. It follows SKSE's published source for Skyrim 1.5.97, 1.6.x, 1.7.99 and 1.7.104; on any other version the answer is a prediction ([details](#patch-day-what-it-opens)).
- **The Doctors read files; they don't run your game.** A clear report means the checks that can run from files passed, and that is all it means. The plugin checks cover Skyrim Special Edition and Anniversary Edition, and several of the rules are borrowed from other tools' documentation or are ModWrench's own guesses, labelled as such. It has not been run against a real install ([details](#the-doctors-what-they-open)).
- **It is early software.** It has bugs you will find before we do.

## It is on you

ModWrench gives an AI assistant better information about your setup. It does not make the assistant right, and it does not make you safe.

**Check what it tells you before you act on it.** Do not delete a mod, reorder a load order, or rebuild a profile because a language model was confident. Back up your saves and your profile before you change anything on the strength of a diagnosis. If ModWrench names a culprit, treat that as a lead to verify — not a verdict.

This is a tool for making a hard job less tedious. It is not a mod manager, not a support desk, and not an authority on your setup. You are.

## How updates reach you — and the one bit of access we do have

The install instructions tell you to run this:

```json
"args": ["-y", "@modwrench/cli"]
```

There is no version pinned there, which means **npx fetches the latest published version every time it starts.** When a new version is published, your next launch picks it up automatically.

That is how you get bug fixes, and it is also the honest answer to "could the maintainer push something into my machine later?" **Yes — that is the one channel that exists.** Not by reaching in; by publishing. It is worth understanding rather than glossing over, so here is what constrains it and what you can do about it.

**The source is public.** Any version can be diffed against this repository. MIT means you never have to take a release on faith.

**Releases carry npm provenance.** From 0.1.0 onward, packages are published by a GitHub Actions workflow with `--provenance`, which produces a signed attestation binding the published tarball to the exact public commit and build that produced it. It is not a promise that the code is good — it is cryptographic proof the code on npm is the code in this repo, and not something built on someone's laptop.

**Nothing is released from a private repository.** Provenance needs a public source repository, and this page promises you can read the source, so the release workflows check first and stop with an error, publishing nothing, while the repository is private.

You can check it yourself:

```bash
npm audit signatures
```

or look for the "Provenance" panel on the package's npm page, which names the source commit and the build run.

Note the honest limit: **0.0.1 was published manually and has no attestation.** Provenance begins at 0.1.0.

**You can pin.** If you would rather decide when to update, pin the version and nothing changes under you:

```json
"args": ["-y", "@modwrench/cli@0.2.1"]
```

Pinning is a completely reasonable thing to do with any tool that can read your files, including this one.

## Check any of this yourself

Do not take the above on faith. The whole point of MIT and a public repo is that you do not have to:

```bash
git clone https://github.com/171county/modwrench.git
cd modwrench

# Every hardcoded network destination in the shipped code
grep -rhoE "https://[a-zA-Z0-9.-]+" packages/*/src --include=*.ts | sort -u

# ...and every call site that makes a request, including ones whose URL is
# a variable. A literal-matching grep cannot see those.
grep -rn "await fetch(" packages/*/src --include=*.ts

# Every filesystem write (the local tools should have none)
grep -rn "writeFile\|appendFile\|createWriteStream\|rmSync\|unlink" packages/workbench/src

# Every program the local tools could start (they should start none)
grep -rn "child_process" packages/workbench/src

# Every non-GET request
grep -rn "method:" packages/*/src --include=*.ts

# Where credentials come from
cat packages/core/src/auth.ts
```

**The first grep returns nineteen hosts, and only five of them are connections.** Rather than let you wonder which, here is the whole output accounted for. The five in the table above, plus fourteen that appear as *text* and are never contacted:

| Host | Why it appears | Contacted? |
|---|---|---|
| `github.com` | inside the User-Agent string (`core/src/index.ts:140`), in the CLI's help text, as the wikis and issues the Doctors name as sources (r2modman, Proton, Flathub, Mod Organizer 2, a Steam runtime issue), and as the feedback form `/mw-critique`'s link opens in your browser | no |
| `help.nexusmods.com` | a link in an error message pointing at Nexus's API policy | no |
| `mod.io` | links telling you where to get your API key, and the address of a mod's page in a result | no |
| `www.nexusmods.com` | the same two kinds of link, and the crash loggers' pages the Doctors name as sources | no |
| `home` | a comment in `crashwhisper/redact.ts` saying why `https://home/x` is not read as a path | no |
| `docs.bepinex.dev` | BepInEx's troubleshooting page, named as a source by the Deck Doctor | no |
| `dyndolod.info` | the plugin-limit page, named as a source by the Setup Doctor | no |
| `en.uesp.net` | a Linux modding page, named as the source for folder names that differ by case | no |
| `learn.microsoft.com` | Microsoft's page on moving Documents into OneDrive | no |
| `loot.readthedocs.io` | LOOT's sorting documentation, named as the source for masters | no |
| `nexus-mods.github.io` | the Nexus Mods App's FAQ on `nxm://` links | no |
| `specifications.freedesktop.org` | a code comment pointing at the mime-apps specification | no |
| `stepmodifications.org` | STEP's setup guide, named as a source for where to keep a game | no |
| `wiki.wabbajack.org` | Wabbajack's troubleshooting FAQ, named as a source for where to keep a game | no |

*(An earlier version of this page said this grep returns nine hosts. The code it described already returned ten: the tenth is `home`, from a comment in the redactor, and the page had not counted it. The Doctors' source pages are the other nine. The table accounts for every line of the output.)*

A string literal is not a request. The second grep finds the requests themselves — every call site, including ones whose URL is a variable that no literal-matching grep can see. On the current code it returns thirteen, and they account for everything:

| Where | Count | What |
|---|---|---|
| `core/src/http.ts` | 1 | the shared client every tool request goes through |
| `nexus/src/auth.ts` | 4 | key validation, OAuth token exchange, profile checks |
| `modio/src/auth.ts` | 6 | key validation, the OAuth email exchange, profile checks |
| `workbench/src/conflicts/loot.ts` | 1 | the LOOT masterlist |
| `nexus/src/register.ts` | 1 | **the CDN preview** — the one with no base URL behind it |

The auth files hold ten of the thirteen, which is the same point made above from the other direction: the credential-carrying requests are the ones that do not go through the overridable shared client.

The `method:` grep finds the POSTs: the key and OAuth exchanges in the two auth files, the GraphQL queries (GraphQL is sent as a POST; these only read), and the endorsement, which is the one write. It also matches two lines in `ui/src/app.ts`, which are the JSON-RPC `method` field every ModWrench page uses to talk to your client (see [the Patch Day page](#the-patch-day-page), [the Crash Whisperer page](#the-crash-whisperer-page), [the Doctor page](#the-doctor-page) and [the other pages](#the-other-pages)) and not an HTTP method. Every page's Content-Security-Policy forbids it from making a network request at all.

If any of these greps turn up something this page does not account for, that is a bug in this page. [Report it](https://github.com/171county/modwrench/issues) and it gets fixed or this page gets corrected.

---

*Last verified against the code on 2026-09-15; the Patch Day, Crash Whisperer and Doctors sections, their pages and the lines that mention them were added and checked against the code on 2026-10-02, and checked again on 2026-10-03 after the fixes listed in the changelog, when the greps above were re-run and gave the counts stated here (nineteen hosts, thirteen request sites, no filesystem writes and no `child_process` in the workbench). The other pages, which replaced the MCP-UI panels, and the lines that mention them were added and checked against the code on 2026-10-05, when the greps were re-run and gave the same counts. If you find a gap between this document and the source, the source is the truth and this document is wrong.*
