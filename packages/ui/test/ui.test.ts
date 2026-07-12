import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createUIResource,
  esc,
  renderShell,
  renderDeck,
  renderMods,
  renderCrash,
  themeForCrashType,
  THEME_IDS,
} from "../src/index.js";

// ---- createUIResource ----

test("createUIResource returns a spec-shaped MCP-UI resource block", () => {
  const block = createUIResource({ uri: "ui://modwrench/deck", html: "<p>hi</p>" });
  assert.equal(block.type, "resource");
  assert.equal(block.resource.uri, "ui://modwrench/deck");
  assert.equal(block.resource.mimeType, "text/html");
  assert.equal(block.resource.text, "<p>hi</p>");
});

test("createUIResource rejects a non-ui:// uri", () => {
  assert.throws(
    () => createUIResource({ uri: "https://evil/x", html: "<p>x</p>" }),
    /must start with/
  );
});

test("createUIResource attaches _meta when provided", () => {
  const block = createUIResource({
    uri: "ui://modwrench/deck",
    html: "<p>x</p>",
    meta: { "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"] },
  });
  assert.deepEqual(block.resource._meta, {
    "mcpui.dev/ui-preferred-frame-size": ["1040px", "720px"],
  });
});

// ---- esc ----

test("esc neutralizes HTML-significant characters", () => {
  assert.equal(esc("<a & b>"), "&lt;a &amp; b&gt;");
  assert.equal(esc('say "hi"'), "say &quot;hi&quot;");
  assert.equal(esc("O'Brien"), "O&#39;Brien");
  assert.equal(esc(undefined), "");
});

// ---- shell ----

test("renderShell emits a full document with every theme block", () => {
  const html = renderShell({ view: "deck", deck: { connectors: [] } });
  assert.match(html, /^<!doctype html>/);
  for (const id of THEME_IDS) {
    assert.ok(html.includes('[data-theme="' + id + '"]'), "missing theme block: " + id);
  }
  // stateless posture: no browser storage or network from the rendered HTML
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
  assert.doesNotMatch(html, /fetch\(/);
});

test("renderShell honors the requested theme + view", () => {
  const html = renderShell({ theme: "fallout", view: "crash", crash: { ok: false, reason: "nope" } });
  assert.match(html, /<html[^>]*data-theme="fallout"/);
  // The apostrophe in the copy is HTML-escaped, so match without it.
  assert.match(html, /parse that crashlog/);
});

test("renderShell defaults an unknown theme to skyrim", () => {
  const html = renderShell({ theme: "morrowind" as never, view: "deck", deck: { connectors: [] } });
  assert.match(html, /<html[^>]*data-theme="skyrim"/);
});

// ---- views ----

test("renderDeck lists connectors and wires their tool", () => {
  const html = renderDeck({
    connectors: [{ id: "nexus", name: "Nexus Mods", toolCount: 13, status: "on", tool: "nexus_search" }],
  });
  assert.match(html, /Nexus Mods/);
  assert.ok(html.includes("mw('tool','nexus_search')"));
});

test("renderDeck shows a themed empty state with no connectors", () => {
  assert.match(renderDeck({ connectors: [] }), /No connectors active/);
});

test("renderMods renders a card with mandatory attribution", () => {
  const html = renderMods({
    query: "sword",
    mods: [{ name: "Frost Blade", author: "Dovah", platform: "nexus", downloads: 120000, pageUrl: "https://x/y" }],
  });
  assert.match(html, /Frost Blade/);
  assert.match(html, /by <strong>Dovah<\/strong>/);
  assert.match(html, /120k/);
  assert.ok(html.includes("mw('link','https://x/y')"));
});

test("renderCrash surfaces exception, stack and plugins", () => {
  const html = renderCrash({
    detectedType: "buffout4",
    exception: { type: "EXCEPTION_ACCESS_VIOLATION", address: "0x7ff6" },
    callStack: [{ index: 0, module: "Fallout4.exe", offset: "1a2b" }],
    loadedPlugins: [{ name: "ArmorKeywords.esm" }],
  });
  assert.match(html, /EXCEPTION_ACCESS_VIOLATION/);
  assert.match(html, /Fallout4\.exe/);
  assert.match(html, /ArmorKeywords\.esm/);
});

test("themeForCrashType maps games to themes", () => {
  assert.equal(themeForCrashType("buffout4"), "fallout");
  assert.equal(themeForCrashType("bepinex"), "lethal");
  assert.equal(themeForCrashType("crashlogger-sse"), "skyrim");
  assert.equal(themeForCrashType(undefined), "skyrim");
});
