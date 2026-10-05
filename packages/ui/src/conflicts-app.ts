// ─── The Conflicts page ─────────────────────────────────────────────────────
// The known conflicts between mods, drawn as an MCP Apps page (see app.ts) in the
// four game skins (see skin.ts), for mw_check_known_conflicts.
//
// The page is a pure function of the tool result. It keeps nothing, stores nothing
// and makes no network requests (its own Content-Security-Policy forbids them).
// Everything in a result is someone else's text and goes on the page as text only.
// The mod names and descriptions come from LOOT's masterlist or the bundled
// community list, so the page has no button that would send any of them on.

import { renderApp } from "./app.js";
import type { AppPageDef } from "./serve.js";
import { SKIN_CSS, SKIN_JS, skinFrame } from "./skin.js";
import { THEME_IDS, type ThemeId } from "./themes.js";

/** The page that shows the known conflicts between mods. */
export const CONFLICTS_APP_URI = "ui://modwrench/conflicts";

/** One known conflict, as the page draws it. `source` is where the entry comes from (the attribution). */
export type ConflictRow = {
  modA: string;
  modB: string;
  severity: string;
  description: string;
  source: string;
  workaround?: string;
  patchModId?: string;
};

/** What mw_check_known_conflicts hands the page as structuredContent. */
export type ConflictsView = {
  view: "conflicts";
  theme: ThemeId;
  gameId: string;
  conflicts: ConflictRow[];
  sources: { loot: { available: boolean; reason?: string }; community: { available: boolean; entries: number } };
  warnings: string[];
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The page's data for one answer: only the fields the page draws, the skin checked
 * against the four, and a mistyped field from a masterlist entry made harmless (a
 * string that isn't one becomes "", an optional one is left out). Never throws.
 */
export function conflictsView(input: {
  theme?: string;
  gameId: string;
  conflicts: ConflictRow[];
  sources: ConflictsView["sources"];
  warnings?: string[];
}): ConflictsView {
  const loot = input.sources?.loot;
  const community = input.sources?.community;
  const entries = community?.entries;
  return {
    view: "conflicts",
    theme: THEME_IDS.find((id) => id === input.theme) ?? "skyrim",
    gameId: str(input.gameId),
    conflicts: (Array.isArray(input.conflicts) ? input.conflicts : [])
      .filter((c) => c !== null && typeof c === "object")
      .map((c) => ({
        modA: str(c.modA),
        modB: str(c.modB),
        severity: str(c.severity),
        description: str(c.description),
        source: str(c.source),
        ...(str(c.workaround) ? { workaround: c.workaround } : {}),
        ...(str(c.patchModId) ? { patchModId: c.patchModId } : {}),
      })),
    sources: {
      loot: { available: loot?.available === true, ...(str(loot?.reason) ? { reason: loot?.reason } : {}) },
      community: {
        available: community?.available === true,
        entries: typeof entries === "number" && Number.isFinite(entries) ? entries : 0,
      },
    },
    warnings: (Array.isArray(input.warnings) ? input.warnings : []).filter((w) => typeof w === "string"),
  };
}

// From the old panel's conflicts styles, plus room to wrap at phone width.
const CSS = String.raw`
#cf-out .mw-sec-h{flex-wrap:wrap}
#cf-out .mw-sec-h h2{min-width:0;overflow-wrap:anywhere}
.mw-srcs{display:flex;gap:6px;flex-wrap:wrap}
.mw-src{font-family:var(--mono);font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid var(--border);color:var(--sub)}
.mw-src.ok{color:var(--ok);border-color:var(--ok)}
.mw-src.off{color:var(--sub)}
.mw-cwhy{margin:-4px 0 12px;overflow-wrap:anywhere}
.mw-legend{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.mw-sev{font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;padding:2px 7px;border-radius:5px;
  border:1px solid var(--border);color:var(--sub);white-space:nowrap;text-transform:uppercase}
.mw-sev.loser{color:var(--danger);border-color:var(--danger)}
.mw-sev.order{color:var(--warn);border-color:var(--warn)}
.mw-sev.patch{color:var(--accent2);border-color:var(--accent2)}
.mw-sev.info{color:var(--sub);border-color:var(--border)}
.mw-crow{display:flex;align-items:flex-start;gap:11px;padding:11px 12px;border-bottom:1px solid var(--border)}
.mw-crow:last-child{border-bottom:0}
.mw-crow:nth-child(odd){background:rgba(255,255,255,.015)}
.mw-cmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;overflow-wrap:anywhere}
.mw-cpair{font-family:var(--font-head);font-size:13px;color:var(--ink)}
.mw-vs{color:var(--danger);margin:0 3px}
.mw-cdesc{font-size:12px;color:var(--ink);opacity:.8;line-height:1.5}
.mw-cwork{font-size:11.5px;color:var(--accent2)}
.mw-csrc{font-family:var(--mono);font-size:9.5px;color:var(--sub);white-space:nowrap;padding-top:2px}
.mw-clean{display:flex;align-items:center;gap:10px;padding:24px 16px;color:var(--ok);
  font-family:var(--mono);font-size:13px;border:1px solid var(--ok);border-radius:var(--r);background:var(--panel)}
.mw-clean-mark{font-size:18px}
.mw-warnrow{font-family:var(--mono);font-size:11px;color:var(--warn);padding:8px 2px;overflow-wrap:anywhere}
@media (max-width:480px){.mw-crow{flex-wrap:wrap}.mw-cmain{flex-basis:100%;order:2}}
`;

const BODY = `<section id="cf-out" class="mw-sec" aria-label="Known conflicts" hidden></section>`;

// No template literals, no backticks and no dollar-brace: this text sits inside a
// template literal. Strings with apostrophes use double quotes.
const SCRIPT = String.raw`
(function () {
  'use strict';
  var h = mwSkin.h;
  var tidy = mwSkin.tidy;

  // The four severities, coloured as LOOT and xEdit colour them. Anything else,
  // names every object has included, is drawn as INFO.
  var SEVERITY = {
    incompatible: { cls: 'mw-sev loser', label: 'INCOMPATIBLE', legend: 'incompatible' },
    'load-order-sensitive': { cls: 'mw-sev order', label: 'LOAD ORDER', legend: 'load order' },
    'patch-available': { cls: 'mw-sev patch', label: 'PATCH AVAIL', legend: 'patch' },
    informational: { cls: 'mw-sev info', label: 'INFO', legend: 'info' }
  };

  function obj(value) { return value && typeof value === 'object' ? value : {}; }

  function legend() {
    return h('div', { class: 'mw-legend', role: 'note', 'aria-label': 'Severity' }, Object.keys(SEVERITY).map(function (key) {
      return h('span', { class: SEVERITY[key].cls, text: SEVERITY[key].legend });
    }));
  }

  // One conflict. The id of a patch is shown as text: a message sent as the
  // person's own words never carries text from the masterlist.
  function row(c) {
    var sev = SEVERITY[mwSkin.pick(SEVERITY, c.severity, 'informational')];
    var main = [
      h('span', { class: 'mw-cpair' }, [
        h('strong', { text: tidy(c.modA, 160) || '(no name)' }),
        ' ',
        h('span', { class: 'mw-vs', title: 'conflicts with', text: '⚔' }),
        ' ',
        h('strong', { text: tidy(c.modB, 160) || '(no name)' })
      ]),
      h('span', { class: 'mw-cdesc', text: tidy(c.description, 600) })
    ];
    var workaround = tidy(c.workaround, 400);
    if (workaround) main.push(h('span', { class: 'mw-cwork', text: '↳ ' + workaround }));
    var patch = tidy(c.patchModId, 160);
    if (patch) main.push(h('span', { class: 'mw-lmeta', text: 'Patch: ' + patch }));
    return h('li', { class: 'mw-crow' }, [
      h('span', { class: sev.cls, text: sev.label }),
      h('span', { class: 'mw-cmain' }, main),
      h('span', { class: 'mw-csrc', title: 'Where this entry comes from', text: tidy(c.source, 60) })
    ]);
  }

  function draw(data) {
    var out = mwSkin.el('cf-out');
    mwSkin.clear(out);
    var rows = (Array.isArray(data.conflicts) ? data.conflicts : []).filter(function (c) { return c && typeof c === 'object'; });
    var sources = obj(data.sources);
    var loot = obj(sources.loot);
    var community = obj(sources.community);
    var lootOn = loot.available === true;
    var game = tidy(data.gameId, 80);

    out.appendChild(h('div', { class: 'mw-sec-h' }, [
      h('h2', {}, [
        game ? 'Conflicts · ' + game : 'Conflicts',
        rows.length ? ' ' : null,
        rows.length ? h('span', { class: 'mw-count', text: String(rows.length) }) : null
      ]),
      h('span', { class: 'mw-sec-sub mw-srcs' }, [
        h('span', { class: lootOn ? 'mw-src ok' : 'mw-src off', text: lootOn ? 'LOOT live' : 'LOOT off' }),
        h('span', { class: community.available === true ? 'mw-src ok' : 'mw-src off', text: 'community ' + mwSkin.compact(community.entries) })
      ])
    ]));
    var reason = lootOn ? '' : tidy(loot.reason, 400);
    if (reason) out.appendChild(h('p', { class: 'mw-note mw-cwhy', text: reason }));
    out.appendChild(legend());

    if (rows.length) {
      out.appendChild(h('ul', { class: 'mw-list', 'aria-label': 'Conflicts' }, rows.map(row)));
    } else {
      out.appendChild(h('p', { class: 'mw-clean' }, [
        h('span', { class: 'mw-clean-mark', 'aria-hidden': 'true', text: '✔' }),
        "No known conflicts flagged. Not a promise it'll run, just that nothing's on the list."
      ]));
    }

    // A failed masterlist fetch puts the same sentence in LOOT's reason and in the
    // warnings; it is shown once.
    (Array.isArray(data.warnings) ? data.warnings : []).forEach(function (w) {
      var line = tidy(w, 400);
      if (line && line !== reason) out.appendChild(h('p', { class: 'mw-warnrow', role: 'note', text: line }));
    });
    mwSkin.show('cf-out', true);
  }

  mwSkin.start({ name: 'conflicts', view: 'conflicts', draw: draw, reset: function () { mwSkin.show('cf-out', false); } });
})();
`;

/** The Conflicts page, as the HTML an MCP Apps host loads for `ui://modwrench/conflicts`. */
export function renderConflictsApp(): string {
  return renderApp({
    title: "Conflicts",
    css: SKIN_CSS + CSS,
    body: skinFrame("Conflicts", BODY),
    script: SKIN_JS + SCRIPT,
  });
}

/** The Conflicts page as a server registers it (see registerAppPage). */
export const CONFLICTS_PAGE: AppPageDef = {
  name: "conflicts_panel",
  uri: CONFLICTS_APP_URI,
  title: "Conflicts page",
  description:
    "The page MCP Apps clients draw for mw_check_known_conflicts: each known conflict with its severity, the two mods, the workaround and where the entry comes from. Read-only; it makes no network requests and keeps nothing.",
  render: renderConflictsApp,
  clipboard: false,
};
