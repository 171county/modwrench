// A real-browser check of the built website, run by hand: CI has no browser. It needs Playwright and its Chromium,
// which this repo doesn't install:
//
//   npm run site:build
//   NODE_PATH="$(npm root -g)" node site/test/browser-check.mjs [folder for screenshots]
//
// It serves site/dist with the headers in its _headers file (the CSP above all), reads a crash log and compares crew
// lists in the page, and fails if the page makes any request but for its own files, if anything breaks the CSP, if a
// hostile log or crew list turns into markup, or if the page scrolls sideways at 390 or 1280 pixels, light or dark.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(SITE, "dist");
const FIXTURES = join(SITE, "..", "packages", "workbench", "test", "fixtures");
const shots = process.argv[2];

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
    return require(join(root, "playwright"));
  }
}

// ─── A static server that sends the _headers file's headers, as Cloudflare does ──

function headersFile() {
  const out = {};
  let inAll = false;
  for (const line of readFileSync(join(DIST, "_headers"), "utf8").split(/\r?\n/)) {
    if (/^\S/.test(line)) inAll = line.trim() === "/*";
    else if (inAll && line.includes(":")) {
      const at = line.indexOf(":");
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return out;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" };
const served = [];

function serve() {
  const headers = headersFile();
  assert.match(headers["Content-Security-Policy"] ?? "", /default-src 'none'/);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    served.push(path);
    const file = normalize(join(DIST, path === "/" ? "index.html" : path));
    if (!file.startsWith(DIST) || path.startsWith("/_headers") || !existsSync(file) || !TYPES[extname(file)]) {
      res.writeHead(404, headers).end();
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] }).end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ─── The checks ──────────────────────────────────────────────────────────────

const CRASH_LOG = join(FIXTURES, "crash-sse-real-format.log");
const HOSTILE = ["<img/src/onerror=alert(1)>", "<script>alert(1)</script>"];
const CREW_A = "ModWrench crew list 1 · Lethal Company · 3 mods\nBepInEx-BepInExPack 5.4.2100\nx753-More_Suits 1.4.3\nnotnotnotswipez-MoreCompany 1.9.1";
const CREW_B = "ModWrench crew list 1 · Lethal Company · 2 mods\nBepInEx-BepInExPack 5.4.2100\nx753-More_Suits 1.4.2";

async function newPage(browser, origin, width, colorScheme, seen) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on("request", (r) => seen.requests.push(r.url()));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") seen.console.push(m.text());
  });
  page.on("pageerror", (e) => seen.errors.push(String(e)));
  page.on("dialog", (d) => {
    seen.dialogs.push(d.message());
    d.dismiss();
  });
  const response = await page.goto(`${origin}/`);
  assert.match(response.headers()["content-security-policy"], /script-src 'self'/);
  return { context, page };
}

async function noSideScroll(page, label) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.ok(scroll <= client, `${label}: the page is ${scroll}px wide in a ${client}px window`);
}

async function main() {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const seen = { requests: [], console: [], errors: [], dialogs: [], violations: [] };
  const results = [];
  try {
    for (const colorScheme of ["dark", "light"]) {
      for (const width of [390, 1280]) {
        const label = `${width}px ${colorScheme}`;
        const { context, page } = await newPage(browser, origin, width, colorScheme, seen);
        await noSideScroll(page, `${label}, before`);

        // A crash log, chosen as a file: FileReader, then Crash Whisperer's pipeline.
        await page.setInputFiles("#log-file", CRASH_LOG);
        await page.waitForSelector("#log-result:not([hidden]) ol.leads > li");
        const leads = await page.$$eval("#log-result ol.leads > li .lead-name", (els) => els.map((e) => e.textContent));
        assert.equal(leads[0], "CloakAndDaggerFix.dll", label);
        assert.equal(await page.locator("#log-result details.post").count(), 4, label);
        const post = await page.inputValue("#log-result details.post textarea");
        assert.match(post, /CloakAndDaggerFix\.dll \(strong lead\)/);
        await page.click("#log-result details.post .row button");
        await page.waitForSelector("#log-result .copied:has-text('Copied.')");
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), post, `${label}: the copied post`);
        const headline = await page.textContent("#log-result .headline");
        await noSideScroll(page, `${label}, a log read`);
        if (shots) await page.locator("#try").screenshot({ path: join(shots, `try-${width}-${colorScheme}.png`) });

        // Crew Check on two pasted lists.
        await page.fill("#crew-list-1", CREW_A);
        await page.fill("#crew-name-2", "Bo");
        await page.fill("#crew-list-2", CREW_B);
        await page.click("#crew-compare");
        await page.waitForSelector("#crew-result:not([hidden])");
        const crew = await page.textContent("#crew-result");
        assert.match(crew, /1 mod isn't on everyone's list, and 1 is on different versions\. 1 match\./);
        assert.match(crew, /Crewmate 1 has it; Bo doesn't\./);
        assert.match(crew, /Crewmate 1: 1\.4\.3, Bo: 1\.4\.2/);
        await noSideScroll(page, `${label}, crews compared`);

        results.push(`${label}: lead "${leads[0]}", ${leads.length} leads; "${headline.slice(0, 80)}…"`);
        seen.violations.push(...(await page.evaluate(() => window.__violations)));
        await context.close();
      }
    }

    // The sample log button, for a visitor with no log of their own.
    {
      const { context, page } = await newPage(browser, origin, 390, "dark", seen);
      await page.click("#log-sample");
      await page.waitForSelector("#log-result:not([hidden]) ol.leads > li");
      assert.equal(await page.textContent("#log-result ol.leads > li .lead-name"), "CloakAndDaggerFix.dll", "the sample's lead");
      seen.violations.push(...(await page.evaluate(() => window.__violations)));
      await context.close();
    }

    // A hostile log and a hostile crewmate's name stay text.
    const { context, page } = await newPage(browser, origin, 1280, "dark", seen);
    for (const payload of HOSTILE) {
      await page.fill("#log-text", readFileSync(join(FIXTURES, "crash-sse.log"), "utf8").replaceAll("JKsWhiterunOutskirts.dll", `${payload}.dll`));
      await page.click("#log-read");
      await page.waitForFunction((p) => document.querySelector("#log-result")?.textContent?.includes(p), payload);
      assert.equal(await page.locator("#log-result :is(img, script, svg, [onerror], [onload])").count(), 0);
    }
    await page.fill("#crew-name-1", "<b onmouseover=alert(1)>Cy</b>");
    await page.fill("#crew-list-1", CREW_A);
    await page.fill("#crew-list-2", CREW_B);
    await page.click("#crew-compare");
    await page.waitForFunction(() => document.querySelector("#crew-result")?.textContent?.includes("<b onmouseover=alert(1)>Cy</b>"));
    assert.equal(await page.locator("#crew-result [onmouseover]").count(), 0);
    seen.violations.push(...(await page.evaluate(() => window.__violations)));

    // Everything so far: only the page's own files, no CSP violation, no error, nothing run from a log.
    const foreign = seen.requests.filter((u) => !u.startsWith(`${origin}/`));
    assert.deepEqual(foreign, [], "requests to anywhere but the site");
    assert.deepEqual(seen.violations, [], "CSP violations");
    assert.deepEqual(seen.errors, [], "page errors");
    assert.deepEqual(seen.console, [], "console errors and warnings");
    assert.deepEqual(seen.dialogs, [], "a hostile name ran as script");
    const paths = [...new Set(seen.requests.map((u) => new URL(u).pathname))].sort();

    // And the CSP itself: a request the page's code tried to make would be refused before it left.
    const before = seen.requests.length;
    const tried = await page.evaluate(() => fetch("https://example.com/").then(() => "sent", () => "blocked"));
    const blocked = await page.evaluate(() => window.__violations.slice(-1)[0]);
    assert.equal(tried, "blocked");
    assert.match(blocked ?? "", /^connect-src https:\/\/example\.com/);
    assert.equal(seen.requests.slice(before).filter((u) => u.includes("example.com")).length, 0, "the blocked request left the page");
    await context.close();

    console.log(results.join("\n"));
    console.log(`Requests: ${seen.requests.length}, all to ${origin}: ${paths.join(", ")}`);
    console.log("CSP violations from the page: 0. Console errors: 0. Dialogs from hostile input: 0.");
    console.log(`A fetch to https://example.com from the page: ${tried} (${blocked}).`);
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
