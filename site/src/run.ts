import { MAX_PASTE, whisper, type CrashWhisperResult } from "../../packages/workbench/src/crashwhisper/index.js";
import { compareCrewLists, CREW_MAX_CHARS, CREW_MAX_LISTS, type CrewList } from "../../packages/workbench/src/crew/index.js";

// What the website's Try section runs: ModWrench's own Crash Whisperer and Crew Check, on text the visitor pasted or
// picked, with nothing read from a disk and nothing sent anywhere. try.ts draws the results; this file holds no page
// code, so site/test runs it under Node, and runs the browser bundle of it with every disk call made to fail.

export { MAX_PASTE, CREW_MAX_CHARS, CREW_MAX_LISTS };
export { formatName } from "../../packages/workbench/src/crashwhisper/explain.js";
export { VENUES, type Basis, type CrashWhisperReport, type Lead } from "../../packages/workbench/src/crashwhisper/types.js";

/**
 * A file bigger than this holds more than MAX_PASTE characters whatever its encoding (UTF-8 spends at most three bytes
 * on each character JavaScript counts, plus a three-byte mark at the start), so the page refuses it without reading it.
 */
export const MAX_FILE_BYTES = 3 * MAX_PASTE + 3;

export type LogRead = CrashWhisperResult;

/** Crash Whisperer's own pipeline on a pasted log: no install to check, no other logs to compare, no names of this machine. */
export function readCrashLog(text: string): LogRead {
  if (text.trim() === "") return { ok: false, error: "Paste a crash log first, or choose its file." };
  if (text.length > MAX_PASTE) {
    return {
      ok: false,
      error: `That's more text than Crash Whisperer reads from a paste (${MAX_PASTE.toLocaleString("en-US")} characters).`,
      hint: "A crash log is usually far smaller. If this is a long BepInEx log, ModWrench installed can read the file from disk itself, at its start and end.",
    };
  }
  return whisper({ logContent: text, checkInstall: false, compareRecent: 0, redactOptions: { ownNames: false } });
}

export type CrewCompare = ReturnType<typeof compareCrewLists>;

/** Crew Check's own comparison on two or more pasted lists, with no player's profile behind it. */
export function checkCrew(lists: CrewList[]): { ok: false; error: string } | ({ ok: true } & CrewCompare) {
  const filled = lists.filter((l) => l.list.trim() !== "");
  if (filled.length < 2) return { ok: false, error: "Paste at least two crew lists to compare." };
  const long = filled.find((l) => l.list.length > CREW_MAX_CHARS);
  if (long) return { ok: false, error: `A list is longer than Crew Check reads (${CREW_MAX_CHARS.toLocaleString("en-US")} characters).` };
  return { ok: true, ...compareCrewLists(filled) };
}
