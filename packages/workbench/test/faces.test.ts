import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CREW_LIST_HEADER } from "../src/crew/index.js";
import { FACE_JOBS, clearFaces, crashFace, crewFace, deckFaces, patchFace, setupFace, updatesFace } from "../src/faces.js";
import { registerWorkbenchTools } from "../src/register.js";
import { r2profile, withEnv } from "./helpers/r2profile.js";

// ─── The deck's faces ────────────────────────────────────────────────────────
// Each job's last verdict in this session: verdict words and numbers only, in
// memory, recorded when a job actually ran.

const root = mkdtempSync(join(tmpdir(), "mw-faces-"));
after(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => clearFaces());

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
function tools(): Map<string, Handler> {
  const out = new Map<string, Handler>();
  registerWorkbenchTools({ registerTool: (name: string, _c: unknown, handler: Handler) => void out.set(name, handler) } as never);
  return out;
}

test("every job is listed, in the deck's order, and none has a verdict until it runs", () => {
  assert.deepEqual(deckFaces(), FACE_JOBS.map((job) => ({ job })));
  assert.deepEqual(FACE_JOBS, ["crash", "setup", "patch", "updates", "crew"]);
});

test("a face's line is verdict words and numbers, and nothing else", () => {
  assert.equal(crashFace(3, "log-and-install"), "crash read from the log and your install: 3 leads");
  assert.equal(crashFace(1, "partial"), "crash read from part of a log: 1 lead");
  assert.equal(setupFace("clear", { problem: 0, warn: 0 }), "clear");
  assert.equal(setupFace("problems", { problem: 2, warn: 1 }), "problems: 2 problems, 1 warning");
  assert.equal(patchFace("wait"), "wait");
  assert.equal(updatesFace(40, 3, 1, 0), "3 updates, 1 deprecated, 0 gone, of 40 mods checked");
  assert.equal(crewFace(0, 0, 12), "everyone matches on 12 mods");
  assert.equal(crewFace(2, 1, 9), "2 not on everyone's list, 1 on different versions");
});

test("Crew Check records a face when it compares lists, not when it only makes the player's list, and the face names no mod or crewmate", async () => {
  const env = r2profile(root, [{ name: "BepInEx-BepInExPack", version: [5, 4, 2100] }, { name: "x753-More_Suits", version: [1, 4, 3] }]);
  const crew = tools().get("mw_crew_check")!;
  await withEnv(env, () => crew({ gameId: "lethalcompany" }));
  assert.equal(deckFaces().find((f) => f.job === "crew")!.last, undefined, "making a list isn't a comparison");
  const sam = [`${CREW_LIST_HEADER} · Lethal Company · 1 mod`, "BepInEx-BepInExPack 5.4.2100"].join("\n");
  await withEnv(env, () => crew({ gameId: "lethalcompany", crewLists: [{ name: "Sam", list: sam }] }));
  const face = deckFaces().find((f) => f.job === "crew")!;
  assert.equal(face.last?.line, "1 not on everyone's list, 0 on different versions");
  assert.doesNotMatch(JSON.stringify(deckFaces()), /Sam|More_Suits|BepInEx|lethal/i);
  assert.ok(!Number.isNaN(Date.parse(face.last!.at)));
});

test("Pulse records a face only for a confirmed check, not for its plan", async () => {
  const env = r2profile(root, [{ name: "x753-More_Suits", version: [1, 4, 2] }]);
  const pulse = tools().get("mw_pulse")!;
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ owner: "x753", latest: { version_number: "1.4.3" }, is_deprecated: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await withEnv(env, () => pulse({ gameId: "lethalcompany" }));
    assert.equal(deckFaces().find((f) => f.job === "updates")!.last, undefined, "a plan checked nothing");
    await withEnv(env, () => pulse({ gameId: "lethalcompany", confirm: true }));
    assert.equal(deckFaces().find((f) => f.job === "updates")!.last?.line, "1 update, 0 deprecated, 0 gone, of 1 mod checked");
    assert.doesNotMatch(JSON.stringify(deckFaces()), /More_Suits|x753/);
  } finally {
    globalThis.fetch = real;
  }
});

test("a job that couldn't run leaves its face as it was", async () => {
  const crew = tools().get("mw_crew_check")!;
  await crew({ gameId: "skyrimspecialedition", crewLists: [{ list: "x" }] });
  assert.equal(deckFaces().find((f) => f.job === "crew")!.last, undefined);
});
