import type { CrashlogType } from "./types.js";

// Format detection based on first ~50 lines + filename hints. SSE and
// Buffout 4 are close cousins so we differentiate them by the game-name line.

export function detectCrashlogType(
  text: string,
  filenameHint?: string
): CrashlogType {
  const head = text.split(/\r?\n/, 60).join("\n");
  const headLower = head.toLowerCase();

  if (
    headLower.includes("crashloggersse") ||
    /^Skyrim (SSE|VR|AE) /.test(head)
  ) {
    return "crashlogger-sse";
  }

  if (
    headLower.includes("buffout 4") ||
    headLower.includes("buffout4") ||
    /^Fallout 4 v/m.test(head)
  ) {
    return "buffout4";
  }

  if (
    headLower.includes("netscriptframework crash log") ||
    headLower.includes("net script framework")
  ) {
    return "netscriptframework";
  }

  // BepInEx LogOutput.log: opens with [Message:   BepInEx] or similar
  // bracketed log-level markers.
  if (/^\[(Message|Info|Warning|Error|Fatal|Debug)\s*:\s*/m.test(head)) {
    return "bepinex";
  }

  // Filename fallback — useful when content sniffing fails on a truncated log.
  if (filenameHint) {
    const f = filenameHint.toLowerCase();
    if (f.includes("crash-")) {
      if (f.includes("skyrim")) return "crashlogger-sse";
      if (f.includes("fallout")) return "buffout4";
    }
    if (f === "logoutput.log" || f.endsWith("/logoutput.log")) return "bepinex";
  }

  return "unknown";
}
