import { test } from "node:test";
import assert from "node:assert/strict";
import { Script, runInNewContext } from "node:vm";
import {
  CRASH_WHISPERER_APP_URI,
  MCP_APP_MIME,
  MCP_APPS_EXTENSION_ID,
  PATCH_DAY_APP_URI,
  appResourceMeta,
  appToolMeta,
  renderApp,
  renderCrashWhispererApp,
  renderPatchDayApp,
} from "../src/index.js";

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

function scriptOf(html: string): string {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  assert.equal(scripts.length, 1, "expected exactly one inline script");
  return scripts[0]!;
}

// ─── What the server attaches ────────────────────────────────────────────────

test("a page is identified by the MCP Apps MIME type and a ui:// URI, and no two pages share one", () => {
  assert.equal(MCP_APP_MIME, "text/html;profile=mcp-app");
  assert.match(PATCH_DAY_APP_URI, /^ui:\/\/modwrench\//);
  assert.match(CRASH_WHISPERER_APP_URI, /^ui:\/\/modwrench\//);
  assert.notEqual(PATCH_DAY_APP_URI, CRASH_WHISPERER_APP_URI);
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

for (const value of ["off", "0", "false", "none", "OFF"]) {
  test(`MODWRENCH_UI=${JSON.stringify(value)} means no page is advertised`, () => {
    assert.equal(withEnv(value, () => appToolMeta(PATCH_DAY_APP_URI)), undefined);
  });
}

test("the page asks for the clipboard and nothing else, and widens no network rule", () => {
  const meta = appResourceMeta() as { ui: Record<string, unknown> };
  assert.deepEqual(meta, { ui: { permissions: { clipboardWrite: {} } } });
  assert.equal("csp" in meta.ui, false, "a csp here would loosen the host's no-network default");
  assert.equal("domain" in meta.ui, false);
});

// ─── The finished HTML ───────────────────────────────────────────────────────

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
];

for (const [name, render] of PAGES) {
  test(`the ${name} page's own Content-Security-Policy allows no network, no frames and no outside loads`, () => {
    const html = render();
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
    assert.ok(csp, "no policy meta tag");
    const policy = csp[1]!.replace(/&#39;/g, "'");
    for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
      assert.ok(policy.includes(directive), `policy lacks ${directive}: ${policy}`);
    }
    assert.doesNotMatch(policy, /https?:|\*/, "the policy names a host or a wildcard");
  });

  test(`the ${name} page contains no URL, so it can load nothing and contact no one`, () => {
    const html = render();
    assert.doesNotMatch(html, /https?:\/\//i);
    assert.doesNotMatch(html, /\/\/[a-z0-9.-]+\.[a-z]{2,}/i, "a protocol-relative URL");
    assert.doesNotMatch(html, /url\s*\(/i, "CSS that loads");
    assert.doesNotMatch(html, /@import/i);
    // Attributes are checked on the markup alone: `data = ...` is ordinary JavaScript in the script.
    const markup = html.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
    assert.ok(markup.includes('id="mw-root"'), "the markup scan lost the page body, so it would pass vacuously");
    assert.doesNotMatch(markup, /\s(?:src|href|srcset|action|formaction|poster|data|ping|background)\s*=/i, "an attribute that loads or navigates");
  });

  test(`the ${name} page has no way to reach the network, keep state or run strings as code`, () => {
    const html = render();
    const banned: Array<[RegExp, string]> = [
      [/\bfetch\s*\(/, "fetch"],
      [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
      [/\bWebSocket\b/, "WebSocket"],
      [/\bEventSource\b/, "EventSource"],
      [/\bsendBeacon\b/, "sendBeacon"],
      [/\bnew\s+Image\b/, "new Image"],
      [/\bimportScripts\b/, "importScripts"],
      [/\bimport\s*\(/, "dynamic import"],
      [/\bServiceWorker\b|\bserviceWorker\b/, "service workers"],
      [/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\.cookie\b/, "browser storage"],
      [/\beval\s*\(/, "eval"],
      [/\bnew\s+Function\b|\bFunction\s*\(/, "Function constructor"],
      [/setTimeout\s*\(\s*['"]/, "setTimeout with a string"],
      [/setInterval\s*\(\s*['"]/, "setInterval with a string"],
      [/\.innerHTML\b|\.outerHTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b|\bsrcdoc\b|\bDOMParser\b|\bcreateContextualFragment\b/, "a way to turn text into markup"],
      [/\bwindow\.open\b|\blocation\s*[.=]|\bwindow\.top\b|\btop\.location\b/, "navigation"],
      [/<(?:iframe|object|embed|link|base|form|frame|meta\s+http-equiv="refresh")\b/i, "an element that loads or navigates"],
    ];
    // The only place the policy meta tag may appear is the head, and it is checked on its own.
    const withoutPolicy = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "");
    for (const [pattern, what] of banned) {
      assert.doesNotMatch(withoutPolicy, pattern, `the page uses ${what}`);
    }
  });

  test(`the ${name} page has no inline event handlers; every action is wired in script`, () => {
    const html = render();
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "an inline handler attribute");
    assert.doesNotMatch(html, /javascript:/i);
  });

  test(`the ${name} page script is valid JavaScript and holds no module syntax`, () => {
    const script = scriptOf(render());
    assert.doesNotThrow(() => new Script(script), "the page script does not parse");
    assert.doesNotMatch(script, /^\s*(?:import|export)\s/m, "module syntax in an inline script");
    assert.doesNotMatch(script, /\brequire\s*\(/);
  });

  test(`every piece of text from the person's machine goes in as text on the ${name} page, never as markup`, () => {
    const script = scriptOf(render());
    // The page builds elements and sets text through one helper, with one escape
    // hatch for attributes. Both are checked: text goes through textContent and
    // text nodes, and no attribute name comes from data.
    assert.match(script, /node\.textContent\s*=/);
    assert.match(script, /document\.createTextNode\(/);
    // Attribute names handed to the element helper are string literals in this file, not data.
    const attrKeys = [...script.matchAll(/\bh\(\s*'[a-z0-9]+'\s*,\s*\{([^}]*)\}/g)].flatMap((m) =>
      [...m[1]!.matchAll(/(?:^|,)\s*(?:'([^']+)'|([A-Za-z_]+))\s*:/g)].map((k) => k[1] ?? k[2]!)
    );
    const allowed = new Set([
      "class", "text", "role", "type", "title", "id", "readonly", "spellcheck", "tabindex",
      "data-tone", "data-status", "data-basis", "data-severity", "data-strength", "data-kind", "data-scan",
      "aria-label", "aria-hidden", "aria-selected", "aria-controls", "aria-live",
    ]);
    for (const key of attrKeys) assert.ok(allowed.has(key), `unexpected attribute name from the page's element helper: ${key}`);
    assert.ok(attrKeys.length > 10, "the attribute scan found almost nothing, so it proves nothing");
  });
}

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

test("the Crash Whisperer page offers the four places a post can go", () => {
  const script = scriptOf(renderCrashWhispererApp());
  assert.match(script, /\['forum', 'Forum'\], \['github', 'GitHub'\], \['discord', 'Discord'\], \['author', 'Mod author'\]/);
});

for (const [name, render] of PAGES) {
  test(`the ${name} page keeps the host's colors when it sends them, and has its own for light and dark when it doesn't`, () => {
    const html = render();
    assert.match(html, /--bg:var\(--color-background-primary,var\(--fb-bg\)\)/);
    assert.match(html, /@media \(prefers-color-scheme:dark\)/);
    assert.match(html, /:root\[data-theme="light"\]/);
    assert.match(html, /:root\[data-theme="dark"\]/);
    assert.match(html, /prefers-reduced-motion:reduce/);
    assert.match(html, /:focus-visible/);
  });

  test(`the ${name} page stays small and never takes the whole panel budget of the old panels`, () => {
    const bytes = Buffer.byteLength(render(), "utf8");
    assert.ok(bytes < 70_000, `the page is ${bytes} bytes`);
    assert.ok(bytes > 10_000, `the page is ${bytes} bytes: suspiciously small`);
  });
}

// ─── The protocol runtime, in a bare VM ──────────────────────────────────────

type Message = Record<string, unknown> & { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code: number; message: string } };
type Listener = (event: { source: unknown; data: unknown }) => void;

type Mw = {
  start(name: string, version: string, onSilent?: () => void): void;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  sendMessage(text: string): Promise<unknown>;
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
