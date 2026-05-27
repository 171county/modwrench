# ModWrench Comms Playbook

**Purpose:** How to talk about ModWrench in public — to modders, to creators, to the MCP/AAIF ecosystem, to journalists if they ever call. Where the landmines are, what to say, what to never say, how to handle the first 48 hours after each launch beat.

**Why this exists:** The modder ecosystem research surfaced that this community has been burned repeatedly — by Bethesda's paid-mod attempts, by Overwolf bundling, by Patreon paywall scrapers, by platforms changing terms without warning, by AI hype that didn't respect creator consent. Trust is built sentence-by-sentence here, and it's lost the same way. This playbook is the firewall between "ModWrench is a tool I trust" and "ModWrench is another thing trying to extract from the community."

---

## Part 1 — The Core Messaging Pillars

Everything you say in public should ladder up to one of four pillars. If a message you're about to send doesn't fit any of them, rewrite it.

### Pillar 1 — The Bridge

ModWrench is a *bridge*, not a destination. It does not host mods. It does not store user data. It does not aspire to become a platform. It exists so the platforms you already use can talk to the AI assistants you already use.

**Language that lives here:** *"a bridge"*, *"connects to"*, *"talks to"*, *"on your behalf"*, *"never in the middle"*, *"thin layer"*.

**Language to avoid:** *"the platform"*, *"the ecosystem"*, *"our community"*, *"users"* (use *"modders"*).

### Pillar 2 — No Data

ModWrench holds nothing about you. API tokens are in your OS keychain. Conversations stay in your AI client. There is no telemetry, no analytics, no anonymous usage stats, no "improve product" pings. This is not a privacy policy — it's the architecture.

**Language that lives here:** *"no data kept"*, *"in your keychain"*, *"never sees your..."*, *"stays on your machine"*, *"no telemetry, ever"*.

**Language to avoid:** *"we take privacy seriously"* (corporate tell), *"anonymized"* (modders know this means trackable), *"opt-out"* (the wrong direction — there's nothing to opt out of).

### Pillar 3 — Attribution Forever

Mod author names, source platforms, and original mod URLs survive every operation ModWrench does. The LLM is *instructed* to preserve them. Tools that handle creator content respect creator permissions. This isn't a feature — it's a constraint.

**Language that lives here:** *"author always credited"*, *"permissions respected"*, *"your work stays yours"*, *"no asset reuse without permission"*.

**Language to avoid:** *"content"* when you mean *"someone's mod"* (modders hear "content" as the language of platforms that don't understand what they're moving).

### Pillar 4 — A Workflow Tool, Not a Generator

ModWrench helps you ship, debug, publish, and maintain. It does not write mods. It does not generate art. It does not produce voices. The LLM you connect to it may do those things on its own — ModWrench provides no tools that assist in that.

**Language that lives here:** *"workflow assistant"*, *"helps you ship"*, *"reduces friction"*, *"your mod is your mod"*.

**Language to avoid:** *"AI-powered"* (triggers immediate suspicion), *"intelligent"* (vague, marketing-coded), *"generative"* (specifically toxic in mod culture right now), *"automated content"*.

---

## Part 2 — The Specific Things You Will Be Asked

These come up. Have the answers ready before the first thread blows up.

### "Why should I trust you?"

> *"You shouldn't yet. Try it on a throwaway API token first. Read the source — it's Apache 2.0 on GitHub. ModWrench has six hard rules baked into the architecture: no telemetry, no personal data stored, attribution preserved, permissions respected, rate limits respected, read-only by default. Those aren't promises in a privacy policy — they're constraints in the code. If you find a violation of any of them, that's a bug and I'll fix it. If you can't find one, that's the trust earned slowly."*

Why this works: it doesn't ask for trust, it offers a verifiable claim and an audit path. Modders respect skepticism.

### "Is this an Overwolf thing?"

> *"No. ModWrench is independent. Apache 2.0 license. No parent company. The 'no data kept' rule is non-negotiable in part because it can't be true under most commercial structures, including Overwolf's. ModWrench has no plans to take investment, run ads, or bundle with any platform's distribution. If that ever changes, this answer changes too — and I'd tell you before it did."*

Why this matters: Overwolf is the elephant. Asking this is reasonable and you should answer cleanly without ever bashing Overwolf — they fund a huge chunk of the ecosystem. Independent without antagonism.

### "Does this use AI to generate mods?"

> *"No. ModWrench is a workflow tool. It helps you publish, debug crashes, manage load orders, and talk to mod platforms through your AI assistant. It does not write mods. It does not generate art, voices, meshes, or text content for your mods. The LLM you connect to ModWrench may do those things on its own — ModWrench provides no tools that assist in that. Your work is your work."*

Why this matters: this is the question that decides whether a creator engages with the project at all. Get it right and direct.

### "What's the catch? How does this make money?"

> *"It doesn't, and there isn't one. ModWrench is free and Apache 2.0. There's no paid tier, no premium features, no Patreon (yet — and if one ever exists it'll be for project costs, not for features). I built this because the modding community deserves better tooling than what the platforms ship by default. If it leads to consulting work, speaking invitations, or job offers in the AI tooling space down the line, that's fine — but that's downstream of building something people actually find useful, not upstream of it."*

Why this matters: the modder culture is suspicious of free-but-monetized-later patterns (because they've been burned by them). Saying "no business model" is more credible than naming one.

### "What happens to my Nexus / mod.io account if I uninstall ModWrench?"

> *"Nothing. ModWrench never had access to your account — only to a personal API key you generated and can revoke anytime from your account settings. Uninstalling ModWrench (deleting the package, deleting the config line in your AI client) ends every connection. Revoking the API key on Nexus and mod.io's sides is the belt-and-suspenders move."*

Why this matters: makes the exit ramp visible. Tools without visible exit ramps are tools people refuse to install.

### "Why not just contribute to Vortex / MO2 / r2modman instead?"

> *"Different layer. Those are mod managers — they install, organize, and launch mods on your machine. ModWrench is a bridge between AI assistants and the platforms where mods live. You'd still use your mod manager of choice; ModWrench just lets your AI assistant query the platforms intelligently. The hope is that future versions can read from Vortex / MO2 / r2modman state files (with your permission) so the AI knows what's actually installed, but ModWrench will never compete with them as a manager."*

Why this matters: defuses the perception that this is yet another mod manager. The compound workbench (v2) specifically respects existing managers.

### "I'm a creator on three platforms. Does ModWrench actually solve the cross-posting problem?"

> *"Not yet — that's v3. Today ModWrench is read-only on the platform side. v3 is the publishing fan-out: one mod definition, multiple platforms (Nexus + mod.io first, then CurseForge and Thunderstore). The model is MC-Publish (the Minecraft GitHub Action) — but conversational rather than CI/CD, because most modders outside the Minecraft community don't write GitHub Actions YAML for a living. If you want to be in the early testers when v3 lands, file an issue and tag it 'publish-beta-interest'."*

Why this matters: honest about what's not done. Invites creators into the build rather than pitching them on something that doesn't exist.

### "What about Bethesda Creations / Verified Creator support?"

> *"Possibly, eventually, but carefully. The Verified Creator program is politically sensitive in this community — three failed paid-mod rollouts, a 25% creator share, generative-AI bans, and an opaque approval process. ModWrench will not enable monetization-against-community-consent patterns. If there's a way to support Verified Creator publishing that genuinely serves creators, that's a v3+ conversation worth having. If there isn't, it stays out."*

Why this matters: the answer respects the community's view of Bethesda without naming Bethesda as an enemy. Position matters.

### "Will this work on Linux / Steam Deck?"

> *"Yes. ModWrench is TypeScript on Node.js — no Windows-specific dependencies. v2's environment detection explicitly handles Proton prefix paths and Steam Deck Game Mode. Linux-specific bugs are a priority, not an edge case. If something breaks on your distro or your Deck, file an issue."*

Why this matters: this group is underserved and loud about it. Saying yes here unlocks evangelism.

### "Can you add support for [obscure modding platform]?"

> *"Maybe — let's talk. Each platform is its own package (`@modwrench/<platform>`). The shape is documented in `docs/adding-a-platform.md`. If you're willing to help wire it (or even just write the API surface description), I'll prioritize it. If the platform has an existing community and a public API, it's a strong candidate."*

Why this matters: turns a feature request into a contribution path. Some of these will lead to PRs.

---

## Part 3 — Channel Strategy

Different communities, different tone, different timing. Here's the channel-by-channel playbook.

### Channel A — GitHub (the canonical home)

**Tone:** Direct, technical, calm. Issues get acknowledged within 24 hours even if not resolved. Maintain a single source of truth here.

**First post:** None — GitHub doesn't get "posts," it gets a README and an Issues tab. Your launch post on Reddit and Discord will *link* to GitHub, and the first 48 hours of GitHub traffic will be people clicking that link, scanning the README, scanning the Issues, and deciding whether to install.

**What to have ready before any launch post goes out:**

- README in final form (you have this)
- LICENSE file (Apache 2.0)
- CONTRIBUTING.md (next file in this sequence)
- 3-5 starter issues labeled `good-first-issue` and `help-wanted` (this is how serious contributors evaluate "is this a real project")
- A pinned issue: *"v2 Compound Workbench — design discussion"* — invites architectural input
- Issue templates (bug report, feature request, platform support request)
- An empty `.github/DISCUSSIONS` enabled so people can post Q&A without filing issues

**Tactical note:** Star count is the social-proof metric people will glance at. You don't ask for stars in your launch post — that's tacky in modder culture — but if a friend or two stars the repo before launch, that's normal and helpful. Three stars looks like a personal project; thirty stars looks like a thing worth investigating.

### Channel B — Reddit

The biggest discovery surface for modders. Also the highest-stakes channel because Reddit posts age into permanent search results. A bad first post on `r/skyrimmods` becomes the second Google result for "ModWrench" for years.

**Subreddits to target, in priority order:**

1. **`r/skyrimmods`** (~700K subscribers) — the canonical Bethesda modding sub. Strict rules. Read the wiki and the rules sidebar before posting.
2. **`r/SteamDeck`** — if your Linux/Deck support is solid, this is a huge audience.
3. **`r/lethalcompany`** + **`r/RiskOfRain2`** + **`r/valheim`** — Unity co-op modder subs. Smaller but more receptive to tooling.
4. **`r/feedthebeast`** + **`r/MinecraftMod`** — Minecraft modders. Sophisticated audience, will compare directly to MC-Publish.
5. **`r/thesims4`** + **`r/Sims4`** + **`r/thesims`** — Sims modding has a different culture (more design-focused, less code-focused). Frame the value prop accordingly.
6. **`r/LocalLLaMA`** + **`r/ChatGPT`** + **`r/ClaudeAI`** — AI-adjacent subs. Different audience entirely — they want the MCP/protocol angle, not the modding angle. Different post for these.

**The launch post template (for `r/skyrimmods` first):**

> **Title:** *"I built a free MCP tool that lets your AI assistant talk to Nexus and mod.io directly — looking for testers"*
>
> *I've been working on a tool called ModWrench. It's an MCP server (the Model Context Protocol thing Claude and ChatGPT use for tools) that lets your AI assistant search Nexus, read mod changelogs, check versions, look up authors, browse by tag — all from inside whatever AI client you use.*
>
> *Currently has 14 tools each for Nexus Mods and mod.io. Free. Apache 2.0. No telemetry. API keys live in your OS keychain. The whole project is intentionally a bridge — it holds nothing about you.*
>
> *It's NOT a mod manager (use Vortex/MO2/whatever), and it does NOT generate mod content. It's a workflow tool that lets you ask your AI things like "what's the changelog on the latest version of [mod]" or "what lighting overhauls are tagged ENB-free and updated this year" without context-switching to a browser.*
>
> *Looking for 5-10 testers to try it before I push it harder anywhere. Especially interested in: people running 100+ mod load orders, Steam Deck/Linux modders, and anyone who manages mods across both Nexus and a platform like mod.io.*
>
> *GitHub: [link]*
> *Install instructions: in the README*
>
> *Happy to answer any questions about the architecture, the "no data" claim, or where this is going. v2 is a crashlog/load-order diagnostic assistant — that's the next thing.*

**Why this works:**

- Title is descriptive, not clickbait-y
- Opens with what it is, not what it could be
- Names what it isn't (mod manager, generator) in the first 3 sentences — addresses the predictable suspicion immediately
- Explicit "looking for testers, not users" framing — modders trust early-stage honesty
- "5-10 testers" is humble — not "I built the future of modding"
- Names specific audiences who'd benefit (high-mod-count users, Steam Deck users, multi-platform users)
- Offers to answer architecture questions — invites scrutiny, doesn't deflect it

**What NOT to do:**

- Don't title the post anything ending in `!` or with caps
- Don't say "revolutionary" or "game-changing" or "the future of"
- Don't promise features that aren't shipped
- Don't compare yourself directly to other tools by name — let users do that
- Don't reply defensively to skeptical comments — see Part 4

**Timing:** Tuesday or Wednesday, mid-morning US Eastern. Avoid Fridays (everyone's tired, posts age out fast), weekends (mods are stricter, fewer eyeballs), and Mondays (everyone's catching up). Avoid major patch days for popular games.

**Follow-up rhythm:** Reply to every comment in the first 12 hours, even one-word replies. Visible engagement signals "real person, real project." After 48 hours, you can taper off but check daily for two weeks.

### Channel C — Discord

Discord is where the actual modding conversations happen. Reddit is the front door; Discord is the kitchen.

**Servers worth being in (not for promotion — for listening):**

1. **The official Nexus Mods Discord** — large, generally serious, has a `#mod-development` channel
2. **The Skyrim modding Discord** (also Wabbajack-affiliated) — power users
3. **The Lethal Company modding Discord** — Thunderstore-affiliated
4. **The r2modman Discord** — small but extremely technical
5. **The Modrinth Discord** — for the Minecraft-side eventual expansion
6. **The MCP Dev Summit / AAIF Discord** — different audience entirely

**The "soft launch" Discord posting pattern:**

> Don't post a launch announcement in any modding Discord as your first contribution. Join the server. Read the channels for 2-4 weeks. Help someone with a question if you can. Reply to a few discussions. *Then* — and only then — when ModWrench naturally comes up (someone's debugging a crash, someone's asking about Linux Steam Deck modding, etc.) — mention it once. Not as a promotion. As a "here's a tool that might help with this specific thing."

This is the slowest-feeling approach and also the highest-converting one. Discord modders are tribal and they sniff out drive-by promoters within minutes.

**One exception:** the AAIF / MCP Discord. That community wants to hear about new MCP servers, so a normal "I built this MCP server, here it is" post is appropriate there. Frame it as MCP infrastructure, not modding (different audience, different framing).

### Channel D — Nexus Forums

The Nexus site has its own forums, and they're underused these days but still indexed by Google. A polite "tool announcement" thread in the right Nexus sub-forum gets you indexed for the next decade.

**Important:** read Nexus's site rules carefully before posting any tool. They have specific policies about what third-party tools can do with their API and what's appropriate to advertise on the forums. Be in compliance, or don't post.

**If you post:** Use the same tone as the Reddit post but slightly more formal. Nexus forums skew older, slightly less tolerant of casual language. Avoid memes, avoid emoji-heavy posts.

### Channel E — mod.io Community

mod.io's community is smaller and more developer-focused than Nexus's (because mod.io is embedded in games rather than a destination site). The right contact point here might actually be mod.io's developer relations directly — they would likely be interested in a third-party tool that makes their API more accessible.

**Tactical move:** Once ModWrench is solid, email `support@mod.io` or reach out via their developer channels with a friendly *"hey, built a thing that uses your API, here's what it does, just letting you know in case you're curious."* This is not promotion — it's professional courtesy. mod.io will not be hostile; they might be helpful.

### Channel F — Hacker News

A *post-launch* channel, not a launch channel. Hacker News is where you go after the modder communities have given the project a few weeks of social proof.

**The HN angle:** *"Show HN: ModWrench — an MCP server for game modding platforms"*. The audience here doesn't care about Skyrim — they care about the MCP architecture, the "no telemetry" stance, the open-source posture. Frame it as infrastructure.

**Timing:** Don't post until you have at least 100 GitHub stars and at least one issue from someone you don't know. HN respects organic growth signals.

### Channel G — LinkedIn / your professional surface

The audience here is the career-growth surface from your `userPreferences`. The story is *"I built MCP infrastructure for the game modding community, here's what I learned about agentic tooling, here's the AAIF/MCP ecosystem context."* This is the post that gets noticed by recruiters in the AI tooling space.

**Tactical:** Don't post on LinkedIn until you can point to either (a) installable npm packages with non-trivial download counts, or (b) coverage in a respected publication, or (c) someone notable using ModWrench publicly. Posting too early to LinkedIn looks aspirational; posting after traction looks like you're a builder.

### Channel H — YouTube modding channels (the long game)

The dream long-tail surface. If GamerPoets, MxR Mods, or similar Skyrim-focused YouTubers cover ModWrench in a video, you've hit the modder community's central trust gateway. You don't pitch them — you build something good enough that they hear about it organically, or you reach out only after social proof exists.

**Realistic timeline:** 6-12 months minimum. This is not a launch channel; it's a sustenance channel.

---

## Part 4 — Handling Hostile / Skeptical Reactions

Some of this will happen. Have a posture ready.

### The "this is just an AI grift" reply

Someone will say this. Probably in the top-10 comments of your first Reddit post.

**Don't:** Get defensive. Explain at length. Engage in extended back-and-forth.

**Do:** Reply once, briefly, factually.

> *"Reasonable suspicion — the AI tooling space has earned it. ModWrench specifically doesn't generate mod content; it's a workflow tool for talking to Nexus/mod.io APIs from your AI assistant. Source is on GitHub if you want to audit the "no data" claim. If it's not for you, that's fine."*

Then move on. Don't reply to the inevitable follow-up.

### The "why does this need AI at all" reply

This is a fair question. The answer is genuine.

> *"It doesn't need AI for the basic API calls — you can hit the Nexus API with curl and a JSON parser. What AI adds is the conversation layer: you can ask 'show me lighting overhauls without ENB that work on 1.6.1170' in plain English instead of constructing a query. For people who already use Claude or ChatGPT alongside their modding setup, ModWrench just means those tools know about your modding world. For people who don't use AI assistants, it's not for them and that's fine."*

### The "is this safe to give my API key to" reply

Important question. Answer factually.

> *"It only ever has access to what your API key has access to (read operations). The key lives in your OS keychain (Windows Credential Manager / macOS Keychain / Linux libsecret), not in a config file. ModWrench's process reads the key when it needs to make an API call, then forgets it. You can revoke the key from your Nexus/mod.io account settings any time. The source code is Apache 2.0 — you can audit the keychain handling in `packages/core/src/auth/`."*

### The "Overwolf is going to buy you" reply

Inevitable joke. Handle with humor, don't bash Overwolf.

> *"They fund a real chunk of the ecosystem and they've been good to a lot of creators. ModWrench's 'no data kept' rule is structurally incompatible with most commercial models including Overwolf's, so I don't expect this scenario, but I respect their business. If anyone makes an offer that would change the no-data posture, the answer's no — and I'd tell the community before it changed."*

### The "you're just doing this to land an AI job" reply

Sometimes true and sometimes worth saying so.

> *"It might end up doing that. I'm not hiding that I work in this space and that visible projects help. But the only way that works is if the project is actually useful, and the only way to find out is to build it openly and see if people use it. If it's useful to you, great. If it lands me an interview somewhere down the line, also great. Neither requires the other."*

Honesty here is more credible than denial.

### The "I tried it, it broke" reply

The most valuable reply you'll get. Treat it like gold.

> *"That's exactly the kind of report I need. Could you open an issue on GitHub with: your OS, your AI client (Claude Desktop / Claude Code / Cursor / etc.), the command or query that broke, and any error message? I'll dig in."*

Direct them to GitHub Issues. Solve the issue publicly. The fix in the changelog becomes the next post's social proof.

### The hostile attack-message

Sometimes — rarely — someone is just angry. Tool projects in modding communities have triggered drama in the past. The hostility may not be about you specifically.

**Don't:** Engage. Don't argue. Don't try to convert them.

**Do:** Reply once, neutrally, if at all. *"Sorry it's not for you. Thanks for the feedback."* Then disengage. Modder culture respects people who don't fight on the internet.

**If it escalates** (personal threats, doxxing, sustained brigading): report to the subreddit mods or Discord admins, document everything, and step back from the channel for 48 hours. Don't respond. The community will usually self-correct if you don't fuel it.

---

## Part 5 — The Escalation Playbook

What to do if something goes seriously wrong.

### Scenario: A security issue is reported

Someone finds (or claims to find) a way ModWrench leaks data, mishandles API keys, or violates one of the six rules.

**Within 1 hour:**
- Acknowledge publicly (even if you haven't verified yet): *"Reviewing this now — pulling the published package as a precaution while I verify."*
- Mark the npm package as deprecated if the claim is plausible: `npm deprecate @modwrench/cli@x.y.z "investigating security report"`
- Open a public issue with details (redact if needed)

**Within 24 hours:**
- Confirm or deny the issue with technical detail
- If confirmed: push a fix, publish a new patch version, write a postmortem
- If unconfirmed: explain what you verified and what evidence you needed

**Postmortem template:**

> *"On [date], a security concern was raised about ModWrench [link to issue]. Here's what happened, what I found, what I changed, and what I'm doing differently."*

Modders respect public postmortems more than they respect "we take security seriously" PR. Be specific.

### Scenario: A platform pulls API access

Nexus, mod.io, or another platform decides ModWrench is violating their ToS and revokes access.

**Don't:** Bash the platform publicly.

**Do:** Reach out to the platform directly. Email, ticket, whatever channel they prefer. Ask what specifically violated their terms. Fix what's fixable. If it's not fixable, deprecate that platform's package and explain to users.

Communicate to users:

> *"As of [date], ModWrench's [platform] integration is paused while I work with [platform] on a compliance question. I'll update this thread when there's resolution. Your data is unaffected — ModWrench never had any to lose."*

Notice the last sentence. Even in a bad-news moment, you reinforce the trust position.

### Scenario: Someone forks ModWrench and adds telemetry

Apache 2.0 allows this. It will eventually happen if the project is successful.

**Response:** Document clearly that the official ModWrench at `github.com/<your-username>/modwrench` is the one with the no-data rule. Trademark "ModWrench" if you haven't already (cheap, $250-$350 USPTO filing — see `oss-ip-foundations` skill). A fork called "ModWrench-with-analytics" cannot use the ModWrench name legally if the mark is registered. A fork called something else with ModWrench's code is fine and Apache-2.0-permitted; users will choose.

### Scenario: An LLM provider deprecates an API you depend on

Less likely but possible. Anthropic changes MCP transport semantics, OpenAI changes Responses API tool format, etc.

**Response:** Versioning is your friend. Pin ModWrench's dependencies. When breakages happen, ship a compatibility patch within days. Users on older AI clients should keep working on older ModWrench versions.

---

## Part 6 — Things You Will Be Tempted To Do That You Should Not Do

A short list of mistakes that are easy to make and hard to recover from.

### Don't crowdsource the name change

If "ModWrench" doesn't work and you need to rename, decide privately and rename once. Public name-changing-by-polling looks indecisive and you lose the early SEO/recognition you've built. The current name is fine.

### Don't add a Discord server too early

A Discord server with 4 people in it looks worse than no Discord server. Wait until you have ~50 GitHub stars or ~10 issues from people you don't know before opening one. Until then, GitHub Discussions is enough.

### Don't accept money before you've thought about it

If someone offers to sponsor ModWrench, donate via PayPal, send Bitcoin, etc., your default answer is *"thanks, not set up to accept anything right now."* Accepting money creates obligations you may not want, and it muddies the "no commercial agenda" positioning. When the time comes — and it might, for hosting costs or domain renewals — set up GitHub Sponsors or Open Collective with full public transparency. Not before.

### Don't promise features in casual replies

If someone says *"can it do X?"* and you reply *"yes I'll add that this weekend,"* you've made a promise. File the issue, label it, prioritize honestly. *"That's on the v2 list — file an issue if you want to track it"* is the better reply.

### Don't argue with critics in public

Already covered, but it's worth saying twice. Every minute spent arguing with a critic is a minute you didn't spend building something that makes them irrelevant.

### Don't post the same thing in five subreddits at once

Reddit's anti-spam systems will detect this and shadow-ban you. Post in one subreddit, let it run for 24-48 hours, then post in the next. Tailor each post slightly to the subreddit's culture.

### Don't claim numbers you don't have

If GitHub stars are at 12, don't say "growing community." If downloads are at 50, don't say "thousands of users." Modders read the README, look at the GitHub stats, and form an opinion in 30 seconds. Inflated language collapses that opinion fast.

### Don't make ModWrench an identity

ModWrench is a project. You are a person who builds projects. If ModWrench fails to gain traction, that's data, not failure. If ModWrench succeeds beyond your wildest expectations, that's a new set of problems. Either way: don't let the project become "who you are." That's how burnout happens.

---

## Part 7 — The First 30 Days: A Suggested Cadence

A rough schedule for the launch month. Adjust to your life.

**Days 1-3:** Final README pass. LICENSE file. CONTRIBUTING.md. Issue templates. Push to public GitHub. Get 3-5 starter issues filed. Submit to MCP Registry. Tell three close friends — they each star the repo. (Not asking for favors — just letting them know.)

**Day 4-5:** Post in the AAIF/MCP Discord and the MCP Registry's announcement channel. Frame it as MCP infrastructure. Get the first technical feedback from people who care about the protocol, not the modding side yet.

**Days 6-7:** Reread the README based on what you learned in days 4-5. Polish.

**Days 8-10:** Post to `r/skyrimmods` using the template above. Reply to every comment for the first 12 hours. Be patient with skepticism. Be honest about what works and doesn't.

**Days 11-14:** Based on response, decide next subreddit. Probably `r/SteamDeck` or `r/lethalcompany` depending on what feedback you got. Same pattern.

**Days 15-21:** Begin lurking in 2-3 Discord servers (Nexus, Lethal Company modding, r2modman). Help with one or two unrelated questions per server. Don't post about ModWrench unless it naturally fits an existing conversation.

**Days 22-28:** First "what I learned" follow-up post on the original Reddit thread or in GitHub Discussions. *"Two weeks in, here's what's working, here's what's broken, here's what's next."* This is the post that builds long-term trust — the first transparent retro.

**Days 29-30:** Reflect privately. What's the actual usage pattern? Who's actually filing issues — modders, AI tinkerers, or randoms? What does v2 need to look like based on this evidence? Write down what you learned in `docs/launch-retro.md` (it doesn't need to be public).

---

## Part 8 — One Page Cheat Sheet

For when you're about to send something and don't have time to reread this doc.

**Before posting anywhere, check:**

- [ ] Does this ladder up to one of the four pillars (Bridge / No Data / Attribution Forever / Workflow Tool)?
- [ ] Am I claiming any feature that isn't shipped?
- [ ] Am I comparing to a competitor by name?
- [ ] Did I use any of the forbidden phrases (*"AI-powered"*, *"intelligent"*, *"generative"*, *"revolutionary"*, *"game-changing"*)?
- [ ] Is my title descriptive rather than clickbait?
- [ ] Is there an exit ramp visible (uninstall, revoke, audit)?
- [ ] Did I leave room for the reader to be skeptical without me getting defensive?

**Default responses:**

| Situation | One-line reply |
|---|---|
| Hostile / accusatory | *"Sorry it's not for you. Thanks for the feedback."* |
| Suspicious / skeptical | *"Reasonable. Source is on GitHub if you want to verify."* |
| Curious / engaged | *"Happy to dig in — what's the modding setup you'd use it on?"* |
| Bug report | *"That's the kind of thing I need to know — could you open an issue with [OS/client/command]?"* |
| Feature request | *"Good idea — file it as an issue, I'll triage. No promises on timeline."* |
| "Why does this need AI?" | *"It doesn't, for the API calls. AI adds the conversational layer — you can ask in plain English instead of constructing queries."* |
| "Is this safe?" | *"API keys live in your OS keychain, not in a file. Read-only by default. Revoke any time from your account settings."* |

---

*ModWrench Comms Playbook — synthesized from the modder ecosystem research. Style-matched to existing project documents. Read before each significant public posting. The defaults are calibrated; deviate only with reason.*
