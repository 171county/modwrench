import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerPrompts,
  PROMPT_NAMES,
  PROMPT_COUNT,
  buildModwrenchPrompt,
  buildFindPrompt,
  buildCrashPrompt,
  buildConflictsPrompt,
  buildOrderPrompt,
  buildPatchPrompt,
} from "../src/prompts.js";

// registerPrompts is tested against a mock McpServer — we don't need a
// transport, just proof that every prompt registers under its expected name.
// The mock accepts the SDK's variadic prompt() overloads (name, desc, cb) and
// (name, desc, schema, cb) and records the first argument (the name).

class MockPromptServer {
  registered: string[] = [];
  prompt(...args: unknown[]): void {
    this.registered.push(args[0] as string);
  }
}

test("PROMPT_NAMES holds the six summons in menu order", () => {
  assert.deepEqual(PROMPT_NAMES, [
    "modwrench",
    "mw-find",
    "mw-crash",
    "mw-conflicts",
    "mw-order",
    "mw-patch",
  ]);
  assert.equal(PROMPT_COUNT, 6);
});

test("registerPrompts registers every prompt and reports the count", () => {
  const server = new MockPromptServer();
  const { promptCount } = registerPrompts(server as unknown as never);
  assert.equal(promptCount, 6);
  assert.deepEqual(server.registered.sort(), [...PROMPT_NAMES].sort());
});

test("/modwrench seeds a deck open", () => {
  const text = buildModwrenchPrompt().messages[0]?.content.text ?? "";
  assert.match(text, /mw_deck/);
});

test("/mw-find interpolates the query and names the search tools", () => {
  const text = buildFindPrompt("immersive armor").messages[0]?.content.text ?? "";
  assert.match(text, /immersive armor/);
  assert.match(text, /nexus_search/);
  // Attribution is non-negotiable — the summon must ask for credit to stay on.
  assert.match(text, /attribution/i);
});

test("/mw-crash with a log embeds it and parses-not-guesses", () => {
  const text = buildCrashPrompt("Unhandled exception at 0x7ff6").messages[0]?.content.text ?? "";
  assert.match(text, /mw_parse_crashlog/);
  assert.match(text, /0x7ff6/);
  assert.match(text, /don't guess beyond the data/i);
});

test("/mw-crash with no log asks where the log lives", () => {
  const text = buildCrashPrompt().messages[0]?.content.text ?? "";
  assert.match(text, /mw_parse_crashlog/);
  assert.match(text, /LogOutput\.log/);
});

test("/mw-conflicts scopes to a game and calls the conflict checker", () => {
  const text = buildConflictsPrompt("skyrimspecialedition").messages[0]?.content.text ?? "";
  assert.match(text, /skyrimspecialedition/);
  assert.match(text, /mw_check_known_conflicts/);
});

test("/mw-conflicts without a game detects the environment first", () => {
  const text = buildConflictsPrompt().messages[0]?.content.text ?? "";
  assert.match(text, /mw_detect_environment/);
  assert.match(text, /mw_check_known_conflicts/);
});

test("/mw-order reads the load order", () => {
  const text = buildOrderPrompt().messages[0]?.content.text ?? "";
  assert.match(text, /mw_read_load_order/);
});

test("/mw-patch runs the patch check and refuses to call anything safe", () => {
  const text = buildPatchPrompt().messages[0]?.content.text ?? "";
  assert.match(text, /mw_patch_day/);
  assert.match(text, /go \/ check \/ wait/);
  assert.match(text, /Don't call it safe/);
  assert.doesNotMatch(text, /targetVersion/);
});

test("/mw-patch with a version asks for that version to be judged", () => {
  const text = buildPatchPrompt(" 1.7.104 ").messages[0]?.content.text ?? "";
  assert.match(text, /targetVersion "1\.7\.104"/);
});
