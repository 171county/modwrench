// ─── Looking for a folder in what a tool says ────────────────────────────────
// The tests that prove no folder of the player's comes out look for it in a report read
// as JSON as well as in plain text. JSON doubles a Windows path's backslashes, so a path
// looked for as it is written is never found there, and on Windows the check can't fail.
// This looks for it as it is written and as JSON writes it, with its slashes either way.

/** Whether `text` holds `path`, as it is written or as JSON writes it, with backslashes or forward slashes. */
export function holdsPath(text: string, path: string): boolean {
  const forms = [path, path.replaceAll("\\", "/"), path.replaceAll("/", "\\")];
  return forms.some((form) => text.includes(form) || text.includes(JSON.stringify(form).slice(1, -1)));
}
