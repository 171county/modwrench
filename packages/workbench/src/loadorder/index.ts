import type { GameDef } from "../detect/games.js";
import { findGameById } from "../detect/games.js";
import {
  detectInstalledManagers,
  inferManagerForGame,
  type ManagerName,
} from "../detect/manager.js";
import { readMo2LoadOrder } from "./mo2.js";
import { readR2modmanLoadOrder } from "./r2modman.js";
import { readVortexLoadOrder } from "./vortex.js";
import type { LoadOrderResult } from "./types.js";

export type ReadLoadOrderInput = {
  gameId: string;
  modManager?: ManagerName | "auto";
  profileName?: string;
  instancePath?: string;
};

export type ReadLoadOrderError = {
  ok: false;
  reason: string;
  game?: GameDef;
  attemptedManagers: ManagerName[];
};

export type ReadLoadOrderSuccess = LoadOrderResult & { ok: true };

export function readLoadOrder(
  input: ReadLoadOrderInput
): ReadLoadOrderSuccess | ReadLoadOrderError {
  const game = findGameById(input.gameId);
  if (!game) {
    return {
      ok: false,
      reason:
        `Unknown gameId "${input.gameId}". Known IDs are listed in ` +
        "@modwrench/workbench's KNOWN_GAMES catalogue. Use mw_detect_environment " +
        "to see detected games on this machine.",
      attemptedManagers: [],
    };
  }

  // Build the list of managers to try, in priority order.
  let order: ManagerName[];
  if (input.modManager && input.modManager !== "auto") {
    order = [input.modManager];
  } else {
    const managers = detectInstalledManagers();
    const inferred = inferManagerForGame(game, managers);
    // Fall back across the rest in family-sensible order.
    const familyOrder: ManagerName[] =
      game.family === "bethesda"
        ? ["mo2", "vortex"]
        : game.family === "unity-coop"
          ? ["r2modman", "thunderstore-mm"]
          : [];
    const seen = new Set<ManagerName>();
    order = [];
    for (const m of [inferred, ...familyOrder]) {
      if (m && !seen.has(m)) {
        seen.add(m);
        order.push(m);
      }
    }
  }

  const attempted: ManagerName[] = [];
  for (const manager of order) {
    attempted.push(manager);
    let result: LoadOrderResult | null = null;
    if (manager === "mo2") {
      result = readMo2LoadOrder(game, {
        instancePath: input.instancePath,
        profileName: input.profileName,
      });
    } else if (manager === "r2modman") {
      result = readR2modmanLoadOrder(game, {
        profileName: input.profileName,
      });
    } else if (manager === "vortex") {
      result = readVortexLoadOrder(game);
    }
    if (result) return { ok: true, ...result };
  }

  return {
    ok: false,
    game,
    attemptedManagers: attempted,
    reason:
      attempted.length === 0
        ? "No mod manager could be inferred for this game's family. " +
          "Specify modManager explicitly or install one of: " +
          (game.family === "bethesda"
            ? "MO2, Vortex"
            : game.family === "unity-coop"
              ? "r2modman, Thunderstore Mod Manager"
              : "a supported manager")
        : `Tried ${attempted.join(", ")} but no readable state was found for ${game.displayName}.`,
  };
}
