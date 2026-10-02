import { parseVdf, type VdfObject, type VdfValue } from "../detect/vdf.js";
import { listDir, readText, resolveCI } from "./fsutil.js";

// ─── Two small files that decide whether BepInEx loads under Proton ─────────
// A Windows Unity game run through Proton loads Wine's own winhttp.dll unless it
// is told to prefer the one in the game folder, and BepInEx's loader is a winhttp.dll.
// The "prefer ours" setting can live in two places a file read can see:
//   - the game's Steam launch options, WINEDLLOVERRIDES="winhttp=n,b" %command%
//   - the Proton prefix's own registry file, user.reg, where winecfg and r2modman put it
// A manager can also set it in the environment of the process it starts, which no file shows.
//
// The launch options live in Steam's per-account localconfig.vdf, a file that also holds
// other personal settings. Only the one line for this game is looked at, and its text is
// never returned: callers get a yes or no.

function child(value: VdfValue | undefined, key: string): VdfValue | undefined {
  if (value === undefined || typeof value === "string") return undefined;
  const wanted = key.toLowerCase();
  for (const k of Object.keys(value)) if (k.toLowerCase() === wanted) return value[k];
  return undefined;
}

function at(root: VdfObject, ...keys: string[]): VdfValue | undefined {
  let current: VdfValue | undefined = root;
  for (const key of keys) current = child(current, key);
  return current;
}

/** The launch options set for `appId` by each Steam account on this computer. */
export function launchOptionsFor(steamRoot: string, appId: string): string[] {
  const out: string[] = [];
  const userdata = resolveCI(steamRoot, "userdata");
  if (userdata === null) return out;
  for (const id of listDir(userdata)) {
    if (!/^\d+$/.test(id)) continue;
    const file = resolveCI(userdata, id, "config", "localconfig.vdf");
    if (file === null) continue;
    const text = readText(file, 16 * 1024 * 1024);
    if (text === null) continue;
    const root = parseVdf(text);
    if (root === null) continue;
    const options = at(root, "Software", "Valve", "Steam", "apps", appId, "LaunchOptions");
    if (typeof options === "string" && options.trim() !== "") out.push(options);
  }
  return out;
}

/** `value` is what follows "WINEDLLOVERRIDES=": does it make `dll` prefer the native (game folder) copy? */
export function overridesPreferNative(value: string, dll: string): boolean {
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const names = part
      .slice(0, eq)
      .split(",")
      .map((n) => n.trim().toLowerCase().replace(/\.dll$/, ""));
    const mode = (part.slice(eq + 1).split(",")[0] ?? "").trim().toLowerCase();
    if (names.includes(dll) && (mode === "n" || mode === "native")) return true;
  }
  return false;
}

/** Does a launch-options line carry a WINEDLLOVERRIDES that prefers the game's own winhttp.dll? */
export function launchOptionsOverrideWinhttp(options: string): boolean {
  const text = options.replace(/\\"/g, '"');
  for (const m of text.matchAll(/WINEDLLOVERRIDES\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/gi)) {
    if (overridesPreferNative(m[1] ?? m[2] ?? m[3] ?? "", "winhttp")) return true;
  }
  return false;
}

/**
 * Whether the prefix's user.reg prefers a native winhttp. Null when the prefix has no user.reg,
 * which is how a prefix that Proton hasn't finished setting up looks.
 */
export function prefixPrefersNativeWinhttp(prefixDir: string): boolean | null {
  const file = resolveCI(prefixDir, "user.reg");
  if (file === null) return null;
  const text = readText(file, 16 * 1024 * 1024);
  if (text === null) return null;
  let inSection = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inSection = /^\[software\\{1,2}wine\\{1,2}dlloverrides\]/i.test(line);
      continue;
    }
    if (!inSection) continue;
    const m = /^"winhttp(?:\.dll)?"\s*=\s*"([^"]*)"/i.exec(line);
    if (m !== null) {
      const first = (m[1] ?? "").split(",")[0]!.trim().toLowerCase();
      if (first === "native" || first === "n") return true;
    }
  }
  return false;
}
