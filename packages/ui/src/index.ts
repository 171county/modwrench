// @modwrench/ui — stateless MCP-UI toolkit for ModWrench.
//
// Tools return a themed, interactive UI as a ui:// resource built entirely from
// their own output. Four flagship-game themes (Skyrim, Fallout, Lethal Company,
// Valheim); three views (deck, mod cards, crashlog panel) under one shell. No
// state, no storage, no network from the rendered HTML.

export { createUIResource, esc } from "./resource.js";
export type { UIResourceBlock } from "./resource.js";

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
