#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { log } from "@modwrench/core";
import { registerNexusTools } from "@modwrench/nexus/register";
import { registerModioTools } from "@modwrench/modio/register";
import { registerThunderstoreTools } from "@modwrench/thunderstore/register";
import { registerWorkbenchTools } from "@modwrench/workbench/register";
import { MetaCatalog, type PlatformDef } from "./catalog.js";
import { renderShell, createUIResource, THEME_IDS } from "@modwrench/ui";

// ─── Subcommand dispatch ─────────────────────────────────────────────────────
// Must run before the MCP boot block below. Two routes today:
//   `modwrench --version | -v`         → print version, exit
//   `modwrench auth <action> <plat>`   → per-platform auth flow
// A user running `auth login` does so precisely because they don't have a
// credential yet — the credential-load block below must not run on that path.

const [, , subcmd, action, platform] = process.argv;

if (subcmd === "--version" || subcmd === "-v") {
  // Read directly from this package's package.json so version stays in sync
  // automatically — no hardcoded duplicate to forget on release.
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgJson = JSON.parse(
    readFileSync(resolve(here, "..", "package.json"), "utf8")
  ) as { version: string };
  process.stdout.write(`${pkgJson.version}\n`);
  process.exit(0);
}

if (subcmd === "auth") {
  if (!action || !platform) {
    process.stderr.write(
      "Usage: modwrench auth <login|status|logout> <nexus|modio>\n"
    );
    process.exit(1);
  }

  type AuthModule = {
    authLogin(): Promise<void>;
    authStatus(): Promise<void>;
    authLogout(): Promise<void>;
  };

  let authMod: AuthModule;
  if (platform === "nexus") {
    authMod = (await import("@modwrench/nexus/auth")) as unknown as AuthModule;
  } else if (platform === "modio") {
    authMod = (await import("@modwrench/modio/auth")) as unknown as AuthModule;
  } else {
    process.stderr.write(
      `Unknown platform "${platform}". Supported: nexus, modio.\n`
    );
    process.exit(1);
  }

  if (action === "login") await authMod.authLogin();
  else if (action === "status") await authMod.authStatus();
  else if (action === "logout") await authMod.authLogout();
  else {
    process.stderr.write(
      `Unknown action "${action}". Supported: login, status, logout.\n`
    );
    process.exit(1);
  }
  process.exit(0);
}

// ─── Meta-server boot — v2.5 dynamic catalog architecture ────────────────────
// The catalog tracks which platforms are active. Each platform's register
// function is called via the catalog rather than inline, which lets us:
//
//   - Activate platforms at boot (the static-catalog equivalent — current
//     behavior; every available platform tries to register)
//   - Re-activate later via the mw_activate_platform meta-tool, e.g. after
//     the user runs `modwrench auth login` in another terminal and wants
//     to pull the platform in without restarting the server
//   - Notify clients via notifications/tools/list_changed whenever the
//     catalog changes (listChanged capability declared below)
//
// See docs/dynamic-catalog-architecture.md for the full design.

const platforms: PlatformDef[] = [
  {
    id: "nexus",
    kind: "credentialed",
    register: registerNexusTools,
    service: "nexus",
    authHint:
      "Store your Nexus credential in your OS credential manager under service `modwrench-nexus` — either a personal API key (https://www.nexusmods.com/users/myaccount?tab=api+access) or an OAuth token via `modwrench auth login nexus`.",
  },
  {
    id: "modio",
    kind: "credentialed",
    register: registerModioTools,
    service: "modio",
    authHint:
      "Store your mod.io credential in your OS credential manager under service `modwrench-modio` — either an API key (https://mod.io/me/access) or an OAuth token via `modwrench auth login modio`.",
  },
  {
    id: "thunderstore",
    kind: "local",
    register: registerThunderstoreTools,
  },
  {
    id: "workbench",
    kind: "local",
    register: registerWorkbenchTools,
  },
];

const server = new McpServer(
  {
    name: "modwrench",
    version: "0.1.0",
  },
  {
    // listChanged advertises to MCP clients that the tool catalog can change
    // at runtime. The McpServer's sendToolListChanged() (called by
    // MetaCatalog.activate) emits notifications/tools/list_changed which
    // tells the client to re-fetch via tools/list. Without this capability
    // declared, runtime activation still works but clients may not refresh.
    capabilities: { tools: { listChanged: true } },
  }
);

const catalog = new MetaCatalog(server, platforms);

// Boot-time activation: try every platform. Credentialed platforms whose
// credentials are missing land in catalog.listFailed() and stay dormant
// until mw_activate_platform retries them.
await catalog.activateAll();

// Register the mw_activate_platform meta-tool. Always available — even when
// the user runs the meta-CLI with zero active platforms (no creds anywhere),
// this tool gives the LLM a programmatic way to surface the right "go run
// modwrench auth login X" hint and retry activation when credentials are
// added.
server.tool(
  "mw_activate_platform",
  "Activate an additional platform's tool set without restarting the meta-server. Use this when the user adds credentials or asks about a platform that wasn't loaded at boot. After activation, the new tools appear in the catalog and become callable. Returns the activation result (success with toolCount + baseUrl, or failure with reason — usually a missing-credential hint pointing at `modwrench auth login <platform>`).",
  {
    platform_id: z
      .enum(catalog.knownIds() as [string, ...string[]])
      .describe(
        "Platform identifier. Idempotent — activating an already-active platform returns alreadyActive: true with no side effects."
      ),
  },
  async ({ platform_id }) => {
    const result = await catalog.activate(platform_id);
    log("debug", "catalog.activate", { platform_id, status: result.status });
    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
    };
  }
);

// ─── mw_deck — stateless MCP-UI surface ──────────────────────────────────────
// Returns the ModWrench deck as a ui:// resource built entirely from the current
// catalog state. Four flagship-game themes; no state, no storage, no network from
// the rendered HTML — the UI is a pure function of the tool output.

const CONNECTOR_META: Record<string, { name: string; tool: string }> = {
  nexus: { name: "Nexus Mods", tool: "nexus_search" },
  modio: { name: "mod.io", tool: "modio_list_games" },
  thunderstore: { name: "Thunderstore", tool: "thunderstore_list_communities" },
  workbench: { name: "Workbench", tool: "mw_detect_environment" },
};

const FLAGSHIP_GAMES = [
  { id: "skyrim", name: "Skyrim SE", note: "Nexus \u00b7 Bethesda" },
  { id: "fallout", name: "Fallout 4", note: "Nexus \u00b7 Bethesda" },
  { id: "lethal", name: "Lethal Company", note: "Thunderstore \u00b7 BepInEx" },
  { id: "valheim", name: "Valheim", note: "Thunderstore \u00b7 BepInEx" },
];

server.tool(
  "mw_deck",
  "Open the ModWrench deck: a themed, interactive MCP-UI surface (returned as a ui:// resource) showing the active connectors and flagship games, with four game themes (Skyrim, Fallout, Lethal Company, Valheim). Stateless \u2014 rendered fresh from the current catalog, holds nothing. Use when the user wants a visual dashboard or says \"open the deck\". Optional args set the initial theme and view.",
  {
    theme: z
      .enum([...THEME_IDS] as [string, ...string[]])
      .optional()
      .describe("Initial theme: skyrim | fallout | lethal | valheim. Default skyrim."),
    view: z
      .enum(["deck", "mods", "crash"])
      .optional()
      .describe("Initial view. Default 'deck'."),
  },
  async ({ theme, view }) => {
    const active = new Map(
      catalog.listActive().map((p) => [p.platformId, p.toolCount] as const)
    );
    const connectors = catalog.knownIds().map((id) => {
      const meta = CONNECTOR_META[id] ?? { name: id, tool: "" };
      const on = active.has(id);
      return {
        id,
        name: meta.name,
        tool: meta.tool,
        status: on ? ("on" as const) : ("off" as const),
        ...(on ? { toolCount: active.get(id) } : {}),
      };
    });
    const html = renderShell({
      theme,
      view: view ?? "deck",
      deck: { connectors, games: FLAGSHIP_GAMES },
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { view: view ?? "deck", theme: theme ?? "skyrim", connectors },
            null,
            2
          ),
        },
        createUIResource({
          uri: "ui://modwrench/deck",
          html,
          meta: { "mcpui.dev/ui-preferred-frame-size": ["1040px", "760px"] },
        }),
      ],
    };
  }
);

const activeAtBoot = catalog.listActive();
const failedAtBoot = catalog.listFailed();

if (activeAtBoot.length === 0) {
  log("error", "modwrench.fatal", {
    message: "No platforms could activate.",
    failed: failedAtBoot,
  });
  process.exit(1);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "modwrench.started", {
    loaded: activeAtBoot.map((p) => ({
      platform: p.platformId,
      tools: p.toolCount,
      ...(p.baseUrl ? { base_url: p.baseUrl } : {}),
    })),
    skipped: failedAtBoot.map((p) => p.platformId),
    total_tools:
      activeAtBoot.reduce((sum, p) => sum + p.toolCount, 0) + 2, // +2 for mw_activate_platform and mw_deck
    catalog_dynamic: true,
  });
}

main().catch((err) => {
  log("error", "modwrench.fatal", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
