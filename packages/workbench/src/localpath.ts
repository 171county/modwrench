import { win32 } from "node:path";

// ─── This computer's own drives only ─────────────────────────────────────────
// A path argument is a string the model chose, and the model also reads text other
// people wrote (a mod page, a crash log). On Windows, opening \\host\share\x makes the
// system connect to that host over SMB and offer the signed-in account's credentials
// before a single byte is read. The workbench tools say they make no network request,
// so a path that names another computer or a device is refused before anything opens it.
// Mod Organizer 2's own files (ModOrganizer.ini, modlist.txt) are text anyone can plant
// too, so a folder they lead to gets the same check before it is opened.
//
// Refused: anything that starts with two slashes or backslashes in any mix, which is how
// Windows spells another computer (\\host\share, //host/share, \\?\UNC\host\share) and a
// device (\\.\pipe\x, \\.\C:, \\?\GLOBALROOT\...). Allowed: \\?\C:\..., the long-path
// spelling of a local drive, judged after folding its "." and ".." the way Node does
// before it opens it: \\?\C:\..\UNC\host\share folds to \\?\UNC\host\share. Not covered:
// a drive letter the person mapped to a share, or a link on a local drive that points at
// one. Those were set up by the person, not chosen by the model.

const TWO_SEPARATORS = /^[\\/]{2}/;
const LOCAL_LONG_PATH = /^[\\/]{2}\?[\\/][A-Za-z]:(?:[\\/]|$)/;

/** True when `path` names another computer or a device rather than a place on a local drive. */
export function isNetworkPath(path: string): boolean {
  const p = path.trimStart();
  return TWO_SEPARATORS.test(p) && !LOCAL_LONG_PATH.test(win32.resolve(p));
}
