# Nexus Mods — application registration request

Send to **support@nexusmods.com**. Suggested subject:

> API application registration + Section 11 clarification — ModWrench (open source, read-only)

Everything below is a draft. Read it before sending and change anything that
does not sound like you — it should come from a person, not a template.

---

Hello,

I maintain **ModWrench**, a free and open-source tool for modders, and I would
like to register it as an API application before I release it publicly. I also
have one policy question I would rather ask now than assume the answer to.

**Application name:** ModWrench
**Version:** 0.1.0
**Source:** https://github.com/171county/modwrench (MIT, public)
**Distribution:** npm, as `@modwrench/cli`
**Author:** Sean B. (Nexus account: 171county)

## What it is

ModWrench is a Model Context Protocol (MCP) server. It runs locally on a
modder's own machine and gives their AI assistant — Claude, Cursor, or any other
MCP-compatible client — the ability to look things up on their behalf while they
troubleshoot their setup.

The use case it exists for: a user's game crashes, they paste the crash log to
their assistant, and ModWrench reads the log, reads their actual installed load
order from MO2 or Vortex, and helps identify which of *their* mods is implicated.
Nexus metadata is what turns a plugin filename in a crash log into a mod with a
name, an author, and a page to visit.

There is no ModWrench server. Nothing runs on infrastructure I control, and no
user data reaches me. Each user runs it on their own machine with their own
credential.

## What it does with your API

**Read-only, per-user, on demand.** Endpoints used are `/v1` REST (games, mods,
files, changelogs, latest/trending/updated, validate) and the `/v2` GraphQL
endpoint for full-text mod search, which `/v1` does not offer.

Specifically, so there is no ambiguity:

- **No writes of any kind.** No endorsements, votes, comments, subscriptions, or
  uploads. No such call exists in the code. The OAuth scope requested is
  `public` (read-only).
- **No downloading of mod files.** ModWrench does not download, install, or
  manage mods. It reads metadata and links the user back to the mod page.
- **No bulk fetching, no mirroring, no caching of your data.** Requests are made
  one at a time in response to a user's question. Nothing from your API is
  written to disk or persisted anywhere.
- **Every request identifies itself** with `Application-Name: ModWrench` and
  `Application-Version`, plus a User-Agent naming the project and its repo, on
  the REST endpoints, the GraphQL endpoint, and the one CDN fetch used for file
  content previews.
- Requests go through a shared client with a concurrency cap, retry with
  backoff, and 429 handling.

## What I am asking for

**1. Application registration and a client ID.**

The Acceptable Use Policy asks public-facing applications to register rather than
run on users' personal API keys, and I would like to do this properly rather than
ship on personal keys. The OAuth PKCE flow is already implemented and tested — it
only needs a client ID to become the default path.

Until then I have made the personal-key path explicit about its status. The CLI
and README both tell users plainly that ModWrench is not a registered Nexus
application, that the AUP tolerates personal keys for personal use rather than
public applications, and that any consequence would land on their key rather than
mine. I would rather say that out loud than quietly rely on it.

The AUP mentions that including source may speed up review — the full source is
public at the link above, and the Nexus integration is under `packages/nexus/`.

**2. A clarification on Terms of Service Section 11.**

Section 11 prohibits automated analysis of site data and states that Nexus data
may not be used "for the purposes of developing, training, fine-tuning or
validating any AI system or model."

ModWrench does none of those things. No model is trained, fine-tuned, or
evaluated, and nothing from your API is retained. What happens is that data your
API returns to a user's own request is passed into that user's AI assistant so it
can answer their question — inference at the moment of asking, then discarded.

My reading is that this is outside what Section 11 is aimed at, which appears to
be scraping and dataset construction. But the clause is broad enough that I would
rather have your answer in writing than rely on my own interpretation, and the
clause itself points here for exemptions.

If you see this differently, I would genuinely like to know before release rather
than after. If there are conditions that would make it acceptable — rate limits,
attribution requirements, specific endpoints to avoid — I will implement them.

## On AI tooling generally

I am aware this arrives during a period when a lot of AI-adjacent projects have
made modding communities justifiably wary. For what it is worth about where this
one sits:

ModWrench generates no mod content. No assets, no code, no voices, no text
intended to ship inside anyone's mod. It reads and explains. It does not rate,
rank, or review mods, and it links users back to mod pages rather than standing
in front of them.

The project publishes a `TRUST.md` stating exactly what it does and does not do,
including the parts that are awkward, along with the commands to verify each
claim against the source:
https://github.com/171county/modwrench/blob/main/TRUST.md

If any of that conflicts with how you would want a third-party tool to behave, I
would rather adjust it now.

Thank you for your time, and for keeping the API open to third parties at all.

Sean B.
Nexus: 171county
https://github.com/171county/modwrench

---

## Notes before you send

- **Check the Nexus username.** I have used `171county` because that is your
  GitHub handle; if your Nexus account differs, correct it.
- **Use a contact address you are willing to keep.** This becomes the registered
  contact for the application.
- **Attach or link a testing build if they ask.** The AUP's registration process
  mentions supplying a build usable with a personal API key — `npx -y
  @modwrench/cli` covers that once published, and the repo covers it now.
- **Expect the Section 11 answer to take longer than the registration.** It is a
  legal question, not a support one. If they answer the registration and ignore
  Section 11, follow up on it separately rather than treating silence as consent.
- **Do not ship a Nexus client ID as a secret.** A public OAuth client ID is not
  a secret and is fine to ship; a client *secret* is not, and the PKCE flow does
  not need one.
