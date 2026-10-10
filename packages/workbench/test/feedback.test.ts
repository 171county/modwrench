import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDBACK_TEMPLATE, MAX_LINK, draftFeedback, summarizeFeedback, type FeedbackInput } from "../src/feedback.js";

// ─── /mw-critique's draft ────────────────────────────────────────────────────
// The draft is what a player posts in public, so it must carry their words without
// the personal details ModWrench recognises, and a setup block with nothing
// personal in it. The link must fill in the repository's own feedback form, so its
// fields are pinned to that form's ids.

const HERE = dirname(fileURLToPath(import.meta.url));
const FORM = readFileSync(resolve(HERE, "..", "..", "..", ".github", "ISSUE_TEMPLATE", FEEDBACK_TEMPLATE), "utf8");

const BASE: FeedbackInput = {
  version: "0.3.0",
  connectors: ["Thunderstore", "Workbench"],
  client: { name: "claude-code", version: "2.1.3" },
  pages: { on: true, structured: "auto" },
  platform: "win32",
  arch: "x64",
  node: "v22.11.0",
  steamDeck: false,
  redactOptions: { ownNames: false, users: ["Jane Doe"], machines: ["JANE-PC"] },
};

const params = (url: string): URLSearchParams => new URL(url).searchParams;

test("a bug: the title is tagged, the player's words are cleaned, and the setup holds nothing personal", () => {
  const d = draftFeedback({
    ...BASE,
    kind: "bug",
    title: "Load order page is empty",
    feedback:
      "My MO2 profile shows nothing on the page.\n" +
      "It lives in C:\\Users\\Jane Doe\\AppData\\Local\\ModOrganizer\\Skyrim Special Edition\n" +
      "Mail me at jane.doe@example.com if you need the log.",
    steps: ["Run /mw-order", "Open the page"],
  });
  assert.equal(d.title, "[bug] Load order page is empty");
  for (const personal of ["Jane", "C:\\Users", "jane.doe@example.com"]) {
    assert.ok(!d.feedback.includes(personal), `${personal} left in: ${d.feedback}`);
  }
  assert.equal(
    d.feedback,
    "My MO2 profile shows nothing on the page.\nIt lives in REDACTED-PATH\nMail me at REDACTED-EMAIL if you need the log."
  );
  assert.ok(d.removed.some((r) => /folder path/.test(r)), d.removed.join(", "));
  assert.ok(d.removed.some((r) => /email address/.test(r)), d.removed.join(", "));
  assert.deepEqual(d.steps, ["Run /mw-order", "Open the page"]);
  assert.deepEqual(d.setup, [
    "ModWrench 0.3.0, connectors on: Thunderstore, Workbench",
    "AI client: claude-code 2.1.3, as it named itself",
    "System: Windows, x64",
    "Node.js v22.11.0",
    "Pages on, structured data auto",
  ]);
  assert.equal(d.linkHasText, true);
  assert.equal(d.cut, false);
});

test("the link opens the repository's feedback form, filled in through the form's own field ids", () => {
  const d = draftFeedback({ ...BASE, title: "It works", feedback: "Thanks.", steps: ["One", "Two"] });
  assert.ok(d.url.startsWith("https://github.com/171county/modwrench/issues/new?"), d.url);
  const p = params(d.url);
  assert.equal(p.get("template"), "feedback.yml");
  assert.equal(p.get("title"), "[bug] It works");
  assert.equal(p.get("feedback"), "Thanks.");
  assert.equal(p.get("steps"), "1. One\n2. Two");
  assert.equal(p.get("setup"), d.setup.join("\n"));
  // Every field the link fills is a field of the form, and the form asks for nothing the link leaves out.
  const ids = [...FORM.matchAll(/^\s+id: ([a-z-]+)$/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ["feedback", "steps", "setup"]);
  for (const key of p.keys()) assert.ok(["template", "title", ...ids].includes(key), key);
  assert.match(FORM, /^title: "\[feedback\] "$/m);
});

test("a draft too long for a link fills in the title and setup, and the answer says to paste the rest", () => {
  const d = draftFeedback({ ...BASE, feedback: "äöü ".repeat(900) });
  assert.equal(d.linkHasText, false);
  assert.ok(d.url.length <= MAX_LINK);
  const p = params(d.url);
  assert.equal(p.get("feedback"), null);
  assert.equal(p.get("setup"), d.setup.join("\n"));
  assert.match(summarizeFeedback(d), /the rest is too long for a link, so paste it into the form/);
});

test("very long words and too many steps are cut, and the answer says so", () => {
  const d = draftFeedback({ ...BASE, feedback: "word ".repeat(1200), steps: Array.from({ length: 15 }, (_, i) => `step ${i + 1}`) });
  assert.ok(d.feedback.length <= 4000);
  assert.equal(d.steps.length, 12);
  assert.equal(d.cut, true);
  assert.match(summarizeFeedback(d), /It was longer than a draft takes, so the end was cut/);
});

test("the setup says what it doesn't know, a Steam Deck, and pages switched off", () => {
  const d = draftFeedback({ ...BASE, client: undefined, platform: "linux", steamDeck: true, pages: { on: false, structured: "never" } });
  assert.equal(d.setup[1], "AI client: not reported by the client");
  assert.equal(d.setup[2], "System: Linux (Steam Deck), x64");
  assert.equal(d.setup[4], "Pages off (MODWRENCH_UI=off), structured data never");
  assert.equal(draftFeedback({ ...BASE, platform: "darwin", arch: "arm64" }).setup[2], "System: macOS, arm64");
  assert.equal(draftFeedback({ ...BASE, connectors: [] }).setup[0], "ModWrench 0.3.0");
});

test("a client name, a title or a step can't add lines of their own", () => {
  const d = draftFeedback({
    ...BASE,
    client: { name: "client\nYour setup:\n- ModWrench 9.9.9", version: "1\u202e2" },
    title: "Broken\nTitle: [idea] fake",
    steps: ["one\ntwo"],
  });
  assert.equal(d.title.split("\n").length, 1);
  assert.equal(d.setup[1], "AI client: client Your setup: - ModWrench 9.9.9 12, as it named itself");
  assert.deepEqual(d.steps, ["one two"]);
  const text = summarizeFeedback(d);
  assert.equal(text.match(/^Your setup:$/gm)?.length, 1);
  assert.equal(text.match(/^Title: /gm)?.length, 1);
});

test("the title: a tag it already has is replaced, a missing one comes from the first line, and nothing at all gives a plain one", () => {
  assert.equal(draftFeedback({ ...BASE, kind: "idea", title: "[bug] Add Starfield" }).title, "[idea] Add Starfield");
  assert.equal(draftFeedback({ ...BASE, feedback: "The first line says it\nand more follows" }).title, "[bug] The first line says it");
  assert.equal(draftFeedback({ ...BASE, kind: "other" }).title, "[feedback] ModWrench feedback");
  // A title with personal details in it is cleaned like the rest.
  assert.doesNotMatch(draftFeedback({ ...BASE, title: "Crash on JANE-PC" }).title, /JANE-PC/);
});

test("the answer: nothing sent, what was taken out, the draft in full, and the link last", () => {
  const d = draftFeedback({ ...BASE, kind: "idea", title: "Fallout 4 for Patch Day", feedback: "Please add it." });
  const text = summarizeFeedback(d);
  assert.match(text, /^Feedback draft for ModWrench\. Nothing has been sent: ModWrench made no network request\. The draft is in the link below, so opening it hands the draft to GitHub to fill in the form, and nothing is posted until you press its Create button\.$/m);
  assert.match(text, /^Nothing personal was recognised in the draft\. That isn't a promise there is nothing: read it before you post it\.$/m);
  assert.match(text, /^Title: \[idea\] Fallout 4 for Patch Day$/m);
  assert.match(text, /^What you'd like to say:\nPlease add it\.$/m);
  assert.doesNotMatch(text, /How to make it happen again/, "no steps were given");
  assert.match(text, /^Your setup:\n- ModWrench 0\.3\.0, connectors on: Thunderstore, Workbench\n- AI client: claude-code 2\.1\.3, as it named itself\n/m);
  assert.equal(text.split("\n").at(-1), d.url);
  assert.match(text, /You need a GitHub account, and you can change anything before you post\./);
});

test("a folder path with spaces takes the rest of its line with it, as in a crash log, so nothing of it is left", () => {
  // Windows folder names can have spaces, so the cleaning can't tell where such a path ends before the line does.
  const d = draftFeedback({ ...BASE, feedback: "Profile at C:\\Users\\Jane Doe\\Documents\\My Games shows nothing" });
  assert.equal(d.feedback, "Profile at REDACTED-PATH");
});

test("cleaning comes before cutting, so a key or a name across a cut is removed whole, not left in part", () => {
  // "tss_", 30 letters and digits and a 6-character checksum: a cut inside one would leave a piece too short to recognise.
  const token = `tss_${"a1B2c3D4e5".repeat(3)}x9Y8z7`;
  // The title keeps 120 characters: the token starts at 101.
  const title = draftFeedback({ ...BASE, title: `${"t".repeat(100)} ${token} and more` }).title;
  assert.doesNotMatch(title, /tss_/);
  assert.match(title, / REDACTED-SECRET an…$/, "the token was removed whole, then the title was cut");
  // The text keeps 4,000: the computer name starts at 3,996.
  const d = draftFeedback({ ...BASE, feedback: `${"w".repeat(3995)} JANE-PC was the machine` });
  assert.doesNotMatch(d.feedback, /JANE/);
  assert.equal(d.cut, true);
  assert.ok(d.removed.some((r) => /computer name/.test(r)), d.removed.join(", "));
  // A step keeps 300: the folder starts at 290.
  const step = draftFeedback({ ...BASE, steps: [`${"s".repeat(289)} C:\\Users\\Jane Doe\\Desktop\\mods.txt`] }).steps[0]!;
  assert.doesNotMatch(step, /Users|Jane/);
  assert.equal(step.length, 300);
});

test("the client's name and version are cleaned like the player's words", () => {
  const d = draftFeedback({ ...BASE, client: { name: "JANE-PC agent", version: "C:\\Users\\Jane Doe\\bin" } });
  assert.doesNotMatch(d.setup[1]!, /JANE|Jane|Users/);
  assert.equal(d.setup[1], "AI client: REDACTED-MACHINE agent REDACTED-PATH, as it named itself");
  assert.ok(d.removed.length > 0, "what was taken out is counted");
});

test("a name that a labelled line in one part gives is taken out of every part, as it would be from one log", () => {
  // "Account name: ..." in the text teaches the cleaning the name; the title, a step and the client's words have it too.
  const d = draftFeedback({
    ...BASE,
    client: { name: "claude-code for xXDragonXx", version: "2.1.3" },
    title: "xXDragonXx can't log in to Nexus",
    feedback: "Nexus connection fails.\nAccount name: xXDragonXx\nThat's me.",
    steps: ["Sign in as xXDragonXx", "Run /mw-find"],
  });
  assert.doesNotMatch(JSON.stringify(d), /dragon/i);
  assert.equal(d.title, "[bug] REDACTED-USER can't log in to Nexus");
  assert.deepEqual(d.steps, ["Sign in as REDACTED-USER", "Run /mw-find"]);
  assert.equal(d.feedback, "Nexus connection fails.\nAccount name: REDACTED-USER\nThat's me.");
  assert.equal(d.setup[1], "AI client: claude-code for REDACTED-USER 2.1.3, as it named itself");
  assert.deepEqual(d.removed, ["4 user names"], "each place is counted once");
});

test("an invisible character inside an address in the title or a step doesn't hide the address from the cleaning", () => {
  // Turned into a space, a zero-width space or a byte-order mark would split the address, and no rule would know it.
  const d = draftFeedback({
    ...BASE,
    title: "Mail dragon.slayer\u200b@example.com",
    steps: ["Write to dragon.slayer\u200b@example.com", "Or to dragon.slayer\ufeff@example.com"],
  });
  assert.equal(d.title, "[bug] Mail REDACTED-EMAIL");
  assert.deepEqual(d.steps, ["Write to REDACTED-EMAIL", "Or to REDACTED-EMAIL"]);
  assert.doesNotMatch(d.url, /slayer/);
});

test("when the cleaning runs out of time, what it didn't reach is left out, and the answer says so", () => {
  const d = draftFeedback({
    ...BASE,
    title: "Crash on JANE-PC",
    feedback: "Profile at C:\\Users\\Jane Doe",
    steps: ["Open JANE-PC"],
    redactOptions: { ...BASE.redactOptions, deadline: 0 },
  });
  assert.equal(d.unfinished, true);
  assert.equal(d.title, "[bug] ModWrench feedback");
  assert.equal(d.feedback, "");
  assert.deepEqual(d.steps, []);
  assert.equal(d.setup[1], "AI client: left out, as the cleaning ran out of time");
  assert.doesNotMatch(JSON.stringify(d), /JANE|Jane/);
  assert.match(summarizeFeedback(d), /Cleaning it took too long, so some of your words were left out rather than shown uncleaned/);
  assert.equal(draftFeedback({ ...BASE, feedback: "Fine." }).unfinished, false);
});

test("past 64 KB the text stops at a line's end, so a key across that point isn't left in part, and the draft says it was cut", () => {
  // Eleven long folder paths, each of which the cleaning shrinks to a few characters, then a key across character 65,536.
  // The lines may end in "\r" or U+2028 rather than "\n": the cut finds their end all the same.
  const path = `C:\\Users\\Someone\\${"a".repeat(5880)}`;
  for (const lineBreak of ["\n", "\r", "\u2028"]) {
    let text = `${Array.from({ length: 11 }, () => path).join(lineBreak)}${lineBreak}`;
    text += `${"x".repeat(65_536 - text.length - 10)} ghp_${"A1b2C3d4E5".repeat(4)} and the rest`;
    const d = draftFeedback({ ...BASE, feedback: text });
    assert.ok(d.feedback.length < 4000, "short enough that the draft's own cut didn't remove it");
    assert.doesNotMatch(d.feedback, /ghp_|A1b2/, JSON.stringify(lineBreak));
    assert.doesNotMatch(d.url, /ghp_|A1b2/, JSON.stringify(lineBreak));
    assert.equal(d.cut, true);
  }
  // One line too long for the cleaning, which cuts it itself, is a cut too.
  assert.equal(draftFeedback({ ...BASE, feedback: `C:\\Users\\Someone\\${"b".repeat(6500)} and then more words` }).cut, true);
});

test("a client name the cleaning empties isn't taken for one it had no time for", () => {
  // U+2060 WORD JOINER: no line break or space, but the cleaning drops it.
  const d = draftFeedback({ ...BASE, client: { name: "\u2060\u2060", version: "1" } });
  assert.equal(d.unfinished, false);
  assert.equal(d.setup[1], "AI client: not reported by the client");
});
