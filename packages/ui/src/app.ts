// ─── MCP Apps: the shared page runtime ───────────────────────────────────────
// The panels in views.ts and shell.ts travel inside the tool result as an
// embedded `ui://` resource. That works in clients that draw them and puts the
// whole page into the conversation in clients that don't. MCP Apps (the
// extension the MCP project standardised in 2026) is built the other way round:
// the tool result stays plain, the tool points at a `ui://` resource by URI, and
// a client that supports the extension fetches that page itself and draws it in a
// sandboxed frame. A client that doesn't support it never fetches it, so nothing
// lands in the conversation.
//
// This file holds what every such page needs: the identifiers, the metadata the
// server attaches, and a small runtime that speaks the page side of the protocol
// (JSON-RPC over postMessage to the host). It is plain script with no
// dependencies: the page cannot load anything, and the protocol is small enough
// that a library would be larger than the code it saved.
//
// Pages built on it are a pure function of the tool result: they hold nothing,
// store nothing and make no network requests. They draw what the host hands them
// and, when the person presses a button, ask the host to call a tool again.

import { esc, panelsDisabled } from "./resource.js";

/** The MIME type MCP Apps hosts look for on a UI resource. */
export const MCP_APP_MIME = "text/html;profile=mcp-app";

/**
 * The key a client uses, under `capabilities.extensions` when it connects, to say it
 * can draw MCP Apps pages. Its value lists the MIME types it can draw.
 */
export const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui";

/** The page that shows a Patch Day result. */
export const PATCH_DAY_APP_URI = "ui://modwrench/patch-day";

/** The page that shows a Crash Whisperer result. */
export const CRASH_WHISPERER_APP_URI = "ui://modwrench/crash-whisperer";

/** The page that shows a Doctor result. */
export const DOCTOR_APP_URI = "ui://modwrench/doctor";

/**
 * The `_meta` a tool carries to say "draw this page for my result".
 *
 * `ui.resourceUri` is the current key; the flat `ui/resourceUri` is the older
 * spelling some hosts still read. `visibility` includes "app" so the page can
 * call the tool itself (the Re-check button) and "model" so the assistant can
 * still call it.
 *
 * Returns undefined when the person has switched panels off (MODWRENCH_UI=off),
 * so the tool then advertises no page at all.
 */
export function appToolMeta(resourceUri: string): Record<string, unknown> | undefined {
  if (panelsDisabled()) return undefined;
  return {
    ui: { resourceUri, visibility: ["model", "app"] },
    "ui/resourceUri": resourceUri,
  };
}

/**
 * The `_meta` on the page itself, as read by the host.
 *
 * No `csp`: that is the host's strict default, which allows no network access
 * at all, and a page that needs nothing outside itself asks for nothing.
 * `clipboardWrite` is the one permission requested, for the Copy button, and the
 * page falls back to selecting the text when a host doesn't grant it.
 */
export function appResourceMeta(): Record<string, unknown> {
  return { ui: { permissions: { clipboardWrite: {} } } };
}

// What the page itself promises, enforced by the browser rather than by trust:
// no network of any kind, nothing loaded from anywhere, no forms, no frames.
const PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";

// Colors, spacing and the pieces every page shares. Host variables (the
// `--color-*` and `--font-*` names the MCP Apps spec defines) win when the host
// sends them; the fallbacks are ModWrench's own and follow the host's
// light/dark choice, or the system's when the host says nothing.
const APP_BASE_CSS = String.raw`
:root{
  color-scheme:light dark;
  --fb-bg:#ffffff;--fb-panel:#f5f6f8;--fb-ink:#1b1c20;--fb-sub:#585c66;--fb-line:#d5d8df;--fb-focus:#1d4ed8;
  --fb-go:#17703a;--fb-go-bg:#e4f3e9;--fb-warn:#7d5200;--fb-warn-bg:#fff2d1;--fb-bad:#b3261e;--fb-bad-bg:#fde7e5;
}
@media (prefers-color-scheme:dark){:root{
  --fb-bg:#17181c;--fb-panel:#202228;--fb-ink:#ececf1;--fb-sub:#a6aab6;--fb-line:#363943;--fb-focus:#7fb0ff;
  --fb-go:#5bcf84;--fb-go-bg:#12301f;--fb-warn:#f1b73f;--fb-warn-bg:#352808;--fb-bad:#ff8c82;--fb-bad-bg:#3b1715;
}}
:root[data-theme="light"]{
  color-scheme:light;
  --fb-bg:#ffffff;--fb-panel:#f5f6f8;--fb-ink:#1b1c20;--fb-sub:#585c66;--fb-line:#d5d8df;--fb-focus:#1d4ed8;
  --fb-go:#17703a;--fb-go-bg:#e4f3e9;--fb-warn:#7d5200;--fb-warn-bg:#fff2d1;--fb-bad:#b3261e;--fb-bad-bg:#fde7e5;
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --fb-bg:#17181c;--fb-panel:#202228;--fb-ink:#ececf1;--fb-sub:#a6aab6;--fb-line:#363943;--fb-focus:#7fb0ff;
  --fb-go:#5bcf84;--fb-go-bg:#12301f;--fb-warn:#f1b73f;--fb-warn-bg:#352808;--fb-bad:#ff8c82;--fb-bad-bg:#3b1715;
}
:root{
  --bg:var(--color-background-primary,var(--fb-bg));
  --panel:var(--color-background-secondary,var(--fb-panel));
  --ink:var(--color-text-primary,var(--fb-ink));
  --sub:var(--color-text-secondary,var(--fb-sub));
  --line:var(--color-border-primary,var(--fb-line));
  --focus:var(--color-ring-primary,var(--fb-focus));
  --go:var(--color-text-success,var(--fb-go));
  --go-bg:var(--color-background-success,var(--fb-go-bg));
  --warn:var(--color-text-warning,var(--fb-warn));
  --warn-bg:var(--color-background-warning,var(--fb-warn-bg));
  --bad:var(--color-text-danger,var(--fb-bad));
  --bad-bg:var(--color-background-danger,var(--fb-bad-bg));
  --font:var(--font-sans,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif);
  --mono:var(--font-mono,ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace);
  --radius:var(--border-radius-md,10px);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:14px/1.5 var(--font);-webkit-font-smoothing:antialiased;display:flow-root}
button,input{font:inherit;color:inherit}
code,.mono{font-family:var(--mono)}
[hidden]{display:none!important}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.btn{min-height:36px;padding:6px 14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);cursor:pointer;line-height:1.2}
.btn:hover:not(:disabled){border-color:var(--sub)}
.btn:disabled{opacity:.55;cursor:default}
.btn.primary{background:var(--ink);color:var(--bg);border-color:var(--ink);font-weight:600}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

// The page side of the MCP Apps protocol. JSON-RPC 2.0 over window.parent.postMessage.
//   page -> host   ui/initialize (request), then ui/notifications/initialized
//   host -> page   ui/notifications/tool-input, tool-result, tool-cancelled, host-context-changed
//                  ui/resource-teardown and ping (requests; answered with {})
//   page -> host   tools/call, ui/message, ui/notifications/size-changed
// Messages are accepted only from the parent window, and anything that isn't a
// JSON-RPC message is ignored. Written without template literals: this text is
// embedded in a template literal itself.
const APP_RUNTIME_JS = String.raw`
var mwApp = (function () {
  'use strict';
  var PROTOCOL = '2026-01-26';
  var nextId = 1;
  var pending = {};
  var listeners = { input: [], result: [], context: [], cancelled: [], teardown: [] };
  var host = { context: {}, capabilities: {}, ready: false };
  var appName = 'modwrench';

  function post(message) {
    try { window.parent.postMessage(message, '*'); } catch (e) { /* no host to talk to */ }
  }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    });
  }
  function notify(method, params) {
    post({ jsonrpc: '2.0', method: method, params: params || {} });
  }
  function emit(kind, payload) {
    listeners[kind].forEach(function (fn) {
      try { fn(payload); } catch (e) { /* one listener must not stop the rest */ }
    });
  }

  function applyContext() {
    var ctx = host.context || {};
    var root = document.documentElement;
    if (ctx.theme === 'light' || ctx.theme === 'dark') {
      root.setAttribute('data-theme', ctx.theme);
      root.style.colorScheme = ctx.theme;
    }
    var vars = ctx.styles && ctx.styles.variables;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach(function (key) {
        var value = vars[key];
        if (/^--[a-zA-Z0-9-]+$/.test(key) && typeof value === 'string') root.style.setProperty(key, value);
      });
    }
    var inset = ctx.safeAreaInsets;
    if (inset && typeof inset === 'object') {
      ['top', 'right', 'bottom', 'left'].forEach(function (side) {
        var px = Number(inset[side]);
        root.style.setProperty('--safe-' + side, (isFinite(px) ? px : 0) + 'px');
      });
    }
  }

  function onRequest(message) {
    if (message.method === 'ping') {
      post({ jsonrpc: '2.0', id: message.id, result: {} });
    } else if (message.method === 'ui/resource-teardown') {
      emit('teardown', message.params);
      post({ jsonrpc: '2.0', id: message.id, result: {} });
    } else {
      post({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
    }
  }
  function onNotification(message) {
    var params = message.params || {};
    if (message.method === 'ui/notifications/tool-input') emit('input', params);
    else if (message.method === 'ui/notifications/tool-result') emit('result', params);
    else if (message.method === 'ui/notifications/tool-cancelled') emit('cancelled', params);
    else if (message.method === 'ui/notifications/host-context-changed') {
      var merged = {};
      Object.keys(host.context || {}).forEach(function (k) { merged[k] = host.context[k]; });
      Object.keys(params).forEach(function (k) { merged[k] = params[k]; });
      host.context = merged;
      applyContext();
      emit('context', host.context);
    }
  }
  function onResponse(message) {
    var entry = pending[message.id];
    if (!entry) return;
    delete pending[message.id];
    if (message.error) entry.reject(new Error(String(message.error.message || 'The host refused the request')));
    else entry.resolve(message.result);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return;
    var hasId = message.id !== undefined && message.id !== null;
    if (typeof message.method === 'string') {
      if (hasId) onRequest(message); else onNotification(message);
    } else if (hasId) {
      onResponse(message);
    }
  });

  // Tell the host how tall the page is. Measured on the root element, not the
  // window, so the page can shrink as well as grow.
  var lastHeight = -1;
  var sizeQueued = false;
  function sendSize() {
    var root = document.getElementById('mw-root');
    if (!root) return;
    var height = Math.ceil(root.getBoundingClientRect().height);
    if (height === lastHeight) return;
    lastHeight = height;
    notify('ui/notifications/size-changed', { width: Math.ceil(root.getBoundingClientRect().width), height: height });
  }
  function queueSize() {
    if (sizeQueued) return;
    sizeQueued = true;
    window.requestAnimationFrame(function () { sizeQueued = false; sendSize(); });
  }

  function start(name, version, onHostSilent) {
    appName = name;
    if (typeof ResizeObserver === 'function') {
      var root = document.getElementById('mw-root');
      if (root) new ResizeObserver(queueSize).observe(root);
    }
    window.addEventListener('resize', queueSize);
    var answered = false;
    request('ui/initialize', {
      protocolVersion: PROTOCOL,
      appInfo: { name: appName, version: version },
      appCapabilities: { availableDisplayModes: ['inline'] }
    }).then(function (result) {
      answered = true;
      result = result || {};
      host.context = result.hostContext || {};
      host.capabilities = result.hostCapabilities || {};
      host.ready = true;
      applyContext();
      notify('ui/notifications/initialized', {});
      emit('context', host.context);
      queueSize();
    }).catch(function () { /* a host that refuses initialisation gets no page; the answer stays in the chat */ });
    window.setTimeout(function () { if (!answered && onHostSilent) onHostSilent(); }, 4000);
  }

  return {
    start: start,
    request: request,
    callTool: function (name, args) { return request('tools/call', { name: name, arguments: args || {} }); },
    // A host that refused the message, or couldn't deliver it, answers with isError rather than an error.
    sendMessage: function (text) {
      return request('ui/message', { role: 'user', content: [{ type: 'text', text: text }] }).then(function (result) {
        if (result && result.isError) throw new Error('The host did not take the message');
        return result;
      });
    },
    capabilities: function () { return host.capabilities || {}; },
    resized: queueSize,
    on: function (kind, fn) { if (listeners[kind]) listeners[kind].push(fn); }
  };
})();
`;

export type AppPage = {
  /** The page title (also the accessible name of the frame in some hosts). */
  title: string;
  /** CSS for this page, after the shared base. */
  css: string;
  /** The static markup of the page body. It must contain an element with id="mw-root" wrapping everything the person sees. */
  body: string;
  /** The script for this page, after the shared runtime. */
  script: string;
};

/** A complete HTML document for an MCP App resource. */
export function renderApp(page: AppPage): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${esc(PAGE_CSP)}">
<title>${esc(page.title)}</title>
<style>${APP_BASE_CSS}${page.css}</style>
</head>
<body>
${page.body}
<script>${APP_RUNTIME_JS}
${page.script}</script>
</body>
</html>`;
}
