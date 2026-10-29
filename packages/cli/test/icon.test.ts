import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ICONS } from "../src/icon.js";

// The server's icon is the website's logo, embedded, so it can't drift from it and showing it fetches nothing.

const LOGO = fileURLToPath(new URL("../../../site/public/media/logo.png", import.meta.url));

test("the server's icon is the website's 128 px logo, as an embedded PNG", () => {
  assert.equal(ICONS.length, 1);
  const [icon] = ICONS;
  assert.equal(icon!.mimeType, "image/png");
  assert.deepEqual(icon!.sizes, ["128x128"]);
  const prefix = "data:image/png;base64,";
  assert.ok(icon!.src.startsWith(prefix), "the icon must be a data: URI, never an address a client would fetch");
  const bytes = Buffer.from(icon!.src.slice(prefix.length), "base64");
  assert.deepEqual(bytes, readFileSync(LOGO), "the embedded icon no longer matches site/public/media/logo.png");
  assert.equal(bytes.readUInt32BE(16), 128, "width");
  assert.equal(bytes.readUInt32BE(20), 128, "height");
});
