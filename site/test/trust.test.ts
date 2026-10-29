import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trustPage } from "../build.mjs";

// The website's trust page is TRUST.md, made into HTML by site/build.mjs on every build.

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(join(SITE, "public", "index.html"), "utf8");
const page = trustPage(readFileSync(join(SITE, "..", "TRUST.md"), "utf8"), home);

test("every #link on the trust page has its heading, as on GitHub", () => {
  const ids = new Set([...page.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const targets = [...page.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length > 10);
  assert.deepEqual(targets.filter((t) => !ids.has(t)), []);
  assert.ok(ids.has("the-limits-of-the-adult-filter"));
  assert.ok(ids.has("feedback-what-mw-critique-reads-and-sends"));
});

test("the trust page runs no script and loads only the site's own files", () => {
  assert.doesNotMatch(page, /<script/i);
  const fetched = [...page.matchAll(/<(?:img|link)\b[^>]*\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(fetched.includes("/media/logo.png"));
  assert.deepEqual(fetched.filter((u) => !u.startsWith("/")), []);
});

test("the trust page has the home page's header, pointing back at the home page", () => {
  assert.match(page, /<title>What ModWrench does, and what it won't · ModWrench<\/title>/);
  assert.match(page, /<img src="\/media\/logo\.png"/);
  assert.match(page, /href="\/#install">Install</);
  assert.doesNotMatch(page, /href="#(?:what|try|promises|install)"/);
});

test("the home page's trust links stay on the site", () => {
  assert.equal(home.match(/href="\/trust"/g)?.length, 3);
  assert.doesNotMatch(home, /blob\/main\/TRUST\.md/);
});
