import { test } from "node:test";
import assert from "node:assert/strict";
import { hostname, homedir, userInfo } from "node:os";
import { registerCritiqueTool } from "../src/critique.js";
import { AppsMockServer, PLAIN, withEnv } from "./helpers/apps-server.js";

// ─── mw_critique ─────────────────────────────────────────────────────────────
// The tool reads what it can know without asking (ModWrench's version, the
// connectors that are on, the client's own name, the system) and hands back a
// draft and a link. It is read-only, sends nothing, and puts nothing personal in.

type Active = Array<{ platformId: string; toolCount: number }>;
const catalog = (active: Active) => ({ listActive: () => active }) as never;
const BOOT: Active = [
  { platformId: "thunderstore", toolCount: 9 },
  { platformId: "workbench", toolCount: 10 },
];

/** The mock server, also answering getClientVersion() the way the SDK's server does after initialize. */
class ClientServer extends AppsMockServer {
  constructor(private readonly info: unknown) {
    super(PLAIN);
  }
  override get server(): { getClientCapabilities: () => unknown; getClientVersion: () => unknown } {
    return { getClientCapabilities: () => this.clientCapabilities, getClientVersion: () => this.info };
  }
}

/** A server with mw_critique on it, whose client named itself `info` (anything, undefined included). */
function critiqueWith(info: unknown, active: Active = BOOT): ClientServer {
  const server = new ClientServer(info);
  registerCritiqueTool(server as never, catalog(active), "0.3.0");
  return server;
}
const critique = (): ClientServer => critiqueWith({ name: "test-client", version: "1.2.3" });

test("mw_critique is read-only, touches nothing outside, and says it posts nothing", () => {
  const tool = critique().tools.get("mw_critique");
  assert.ok(tool);
  assert.deepEqual(tool.config.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.match(tool.config.description, /makes no network request and posts nothing/);
  assert.equal(tool.config._meta, undefined, "no page");
});

test("the draft names the version, the connectors that are on and the client as it named itself", async () => {
  const result = await withEnv({ MODWRENCH_UI: undefined, MODWRENCH_STRUCTURED: undefined }, () =>
    critique().call("mw_critique", { kind: "idea", title: "More games", feedback: "Fallout 4 please." })
  );
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent, undefined);
  const text = result.content[0]?.text ?? "";
  assert.match(text, /^Title: \[idea\] More games$/m);
  assert.match(text, /^- ModWrench 0\.3\.0, connectors on: Thunderstore, Workbench$/m);
  assert.match(text, /^- AI client: test-client 1\.2\.3, as it named itself$/m);
  assert.match(text, /^- Pages on, structured data auto$/m);
  assert.match(text, /^https:\/\/github\.com\/171county\/modwrench\/issues\/new\?template=feedback\.yml&/m);
});

test("the page settings in the draft are the ones the server runs with", async () => {
  const text = (
    await withEnv({ MODWRENCH_UI: "off", MODWRENCH_STRUCTURED: "never" }, () => critique().call("mw_critique", {}))
  ).content[0]?.text ?? "";
  assert.match(text, /^- Pages off \(MODWRENCH_UI=off\), structured data never$/m);
});

test("a client that named nothing, or a server that can't say, leaves the client out rather than guessing", async () => {
  for (const info of [undefined, null, "a string", { version: "9" }]) {
    const text = (await critiqueWith(info).call("mw_critique", {})).content[0]?.text ?? "";
    assert.match(text, /^- AI client: not reported by the client$/m, String(info));
  }
});

test("nothing about this machine or its user is in the answer", async () => {
  const text = (await critique().call("mw_critique", { feedback: "It works." })).content[0]?.text ?? "";
  const me = userInfo().username;
  for (const personal of [homedir(), hostname(), me]) {
    if (personal.length >= 3) assert.ok(!text.includes(personal), `found ${personal}`);
  }
});
