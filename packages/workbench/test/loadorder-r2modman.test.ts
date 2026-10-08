import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readR2modmanLoadOrder } from "../src/loadorder/r2modman.js";
import { findGameById } from "../src/detect/games.js";

const root = mkdtempSync(join(tmpdir(), "mw-r2-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** Puts a profile's mods.yml where r2modman keeps it on this platform, under a home of our own. */
function profile(yaml: string): { home: string; env: Record<string, string> } {
  const home = mkdtempSync(join(root, "home-"));
  const r2 =
    process.platform === "win32"
      ? join(home, "AppData", "Roaming", "r2modmanPlus-local")
      : process.platform === "darwin"
        ? join(home, "Library", "Application Support", "r2modmanPlus-local")
        : join(home, ".config", "r2modmanPlus-local");
  mkdirSync(join(r2, "LethalCompany", "profiles", "Default"), { recursive: true });
  writeFileSync(join(r2, "LethalCompany", "profiles", "Default", "mods.yml"), yaml);
  return { home, env: { APPDATA: join(home, "AppData", "Roaming"), HOME: home, USERPROFILE: home } };
}

function withEnv<T>(env: Record<string, string>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Entries as r2modman writes them: js-yaml dumping its ManifestV2 objects (ProfileModList.saveModList), so camelCase
// keys, the Thunderstore id in name and the version under versionNumber. Taken from a public Lethal Company profile
// (Nirekron/Seema_Gang-LethalCompany, Seema/mods.yml); the icon path's user name is replaced, and the last mod is
// switched off here to cover that case.
const REAL = [
  "- manifestVersion: 1",
  "  name: BepInEx-BepInExPack",
  "  authorName: BepInEx",
  "  websiteUrl: https://thunderstore.io/c/lethal-company/p/BepInEx/BepInExPack/",
  "  displayName: BepInExPack",
  "  description: BepInEx pack for Mono Unity games. Preconfigured and ready to use.",
  '  gameVersion: "0"',
  "  networkMode: both",
  "  packageType: other",
  "  installMode: managed",
  "  installedAtTime: 0",
  "  loaders: []",
  "  dependencies: []",
  "  incompatibilities: []",
  "  optionalDependencies: []",
  "  versionNumber:",
  "    major: 5",
  "    minor: 4",
  "    patch: 2100",
  "  enabled: true",
  "  icon: C:\\Users\\janedoe\\AppData\\Roaming\\r2modmanPlus-local\\LethalCompany\\cache\\BepInEx-BepInExPack\\5.4.2100\\icon.png",
  "- manifestVersion: 1",
  "  name: OrtonLongGaming-FreddyBracken",
  "  authorName: OrtonLongGaming",
  "  websiteUrl: https://thunderstore.io/c/lethal-company/p/OrtonLongGaming/FreddyBracken/",
  "  displayName: FreddyBracken",
  "  dependencies:",
  "    - BepInEx-BepInExPack-5.4.2100",
  "  versionNumber:",
  "    major: 1",
  "    minor: 0",
  "    patch: 6",
  "  enabled: false",
  "",
].join("\n");

test("r2modman's mods.yml is read as r2modman writes it: names, authors, versions, ids and which mods are on", () => {
  const { env } = profile(REAL);
  const result = withEnv(env, () => readR2modmanLoadOrder(findGameById("lethalcompany")!, {}));
  assert.ok(result);
  assert.deepEqual(result.mods, [
    { name: "BepInExPack", enabled: true, loadOrderIndex: 0, sourcePlatform: "thunderstore", version: "5.4.2100", author: "BepInEx", sourceModId: "BepInEx-BepInExPack" },
    { name: "FreddyBracken", enabled: false, loadOrderIndex: 1, sourcePlatform: "thunderstore", version: "1.0.6", author: "OrtonLongGaming", sourceModId: "OrtonLongGaming-FreddyBracken" },
  ]);
  assert.equal(result.enabledCount, 1);
  assert.equal(result.totalCount, 2);
  // The icon line holds a folder path with the player's user name; nothing from it is read.
  assert.doesNotMatch(JSON.stringify(result.mods), /janedoe/);
});

test("r2modman reads a mod without enabled: true as switched off, and so does this", () => {
  const { env } = profile("- name: Author-Mod\n  authorName: Author\n  displayName: Mod\n");
  const result = withEnv(env, () => readR2modmanLoadOrder(findGameById("lethalcompany")!, {}));
  assert.equal(result?.mods[0]?.enabled, false);
  assert.equal(result?.enabledCount, 0);
});

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const real = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", real);
  }
}

test("on Linux and the Steam Deck, a profile in r2modman's Flatpak (io.github.ebkr.r2modman) is found", () => {
  // r2modman's own Flatpak manifest is flatpak/io.github.ebkr.r2modman.yaml; a Flatpak app's config lives under ~/.var/app/<id>.
  const home = mkdtempSync(join(root, "home-"));
  const dir = join(home, ".var", "app", "io.github.ebkr.r2modman", "config", "r2modmanPlus-local", "LethalCompany", "profiles", "Default");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mods.yml"), "- name: Author-Mod\n  authorName: Author\n  displayName: Mod\n  enabled: true\n");
  const result = withPlatform("linux", () => withEnv({ HOME: home, USERPROFILE: home }, () => readR2modmanLoadOrder(findGameById("lethalcompany")!, {})));
  assert.equal(result?.mods[0]?.sourceModId, "Author-Mod");
});
