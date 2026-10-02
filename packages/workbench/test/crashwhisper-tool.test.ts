import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MCP_APP_MIME, MCP_APPS_EXTENSION_ID } from "@modwrench/ui";
import { summarizeCrashWhisper, whisper, type CrashWhisperReport } from "../src/crashwhisper/index.js";
import { VENUES } from "../src/crashwhisper/types.js";
import { registerWorkbenchTools } from "../src/register.js";
import { everythingOut, fixture, found, personalLines, PERSON, valuesOf } from "./helpers/person.js";
import { createSandbox, put } from "./helpers/world.js";

// ─── mw_crash_whisperer, the way a client calls it ───────────────────────────
// The engine is tested end to end in crashwhisper*.test.ts. This file is about the
// tool around it: what a client is sent, who gets the structured report, what the
// arguments do, and that going through the tool doesn't open a way around anything
// the engine guarantees. Every test runs with HOME and friends pointed into a temp
// folder, so what the tool finds on disk is only what the test built.

const HERE = dirname(fileURLToPath(import.meta.url));
const SSE = fixture("crash-sse-real-format.log");
const BEPINEX = fixture("LogOutput-real-format.log");

const sandbox = createSandbox("mw-crashtool-");
before(() => sandbox.start());
afterEach(() => sandbox.isolate());
after(() => sandbox.stop());

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;
type Registered = {
  config: {
    title?: string;
    description: string;
    inputSchema?: Record<string, z.ZodTypeAny>;
    annotations: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
  handler: Handler;
};

class MockMcpServer {
  tools = new Map<string, Registered>();
  /** What the connected client said it can do when it connected. */
  constructor(private readonly clientCapabilities?: unknown) {}
  get server(): { getClientCapabilities: () => unknown } {
    return { getClientCapabilities: () => this.clientCapabilities };
  }
  registerTool(name: string, config: Registered["config"], handler: Handler): void {
    this.tools.set(name, { config, handler });
  }
  registerResource(): void {
    // The page isn't what these tests are about (apps.test.ts covers it).
  }
}

/** A client that says it can draw MCP Apps pages. Pass null to a helper for a client that said nothing. */
const DRAWS_PAGES = { extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME] } } };

function tool(capabilities: unknown = DRAWS_PAGES): Registered {
  const server = new MockMcpServer(capabilities);
  registerWorkbenchTools(server as unknown as never);
  const found_ = server.tools.get("mw_crash_whisperer");
  assert.ok(found_, "mw_crash_whisperer is not registered");
  return found_;
}

function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}
const withStructured = <T>(value: string | undefined, fn: () => T): T => withEnv("MODWRENCH_STRUCTURED", value, fn);

/** What a client receives on the wire: JSON, so `undefined` fields are gone. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Arguments that keep a run to the pasted log alone. */
const alone = { checkInstall: false, compareRecent: 0 } as const;

const skseDocs = (documents: string): string => join(documents, "My Games", "Skyrim Special Edition", "SKSE");

function logAt(dir: string, name: string, daysAgo: number, text: string): string {
  put(dir, name, text);
  const when = new Date(Date.now() - daysAgo * 86_400_000);
  utimesSync(join(dir, name), when, when);
  return join(dir, name);
}

const report = (result: ToolResult): CrashWhisperReport => {
  assert.ok(result.structuredContent, "the structured report is missing");
  assert.equal(result.structuredContent.ok, true, String(result.structuredContent.error ?? ""));
  return result.structuredContent as unknown as CrashWhisperReport;
};

// ─── What the tool is ────────────────────────────────────────────────────────

test("mw_crash_whisperer: a question in the player's words, read-only, with every argument optional", () => {
  const { config } = tool();
  assert.equal(config.title, "Why did my game crash?");
  assert.deepEqual(
    { r: config.annotations.readOnlyHint, d: config.annotations.destructiveHint, i: config.annotations.idempotentHint, o: config.annotations.openWorldHint },
    { r: true, d: false, i: true, o: false }
  );
  assert.ok(config.inputSchema, "no input schema");
  const schema = z.object(config.inputSchema).strict();
  assert.equal(schema.safeParse({}).success, true, "calling it with nothing reads the newest log");
  assert.deepEqual(Object.keys(config.inputSchema).sort(), [
    "checkInstall",
    "compareRecent",
    "gameId",
    "gamePath",
    "hideNames",
    "logContent",
    "logPath",
    "logType",
    "mo2InstancePath",
    "packet",
    "profileName",
  ]);
});

test("mw_crash_whisperer: what the arguments accept and refuse", () => {
  const schema = z.object(tool().config.inputSchema!).strict();
  const good = {
    logContent: "text",
    logPath: "x.log",
    gameId: "skyrimspecialedition",
    logType: "crashlogger-sse",
    gamePath: "g",
    mo2InstancePath: "m",
    profileName: "p",
    checkInstall: false,
    compareRecent: 10,
    hideNames: true,
    packet: "forum",
  };
  assert.equal(schema.safeParse(good).success, true);
  for (const logType of ["auto", "crashlogger-sse", "buffout4", "netscriptframework", "bepinex"]) {
    assert.equal(schema.safeParse({ logType }).success, true, logType);
  }
  for (const packet of VENUES) assert.equal(schema.safeParse({ packet }).success, true, packet);
  for (const [what, bad] of [
    ["a packet for a place that doesn't exist", { packet: "twitter" }],
    ["a format it doesn't read", { logType: "unreal" }],
    ["too many logs to compare", { compareRecent: 11 }],
    ["fewer than none to compare", { compareRecent: -1 }],
    ["half a log to compare", { compareRecent: 2.5 }],
    ["a yes that isn't a boolean", { checkInstall: "yes" }],
    ["hideNames as a word", { hideNames: "true" }],
    ["an argument it doesn't have", { writeFix: true }],
  ] as const) {
    assert.equal(schema.safeParse(bad).success, false, what);
  }
});

test("mw_crash_whisperer: the places a packet can be asked for are the places there are packets for", () => {
  const packet = tool().config.inputSchema!.packet as z.ZodOptional<z.ZodEnum<[string, ...string[]]>>;
  assert.deepEqual([...packet.unwrap().options].sort(), [...VENUES].sort());
});

test("mw_crash_whisperer: the description says what it does and what it doesn't", () => {
  const { description } = tool().config;
  assert.match(description, /^Why did my game crash\?/);
  assert.match(description, /read-only/i);
  assert.match(description, /ModWrench sends nothing anywhere/);
  assert.match(description, /the answer goes to the AI you're talking to/);
  assert.match(description, /a lead, never a verdict/);
  assert.match(description, /Crash Logger SSE, Buffout 4, NetScriptFramework and BepInEx/);
  assert.match(description, /Use when the user says/);
  assert.doesNotMatch(description, /\b(is safe|are safe|guilty|culprit|definitely|certainly|100%)\b/i);
});

// ─── Plain text first ────────────────────────────────────────────────────────

test("a pasted log: a short plain-text answer, and for a client that draws pages the engine's whole report", async () => {
  const result = await withStructured(undefined, () => tool().handler({ logContent: SSE, ...alone }));
  const engine = whisper({ logContent: SSE, ...alone });
  assert.equal(engine.ok, true);

  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]!.type, "text");
  assert.equal(result.content[0]!.text, summarizeCrashWhisper(engine));
  assert.match(result.content[0]!.text, /strongest lead is CloakAndDaggerFix\.dll/);
  assert.match(result.content[0]!.text, /^How sure: /m);
  assert.match(result.content[0]!.text, /^Leads \(names the log points at/m);
  assert.doesNotMatch(result.content[0]!.text, /^\s*[{[]/, "the text is an answer, not a JSON dump");
  assert.deepEqual(wire(result.structuredContent), wire(engine));
  assert.equal(report(result).crash.source, "pasted");
});

test("a client that can't draw pages gets the plain text and nothing else", async () => {
  const engine = whisper({ logContent: SSE, ...alone });
  for (const [what, capabilities] of [
    ["no capabilities", null],
    ["other capabilities", { roots: {}, sampling: {} }],
    ["no extensions", { extensions: {} }],
    ["another extension", { extensions: { "io.example/other": { mimeTypes: [MCP_APP_MIME] } } }],
  ] as const) {
    const result = await withStructured(undefined, () => tool(capabilities).handler({ logContent: SSE, ...alone }));
    assert.equal(result.content.length, 1, what);
    assert.equal(result.content[0]!.text, summarizeCrashWhisper(engine), what);
    assert.ok(!("structuredContent" in result), `${what}: the whole report was sent to a client that didn't ask for pages`);
  }
});

test("the text is compact for every client, with or without a help post in it", async () => {
  const full = JSON.stringify(report(await tool().handler({ logContent: SSE, ...alone })));
  const plain = await tool(null).handler({ logContent: SSE, ...alone });
  assert.ok(plain.content[0]!.text.length < 6000, `the answer is ${plain.content[0]!.text.length} characters`);
  assert.ok(plain.content[0]!.text.length < full.length / 2, "the text is far shorter than the report it summarizes");
  for (const packet of VENUES) {
    const withPacket = await tool(null).handler({ logContent: SSE, packet, ...alone });
    assert.ok(withPacket.content[0]!.text.length < 12_000, `${packet}: ${withPacket.content[0]!.text.length} characters`);
  }
});

test("MODWRENCH_STRUCTURED=always sends the report to a client that can't draw pages; =never withholds it from one that can", async () => {
  const engine = whisper({ logContent: SSE, ...alone });
  const forced = await withStructured("always", () => tool(null).handler({ logContent: SSE, ...alone }));
  assert.deepEqual(wire(forced.structuredContent), wire(engine));
  assert.equal(forced.content[0]!.text, summarizeCrashWhisper(engine), "the text is still there");

  const withheld = await withStructured("never", () => tool(DRAWS_PAGES).handler({ logContent: SSE, ...alone }));
  assert.ok(!("structuredContent" in withheld));
  assert.equal(withheld.content[0]!.text, summarizeCrashWhisper(engine));
});

test("asking twice gives the same answer", async () => {
  const t = tool();
  const first = await t.handler({ logContent: SSE, ...alone });
  const second = await t.handler({ logContent: SSE, ...alone });
  assert.deepEqual(second, first);
});

// ─── Reading the newest log from disk ────────────────────────────────────────

test("with no arguments it reads the newest crash log the logger wrote", async () => {
  const w = sandbox.makeWorld();
  logAt(skseDocs(w.documents), "crash-2026-09-20-08-00-00.log", 12, SSE.replace("21:14:03", "08:00:00"));
  logAt(skseDocs(w.documents), "crash-2026-10-01-21-14-03.log", 1, SSE);
  const result = await tool().handler({});
  assert.equal(result.isError, undefined);
  const r = report(result);
  assert.equal(r.crash.source, "newest");
  assert.equal(r.crash.fileName, "crash-2026-10-01-21-14-03.log");
  assert.equal(r.crash.format, "crashlogger-sse");
  assert.match(result.content[0]!.text, /file crash-2026-10-01-21-14-03\.log/);
  assert.equal(r.recent.examined, 1, "the older crash is compared by default");
});

test("a log given by path, and the other arguments reach the engine", async () => {
  const w = sandbox.makeWorld();
  const elsewhere = join(w.root, "Elsewhere");
  mkdirSync(elsewhere, { recursive: true });
  writeFileSync(join(elsewhere, "my-crash.log"), SSE);
  const path = join(elsewhere, "my-crash.log");
  // Two older crashes where the logger writes them, so what gets compared is something to count.
  logAt(skseDocs(w.documents), "crash-2026-09-20-08-00-00.log", 12, SSE.replace("21:14:03", "08:00:00"));
  logAt(skseDocs(w.documents), "crash-2026-09-10-08-00-00.log", 22, SSE.replace("21:14:03", "09:00:00"));

  const r = report(await tool().handler({ logPath: path, hideNames: true, checkInstall: false, compareRecent: 0 }));
  assert.equal(r.crash.source, "path");
  assert.equal(r.crash.fileName, "my-crash.log");
  assert.equal(r.install.checked, false, "checkInstall: false was honoured");
  assert.equal(r.recent.examined, 0, "compareRecent: 0 was honoured");
  assert.match(r.packets.forum.text, /left out on purpose/, "hideNames was honoured");

  const some = report(await tool().handler({ logPath: path, checkInstall: false, compareRecent: 1 }));
  assert.equal(some.recent.examined, 1, "compareRecent: 1 was honoured");
  const dflt = report(await tool().handler({ logPath: path, checkInstall: false }));
  assert.equal(dflt.recent.examined, 2, "the other recent crashes are compared by default");
  assert.doesNotMatch(dflt.packets.forum.text, /left out on purpose/, "the plugin lists are in the packets unless asked to leave them out");
});

test("a format given by hint is the format it is read as", async () => {
  const auto = report(await tool().handler({ logContent: SSE, ...alone }));
  assert.equal(auto.crash.format, "crashlogger-sse", "detected from the log itself");
  for (const logType of ["buffout4", "netscriptframework", "bepinex"] as const) {
    const hinted = report(await tool().handler({ logContent: SSE, logType, ...alone }));
    assert.equal(hinted.crash.format, logType, `read as ${logType}`);
  }
  assert.equal(report(await tool().handler({ logContent: SSE, logType: "auto", ...alone })).crash.format, "crashlogger-sse");
});

test("another game's log is looked for when the game is named", async () => {
  const w = sandbox.makeWorld();
  const dir = join(sandbox.home, ".config", "r2modmanPlus-local", "LethalCompany", "profiles", "Default", "BepInEx");
  logAt(dir, "LogOutput.log", 1, BEPINEX);
  logAt(skseDocs(w.documents), "crash-2026-10-01-21-14-03.log", 5, SSE);
  const r = report(await tool().handler({ gameId: "lethalcompany", ...alone }));
  assert.equal(r.crash.format, "bepinex");
  assert.equal(r.crash.game.name, "Lethal Company");
});

test("a help packet is put in the answer only when asked for, and it is the packet the page offers", async () => {
  const none = await tool().handler({ logContent: SSE, ...alone });
  assert.match(none.content[0]!.text, /Ask again with packet set to one of them/);
  assert.doesNotMatch(none.content[0]!.text, /^Help packet for /m);
  for (const venue of VENUES) {
    const result = await tool().handler({ logContent: SSE, packet: venue, ...alone });
    const r = report(result);
    const text = result.content[0]!.text;
    assert.match(text, new RegExp(`^Help packet for ${venue} `, "m"));
    assert.ok(text.includes(r.packets[venue].text), `${venue}: the packet's text is in the answer whole`);
    assert.doesNotMatch(text, /Ask again with packet set/);
  }
});

// ─── When it can't run ───────────────────────────────────────────────────────

test("no crash log anywhere: an error with the reason and where it looked, in words, whoever the client is", async () => {
  sandbox.makeWorld();
  for (const capabilities of [DRAWS_PAGES, null]) {
    const result = await withStructured(undefined, () => tool(capabilities).handler({ gameId: "skyrimspecialedition" }));
    assert.equal(result.isError, true);
    const text = result.content[0]!.text;
    assert.match(text, /^Crash Whisperer couldn't run: No crash log found\./);
    assert.match(text, /Where it looked:\n- Skyrim Special Edition: no log found/);
    assert.ok(!text.includes(sandbox.root), "no folder of the player's in the answer");
    assert.doesNotMatch(text, /[A-Za-z]:\\|\/tmp\/|\/home\//);
    assert.equal("structuredContent" in result, capabilities !== null);
    if (capabilities !== null) assert.equal(result.structuredContent?.ok, false);
  }
});

test("a log that isn't one it reads, a missing file and a game it doesn't know are errors with a way forward", async () => {
  const w = sandbox.makeWorld();
  const junk = await tool().handler({ logContent: "this is not a crash log\njust some words", ...alone });
  assert.equal(junk.isError, true);
  assert.match(junk.content[0]!.text, /doesn't look like a log Crash Whisperer can read/);
  assert.match(junk.content[0]!.text, /logType/);

  const missing = await tool().handler({ logPath: join(w.root, "no-such-file.log") });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0]!.text, /can't open the file at logPath/);
  assert.ok(!missing.content[0]!.text.includes(w.root), "the path the player gave isn't echoed back");

  const unknownGame = await tool().handler({ gameId: "notagame" });
  assert.equal(unknownGame.isError, true);
  assert.match(unknownGame.content[0]!.text, /doesn't know where "notagame" keeps its logs/);
  assert.match(unknownGame.content[0]!.text, /skyrimspecialedition/);
});

test("a paste that is too big is turned away with the way round it", async () => {
  const huge = "x".repeat(4_000_001);
  const result = await tool(null).handler({ logContent: huge });
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /too much text to paste/);
  assert.match(result.content[0]!.text, /logPath/);
});

// ─── Nothing gets around the redaction ───────────────────────────────────────

function asPerson<T>(fn: () => T): T {
  const keys = ["USERNAME", "USER", "LOGNAME", "COMPUTERNAME", "HOSTNAME", "HOME"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.USERNAME = PERSON.name;
  process.env.USER = PERSON.account;
  process.env.LOGNAME = PERSON.account;
  process.env.COMPUTERNAME = PERSON.machine;
  process.env.HOSTNAME = PERSON.machine;
  process.env.HOME = join(sandbox.root, PERSON.account);
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("through the tool, the person's name, computer, folders and keys are in none of the answers a client can be handed", async () => {
  const planted = `${SSE.trimEnd()}\n${personalLines().join("\n")}\n`;
  for (const capabilities of [DRAWS_PAGES, null]) {
    const t = tool(capabilities);
    for (const venue of [undefined, ...VENUES]) {
      const result = await asPerson(() => t.handler({ logContent: planted, ...alone, ...(venue ? { packet: venue } : {}) }));
      assert.equal(result.isError, undefined);
      const out: Record<string, string> = { text: result.content[0]!.text };
      if (result.structuredContent) Object.assign(out, everythingOut(result.structuredContent as unknown as CrashWhisperReport));
      for (const [where, text] of Object.entries(out)) {
        assert.deepEqual(found(text), [], `${venue ?? "no packet"} / ${capabilities ? "pages" : "plain"} / ${where}`);
      }
    }
  }
});

test("through the tool, a log named after the person on disk is read without the name coming out", async () => {
  const w = sandbox.makeWorld();
  const dir = join(w.root, "Elsewhere");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `crash-${PERSON.name}-2026.log`);
  writeFileSync(path, `${SSE.trimEnd()}\n${personalLines().join("\n")}\n`);
  const result = await asPerson(() => tool().handler({ logPath: path, ...alone }));
  const everything = [result.content[0]!.text, ...valuesOf(result.structuredContent), JSON.stringify(result.structuredContent)].join("\n");
  assert.deepEqual(found(everything), []);
  assert.equal(report(result).crash.fileName, "crash-REDACTED-USER-2026.log");
});

// ─── What it logs ────────────────────────────────────────────────────────────
// The tool logs one line at debug level so a player who turns logging on can see it ran. That line holds a
// count and a format name. It runs in a child process, because the logger reads its level once, at start.

test("the debug log says that it ran and how it went, and holds nothing from the log or the player's files", () => {
  const w = sandbox.makeWorld();
  const path = join(w.root, "planted.log");
  writeFileSync(path, `${SSE.trimEnd()}\n${personalLines().join("\n")}\n`);
  const script = `
    import { registerWorkbenchTools } from "./src/register.ts";
    const tools = new Map();
    registerWorkbenchTools({
      registerTool(name, _config, handler) { tools.set(name, handler); },
      registerResource() {},
      server: { getClientCapabilities: () => undefined },
    });
    const result = await tools.get("mw_crash_whisperer")({ logPath: process.env.PLANTED_LOG, compareRecent: 0 });
    if (result.isError) { process.stderr.write("RUN-FAILED " + result.content[0].text + "\\n"); process.exit(2); }
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: join(HERE, ".."),
    encoding: "utf8",
    env: { ...process.env, LOG_LEVEL: "debug", PLANTED_LOG: path, HOME: sandbox.home, USERPROFILE: sandbox.home },
    timeout: 60_000,
  });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stderr.split("\n").filter((l) => l.trim() !== "");
  const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  const ours = entries.filter((e) => e.msg === "workbench.crash_whisperer");
  assert.equal(ours.length, 1, "one line, logged once");
  assert.deepEqual(Object.keys(ours[0]!).sort(), ["checks", "format", "leads", "level", "msg", "ok", "source", "ts"]);
  assert.equal(ours[0]!.ok, true);
  assert.equal(ours[0]!.format, "crashlogger-sse");
  assert.equal(ours[0]!.source, "path");
  assert.equal(typeof ours[0]!.leads, "number");
  assert.equal(typeof ours[0]!.checks, "number");
  const everythingLogged = run.stderr;
  assert.deepEqual(found(everythingLogged), [], "nothing personal in what was logged");
  assert.doesNotMatch(everythingLogged, /CloakAndDaggerFix|Tiny Tweak|crash-sse|planted\.log|EXCEPTION_ACCESS/, "nothing from the log in what was logged");
  assert.ok(!everythingLogged.includes(w.root), "no folder in what was logged");
});
