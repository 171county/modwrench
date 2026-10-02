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

test("/mw-crash with nothing after it reads the newest log itself, and says so", () => {
  const text = buildCrashPrompt().messages[0]?.content.text ?? "";
  assert.match(text, /mw_crash_whisperer/);
  assert.match(text, /with no arguments/);
  assert.match(text, /nothing for me to paste/);
  assert.doesNotMatch(text, /mw_parse_crashlog/, "the older parse-only tool isn't what this asks for");
  assert.doesNotMatch(text, /logContent|---/, "no pasted text, so none is passed");
  // The answer is plain words, ranked leads that say how sure they are, and no verdicts.
  assert.match(text, /plain words/);
  assert.match(text, /how sure it is and what it rests on/);
  assert.match(text, /A lead isn't a finding/);
  assert.match(text, /don't call anything safe/);
  // The help post is offered, and asked for by place.
  assert.match(text, /packet set to that place/);
  assert.match(text, /forum, GitHub, Discord or the mod's author/);
  // If there is no log it asks where, in a way that keeps the name out of the chat.
  assert.match(text, /logPath/);
  assert.match(text, /only if the file can't be reached/);
});

test("/mw-crash with a file path hands the path to the tool, exactly as given, and embeds nothing", () => {
  for (const [given, expected] of [
    ["C:\\Users\\someone\\Documents\\My Games\\Skyrim Special Edition\\SKSE\\crash-2026-10-01-21-14-03.log", undefined],
    ["/home/someone/Documents/My Games/Skyrim Special Edition/SKSE/crash-1.log", undefined],
    ["~/crash.log", undefined],
    ['"C:\\Program Files (x86)\\Steam\\steamapps\\common\\Lethal Company\\BepInEx\\LogOutput.log"', "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Lethal Company\\BepInEx\\LogOutput.log"],
    ["'/home/someone/my crashes/crash.log'", "/home/someone/my crashes/crash.log"],
    ["\\\\NAS\\share\\crash.log", undefined],
    ["LogOutput.log", undefined],
  ] as const) {
    const text = buildCrashPrompt(`  ${given}  `).messages[0]?.content.text ?? "";
    const path = expected ?? given;
    assert.match(text, /mw_crash_whisperer/, given);
    assert.match(text, /logPath set to exactly the line below/, given);
    // On a line of its own, not escaped or quoted, so what the model passes on is the path itself.
    assert.ok(text.includes(`:\n${path}\n\n`), `${given}: the path is on its own line, as the player's system writes it`);
    assert.doesNotMatch(text, /logContent|---|already reached/, given);
  }
});

test("/mw-crash with pasted text passes it as logContent and says that the paste has already reached the AI", () => {
  const pasted = "Unhandled exception at 0x7ff6\nSystem Specs: ...\nProbable Call Stack:\n\t[ 0] 0x7ff6 SkyrimSE.exe+1";
  for (const text_ of [pasted, "Unhandled exception at 0x7ff6"]) {
    const text = buildCrashPrompt(text_).messages[0]?.content.text ?? "";
    assert.match(text, /mw_crash_whisperer/);
    assert.match(text, /log below as logContent/);
    assert.match(text, /already reached you with my name and folders in it/);
    assert.match(text, /`\/mw-crash` with nothing after it reads the log from disk/);
    assert.ok(text.endsWith(`---\n${text_}`), "the pasted text comes last, whole");
    assert.doesNotMatch(text, /logPath/);
  }
});

test("/mw-crash never asks for the older parse-only tool, and its description says what it does and doesn't", () => {
  for (const arg of [undefined, "C:\\x\\crash.log", "some pasted words"]) {
    assert.doesNotMatch(buildCrashPrompt(arg).messages[0]?.content.text ?? "", /mw_parse_crashlog|mw_diagnose_crash/);
  }
  let description = "";
  const server = {
    prompt: (name: string, text: string) => {
      if (name === "mw-crash") description = text;
    },
  };
  registerPrompts(server as unknown as never);
  assert.match(description, /^Why did my game crash\?/);
  assert.match(description, /read-only/i);
  assert.match(description, /A lead is not a verdict/);
  assert.doesNotMatch(description, /culprit/i);
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
