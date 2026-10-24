import { unavailable } from "./unavailable.js";

// node:path in the browser build. The page has no file paths: a pasted log has no file behind it. These are used only
// to find and open files on disk, so each throws rather than guess at a platform's rules.
export const basename = unavailable("path.basename");
export const dirname = unavailable("path.dirname");
export const isAbsolute = unavailable("path.isAbsolute");
export const join = unavailable("path.join");
export const normalize = unavailable("path.normalize");
export const parse = unavailable("path.parse");
export const resolve = unavailable("path.resolve");
export const win32 = { resolve: unavailable("path.win32.resolve") };
