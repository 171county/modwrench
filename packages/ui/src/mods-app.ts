// ─── The Mods page ──────────────────────────────────────────────────────────
// A list of mods from Nexus Mods, mod.io or Thunderstore, drawn as an MCP Apps page
// (see app.ts) in the four game skins (see skin.ts), for thunderstore_list_mods,
// thunderstore_search_mods, thunderstore_top_mods, nexus_trending, modio_list_mods,
// modio_search_mods and mw_query_mod_metadata.
//
// The page is a pure function of the tool result. It keeps nothing, stores nothing
// and makes no network requests (its own Content-Security-Policy forbids them).
// Everything in a result is someone else's text and goes on the page as text only.
//
// Every row keeps its attribution: the author, the platform and the mod's page
// address, shown as text. The one control, Open, asks the editor to open that
// address, and only for an https address on the three platforms' own sites.

import { renderApp } from "./app.js";
import type { AppPageDef } from "./serve.js";
import { SKIN_CSS, SKIN_JS, skinFrame } from "./skin.js";
import { THEME_IDS, type ThemeId } from "./themes.js";

/** The page that shows a list of mods from Nexus Mods, mod.io or Thunderstore. */
export const MODS_APP_URI = "ui://modwrench/mods";

/** One mod on the Mods page. */
export type ModRow = {
  /** "" when the platform gave none; the page shows "(no name)". */
  name: string;
  /** "unknown" when the platform gave none. */
  author: string;
  platform?: "nexus" | "modio" | "thunderstore";
  version?: string;
  downloads?: number;
  /** Nexus endorsements, Thunderstore rating_score, mod.io ratings_weighted_aggregate. */
  endorsements?: number;
  summary?: string;
  /** The mod's page address, as the platform gave it. */
  pageUrl?: string;
};

/** What a tool sends the Mods page (its structuredContent). */
export type ModsView = { view: "mods"; theme: ThemeId; query?: string; mods: ModRow[]; note?: string };

const PLATFORMS: readonly string[] = ["nexus", "modio", "thunderstore"];

// A row as a platform's data really arrives: any field may be missing or the wrong type.
function modRow(value: unknown): ModRow {
  const r = (value !== null && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const row: ModRow = {
    name: typeof r.name === "string" ? r.name : "",
    author: typeof r.author === "string" && r.author !== "" ? r.author : "unknown",
  };
  if (typeof r.platform === "string" && PLATFORMS.includes(r.platform)) row.platform = r.platform as ModRow["platform"];
  if (typeof r.version === "string") row.version = r.version;
  if (Number.isFinite(r.downloads)) row.downloads = r.downloads as number;
  if (Number.isFinite(r.endorsements)) row.endorsements = r.endorsements as number;
  if (typeof r.summary === "string") row.summary = r.summary;
  if (typeof r.pageUrl === "string") row.pageUrl = r.pageUrl;
  return row;
}

/**
 * The Mods page's data, from rows as a tool mapped them. Never throws on what a
 * platform left out or sent as the wrong type: a name that isn't a string is "", an
 * author that isn't one (or is empty) is "unknown", and any other such field is left
 * out. A theme that isn't one of the four skins is Skyrim. Every row is kept; the
 * tools cap their own lists.
 */
export function modsView(input: { theme?: string; query?: string; mods: ModRow[]; note?: string }): ModsView {
  return {
    view: "mods",
    theme: (THEME_IDS as readonly unknown[]).includes(input.theme) ? (input.theme as ThemeId) : "skyrim",
    ...(typeof input.query === "string" ? { query: input.query } : {}),
    mods: (Array.isArray(input.mods) ? input.mods : []).map(modRow),
    ...(typeof input.note === "string" ? { note: input.note } : {}),
  };
}

const CSS = String.raw`
.mw-mrow{display:flex;align-items:center;gap:11px;padding:11px 12px;border-bottom:1px solid var(--border);background:transparent}
.mw-mrow:last-child{border-bottom:0}
.mw-mrow:nth-child(odd){background:rgba(255,255,255,.015)}
.mw-micon{width:34px;height:34px;border-radius:7px;flex:none;display:grid;place-items:center;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--bg);background:var(--accent);opacity:.92}
.mw-mmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.mw-mname{font-family:var(--font-head);font-size:14px;font-weight:600;color:var(--ink);display:flex;align-items:center;flex-wrap:wrap;gap:7px}
.mw-mtitle{min-width:0;overflow-wrap:anywhere}
.mw-mby{font-size:11.5px;color:var(--sub);overflow-wrap:anywhere}
.mw-mby strong{color:var(--ink)}
.mw-msum{font-size:12px;color:var(--ink);opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.mw-url{font-size:10.5px;color:var(--sub);text-transform:none;overflow-wrap:anywhere}
.mw-mstat{font-family:var(--mono);font-size:10.5px;color:var(--sub);display:flex;gap:12px;white-space:nowrap}
.mw-mact{display:flex;align-items:center;gap:9px;flex:none}
@media(max-width:560px){.mw-msum{display:none}.mw-mrow{flex-wrap:wrap}.mw-mmain{flex-basis:calc(100% - 45px)}}
`;

const BODY = `
<section id="mods" class="mw-sec" hidden>
  <div class="mw-sec-h"><h2 id="mods-head">Mods</h2><span id="mods-count" class="mw-sec-sub"></span></div>
  <ul id="mods-list" class="mw-list"></ul>
</section>
<div id="mods-none" hidden></div>
`;

// No template literals, no backticks and no dollar-brace: this text sits inside a
// template literal. Strings with apostrophes use double quotes.
const SCRIPT = String.raw`
(function () {
  'use strict';
  var h = mwSkin.h;
  var el = mwSkin.el;
  var tidy = mwSkin.tidy;

  // A badge for the platforms this table names, and none for anything else.
  var PLATFORMS = { nexus: 'Nexus Mods', modio: 'mod.io', thunderstore: 'Thunderstore' };

  // The only addresses Open asks the editor to open: https, on nexusmods.com, mod.io or
  // thunderstore.io or a name under one of them, no port but the default, then nothing
  // or a path; printable ASCII with no space or backslash, and 2,048 characters at most.
  // Every address is shown as text whether or not it passes; this decides the button only.
  var OPENABLE = /^https:\/\/(?:[a-z0-9-]+\.)*(?:nexusmods\.com|mod\.io|thunderstore\.io)(?::443)?(?:\/[\x21-\x5b\x5d-\x7e]*)?$/i;
  function openable(url) {
    return typeof url === 'string' && url.length <= 2048 && OPENABLE.test(url);
  }

  function initials(name) {
    var out = name.split(' ').slice(0, 2).map(function (word) { return Array.from(word)[0] || ''; }).join('').toUpperCase();
    return out || 'MO';
  }

  function row(m, canOpen) {
    var name = tidy(m.name, 120);
    var author = tidy(m.author, 80) || 'unknown';
    var version = tidy(m.version, 40);
    var summary = tidy(m.summary, 300);
    var platform = mwSkin.pick(PLATFORMS, m.platform, '');
    var url = typeof m.pageUrl === 'string' ? m.pageUrl : '';
    var exact = openable(url);
    var address = exact ? url : tidy(url, 300);
    var main = h('div', { class: 'mw-mmain' }, [
      h('span', { class: 'mw-mname' }, [
        h('span', { class: 'mw-mtitle', text: name || '(no name)' }),
        platform ? h('span', { class: 'mw-badge', text: PLATFORMS[platform] }) : null
      ]),
      h('span', { class: 'mw-mby' }, ['by ', h('strong', { text: author }), version ? ' · v' + version : null]),
      summary ? h('span', { class: 'mw-msum', text: summary }) : null,
      address ? h('code', { class: 'mw-url', text: address }) : null
    ]);
    var stats = h('div', { class: 'mw-mstat' }, [
      h('span', { title: 'downloads', text: '▼ ' + mwSkin.compact(m.downloads) }),
      h('span', { title: 'endorsements or rating', text: '★ ' + mwSkin.compact(m.endorsements) })
    ]);
    var act = h('div', { class: 'mw-mact' });
    if (canOpen && exact) {
      var refused = null;
      var button = h('button', { type: 'button', class: 'mw-btn', 'aria-label': 'Open the page of ' + (name || 'this mod'), text: 'Open ›' });
      // The editor opens exactly the address that passed, and may ask the person first or say no.
      button.addEventListener('click', function () {
        window.mwApp.openLink(url).then(function () {
          if (refused) main.removeChild(refused);
          refused = null;
          window.mwApp.resized();
        }, function () {
          if (!refused) refused = main.appendChild(h('span', { class: 'mw-note', role: 'status', text: "Your editor didn't open the link. The address is above." }));
          window.mwApp.resized();
        });
      });
      act.appendChild(button);
    }
    return h('li', { class: 'mw-mrow' }, [h('span', { class: 'mw-micon', 'aria-hidden': 'true', text: initials(name) }), main, stats, act]);
  }

  function draw(data) {
    var mods = Array.isArray(data.mods) ? data.mods : [];
    var query = tidy(data.query, 120);
    var list = el('mods-list');
    var none = el('mods-none');
    mwSkin.clear(list);
    mwSkin.clear(none);
    if (!mods.length) {
      var hint = tidy(data.note, 300) || (query ? 'Nothing came back for "' + query + '".' : 'Nothing came back.');
      none.appendChild(mwSkin.empty('No mods to show', hint));
      mwSkin.show('mods', false);
      mwSkin.show('mods-none', true);
      return;
    }
    el('mods-head').textContent = query ? 'Mods · "' + query + '"' : 'Mods';
    el('mods-count').textContent = mods.length + (mods.length === 1 ? ' mod' : ' mods');
    var canOpen = !!window.mwApp.capabilities().openLinks;
    mods.forEach(function (m) { list.appendChild(row(m && typeof m === 'object' ? m : {}, canOpen)); });
    mwSkin.show('mods-none', false);
    mwSkin.show('mods', true);
  }

  function reset() {
    mwSkin.show('mods', false);
    mwSkin.show('mods-none', false);
  }

  mwSkin.start({ name: 'mods', view: 'mods', draw: draw, reset: reset });
})();
`;

/** The Mods page, as the HTML an MCP Apps host loads for `ui://modwrench/mods`. */
export function renderModsApp(): string {
  return renderApp({
    title: "Mods",
    css: SKIN_CSS + CSS,
    body: skinFrame("Mods", BODY),
    script: SKIN_JS + SCRIPT,
  });
}

/** The Mods page as a server registers it (see registerAppPage). */
export const MODS_PAGE: AppPageDef = {
  name: "mods_panel",
  uri: MODS_APP_URI,
  title: "Mods page",
  description:
    "The page MCP Apps clients draw for mod lists (Nexus trending, mod.io lists and searches, Thunderstore lists, searches and top mods, and mw_query_mod_metadata): each mod with its author, platform, version, counts and page address. Read-only; it makes no network requests and keeps nothing. A mod's page opens only if you press Open and your client agrees.",
  render: renderModsApp,
  clipboard: false,
};
