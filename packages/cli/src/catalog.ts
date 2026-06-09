import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCredential, log, type Credential } from "@modwrench/core";

// ─── Platform identity & registration shapes ─────────────────────────────────

export type PlatformId =
  | "nexus"
  | "modio"
  | "thunderstore"
  | "modrinth"
  | "workbench";

export type CredentialedPlatform = {
  id: PlatformId;
  kind: "credentialed";
  register: (
    server: McpServer,
    credential: Credential
  ) => { toolCount: number; baseUrl: string };
  envVar: string;
  service: string;
  authHint: string;
};

export type LocalPlatform = {
  id: PlatformId;
  kind: "local";
  register: (server: McpServer) => { toolCount: number; baseUrl?: string };
};

export type PlatformDef = CredentialedPlatform | LocalPlatform;

// ─── Activation result type ─────────────────────────────────────────────────

export type ActivationResult =
  | {
      status: "active";
      platformId: PlatformId;
      alreadyActive: boolean;
      toolCount: number;
      baseUrl?: string;
    }
  | { status: "unknown"; platformId: string; reason: string }
  | { status: "failed"; platformId: PlatformId; reason: string };

// ─── MetaCatalog ────────────────────────────────────────────────────────────
// Tracks which platforms are active and routes activation requests to the
// right register function. The v2.5 foundation per docs/dynamic-catalog-
// architecture.md.
//
// Current scope (v2.5 MVP):
//   - activate() registers a platform's tools and tracks state
//   - mw_activate_platform meta-tool calls into here from the LLM side
//   - listChanged capability declared so clients re-fetch on activation
//
// Out of scope (v2.5.x follow-ups, documented in the architecture spec):
//   - Per-tool unregistration (would need each platform's register to
//     return tool names; not yet wired)
//   - Auto-activation policy based on detection (this MVP activates the
//     same set as before — workbench always, credentialed if cred exists,
//     local always; the personalization win comes when we tighten the
//     policy to detected-only platforms)

export class MetaCatalog {
  private active = new Map<
    PlatformId,
    { toolCount: number; baseUrl?: string }
  >();
  private failed = new Map<PlatformId, string>();

  constructor(
    private readonly server: McpServer,
    private readonly platforms: PlatformDef[]
  ) {}

  /** Known platform IDs — used by mw_activate_platform's zod enum. */
  knownIds(): PlatformId[] {
    return this.platforms.map((p) => p.id);
  }

  isActive(id: PlatformId): boolean {
    return this.active.has(id);
  }

  /** Snapshot of currently-active platforms for boot logging. */
  listActive(): Array<{ platformId: PlatformId; toolCount: number; baseUrl?: string }> {
    return Array.from(this.active.entries()).map(([platformId, info]) => ({
      platformId,
      toolCount: info.toolCount,
      ...(info.baseUrl !== undefined ? { baseUrl: info.baseUrl } : {}),
    }));
  }

  /** Snapshot of platforms that tried to activate and failed. */
  listFailed(): Array<{ platformId: PlatformId; reason: string }> {
    return Array.from(this.failed.entries()).map(([platformId, reason]) => ({
      platformId,
      reason,
    }));
  }

  /**
   * Activate a platform. Idempotent — if already active, returns
   * `alreadyActive: true` with no side effects. Loads credentials for
   * credentialed platforms, runs the platform's register function, then
   * notifies clients that the tool catalog changed.
   */
  async activate(id: string): Promise<ActivationResult> {
    const platform = this.platforms.find((p) => p.id === id);
    if (!platform) {
      return {
        status: "unknown",
        platformId: id,
        reason: `Unknown platform "${id}". Known: ${this.knownIds().join(", ")}.`,
      };
    }

    if (this.active.has(platform.id)) {
      const existing = this.active.get(platform.id)!;
      return {
        status: "active",
        platformId: platform.id,
        alreadyActive: true,
        toolCount: existing.toolCount,
        ...(existing.baseUrl !== undefined ? { baseUrl: existing.baseUrl } : {}),
      };
    }

    try {
      let result: { toolCount: number; baseUrl?: string };
      if (platform.kind === "credentialed") {
        const credential = loadCredential({
          service: platform.service,
          envVar: platform.envVar,
          authHint: platform.authHint,
        });
        result = platform.register(this.server, credential);
      } else {
        result = platform.register(this.server);
      }
      this.active.set(platform.id, {
        toolCount: result.toolCount,
        ...(result.baseUrl !== undefined ? { baseUrl: result.baseUrl } : {}),
      });
      this.failed.delete(platform.id);

      // Notify connected MCP clients that the tool catalog changed so they
      // re-fetch via tools/list. The McpServer's sendToolListChanged dispatches
      // the standard notifications/tools/list_changed message. Catch + log
      // failures silently — notification delivery is best-effort.
      try {
        await this.server.sendToolListChanged();
      } catch (err) {
        log("debug", "catalog.notify_failed", {
          platformId: platform.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return {
        status: "active",
        platformId: platform.id,
        alreadyActive: false,
        toolCount: result.toolCount,
        ...(result.baseUrl !== undefined ? { baseUrl: result.baseUrl } : {}),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.failed.set(platform.id, reason);
      return {
        status: "failed",
        platformId: platform.id,
        reason,
      };
    }
  }

  /**
   * Try to activate every registered platform. Useful at boot — succeeds
   * silently, records failures for later retry via mw_activate_platform.
   */
  async activateAll(): Promise<void> {
    for (const platform of this.platforms) {
      await this.activate(platform.id);
    }
  }
}
