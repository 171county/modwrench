// ─── The Dependencies and load order page ───────────────────────────────────
// A mod's dependencies, or a load order, drawn as an MCP Apps page (see app.ts) in
// the four game skins (see skin.ts), for thunderstore_mod_dependencies,
// thunderstore_resolve_dependencies and mw_read_load_order.
//
// The page is a pure function of the tool result. It keeps nothing, stores nothing
// and makes no network requests (its own Content-Security-Policy forbids them).
// Everything in a result is someone else's text and goes on the page as text only.
// It says so when a list is cut short, incomplete or unsure, rather than showing a
// partial list or a guess as the whole story.

import { renderApp } from "./app.js";
import type { AppPageDef } from "./serve.js";
import { SKIN_CSS, SKIN_JS, skinFrame } from "./skin.js";
import { THEME_IDS, type ThemeId } from "./themes.js";

/** The page that shows a mod's dependencies, or a load order. */
export const DEPS_APP_URI = "ui://modwrench/deps";

/** One entry of a load order, as the page is sent it. */
export type LoadOrderRow = {
  name: string;
  /** null when the manager can't say (Vortex). */
  enabled: boolean | null;
  index?: number;
  version?: string;
  source?: string;
  pluginFile?: string;
  author?: string;
};

/** What the page draws: a mod's dependencies, or a load order that was read or wasn't. */
export type DepsView =
  | { view: "deps"; kind: "deps"; theme: ThemeId; root: string; deps: string[]; unresolved?: number; truncated?: boolean }
  | {
      view: "deps";
      kind: "order";
      theme: ThemeId;
      ok: true;
      manager: string;
      profile: string;
      enabledCount: number;
      totalCount: number;
      loadOrder: LoadOrderRow[];
      warning?: string;
      /** "folders": the profile lists no plugins, so the rows are its mod folders (Mod Organizer 2). */
      rows?: "folders";
      /** No entry's enable state is known (Vortex), so the count of enabled entries means nothing. */
      enabledUnknown?: true;
    }
  | { view: "deps"; kind: "order"; theme: ThemeId; ok: false; reason: string };

/** The most load-order entries the page is sent; the counts stay the full ones. */
export const ORDER_ROWS = 200;

const themeOf = (theme: unknown): ThemeId => (THEME_IDS.includes(theme as ThemeId) ? (theme as ThemeId) : "skyrim");
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** A mod's dependencies for the page, install-first. Anything mistyped is dropped or emptied, never thrown on. */
export function depsView(input: { theme?: string; root: string; deps: string[]; unresolved?: number; truncated?: boolean }): DepsView {
  return {
    view: "deps",
    kind: "deps",
    theme: themeOf(input.theme),
    root: str(input.root),
    deps: Array.isArray(input.deps) ? input.deps.map(str) : [],
    ...(finite(input.unresolved) ? { unresolved: input.unresolved } : {}),
    ...(typeof input.truncated === "boolean" ? { truncated: input.truncated } : {}),
  };
}

function orderRow(row: LoadOrderRow): LoadOrderRow {
  const m: Partial<Record<keyof LoadOrderRow, unknown>> = row && typeof row === "object" ? row : {};
  const version = text(m.version);
  const source = text(m.source);
  const pluginFile = text(m.pluginFile);
  const author = text(m.author);
  return {
    name: str(m.name),
    enabled: m.enabled === true || m.enabled === false ? m.enabled : null,
    ...(finite(m.index) ? { index: m.index } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(pluginFile !== undefined ? { pluginFile } : {}),
    ...(author !== undefined ? { author } : {}),
  };
}

/**
 * A load order for the page, or why it couldn't be read. Sends the first ORDER_ROWS
 * entries with the full counts, and only the fields above (no folder paths).
 *
 * `folders`: a Mod Organizer 2 profile's mod folders. They are drawn when the profile
 * lists no plugins, the case where the manager's own counts are counts of folders, so
 * the page never shows "nothing in this load order" under a count of enabled mods.
 */
export function orderView(
  input: { theme?: string } & (
    | {
        ok: true;
        manager: string;
        profile: string;
        enabledCount: number;
        totalCount: number;
        loadOrder: LoadOrderRow[];
        warning?: string;
        folders?: LoadOrderRow[];
      }
    | { ok: false; reason: string }
  )
): DepsView {
  const theme = themeOf(input.theme);
  if (!input.ok) return { view: "deps", kind: "order", theme, ok: false, reason: str(input.reason) };
  const plugins = Array.isArray(input.loadOrder) ? input.loadOrder : [];
  const folders = Array.isArray(input.folders) ? input.folders : [];
  const asFolders = plugins.length === 0 && folders.length > 0;
  const all = asFolders ? folders : plugins;
  const warning = text(input.warning);
  const rows = all.slice(0, ORDER_ROWS).map(orderRow);
  // Vortex can't say which mods are on: every state is unknown and its count of enabled
  // mods is 0. Saying "0/N enabled" over a list of question marks would be wrong.
  const enabledUnknown = all.length > 0 && all.every((m) => m?.enabled !== true && m?.enabled !== false);
  return {
    view: "deps",
    kind: "order",
    theme,
    ok: true,
    manager: str(input.manager),
    profile: str(input.profile),
    enabledCount: finite(input.enabledCount) ? input.enabledCount : all.filter((m) => m?.enabled === true).length,
    totalCount: finite(input.totalCount) ? input.totalCount : all.length,
    loadOrder: rows,
    ...(warning !== undefined ? { warning } : {}),
    ...(asFolders ? { rows: "folders" as const } : {}),
    ...(enabledUnknown ? { enabledUnknown: true as const } : {}),
  };
}

// From the old panel's tree, less the drag handle (nothing here can be dragged).
const CSS = String.raw`
.mw-deps .mw-sec-h{flex-wrap:wrap}
.mw-deps h2{min-width:0;overflow-wrap:anywhere}
.mw-tree{font-family:var(--mono);color:var(--sub);opacity:.6;letter-spacing:-1px}
.mw-dep{padding-left:22px}
.mw-deproot .mw-lname,.mw-deproot{font-family:var(--font-head)}
.mw-deproot .mw-prio{color:var(--accent)}
.mw-deps-note{margin:10px 2px 0}
.mw-deps-warn{color:var(--warn);margin:0 2px 12px}
`;

const BODY = `<section id="deps-out" class="mw-sec mw-deps" hidden></section>`;

// No template literals, no backticks and no dollar-brace: this text sits inside a
// template literal. Strings with apostrophes use double quotes.
const SCRIPT = String.raw`
(function () {
  'use strict';
  var h = mwSkin.h;
  var tidy = mwSkin.tidy;

  // How each enable state looks. Vortex can't say, so its entries are neither on nor off.
  var DOT = { on: 'mw-dot on', off: 'mw-dot off', unknown: 'mw-dot' };
  var FLAG = { on: 'mw-flag ok', off: 'mw-flag', unknown: 'mw-flag' };
  var WORD = { on: 'ON', off: 'OFF', unknown: '?' };

  function finite(n) { return typeof n === 'number' && isFinite(n); }
  function nameOf(value) { return tidy(value, 200) || '(no name)'; }

  function head(title, count, sub) {
    var h2 = h('h2', { text: title });
    if (count !== null) {
      h2.appendChild(document.createTextNode(' '));
      h2.appendChild(h('span', { class: 'mw-count', text: String(count) }));
    }
    return h('div', { class: 'mw-sec-h' }, [h2, sub ? h('span', { class: 'mw-sec-sub', text: sub }) : null]);
  }

  function note(text, warn) {
    return h('p', { class: warn ? 'mw-note mw-deps-warn' : 'mw-note mw-deps-note', text: text });
  }

  function drawDeps(out, data) {
    var root = tidy(data.root, 120);
    var deps = Array.isArray(data.deps) ? data.deps : [];
    var unresolved = finite(data.unresolved) && data.unresolved > 0 ? data.unresolved : 0;
    var truncated = data.truncated === true;
    out.appendChild(head('Dependencies' + (root ? ' · ' + root : ''), deps.length, deps.length ? 'Thunderstore · install these first' : 'Thunderstore'));
    if (deps.length) {
      if (root) {
        out.appendChild(h('div', { class: 'mw-lrow mw-deproot' }, [
          h('span', { class: 'mw-prio', text: '▸', 'aria-hidden': 'true' }),
          h('span', { class: 'mw-dot on', 'aria-hidden': 'true' }),
          h('span', { class: 'mw-lmain' }, [h('span', { class: 'mw-lname', text: nameOf(data.root) })])
        ]));
      }
      var list = h('ul', { class: 'mw-list', 'aria-label': 'Dependencies' });
      deps.forEach(function (dep) {
        list.appendChild(h('li', { class: 'mw-lrow mw-dep' }, [
          h('span', { class: 'mw-tree', text: '└─', 'aria-hidden': 'true' }),
          h('span', { class: 'mw-dot on', 'aria-hidden': 'true' }),
          h('span', { class: 'mw-lmain' }, [h('span', { class: 'mw-lname', text: nameOf(dep) })])
        ]));
      });
      out.appendChild(list);
    } else if (unresolved || truncated) {
      out.appendChild(mwSkin.empty('No dependencies to show', 'None came back for ' + (root || 'this mod') + '.'));
    } else {
      out.appendChild(mwSkin.empty('No dependencies', (root || 'This mod') + ' lists no dependencies.'));
    }
    if (unresolved === 1) out.appendChild(note("One reference couldn't be resolved; the chat answer names it."));
    else if (unresolved) out.appendChild(note(unresolved + " references couldn't be resolved; the chat answer lists them."));
    if (truncated) out.appendChild(note('The walk stopped at its depth or size limit, so this list may be incomplete.'));
  }

  function drawOrder(out, data) {
    if (data.ok !== true) {
      var reason = tidy(data.reason, 600);
      out.appendChild(h('div', { class: 'mw-problem', role: 'alert' }, [
        h('p', {}, [h('b', { text: "Couldn't read the load order." })]),
        reason ? h('p', { text: reason }) : null
      ]));
      return;
    }
    var rows = Array.isArray(data.loadOrder) ? data.loadOrder : [];
    var total = finite(data.totalCount) ? data.totalCount : rows.length;
    var enabled = finite(data.enabledCount) ? data.enabledCount : 0;
    var folders = data.rows === 'folders';
    var title = [folders ? 'Mod folders' : 'Load order', tidy(data.manager, 40), tidy(data.profile, 80)].filter(Boolean).join(' · ');
    var count = data.enabledUnknown === true
      ? total + (total === 1 ? ' entry' : ' entries') + ', enabled state not known'
      : enabled + '/' + total + ' enabled';
    out.appendChild(head(title, null, count));
    var warning = tidy(data.warning, 600);
    if (warning) out.appendChild(note(warning, true));
    if (folders) out.appendChild(note("This profile lists no plugins, so these are its mod folders."));
    if (!rows.length) {
      out.appendChild(mwSkin.empty('Nothing in this load order', 'The load order is empty.'));
      return;
    }
    var list = h('ul', { class: 'mw-list', 'aria-label': folders ? 'Mod folders' : 'Load order' });
    rows.forEach(function (row, i) {
      var m = row && typeof row === 'object' ? row : {};
      var state = m.enabled === true ? 'on' : m.enabled === false ? 'off' : 'unknown';
      var author = tidy(m.author, 80);
      var version = tidy(m.version, 40);
      var meta = [tidy(m.pluginFile, 120) || tidy(m.source, 40), author ? 'by ' + author : '', version ? 'v' + version : ''].filter(Boolean).join(' · ');
      list.appendChild(h('li', { class: 'mw-lrow' }, [
        h('span', { class: 'mw-prio', text: String(finite(m.index) ? m.index : i).padStart(2, '0') }),
        h('span', { class: DOT[state], 'aria-hidden': 'true' }),
        h('span', { class: 'mw-lmain' }, [
          h('span', { class: 'mw-lname', text: nameOf(m.name) }),
          meta ? h('span', { class: 'mw-lmeta', text: meta }) : null
        ]),
        h('span', { class: FLAG[state], text: WORD[state], title: state === 'unknown' ? 'not known' : null })
      ]));
    });
    out.appendChild(list);
    if (total > rows.length) out.appendChild(note('Showing the first ' + rows.length + ' of ' + total + '; the full list is in the chat answer.'));
  }

  function draw(data) {
    var out = mwSkin.el('deps-out');
    mwSkin.clear(out);
    if (data.kind === 'order') drawOrder(out, data);
    else if (data.kind === 'deps') drawDeps(out, data);
    else out.appendChild(mwSkin.empty('Nothing to show', 'Nothing came back that this page can show.'));
    mwSkin.show('deps-out', true);
  }

  mwSkin.start({ name: 'deps', view: 'deps', draw: draw, reset: function () { mwSkin.show('deps-out', false); } });
})();
`;

/** The Dependencies and load order page, as the HTML an MCP Apps host loads for `ui://modwrench/deps`. */
export function renderDepsApp(): string {
  return renderApp({
    title: "Dependencies",
    css: SKIN_CSS + CSS,
    body: skinFrame("Dependencies", BODY),
    script: SKIN_JS + SCRIPT,
  });
}

/** The Dependencies and load order page as a server registers it (see registerAppPage). */
export const DEPS_PAGE: AppPageDef = {
  name: "deps_panel",
  uri: DEPS_APP_URI,
  title: "Dependencies and load order page",
  description:
    "The page MCP Apps clients draw for a Thunderstore mod's dependencies (thunderstore_mod_dependencies, thunderstore_resolve_dependencies) and for the load order mw_read_load_order reads: each entry with its place, whether it is enabled and where it comes from. Read-only; it makes no network requests and keeps nothing.",
  render: renderDepsApp,
  clipboard: false,
};
