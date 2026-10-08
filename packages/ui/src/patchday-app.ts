// ─── The Patch Day page ──────────────────────────────────────────────────────
// What `mw_patch_day` returns, drawn as a page: the verdict first, how sure it
// is, what needs attention, what to do. It is an MCP App (see app.ts), so a
// client that supports the extension draws it and every other client shows the
// plain-text answer the tool returns, with nothing extra in the conversation.
//
// The page is a pure function of the tool result. It keeps nothing, stores
// nothing and makes no network requests (its own Content-Security-Policy forbids
// them). Its two buttons ask the host to call the same read-only tool again.
//
// Everything that comes from the person's machine (plugin file names, mod folder
// names, log lines) is another author's text. It is only ever put on the page
// with textContent, never as markup, so a mod called `<img onerror=...>` is just
// a strange name.

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
.app[data-verdict="go"]{--tone:var(--go);--tone-bg:var(--go-bg)}
.app[data-verdict="check"]{--tone:var(--warn);--tone-bg:var(--warn-bg)}
.app[data-verdict="wait"]{--tone:var(--bad);--tone-bg:var(--bad-bg)}
.vmark{flex:none}
.vmark svg{display:none;width:52px;height:52px;fill:none;stroke:currentColor}
.app[data-verdict="go"] .vm-go,.app[data-verdict="check"] .vm-check,.app[data-verdict="wait"] .vm-wait{display:block}
.vtag{margin:0 0 2px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.vword{margin:0;font-size:30px;line-height:1.1;font-weight:800;letter-spacing:.07em}
.vline{margin:6px 0 0;color:var(--ink)}

.problem{margin-top:12px;padding:12px 14px;border:1px solid var(--bad);border-radius:var(--radius);background:var(--bad-bg);color:var(--ink)}
.problem b{color:var(--bad)}
.problem p{margin:4px 0 0}
.plain{margin:12px 0 0;padding:12px 14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--mono);font-size:12.5px}

.sure{display:flex;gap:12px;align-items:flex-start;margin:12px 0 0;padding:10px 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
.sure p{margin:0}
.evid{display:flex;flex-direction:column;gap:5px;flex:none;min-width:58px;padding-top:3px}
.evid-k{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--sub)}
.gauge{display:flex;gap:3px}
.seg{width:16px;height:8px;border-radius:2px;border:1px solid var(--sub)}
.seg.on{background:var(--ink);border-color:var(--ink)}

.clash{margin:12px 0 0;padding:12px 14px;border:1px solid var(--warn);border-radius:var(--radius);background:var(--warn-bg)}
.clash .h2{margin-bottom:4px}
.clash p{margin:0}

.chips{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;gap:6px;align-items:baseline;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel);font-size:12.5px}
.chip-i{font-weight:800;min-width:1em;text-align:center}
.chip[data-tone="ok"] .chip-i{color:var(--go)}
.chip[data-tone="warn"] .chip-i{color:var(--warn)}
.chip[data-tone="bad"] .chip-i{color:var(--bad)}
.chip-k{color:var(--sub)}
.chip-v{font-weight:600}

.block{margin-top:18px}
.h2{margin:0 0 8px;font-size:15px;font-weight:700;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.count{font-weight:400;color:var(--sub);font-size:12.5px}
.bar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--line);margin:0 0 10px}
.bar i{display:block;height:100%}
.b-ok{background:var(--go)}
.b-unclear{background:var(--warn)}
.b-broken{background:var(--bad)}
.calm{margin:0;color:var(--sub)}
.plist{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.prow{padding:10px 12px;border:1px solid var(--line);border-left-width:4px;border-radius:var(--radius);background:var(--panel)}
.prow[data-status="broken"]{border-left-color:var(--bad)}
.prow[data-status="unclear"]{border-left-color:var(--warn)}
.phead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pfile{font-size:13px;font-weight:600;overflow-wrap:anywhere}
.pname{color:var(--sub);font-size:12.5px;overflow-wrap:anywhere}
.badge{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:1px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.prow[data-status="broken"] .st{color:var(--bad)}
.prow[data-status="unclear"] .st{color:var(--warn)}
.preason{margin:6px 0 0;overflow-wrap:anywhere}
.pmeta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;color:var(--sub);font-size:12.5px}
.basis{color:var(--sub)}
.basis[data-basis="skse-source"],.basis[data-basis="f4se-source"]{border-style:solid;color:var(--ink)}
.basis[data-basis="field-reports"]{border-style:dashed}
.basis[data-basis="inferred"]{border-style:dotted}
.psrc{overflow-wrap:anywhere}
.pskse{margin:6px 0 0;font-family:var(--mono);font-size:12px;color:var(--sub);overflow-wrap:anywhere}
.small{font-size:12.5px}
.muted{color:var(--sub)}
.names{margin:6px 0 0;font-family:var(--mono);font-size:12px;color:var(--sub);overflow-wrap:anywhere}
.plain-list{margin:6px 0 0;padding-left:20px}
.plain-list li{margin:3px 0;overflow-wrap:anywhere}
.steps{margin:0;padding-left:22px}
.steps li{margin:6px 0;overflow-wrap:anywhere}

.controls{margin-top:18px;padding-top:14px;border-top:1px solid var(--line);display:grid;gap:10px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lbl{color:var(--sub)}
.input{min-height:36px;width:9.5em;padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg)}
.btn.small{min-height:30px;padding:3px 10px;font-size:12.5px}
.mt{margin-top:8px}
.note{margin:0;color:var(--sub)}

.more{margin-top:12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
.more>summary{cursor:pointer;padding:9px 12px;font-weight:600}
.more>:not(summary){margin:0;padding:0 12px 10px}
.more ul{padding-left:30px}
.more li{margin:4px 0;overflow-wrap:anywhere}
.legend dt{font-weight:600;margin-top:6px}
.legend dd{margin:0 0 0 0;color:var(--sub)}
.foot{margin-top:14px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;color:var(--sub);font-size:12px}
.copybox{width:100%;min-height:120px;margin-top:10px;font-family:var(--mono);font-size:12px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius);padding:8px}
`;

const BODY = String.raw`
<div id="mw-root" class="app" data-verdict="">
  <header class="top">
    <span class="brand">ModWrench <b>Patch Day</b></span>
    <span id="ctx" class="ctx" hidden></span>
  </header>

  <div id="waiting" class="waiting">
    <p id="status" class="status" role="status" aria-live="polite">Waiting for the check to finish. If this stays here, the answer is in the chat.</p>
    <button id="btn-run" class="btn small" type="button" hidden>Run the check now</button>
  </div>

  <section id="verdict" class="verdict" hidden aria-labelledby="verdict-word">
    <div class="vmark" aria-hidden="true">
      <svg class="vm-go" viewBox="0 0 48 48" focusable="false"><circle cx="24" cy="24" r="20" stroke-width="3"/><path d="M14 25l7 7 13-15" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <svg class="vm-check" viewBox="0 0 48 48" focusable="false"><path d="M24 5L45 41H3Z" stroke-width="3" stroke-linejoin="round"/><path d="M24 18v10" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="34" r="2.4" fill="currentColor" stroke="none"/></svg>
      <svg class="vm-wait" viewBox="0 0 48 48" focusable="false"><path d="M16 4h16l12 12v16L32 44H16L4 32V16z" stroke-width="3" stroke-linejoin="round"/><path d="M19 16v16M29 16v16" stroke-width="4" stroke-linecap="round"/></svg>
    </div>
    <div class="vtext">
      <p id="verdict-tag" class="vtag" hidden></p>
      <h1 id="verdict-word" class="vword"></h1>
      <p id="verdict-line" class="vline"></p>
    </div>
  </section>

  <div id="problem" class="problem" role="alert" hidden></div>
  <pre id="plain" class="plain" hidden></pre>

  <section id="sure" class="sure" hidden aria-label="How sure this is"></section>
  <section id="clash" class="clash" hidden></section>
  <ul id="chips" class="chips" hidden aria-label="The setup"></ul>
  <section id="plugins" class="block" hidden></section>
  <section id="ahead" class="block" hidden></section>
  <section id="steps" class="block" hidden></section>

  <section id="controls" class="controls" hidden aria-label="Actions">
    <div class="row">
      <button id="btn-recheck" class="btn primary" type="button">Re-check</button>
      <button id="btn-copy" class="btn" type="button" hidden>Copy summary</button>
      <button id="btn-ask" class="btn" type="button" hidden>Ask about this</button>
    </div>
    <div class="row">
      <label for="whatif" class="lbl">What if I update to</label>
      <input id="whatif" class="input mono" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="24" placeholder="1.7.104">
      <button id="btn-whatif" class="btn" type="button">Check</button>
      <button id="btn-installed" class="btn" type="button" hidden>Back to the installed version</button>
    </div>
    <p id="note" class="note" role="status" aria-live="polite"></p>
    <textarea id="copy-box" class="copybox" readonly hidden aria-label="Summary text to copy"></textarea>
  </section>

  <details id="limits" class="more" hidden><summary>What this can't tell you</summary><ul id="limits-list"></ul></details>
  <details id="legend" class="more" hidden>
    <summary>How to read the labels</summary>
    <dl class="legend">
      <dt>SKSE source, F4SE source</dt><dd>A rule taken from the script extender's published source code (SKSE for Skyrim, F4SE for Fallout 4). It would refuse the plugin with the message shown.</dd>
      <dt>Inferred</dt><dd>ModWrench's best guess from how the file looks. Treat it as a hint and confirm it against the script extender's own log.</dd>
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

  var TOOL = 'mw_patch_day';
  var state = { baseArgs: {}, args: {}, report: null, text: '', busy: false, showAll: false, canCall: true, gotResult: false, inputSeen: false };

  var VERDICTS = { go: 'GO', check: 'CHECK', wait: 'WAIT' };
  var STATUS = { broken: 'Broken', unclear: 'Unclear' };
  var BASIS = {
    'skse-source': { label: 'SKSE source', tip: "A rule taken from SKSE's published source code." },
    'f4se-source': { label: 'F4SE source', tip: "A rule taken from F4SE's published source code." },
    'field-reports': { label: 'Field reports', tip: "Matches what players and plugin authors have reported. Not from SKSE's source." },
    inferred: { label: 'Inferred', tip: "ModWrench's best guess from how the file looks. Treat it as a hint." }
  };
  // The script extender a report is about. Only the two names Patch Day writes are used; anything else reads as SKSE.
  function xse(r) { var s = r && r.scriptExtender; return s && s.name === 'F4SE' ? 'F4SE' : 'SKSE'; }
  function evidenceFor(key, X) {
    if (key === 'log') return { label: X + ' log', full: X + "'s own log", level: 3 };
    if (key === 'files') return { label: 'Files', full: 'the files and ' + X + "'s rules", level: 2 };
    return { label: 'Prediction', full: 'a prediction', level: 1 };
  }
  var INITIAL_ROWS = 10;

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

  function sourceLabel(source) {
    var s = String(source || '');
    if (s === 'game') return 'Game folder';
    if (s === 'mo2:overwrite') return 'MO2 overwrite folder';
    if (s.indexOf('mo2:') === 0) return 'MO2 mod: ' + tidy(s.slice(4), 80);
    return tidy(s, 80);
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
    ['btn-recheck', 'btn-whatif', 'btn-installed', 'btn-run'].forEach(function (id) { el(id).disabled = on; });
    if (on) say('Checking…');
    else el('note').textContent = '';
  }

  // ── Pieces of the page ────────────────────────────────────────────────────

  function stripVerdict(headline) {
    return tidy(headline, 700).replace(/^(GO|CHECK|WAIT) +[—–-] +/, '');
  }

  function renderVerdict(r) {
    var v = VERDICTS[r.verdict] ? r.verdict : 'check';
    el('mw-root').setAttribute('data-verdict', v);
    el('verdict-word').textContent = VERDICTS[v];
    el('verdict-line').textContent = stripVerdict(r.headline);
    var tag = el('verdict-tag');
    var checked = r.checked || {};
    if (checked.source === 'targetVersion') {
      tag.textContent = 'What if you update to ' + tidy(checked.version, 24) + ' (installed: ' + tidy(checked.installed, 24) + ')';
      tag.hidden = false;
    } else {
      tag.hidden = true;
    }
    show('verdict', true);
  }

  function renderSure(r) {
    var host = el('sure');
    clear(host);
    var c = r.confidence || {};
    var ev = evidenceFor(c.evidence, xse(r));
    var gauge = h('div', { class: 'gauge', role: 'img', 'aria-label': 'Evidence: ' + ev.full + ', level ' + ev.level + ' of 3' }, [
      h('span', { class: ev.level >= 1 ? 'seg on' : 'seg' }),
      h('span', { class: ev.level >= 2 ? 'seg on' : 'seg' }),
      h('span', { class: ev.level >= 3 ? 'seg on' : 'seg' })
    ]);
    host.appendChild(h('div', { class: 'evid' }, [gauge, h('span', { class: 'evid-k', text: ev.label, 'aria-hidden': 'true' })]));
    host.appendChild(h('p', { text: tidy(c.summary, 600) }));
    show('sure', true);
  }

  // The script extender's own log is the real answer. When it refused a plugin the file
  // check had passed, say so here, above everything else on the page; each entry is
  // already a sentence naming the plugin and quoting what the script extender logged.
  function renderClash(r) {
    var host = el('clash');
    clear(host);
    var log = r.log;
    var checked = r.checked || {};
    var list = log && log.found && log.fresh && checked.source !== 'targetVersion' && Array.isArray(log.disagreements) ? log.disagreements : [];
    if (list.length === 0) { show('clash', false); return; }
    var X = xse(r);
    host.appendChild(h('h2', { class: 'h2', text: X + "'s own log disagrees with the file check" }));
    host.appendChild(h('p', { class: 'small', text: X + ' refused ' + (list.length === 1 ? 'a plugin' : list.length + ' plugins') + " the file check had passed. " + X + "'s log is what really happened, so start here." }));
    var items = h('ul', { class: 'plain-list' });
    list.slice(0, 10).forEach(function (entry) {
      var text = tidy(entry, 320);
      var parts = /^(.{1,100}?): ((?:SKSE|F4SE) logged .*)$/.exec(text);
      items.appendChild(h('li', {}, parts ? [h('code', { text: parts[1] }), ': ' + parts[2]] : [text]));
    });
    host.appendChild(items);
    if (list.length > 10) host.appendChild(h('p', { class: 'muted small mt', text: 'and ' + (list.length - 10) + ' more.' }));
    show('clash', true);
  }

  function chip(tone, key, value, tip) {
    var icon = tone === 'ok' ? '✓' : tone === 'warn' ? '!' : tone === 'bad' ? '✕' : '–';
    var word = tone === 'ok' ? 'fine' : tone === 'warn' ? 'worth a look' : tone === 'bad' ? 'a problem' : 'for information';
    return h('li', { class: 'chip', 'data-tone': tone, title: tip || false }, [
      h('span', { class: 'chip-i', 'aria-hidden': 'true', text: icon }),
      h('span', { class: 'chip-k', text: key }),
      h('span', { class: 'chip-v', text: value }),
      h('span', { class: 'sr', text: ' (' + word + ')' })
    ]);
  }

  function renderChips(r) {
    var host = el('chips');
    clear(host);
    var checked = r.checked || {};
    var game = r.game || {};
    var skse = r.scriptExtender || {};
    var lib = r.addressLibrary || {};
    var plugins = r.plugins || {};
    var whatIf = checked.source === 'targetVersion';

    host.appendChild(chip('info', tidy(game.name, 40) || 'Game', tidy(checked.version, 24), whatIf ? 'The version being asked about' : 'The installed version'));

    var X = xse(r);
    var installed = Array.isArray(skse.dllsInstalled) ? skse.dllsInstalled.length : 0;
    if (!skse.loaderPresent && installed === 0) host.appendChild(chip('warn', X, 'not installed'));
    else if (skse.dllPresent) host.appendChild(chip('ok', X, skse.version ? 'v' + tidy(skse.version, 20) : 'present', tidy(skse.expectedDll, 60)));
    else host.appendChild(chip('bad', X, 'no build for this version', 'Needs ' + tidy(skse.expectedDll, 60)));

    if (lib.present) host.appendChild(chip('ok', 'Address Library', 'present' + (lib.format === null || lib.format === undefined ? '' : ' (format ' + num(lib.format) + ')'), tidy(lib.expectedFile, 60)));
    else if (num(lib.pluginsNeedingIt) > 0) host.appendChild(chip('bad', 'Address Library', 'missing', 'Needs ' + tidy(lib.expectedFile, 60)));
    else host.appendChild(chip('info', 'Address Library', 'not needed'));

    var total = num(plugins.total);
    var broken = num(plugins.broken);
    var unclear = num(plugins.unclear);
    host.appendChild(chip(broken > 0 ? 'bad' : unclear > 0 ? 'warn' : 'ok', 'Plugins',
      total + ' checked' + (broken ? ', ' + broken + ' broken' : '') + (unclear ? ', ' + unclear + ' unclear' : '')));

    if (r.steam) {
      host.appendChild(chip(r.steam.updatePending && !whatIf ? 'warn' : 'ok', 'Steam',
        r.steam.updatePending && !whatIf ? 'update waiting' : 'no update waiting'));
    }

    var log = r.log;
    if (whatIf) host.appendChild(chip('info', X + ' log', 'not used', 'It describes the installed version.'));
    else if (!log || !log.found) host.appendChild(chip('info', X + ' log', 'not found'));
    else if (!log.fresh) host.appendChild(chip('info', X + ' log', 'older than the last patch'));
    else host.appendChild(chip(Array.isArray(log.refusals) && log.refusals.length ? 'warn' : 'ok', X + ' log',
      num(log.pluginsLoaded) + ' loaded, ' + (Array.isArray(log.refusals) ? log.refusals.length : 0) + ' refused'));
    show('chips', true);
  }

  function pluginRow(q, X) {
    var status = STATUS[q.status] ? q.status : 'unclear';
    var basis = BASIS[q.basis] ? q.basis : 'inferred';
    return h('li', { class: 'prow', 'data-status': status }, [
      h('div', { class: 'phead' }, [
        h('span', { class: 'badge st', text: STATUS[status] }),
        h('code', { class: 'pfile', title: tidy(q.file, 300), text: tidy(q.file, 90) }),
        q.name ? h('span', { class: 'pname', text: '“' + tidy(q.name, 60) + '”' }) : null
      ]),
      h('p', { class: 'preason', text: tidy(q.reason, 400) }),
      h('div', { class: 'pmeta' }, [
        h('span', { class: 'badge basis', 'data-basis': basis, title: BASIS[basis].tip, text: BASIS[basis].label }),
        h('span', { class: 'psrc', text: sourceLabel(q.source) })
      ]),
      q.skseMessage ? h('p', { class: 'pskse' }, [X + ' will log: ', h('q', { text: tidy(q.skseMessage, 160) })]) : null
    ]);
  }

  function renderPlugins(r) {
    var host = el('plugins');
    clear(host);
    var p = r.plugins || {};
    var problems = Array.isArray(p.problems) ? p.problems : [];
    var total = num(p.total);
    var broken = num(p.broken);
    var unclear = num(p.unclear);
    var okCount = num(p.ok);

    host.appendChild(h('h2', { class: 'h2' }, [
      'Plugins',
      h('span', { class: 'count', text: total + ' checked · ' + okCount + ' ok · ' + broken + ' broken · ' + unclear + ' unclear' })
    ]));

    if (total > 0) {
      var bar = h('div', { class: 'bar', role: 'img', 'aria-label': okCount + ' ok, ' + unclear + ' unclear, ' + broken + ' broken' });
      [['b-ok', okCount], ['b-unclear', unclear], ['b-broken', broken]].forEach(function (seg) {
        if (seg[1] > 0) {
          var piece = h('i', { class: seg[0] });
          piece.style.width = (seg[1] / total * 100) + '%';
          bar.appendChild(piece);
        }
      });
      host.appendChild(bar);
    }

    if (problems.length === 0) {
      host.appendChild(h('p', { class: 'calm', text: total > 0 ? 'The file check flagged no plugin.' : 'No ' + xse(r) + ' plugins were found.' }));
    } else {
      var shown = state.showAll ? problems.length : Math.min(problems.length, INITIAL_ROWS);
      var list = h('ul', { class: 'plist' });
      problems.slice(0, shown).forEach(function (q) { list.appendChild(pluginRow(q || {}, xse(r))); });
      host.appendChild(list);
      if (problems.length > shown) {
        var more = h('button', { class: 'btn small mt', type: 'button', text: 'Show all ' + problems.length });
        more.addEventListener('click', function () { state.showAll = true; if (state.report) renderPlugins(state.report); window.mwApp.resized(); });
        host.appendChild(more);
      }
    }

    var passed = Array.isArray(p.passed) ? p.passed : [];
    if (passed.length > 0) {
      var names = passed.slice(0, 200).map(function (n) { return tidy(n, 60); }).join(', ');
      if (passed.length > 200) names += ', and ' + (passed.length - 200) + ' more';
      var details = h('details', { class: 'more' }, [h('summary', { text: 'Passed (' + passed.length + ')' }), h('p', { class: 'names', text: names })]);
      host.appendChild(details);
    }
    show('plugins', true);
  }

  function renderAhead(r) {
    var host = el('ahead');
    clear(host);
    var np = r.nextPatch || {};
    var pinned = Array.isArray(np.pinned) ? np.pinned : [];
    if (pinned.length === 0) { show('ahead', false); return; }
    host.appendChild(h('h2', { class: 'h2', text: 'After the next patch' }));
    host.appendChild(h('p', { class: 'muted', text: pinned.length + (pinned.length === 1 ? ' plugin is' : ' plugins are') + ' pinned to exact game versions and will be refused after the next game update until rebuilt.' }));
    var list = h('ul', { class: 'plain-list' });
    pinned.slice(0, 12).forEach(function (x) {
      var supports = Array.isArray(x && x.supports) ? x.supports.slice(0, 4).map(function (v) { return tidy(v, 20); }).join(', ') : '';
      list.appendChild(h('li', {}, [h('code', { text: tidy(x && x.file, 60) }), supports ? ' supports ' + supports : '']));
    });
    host.appendChild(list);
    if (pinned.length > 12) host.appendChild(h('p', { class: 'muted small', text: 'and ' + (pinned.length - 12) + ' more.' }));
    show('ahead', true);
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
    var sources = r.sources || {};
    where.appendChild(h('li', { text: 'Game folder: ' + num(sources.gameFolderPlugins) + ' plugin file' + (num(sources.gameFolderPlugins) === 1 ? '' : 's') + '.' }));
    var mo2 = sources.mo2 || {};
    var mo2Text = 'Mod Organizer 2: ' + (mo2.used ? 'read' + (mo2.profile ? ' (profile ' + tidy(mo2.profile, 60) + ')' : '') + (mo2.modsWithPlugins !== undefined ? ', ' + num(mo2.modsWithPlugins) + ' mods with plugins' : '') + '.' : (mo2.unread ? 'not read. ' : 'not used. ') + tidy(mo2.reason, 200));
    where.appendChild(h('li', { text: mo2Text }));
    show('where', true);
  }

  function renderControls(r) {
    var checked = r.checked || {};
    var whatIf = checked.source === 'targetVersion';
    var input = el('whatif');
    input.placeholder = xse(r) === 'F4SE' ? '1.11.240' : '1.7.104';
    if (whatIf) input.value = tidy(state.args.targetVersion !== undefined ? state.args.targetVersion : checked.version, 24);
    el('btn-installed').hidden = !whatIf;
    show('controls', true);
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
    renderSure(r);
    renderClash(r);
    renderChips(r);
    renderPlugins(r);
    renderAhead(r);
    renderSteps(r);
    renderDetails(r);
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
    ['verdict', 'sure', 'clash', 'chips', 'plugins', 'ahead', 'steps', 'limits', 'legend', 'where'].forEach(function (id) { show(id, false); });
    el('mw-root').setAttribute('data-verdict', '');
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
    el('foot-time').textContent = '';
    show('foot', true);
    el('btn-installed').hidden = state.args.targetVersion === undefined;
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
    else if (data && typeof data === 'object' && data.ok === false) showProblem("Patch Day couldn't run.", data.error, data.hint);
    else if (result.isError) showProblem("Patch Day couldn't run.", state.text);
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
      showProblem("Your editor didn't run the check from this page.", tidy(error && error.message, 300), 'Ask in the chat instead, for example: is it safe to update?');
      el('btn-recheck').hidden = true;
      el('btn-whatif').hidden = true;
      el('btn-installed').hidden = true;
    });
  }

  function whatIfArgs(version) {
    var args = copyObject(state.baseArgs);
    args.targetVersion = version;
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
  el('btn-installed').addEventListener('click', function () { el('whatif').value = ''; runCheck(state.baseArgs); });
  el('btn-whatif').addEventListener('click', function () {
    var version = tidy(el('whatif').value, 24);
    if (!version) { el('whatif').focus(); return; }
    runCheck(whatIfArgs(version));
  });
  el('whatif').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); el('btn-whatif').click(); }
  });
  el('btn-copy').addEventListener('click', function () {
    copyText(state.text).then(function (copied) {
      say(copied ? 'Summary copied.' : 'Press Ctrl+C (or Cmd+C) to copy the selected text.');
      window.mwApp.resized();
    });
  });
  // The message goes into the chat as the person's own words, so it is a fixed sentence: nothing from the
  // result (plugin names are other people's text), and the AI already has the result.
  el('btn-ask').addEventListener('click', function () {
    if (!state.report) return;
    var message = 'Please walk me through the latest Patch Day result, starting with the most important thing.';
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
    state.inputSeen = true;
    state.args = copyObject(args);
    state.baseArgs = copyObject(args);
    delete state.baseArgs.targetVersion;
  });
  window.mwApp.on('result', handleResult);
  window.mwApp.on('cancelled', function () { if (!state.gotResult) say('The check was cancelled.'); });
  window.mwApp.on('context', updateCapabilities);
  window.mwApp.on('teardown', function () { state.busy = false; });

  window.mwApp.start('modwrench-patch-day', '1', function () {
    state.canCall = false;
    say("This page couldn't reach your editor. The answer is in the chat.");
  });
  window.setTimeout(function () {
    if (!state.gotResult && !state.busy && state.canCall) el('btn-run').hidden = false;
  }, 6000);
})();
`;

/** The Patch Day page, as the HTML an MCP Apps host loads for `ui://modwrench/patch-day`. */
export function renderPatchDayApp(): string {
  return renderApp({ title: "Patch Day", css: CSS, body: BODY, script: SCRIPT });
}
