import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerWorkbenchTools } from "../src/register.js";
import { isNetworkPath } from "../src/localpath.js";
import { mo2Folder } from "../src/loadorder/mo2.js";
import { createSandbox, put } from "./helpers/world.js";

// Mock server pattern — same shape used in nexus + modio + thunderstore tests.
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

class MockMcpServer {
  tools = new Map<
    string,
    {
      title?: string;
      description: string;
      schema: unknown;
      annotations: Record<string, unknown>;
      handler: ToolHandler;
    }
  >();
  registerTool(
    name: string,
    config: {
      title?: string;
      description: string;
      inputSchema?: unknown;
      annotations: Record<string, unknown>;
    },
    handler: ToolHandler
  ): void {
    this.tools.set(name, {
      title: config.title,
      description: config.description,
      schema: config.inputSchema,
      annotations: config.annotations,
      handler,
    });
  }
}

// ─── Registration smoke tests ───────────────────────────────────────────────

test("registerWorkbenchTools: registers 9 tools", () => {
  const server = new MockMcpServer();
  const result = registerWorkbenchTools(server as unknown as never);
  assert.equal(result.toolCount, 9);
  assert.equal(server.tools.size, 9);
});

test("registerWorkbenchTools: every expected tool is present", () => {
  const server = new MockMcpServer();
  registerWorkbenchTools(server as unknown as never);
  const expected = [
    "mw_detect_environment",
    "mw_read_load_order",
    "mw_parse_crashlog",
    "mw_query_mod_metadata",
    "mw_check_known_conflicts",
    "mw_diagnose_crash",
    "mw_patch_day",
    "mw_crash_whisperer",
    "mw_doctor",
  ];
  for (const name of expected) {
    assert.ok(server.tools.has(name), `missing tool: ${name}`);
  }
});

test("every workbench tool declares all four boolean annotation hints", () => {
  // Hints are honest self-descriptions for host UX — hints, not guarantees,
  // per the MCP spec. The read-only promise itself is enforced separately by
  // readonly.test.ts; this guard holds the declared metadata in place.
  const server = new MockMcpServer();
  registerWorkbenchTools(server as unknown as never);
  assert.ok(
    server.tools.size > 0,
    "no tools registered — this guard would pass vacuously"
  );
  for (const [name, tool] of server.tools) {
    assert.equal(typeof tool.title, "string", `${name} is missing a title`);
    for (const hint of [
      "readOnlyHint",
      "destructiveHint",
      "idempotentHint",
      "openWorldHint",
    ]) {
      assert.equal(
        typeof tool.annotations?.[hint],
        "boolean",
        `${name} is missing an explicit boolean ${hint}`
      );
    }
  }
});

test("mw_doctor's arguments say what gamePath must hold and what the answer does without mo2InstancePath", () => {
  const server = new MockMcpServer();
  registerWorkbenchTools(server as unknown as never);
  const schema = server.tools.get("mw_doctor")!.schema as Record<string, { description?: string }>;
  // For Skyrim SE a gamePath without SkyrimSE.exe is reported as not the game's folder (doctor/index.ts).
  assert.match(schema.gamePath!.description!, /the game's executable \(for Skyrim Special Edition, SkyrimSE\.exe\), not its Data folder/);
  // Without MO2, the plugin checks read the game's own plugins.txt and say so; they don't stop.
  assert.match(schema.mo2InstancePath!.description!, /the answer says the plugin checks looked at the game's own plugins\.txt instead/);
  assert.doesNotMatch(schema.mo2InstancePath!.description!, /couldn't see it/);
});

// ─── Path arguments: this computer's own drives only ────────────────────────
// A path argument is a string the model picked, and the model reads other people's
// text (a mod page, a crash log). On Windows, opening \\host\share\x connects to that
// host over SMB and offers the signed-in account's credentials before a byte is read,
// so a tool that says "no network" must not open one. These run on every platform: the
// check is on the text, and on Linux the same strings are simply refused too.

const B = "\\";
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

test("isNetworkPath: another machine or a device is refused; a local drive, long spelling included, is not", () => {
  for (const p of [
    `${B}${B}host${B}share${B}crash.log`,
    "//host/share/crash.log",
    `${B}/host/share`,
    `/${B}host${B}share`,
    `${B}${B}?${B}UNC${B}host${B}share${B}x`,
    "//?/UNC/host/share/x",
    `${B}${B}.${B}pipe${B}x`,
    `${B}${B}.${B}C:${B}x`,
    `${B}${B}?${B}GLOBALROOT${B}Device${B}Mup${B}host${B}share`,
    `  ${B}${B}host${B}share`,
    // Node folds ".." before it opens a long path, and these fold to \\?\UNC\host\share.
    `${B}${B}?${B}C:${B}..${B}UNC${B}host${B}share${B}x`,
    "//?/C:/../../UNC/host/share/x",
    `${B}${B}?${B}c:${B}.${B}Games${B}..${B}..${B}UNC${B}host${B}share`,
  ]) {
    assert.equal(isNetworkPath(p), true, p);
  }
  for (const p of [
    `C:${B}Games${B}Skyrim`,
    `${B}${B}?${B}C:${B}Games${B}Skyrim`,
    `${B}${B}?${B}C:${B}Games${B}Mods${B}..${B}Skyrim`,
    "//?/c:/Games/Skyrim",
    `${B}${B}?${B}D:`,
    `${B}Games${B}Skyrim`,
    "/home/jane/crash.log",
    "relative/crash.log",
    "",
  ]) {
    assert.equal(isNetworkPath(p), false, p);
  }
});

/** A real server and client, talking over the SDK's in-memory transport. */
async function connected(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = new McpServer({ name: "workbench-test", version: "0" });
  registerWorkbenchTools(server);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "workbench-test-client", version: "0" });
  await client.connect(clientSide);
  return { client, close: () => client.close() };
}

type CallResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };
const textOf = (r: CallResult): string => r.content.map((c) => c.text ?? "").join("\n");

/**
 * Record every filesystem call that is handed a path starting with two separators, unless
 * Node opens it as the long spelling of a local drive (\\?\C:\...), and refuse it as if it
 * didn't exist, so not even a broken guard can reach the network here.
 */
function spyOnNetworkOpens(): { seen: string[]; restore: () => void } {
  const seen: string[] = [];
  const names = ["statSync", "lstatSync", "openSync", "existsSync", "readFileSync", "readdirSync", "accessSync", "statfsSync", "realpathSync", "opendirSync"];
  const target = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const originals = new Map<string, (...a: unknown[]) => unknown>();
  for (const name of names) {
    const original = target[name]!;
    originals.set(name, original);
    target[name] = function (this: unknown, p: unknown, ...rest: unknown[]) {
      if (typeof p === "string" && /^\s*[\\/]{2}/.test(p) && !/^\\\\\?\\[A-Za-z]:(?:\\|$)/.test(win32.toNamespacedPath(p.trimStart()))) {
        seen.push(`${name}(${p})`);
        if (name === "existsSync") return false;
        throw Object.assign(new Error("ENOENT: refused by the test"), { code: "ENOENT" });
      }
      return original.call(this, p, ...rest);
    };
  }
  syncBuiltinESMExports();
  return {
    seen,
    restore: () => {
      for (const [name, original] of originals) target[name] = original;
      syncBuiltinESMExports();
    },
  };
}

const SSE_LOG = join(FIXTURES, "crash-sse.log");
const PATH_ARGS: Array<[tool: string, arg: string, others: Record<string, unknown>]> = [
  ["mw_read_load_order", "instancePath", { gameId: "skyrimspecialedition", modManager: "mo2" }],
  ["mw_parse_crashlog", "logPath", {}],
  ["mw_diagnose_crash", "logPath", {}],
  // gameId becomes part of a file name in the known-conflicts lookup, so it is a path there too.
  ["mw_diagnose_crash", "gameId", { logPath: SSE_LOG }],
  ["mw_check_known_conflicts", "gameId", { modIds: ["A.esp", "B.esp"] }],
  ["mw_patch_day", "gamePath", {}],
  ["mw_patch_day", "mo2InstancePath", {}],
  ["mw_patch_day", "logPath", {}],
  ["mw_crash_whisperer", "logPath", {}],
  ["mw_crash_whisperer", "gamePath", { logPath: SSE_LOG, compareRecent: 0 }],
  ["mw_crash_whisperer", "mo2InstancePath", { logPath: SSE_LOG, compareRecent: 0 }],
  ["mw_doctor", "gamePath", {}],
  ["mw_doctor", "mo2InstancePath", {}],
];
const NETWORK_FORMS = [
  `${B}${B}127.0.0.1${B}mw-test-share${B}x`,
  "//127.0.0.1/mw-test-share/x",
  `${B}${B}?${B}UNC${B}127.0.0.1${B}mw-test-share${B}x`,
  `${B}${B}.${B}pipe${B}mw-test-pipe`,
  `${B}${B}?${B}C:${B}..${B}UNC${B}127.0.0.1${B}mw-test-share${B}x`,
];

test("every path argument of every tool is in the list the next test checks", async () => {
  const { client, close } = await connected();
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 9);
    const listed = new Set(PATH_ARGS.map(([tool, arg]) => `${tool}.${arg}`));
    for (const t of tools) {
      for (const arg of Object.keys(t.inputSchema.properties ?? {})) {
        if (/path$/i.test(arg)) assert.ok(listed.has(`${t.name}.${arg}`), `${t.name}.${arg} takes a path and isn't checked by the test below`);
      }
    }
  } finally {
    await close();
  }
});

test("a path argument that names another machine or a device is refused before anything opens it, without repeating it", async () => {
  const { client, close } = await connected();
  const spy = spyOnNetworkOpens();
  try {
    for (const [tool, arg, others] of PATH_ARGS) {
      for (const bad of NETWORK_FORMS) {
        const r = (await client.callTool({ name: tool, arguments: { ...others, [arg]: bad } })) as CallResult;
        const what = `${tool} ${arg}=${bad}`;
        assert.equal(r.isError, true, what);
        const text = textOf(r);
        assert.ok(text.includes(arg), `${what}: the answer names the argument: ${text}`);
        assert.match(text, /another computer or a device/, what);
        assert.ok(!text.includes("127.0.0.1") && !text.includes("mw-test"), `${what}: the answer repeats the path: ${text}`);
      }
    }
    assert.deepEqual(spy.seen, [], "a network path reached the filesystem");
  } finally {
    spy.restore();
    await close();
  }
});

test("a local file under its long \\\\?\\C:\\ spelling still reads", { skip: process.platform !== "win32" }, async () => {
  const { client, close } = await connected();
  try {
    const long = `${B}${B}?${B}${resolve(SSE_LOG)}`;
    const parsed = (await client.callTool({ name: "mw_parse_crashlog", arguments: { logPath: long } })) as CallResult;
    assert.equal(parsed.isError, undefined, textOf(parsed));
    assert.equal(JSON.parse(textOf(parsed)).ok, true);
    const whispered = (await client.callTool({ name: "mw_crash_whisperer", arguments: { logPath: long, checkInstall: false, compareRecent: 0 } })) as CallResult;
    assert.equal(whispered.isError, undefined, textOf(whispered));
  } finally {
    await close();
  }
});

// A local instance folder is a fine argument, but its ModOrganizer.ini, modlist.txt and
// profile name are files anyone can plant, say in an unpacked download. They are not
// followed onto another computer either.

/** Call every tool that reads an MO2 instance, with `instance` as its instance folder. */
async function callMo2Tools(client: Client, gameDir: string, instance: string): Promise<void> {
  for (const [tool, args] of [
    ["mw_patch_day", { gamePath: gameDir, mo2InstancePath: instance }],
    ["mw_crash_whisperer", { logPath: SSE_LOG, compareRecent: 0, gamePath: gameDir, mo2InstancePath: instance }],
    ["mw_doctor", { gamePath: gameDir, mo2InstancePath: instance }],
    ["mw_read_load_order", { gameId: "skyrimspecialedition", modManager: "mo2", instancePath: instance }],
  ] as const) {
    const r = (await client.callTool({ name: tool, arguments: args })) as CallResult;
    assert.notEqual(r.isError, true, `${tool}: ${textOf(r)}`);
  }
}

test("a folder that ModOrganizer.ini puts on another computer is not opened", async () => {
  const sb = createSandbox("mw-ini-share-");
  sb.start();
  const { client, close } = await connected();
  const spy = spyOnNetworkOpens();
  try {
    const w = sb.makeWorld();
    const share = `${B}${B}127.0.0.1${B}mw-test-share`;
    for (const [name, settings] of [
      ["base", `base_directory=${share}`],
      ["mods", `mod_directory=${share}${B}mods\noverwrite_directory=${share}${B}overwrite`],
    ]) {
      const instance = join(w.root, "Downloads", name!);
      put(instance, "ModOrganizer.ini", `[General]\ngameName=Skyrim Special Edition\nselected_profile=Default\n\n[Settings]\n${settings}\n`);
      put(join(instance, "profiles", "Default"), "modlist.txt", "+Some Mod\n");
      put(join(instance, "profiles", "Default"), "plugins.txt", "*Some Mod.esp\n");
      await callMo2Tools(client, w.gameDir, instance);
      // On no system is it a folder of this machine: Linux would read "//host/share" as one of its own.
      assert.equal(mo2Folder(instance, "mod_directory", "mods"), null, name);
    }
    assert.deepEqual(spy.seen, [], "a network path reached the filesystem");
  } finally {
    spy.restore();
    await close();
    sb.stop();
  }
});

test("a mod or profile name in MO2's files can't climb from a long \\\\?\\C:\\ path onto another computer", { skip: process.platform !== "win32" }, async () => {
  // Node folds "..\..\UNC\host\share" under \\?\C:\ into \\?\UNC\host\share.
  const sb = createSandbox("mw-ini-climb-");
  sb.start();
  const { client, close } = await connected();
  const spy = spyOnNetworkOpens();
  try {
    const w = sb.makeWorld();
    const climb = `${Array(16).fill("..").join(B)}${B}UNC${B}127.0.0.1${B}mw-test-share`;
    const long = (p: string): string => `${B}${B}?${B}${resolve(p)}`;
    const elsewhere = join(w.root, "Elsewhere");
    mkdirSync(join(elsewhere, "mods"), { recursive: true });
    // The mods folder set to a long path, and a mod named to climb out of it.
    const a = join(w.root, "Downloads", "A");
    put(a, "ModOrganizer.ini", `[General]\ngameName=Skyrim Special Edition\nselected_profile=Default\n\n[Settings]\nmod_directory=${long(join(elsewhere, "mods"))}\n`);
    put(join(a, "profiles", "Default"), "modlist.txt", `+${climb}\n`);
    put(join(a, "profiles", "Default"), "plugins.txt", "*Some Mod.esp\n");
    // The profiles folder set to a long path, and the selected profile named to climb out of it.
    const b = join(w.root, "Downloads", "B");
    put(b, "ModOrganizer.ini", `[General]\ngameName=Skyrim Special Edition\nselected_profile=${climb}\n\n[Settings]\nprofiles_directory=${long(elsewhere)}\n`);
    // The instance itself passed under its long spelling, and a mod named to climb out of it.
    const c = join(w.root, "Downloads", "C");
    put(c, "ModOrganizer.ini", "[General]\ngameName=Skyrim Special Edition\nselected_profile=Default\n");
    put(join(c, "profiles", "Default"), "modlist.txt", `+${climb}\n`);
    put(join(c, "profiles", "Default"), "plugins.txt", "*Some Mod.esp\n");
    mkdirSync(join(c, "mods"), { recursive: true });
    for (const instance of [a, b, long(c)]) await callMo2Tools(client, w.gameDir, instance);
    assert.deepEqual(spy.seen, [], "a network path reached the filesystem");
  } finally {
    spy.restore();
    await close();
    sb.stop();
  }
});

// ─── An error nobody planned for ─────────────────────────────────────────────
// A file another program holds open (EBUSY), or one the account can't read (EPERM),
// makes Node throw an error whose message is the full path, user name and all. The SDK
// hands a thrown error's message to the client as the answer. So every handler catches
// it and says what happened in a sentence with no path in it.

const PLANTED_DIR = `C:${B}Users${B}Jane Doe${B}Games${B}MO2 Portable`;
const busy = (): Error =>
  Object.assign(new Error(`EBUSY: resource busy or locked, open '${PLANTED_DIR}${B}profiles${B}Default${B}modlist.txt'`), {
    code: "EBUSY",
    path: PLANTED_DIR,
  });

test("a handler that hits an error it didn't plan for answers in one sentence, with the error's code and no path", async () => {
  const server = new MockMcpServer();
  registerWorkbenchTools(server as unknown as never);
  // Reading any argument throws, the way a locked file throws deep inside a tool.
  const hostile = new Proxy({}, { get: () => { throw busy(); }, has: () => { throw busy(); } });
  let checked = 0;
  for (const [name, tool] of server.tools) {
    if (tool.schema === undefined) continue; // mw_detect_environment takes no arguments to plant this in
    const r = await tool.handler(hostile as Record<string, unknown>);
    assert.equal(r.isError, true, name);
    const text = r.content.map((c) => c.text).join("\n");
    assert.ok(text.includes(name), `${name}: ${text}`);
    assert.ok(text.includes("EBUSY"), `${name}: ${text}`);
    assert.doesNotMatch(text, /Jane|Doe|Users|MO2 Portable|modlist/, `${name}: ${text}`);
    checked++;
  }
  assert.equal(checked, 8);
});

test("through the real SDK, a locked MO2 file gives a plain error, not the path and user name Node put in its message", async () => {
  const root = mkdtempSync(join(tmpdir(), "mw-guard-"));
  const instance = join(root, "Jane Doe", "MO2 Portable");
  mkdirSync(join(instance, "profiles", "Default"), { recursive: true });
  writeFileSync(join(instance, "ModOrganizer.ini"), "[General]\ngameName=Skyrim Special Edition\nselected_profile=Default\n");
  writeFileSync(join(instance, "profiles", "Default", "modlist.txt"), "+Some Mod\n");
  writeFileSync(join(instance, "profiles", "Default", "plugins.txt"), "*Some Mod.esp\n");
  const target = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const original = target.readFileSync!;
  target.readFileSync = function (this: unknown, p: unknown, ...rest: unknown[]) {
    if (typeof p === "string" && p.endsWith("modlist.txt")) {
      throw Object.assign(new Error(`EBUSY: resource busy or locked, open '${p}'`), { code: "EBUSY", path: p });
    }
    return original.call(this, p, ...rest);
  };
  syncBuiltinESMExports();
  const { client, close } = await connected();
  try {
    const r = (await client.callTool({
      name: "mw_read_load_order",
      arguments: { gameId: "skyrimspecialedition", modManager: "mo2", instancePath: instance },
    })) as CallResult;
    const text = textOf(r);
    assert.equal(r.isError, true, text);
    assert.ok(text.includes("EBUSY"), text);
    assert.ok(!text.includes(root) && !text.includes("Jane Doe") && !text.includes(tmpdir()), `the answer carries the path: ${text}`);
  } finally {
    target.readFileSync = original;
    syncBuiltinESMExports();
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});
