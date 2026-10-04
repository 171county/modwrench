import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanBepInEx } from "../src/crashwhisper/bepinex-scan.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(resolve(HERE, "fixtures", name), "utf8");

// BepInEx's chainloader messages below are the ones in its own source: Chainloader.cs at v5.4.21 and v5.4.23.2, which
// the fixture is written in, and BaseChainloader.cs on master (6.x). The fixture is laid out the way a real
// LogOutput.log is, with invented mod names.

test("the loader, the game and the Unity version come from the first lines", () => {
  const f = scanBepInEx(fixture("LogOutput-real-format.log"));
  assert.equal(f.loader, "BepInEx 5.4.21.0");
  assert.equal(f.game, "Lethal Company");
  assert.equal(f.unity, "2022.3.9");
});

test("every kind of load problem BepInEx reports is read, with the plugin and what it said", () => {
  const f = scanBepInEx(fixture("LogOutput-real-format.log"));
  assert.deepEqual(
    f.problems.map((p) => [p.kind, p.plugin, p.level]),
    [
      ["wrong-bepinex", "BetterEmotes 1.4.0", "Warning"],
      ["missing-dependency", "CompanyCosmetics 2.0.0", "Error"],
      ["dependency-not-loaded", "CosmeticAddons 1.1.0", "Warning"],
      ["load-error", "ShipLoot 3.0.0", "Error"],
    ]
  );
  const missing = f.problems.find((p) => p.kind === "missing-dependency");
  assert.equal(missing?.detail, "x753.Lethal_Company_Variables (v1.0.0 or newer)");
  const wrong = f.problems.find((p) => p.kind === "wrong-bepinex");
  assert.equal(wrong?.detail, "5.4.19.0");
  const failed = f.problems.find((p) => p.kind === "load-error");
  assert.match(failed?.detail ?? "", /^Could not load type of field/);
});

test("a failed load is read in BepInEx 5's words (a space before the colon) and in BepInEx 6's", () => {
  const f = scanBepInEx(
    [
      // Chainloader.cs, v5.4.21 and v5.4.23.2: $"Error loading [{pluginInfo}] : {ex.Message}"
      "[Error  :   BepInEx] Error loading [ShipLoot 3.0.0] : Could not load file or assembly 'LethalLib'",
      // BaseChainloader.cs on master: $"Error loading [{plugin}]: {ex}"
      "[Error  :   BepInEx] Error loading [Other 1.0.0]: System.TypeLoadException: Could not load type 'X'",
    ].join("\n")
  );
  assert.deepEqual(
    f.problems.map((p) => [p.kind, p.plugin, p.detail]),
    [
      ["load-error", "ShipLoot 3.0.0", "Could not load file or assembly 'LethalLib'"],
      ["load-error", "Other 1.0.0", "System.TypeLoadException: Could not load type 'X'"],
    ]
  );
});

test("incompatible versions and 'incompatible with' are told apart from a missing dependency", () => {
  const f = scanBepInEx(
    [
      "[Error  :   BepInEx] Could not load [Alpha 1.0.0] because the following dependencies are installed with an incompatible version: Beta (2.0.0). Update the listed plugin(s) and restart the game.",
      "[Error  :   BepInEx] Could not load [Gamma 1.0.0] because it is incompatible with: Delta, Epsilon",
    ].join("\n")
  );
  assert.deepEqual(
    f.problems.map((p) => [p.kind, p.plugin, p.detail]),
    [
      ["incompatible-version", "Alpha 1.0.0", "Beta (2.0.0)"],
      ["incompatible-with", "Gamma 1.0.0", "Delta, Epsilon"],
    ]
  );
});

test("a line that merely mentions loading isn't a problem", () => {
  const f = scanBepInEx(["[Info   :   BepInEx] Loading [Fine 1.0.0]", "[Message:Fine] Could not load the texture, using a fallback"].join("\n"));
  assert.deepEqual(f.problems, []);
});

test("every logged error is kept with its type and the namespaces on its stack", () => {
  const f = scanBepInEx(fixture("LogOutput-real-format.log"));
  assert.equal(f.errorCount, 5);
  const last = f.events.at(-1);
  assert.equal(last?.type, "IndexOutOfRangeException");
  assert.equal(last?.source, "Unity Log");
  assert.deepEqual(last?.modules, ["HUDManager", "LethalConfig", "UnityEngine", "BetterEmotes"]);
  const first = f.events.find((e) => e.type === "NullReferenceException");
  assert.deepEqual(first?.modules, ["MoreCompany"]);
});

test("errors that repeat are counted, most repeated first", () => {
  const f = scanBepInEx(fixture("LogOutput-real-format.log"));
  assert.deepEqual(f.repeats, [{ key: "NullReferenceException|MoreCompany", type: "NullReferenceException", source: "MoreCompany", count: 2 }]);
});

test("a log with no errors has none, and says so", () => {
  const f = scanBepInEx("[Message:   BepInEx] BepInEx 5.4.21.0 - Valheim (1/15/2024 2:30:00 PM)\n[Info   :   BepInEx] Loading [Fine 1.0.0]\n");
  assert.equal(f.errorCount, 0);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.repeats, []);
  assert.equal(f.game, "Valheim");
});

test("a Warning-level line is not an error", () => {
  const f = scanBepInEx("[Warning: Some Mod] That config value is deprecated\nStack trace:\nSomeMod.Config.Load ()\n");
  assert.equal(f.errorCount, 0);
});

test("a stack line after an error that isn't in a trace is not read as one", () => {
  const f = scanBepInEx(["[Error  : Unity Log] Something failed", "this line is just prose and not a stack frame", "at Real.Frame.Run ()"].join("\n"));
  assert.deepEqual(f.events[0]?.modules, ["Real"]);
});

test("a very long log keeps the first 400 errors and still counts all of them", () => {
  const text = Array.from({ length: 1000 }, (_, i) => `[Error  : Unity Log] Failure number ${i}\nStack trace:\nSomeMod.Thing.Run ()\n`).join("");
  const f = scanBepInEx(text);
  assert.equal(f.errorCount, 1000);
  assert.equal(f.events.length, 400);
});

test("a very long first line of an error is cut, not carried whole", () => {
  const f = scanBepInEx(`[Error  : Unity Log] NullReferenceException: ${"x".repeat(5000)}\n`);
  assert.ok((f.events[0]?.message.length ?? 0) <= 200);
});

test("one error's stack lists at most 24 namespaces", () => {
  const frames = Array.from({ length: 60 }, (_, i) => `Ns${i}.Thing.Run ()`).join("\n");
  const f = scanBepInEx(`[Error  : Unity Log] Boom\nStack trace:\n${frames}\n`);
  assert.equal(f.events[0]?.modules.length, 24);
});

test("Windows line endings read the same as Unix ones", () => {
  const f = scanBepInEx(fixture("LogOutput-real-format.log").replace(/\n/g, "\r\n"));
  assert.equal(f.errorCount, 5);
  assert.equal(f.problems.length, 4);
});

test("text that isn't a BepInEx log at all gives nothing, without failing", () => {
  const f = scanBepInEx("hello\nworld\n");
  assert.deepEqual(f, { problems: [], events: [], errorCount: 0, repeats: [] });
});
