import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAdult } from "@modwrench/core";

// ─── nexus_file_preview leaves the shared request path ───────────────────────
// Every other Nexus tool goes through nexusRequest(), which ends in
// applyAdultPolicy(). nexus_file_preview cannot: the preview lives on a CDN URL
// that Nexus names at runtime in content_preview_link, so the tool does its own
// bare fetch() and serialized the response straight into the tool result. The
// policy was never applied to it — the one Nexus content fetch in the package
// with no filter attached.
//
// Filtering the CDN response would not have fixed it either, and that is the
// part worth pinning down. The preview is a folder/filename tree; it carries no
// adult flag, and isAdult() reads a flag off the record. On a payload with no
// flag the filter is structurally a no-op, so "just call applyAdultPolicy on
// the tree" would look like a fix and change nothing.
//
// The flag lives on the MOD record. So the gate has to be a separate, earlier
// fetch of the mod, which nexusRequest() does filter. These guards hold that
// shape in place.

const REGISTER = new URL("../src/register.ts", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1"
);

function filePreviewHandler(src: string): string {
  const start = src.indexOf('"nexus_file_preview"');
  assert.ok(start > -1, "nexus_file_preview not found — this guard would pass vacuously");
  const next = src.indexOf("server.tool(", start);
  return src.slice(start, next === -1 ? undefined : next);
}

test("the adult filter is a no-op on a preview tree — which is why the gate is elsewhere", () => {
  // This is the fact the whole fix rests on. A content-preview payload looks
  // like this: nested nodes with names and types, no adult flag anywhere.
  const previewTree = {
    children: [
      { name: "Data", type: "directory", children: [{ name: "Some.esp", type: "file" }] },
      { name: "readme.txt", type: "file" },
    ],
  };

  assert.equal(
    isAdult(previewTree),
    false,
    "isAdult() returned true for a flagless tree — if this ever changes, the gate " +
      "in nexus_file_preview could be simplified"
  );
  assert.equal(
    isAdult(previewTree.children[0]),
    false,
    "a preview node carries no adult flag, so filtering the tree cannot withhold it"
  );
});

test("nexus_file_preview gates on the mod record before following the CDN link", () => {
  const src = readFileSync(REGISTER, "utf8");
  assert.ok(src.length > 0, "register.ts was not read");
  const handler = filePreviewHandler(src);

  const gateAt = handler.indexOf("adultContentAllowed()");
  const fetchAt = handler.indexOf("content_preview_link");

  assert.ok(
    gateAt > -1,
    "nexus_file_preview no longer consults adultContentAllowed() — an adult-tagged " +
      "mod's archive listing can come back unlabelled again"
  );
  assert.ok(
    gateAt < fetchAt,
    "the adult gate runs after the preview link is read — it must run before, or " +
      "the CDN payload is fetched regardless"
  );

  assert.match(
    handler,
    /mods\/\$\{mod_id\}\.json/,
    "the gate no longer fetches the MOD record — the file record carries no adult " +
      "flag, so gating on it would be a no-op"
  );
});

test("the gate refuses rather than returning an unlabelled listing", () => {
  const handler = filePreviewHandler(readFileSync(REGISTER, "utf8"));

  assert.match(
    handler,
    /nexus_adult_filtered/,
    "the gate no longer throws — refusing is the point; returning a filtered-but-" +
      "unlabelled tree is the behavior this replaced"
  );
  assert.match(
    handler,
    /NEXUS_ALLOW_ADULT_CONTENT/,
    "the refusal no longer names the opt-in variable — a user who deliberately " +
      "wants adult content has no way to discover how to enable it"
  );
});
