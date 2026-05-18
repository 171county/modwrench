# Volume III: The Modder Ecosystem — A Foundation Report for ModWrench (May 2026)

**Scope:** Cross-community survey of the game modding ecosystem, weighted ~70% creator-side and ~30% user-side, covering pain points, tool landscape, culture, and economics. Communities surveyed: Bethesda (Skyrim/Fallout/Starfield), Unity co-op (Lethal Company / Valheim / REPO / Risk of Rain 2), Minecraft, The Sims 4, and the adjacent UGC platforms (Roblox, UEFN / Fortnite Creative).

**Purpose:** Foundation document for the ModWrench MCP product. Identifies the workflows and friction points where conversational AI tooling has defensible value, weighted toward where no incumbent solution exists.

---

## TL;DR

- **The cross-posting problem is largely unsolved everywhere except Minecraft.** Minecraft creators have a working CI-pipeline solution (MC-Publish, the GitHub Action that publishes to CurseForge + Modrinth + GitHub Releases from one commit). Bethesda, Unity-co-op, Sims, and most other communities have nothing equivalent. A creator who wants reach manually uploads to 3–5 platforms per release. This is the highest-leverage creator-side opportunity in 2026.
- **Crash-log interpretation is partly solved by static analyzers but breaks down on the long tail.** Phostwood's Skyrim Crash Log Analyzer handles 75–90% of identifiable crashes for 200+ modders daily after 750+ hours of pattern-matching work. The remaining 10–25% is exactly where an LLM with load-order context wins, and no one has built that.
- **The economics are unequal by an order of magnitude across platforms.** Roblox paid $1B+ to creators March 2024–March 2025 but at only ~25–28% effective revenue share. UEFN/Fortnite pays up to 74% on direct item sales (100% promotional through January 2027) on a smaller $352M+ pool. Nexus pays roughly $325K/month in donation points to ~tens of thousands of authors (effectively $1 per ~1,000 downloads on a hidden algorithm). mod.io creators see 20–40% (default ~28%) after the marketplace fee stack. CurseForge advertises a 70% share of ad revenue (not direct sales). Most mod creators across all communities earn well under minimum wage from platform monetization; the real money is Patreon.
- **Mod theft is a 20-year-old wound that has never healed.** The 2016 Bethesda.net console-port wave, ongoing Patreon paywall scraping, and current generative-AI training fears all activate the same modder reflex: *attribution is sacred, permissions are non-negotiable, and platforms that fail to police theft are seen as complicit.* Any tool entering this space needs to treat attribution as a first-class data field, not an afterthought.
- **Bethesda's "Creations" (the Verified Creator Program) is the modding community's structural enemy.** Three failed paid-mods attempts since 2015. Each rollout broke existing mods, and each generated review-bombs and exodus chatter. Yet Bethesda will not stop — the program persists despite community hostility because it's a strategic priority. Modders treat this as the canonical "studios trying to capture the value they didn't create" story, and any tool that ships a "monetize-with-one-click" feature for Bethesda games is suspect by default.
- **The mod manager landscape has settled into three clear lanes.** Vortex (Nexus-owned, beginner-friendly, multi-game) for variety. Mod Organizer 2 (MO2) for serious modders running 200+ load orders. r2modman / Thunderstore Mod Manager for Unity co-op games. CurseForge App for Minecraft/Sims/WoW. These do not interoperate well, and the user is expected to know which one fits their game.
- **The anti-AI sentiment in modding is real but uneven.** Bethesda explicitly bans generative AI in Creations content. Many creators block AI training. Yet the same communities use AI-assisted crash analysis, AI-aided Papyrus scripting, and AI summaries of mod descriptions. The pattern: AI as *workflow tool* is grudgingly accepted; AI as *creator substitute* is rejected. ModWrench is firmly the former.
- **The Linux/Steam Deck / cross-platform modding tide is rising.** Nexus Mods is building a new cross-platform app (work began on Skyrim SE support in 2025). r2modman ships first-class Linux/Steam Deck support. BepInEx works on macOS via tools like `gib`. Windows-only assumptions in modding tooling are increasingly a liability.
- **Overwolf is the elephant.** Owns CurseForge (2020), Tebex (monetization), Thunderstore Mod Manager wrap (the "Overwolf-version of r2modman"), and ~165–178K creators across its umbrella. Loved for funding the ecosystem, distrusted for ads and bundling. A tool that respects the user's choice of mod manager (and doesn't push Overwolf surfaces) carries an instant trust premium.

---

## Key Findings

1. **MC-Publish (Kir-Antipov, GitHub Action) is the only working cross-platform publishing pipeline in modding.** It targets CurseForge + Modrinth + GitHub Releases for Minecraft mods. The pattern is generalizable to every other modding community but has not been generalized — that's the open lane.

2. **Phostwood's Skyrim Crash Log Analyzer is the unofficial industry baseline for automated crash diagnosis.** 200+ daily users, ~300 crashes analyzed per day, 75–90% identification rate on common crashes, 750+ hours of curated pattern-matching. The hard-coded approach hits a ceiling on novel mod combinations — that's the LLM gap.

3. **Nexus Mods Donation Points pays out roughly $325K/month, distributed via an opaque algorithm hidden since August 2024.** The pool has been steady but author-reported per-mod payouts have declined; the community survey thread "Donation Points Survey 2025" tracks this as a persistent grievance. Payout: NET90. Cashout: PayPal or in-platform store credit.

4. **mod.io's effective creator share is ~28%** on a default 70/30 studio split, varying 20–40% based on per-game configuration. The marketplace is currency-pack based ($0.01 per credit, $0.0052 wholesale to mod.io). 30-day hold on creator credits before payout via Thunes. Annual platform revenue ~$10.1M (Growjo, 2026), 55 employees, $26M Series A, based in South Melbourne.

5. **CurseForge / Overwolf pays 70% of ad revenue to authors via a points system** redeemable as PayPal or Amazon gift cards. Discrete subscription product ("CurseForge Premium") added 2024–2025. DLC-level paid mods exist in narrow categories.

6. **Roblox paid $1B+ to creators March 2024–March 2025 but at an effective ~25–28% take rate** after platform cuts, marketplace fees, and DevEx exchange ($0.0038/Robux). 400M+ MAU, 112M+ DAU. Highest absolute payouts; lowest revenue share among major UGC platforms.

7. **UEFN / Fortnite Creative pays up to 74% direct item revenue (100% promotional through January 31, 2027)** on a smaller $352M 2024 engagement pool. 58+ creator-millionaires minted. Direct item sales launched January 2026 with Verse-based API. Epic explicitly markets the rate gap vs Roblox.

8. **The "Bethesda Creations" program (Skyrim, Fallout 4, Starfield) is the only paid-mod marketplace that has survived community backlash for 8+ years**, but its creator share remains the controversial 25% from 2015. Three rollouts (Creation Club 2017, Creations 2023, Verified Creator Program ongoing). Generative AI is explicitly banned in Creations content.

9. **The Sims 4 community has a parallel "Patreon Early Access" economy** that survived EA's 2022 attempt to ban paid mods. Top Sims creators (Felixandre, HeyHarrie) have 4,000+ patrons at $2–6/mo, generating Patreon-side incomes that dwarf any platform donation system. CurseForge launched a Sims 4 "Mod Hub" via partnership with EA/Maxis in November 2022.

10. **Vortex vs MO2 is the religious war of the Bethesda modding scene.** Roughly: Vortex for breadth (multi-game, lower friction, Nexus-owned), MO2 for depth (single-game profiles, virtual file system, used by Wabbajack/Nolvus). Both are free, both have active development. Neither has a public scripting/automation API that an MCP could cleanly wrap as of mid-2026.

---

## Section A — The Communities

A useful frame: modders don't think of themselves as "modders" in a unified sense. They think of themselves as Skyrim modders, Lethal Company modders, Sims creators, Minecraft modpack authors. Each community has its own tools, vocabulary, and dramas. Multi-platform tooling has to respect that and meet each community where it is.

### A1. Bethesda games (Skyrim SE, Fallout 4, Starfield, Oblivion Remastered, Skyblivion)

The most institutional, most political modding community. Skyrim modding alone covers 72,000+ mods on Nexus and 27,000+ on Steam Workshop (Wikipedia, August 2024 figures). The community is built around:

- **Creation Kit (Bethesda's official editor)** — buggy, crash-prone, but the only path to editing ESM/ESP plugin files. Required for any serious quest/world mod.
- **xEdit / SSEEdit / FO4Edit / TES5Edit** — third-party plugin viewer, conflict detector, cleaner, patcher. The single most important tool a serious modder learns after a mod manager. Has a Pascal-based scripting interface (DelphiScript) that power-users automate.
- **LOOT (Load Order Optimization Tool)** — runs a community-curated masterlist of plugin sort rules. Auto-sorts the load order; flags incompatibilities. Built into Vortex; standalone for MO2 users.
- **Wabbajack** — community modlist installer. Curators (Aldrnari, Living Skyrim, The Phoenix Flavour, Keizaal) package complete modding experiences as installable bundles. MO2-first.
- **Nolvus** — the largest curated Skyrim SE modlist (~2,000 mods), with its own ascension/v6 install pipeline.

Community vocab: "ESP" / "ESM" / "ESL" (plugin types), "ITM" (Identical to Master record — a "dirty edit" to clean), "papyrus" (Skyrim's scripting language), "SKSE" (Script Extender — required infrastructure for advanced mods), "CTD" (Crash to Desktop), "Bashed Patch" (auto-merged compatibility patch). A new ModWrench user from this community will use these terms casually and expect the tool to understand them.

The Bethesda creator pipeline is the most fragmented: Nexus is the dominant home, Bethesda.net is the official console-friendly path, Steam Workshop is for Skyrim LE (original), and Bethesda Creations is the paid surface. Top creators publish to 3–4 of these. Cross-posting is *manual*.

### A2. Unity co-op horror/survival (Lethal Company, REPO, Valheim, Risk of Rain 2, BONEWORKS, Dyson Sphere Program)

Newer community, fast-growing, built almost entirely around Thunderstore + BepInEx. 5,000+ Lethal Company mods on Thunderstore by mid-2026 (per Switchblade Gaming guide, April 2026).

- **BepInEx** — the .NET/Unity/IL2CPP modding framework. Required for virtually every Unity-game mod. Auto-installed by r2modman as a dependency.
- **r2modman** — open-source, free, no-ads mod manager. The community standard for Lethal Company and friends.
- **Thunderstore Mod Manager** — Overwolf-wrapped r2modman. Has ads. Community attitude (per Steam discussions): "*don't get the thunderstore app it's cringe adware. get r2modman ... thunderstore mod manager is just a repackaged r2modman with ads slapped on top*"
- **Profile-sharing codes** — a Lethal Company–native feature: export a complete modpack as a code, paste into r2modman, get the exact same setup. Essential for co-op (everyone in the lobby needs identical mods).

Community vocab: "profile" / "modpack code", "Loader" (BepInEx), "config tweaks" (LethalConfig), "vanilla compat" (works on unmodded servers too).

Creator pipeline is *cleaner* than Bethesda because there's effectively one platform (Thunderstore) and the upload UX is straightforward. Cross-posting is rarer because Thunderstore is dominant for these games.

### A3. Minecraft

The largest modding community by raw user count. Three major mod loaders, two major hosts, deeply CI/CD-mature creator workflow.

- **Mod loaders:** Forge (oldest, largest library), Fabric (modern, performance-focused, optimization mods like Sodium live here), NeoForge (community fork of Forge, the modern Forge-path), Quilt (Fabric fork). Mods are typically loader-specific; some authors maintain Forge + Fabric + NeoForge ports.
- **Hosts:** CurseForge (Overwolf-owned, larger, paid via points system), Modrinth (open, dev-friendly, 75% ad rev to creators, smaller but rising).
- **Cross-platform code-sharing:** Forgified Fabric API and Sinytra Connector let Fabric mods run on NeoForge. Cloth Config API is the universal config library across all three loaders — 336.7M downloads on CurseForge alone.
- **Packwiz** is the Git-friendly modpack scaffolding tool. **MC-Publish** is the GitHub Action that auto-publishes to CurseForge + Modrinth + GitHub on tag push. This community has solved cross-posting via CI.

Community vocab: "modpack" (curated set), "shader" (visual mods), "resource pack" (texture replacement), "data pack" (vanilla-compatible content additions), "modloader" (Forge/Fabric/NeoForge).

Minecraft is the **least painful** publishing community, which makes it a poor v1 target for ModWrench's creator-side value prop but a great v2/v3 expansion target once you can match MC-Publish's automation.

### A4. The Sims 4

Distinct from every other modding community. Sims modders are roughly 70% CC creators (custom content — hair, clothing, furniture meshes), 30% script/gameplay modders. Heavy Patreon dependency.

- **CurseForge Sims 4 Mod Hub** — launched November 2022 via partnership with EA/Maxis. The "official" home, but didn't kill Patreon early-access culture.
- **Patreon early-access economy** — creators release mods to patrons first ($2–6/mo), then publicly weeks later. Top creators (Felixandre 4,433 patrons, HeyHarrie 4,293 patrons) generate $5–25K/mo in Patreon revenue alone — far more than any platform's donation system pays.
- **EA's 2022 policy attempt** — EA tried to ban all paid mods + permanent paywalls. Backlash within days. EA reversed course on early-access specifically, kept the ban on permapaywalls. Creators continue using "loopholes" (per Reddit discussions of CowBuild, PixelVibeSims).

Community vocab: "CC" (Custom Content), "Maxis Match" vs "Alpha" CC (art-style camps), "early access" (paid Patreon tier), "permapaywall" (the slur for content kept paid forever).

The Sims 4 Mod Hub has a real UX wound flagged by creators directly on Overwolf's idea board (March 2025): the new UI doesn't support posting early-access content, forcing creators to use the *legacy* CurseForge site for that. **This is an immediate ModWrench target** — wrap the legacy publishing flow and expose it as a clean MCP tool.

### A5. Adjacent — Roblox and UEFN/Fortnite Creative

Not "modding" in the classical sense (no game-binary modification) but the same fundamental shape: user-generated content for a host game with platform monetization. Cited here because they're where the *creator economy money* actually lives.

- **Roblox:** $1B+ paid to creators March 2024–March 2025. 112M DAU, 400M+ MAU. Effective ~25–28% creator share after DevEx ($0.0038/Robux). Multiple monetization channels (game pass, premium, ads, item sales). Hostile to traditional modding because game ownership = full Roblox-stack control.
- **UEFN / Fortnite Creative:** $352M paid via engagement payouts in 2024, $722M cumulative since UEFN launch (per Naavik 2026, Epic's September 2025 update). Direct item sales via Verse-based API launched January 2026; 74% revenue share (100% promo through Jan 31, 2027). 58 creator-millionaires. Higher per-creator economics, smaller total pool.

These platforms are *parallel universes* to traditional modding. A modder who's been on Nexus for 10 years can't trivially move to Roblox. But a ModWrench creator-side workflow that supports "publish to Roblox marketplace" or "publish to UEFN island" via API would be a unique multi-universe play. UEFN especially: it has a Verse-based developer API and was built with programmatic publishing as a first-class affordance.

---

## Section B — The Tool Landscape

A typical Bethesda modder runs 6–10 distinct tools to manage a serious 200-mod load order. A Lethal Company modder runs 2 (Thunderstore + r2modman + the game). A Minecraft creator might run 10 (IDE + mod loader + Packwiz + GitHub + MC-Publish + Modrinth web upload + asset tools). The tool landscape determines where MCP wrappers earn their value.

### B1. Mod managers

| Manager | Owned by | Primary games | Strengths | Weaknesses |
|---|---|---|---|---|
| **Vortex** | Nexus Mods | All Bethesda + ~100 others | Auto-deploy, LOOT integration, broad game coverage, beginner-friendly | Rule-based load order can hit "cyclic interaction" deadlocks at 100+ mods |
| **Mod Organizer 2 (MO2)** | Open source / Nexus-hosted | Bethesda primarily | Virtual file system, profile separation, scales to 1000+ mods | Steeper learning curve, single-game per instance |
| **r2modman** | ebkr (open source) | Lethal Co, REPO, Valheim, RoR2, Dyson Sphere | Free, no ads, Linux/Steam Deck native, profile codes | Limited to Thunderstore-hosted games |
| **Thunderstore Mod Manager** | Thunderstore × Overwolf | Same as r2modman | Same UX, Overwolf in-game features | Ads (the main reason power users prefer r2modman) |
| **CurseForge App** | Overwolf | Minecraft, Sims 4, WoW, ARK | Native to its ecosystem, one-click install | Overwolf bundle, Minecraft-Forum community has criticized as ad-funnel |
| **Nexus Mods app (new)** | Nexus Mods | Cross-platform (in dev for Skyrim) | First-party, in active development since 2025 | Not yet GA for Bethesda games as of May 2026 |

None of these have a public MCP server. None have a clean public API surface a third party can call to "install mod X with these settings into profile Y." This is a deeper Layer-2 opportunity — wrap the *local* mod manager file format directly (Vortex stores its state in JSON; MO2 in INI files), which gives an MCP tool the ability to read state without needing an official API.

### B2. Mod loaders / frameworks

- **BepInEx** — Unity/IL2CPP/.NET injector. Required for nearly all Unity-game mods. Versions: 5.x stable, 6.x bleeding-edge (IL2CPP-native). Auto-installed by r2modman + CurseForge App for relevant games.
- **SKSE / F4SE / FOSE / NVSE / SFSE / OBSE** — Bethesda script extenders. Mandatory infrastructure for most serious Bethesda mods. Tied to specific game .exe versions (a Skyrim update breaks SKSE until rebuilt).
- **Forge / Fabric / NeoForge / Quilt** — Minecraft. Mutually incompatible at the mod-binary level but increasingly cross-portable via Forgified Fabric API + Sinytra Connector.
- **MelonLoader** — Unity (older), .NET 6, alternative to BepInEx for some games.
- **ASI Loader, ScriptHook (V/RDR2), Ultimate ASI Loader** — for non-Bethesda, non-Unity games (GTA, Red Dead).
- **DLL hijack / DInput8 / d3d9 loaders** — for engine-injection at the binary level.

Loader compatibility is the #1 source of "why doesn't this mod work" frustration. An LLM tool that knows the loader graph for any given mod ID can answer "will this mod work with my BepInEx 5.4.23 setup" in one shot.

### B3. Conflict / load-order tooling

- **LOOT (libloot under the hood)** — auto-sorts plugin load order using a community masterlist of known incompatibility/sort rules. Bethesda games only.
- **xEdit family (TES4Edit, FNVEdit, FO4Edit, SSEEdit, EnderalEdit, etc.)** — Pascal-scripted plugin record viewer. Used for conflict detection at the record level (not the file level), patch generation, ESL conversion, masterlist cleanup.
- **Wrye Bash** — older, still in use. Bashed Patch merges leveled lists across mods automatically.
- **Mator Smash** — alternative to Wrye Bash for advanced merging.
- **zMerge** — automated plugin merging.

These tools all have scripting interfaces but no MCP wrappers. An xEdit scripting wrapper that lets an LLM say "scan my load order for stat-conflict between weapon mods and explain each one in plain English" is a genuine breakthrough — that workflow is currently expert-only.

### B4. Crash log analysis

- **Crash Logger SSE / Crash Logger AE / Crash Logger VR (FudgyDuff)** — MIT-licensed, generates the crash dump.
- **Buffout 4 / Buffout 4 NG** — Fallout 4 equivalent.
- **NetScriptFramework** — older Skyrim crash framework, still in use for some setups (notably older Nolvus versions).
- **CLAS / CLASSIC (Crash Log Auto Scanner)** — Buffout 4 companion. Pattern-matches ~250 known issues, integrates with game-file scanning.
- **Phostwood's Crash Log Analyzer** — Skyrim. Web-based. 200+ daily users, 75–90% identification rate. The most-used automated analyzer for Skyrim crashes in 2026.
- **Skyrim Crash Decoder** — web-based, paste-and-analyze. Smaller scope than Phostwood.

These are all *pattern matchers*. They work great when the crash signature is in their database. They fail when it's not — and they cannot reason across the user's mod combination. **This is the canonical LLM win** for ModWrench Layer 2: read the crash log, cross-reference the user's load order via the Nexus API or local mod manager, hypothesize the cause, suggest a test.

### B5. Asset / authoring tools (creator-side)

- **Blender** — 3D mesh editing. Open source. The de facto tool across all communities.
- **NifSkope** — Bethesda's NIF mesh format viewer/editor. Bethesda-specific.
- **Photoshop / Krita / GIMP** — texture work.
- **Substance Painter / Substance Designer** — PBR texture authoring.
- **Audacity / REAPER** — audio work (voice mods, music mods).
- **VS Code / Visual Studio / Rider** — code for Papyrus (Skyrim), C# (BepInEx plugins, Minecraft Fabric mods), Java (Minecraft Forge/NeoForge mods), Verse (UEFN), Luau (Roblox).
- **Creation Kit** — Bethesda's official editor. Required for ESP/ESM authoring.
- **Unreal Editor for Fortnite (UEFN)** — Fortnite Creative authoring; Unreal Engine 5.5 features.
- **Roblox Studio** — Roblox authoring.

The authoring tools are largely outside MCP scope (they're GUI-driven), but **publishing automation** sits between them and the upload step — that's where ModWrench lives.

### B6. Publishing / cross-posting

This is the section with the cleanest ModWrench opportunity.

| Tool | Coverage | Limitation |
|---|---|---|
| **MC-Publish (Kir-Antipov)** | Minecraft → CurseForge + Modrinth + GitHub | GitHub Action only; Minecraft-only; no Bethesda/Unity coverage |
| **Manual web uploads** | Everything else | Hours per release across 3–5 platforms per release |
| **mod.io SDK** | mod.io | Integrates into games that embed mod.io; not used for cross-posting |
| **Nexus Mods Upload API** | Nexus | Has API but rate-limited, requires manual permission setup |
| **Bethesda Creations Kit upload** | Bethesda.net | Buggy, crash-prone, console-port-specific |
| **CurseForge author dashboard** | CurseForge | Web UI; legacy interface required for Sims 4 early-access |
| **Modrinth API** | Modrinth | Clean REST API, 75% ad-rev to creators |
| **Thunderstore upload** | Thunderstore | Web UI + GitHub Actions support |

The Minecraft community has built CI-based cross-posting because Minecraft creator culture has unusually high CI/CD literacy (high overlap with professional Java devs). Bethesda, Unity-co-op, and Sims communities have much lower CI/CD adoption — they would benefit *more* from a conversational publishing tool than Minecraft does, precisely because they can't be expected to write GitHub Actions YAML.

**ModWrench publishing-side value prop, stated bluntly:** *"Talk to your AI: publish v1.4 of my mod to Nexus and mod.io with this changelog. Done."* No incumbent does this for Bethesda, Unity, or Sims.

---

## Section C — Creator Pain Points (heavy)

Five canonical pain points, ordered by ModWrench fit (highest first).

### C1. Cross-posting friction (THE creator opportunity)

A serious modder with a popular Bethesda mod might publish to:

1. Nexus Mods (the default audience)
2. Bethesda Creations / Verified Creator (console reach + paid option)
3. mod.io (cross-platform reach, increasingly important)
4. Mod's own page on the creator's site (if they have one)
5. Patreon (for backers / early access)

Each platform has different:
- Upload UI (some are buggy; Bethesda's Creation Kit can crash mid-upload)
- Description markdown flavor (BBCode on some, custom markdown on others)
- Permissions model (different "can other authors use my assets" toggles)
- Changelog conventions
- Required metadata fields (categories, tags, compatibility flags)
- File-size limits
- Asset thumbnail / banner specs

A new release goes through this 3–5 times. **Hours of manual work per release.** Most independent modders ship versions less frequently than they otherwise would because of this cost. Reduce cross-post friction by 80% and you've effectively doubled output across the community.

**ModWrench opportunity:** A `publish_mod` MCP tool that takes one definition (`title, version, changelog, files, screenshots, permissions, categories`) and fans out to N platforms. Even a 60% solution (publish to two platforms cleanly, fail-loudly on the rest) is more than any modder has today outside Minecraft.

### C2. Monetization opacity

Across every platform, creators don't know how they're being paid until they're paid (and often not even then).

- **Nexus Donation Points algorithm has been hidden since August 2024** (per Nexus News, May 2024 — *"we've decided to keep the details of the algorithm hidden going forward"*). The 2025 community survey thread is the canonical grievance.
- **mod.io marketplace economics depend on per-game studio configuration** (70/30 default), which is opaque to the creator at signup time.
- **CurseForge points-to-USD conversion fluctuates monthly.**
- **Roblox DevEx rate at $0.0038/Robux is published, but the effective take rate after marketplace fees compounds confusingly.**
- **UEFN's V-Bucks → USD math goes through Epic's monthly cohort-average pricing**, which is itself not always fully transparent.

This is *not* something ModWrench can fix (the data isn't public). But ModWrench can *aggregate* what the creator has earned across platforms into one view — "you made $X this month: $A from Nexus DP, $B from CurseForge points, $C from mod.io credits, $D from Patreon (manual entry)." That alone would be a useful free utility nothing else provides.

### C3. Mod theft & permission policing

Cited in every modder forum thread on the topic since 2016. Nexus owner Robin "Dark0ne" Scott has written 5,000+ word essays on the topic. The 2016 Bethesda.net console-port wave caused a permission-system overhaul on Nexus. Patreon paywall scraping is a current ongoing issue (per FluffyQuack 2023, ongoing).

What modders want:
- **A "where is my mod posted?" search** — find every site/marketplace hosting their content
- **Attribution-violation detection** — find their assets used without credit in someone else's mod
- **DMCA-helper tooling** — generate takedown notices for confirmed thefts

ModWrench could partially support this with a `mod_search_across_platforms` tool that takes a creator's username or known mod fingerprint and returns where it shows up. Imperfect, but valuable. This is also a Layer 3+ feature — not v1.

### C4. AI-tooling tension

Bethesda Creations explicitly bans AI-generated content. Many Patreon creators have anti-AI-training language in their mod pages. Generative AI is broadly viewed with suspicion (per Inverse, December 2023; ongoing discourse).

But: **the same modders use AI as a workflow tool.** AI for crash log analysis is normal. AI for Papyrus / C# / Java coding assistance is normal. AI for changelog drafting from git diffs is normal. AI for translating mod descriptions across languages is normal.

The pattern: *AI as workflow* = OK. *AI as creator-substitute* = not OK.

ModWrench is firmly in the former camp. Marketing copy should make this explicit: "*ModWrench helps you publish, debug, and maintain. It does not generate mod content. Your art is yours.*"

### C5. Platform lock-in / API politics

Nexus has historically been protective of its position. The 2020 "OpenMW vs Nexus" controversy, the ongoing tension with MO2's UI (which is non-Nexus-native), and the recent algorithmic opacity all signal a platform that does not love third-party tooling that competes with Vortex.

CurseForge under Overwolf has had similar friction — see the 2022 Minecraft Forum "Curseforge/Overwolf zzzzzzz train" thread complaining about API restrictions on third-party launchers.

mod.io is *much* more API-friendly by design (it's a B2B platform, embedded in games).

**ModWrench positioning:** "We're a respectful client of these APIs. We never scrape, never rate-limit-bust, always honor robots.txt and ToS. We're advocating for the creator's right to use their own data their way." That stance is the only stance that survives long-term across all platforms.

---

## Section D — User Pain Points (lighter)

The user side is briefer because the creator side is your strategic focus — but these matter because *users* become *patrons*, which is where creators actually earn.

### D1. Crashlog interpretation
Already covered in B4. Phostwood's analyzer handles the common cases; the long tail needs an LLM with load-order context. **High-leverage Layer 2 tool** for ModWrench: paste crashlog → cross-reference mod list via Nexus/mod.io APIs → reason → answer.

### D2. Load order conflicts
LOOT handles the auto-sort but the "why is LOOT putting this mod here, and is it actually right for my setup?" question is conversational. xEdit has the record-level answer but takes hours to learn. ModWrench tool: `explain_load_order_position(mod_id)` that pulls LOOT's rule + the underlying xEdit record conflicts + the user's manual overrides into a plain-English explanation.

### D3. "Will these mods play nice together?"
The compatibility question. Currently solved by reading mod page descriptions, browsing Reddit threads, and trial-and-error. ModWrench compatibility tool would cross-reference mod pages, known conflict databases (LOOT masterlist, community-maintained lists like the [Skyrim Mod Conflict Catalog]), and explain conflicts in context.

### D4. Update fatigue
A 200-mod load order might have 10–20 updates pending at any time. Updating means: download, verify version compat with the rest of the load order, replace the file, sometimes redo patches. ModWrench `check_updates_across_all_my_mods` tool plus `prioritize_updates_by_breaking_change_risk` is a clean win.

### D5. Steam Deck / Linux modding
Increasingly mainstream as Steam Deck adoption rises. r2modman handles this well for Unity games. BepInEx has macOS support via `gib`. Vortex doesn't run natively on Linux; Nexus Mods is building a new cross-platform app for that reason. ModWrench's Node.js base means it runs anywhere — that's an unsung advantage.

---

## Section E — Culture & Values

ModWrench's tone and behavior need to match the culture of the people it serves. The culture is real, opinionated, and not what most SaaS products understand.

**Attribution is sacred.** "Stolen mods" is the third-rail issue. A tool that displays mod author names prominently, cites sources in any aggregation, and never strips credit metadata earns instant goodwill. A tool that "summarizes" a mod page without crediting the author looks like the thing modders have spent 20 years fighting against.

**Permissions are not a checkbox.** Nexus's permission system has 8+ categories (modification permission, conversion permission, asset use, asset use in mods being sold, asset use in DP-earning mods, upload permission, etc.). These are taken seriously. Any ModWrench tool that handles cross-posting *must* read and respect the source mod's permissions before re-uploading anywhere.

**Anti-paid-mods is the default.** Sims and Bethesda are the partial exceptions (Sims via Patreon, Bethesda via Verified Creator). For everything else, "paid mods" is a slur. ModWrench should default to free-distribution workflows, support paid where the platform supports it, but never *advocate* for paid-mod adoption.

**Anti-AI is variable but loud.** Workflow AI is fine. Generative AI in mod content is contested. Don't surprise users. Be explicit: "ModWrench uses AI to assist with publishing and debugging. It does not generate mod content."

**Platform loyalty is tribal.** A Bethesda modder who's been on Nexus for 10 years has *opinions* about CurseForge. A Lethal Company modder who uses r2modman has *opinions* about Thunderstore Mod Manager. Don't take sides. Be the Switzerland.

**The Overwolf trust deficit is real.** The 2022 Minecraft Forum complaint thread is representative. Ads-funded modding platforms have a credibility problem. ModWrench's "we hold no personal data, period — this is a bridge" positioning is *exactly the language* the community wants to hear in 2026. Lean into it.

**Modders self-identify as DIY.** They're not customers, they're contributors. Tools that treat them as users-to-be-monetized fail. Tools that treat them as collaborators-with-a-shared-goal succeed. The CurseForge "we're committed to fairly rewarding such dedication and creativity" copy works because it's culturally legible. The same copy from a SaaS startup wouldn't.

---

## Section F — Economics

Where the money actually flows in modding, with the best-available 2026 numbers.

### F1. Nexus Mods (Donation Points)

| Year/Period | Pool | Notes |
|---|---|---|
| 2018 launch | $100K seed | $1 per 2,322 downloads |
| 2020 | unspecified | $1 per 2,322 downloads |
| 2023 (peak) | unspecified | $1 per 880 downloads |
| 2024 | ~$325K/mo monthly | Algorithm change August 2024; opaque since |
| 2025 (community-reported) | ~$325K/mo | Per-mod earnings reported as declining despite stable pool |

NET90 payout schedule. PayPal or store credit. No regional pricing. Author can split DP across up to 24 collaborators per mod.

### F2. mod.io (Marketplace)

- Default revenue split: 70/30 studio. Of the 30% creator share, mod.io takes its fee out → ~28% effective.
- Range across games: 20–40% effective creator share.
- 30-day credit hold before payout.
- Payouts via Thunes (third-party processor).
- 600,000 pieces of content lifetime; 100M total mod installs (Crunchbase).
- Company: $10.1M annual revenue, 55 employees, $26M Series A, Bethesda Softworks among investors.

### F3. CurseForge (Overwolf-owned)

- 70% of *ad revenue* shared with authors (not direct sales).
- Author Reward Points → PayPal or Amazon gift cards.
- CurseForge Premium subscription added 2024–2025 (consumer-side).
- "DLC-level mods" purchasable in-game in narrow categories.

### F4. Modrinth

- 75% of ad revenue to creators (per Modrinth+ subscription page).
- Open-source platform.
- Smaller than CurseForge in raw download volume but rapidly growing.

### F5. Bethesda Creations / Verified Creator Program

- Creator share: 25% (unchanged since the 2015 Paid Workshop attempt).
- In-game "Creation Credits" currency. $35 Starfield Premium Edition includes 1,000 Creation Credits.
- All content requires Bethesda vetting/approval.
- Generative AI explicitly banned.

### F6. Roblox (DevEx)

- $1B+ paid to creators March 2024–March 2025.
- 112M+ DAU, 400M+ MAU.
- Effective ~25–28% creator share after marketplace fees + DevEx conversion ($0.0038/Robux).
- Six monetization channels (game pass, premium, ads, direct items, etc.).

### F7. UEFN / Fortnite Creative

- $352M paid to creators in 2024 (engagement payouts).
- $722M cumulative since UEFN launch.
- 58+ creator-millionaires.
- Direct item sales (Verse-based API) launched January 2026.
- Revenue share: 100% (promotional through January 31, 2027), reverting to 50% V-Bucks value (~37% retail) after.
- Epic explicitly markets the 74% headline rate vs Roblox's 25%.

### F8. The hidden economy — Patreon

The dirty open secret of modding economics: **platform monetization is a side stipend; Patreon is the actual income.**

- Felixandre (Sims 4): 4,433 patrons at $5+/mo = $22,000+/mo minimum.
- HeyHarrie (Sims 4): 4,293 patrons at $2+/mo = $8,500+/mo minimum.
- Top Skyrim modders running Wabbajack lists report 5-figure monthly Patreon income.
- The 2019 Skyrim Together drama centered on a $33,000/month Patreon for a single project.

Across every community, the top 1% of creators earn 90%+ of mod-derived income via Patreon, not via the platforms. **ModWrench at some Layer 3+ stage could have a "your Patreon-aware view of which mods to support next" tool that maps creators to their Patreon presence**, but this is not a v1 move and treads carefully on community sensitivities.

---

## Section G — The AI-In-Modding Tension

A snapshot of where this stands in May 2026, because it directly affects ModWrench's positioning.

**Bethesda Creations bans generative AI.** Confirmed in the original 2023 Creations rollout, still enforced as of 2025–2026.

**Sandfall Interactive's Clair Obscur lost Indie Game Awards in 2026** for undisclosed generative AI use. The pattern is real: when generative AI use is disclosed (or caught), there are consequences.

**Crimson Desert (Pearl Abyss) faced AI scandal in 2026.** Resolved without lasting damage but the discourse is still active.

**The 2025 GDC survey: 60% of devs cite AI as exacerbating layoffs.** Player surveys show comparable concern.

**However, AI-assisted modding tools are quietly mainstream:**
- Phostwood's analyzer (rule-based but increasingly LLM-augmented per its 2025 docs)
- SkyLink AI on Nexus (74-tool MCP server *inside* Skyrim — released March 2026 on Nexus)
- AI-generated Papyrus code is normal in mod authoring
- AI translation of mod descriptions across languages is normal

**The dividing line is clear in community discourse:**
- **AI as workflow assistant** (translates, debugs, drafts, organizes) = accepted
- **AI as content generator** (textures, voices, meshes, dialogue) = controversial → rejected

ModWrench is firmly on the *workflow assistant* side. Marketing copy should be explicit: *"ModWrench helps you ship faster. It does not write your mod for you. Your work is yours."*

A specific anti-pattern to avoid: do not bundle generative-AI image/text features into ModWrench. The moment ModWrench can "generate a mod description for you" or "generate a screenshot," the trust angle collapses. Stay narrow.

---

## Section H — Strategic Implications for ModWrench

Ordered by leverage and feasibility.

### H1. v1 — Foundation (you're already here)

mod.io + Nexus, 14 tools each, Claude Code working. The lane exists, no incumbent. Push public Apache 2.0 within days. README that explicitly states the "bridge, no data, no lock-in" positioning. Submit to the MCP Registry. Talk to 5 modders. The reasoning from the previous turns stands.

### H2. v2 — Layer 2 wins (cross-cutting tools)

Pick 2–3 from this list based on first-user feedback:

1. **`mod_publish_multi_platform`** — the highest-leverage creator-side tool. One definition → fan out to mod.io + Nexus initially, expanding outward.
2. **`crashlog_analyze_with_load_order`** — pull crashlog + Nexus-installed mod list → reason in plain English. The Phostwood + LLM combo.
3. **`mod_compatibility_check`** — read user's load order, query known incompatibility data, predict + explain.
4. **`mod_update_summary`** — "what changed across my installed mods this week, ordered by breaking-change risk?"

### H3. v3 — Platform expansion

CurseForge first (best documented API, biggest catalog for Minecraft/Sims/WoW). Thunderstore second (smallest API, easiest to wrap, unlocks Unity co-op community). Bethesda Creations / Verified Creator third — but only if a creator-facing case clearly justifies it given the political sensitivity.

### H4. v4 — Local-tool bridges

Vortex profile reader (parse Vortex's state JSON). MO2 INI parser. LOOT CLI wrapper. BepInEx log reader. xEdit script invoker. These are *local file format wrappers*, not API integrations — different work, different value, all power-user catnip.

### H5. v5 — Adjacent universes

Roblox (Open Cloud API exists), UEFN (Verse-based dev tools, programmatic upload from January 2026). These are *not modding* in the classical sense but they share the creator-economy DNA and they have first-class APIs. Treat as opportunistic expansion, not roadmap priority.

### H6. Distribution & UX

- **MCP Server** is the foundation, working in Claude Desktop / Claude Code / Cursor / Continue / Cline (free distribution to every MCP-aware client).
- **Remote MCP** via Cloudflare Workers for ChatGPT Responses API compatibility — this is days of work, not weeks.
- **Discord bot wrapper** around the same MCP tools — modders live in Discord. A `/modwrench` slash command in a Skyrim modding server has surface-area value. v3+ effort.
- **VS Code extension** — only if there's a UI need ModWrench's MCP tools can't surface through the host clients. Probably not before v4.

### H7. Positioning copy

*"One wrench for every modding platform. Zero data kept. Just a bridge."*

Riffs on this theme that test well in modder culture:
- "ModWrench knows nothing about you. That's the whole point."
- "Cross-post to every platform. Lose track of zero credits."
- "Your modding workflow, finally talking back."
- "Built by a tinkerer who didn't see this coming." (your own self-description from earlier turns — keep it)

### H8. Anti-positioning (what NOT to say)

- "AI-powered modding" — triggers the wrong reflex
- "Monetize your mods" — triggers the wrong reflex
- "Replace your mod manager" — triggers the wrong reflex (you're not Vortex/MO2)
- "Generate mod content" — never. Not ever. Not even as a teaser.

---

## Caveats

- **Pricing and rev-share numbers shift frequently.** Roblox's effective rate was 24.5% in 2023, ~28% by 2026 — Epic is actively pressuring Roblox here. Treat all economic figures as ±10% accurate at the time of source.
- **Nexus Donation Points pool number ($325K/month, May 2024)** is the last public figure. The 2025 community survey suggests this number is roughly stable but actual current monthly pool is not officially disclosed.
- **Discord communities for modders are a research blind spot.** Most actual creator-to-creator dialogue happens in Discord servers (Skyrim mods, Nolvus, Lethal Co modding, Thunderstore staff, etc.) which web search doesn't index. First-hand observation by joining 3–5 of these would materially upgrade this research.
- **"Phostwood's Skyrim Crash Log Analyzer" — 200+ daily users / 75–90% identification rate** numbers come from the project's own README. Plausible but not independently verified.
- **The "MC-Publish is the only cross-posting solution" claim** is true for the major public-tool surface but I haven't surveyed every modding community on Earth. Smaller communities (Stardew Valley SMAPI mods, Cities Skylines, KSP, etc.) may have their own automation.
- **Bethesda's Verified Creator Program 25% creator share** is the number from public reporting; the actual contract terms with Verified Creators may differ for top-tier signings.
- **The Sims 4 Patreon income figures** are minimum-bound estimates based on publicly visible patron counts × minimum tier prices; actual income is higher (higher tiers, additional revenue streams).
- **AI sentiment in modding is changing fast.** This report captures a May 2026 snapshot. By Q4 2026 the discourse may have shifted further in either direction.
- **mod.io's $26M Series A from 2021** financed years of runway but the platform's long-term unit economics (especially the 30-day creator credit hold) suggest they're optimizing for scale, not creator-take-rate. Watch for changes.
- **CurseForge / Overwolf's exact 2026 author payout numbers** aren't public; the 70% ad-rev figure is platform-wide, not per-creator.
- **Roblox $1B+ payout figure** is the official number from Roblox Investor Relations (March 2024–March 2025). Independent reporting confirms this is gross-of-DevEx-conversion, so the creator's *USD-received* total is significantly less.
- **UEFN promotional 100% rate ends January 31, 2027.** After that the rate drops to 50% of V-Bucks value (~37% retail). This is in the published Epic Fortnite news post and is firm.
- **The "Skyrim Together $33,000/month Patreon" 2019 figure** was the high-profile flashpoint; current top-Patreon Skyrim creators are believed to earn similar or higher but specific creator-income figures are scarce.

---

## Sources

- Nexus Mods Donation Points (FAQ, ToS, How They Work, Survey 2025) — help.nexusmods.com, nexusmods.com/news
- mod.io Marketplace documentation — docs.mod.io, support.mod.io
- mod.io company profile — crunchbase.com, growjo.com
- CurseForge author program — authors.curseforge.com
- Modrinth platform — modrinth.com
- Bethesda Creations / Verified Creator coverage — Fallout Wiki, Techdirt (June 2024), The Gamer (December 2023), Inverse, NotebookCheck
- Skyrim modding overview — Wikipedia (Skyrim modding article)
- Vortex vs MO2 comparison — builttofrag.com (Feb 2026), modengine2.com, Medium (Napisss April 2026)
- Thunderstore / r2modman — thunderstore.io, lethal.wiki, switchbladegaming.com (April 2026)
- Minecraft modding workflow — MSN/Fabric/NeoForge coverage, Sinytra, Cloth Config API, MC-Publish (Kir-Antipov on GitHub)
- Phostwood's Crash Log Analyzer — phostwood.github.io/crash-analyzer, GitHub
- Buffout 4 / CLASSIC — nexusmods.com/fallout4/mods/56255
- Crash Logger SSE — nexusmods.com/skyrimspecialedition/mods/59818
- Skyrim Crash Decoder — skyrimcrashdecoder.com
- LOOT — loot.github.io, modding.wiki/en/skyrim
- SkyLink AI MCP — nexusmods.com/skyrimspecialedition/mods/175682 (March 2026)
- Sims 4 / EA paid-mods controversy — Game Rant (Aug 2022), GameSpot (Aug 2022), Kotaku (2022)
- CurseForge Sims 4 Mod Hub — yahoo tech, simscommunity.info
- Mod theft history — PCGamesN (2016), TechCrunch (2019), Patreon/FluffyQuack (2023)
- Overwolf / CurseForge acquisition history — Wikipedia (Curse LLC), Overwolf Blog, gameslearningsociety.org
- Roblox creator economy — Naavik (March 2026), endsights.com (April 2026), generalistprogrammer.com (March 2026)
- UEFN / Fortnite Creative — fortnite.com news (Sept 2025), Naavik (March 2026), GEEIQ (October 2025)
- AI-in-gaming backlash — GameSpot (Crimson Desert, April 2026), HyperAI (December 2025), Inverse (Bethesda Creations + AI ban, 2023)
- AI-mod legality — ScoreDetect blog (May 2025)

---

*Report generated for ModWrench project planning — Foundation document. Style-matched to Volume II (WebGPU-NN_Research.md). Synthesized from ~10 targeted web searches across the modder ecosystem, May 17, 2026.*
