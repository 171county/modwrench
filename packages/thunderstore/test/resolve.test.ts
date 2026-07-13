import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDependencyString,
  resolveDependencyTree,
  type FetchDeps,
} from "../src/resolve.js";

// ─── parseDependencyString ────────────────────────────────────────────────────

test("parseDependencyString splits Namespace-Name-Version", () => {
  assert.deepEqual(parseDependencyString("BepInEx-BepInExPack-5.4.2100"), {
    namespace: "BepInEx",
    name: "BepInExPack",
    version: "5.4.2100",
  });
});

test("parseDependencyString handles a missing version", () => {
  assert.deepEqual(parseDependencyString("Team-Mod"), {
    namespace: "Team",
    name: "Mod",
  });
});

test("parseDependencyString returns null for a bare token", () => {
  assert.equal(parseDependencyString("nope"), null);
});

// ─── resolveDependencyTree ────────────────────────────────────────────────────

function graphFetch(graph: Record<string, string[]>): FetchDeps {
  return async (ns, name) => ({
    version: "1.0.0",
    dependencies: graph[`${ns}-${name}`] ?? [],
  });
}

test("resolveDependencyTree returns install-first order, dedups shared deps", async () => {
  const graph: Record<string, string[]> = {
    "A-Root": ["B-Left-1.0.0", "C-Right-1.0.0"],
    "B-Left": ["D-Shared-1.0.0"],
    "C-Right": ["D-Shared-1.0.0"],
    "D-Shared": [],
  };
  const res = await resolveDependencyTree({
    namespace: "A",
    name: "Root",
    fetchDeps: graphFetch(graph),
  });
  // D-Shared resolved exactly once despite two parents.
  assert.equal(res.nodes.filter((n) => n.fullName === "D-Shared").length, 1);
  const idx = (fn: string) => res.order.indexOf(fn);
  assert.ok(idx("D-Shared") < idx("B-Left"), "shared dep before its dependents");
  assert.ok(idx("D-Shared") < idx("C-Right"));
  assert.equal(res.order[res.order.length - 1], "A-Root", "root installs last");
  assert.equal(res.unresolved.length, 0);
});

test("resolveDependencyTree is cycle-safe", async () => {
  const graph: Record<string, string[]> = {
    "X-One": ["Y-Two-1.0.0"],
    "Y-Two": ["X-One-1.0.0"],
  };
  const res = await resolveDependencyTree({
    namespace: "X",
    name: "One",
    fetchDeps: graphFetch(graph),
  });
  assert.equal(res.nodes.length, 2); // each visited once, no infinite loop
  assert.ok(res.order.includes("X-One") && res.order.includes("Y-Two"));
});

test("resolveDependencyTree records unresolved refs on fetch failure", async () => {
  const fetchDeps: FetchDeps = async (_ns, name) => {
    if (name === "Missing") throw new Error("404");
    return { version: "1.0.0", dependencies: ["Z-Missing-1.0.0"] };
  };
  const res = await resolveDependencyTree({
    namespace: "A",
    name: "Root",
    fetchDeps,
  });
  assert.equal(res.unresolved.length, 1);
  assert.equal(res.unresolved[0]?.ref, "Z-Missing");
});

test("resolveDependencyTree truncates at maxDepth", async () => {
  const graph: Record<string, string[]> = {
    "A-Root": ["B-Two-1.0.0"],
    "B-Two": ["C-Three-1.0.0"],
    "C-Three": [],
  };
  const res = await resolveDependencyTree({
    namespace: "A",
    name: "Root",
    fetchDeps: graphFetch(graph),
    maxDepth: 1,
  });
  assert.equal(res.truncated, true);
});
