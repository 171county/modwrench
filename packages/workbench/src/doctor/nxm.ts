import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { clean } from "../patchday/summary.js";
import { isFile, readText } from "./fsutil.js";
import type { DoctorFinding } from "./types.js";

// ─── Which app opens nxm:// links ────────────────────────────────────────────
// The "Mod Manager Download" button on Nexus Mods opens an nxm:// link. On Linux, which
// program receives it is decided by the freedesktop mime-apps files: mimeapps.list names
// a default for x-scheme-handler/nxm, a .desktop file says what to run, and mimeinfo.cache
// lists which .desktop files claim the type. This follows those files the way the
// specification orders them. It doesn't run xdg-mime or open the link.
// Spec: https://specifications.freedesktop.org/mime-apps-spec/latest/

const TYPE = "x-scheme-handler/nxm";
const FAQ = "https://nexus-mods.github.io/NexusMods.App/users/faq/NexusModsDownloads/";

type Env = Record<string, string | undefined>;

export type NxmResult =
  | { status: "ok"; id: string; name: string; label: string }
  | { status: "program-missing"; id: string; name: string; label: string }
  | { status: "launcher-missing"; ids: string[] }
  | { status: "no-default"; claimants: string[] }
  | { status: "none" };

// The XDG lists are separated by ':', which is path.delimiter on Linux. Splitting on the
// delimiter keeps a Windows drive letter whole when the tests run there.
function split(value: string | undefined, fallback: string[]): string[] {
  const parts = (value ?? "").split(delimiter).filter((p) => p !== "");
  return parts.length > 0 ? parts : fallback;
}

type KeyFile = Record<string, Record<string, string>>;

function parseKeyFile(text: string): KeyFile {
  const out: KeyFile = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq > 0 && section !== "") (out[section] ??= {})[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const ids = (value: string | undefined): string[] => (value ?? "").split(";").map((s) => s.trim()).filter((s) => s !== "");

/** The first word of an Exec line that names a program: past "env" and VAR=value prefixes, quotes removed. */
function execProgram(exec: string): string | null {
  const tokens = exec.match(/"[^"]*"|\S+/g) ?? [];
  for (const raw of tokens) {
    const token = raw.replace(/^"|"$/g, "");
    if (token === "env" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    return token;
  }
  return null;
}

function friendly(id: string, name: string, exec: string): string {
  const hay = `${id} ${exec}`.toLowerCase();
  if (/modorganizer|mo2/.test(hay)) return "Mod Organizer 2";
  if (/vortex/.test(hay)) return "Vortex";
  if (/nexusmods-app|nexusmods\.app/.test(hay)) return "the Nexus Mods App";
  if (/limo/.test(hay)) return "Limo";
  return clean(name || id, 50);
}

export function findNxmHandler(env: Env = process.env, home: string = homedir()): NxmResult {
  const configHome = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== "" ? env.XDG_CONFIG_HOME : join(home, ".config");
  const dataHome = env.XDG_DATA_HOME && env.XDG_DATA_HOME !== "" ? env.XDG_DATA_HOME : join(home, ".local", "share");
  const configDirs = split(env.XDG_CONFIG_DIRS, ["/etc/xdg"]);
  const dataDirs = split(env.XDG_DATA_DIRS, ["/usr/local/share", "/usr/share"]);
  const desktops = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":").filter((d) => d !== "");

  // Flatpak exports each app's launcher file into its installation's exports folder. flatpak(1)
  // puts the per-user installation in $XDG_DATA_HOME/flatpak and the system-wide one in
  // /var/lib/flatpak, and lets FLATPAK_USER_DIR and FLATPAK_SYSTEM_DIR move them.
  const flatpakUser = env.FLATPAK_USER_DIR && env.FLATPAK_USER_DIR !== "" ? env.FLATPAK_USER_DIR : join(dataHome, "flatpak");
  const flatpakSystem = env.FLATPAK_SYSTEM_DIR && env.FLATPAK_SYSTEM_DIR !== "" ? env.FLATPAK_SYSTEM_DIR : join("/var", "lib", "flatpak");
  const appDirs = [
    join(dataHome, "applications"),
    ...dataDirs.map((d) => join(d, "applications")),
    join(flatpakUser, "exports", "share", "applications"),
    join(flatpakSystem, "exports", "share", "applications"),
  ];

  // The lists, in the order the specification reads them. At each place the files named for the
  // desktop come first.
  const listFiles: string[] = [];
  const addList = (dir: string): void => {
    for (const d of desktops) listFiles.push(join(dir, `${d}-mimeapps.list`));
    listFiles.push(join(dir, "mimeapps.list"));
  };
  addList(configHome);
  for (const d of configDirs) addList(d);
  addList(join(dataHome, "applications"));
  for (const d of dataDirs) addList(join(d, "applications"));

  const desktopFile = (id: string): string | null => {
    for (const dir of appDirs) {
      const file = join(dir, id);
      if (isFile(file)) return file;
    }
    return null;
  };
  const describe = (id: string, file: string) => {
    const entry = parseKeyFile(readText(file, 256 * 1024) ?? "")["Desktop Entry"] ?? {};
    const exec = entry["Exec"] ?? "";
    const program = execProgram(exec);
    const tryExec = entry["TryExec"];
    const gone = [program, tryExec].some((p) => p !== undefined && p !== null && /^(?:\/|[A-Za-z]:[\\/])/.test(p) && !isFile(p));
    return { name: entry["Name"] ?? id, label: friendly(id, entry["Name"] ?? "", exec), gone };
  };

  const unfound: string[] = [];
  for (const file of listFiles) {
    const text = readText(file, 512 * 1024);
    if (text === null) continue;
    const defaults = ids(parseKeyFile(text)["Default Applications"]?.[TYPE]);
    if (defaults.length === 0) continue;
    for (const id of defaults) {
      const found = desktopFile(id);
      if (found === null) {
        unfound.push(id);
        continue;
      }
      const d = describe(id, found);
      return { status: d.gone ? "program-missing" : "ok", id, name: d.name, label: d.label };
    }
  }
  if (unfound.length > 0) return { status: "launcher-missing", ids: [...new Set(unfound)] };

  // No default anywhere: who claims the type?
  const claimants = new Set<string>();
  for (const file of listFiles) {
    const text = readText(file, 512 * 1024);
    if (text === null) continue;
    for (const id of ids(parseKeyFile(text)["Added Associations"]?.[TYPE])) if (desktopFile(id) !== null) claimants.add(id);
  }
  for (const dir of appDirs) {
    const text = readText(join(dir, "mimeinfo.cache"), 4 * 1024 * 1024);
    if (text === null) continue;
    for (const id of ids(parseKeyFile(text)["MIME Cache"]?.[TYPE])) if (desktopFile(id) !== null) claimants.add(id);
  }
  return claimants.size > 0 ? { status: "no-default", claimants: [...claimants].sort() } : { status: "none" };
}

/** What the result means for someone who downloads mods from Nexus Mods. */
export function judgeNxm(result: NxmResult): DoctorFinding {
  const base = { id: "deck.nxm-handler", area: "deck" as const, basis: "install" as const };
  switch (result.status) {
    case "ok":
      return {
        ...base,
        status: "ok",
        title: `nxm:// links open ${result.label}`,
        detail: `The Mod Manager Download button on Nexus Mods hands its link to ${result.label}.`,
      };
    case "program-missing":
      return {
        ...base,
        status: "warn",
        title: "nxm:// links go to a program that isn't there",
        detail: `nxm:// links are set to open ${result.label}, but the launcher file points at a program that no longer exists, so the Mod Manager Download button will do nothing.`,
        fix: "Reinstall that manager, or point the links at the one you use now.",
        source: FAQ,
      };
    case "launcher-missing":
      return {
        ...base,
        status: "warn",
        title: "nxm:// links point at a launcher that isn't installed",
        detail: `Your mime settings name ${result.ids.slice(0, 3).map((i) => clean(i, 60)).join(", ")} for nxm:// links, but no such launcher file exists, so the Mod Manager Download button will do nothing.`,
        fix: "Reinstall the manager that came with it, or set a different default: xdg-settings set default-url-scheme-handler nxm <launcher>.desktop",
        source: FAQ,
      };
    case "no-default": {
      const named = result.claimants.slice(0, 3).map((i) => clean(i, 60)).join(", ");
      if (result.claimants.length === 1) {
        return {
          ...base,
          status: "note",
          title: "One app claims nxm:// links, but it isn't the default",
          detail: `1 installed launcher claims nxm:// links (${named}), but it isn't set as the default, so the Mod Manager Download button relies on the desktop falling back to it.`,
          fix: "Make it the default: xdg-settings set default-url-scheme-handler nxm <launcher>.desktop",
          source: FAQ,
        };
      }
      return {
        ...base,
        status: "note",
        title: "Several apps claim nxm:// links, none is the default",
        detail: `${result.claimants.length} installed launchers claim nxm:// links (${named}), but none is set as the default, so which one opens is down to the desktop.`,
        fix: "Pick one: xdg-settings set default-url-scheme-handler nxm <launcher>.desktop",
        source: FAQ,
      };
    }
    default:
      return {
        ...base,
        status: "note",
        title: "Nothing is set to open nxm:// links",
        detail: "No app is registered for nxm:// links, so the Mod Manager Download button on Nexus Mods won't open anything. You can still download files by hand.",
        fix: "A mod manager that handles Nexus downloads registers itself with a launcher file; xdg-settings set default-url-scheme-handler nxm <launcher>.desktop makes it the default. To test, run xdg-open nxm://premium.",
        source: FAQ,
      };
  }
}
