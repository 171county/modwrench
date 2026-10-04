import { clean } from "../patchday/summary.js";

// ─── Small text helpers shared by the answer and the help packets ────────────

const SWAPS: Record<string, string> = { "<": "(", ">": ")", "[": "(", "]": ")", "`": "'" };

/**
 * A name from a log or from a mod folder, made safe to put in text someone will post. Anyone can name
 * a mod anything, and the packets end up on forums, in GitHub issues and in Discord, where square
 * brackets can be markup, backticks end a code block, and "@" pings a person or a whole channel.
 * Those are swapped for harmless look-alikes, and the name is cut to one short line.
 */
export function safeName(value: string, max = 80): string {
  return clean(value, max)
    .replace(/[<>[\]`]/g, (c) => SWAPS[c] ?? c)
    .replace(/@/g, "(at)");
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** How many of an answer's statements rest on each basis, as a sentence that agrees with its numbers. */
export function basisSentence(basis: { log: number; install: number; rule: number; guess: number }): string {
  const total = basis.log + basis.install + basis.rule + basis.guess;
  const comes = basis.log === 1 ? "comes" : "come";
  const is = basis.guess === 1 ? "is" : "are";
  const guesses = basis.guess === 1 ? "ModWrench's own guess" : "ModWrench's own guesses";
  return (
    `Of the ${plural(total, "statement", "statements")} in this answer, ${basis.log} ${comes} from the log, ` +
    `${basis.install} from your files, ${basis.rule} from documented rules and ${basis.guess} ${is} ${guesses}.`
  );
}

/** Gigabytes, to one decimal, without a trailing ".0". */
export function gb(n: number): string {
  return `${Math.round(n * 10) / 10}`;
}
