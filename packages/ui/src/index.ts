// @modwrench/ui — stateless MCP-UI toolkit for ModWrench.
//
// Tools return a themed, interactive UI as a ui:// resource built entirely from
// their own output. Four flagship-game themes (Skyrim, Fallout, Lethal Company,
// Valheim); three views (deck, mod cards, crashlog panel) under one shell. No
// state, no storage, no network from the rendered HTML.

export { createUIResource, esc, panelsDisabled } from "./resource.js";
export type { UIResourceBlock } from "./resource.js";

// MCP Apps: pages a client fetches by URI instead of receiving inside the tool
// result. See app.ts.
export {
  MCP_APP_MIME,
  MCP_APPS_EXTENSION_ID,
  PATCH_DAY_APP_URI,
  CRASH_WHISPERER_APP_URI,
  appToolMeta,
  appResourceMeta,
  renderApp,
} from "./app.js";
export type { AppPage } from "./app.js";
export { renderPatchDayApp } from "./patchday-app.js";
export { renderCrashWhispererApp } from "./crashwhisperer-app.js";

export {
  THEMES,
  THEME_IDS,
  resolveTheme,
  themeForCrashType,
  themeStyleBlock,
} from "./themes.js";
export type { Theme, ThemeId } from "./themes.js";

export { renderDeck, renderMods, renderCrash, renderConflicts, renderDeps } from "./views.js";
export type {
  Connector,
  DeckData,
  ModCard,
  ModsData,
  CrashData,
  ConflictItem,
  ConflictsData,
  DepsData,
} from "./views.js";

export { renderShell } from "./shell.js";
export type { ShellOptions, ShellView } from "./shell.js";
