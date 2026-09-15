import { test } from "node:test";
import assert from "node:assert/strict";
import { createUIResource, renderShell } from "../src/index.js";

// ─── MODWRENCH_UI=off, and why it exists ─────────────────────────────────────
// MCP-UI support is uneven across clients. The failure mode is not that an
// unsupporting client ignores the panel — it is that the client puts the HTML
// into the conversation as text, so the model reads markup and minified
// JavaScript it can do nothing with.
//
// Found by running ModWrench in Cline: a Thunderstore dependency-resolution
// answer came back correct and useful, with ~28kb of panel source pasted into
// the transcript ahead of it. Measured: one panel is ~27.6kb, roughly 8,800
// tokens, about 7% of a 128k window. A four-tool answer spends over a quarter
// of the window on markup that was never drawn.
//
// So MODWRENCH_UI=off shrinks the payload while keeping the block's shape —
// dropping the block entirely would change the content array at 19 call sites,
// and a client that expects a resource would see a hole instead.

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.MODWRENCH_UI;
  if (value === undefined) delete process.env.MODWRENCH_UI;
  else process.env.MODWRENCH_UI = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MODWRENCH_UI;
    else process.env.MODWRENCH_UI = prev;
  }
}

const panel = () =>
  renderShell({ theme: "skyrim", view: "mods", mods: { query: "x", mods: [] } });

test("by default the full panel is sent — the opt-out must be opt-in", () => {
  withEnv(undefined, () => {
    const block = createUIResource({ uri: "ui://modwrench/mods", html: panel() });
    assert.ok(
      block.resource.text.length > 10_000,
      "the full panel is no longer being sent by default — suppression must never be the default"
    );
    assert.match(block.resource.text, /<!doctype html>/i);
  });
});

for (const value of ["off", "0", "false", "none", "OFF", " Off "]) {
  test(`MODWRENCH_UI=${JSON.stringify(value)} shrinks the payload`, () => {
    withEnv(value, () => {
      const block = createUIResource({ uri: "ui://modwrench/mods", html: panel() });
      assert.ok(
        block.resource.text.length < 500,
        `panel not suppressed for ${JSON.stringify(value)} — payload was ` +
          `${block.resource.text.length} bytes`
      );
      // The user has to be able to find their way back.
      assert.match(
        block.resource.text,
        /MODWRENCH_UI=off/,
        "the suppressed panel does not name the variable that caused it — a user " +
          "who forgot they set it has no way to work out why the UI vanished"
      );
    });
  });
}

test("an unrelated value leaves the panel alone", () => {
  for (const value of ["on", "1", "true", "", "yes", "maybe"]) {
    withEnv(value, () => {
      const block = createUIResource({ uri: "ui://modwrench/mods", html: panel() });
      assert.ok(
        block.resource.text.length > 10_000,
        `MODWRENCH_UI=${JSON.stringify(value)} suppressed the panel; only off/0/false/none should`
      );
    });
  }
});

test("suppression keeps the block's shape, so callers and clients still work", () => {
  withEnv("off", () => {
    const block = createUIResource({
      uri: "ui://modwrench/mods",
      html: panel(),
      meta: { "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"] },
    });
    assert.equal(block.type, "resource", "the content block type changed");
    assert.equal(block.resource.uri, "ui://modwrench/mods", "the uri changed");
    assert.equal(block.resource.mimeType, "text/html", "the mimeType changed");
    assert.deepEqual(
      block.resource._meta,
      { "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"] },
      "meta was dropped — the block must stay structurally identical, only smaller"
    );
  });
});

test("the uri guard still fires when panels are suppressed", () => {
  withEnv("off", () => {
    assert.throws(
      () => createUIResource({ uri: "https://example.com", html: panel() }),
      /must start with "ui:\/\/"/,
      "the spec guard was bypassed on the suppressed path"
    );
  });
});

test("the saving is real, not cosmetic", () => {
  const full = withEnv(undefined, () =>
    createUIResource({ uri: "ui://modwrench/mods", html: panel() }).resource.text.length
  );
  const off = withEnv("off", () =>
    createUIResource({ uri: "ui://modwrench/mods", html: panel() }).resource.text.length
  );
  assert.ok(
    full / off > 50,
    `suppression only saved ${(full / off).toFixed(1)}x (${full} -> ${off} bytes); ` +
      `the whole point is a payload small enough not to matter`
  );
});
