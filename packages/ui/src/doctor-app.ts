// ─── The Doctor page ─────────────────────────────────────────────────────────
// What `mw_doctor` returns, drawn as a page: where the setup stands, what needs
// attention, what each finding rests on, and what ModWrench can't see. It is an MCP
// App (see app.ts), so a client that supports the extension draws it and every other
// client shows the plain-text answer the tool returns, with nothing extra in the
// conversation.
//
// The page is a pure function of the tool result. It keeps nothing, stores nothing
// and makes no network requests (its own Content-Security-Policy forbids them). Its
// buttons ask the host to call the same read-only tool again.
//
// Everything that comes from the person's machine (plugin file names, mod folder
// names, the names of other people's mods) is another author's text. It is only ever
// put on the page with textContent, never as markup, so a mod called `<img onerror=...>`
// is just a strange name. Reports never hold a folder path, so the page has none to show.

import { renderApp } from "./app.js";

const CSS = String.raw`
.app{max-width:780px;margin:0 auto;padding:14px 16px 16px;
  padding-top:calc(14px + var(--safe-top,0px));padding-right:calc(16px + var(--safe-right,0px));
  padding-bottom:calc(16px + var(--safe-bottom,0px));padding-left:calc(16px + var(--safe-left,0px))}
.top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;color:var(--sub);font-size:12px;letter-spacing:.02em}
.brand b{color:var(--ink);font-weight:600}
.waiting{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 8px}
.status{margin:0;color:var(--sub)}
.fade{animation:mwfade .2s ease-out}
@keyframes mwfade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}

.verdict{display:flex;gap:16px;align-items:center;padding:16px 18px;border-radius:calc(var(--radius) + 2px);
  border:1px solid var(--tone,var(--line));background:var(--tone-bg,var(--panel));color:var(--tone,var(--ink))}
.app[data-verdict="clear"]{--tone:var(--go);--tone-bg:var(--go-bg)}
.app[data-verdict="attention"]{--tone:var(--warn);--tone-bg:var(--warn-bg)}
.app[data-verdict="problems"]{--tone:var(--bad);--tone-bg:var(--bad-bg)}
.vmark{flex:none}
.vmark svg{display:none;width:52px;height:52px;fill:none;stroke:currentColor}
.app[data-verdict="clear"] .vm-clear,.app[data-verdict="attention"] .vm-attention,.app[data-verdict="problems"] .vm-problems{display:block}
.vtag{margin:0 0 2px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.vword{margin:0;font-size:26px;line-height:1.1;font-weight:800;letter-spacing:.06em}
.vline{margin:6px 0 0;color:var(--ink)}

.problem{margin-top:12px;padding:12px 14px;border:1px solid var(--bad);border-radius:var(--radius);background:var(--bad-bg);color:var(--ink)}
.problem b{color:var(--bad)}
.problem p{margin:4px 0 0}
.plain{margin:12px 0 0;padding:12px 14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--mono);font-size:12.5px}

.chips{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;gap:6px;align-items:baseline;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel);font-size:12.5px}
.chip-i{font-weight:800;min-width:1em;text-align:center}
.chip[data-tone="ok"] .chip-i{color:var(--go)}
.chip[data-tone="warn"] .chip-i{color:var(--warn)}
.chip[data-tone="bad"] .chip-i{color:var(--bad)}
.chip-k{color:var(--sub)}
.chip-v{font-weight:600}

.block{margin-top:18px}
.group+.group{margin-top:16px}
.h2{margin:0 0 8px;font-size:15px;font-weight:700;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.count{font-weight:400;color:var(--sub);font-size:12.5px}
.calm{margin:0;color:var(--sub)}
.plist{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.prow{padding:10px 12px;border:1px solid var(--line);border-left-width:4px;border-radius:var(--radius);background:var(--panel)}
.prow[data-status="problem"]{border-left-color:var(--bad)}
.prow[data-status="warn"]{border-left-color:var(--warn)}
.phead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ptitle{font-size:14px;overflow-wrap:anywhere}
.badge{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:1px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.prow[data-status="problem"] .st{color:var(--bad)}
.prow[data-status="warn"] .st{color:var(--warn)}
.prow[data-status="note"] .st{color:var(--sub)}
.preason{margin:6px 0 0;overflow-wrap:anywhere}
.items{margin:6px 0 0;padding-left:20px;font-family:var(--mono);font-size:12px;color:var(--sub)}
.items li{margin:2px 0;overflow-wrap:anywhere}
.pfix{margin:8px 0 0;overflow-wrap:anywhere}
.pfix b{font-weight:700}
.pmeta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;color:var(--sub);font-size:12.5px}
.basis{color:var(--sub)}
.basis[data-basis="install"]{border-style:solid;color:var(--ink)}
.basis[data-basis="rule"]{border-style:dashed}
.basis[data-basis="guess"]{border-style:dotted}
.psrc{overflow-wrap:anywhere}
.small{font-size:12.5px}
.muted{color:var(--sub)}
.plain-list{margin:6px 0 0;padding-left:20px}
.plain-list li{margin:3px 0;overflow-wrap:anywhere}

.controls{margin-top:18px;padding-top:14px;border-top:1px solid var(--line);display:grid;gap:10px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lbl{color:var(--sub)}
.input{min-height:36px;padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg)}
.btn.small{min-height:30px;padding:3px 10px;font-size:12.5px}
.mt{margin-top:8px}
.note{margin:0;color:var(--sub)}

.more{margin-top:12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
.more>summary{cursor:pointer;padding:9px 12px;font-weight:600}
.more>:not(summary){margin:0;padding:0 12px 10px}
.more ul{padding-left:30px}
.more li{margin:4px 0;overflow-wrap:anywhere}
.more ul.fine{list-style:none;padding-left:12px}
.more ul.fine li{margin:8px 0}
.fine-d{display:block;margin-top:2px}
.legend dt{font-weight:600;margin-top:6px}
.legend dd{margin:0;color:var(--sub)}
.blind-what{font-weight:600}
.foot{margin-top:14px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;color:var(--sub);font-size:12px}
.copybox{width:100%;min-height:120px;margin-top:10px;font-family:var(--mono);font-size:12px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius);padding:8px}
`;

const BODY = String.raw`
<div id="mw-root" class="app" data-verdict="">
  <header class="top">
    <span class="brand">ModWrench <b>Doctor</b></span>
    <span id="ctx" class="ctx" hidden></span>
  </header>

  <div id="waiting" class="waiting">
    <p id="status" class="status" role="status" aria-live="polite">Waiting for the check to finish. If this stays here, the answer is in the chat.</p>
    <button id="btn-run" class="btn small" type="button" hidden>Run the check now</button>
  </div>

  <section id="verdict" class="verdict" hidden aria-labelledby="verdict-word">
    <div class="vmark" aria-hidden="true">
      <svg class="vm-clear" viewBox="0 0 48 48" focusable="false"><circle cx="24" cy="24" r="20" stroke-width="3"/><path d="M14 25l7 7 13-15" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <svg class="vm-attention" viewBox="0 0 48 48" focusable="false"><path d="M24 5L45 41H3Z" stroke-width="3" stroke-linejoin="round"/><path d="M24 18v10" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="34" r="2.4" fill="currentColor" stroke="none"/></svg>
      <svg class="vm-problems" viewBox="0 0 48 48" focusable="false"><path d="M16 4h16l12 12v16L32 44H16L4 32V16z" stroke-width="3" stroke-linejoin="round"/><path d="M17 17l14 14M31 17L17 31" stroke-width="4" stroke-linecap="round"/></svg>
    </div>
    <div class="vtext">
      <p id="verdict-tag" class="vtag" hidden></p>
      <h1 id="verdict-word" class="vword"></h1>
      <p id="verdict-line" class="vline"></p>
    </div>
  </section>

  <div id="problem" class="problem" role="alert" hidden></div>
  <pre id="plain" class="plain" hidden></pre>

  <ul id="chips" class="chips" hidden aria-label="What was found"></ul>
  <section id="findings" class="block" hidden></section>

  <section id="controls" class="controls" hidden aria-label="Actions">
    <div class="row">
      <button id="btn-recheck" class="btn primary" type="button">Re-check</button>
      <button id="btn-copy" class="btn" type="button" hidden>Copy summary</button>
      <button id="btn-ask" class="btn" type="button" hidden>Ask about this</button>
    </div>
    <div id="area-row" class="row" hidden>
      <label for="area" class="lbl">Look at</label>
      <select id="area" class="input">
        <option value="all">Everything</option>
        <option value="setup">Setup only</option>
        <option value="deck">Deck and Linux only</option>
      </select>
      <button id="btn-area" class="btn" type="button">Check</button>
    </div>
    <p id="note" class="note" role="status" aria-live="polite"></p>
    <textarea id="copy-box" class="copybox" readonly hidden aria-label="Summary text to copy"></textarea>
  </section>

  <details id="blind" class="more" hidden><summary id="blind-sum">What ModWrench can't see from here</summary><ul id="blind-list"></ul></details>
  <details id="limits" class="more" hidden><summary>What this can't tell you</summary><ul id="limits-list"></ul></details>
  <details id="legend" class="more" hidden>
    <summary>How to read the labels</summary>
    <dl class="legend">
      <dt>Your files</dt><dd>ModWrench read it straight from your own files.</dd>
      <dt>Documented rule</dt><dd>A rule from another tool's own documentation, applied to what your files show. The source is named on the finding.</dd>
      <dt>ModWrench's guess</dt><dd>A rule of thumb, not a published rule. Treat it as a hint.</dd>
    </dl>
  </details>
  <details id="where" class="more" hidden><summary>Where it looked</summary><ul id="where-list"></ul></details>

  <footer id="foot" class="foot" hidden>
    <span>Read-only. This answer goes to the AI you're talking to; ModWrench itself sends nothing anywhere.</span>
    <span id="foot-time"></span>
  </footer>
</div>
`;

// No template literals, no backticks and no dollar-brace: this text sits inside a
// template literal. Strings with apostrophes use double quotes.
const SCRIPT = String.raw`
(function () {
  'use strict';

  var TOOL = 'mw_doctor';
  var state = { baseArgs: {}, args: {}, report: null, text: '', busy: false, canCall: true, gotResult: false };

  var VERDICTS = { clear: 'NOTHING FOUND', attention: 'WORTH A LOOK', problems: 'NEEDS FIXING' };
  var STATUS = { problem: 'Problem', warn: 'Warning', note: 'Note' };
  var GROUPS = [['problem', 'Problems'], ['warn', 'Warnings'], ['note', 'Notes']];
  var BASIS = {
    install: { label: 'Your files', tip: 'ModWrench read it straight from your own files.' },
    rule: { label: 'Documented rule', tip: "A rule from another tool's own documentation, applied to what your files show." },
    guess: { label: "ModWrench's guess", tip: 'A rule of thumb. Treat it as a hint.' }
  };
  var AREAS = { setup: 'Setup', deck: 'Deck' };
  var STEAMS = { native: 'a regular install', flatpak: 'a Flatpak install', custom: 'a folder set with STEAM_ROOT', none: 'not found' };
  var ITEMS_SHOWN = 8;

  function el(id) { return document.getElementById(id); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function num(value) { var n = Number(value); return isFinite(n) ? n : 0; }
  function copyObject(source) {
    var out = {};
    if (source && typeof source === 'object') Object.keys(source).forEach(function (k) { out[k] = source[k]; });
    return out;
  }
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
    var s = value === null || value === undefined ? '' : String(value);
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

  function show(id, on) { el(id).hidden = !on; }

  // A line of feedback: next to the buttons once there are buttons, otherwise in the waiting area.
  function say(text) {
    if (!el('controls').hidden) { el('note').textContent = text; return; }
    el('status').textContent = text;
    show('waiting', true);
  }

  function setBusy(on) {
    state.busy = on;
    el('mw-root').setAttribute('aria-busy', on ? 'true' : 'false');
    ['btn-recheck', 'btn-area', 'area', 'btn-run'].forEach(function (id) { el(id).disabled = on; });
    if (on) say('Checking…');
    else el('note').textContent = '';
  }

  function platformLabel(r) {
    if (r.platform === 'linux') return r.steamDeck === true ? 'Steam Deck' : 'Linux';
    return r.platform === 'windows' ? 'Windows' : r.platform === 'macos' ? 'macOS' : '';
  }

  function areasLabel(r) {
    var areas = Array.isArray(r.areas) ? r.areas : [];
    var hasSetup = areas.indexOf('setup') >= 0;
    var hasDeck = areas.indexOf('deck') >= 0;
    if (hasSetup && hasDeck) return 'Setup and Deck checks';
    if (hasDeck) return 'Deck checks';
    if (hasSetup) return 'Setup checks';
    return '';
  }

  // ── Pieces of the page ────────────────────────────────────────────────────

  function renderVerdict(r) {
    var v = pick(VERDICTS, r.verdict, 'attention');
    el('mw-root').setAttribute('data-verdict', v);
    el('verdict-word').textContent = VERDICTS[v];
    el('verdict-line').textContent = tidy(r.headline, 400);
    var tag = el('verdict-tag');
    var label = areasLabel(r);
    tag.textContent = label;
    tag.hidden = label === '';
    var game = r.game || {};
    var ctx = el('ctx');
    var where = [tidy(game.name, 60), platformLabel(r)].filter(function (t) { return t !== ''; }).join(' · ');
    ctx.textContent = where;
    ctx.hidden = where === '';
    show('verdict', true);
  }

  function chip(tone, key, value) {
    var icon = tone === 'ok' ? '✓' : tone === 'warn' ? '!' : tone === 'bad' ? '✕' : '–';
    return h('li', { class: 'chip', 'data-tone': tone }, [
      h('span', { class: 'chip-i', 'aria-hidden': 'true', text: icon }),
      h('span', { class: 'chip-k', text: key }),
      h('span', { class: 'chip-v', text: String(value) })
    ]);
  }

  function renderChips(r) {
    var host = el('chips');
    clear(host);
    var c = r.counts || {};
    var problems = num(c.problem);
    var warns = num(c.warn);
    var notes = num(c.note);
    var fine = num(c.ok);
    host.appendChild(chip(problems > 0 ? 'bad' : 'ok', 'Problems', problems));
    host.appendChild(chip(warns > 0 ? 'warn' : 'ok', 'Warnings', warns));
    host.appendChild(chip('info', 'Notes', notes));
    host.appendChild(chip('ok', 'Fine', fine));
    show('chips', true);
  }

  function basisBadge(key) {
    var b = pick(BASIS, key, 'guess');
    return h('span', { class: 'badge basis', 'data-basis': b, title: BASIS[b].tip, text: BASIS[b].label });
  }

  function findingRow(f, showArea) {
    var status = pick(STATUS, f.status, 'note');
    var items = Array.isArray(f.items) ? f.items : [];
    var kids = [
      h('div', { class: 'phead' }, [
        h('span', { class: 'badge st', text: STATUS[status] }),
        h('strong', { class: 'ptitle', text: tidy(f.title, 160) })
      ]),
      h('p', { class: 'preason', text: tidy(f.detail, 900) })
    ];
    if (items.length > 0) {
      var list = h('ul', { class: 'items' });
      items.slice(0, ITEMS_SHOWN).forEach(function (item) { list.appendChild(h('li', { text: tidy(item, 160) })); });
      var more = Math.max(0, items.length - ITEMS_SHOWN) + num(f.more);
      if (more > 0) list.appendChild(h('li', { text: 'and ' + more + ' more.' }));
      kids.push(list);
    } else if (num(f.more) > 0) {
      kids.push(h('p', { class: 'muted small', text: 'and ' + num(f.more) + ' more.' }));
    }
    if (f.fix) kids.push(h('p', { class: 'pfix' }, [h('b', { text: 'Fix: ' }), tidy(f.fix, 500)]));
    var meta = [basisBadge(f.basis)];
    if (showArea) {
      var area = pick(AREAS, f.area, '');
      if (area !== '') meta.push(h('span', { text: AREAS[area] }));
    }
    if (f.source) meta.push(h('span', { class: 'psrc', text: 'Source: ' + tidy(f.source, 200) }));
    kids.push(h('div', { class: 'pmeta' }, meta));
    return h('li', { class: 'prow', 'data-status': status }, kids);
  }

  function renderFindings(r) {
    var host = el('findings');
    clear(host);
    var all = Array.isArray(r.findings) ? r.findings : [];
    var areas = Array.isArray(r.areas) ? r.areas : [];
    var showArea = areas.length > 1;
    var any = false;

    GROUPS.forEach(function (g) {
      var list = all.filter(function (f) { return f && f.status === g[0]; });
      if (list.length === 0) return;
      any = true;
      var group = h('div', { class: 'group' });
      group.appendChild(h('h2', { class: 'h2' }, [g[1], h('span', { class: 'count', text: String(list.length) })]));
      var ul = h('ul', { class: 'plist' });
      list.forEach(function (f) { ul.appendChild(findingRow(f, showArea)); });
      group.appendChild(ul);
      host.appendChild(group);
    });
    if (!any) host.appendChild(h('p', { class: 'calm', text: 'Nothing to flag in what ModWrench could see.' }));

    var fine = all.filter(function (f) { return f && f.status === 'ok'; });
    if (fine.length > 0) {
      // Each one says what was checked and what it came to ("the game's drive: 44.7 GB free"), so a
      // clear result still shows its numbers.
      var ul2 = h('ul', { class: 'fine' });
      fine.forEach(function (f) {
        ul2.appendChild(h('li', {}, [
          h('strong', { class: 'ptitle', text: tidy(f.title, 160) }),
          ' ',
          basisBadge(f.basis),
          h('span', { class: 'muted small fine-d', text: tidy(f.detail, 220) })
        ]));
      });
      host.appendChild(h('details', { class: 'more' }, [h('summary', { text: 'Fine (' + fine.length + ')' }), ul2]));
    }
    show('findings', true);
  }

  function renderBlind(r) {
    var list = el('blind-list');
    clear(list);
    var blind = Array.isArray(r.notChecked) ? r.notChecked : [];
    blind.forEach(function (n) {
      list.appendChild(h('li', {}, [h('span', { class: 'blind-what', text: tidy(n && n.what, 220) }), ': ' + tidy(n && n.why, 320)]));
    });
    el('blind-sum').textContent = "What ModWrench can't see from here (" + blind.length + ')';
    show('blind', blind.length > 0);

    var limits = Array.isArray(r.limits) ? r.limits : [];
    var lim = el('limits-list');
    clear(lim);
    limits.forEach(function (t) { lim.appendChild(h('li', { text: tidy(t, 500) })); });
    show('limits', limits.length > 0);
    show('legend', true);
  }

  function renderWhere(r) {
    var host = el('where-list');
    clear(host);
    var looked = r.looked || {};
    host.appendChild(h('li', { text: 'Game folder: ' + (looked.gameFolder ? 'found.' : 'not found.') }));
    var steam = pick(STEAMS, looked.steam, 'none');
    host.appendChild(h('li', { text: 'Steam: ' + STEAMS[steam] + '.' }));
    var mo2 = looked.mo2 || {};
    var mo2Text = mo2.used
      ? 'Mod Organizer 2: read' + (mo2.profile ? ' (profile ' + tidy(mo2.profile, 60) + ')' : '') + (mo2.modFolders !== undefined ? ', ' + num(mo2.modFolders) + ' mod folders' : '') + '.'
      : 'Mod Organizer 2: not used. ' + tidy(mo2.reason, 200);
    host.appendChild(h('li', { text: mo2Text }));
    var p = looked.plugins;
    if (p && typeof p === 'object') {
      var text = 'Plugins: ' + num(p.listed) + ' listed, ' + num(p.active) + ' active, ' + num(p.read) + ' read';
      if (num(p.unreadable) > 0) text += ', ' + num(p.unreadable) + " couldn't be read";
      text += p.complete === false ? '. Some were skipped.' : '.';
      host.appendChild(h('li', { text: text }));
    }
    var v = looked.vortex;
    if (v && typeof v === 'object') {
      host.appendChild(h('li', {
        text: v.record
          ? "Vortex: its deployment record in the game's Data folder names the staging folder" + (typeof v.method === 'string' ? ' (method ' + tidy(v.method, 40) + ')' : '') + '.'
          : "Vortex: no deployment record naming a staging folder in the game's Data folder."
      }));
    }
    show('where', true);
  }

  function renderControls(r) {
    show('controls', true);
    // Deck checks only apply on Linux, so only there is there anything to choose.
    var choose = r.platform === 'linux';
    el('area-row').hidden = !choose;
    if (choose) el('area').value = pick({ all: 1, setup: 1, deck: 1 }, state.args.area, 'all');
    updateCapabilities();
  }

  function updateCapabilities() {
    var caps = window.mwApp.capabilities();
    el('btn-ask').hidden = !(caps && caps.message) || !state.report;
    el('btn-copy').hidden = !state.text;
  }

  function showReport(r) {
    state.report = r;
    show('waiting', false);
    show('problem', false);
    show('plain', false);
    renderVerdict(r);
    renderChips(r);
    renderFindings(r);
    renderBlind(r);
    renderWhere(r);
    renderControls(r);
    el('note').textContent = '';
    var now = new Date();
    el('foot-time').textContent = 'Checked ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    show('foot', true);
    el('mw-root').classList.remove('fade');
    void el('mw-root').offsetWidth;
    el('mw-root').classList.add('fade');
    window.mwApp.resized();
  }

  // Everything that belongs to a finished report, put away when what comes back isn't one.
  function hideReport() {
    state.report = null;
    ['verdict', 'chips', 'findings', 'blind', 'limits', 'legend', 'where'].forEach(function (id) { show(id, false); });
    el('mw-root').setAttribute('data-verdict', '');
    el('ctx').hidden = true;
  }

  function showProblem(title, detail, hint) {
    hideReport();
    show('waiting', false);
    show('plain', false);
    var box = el('problem');
    clear(box);
    box.appendChild(h('p', {}, [h('b', { text: tidy(title, 300) })]));
    if (detail) box.appendChild(h('p', { text: tidy(detail, 600) }));
    if (hint) box.appendChild(h('p', { class: 'muted', text: tidy(hint, 600) }));
    box.hidden = false;
    show('controls', true);
    el('area-row').hidden = true;
    el('foot-time').textContent = '';
    show('foot', true);
    updateCapabilities();
    window.mwApp.resized();
  }

  function showTextOnly(text) {
    hideReport();
    show('waiting', false);
    show('problem', false);
    var box = el('plain');
    box.textContent = String(text).slice(0, 20000);
    box.hidden = false;
    show('controls', true);
    el('area-row').hidden = true;
    el('foot-time').textContent = '';
    show('foot', true);
    updateCapabilities();
    window.mwApp.resized();
  }

  // ── Results from the host ─────────────────────────────────────────────────

  function firstText(result) {
    var content = result && Array.isArray(result.content) ? result.content : [];
    for (var i = 0; i < content.length; i++) {
      if (content[i] && content[i].type === 'text' && typeof content[i].text === 'string') return content[i].text;
    }
    return '';
  }

  function handleResult(result) {
    if (!result || typeof result !== 'object') return;
    state.gotResult = true;
    state.text = firstText(result);
    var data = result.structuredContent;
    if (data && typeof data === 'object' && data.ok === true) showReport(data);
    else if (data && typeof data === 'object' && data.ok === false) showProblem("The Doctors couldn't run.", data.error, data.hint);
    else if (result.isError) showProblem("The Doctors couldn't run.", state.text);
    else if (state.text) showTextOnly(state.text);
    else showProblem('The check returned nothing this page can show.');
    updateCapabilities();
  }

  function runCheck(args) {
    if (state.busy) return;
    state.args = copyObject(args);
    setBusy(true);
    window.mwApp.callTool(TOOL, state.args).then(function (result) {
      setBusy(false);
      handleResult(result);
    }, function (error) {
      setBusy(false);
      state.canCall = false;
      showProblem("Your editor didn't run the check from this page.", tidy(error && error.message, 300), 'Ask in the chat instead, for example: is my setup ready?');
      el('btn-recheck').hidden = true;
      el('area-row').hidden = true;
    });
  }

  function argsFor(area) {
    var args = copyObject(state.baseArgs);
    if (area === 'setup' || area === 'deck') args.area = area;
    else delete args.area;
    return args;
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      function fallback() {
        var box = el('copy-box');
        box.value = text;
        box.hidden = false;
        box.focus();
        box.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
        if (copied) box.hidden = true;
        window.mwApp.resized();
        resolve(copied);
      }
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, fallback);
      } else {
        fallback();
      }
    });
  }

  // ── Buttons ───────────────────────────────────────────────────────────────

  el('btn-recheck').addEventListener('click', function () { runCheck(state.args); });
  el('btn-run').addEventListener('click', function () { runCheck(state.args); });
  el('btn-area').addEventListener('click', function () { runCheck(argsFor(el('area').value)); });
  el('btn-copy').addEventListener('click', function () {
    copyText(state.text).then(function (copied) {
      say(copied ? 'Summary copied.' : 'Press Ctrl+C (or Cmd+C) to copy the selected text.');
      window.mwApp.resized();
    });
  });
  // The message goes into the chat as the person's own words, so it is a fixed sentence: nothing from the
  // result (plugin and mod names are other people's text), and the AI already has the result.
  el('btn-ask').addEventListener('click', function () {
    if (!state.report) return;
    var message = 'Please walk me through the latest result from the Doctors, starting with the most important thing.';
    window.mwApp.sendMessage(message).then(function () {
      say('Sent to the chat.');
      window.mwApp.resized();
    }, function () {
      say("Your editor didn't take the message. You can ask in the chat directly.");
      window.mwApp.resized();
    });
  });

  // ── Host wiring ───────────────────────────────────────────────────────────

  window.mwApp.on('input', function (params) {
    var args = params && params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    state.args = copyObject(args);
    state.baseArgs = copyObject(args);
    delete state.baseArgs.area;
  });
  window.mwApp.on('result', handleResult);
  window.mwApp.on('cancelled', function () { if (!state.gotResult) say('The check was cancelled.'); });
  window.mwApp.on('context', updateCapabilities);
  window.mwApp.on('teardown', function () { state.busy = false; });

  window.mwApp.start('modwrench-doctor', '1', function () {
    state.canCall = false;
    say("This page couldn't reach your editor. The answer is in the chat.");
  });
  window.setTimeout(function () {
    if (!state.gotResult && !state.busy && state.canCall) el('btn-run').hidden = false;
  }, 6000);
})();
`;

/** The Doctor page, as the HTML an MCP Apps host loads for `ui://modwrench/doctor`. */
export function renderDoctorApp(): string {
  return renderApp({ title: "Doctor", css: CSS, body: BODY, script: SCRIPT });
}
