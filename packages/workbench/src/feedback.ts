import { arch as osArch } from "node:os";
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
// query parameters GitHub documents for issue forms. GitHub gets it only if the
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
  /** GitHub's feedback form, filled in. Opening it sends nothing. */
  url: string;
  /** False when the draft is too long for a link: the link then fills in the title and setup only. */
  linkHasText: boolean;
};

/** One line, no control characters, at most `max` characters. */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Keeps line breaks, drops other control characters and the ones that flip text direction. */
function paragraphs(text: string, max: number): { text: string; cut: boolean } {
  const tidy = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return tidy.length > max ? { text: `${tidy.slice(0, max - 1).trimEnd()}…`, cut: true } : { text: tidy, cut: false };
}

function systemName(platform: NodeJS.Platform, steamDeck: boolean): string {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return steamDeck ? "Linux (Steam Deck)" : "Linux";
  return platform;
}

function clientWords(client: FeedbackInput["client"]): string {
  const name = typeof client?.name === "string" ? oneLine(client.name, 60) : "";
  const version = typeof client?.version === "string" ? oneLine(client.version, 30) : "";
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
  const options: RedactOptions = { budgetMs: CLEANING_MS, ...input.redactOptions };
  const removedByKind = Object.fromEntries(REDACTION_KINDS.map((k) => [k, 0])) as Record<RedactionKind, number>;
  let leftover = 0;
  const clean = (text: string): string => {
    if (text === "") return "";
    const out = redact(text, options);
    for (const k of REDACTION_KINDS) removedByKind[k] += out.report.byKind[k];
    leftover += out.report.leftover;
    return out.text;
  };

  const body = paragraphs(input.feedback ?? "", MAX_TEXT);
  const feedback = clean(body.text);
  const stepsIn = (input.steps ?? []).map((s) => oneLine(s, MAX_STEP)).filter((s) => s !== "");
  const steps = stepsIn.slice(0, MAX_STEPS).map(clean);
  // A title that already starts with a tag gets this one instead, not two.
  const given = oneLine(input.title ?? "", MAX_TITLE).replace(/^\[(?:bug|idea|feedback|feature)\]\s*/i, "");
  const fromText = oneLine(feedback.split("\n")[0] ?? "", 80);
  const title = `${PREFIX[kind]} ${clean(given) || fromText || "ModWrench feedback"}`;

  const platform = input.platform ?? process.platform;
  const steamDeck = input.steamDeck ?? (platform === "linux" ? detectSteamDeck() : false);
  const setup = [
    `ModWrench ${oneLine(input.version, 30)}${input.connectors.length > 0 ? `, connectors on: ${input.connectors.map((c) => oneLine(c, 30)).join(", ")}` : ""}`,
    `AI client: ${clientWords(input.client)}`,
    `System: ${systemName(platform, steamDeck)}, ${oneLine(input.arch ?? osArch(), 16)}`,
    `Node.js ${oneLine(input.node ?? process.version, 20)}`,
    `Pages ${input.pages.on ? "on" : "off (MODWRENCH_UI=off)"}, structured data ${oneLine(input.pages.structured, 10)}`,
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
    removed: removedParts(removedByKind),
    leftover,
    cut: body.cut || stepsIn.length > MAX_STEPS,
    url,
    linkHasText,
  };
}

/** The answer the AI client gets: the draft in full, what was taken out, and how to post it. */
export function summarizeFeedback(d: FeedbackDraft): string {
  const out: string[] = [
    "Feedback draft for ModWrench. Nothing has been sent: ModWrench made no network request, and GitHub gets this only if you open the link below and press its Create button.",
    d.removed.length > 0
      ? `Taken out of your words: ${d.removed.join(", ")}. Read it before you post it.`
      : "Nothing personal was recognised in your words. That isn't a promise there is nothing: read it before you post it.",
  ];
  if (d.leftover > 0) {
    out.push(`Your account or computer name is still inside ${d.leftover === 1 ? "another word" : `${d.leftover} other words`}; check ${d.leftover === 1 ? "it" : "them"}.`);
  }
  if (d.cut) out.push("It was longer than a draft takes, so the end was cut; add it on GitHub if it matters.");
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
