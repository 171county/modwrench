// ─── The skin: one look for the mods, dependencies, crash log, conflicts and deck pages ──
// These five pages are MCP Apps pages (see app.ts) that keep the look of the panels
// they replace: the four flagship-game skins from themes.ts, keyed on `data-game` on
// <html> (MCP Apps already uses `data-theme` there for the host's light or dark).
// The frame, the swatches that switch skins, and what a page shows before its answer
// arrives or in place of it are the same on all five, so they are written once here.
//
// A page is renderApp({ title, css: SKIN_CSS + its CSS, body: skinFrame(label, its
// markup), script: SKIN_JS + its script }), and its script calls mwSkin.start() once.
// Switching skins is an attribute swap in the page; nothing is stored.

import { esc } from "./app.js";
import { THEMES, THEME_IDS, themeStyleBlock } from "./themes.js";

// The shared frame. Carried over from the old shell, without what would stop a page
// from shrinking to its content: the host is told the height of #mw-root, and a root
// pinned to the viewport's height could only ever grow.
const FRAME_CSS = String.raw`
*{margin:0;padding:0}
:root{--r:14px}
html[data-game]{color-scheme:dark!important}
html[data-game] body{font-family:var(--font-body);background:var(--bg);color:var(--ink)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
.mw-app{max-width:1040px;margin:0 auto;
  padding:calc(14px + var(--safe-top,0px)) calc(16px + var(--safe-right,0px)) calc(14px + var(--safe-bottom,0px)) calc(16px + var(--safe-left,0px))}
/* top bar */
.mw-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  padding-bottom:14px;border-bottom:1px solid var(--border)}
.mw-brand{font-family:var(--font-head);font-weight:700;font-size:19px;letter-spacing:.02em;
  display:flex;align-items:baseline;gap:9px;color:var(--ink)}
.mw-brand b{color:var(--accent)}
.mw-brand-sub{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--sub)}
.mw-themes{display:flex;gap:6px}
.mw-theme{width:26px;height:26px;border-radius:50%;border:1.5px solid var(--border);cursor:pointer;
  padding:0;position:relative;background:var(--tsw);transition:transform .09s ease,border-color .12s,box-shadow .12s}
.mw-theme[data-t="skyrim"]{--tsw:radial-gradient(circle at 35% 30%,#c9a25a,#241d12)}
.mw-theme[data-t="fallout"]{--tsw:radial-gradient(circle at 35% 30%,#3bff7a,#04120a)}
.mw-theme[data-t="lethal"]{--tsw:radial-gradient(circle at 35% 30%,#37e0d0,#070a0c)}
.mw-theme[data-t="valheim"]{--tsw:radial-gradient(circle at 35% 30%,#c9a86a,#10141b)}
.mw-theme.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--bg),0 0 0 3.5px var(--accent)}
.mw-theme:active{transform:scale(.9)}
/* body */
.mw-body{padding:20px 0}
.mw-sec{margin-bottom:26px}
.mw-sec-h{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
.mw-sec-h h2{font-family:var(--font-head);font-size:15px;letter-spacing:.03em;color:var(--ink);font-weight:600}
.mw-sec-sub{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;color:var(--sub)}
.mw-dot{width:8px;height:8px;border-radius:50%;background:var(--sub);box-shadow:0 0 8px currentColor;flex:none}
.mw-dot.on{background:var(--accent);color:var(--accent)}
.mw-dot.warn{background:var(--accent2);color:var(--accent2)}
.mw-dot.off{background:var(--sub);box-shadow:none}
/* lists: MO2 ordered list + r2modman rows */
.mw-list{display:flex;flex-direction:column;list-style:none;border:1px solid var(--border);border-radius:var(--r);overflow:hidden;background:var(--panel);box-shadow:var(--glow)}
.mw-lrow{display:flex;align-items:center;gap:11px;padding:9px 12px;border-bottom:1px solid var(--border);background:transparent;color:var(--ink);text-align:left;width:100%;font:inherit}
.mw-lrow:last-child{border-bottom:0}
.mw-lrow:nth-child(odd){background:rgba(255,255,255,.015)}
.mw-prio{font-family:var(--mono);font-size:11px;color:var(--sub);min-width:20px;text-align:right}
.mw-lmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.mw-lname{font-family:var(--font-head);font-size:13.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mw-lmeta{font-family:var(--mono);font-size:10px;color:var(--sub)}
.mw-flag{font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;padding:1px 5px;border-radius:4px;border:1px solid var(--border);color:var(--sub)}
.mw-flag.ok{color:var(--ok);border-color:var(--ok)}
.mw-flag.warn{color:var(--warn);border-color:var(--warn)}
.mw-count{color:var(--accent)}
.mw-badge{font-family:var(--mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--accent2);border:1px solid var(--border);border-radius:6px;padding:2px 6px;white-space:nowrap}
/* buttons */
.mw-btn{font-family:var(--mono);font-size:11px;letter-spacing:.03em;cursor:pointer;color:var(--ink);
  background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-radius:9px;padding:7px 12px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 2px 0 rgba(0,0,0,.5),0 5px 12px rgba(0,0,0,.32);
  transition:transform .07s ease,box-shadow .07s ease,border-color .12s,background .12s}
.mw-btn:hover{border-color:var(--accent);color:var(--ink)}
.mw-btn:active{transform:translateY(2px);box-shadow:inset 0 2px 6px rgba(0,0,0,.55),0 1px 0 rgba(0,0,0,.4)}
.mw-btn.primary{background:var(--accent);color:var(--bg);border-color:var(--accent);font-weight:700;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 2px 0 rgba(0,0,0,.55),0 6px 16px rgba(0,0,0,.35)}
.mw-btn.primary:active{transform:translateY(2px);box-shadow:inset 0 2px 7px rgba(0,0,0,.4),0 0 14px var(--accent)}
.mw-note{font-size:11px;color:var(--sub)}
.mw-muted{color:var(--sub)}
.mw-empty{text-align:center;padding:56px 20px;color:var(--sub)}
.mw-empty-mark{width:44px;height:44px;margin:0 auto 16px;border:2px dashed var(--border);border-radius:12px;transform:rotate(45deg)}
.mw-empty h3{font-family:var(--font-head);color:var(--ink);font-size:16px;margin-bottom:6px}
.mw-empty p{font-size:13px;margin-bottom:16px}
/* what a page shows before, or instead of, its own drawing */
.mw-status{font-family:var(--mono);font-size:11.5px;color:var(--sub);margin-bottom:14px}
.mw-problem{margin-bottom:14px;padding:12px 14px;border:1px solid var(--danger);border-radius:var(--r);background:var(--panel);
  color:var(--ink);font-size:13px;line-height:1.5}
.mw-problem p+p{margin-top:6px}
.mw-plain{margin-bottom:14px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--r);background:var(--panel);
  font-family:var(--mono);font-size:11.5px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto}
/* footer: the tagline of the skin in use */
.mw-foot{border-top:1px solid var(--border);padding-top:12px;display:flex;justify-content:space-between;
  gap:10px;flex-wrap:wrap;font-family:var(--mono);font-size:10.5px;color:var(--sub)}
.mw-foot .mw-tag{color:var(--ink);opacity:.7;display:none}
${THEME_IDS.map((id) => `[data-game="${id}"] .mw-foot .mw-tag[data-for="${id}"]{display:inline}`).join("\n")}
`;

/** The four skins (theme token blocks and chrome, keyed on `[data-game]`) and the shared frame. */
export const SKIN_CSS: string = themeStyleBlock() + "\n" + FRAME_CSS;

/**
 * The page body: #mw-root.mw-app holding the header (brand, `label`, the four skin
 * swatches), the status line, the problem box, the text-only box, `inner`, and the footer.
 */
export function skinFrame(label: string, inner: string): string {
  const swatches = THEME_IDS.map(
    (id) =>
      `<button type="button" id="mw-skin-${id}" class="mw-theme" data-t="${id}" title="${esc(THEMES[id].game)}" aria-label="${esc(THEMES[id].label)} skin" aria-pressed="false"></button>`
  ).join("\n      ");
  const taglines = THEME_IDS.map((id) => `<span class="mw-tag" data-for="${id}">${esc(THEMES[id].tagline)}</span>`).join("\n    ");
  return `
<div id="mw-root" class="mw-app">
  <header class="mw-top">
    <div class="mw-brand"><b>&#9881; ModWrench</b><span class="mw-brand-sub">${esc(label)}</span></div>
    <div class="mw-themes" role="group" aria-label="Skin">
      ${swatches}
    </div>
  </header>
  <main class="mw-body">
    <p id="mw-status" class="mw-status" role="status" aria-live="polite">Waiting for the answer. If this stays here, the answer is in the chat.</p>
    <div id="mw-problem" class="mw-problem" role="alert" hidden></div>
    <pre id="mw-plain" class="mw-plain" hidden></pre>
    ${inner}
  </main>
  <footer class="mw-foot">
    ${taglines}
    <span>Read-only. This answer goes to the AI you're talking to; this page sends nothing anywhere and keeps nothing.</span>
  </footer>
</div>
`;
}

// mwSkin: what every one of the five pages does the same way. Comes after the mwApp
// runtime. No template literals, no backticks and no dollar-brace: this text sits
// inside a template literal. Strings with apostrophes use double quotes.
//
//   mwSkin.start({ name, view, draw, reset })
//       name   'mods' and so on; the page introduces itself as 'modwrench-' + name
//       view   the structuredContent.view this page draws
//       draw   draw(data) for a result whose view matches
//       reset  hide the page's own sections (a result it can't draw arrived)
//   mwSkin.h(tag, attrs, kids)   build an element; text goes in only as text
//   mwSkin.el(id), clear(node), show(id, on), say(text)
//   mwSkin.tidy(value, max)      one display-safe line, as the server's clean() makes it; non-strings give ''
//   mwSkin.pick(table, key, fallback)   key when it is one of the table's own keys, else fallback
//   mwSkin.compact(n)            '1.2k', '3.4M'; a dash for anything that isn't a finite number
//   mwSkin.empty(title, hint)    the empty-state block
export const SKIN_JS = String.raw`
var mwSkin = (function () {
  'use strict';

  var SKINS = { skyrim: true, fallout: true, lethal: true, valheim: true };
  var page = null;
  var state = { picked: false, gotResult: false };

  function el(id) { return document.getElementById(id); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function show(id, on) { el(id).hidden = !on; }
  // A value that is one of a fixed table's own keys, or the fallback. Anything else
  // from a result (including names every object inherits) is never used as a key.
  function pick(table, key, fallback) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? key : fallback;
  }

  // Display-safe text, made the way the server's clean() makes it (patchday/summary.ts): one line, none of
  // the characters that print nothing (controls, zero-width and direction marks, soft hyphens, fillers,
  // variation selectors, tag characters), and a cut that never splits a character in two.
  var INVISIBLE = /[\p{Cc}\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u2800\u3164\uFFA0\uFE00-\uFE0F\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}\u2028\u2029]/gu;
  function tidy(value, max) {
    var s = typeof value === 'string' ? value : '';
    var out = s.replace(INVISIBLE, ' ').replace(/ {2,}/g, ' ').trim();
    var chars = Array.from(out);
    if (max && chars.length > max) out = chars.slice(0, max - 1).join('') + '…';
    return out;
  }

  // Elements are built, never parsed: text goes in through textContent only.
  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'text') node.textContent = String(value);
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return node;
  }

  function compact(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function empty(title, hint) {
    return h('div', { class: 'mw-empty' }, [h('div', { class: 'mw-empty-mark', 'aria-hidden': 'true' }), h('h3', { text: title }), h('p', { text: hint })]);
  }

  function say(text) {
    el('mw-status').textContent = text;
    show('mw-status', true);
  }

  function setSkin(id) {
    document.documentElement.setAttribute('data-game', id);
    Object.keys(SKINS).forEach(function (s) {
      var swatch = el('mw-skin-' + s);
      swatch.setAttribute('aria-pressed', s === id ? 'true' : 'false');
      if (s === id) swatch.classList.add('on');
      else swatch.classList.remove('on');
    });
  }

  function firstText(result) {
    var content = Array.isArray(result.content) ? result.content : [];
    for (var i = 0; i < content.length; i++) {
      if (content[i] && content[i].type === 'text' && typeof content[i].text === 'string') return content[i].text;
    }
    return '';
  }

  function problem(title, detail) {
    var box = el('mw-problem');
    clear(box);
    box.appendChild(h('p', {}, [h('b', { text: title })]));
    if (detail) box.appendChild(h('p', { text: detail }));
    box.hidden = false;
  }

  function handleResult(result) {
    if (!result || typeof result !== 'object') return;
    state.gotResult = true;
    var data = result.structuredContent;
    var text = firstText(result);
    show('mw-status', false);
    show('mw-problem', false);
    show('mw-plain', false);
    if (data && typeof data === 'object' && data.view === page.view) {
      if (!state.picked) setSkin(pick(SKINS, data.theme, 'skyrim'));
      page.draw(data);
    } else if (result.isError) {
      page.reset();
      problem("The tool couldn't answer this time.", tidy(text, 600));
    } else if (text) {
      page.reset();
      var box = el('mw-plain');
      box.textContent = text.slice(0, 20000);
      box.hidden = false;
      say('ModWrench sent this answer as text only.');
    } else {
      page.reset();
      problem('Nothing came back that this page can show.');
    }
    window.mwApp.resized();
  }

  function start(def) {
    page = def;
    setSkin('skyrim');
    Object.keys(SKINS).forEach(function (s) {
      el('mw-skin-' + s).addEventListener('click', function () {
        state.picked = true;
        setSkin(s);
      });
    });
    window.mwApp.on('result', handleResult);
    window.mwApp.on('cancelled', function () { if (!state.gotResult) say('The call was cancelled.'); });
    window.mwApp.start('modwrench-' + def.name, '1', function () {
      if (!state.gotResult) say("This page couldn't reach your editor. The answer is in the chat.");
    });
  }

  return { start: start, h: h, el: el, clear: clear, show: show, say: say, tidy: tidy, pick: pick, compact: compact, empty: empty };
})();
`;
