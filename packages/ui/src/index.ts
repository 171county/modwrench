// @modwrench/ui — the MCP Apps pages for ModWrench.
//
// A tool points at a page by URI; a client that draws MCP Apps pages fetches it
// and hands it the tool's result. The mods, dependencies, crash log, conflicts
// and deck pages wear four flagship-game skins (Skyrim, Fallout, Lethal Company,
// Valheim); Patch Day, Crash Whisperer and the Doctor follow the host's colours.
// No state, no storage, no network from any page.

export { esc, panelsDisabled } from "./app.js";

// MCP Apps: pages a client fetches by URI instead of receiving inside the tool
// result. See app.ts.
export {
  MCP_APP_MIME,
  MCP_APPS_EXTENSION_ID,
  PATCH_DAY_APP_URI,
  CRASH_WHISPERER_APP_URI,
  DOCTOR_APP_URI,
  appToolMeta,
  appResourceMeta,
  renderApp,
} from "./app.js";
export type { AppPage } from "./app.js";
export { renderPatchDayApp } from "./patchday-app.js";
export { renderCrashWhispererApp } from "./crashwhisperer-app.js";
export { renderDoctorApp } from "./doctor-app.js";

// Registering a page and answering a tool for it, from any package. See serve.ts.
export * from "./serve.js";

// The pages that replace the older panels, in the game skins of skin.ts.
export * from "./mods-app.js";
export * from "./deps-app.js";
export * from "./crash-app.js";
export * from "./conflicts-app.js";
export * from "./deck-app.js";

export {
  THEMES,
  THEME_IDS,
  themeForCrashType,
  themeStyleBlock,
} from "./themes.js";
export type { Theme, ThemeId } from "./themes.js";
