// ─── The Crash Whisperer page ────────────────────────────────────────────────
// What `mw_crash_whisperer` returns, drawn as a page: what happened and which names
// the log points at, how sure that is and what it rests on, the setup checks, the
// call stack, and the posts to ask for help with, ready to copy. It is an MCP App
// (see app.ts), so a client that supports the extension draws it and every other
// client shows the plain-text answer the tool returns, with nothing extra in the
// conversation.
//
// The page is a pure function of the tool result. It keeps nothing, stores nothing
// and makes no network requests (its own Content-Security-Policy forbids them). Its
// buttons ask the host to call the same read-only tool again, with different
// arguments: read again, read the newest log, compare or don't compare with the
// other recent crashes, leave the plugin lists out of the posts, or read a log the
// person pastes into the box.
//
// Everything that comes from the person's machine (log lines, plugin and mod names,
// folder names the install reports) is another author's text. It is only ever put
// on the page with textContent, never as markup, so a mod called `<img onerror=...>`
// is just a strange name. The help packets are put in a read-only text box by value.

import { renderApp } from "./app.js";

const CSS = String.raw`
.app{max-width:800px;margin:0 auto;padding:14px 16px 16px;
  padding-top:calc(14px + var(--safe-top,0px));padding-right:calc(16px + var(--safe-right,0px));
  padding-bottom:calc(16px + var(--safe-bottom,0px));padding-left:calc(16px + var(--safe-left,0px))}
.top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;color:var(--sub);font-size:12px;letter-spacing:.02em}
.brand b{color:var(--ink);font-weight:600}
.waiting{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 8px}
.status{margin:0;color:var(--sub)}
.fade{animation:mwfade .2s ease-out}
@keyframes mwfade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}

.headline{display:flex;gap:16px;align-items:flex-start;padding:16px 18px;border-radius:calc(var(--radius) + 2px);
  border:1px solid var(--line);border-left:5px solid var(--tone,var(--line));background:var(--panel)}
.app[data-lead="strong"]{--tone:var(--warn)}
.app[data-lead="possible"]{--tone:var(--focus)}
.hmark{flex:none;color:var(--tone,var(--sub))}
.hmark svg{width:44px;height:44px;fill:none;stroke:currentColor;display:block}
.htag{margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--sub);overflow-wrap:anywhere}
.hword{margin:0;font-size:19px;line-height:1.35;font-weight:700;overflow-wrap:anywhere}

.problem{margin-top:12px;padding:12px 14px;border:1px solid var(--bad);border-radius:var(--radius);background:var(--bad-bg);color:var(--ink)}
.problem b{color:var(--bad)}
.problem p{margin:4px 0 0;overflow-wrap:anywhere}
.problem ul{margin:6px 0 0;padding-left:20px}
.plain{margin:12px 0 0;padding:12px 14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--mono);font-size:12.5px}

.sure{margin:12px 0 0;padding:10px 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
.sure-top{display:flex;gap:12px;align-items:flex-start}
.sure p{margin:0;overflow-wrap:anywhere}
.evid{display:flex;flex-direction:column;gap:5px;flex:none;min-width:64px;padding-top:3px}
.evid-k{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--sub)}
.gauge{display:flex;gap:3px}
.seg{width:16px;height:8px;border-radius:2px;border:1px solid var(--sub)}
.seg.on{background:var(--ink);border-color:var(--ink)}
.mix{margin-top:10px}
.mixbar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--line);gap:2px}
.mixbar i{display:block;height:100%;min-width:3px}
.m-log{background:var(--ink)}
.m-install{background:var(--focus)}
.m-rule{background:var(--sub)}
.m-guess{background:repeating-linear-gradient(45deg,var(--warn) 0 3px,transparent 3px 6px);outline:1px solid var(--warn);outline-offset:-1px}
.mixkey{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--sub)}
.mixkey b{color:var(--ink)}

.block{margin-top:18px}
.h2{margin:0 0 8px;font-size:15px;font-weight:700;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.count{font-weight:400;color:var(--sub);font-size:12.5px}
.calm{margin:0;color:var(--sub)}
.p{margin:0 0 6px;overflow-wrap:anywhere}
.small{font-size:12.5px}
.muted{color:var(--sub)}
.mt{margin-top:8px}
code{overflow-wrap:anywhere}

.llist{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.lead{padding:12px 14px;border:1px solid var(--line);border-left-width:4px;border-radius:var(--radius);background:var(--panel)}
.lead[data-strength="strong"]{border-left-color:var(--warn)}
.lead[data-strength="possible"]{border-left-color:var(--focus)}
.lead[data-strength="faint"]{border-left-style:dashed}
.lhead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lrank{font-weight:800;color:var(--sub);min-width:1.4em}
.lname{font-size:14px;font-weight:700;overflow-wrap:anywhere}
.badge{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:1px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.lead[data-strength="strong"] .st{color:var(--warn)}
.lead[data-strength="possible"] .st{color:var(--focus)}
.lead[data-strength="faint"] .st{color:var(--sub);border-style:dashed}
.recur{font-size:12px;color:var(--sub)}
.lsum{margin:6px 0 0;overflow-wrap:anywhere}
.lmeta{margin:6px 0 0;font-size:12.5px;color:var(--sub);overflow-wrap:anywhere}
.lflag{margin:6px 0 0;padding:6px 10px;border:1px solid var(--bad);border-radius:var(--radius);background:var(--bad-bg);font-size:12.5px;overflow-wrap:anywhere}
.ev{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:5px}
.ev li{display:flex;gap:8px;align-items:baseline;font-size:13px}
.ev li span:last-child{overflow-wrap:anywhere;min-width:0}
.basis{flex:none;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:0 7px;border-radius:999px;border:1px solid var(--sub);color:var(--sub);white-space:nowrap}
.basis[data-basis="log"]{border-style:solid;color:var(--ink);border-color:var(--ink)}
.basis[data-basis="install"]{border-style:solid;color:var(--focus);border-color:var(--focus)}
.basis[data-basis="rule"]{border-style:double;border-width:3px;padding:0 5px}
.basis[data-basis="guess"]{border-style:dotted;color:var(--warn);border-color:var(--warn)}

.clist{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.check{padding:10px 12px;border:1px solid var(--line);border-left-width:4px;border-radius:var(--radius);background:var(--panel)}
.check[data-severity="problem"]{border-left-color:var(--bad)}
.check[data-severity="note"]{border-left-color:var(--warn)}
.chead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ctitle{font-weight:600;overflow-wrap:anywhere}
.check[data-severity="problem"] .sev{color:var(--bad)}
.check[data-severity="note"] .sev{color:var(--warn)}
.check[data-severity="info"] .sev{color:var(--sub)}
.cdetail{margin:6px 0 0;overflow-wrap:anywhere}
.cfix{margin:6px 0 0;overflow-wrap:anywhere}
.cfix b{font-weight:700}

.more{margin-top:12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
.more>summary{cursor:pointer;padding:9px 12px;font-weight:600}
.more>:not(summary){margin:0;padding:0 12px 10px}
.more ul{padding-left:30px}
.more li{margin:4px 0;overflow-wrap:anywhere}
.legend dt{font-weight:600;margin-top:6px}
.legend dd{margin:0;color:var(--sub)}

.stack{margin:0;padding:0;list-style:none;font-family:var(--mono);font-size:12px;display:grid;gap:2px}
.stack li{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin:0;padding:2px 0}
.fidx{flex:none;min-width:2.6em;color:var(--sub);text-align:right}
.fmod{overflow-wrap:anywhere}
.stack li[data-kind="mod"] .fmod{font-weight:700}
.stack li[data-scan="true"]{opacity:.7}
.fnote{font-family:var(--font);font-size:11.5px;color:var(--sub)}

.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}
.tab{min-height:32px;padding:4px 12px;border:1px solid var(--line);border-radius:999px;background:var(--panel);cursor:pointer;font-size:13px}
.tab[aria-selected="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink);font-weight:600}
.pwhere{margin:0 0 6px;color:var(--sub);font-size:12.5px}
.ptitle{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 6px}
.ptitle code{font-size:12.5px;flex:1 1 220px}
.postbox{width:100%;min-height:240px;max-height:60vh;resize:vertical;font-family:var(--mono);font-size:12px;line-height:1.45;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius);padding:8px}
.pfoot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px}
.redacted{margin:8px 0 0;font-size:12.5px;color:var(--sub);overflow-wrap:anywhere}

.steps{margin:0;padding-left:22px}
.steps li{margin:6px 0;overflow-wrap:anywhere}

.controls{margin-top:18px;padding-top:14px;border-top:1px solid var(--line);display:grid;gap:10px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.check-row{display:flex;gap:8px;align-items:flex-start}
.check-row input{margin-top:3px}
.btn.small{min-height:30px;padding:3px 10px;font-size:12.5px}
.note{margin:0;color:var(--sub)}
.pastebox{width:100%;min-height:110px;resize:vertical;font-family:var(--mono);font-size:12px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius);padding:8px}
.select{min-height:30px;padding:3px 8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg)}
.copybox{width:100%;min-height:100px;margin-top:10px;font-family:var(--mono);font-size:12px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius);padding:8px}
.foot{margin-top:14px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;color:var(--sub);font-size:12px}
`;

const BODY = String.raw`
<div id="mw-root" class="app" data-lead="">
  <header class="top">
    <span class="brand">ModWrench <b>Crash Whisperer</b></span>
  </header>

  <div id="waiting" class="waiting">
    <p id="status" class="status" role="status" aria-live="polite">Waiting for the log to be read. If this stays here, the answer is in the chat.</p>
    <button id="btn-run" class="btn small" type="button" hidden>Read the newest crash log</button>
  </div>

  <section id="headline" class="headline" hidden aria-labelledby="headline-text">
    <div class="hmark" aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false"><circle cx="20" cy="20" r="13" stroke-width="3.5"/><path d="M30 30l13 13" stroke-width="5" stroke-linecap="round"/><path d="M14 20h4l2-5 3 10 2-5h3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div>
      <p id="headline-tag" class="htag"></p>
      <h1 id="headline-text" class="hword"></h1>
    </div>
  </section>

  <div id="problem" class="problem" role="alert" hidden></div>
  <pre id="plain" class="plain" hidden></pre>

  <section id="sure" class="sure" hidden aria-label="How sure this is"></section>
  <section id="happened" class="block" hidden></section>
  <section id="leads" class="block" hidden></section>
  <section id="checks" class="block" hidden></section>
  <details id="stack" class="more" hidden><summary id="stack-sum">Call stack</summary><div id="stack-body"></div></details>
  <section id="packets" class="block" hidden></section>
  <section id="steps" class="block" hidden></section>

  <section id="controls" class="controls" hidden aria-label="Actions">
    <div class="row">
      <button id="btn-recheck" class="btn primary" type="button">Read again</button>
      <button id="btn-newest" class="btn" type="button">Read the newest log</button>
      <button id="btn-copy" class="btn" type="button" hidden>Copy summary</button>
      <button id="btn-ask" class="btn" type="button" hidden>Ask about this</button>
    </div>
    <label id="recent-row" class="check-row" for="chk-recent" hidden><input id="chk-recent" type="checkbox" checked><span>Compare with my other recent crashes, to see whether the same name keeps coming up</span></label>
    <label class="check-row" for="chk-hide"><input id="chk-hide" type="checkbox"><span>Leave my plugin lists out of the posts</span></label>
    <p id="note" class="note" role="status" aria-live="polite"></p>
    <textarea id="copy-box" class="copybox" readonly hidden aria-label="Text to copy"></textarea>
  </section>

  <details id="paste" class="more" hidden>
    <summary>Read a log I paste here</summary>
    <div>
      <p class="muted small">Paste the whole log. ModWrench takes out the personal details it recognises (your user name, computer name, folders, addresses, keys) before it reads it. It can miss things, so read a help post before you send it. For a very large log, leave this empty and ask for the newest one instead: ModWrench reads big files itself.</p>
      <textarea id="paste-box" class="pastebox" spellcheck="false" aria-label="Crash log text"></textarea>
      <div class="row mt">
        <button id="btn-paste" class="btn" type="button">Read this log</button>
        <label for="paste-type" class="muted small">Format</label>
        <select id="paste-type" class="select">
          <option value="auto">Work it out</option>
          <option value="crashlogger-sse">Crash Logger SSE</option>
          <option value="buffout4">Buffout 4</option>
          <option value="netscriptframework">NetScriptFramework</option>
          <option value="bepinex">BepInEx</option>
        </select>
        <span id="paste-note" class="muted small" role="status" aria-live="polite"></span>
      </div>
    </div>
  </details>

  <details id="limits" class="more" hidden><summary>What this can't tell you</summary><ul id="limits-list"></ul></details>
  <details id="legend" class="more" hidden>
    <summary>How to read the labels</summary>
    <dl class="legend">
      <dt>Log</dt><dd>The crash log says so.</dd>
      <dt>Your files</dt><dd>Your own files say so: what is installed, and which version.</dd>
      <dt>Rule</dt><dd>A published rule or documented behaviour, such as what a Windows exception means or SKSE's own compatibility check.</dd>
      <dt>Guess</dt><dd>ModWrench's own inference: the ranking of leads, matching one file's name to another's. A lead to check, never a finding.</dd>
      <dt>Strong, possible, faint</dt><dd>How directly a name sits in the crash. Even a strong lead can be innocent: the log records where the game stopped, not why.</dd>
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

  var TOOL = 'mw_crash_whisperer';
  var state = {
    baseArgs: {}, args: {}, report: null, text: '', busy: false, canCall: true, gotResult: false,
    venue: 'forum', showWeak: false
  };

  var STRENGTH = { strong: 'Strong lead', possible: 'Possible lead', faint: 'Faint lead' };
  var SEVERITY = { problem: 'Problem', note: 'Note', info: 'Info' };
  var BASIS = {
    log: { label: 'Log', tip: 'The crash log says so.' },
    install: { label: 'Your files', tip: 'Your own files say so: what is installed, and which version.' },
    rule: { label: 'Rule', tip: 'A published rule or documented behaviour, applied to what the log and your files show.' },
    guess: { label: 'Guess', tip: "ModWrench's own inference: a lead to check, never a finding." }
  };
  var BASIS_ORDER = ['log', 'install', 'rule', 'guess'];
  var EVIDENCE = {
    partial: { label: 'Thin', full: 'a log that is missing the part that matters', level: 1 },
    log: { label: 'Log', full: 'the crash log alone', level: 2 },
    'log-and-install': { label: 'Log + files', full: 'the crash log checked against your files', level: 3 }
  };
  var KIND = {
    game: "the game's own code", extender: 'the script extender', system: 'Windows', graphics: 'the graphics layer',
    overlay: 'an overlay or loader', framework: 'the runtime (Unity, .NET or the mod loader)', mod: 'a mod',
    unknown: "code that isn't from a mod ModWrench can identify"
  };
  var FORMAT = {
    'crashlogger-sse': 'Crash Logger SSE', buffout4: 'Buffout 4', netscriptframework: 'NetScriptFramework', bepinex: 'BepInEx'
  };
  var VENUES = [['forum', 'Forum'], ['github', 'GitHub'], ['discord', 'Discord'], ['author', 'Mod author']];
  var STRONG_SHOWN = 3;
  // The most the tool takes as pasted text (MAX_PASTE in the workbench's crashwhisper/index.ts). The box
  // has no maxlength of its own: a browser would drop the rest of a longer log without a word.
  var MAX_PASTE = 4000000;

  function el(id) { return document.getElementById(id); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function num(value) { var n = Number(value); return isFinite(n) ? n : 0; }
  function copyObject(source) {
    var out = {};
    if (source && typeof source === 'object') Object.keys(source).forEach(function (k) { out[k] = source[k]; });
    return out;
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

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // A line of feedback: next to the buttons once there are buttons, otherwise in the waiting area.
  function say(text) {
    if (!el('controls').hidden) { el('note').textContent = text; return; }
    el('status').textContent = text;
    show('waiting', true);
  }

  function setBusy(on) {
    state.busy = on;
    el('mw-root').setAttribute('aria-busy', on ? 'true' : 'false');
    ['btn-recheck', 'btn-newest', 'btn-run', 'btn-paste', 'chk-recent', 'chk-hide'].forEach(function (id) { el(id).disabled = on; });
    if (on) say('Reading the log…');
    else { el('note').textContent = ''; el('paste-note').textContent = ''; }
  }

  function basisChip(basis) {
    var b = BASIS[basis] ? basis : 'guess';
    return h('span', { class: 'basis', 'data-basis': b, title: BASIS[b].tip, text: BASIS[b].label });
  }

  // ── Pieces of the page ────────────────────────────────────────────────────

  function strongest(r) {
    var leads = Array.isArray(r.leads) ? r.leads : [];
    var first = leads[0];
    return first && STRENGTH[first.strength] ? first.strength : 'none';
  }

  function renderHeadline(r) {
    el('mw-root').setAttribute('data-lead', strongest(r));
    var c = r.crash || {};
    var game = c.game || {};
    var bits = [];
    if (game.name) bits.push(tidy(game.name, 60) + (game.version ? ' ' + tidy(game.version, 24) : ''));
    if (c.format && FORMAT[c.format]) bits.push(FORMAT[c.format]);
    if (c.time) bits.push('crashed ' + tidy(c.time, 20));
    el('headline-tag').textContent = bits.join(' · ');
    el('headline-text').textContent = tidy(r.headline, 700);
    show('headline', true);
  }

  function renderSure(r) {
    var host = el('sure');
    clear(host);
    var conf = r.confidence || {};
    var ev = EVIDENCE[conf.evidence] || EVIDENCE.log;
    var gauge = h('div', { class: 'gauge', role: 'img', 'aria-label': 'Evidence: ' + ev.full + ', level ' + ev.level + ' of 3' }, [
      h('span', { class: ev.level >= 1 ? 'seg on' : 'seg' }),
      h('span', { class: ev.level >= 2 ? 'seg on' : 'seg' }),
      h('span', { class: ev.level >= 3 ? 'seg on' : 'seg' })
    ]);
    var top = h('div', { class: 'sure-top' }, [
      h('div', { class: 'evid' }, [gauge, h('span', { class: 'evid-k', text: ev.label, 'aria-hidden': 'true' })]),
      h('p', { text: tidy(conf.summary, 900) })
    ]);
    host.appendChild(top);

    var counts = conf.basis || {};
    var total = 0;
    BASIS_ORDER.forEach(function (k) { total += num(counts[k]); });
    if (total > 0) {
      var bar = h('div', { class: 'mixbar', role: 'img', 'aria-label': 'What the statements rest on: ' + BASIS_ORDER.map(function (k) { return num(counts[k]) + ' ' + BASIS[k].label.toLowerCase(); }).join(', ') });
      BASIS_ORDER.forEach(function (k) {
        if (num(counts[k]) > 0) {
          var piece = h('i', { class: 'm-' + k });
          piece.style.width = (num(counts[k]) / total * 100) + '%';
          bar.appendChild(piece);
        }
      });
      var key = h('ul', { class: 'mixkey' });
      BASIS_ORDER.forEach(function (k) {
        key.appendChild(h('li', {}, [h('b', { text: String(num(counts[k])) }), ' ' + BASIS[k].label.toLowerCase()]));
      });
      host.appendChild(h('div', { class: 'mix' }, [bar, key]));
    }
    show('sure', true);
  }

  function renderHappened(r) {
    var host = el('happened');
    clear(host);
    var c = r.crash || {};
    var ex = c.exception;
    var site = c.site;
    if (!ex && !site) { show('happened', false); return; }
    host.appendChild(h('h2', { class: 'h2', text: 'What happened' }));
    if (ex) {
      host.appendChild(h('p', { class: 'p' }, [ex.type ? h('code', { text: tidy(ex.type, 80) }) : null, ex.type && ex.plain ? ': ' : null, ex.plain ? tidy(ex.plain, 900) : null]));
    }
    if (site) {
      var where = tidy(site.module, 60) + (site.offset ? '+' + tidy(site.offset, 16) : '');
      var label = c.format === 'bepinex' ? 'Where the error began' : 'Where it stopped';
      host.appendChild(h('p', { class: 'p muted' }, [label + ': frame ' + num(site.index) + ', ', h('code', { text: where }), ' (' + (KIND[site.kind] || KIND.unknown) + ').']));
    }
    show('happened', true);
  }

  function installLines(lead) {
    var nodes = [];
    var ins = lead.install;
    if (!ins) return nodes;
    if (ins.present === false) {
      nodes.push(h('p', { class: 'lmeta', text: "In your files: it isn't in your plugin folders any more." }));
      return nodes;
    }
    var bits = [];
    if (ins.source) bits.push('from ' + tidy(ins.source, 80));
    if (ins.version) bits.push('version ' + tidy(ins.version, 24));
    if (ins.declaredName) bits.push('calls itself “' + tidy(ins.declaredName, 60) + '”');
    if (bits.length > 0) nodes.push(h('p', { class: 'lmeta', text: 'In your files: ' + bits.join(', ') + '.' }));
    if (ins.flagged) {
      var basis = ins.flagged.basis === 'inferred' ? 'guess' : 'rule';
      nodes.push(h('p', { class: 'lflag' }, [
        h('b', { text: ins.flagged.status === 'broken' ? 'Patch Day says this plugin is broken for your game version. ' : 'Patch Day can\'t tell whether this plugin works with your game version. ' }),
        tidy(ins.flagged.reason, 300) + ' ',
        basisChip(basis)
      ]));
    }
    return nodes;
  }

  function leadItem(lead) {
    var strength = STRENGTH[lead.strength] ? lead.strength : 'faint';
    var head = h('div', { class: 'lhead' }, [
      h('span', { class: 'lrank', text: '#' + num(lead.rank) }),
      h('code', { class: 'lname', text: tidy(lead.name, 80) }),
      h('span', { class: 'badge st', text: STRENGTH[strength] })
    ]);
    var rec = lead.recurrence;
    if (rec && num(rec.logs) > 0) {
      head.appendChild(h('span', { class: 'recur', text: 'also a lead in ' + num(rec.logs) + ' of ' + plural(num(rec.of), 'other crash', 'other crashes') }));
    }
    var item = h('li', { class: 'lead', 'data-strength': strength }, [head, h('p', { class: 'lsum', text: tidy(lead.summary, 300) })]);
    var files = Array.isArray(lead.files) ? lead.files.map(function (f) { return tidy(f, 80); }).filter(function (f) { return f && f !== tidy(lead.name, 80); }) : [];
    if (files.length > 0) item.appendChild(h('p', { class: 'lmeta', text: 'Also: ' + files.slice(0, 6).join(', ') + (files.length > 6 ? ', and ' + (files.length - 6) + ' more' : '') }));
    installLines(lead).forEach(function (n) { item.appendChild(n); });
    var evidence = Array.isArray(lead.evidence) ? lead.evidence : [];
    if (evidence.length > 0) {
      var list = h('ul', { class: 'ev' });
      evidence.slice(0, 10).forEach(function (e) {
        list.appendChild(h('li', {}, [basisChip(e && e.basis), h('span', { text: tidy(e && e.text, 420) })]));
      });
      item.appendChild(list);
    }
    return item;
  }

  function renderLeads(r) {
    var host = el('leads');
    clear(host);
    var leads = Array.isArray(r.leads) ? r.leads : [];
    host.appendChild(h('h2', { class: 'h2' }, ['Leads', h('span', { class: 'count', text: "names the log points at, ranked by ModWrench's own scoring. A lead is not a finding." })]));
    if (leads.length === 0) {
      host.appendChild(h('p', { class: 'calm', text: 'None. Nothing from a mod was on the call stack or among the objects the logger lists.' }));
      show('leads', true);
      return;
    }
    var shown = state.showWeak ? leads.length : Math.min(leads.length, STRONG_SHOWN);
    var list = h('ul', { class: 'llist' });
    leads.slice(0, shown).forEach(function (lead) { list.appendChild(leadItem(lead || {})); });
    host.appendChild(list);
    if (leads.length > shown) {
      var more = h('button', { class: 'btn small mt', type: 'button', text: 'Show ' + plural(leads.length - shown, 'weaker lead', 'weaker leads') });
      more.addEventListener('click', function () { state.showWeak = true; if (state.report) renderLeads(state.report); window.mwApp.resized(); });
      host.appendChild(more);
    }
    show('leads', true);
  }

  function renderChecks(r) {
    var host = el('checks');
    clear(host);
    var checks = Array.isArray(r.checks) ? r.checks : [];
    var problems = 0;
    checks.forEach(function (c) { if (c && c.severity === 'problem') problems++; });
    host.appendChild(h('h2', { class: 'h2' }, [
      'Checks',
      h('span', { class: 'count', text: checks.length === 0 ? 'nothing stood out' : problems > 0 ? plural(problems, 'problem', 'problems') + ' worth fixing first' : plural(checks.length, 'note', 'notes') })
    ]));
    if (checks.length === 0) {
      host.appendChild(h('p', { class: 'calm', text: 'Nothing in the setup stood out. That is not the same as nothing being wrong.' }));
      show('checks', true);
      return;
    }
    var list = h('ul', { class: 'clist' });
    checks.slice(0, 30).forEach(function (c) {
      c = c || {};
      var sev = SEVERITY[c.severity] ? c.severity : 'info';
      var item = h('li', { class: 'check', 'data-severity': sev }, [
        h('div', { class: 'chead' }, [h('span', { class: 'badge sev', text: SEVERITY[sev] }), h('span', { class: 'ctitle', text: tidy(c.title, 200) }), basisChip(c.basis)]),
        h('p', { class: 'cdetail', text: tidy(c.detail, 640) })
      ]);
      if (c.fix) item.appendChild(h('p', { class: 'cfix' }, [h('b', { text: 'Fix: ' }), tidy(c.fix, 440)]));
      list.appendChild(item);
    });
    host.appendChild(list);
    if (checks.length > 30) host.appendChild(h('p', { class: 'muted small mt', text: 'and ' + (checks.length - 30) + ' more in the full report.' }));
    show('checks', true);
  }

  function renderStack(r) {
    var c = r.crash || {};
    var frames = Array.isArray(c.frames) ? c.frames : [];
    if (frames.length === 0) { show('stack', false); return; }
    var body = el('stack-body');
    clear(body);
    var list = h('ol', { class: 'stack' });
    frames.slice(0, 60).forEach(function (f) {
      f = f || {};
      var kind = KIND[f.kind] ? f.kind : 'unknown';
      var li = h('li', { 'data-kind': kind, 'data-scan': f.scan ? 'true' : 'false' }, [
        h('span', { class: 'fidx', text: '[' + num(f.index) + ']' }),
        h('span', { class: 'fmod', text: tidy(f.module, 80) + (f.offset ? '+' + tidy(f.offset, 16) : '') + (f.function ? '  ' + tidy(f.function, 120) : '') }),
        h('span', { class: 'fnote', text: (f.scan ? 'stack scan · ' : '') + KIND[kind] })
      ]);
      list.appendChild(li);
    });
    body.appendChild(list);
    el('stack-sum').textContent = 'Call stack (' + plural(frames.length, 'frame shown', 'frames shown') + ')';
    show('stack', true);
  }

  // ── Help packets ──────────────────────────────────────────────────────────

  function renderPackets(r) {
    var host = el('packets');
    clear(host);
    var packets = r.packets || {};
    host.appendChild(h('h2', { class: 'h2' }, ['Ask for help', h('span', { class: 'count', text: 'posts with the personal details ModWrench recognised taken out. Read one before you post it.' })]));

    var tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Where to post' });
    VENUES.forEach(function (v) {
      var tab = h('button', { class: 'tab', type: 'button', role: 'tab', id: 'tab-' + v[0], 'aria-selected': state.venue === v[0] ? 'true' : 'false', 'aria-controls': 'tabpanel', tabindex: state.venue === v[0] ? '0' : '-1', text: v[1] });
      tab.addEventListener('click', function () { selectVenue(v[0]); });
      tab.addEventListener('keydown', function (event) {
        var at = -1;
        VENUES.forEach(function (x, i) { if (x[0] === state.venue) at = i; });
        var next = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? VENUES.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        next = (next + VENUES.length) % VENUES.length;
        selectVenue(VENUES[next][0]);
        var target = el('tab-' + VENUES[next][0]);
        if (target) target.focus();
      });
      tabs.appendChild(tab);
    });
    host.appendChild(tabs);

    var panel = h('div', { id: 'tabpanel', role: 'tabpanel' });
    panel.appendChild(h('p', { id: 'pwhere', class: 'pwhere' }));
    var title = h('div', { class: 'ptitle' }, [h('span', { class: 'muted small', text: 'Title' }), h('code', { id: 'ptitle-text' })]);
    var copyTitle = h('button', { id: 'btn-copy-title', class: 'btn small', type: 'button', text: 'Copy title' });
    copyTitle.addEventListener('click', function () { copyOut(currentPacket().title, null, 'Title copied.', 'pnote'); });
    title.appendChild(copyTitle);
    panel.appendChild(title);
    panel.appendChild(h('textarea', { id: 'postbox', class: 'postbox', readonly: true, spellcheck: 'false', 'aria-label': 'The post, ready to copy' }));
    var foot = h('div', { class: 'pfoot' });
    var copyPost = h('button', { id: 'btn-copy-post', class: 'btn primary small', type: 'button', text: 'Copy post' });
    copyPost.addEventListener('click', function () { copyOut(currentPacket().text, el('postbox'), 'Post copied.', 'pnote'); });
    foot.appendChild(copyPost);
    foot.appendChild(h('span', { id: 'pcount', class: 'muted small' }));
    foot.appendChild(h('span', { id: 'pnote', class: 'small', role: 'status', 'aria-live': 'polite' }));
    panel.appendChild(foot);
    panel.appendChild(h('p', { id: 'predacted', class: 'redacted' }));
    host.appendChild(panel);
    show('packets', true);
    fillPacket(r);
  }

  function currentPacket() {
    var packets = (state.report && state.report.packets) || {};
    return packets[state.venue] || { title: '', text: '', where: '', chars: 0, trimmed: false };
  }

  function fillPacket(r) {
    var p = currentPacket();
    el('tabpanel').setAttribute('aria-labelledby', 'tab-' + state.venue);
    el('pnote').textContent = '';
    el('pwhere').textContent = tidy(p.where, 200);
    el('ptitle-text').textContent = tidy(p.title, 240);
    el('postbox').value = String(p.text || '');
    var count = num(p.chars).toLocaleString() + ' characters';
    el('pcount').textContent = count + (p.trimmed ? ' · shortened to fit' : '');
    var red = r.redaction || {};
    el('predacted').textContent = tidy(red.summary, 600);
  }

  function selectVenue(venue) {
    state.venue = venue;
    VENUES.forEach(function (v) {
      var tab = el('tab-' + v[0]);
      if (!tab) return;
      tab.setAttribute('aria-selected', v[0] === venue ? 'true' : 'false');
      tab.setAttribute('tabindex', v[0] === venue ? '0' : '-1');
    });
    if (state.report) fillPacket(state.report);
    window.mwApp.resized();
  }

  function renderSteps(r) {
    var host = el('steps');
    clear(host);
    var steps = Array.isArray(r.nextSteps) ? r.nextSteps : [];
    if (steps.length === 0) { show('steps', false); return; }
    host.appendChild(h('h2', { class: 'h2', text: 'What to do next' }));
    var list = h('ol', { class: 'steps' });
    steps.forEach(function (s) { list.appendChild(h('li', { text: tidy(s, 700) })); });
    host.appendChild(list);
    show('steps', true);
  }

  function renderDetails(r) {
    var limits = Array.isArray(r.limits) ? r.limits : [];
    var list = el('limits-list');
    clear(list);
    limits.forEach(function (t) { list.appendChild(h('li', { text: tidy(t, 700) })); });
    show('limits', limits.length > 0);
    show('legend', true);

    var where = el('where-list');
    clear(where);
    var c = r.crash || {};
    var sources = { newest: 'the newest crash log on this computer', path: 'a log file you pointed at', pasted: 'a log that was pasted' };
    var logBits = [sources[c.source] || 'a crash log'];
    if (c.fileName) logBits.push('file ' + tidy(c.fileName, 80));
    if (c.written) logBits.push('written ' + tidy(c.written, 24));
    where.appendChild(h('li', { text: 'Log: ' + logBits.join(', ') + '.' }));
    var ins = r.install || {};
    where.appendChild(h('li', { text: ins.checked
      ? 'Your install: read' + (ins.gameVersion ? ' (game ' + tidy(ins.gameVersion, 24) + (ins.scriptExtender ? ', ' + tidy(ins.scriptExtender, 40) : '') + ')' : '') + (ins.modFolders !== undefined ? ', ' + plural(num(ins.modFolders), 'Mod Organizer 2 mod folder', 'Mod Organizer 2 mod folders') + ' with plugins' : '') + '.'
      : 'Your install: not read. ' + tidy(ins.reason, 240) }));
    var recent = r.recent || {};
    where.appendChild(h('li', { text: num(recent.examined) > 0 ? 'Other crash logs compared: ' + num(recent.examined) + '.' : 'Other crash logs compared: none.' }));
    show('where', true);
  }

  function renderControls() {
    // The comparison only runs on Crash Logger SSE and Buffout 4 logs of a game ModWrench recognised,
    // so the box is offered only for those.
    var c = (state.report && state.report.crash) || {};
    el('recent-row').hidden = !((c.format === 'crashlogger-sse' || c.format === 'buffout4') && c.game && c.game.id);
    el('chk-recent').checked = state.args.compareRecent === undefined || num(state.args.compareRecent) > 0;
    el('chk-hide').checked = state.args.hideNames === true;
    show('controls', true);
    show('paste', true);
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
    renderHeadline(r);
    renderSure(r);
    renderHappened(r);
    renderLeads(r);
    renderChecks(r);
    renderStack(r);
    renderPackets(r);
    renderSteps(r);
    renderDetails(r);
    renderControls();
    el('note').textContent = '';
    var now = new Date();
    el('foot-time').textContent = 'Read ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    show('foot', true);
    el('mw-root').classList.remove('fade');
    void el('mw-root').offsetWidth;
    el('mw-root').classList.add('fade');
    window.mwApp.resized();
  }

  // Everything that belongs to a finished report, put away when what comes back isn't one.
  function hideReport() {
    state.report = null;
    ['headline', 'sure', 'happened', 'leads', 'checks', 'stack', 'packets', 'steps', 'limits', 'legend', 'where', 'recent-row'].forEach(function (id) { show(id, false); });
    el('mw-root').setAttribute('data-lead', '');
  }

  function showProblem(title, detail, hint, looked) {
    hideReport();
    show('waiting', false);
    show('plain', false);
    var box = el('problem');
    clear(box);
    box.appendChild(h('p', {}, [h('b', { text: tidy(title, 300) })]));
    if (detail) box.appendChild(h('p', { text: tidy(detail, 600) }));
    if (hint) box.appendChild(h('p', { class: 'muted', text: tidy(hint, 700) }));
    if (Array.isArray(looked) && looked.length > 0) {
      box.appendChild(h('p', { class: 'muted', text: 'Where it looked:' }));
      var list = h('ul');
      looked.slice(0, 12).forEach(function (line) { list.appendChild(h('li', { text: tidy(line, 160) })); });
      box.appendChild(list);
    }
    box.hidden = false;
    show('controls', true);
    show('paste', true);
    el('paste').open = true;
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
    show('paste', true);
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
    else if (data && typeof data === 'object' && data.ok === false) showProblem("Crash Whisperer couldn't read a log.", data.error, data.hint, data.looked);
    else if (result.isError) showProblem("Crash Whisperer couldn't read a log.", state.text);
    else if (state.text) showTextOnly(state.text);
    else showProblem('The tool returned nothing this page can show.');
    updateCapabilities();
  }

  function runCheck(args, after) {
    if (state.busy) return;
    state.args = copyObject(args);
    setBusy(true);
    window.mwApp.callTool(TOOL, state.args).then(function (result) {
      setBusy(false);
      handleResult(result);
      if (after) after(result);
    }, function (error) {
      setBusy(false);
      state.canCall = false;
      showProblem("Your editor didn't run the tool from this page.", tidy(error && error.message, 300), 'Ask in the chat instead, for example: why did my game crash?');
      ['btn-recheck', 'btn-newest', 'btn-paste'].forEach(function (id) { el(id).hidden = true; });
    });
  }

  // The settings the buttons change, applied to whatever was asked last.
  function withSettings(args) {
    var out = copyObject(args);
    out.compareRecent = el('chk-recent').checked ? (num(state.baseArgs.compareRecent) > 0 ? num(state.baseArgs.compareRecent) : 5) : 0;
    if (el('chk-hide').checked) out.hideNames = true; else delete out.hideNames;
    return out;
  }

  // Copy text to the clipboard; when the host doesn't allow that, select it so Ctrl+C does.
  function copyOut(text, box, done, noteId) {
    function tell(message) {
      if (noteId) el(noteId).textContent = message; else say(message);
      window.mwApp.resized();
    }
    function fallback() {
      var target = box || el('copy-box');
      if (!box) { target.value = text; target.hidden = false; }
      target.focus();
      target.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
      if (copied && !box) target.hidden = true;
      tell(copied ? done : 'Press Ctrl+C (or Cmd+C) to copy the selected text.');
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () { tell(done); }, fallback);
    } else {
      fallback();
    }
  }

  // ── Buttons ───────────────────────────────────────────────────────────────

  el('btn-recheck').addEventListener('click', function () { runCheck(withSettings(state.args)); });
  el('btn-run').addEventListener('click', function () { runCheck(withSettings(state.args)); });
  el('btn-newest').addEventListener('click', function () {
    var args = withSettings(state.baseArgs);
    delete args.logPath;
    delete args.logContent;
    delete args.logType;
    runCheck(args);
  });
  el('chk-recent').addEventListener('change', function () { runCheck(withSettings(state.args)); });
  el('chk-hide').addEventListener('change', function () { runCheck(withSettings(state.args)); });
  el('btn-paste').addEventListener('click', function () {
    var text = el('paste-box').value;
    if (!text || !/\S/.test(text)) { el('paste-note').textContent = 'Paste a log into the box first.'; el('paste-box').focus(); return; }
    if (text.length > MAX_PASTE) {
      el('paste-note').textContent = 'That log is longer than the 4,000,000 characters ModWrench reads from a paste, so nothing was sent. For a log this big, leave the box empty and use Read the newest log: ModWrench reads big files itself.';
      return;
    }
    var args = withSettings(state.baseArgs);
    delete args.logPath;
    args.logContent = text;
    var type = el('paste-type').value;
    if (type && type !== 'auto') args.logType = type; else delete args.logType;
    runCheck(args, function (result) {
      var data = result && result.structuredContent;
      if (data && data.ok === true) { el('paste-box').value = ''; el('paste').open = false; }
    });
  });
  el('btn-copy').addEventListener('click', function () { copyOut(state.text, null, 'Summary copied.'); });
  // The message goes into the chat as the person's own words, so it is a fixed sentence: nothing from the
  // result (the names a log points at are chosen by whoever wrote the mod), and the AI already has the result.
  el('btn-ask').addEventListener('click', function () {
    if (!state.report) return;
    var message = 'Please walk me through the latest Crash Whisperer result: what to try first, and how sure we can be.';
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
    delete state.baseArgs.packet;
  });
  window.mwApp.on('result', handleResult);
  window.mwApp.on('cancelled', function () { if (!state.gotResult) say('Reading the log was cancelled.'); });
  window.mwApp.on('context', updateCapabilities);
  window.mwApp.on('teardown', function () { state.busy = false; });

  window.mwApp.start('modwrench-crash-whisperer', '1', function () {
    state.canCall = false;
    say("This page couldn't reach your editor. The answer is in the chat.");
  });
  window.setTimeout(function () {
    if (!state.gotResult && !state.busy && state.canCall) { el('btn-run').hidden = false; show('paste', true); }
  }, 6000);
})();
`;

/** The Crash Whisperer page, as the HTML an MCP Apps host loads for `ui://modwrench/crash-whisperer`. */
export function renderCrashWhispererApp(): string {
  return renderApp({ title: "Crash Whisperer", css: CSS, body: BODY, script: SCRIPT });
}
