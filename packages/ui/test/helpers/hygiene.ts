import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";

// ─── The promises every MCP Apps page makes, as tests ────────────────────────
// A page here is a promise the README and TRUST.md make out loud: it makes no
// network requests, keeps nothing, loads nothing, and puts nothing from the
// person's machine on the page as markup. These tests read the finished HTML for
// the things that would break them: a URL, a way to reach the network, a way to
// turn a string into markup or code, an inline handler. Every page is held to the
// same ones: call pageHygieneTests once per page.

/** A page's one inline script. */
export function scriptOf(html: string): string {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  assert.equal(scripts.length, 1, "expected exactly one inline script");
  return scripts[0]!;
}

/** The attribute names a page's element helper may set. A page that needs another passes it in `extraAttrs`. */
const ALLOWED_ATTRS = [
  "class", "text", "role", "type", "title", "id", "readonly", "spellcheck", "tabindex",
  "data-tone", "data-status", "data-basis", "data-severity", "data-strength", "data-kind", "data-scan", "data-sev", "data-state",
  "aria-label", "aria-hidden", "aria-selected", "aria-controls", "aria-live", "aria-pressed", "aria-expanded",
];

/**
 * Register the hygiene tests for one page.
 *
 * `minAttrs` is how many attribute names the scan of the page's element helper calls must find
 * before it proves anything (default 10); `extraAttrs` widens the allowlist for this page only.
 */
export function pageHygieneTests(
  name: string,
  render: () => string,
  opts: { extraAttrs?: string[]; minAttrs?: number } = {}
): void {
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
      [/\.innerHTML\b|\.outerHTML\b|\binsertAdjacentHTML\b|\bsetHTMLUnsafe\b|\bparseHTMLUnsafe\b|\bdocument\.write(?:ln)?\b|\bsrcdoc\b|\bDOMParser\b|\bcreateContextualFragment\b/, "a way to turn text into markup"],
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
    const allowed = new Set([...ALLOWED_ATTRS, ...(opts.extraAttrs ?? [])]);
    for (const key of attrKeys) assert.ok(allowed.has(key), `unexpected attribute name from the page's element helper: ${key}`);
    const minAttrs = opts.minAttrs ?? 10;
    assert.ok(attrKeys.length > minAttrs, "the attribute scan found almost nothing, so it proves nothing");
  });

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
