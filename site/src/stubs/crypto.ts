import { unavailable } from "./unavailable.js";

// node:crypto in the browser build. Crash Whisperer hashes a log only to tell it apart from the other recent logs it
// compares on disk, which the page never does (compareRecent: 0).
export const createHash = unavailable("crypto.createHash");
