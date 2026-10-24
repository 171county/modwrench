// ─── The deck's faces: each job's last verdict in this session ───────────────
// The deck page shows one face per job with how that job last came out. A face
// holds one line made of a verdict and counts only (never a mod name, a folder,
// or text from the player's files), in this process's memory: nothing is
// written, and it goes when the session's server stops. TRUST.md says the same.

export const FACE_JOBS = ["crash", "setup", "patch", "updates", "crew"] as const;
export type FaceJob = (typeof FACE_JOBS)[number];

export type Face = { job: FaceJob; last?: { line: string; at: string } };

const last = new Map<FaceJob, { line: string; at: string }>();

/** Remember a job's last verdict. `line` must be built from verdict words and numbers only. */
export function noteFace(job: FaceJob, line: string): void {
  last.set(job, { line, at: new Date().toISOString() });
}

/** Every job, in the deck's order, with its last verdict when it has run in this session. */
export function deckFaces(): Face[] {
  return FACE_JOBS.map((job) => {
    const seen = last.get(job);
    return seen ? { job, last: { ...seen } } : { job };
  });
}

/** For tests: forget every face. */
export function clearFaces(): void {
  last.clear();
}

const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export function crashFace(leads: number, evidence: "log" | "log-and-install" | "partial"): string {
  const from = evidence === "log-and-install" ? "from the log and your install" : evidence === "partial" ? "from part of a log" : "from the log";
  return `crash read ${from}: ${n(leads, "lead", "leads")}`;
}

export function setupFace(verdict: "clear" | "attention" | "problems", counts: { problem: number; warn: number }): string {
  return verdict === "clear" ? "clear" : `${verdict}: ${n(counts.problem, "problem", "problems")}, ${n(counts.warn, "warning", "warnings")}`;
}

export function patchFace(verdict: "go" | "check" | "wait"): string {
  return verdict;
}

export function updatesFace(checked: number, updates: number, deprecated: number, gone: number): string {
  return `${n(updates, "update", "updates")}, ${deprecated} deprecated, ${gone} gone, of ${n(checked, "mod", "mods")} checked`;
}

export function crewFace(missing: number, versions: number, same: number): string {
  return missing + versions === 0 ? `everyone matches on ${n(same, "mod", "mods")}` : `${missing} not on everyone's list, ${versions} on different versions`;
}
