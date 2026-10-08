import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ─── The two always-on meta-tools declare their annotation hints ────────────
// mw_activate_platform is registered inline in src/index.ts — the boot script,
// which runs the whole server at import time — so it can't be exercised
// through a mock McpServer the way the platform packages can. mw_deck lives in
// src/deck.ts and is held to the same scan. This guard scans the source
// instead, in the house style of nexus's preview-adult guard: a little brittle
// beats silently passing.
//
// What it enforces: every tool declares all four MCP annotation hints as
// explicit booleans. Hosts (and directories like OpenAI's) reject or mis-handle
// tools with missing or non-boolean hints. The hints are honest
// self-descriptions for host UX — hints, not guarantees, per the MCP spec.

const SRC = (file: string): string =>
  new URL(`../src/${file}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Where each meta-tool is registered. */
const SOURCES: Record<string, string> = { mw_activate_platform: "index.ts", mw_deck: "deck.ts" };

const HINTS = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
];

function toolBlock(src: string, name: string): string {
  const start = src.indexOf(`"${name}"`);
  assert.ok(start > -1, `${name} not found — this guard would pass vacuously`);
  // Slice to the NEXT registerTool call so each block contains only its own
  // tool's config — a missing hint can't hide inside the other tool's block.
  const next = src.indexOf("server.registerTool(", start);
  return src.slice(start, next === -1 ? undefined : next);
}

test("the meta-tools declare all four boolean annotation hints", () => {
  for (const [name, file] of Object.entries(SOURCES)) {
    const block = toolBlock(readFileSync(SRC(file), "utf8"), name);
    assert.match(block, /title:\s*"/, `${name} is missing a title`);
    for (const hint of HINTS) {
      assert.match(
        block,
        new RegExp(`${hint}:\\s*(?:true|false)\\b`),
        `${name} is missing an explicit boolean ${hint}`
      );
    }
  }
});
