import { existsSync, readFileSync } from "node:fs";

export type OsName = "windows" | "macos" | "linux";

export function detectOs(): OsName {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    default:
      return "linux";
  }
}

/**
 * Detect SteamOS / Steam Deck by reading /etc/os-release. Returns false on
 * non-Linux systems without touching the filesystem.
 *
 * Source: Valve's Steam Deck images set ID=steamos in os-release. Holo (the
 * SteamOS 3 base) keeps the same ID, so this catches both bare metal and
 * cloned/recovery installs.
 */
export function detectSteamDeck(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const content = readFileSync("/etc/os-release", "utf8");
    const idLine = content
      .split("\n")
      .find((line) => line.startsWith("ID="));
    if (!idLine) return false;
    const id = idLine.slice(3).replace(/"/g, "").trim().toLowerCase();
    return id === "steamos" || id === "holo";
  } catch {
    return false;
  }
}

/**
 * Detect whether we're running inside Steam Deck's Game Mode (Gamescope
 * compositor) vs Desktop Mode. Game Mode can't run mod managers cleanly, so
 * this is worth surfacing to the user.
 */
export function detectGameMode(): boolean {
  if (process.platform !== "linux") return false;
  // Gamescope sets these env vars in Game Mode sessions.
  return !!(process.env.GAMESCOPE_WAYLAND_DISPLAY || process.env.SteamDeck);
}

/** Whether a path exists and is readable. Wraps existsSync with a try/catch
 * because on Windows existsSync can throw on certain reparse points. */
export function pathExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
