import { PeFile } from "./pe.js";

// ─── What an SKSE plugin DLL says about itself ───────────────────────────────
// A script-extender plugin is a DLL. Before loading it, SKSE reads a data
// export called SKSEPlugin_Version straight out of the file: a fixed 848-byte
// struct in which the plugin declares which game versions it works with. The
// layout below is SKSEPluginVersionData from SKSE's own PluginAPI.h (ianpatt/
// skse64, checked 2026-10-02) and matches CommonLibSSE-NG's PluginVersionData.
// Reading it needs no game running and no code from the plugin executing.

export const SKSE_PLUGIN_VERSION_SIZE = 848;

/** versionIndependence bits (SKSEPluginVersionData::kVersionIndependent_*). */
export const VI_ADDRESS_LIBRARY_POST_AE = 1 << 0;
export const VI_SIGNATURES = 1 << 1;
export const VI_STRUCTS_POST_629 = 1 << 2;
export const VI_KNOWN = VI_ADDRESS_LIBRARY_POST_AE | VI_SIGNATURES | VI_STRUCTS_POST_629;

/** versionIndependenceEx bits (kVersionIndependentEx_*). */
export const VIX_NO_STRUCT_USE = 1 << 0;
export const VIX_ADDRESS_LIBRARY_V5 = 1 << 1;

export type SkseVersionData = {
  dataVersion: number;
  pluginVersion: number;
  name: string;
  author: string;
  versionIndependenceEx: number;
  versionIndependence: number;
  /** Packed game versions the plugin lists, up to the first zero (as SKSE reads it). */
  compatibleVersions: number[];
  seVersionRequired: number;
};

/** Parse the 848-byte SKSEPluginVersionData struct. Null if the buffer is short. */
export function parseSkseVersionData(buf: Buffer): SkseVersionData | null {
  if (buf.length < SKSE_PLUGIN_VERSION_SIZE) return null;
  const text = (from: number, to: number): string => {
    const end = buf.indexOf(0, from);
    return buf.toString("latin1", from, end === -1 || end > to ? to : end);
  };
  const compatibleVersions: number[] = [];
  for (let i = 0; i < 16; i++) {
    const v = buf.readUInt32LE(780 + i * 4);
    if (v === 0) break;
    compatibleVersions.push(v);
  }
  return {
    dataVersion: buf.readUInt32LE(0),
    pluginVersion: buf.readUInt32LE(4),
    name: text(8, 264),
    author: text(264, 520),
    versionIndependenceEx: buf.readUInt32LE(772),
    versionIndependence: buf.readUInt32LE(776),
    compatibleVersions,
    seVersionRequired: buf.readUInt32LE(844),
  };
}

export type SkseDllInfo = {
  /** False when the file could not be read as a Windows DLL at all. */
  readable: boolean;
  problem?: string;
  is64: boolean;
  exports: { version: boolean; query: boolean; load: boolean; preload: boolean };
  versionData?: SkseVersionData;
  /** The PE header's build time (seconds since 1970, as the linker wrote it), for a readable 64-bit DLL. */
  buildTime?: number;
};

const NO_EXPORTS = { version: false, query: false, load: false, preload: false };

/** Inspect one plugin DLL. Never throws; never executes the file. */
export function inspectSksePlugin(path: string): SkseDllInfo {
  const pe = PeFile.open(path);
  if ("problem" in pe) {
    return { readable: false, problem: pe.problem, is64: false, exports: NO_EXPORTS };
  }
  try {
    // A 32-bit DLL is a Skyrim LE plugin. SKSE for SE/AE refuses it before it
    // reads anything else, so there is nothing more to learn from it.
    if (!pe.is64) return { readable: true, is64: false, exports: NO_EXPORTS };

    const table = pe.exports();
    if (!table) {
      return { readable: false, problem: "damaged export table", is64: true, exports: NO_EXPORTS };
    }
    const info: SkseDllInfo = {
      readable: true,
      is64: true,
      exports: {
        version: table.has("SKSEPlugin_Version"),
        query: table.has("SKSEPlugin_Query"),
        load: table.has("SKSEPlugin_Load"),
        preload: table.has("SKSEPlugin_Preload"),
      },
      buildTime: pe.timeDateStamp,
    };
    const versionRva = table.get("SKSEPlugin_Version");
    if (versionRva !== undefined) {
      const raw = pe.readRva(versionRva, SKSE_PLUGIN_VERSION_SIZE);
      const data = raw ? parseSkseVersionData(raw) : null;
      if (data) info.versionData = data;
      else info.problem = "SKSEPlugin_Version points outside the file";
    }
    return info;
  } finally {
    pe.close();
  }
}

// ─── Game version arithmetic ─────────────────────────────────────────────────
// SKSE and CommonLib pack a four-part game version into 32 bits: 8 bits major,
// 8 minor, 12 build, 4 revision. (MAKE_EXE_VERSION_EX in SKSE; REL::Version::
// pack() in CommonLib — the same formula.) Plugins list the versions they work
// with in this form.

export function packVersion(major: number, minor: number, build: number, sub = 0): number {
  return (
    (((major & 0xff) << 24) | ((minor & 0xff) << 16) | ((build & 0xfff) << 4) | (sub & 0xf)) >>> 0
  );
}

export function unpackVersion(packed: number): [number, number, number, number] {
  return [(packed >>> 24) & 0xff, (packed >>> 16) & 0xff, (packed >>> 4) & 0xfff, packed & 0xf];
}

export function formatPacked(packed: number): string {
  return unpackVersion(packed).join(".");
}

/** "1.7.104" or "1.7.104.0" → packed version; null if it isn't one. */
export function parseVersionText(text: string): number | null {
  const m = /^\s*v?(\d{1,3})\.(\d{1,3})\.(\d{1,4})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const [major, minor, build, sub] = [m[1], m[2], m[3], m[4] ?? "0"].map(Number) as [
    number,
    number,
    number,
    number,
  ];
  if (major > 255 || minor > 255 || build > 4095 || sub > 15) return null;
  return packVersion(major, minor, build, sub);
}
