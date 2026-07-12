// ─── View renderers ───────────────────────────────────────────────────────────
// Pure functions: (data) -> HTML fragment string for the shell's main area.
// Every view is a function of the tool result only — no state, no fetch. Missing
// data renders a themed empty state that invites the relevant tool call.
//
// Actions post MCP-UI intents to the host via the mw() bridge defined in the
// shell (window.parent.postMessage). Buttons never mutate anything locally.

import { esc } from "./resource.js";

export type Connector = {
  id: string;
  name: string;
  toolCount?: number;
  status?: "on" | "off" | "warn";
  /** Tool to invoke when the connector chip is clicked (e.g. "nexus_get_game"). */
  tool?: string;
};

export type DeckData = {
  connectors?: Connector[];
  /** Optional flagship-game shortcuts with a few example mods. */
  games?: Array<{ id: string; name: string; note?: string }>;
};

export type ModCard = {
  id?: string | number;
  name: string;
  author: string;
  platform?: string;
  version?: string;
  downloads?: number;
  endorsements?: number;
  summary?: string;
  pageUrl?: string;
};

export type ModsData = {
  query?: string;
  mods?: ModCard[];
};

export type CrashData = {
  detectedType?: string;
  gameVersion?: string;
  loggerVersion?: string;
  exception?: { type?: string; address?: string; description?: string };
  callStack?: Array<{
    index?: number;
    module?: string;
    function?: string;
    offset?: string;
  }>;
  registers?: Record<string, string>;
  loadedPlugins?: Array<{ name: string; loadIndex?: string; index?: string | number }>;
  suspectedRefs?: Array<{ type?: string; value?: string; likelySource?: string }>;
  /** Recognized-but-unstructured sections (MODULES, F4SE PLUGINS, STACK, ...). */
  rawSections?: Record<string, string>;
  ok?: boolean;
  reason?: string;
};

export type ConflictItem = {
  modA: string;
  modB: string;
  severity: string;
  description: string;
  source: string;
  workaround?: string;
  patchModId?: string;
};

export type ConflictsData = {
  gameId?: string;
  conflicts?: ConflictItem[];
  sources?: {
    loot?: { available: boolean; reason?: string };
    community?: { available: boolean; entries: number };
  };
  warnings?: string[];
};

export type DepsData = {
  title?: string;
  root?: string;
  deps?: string[];
  loadOrder?: Array<{
    name: string;
    enabled?: boolean | null;
    index?: number;
    version?: string;
    source?: string;
    pluginFile?: string;
  }>;
  manager?: string;
  profile?: string;
  enabledCount?: number;
  totalCount?: number;
};

function num(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function empty(title: string, hint: string, action?: { label: string; tool: string }): string {
  const btn = action
    ? `<button class="mw-btn primary" onclick="mw('tool','${esc(action.tool)}')">${esc(action.label)}</button>`
    : "";
  return `<div class="mw-empty"><div class="mw-empty-mark"></div><h3>${esc(title)}</h3><p>${esc(hint)}</p>${btn}</div>`;
}

// ─── Deck — MO2-style ordered connector list ─────────────────────────────────

export function renderDeck(data: DeckData): string {
  const connectors = data.connectors ?? [];
  if (connectors.length === 0) {
    return empty("No connectors active", "Activate a platform to populate the deck.", {
      label: "Detect environment",
      tool: "mw_detect_environment",
    });
  }
  const rows = connectors
    .map((c, i) => {
      const dot = c.status ?? "on";
      const tool = c.tool ? esc(c.tool) : "";
      const click = tool ? `onclick="mw('tool','${tool}')"` : "";
      const prio = String(i + 1).padStart(2, "0");
      const flag =
        dot === "off"
          ? `<span class="mw-flag">OFF</span>`
          : dot === "warn"
            ? `<span class="mw-flag warn">WARN</span>`
            : `<span class="mw-flag ok">ON</span>`;
      const count =
        c.toolCount !== undefined ? `<span class="mw-lct">${c.toolCount} tools</span>` : "";
      return `<button class="mw-lrow" ${click} title="${tool}">
        <span class="mw-handle">⠿</span>
        <span class="mw-prio">${prio}</span>
        <span class="mw-dot ${dot}"></span>
        <span class="mw-lmain"><span class="mw-lname">${esc(c.name)}</span>
          <span class="mw-lmeta">${tool || "local"}</span></span>
        ${flag}${count}
        <span class="mw-chev">›</span>
      </button>`;
    })
    .join("");

  const games = (data.games ?? [])
    .map(
      (g) => `<button class="mw-game" onclick="mw('prompt','Show top ${esc(g.name)} mods')">
        <span class="mw-game-nm">${esc(g.name)}</span>
        ${g.note ? `<span class="mw-game-note">${esc(g.note)}</span>` : ""}
      </button>`
    )
    .join("");

  return `
    <section class="mw-sec">
      <div class="mw-sec-h"><h2>Connectors</h2><span class="mw-sec-sub">load order · click a row to run its tool</span></div>
      <div class="mw-list">${rows}</div>
    </section>
    ${
      games
        ? `<section class="mw-sec">
      <div class="mw-sec-h"><h2>Flagship scenes</h2><span class="mw-sec-sub">jump to a game</span></div>
      <div class="mw-game-grid">${games}</div>
    </section>`
        : ""
    }`;
}

// ─── Mod cards — r2modman-style rows with enable toggles ──────────────────────

export function renderMods(data: ModsData): string {
  const mods = data.mods ?? [];
  if (mods.length === 0) {
    return empty(
      "No mods to show",
      data.query ? `Nothing came back for "${data.query}".` : "Run a search to populate mod cards.",
      { label: "Search mods", tool: "nexus_search" }
    );
  }
  const rows = mods
    .map((m) => {
      const initials =
        esc(
          m.name
            .split(/\s+/)
            .map((w) => w[0] ?? "")
            .join("")
            .slice(0, 2)
            .toUpperCase()
        ) || "MO";
      const plat = m.platform ? `<span class="mw-badge">${esc(m.platform)}</span>` : "";
      const open = m.pageUrl
        ? `<button class="mw-btn" onclick="mw('link','${esc(m.pageUrl)}')">Open ›</button>`
        : "";
      const toggle = `<span class="mw-toggle" data-on="1" title="enable / disable" onclick="mwToggle(this,'${esc(
        m.name
      )}',event)"></span>`;
      const stats = `<span class="mw-mstat"><span title="downloads">▼ ${num(
        m.downloads
      )}</span><span title="endorsements">★ ${num(m.endorsements)}</span></span>`;
      return `<div class="mw-mrow">
        <span class="mw-micon">${initials}</span>
        <span class="mw-mmain">
          <span class="mw-mname">${esc(m.name)}${plat}</span>
          <span class="mw-mby">by <strong>${esc(m.author)}</strong>${
            m.version ? ` · v${esc(m.version)}` : ""
          }</span>
          ${m.summary ? `<span class="mw-msum">${esc(m.summary)}</span>` : ""}
        </span>
        ${stats}
        <span class="mw-mact">${open}${toggle}</span>
      </div>`;
    })
    .join("");
  return `<section class="mw-sec">
    <div class="mw-sec-h"><h2>Mods${data.query ? ` · "${esc(data.query)}"` : ""}</h2>
      <span class="mw-sec-sub">r2modman-style · attribution on every row</span></div>
    <div class="mw-list">${rows}</div>
  </section>`;
}

// ─── Crash panel ──────────────────────────────────────────────────────────────

export function renderCrash(data: CrashData): string {
  if (data.ok === false) {
    return empty("Couldn't parse that crashlog", data.reason ?? "Unknown format.", {
      label: "Try another log",
      tool: "mw_parse_crashlog",
    });
  }
  if (!data.exception && !(data.callStack && data.callStack.length)) {
    return empty("No crashlog loaded", "Parse a crashlog to see the breakdown here.", {
      label: "Parse a crashlog",
      tool: "mw_parse_crashlog",
    });
  }

  const ex = data.exception ?? {};
  const ver = [data.gameVersion, data.loggerVersion].filter(Boolean).map(esc).join(" · ");

  const stack = (data.callStack ?? [])
    .slice(0, 32)
    .map(
      (f, i) => `<li><span class="mw-frame-i">${f.index ?? i}</span>
        <span class="mw-frame-mod">${esc(f.module ?? "—")}</span>
        ${f.function ? `<span class="mw-frame-fn">${esc(f.function)}</span>` : ""}
        ${f.offset ? `<span class="mw-frame-off">+${esc(f.offset)}</span>` : ""}</li>`
    )
    .join("");

  const suspects = (data.suspectedRefs ?? [])
    .slice(0, 10)
    .map(
      (s) =>
        `<span class="mw-suspect">${esc(s.value ?? s.type ?? "ref")}${s.likelySource ? ` <em>${esc(s.likelySource)}</em>` : ""}</span>`
    )
    .join("");

  const regs = Object.entries(data.registers ?? {})
    .slice(0, 32)
    .map(([r, v]) => `<div class="mw-reg"><span class="mw-reg-k">${esc(r)}</span><span class="mw-reg-v">${esc(v)}</span></div>`)
    .join("");

  const plugins = data.loadedPlugins ?? [];
  const pluginList = plugins
    .slice(0, 60)
    .map(
      (p) => `<li>${p.loadIndex ? `<span class="mw-frame-i">${esc(p.loadIndex)}</span>` : ""}${esc(p.name)}</li>`
    )
    .join("");

  // Buffout4/CrashLogger recognized-but-unstructured sections (MODULES, F4SE PLUGINS, STACK, SETTINGS, ...).
  const rawOrder = ["SETTINGS", "MODULES", "F4SE PLUGINS", "SKSE PLUGINS", "STACK"];
  const rawEntries = Object.entries(data.rawSections ?? {});
  rawEntries.sort((a, b) => {
    const ia = rawOrder.indexOf(a[0].toUpperCase());
    const ib = rawOrder.indexOf(b[0].toUpperCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const rawBlocks = rawEntries
    .map(([name, text]) => {
      const body = esc(String(text).split(/\r?\n/).slice(0, 60).join("\n"));
      return `<details class="mw-raw"><summary>${esc(name.toUpperCase())}</summary><pre class="mw-pre">${body}</pre></details>`;
    })
    .join("");

  return `<section class="mw-sec mw-crash">
    <div class="mw-crash-head">
      <span class="mw-crash-type">${esc((data.detectedType ?? "crashlog").toUpperCase())}</span>
      <h2 class="mw-crash-ex">${esc(ex.type ?? "Unknown exception")}</h2>
      ${ex.address ? `<span class="mw-crash-addr">${esc(ex.address)}</span>` : ""}
      ${ver ? `<span class="mw-crash-ver">${ver}</span>` : ""}
    </div>
    ${ex.description ? `<p class="mw-crash-desc">${esc(ex.description)}</p>` : ""}
    ${suspects ? `<div class="mw-suspects"><span class="mw-lbl">SUSPECTED</span>${suspects}</div>` : ""}
    <div class="mw-crash-cols">
      <div class="mw-col">
        <div class="mw-col-h">PROBABLE CALL STACK <span class="mw-count">${(data.callStack ?? []).length}</span></div>
        <ol class="mw-stack">${stack || '<li class="mw-muted">no frames parsed</li>'}</ol>
      </div>
      <div class="mw-col">
        <div class="mw-col-h">REGISTERS <span class="mw-count">${Object.keys(data.registers ?? {}).length}</span></div>
        <div class="mw-regs">${regs || '<span class="mw-muted">none parsed</span>'}</div>
      </div>
    </div>
    <div class="mw-col mw-col-wide">
      <div class="mw-col-h">PLUGINS <span class="mw-count">${plugins.length}</span></div>
      <ul class="mw-plugins mw-plugins-wide">${pluginList || '<li class="mw-muted">none listed</li>'}</ul>
    </div>
    ${rawBlocks ? `<div class="mw-raws">${rawBlocks}</div>` : ""}
    <div class="mw-card-actions">
      <button class="mw-btn primary" onclick="mw('prompt','Diagnose this crash from the parsed ModWrench output (exception, call stack, registers, modules, plugins) and suggest likely culprits — do not guess beyond the data.')">Ask AI to diagnose</button>
      <span class="mw-note">ModWrench parses; it never guesses the cause — that's the model's job.</span>
    </div>
  </section>`;
}

// ─── Conflicts — xEdit/LOOT severity coding ───────────────────────────────────

const SEVERITY: Record<string, { cls: string; label: string }> = {
  incompatible: { cls: "loser", label: "INCOMPATIBLE" },
  "load-order-sensitive": { cls: "order", label: "LOAD ORDER" },
  "patch-available": { cls: "patch", label: "PATCH AVAIL" },
  informational: { cls: "info", label: "INFO" },
};

export function renderConflicts(data: ConflictsData): string {
  const conflicts = data.conflicts ?? [];
  const loot = data.sources?.loot;
  const community = data.sources?.community;
  const sources = [
    loot ? `<span class="mw-src ${loot.available ? "ok" : "off"}">LOOT ${loot.available ? "live" : "off"}</span>` : "",
    community ? `<span class="mw-src ${community.available ? "ok" : "off"}">community ${community.entries}</span>` : "",
  ].join("");

  const legend = `<div class="mw-legend">
    <span class="mw-sev loser">incompatible</span>
    <span class="mw-sev order">load order</span>
    <span class="mw-sev patch">patch</span>
    <span class="mw-sev info">info</span></div>`;

  if (conflicts.length === 0) {
    return `<section class="mw-sec">
      <div class="mw-sec-h"><h2>Conflicts${data.gameId ? ` · ${esc(data.gameId)}` : ""}</h2><span class="mw-sec-sub">${sources}</span></div>
      ${legend}
      <div class="mw-clean"><span class="mw-clean-mark">✔</span> No known conflicts among the checked mods.</div>
      ${(data.warnings ?? []).map((w) => `<div class="mw-warnrow">${esc(w)}</div>`).join("")}
    </section>`;
  }

  const rows = conflicts
    .map((c) => {
      const sev = SEVERITY[c.severity] ?? { cls: "info", label: esc(c.severity).toUpperCase() };
      const patch = c.patchModId
        ? `<button class="mw-btn" onclick="mw('prompt','Find the patch mod ${esc(c.patchModId)}')">Patch</button>`
        : "";
      return `<div class="mw-crow">
        <span class="mw-sev ${sev.cls}">${sev.label}</span>
        <span class="mw-cmain">
          <span class="mw-cpair"><strong>${esc(c.modA)}</strong> <span class="mw-vs">⚔</span> <strong>${esc(c.modB)}</strong></span>
          <span class="mw-cdesc">${esc(c.description)}</span>
          ${c.workaround ? `<span class="mw-cwork">↳ ${esc(c.workaround)}</span>` : ""}
        </span>
        <span class="mw-csrc">${esc(c.source)}</span>
        ${patch}
      </div>`;
    })
    .join("");

  return `<section class="mw-sec">
    <div class="mw-sec-h"><h2>Conflicts${data.gameId ? ` · ${esc(data.gameId)}` : ""} <span class="mw-count">${conflicts.length}</span></h2>
      <span class="mw-sec-sub">${sources}</span></div>
    ${legend}
    <div class="mw-list">${rows}</div>
    ${(data.warnings ?? []).map((w) => `<div class="mw-warnrow">${esc(w)}</div>`).join("")}
  </section>`;
}

// ─── Dependencies / load order — MO2 tree ─────────────────────────────────────

export function renderDeps(data: DepsData): string {
  const lo = data.loadOrder ?? [];
  if (lo.length > 0) {
    const rows = lo
      .slice(0, 200)
      .map((m, i) => {
        const on = m.enabled !== false;
        const idx = m.index ?? i;
        return `<div class="mw-lrow">
          <span class="mw-handle">⠿</span>
          <span class="mw-prio">${String(idx).padStart(2, "0")}</span>
          <span class="mw-dot ${on ? "on" : "off"}"></span>
          <span class="mw-lmain"><span class="mw-lname">${esc(m.name)}</span>
            <span class="mw-lmeta">${esc(m.pluginFile ?? m.source ?? "")}${m.version ? ` · v${esc(m.version)}` : ""}</span></span>
          <span class="mw-flag ${on ? "ok" : ""}">${on ? "ON" : "OFF"}</span>
        </div>`;
      })
      .join("");
    const meta = [data.manager, data.profile].filter(Boolean).map(esc).join(" · ");
    return `<section class="mw-sec">
      <div class="mw-sec-h"><h2>Load order${meta ? ` · ${meta}` : ""}</h2>
        <span class="mw-sec-sub">${data.enabledCount ?? lo.filter((m) => m.enabled !== false).length}/${data.totalCount ?? lo.length} enabled</span></div>
      <div class="mw-list">${rows}</div>
    </section>`;
  }

  const deps = data.deps ?? [];
  if (deps.length === 0) {
    return empty("No dependencies", data.root ? `${data.root} lists no dependencies.` : "Look up a mod's dependencies to see the chain.", {
      label: "Check dependencies",
      tool: "thunderstore_mod_dependencies",
    });
  }
  const tree = deps
    .map(
      (d) => `<div class="mw-lrow mw-dep"><span class="mw-tree">└─</span>
        <span class="mw-dot on"></span>
        <span class="mw-lmain"><span class="mw-lname">${esc(d)}</span></span></div>`
    )
    .join("");
  return `<section class="mw-sec">
    <div class="mw-sec-h"><h2>Dependencies${data.root ? ` · ${esc(data.root)}` : ""} <span class="mw-count">${deps.length}</span></h2>
      <span class="mw-sec-sub">install these first — the backbone of a correct profile</span></div>
    ${data.root ? `<div class="mw-lrow mw-deproot"><span class="mw-prio">▸</span><span class="mw-dot on"></span><span class="mw-lmain"><span class="mw-lname">${esc(data.root)}</span></span></div>` : ""}
    <div class="mw-list">${tree}</div>
  </section>`;
}
