import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── LOOT's masterlist, as the known-conflict check reads it ─────────────────
// mw_check_known_conflicts, and mw_diagnose_crash with a gameId, fetch LOOT's
// masterlist from GitHub. Here fetch is stubbed. Skyrim SE's answer is a slice of
// the real v0.29 list (fixtures/loot-skyrimse-v0.29.yaml, CC0, with its source
// named at the top); Fallout 4's is made up for the cases the real list has no
// example of. Every other repo answers 404, as GitHub does for a list that
// doesn't exist.

// The branch is read from LOOT_BRANCH when the module loads, so it's cleared first.
delete process.env["LOOT_BRANCH"];
const { checkKnownConflicts } = await import("../src/conflicts/index.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const SKYRIM = readFileSync(resolve(HERE, "fixtures", "loot-skyrimse-v0.29.yaml"), "utf8");
const FALLOUT = [
  "plugins:",
  "  - name: 'Example.esm'",
  "    inc: [ 'Other.esp' ]",
].join("\n");

const MB = 1024 * 1024;
/** A YAML comment line of `n` bytes, newline included. */
const commentLine = (n: number): Uint8Array => new TextEncoder().encode(n < 2 ? "\n" : "#" + "x".repeat(n - 2) + "\n");
const PAD = commentLine(65_536);

/** A connection that never finishes on its own: it ends only when the fetch's signal does. */
function stalled(signal: AbortSignal | null | undefined, sendsHeaders: boolean): Promise<Response> {
  if (!signal) return Promise.reject(new Error("no signal: this fetch would wait for ever"));
  if (!sendsHeaders) return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("plugins:\n"));
      signal.addEventListener("abort", () => controller.error(signal.reason));
    },
  });
  return Promise.resolve(new Response(body, { status: 200 }));
}

/** Fallout 4's list naming a conflict, then comment lines up to `total` bytes, counting what was sent. */
const padded = { sent: 0, cancelled: false };
function paddedList(total: number): Response {
  const head = new TextEncoder().encode(FALLOUT + "\n");
  padded.sent = 0;
  padded.cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const left = total - padded.sent;
      if (left <= 0) return controller.close();
      const chunk = padded.sent === 0 ? head : left < PAD.byteLength ? commentLine(left) : PAD;
      controller.enqueue(chunk);
      padded.sent += chunk.byteLength;
    },
    cancel() {
      padded.cancelled = true;
    },
  });
  return new Response(body, { status: 200 });
}

const requested: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const url = String(input);
  requested.push(url);
  if (url.includes("/loot/skyrimse/")) return new Response(SKYRIM, { status: 200 });
  if (url.includes("/loot/fallout4/")) return new Response(FALLOUT, { status: 200 });
  if (url.includes("/loot/falloutnv/")) return stalled(init?.signal, false);
  if (url.includes("/loot/oblivion/")) return stalled(init?.signal, true);
  if (url.includes("/loot/fallout3/")) return paddedList(8 * MB);
  if (url.includes("/loot/starfield/")) return paddedList(16 * MB);
  return new Response("404: Not Found", { status: 404 });
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

/** The pairs a check found, as [modA, modB, severity]. */
async function pairs(gameId: string, modIds: string[]): Promise<string[][]> {
  const r = await checkKnownConflicts({ gameId, modIds });
  assert.equal(r.sources.loot.available, true, `${gameId}: ${r.sources.loot.reason ?? ""}`);
  return r.conflicts.map((c) => [c.modA, c.modB, c.severity]);
}

// ─── Which list is fetched ───────────────────────────────────────────────────

test("the masterlist comes from v0.29, the branch LOOT itself reads by default", async () => {
  await pairs("skyrimspecialedition", ["NAT.esp", "Vivid WeathersSE.esp"]);
  assert.ok(
    requested.includes("https://raw.githubusercontent.com/loot/skyrimse/v0.29/masterlist.yaml"),
    requested.join("\n")
  );
  assert.ok(requested.every((url) => url.includes("/v0.29/")), requested.join("\n"));
});

test("Skyrim VR reads Skyrim SE's masterlist and Fallout 4 VR reads Fallout 4's, as LOOT does", async () => {
  assert.deepEqual(await pairs("skyrimvr", ["NAT.esp", "Vivid WeathersSE.esp"]), [
    ["NAT.esp", "Vivid WeathersSE.esp", "incompatible"],
  ]);
  assert.deepEqual(await pairs("fallout4vr", ["Example.esm", "Other.esp"]), [
    ["Example.esm", "Other.esp", "incompatible"],
  ]);
  assert.deepEqual(
    requested.filter((url) => /\/loot\/(skyrimvr|fallout4vr)\//.test(url)),
    [],
    "there is no VR repo on a current branch"
  );
});

// ─── The fetch's limits ──────────────────────────────────────────────────────

const FALLBACK = " Conflict detection falls back to community data only.";

test("a fetch that stalls gives up after 30 seconds, before the answer starts or in the middle of it", async (t) => {
  const asked: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  // The fetch asks for its 30 seconds; the test waits 10 milliseconds instead.
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    asked.push(ms);
    return timeout(10);
  });
  const reason = "LOOT masterlist fetch timed out after 30 seconds." + FALLBACK;
  for (const gameId of ["falloutnv", "oblivion"]) {
    const r = await checkKnownConflicts({ gameId, modIds: ["Example.esm", "Other.esp"] });
    assert.deepEqual(r.conflicts, [], gameId);
    assert.deepEqual(r.sources.loot, { available: false, reason }, gameId);
    assert.deepEqual(r.warnings, [reason], gameId);
  }
  assert.deepEqual(asked, [30_000, 30_000]);
});

test("a masterlist over 8 MB is left unread, never parsed in part; one of 8 MB is read", async () => {
  const over = await checkKnownConflicts({ gameId: "starfield", modIds: ["Example.esm", "Other.esp"] });
  assert.deepEqual(over.conflicts, [], "the conflict at the top of the list isn't used");
  assert.deepEqual(over.sources.loot, {
    available: false,
    reason: "LOOT masterlist was over 8 MB, so it wasn't read." + FALLBACK,
  });
  assert.equal(padded.cancelled, true, "the rest of the body was cancelled");
  assert.ok(padded.sent <= 8 * MB + 2 * PAD.byteLength, `${padded.sent} bytes were sent before it stopped`);

  assert.deepEqual(await pairs("fallout3", ["Example.esm", "Other.esp"]), [["Example.esm", "Other.esp", "incompatible"]]);
  assert.equal(padded.sent, 8 * MB);
  assert.equal(padded.cancelled, false);
});
