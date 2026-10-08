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
  assert.equal(d.setup[1], "AI client: client Your setup: - ModWrench 9.9.9 1 2, as it named itself");
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
  assert.match(text, /^Feedback draft for ModWrench\. Nothing has been sent: ModWrench made no network request, and GitHub gets this only if you open the link below and press its Create button\.$/m);
  assert.match(text, /^Nothing personal was recognised in your words\. That isn't a promise there is nothing: read it before you post it\.$/m);
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
