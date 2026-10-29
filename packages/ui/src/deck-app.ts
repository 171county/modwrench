// ─── The Deck page ──────────────────────────────────────────────────────────
// Which platforms are connected, and the flagship games, drawn as an MCP Apps page
// (see app.ts) in the five game skins (see skin.ts), for mw_deck.
//
// The page is a pure function of the tool result. It keeps nothing, stores nothing
// and makes no network requests (its own Content-Security-Policy forbids them).
// Everything in a result is someone else's text and goes on the page as text only.
//
// Its one control is Ask, shown only when the client takes messages from a page:
// it puts a fixed sentence from this file in the chat. Nothing from the result is
// ever in a message, and an id the page doesn't know gets no Ask at all.

import { renderApp } from "./app.js";
import type { AppPageDef } from "./serve.js";
import { SKIN_CSS, SKIN_JS, skinFrame } from "./skin.js";
import { THEME_IDS, type ThemeId } from "./themes.js";

/** The page that shows which platforms are connected, and the flagship games. */
export const DECK_APP_URI = "ui://modwrench/deck";

/** One platform on the deck. */
export type DeckConnector = { id: string; name: string; status: "on" | "off" | "warn"; toolCount?: number; tool?: string };

/** One job on the deck, with how it last came out in this session: a verdict and counts, never names. */
export type DeckFace = { job: string; last?: { line: string; at: string } };

/** What mw_deck sends the Deck page as its structuredContent. */
export type DeckView = {
  view: "deck";
  theme: ThemeId;
  connectors: DeckConnector[];
  games: Array<{ id: string; name: string; note?: string }>;
  faces: DeckFace[];
};

const STATUSES: ReadonlyArray<string> = ["on", "off", "warn"];
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The Deck page's data. A theme that isn't one of the five skins is Skyrim; a text
 * field that isn't a string becomes "", a status that isn't on, off or warn is off,
 * and a tool count that isn't a finite number is left out. Never throws on a field.
 */
export function deckView(input: { theme?: string; connectors: DeckConnector[]; games: DeckView["games"]; faces?: DeckFace[] }): DeckView {
  return {
    view: "deck",
    theme: THEME_IDS.includes(input.theme as ThemeId) ? (input.theme as ThemeId) : "skyrim",
    connectors: input.connectors.map((c) => ({
      id: str(c.id),
      name: str(c.name),
      ...(typeof c.tool === "string" ? { tool: c.tool } : {}),
      status: STATUSES.includes(c.status) ? c.status : "off",
      ...(typeof c.toolCount === "number" && Number.isFinite(c.toolCount) ? { toolCount: c.toolCount } : {}),
    })),
    games: input.games.map((g) => ({
      id: str(g.id),
      name: str(g.name),
      ...(typeof g.note === "string" ? { note: g.note } : {}),
    })),
    faces: (Array.isArray(input.faces) ? input.faces : [])
      .filter((f) => f !== null && typeof f === "object")
      .map((f) => ({
        job: str(f.job),
        ...(f.last && typeof f.last === "object" && str(f.last.line) ? { last: { line: str(f.last.line), at: str(f.last.at) } } : {}),
      })),
  };
}

const CSS = String.raw`
.mw-lmeta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mw-lct{font-family:var(--mono);font-size:10px;color:var(--sub);white-space:nowrap}
.mw-ask{flex:none;padding:4px 10px}
.mw-game-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px}
.mw-game{display:flex;flex-direction:column;gap:3px;min-width:0;text-align:left;
  background:var(--panel2);border:1px solid var(--border);border-radius:11px;padding:11px 13px;color:var(--ink)}
.mw-game-nm{font-family:var(--font-head);font-weight:600;font-size:13px;overflow-wrap:anywhere}
.mw-game-note{font-family:var(--mono);font-size:9.5px;color:var(--sub);overflow-wrap:anywhere}
.mw-game .mw-ask{align-self:flex-start;margin-top:6px}
@media (max-width:480px){.mw-lct{display:none}}
`;

const BODY = `
    <section id="deck-faces" class="mw-sec" hidden>
      <div class="mw-sec-h"><h2>Jobs</h2><span class="mw-sec-sub">how each last came out in this session</span></div>
      <ul id="deck-face-list" class="mw-list"></ul>
    </section>
    <section id="deck-connectors" class="mw-sec" hidden>
      <div class="mw-sec-h"><h2>Connectors</h2><span class="mw-sec-sub">what ModWrench can reach</span></div>
      <ul id="deck-list" class="mw-list"></ul>
    </section>
    <div id="deck-empty" hidden></div>
    <section id="deck-games" class="mw-sec" hidden>
      <div class="mw-sec-h"><h2>Flagship scenes</h2><span class="mw-sec-sub">the games behind the five skins</span></div>
      <div id="deck-grid" class="mw-game-grid"></div>
    </section>`;

// No template literals, no backticks and no dollar-brace: this text sits inside a
// template literal. Strings with apostrophes use double quotes.
const SCRIPT = String.raw`
(function () {
  'use strict';
  var h = mwSkin.h;
  var el = mwSkin.el;
  var tidy = mwSkin.tidy;
  var pick = mwSkin.pick;

  // What each Ask sends, by the id the result gives. A message goes into the chat as the person's own
  // words, so it is always one of these sentences: names and notes in a result are never sent.
  var CONNECTOR_ASK = {
    'nexus-public': 'Search Nexus Mods for me. Ask me what to look for first.',
    nexus: 'Check my Nexus Mods account connection.',
    modio: "Show me what's on mod.io. Ask me which game first.",
    thunderstore: 'Show me the Thunderstore communities.',
    workbench: 'Detect my modding setup.'
  };
  var GAME_ASK = {
    skyrim: 'Show me the top Skyrim Special Edition mods.',
    fallout: 'Show me the top Fallout 4 mods.',
    lethal: 'Show me the top Lethal Company mods.',
    valheim: 'Show me the top Valheim mods.',
    gta: 'Show me the top GTA V mods.'
  };
  var EMPTY_ASK = 'Detect my modding setup.';
  // The jobs, in the deck's order: the name shown and the one sentence each Ask sends.
  var FACES = {
    crash: { name: 'Crash Whisperer', ask: 'Why did my game crash?' },
    setup: { name: 'The Doctors', ask: 'Is my modding setup ready?' },
    patch: { name: 'Patch Day', ask: 'Is it safe to update my game?' },
    updates: { name: 'Pulse', ask: 'Are my mods up to date?' },
    crew: { name: 'Crew Check', ask: 'Do my crew and I have the same mods?' }
  };

  var FLAGS = { on: ['ON', 'mw-flag ok'], off: ['OFF', 'mw-flag'], warn: ['WARN', 'mw-flag warn'] };

  function isObject(value) { return value !== null && typeof value === 'object'; }

  function canAsk() {
    var caps = window.mwApp.capabilities();
    return !!(caps && caps.message);
  }

  function askButton(sentence, label, cls) {
    var button = h('button', { type: 'button', class: cls, title: sentence, 'aria-label': 'Ask in the chat: ' + sentence, text: label });
    button.addEventListener('click', function () {
      window.mwApp.sendMessage(sentence).then(function () {
        mwSkin.say('Sent to the chat.');
        window.mwApp.resized();
      }, function () {
        mwSkin.say("Your editor didn't take the message. You can ask in the chat directly.");
        window.mwApp.resized();
      });
    });
    return button;
  }

  function connectorRow(c, i, ask) {
    var status = pick(FLAGS, c.status, 'off');
    var asks = ask ? pick(CONNECTOR_ASK, c.id, '') : '';
    var count = typeof c.toolCount === 'number' && isFinite(c.toolCount) ? c.toolCount : null;
    return h('li', { class: 'mw-lrow' }, [
      h('span', { class: 'mw-prio', text: String(i + 1).padStart(2, '0') }),
      h('span', { class: 'mw-dot ' + status, 'aria-hidden': 'true' }),
      h('span', { class: 'mw-lmain' }, [
        h('span', { class: 'mw-lname', text: tidy(c.name, 80) || '(no name)' }),
        h('span', { class: 'mw-lmeta', text: tidy(c.tool, 80) || 'local' })
      ]),
      h('span', { class: FLAGS[status][1], text: FLAGS[status][0] }),
      count === null ? null : h('span', { class: 'mw-lct', text: count + (count === 1 ? ' tool' : ' tools') }),
      asks ? askButton(CONNECTOR_ASK[asks], 'Ask', 'mw-btn mw-ask') : null
    ]);
  }

  function gameTile(g, ask) {
    var asks = ask ? pick(GAME_ASK, g.id, '') : '';
    var note = tidy(g.note, 80);
    return h('div', { class: 'mw-game' }, [
      h('span', { class: 'mw-game-nm', text: tidy(g.name, 60) || '(no name)' }),
      note ? h('span', { class: 'mw-game-note', text: note }) : null,
      asks ? askButton(GAME_ASK[asks], 'Ask', 'mw-btn mw-ask') : null
    ]);
  }

  // A job the page knows, with its last line from this session or "not run yet". Unknown jobs aren't drawn.
  function faceRow(f, ask) {
    var job = pick(FACES, f.job, '');
    if (!job) return null;
    var last = isObject(f.last) ? tidy(f.last.line, 160) : '';
    return h('li', { class: 'mw-lrow' }, [
      h('span', { class: 'mw-dot ' + (last ? 'on' : 'off'), 'aria-hidden': 'true' }),
      h('span', { class: 'mw-lmain' }, [
        h('span', { class: 'mw-lname', text: FACES[job].name }),
        h('span', { class: 'mw-lmeta', text: last || 'not run in this session' })
      ]),
      ask ? askButton(FACES[job].ask, 'Ask', 'mw-btn mw-ask') : null
    ]);
  }

  function reset() {
    mwSkin.show('deck-faces', false);
    mwSkin.show('deck-connectors', false);
    mwSkin.show('deck-empty', false);
    mwSkin.show('deck-games', false);
  }

  function draw(data) {
    reset();
    var ask = canAsk();
    var connectors = (Array.isArray(data.connectors) ? data.connectors : []).filter(isObject);
    var games = (Array.isArray(data.games) ? data.games : []).filter(isObject);
    var faces = (Array.isArray(data.faces) ? data.faces : []).filter(isObject);

    var faceList = el('deck-face-list');
    mwSkin.clear(faceList);
    var drawn = 0;
    faces.forEach(function (f) { var row = faceRow(f, ask); if (row) { faceList.appendChild(row); drawn++; } });
    mwSkin.show('deck-faces', drawn > 0);

    var list = el('deck-list');
    var empty = el('deck-empty');
    mwSkin.clear(list);
    mwSkin.clear(empty);
    if (connectors.length) {
      connectors.forEach(function (c, i) { list.appendChild(connectorRow(c, i, ask)); });
      mwSkin.show('deck-connectors', true);
    } else {
      var block = mwSkin.empty('No connectors active', "Drop a token in your OS keychain, then activate a platform — ModWrench only ever reads it. Or detect what's already installed.");
      if (ask) block.appendChild(askButton(EMPTY_ASK, 'Ask to detect my setup', 'mw-btn primary'));
      empty.appendChild(block);
      mwSkin.show('deck-empty', true);
    }

    var grid = el('deck-grid');
    mwSkin.clear(grid);
    games.forEach(function (g) { grid.appendChild(gameTile(g, ask)); });
    mwSkin.show('deck-games', games.length > 0);
  }

  mwSkin.start({ name: 'deck', view: 'deck', draw: draw, reset: reset });
})();
`;

/** The Deck page, as the HTML an MCP Apps host loads for `ui://modwrench/deck`. */
export function renderDeckApp(): string {
  return renderApp({
    title: "Deck",
    css: SKIN_CSS + CSS,
    body: skinFrame("Deck", BODY),
    script: SKIN_JS + SCRIPT,
  });
}

/** The Deck page as a server registers it (see registerAppPage). */
export const DECK_PAGE: AppPageDef = {
  name: "deck_panel",
  uri: DECK_APP_URI,
  title: "Deck page",
  description:
    "The page MCP Apps clients draw for mw_deck: each job and how it last came out in this session, which platforms are connected, with their tools, and the five flagship games. Read-only; it makes no network requests and keeps nothing. An Ask button puts a fixed sentence in the chat, only when you press it and your client takes messages from pages.",
  render: renderDeckApp,
  clipboard: false,
};
