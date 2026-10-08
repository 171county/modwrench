import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFLICTS_PAGE,
  CRASH_PAGE,
  CRASH_WHISPERER_APP_URI,
  DECK_PAGE,
  DEPS_PAGE,
  DOCTOR_APP_URI,
  MODS_PAGE,
  PATCH_DAY_APP_URI,
  THEMES,
  THEME_IDS,
  renderApp,
  renderConflictsApp,
  renderCrashApp,
  renderDeckApp,
  renderDepsApp,
  renderModsApp,
  themeForCrashType,
} from "../src/index.js";
import { SKIN_CSS, SKIN_JS, skinFrame } from "../src/skin.js";
import { pageHygieneTests } from "./helpers/hygiene.js";
import { loadPage, textOf, type Fake } from "./helpers/page-harness.js";

// ─── The skin shared by the mods, dependencies, crash log, conflicts and deck pages ──
// skin.ts holds the frame, the four game skins and what a page shows before, or
// instead of, its own drawing. It is tested here through a page made of the skin and
// nothing else, so these tests don't change as the five pages are filled in.

const TEST_SCRIPT = String.raw`
(function () {
  'use strict';
  mwSkin.start({
    name: 'test',
    view: 'test',
    draw: function (data) {
      var out = mwSkin.el('t-out');
      mwSkin.clear(out);
      out.appendChild(mwSkin.h('p', { class: 'mw-note', text: mwSkin.tidy(data.say, 80) }));
      mwSkin.show('t-out', true);
    },
    reset: function () { mwSkin.show('t-out', false); }
  });
})();
`;

const renderTestPage = (): string =>
  renderApp({
    title: "Test",
    css: SKIN_CSS,
    body: skinFrame("Test <page>", '<section id="t-out" hidden></section>'),
    script: SKIN_JS + TEST_SCRIPT,
  });

pageHygieneTests("skin", renderTestPage, { minAttrs: 5 });

const WAITING = "Waiting for the answer. If this stays here, the answer is in the chat.";

async function ready(caps: Record<string, unknown> = {}) {
  const page = loadPage(renderTestPage());
  await page.init(caps);
  return page;
}

const visible = (page: ReturnType<typeof loadPage>) => ({
  status: page.el("mw-status").hidden ? null : page.el("mw-status").textContent,
  problem: page.el("mw-problem").hidden ? null : textOf(page.el("mw-problem")),
  plain: page.el("mw-plain").hidden ? null : page.el("mw-plain").textContent,
  drawn: page.el("t-out").hidden ? null : textOf(page.el("t-out")),
});

// ─── The frame ───────────────────────────────────────────────────────────────

test("the frame has the brand, the page's label (escaped), a swatch for each skin and the waiting line", () => {
  const html = renderTestPage();
  assert.match(html, /<span class="mw-brand-sub">Test &lt;page&gt;<\/span>/);
  for (const id of THEME_IDS) {
    assert.match(html, new RegExp(`<button type="button" id="mw-skin-${id}" class="mw-theme" data-t="${id}"[^>]* aria-pressed="false"></button>`));
  }
  assert.ok(html.includes(`<p id="mw-status" class="mw-status" role="status" aria-live="polite">${WAITING}</p>`));
  assert.match(html, /<div id="mw-problem" class="mw-problem" role="alert" hidden><\/div>/);
  assert.match(html, /<pre id="mw-plain" class="mw-plain" hidden><\/pre>/);
});

test("the footer carries each skin's tagline and says the answer goes to the AI and the page makes no network request", () => {
  const footer = /<footer[^>]*>([\s\S]*?)<\/footer>/.exec(renderTestPage())![1]!;
  for (const id of THEME_IDS) {
    const tagline = THEMES[id].tagline.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
    assert.ok(footer.includes(`<span class="mw-tag" data-for="${id}">${tagline}</span>`), id);
  }
  assert.match(footer, /goes to the AI you're talking to; this page makes no network request and keeps nothing\./);
  // Some pages have buttons that ask the host to put a message in the chat or open a link,
  // and some of the tools behind them call mod platforms, so the footer claims neither
  // "sends nothing" nor "nothing leaves".
  assert.doesNotMatch(footer, /nothing leaves|sends nothing/i);
});

test("the skins are keyed on data-game, leaving data-theme to the host's light or dark", () => {
  for (const id of THEME_IDS) {
    assert.ok(SKIN_CSS.includes(`[data-game="${id}"]{`), `no token block for ${id}`);
    assert.ok(SKIN_CSS.includes(`[data-game="${id}"] .mw-foot .mw-tag[data-for="${id}"]{display:inline}`), `no tagline rule for ${id}`);
  }
  assert.doesNotMatch(SKIN_CSS, /data-theme/);
  assert.match(SKIN_CSS, /html\[data-game\]\{color-scheme:dark!important\}/, "a light host must not give a dark skin light controls");
});

test("themeForCrashType maps games to themes", () => {
  assert.equal(themeForCrashType("buffout4"), "fallout");
  assert.equal(themeForCrashType("bepinex"), "lethal");
  assert.equal(themeForCrashType("crashlogger-sse"), "skyrim");
  assert.equal(themeForCrashType(undefined), "skyrim");
});

test("nothing in the frame pins the page to the viewport, so it can shrink to a smaller answer", () => {
  assert.doesNotMatch(SKIN_CSS, /min-height:100vh/);
  assert.doesNotMatch(SKIN_CSS, /html,body\{height:100%\}/);
});

test("reduced motion stops the skins' animations, the blinking cursor on ::after included", () => {
  assert.match(SKIN_CSS, /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important;transition:none!important\}\}/);
});

// ─── What the page shows ─────────────────────────────────────────────────────

test("before any answer: the waiting line, the Skyrim skin, and the page introduces itself by name", () => {
  const page = loadPage(renderTestPage());
  assert.deepEqual(visible(page), { status: WAITING, problem: null, plain: null, drawn: null });
  assert.equal(page.htmlAttrs["data-game"], "skyrim");
  for (const id of THEME_IDS) {
    assert.equal(page.el(`mw-skin-${id}`).attrs["aria-pressed"], id === "skyrim" ? "true" : "false", id);
    assert.equal(page.el(`mw-skin-${id}`).classes.has("on"), id === "skyrim", id);
  }
  const init = page.sent("ui/initialize")[0]!;
  assert.deepEqual((init.params as { appInfo: unknown }).appInfo, { name: "modwrench-test", version: "1" });
});

test("a result for this page is drawn in the skin it names, and nothing else shows", async () => {
  for (const id of THEME_IDS) {
    const page = await ready();
    await page.result({ content: [{ type: "text", text: "the text answer" }], structuredContent: { view: "test", theme: id, say: "hello" } });
    assert.deepEqual(visible(page), { status: null, problem: null, plain: null, drawn: "hello" }, id);
    assert.equal(page.htmlAttrs["data-game"], id);
    for (const other of THEME_IDS) assert.equal(page.el(`mw-skin-${other}`).attrs["aria-pressed"], other === id ? "true" : "false");
  }
});

test("a skin the result names that isn't one of the four, including names every object has, is Skyrim", async () => {
  for (const theme of ["constructor", "toString", "__proto__", "", "morrowind", 5, null, undefined, { id: "fallout" }]) {
    const page = await ready();
    await page.result({ structuredContent: { view: "test", theme: "fallout", say: "x" } });
    assert.equal(page.htmlAttrs["data-game"], "fallout");
    await page.result({ structuredContent: { view: "test", theme, say: "x" } });
    assert.equal(page.htmlAttrs["data-game"], "skyrim", String(theme));
  }
});

test("once the person picks a skin, a later result doesn't change it", async () => {
  const page = await ready();
  page.click("mw-skin-valheim");
  assert.equal(page.htmlAttrs["data-game"], "valheim");
  assert.equal(page.el("mw-skin-valheim").attrs["aria-pressed"], "true");
  await page.result({ structuredContent: { view: "test", theme: "fallout", say: "x" } });
  assert.equal(page.htmlAttrs["data-game"], "valheim");
});

test("a failed call shows the problem and the tool's own words, tidied, as text", async () => {
  const page = await ready();
  await page.result({ structuredContent: { view: "test", say: "drawn first" } });
  const hostile = '<img src=x onerror="alert(1)"> it\u200B failed\u202E ' + "x".repeat(900);
  await page.result({ isError: true, content: [{ type: "text", text: hostile }] });
  const shown = visible(page);
  assert.equal(shown.drawn, null, "the page's own drawing is put away");
  assert.equal(shown.status, null);
  assert.equal(shown.plain, null);
  assert.ok(shown.problem!.startsWith("The tool couldn't answer this time.<img src=x onerror=\"alert(1)\"> it failed "), shown.problem!);
  assert.ok(shown.problem!.endsWith("…"));
  assert.ok(page.created.every((n) => !/^(img|script|iframe)$/.test(n.tag)), "no element came from the data");
});

test("an answer with no data for this page is shown as text, and says so", async () => {
  const long = "line\n".repeat(5000);
  for (const structuredContent of [undefined, null, "a string", [1, 2], { view: "mods", theme: "fallout" }, { theme: "fallout" }]) {
    const page = await ready();
    await page.result({ content: [{ type: "image", data: "x" }, { type: "text", text: long }], ...(structuredContent === undefined ? {} : { structuredContent }) });
    const shown = visible(page);
    assert.equal(shown.status, "ModWrench sent this answer as text only.", JSON.stringify(structuredContent));
    assert.equal(shown.plain, long.slice(0, 20000));
    assert.equal(shown.problem, null);
    assert.equal(shown.drawn, null);
    assert.equal(page.htmlAttrs["data-game"], "skyrim", "a result for another page doesn't pick the skin");
  }
});

test("an answer with nothing this page can use says so", async () => {
  for (const params of [{}, { content: [] }, { content: [{ type: "text", text: "" }] }, { content: "text" }]) {
    const page = await ready();
    await page.result(params);
    assert.deepEqual(visible(page), { status: null, problem: "Nothing came back that this page can show.", plain: null, drawn: null }, JSON.stringify(params));
  }
});

test("a result that isn't an object is ignored", async () => {
  const page = await ready();
  page.fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: "x" });
  assert.equal(visible(page).status, WAITING);
});

test("a call cancelled before it answered says so; one cancelled after leaves the answer alone", async () => {
  const before = await ready();
  await before.cancel();
  assert.equal(visible(before).status, "The call was cancelled.");

  const after = await ready();
  await after.result({ structuredContent: { view: "test", say: "kept" } });
  await after.cancel();
  assert.deepEqual(visible(after), { status: null, problem: null, plain: null, drawn: "kept" });
});

test("a host that never answers is reported; one that answered is not", async () => {
  const silent = loadPage(renderTestPage());
  silent.runTimers();
  assert.equal(visible(silent).status, "This page couldn't reach your editor. The answer is in the chat.");

  const answered = await ready();
  answered.runTimers();
  assert.equal(visible(answered).status, WAITING);
});

test("a later answer replaces an earlier one, whichever kind each is", async () => {
  const page = await ready();
  await page.result({ isError: true, content: [{ type: "text", text: "boom" }] });
  await page.result({ structuredContent: { view: "test", say: "fine now" } });
  assert.deepEqual(visible(page), { status: null, problem: null, plain: null, drawn: "fine now" });
  await page.result({ content: [{ type: "text", text: "just text" }] });
  assert.deepEqual(visible(page), { status: "ModWrench sent this answer as text only.", problem: null, plain: "just text", drawn: null });
});

test("the skin never calls a tool or posts a message on its own", async () => {
  const page = await ready({ message: {}, openLinks: {}, serverTools: {} });
  await page.result({ structuredContent: { view: "test", say: "x" } });
  page.click("mw-skin-lethal");
  await page.result({ isError: true, content: [{ type: "text", text: "boom" }] });
  const methods = new Set(page.posted.map((m) => m.method).filter(Boolean));
  assert.deepEqual([...methods].sort(), ["ui/initialize", "ui/notifications/initialized", "ui/notifications/size-changed"]);
});

// ─── The helpers pages draw with ─────────────────────────────────────────────

type Skin = {
  tidy(value: unknown, max?: number): string;
  pick(table: Record<string, unknown>, key: unknown, fallback: string): string;
  compact(n: unknown): string;
  empty(title: string, hint: string): Fake;
  h(tag: string, attrs?: Record<string, unknown>, kids?: Array<Fake | string | null | false>): Fake;
};
const skinOf = (): Skin => loadPage(renderTestPage()).global("mwSkin") as Skin;

test("tidy makes one display-safe line, cuts at a whole character, and turns anything that isn't a string into nothing", () => {
  const { tidy } = skinOf();
  assert.equal(tidy("  a\u200Bb\u0000c\nd  "), "a b c d");
  assert.equal(tidy("abcdef", 4), "abc…");
  assert.equal(tidy("😀😀😀", 2), "😀…");
  for (const value of [5, null, undefined, { toString: 1 }, ["x"], true]) assert.equal(tidy(value, 10), "", JSON.stringify(value));
});

test("pick takes only a table's own keys", () => {
  const { pick } = skinOf();
  const table = { nexus: "Nexus Mods" };
  assert.equal(pick(table, "nexus", "none"), "nexus");
  for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "", 5, null]) assert.equal(pick(table, key, "none"), "none", String(key));
});

test("compact shortens counts as the old panels did, and shows a dash for anything that isn't a number", () => {
  const { compact } = skinOf();
  assert.equal(compact(0), "0");
  assert.equal(compact(999), "999");
  assert.equal(compact(1000), "1k");
  assert.equal(compact(1200), "1.2k");
  assert.equal(compact(120000), "120k");
  assert.equal(compact(3400000), "3.4M");
  for (const value of [NaN, Infinity, undefined, null, "5", {}]) assert.equal(compact(value), "—", String(value));
});

test("h puts text in as text and builds nothing from it; empty builds the empty-state block", () => {
  const { h, empty } = skinOf();
  const node = h("p", { class: "x", text: "<b>hi</b>", title: null, hidden: false, readonly: true }, ["<i>", null, false]);
  assert.equal(node.textContent, "<b>hi</b>");
  assert.deepEqual(node.attrs, { class: "x", readonly: "" });
  assert.equal(node.children[0]!.tag, "#text");
  assert.equal(node.children[0]!.textContent, "<i>");
  const block = empty("No mods to show", 'Nothing came back for "x".');
  assert.equal(block.attrs.class, "mw-empty");
  assert.equal(textOf(block), 'No mods to showNothing came back for "x".');
});

// ─── The five pages are built on the skin ────────────────────────────────────

const PAGES = [
  { def: MODS_PAGE, render: renderModsApp, view: "mods", title: "Mods" },
  { def: DEPS_PAGE, render: renderDepsApp, view: "deps", title: "Dependencies" },
  { def: CRASH_PAGE, render: renderCrashApp, view: "crash", title: "Crash log" },
  { def: CONFLICTS_PAGE, render: renderConflictsApp, view: "conflicts", title: "Conflicts" },
  { def: DECK_PAGE, render: renderDeckApp, view: "deck", title: "Deck" },
] as const;

test("each page has its own address, name and description, and asks for no permission", () => {
  const uris = PAGES.map((p) => p.def.uri);
  assert.equal(new Set([...uris, PATCH_DAY_APP_URI, CRASH_WHISPERER_APP_URI, DOCTOR_APP_URI]).size, uris.length + 3);
  for (const p of PAGES) {
    assert.equal(p.def.uri, `ui://modwrench/${p.view}`);
    assert.equal(p.def.name, `${p.view}_panel`);
    assert.equal(p.def.render, p.render);
    assert.equal(p.def.clipboard, false, `${p.view}: no Copy button, so no clipboard permission`);
    assert.ok(p.def.title.endsWith(" page"), p.def.title);
    assert.match(p.def.description, /read-only/i, p.view);
    assert.match(p.def.description, /no network/i, p.view);
  }
});

test("each page is a whole document on the skin: its title, the frame, and the text-only answer when that is all there is", async () => {
  for (const p of PAGES) {
    const html = p.render();
    assert.ok(html.includes(`<title>${p.title}</title>`), p.view);
    assert.ok(html.includes(SKIN_CSS), `${p.view}: the skin's CSS`);
    assert.ok(html.includes(SKIN_JS), `${p.view}: the skin's script`);
    const page = loadPage(html);
    assert.equal((page.sent("ui/initialize")[0]!.params as { appInfo: { name: string } }).appInfo.name, `modwrench-${p.view}`);
    await page.init();
    await page.result({ content: [{ type: "text", text: "only text" }] });
    assert.equal(page.el("mw-plain").textContent, "only text", p.view);
    assert.equal(page.el("mw-status").textContent, "ModWrench sent this answer as text only.", p.view);
  }
});
