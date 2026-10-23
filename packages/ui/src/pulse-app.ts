// ─── The Pulse page ──────────────────────────────────────────────────────────
// What has changed for the mods in an r2modman profile, drawn as an MCP Apps page
// (see app.ts) in the four game skins (see skin.ts), for mw_pulse.
//
// The page is a pure function of the tool result. It keeps nothing, stores nothing
// and makes no network requests (its own Content-Security-Policy forbids them): the
// requests to Thunderstore are the server's, made only when mw_pulse is called with
// confirm=true. Before a check the page says exactly what one would send, and its
// Check now button makes that call: pressing it is the person's own yes. Mod names,
// authors and versions come from the profile and from Thunderstore, so they go on the
// page as text only.

import { renderApp } from "./app.js";
import type { AppPageDef } from "./serve.js";
import { SKIN_CSS, SKIN_JS, skinFrame } from "./skin.js";
import { THEME_IDS, type ThemeId } from "./themes.js";

/** The page that shows what has changed for the mods in a profile. */
export const PULSE_APP_URI = "ui://modwrench/pulse";

const STATES = ["update", "current", "ahead", "cant-compare", "gone", "failed"] as const;
export type PulseRowState = (typeof STATES)[number];

/** One mod, as the page draws it. */
export type PulseRow = {
  name: string;
  fullName: string;
  author?: string;
  installed?: string;
  latest?: string;
  state: PulseRowState;
  deprecated: boolean;
  pageUrl?: string;
};

/** What mw_pulse hands the page as structuredContent. */
export type PulseView = {
  view: "pulse";
  theme: ThemeId;
  game: string;
  profile: string;
  host: string;
  /** False before a check: nothing has been sent, and `requests` says what a check would send. */
  confirmed: boolean;
  requests: number;
  mods: PulseRow[];
  notChecked: string[];
  /** What the page's button passes back to mw_pulse, with confirm=true. */
  args: { gameId: string; profileName?: string };
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The page's data for one answer: only the fields the page draws, each checked. Never throws. */
export function pulseView(input: {
  theme?: string;
  game: string;
  profile: string;
  host: string;
  confirmed: boolean;
  requests?: number;
  mods?: unknown[];
  notChecked?: unknown[];
  args: { gameId: string; profileName?: string };
}): PulseView {
  const requests = input.requests;
  return {
    view: "pulse",
    theme: THEME_IDS.find((id) => id === input.theme) ?? "lethal",
    game: str(input.game),
    profile: str(input.profile),
    host: str(input.host),
    confirmed: input.confirmed === true,
    requests: typeof requests === "number" && Number.isFinite(requests) && requests >= 0 ? Math.floor(requests) : 0,
    mods: (Array.isArray(input.mods) ? input.mods : [])
      .filter((m): m is Record<string, unknown> => m !== null && typeof m === "object")
      .map((m) => ({
        name: str(m.name),
        fullName: str(m.fullName),
        ...(str(m.author) ? { author: str(m.author) } : {}),
        ...(str(m.installed) ? { installed: str(m.installed) } : {}),
        ...(str(m.latest) ? { latest: str(m.latest) } : {}),
        state: STATES.find((s) => s === m.state) ?? "failed",
        deprecated: m.deprecated === true,
        ...(str(m.pageUrl) ? { pageUrl: str(m.pageUrl) } : {}),
      })),
    notChecked: (Array.isArray(input.notChecked) ? input.notChecked : []).filter((n): n is string => typeof n === "string"),
    args: {
      gameId: str(input.args?.gameId),
      ...(str(input.args?.profileName) ? { profileName: str(input.args?.profileName) } : {}),
    },
  };
}

const CSS = String.raw`
#pulse-out .mw-sec-h{flex-wrap:wrap}
#pulse-out .mw-sec-h h2{min-width:0;overflow-wrap:anywhere}
.mw-pchips{display:flex;gap:6px;flex-wrap:wrap}
.mw-pchip{font-family:var(--mono);font-size:10px;padding:2px 7px;border-radius:5px;border:1px solid var(--border);color:var(--sub)}
.mw-pchip.up{color:var(--accent2);border-color:var(--accent2)}
.mw-pchip.dep{color:var(--warn);border-color:var(--warn)}
.mw-pchip.gone{color:var(--danger);border-color:var(--danger)}
.mw-pplan{margin:4px 0 12px;overflow-wrap:anywhere;line-height:1.5}
.mw-prow{display:flex;align-items:flex-start;gap:11px;padding:10px 12px;border-bottom:1px solid var(--border)}
.mw-prow:last-child{border-bottom:0}
.mw-pmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;overflow-wrap:anywhere}
.mw-pname{font-family:var(--font-head);font-size:13px;color:var(--ink)}
.mw-pver{font-family:var(--mono);font-size:11px;color:var(--sub)}
.mw-ptag{font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;padding:2px 7px;border-radius:5px;
  border:1px solid var(--border);color:var(--sub);white-space:nowrap;text-transform:uppercase}
.mw-ptag.update{color:var(--accent2);border-color:var(--accent2)}
.mw-ptag.dep{color:var(--warn);border-color:var(--warn)}
.mw-ptag.gone,.mw-ptag.failed{color:var(--danger);border-color:var(--danger)}
.mw-pact{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}
.mw-pskip{font-family:var(--mono);font-size:11px;color:var(--sub);padding:6px 2px;overflow-wrap:anywhere}
@media (max-width:480px){.mw-prow{flex-wrap:wrap}.mw-pmain{flex-basis:100%;order:2}}
`;

const BODY = `<section id="pulse-out" class="mw-sec" aria-label="Pulse" hidden></section>`;

// No template literals, no backticks and no dollar-brace: this text sits inside a
// template literal. Strings with apostrophes use double quotes.
const SCRIPT = String.raw`
(function () {
  'use strict';
  var h = mwSkin.h;
  var tidy = mwSkin.tidy;
  var TOOL = 'mw_pulse';
  var CAP = 25;

  // Open is offered only for an https page on thunderstore.io or a name under it, no port but the
  // default, printable ASCII with no space or backslash, 2,048 characters at most.
  var OPENABLE = /^https:\/\/(?:[a-z0-9-]+\.)*thunderstore\.io(?::443)?(?:\/[\x21-\x5b\x5d-\x7e]*)?$/i;
  function openable(url) { return typeof url === 'string' && url.length <= 2048 && OPENABLE.test(url); }

  // The order the page lists mods in, and the tag each one wears.
  var ORDER = ['update', 'gone', 'ahead', 'cant-compare', 'failed', 'current'];
  var TAG = {
    update: { cls: 'mw-ptag update', text: 'UPDATE' },
    gone: { cls: 'mw-ptag gone', text: 'GONE' },
    ahead: { cls: 'mw-ptag', text: 'NEWER' },
    'cant-compare': { cls: 'mw-ptag', text: '?' },
    failed: { cls: 'mw-ptag failed', text: 'NOT CHECKED' },
    current: { cls: 'mw-ptag', text: 'UP TO DATE' }
  };

  var state = { args: null, busy: false };

  function obj(value) { return value && typeof value === 'object' ? value : {}; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function versions(m) {
    var have = tidy(m.installed, 40) || '?';
    var latest = tidy(m.latest, 40);
    if (m.state === 'update') return have + ' → ' + latest;
    if (m.state === 'gone') return 'you have ' + have + '; Thunderstore no longer has it';
    if (m.state === 'failed') return 'you have ' + have + '; Thunderstore didn’t answer';
    if (m.state === 'ahead') return 'you have ' + have + ', newer than ' + latest;
    if (m.state === 'cant-compare') return 'you have ' + have + ', latest ' + (latest || '?');
    return have;
  }

  function row(m, canOpen) {
    var name = tidy(m.name, 160) || tidy(m.fullName, 160) || '(no name)';
    var author = tidy(m.author, 80);
    var tag = TAG[mwSkin.pick(TAG, m.state, 'failed')];
    var main = h('span', { class: 'mw-pmain' }, [
      h('span', { class: 'mw-pname' }, [h('strong', { text: name }), author ? ' by ' + author : null]),
      h('span', { class: 'mw-pver', text: versions(m) })
    ]);
    var tags = h('span', { class: 'mw-pchips' }, [
      h('span', { class: tag.cls, text: tag.text }),
      m.deprecated === true ? h('span', { class: 'mw-ptag dep', text: 'DEPRECATED' }) : null
    ]);
    var kids = [tags, main];
    if (canOpen && openable(m.pageUrl)) {
      var url = m.pageUrl;
      var button = h('button', { type: 'button', class: 'mw-btn', 'aria-label': 'Open the page of ' + name, text: 'Open ›' });
      button.addEventListener('click', function () {
        window.mwApp.openLink(url).then(function () {}, function () {
          main.appendChild(h('span', { class: 'mw-note', role: 'status', text: "Your editor didn't open the link." }));
          window.mwApp.resized();
        });
      });
      kids.push(button);
    }
    return h('li', { class: 'mw-prow' }, kids);
  }

  function runButton(label, out) {
    var button = h('button', { type: 'button', id: 'pulse-run', class: 'mw-btn', text: label });
    button.addEventListener('click', function () {
      if (state.busy || !state.args) return;
      state.busy = true;
      button.disabled = true;
      button.textContent = 'Checking…';
      var args = { gameId: state.args.gameId, confirm: true };
      if (state.args.profileName) args.profileName = state.args.profileName;
      window.mwApp.callTool(TOOL, args).then(function (result) {
        state.busy = false;
        var data = result && result.structuredContent;
        if (data && typeof data === 'object' && data.view === 'pulse') return draw(data);
        button.disabled = false;
        button.textContent = label;
        var text = '';
        (result && Array.isArray(result.content) ? result.content : []).some(function (c) { if (c && typeof c.text === 'string') { text = c.text; return true; } return false; });
        out.appendChild(h('p', { class: 'mw-note', role: 'status', text: tidy(text, 600) || 'The check returned nothing this page can show.' }));
        window.mwApp.resized();
      }, function () {
        state.busy = false;
        button.disabled = false;
        button.textContent = label;
        out.appendChild(h('p', { class: 'mw-note', role: 'status', text: "Your editor didn't run the check from this page. Ask in the chat instead: are my mods up to date?" }));
        window.mwApp.resized();
      });
    });
    return button;
  }

  function draw(data) {
    var out = mwSkin.el('pulse-out');
    mwSkin.clear(out);
    var args = obj(data.args);
    state.args = typeof args.gameId === 'string' && args.gameId ? { gameId: args.gameId, profileName: typeof args.profileName === 'string' ? args.profileName : '' } : null;
    var game = tidy(data.game, 80);
    var host = tidy(data.host, 120) || 'Thunderstore';
    var mods = (Array.isArray(data.mods) ? data.mods : []).filter(function (m) { return m && typeof m === 'object'; });
    var count = function (s) { return mods.filter(function (m) { return m.state === s; }).length; };
    var deprecated = mods.filter(function (m) { return m.deprecated === true; }).length;

    out.appendChild(h('div', { class: 'mw-sec-h' }, [
      h('h2', { text: game ? 'Pulse · ' + game : 'Pulse' }),
      data.confirmed === true ? h('span', { class: 'mw-sec-sub mw-pchips' }, [
        h('span', { class: 'mw-pchip up', text: plural(count('update'), 'update', 'updates') }),
        deprecated ? h('span', { class: 'mw-pchip dep', text: deprecated + ' deprecated' }) : null,
        count('gone') ? h('span', { class: 'mw-pchip gone', text: count('gone') + ' gone' }) : null
      ]) : null
    ]));

    if (data.confirmed !== true) {
      var requests = typeof data.requests === 'number' && isFinite(data.requests) ? Math.max(0, Math.floor(data.requests)) : 0;
      out.appendChild(h('p', { class: 'mw-pplan', text: requests === 0
        ? 'Nothing has been sent. There are no switched-on Thunderstore mods in this profile to check.'
        : 'Nothing has been sent yet. Checking sends ' + plural(requests, 'request', 'requests') + ' to ' + host + ', one per switched-on mod, each carrying only that mod’s Thunderstore name.' }));
      if (requests > 0 && state.args) out.appendChild(h('div', { class: 'mw-pact' }, [runButton('Check now', out)]));
    } else {
      var canOpen = !!window.mwApp.capabilities().openLinks;
      var sorted = [];
      ORDER.forEach(function (s) { mods.forEach(function (m) { if (m.state === s) sorted.push(m); }); });
      var shown = sorted.slice(0, 200);
      if (shown.length) out.appendChild(h('ul', { class: 'mw-list', 'aria-label': 'Mods' }, shown.map(function (m) { return row(m, canOpen); })));
      else out.appendChild(h('p', { class: 'mw-pplan', text: 'No mods were checked.' }));
      out.appendChild(h('p', { class: 'mw-note', text: 'Checked against ' + host + '. Pulse doesn’t download, install or change anything, and it can’t tell whether an update suits your game version or your other mods.' }));
      if (state.args) out.appendChild(h('div', { class: 'mw-pact' }, [runButton('Check again', out)]));
    }

    var skipped = (Array.isArray(data.notChecked) ? data.notChecked : []).filter(function (n) { return typeof n === 'string'; });
    if (skipped.length) {
      out.appendChild(h('p', { class: 'mw-pskip', text: 'Not checked (' + skipped.length + '):' }));
      skipped.slice(0, CAP).forEach(function (n) { out.appendChild(h('p', { class: 'mw-pskip', text: '· ' + tidy(n, 200) })); });
      if (skipped.length > CAP) out.appendChild(h('p', { class: 'mw-pskip', text: '…and ' + (skipped.length - CAP) + ' more' }));
    }
    mwSkin.show('pulse-out', true);
    window.mwApp.resized();
  }

  mwSkin.start({ name: 'pulse', view: 'pulse', draw: draw, reset: function () { mwSkin.show('pulse-out', false); } });
})();
`;

/** The Pulse page, as the HTML an MCP Apps host loads for `ui://modwrench/pulse`. */
export function renderPulseApp(): string {
  return renderApp({
    title: "Pulse",
    css: SKIN_CSS + CSS,
    body: skinFrame("Pulse", BODY),
    script: SKIN_JS + SCRIPT,
  });
}

/** The Pulse page as a server registers it (see registerAppPage). */
export const PULSE_PAGE: AppPageDef = {
  name: "pulse_panel",
  uri: PULSE_APP_URI,
  title: "Pulse page",
  description:
    "The page MCP Apps clients draw for mw_pulse: which mods in an r2modman profile have updates, which are deprecated and which Thunderstore no longer has, or, before a check, what one would send. Read-only; it makes no network requests and keeps nothing.",
  render: renderPulseApp,
  clipboard: false,
};
