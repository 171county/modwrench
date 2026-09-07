// ─── Flagship-game themes ─────────────────────────────────────────────────────
// Authentic homage skins drawn from what these modders actually stare at — the
// in-game UIs *and* the modding toolchains. Every palette, font, and motif here
// traces to a real reference (Pip-Boy green #1AFF80, the BepInEx console severity
// colors, xEdit conflict coding, Valheim's Averia Serif Libre, r2modman/MO2
// layouts). See docs for provenance.
//
// Each theme is a token set + a `chrome` CSS string. The shell emits base CSS
// plus one [data-theme] var block and the theme's chrome; switching themes is a
// client-side data-attribute swap. No state.

export type ThemeId = "skyrim" | "fallout" | "lethal" | "valheim";

export type Theme = {
  id: ThemeId;
  label: string;
  game: string;
  tagline: string;
  tokens: {
    bg: string;
    panel: string;
    panel2: string;
    ink: string;
    sub: string;
    accent: string;
    accent2: string;
    danger: string;
    warn: string;
    ok: string;
    border: string;
    fontHead: string;
    fontUi: string;
    fontMono: string;
    /** Extra declarations spliced into the [data-theme] var block. */
    fx: string;
  };
  /** Full CSS rules (selectors scoped to [data-theme="id"]) — the signature look. */
  chrome: string;
};

// Free / OFL / system-safe stacks. No webfonts are fetched — see themeFontsHead().
// Each stack leads with a named face (used if the user happens to have it) and
// falls back to a strong system font, so panels render correctly offline and
// contact no third party.
const F = {
  cinzel: '"Cinzel", "Trajan Pro", Georgia, serif',
  oswald: '"Oswald", "Arial Narrow", "Roboto Condensed", sans-serif',
  averia: '"Averia Serif Libre", Georgia, "Times New Roman", serif',
  vt323: '"VT323", "Share Tech Mono", ui-monospace, monospace',
  shareTech: '"Share Tech Mono", "IBM Plex Mono", ui-monospace, monospace',
  plexMono: '"IBM Plex Mono", "Cascadia Mono", ui-monospace, Consolas, monospace',
  sysMono: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
};

export const THEMES: Record<ThemeId, Theme> = {
  // ── Skyrim — MO2 iron + parchment + dragonstone gold + SkyUI list ──────────
  skyrim: {
    id: "skyrim",
    label: "Skyrim",
    game: "The Elder Scrolls V: Skyrim",
    tagline: "Fus Ro Dah — load orders, tamed.",
    tokens: {
      bg: "#15130E",
      panel: "#211E17",
      panel2: "#2C2820",
      ink: "#EDE6D3",
      sub: "#9C9078",
      accent: "#C89B3C",
      accent2: "#6FA8C4",
      danger: "#C0433E",
      warn: "#E0A230",
      ok: "#6FA84E",
      border: "#3A342A",
      fontHead: F.cinzel,
      fontUi: F.oswald,
      fontMono: F.plexMono,
      fx: `--tex: radial-gradient(120% 120% at 50% -8%, rgba(200,155,60,.08), transparent 55%);
        --glow: inset 0 1px 0 rgba(255,255,255,.05), inset 0 -1px 0 rgba(0,0,0,.5), 0 8px 26px rgba(0,0,0,.5);`,
    },
    chrome: `
      [data-theme="skyrim"] body{background-image:var(--tex),
        repeating-linear-gradient(90deg, rgba(255,255,255,.015) 0 1px, transparent 1px 4px)}
      [data-theme="skyrim"] .mw-brand b,[data-theme="skyrim"] .mw-sec-h h2,[data-theme="skyrim"] .mw-card-nm,
      [data-theme="skyrim"] .mw-conn-nm{font-family:var(--font-head);letter-spacing:.02em;
        text-shadow:0 1px 0 rgba(0,0,0,.6),0 -1px 0 rgba(255,255,255,.04)}
      [data-theme="skyrim"] .mw-sec-h{border-bottom:1px solid transparent;
        background:linear-gradient(90deg,transparent,var(--accent) 8%,transparent) bottom/100% 1px no-repeat;padding-bottom:8px}
      /* SkyUI list: gold caret on hover/active rows */
      [data-theme="skyrim"] .mw-conn{border-radius:4px}
      [data-theme="skyrim"] .mw-conn::after{content:"\\276F";position:absolute;right:12px;color:var(--accent);opacity:0;transition:.12s}
      [data-theme="skyrim"] .mw-conn:hover::after{opacity:1}
      [data-theme="skyrim"] .mw-conn:hover{background:linear-gradient(90deg,rgba(200,155,60,.10),transparent)}
      [data-theme="skyrim"] .mw-tab.on{background:var(--accent);color:#1a1509}
    `,
  },

  // ── Fallout — Pip-Boy CRT green + RobCo terminal + scanlines ───────────────
  fallout: {
    id: "fallout",
    label: "Fallout",
    game: "Fallout 4",
    tagline: "Vault-Tec approved. Buffout4 in plain text.",
    tokens: {
      bg: "#08120C",
      panel: "#0E2416",
      panel2: "#12301D",
      ink: "#1AFF80",
      sub: "#1B9A4E",
      accent: "#2EFF9B",
      accent2: "#FFB641",
      danger: "#E23B2E",
      warn: "#FFB641",
      ok: "#2EFF9B",
      border: "#1E5A34",
      fontHead: F.vt323,
      fontUi: F.shareTech,
      fontMono: F.shareTech,
      fx: `--tex: none;
        --glow: inset 0 0 60px rgba(26,255,128,.06), 0 0 2px rgba(26,255,128,.4);
        --scan: repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0 2px, rgba(0,0,0,.34) 3px 4px);`,
    },
    chrome: `
      /* Pip-Boy CRT: scanlines + curved-glass vignette on the app frame */
      [data-theme="fallout"] .mw-app{border-radius:16px;box-shadow:inset 0 0 90px rgba(0,0,0,.7),inset 0 0 22px rgba(26,255,128,.05);
        animation:mwcrtflicker 5s infinite steps(1)}
      [data-theme="fallout"] .mw-app::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:50;
        background:var(--scan);background-size:100% 4px;mix-blend-mode:multiply}
      [data-theme="fallout"] .mw-app::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:49;
        background:radial-gradient(115% 120% at 50% 50%, transparent 52%, rgba(0,0,0,.62) 100%)}
      /* slow phosphor sweep down the screen */
      [data-theme="fallout"] .mw-body{position:relative}
      [data-theme="fallout"] .mw-body::after{content:"";position:absolute;left:0;right:0;top:0;height:26%;pointer-events:none;z-index:2;
        background:linear-gradient(rgba(26,255,128,0),rgba(26,255,128,.05),rgba(26,255,128,0));animation:mwsweep 7s linear infinite}
      [data-theme="fallout"] body{text-shadow:0 0 2px rgba(26,255,128,.85),0 0 8px rgba(26,255,128,.4);text-transform:uppercase}
      [data-theme="fallout"] .mw-brand-sub,[data-theme="fallout"] .mw-card-sum,[data-theme="fallout"] .mw-note{letter-spacing:.06em}
      [data-theme="fallout"] .mw-sec-h h2::before{content:"> "}
      [data-theme="fallout"] .mw-brand::after{content:"\\2588";animation:mwblink 1s steps(1) infinite;color:var(--accent);margin-left:2px}
      /* Pip-Boy tab bar: sits on a glowing rule; active tab is an inverted block */
      [data-theme="fallout"] .mw-tabs{border-bottom:2px solid var(--border);padding-bottom:2px;gap:0}
      [data-theme="fallout"] .mw-tab{letter-spacing:.14em;border-radius:0;border-bottom:2px solid transparent;margin-bottom:-2px}
      [data-theme="fallout"] .mw-tab.on{background:var(--ink);color:#04120a;box-shadow:0 0 12px rgba(26,255,128,.55);border-bottom-color:var(--ink)}
      [data-theme="fallout"] .mw-top{border-bottom-color:var(--border);box-shadow:0 2px 0 rgba(26,255,128,.12)}
      [data-theme="fallout"] .mw-conn,[data-theme="fallout"] .mw-card,[data-theme="fallout"] .mw-col,[data-theme="fallout"] .mw-lrow{box-shadow:var(--glow)}
      [data-theme="fallout"] .mw-btn.primary{box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 2px 0 rgba(0,0,0,.55),0 0 12px rgba(26,255,128,.45)}
      [data-theme="fallout"] .mw-btn:active{box-shadow:inset 0 0 14px rgba(26,255,128,.4),0 0 10px rgba(26,255,128,.3)}
      /* Pip-Boy status strip footer: HP/AP-style bracketed segments */
      [data-theme="fallout"] .mw-foot{border-top:2px solid var(--border);box-shadow:0 -2px 0 rgba(26,255,128,.12);
        text-transform:uppercase;letter-spacing:.1em;color:var(--ink);opacity:.85}
      [data-theme="fallout"] .mw-foot .mw-tag::before{content:"\\25C0 "}
      @keyframes mwblink{50%{opacity:0}}
      @keyframes mwsweep{from{transform:translateY(-30%)}to{transform:translateY(430%)}}
      @keyframes mwcrtflicker{0%,100%{opacity:1}96%{opacity:1}97%{opacity:.94}98%{opacity:1}}
    `,
  },

  // ── Lethal Company — monochrome ship terminal + BepInEx log ────────────────
  lethal: {
    id: "lethal",
    label: "Lethal Co.",
    game: "Lethal Company",
    tagline: "Meet the quota. Read the crash.",
    tokens: {
      bg: "#0A1410",
      panel: "#101d16",
      panel2: "#14251c",
      ink: "#3BFF6E",
      sub: "#1FA34C",
      accent: "#3BFF6E",
      accent2: "#39E9AA",
      danger: "#E23D3D",
      warn: "#F5C518",
      ok: "#3BFF6E",
      border: "#1d4230",
      fontHead: F.shareTech,
      fontUi: F.plexMono,
      fontMono: F.plexMono,
      fx: `--tex: none;
        --glow: inset 0 0 40px rgba(59,255,110,.06), 0 0 0 1px rgba(59,255,110,.14);
        --scan: repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0 2px, rgba(0,0,0,.28) 2px 4px);`,
    },
    chrome: `
      [data-theme="lethal"] .mw-app::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:50;
        background:var(--scan);mix-blend-mode:multiply}
      [data-theme="lethal"] body{text-shadow:0 0 2px rgba(59,255,110,.6),0 0 8px rgba(59,255,110,.3);text-transform:uppercase}
      /* one-color rule: scrollbars + carets inherit terminal green */
      [data-theme="lethal"] *{scrollbar-color:var(--accent) transparent}
      [data-theme="lethal"] ::selection{background:var(--accent);color:#04120a}
      [data-theme="lethal"] .mw-sec-h h2::before{content:"> "}
      [data-theme="lethal"] .mw-brand::after{content:"\\2588";animation:mwblink 1s steps(1) infinite;color:var(--accent);margin-left:2px}
      [data-theme="lethal"] .mw-tab.on{background:var(--accent);color:#04120a}
      [data-theme="lethal"] .mw-conn,[data-theme="lethal"] .mw-card,[data-theme="lethal"] .mw-col,[data-theme="lethal"] .mw-list{box-shadow:var(--glow)}
      [data-theme="lethal"] .mw-btn:active{box-shadow:inset 0 0 14px rgba(59,255,110,.4),0 0 10px rgba(59,255,110,.3)}
      @keyframes mwblink{50%{opacity:0}}
    `,
  },

  // ── Valheim — carved wood + parchment + aged bronze + rune bevels ──────────
  valheim: {
    id: "valheim",
    label: "Valheim",
    game: "Valheim",
    tagline: "Tenth world. r2modman, ordered.",
    tokens: {
      bg: "#17110B",
      panel: "#2B2119",
      panel2: "#33271C",
      ink: "#E7DBBE",
      sub: "#9C8F72",
      accent: "#C6A05A",
      accent2: "#03B3CB",
      danger: "#C0392B",
      warn: "#E3C36B",
      ok: "#6FA84E",
      border: "#5A4527",
      fontHead: F.averia,
      fontUi: F.averia,
      fontMono: F.sysMono,
      fx: `--gilt:#E3C36B;
        --tex: repeating-linear-gradient(90deg, rgba(0,0,0,.26) 0 2px, transparent 2px 7px),
          repeating-linear-gradient(0deg, rgba(120,80,40,.08) 0 3px, rgba(0,0,0,.10) 3px 8px);
        --glow: inset 0 1px 0 rgba(198,160,90,.15), inset 0 0 26px rgba(0,0,0,.45), 0 6px 16px rgba(0,0,0,.5);`,
    },
    chrome: `
      [data-theme="valheim"] body{background-image:var(--tex),linear-gradient(180deg,#221913,#140f0a)}
      [data-theme="valheim"] .mw-brand b,[data-theme="valheim"] .mw-sec-h h2,[data-theme="valheim"] .mw-card-nm,
      [data-theme="valheim"] .mw-conn-nm{font-family:var(--font-head);color:var(--gilt);
        text-shadow:0 1px 0 rgba(0,0,0,.5)}
      /* rune-carved bronze bevel on panels */
      [data-theme="valheim"] .mw-conn,[data-theme="valheim"] .mw-card,[data-theme="valheim"] .mw-col{
        border:2px solid var(--accent);border-radius:3px;
        box-shadow:inset 0 0 0 1px rgba(20,12,6,.85), inset 0 2px 3px rgba(0,0,0,.55),
          0 0 0 1px rgba(227,195,107,.2), 0 6px 16px rgba(0,0,0,.5)}
      [data-theme="valheim"] .mw-conn:hover,[data-theme="valheim"] .mw-card:hover{border-color:var(--gilt);
        box-shadow:inset 0 2px 4px rgba(0,0,0,.5), 0 0 10px rgba(41,253,254,.25)}
      [data-theme="valheim"] .mw-tab.on{background:var(--accent);color:#1a1109}
      [data-theme="valheim"] .mw-chip-ct,[data-theme="valheim"] .mw-card-stats{font-family:var(--font-head);color:var(--gilt)}
    `,
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export function resolveTheme(id: string | undefined): Theme {
  return (id && THEMES[id as ThemeId]) || THEMES.skyrim;
}

/**
 * Infer the theme from a crashlog type so the crash panel matches the game:
 * Fallout/Buffout4 → Pip-Boy, BepInEx (Unity co-op) → Lethal terminal, Skyrim → Skyrim.
 */
export function themeForCrashType(crashType: string | undefined): ThemeId {
  switch (crashType) {
    case "buffout4":
      return "fallout";
    case "bepinex":
      return "lethal";
    case "crashlogger-sse":
    case "netscriptframework":
    default:
      return "skyrim";
  }
}

/**
 * Deliberately empty.
 *
 * These panels used to load webfonts from Google Fonts. That meant every tool
 * call returning a UI resource caused the user's client to contact Google —
 * sending their IP and User-Agent to a third party they never opted into, on a
 * tool whose entire premise is that it holds nothing about them. It also made
 * README's "nothing is sent anywhere except the platforms you're already using"
 * false.
 *
 * Every font stack in this file leads with a named face and falls back to a
 * strong system font, so the panels still render correctly with no webfonts at
 * all. Losing a typeface is a cheap price for a claim that survives someone
 * opening DevTools.
 *
 * If webfonts are ever wanted back, self-host or inline them — do not reach out
 * to a third party from a user's machine without asking.
 */
export function themeFontsHead(): string {
  return "";
}

/** Emit base var blocks (one per theme) + every theme's chrome CSS. */
export function themeStyleBlock(): string {
  const vars = THEME_IDS.map((id) => {
    const t = THEMES[id].tokens;
    return `[data-theme="${id}"]{
  --bg:${t.bg};--panel:${t.panel};--panel2:${t.panel2};--ink:${t.ink};--sub:${t.sub};
  --accent:${t.accent};--accent2:${t.accent2};--danger:${t.danger};--warn:${t.warn};--ok:${t.ok};--border:${t.border};
  --font-head:${t.fontHead};--font-body:${t.fontUi};--mono:${t.fontMono};
  ${t.fx.trim()}
}`;
  }).join("\n");
  const chrome = THEME_IDS.map((id) => THEMES[id].chrome.trim()).join("\n");
  return vars + "\n" + chrome;
}
