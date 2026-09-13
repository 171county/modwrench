import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerNexusTools } from "../src/register.js";
import type { Credential } from "@modwrench/core";

// ─── nexus_search and the adult filter ───────────────────────────────────────
// This tool was the one hole in the adult-content filter, and the hole was
// invisible: applyAdultPolicy was wired to the GraphQL path correctly, and the
// filter itself worked. But the filter decides by reading a flag off a record,
// and the search query never asked Nexus for that flag. Nothing was flagged, so
// nothing was filtered, on the only Nexus tool with real keyword search.
//
// The lesson worth encoding: a filter that reads a field is only as good as the
// query that requests it. So these tests assert the request, not just the
// response — a future change to the selection set that drops the field is the
// regression to catch, and it would leave every response-level test passing.

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
}>;

class MockServer {
  tools = new Map<string, ToolHandler>();
  tool(name: string, _d: string, _s: unknown, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }
}

const CRED: Credential = { source: "apikey", apiKey: "test-api-key-12345" };
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

/** Stub fetch, capturing the GraphQL query text of every request. */
function stub(respond: (query: string) => unknown): { queries: string[] } {
  const queries: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
    const q = body.query ?? "";
    queries.push(q);
    return new Response(JSON.stringify(respond(q)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { queries };
}

function searchTool(): ToolHandler {
  const server = new MockServer();
  registerNexusTools(server as unknown as never, CRED);
  const handler = server.tools.get("nexus_search");
  assert.ok(handler, "nexus_search was not registered");
  return handler;
}

function node(modId: number, name: string, adult?: boolean) {
  const n: Record<string, unknown> = {
    modId,
    name,
    summary: "",
    author: "someone",
    uploader: { name: "someone" },
    game: { domainName: "skyrimspecialedition", name: "Skyrim SE" },
    downloads: 1,
    endorsements: 1,
  };
  if (adult !== undefined) n.adult = adult;
  return n;
}

test("the search query asks Nexus for the adult flag when filtering is active", async () => {
  const { queries } = stub(() => ({
    data: { mods: { totalCount: 1, nodes: [node(1, "Clean")] } },
  }));
  await searchTool()({ query: "lighting" });

  assert.equal(queries.length, 1);
  assert.match(
    queries[0],
    /\badult\b/,
    "the selection set no longer requests the adult flag — the filter has nothing to read and passes everything"
  );
});

test("adult-flagged results are dropped from search output", async () => {
  stub(() => ({
    data: {
      mods: {
        totalCount: 3,
        nodes: [node(1, "Clean"), node(2, "Flagged", true), node(3, "Also clean")],
      },
    },
  }));
  const res = await searchTool()({ query: "lighting" });
  const text = res.content[0].text;

  assert.match(text, /Clean/);
  assert.match(text, /Also clean/);
  assert.doesNotMatch(text, /Flagged/, "an adult-tagged mod reached the output");
});

test("search fails closed when the schema has no such field", async () => {
  stub(() => ({
    errors: [{ message: "Cannot query field 'adult' on type 'Mod'." }],
  }));

  await assert.rejects(
    () => searchTool()({ query: "lighting" }),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, "nexus_adult_unverifiable");
      assert.match(err.message, /GQL_ADULT_FIELD/);
      return true;
    },
    "unverifiable results must not be returned — Nexus puts the filtering duty on us"
  );
});

test("an unrelated GraphQL error is not swallowed as an adult-field problem", async () => {
  stub(() => ({ errors: [{ message: "Rate limit exceeded" }] }));

  await assert.rejects(
    () => searchTool()({ query: "lighting" }),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, "nexus_graphql_error");
      return true;
    }
  );
});

test("an opted-in operator gets results, and the query does not ask for the flag", async () => {
  process.env.NEXUS_ALLOW_ADULT_CONTENT = "true";
  const { queries } = stub(() => ({
    data: { mods: { totalCount: 1, nodes: [node(2, "Flagged", true)] } },
  }));

  const res = await searchTool()({ query: "lighting" });
  assert.doesNotMatch(
    queries[0],
    /\n\s+adult\n/,
    "no reason to request a flag that will not be used"
  );
  assert.match(res.content[0].text, /Flagged/, "opt-in was not honoured");
});
