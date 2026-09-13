import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterAdultContent } from "@modwrench/core";

// ─── The adult-content filter, enforced on this package's Nexus path ─────────
// Nexus's Terms of Service put the filtering duty on API consumers: "Third
// parties who use our APIs are responsible for filtering the content returned."
// TRUST.md repeats that as a promise to the user.
//
// The promise was false here. @modwrench/workbench does not use the Nexus
// package — it builds its own Nexus REST client in src/metadata/clients.ts for
// mw_query_mod_metadata, and that client returned responses raw. A mod the
// Nexus package's own tools would have withheld came back in full through a
// direct id lookup. The filter was never wired to the second door.
//
// So the guard is written against the thing that actually broke: not "does the
// filter work" (the Nexus package's tests already cover that), but "is this
// package's Nexus client still routed through it". A future refactor that
// rebuilds this client is the exact scenario that caused the gap, and it is the
// scenario this test is here to fail.

const CLIENTS = new URL("../src/metadata/clients.ts", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1"
);

test("workbench's Nexus client routes responses through the adult policy", () => {
  const src = readFileSync(CLIENTS, "utf8");
  assert.ok(src.length > 0, "clients.ts was not read — the guard would pass vacuously");

  assert.match(
    src,
    /applyAdultPolicy/,
    "clients.ts no longer references applyAdultPolicy — the Nexus path is unfiltered again"
  );

  // The import alone is not enough; it has to be applied to what request() returns.
  const nexusRequest = src.slice(src.indexOf("workbench.nexus.request"));
  const body = nexusRequest.slice(0, nexusRequest.indexOf("};"));
  assert.match(
    body,
    /applyAdultPolicy\(\s*await\s+http\.request/,
    "the Nexus client returns an unfiltered response"
  );
});

test("the shared filter redacts a flagged record rather than passing it through", () => {
  const { value, removed } = filterAdultContent({
    mod_id: 1,
    name: "Flagged",
    contains_adult_content: true,
  });
  assert.equal(removed, 1);
  assert.equal((value as { filtered?: boolean }).filtered, true);
  assert.match(String((value as { reason?: string }).reason), /withheld/);
});

test("the shared filter drops flagged entries from a list but keeps the rest", () => {
  const { value, removed } = filterAdultContent({
    mods: [
      { mod_id: 1, name: "Clean" },
      { mod_id: 2, name: "Flagged", contains_adult_content: true },
      { mod_id: 3, name: "Also clean" },
    ],
  });
  assert.equal(removed, 1);
  assert.deepEqual(
    (value as { mods: Array<{ name: string }> }).mods.map((m) => m.name),
    ["Clean", "Also clean"]
  );
});

// The honest limit, asserted so nobody mistakes the filter for stronger than it
// is: it reads a flag off the record. A response that never carried the flag
// cannot be judged and passes through. That is why nexus_search, whose GraphQL
// selection set does not request an adult field, is documented as an exception
// rather than quietly assumed to be covered.
test("a record with no adult field is not treated as filtered", () => {
  const { value, removed } = filterAdultContent({ mod_id: 1, name: "Unknown status" });
  assert.equal(removed, 0);
  assert.equal((value as { name: string }).name, "Unknown status");
});
