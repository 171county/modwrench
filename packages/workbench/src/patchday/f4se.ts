import { PeFile } from "./pe.js";

// ─── What an F4SE plugin DLL says about itself ───────────────────────────────
// Fallout 4's script extender works like Skyrim's. Since the Next-Gen update
// (game 1.10.980, F4SE 0.7.0), F4SE reads a data export called F4SEPlugin_Version
// straight out of each plugin file before loading it: a fixed 1,116-byte struct in
// which the plugin says how it finds the game's code and which game versions it
// works with. The layout below is F4SEPluginVersionData from F4SE's own PluginAPI.h
// (ianpatt/f4se at 6f6a7caa, 2026-09-06). Before the Next-Gen update, F4SE 0.6.23
// loaded every DLL and asked the plugin's own code (F4SEPlugin_Query); that is
// still what a plugin with no version data exports.
//
//   0x000  dataVersion            u32  (kVersion = 1)
//   0x004  pluginVersion          u32
//   0x008  name                   char[256]
//   0x108  author                 char[256]
//   0x208  addressIndependence    u32  bit 0 signatures, bit 1 Address Library 1.10.980+, bit 2 Address Library 1.11.137+
//   0x20C  structureIndependence  u32  bit 0 no game structures, bit 1 1.10.980+ layout, bit 2 1.11.137+ layout
//   0x210  compatibleVersions     u32[16], zero-terminated
//   0x250  seVersionRequired      u32  compared against the packed F4SE version
//   0x254  reservedNonBreaking    u32
//   0x258  reservedBreaking       u32  anything here and F4SE treats the plugin as not version-independent
//   0x25C  reserved               u8[512]
//
// Reading it needs no game running and no code from the plugin executing.

export const F4SE_PLUGIN_VERSION_SIZE = 1116;

/** addressIndependence bits (F4SEPluginVersionData::kAddressIndependence_*). The 1.11.137 bit came with F4SE 0.7.5. */
export const AI_SIGNATURES = 1 << 0;
export const AI_ADDRESS_LIBRARY_1_10_980 = 1 << 1;
export const AI_ADDRESS_LIBRARY_1_11_137 = 1 << 2;

/** structureIndependence bits (kStructureIndependence_*). */
export const SI_NO_STRUCTS = 1 << 0;
export const SI_1_10_980_LAYOUT = 1 << 1;
export const SI_1_11_137_LAYOUT = 1 << 2;

export type F4seVersionData = {
  dataVersion: number;
  pluginVersion: number;
  name: string;
  author: string;
  addressIndependence: number;
  structureIndependence: number;
  /** Packed game versions the plugin lists, up to the first zero (as F4SE reads them). */
  compatibleVersions: number[];
  seVersionRequired: number;
  reservedBreaking: number;
};

/** Parse the 1,116-byte F4SEPluginVersionData struct. Null if the buffer is short. */
export function parseF4seVersionData(buf: Buffer): F4seVersionData | null {
  if (buf.length < F4SE_PLUGIN_VERSION_SIZE) return null;
  // F4SE ends both strings at their last byte (PluginManager::Sanitize), so a name is at most 255 characters.
  const text = (from: number, to: number): string => {
    const end = buf.indexOf(0, from);
    return buf.toString("latin1", from, end === -1 || end > to - 1 ? to - 1 : end);
  };
  const compatibleVersions: number[] = [];
  for (let i = 0; i < 16; i++) {
    const v = buf.readUInt32LE(0x210 + i * 4);
    if (v === 0) break;
    compatibleVersions.push(v);
  }
  return {
    dataVersion: buf.readUInt32LE(0x000),
    pluginVersion: buf.readUInt32LE(0x004),
    name: text(0x008, 0x108),
    author: text(0x108, 0x208),
    addressIndependence: buf.readUInt32LE(0x208),
    structureIndependence: buf.readUInt32LE(0x20c),
    compatibleVersions,
    seVersionRequired: buf.readUInt32LE(0x250),
    reservedBreaking: buf.readUInt32LE(0x258),
  };
}

export type F4seDllInfo = {
  /** False when the file could not be read as a Windows DLL at all. */
  readable: boolean;
  problem?: string;
  is64: boolean;
  exports: { version: boolean; query: boolean; load: boolean; preload: boolean };
  versionData?: F4seVersionData;
  /** The PE header's build time, for a readable 64-bit DLL. */
  buildTime?: number;
};

const NO_EXPORTS = { version: false, query: false, load: false, preload: false };

/** Inspect one F4SE plugin DLL. Never throws; never executes the file. */
export function inspectF4sePlugin(path: string): F4seDllInfo {
  const pe = PeFile.open(path);
  if ("problem" in pe) {
    return { readable: false, problem: pe.problem, is64: false, exports: NO_EXPORTS };
  }
  try {
    // A 32-bit DLL can't go into the 64-bit game; F4SE says so before it reads anything else.
    if (!pe.is64) return { readable: true, is64: false, exports: NO_EXPORTS };

    const table = pe.exports();
    if (!table) {
      return { readable: false, problem: "damaged export table", is64: true, exports: NO_EXPORTS };
    }
    const info: F4seDllInfo = {
      readable: true,
      is64: true,
      exports: {
        version: table.has("F4SEPlugin_Version"),
        query: table.has("F4SEPlugin_Query"),
        load: table.has("F4SEPlugin_Load"),
        preload: table.has("F4SEPlugin_Preload"),
      },
      buildTime: pe.timeDateStamp,
    };
    const versionRva = table.get("F4SEPlugin_Version");
    if (versionRva !== undefined) {
      const raw = pe.readRva(versionRva, F4SE_PLUGIN_VERSION_SIZE);
      const data = raw ? parseF4seVersionData(raw) : null;
      if (data) info.versionData = data;
      else info.problem = "F4SEPlugin_Version points outside the file";
    }
    return info;
  } finally {
    pe.close();
  }
}
