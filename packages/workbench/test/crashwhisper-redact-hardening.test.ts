import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { redact, type RedactOptions } from "../src/crashwhisper/redact.js";

// What a hostile or just unlucky log can do to the redactor, family by family. Every example here is a form that
// once got through or was once mishandled, so the list can only grow. Credential-shaped test data is put together at
// run time from pieces, so no line of this file looks like a real key to a secret scanner.

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(resolve(HERE, "fixtures", name), "utf8");
const j = (...parts: string[]): string => parts.join("");

const ME: RedactOptions = { users: ["Jane Doe", "jane"], machines: ["JANES-PC"], ownNames: false };
const run = (text: string, options: RedactOptions = ME) => redact(text, options);

/** Redact, and prove none of `secrets` is left in what comes out (any case). Returns the output. */
function gone(input: string, secrets: string[], options: RedactOptions = ME): string {
  const out = run(input, options).text;
  for (const secret of secrets) {
    assert.ok(!out.toLowerCase().includes(secret.toLowerCase()), `${JSON.stringify(secret)} survived in ${JSON.stringify(out)} (from ${JSON.stringify(input)})`);
  }
  return out;
}

/** Redact, and prove nothing changed. */
function untouched(input: string, options: RedactOptions = ME): void {
  const { text, report } = run(input, options);
  assert.equal(text, input, `${JSON.stringify(input)} was changed`);
  assert.equal(report.total, 0);
}

const V = j("abcDEF", "123456abcDEF");

// ─── The quick checks that skip rules change nothing ─────────────────────────

/** A small deterministic random source, so a failure can be reproduced. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAGMENTS = [
  // words that label things
  "password", "Password", "passwd", "token", "secret", "api_key", "apikey", "NexusApiKey", "STEAM_TOKEN", "Authorization", "Bearer", "Cookie",
  "key", "pass", "pwd", "credential", "connection_string", "webhook", "user name", "User Name", "Computer Name", "hostname", "logged in as",
  "account id", "steamid", "serial", "address", "peer", "server", "version", "build", "at", "(at)", "dot", "password is", "set password",
  // values
  V, "hunter2pass", "0x06000123", "1234", "null", "REDACTED-SECRET", "REDACTED-USER", j("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"),
  j("AK", "IA", "ABCDEFGHIJKLMNOP"), j("sk", "-", "A1b2C3d4E5f6G7h8I9j0K1l2"), j("eyJhbGciOiJIUzI1NiJ9", ".eyJzdWIiOiJqYW5lIn0", ".c2lnbmF0dXJlMTIzNDU2"),
  j("AI", "zaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"), j("np", "m_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"), j("glp", "at-", "A1b2C3d4E5f6G7h8I9j0"), j("xo", "xb-", "1234567890-abcdefghij"),
  j("whs", "ec_", "A1b2C3d4E5f6G7h8I9j0"), j("https://hooks.slack.com/services/", "T0000/B0000/", "XXXXXXXXXXXXXXXXXXXXXXXX"),
  j("https://discord.com/api/v10/webhooks/123456789012345678/", "AbCdEfGhIjKlMnOpQrSt", "UvWxYz0123456789"), j("MTk4NjIyNDgzNDcxOTI1MjQ4", ".Cl2FMQ.", "ZnCjm1XVW7vRze4b7Cq4se7kKWs"),
  "0123456789abcdef0123456789abcdef", "abcdefabcdefabcdefabcdefabcdefab", "A".repeat(90), j("Qm9xRGVhZGJlZWY", "T3BlbkFQSUtleQ", "WmVsZGFOZXZlckdpdmVz", "QnJpbmdzVGhlVHJpZm9yY2U", "AbC123XyZ"), ";sid=abc123", "/login;sid=", "jane%2Fdoe",
  "serial: ABC123456", "Account ID: 52079950", "Machine ID: 0123abcd-4567", "WIN-ABCDEFGHIJK", "LAPTOP-RS7P8E2D", "desktop-4f9k2lq", `${"Ab1_".repeat(25)}`, j("123456789", ":AAEhBP0av28EXAMPLEtokenValue0123456789ab"),
  // places
  "C:\\Users\\Jane Doe\\Documents\\x.dll", "/home/jane/mods/x.dll", "\\\\NAS\\share\\dir\\file.esp", "//NAS/share/dir/file.esp", "file:///C:/Users/Jane%20Doe/x.log",
  "~/mods/x.dll", "$HOME/x", "%USERPROFILE%\\x.dll", "/Users/jdoe/Library/x.log", "C:%5CUsers%5Cjane%5Cx.dll", "/cygdrive/c/Users/jane/x.dll", "D:\\Games\\SecretLib\\a.dll",
  "https://example.com/home/page.html", "Data\\Textures\\x.dds", "/usr/lib/libfoo.so", "SKSE/Plugins/Thing.dll",
  // addresses and identities
  "203.0.113.45", "203.0.113.45:2456", "10.0.0.1", "127.0.0.1", "v1.5.97.0", "1.2.3.4", "2001:db8:85a3::8a2e:370:7334", "fe80::1c2d:3e4f:5a6b:7c8d%eth0", "::1", "[2001:db8::1]:8080",
  "aa:bb:cc:dd:ee:ff", "AA-BB-CC-DD-EE-FF", "jane.doe@example.com", "jane%40example.com", "jane at example dot com", "git@github.com:owner/repo.git", "icon@2x.png",
  "host.local", "me.duckdns.org", "DESKTOP-4F9K2LQ", "WIN-CHECKSUM1", "JANES-PC", "Jane Doe", "jane", "JANE", "J.Doe", "7656119" + "8012345678", "[U:1:52079950]", "STEAM_0:1:26039975",
  "S-1-5-21-1234567890-123456789-123456789-1001", "<@123456789012345678>", "user 123456789012345678",
  // ordinary log text
  "Loaded plugin", "CloakAndDaggerFix.dll+0003A41", "EXCEPTION_ACCESS_VIOLATION", "0x7FFAF1BF3A41", "MoreCompany.PlayerListener.UpdateCosmetics", "[Info   :   BepInEx]",
  "<apikey>", "</apikey>", "<add key=\"ApiKey\" value=\"", "\" />", "?api_key=", "&token=", "--password", "-Password", "Cookie: a=1; b=2", "SetPassword(\"", "\")",
];
const SEPARATORS = [" ", " ", " ", "", "=", ": ", " = ", "\t", "/", "\\", ",", "\"", "'", "(", ")", "[", "]", "<", ">", ";", "&", "?", "@", ":", "-", "_", "."];

function fuzzText(seed: number, lines: number): string {
  const next = random(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)]!;
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    const parts: string[] = [];
    for (let n = 1 + Math.floor(next() * 6); n > 0; n--) parts.push(pick(FRAGMENTS), pick(SEPARATORS));
    out.push(parts.join(""));
  }
  return out.join("\n");
}

test("skipping rules a line cannot match changes no answer: every rule on every line gives the same text and counts", () => {
  const options: RedactOptions[] = [ME, { ownNames: false }, { users: ["jane", "Dragonborn"], machines: ["JANES-PC"], ownNames: false }];
  let removed = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const text = fuzzText(seed, 700);
    for (const option of options) {
      const fast = redact(text, option);
      const slow = redact(text, { ...option, unsafeNoShortcuts: true });
      assert.equal(fast.text, slow.text, `seed ${seed}`);
      assert.deepEqual(fast.report, slow.report, `seed ${seed}`);
      removed += fast.report.total;
    }
  }
  assert.ok(removed > 3000, `only ${removed} things were removed: the fuzz is not reaching the rules`);
});

test("skipping rules changes no answer on the real log layouts either", () => {
  for (const name of ["crash-sse.log", "crash-sse-real-format.log", "crash-buffout4.log", "crash-netscriptframework.log", "LogOutput.log", "LogOutput-real-format.log"]) {
    const text = fixture(name);
    const fast = redact(text, ME);
    const slow = redact(text, { ...ME, unsafeNoShortcuts: true });
    assert.equal(fast.text, slow.text, name);
    assert.deepEqual(fast.report, slow.report, name);
  }
});

// ─── Secrets by their label ──────────────────────────────────────────────────

test("a name that ends in a secret's word is a secret's name, whatever it starts with", () => {
  const labels = [
    "apikey", "api_key", "api-key", "ApiKey", "API_KEY", "NexusApiKey", "nexus_api_key", "nexus-api-key", "ModioApiKey", "SteamApiKey", "x-api-key",
    "secret", "secret_key", "SecretKey", "client_secret", "client-secret", "ClientSecret", "app_secret", "consumer_secret", "private_key", "privateKey",
    "token", "Token", "AuthToken", "auth_token", "access_token", "accessToken", "refresh_token", "id_token", "session_token", "bot_token", "BotToken",
    "DiscordToken", "discord_token", "STEAM_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "bearer",
    "password", "Password", "passwd", "login_password", "db_password", "DatabasePassword", "UserPassword", "passphrase",
    "credential", "credentials", "license_key", "licenseKey", "AccountKey", "connectionString", "ConnectionString", "webhook_url", "WebhookUrl", "dsn", "pwd", "pw",
  ];
  const forms = (l: string): string[] => [`${l}=${V}`, `${l}: ${V}`, `${l} = ${V}`, `"${l}": "${V}"`, `${l}='${V}'`, `{"${l}":"${V}"}`, `export ${l}=${V}`];
  for (const label of labels) {
    for (const form of forms(label)) gone(form, [V]);
  }
});

test("a value that is quoted is taken whole, spaces and all", () => {
  const out = gone(`password = "${V} and some more words" next`, [V, "more words"]);
  assert.match(out, /next$/);
  gone(`{"secret":"${V}","other":"kept"}`, [V]);
  assert.match(run(`{"secret":"${V}","other":"kept"}`).text, /"other":"kept"/);
});

test("Authorization and cookie headers: the whole value goes, whatever the scheme", () => {
  gone(`Authorization: Basic ${j("dXNlcjpw", "YXNz")}`, [j("dXNlcjpw", "YXNz")]);
  gone(`Authorization: Digest username="jane", response="${V}"`, [V]);
  gone(`Authorization: ApiKey ${V}`, [V]);
  gone(`Proxy-Authorization: Negotiate ${V}`, [V]);
  gone(`Cookie: session=${V}; theme=dark`, [V, "theme=dark"]);
  gone(`Set-Cookie: sid=${V}; Path=/; HttpOnly`, [V]);
  gone(`{"Cookie":"session=${V}"}`, [V]);
});

test("a secret in markup, a web address or a command line", () => {
  gone(`<apikey>${V}</apikey>`, [V]);
  gone(`<Password>${V}</Password>`, [V]);
  gone(`<NexusApiKey attr="x">${V}</NexusApiKey>`, [V]);
  gone(`<add key="ApiKey" value="${V}" />`, [V]);
  gone(`<setting name="db_password" value='${V}'/>`, [V]);
  assert.equal(run(`<add key="Theme" value="dark" />`).text, `<add key="Theme" value="dark" />`);
  gone(`GET /api?api_key=${V}&x=1`, [V]);
  gone(`GET /api?x=1&token=${V}`, [V]);
  gone(`GET /api?x=1;sid=${V}`, [V]);
  gone(`Location: /login;sid=${V}`, [V]);
  assert.match(run(`GET /api?api_key=${V}&x=1`).text, /&x=1$/);
  gone(`curl --password ${V} https://x.test`, [V]);
  gone(`tool --password=${V}`, [V]);
  gone(`tool -Password "${V} two"`, [V, "two"]);
  gone(`tool --token ${V}`, [V]);
  assert.match(run(`curl --password ${V} https://x.test`).text, /https:\/\/x\.test$/);
});

test("a password said in words, or handed to a function that is named for it", () => {
  gone(`set password ${V}`, [V]);
  gone(`set the password ${V}`, [V]);
  gone(`SetPassword("${V}")`, [V]);
  gone(`the password is ${V}`, [V]);
  gone(`Password is: ${V}`, [V]);
  gone(`the password was ${V}`, [V]);
  // A message that merely says the word is not a secret.
  untouched("the password is required");
  untouched("password is: required");
  untouched("Invalid password, try again");
});

test("the keys that have a shape: tokens from the usual services, a Telegram bot, a webhook, a JWT", () => {
  const shapes = [
    j("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"),
    j("github_", "pat_", "A1b2C3d4E5f6G7h8I9j0K1l2"),
    j("glp", "at-", "A1b2C3d4E5f6G7h8I9j0"),
    j("np", "m_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"),
    j("sk", "_live_", "A1b2C3d4E5f6G7h8I9j0K1l2"),
    j("sk", "-", "A1b2C3d4E5f6G7h8I9j0K1l2"),
    j("xo", "xb-", "1234567890-abcdefghij"),
    j("AI", "zaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"),
    j("123456789", ":AAEhBP0av28EXAMPLEtokenValue0123456789ab"),
    j("eyJhbGciOiJIUzI1NiJ9", ".eyJzdWIiOiJqYW5lIn0", ".c2lnbmF0dXJlMTIzNDU2"),
    j("https://hooks.slack.com/services/", "T0000/B0000/", "XXXXXXXXXXXXXXXXXXXXXXXX"),
    j("https://discord.com/api/webhooks/123456789012345678/", "AbCdEfGhIjKlMnOpQrSt", "UvWxYz0123456789"),
    j("https://discord.com/api/v10/webhooks/123456789012345678/", "AbCdEfGhIjKlMnOpQrSt", "UvWxYz0123456789"),
    j("https://ptb.discord.com/api/webhooks/123456789012345678/", "AbCdEfGhIjKlMnOpQrSt", "UvWxYz0123456789"),
  ];
  for (const shape of shapes) {
    gone(`value ${shape} end`, [shape.slice(-20)]);
    gone(shape, [shape.slice(-20)]);
  }
});

test("a mod.io or Steam key is 32 hex characters, and the word before it says so", () => {
  const key = "0123456789abcdef0123456789abcdef";
  gone(`api key ${key}`, [key]);
  gone(`modio_key: ${key}`, [key]);
  gone(`Steam Web API key is ${key}`, [key]);
  // Hex with no digit in it at all is rare, but the word before it still says what it is.
  gone("key abcdefabcdefabcdefabcdefabcdefab", ["abcdefabcdefabcdefabcdefabcdefab"]);
  // The same hex with nothing saying it is a key is a hash, and a hash is not personal.
  untouched(`sha256 ${key}`);
  untouched(`Plugin checksum: ${key}`);
  // "key" and a space before a token with a digit in it say what the token is. Written "key:" or "key=", the value stays
  // (TRUST.md lists it): real BepInEx logs print config entries as "Key: <name>" and Unity's asset errors as "Key=<32 hex>".
  for (const line of [`key ${V}`, `key = ${V}`, `key is ${V}`]) gone(line, [V]);
  untouched("Getting configuration entry: Section: Gambling Chances Key: JackpotChance2");
  untouched(`InvalidKeyException: Exception of type 'UnityEngine.AddressableAssets.InvalidKeyException' was thrown., Key=${key}, Type=UnityEngine.Shader`);
});

test("a long mixed-case token with no word in front of it is taken out; a hash and a long identifier are not", () => {
  const token = j("Qm9xRGVhZGJlZWY", "T3BlbkFQSUtleQ", "WmVsZGFOZXZlckdpdmVz", "QnJpbmdzVGhlVHJpZm9yY2U", "AbC123XyZ");
  assert.ok(token.length >= 80 && token.length < 120);
  const out = gone(`request sent with ${token} and it worked`, [token.slice(10, 50)]);
  assert.match(out, /^request sent with REDACTED-SECRET and it worked$/);
  // Base64 with its padding.
  gone(`blob ${token}==`, [token.slice(10, 50)]);
  untouched(`file hash ${"0123456789abcdef".repeat(5)} done`);
  untouched(`at ${["Game", "Core", "Systems", "Inventory", "ItemSlot", "Handler", "OnEquipChanged", "Callback", "Internal", "Dispatch", "Invoker"].join("_")}`);
});

test("a private key block: a plain one, a log-prefixed one, a truncated one, a long one, an OpenSSH or a PGP one", () => {
  const body = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj";
  // The markers are put together here, so no line of this file is a key block to a secret scanner.
  const begin = (kind: string): string => j("-----BEGIN ", kind, "-----");
  const end = (kind: string): string => j("-----END ", kind, "-----");
  const key = (kind: string, lines: number, tail = "abc12=="): string[] => [
    begin(kind),
    ...Array.from({ length: lines }, (_, i) => `${body.slice(i % 7)}${"Q".repeat(i % 5)}`),
    tail,
    end(kind),
  ];
  for (const kind of ["RSA PRIVATE KEY", "PRIVATE KEY", "OPENSSH PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY", "PGP PRIVATE KEY BLOCK"]) {
    const plain = ["before", ...key(kind, 30), "after"].join("\n");
    const out = gone(plain, [body.slice(8, 40), "abc12"]);
    assert.equal(out, "before\nREDACTED-SECRET\nafter", kind);
    // Every line carries the logger's prefix.
    const prefixed = ["[Info] before", ...key(kind, 30).map((l) => `[Info   :   Mod] ${l}`), "[Info] after"].join("\n");
    const prefixedOut = gone(prefixed, [body.slice(8, 40), "abc12"]);
    assert.match(prefixedOut, /\[Info\] before\n.*REDACTED-SECRET\n\[Info\] after$/, kind);
  }
  // A blank line and a short last line are part of the key: a PGP key has both.
  const pgpKind = "PGP PRIVATE KEY BLOCK";
  const pgp = [`[Info] ${begin(pgpKind)}`, "[Info] ", `[Info] ${body}`, `[Info] ${body}`, "[Info] abc=", "[Info] =xYz1", `[Info] ${end(pgpKind)}`, "[Info] after"].join("\n");
  assert.equal(run(pgp).text, "[Info] REDACTED-SECRET\n[Info] after");
  // A key longer than the 12,000 characters a single line may hold, and one cut off before its end.
  assert.equal(run(["x", ...key("RSA PRIVATE KEY", 300), "y"].join("\n")).text, "x\nREDACTED-SECRET\ny");
  const cut = run(["start", begin("RSA PRIVATE KEY"), ...Array.from({ length: 60 }, () => body)].join("\n")).text;
  assert.equal(cut, "start\nREDACTED-SECRET");
  // A key all on one line.
  assert.equal(run(`key=${begin("PRIVATE KEY")}${body}${end("PRIVATE KEY")} ok`).text.includes(body.slice(8, 40)), false);
  // The line after a key's start that is not part of a key is kept.
  assert.equal(run(`${begin("PRIVATE KEY")}\nDone\nnext`).text, "REDACTED-SECRET\nDone\nnext");
  // Another log line in the middle of a key (a second thread writing to the same log) is kept, and the rest of the key still goes.
  const rsa = "RSA PRIVATE KEY";
  const interrupted = ["[Info] before", `[Info] ${begin(rsa)}`, `[Info] ${body}`, `[Info] ${body}`, "[Warning: OtherMod] Something else happened.", `[Info] ${body.slice(5)}`, "[Info] abc12==", `[Info] ${end(rsa)}`, "[Info] after"];
  assert.equal(run(interrupted.join("\n")).text, "[Info] before\n[Info] REDACTED-SECRET\n[Warning: OtherMod] Something else happened.\n[Info] after");
  // But a line that can pass for part of the key goes with it, as TRUST.md says: one that ends in a short word or in "]".
  for (const other of ["[Info   : MoreCompany] Loaded 12 cosmetics", "[Message:   BepInEx] Chainloader startup complete", "[Info   :   BepInEx] Loading [Some Mod 1.0.0]"]) {
    const swallowed = interrupted.map((line) => (line.startsWith("[Warning") ? other : line));
    assert.equal(run(swallowed.join("\n")).text, "[Info] before\n[Info] REDACTED-SECRET\n[Info] after", other);
  }
  // With no END line in reach (a key the log cut off), the key ends at the line that interrupts it, and a body line after it
  // stays (TRUST.md lists it).
  assert.equal(run([begin(rsa), body, "[Warning] Something else happened.", body].join("\n")).text, `REDACTED-SECRET\n[Warning] Something else happened.\n${body}`);
});

// ─── Addresses ───────────────────────────────────────────────────────────────

test("an IPv6 address in any spelling", () => {
  const addresses = [
    ["ipv6 2001:0db8:85a3:0000:0000:8a2e:0370:7334", "8a2e:0370:7334"],
    ["ipv6 2001:db8:85a3::8a2e:370:7334", "8a2e:370:7334"],
    ["ipv6 2001:db8::1", "2001:db8::1"],
    ["client 2a02:8071:5183:7a00::1234 connected", "7a00::1234"],
    ["listen [2001:db8::1]:8080", "2001:db8::1"],
    ["addr fe80::1c2d:3e4f:5a6b:7c8d%eth0", "1c2d:3e4f:5a6b:7c8d"],
    ["GET http://[2001:db8::1]/x", "2001:db8::1"],
    ["peer ::ffff:203.0.113.45", "203.0.113.45"],
    ["peer ::ffff:c000:0201", "c000:0201"],
    ["ADDR 2001:DB8:85A3::8A2E:370:7334", "8A2E:370:7334"],
  ] as const;
  for (const [line, secret] of addresses) gone(line, [secret]);
  // Loopback and the unspecified address are nobody's.
  untouched("listen ::1 and ::");
});

test("an IPv4 address: bare, with a port, in a URL, in a list, with a prefix length, in private ranges, zero-padded", () => {
  const lines = [
    ["Client 203.0.113.45 disconnected", "203.0.113.45"],
    ["Connecting to 203.0.113.45:2456", "203.0.113.45"],
    ["GET http://203.0.113.45/api/x", "203.0.113.45"],
    ["GET http://203.0.113.45:8080/api/x", "203.0.113.45"],
    ["X-Forwarded-For: 203.0.113.45, 10.0.0.1", "203.0.113.45"],
    ["route 203.0.113.0/24 via 10.0.0.1", "203.0.113"],
    ["gw 10.1.2.3", "10.1.2.3"],
    ["gw 192.168.1.77", "192.168.1.77"],
    ["gw 172.20.5.9", "172.20.5.9"],
    ["gw 100.72.5.9", "100.72.5.9"],
    ["addr 169.254.12.34", "169.254.12.34"],
    ["gw 192.168.001.005 up", "192.168.001.005"],
    ["server 203.000.113.045", "203.000.113.045"],
    ["peer [203.0.113.45]:2456", "203.0.113.45"],
    ["IPv4 Address. . . . . . . . . . . : 203.0.113.45", "203.0.113.45"],
    [`{"ip":"203.0.113.45","city":"X"}`, "203.0.113.45"],
  ] as const;
  for (const [line, secret] of lines) gone(line, [secret]);
});

test("addresses that are not a machine's stay: loopback, versions, a driver's number, a public resolver", () => {
  untouched("listen 127.0.0.1:2456");
  untouched("game v1.5.97.0 driver 31.0.15.3623 OS 10.0.22631");
  untouched("Server 1.2.3.4 build 99");
  untouched("Updated from 1.5.97.0 to 1.6.1170.0");
  untouched("DNS Servers . . . . . : 8.8.8.8");
  untouched("Skyrim 1.6.1170.0 runtime");
  // Shapes from real logs: BepInEx's own version, a plugin's version as the plugin list prints it, Fallout 4's version in a cut string.
  untouched("[Message:   BepInEx] BepInEx 5.4.21.0 - Lethal Company (1/15/2024 10:38:04 PM)");
  untouched("[Info   :   BepInEx] Loading [Better Item Scan 3.0.0.2]");
  untouched("[Info   :   BepInEx] Loading [NebulaMultiplayerModApi 2.0.0.242]");
  untouched(`(char*) "sion: 1.10.163.0, Save Version 15.68`);
  // A version with a port after it is read as an address: that is what it is when it has a port.
  assert.equal(run("v2.0.1.3:80").text.includes("2.0.1.3"), true);
});

test("hardware addresses, names that exist only on a private network, and dynamic-DNS names", () => {
  gone("adapter aa:bb:cc:dd:ee:ff up", ["aa:bb:cc:dd:ee:ff"]);
  gone("adapter AA-BB-CC-DD-EE-FF up", ["AA-BB-CC-DD-EE-FF"]);
  gone("Physical Address. . . : AA-BB-CC-DD-EE-FF", ["AA-BB-CC-DD-EE-FF"]);
  gone("host janes-rig.local answered", ["janes-rig"]);
  gone("host nas.home.arpa answered", ["nas"]);
  gone("join myserver.duckdns.org:2456", ["myserver"]);
  gone("join me.ngrok.io", ["ngrok"]);
  // A name that only looks like one.
  untouched("namespace Game.Local.Settings and System.Internal.Thing");
});

test("an address in an email, a git address and a webhook is taken out as what it is", () => {
  gone("contact jane.doe@example.com now", ["jane.doe", "example.com"]);
  gone("contact jane%40example.com now", ["jane", "example.com"]);
  gone("contact jane[at]example.com now", ["jane", "example.com"]);
  gone("contact jane at example dot com now", ["jane", "example"]);
  gone("remote git@github.com:owner/repo.git", ["owner", "repo"]);
  gone("proxy https://jane:secretpw123@proxy.test/path", ["secretpw123", "jane:"]);
  // A file name with an @ is not an address, and nor is the same name as the help posts write it, with "(at)".
  untouched("textures icon@2x.png and Preloader@ver2.dll");
  untouched("textures icon(at)2x.png and Preloader(at)ver2.dll");
  untouched("it points at Preloader(at)ver2.dll. It ranks names");
  gone("contact jane(at)example.com now", ["jane", "example.com"]);
  // An address with a file ending glued on is still an address.
  gone("reported by jane.doe@example.com.esl", ["jane.doe", "example.com"]);
  gone("reported by jane.doe(at)example.com.esl", ["jane.doe", "example.com"]);
});

// ─── Paths ───────────────────────────────────────────────────────────────────

test("a file: address, with spaces or percent-encoding, loses its folders", () => {
  assert.equal(run("file:///C:/Users/Jane%20Doe/Documents/x.log").text, "REDACTED-PATH/x.log");
  assert.equal(run("file://C:/Users/Jane Doe/Documents/x.log").text, "REDACTED-PATH/x.log");
  gone("see file:///home/bob/Mod Folder/x.log now", ["bob", "Mod Folder"]);
});

test("network shares in every form", () => {
  assert.equal(run("\\\\NAS-HOME\\Share-Private\\Skyrim\\file.esp").text, "REDACTED-PATH\\file.esp");
  assert.equal(run("//NAS-HOME/Share-Private/Skyrim/file.esp").text, "REDACTED-PATH/file.esp");
  assert.equal(run("smb://nas/share/dir/file.esp").text, "REDACTED-PATH/file.esp");
  assert.equal(run("\\\\?\\UNC\\NAS\\share\\x\\y.dll").text, "REDACTED-PATH\\y.dll");
});

test("device paths, Cygwin and MSYS, macOS, and a home folder written with a variable", () => {
  const cases = [
    ["\\Device\\HarddiskVolume3\\Users\\Jane\\x.dll", "Jane"],
    ["/cygdrive/c/Users/Jane/x.dll", "Jane"],
    ["/c/Users/Jane/x.dll", "Jane"],
    ["/Users/jdoe/Library/Application Support/x/y.log", "jdoe"],
    ["/Volumes/Backup/Jane/mods/x.dll", "Backup"],
    ["/private/var/folders/ab/cd/T/x.log", "folders"],
    ["~/mods/x.dll", "mods"],
    ["$HOME/mods/x.dll", "mods"],
    ["${HOME}/mods/x.dll", "mods"],
    ["%USERPROFILE%\\mods\\x.dll", "mods"],
    ["%APPDATA%\\Mod\\x.cfg", "Mod\\"],
    ["%LOCALAPPDATA%\\Temp\\x.dmp", "Temp"],
    ["%HOMEDRIVE%%HOMEPATH%\\Documents\\SecretLib\\x.dll", "SecretLib"],
    ["%HOMEDRIVE%\\Games\\SecretLib\\x.dll", "SecretLib"],
    ["\\\\files.example.com@SSL\\DavWWWRoot\\SecretLib\\x.dll", "SecretLib"],
    ["\\\\nas@SSL@8443\\DavWWWRoot\\SecretLib\\x.dll", "SecretLib"],
    ["C:%5CUsers%5CJane%5Cx.dll", "Jane"],
    ["C%3A%2FUsers%2FJane%2Fx.dll", "Jane"],
    ["D:\\Games\\SecretLib\\x.dll", "SecretLib"],
    ["Z:\\home\\jane\\games\\LibraryNine\\x.dll", "LibraryNine"],
  ] as const;
  for (const [path, secret] of cases) {
    const out = gone(`opened ${path} ok`, [secret]);
    assert.match(out, /REDACTED-PATH/, path);
  }
});

test("a folder that is an account's own name, with a dot in it, is taken out too", () => {
  assert.equal(run("C:\\Users\\bob.smith").text, "REDACTED-PATH");
  assert.equal(run("C:\\Users\\bob.smith\\x.log").text, "REDACTED-PATH\\x.log");
  assert.equal(run("/home/bob.smith").text, "REDACTED-PATH");
  assert.equal(run("/Users/bob.smith/x.log").text, "REDACTED-PATH/x.log");
});

test("a path in the game's own folders keeps its file name, and a web address with /home/ in it is not a path", () => {
  assert.equal(run("Loaded C:\\Program Files (x86)\\Steam\\steamapps\\common\\Skyrim Special Edition\\Data\\x.esp").text, "Loaded REDACTED-PATH\\x.esp");
  untouched("https://example.com/home/page.html");
  untouched("see https://nexusmods.com/users/12345/mods");
  untouched("Data\\Textures\\actors\\x.dds");
  untouched("SKSE/Plugins/Thing.dll");
  untouched("/home/ is empty");
});

// ─── Names ───────────────────────────────────────────────────────────────────

test("a name is found however it is cased, joined, abbreviated or composed", () => {
  const out = gone("Hello JANE DOE and Jane Doe's mods, jane-doe, jane_doe, JaneDoe, J.Doe, jane.doe", ["jane", "doe"]);
  assert.equal(out.match(/REDACTED-USER/g)?.length, 7);
  // The same letters composed or decomposed (é as one character or as e and an accent).
  const accented: RedactOptions = { users: ["jané"], ownNames: false };
  gone(`user jan\u00e9 and jane\u0301`, ["jan"], accented);
  gone(`user jane\u0301 and jan\u00e9`, ["jan"], { users: ["jane\u0301"], ownNames: false });
  // A name with a one-letter word in it has joined forms too; a joined form too short to be a name on its own is not made.
  gone("JaneQDoe, jane_q_doe and Jane.Q.Doe", ["jane"], { users: ["Jane Q Doe"], ownNames: false });
  untouched("AB and a.b", { users: ["A B"], ownNames: false });
  // Names in other scripts.
  gone("田中太郎 logged in; 田中太郎のMOD", ["田中"], { users: ["田中太郎"], ownNames: false });
  gone("Привет, Иван Петров!", ["Иван", "Петров"], { users: ["Иван Петров"], ownNames: false });
});

test("a name with something invisible inside it is still the name", () => {
  gone("J\u200Bane\u200D Doe\u2060 and ja\u00ADne and J\u{E0041}ane", ["jane", "doe"]);
  gone("J\0a\0n\0e\0 \0D\0o\0e\0", ["jane"]);
  gone("\u202EJane Doe", ["jane"]);
  // Marks that print nothing without being format characters: Mongolian variation selectors, Khmer inherent vowels, the blank Braille cell.
  for (const mark of ["\u180B", "\u180C", "\u180D", "\u180E", "\u180F", "\u17B4", "\u17B5", "\u2800"]) {
    assert.equal(run(`J${mark}ane D${mark}oe`).text, "REDACTED-USER", `U+${mark.codePointAt(0)!.toString(16).toUpperCase()}`);
  }
});

test("a Windows short name and a domain name are the account too", () => {
  gone("C:\\Users\\JANEDO~1\\x.dll", ["JANEDO"]);
  gone("JANEDO~1 folder", ["JANEDO"]);
  gone("CORP\\jane and jane@CORP", ["jane"]);
  gone("logged in as CORP\\jane", ["jane"]);
});

test("the game's own files are not made personal by an account that shares a word with them", () => {
  const o: RedactOptions = { users: ["Dragonborn"], ownNames: false };
  const out = run("Account Dragonborn loaded Dragonborn.esm and Dragonborn.esp; Dragonborn said hi", o).text;
  assert.equal(out, "Account REDACTED-USER loaded Dragonborn.esm and Dragonborn.esp; REDACTED-USER said hi");
});

test("an account that is only digits is not made of every number in the log", () => {
  const o: RedactOptions = { users: ["1170"], ownNames: false };
  assert.equal(run("v1.6.1170 build 1170 id 1170", o).text, "v1.6.1170 build 1170 id 1170");
  gone("C:\\Users\\1170\\x.dll", ["1170"], o);
});

test("a name a labelled line gives is removed wherever else the log has it, in its joined forms too", () => {
  const none: RedactOptions = { ownNames: false };
  // The shape of a real Lethal Company log: the player's name labelled once, then printed bare.
  const log = [
    "[Info   : Unity Log] username: Marigold Quine",
    "[Info   :Emotes] Loading 0 unlocked emotes for player: Marigold Quine",
    "Computer Name: QUINE-STUDIO",
    "logged in as 'mquine'",
    "saved MarigoldQuine_save1 for mquine on quine.studio; MarigoldQuineArmor.esp loaded",
  ].join("\n");
  const { text, report } = run(log, none);
  assert.equal(
    text,
    [
      "[Info   : Unity Log] username: REDACTED-USER",
      "[Info   :Emotes] Loading 0 unlocked emotes for player: REDACTED-USER",
      "Computer Name: REDACTED-MACHINE",
      "logged in as REDACTED-USER",
      "saved REDACTED-USER_save1 for REDACTED-USER on REDACTED-MACHINE; MarigoldQuineArmor.esp loaded",
    ].join("\n")
  );
  assert.equal(report.leftover, 1);
  // A label that gives no name teaches nothing.
  untouched("User Name: Unknown\nUnknown error", none);
  // Each name learned is looked for in the whole log, so only a few are: a log of many labels can't make that run away.
  const many = Array.from({ length: 20_000 }, (_, i) => `username: player${i}x`).join("\n");
  const started = Date.now();
  assert.equal(run(many, none).report.byKind.user, 20_000);
  assert.ok(Date.now() - started < 4000, `${Date.now() - started} ms`);
  // So the seventeenth name labelled, and a name over 64 characters, are removed on their own line only (TRUST.md lists it).
  const seventeen = [...Array.from({ length: 17 }, (_, i) => `username: player${i}x`), "player15x and player16x played"].join("\n");
  assert.match(run(seventeen, none).text, /\nREDACTED-USER and player16x played$/);
  const long = `Q${"u".repeat(64)}`;
  assert.match(run(`username: ${long}\n${long} played`, none).text, new RegExp(`\\n${long} played$`));
});

test("an account ID after a label written with only a space, and an account name after USER= or LOGNAME=", () => {
  const none: RedactOptions = { ownNames: false };
  gone("steam id 52079950 joined", ["52079950"], none);
  gone("Account ID 1234567890", ["1234567890"], none);
  // A shorter number after such a label is something else: a real Valheim log prints the game's own Steam number this way.
  untouched("Using environment steamid 892970", none);
  untouched("account id missing, user id unknown", none);
  // A two-letter account is too short to replace everywhere; the variables that hold it say what it is.
  assert.equal(run("USER=jo LOGNAME=jo", { users: ["jo"], ownNames: false }).text, "USER=REDACTED-USER LOGNAME=REDACTED-USER");
  untouched("USER=root LOGNAME=deck", none);
});

test("an account name of several words goes whole after logged in as, USER= or LOGNAME=, and is counted once", () => {
  // Those labels take one word, as a Linux account is one word; the rest of a longer name must not be left behind.
  const o: RedactOptions = { users: ["Jane Doe"], ownNames: false };
  for (const line of ["session refused, logged in as Jane Doe", "USER=Jane Doe", "LOGNAME=jane doe"]) {
    const r = run(line, o);
    assert.doesNotMatch(r.text, /jane|doe/i, line);
    assert.equal(r.report.byKind.user, 1, line);
  }
});

test("a labelled name is read with a hyphen between the label's words too", () => {
  const none: RedactOptions = { ownNames: false };
  assert.equal(run("user-name: jdoe92\nlater jdoe92", none).text, "user-name: REDACTED-USER\nlater REDACTED-USER");
  assert.equal(run("computer-name: JANESBOX\nlater JANESBOX", none).text, "computer-name: REDACTED-MACHINE\nlater REDACTED-MACHINE");
});
test("names every machine has, and labels that say there is no name, are left as they are", () => {
  untouched("steamdeck up; Steam Deck docked", { machines: ["steamdeck"], ownNames: false });
  untouched("Profile name: Default", { ownNames: false });
  untouched("User Name: Unknown", { ownNames: false });
  untouched("Computer Name: (not available)", { ownNames: false });
  assert.equal(run("Computer Name: JANES-PC", { ownNames: false }).text, "Computer Name: REDACTED-MACHINE");
  assert.equal(run("User Name: someoneelse", { ownNames: false }).text, "User Name: REDACTED-USER");
});

test("Windows' default computer names are taken out at their real length, and words that look like one are not", () => {
  assert.equal(run("DESKTOP-4F9K2LQ LAPTOP-RS7P8E2D WIN-3KT5F2NU7QO", { ownNames: false }).text, "REDACTED-MACHINE REDACTED-MACHINE REDACTED-MACHINE");
  untouched("WIN-CHECKSUM1 LAPTOP-ENGINE1 PC-VERSION DESKTOP-ABC", { ownNames: false });
});

// ─── Not over-redacting ──────────────────────────────────────────────────────

test("things that look like secrets or identities and are neither stay as they were written", () => {
  untouched("Token: 0x06000123 and token = 0x06000124", { ownNames: false });
  untouched("key=1234 pass=3 token: 42", { ownNames: false });
  untouched("Preloader@ver2.dll and icon@2x.png", { ownNames: false });
  untouched("Ring Bearer Chronicles loaded", { ownNames: false });
  untouched("EXCEPTION_ACCESS_VIOLATION at 0x7FFAF1BF3A41 in SkyrimSE.exe+0x1234", { ownNames: false });
  untouched("Plugin.Namespace.SomeVeryLongClassName.AnotherVeryLongMethodName.YetAnotherVeryLongMethodNameThatKeepsGoing", { ownNames: false });
  const il2cpp = `${["Game", "Core", "Systems", "Inventory", "ItemSlot", "Handler", "OnEquipChanged", "Callback", "Internal", "Dispatch", "Invoker"].join("_")}_0`;
  untouched(`at ${il2cpp} (at <0123456789abcdef>:0)`, { ownNames: false });
  untouched("sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", { ownNames: false });
});

// ─── The text itself ─────────────────────────────────────────────────────────

test("line endings of every kind become one, so a name can't hide in a CR-only file", () => {
  const out = run("a\rb\r\nc\u2028d\u0085e\rpassword=" + V + "\rC:\\Users\\Jane Doe\\x.dll").text;
  assert.equal(out, "a\nb\nc\nd\ne\npassword=REDACTED-SECRET\nREDACTED-PATH\\x.dll");
});

test("characters that print nothing are taken out of the text, so they can't split a word the rules look for", () => {
  const spaced = ["pass\u200Bword", "tok\u2060en", "sec\u00ADret", "api\u200D_key"].map((l) => `${l}=${V}`);
  for (const line of spaced) gone(line, [V]);
  assert.equal(run("a\u200Bb\u{E0041}c\u202Ed").text, "abcd");
});

// ─── A budget, and no run-away ───────────────────────────────────────────────

test("when time runs out the lines not reached are dropped and counted, never passed along as they were", () => {
  const log = Array.from({ length: 5000 }, (_, i) => `line ${i} password=${V} C:\\Users\\Jane Doe\\x${i}.dll`).join("\n");
  const none = run(log, { ...ME, budgetMs: 0 });
  assert.equal(none.text, "");
  assert.equal(none.report.skippedLines, 5000);
  const some = run(log, { ...ME, budgetMs: 1 });
  for (const line of some.text.split("\n")) assert.ok(!line.includes(V) && !/Jane/.test(line), "a line passed through unredacted");
  assert.equal(some.text.split("\n").length + some.report.skippedLines >= 5000 || some.report.skippedLines === 0, true);
  // Given its time, nothing is skipped.
  assert.equal(run(log).report.skippedLines, 0);
});

test("a long run of separators, a field of folders or a flood of colons costs time in proportion to its length", () => {
  const nasty: Record<string, string> = {
    "slashes": "/".repeat(500_000),
    "backslashes": "\\".repeat(500_000),
    "home folders": "/home/".repeat(60_000),
    "drive roots": "C:\\".repeat(100_000),
    "schemes": "a://".repeat(100_000),
    "at signs": "a@".repeat(150_000),
    "dots": "1.2.3.".repeat(80_000),
    "colons": ":".repeat(300_000),
    "hex pairs": "aa:bb:".repeat(60_000),
    "label words": "password ".repeat(60_000),
    "quotes": "\"".repeat(300_000),
    "percents": "%5C".repeat(100_000),
  };
  for (const [name, input] of Object.entries(nasty)) {
    const started = Date.now();
    redact(input, ME);
    const took = Date.now() - started;
    assert.ok(took < 4000, `${name}: ${took} ms`);
  }
});

test("a long line cut where no space is near backs up past an address, so no half of one is left", () => {
  const { text, report } = run(`${"|".repeat(5990)}jane.doe@example.com and more`, { ownNames: false });
  assert.equal(report.cutLines, 1);
  assert.ok(!text.includes("jane.doe") && !text.includes("@"), text.slice(-30));
  assert.ok(text.startsWith("|".repeat(5990)));
});

test("a line of six thousand slashes inside a real log does not stall the lines around it", () => {
  const log = ["start", `GET ${"/".repeat(6000)}`, `path ${"\\".repeat(6000)}`, "end"].join("\n");
  const started = Date.now();
  const out = run(log).text.split("\n");
  assert.ok(Date.now() - started < 1000);
  assert.equal(out[0], "start");
  assert.equal(out[out.length - 1], "end");
});

// ─── Words that are not ours, put where ours go ──────────────────────────────

test("text shaped like one of our own placeholders is not a way to hide something behind it", () => {
  assert.equal(run("password=REDACTED-SECRETabcd1234").text, "password=REDACTED-SECRET");
  assert.equal(run("REDACTED-SECRET= hunter2abc").text, "REDACTED-SECRET= REDACTED-SECRET");
  assert.ok(!run("api_key=REDACTED-SECRET-" + V).text.includes(V));
  // A real one is left alone, and not counted again.
  const again = run("password=REDACTED-SECRET");
  assert.equal(again.text, "password=REDACTED-SECRET");
  assert.equal(again.report.total, 0);
});

// ─── What it says it does not take out ───────────────────────────────────────

test("the things TRUST.md lists as not removed are really not removed (so the list stays true)", () => {
  // If one of these starts being removed, that is good news: take it off the list in TRUST.md and out of this test.
  const kept: Array<[string, string]> = [
    ...["pass", "PASS", "key", "pin", "cred", "otp", "sig", "signature", "webhook", "licence", "sas"].map((label): [string, string] => [`a bare label that is an ordinary word (${label})`, `${label}: ${V}`]),
    ["an unlabelled key of a shape nobody has told it", `loaded ${j("Zx9Qw8Er7Ty6", "Ui5Op4As3Df2")}`],
    ["a relative path", "opened ../SecretFolder/x.dll"],
    ["a relative path from here", "opened ./SecretFolder/x.dll"],
    ["a drive-relative path", "opened D:SecretFolder\\x.dll"],
    ["an address written as one decimal number", "peer 3405803777"],
    ["an address written in hexadecimal", "peer 0xCB007101"],
    ["an address written in octal", "peer 0313.0.0161.0105"],
    ["a hardware address with no separators", "adapter AABBCCDDEEFF"],
    ["a phone number", "call +1 555 010 9999"],
    ["a public host name", "connecting to play.example-game.com"],
    ["a flag with a one-letter name", `mysql -p ${V}`],
    // Dotted numbers that look like the version numbers real logs are full of.
    ["a public address under 11. with no port and no address word before it", "no answer from relay at 5.45.12.7"],
    ["an address ending in .0 with no port and no address word before it", "seen at 93.184.216.0"],
    ["an address right after a version word", "server version 203.0.113.45"],
    ["an address right after ver", "server ver 203.0.113.45"],
    ["an address right after rev", "server rev 203.0.113.45"],
    // "key" says secret only when a space comes between it and the value.
    ["key with = and no space", `key=${V}`],
    // Short names after labels that are also ordinary words, and a short number after a label and a space.
    ["a short name after login:", "login: jo"],
    ["a short name after Account:", "Account: jo"],
    ["an ID under eight characters after a label and a space", "steam id 1234567"],
    ["an ID under six characters after a label and a colon", "account id: 12345"],
  ];
  for (const [what, line] of kept) {
    const out = run(line, { ownNames: false }).text;
    const survivor = line.split(/\s+/).pop()!;
    assert.ok(out.includes(survivor), `${what}: ${JSON.stringify(line)} -> ${JSON.stringify(out)}. It is now taken out; update TRUST.md and this list.`);
  }
  // An address with a version word right after it.
  assert.equal(run("seen 203.0.113.45 build", { ownNames: false }).text, "seen 203.0.113.45 build");
  // "key=" right after "?", "&" or ";" is read as a query string's, and goes.
  assert.equal(run(`a=1;key=${V}`, { ownNames: false }).text, "a=1;key=REDACTED-SECRET");
  // A secret on the line after its label.
  assert.equal(run("password\nvalue-on-the-next-line-1234").text, "password\nvalue-on-the-next-line-1234");
  // A password with spaces and no quotes: the first word goes, the rest is taken for text.
  assert.equal(run(`password: ${V} second third`).text, "password: REDACTED-SECRET second third");
});

test("the limits on paths that TRUST.md lists: a Linux path glued to the text before it, and a path a log wrapped onto two lines", () => {
  const jane: RedactOptions = { users: ["jane"], ownNames: false };
  for (const prefix of ["foo", "-", ".", "$", "1", "_"]) {
    const out = run(`see ${prefix}/home/jane/mods/x.dll`, jane).text;
    assert.ok(out.includes("mods/x.dll"), `${prefix}: ${out}`); // the other folders stay
    assert.ok(!out.includes("jane"), `${prefix}: ${out}`); // the account name does not
  }
  assert.equal(run("C:\\Users\\Jane Doe\\Games\\Very Long\n  Folder\\x.dll").text, "REDACTED-PATH\n  Folder\\x.dll");
  // A rooted path whose first folder is not one it knows: the other folders stay, the account name does not.
  assert.equal(run("see /data/jane/mods/x.dll and /tmp/jane/y.dll", jane).text, "see /data/REDACTED-USER/mods/x.dll and /tmp/REDACTED-USER/y.dll");
});

test("the limits on names that TRUST.md lists: a first name alone, a very short name, an account named for a common word, a name inside a longer word", () => {
  const jane: RedactOptions = { users: ["Jane Doe"], ownNames: false };
  // The whole name, and its joined forms, go; the first name on its own goes only in a path or on a labelled line.
  assert.equal(run("hello Jane and Doe and jane", jane).text, "hello Jane and Doe and jane");
  assert.equal(run("C:\\Users\\Jane Doe\\x.dll and Jane's mod", jane).text, "REDACTED-PATH\\x.dll and Jane's mod");
  assert.equal(run("User Name: Jane", { ownNames: false }).text, "User Name: REDACTED-USER");
  // Under three characters: with its path only. Under two, for a name in a script with no spaces between words.
  assert.equal(run("Jo played; C:\\Users\\Jo\\x.dll; Jo: 3", { users: ["Jo"], ownNames: false }).text, "Jo played; REDACTED-PATH\\x.dll; Jo: 3");
  assert.equal(run("李 played; C:\\Users\\李\\x.dll", { users: ["李"], ownNames: false }).text, "李 played; REDACTED-PATH\\x.dll");
  // A common word for a name: with its path only.
  assert.equal(run("Steam launched; C:\\Users\\Steam\\x.dll; User Name: Steam", { users: ["Steam"], ownNames: false }).text, "Steam launched; REDACTED-PATH\\x.dll; User Name: Steam");
  // Inside a longer word: left, and counted.
  const inside = run("JaneArmor.esp and DoeMods", { users: ["Jane"], ownNames: false });
  assert.equal(inside.text, "JaneArmor.esp and DoeMods");
  assert.equal(inside.report.leftover, 1);
  // Every spelling of the name that is removed when it stands alone is counted inside a longer word too, not only the spaced one.
  const joined = run("JaneDoeArmor.esp, Jane_DoeTweaks.esp, jane.doeFollowers.esp and JDoeHair.esp", jane);
  assert.equal(joined.text, "JaneDoeArmor.esp, Jane_DoeTweaks.esp, jane.doeFollowers.esp and JDoeHair.esp");
  assert.equal(joined.report.leftover, 4);
  // Two names that overlap in the same word count it once.
  assert.equal(run("JaneDoeArmor.esp", { users: ["Jane Doe", "janedoe"], ownNames: false }).report.leftover, 1);
  // A labelled name with more after it on its line is removed on that line only.
  const none: RedactOptions = { ownNames: false };
  assert.equal(run("User Name: Jane Doe (Administrator)\nseen Jane Doe here", none).text, "User Name: REDACTED-USER\nseen Jane Doe here");
  assert.equal(run("User Name: jdoe92   Computer Name: JANESBOX\nlater jdoe92", none).text, "User Name: REDACTED-USER\nlater jdoe92");
});
