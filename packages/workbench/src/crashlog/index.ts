import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathExists } from "../detect/os.js";
import { detectCrashlogType } from "./detect.js";
import { parseCrashloggerSse } from "./crashlogger-sse.js";
import { parseBepInExLog } from "./bepinex.js";
import { parseMinecraftCrashReport } from "./minecraft.js";
import { parseNetScriptFramework } from "./netscriptframework.js";
import type { CrashlogParseResult, CrashlogType } from "./types.js";

export type ParseCrashlogInput = {
  logContent?: string;
  logPath?: string;
  logType?: CrashlogType | "auto";
};

export type ParseCrashlogError = {
  ok: false;
  reason: string;
};

export type ParseCrashlogSuccess = CrashlogParseResult & { ok: true };

export function parseCrashlog(
  input: ParseCrashlogInput
): ParseCrashlogSuccess | ParseCrashlogError {
  let text = input.logContent;
  let filenameHint: string | undefined;

  if (!text) {
    if (!input.logPath) {
      return {
        ok: false,
        reason: "Provide either logContent or logPath.",
      };
    }
    if (!pathExists(input.logPath)) {
      return {
        ok: false,
        reason: `logPath does not exist: ${input.logPath}`,
      };
    }
    try {
      text = readFileSync(input.logPath, "utf8");
      filenameHint = basename(input.logPath);
    } catch (err) {
      return {
        ok: false,
        reason: `Failed to read logPath: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  if (!text || text.trim().length === 0) {
    return { ok: false, reason: "Crashlog content is empty." };
  }

  const declared = input.logType && input.logType !== "auto" ? input.logType : null;
  const detected = declared ?? detectCrashlogType(text, filenameHint);

  let parsed: CrashlogParseResult;
  switch (detected) {
    case "crashlogger-sse":
    case "buffout4":
      parsed = parseCrashloggerSse(text, detected);
      break;
    case "bepinex":
      parsed = parseBepInExLog(text);
      break;
    case "minecraft":
      parsed = parseMinecraftCrashReport(text);
      break;
    case "netscriptframework":
      parsed = parseNetScriptFramework(text);
      break;
    default:
      return {
        ok: false,
        reason:
          "Could not auto-detect the crashlog format. Pass logType explicitly " +
          "(crashlogger-sse, buffout4, netscriptframework, bepinex, or minecraft).",
      };
  }

  return { ok: true, ...parsed };
}
