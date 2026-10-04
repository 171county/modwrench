import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  packVersion,
  VIX_ADDRESS_LIBRARY_V5 as V5,
  VI_ADDRESS_LIBRARY_POST_AE as AL,
  VI_STRUCTS_POST_629 as S629,
} from "../../src/patchday/skse.js";
import { buildPe, skseVersionData } from "./pe-builder.js";

// A folder on disk laid out like a Skyrim install (a Steam library, the game's executable, SKSE and
// plugin DLLs) for tests that need the player's own files to read. Every test using it runs with HOME,
// USERPROFILE, APPDATA, LOCALAPPDATA, STEAM_ROOT and WINEPREFIX pointed into a temp folder, and OneDrive's
// own variables unset, so what the code finds is only what the test built, never the Steam library or
// Documents folder of whoever runs the suite.

const ENV_KEYS = ["HOME", "USERPROFILE", "STEAM_ROOT", "LOCALAPPDATA", "APPDATA", "WINEPREFIX", "OneDrive", "OneDriveCommercial", "OneDriveConsumer"] as const;

export type V4 = [number, number, number, number];
export const APP_ID = "489830";

export type World = {
  root: string;
  steam: string;
  steamapps: string;
  gameDir: string;
  plugins: string;
  /** Where Proton keeps this game's Documents folder. */
  documents: string;
};

export type Sandbox = {
  readonly root: string;
  /** Save the environment and point it into the sandbox. Call from `before`. */
  start(): void;
  /** Point the environment into the sandbox again. Call from `afterEach`. */
  isolate(): void;
  /** Restore the environment and delete the sandbox. Call from `after`. */
  stop(): void;
  /** The folder HOME points at. */
  readonly home: string;
  makeWorld(options?: { game?: V4; skse?: null | { loader?: boolean; dlls?: Array<[string, V4]> } }): World;
};

export function createSandbox(prefix: string): Sandbox {
  const saved: Record<string, string | undefined> = {};
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home");
  let worlds = 0;

  const isolate = (): void => {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.LOCALAPPDATA = join(home, "AppData", "Local");
    process.env.APPDATA = join(home, "AppData", "Roaming");
    process.env.STEAM_ROOT = join(root, "no-steam-here");
    delete process.env.WINEPREFIX;
    delete process.env.OneDrive;
    delete process.env.OneDriveCommercial;
    delete process.env.OneDriveConsumer;
  };

  return {
    root,
    home,
    start() {
      for (const key of ENV_KEYS) saved[key] = process.env[key];
      mkdirSync(home, { recursive: true });
      isolate();
    },
    isolate,
    stop() {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      rmSync(root, { recursive: true, force: true });
    },
    makeWorld(o = {}) {
      const base = join(root, `w${worlds++}`);
      const steam = join(base, "steam");
      const steamapps = join(steam, "steamapps");
      const gameDir = join(steamapps, "common", "Skyrim Special Edition");
      const plugins = join(gameDir, "Data", "SKSE", "Plugins");
      mkdirSync(plugins, { recursive: true });
      writeFileSync(join(gameDir, "SkyrimSE.exe"), buildPe({ version: o.game ?? [1, 6, 1170, 0] }));
      const skse =
        o.skse === undefined
          ? { loader: true, dlls: [["skse64_1_6_1170.dll", [0, 2, 2, 6]]] as Array<[string, V4]> }
          : o.skse;
      if (skse) {
        // SKSE's files carry FILEVERSION 0,major,minor,beta (skse_version.rc): SKSE 2.2.6 is 0.2.2.6. A release's loader carries its DLL's.
        if (skse.loader !== false) writeFileSync(join(gameDir, "skse64_loader.exe"), buildPe({ version: skse.dlls?.[0]?.[1] ?? [0, 2, 2, 6] }));
        for (const [name, version] of skse.dlls ?? []) writeFileSync(join(gameDir, name), buildPe({ version }));
      }
      writeFileSync(
        join(steamapps, `appmanifest_${APP_ID}.acf`),
        [
          '"AppState"',
          "{",
          `\t"appid"\t\t"${APP_ID}"`,
          '\t"name"\t\t"The Elder Scrolls V: Skyrim Special Edition"',
          '\t"StateFlags"\t\t"4"',
          '\t"installdir"\t\t"Skyrim Special Edition"',
          '\t"buildid"\t\t"100"',
          "}",
          "",
        ].join("\n")
      );
      // Steam finds its libraries from the root, which the sandbox's STEAM_ROOT points at.
      process.env.STEAM_ROOT = steam;
      const documents = join(steamapps, "compatdata", APP_ID, "pfx", "drive_c", "users", "steamuser", "Documents");
      return { root: base, steam, steamapps, gameDir, plugins, documents };
    },
  };
}

/** Write a file, making its folder first. */
export function put(dir: string, file: string, bytes: Buffer | string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), bytes);
}

/** A plugin as a current SKSE plugin is built: SKSEPlugin_Version data plus SKSEPlugin_Load. */
export function modern(opts: Parameters<typeof skseVersionData>[0]): Buffer {
  return buildPe({
    exports: [{ name: "SKSEPlugin_Version", data: skseVersionData(opts) }, { name: "SKSEPlugin_Load" }],
  });
}

/** A plugin that works on any game version, declaring itself version `version`. */
export function goodPlugin(name = "Good", version = packVersion(1, 0, 0)): Buffer {
  return modern({
    name,
    pluginVersion: version,
    versionIndependence: AL | S629,
    versionIndependenceEx: V5,
    seVersionRequired: packVersion(2, 2, 6),
  });
}

/** A plugin that lists exact game versions it works with. */
export function pinnedTo(name: string, ...versions: number[]): Buffer {
  return modern({ name, compatibleVersions: versions });
}
