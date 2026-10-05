// ─── The Crash log page ─────────────────────────────────────────────────────
// A parsed crash log, drawn as an MCP Apps page (see app.ts) in the four game skins
// (see skin.ts), for mw_parse_crashlog and mw_diagnose_crash.
//
// The page is a pure function of the tool result. It keeps nothing, stores nothing
// and makes no network requests (its own Content-Security-Policy forbids them).
// Everything in a result is someone else's text and goes on the page as text only.

import { renderApp } from "./app.js";
import type { AppPageDef } from "./serve.js";
import { SKIN_CSS, SKIN_JS, skinFrame } from "./skin.js";
import { THEME_IDS, type ThemeId } from "./themes.js";

/** The page that shows a parsed crash log. */
export const CRASH_APP_URI = "ui://modwrench/crash";

/** What the page draws: the parsed crash, cut to what the page shows, with the full counts. */
export type CrashView =
  | { view: "crash"; theme: ThemeId; ok: false; reason: string }
  | {
      view: "crash";
      theme: ThemeId;
      ok: true;
      detectedType: string;
      gameVersion?: string;
      loggerVersion?: string;
      exception: { type?: string; address?: string; description?: string };
      /** The first 32 frames. */
      callStack: Array<{ index?: number; module: string; function?: string; offset?: string }>;
      /** The first 32 registers, in the log's order. */
      registers: Array<{ name: string; value: string }>;
      /** The first 60 plugins. */
      loadedPlugins: Array<{ name: string; loadIndex?: string }>;
      /** The first 10 suspected references. */
      suspectedRefs: Array<{ type?: string; value?: string; likelySource?: string }>;
      /** SETTINGS, MODULES, F4SE PLUGINS, SKSE PLUGINS, STACK, then the rest in the log's order; each cut to 60 lines. */
      rawSections: Array<{ name: string; text: string }>;
      counts: { frames: number; registers: number; plugins: number };
    };

/** A parsed crash log as workbench's parseCrashlog returns it (ui can't import workbench, so it is matched by shape). */
export type CrashInput =
  | { ok: false; reason: string }
  | {
      ok: true;
      detectedType: string;
      gameVersion?: string;
      loggerVersion?: string;
      exception: { type?: string; address?: string; description?: string };
      callStack: Array<{ index?: number; module: string; function?: string; offset?: string }>;
      loadedPlugins: Array<{ name: string; loadIndex?: string }>;
      registers?: Record<string, string>;
      suspectedRefs?: Array<{ type?: string; value?: string; likelySource?: string }>;
      rawSections: Record<string, string>;
    };

// The old panel's limits.
const FRAMES = 32;
const REGISTERS = 32;
const PLUGINS = 60;
const REFS = 10;
const LINES = 60;
const RAW_FIRST = ["SETTINGS", "MODULES", "F4SE PLUGINS", "SKSE PLUGINS", "STACK"];

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The named fields of `from` that are strings, and no others. */
function strings<K extends string>(from: unknown, keys: readonly K[]): { [P in K]?: string } {
  const out: { [P in K]?: string } = {};
  const fields = record(from);
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * The Crash log page's data for a parsed crash log (or one that couldn't be parsed). Copies only
 * the fields the page draws, cut to the old panel's limits, and never throws on a missing or
 * mistyped field. A theme that isn't one of the four is Skyrim.
 */
export function crashView(parsed: CrashInput, theme?: string): CrashView {
  const skin: ThemeId = (THEME_IDS as readonly string[]).includes(theme ?? "") ? (theme as ThemeId) : "skyrim";
  const input = record(parsed);
  if (input.ok !== true) return { view: "crash", theme: skin, ok: false, reason: str(input.reason) };

  const frames = list(input.callStack);
  const plugins = list(input.loadedPlugins);
  const registers = Object.entries(record(input.registers));
  const rank = (name: string): number => {
    const at = RAW_FIRST.indexOf(name.toUpperCase());
    return at < 0 ? RAW_FIRST.length : at;
  };
  const sections = Object.entries(record(input.rawSections)).sort((a, b) => rank(a[0]) - rank(b[0]));

  return {
    view: "crash",
    theme: skin,
    ok: true,
    detectedType: str(input.detectedType),
    ...strings(input, ["gameVersion", "loggerVersion"] as const),
    exception: strings(input.exception, ["type", "address", "description"] as const),
    callStack: frames.slice(0, FRAMES).map((frame) => {
      const index = record(frame).index;
      return {
        ...(typeof index === "number" && Number.isFinite(index) ? { index } : {}),
        module: str(record(frame).module),
        ...strings(frame, ["function", "offset"] as const),
      };
    }),
    registers: registers.slice(0, REGISTERS).map(([name, value]) => ({ name, value: str(value) })),
    loadedPlugins: plugins.slice(0, PLUGINS).map((plugin) => ({
      name: str(record(plugin).name),
      ...strings(plugin, ["loadIndex"] as const),
    })),
    suspectedRefs: list(input.suspectedRefs)
      .slice(0, REFS)
      .map((ref) => strings(ref, ["type", "value", "likelySource"] as const)),
    rawSections: sections.map(([name, text]) => ({ name, text: str(text).split(/\r?\n/).slice(0, LINES).join("\n") })),
    counts: { frames: frames.length, registers: registers.length, plugins: plugins.length },
  };
}

// The old panel's look, without what the frame already has.
const CSS = String.raw`
.mw-crash-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.mw-crash-type{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--bg);background:var(--accent);border-radius:6px;padding:3px 8px}
.mw-crash-ex{font-family:var(--mono);font-size:18px;color:var(--danger);overflow-wrap:anywhere}
.mw-crash-addr{font-family:var(--mono);font-size:12px;color:var(--sub)}
.mw-crash-ver{font-family:var(--mono);font-size:11px;color:var(--sub)}
.mw-crash-desc{font-size:13px;color:var(--ink);opacity:.85;margin-top:8px;line-height:1.55;overflow-wrap:anywhere}
.mw-suspects{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:14px 0}
.mw-lbl{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--sub)}
.mw-suspect{font-family:var(--mono);font-size:11px;color:var(--accent2);border:1px solid var(--border);
  border-radius:6px;padding:3px 8px;background:var(--panel);overflow-wrap:anywhere}
.mw-crash-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}
.mw-col{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:12px 14px;min-width:0}
.mw-col-h{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--sub);
  display:flex;justify-content:space-between;margin-bottom:8px}
.mw-col-wide{margin-top:14px}
.mw-stack{list-style:none;font-family:var(--mono);font-size:11.5px;line-height:1.9;max-height:280px;overflow:auto}
.mw-stack li{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;border-bottom:1px solid rgba(255,255,255,.03);padding:1px 0}
.mw-frame-i{color:var(--sub);min-width:20px}
.mw-frame-mod{color:var(--ink);min-width:0;overflow-wrap:anywhere}
.mw-frame-fn{color:var(--accent);min-width:0;overflow-wrap:anywhere}
.mw-frame-off{color:var(--sub)}
.mw-plugins{list-style:none;font-family:var(--mono);font-size:11.5px;line-height:1.85;max-height:280px;overflow:auto;color:var(--ink)}
.mw-plugins .mw-frame-i{display:inline-block;margin-right:8px}
.mw-plugins-wide{max-height:200px;columns:2;column-gap:18px}
.mw-plugins-wide li{break-inside:avoid;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* A 64-bit register value is "0x" + 16 hex digits: 18 mono characters, about
   119px at 11px, plus a 34px label and the 7px gap. Tracks narrower than that
   let each cell spill into the next column, so the value of one register ran
   straight into the name of the next. */
.mw-regs{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:4px 12px;max-height:280px;overflow:auto}
.mw-reg{display:flex;gap:7px;font-family:var(--mono);font-size:11px;min-width:0}
.mw-reg-k{color:var(--accent);min-width:34px;flex:none}
.mw-reg-v{color:var(--ink);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mw-raws{margin-top:14px;display:flex;flex-direction:column;gap:8px}
.mw-raw{border:1px solid var(--border);border-radius:9px;background:var(--panel);overflow:hidden}
.mw-raw>summary{cursor:pointer;padding:9px 12px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--sub);list-style:none}
.mw-raw>summary::-webkit-details-marker{display:none}
.mw-raw>summary::before{content:"▸ ";color:var(--accent)}
.mw-raw[open]>summary::before{content:"▾ "}
.mw-pre{margin:0;padding:0 12px 12px;font-family:var(--mono);font-size:11px;line-height:1.6;color:var(--ink);
  opacity:.85;white-space:pre-wrap;max-height:260px;overflow:auto}
.mw-crash-acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:16px}
@media(max-width:640px){.mw-crash-cols{grid-template-columns:1fr}}
`;

const BODY = `
<section id="crash-view" class="mw-sec mw-crash" hidden>
  <div class="mw-crash-head">
    <span id="crash-type" class="mw-crash-type"></span>
    <h2 id="crash-ex" class="mw-crash-ex"></h2>
    <span id="crash-addr" class="mw-crash-addr" hidden></span>
    <span id="crash-ver" class="mw-crash-ver" hidden></span>
  </div>
  <p id="crash-desc" class="mw-crash-desc" hidden></p>
  <div id="crash-suspects" class="mw-suspects" hidden></div>
  <div class="mw-crash-cols">
    <div class="mw-col">
      <div class="mw-col-h">Probable call stack <span id="crash-frames-n" class="mw-count"></span></div>
      <ol id="crash-stack" class="mw-stack"></ol>
    </div>
    <div class="mw-col">
      <div class="mw-col-h">Registers <span id="crash-regs-n" class="mw-count"></span></div>
      <div id="crash-regs" class="mw-regs"></div>
    </div>
  </div>
  <div class="mw-col mw-col-wide">
    <div class="mw-col-h">Plugins <span id="crash-plugins-n" class="mw-count"></span></div>
    <ul id="crash-plugins" class="mw-plugins mw-plugins-wide"></ul>
  </div>
  <div id="crash-raws" class="mw-raws" hidden></div>
  <div class="mw-crash-acts">
    <button type="button" id="crash-ask" class="mw-btn primary" hidden>Ask about this</button>
    <span id="crash-asked" class="mw-note" role="status" aria-live="polite"></span>
  </div>
  <p class="mw-note">ModWrench parses; it never guesses the cause. That's the model's job.</p>
</section>
<div id="crash-empty" hidden></div>
`;

// No template literals, no backticks and no dollar-brace: this text sits inside a
// template literal. Strings with apostrophes use double quotes.
const SCRIPT = String.raw`
(function () {
  'use strict';
  var h = mwSkin.h, el = mwSkin.el, clear = mwSkin.clear, show = mwSkin.show, tidy = mwSkin.tidy;

  // The message goes into the chat as the person's own words, so it is a fixed sentence: nothing from
  // the log (plugin and mod names are other people's text), and the AI already has the parsed crash.
  var ASK = 'Please go through the crash ModWrench just parsed: what the exception, call stack and plugins point at, without guessing beyond what the log shows.';
  // In a block of the log's own lines: the characters that print nothing or turn text around, except
  // the tabs and line breaks the block is laid out with.
  var HIDDEN = /[^\P{Cc}\t\n]|\p{Cf}/gu;

  var drawn = false;

  function list(value) { return Array.isArray(value) ? value : []; }
  function fields(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function finite(n) { return typeof n === 'number' && isFinite(n); }

  // "32", or "first 32 of 40" when the server cut the list.
  function count(id, shown, total) {
    var all = finite(total) && total > shown ? total : shown;
    el(id).textContent = all > shown ? 'first ' + shown + ' of ' + all : String(all);
  }

  function updateAsk() {
    var caps = window.mwApp.capabilities();
    el('crash-ask').hidden = !(caps && caps.message) || !drawn;
  }

  function reset() {
    drawn = false;
    show('crash-view', false);
    show('crash-empty', false);
    el('crash-asked').textContent = '';
    updateAsk();
  }

  function failed(reason) {
    var box = el('mw-problem');
    clear(box);
    box.appendChild(h('p', {}, [h('b', { text: "Couldn't parse that crash log." })]));
    var why = tidy(reason, 600);
    if (why) box.appendChild(h('p', { text: why }));
    show('mw-problem', true);
  }

  function drawHead(data) {
    var ex = fields(data.exception);
    el('crash-type').textContent = tidy(data.detectedType, 40) || 'crashlog';
    el('crash-ex').textContent = tidy(ex.type, 200) || 'Unknown exception';
    var addr = tidy(ex.address, 80);
    el('crash-addr').textContent = addr;
    show('crash-addr', !!addr);
    var ver = [tidy(data.gameVersion, 80), tidy(data.loggerVersion, 80)].filter(Boolean).join(' · ');
    el('crash-ver').textContent = ver;
    show('crash-ver', !!ver);
    var desc = tidy(ex.description, 600);
    el('crash-desc').textContent = desc;
    show('crash-desc', !!desc);

    var refs = list(data.suspectedRefs);
    var box = el('crash-suspects');
    clear(box);
    if (refs.length) box.appendChild(h('span', { class: 'mw-lbl', text: 'Suspected' }));
    refs.forEach(function (item) {
      var ref = fields(item);
      var source = tidy(ref.likelySource, 120);
      box.appendChild(h('span', { class: 'mw-suspect' }, [
        tidy(ref.value, 120) || tidy(ref.type, 120) || 'ref',
        source ? ' ' : null,
        source ? h('em', { text: source }) : null
      ]));
    });
    show('crash-suspects', refs.length > 0);
  }

  function drawStack(data) {
    var frames = list(data.callStack);
    var box = el('crash-stack');
    clear(box);
    frames.forEach(function (item, i) {
      var frame = fields(item);
      var fn = tidy(frame['function'], 200);
      var offset = tidy(frame.offset, 40);
      box.appendChild(h('li', {}, [
        h('span', { class: 'mw-frame-i', text: finite(frame.index) ? String(frame.index) : String(i) }),
        h('span', { class: 'mw-frame-mod', text: tidy(frame.module, 160) || '—' }),
        fn ? h('span', { class: 'mw-frame-fn', text: fn }) : null,
        offset ? h('span', { class: 'mw-frame-off', text: '+' + offset }) : null
      ]));
    });
    if (!frames.length) box.appendChild(h('li', { class: 'mw-muted', text: 'no frames parsed' }));
    count('crash-frames-n', frames.length, fields(data.counts).frames);
  }

  function drawRegisters(data) {
    var regs = list(data.registers);
    var box = el('crash-regs');
    clear(box);
    regs.forEach(function (item) {
      var reg = fields(item);
      var value = tidy(reg.value, 80);
      box.appendChild(h('div', { class: 'mw-reg' }, [
        h('span', { class: 'mw-reg-k', text: tidy(reg.name, 24) }),
        h('span', { class: 'mw-reg-v', text: value, title: value })
      ]));
    });
    if (!regs.length) box.appendChild(h('span', { class: 'mw-muted', text: 'none parsed' }));
    count('crash-regs-n', regs.length, fields(data.counts).registers);
  }

  function drawPlugins(data) {
    var plugins = list(data.loadedPlugins);
    var box = el('crash-plugins');
    clear(box);
    plugins.forEach(function (item) {
      var plugin = fields(item);
      var at = tidy(plugin.loadIndex, 12);
      var name = tidy(plugin.name, 160);
      box.appendChild(h('li', { title: name }, [at ? h('span', { class: 'mw-frame-i', text: at }) : null, name]));
    });
    if (!plugins.length) box.appendChild(h('li', { class: 'mw-muted', text: 'none listed' }));
    count('crash-plugins-n', plugins.length, fields(data.counts).plugins);
  }

  function drawSections(data) {
    var sections = list(data.rawSections);
    var box = el('crash-raws');
    clear(box);
    sections.forEach(function (item) {
      var section = fields(item);
      var text = typeof section.text === 'string' ? section.text.replace(HIDDEN, ' ') : '';
      box.appendChild(h('details', { class: 'mw-raw' }, [
        h('summary', { text: tidy(section.name, 60) || 'section' }),
        h('pre', { class: 'mw-pre', text: text })
      ]));
    });
    show('crash-raws', sections.length > 0);
  }

  function draw(data) {
    reset();
    if (data.ok !== true) {
      failed(data.reason);
      return;
    }
    var ex = fields(data.exception);
    var nothing = !tidy(ex.type, 10) && !list(data.callStack).length && !list(data.registers).length &&
      !list(data.loadedPlugins).length && !list(data.suspectedRefs).length && !list(data.rawSections).length;
    if (nothing) {
      var empty = el('crash-empty');
      clear(empty);
      empty.appendChild(mwSkin.empty('Nothing to show', 'The log had no exception or call stack.'));
      show('crash-empty', true);
      return;
    }
    drawHead(data);
    drawStack(data);
    drawRegisters(data);
    drawPlugins(data);
    drawSections(data);
    show('crash-view', true);
    drawn = true;
    updateAsk();
  }

  el('crash-ask').addEventListener('click', function () {
    if (!drawn) return;
    var note = el('crash-asked');
    window.mwApp.sendMessage(ASK).then(function () {
      note.textContent = 'Sent to the chat.';
      window.mwApp.resized();
    }, function () {
      note.textContent = "Your editor didn't take the message. You can ask in the chat directly.";
      window.mwApp.resized();
    });
  });
  window.mwApp.on('context', updateAsk);

  mwSkin.start({ name: 'crash', view: 'crash', draw: draw, reset: reset });
})();
`;

/** The Crash log page, as the HTML an MCP Apps host loads for `ui://modwrench/crash`. */
export function renderCrashApp(): string {
  return renderApp({
    title: "Crash log",
    css: SKIN_CSS + CSS,
    body: skinFrame("Crash log", BODY),
    script: SKIN_JS + SCRIPT,
  });
}

/** The Crash log page as a server registers it (see registerAppPage). */
export const CRASH_PAGE: AppPageDef = {
  name: "crash_panel",
  uri: CRASH_APP_URI,
  title: "Crash log page",
  description:
    "The page MCP Apps clients draw for a parsed crash log (mw_parse_crashlog, mw_diagnose_crash): the exception, the call stack, the registers, the plugins and the log's other sections. Read-only; it makes no network requests and keeps nothing.",
  render: renderCrashApp,
  clipboard: false,
};
