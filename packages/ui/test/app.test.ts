import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import {
  CRASH_WHISPERER_APP_URI,
  DOCTOR_APP_URI,
  MCP_APP_MIME,
  MCP_APPS_EXTENSION_ID,
  PATCH_DAY_APP_URI,
  appResourceMeta,
  appToolMeta,
  esc,
  renderApp,
  renderCrashWhispererApp,
  renderDoctorApp,
  renderPatchDayApp,
} from "../src/index.js";
import { pageHygieneTests, scriptOf } from "./helpers/hygiene.js";

// ─── MCP Apps pages ──────────────────────────────────────────────────────────
// A page here is a promise the README and TRUST.md make out loud: it makes no
// network requests, keeps nothing, loads nothing, and puts nothing from the
// person's machine on the page as markup. Those promises are checked two ways.
//
// The hygiene tests read the finished HTML for the things that would break them:
// a URL, a way to reach the network, a way to turn a string into markup or code,
// an inline handler. The runtime tests run the protocol code in a bare VM with a
// fake window and fake host, because that code is what decides whose messages to
// believe and what to say back.
//
// What neither can show is how the page looks and behaves in a browser. That was
// checked by hand in Chromium against a stand-in host before this shipped, and is
// not part of the suite: a browser harness would be the heaviest dependency in the
// repository.

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

// ─── What the server attaches ────────────────────────────────────────────────

test("a page is identified by the MCP Apps MIME type and a ui:// URI, and no two pages share one", () => {
  assert.equal(MCP_APP_MIME, "text/html;profile=mcp-app");
  for (const uri of [PATCH_DAY_APP_URI, CRASH_WHISPERER_APP_URI, DOCTOR_APP_URI]) assert.match(uri, /^ui:\/\/modwrench\//);
  assert.equal(new Set([PATCH_DAY_APP_URI, CRASH_WHISPERER_APP_URI, DOCTOR_APP_URI]).size, 3);
});

test("the extension a client names to say it can draw pages is the one the MCP Apps spec defines", () => {
  // The server reads the client's capabilities under this key and the page type above. If either drifted,
  // no client would ever be recognised as one that draws pages, and the full report would never be sent.
  assert.equal(MCP_APPS_EXTENSION_ID, "io.modelcontextprotocol/ui");
});

test("the tool metadata points at the page under both spellings and lets the page call the tool", () => {
  const meta = withEnv(undefined, () => appToolMeta(PATCH_DAY_APP_URI));
  assert.ok(meta);
  assert.deepEqual(meta, {
    ui: { resourceUri: PATCH_DAY_APP_URI, visibility: ["model", "app"] },
    "ui/resourceUri": PATCH_DAY_APP_URI,
  });
});

for (const value of ["off", "0", "false", "none", "OFF", " Off "]) {
  test(`MODWRENCH_UI=${JSON.stringify(value)} means no page is advertised`, () => {
    assert.equal(withEnv(value, () => appToolMeta(PATCH_DAY_APP_URI)), undefined);
  });
}

test("an unrelated MODWRENCH_UI value leaves pages on: only off, 0, false and none turn them off", () => {
  for (const value of ["on", "1", "true", "", "yes", "maybe"]) {
    assert.ok(
      withEnv(value, () => appToolMeta(PATCH_DAY_APP_URI)),
      `MODWRENCH_UI=${JSON.stringify(value)} turned pages off; only off/0/false/none should`
    );
  }
});

test("the page asks for the clipboard and nothing else, and widens no network rule", () => {
  const meta = appResourceMeta() as { ui: Record<string, unknown> };
  assert.deepEqual(meta, { ui: { permissions: { clipboardWrite: {} } } });
  assert.equal("csp" in meta.ui, false, "a csp here would loosen the host's no-network default");
  assert.equal("domain" in meta.ui, false);
});

// ─── The finished HTML ───────────────────────────────────────────────────────

test("esc neutralizes HTML-significant characters", () => {
  assert.equal(esc("<a & b>"), "&lt;a &amp; b&gt;");
  assert.equal(esc('say "hi"'), "say &quot;hi&quot;");
  assert.equal(esc("O'Brien"), "O&#39;Brien");
  assert.equal(esc(undefined), "");
});

test("renderApp wraps a page in a complete document with its own policy", () => {
  const html = renderApp({ title: "T <&>", css: "p{}", body: '<div id="mw-root"></div>', script: "void 0;" });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<title>T &lt;&amp;&gt;<\/title>/, "the title is escaped");
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /<div id="mw-root"><\/div>/);
});

// Every page is held to the same promises, so each test below runs for each of them.
const PAGES: Array<[string, () => string]> = [
  ["Patch Day", renderPatchDayApp],
  ["Crash Whisperer", renderCrashWhispererApp],
  ["Doctor", renderDoctorApp],
];

for (const [name, render] of PAGES) pageHygieneTests(name, render);

test("the Patch Day page looks up every value that becomes a class name or a data attribute in a fixed table first", () => {
  const script = scriptOf(renderPatchDayApp());
  assert.match(script, /var VERDICTS = \{/);
  assert.match(script, /var STATUS = \{/);
  assert.match(script, /var BASIS = \{/);
  assert.match(script, /VERDICTS\[r\.verdict\] \? r\.verdict : 'check'/);
  assert.match(script, /STATUS\[q\.status\] \? q\.status : 'unclear'/);
  assert.match(script, /BASIS\[q\.basis\] \? q\.basis : 'inferred'/);
});

test("the Crash Whisperer page looks up every value that becomes a class name or a data attribute in a fixed table first", () => {
  const script = scriptOf(renderCrashWhispererApp());
  for (const table of ["STRENGTH", "SEVERITY", "BASIS", "KIND", "EVIDENCE", "FORMAT"]) {
    assert.match(script, new RegExp(`var ${table} = \\{`), `${table} is not a fixed table`);
  }
  assert.match(script, /STRENGTH\[lead\.strength\] \? lead\.strength : 'faint'/);
  assert.match(script, /SEVERITY\[c\.severity\] \? c\.severity : 'info'/);
  assert.match(script, /BASIS\[basis\] \? basis : 'guess'/);
  assert.match(script, /KIND\[f\.kind\] \? f\.kind : 'unknown'/);
  assert.match(script, /EVIDENCE\[conf\.evidence\] \|\| EVIDENCE\.log/);
  // The only class name built from data is the mix bar's, from the four fixed basis names.
  assert.match(script, /'m-' \+ k/);
  assert.match(script, /var BASIS_ORDER = \['log', 'install', 'rule', 'guess'\]/);
});

test("the Crash Whisperer page puts a post into its box by value, so no text in it is ever parsed", () => {
  const script = scriptOf(renderCrashWhispererApp());
  assert.match(script, /el\('postbox'\)\.value = String\(p\.text \|\| ''\)/);
  assert.match(script, /readonly: true/);
});

test("the Crash Whisperer page asks for the tool it belongs to, and only by that name", () => {
  const script = scriptOf(renderCrashWhispererApp());
  assert.match(script, /var TOOL = 'mw_crash_whisperer'/);
  assert.equal((script.match(/callTool\(/g) ?? []).length, 1, "one place calls a tool");
  assert.doesNotMatch(script, /callTool\(\s*['"]/, "a tool named inline");
});

test("the Doctor page only ever uses a value from a result as a key when it is one of a fixed table's own keys", () => {
  const script = scriptOf(renderDoctorApp());
  for (const table of ["VERDICTS", "STATUS", "BASIS", "AREAS", "STEAMS"]) {
    assert.match(script, new RegExp(`var ${table} = \\{`), `${table} is not a fixed table`);
  }
  // A names every object inherits ("constructor", "toString") must not count as a key.
  assert.match(script, /Object\.prototype\.hasOwnProperty\.call\(table, key\)/);
  assert.match(script, /pick\(VERDICTS, r\.verdict, 'attention'\)/);
  assert.match(script, /pick\(STATUS, f\.status, 'note'\)/);
  assert.match(script, /pick\(BASIS, key, 'guess'\)/);
  assert.match(script, /pick\(STEAMS, looked\.steam, 'none'\)/);
  // The only data-* values built from a result are the ones picked above or fixed words.
  const dataValues = [...script.matchAll(/'data-(?:status|basis|verdict|tone)':\s*([^,}]+)/g)].map((m) => m[1]!.trim());
  assert.ok(dataValues.length >= 3, "the scan found almost nothing, so it proves nothing");
  for (const value of dataValues) assert.match(value, /^(?:status|b|tone)$/, `data attribute built from ${value}`);
});

test("the Doctor page names the three verdicts and the three labels the engine uses", () => {
  const script = scriptOf(renderDoctorApp());
  for (const verdict of ["clear", "attention", "problems"]) assert.match(script, new RegExp(`${verdict}: '`), verdict);
  for (const basis of ["install", "rule", "guess"]) assert.match(script, new RegExp(`${basis}: \\{ label:`), basis);
  for (const status of ["problem", "warn", "note"]) assert.match(script, new RegExp(`${status}: '`), status);
  const html = renderDoctorApp();
  for (const verdict of ["clear", "attention", "problems"]) {
    assert.match(html, new RegExp(`\\.app\\[data-verdict="${verdict}"\\]`), `no style for ${verdict}`);
  }
});

test("the Doctor page puts a clear report as 'nothing found', not 'all clear', so it never sounds like a promise", () => {
  const script = scriptOf(renderDoctorApp());
  assert.match(script, /clear: 'NOTHING FOUND'/);
  assert.doesNotMatch(renderDoctorApp(), /ALL CLEAR|all clear|SAFE\b/);
});

test("the Doctor page asks for the tool it belongs to, and only by that name", () => {
  const script = scriptOf(renderDoctorApp());
  assert.match(script, /var TOOL = 'mw_doctor'/);
  assert.equal((script.match(/callTool\(/g) ?? []).length, 1, "one place calls a tool");
  assert.doesNotMatch(script, /callTool\(\s*['"]/, "a tool named inline");
});

test("the Doctor page offers the three kinds of check, and only the tool's own words for them", () => {
  const html = renderDoctorApp();
  assert.match(html, /<option value="all">/);
  assert.match(html, /<option value="setup">/);
  assert.match(html, /<option value="deck">/);
  const script = scriptOf(html);
  assert.match(script, /area === 'setup' \|\| area === 'deck'/);
});

test("the Doctor page draws a stand-in result without touching markup, and shows names from other people's files as plain text", async () => {
  // A small DOM stand-in: enough to run the page's own script, runtime included, against a report
  // handed over the way a host hands it over, and to read back what the page drew.
  type Fake = {
    tag: string;
    children: Fake[];
    attrs: Record<string, string>;
    textContent: string;
    hidden: boolean;
    value: string;
    disabled: boolean;
    firstChild: Fake | null;
    offsetWidth: number;
    style: Record<string, string>;
    classList: { add(): void; remove(): void };
    appendChild(n: Fake): Fake;
    removeChild(n: Fake): Fake;
    setAttribute(k: string, v: string): void;
    addEventListener(): void;
    getBoundingClientRect(): { width: number; height: number };
    focus(): void;
    select(): void;
  };
  const make = (tag: string, text = ""): Fake => {
    const node: Fake = {
      tag,
      children: [],
      attrs: {},
      textContent: text,
      hidden: false,
      value: "",
      disabled: false,
      firstChild: null,
      offsetWidth: 0,
      style: {},
      classList: { add() {}, remove() {} },
      appendChild(n) {
        node.children.push(n);
        node.firstChild = node.children[0] ?? null;
        return n;
      },
      removeChild(n) {
        node.children = node.children.filter((c) => c !== n);
        node.firstChild = node.children[0] ?? null;
        return n;
      },
      setAttribute(k, v) {
        node.attrs[k] = v;
      },
      addEventListener() {},
      getBoundingClientRect: () => ({ width: 300, height: 200 }),
      focus() {},
      select() {},
    };
    return node;
  };

  const html = renderDoctorApp();
  const byId = new Map<string, Fake>();
  for (const m of html.matchAll(/\sid="([a-z-]+)"/g)) byId.set(m[1]!, make("x"));
  const posted: Message[] = [];
  const parent = { postMessage: (m: Message) => void posted.push(JSON.parse(JSON.stringify(m)) as Message) };
  const listeners: Record<string, Listener[]> = {};
  const sandbox: Record<string, unknown> = {
    parent,
    addEventListener: (type: string, fn: Listener) => void (listeners[type] ??= []).push(fn),
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    setTimeout: () => 1,
    navigator: {},
    document: {
      documentElement: { setAttribute() {}, style: { setProperty() {}, colorScheme: "" } },
      getElementById: (id: string) => byId.get(id) ?? null,
      createElement: (tag: string) => make(tag),
      createTextNode: (text: string) => make("#text", text),
    },
  };
  sandbox.window = sandbox; // as in a browser, where the global object is the window
  runInNewContext(scriptOf(html), sandbox);
  assert.ok(posted.some((m) => m.method === "ui/initialize"), "the page introduced itself to the host");

  const hostile = '<img src=x onerror="alert(1)"> Some Mod.esp';
  const fromHost = (data: unknown): void => {
    for (const fn of listeners.message ?? []) fn({ source: parent, data });
  };
  fromHost({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      content: [{ type: "text", text: "Doctor: x" }],
      structuredContent: {
        ok: true,
        game: { id: "skyrimspecialedition", name: hostile },
        platform: "linux",
        steamDeck: true,
        areas: ["setup", "deck"],
        verdict: "constructor",
        headline: "1 problem found. Start with the first.",
        counts: { problem: 1, warn: 0, note: 0, ok: 0 },
        findings: [
          { id: "setup.masters-missing", area: "setup", status: "problem", title: hostile, detail: hostile, fix: hostile, basis: "toString", source: hostile, items: [hostile] },
        ],
        notChecked: [{ what: hostile, why: hostile }],
        nextSteps: [],
        limits: [hostile],
        looked: { gameFolder: true, steam: "constructor", mo2: { used: false, reason: hostile } },
      },
    },
  });
  await tick();

  const drawn: Fake[] = [];
  const walk = (n: Fake): void => {
    drawn.push(n);
    n.children.forEach(walk);
  };
  for (const node of byId.values()) walk(node);
  // Nothing was parsed as markup: every element is one the page made itself, and the hostile text is only ever text.
  assert.ok(drawn.some((n) => n.textContent.includes("<img")), "the hostile text should appear, as text");
  assert.ok(drawn.every((n) => !/^(img|script|iframe)$/.test(n.tag)), "no element came from the data");
  assert.equal(byId.get("mw-root")!.attrs["data-verdict"], "attention", "an inherited name is not a verdict");
  assert.equal(byId.get("verdict-word")!.textContent, "WORTH A LOOK");
  assert.equal(byId.get("area-row")!.hidden, false, "on Linux there is a choice of checks");
  const labelled = drawn.filter((n) => n.attrs["data-basis"] !== undefined);
  assert.ok(labelled.length > 0, "the finding carries a basis label");
  for (const n of labelled) assert.equal(n.attrs["data-basis"], "guess", "an inherited name is not a basis");
  const rows = drawn.filter((n) => n.attrs["data-status"] !== undefined);
  assert.ok(rows.length > 0);
  for (const n of rows) assert.equal(n.attrs["data-status"], "problem");
});

test("the Crash Whisperer page offers the four places a post can go", () => {
  const script = scriptOf(renderCrashWhispererApp());
  assert.match(script, /\['forum', 'Forum'\], \['github', 'GitHub'\], \['discord', 'Discord'\], \['author', 'Mod author'\]/);
});

// ─── The protocol runtime, in a bare VM ──────────────────────────────────────

type Message = Record<string, unknown> & { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code: number; message: string } };
type Listener = (event: { source: unknown; data: unknown }) => void;

type Mw = {
  start(name: string, version: string, onSilent?: () => void): void;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  sendMessage(text: string): Promise<unknown>;
  openLink(url: string): Promise<unknown>;
  on(kind: string, fn: (payload: unknown) => void): void;
  capabilities(): Record<string, unknown>;
  resized(): void;
};

function boot() {
  const runtime = (() => {
    const html = renderApp({ title: "t", css: "", body: '<div id="mw-root"></div>', script: "" });
    return scriptOf(html);
  })();
  const posted: Message[] = [];
  const listeners: Record<string, Listener[]> = {};
  const parent = { postMessage: (m: Message) => void posted.push(JSON.parse(JSON.stringify(m)) as Message) };
  const attrs: Record<string, string> = {};
  const vars: Record<string, string> = {};
  const timers: Array<() => void> = [];
  const root = { getBoundingClientRect: () => ({ width: 320, height: 240 }) };
  const win = {
    parent,
    addEventListener: (type: string, fn: Listener) => void (listeners[type] ??= []).push(fn),
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    setTimeout: (fn: () => void) => timers.push(fn),
  };
  const doc = {
    documentElement: {
      setAttribute: (k: string, v: string) => void (attrs[k] = v),
      style: { setProperty: (k: string, v: string) => void (vars[k] = v), colorScheme: "" },
    },
    getElementById: (id: string) => (id === "mw-root" ? root : null),
  };
  const sandbox: Record<string, unknown> = { window: win, document: doc };
  runInNewContext(runtime + "\nthis.mwApp = mwApp;", sandbox);
  const mw = sandbox.mwApp as Mw;
  const fromHost = (data: unknown): void => {
    for (const fn of listeners.message ?? []) fn({ source: parent, data });
  };
  const fromElsewhere = (data: unknown): void => {
    for (const fn of listeners.message ?? []) fn({ source: { not: "the parent" }, data });
  };
  const answerInitialize = (hostContext: Record<string, unknown> = {}, hostCapabilities: Record<string, unknown> = {}): void => {
    const init = posted.find((m) => m.method === "ui/initialize");
    assert.ok(init, "ui/initialize was not sent");
    fromHost({ jsonrpc: "2.0", id: init.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "h", version: "1" }, hostCapabilities, hostContext } });
  };
  return { mw, posted, attrs, vars, timers, root, fromHost, fromElsewhere, answerInitialize };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("start() introduces the page to the host first, and says nothing else until it is answered", () => {
  const { mw, posted } = boot();
  mw.start("modwrench-test", "9");
  assert.equal(posted.length, 1);
  const init = posted[0]!;
  assert.equal(init.jsonrpc, "2.0");
  assert.equal(init.method, "ui/initialize");
  assert.equal(typeof init.id, "number");
  assert.deepEqual(init.params, {
    protocolVersion: "2026-01-26",
    appInfo: { name: "modwrench-test", version: "9" },
    appCapabilities: { availableDisplayModes: ["inline"] },
  });
});

test("once the host answers, the page confirms, adopts the host's theme and variables, and reports its size", async () => {
  const { mw, posted, attrs, vars, answerInitialize } = boot();
  mw.start("t", "1");
  answerInitialize({
    theme: "dark",
    styles: { variables: { "--color-background-primary": "#111", "--font-sans": "Georgia", "color": "red", "--bad key": "x", "--n": 5 } },
    safeAreaInsets: { top: 4, right: 0, bottom: 2, left: 0 },
  }, { message: { text: {} } });
  await tick();
  const methods = posted.map((m) => m.method);
  assert.deepEqual(methods.slice(0, 2), ["ui/initialize", "ui/notifications/initialized"]);
  assert.equal(attrs["data-theme"], "dark");
  assert.equal(vars["--color-background-primary"], "#111");
  assert.equal(vars["--font-sans"], "Georgia");
  assert.equal("color" in vars, false, "a name that isn't a custom property is ignored");
  assert.equal("--bad key" in vars, false, "a malformed name is ignored");
  assert.equal("--n" in vars, false, "a non-string value is ignored");
  assert.equal(vars["--safe-top"], "4px");
  assert.equal(vars["--safe-bottom"], "2px");
  assert.deepEqual(mw.capabilities(), { message: { text: {} } });
  const size = posted.find((m) => m.method === "ui/notifications/size-changed");
  assert.deepEqual(size?.params, { width: 320, height: 240 });
});

test("the same size is not reported twice", async () => {
  const { mw, posted, answerInitialize } = boot();
  mw.start("t", "1");
  answerInitialize();
  await tick();
  mw.resized();
  mw.resized();
  assert.equal(posted.filter((m) => m.method === "ui/notifications/size-changed").length, 1);
});

test("only the parent window is believed, and only JSON-RPC 2.0", async () => {
  const { mw, posted, fromHost, fromElsewhere } = boot();
  const seen: unknown[] = [];
  mw.on("result", (p) => seen.push(p));
  mw.start("t", "1");
  const before = posted.length;
  fromElsewhere({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [] } });
  fromElsewhere({ jsonrpc: "2.0", id: 1, result: {} });
  fromHost("PWNED");
  fromHost(null);
  fromHost(42);
  fromHost({ method: "ui/notifications/tool-result", params: {} });
  fromHost({ jsonrpc: "1.0", method: "ui/notifications/tool-result", params: {} });
  await tick();
  assert.deepEqual(seen, [], "a message that should have been ignored reached a listener");
  assert.equal(posted.length, before, "the page answered something it should have ignored");
});

test("tool input, results, cancellation and context changes reach the page's listeners", async () => {
  const { mw, fromHost, answerInitialize, vars, attrs } = boot();
  const got: Record<string, unknown[]> = { input: [], result: [], cancelled: [], context: [] };
  for (const kind of Object.keys(got)) mw.on(kind, (p) => got[kind]!.push(p));
  mw.start("t", "1");
  answerInitialize({ theme: "light", displayMode: "inline" });
  await tick();
  fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { gamePath: "x" } } });
  fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "text", text: "hi" }], structuredContent: { ok: true } } });
  fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-cancelled", params: { reason: "stop" } });
  fromHost({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "dark", styles: { variables: { "--ink": "#fff" } } } });
  await tick();
  assert.deepEqual(got.input, [{ arguments: { gamePath: "x" } }]);
  assert.deepEqual(got.result, [{ content: [{ type: "text", text: "hi" }], structuredContent: { ok: true } }]);
  assert.deepEqual(got.cancelled, [{ reason: "stop" }]);
  const merged = got.context.at(-1) as Record<string, unknown>;
  assert.equal(merged.theme, "dark", "the change wins");
  assert.equal(merged.displayMode, "inline", "what the change didn't mention is kept");
  assert.equal(attrs["data-theme"], "dark");
  assert.equal(vars["--ink"], "#fff");
});

test("ping and teardown are answered with {}; any other request is refused, and a failing listener doesn't stop the rest", async () => {
  const { mw, posted, fromHost, answerInitialize } = boot();
  const order: string[] = [];
  mw.on("teardown", () => {
    order.push("first");
    throw new Error("a broken listener");
  });
  mw.on("teardown", () => order.push("second"));
  mw.start("t", "1");
  answerInitialize();
  fromHost({ jsonrpc: "2.0", id: 71, method: "ping" });
  fromHost({ jsonrpc: "2.0", id: 72, method: "ui/resource-teardown", params: { reason: "gone" } });
  fromHost({ jsonrpc: "2.0", id: 73, method: "something/else" });
  await tick();
  const reply = (id: number): Message | undefined => posted.find((m) => m.id === id && m.method === undefined);
  assert.deepEqual(reply(71)?.result, {});
  assert.deepEqual(reply(72)?.result, {});
  assert.equal(reply(73)?.error?.code, -32601);
  assert.deepEqual(order, ["first", "second"]);
});

test("callTool sends tools/call and matches each answer to its own request, in any order", async () => {
  const { mw, posted, fromHost, answerInitialize } = boot();
  mw.start("t", "1");
  answerInitialize();
  await tick();
  const a = mw.callTool("mw_patch_day", { gamePath: "a" });
  const b = mw.callTool("mw_patch_day", { gamePath: "b" });
  const calls = posted.filter((m) => m.method === "tools/call");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]!.params, { name: "mw_patch_day", arguments: { gamePath: "a" } });
  assert.notEqual(calls[0]!.id, calls[1]!.id);
  fromHost({ jsonrpc: "2.0", id: calls[1]!.id, result: { content: [{ type: "text", text: "B" }] } });
  fromHost({ jsonrpc: "2.0", id: calls[0]!.id, result: { content: [{ type: "text", text: "A" }] } });
  assert.deepEqual(await a, { content: [{ type: "text", text: "A" }] });
  assert.deepEqual(await b, { content: [{ type: "text", text: "B" }] });
});

test("a host that refuses a request rejects it with the host's own message", async () => {
  const { mw, posted, fromHost, answerInitialize } = boot();
  mw.start("t", "1");
  answerInitialize();
  await tick();
  const call = mw.callTool("mw_patch_day");
  const sent = posted.filter((m) => m.method === "tools/call")[0]!;
  fromHost({ jsonrpc: "2.0", id: sent.id, error: { code: -32601, message: "not supported here" } });
  await assert.rejects(call, /not supported here/);
});

test("sendMessage puts the text in an array of content blocks, as ui/message requires", async () => {
  const { mw, posted, answerInitialize } = boot();
  mw.start("t", "1");
  answerInitialize();
  await tick();
  void mw.sendMessage("hello");
  const sent = posted.find((m) => m.method === "ui/message");
  assert.deepEqual(sent?.params, { role: "user", content: [{ type: "text", text: "hello" }] });
});

test("a host that answers ui/message with isError didn't take it, so sendMessage rejects", async () => {
  // MCP Apps: McpUiMessageResult.isError is "true if the host rejected or failed to deliver the message".
  const { mw, posted, fromHost, answerInitialize } = boot();
  mw.start("t", "1");
  answerInitialize();
  await tick();
  const refused = mw.sendMessage("hello");
  fromHost({ jsonrpc: "2.0", id: posted.filter((m) => m.method === "ui/message")[0]!.id, result: { isError: true } });
  await assert.rejects(refused);
  const taken = mw.sendMessage("hello");
  fromHost({ jsonrpc: "2.0", id: posted.filter((m) => m.method === "ui/message")[1]!.id, result: {} });
  assert.deepEqual(await taken, {});
});

test("openLink asks the host to open exactly the address it was given, and nothing else rides along", async () => {
  const { mw, posted, fromHost, answerInitialize } = boot();
  mw.start("t", "1");
  answerInitialize();
  await tick();
  const url = "https://www.nexusmods.com/skyrimspecialedition/mods/1";
  const opened = mw.openLink(url);
  const sent = posted.filter((m) => m.method === "ui/open-link");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.params, { url });
  fromHost({ jsonrpc: "2.0", id: sent[0]!.id, result: {} });
  assert.deepEqual(await opened, {});
});

test("a host that won't open the link, by error or by isError, makes openLink reject", async () => {
  // MCP Apps: a refusal is a JSON-RPC error ("Link opening denied by user"); McpUiOpenLinkResult also allows isError.
  const { mw, posted, fromHost, answerInitialize } = boot();
  mw.start("t", "1");
  answerInitialize();
  await tick();
  const denied = mw.openLink("https://mod.io/g/x/m/y");
  fromHost({ jsonrpc: "2.0", id: posted.filter((m) => m.method === "ui/open-link")[0]!.id, error: { code: -32000, message: "Link opening denied by user" } });
  await assert.rejects(denied, /denied by user/);
  const refused = mw.openLink("https://mod.io/g/x/m/y");
  fromHost({ jsonrpc: "2.0", id: posted.filter((m) => m.method === "ui/open-link")[1]!.id, result: { isError: true } });
  await assert.rejects(refused, /did not open the link/);
});

test("a host that never answers is reported after the wait, and one that answers is not", async () => {
  const silent = boot();
  let told = 0;
  silent.mw.start("t", "1", () => told++);
  silent.timers.forEach((fn) => fn());
  assert.equal(told, 1, "the page should say it couldn't reach the host");

  const answered = boot();
  let toldAgain = 0;
  answered.mw.start("t", "1", () => toldAgain++);
  answered.answerInitialize();
  await tick();
  answered.timers.forEach((fn) => fn());
  assert.equal(toldAgain, 0, "an answered host must not be reported as silent");
});
