import {
  tryCreateNexusClient,
  tryCreateModioClient,
  type NexusClient,
  type ModioClient,
} from "./clients.js";
import {
  normalizeNexusMod,
  normalizeModioMod,
  type NexusModResponse,
  type ModioModResponse,
} from "./normalize.js";
import type {
  ModPlatform,
  QueryModMetadataInput,
  QueryModMetadataResult,
} from "./types.js";

// ─── Per-platform query implementations ───────────────────────────────────────

async function queryNexus(
  client: NexusClient,
  gameDomain: string,
  modIdStr: string
): Promise<NexusModResponse> {
  const modId = Number.parseInt(modIdStr, 10);
  if (!Number.isFinite(modId) || modId <= 0) {
    throw new Error(
      `Nexus mod IDs are numeric; got "${modIdStr}". Pass the mod's numeric Nexus ID.`
    );
  }
  return client.request<NexusModResponse>(
    `/games/${gameDomain}/mods/${modId}.json`
  );
}

async function queryModioById(
  client: ModioClient,
  gameIdStr: string,
  modIdStr: string
): Promise<ModioModResponse> {
  const gameId = Number.parseInt(gameIdStr, 10);
  const modId = Number.parseInt(modIdStr, 10);
  if (!Number.isFinite(gameId) || !Number.isFinite(modId)) {
    throw new Error(
      `mod.io IDs are numeric; got gameId="${gameIdStr}", modId="${modIdStr}".`
    );
  }
  return client.request<ModioModResponse>(`/games/${gameId}/mods/${modId}`);
}

type ModioListEnvelope<T> = { data: T[]; result_total: number };

async function searchModioByName(
  client: ModioClient,
  gameIdStr: string,
  name: string
): Promise<ModioModResponse | null> {
  const gameId = Number.parseInt(gameIdStr, 10);
  if (!Number.isFinite(gameId)) {
    throw new Error(`mod.io gameId must be numeric; got "${gameIdStr}".`);
  }
  const list = await client.request<ModioListEnvelope<ModioModResponse>>(
    `/games/${gameId}/mods`,
    { _q: name, _limit: 1 }
  );
  return list.data?.[0] ?? null;
}

// ─── Orchestration ────────────────────────────────────────────────────────────

export function queryModMetadata(
  input: QueryModMetadataInput
): Promise<QueryModMetadataResult> {
  return queryModMetadataInner(input);
}

async function queryModMetadataInner(
  input: QueryModMetadataInput
): Promise<QueryModMetadataResult> {
  const platform = input.platform ?? "any";
  const platformErrors: Record<string, string> = {};
  const attempted: ModPlatform[] = [];

  if (!input.modId && !input.modName) {
    return {
      found: false,
      reason: "Provide either modId or modName.",
      attemptedPlatforms: [],
    };
  }

  const tryNexus =
    (platform === "nexus" || platform === "any") &&
    input.modId !== undefined &&
    input.gameId !== undefined;

  const tryModioById =
    (platform === "modio" || platform === "any") &&
    input.modId !== undefined &&
    input.gameId !== undefined;

  const tryModioByName =
    (platform === "modio" || platform === "any") &&
    input.modName !== undefined &&
    input.gameId !== undefined;

  if (platform === "thunderstore" || platform === "curseforge") {
    return {
      found: false,
      reason: `Platform "${platform}" support is not implemented yet (planned for v3+). Use platform="nexus" or "modio" for now.`,
      attemptedPlatforms: [],
    };
  }

  // Try Nexus first (it's the dominant home for Bethesda games, which is
  // where the bulk of crash-diagnosis traffic will come from).
  if (tryNexus) {
    attempted.push("nexus");
    const client = tryCreateNexusClient();
    if (!client) {
      platformErrors["nexus"] =
        "No Nexus credential configured. Run `modwrench auth login nexus` " +
        "(OAuth) or set NEXUS_API_KEY in your .env.";
    } else {
      try {
        const raw = await queryNexus(client, input.gameId!, input.modId!);
        return {
          found: true,
          mod: normalizeNexusMod(raw, input.gameId!),
          attemptedPlatforms: attempted,
        };
      } catch (err) {
        platformErrors["nexus"] =
          err instanceof Error ? err.message : String(err);
      }
    }
  }

  if (tryModioById) {
    attempted.push("modio");
    const client = tryCreateModioClient();
    if (!client) {
      platformErrors["modio"] =
        "No mod.io credential configured. Run `modwrench auth login modio` " +
        "(OAuth) or set MODIO_API_KEY in your .env.";
    } else {
      try {
        const raw = await queryModioById(client, input.gameId!, input.modId!);
        return {
          found: true,
          mod: normalizeModioMod(raw),
          attemptedPlatforms: attempted,
        };
      } catch (err) {
        platformErrors["modio"] =
          err instanceof Error ? err.message : String(err);
      }
    }
  }

  if (tryModioByName) {
    if (!attempted.includes("modio")) attempted.push("modio");
    const client = tryCreateModioClient();
    if (!client) {
      platformErrors["modio"] ??=
        "No mod.io credential configured. Run `modwrench auth login modio`.";
    } else {
      try {
        const raw = await searchModioByName(
          client,
          input.gameId!,
          input.modName!
        );
        if (raw) {
          return {
            found: true,
            mod: normalizeModioMod(raw),
            attemptedPlatforms: attempted,
          };
        }
        platformErrors["modio"] = `No mod.io match for name "${input.modName}".`;
      } catch (err) {
        platformErrors["modio"] =
          err instanceof Error ? err.message : String(err);
      }
    }
  }

  // No platform attempted? That means the input was insufficient for the
  // platforms we actually support — surface a helpful error.
  if (attempted.length === 0) {
    return {
      found: false,
      reason:
        "Insufficient input. Nexus requires (modId + gameId as Nexus domain). " +
        "mod.io requires (modId + numeric gameId) or (modName + numeric gameId).",
      attemptedPlatforms: [],
    };
  }

  return {
    found: false,
    reason: `No matching mod found across ${attempted.join(", ")}.`,
    attemptedPlatforms: attempted,
    platformErrors,
  };
}
