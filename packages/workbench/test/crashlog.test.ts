import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseCrashlog } from "../src/crashlog/index.js";
import { detectCrashlogType } from "../src/crashlog/detect.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(resolve(HERE, "fixtures", name), "utf8");

// ─── detectCrashlogType ──────────────────────────────────────────────────────

test("detect: Crash Logger SSE", () => {
  assert.equal(detectCrashlogType(fixture("crash-sse.log")), "crashlogger-sse");
});

test("detect: Buffout 4", () => {
  assert.equal(detectCrashlogType(fixture("crash-buffout4.log")), "buffout4");
});

test("detect: BepInEx", () => {
  assert.equal(detectCrashlogType(fixture("LogOutput.log")), "bepinex");
});

test("detect: NetScriptFramework", () => {
  assert.equal(
    detectCrashlogType(fixture("crash-netscriptframework.log")),
    "netscriptframework"
  );
});

test("detect: unknown content returns 'unknown'", () => {
  assert.equal(
    detectCrashlogType("just some random text with no signature"),
    "unknown"
  );
});

// ─── parseCrashlog: input handling ───────────────────────────────────────────

test("parseCrashlog: empty content returns error", () => {
  const result = parseCrashlog({ logContent: "" });
  assert.equal(result.ok, false);
});

test("parseCrashlog: missing both content and path returns error", () => {
  const result = parseCrashlog({});
  assert.equal(result.ok, false);
});

test("parseCrashlog: unknown format returns clear error", () => {
  const result = parseCrashlog({ logContent: "random text" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /Could not auto-detect/);
});

// ─── Crash Logger SSE ────────────────────────────────────────────────────────

test("SSE: extracts game and logger versions", () => {
  const result = parseCrashlog({ logContent: fixture("crash-sse.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.gameVersion ?? "", /Skyrim SSE/);
  assert.match(result.loggerVersion ?? "", /CrashLoggerSSE/);
});

test("SSE: extracts exception type and address", () => {
  const result = parseCrashlog({ logContent: fixture("crash-sse.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.exception.type, "EXCEPTION_ACCESS_VIOLATION");
  assert.match(result.exception.address ?? "", /^0x[0-9A-Fa-f]+$/);
});

test("SSE: parses call stack with module and offset", () => {
  const result = parseCrashlog({ logContent: fixture("crash-sse.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.callStack.length >= 4);
  const first = result.callStack[0];
  assert.equal(first?.module, "SkyrimSE.exe");
  assert.equal(first?.offset, "1AA3A3F0");
  assert.equal(first?.index, 0);
});

test("SSE: parses all loaded plugins with load indices including ESLs", () => {
  const result = parseCrashlog({ logContent: fixture("crash-sse.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.loadedPlugins.length >= 5);
  const esl = result.loadedPlugins.find((p) => p.name === "SomeESL.esl");
  assert.ok(esl, "expected to find SomeESL.esl");
  assert.equal(esl?.loadIndex, "FE 001");
});

test("SSE: parses registers", () => {
  const result = parseCrashlog({ logContent: fixture("crash-sse.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.registers);
  assert.match(result.registers?.["RAX"] ?? "", /^0x[0-9A-Fa-f]+$/);
});

test("SSE: suspectedRefs preserves plugin names with spaces (regression)", () => {
  // Earlier regex used \S+ which truncated "JKs Whiterun Outskirts.esp"
  // to just "Outskirts.esp". This test prevents that regression.
  const result = parseCrashlog({ logContent: fixture("crash-sse.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.suspectedRefs);
  const multiWord = result.suspectedRefs?.find((r) =>
    r.likelySource?.includes("Whiterun Outskirts")
  );
  assert.ok(
    multiWord,
    "expected likelySource to preserve full multi-word plugin name"
  );
  assert.equal(multiWord?.likelySource, "JKs Whiterun Outskirts.esp");
});

test("SSE: suspectedRefs preserves plugin names with hyphens", () => {
  const result = parseCrashlog({ logContent: fixture("crash-sse.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const hyphenated = result.suspectedRefs?.find((r) =>
    r.likelySource?.includes("Cities of the North")
  );
  assert.equal(hyphenated?.likelySource, "Cities of the North - Whiterun.esp");
});

test("SSE: rawSections preserves unparsed section text", () => {
  const result = parseCrashlog({ logContent: fixture("crash-sse.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // The full PROBABLE CALL STACK text should be in rawSections so the LLM
  // can inspect anything we didn't structure.
  assert.ok(result.rawSections["PROBABLE CALL STACK"]);
  assert.match(result.rawSections["PROBABLE CALL STACK"] ?? "", /SkyrimSE\.exe/);
});

// ─── Buffout 4 ───────────────────────────────────────────────────────────────

test("Buffout 4: detected and parsed with Fallout 4 game version", () => {
  const result = parseCrashlog({ logContent: fixture("crash-buffout4.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.detectedType, "buffout4");
  assert.match(result.gameVersion ?? "", /Fallout 4/);
});

test("Buffout 4: shares parser with SSE — call stack + plugins extracted", () => {
  const result = parseCrashlog({ logContent: fixture("crash-buffout4.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.callStack.length > 0);
  assert.ok(result.loadedPlugins.length > 0);
});

// ─── BepInEx ─────────────────────────────────────────────────────────────────

test("BepInEx: surfaces most recent Fatal as primary exception", () => {
  const result = parseCrashlog({ logContent: fixture("LogOutput.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.detectedType, "bepinex");
  // The fixture's most recent Fatal is InvalidOperationException — should be
  // surfaced; earlier NullReferenceException goes to rawSections.
  assert.equal(result.exception.type, "InvalidOperationException");
});

test("BepInEx: extracts Loading [Plugin x.y.z] entries", () => {
  const result = parseCrashlog({ logContent: fixture("LogOutput.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const lethalConfig = result.loadedPlugins.find(
    (p) => p.name === "LethalConfig"
  );
  assert.ok(lethalConfig, "expected LethalConfig in loaded plugins");
});

test("BepInEx: earlier fatal events preserved in rawSections", () => {
  const result = parseCrashlog({ logContent: fixture("LogOutput.log") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.rawSections["earlier_fatal_events"]);
  assert.match(
    result.rawSections["earlier_fatal_events"] ?? "",
    /NullReferenceException/
  );
});

// ─── NetScriptFramework ──────────────────────────────────────────────────────

test("NetScriptFramework: extracts exception type from Crash Reason", () => {
  const result = parseCrashlog({
    logContent: fixture("crash-netscriptframework.log"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.detectedType, "netscriptframework");
  assert.equal(result.exception.type, "AccessViolationException");
});

test("NetScriptFramework: extracts call stack and plugins", () => {
  const result = parseCrashlog({
    logContent: fixture("crash-netscriptframework.log"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.callStack.length >= 2);
  assert.ok(result.loadedPlugins.length >= 3);
});
