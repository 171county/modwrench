import type { NotChecked } from "./types.js";

// ─── One check failing must not take the report down ─────────────────────────
// The Doctors read a player's files, and a player's files can be anything: a folder
// that can't be opened, a list in an encoding nobody expected, a link that loops.
// Every file helper swallows its own errors, but a surprise inside a check is still
// possible, so each check runs through a guard. A check that stops is left out of the
// report, and the report says so under "what ModWrench couldn't check" rather than
// presenting a shorter list as a complete one.

export type Guard = {
  /** Run one check. Its result, or undefined when it stopped on an error. */
  step<T>(what: string, run: () => T): T | undefined;
  /** The checks that stopped, in the order they did. */
  readonly stopped: NotChecked[];
};

export function createGuard(): Guard {
  const stopped: NotChecked[] = [];
  return {
    stopped,
    step<T>(what: string, run: () => T): T | undefined {
      try {
        return run();
      } catch {
        // The error text is dropped on purpose: it can carry a file path.
        stopped.push({ what, why: "It stopped on an error while reading your files, so it isn't in this report." });
        return undefined;
      }
    },
  };
}
