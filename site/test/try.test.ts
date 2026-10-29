import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isIPv6 as nodeIsIPv6 } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import { bundleOptions } from "../build.mjs";
import { checkCrew, MAX_FILE_BYTES, MAX_PASTE, readCrashLog, VENUES } from "../src/run.js";
import * as fs from "../src/stubs/fs.js";
import * as path from "../src/stubs/path.js";
import * as os from "../src/stubs/os.js";
import { createHash } from "../src/stubs/crypto.js";
import { isIPv6 } from "../src/stubs/net.js";
import { CREW_LIST_HEADER, CREW_MAX_CHARS } from "../../packages/workbench/src/crew/index.js";

// The website's Try section runs ModWrench's own Crash Whisperer and Crew Check in the visitor's browser. These tests
// run what the page runs: src/run.ts under Node, and the browser bundle of it in a context with no Node at all, where
// every stub that would touch a disk throws.

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(SITE, "..", "packages", "workbench", "test", "fixtures");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const LOGS: Array<[file: string, format: string]> = [
  ["crash-sse.log", "crashlogger-sse"],
  ["crash-sse-real-format.log", "crashlogger-sse"],
  ["crash-sse-v1-20-quoted.log", "crashlogger-sse"],
  ["crash-buffout4.log", "buffout4"],
  ["crash-netscriptframework.log", "netscriptframework"],
  ["crash-netscriptframework-real-format.log", "netscriptframework"],
  ["LogOutput.log", "bepinex"],
  ["LogOutput-real-format.log", "bepinex"],
];

type Run = { readCrashLog: typeof readCrashLog; checkCrew: typeof checkCrew };

let built: Promise<Run> | undefined;

/** The page's code as the browser gets it, run where there is no process, require, Buffer or disk: only a clock. */
function bundled(): Promise<Run> {
  built ??= build({ ...bundleOptions(join(SITE, "src", "run.ts")), format: "iife", globalName: "SiteRun", write: false }).then(
    (out) => vm.runInNewContext(`${out.outputFiles[0]!.text}\nSiteRun`, { performance }) as Run
  );
  return built;
}

// ─── The stubs ───────────────────────────────────────────────────────────────

test("every stub that would read the disk, name a file or hash throws, and the machine's names come back empty", () => {
  for (const [name, fn] of Object.entries(fs)) assert.throws(() => (fn as () => unknown)(), /not available on the website/, `fs.${name}`);
  for (const [name, fn] of Object.entries(path)) {
    if (name === "win32") assert.throws(() => path.win32.resolve(), /not available/);
    else assert.throws(() => (fn as () => unknown)(), /not available on the website/, `path.${name}`);
  }
  assert.throws(() => createHash(), /not available on the website/);
  assert.equal(os.homedir(), "");
  assert.equal(os.hostname(), "");
  assert.equal(os.userInfo().username, "");
});

test("the browser's isIPv6 answers exactly as Node's does", () => {
  const samples = [
    "", "::", "::1", "1::", "fe80::1", "fe80::1%eth0", "fe80::1%", "2001:db8::8a2e:370:7334", "2001:0db8:0000:0000:0000:ff00:0042:8329",
    "::ffff:192.168.1.1", "::ffff:256.1.1.1", "1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7::", "1::2::3", "12345::", "g::1",
    "1.2.3.4", "::1.2.3.4", "1:2:3:4:5:6:1.2.3.4", "1:2:3:4:5:6:7:1.2.3.4", "abcd:ef01:2345:6789:abcd:ef01:2345:6789", "ABCD::", ":1", "1:",
    "12:34:56", "00:1A:2B:3C:4D:5E", "10:30:00", "::%1", "fe80::%en0.1:x", "2001:db8::/32", " ::1",
  ];
  // And a few thousand made from the characters an address is written with, some of them in a log's usual shapes.
  let seed = 7;
  const next = (n: number): number => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const alphabet = "0123456789abcdefABCDEFg:.%-";
  for (let i = 0; i < 5000; i++) {
    let s = "";
    for (let j = next(40); j > 0; j--) s += alphabet[next(alphabet.length)];
    samples.push(s);
  }
  for (let i = 0; i < 2000; i++) {
    const groups = Array.from({ length: 1 + next(8) }, () => (next(5) === 0 ? "" : next(65536).toString(16)));
    samples.push(groups.join(":") + (next(6) === 0 ? `:${next(300)}.${next(300)}.${next(300)}.${next(300)}` : ""));
  }
  for (const s of samples) assert.equal(isIPv6(s), nodeIsIPv6(s), JSON.stringify(s));
});

// ─── Crash log reader ────────────────────────────────────────────────────────

test("the bundle the page runs reads every fixture log as ModWrench does, and never reaches Node, the disk or the network", async () => {
  const run = await bundled();
  for (const [file, format] of LOGS) {
    const text = fixture(file);
    const inBrowser = run.readCrashLog(text);
    const underNode = readCrashLog(text);
    assert.ok(inBrowser.ok, `${file}: ${inBrowser.ok ? "" : inBrowser.error}`);
    assert.equal(inBrowser.crash.format, format, file);
    assert.equal(inBrowser.crash.source, "pasted", file);
    assert.equal(inBrowser.install.checked, false, file);
    assert.equal(inBrowser.recent.examined, 0, file);
    assert.ok(inBrowser.leads.length > 0, `${file}: no leads`);
    for (const lead of inBrowser.leads) assert.ok(lead.evidence.length > 0 && ["strong", "possible", "faint"].includes(lead.strength), file);
    for (const venue of VENUES) {
      const packet = inBrowser.packets[venue];
      assert.ok(packet.title.length > 0 && packet.text.length > 200, `${file}: ${venue} packet`);
    }
    // The same result, value for value, as the code run under Node with its real modules.
    assert.deepEqual(JSON.parse(JSON.stringify(inBrowser)), JSON.parse(JSON.stringify(underNode)), file);
  }
});

test("a Crash Logger log: what happened, the strongest lead with its reasons, and a help post for each place", () => {
  const r = readCrashLog(fixture("crash-sse-real-format.log"));
  assert.ok(r.ok);
  assert.equal(r.crash.game.name, "Skyrim Special Edition");
  assert.equal(r.crash.exception?.type, "EXCEPTION_ACCESS_VIOLATION");
  assert.match(r.crash.exception?.plain ?? "", /memory it doesn't own/);
  assert.equal(r.leads[0]!.name, "CloakAndDaggerFix.dll");
  assert.equal(r.leads[0]!.strength, "strong");
  assert.ok(r.leads[0]!.evidence.some((e) => e.basis === "log"));
  assert.deepEqual(Object.keys(r.packets).sort(), [...VENUES].sort());
  assert.match(r.packets.forum.text, /CloakAndDaggerFix\.dll \(strong lead\)/);
  assert.ok(r.packets.discord.chars <= 2000);
});

test("folder paths in a pasted log are cleaned with no machine's names to go on", () => {
  const log = fixture("crash-sse.log").replace(
    "SYSTEM SPECS:",
    "Loaded from C:\\Users\\JaneQPlayer\\Documents\\My Games\\Skyrim Special Edition\\SKSE\\crash-2026.log\nUSERNAME=JaneQPlayer\nSYSTEM SPECS:"
  );
  const r = readCrashLog(log);
  assert.ok(r.ok);
  assert.ok(r.redaction.total >= 2);
  assert.doesNotMatch(JSON.stringify(r), /JaneQPlayer/);
});

test("a hostile log's names come back as plain text, and the help posts can't turn them into markup", async () => {
  const evil = ["<img/src/onerror=alert(1)>", "<script>alert(1)</script>"];
  const run = await bundled();
  for (const payload of evil) {
    const r = run.readCrashLog(fixture("crash-sse.log").replaceAll("JKsWhiterunOutskirts.dll", `${payload}.dll`));
    assert.ok(r.ok);
    // The page draws these with text nodes only (the bundle test below checks it has no way to write markup), so the
    // name is kept as the log wrote it, for the visitor to see.
    assert.ok(r.leads.some((l) => l.name === `${payload}.dll`));
    for (const venue of VENUES) assert.doesNotMatch(r.packets[venue].text, /<(?:img|script)/, venue);
  }
});

test(`a paste over ${MAX_PASTE.toLocaleString("en-US")} characters, Crash Whisperer's own cap, is refused before anything reads it`, () => {
  assert.equal(MAX_PASTE, 4_000_000);
  const r = readCrashLog(`${fixture("crash-sse.log")}${"x".repeat(MAX_PASTE)}`);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /4,000,000 characters/);
  // A file is refused unread only when no encoding could fit it in the cap.
  assert.ok(MAX_FILE_BYTES >= 3 * MAX_PASTE);
  assert.equal(readCrashLog("   \n").ok, false);
  const unknown = readCrashLog("just some words, not a crash log");
  assert.equal(unknown.ok, false);
});

// ─── Crew Check ──────────────────────────────────────────────────────────────

const header = (n: number): string => `${CREW_LIST_HEADER} · Lethal Company · ${n} mods`;

test("two pasted crew lists: who's missing which mod, and which mods are on different versions", () => {
  const r = checkCrew([
    { name: "Ana", list: [header(3), "BepInEx-BepInExPack 5.4.2100", "x753-More_Suits 1.4.3", "notnotnotswipez-MoreCompany 1.9.1"].join("\n") },
    { name: "Bo", list: ["```", header(2), "- BepInEx-BepInExPack 5.4.2100", "- x753-More_Suits 1.4.2", "```"].join("\n") },
  ]);
  assert.ok(r.ok);
  assert.equal(r.game, "Lethal Company");
  assert.deepEqual(r.players, ["Ana", "Bo"]);
  assert.deepEqual(r.missing, [{ id: "notnotnotswipez-MoreCompany", has: ["Ana"], lacks: ["Bo"] }]);
  assert.deepEqual(r.versions, [{ id: "x753-More_Suits", byPlayer: [["Ana", "1.4.3"], ["Bo", "1.4.2"]] }]);
  assert.equal(r.same, 1);
  assert.deepEqual(r.warnings, []);
});

test("three lists, one for another game, one with lines that aren't mods, and an empty box skipped", async () => {
  const run = await bundled();
  const lists = [
    { name: "Crewmate 1", list: [header(2), "BepInEx-BepInExPack 5.4.2100", "x753-More_Suits 1.4.3"].join("\n") },
    { name: "Crewmate 2", list: "" },
    { name: "Crewmate 3", list: [`${CREW_LIST_HEADER} · Valheim · 2 mods`, "BepInEx-BepInExPack 5.4.2100", "x753-More_Suits 1.4.3", "hello there"].join("\n") },
    { name: "<b onmouseover=alert(1)>Cy</b>", list: ["BepInEx-BepInExPack 5.4.2100", "x753-More_Suits 1.4.3"].join("\n") },
  ];
  // Copied out of the bundle's own realm, so its arrays compare as arrays here.
  const r = JSON.parse(JSON.stringify(run.checkCrew(lists))) as ReturnType<typeof checkCrew>;
  assert.ok(r.ok);
  assert.deepEqual(r, JSON.parse(JSON.stringify(checkCrew(lists))));
  assert.deepEqual(r.players, ["Crewmate 1", "Crewmate 3", "<b onmouseover=alert(1)>Cy</b>"]);
  assert.equal(r.same, 2);
  assert.deepEqual(r.warnings, ["Crewmate 3's list is for Valheim, not Lethal Company.", "Crewmate 3's list had 1 line that weren't a mod and a version, left unread."]);
});

test("Crew Check needs two lists, and refuses one longer than the tool reads", () => {
  assert.equal(checkCrew([{ list: header(0) }, { list: "  " }]).ok, false);
  const r = checkCrew([{ list: header(0) }, { list: "x".repeat(CREW_MAX_CHARS + 1) }]);
  assert.equal(r.ok, false);
});

// ─── The page ────────────────────────────────────────────────────────────────

test("the page's script has no way to send anything, store anything or write markup", async () => {
  const out = await build({ ...bundleOptions(join(SITE, "src", "try.ts")), format: "iife", write: false });
  const code = out.outputFiles[0]!.text;
  for (const word of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "Function(", "import("]) {
    assert.ok(!code.includes(word), `the bundle contains ${word}`);
  }
  assert.ok(code.length < 300_000, `the bundle is ${code.length} bytes`);
});

test("the sample log the page offers is bundled whole, and is the made-up one from the tests", async () => {
  const out = await build({ ...bundleOptions(join(SITE, "src", "try.ts")), format: "iife", write: false });
  const code = out.outputFiles[0]!.text;
  for (const line of fixture("crash-sse-real-format.log").split(/\r?\n/).filter((l) => /^(CRASH TIME|Skyrim SSE|CrashLoggerSSE) /.test(l))) {
    assert.ok(code.includes(line), `the bundle has the sample's line "${line}"`);
  }
  assert.ok(readFileSync(join(SITE, "public", "index.html"), "utf8").includes('id="log-sample"'));
});

test("the CSP forbids every request but the page's own script and images, and the page has no inline script", () => {
  const headers = readFileSync(join(SITE, "public", "_headers"), "utf8");
  const csp = /Content-Security-Policy: (.+)/.exec(headers)?.[1]?.trim();
  assert.equal(
    csp,
    "default-src 'none'; script-src 'self'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  assert.match(headers, /Referrer-Policy: no-referrer/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  const html = readFileSync(join(SITE, "public", "index.html"), "utf8");
  assert.deepEqual(html.match(/<script\b[^>]*>/g), ['<script src="/try.js" defer>']);
  assert.match(html, /<script src="\/try\.js" defer><\/script>/);
  assert.doesNotMatch(html, /\son[a-z]+=/i, "an inline event handler");
  for (const [, url] of html.matchAll(/\b(?:src|srcset)="([^"]+)"/g)) assert.match(url!, /^\//, `a resource from elsewhere: ${url}`);
  assert.doesNotMatch(html, /<link\b[^>]*rel="(?:stylesheet|preload|prefetch|preconnect|dns-prefetch|manifest)"/);
  const icons = [...html.matchAll(/<link\b[^>]*rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(icons.length, (html.match(/<link\b/g) ?? []).length, "a link that isn't a tab icon");
  for (const url of icons) assert.match(url, /^\/(?!\/)/, `an icon from elsewhere: ${url}`);
});

// ─── Install: pick your app ──────────────────────────────────────────────────

test("the one-click install links carry exactly ModWrench's command, in the form each app documents", () => {
  const html = readFileSync(join(SITE, "public", "index.html"), "utf8").replaceAll("&amp;", "&");
  const server = { command: "npx", args: ["-y", "@modwrench/cli"] };
  const vscode = /href="vscode:mcp\/install\?([^"]+)"/.exec(html);
  assert.ok(vscode, "the VS Code link");
  assert.deepEqual(JSON.parse(decodeURIComponent(vscode[1]!)), { name: "modwrench", type: "stdio", ...server });
  const cursor = /href="cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=modwrench&config=([A-Za-z0-9+/=]+)"/.exec(html);
  assert.ok(cursor, "the Cursor link");
  assert.deepEqual(JSON.parse(Buffer.from(cursor[1]!, "base64").toString("utf8")), server);
  for (const app of ["Claude Desktop", "Claude Code", "VS Code", "Cursor", "Codex", "Antigravity", "Devin"]) {
    assert.ok(html.includes(`<span class="app-name">${app}`), app);
  }
});
