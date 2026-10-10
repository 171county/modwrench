import { arch as osArch } from "node:os";
import { performance } from "node:perf_hooks";
import { REDACTION_KINDS, redact, removedParts, type RedactionKind, type RedactOptions } from "./crashwhisper/redact.js";
import { detectSteamDeck } from "./detect/os.js";

// ─── Feedback: a GitHub issue the player reads and posts ─────────────────────
// /mw-critique turns what a player wants to tell ModWrench's maintainers into an
// issue for its tracker, with the few details a maintainer needs to reproduce it:
// ModWrench's version, the connectors that are on, the AI client as it named
// itself, the operating system, Node's version and the two page settings. Nothing
// personal is added.
//
// Nothing is sent from here. ModWrench makes no network request: the draft goes
// back to the player's AI client, and the link opens GitHub's own form for the
// feedback template (.github/ISSUE_TEMPLATE/feedback.yml), filled in through the
// query parameters GitHub documents for issue forms. The draft is in the link's
// address, so opening the link hands it to GitHub; nothing is posted until the
// player presses the form's button.
//
// The player's words go through the cleaning Crash Whisperer's help posts get, so
// a folder, account name, address or key they paste doesn't end up in a public
// issue. Like there, it removes what it recognises; the draft is shown in full so
// the player reads it first.

export const FEEDBACK_REPO = "https://github.com/171county/modwrench";
/** The issue form the link opens. Its field ids are the query parameters below. */
export const FEEDBACK_TEMPLATE = "feedback.yml";

/**
 * GitHub answers "414 URI Too Long" past a length it doesn't publish. Common servers stop at about
 * 8 KB, so a link stays under this, and a draft too long for one leaves its text to be pasted.
 */
export const MAX_LINK = 6000;
const MAX_TITLE = 120;
const MAX_TEXT = 4000;
const MAX_STEPS = 12;
const MAX_STEP = 300;
/** The time the cleaning gets for the whole draft, every piece together. */
const CLEANING_MS = 3000;

export type FeedbackKind = "bug" | "idea" | "other";

const PREFIX: Record<FeedbackKind, string> = { bug: "[bug]", idea: "[idea]", other: "[feedback]" };

export type FeedbackInput = {
  kind?: FeedbackKind | undefined;
  /** A short title, in the player's words. */
  title?: string | undefined;
  /** What they want to say, in their words. */
  feedback?: string | undefined;
  /** For a bug: the steps that make it happen again. */
  steps?: string[] | undefined;
  /** ModWrench's version. */
  version: string;
  /** The connectors that are on, by name. */
  connectors: string[];
  /** The AI client as it named itself when it connected, when it did. */
  client?: { name?: unknown; version?: unknown } | undefined;
  /** MODWRENCH_UI and MODWRENCH_STRUCTURED as the server reads them. */
  pages: { on: boolean; structured: string };
  /** For tests: the system, the processor, Node's version and whether this is a Steam Deck. */
  platform?: NodeJS.Platform;
  arch?: string;
  node?: string;
  steamDeck?: boolean;
  /** For tests: the cleaning's options (e.g. the account names to look for). */
  redactOptions?: RedactOptions;
};

export type FeedbackDraft = {
  kind: FeedbackKind;
  title: string;
  feedback: string;
  steps: string[];
  /** The setup lines, as they go into the issue. */
  setup: string[];
  /** What the cleaning took out of the player's words, counted ("1 folder path"). Never what it was. */
  removed: string[];
  /** Places this machine's account or computer name is still inside a longer word. */
  leftover: number;
  /** The player's text was longer than an issue draft takes, and was cut. */
  cut: boolean;
  /** The cleaning ran out of time, so some of the player's words were left out rather than shown uncleaned. */
  unfinished: boolean;
  /** GitHub's feedback form, filled in. Opening it hands GitHub the draft; only the form's button posts it. */
  url: string;
  /** False when the draft is too long for a link: the link then fills in the title and setup only. */
  linkHasText: boolean;
};

/** Characters that print nothing or flip the direction of text: control characters, zero-width ones and bidi controls. */
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * One line: line breaks and tabs become spaces, runs of spaces one. Invisible characters are dropped, as the cleaning
 * drops them: turned into a space, one inside an address or a name would split it where no rule recognises it.
 */
function oneLine(text: string): string {
  return text.replace(/[\r\n\t\u0085\u2028\u2029]/g, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/** Line breaks kept (at most one blank line in a row), invisible characters dropped. */
function paragraphs(text: string): string {
  return text.replace(INVISIBLE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** At most `max` characters, with an ellipsis when cut. */
function shorten(text: string, max: number): { text: string; cut: boolean } {
  return text.length > max ? { text: `${text.slice(0, max - 1).trimEnd()}…`, cut: true } : { text, cut: false };
}

/**
 * What the cleaning reads at most of any one piece, far more than a draft keeps. Past it, the text stops at the end
 * of the last whole line, so no line is split here; one long line is cut by the cleaning itself, which backs off
 * to a space or past a run of letters and digits rather than split a word. The cut to the draft's own lengths
 * comes after the cleaning, so it can't split a name or a key the cleaning would have recognised whole.
 */
const READ_AT_MOST = 64 * 1024;

/** At most READ_AT_MOST characters, ending at a line break when the text goes on past it. */
function readable(text: string): { text: string; cut: boolean } {
  if (text.length <= READ_AT_MOST) return { text, cut: false };
  const head = text.slice(0, READ_AT_MOST);
  const lineEnd = head.lastIndexOf("\n");
  return { text: lineEnd > 0 ? head.slice(0, lineEnd) : head, cut: true };
}

function systemName(platform: NodeJS.Platform, steamDeck: boolean): string {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return steamDeck ? "Linux (Steam Deck)" : "Linux";
  return platform;
}

function clientWords(client: FeedbackInput["client"], clean: (text: string) => { text: string; timedOut: boolean }): string {
  // The client chose these words; they are cleaned like the player's, in case one holds a name or a folder.
  // Undefined: there was something, but no time left to clean it.
  const word = (value: unknown, max: number): string | undefined => {
    const raw = typeof value === "string" ? oneLine(value.slice(0, 1024)) : "";
    if (raw === "") return "";
    const cleaned = clean(raw);
    return cleaned.timedOut ? undefined : shorten(cleaned.text, max).text;
  };
  const name = word(client?.name, 60);
  const version = word(client?.version, 30) ?? "";
  if (name === undefined) return "left out, as the cleaning ran out of time";
  if (name === "") return "not reported by the client";
  return `${name}${version ? ` ${version}` : ""}, as it named itself`;
}

function link(title: string, fields: Record<string, string>): string {
  const params = new URLSearchParams({ template: FEEDBACK_TEMPLATE, title });
  for (const [key, value] of Object.entries(fields)) if (value !== "") params.set(key, value);
  return `${FEEDBACK_REPO}/issues/new?${params.toString()}`;
}

/** The draft and its link. Pure apart from reading which system this is (and, on Linux, whether it is a Steam Deck). */
export function draftFeedback(input: FeedbackInput): FeedbackDraft {
  const kind = input.kind ?? "bug";
  // One allowance for every piece, so a long draft can't take a few seconds per step.
  const options: RedactOptions = { deadline: performance.now() + CLEANING_MS, ...input.redactOptions };
  // A title that already starts with a tag gets this one instead, not two. A title and a step are one line each,
  // which the cleaning cuts short itself past 6,000 characters.
  const titleIn = oneLine((input.title ?? "").slice(0, READ_AT_MOST)).replace(/^\[(?:bug|idea|feedback|feature)\]\s*/i, "");
  const stepsIn = (input.steps ?? []).map((s) => oneLine(s.slice(0, READ_AT_MOST))).filter((s) => s !== "");
  // Every kind of line break is "\n" before the 64 KB cut, so that cut lands at a line's end whichever kind the text has.
  const read = readable((input.feedback ?? "").replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n"));

  // Every piece cleaned with these options, and what the cleaning took out of them all.
  const cleanAll = (cleaning: RedactOptions) => {
    const removedByKind = Object.fromEntries(REDACTION_KINDS.map((k) => [k, 0])) as Record<RedactionKind, number>;
    let leftover = 0;
    let skipped = 0;
    // A line the cleaning cut short for its length (6,000 characters) lost its end, as a draft's own cut does.
    let longLines = 0;
    const learned = { users: [] as string[], machines: [] as string[] };
    const cleanPiece = (text: string): { text: string; timedOut: boolean } => {
      if (text === "") return { text: "", timedOut: false };
      const out = redact(text, cleaning);
      for (const k of REDACTION_KINDS) removedByKind[k] += out.report.byKind[k];
      leftover += out.report.leftover;
      longLines += out.report.cutLines;
      // Lines the cleaning had no time for are left out, never passed on uncleaned.
      skipped += out.report.skippedLines;
      learned.users.push(...out.learned.users);
      learned.machines.push(...out.learned.machines);
      return { text: out.text, timedOut: out.report.skippedLines > 0 };
    };
    const clean = (text: string): string => cleanPiece(text).text;

    // Clean first, then cut: a cut that landed inside a key or a name would leave a piece no rule recognises.
    // The short pieces go first, so a long text that uses up the time loses only its own end.
    const client = clientWords(input.client, cleanPiece);
    const given = shorten(clean(titleIn), MAX_TITLE).text;
    const stepsCut = stepsIn.slice(0, MAX_STEPS).map((s) => shorten(clean(s), MAX_STEP));
    const body = shorten(clean(paragraphs(read.text)), MAX_TEXT);
    return { client, given, stepsCut, body, removedByKind, leftover, skipped, longLines, learned };
  };
  let cleaned = cleanAll(options);
  // A name a labelled line in one piece gave ("Account name: ...") goes from every piece, as it would from one log: every
  // piece is cleaned again from the player's words with that name added, and only that pass counts. The deadline is the
  // same, so the two passes share one allowance.
  const { users, machines } = cleaned.learned;
  if (users.length + machines.length > 0) {
    cleaned = cleanAll({ ...options, users: [...(options.users ?? []), ...users], machines: [...(options.machines ?? []), ...machines] });
  }
  const { client, given, stepsCut, body } = cleaned;
  const steps = stepsCut.map((s) => s.text).filter((s) => s !== "");
  const feedback = body.text;
  const fromText = shorten(oneLine(feedback.split("\n")[0] ?? ""), 80).text;
  const title = `${PREFIX[kind]} ${given || fromText || "ModWrench feedback"}`;

  const platform = input.platform ?? process.platform;
  const steamDeck = input.steamDeck ?? (platform === "linux" ? detectSteamDeck() : false);
  const setup = [
    `ModWrench ${shorten(oneLine(input.version), 30).text}${input.connectors.length > 0 ? `, connectors on: ${input.connectors.map((c) => shorten(oneLine(c), 30).text).join(", ")}` : ""}`,
    `AI client: ${client}`,
    `System: ${systemName(platform, steamDeck)}, ${shorten(oneLine(input.arch ?? osArch()), 16).text}`,
    `Node.js ${shorten(oneLine(input.node ?? process.version), 20).text}`,
    `Pages ${input.pages.on ? "on" : "off (MODWRENCH_UI=off)"}, structured data ${shorten(oneLine(input.pages.structured), 10).text}`,
  ];

  const numbered = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const full = link(title, { feedback, steps: numbered, setup: setup.join("\n") });
  const linkHasText = full.length <= MAX_LINK;
  const url = linkHasText ? full : link(title, { setup: setup.join("\n") });

  return {
    kind,
    title,
    feedback,
    steps,
    setup,
    removed: removedParts(cleaned.removedByKind),
    leftover: cleaned.leftover,
    cut: read.cut || body.cut || cleaned.longLines > 0 || stepsIn.length > MAX_STEPS || stepsCut.some((s) => s.cut),
    unfinished: cleaned.skipped > 0,
    url,
    linkHasText,
  };
}

/** The answer the AI client gets: the draft in full, what was taken out, and how to post it. */
export function summarizeFeedback(d: FeedbackDraft): string {
  const out: string[] = [
    "Feedback draft for ModWrench. Nothing has been sent: ModWrench made no network request. The draft is in the link below, so opening it hands the draft to GitHub to fill in the form, and nothing is posted until you press its Create button.",
    d.removed.length > 0
      ? `Taken out of the draft: ${d.removed.join(", ")}. Read it before you post it.`
      : "Nothing personal was recognised in the draft. That isn't a promise there is nothing: read it before you post it.",
  ];
  if (d.leftover > 0) {
    out.push(`Your account or computer name is still inside ${d.leftover === 1 ? "another word" : `${d.leftover} other words`}; check ${d.leftover === 1 ? "it" : "them"}.`);
  }
  if (d.cut) out.push("It was longer than a draft takes, so the end was cut; add it on GitHub if it matters.");
  if (d.unfinished) out.push("Cleaning it took too long, so some of your words were left out rather than shown uncleaned; add them on GitHub if they matter, and check them first.");
  out.push("", `Title: ${d.title}`);
  if (d.feedback !== "") out.push("", "What you'd like to say:", d.feedback);
  if (d.steps.length > 0) out.push("", "How to make it happen again:", ...d.steps.map((s, i) => `${i + 1}. ${s}`));
  out.push("", "Your setup:", ...d.setup.map((line) => `- ${line}`));
  out.push(
    "",
    "To post it, open this link in your browser. It opens ModWrench's feedback form on GitHub with " +
      (d.linkHasText ? "all of this filled in" : "the title and your setup filled in; the rest is too long for a link, so paste it into the form") +
      ". You need a GitHub account, and you can change anything before you post.",
    d.url
  );
  return out.join("\n");
}
