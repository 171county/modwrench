import { test } from "node:test";
import assert from "node:assert/strict";
import { PULSE_APP_URI, PULSE_PAGE, pulseView, renderPulseApp } from "../src/index.js";
import { pageHygieneTests } from "./helpers/hygiene.js";
import { loadPage, textOf, tick, type Fake } from "./helpers/page-harness.js";

// ─── The Pulse page ──────────────────────────────────────────────────────────
// What mw_pulse sends the page, what the page draws, and the one call it can make:
// mw_pulse with confirm=true, when the person presses its button.

pageHygieneTests("Pulse", renderPulseApp);

const ARGS = { gameId: "lethalcompany", profileName: "Seema" };
const PREVIEW = pulseView({ theme: "lethal", game: "Lethal Company", profile: "Seema", host: "thunderstore.io", confirmed: false, requests: 3, notChecked: [], args: ARGS });
const RESULT = pulseView({
  theme: "lethal",
  game: "Lethal Company",
  profile: "Seema",
  host: "thunderstore.io",
  confirmed: true,
  mods: [
    { name: "BepInExPack", fullName: "BepInEx-BepInExPack", author: "BepInEx", installed: "5.4.2100", latest: "5.4.2100", state: "current", deprecated: false },
    { name: "MoreSuits", fullName: "x753-More_Suits", author: "x753", installed: "1.4.2", latest: "1.4.3", state: "update", deprecated: false, pageUrl: "https://thunderstore.io/c/lethal-company/p/x753/More_Suits/" },
    { name: "Old", fullName: "Owner-Old", installed: "2.0.0", latest: "2.0.0", state: "current", deprecated: true, pageUrl: "https://evil.example/x" },
    { name: "Gone", fullName: "Owner-Gone", installed: "1.0.0", state: "gone", deprecated: false },
  ],
  notChecked: ["Local mod (not a Thunderstore name)"],
  args: ARGS,
});

const classOf = (node: Fake): string[] => (node.attrs.class ?? "").split(/\s+/).filter(Boolean);
const rows = (page: ReturnType<typeof loadPage>): Fake[] => page.created.filter((n) => classOf(n).includes("mw-prow"));
const out = (page: ReturnType<typeof loadPage>): string => textOf(page.el("pulse-out"));
const buttons = (page: ReturnType<typeof loadPage>, label: string): Fake[] => page.created.filter((n) => n.tag === "button" && textOf(n) === label);

async function shown(data: unknown, caps: Record<string, unknown> = { message: {} }) {
  const page = loadPage(renderPulseApp());
  await page.show(data, caps);
  return page;
}

test("the page as a server registers it: its address, name, and no clipboard", () => {
  assert.equal(PULSE_PAGE.uri, PULSE_APP_URI);
  assert.equal(PULSE_APP_URI, "ui://modwrench/pulse");
  assert.equal(PULSE_PAGE.name, "pulse_panel");
  assert.equal(PULSE_PAGE.clipboard, false);
  assert.match(PULSE_PAGE.description, /Read-only; it makes no network requests and keeps nothing\./);
});

// ─── Before a check ──────────────────────────────────────────────────────────

test("before a check, the page says nothing has been sent and exactly what a check would send", async () => {
  const page = await shown(PREVIEW);
  assert.match(out(page), /Nothing has been sent yet\. Checking sends 3 requests to thunderstore\.io, one per switched-on mod, each carrying only that mod’s Thunderstore name\./);
  assert.equal(page.sent("tools/call").length, 0, "drawing the plan calls nothing");
  assert.equal(buttons(page, "Check now").length, 1);
});

test("Check now makes one call: mw_pulse with confirm=true and the profile's own arguments, and draws what comes back", async () => {
  const page = await shown(PREVIEW);
  page.press(buttons(page, "Check now")[0]!);
  page.press(buttons(page, "Checking…")[0] ?? buttons(page, "Check now")[0]!);
  const calls = page.sent("tools/call");
  assert.equal(calls.length, 1, "a second press while it runs sends nothing");
  assert.deepEqual(calls[0]!.params, { name: "mw_pulse", arguments: { gameId: "lethalcompany", confirm: true, profileName: "Seema" } });
  page.answer(calls[0]!, { content: [{ type: "text", text: "text" }], structuredContent: RESULT });
  await tick();
  assert.match(out(page), /1 update/);
  assert.equal(rows(page).length, 4);
});

test("a refused call or an answer with no page data leaves a plain note and the button ready again", async () => {
  const refused = await shown(PREVIEW);
  refused.press(buttons(refused, "Check now")[0]!);
  refused.refuse(refused.sent("tools/call")[0]!);
  await tick();
  assert.match(out(refused), /Your editor didn't run the check from this page/);
  assert.equal(buttons(refused, "Check now").length, 1);
  const textOnly = await shown(PREVIEW);
  textOnly.press(buttons(textOnly, "Check now")[0]!);
  textOnly.answer(textOnly.sent("tools/call")[0]!, { content: [{ type: "text", text: "No r2modman profile was found." }], isError: true });
  await tick();
  assert.match(out(textOnly), /No r2modman profile was found\./);
});

test("with nothing to check there is no button", async () => {
  const page = await shown(pulseView({ game: "Lethal Company", profile: "Default", host: "thunderstore.io", confirmed: false, requests: 0, args: ARGS }));
  assert.match(out(page), /There are no switched-on Thunderstore mods in this profile to check\./);
  assert.equal(page.created.filter((n) => n.tag === "button" && textOf(n) === "Check now").length, 0);
});

// ─── After a check ───────────────────────────────────────────────────────────

test("after a check, updates come first, then mods Thunderstore no longer has, then the rest; deprecated mods are tagged", async () => {
  const page = await shown(RESULT);
  const drawn = rows(page).map(textOf);
  assert.match(drawn[0]!, /^UPDATE.*MoreSuits by x7531\.4\.2 → 1\.4\.3/);
  assert.match(drawn[1]!, /^GONE.*Gone/);
  assert.match(drawn.join("\n"), /UP TO DATEDEPRECATED.*Old/);
  assert.match(out(page), /Not checked \(1\):/);
  assert.match(out(page), /Checked against thunderstore\.io\. Pulse doesn’t download, install or change anything/);
  assert.equal(buttons(page, "Check again").length, 1);
});

test("Open is offered only for a Thunderstore page, only when the editor can open links, and opens exactly that address", async () => {
  const without = await shown(RESULT);
  assert.equal(buttons(without, "Open ›").length, 0);
  const page = await shown(RESULT, { openLinks: {} });
  const open = buttons(page, "Open ›");
  assert.equal(open.length, 1, "the evil.example address gets none");
  page.press(open[0]!);
  assert.deepEqual(page.sent("ui/open-link")[0]!.params, { url: "https://thunderstore.io/c/lethal-company/p/x753/More_Suits/" });
});

test("names and versions from a profile or Thunderstore go on the page as text, never as markup", async () => {
  const hostile = pulseView({
    game: "<img src=x>",
    profile: "p",
    host: "thunderstore.io",
    confirmed: true,
    mods: [{ name: "<script>alert(1)</script>", fullName: "a-b", author: "<b>me</b>", installed: "<i>", latest: "1", state: "update", deprecated: false }],
    args: ARGS,
  });
  const page = await shown(hostile);
  assert.match(out(page), /<script>alert\(1\)<\/script> by <b>me<\/b>/);
  assert.ok(page.created.every((n) => !["script", "img", "b", "i"].includes(n.tag)));
});

// ─── The data ────────────────────────────────────────────────────────────────

test("pulseView keeps only what the page draws, each field checked, and never throws", () => {
  const view = pulseView({
    theme: "nope",
    game: 5 as never,
    profile: "p",
    host: "h",
    confirmed: "yes" as never,
    requests: -4,
    mods: [null, "x", { name: 1, fullName: "a-b", state: "weird", deprecated: "true", pageUrl: 7 }],
    notChecked: ["ok", 3],
    args: { gameId: "lethalcompany", profileName: 9 as never },
  });
  assert.deepEqual(view, {
    view: "pulse",
    theme: "lethal",
    game: "",
    profile: "p",
    host: "h",
    confirmed: false,
    requests: 0,
    mods: [{ name: "", fullName: "a-b", state: "failed", deprecated: false }],
    notChecked: ["ok"],
    args: { gameId: "lethalcompany" },
  });
});
