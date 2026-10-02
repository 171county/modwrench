# What ModWrench does, and what it won't

Every claim on this page was checked against the code before it was written here, and every one of them is something you can verify yourself. The last section shows you how.

Where a claim needed a caveat to stay true, the caveat is here instead of being left out. A list like this is only worth anything if the awkward parts are on it.

---

## What ModWrench will never do

- **Never download, install, or delete a mod.** No tool does it. There is no download code in this repository.
- **Never modify your load order, your mod files, or your game files.** Every local tool opens files read-only. There is not a single filesystem write call in the workbench package.
- **One write action, and only on your say-so.** ModWrench can endorse a mod on Nexus — crediting its author — when you ask it to. It asks first, every time, and shows you exactly what it will do before it does anything. Nothing else writes: no votes, no ratings, no comments, no subscriptions, no uploads. Details below.
- **Never generate mod content.** ModWrench reads and explains. It produces no assets, no code, no voices, no text intended to ship inside anyone's mod.
- **Never rate, rank, or score a mod itself.** It will tell you what a mod is and what it does, and it will not review someone's work back at them. It does pass through a platform's *own* published figures — Nexus trending, mod.io popular, Thunderstore top-rated — because those are the platform's numbers, not ModWrench's opinion.
- **Never send anything to the maintainer.** There is no analytics SDK, no crash reporting, no telemetry, no phone-home. No network destination in this codebase belongs to us.
- **Never store your data.** Nothing is written to disk. There is no database and no cache of your data — the only thing held in memory is LOOT's public masterlist, and it dies with the process.
- **Never ask for a password.** ModWrench never sees or handles your platform password.
- **Filter adult-tagged Nexus content by default**, unless you explicitly enable it yourself. Every Nexus response passes through the filter, which drops what the adult flag marks. The filter reads that flag off the record, so where a response carries no flag it cannot judge it — see [the limits of the adult filter](#the-limits-of-the-adult-filter) below, which says exactly which tools fail closed and which do not. This is the one promise on this page with a real edge, and it is spelled out rather than rounded up.

## There is no ModWrench service

There is no account, no login to us, no server we operate. Nothing you do reaches a machine we control, because there is no such machine. ModWrench is a program your editor starts on your computer and stops when you close it.

Two clarifications so that is exact rather than merely reassuring:

1. The repo includes an optional HTTP transport package (`@modwrench/remote`), which is published to npm and which **you** may choose to run — on your own machine or your own host. It defaults to binding `127.0.0.1`, creates a fresh stateless server per request, and exposes only the public Thunderstore tools: it holds no credential and touches no files. Nobody runs an instance of it for you.
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

`mw_patch_day` ("is it safe to update?") reads more of your game folder than the other local tools, so here is exactly what it touches.

It opens, read-only:

- the game's executable and SKSE's DLL for that game version, to read the version number the file carries;
- every `.dll` directly inside `Data/SKSE/Plugins` — in the game folder, and, when Mod Organizer 2 is the active manager or you give it an instance, in each enabled mod and the overwrite folder — reading the file's header, its export table, and the 848-byte version block a plugin publishes for SKSE;
- the first four bytes of the Address Library file, which hold its format number;
- Steam's `appmanifest_<appid>.acf` for the game, to see whether an update is waiting;
- SKSE's own log, `skse64.log`, if it is in the usual place or you pass its path (the first 8 MB at most).

**It never runs any of it.** A DLL is read as bytes: nothing is loaded, executed or called into. It writes nothing, makes no network request, and keeps nothing — no cache, and the result lives in memory until your AI client has it. The repository's read-only scan covers it like the rest of the workbench.

**What goes back to your AI client:** file names and Mod Organizer 2 mod-folder names, the name each plugin declares for itself, game and SKSE version numbers, Steam build numbers and the last-update date, and — if SKSE's log is read — its lines about refused plugins. **No folder path is returned**, and a test fails if one appears; log lines have their folders stripped, spaces in folder names included. That is stricter than `mw_detect_environment`, which does return paths. A list of the plugins you run can still say a lot about what you play, so it is on this page.

The limits, because the awkward parts belong here:

- **The rules are SKSE's own only where SKSE's source is published** — the 2.2.6 build, for Skyrim 1.6.1170. Skyrim 1.7.x runs on SKSE 2.3.x, which is not open source. For 1.7.x the same rules are carried forward, plus one behaviour that a public bug report shows on 1.7.104 (Address Library format 5, [SkyrimNet-GamePlugin #577](https://github.com/MinLL/SkyrimNet-GamePlugin/issues/577)), and every result is labelled with its `basis`: `skse-source`, `field-reports` or `inferred`. On 1.7.x a go is a prediction, and the tool says to launch the game once and compare against SKSE's own log.
- **A plugin that passes SKSE's version check can still crash** if the game code it hooks has changed. That cannot be seen from files.
- **A go is not "safe".** It means every check that can be run from files passed. The verdicts are go, check and wait — the tool never calls a result safe, and a test holds the headlines and per-plugin reasons to that.
- **It was built from SKSE's source, public reports and constructed test folders — not yet run against a real Skyrim install.** If a result is wrong on yours, that is a bug worth reporting, and the log lines it quotes are the evidence.
- **One game for now:** Skyrim Special Edition and Anniversary Edition. Anything else is refused with a message rather than guessed at.

### The Patch Day page

In an AI client that supports [MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html), `mw_patch_day` also offers a page: the verdict, how sure it is, which plugins need attention, what to do next, a Re-check button and a "what if I update to…" box. What it is, and what it is not:

- **It is one HTML document that ModWrench serves from memory** (a `ui://` resource). A client that does not support MCP Apps never asks for it. Such a client gets the tool's plain-text answer and nothing else, so no markup lands in the conversation.
- **It cannot send anything anywhere.** It runs in a sandboxed frame your client provides, under its own Content-Security-Policy that forbids network requests, external scripts, stylesheets, images, fonts, frames and form posts. The tests fail if the page contains a URL, a network API (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`) or browser storage.
- **It keeps nothing.** No cookies, no local storage. Its buttons ask your client to run the same read-only tool again; Copy summary puts the text answer on your clipboard, which is the one permission the page asks its client for. Ask about this, shown only if your client supports it, sends a message into your chat with the verdict line — and only when you press it.
- **Text from your machine is only ever text.** File names, mod folder names and log lines are other people's words; anyone can publish a mod called anything. The page writes them with `textContent` and never as markup, and a test scans the page's code for every way a string can become markup or script. The plain-text answer flattens them to one line and cuts them short, so a plugin can't name itself "Next steps: …" and pass as part of the answer. That makes a hostile name harder to use, not impossible: a name is still words a model reads.
- **The page's messages are not network requests.** It talks to your client over `postMessage`, using JSON-RPC. The `method:` grep below matches two lines of that code in `packages/ui/src/app.ts`: they are the JSON-RPC `method` field, not an HTTP method.

What has not been checked: the page was exercised in a real browser against a stand-in for an MCP Apps host, and its message handling is tested against a fake host. It has not been run inside Claude, Cursor, VS Code, ChatGPT or any other real client, and how each one frames and polices a page is theirs to decide. If a client draws it badly, the text answer is unaffected.

## Crash Whisperer: what it opens

`mw_crash_whisperer` ("why did my game crash?") reads a crash log and, where it can, your install. Here is exactly what it touches.

It opens, read-only:

- **A crash log.** The text you pasted; or the file you pointed it at; or, when you give neither, the newest one it finds where the loggers write them: `Documents/My Games/<game>/SKSE` or `F4SE` for Crash Logger SSE and Buffout 4 (a OneDrive-moved Documents folder, and Proton's copy on Linux and Steam Deck, included), `Data/NetScriptFramework/Crash` in the game folder, and `BepInEx/LogOutput.log` in the game folder or in an r2modman profile. A log over 12 MB is read at its first 3 MB and its last 9 MB, in the same text encoding at both ends and each cut at a whole line; the part in between is never read, and the answer says how much was.
- **Your other recent crash logs**, from those same places: up to five by default (`compareRecent`; ten at most; 0 turns it off), each read in memory to see whether the same names keep coming up. What comes out of them is a count and which names recurred.
- **Your install, for Skyrim Special Edition** (`checkInstall`, on by default): the same reading Patch Day does. The game's executable and SKSE's DLL for their version numbers, each plugin DLL in `Data/SKSE/Plugins` (the game folder and each enabled Mod Organizer 2 mod), and the Address Library file's first bytes. That is how it can say that a plugin the log names is no longer installed, where it came from, or that SKSE's own rule refuses it on your game version.

**It never runs any of it.** A DLL is read as bytes: nothing is loaded or executed. It writes nothing, makes no network request, and keeps nothing; the result lives in memory until your AI client has it. The repository's read-only scan covers it like the rest of the workbench, and a test checks that reading a log, the install and the other recent logs creates, changes and deletes nothing.

**What it recognises comes out first.** Before anything else reads the log, a copy of its text is cleaned. It recognises, and replaces:

- the account and computer name your operating system reports, and the values on labelled lines such as `Computer Name:` and `User Name:`, whatever the capitalisation and in their joined, abbreviated and composed forms (`jane-doe`, `JaneDoe`, `J.Doe`, an accented letter written either way, a Windows short name like `JANEDO~1`, `DOMAIN\jane`);
- folder paths, in the forms logs use: Windows drive and share paths, `file:` addresses, `\\?\` and `\Device\` paths, Linux, Steam Deck, Proton, WSL, Cygwin and macOS home folders, `~`, `$HOME` and `%USERPROFILE%`, and paths with their separators percent-encoded. The folders go and the file name stays;
- network addresses: IPv4 and IPv6 in the ordinary spellings, hardware addresses, and the names a private network or a dynamic-DNS service gives a machine;
- email addresses;
- keys, tokens and passwords: the shapes the common services use (GitHub, Discord and Slack webhooks, Google, AWS, npm and so on), the value after a label that says what it is (`STEAM_TOKEN`, `db_password`, `NexusApiKey`), in headers, cookies, web addresses, command lines, config files and markup, and whole private-key blocks;
- account IDs.

Characters that print nothing are dropped, so one can't be slipped inside a word to hide it. Each recognised thing becomes a plain label (`REDACTED-USER`, `REDACTED-PATH` and so on), and the answer says how many of each, never what they were. If cleaning runs past 20 seconds, the lines it hadn't reached are dropped, never passed along unchecked, and the answer says so. The ranking, the checks, the text answer and the help posts are all built from the cleaned copy, and each help post is checked again at the end.

How that has been checked: a test plants a made-up person's name, computer, folders, addresses and keys into logs of all four formats and fails if any of it turns up in anything the tool returns; more tests send the same plants down every route data can take through an answer, and run several hundred other spellings through the cleaning rules; and the cleaning and the log reading were checked by breaking their rules on purpose and confirming a test fails. **It is pattern matching, not a guarantee.** A different person trying hard will find a form it misses.

What that does not cover, because the awkward parts belong here. Where a test can pin an item, one does: it fails if the thing starts being covered, so this list can't go stale quietly.

- **A name it can't know is yours.** It removes your account and computer name and anything shaped like a path, address, email or key. It cannot know that a mod called "Jane's Followers" is personal, or that a plugin's name says something about you. Names are kept as written, because a helper needs them. The help posts are shown whole so you can read them before you post.
- **Parts of your name.** When your account name has several words, the whole name and its joined forms go, but a first or last name on its own is removed only inside a path or on a labelled line. A name under three characters is removed only with its path, and so is an account named for a common word (`Admin`, `Steam`, `Games`), because replacing those everywhere would damage the log. A name inside a longer word (a file called `JaneArmor.esp`) is left alone and counted, and the answer says so, so you can look.
- **Secrets it can't tell are secrets.** A key with no label and no shape ModWrench knows is caught only if it is long and mixed-case (about 80 characters or more). The labels `pass`, `key`, `pin`, `cred`, `otp`, `sig`, `signature`, `licence`, `sas` and a bare `webhook` are not treated as saying "secret", because they are also ordinary words in logs. A password with spaces in it and no quotes loses only its first word (a quoted one goes whole), a secret on the line after its label stays, and so does the value after a one-letter flag such as `-p`. The real formats of Nexus Mods and Thunderstore keys have not been confirmed, so those are caught by their label or by being long, not by how they look.
- **Paths it doesn't recognise.** A Linux or macOS path written directly against a letter, digit, underscore, dot, tilde, dollar sign or hyphen (`foo/home/jane/mods/x.dll`) isn't read as a path: your account name inside it is still removed, but the other folders in it stay. Relative paths (`../Mods/x.dll`), drive-relative ones (`D:Mods\x.dll`) and a path a log wrapped across two lines are left as they are.
- **Addresses in other spellings.** An address written as one decimal, hexadecimal or octal number, a hardware address with no separators, a phone number, and the public name of a server a mod connected to (`play.example-game.com`) are kept.
- **Long lines and big files.** A line over 6,000 characters is cut before it is checked (the cut is counted and said). A log over 12 MB is read at its start and its end only.
- **The log file itself.** Nothing is done to the file: it stays on your disk exactly as the game wrote it, with everything in it. To share a crash, post a help post; don't attach the file.
- **Hardware.** The help posts and the structured report include the hardware lines the log's own system specs carry (operating system, processor, graphics card, memory), because the first thing a helper asks for is those. The crash time is in them too. That is information about your machine, in a post you choose to make.

**What goes back to your AI client.** A short plain-text answer: what happened, the names the log points at with their reasons, setup checks, next steps, what it can't tell you, and, when you ask for one, a help post. Not the log itself, and no folder path (a test fails if one appears). The structured report behind the page goes only to a client that says it can draw pages, or when you set `MODWRENCH_STRUCTURED=always`. Both are built from the cleaned copy.

**A log you paste into the chat has already gone.** Whatever you type into your AI client reaches its provider before ModWrench can touch it, so the cleaning can't help with that copy. Leave the log out and let `mw_crash_whisperer` (or `/mw-crash` with nothing after it) read the file: then what ModWrench recognises is gone before the AI sees anything. The slash command says this when you paste. A file path you type after `/mw-crash` reaches the AI as you typed it, as does anything you say in the chat.

**What each statement rests on.** Every statement in the answer is labelled `log` (the log itself says it), `install` (your files say it), `rule` (a published rule, such as SKSE's own compatibility check) or `guess` (ModWrench's own inference, a name match for example), and the answer counts how many rest on each. Names the log points at are **leads**, scored strong, possible or faint by ModWrench's own rules. A lead is not a finding. A test holds the answer to never calling anything safe, guilty or certain.

The limits:

- **It was built from the crash loggers' published source, format samples and constructed test folders. It has not yet been run against a real Skyrim, Fallout 4 or Unity crash log, or a real install.** If a result is wrong on yours, that is a bug worth reporting, and the log lines it quotes are the evidence.
- **Where NetScriptFramework and Buffout 4 write their logs has been checked only in part**, so both likely places are read. A log kept somewhere else needs `logPath`.
- **On Skyrim 1.7.x SKSE's own rules aren't public**, so the install check there is a prediction, as in [Patch Day](#patch-day-what-it-opens).
- **The setup checks cover Skyrim Special Edition and BepInEx load problems.** For other games the log is read and nothing is checked against your files. It does not yet check for missing masters, a second crash logger running beside the first, a crash logger too old for your game, or a list of known conflicts.
- **A crash log names what was running when the game stopped, not always what caused it.** A lead can be wrong, and will be.

### The Crash Whisperer page

`mw_crash_whisperer` offers a page in clients that support MCP Apps, built the same way as [the Patch Day page](#the-patch-day-page) and held to the same tests: one HTML document served from memory that a client fetches only if it can draw it; a Content-Security-Policy that forbids every network request; no storage; every name from your machine written as text and never as markup. What it adds:

- **Copy** buttons put a help post on your clipboard, the one permission the page asks its client for. The page cannot post anywhere.
- **A box to paste a log into.** What you paste goes to ModWrench through your client, and ModWrench takes out what it recognises before reading it. Whether your client also shows a tool call to its model is up to the client.
- **Two check boxes**: compare with your other recent crashes or not, and leave your plugin lists out of the help posts or not. They ask your client to run the same read-only tool again.
- **Ask about this**, shown only if your client supports it, sends a message into your chat made of the answer's headline and a fixed sentence, and only when you press it.

It has been exercised in a real browser against a stand-in for an MCP Apps host. It has not been run inside Claude, Cursor, VS Code, ChatGPT or any other real client.

## What leaves your machine — read this one

This is the part most tools would leave out.

ModWrench hands its results to the AI client you connected it to. If that client runs a hosted model, **the results go to that provider.** That is how every MCP server works, but it matters more here because of what these particular tools read:

- **`mw_parse_crashlog` and `mw_diagnose_crash` return crash logs close to verbatim.** For Crash Logger SSE and Buffout 4, every named section is passed through as raw text so the model can actually read it. `mw_diagnose_crash` returns the whole parsed log plus the correlation. `mw_crash_whisperer` is the one that cleans first: see [Crash Whisperer](#crash-whisperer-what-it-opens).
- **Paths with your username in them do go out.** `mw_detect_environment` returns your mod manager's data folder, Steam root, game install paths, and Proton prefix. `mw_read_load_order` returns the profile folder it read. On Windows those live under `C:\Users\<you>\`; on Linux and Steam Deck under `/home/<you>/`.
- Crash logs may carry paths of their own, depending on which crash logger and which mods produced them. That part is up to the log, not to ModWrench.
- **`mw_crash_whisperer` takes out what it recognises of your name, computer name, folders, addresses and keys from the log before it reads it**, and returns a short answer rather than the log. It names the plugins the log points at, and the help posts it writes list your plugins unless you ask it not to. A log you paste into the chat yourself has already gone. See [Crash Whisperer](#crash-whisperer-what-it-opens).
- **`mw_patch_day` names your plugins** — every SKSE plugin's file name, the Mod Organizer 2 mod folder it came from, and the name it declares for itself — but returns no folder paths. See [Patch Day](#patch-day-what-it-opens).

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

We think the honest mitigations for `mw_diagnose_crash` are: it is a heuristic and says so, it reports what it correlated rather than pronouncing a verdict, the user is told to verify, and — when the user explicitly opts in — it can link the named mod back to its author's Nexus page so the user can reach them. If you think that is not enough, [open an issue](https://github.com/171county/modwrench/issues) — that objection is legitimate and we would rather hear it from you than about you.

## What ModWrench is bad at

- **Crash diagnosis is a heuristic, not an authority.** It correlates a parsed crash log against your installed mods and known conflicts. It can be confidently wrong, and it will be. Crash Whisperer's ranking is ModWrench's own scoring of what a log shows, not a measurement; treat the top lead as the first thing to check, and the labels on its reasons as the guide to how far to trust it.
- **Coverage is a fixed list.** Local diagnostics know 15 games — 9 Bethesda Creation Engine titles (Skyrim SE/LE/VR, Fallout 4, Fallout 4 VR, Fallout: New Vegas, Fallout 3, Starfield, Oblivion) and 6 Unity/BepInEx titles (Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS). Your game may not be there.
- **Four crash log formats:** Crash Logger SSE, Buffout 4, NetScriptFramework, BepInEx. An unrecognized format returns a clear error, not a guess.
- **Three mod managers:** MO2 and r2modman properly; Vortex only well enough to notice it exists.
- **Patch Day covers one game.** Skyrim Special Edition and Anniversary Edition with SKSE; Fallout 4 is next. On Skyrim 1.7.x SKSE's own rules aren't public, so the answer there is a prediction ([details](#patch-day-what-it-opens)).
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

# Every non-GET request
grep -rn "method:" packages/*/src --include=*.ts

# Where credentials come from
cat packages/core/src/auth.ts
```

**The first grep returns nine hosts, and only five of them are connections.** Rather than let you wonder which, here is the whole output accounted for. The five in the table above, plus four that appear as *text* and are never contacted:

| Host | Why it appears | Contacted? |
|---|---|---|
| `github.com` | inside the User-Agent string — `core/src/index.ts:140` | no |
| `help.nexusmods.com` | a link in an error message pointing at Nexus's API policy | no |
| `mod.io` | a link telling you where to get your API key | no |
| `www.nexusmods.com` | a link telling you where to get your API key | no |

A string literal is not a request. The second grep finds the requests themselves — every call site, including ones whose URL is a variable that no literal-matching grep can see. On the current code it returns thirteen, and they account for everything:

| Where | Count | What |
|---|---|---|
| `core/src/http.ts` | 1 | the shared client every tool request goes through |
| `nexus/src/auth.ts` | 4 | key validation, OAuth token exchange, profile checks |
| `modio/src/auth.ts` | 6 | key validation, the OAuth email exchange, profile checks |
| `workbench/src/conflicts/loot.ts` | 1 | the LOOT masterlist |
| `nexus/src/register.ts` | 1 | **the CDN preview** — the one with no base URL behind it |

The auth files hold ten of the thirteen, which is the same point made above from the other direction: the credential-carrying requests are the ones that do not go through the overridable shared client.

The `method:` grep finds the POSTs: the key and OAuth exchanges in the two auth files, the GraphQL queries (GraphQL is sent as a POST; these only read), and the endorsement, which is the one write. It also matches two lines in `ui/src/app.ts`, which are the JSON-RPC `method` field the Patch Day and Crash Whisperer pages use to talk to your client (see [the Patch Day page](#the-patch-day-page) and [the Crash Whisperer page](#the-crash-whisperer-page)) and not an HTTP method. Those pages' Content-Security-Policy forbids them from making a network request at all.

If any of these greps turn up something this page does not account for, that is a bug in this page. [Report it](https://github.com/171county/modwrench/issues) and it gets fixed or this page gets corrected.

---

*Last verified against the code on 2026-09-15; the Patch Day and Crash Whisperer sections, their pages and the lines that mention them were added and checked against the code on 2026-10-02, when the greps above were re-run and gave the counts stated here (nine hosts, thirteen request sites, no filesystem writes in the workbench). If you find a gap between this document and the source, the source is the truth and this document is wrong.*
