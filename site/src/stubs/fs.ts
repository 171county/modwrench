import { unavailable } from "./unavailable.js";

// node:fs in the browser build. Every function reads the disk, so every one throws.
export const closeSync = unavailable("fs.closeSync");
export const existsSync = unavailable("fs.existsSync");
export const fstatSync = unavailable("fs.fstatSync");
export const openSync = unavailable("fs.openSync");
export const readdirSync = unavailable("fs.readdirSync");
export const readFileSync = unavailable("fs.readFileSync");
export const readSync = unavailable("fs.readSync");
export const realpathSync = unavailable("fs.realpathSync");
export const statfsSync = unavailable("fs.statfsSync");
export const statSync = unavailable("fs.statSync");
