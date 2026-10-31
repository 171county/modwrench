// ─── What the server tells a client about itself ─────────────────────────────
// MCP's `instructions` field: the client may put it in the model's context, so it
// says which tool answers which question, across the 58. Some clients show only the
// start, so the first paragraph (under 512 characters, a test holds it there) stands
// on its own. Every tool named here is checked against the real catalog.

export const SERVER_INSTRUCTIONS = [
  "ModWrench helps with game mods. Pick the tool by the question. Why did my game crash: " +
    "mw_crash_whisperer (it finds the newest crash log). Is my setup OK, why do my mods keep breaking: " +
    "mw_doctor. Safe to " +
    "update the game: mw_patch_day. Are my mods up to date: mw_pulse. Do we all have the same " +
    "mods: mw_crew_check. Who made this mod: mw_trust_card. Load order: mw_read_load_order, then " +
    "mw_check_known_conflicts. Finding mods: the nexus_, modio_ and thunderstore_ tools, or " +
    "mw_query_mod_metadata.",
  "mw_parse_crashlog and mw_diagnose_crash are the lower-level crash tools, for when the user " +
    "wants the parsed fields. The mw_ tools never write. Most read only this computer's files, but " +
    "mw_query_mod_metadata asks Nexus and mod.io, mw_check_known_conflicts, mw_diagnose_crash " +
    "with a gameId and mw_loot_requirements (what LOOT says the active plugins need) fetch LOOT's " +
    "public list from GitHub, attributeSuspects asks Nexus, mw_pulse asks Thunderstore and mw_news " +
    "(what's new for a game: its Steam announcements and its tools' GitHub releases) asks Steam " +
    "and GitHub, but those two send nothing without confirm: show the user the plan and pass " +
    "confirm=true only after they say yes. Every tool reads " +
    "except nexus_endorse_mod: call it without confirm for a preview, and pass confirm=true only " +
    "after the user says yes. Nexus and mod.io tools are there only once connected; " +
    "mw_activate_platform connects one mid-session and mw_deck shows which are connected.",
].join("\n\n");
