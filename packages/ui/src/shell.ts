// ─── Themed shell ─────────────────────────────────────────────────────────────
// A complete, self-contained HTML document rendered as the `text` of a ui://
// resource. Hosts the three views (deck / mods / crash) under one chrome with a
// four-game theme switcher. No external requests, no localStorage, no state —
// the theme switch is a client-side data-attribute swap; every other control
// posts an MCP-UI intent to the host, which re-invokes a tool and returns a
// fresh shell. The UI is a pure function of a tool result.

import { resolveTheme, themeStyleBlock, themeFontsHead, THEME_IDS, THEMES } from "./themes.js";
import type { ThemeId } from "./themes.js";
import { renderDeck, renderMods, renderCrash, renderConflicts, renderDeps } from "./views.js";
import type { DeckData, ModsData, CrashData, ConflictsData, DepsData } from "./views.js";
import { esc } from "./resource.js";

export type ShellView = "deck" | "mods" | "crash" | "conflicts" | "deps";

export type ShellOptions = {
  theme?: ThemeId | string;
  view?: ShellView;
  deck?: DeckData;
  mods?: ModsData;
  crash?: CrashData;
  conflicts?: ConflictsData;
  deps?: DepsData;
};

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--r:14px}
html,body{height:100%}
body{
  background:var(--bg);color:var(--ink);
  font-family:var(--font-body);
  -webkit-font-smoothing:antialiased;
  background-image:var(--texture);background-attachment:fixed;
}
.mw-app{display:flex;flex-direction:column;min-height:100vh;max-width:1040px;margin:0 auto;padding:18px}
/* top bar */
.mw-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  padding-bottom:14px;border-bottom:1px solid var(--border)}
.mw-brand{font-family:var(--font-head);font-weight:700;font-size:19px;letter-spacing:.02em;
  display:flex;align-items:baseline;gap:9px;color:var(--ink)}
.mw-brand b{color:var(--accent)}
.mw-brand-sub{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--sub)}
.mw-tabs{display:flex;gap:4px}
.mw-tab{font-family:var(--mono);font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--sub);background:transparent;border:1px solid transparent;border-radius:9px;
  padding:7px 12px;cursor:pointer}
.mw-tab:hover{color:var(--ink)}
.mw-tab.on{color:var(--bg);background:var(--accent);border-color:var(--accent)}
.mw-themes{display:flex;gap:6px}
.mw-theme{width:26px;height:26px;border-radius:50%;border:1.5px solid var(--border);cursor:pointer;
  padding:0;position:relative;background:var(--tsw)}
.mw-theme[data-t="skyrim"]{--tsw:radial-gradient(circle at 35% 30%,#c9a25a,#241d12)}
.mw-theme[data-t="fallout"]{--tsw:radial-gradient(circle at 35% 30%,#3bff7a,#04120a)}
.mw-theme[data-t="lethal"]{--tsw:radial-gradient(circle at 35% 30%,#37e0d0,#070a0c)}
.mw-theme[data-t="valheim"]{--tsw:radial-gradient(circle at 35% 30%,#c9a86a,#10141b)}
.mw-theme.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--bg),0 0 0 3.5px var(--accent)}
/* body */
.mw-body{flex:1;padding:20px 0}
.mw-sec{margin-bottom:26px}
.mw-sec-h{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
.mw-sec-h h2{font-family:var(--font-head);font-size:15px;letter-spacing:.03em;color:var(--ink);font-weight:600}
.mw-sec-sub{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;color:var(--sub)}
/* connectors */
.mw-conn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.mw-conn{display:flex;align-items:center;gap:10px;text-align:left;cursor:pointer;
  background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:13px 14px;
  color:var(--ink);box-shadow:var(--glow);position:relative;overflow:hidden}
.mw-conn::before{content:"";position:absolute;inset:0 0 auto 0;height:2px;background:var(--chip-shine)}
.mw-conn:hover{border-color:var(--accent);transform:translateY(-1px);transition:.14s}
.mw-conn-nm{font-family:var(--font-head);font-weight:600;font-size:14px;flex:1}
.mw-chip-ct{font-family:var(--mono);font-size:10px;color:var(--sub)}
.mw-dot{width:8px;height:8px;border-radius:50%;background:var(--sub);box-shadow:0 0 8px currentColor}
.mw-dot.on{background:var(--accent);color:var(--accent)}
.mw-dot.warn{background:var(--accent2);color:var(--accent2)}
.mw-dot.off{background:var(--sub);box-shadow:none}
/* tool lists — MO2 ordered list + r2modman rows */
.mw-list{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:var(--r);overflow:hidden;background:var(--panel);box-shadow:var(--glow)}
.mw-lrow{display:flex;align-items:center;gap:11px;padding:9px 12px;border-bottom:1px solid var(--border);background:transparent;color:var(--ink);cursor:pointer;text-align:left;width:100%;font:inherit}
.mw-lrow:last-child{border-bottom:0}
.mw-lrow:nth-child(odd){background:rgba(255,255,255,.015)}
.mw-lrow:hover{background:rgba(255,255,255,.045)}
.mw-handle{color:var(--sub);opacity:.45;font-size:13px;cursor:grab;letter-spacing:-2px}
.mw-prio{font-family:var(--mono);font-size:11px;color:var(--sub);min-width:20px;text-align:right}
.mw-lmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.mw-lname{font-family:var(--font-head);font-size:13.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mw-lmeta{font-family:var(--mono);font-size:10px;color:var(--sub)}
.mw-flag{font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;padding:1px 5px;border-radius:4px;border:1px solid var(--border);color:var(--sub)}
.mw-flag.ok{color:var(--ok);border-color:var(--ok)}
.mw-flag.warn{color:var(--warn);border-color:var(--warn)}
.mw-lct{font-family:var(--mono);font-size:10px;color:var(--sub);white-space:nowrap}
.mw-chev{color:var(--sub);font-size:14px;opacity:.6}
/* r2modman mod rows */
.mw-mrow{display:flex;align-items:center;gap:11px;padding:11px 12px;border-bottom:1px solid var(--border);background:transparent}
.mw-mrow:last-child{border-bottom:0}
.mw-mrow:nth-child(odd){background:rgba(255,255,255,.015)}
.mw-micon{width:34px;height:34px;border-radius:7px;flex:none;display:grid;place-items:center;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--bg);background:var(--accent);opacity:.92}
.mw-mmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.mw-mname{font-family:var(--font-head);font-size:14px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:7px}
.mw-mby{font-size:11.5px;color:var(--sub)}
.mw-mby strong{color:var(--ink)}
.mw-msum{font-size:12px;color:var(--ink);opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.mw-mstat{font-family:var(--mono);font-size:10.5px;color:var(--sub);display:flex;gap:12px;white-space:nowrap}
.mw-mact{display:flex;align-items:center;gap:9px;flex:none}
.mw-toggle{width:34px;height:18px;border-radius:10px;border:1px solid var(--border);background:var(--panel2);position:relative;flex:none;cursor:pointer;padding:0}
.mw-toggle::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--sub);transition:.14s}
.mw-toggle[data-on="1"]{border-color:var(--accent)}
.mw-toggle[data-on="1"]::after{left:18px;background:var(--accent);box-shadow:0 0 8px var(--accent)}
@media(max-width:560px){.mw-msum{display:none}}
/* games */
.mw-game-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px}
.mw-game{display:flex;flex-direction:column;gap:3px;text-align:left;cursor:pointer;
  background:var(--panel2);border:1px solid var(--border);border-radius:11px;padding:11px 13px;color:var(--ink)}
.mw-game:hover{border-color:var(--accent2)}
.mw-game-nm{font-family:var(--font-head);font-weight:600;font-size:13px}
.mw-game-note{font-family:var(--mono);font-size:9.5px;color:var(--sub)}
/* mod cards */
.mw-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.mw-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:14px;
  display:flex;flex-direction:column;gap:8px;box-shadow:var(--glow)}
.mw-card-h{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.mw-card-nm{font-family:var(--font-head);font-size:14.5px;font-weight:600;line-height:1.25}
.mw-badge{font-family:var(--mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--accent2);border:1px solid var(--border);border-radius:6px;padding:2px 6px;white-space:nowrap}
.mw-card-by{font-size:12px;color:var(--sub)}
.mw-card-by strong{color:var(--ink)}
.mw-card-sum{font-size:12.5px;line-height:1.5;color:var(--ink);opacity:.85}
.mw-card-stats{display:flex;gap:14px;font-family:var(--mono);font-size:11px;color:var(--sub);margin-top:2px}
.mw-card-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px}
/* crash */
.mw-crash-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.mw-crash-type{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--bg);background:var(--accent);border-radius:6px;padding:3px 8px}
.mw-crash-ex{font-family:var(--mono);font-size:18px;color:var(--danger)}
.mw-crash-addr{font-family:var(--mono);font-size:12px;color:var(--sub)}
.mw-crash-desc{font-size:13px;color:var(--ink);opacity:.85;margin-top:8px;line-height:1.55}
.mw-suspects{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin:14px 0}
.mw-lbl,.mw-suspects .mw-lbl{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--sub)}
.mw-suspect{font-family:var(--mono);font-size:11px;color:var(--accent2);border:1px solid var(--border);
  border-radius:6px;padding:3px 8px;background:var(--panel)}
.mw-crash-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}
.mw-col{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:12px 14px}
.mw-col-h{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--sub);
  display:flex;justify-content:space-between;margin-bottom:8px}
.mw-count{color:var(--accent)}
.mw-stack{list-style:none;font-family:var(--mono);font-size:11.5px;line-height:1.9;max-height:280px;overflow:auto}
.mw-stack li{display:flex;gap:8px;align-items:baseline;border-bottom:1px solid rgba(255,255,255,.03);padding:1px 0}
.mw-frame-i{color:var(--sub);min-width:20px}
.mw-frame-mod{color:var(--ink)}
.mw-frame-fn{color:var(--accent)}
.mw-frame-off{color:var(--sub)}
.mw-plugins{list-style:none;font-family:var(--mono);font-size:11.5px;line-height:1.85;max-height:280px;overflow:auto;color:var(--ink)}
.mw-muted{color:var(--sub)}
/* buttons + empty + flash */
.mw-btn{font-family:var(--mono);font-size:11px;letter-spacing:.03em;cursor:pointer;color:var(--ink);
  background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border);border-radius:9px;padding:7px 12px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 2px 0 rgba(0,0,0,.5),0 5px 12px rgba(0,0,0,.32);
  transition:transform .07s ease,box-shadow .07s ease,border-color .12s,background .12s}
.mw-btn:hover{border-color:var(--accent);color:var(--ink)}
.mw-btn:active,.mw-btn.mw-press{transform:translateY(2px);box-shadow:inset 0 2px 6px rgba(0,0,0,.55),0 1px 0 rgba(0,0,0,.4)}
.mw-btn.primary{background:var(--accent);color:var(--bg);border-color:var(--accent);font-weight:700;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 2px 0 rgba(0,0,0,.55),0 6px 16px rgba(0,0,0,.35)}
.mw-btn.primary:active,.mw-btn.primary.mw-press{transform:translateY(2px);box-shadow:inset 0 2px 7px rgba(0,0,0,.4),0 0 14px var(--accent)}
/* tap feedback on rows/tabs/toggles/dots */
.mw-lrow,.mw-mrow,.mw-game,.mw-tab,.mw-theme,.mw-toggle{transition:transform .09s ease,border-color .12s,box-shadow .12s,background .12s}
.mw-lrow:active,.mw-lrow.mw-press,.mw-mrow.mw-press,.mw-game:active,.mw-game.mw-press{transform:translateY(1px) scale(.996)}
.mw-tab:active,.mw-tab.mw-press{transform:translateY(1px)}
.mw-theme:active,.mw-theme.mw-press{transform:scale(.9)}
.mw-toggle:active,.mw-toggle.mw-press{transform:scale(.92)}
.mw-note{font-size:11px;color:var(--sub)}
.mw-empty{text-align:center;padding:56px 20px;color:var(--sub)}
.mw-empty-mark{width:44px;height:44px;margin:0 auto 16px;border:2px dashed var(--border);border-radius:12px;
  transform:rotate(45deg)}
.mw-empty h3{font-family:var(--font-head);color:var(--ink);font-size:16px;margin-bottom:6px}
.mw-empty p{font-size:13px;margin-bottom:16px}
/* crash: registers + raw sections */
.mw-crash-ver{font-family:var(--mono);font-size:11px;color:var(--sub)}
.mw-col-wide{margin-top:14px}
.mw-plugins-wide{max-height:200px;columns:2;column-gap:18px}
.mw-plugins-wide li{break-inside:avoid}
.mw-regs{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:4px 12px;max-height:280px;overflow:auto}
.mw-reg{display:flex;gap:7px;font-family:var(--mono);font-size:11px}
.mw-reg-k{color:var(--accent);min-width:34px}
.mw-reg-v{color:var(--ink);opacity:.85}
.mw-raws{margin-top:14px;display:flex;flex-direction:column;gap:8px}
.mw-raw{border:1px solid var(--border);border-radius:9px;background:var(--panel);overflow:hidden}
.mw-raw>summary{cursor:pointer;padding:9px 12px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--sub);list-style:none}
.mw-raw>summary::-webkit-details-marker{display:none}
.mw-raw>summary::before{content:"▸ ";color:var(--accent)}
.mw-raw[open]>summary::before{content:"▾ "}
.mw-pre{margin:0;padding:0 12px 12px;font-family:var(--mono);font-size:11px;line-height:1.6;color:var(--ink);
  opacity:.85;white-space:pre-wrap;max-height:260px;overflow:auto}
/* conflicts — xEdit/LOOT severity coding */
.mw-legend{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.mw-sev{font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;padding:2px 7px;border-radius:5px;
  border:1px solid var(--border);color:var(--sub);white-space:nowrap;text-transform:uppercase}
.mw-sev.loser{color:var(--danger);border-color:var(--danger)}
.mw-sev.order{color:var(--warn);border-color:var(--warn)}
.mw-sev.patch{color:var(--accent2);border-color:var(--accent2)}
.mw-sev.info{color:var(--sub);border-color:var(--border)}
.mw-src{font-family:var(--mono);font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid var(--border);color:var(--sub)}
.mw-src.ok{color:var(--ok);border-color:var(--ok)}
.mw-src.off{color:var(--sub)}
.mw-crow{display:flex;align-items:flex-start;gap:11px;padding:11px 12px;border-bottom:1px solid var(--border)}
.mw-crow:last-child{border-bottom:0}
.mw-crow:nth-child(odd){background:rgba(255,255,255,.015)}
.mw-cmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.mw-cpair{font-family:var(--font-head);font-size:13px;color:var(--ink)}
.mw-vs{color:var(--danger);margin:0 3px}
.mw-cdesc{font-size:12px;color:var(--ink);opacity:.8;line-height:1.5}
.mw-cwork{font-size:11.5px;color:var(--accent2)}
.mw-csrc{font-family:var(--mono);font-size:9.5px;color:var(--sub);white-space:nowrap;padding-top:2px}
.mw-clean{display:flex;align-items:center;gap:10px;padding:24px 16px;color:var(--ok);
  font-family:var(--mono);font-size:13px;border:1px solid var(--ok);border-radius:var(--r);background:var(--panel)}
.mw-clean-mark{font-size:18px}
.mw-warnrow{font-family:var(--mono);font-size:11px;color:var(--warn);padding:8px 2px}
/* deps tree */
.mw-tree{font-family:var(--mono);color:var(--sub);opacity:.6;letter-spacing:-1px}
.mw-dep{padding-left:22px}
.mw-deproot .mw-lname,.mw-deproot{font-family:var(--font-head)}
.mw-deproot .mw-prio{color:var(--accent)}
/* footer */
.mw-foot{border-top:1px solid var(--border);padding-top:12px;display:flex;justify-content:space-between;
  gap:10px;flex-wrap:wrap;font-family:var(--mono);font-size:10.5px;color:var(--sub)}
.mw-foot .mw-tag{color:var(--ink);opacity:.7}
.mw-flash{position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(20px);
  font-family:var(--mono);font-size:11.5px;color:var(--bg);background:var(--accent);
  border-radius:9px;padding:8px 14px;opacity:0;transition:.2s;pointer-events:none;max-width:90%}
.mw-flash.show{opacity:1;transform:translateX(-50%) translateY(0)}
@media(max-width:640px){.mw-crash-cols{grid-template-columns:1fr}}
`;

function themeSwitcher(active: ThemeId): string {
  return THEME_IDS.map(
    (id) =>
      `<button class="mw-theme${id === active ? " on" : ""}" data-t="${id}" title="${esc(THEMES[id].game)}" data-mw-act="theme" data-mw-val="${esc(id)}"></button>`
  ).join("");
}

function tabs(active: ShellView): string {
  const items: Array<[ShellView, string, string]> = [
    ["deck", "Deck", "mw_deck"],
    ["mods", "Mods", "thunderstore_search_mods"],
    ["crash", "Crash", "mw_parse_crashlog"],
    ["conflicts", "Conflicts", "mw_check_known_conflicts"],
    ["deps", "Order", "mw_read_load_order"],
  ];
  return items
    .map(
      ([v, label, tool]) =>
        `<button class="mw-tab${v === active ? " on" : ""}"${
          v === active ? "" : ` data-mw-act="tool" data-mw-val="${esc(tool)}"`
        }>${label}</button>`
    )
    .join("");
}

// Why the panel uses data attributes and one delegated listener, rather than
// inline event handlers:
//
// Mod names, authors and URLs come from public mod platforms — anyone can
// publish a mod called whatever they like, so every one of those strings is
// attacker-controlled. They used to be interpolated into inline handlers.
// HTML escaping cannot make that safe, because the browser decodes entities in
// an attribute BEFORE compiling it as JavaScript: esc()'s &#39; turns back into
// a real quote and breaks out of the string literal. A mod named
//
//     Cool Mod'); mw('prompt','<anything the attacker wants'); //
//
// became a second statement that posted an attacker-written prompt straight
// into the user's AI session.
//
// Values now travel in data attributes and are read back through dataset at
// click time. dataset returns a string and nothing here compiles it, so the
// injection is structurally impossible rather than escaped against. There are
// regression tests asserting no rendered view emits an inline handler.
const BRIDGE = `
function post(type,payload){
  var msg={type:type,messageId:'mw-'+Date.now(),payload:payload};
  try{window.parent.postMessage(msg,'*');}catch(e){}
}
function flash(t){var el=document.getElementById('mwFlash');if(!el)return;
  el.textContent=t;el.classList.add('show');clearTimeout(window.__mwf);
  window.__mwf=setTimeout(function(){el.classList.remove('show');},1600);}
function mw(kind,value){
  if(kind==='tool'){post('tool',{toolName:value,params:{}});flash('▸ '+value+'()');}
  else if(kind==='prompt'){post('prompt',{prompt:value});flash('▸ prompt');}
  else if(kind==='link'){post('link',{url:value});flash('↗ '+value);}
  else if(kind==='notify'){post('notify',{message:value});flash(value);}
}
function mwTheme(id){document.documentElement.setAttribute('data-theme',id);
  var b=document.querySelectorAll('.mw-theme');b.forEach(function(x){x.classList.toggle('on',x.getAttribute('data-t')===id);});
  flash('theme · '+id);}
function mwToggle(el,name){var on=el.getAttribute('data-on')==='1';
  el.setAttribute('data-on',on?'0':'1');flash((on?'○ disable ':'● enable ')+name);
  post('prompt',(on?'Disable ':'Enable ')+name);}

// One delegated listener for every action. See the note above BRIDGE.
document.addEventListener('click',function(e){
  var t=e.target&&e.target.closest&&e.target.closest('[data-mw-act]');
  if(!t)return;
  var act=t.dataset.mwAct;
  var val=t.dataset.mwVal||'';
  if(act==='toggle'){e.stopPropagation();mwToggle(t,val);return;}
  if(act==='theme'){mwTheme(val);return;}
  if(act==='tool'||act==='prompt'||act==='link'||act==='notify'){mw(act,val);}
});
document.addEventListener('pointerdown',function(e){
  var t=e.target&&e.target.closest&&e.target.closest('.mw-btn,.mw-lrow,.mw-mrow,.mw-game,.mw-tab,.mw-theme,.mw-toggle');
  if(!t)return;t.classList.add('mw-press');setTimeout(function(){t.classList.remove('mw-press');},170);
},true);
`;

/**
 * Render the full themed shell document for a ui:// resource. Pass whichever
 * view's data you have; unprovided views render a themed empty state.
 */
export function renderShell(opts: ShellOptions): string {
  const theme = resolveTheme(opts.theme);
  const view: ShellView = opts.view ?? "deck";
  const content =
    view === "mods"
      ? renderMods(opts.mods ?? {})
      : view === "crash"
        ? renderCrash(opts.crash ?? {})
        : view === "conflicts"
          ? renderConflicts(opts.conflicts ?? {})
          : view === "deps"
            ? renderDeps(opts.deps ?? {})
            : renderDeck(opts.deck ?? {});

  return `<!doctype html>
<html lang="en" data-theme="${theme.id}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ModWrench — ${esc(theme.game)}</title>
${themeFontsHead()}
<style>${themeStyleBlock()}${BASE_CSS}</style>
</head>
<body>
<div class="mw-app">
  <header class="mw-top">
    <div class="mw-brand"><b>&#9881; ModWrench</b><span class="mw-brand-sub">stateless deck</span></div>
    <div class="mw-tabs">${tabs(view)}</div>
    <nav class="mw-themes" title="theme">${themeSwitcher(theme.id)}</nav>
  </header>
  <div class="mw-body">${content}</div>
  <footer class="mw-foot">
    <span class="mw-tag">${esc(theme.tagline)}</span>
    <span>holds nothing · reads only · renders from tool output</span>
  </footer>
</div>
<div class="mw-flash" id="mwFlash"></div>
<script>${BRIDGE}</script>
</body>
</html>`;
}
