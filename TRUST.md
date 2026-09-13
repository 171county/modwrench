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
- **Never surface adult-tagged Nexus content** unless you explicitly enable it yourself — see below.

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
| `api.nexusmods.com` | Nexus tools | Mod data |
| `users.nexusmods.com` | `auth login nexus` only | OAuth |
| `api.mod.io` | mod.io tools | Mod data |
| `thunderstore.io` | Thunderstore tools | Mod data |
| `raw.githubusercontent.com` | Conflict tools | LOOT's public masterlist |

That last one is worth naming because it is not a mod platform: conflict checking downloads LOOT's community-maintained masterlist from their GitHub repo. It receives your IP address, like any HTTP request, and nothing else — no mod data, no credentials, no file paths.

Platform base URLs are environment variables you can override, so you can point ModWrench at a proxy and watch every byte it sends.

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

**ModWrench filters it out by default.** Adult-tagged entries are dropped from lists and replaced with a short notice when you ask for one directly. The filter sits in the shared request path, so it covers every Nexus tool — including any added later.

If you want it, you turn it on yourself, on your own machine:

```
NEXUS_ALLOW_ADULT_CONTENT=true
```

Two deliberate choices worth stating. It is an **environment variable, not a tool parameter** — which means the AI cannot switch it off no matter what it is asked to do; only the person running ModWrench can. And ModWrench performs no age verification, so the default is the conservative one rather than a guess about who is reading.

## What leaves your machine — read this one

This is the part most tools would leave out.

ModWrench hands its results to the AI client you connected it to. If that client runs a hosted model, **the results go to that provider.** That is how every MCP server works, but it matters more here because of what these particular tools read:

- **Crash logs come back close to verbatim.** For Crash Logger SSE and Buffout 4, every named section is passed through as raw text so the model can actually read it. `mw_diagnose_crash` returns the whole parsed log plus the correlation.
- **Paths with your username in them do go out.** `mw_detect_environment` returns your mod manager's data folder, Steam root, game install paths, and Proton prefix. `mw_read_load_order` returns the profile folder it read. On Windows those live under `C:\Users\<you>\`; on Linux and Steam Deck under `/home/<you>/`.
- Crash logs may carry paths of their own, depending on which crash logger and which mods produced them. That part is up to the log, not to ModWrench.

ModWrench keeps none of it — nothing written, nothing cached, nothing uploaded. But it cannot control what your AI client does with a tool result, and it cannot un-send it. If that matters to you, use a local model, or don't point the crash tools at anything you would not paste into a chat window.

## For mod authors

If you make mods, ModWrench touches your work. So, plainly:

- It **describes** mods. It does not **review** them. No ratings, no scores, no rankings, no "best mod for X."
- It links back to your mod page. It is meant to send people to you, not to stand in front of you.
- It never redistributes your files. It has no download code at all.
- It can **endorse** your mod when a user asks it to — the one write it performs, and it exists to credit you.
- It never republishes your catalogue. Every request is per-user and on demand; there is no mirror and no bulk fetch.

One thing it does that you should know about, because it is the part you might object to: **`mw_diagnose_crash` can name a specific mod as the likely cause of a crash.** That is an automated tool making a negative statement about your work, to a user, without you in the room.

We think the honest mitigations are: it is a heuristic and says so, it reports what it correlated rather than pronouncing a verdict, and the user is told to verify. If you think that is not enough, [open an issue](https://github.com/171county/modwrench/issues) — that objection is legitimate and we would rather hear it from you than about you.

## What ModWrench is bad at

- **Crash diagnosis is a heuristic, not an authority.** It correlates a parsed crash log against your installed mods and known conflicts. It can be confidently wrong, and it will be.
- **Coverage is a fixed list.** Local diagnostics know 15 games — 9 Bethesda Creation Engine titles (Skyrim SE/LE/VR, Fallout 4, Fallout 4 VR, Fallout: New Vegas, Fallout 3, Starfield, Oblivion) and 6 Unity/BepInEx titles (Lethal Company, Valheim, R.E.P.O., Risk of Rain 2, Dyson Sphere Program, BONEWORKS). Your game may not be there.
- **Four crash log formats:** Crash Logger SSE, Buffout 4, NetScriptFramework, BepInEx. An unrecognized format returns a clear error, not a guess.
- **Three mod managers:** MO2 and r2modman properly; Vortex only well enough to notice it exists.
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
"args": ["-y", "@modwrench/cli@0.1.0"]
```

Pinning is a completely reasonable thing to do with any tool that can read your files, including this one.

## Check any of this yourself

Do not take the above on faith. The whole point of MIT and a public repo is that you do not have to:

```bash
git clone https://github.com/171county/modwrench.git
cd modwrench

# Every network destination in the shipped code
grep -rhoE "https://[a-zA-Z0-9.-]+" packages/*/src --include=*.ts | sort -u

# Every filesystem write (the local tools should have none)
grep -rn "writeFile\|appendFile\|createWriteStream\|rmSync\|unlink" packages/workbench/src

# Every non-GET request
grep -rn "method:" packages/*/src --include=*.ts

# Where credentials come from
cat packages/core/src/auth.ts
```

If any of those turn up something this page does not mention, that is a bug in this page. [Report it](https://github.com/171county/modwrench/issues) and it gets fixed or this page gets corrected.

---

*Last verified against the code on 2026-09-12. If you find a gap between this document and the source, the source is the truth and this document is wrong.*
