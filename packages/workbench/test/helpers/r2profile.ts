import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dump } from "js-yaml";

// An r2modman profile for Lethal Company, written the way r2modman writes mods.yml (see
// loadorder-r2modman.test.ts), under a home of the test's own. Returns the environment that
// points r2modman's folder lookup at it; withEnv sets it for the length of one call.

export type R2Mod = { name: string; displayName?: string; authorName?: string; version?: [number, number, number]; enabled?: boolean };

export function r2profile(root: string, mods: R2Mod[], name = "Default"): Record<string, string> {
  const home = mkdtempSync(join(root, "home-"));
  const r2 =
    process.platform === "win32"
      ? join(home, "AppData", "Roaming", "r2modmanPlus-local")
      : process.platform === "darwin"
        ? join(home, "Library", "Application Support", "r2modmanPlus-local")
        : join(home, ".config", "r2modmanPlus-local");
  const dir = join(r2, "LethalCompany", "profiles", name);
  mkdirSync(dir, { recursive: true });
  const entries = mods.map((m) => ({
    manifestVersion: 1,
    name: m.name,
    ...(m.authorName !== undefined ? { authorName: m.authorName } : {}),
    displayName: m.displayName ?? m.name.split("-")[1] ?? m.name,
    ...(m.version ? { versionNumber: { major: m.version[0], minor: m.version[1], patch: m.version[2] } } : {}),
    enabled: m.enabled ?? true,
  }));
  writeFileSync(join(dir, "mods.yml"), dump(entries));
  return { APPDATA: join(home, "AppData", "Roaming"), HOME: home, USERPROFILE: home };
}

export async function withEnv<T>(env: Record<string, string>, fn: () => T | Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
