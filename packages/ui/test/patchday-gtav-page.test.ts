import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPatchDayApp } from "../src/index.js";
import { loadPage, textOf, type Fake } from "./helpers/page-harness.js";

// ─── The Patch Day page with a GTA V report ──────────────────────────────────
// mw_patch_day answers for GTA V with a report of its own (kind "gtav"): Script Hook V
// and its log where Skyrim's has plugins and an Address Library. The page draws its
// verdict, how sure it is, a row of chips, the steps and the limits, and leaves out
// the plugin sections, their labels and the plugin folders.

const REPORT = {
  ok: true,
  kind: "gtav",
  verdict: "wait",
  headline: "WAIT — Script Hook V supports GTA V Enhanced up to 1.0.1158.13, and the game is 1.0.1158.16.",
  reasons: ["Script Hook V supports the game versions up to the one it was built for, and 1.0.1158.16 is newer."],
  confidence: { evidence: "files", summary: "From the game's and Script Hook V's version numbers." },
  game: { id: "gta5enhanced", name: "GTA V Enhanced" },
  checked: { version: "1.0.1158.16", source: "installed", installed: "1.0.1158.16" },
  steam: { updatePending: false },
  scriptHook: { present: true, version: "3889.0/1158.13", supports: "1.0.1158.13" },
  log: { found: true, fresh: true, outcome: "unknown-version", scriptsRegistered: 0 },
  otherEdition: null,
  limits: ["It checks Script Hook V only."],
  nextSteps: ["Get the newest Script Hook V from dev-c.com/gtav/scripthookv."],
};

const chips = (page: ReturnType<typeof loadPage>): Array<{ tone: string; text: string }> =>
  page.el("chips").children.map((c: Fake) => ({ tone: c.attrs["data-tone"] ?? "", text: textOf(c) }));

test("a GTA V report: the verdict, Script Hook V, Steam and the log as chips, and no plugin sections", async () => {
  const page = loadPage(renderPatchDayApp());
  await page.show(REPORT);
  assert.equal(page.el("mw-root").attrs["data-verdict"], "wait");
  assert.equal(page.el("verdict-word").textContent, "WAIT");
  assert.deepEqual(chips(page), [
    { tone: "info", text: "–GTA V Enhanced1.0.1158.16 (for information)" },
    { tone: "bad", text: "✕Script Hook Vsupports up to 1.0.1158.13 (a problem)" },
    { tone: "ok", text: "✓Steamno update waiting (fine)" },
    { tone: "bad", text: "✕Script Hook V logUnknown game version (a problem)" },
  ]);
  for (const id of ["plugins", "ahead", "clash", "where", "legend"]) assert.equal(page.el(id).hidden, true, id);
  assert.equal(page.el("steps").hidden, false);
  assert.equal(page.el("limits").hidden, false);
  assert.match(textOf(page.el("sure")), /Script Hook V|Files/);
  // The what-if box suggests a GTA V version, not Skyrim's 1.7.104.
  assert.equal((page.el("whatif") as unknown as { placeholder?: string }).placeholder, "1.0.1158.16");
});

test("a GTA V report where the build covers the game, and one without Script Hook V", async () => {
  const covered = loadPage(renderPatchDayApp());
  await covered.show({
    ...REPORT,
    verdict: "go",
    checked: { version: "1.0.1158.13", source: "installed", installed: "1.0.1158.13" },
    log: { found: true, fresh: true, outcome: "started", recognised: "VER_EN_1_0_1158_13", scriptsRegistered: 1 },
  });
  assert.deepEqual(
    chips(covered).map((c) => c.tone),
    ["info", "ok", "ok", "ok"]
  );
  assert.match(chips(covered)[3]!.text, /started, 1 script \(fine\)$/);

  const none = loadPage(renderPatchDayApp());
  await none.show({ ...REPORT, verdict: "go", scriptHook: { present: false, version: null, supports: null }, log: null, steam: null });
  assert.deepEqual(chips(none), [
    { tone: "info", text: "–GTA V Enhanced1.0.1158.16 (for information)" },
    { tone: "info", text: "–Script Hook Vnot installed (for information)" },
  ]);
});
