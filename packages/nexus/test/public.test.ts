import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerNexusPublicTools } from "../src/public.js";

// ─── The Nexus tools that need no key ────────────────────────────────────────
// They read Nexus's v2 GraphQL API with no key or token. These tests pin what each
// one asks for (the query's root field, its variables, the adult flag) and what it
// never sends, because a field Nexus doesn't know fails the whole query, and a
// query that doesn't ask for the adult flag lets every adult mod through.

type ToolResult = { content: Array<{ type: string; text: string }> };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;
type Config = { annotations?: Record<string, unknown> };

class MockServer {
  tools = new Map<string, { config: Config; handler: Handler }>();
  registerTool(name: string, config: Config, handler: Handler): void {
    this.tools.set(name, { config, handler });
  }
  call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`tool not registered: ${name}`);
    return tool.handler(args);
  }
}

type Sent = { query: string; variables: Record<string, unknown>; headers: Headers; url: string };

const originalFetch = globalThis.fetch;
const originalAllow = process.env.NEXUS_ALLOW_ADULT_CONTENT;
beforeEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NEXUS_ALLOW_ADULT_CONTENT;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAllow === undefined) delete process.env.NEXUS_ALLOW_ADULT_CONTENT;
  else process.env.NEXUS_ALLOW_ADULT_CONTENT = originalAllow;
});

/** Answer every GraphQL request with `respond(query)`, and keep what was sent. */
function stub(respond: (sent: Sent) => unknown): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
    const s = { query: body.query ?? "", variables: body.variables ?? {}, headers: new Headers(init?.headers), url: url.toString() };
    sent.push(s);
    return new Response(JSON.stringify(respond(s)), { status: 200, headers: { "content-type": "application/json" } });
  };
  return sent;
}

function server(): MockServer {
  const s = new MockServer();
  registerNexusPublicTools(s as never);
  return s;
}

function mod(modId: number, name: string, adult?: boolean): Record<string, unknown> {
  return {
    modId,
    name,
    summary: `${name} summary`,
    version: "1.0",
    author: "someone",
    uploader: { name: "someone" },
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
    downloads: 10,
    endorsements: 2,
    game: { domainName: "skyrimspecialedition", name: "Skyrim Special Edition" },
    ...(adult === undefined ? {} : { adultContent: adult }),
  };
}

const PUBLIC = [
  "nexus_search",
  "nexus_list_games",
  "nexus_get_game",
  "nexus_get_mod",
  "nexus_latest_added",
  "nexus_latest_updated",
  "nexus_updated",
  "nexus_md5_search",
];

/** A plausible answer for whichever query was sent. */
function answer(s: Sent): unknown {
  if (s.query.includes("games(")) return { data: { games: { totalCount: 1, nodes: [{ id: 1704, domainName: "skyrimspecialedition", name: "Skyrim Special Edition", modCount: 100, downloadCount: "5000" }] } } };
  if (s.query.includes("game(")) return { data: { game: { id: 1704, domainName: "skyrimspecialedition", name: "Skyrim Special Edition" } } };
  if (s.query.includes("legacyModsByDomain(")) return { data: { legacyModsByDomain: { nodes: [mod(1840, "SkyUI", false)] } } };
  if (s.query.includes("fileHash(")) return { data: { fileHash: [] } };
  return { data: { mods: { totalCount: 1, nodes: [mod(1840, "SkyUI", false)] } } };
}

const ARGS: Record<string, Record<string, unknown>> = {
  nexus_search: { query: "sky" },
  nexus_list_games: {},
  nexus_get_game: { game_domain: "skyrimspecialedition" },
  nexus_get_mod: { game_domain: "skyrimspecialedition", mod_id: 1840 },
  nexus_latest_added: { game_domain: "skyrimspecialedition" },
  nexus_latest_updated: { game_domain: "skyrimspecialedition" },
  nexus_updated: { game_domain: "skyrimspecialedition" },
  nexus_md5_search: { md5_hash: "a".repeat(32) },
};

// ─── Registration ────────────────────────────────────────────────────────────

test("the eight public tools are registered, all read-only", () => {
  const s = server();
  assert.deepEqual([...s.tools.keys()].sort(), [...PUBLIC].sort());
  for (const [name, { config }] of s.tools) {
    assert.equal(config.annotations?.readOnlyHint, true, name);
    assert.equal(config.annotations?.destructiveHint, false, name);
    assert.equal(typeof config.annotations?.idempotentHint, "boolean", name);
    assert.equal(typeof config.annotations?.openWorldHint, "boolean", name);
  }
});

test("every public tool sends no key or token, only the application headers, to the v2 GraphQL endpoint", async () => {
  const s = server();
  const sent = stub(answer);
  for (const name of PUBLIC) await s.call(name, ARGS[name]!);
  assert.equal(sent.length, PUBLIC.length);
  for (const r of sent) {
    assert.equal(r.url, "https://api.nexusmods.com/v2/graphql");
    assert.equal(r.headers.get("apikey"), null);
    assert.equal(r.headers.get("authorization"), null);
    assert.equal(r.headers.get("application-name"), "ModWrench");
    assert.ok(r.headers.get("application-version"));
  }
});

test("every query that returns mods asks for adultContent, and none asks for the deprecated adult field", async () => {
  const s = server();
  const sent = stub(answer);
  for (const name of PUBLIC) await s.call(name, ARGS[name]!);
  for (const r of sent) {
    if (r.query.includes("games(") || r.query.includes("game(")) continue;
    assert.match(r.query, /\badultContent\b/, r.query.split("\n")[0]);
    assert.doesNotMatch(r.query, /\badult\b/, r.query.split("\n")[0]);
  }
});

test("no query asks for a user's protected fields", async () => {
  const s = server();
  const sent = stub(answer);
  for (const name of PUBLIC) await s.call(name, ARGS[name]!);
  for (const r of sent) assert.doesNotMatch(r.query, /\b(email|ipAddress|paypal)\b/);
});

// ─── Games ───────────────────────────────────────────────────────────────────

test("nexus_list_games asks for the games with the most mods", async () => {
  const sent = stub(answer);
  const res = await server().call("nexus_list_games");
  assert.match(sent[0]!.query, /games\(count: \$count, sort: \[\{ mods: \{ direction: DESC \} \}\]\)/);
  assert.equal(sent[0]!.variables.count, 50);
  assert.match(res.content[0]!.text, /"domain": "skyrimspecialedition"/);
});

test("nexus_get_game looks the game up by domain name, and says when there is none", async () => {
  let sent = stub(answer);
  const res = await server().call("nexus_get_game", { game_domain: "skyrimspecialedition" });
  assert.match(sent[0]!.query, /game\(domainName: \$domain\)/);
  assert.equal(sent[0]!.variables.domain, "skyrimspecialedition");
  assert.match(res.content[0]!.text, /"url": "https:\/\/www.nexusmods.com\/skyrimspecialedition"/);

  sent = stub(() => ({ data: { game: null } }));
  await assert.rejects(
    () => server().call("nexus_get_game", { game_domain: "nosuchgame" }),
    (err: Error & { code?: string }) => err.code === "nexus_not_found" && /nosuchgame/.test(err.message)
  );
});

// ─── One mod ─────────────────────────────────────────────────────────────────

test("nexus_get_mod asks by game domain and mod id, and returns the mod with its page", async () => {
  const sent = stub(answer);
  const res = await server().call("nexus_get_mod", { game_domain: "skyrimspecialedition", mod_id: 1840 });
  assert.match(sent[0]!.query, /legacyModsByDomain\(ids: \$ids\)/);
  assert.deepEqual(sent[0]!.variables.ids, [{ gameDomain: "skyrimspecialedition", modId: 1840 }]);
  const out = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
  assert.equal(out.mod_id, 1840);
  assert.equal(out.name, "SkyUI");
  assert.equal(out.url, "https://www.nexusmods.com/skyrimspecialedition/mods/1840");
});

test("nexus_get_mod says an adult-flagged mod was withheld, and nothing of it reaches the answer", async () => {
  stub(() => ({ data: { legacyModsByDomain: { nodes: [mod(99, "Flagged", true)] } } }));
  const text = (await server().call("nexus_get_mod", { game_domain: "skyrimspecialedition", mod_id: 99 })).content[0]!.text;
  assert.match(text, /"filtered": true/);
  assert.doesNotMatch(text, /Flagged/);
});

test("nexus_get_mod says when Nexus returns no such mod", async () => {
  stub(() => ({ data: { legacyModsByDomain: { nodes: [] } } }));
  await assert.rejects(
    () => server().call("nexus_get_mod", { game_domain: "skyrimspecialedition", mod_id: 7 }),
    (err: Error & { code?: string }) => err.code === "nexus_not_found"
  );
});

test("a read fails closed when the schema has no adultContent field", async () => {
  stub(() => ({ errors: [{ message: "Cannot query field 'adultContent' on type 'Mod'." }] }));
  for (const name of ["nexus_get_mod", "nexus_latest_added", "nexus_updated", "nexus_md5_search"]) {
    await assert.rejects(
      () => server().call(name, ARGS[name]!),
      (err: Error & { code?: string }) => err.code === "nexus_adult_unverifiable" && /GQL_ADULT_FIELD/.test(err.message),
      name
    );
  }
});

test("an opted-in operator's queries don't ask for the flag, and flagged mods come through", async () => {
  process.env.NEXUS_ALLOW_ADULT_CONTENT = "true";
  const sent = stub(() => ({ data: { legacyModsByDomain: { nodes: [mod(99, "Flagged", true)] } } }));
  const text = (await server().call("nexus_get_mod", { game_domain: "skyrimspecialedition", mod_id: 99 })).content[0]!.text;
  assert.doesNotMatch(sent[0]!.query, /\badultContent\b/);
  assert.match(text, /Flagged/);
});

// ─── Lists ───────────────────────────────────────────────────────────────────

test("nexus_latest_added and nexus_latest_updated sort the game's mods by date, newest first", async () => {
  for (const [name, key] of [["nexus_latest_added", "createdAt"], ["nexus_latest_updated", "updatedAt"]] as const) {
    const sent = stub(answer);
    await server().call(name, { game_domain: "skyrimspecialedition" });
    assert.match(sent[0]!.query, new RegExp(`sort: \\[\\{ ${key}: \\{ direction: DESC \\} \\}\\]`), name);
    assert.deepEqual(sent[0]!.variables.filter, { gameDomainName: [{ value: "skyrimspecialedition", op: "EQUALS" }] }, name);
    assert.equal(sent[0]!.variables.count, 10, name);
  }
});

test("a list drops adult-flagged mods and keeps the rest", async () => {
  stub(() => ({ data: { mods: { totalCount: 2, nodes: [mod(1, "Clean", false), mod(2, "Flagged", true)] } } }));
  const text = (await server().call("nexus_latest_added", { game_domain: "skyrimspecialedition" })).content[0]!.text;
  assert.match(text, /Clean/);
  assert.doesNotMatch(text, /Flagged/);
});

test("nexus_updated asks for mods updated since the start of the window, as a unix timestamp in a string", async () => {
  const sent = stub(() => ({ data: { mods: { totalCount: 250, nodes: [mod(1, "Clean", false)] } } }));
  const before = Math.floor(Date.now() / 1000);
  const res = await server().call("nexus_updated", { game_domain: "skyrimspecialedition", period: "1d" });
  const filter = sent[0]!.variables.filter as { updatedAt: Array<{ value: string; op: string }> };
  assert.equal(filter.updatedAt[0]!.op, "GTE");
  assert.equal(typeof filter.updatedAt[0]!.value, "string");
  const since = Number(filter.updatedAt[0]!.value);
  assert.ok(Math.abs(before - 86_400 - since) <= 2, String(since));
  assert.match(res.content[0]!.text, /^250 mods updated in the last 1d for skyrimspecialedition; showing the newest 1:/);
});

// ─── MD5 ─────────────────────────────────────────────────────────────────────

const hit = (domain: string, m: Record<string, unknown>) => ({
  md5: "a".repeat(32),
  fileName: "file.7z",
  fileSize: "1024",
  modFile: { fileId: 5, name: "Main", version: "1.0", category: "MAIN", size: 1, date: 1700000000, mod: { ...m, game: { domainName: domain, name: domain } } },
});

test("nexus_md5_search looks the hash up in lower case and keeps only the named game's matches when asked", async () => {
  const sent = stub(() => ({ data: { fileHash: [hit("skyrimspecialedition", mod(1, "SkyUI", false)), hit("fallout4", mod(2, "Other", false))] } }));
  const res = await server().call("nexus_md5_search", { md5_hash: "A".repeat(32), game_domain: "skyrimspecialedition" });
  assert.equal(sent[0]!.variables.md5, "a".repeat(32));
  assert.match(res.content[0]!.text, /SkyUI/);
  assert.doesNotMatch(res.content[0]!.text, /Other/);
});

test("nexus_md5_search withholds an adult-flagged mod and says it did", async () => {
  stub(() => ({ data: { fileHash: [hit("skyrimspecialedition", mod(2, "Flagged", true))] } }));
  const text = (await server().call("nexus_md5_search", { md5_hash: "a".repeat(32) })).content[0]!.text;
  assert.match(text, /"filtered": true/);
  assert.doesNotMatch(text, /Flagged/);
});

test("nexus_md5_search says when Nexus knows no such file", async () => {
  stub(() => ({ data: { fileHash: [] } }));
  const text = (await server().call("nexus_md5_search", { md5_hash: "b".repeat(32) })).content[0]!.text;
  assert.match(text, /knows no file with MD5/);
});

// ─── What the answers say, from the first run against the live API ───────────

test("a list says how many adult-tagged mods it withheld, so a short list isn't taken for a short list", async () => {
  stub(() => ({ data: { mods: { totalCount: 2, nodes: [mod(1, "Clean", false), mod(2, "Flagged", true)] } } }));
  const text = (await server().call("nexus_latest_updated", { game_domain: "skyrimspecialedition" })).content[0]!.text;
  assert.match(text, /^1 adult-tagged mod was withheld\.\n\n\[/);
  assert.doesNotMatch(text, /Flagged/);
});

test("a list with nothing withheld is the plain list, as before", async () => {
  stub(() => ({ data: { mods: { totalCount: 1, nodes: [mod(1, "Clean", false)] } } }));
  const text = (await server().call("nexus_latest_added", { game_domain: "skyrimspecialedition" })).content[0]!.text;
  assert.ok(text.startsWith("["), text.slice(0, 40));
});

test("nexus_updated says how many of the newest were withheld and how many are shown", async () => {
  stub(() => ({ data: { mods: { totalCount: 250, nodes: [mod(1, "A", false), mod(2, "Flagged", true), mod(3, "B", false)] } } }));
  const text = (await server().call("nexus_updated", { game_domain: "skyrimspecialedition", period: "1d" })).content[0]!.text;
  assert.match(text, /^250 mods updated in the last 1d for skyrimspecialedition; of the newest 3, 1 is adult-tagged and withheld, so 2 are shown:/);
});

test("nexus_search says how many matches it withheld", async () => {
  stub(() => ({ data: { mods: { totalCount: 3, nodes: [mod(1, "A", false), mod(2, "Flagged", true), mod(3, "Also flagged", true)] } } }));
  const text = (await server().call("nexus_search", { query: "sky" })).content[0]!.text;
  assert.match(text, /showing 1 \(2 more are adult-tagged and withheld\):/);
  assert.doesNotMatch(text, /Flagged|flagged"/);
});

test("nexus_get_game says plainly when Nexus answers an unknown domain with its 'Game not found' error", async () => {
  stub(() => ({ errors: [{ message: "Game not found. Could not find Game game_domain: nosuchgame" }] }));
  await assert.rejects(
    () => server().call("nexus_get_game", { game_domain: "nosuchgame" }),
    (err: Error & { code?: string }) => err.code === "nexus_not_found" && /no game with the domain name "nosuchgame"/.test(err.message)
  );
});

test("any other GraphQL error from nexus_get_game is passed on as it is", async () => {
  stub(() => ({ errors: [{ message: "Rate limit exceeded" }] }));
  await assert.rejects(
    () => server().call("nexus_get_game", { game_domain: "skyrimspecialedition" }),
    (err: Error & { code?: string }) => err.code === "nexus_graphql_error"
  );
});
