import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLACEHOLDER,
  REDACTION_KINDS,
  describeRedaction,
  redact,
  scrub,
  type RedactOptions,
} from "../src/crashwhisper/redact.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(resolve(HERE, "fixtures", name), "utf8");

// Every test names the account and computer explicitly and turns off the lookup of this
// machine's own names, so the results don't depend on who runs them.
const ME: RedactOptions = { users: ["Jane Doe", "jane"], machines: ["JANES-PC"], ownNames: false };
const run = (text: string, options: RedactOptions = ME) => redact(text, options);

// Credential-shaped test data is assembled here from pieces, so no line of this file
// looks like a real key to a secret scanner.
const join = (...parts: string[]): string => parts.join("");

// ─── Paths ───────────────────────────────────────────────────────────────────

test("a Windows path loses its folders, including the account name, and keeps the file name", () => {
  const { text, report } = run(String.raw`Game executable path: C:\Users\Jane Doe\Games\Lethal Company\Lethal Company.exe`);
  assert.equal(text, String.raw`Game executable path: REDACTED-PATH\Lethal Company.exe`);
  assert.equal(report.byKind.path, 1);
  assert.equal(report.total, 1);
});

test("folder names with spaces and parentheses don't end the path early", () => {
  const { text } = run(String.raw`Loaded C:\Program Files (x86)\Steam\steamapps\common\Jane Doe's Games\Mod.dll+0x1234 OK`);
  assert.equal(text, "Loaded REDACTED-PATH\\Mod.dll+0x1234 OK");
});

test("a stack-trace source path keeps the file and the line number, not the author's folders", () => {
  const { text } = run(String.raw`   at MyMod.Plugin.Awake () [0x00000] in C:\Users\Jane Doe\source\repos\MyMod\Plugin.cs:line 14`);
  assert.equal(text, "   at MyMod.Plugin.Awake () [0x00000] in REDACTED-PATH\\Plugin.cs:line 14");
});

test("forward slashes, doubled backslashes and the long-path prefix are all the same path", () => {
  assert.equal(run("Path: C:/Users/Jane Doe/Documents/My Games/x/crash-1.log").text, "Path: REDACTED-PATH/crash-1.log");
  assert.equal(run(String.raw`"C:\\Users\\Jane\\Documents\\save.ess" ok`).text, String.raw`"REDACTED-PATH\save.ess" ok`);
  assert.equal(run(String.raw`\\?\C:\Users\Jane Doe\a\b.txt`).text, String.raw`REDACTED-PATH\b.txt`);
});

test("a path that ends in a folder loses the rest of its line rather than guess where it stops", () => {
  const { text, report } = run(String.raw`Working dir: D:\Mod Organizer 2\mods\Some Mod 2.1\SKSE\Plugins\ and then more text`);
  assert.equal(text, "Working dir: REDACTED-PATH");
  assert.equal(report.byKind.path, 1);
});

test("a folder that happens to contain a dot is not taken for the end of the path", () => {
  // If "Games.old" were read as the file name, "Jane's Mods" would survive.
  const { text } = run(String.raw`C:\Users\Jane Doe\Games.old\Jane's Mods\thing.dll`);
  assert.equal(text, String.raw`REDACTED-PATH\thing.dll`);
  assert.ok(!/Jane|Games|Mods/.test(text));
});

test("a file name with parentheses is cut off safely rather than leaked", () => {
  const { text } = run(String.raw`See C:\Users\Jane Doe\Desktop\crash log (1).txt for details`);
  assert.ok(!/Jane|Desktop/.test(text), text);
  assert.match(text, /REDACTED-PATH/);
});

test("network paths, file:// addresses and Wine drive paths", () => {
  assert.equal(run(String.raw`\\JANES-PC\Share\Skyrim\SKSE\skse64.log`).text, String.raw`REDACTED-PATH\skse64.log`);
  assert.equal(run("Opened file:///C:/Users/Jane%20Doe/Desktop/notes.txt").text, "Opened REDACTED-PATH/notes.txt");
  assert.equal(run(String.raw`Z:\home\deck\.local\share\Steam\steamapps\common\Skyrim Special Edition\SkyrimSE.exe`).text, String.raw`REDACTED-PATH\SkyrimSE.exe`);
});

test("Linux, Steam Deck, Proton prefix, WSL and macOS paths", () => {
  const cases = [
    ["/home/deck/.local/share/Steam/steamapps/common/Skyrim Special Edition/SkyrimSE.exe", "REDACTED-PATH/SkyrimSE.exe"],
    ["/home/jane/.steam/steamapps/compatdata/489830/pfx/drive_c/users/steamuser/Documents/My Games/x.log", "REDACTED-PATH/x.log"],
    ["/mnt/c/Users/Jane Doe/AppData/Local/Temp/crash.dmp", "REDACTED-PATH/crash.dmp"],
    ["/run/media/jane/Games/SteamLibrary/steamapps/common/Valheim/BepInEx/LogOutput.log", "REDACTED-PATH/LogOutput.log"],
    ["/Users/jane/Library/Application Support/Steam/steamapps/common/Valheim/valheim.log", "REDACTED-PATH/valheim.log"],
  ] as const;
  for (const [input, expected] of cases) {
    const { text } = run(`log at ${input} done`);
    assert.equal(text, `log at ${expected} done`.replace(/ done$/, " done"), input);
    assert.ok(!/jane|deck/i.test(text), input);
  }
});

test("web addresses that happen to contain /home/ or /media/ are left alone", () => {
  const url = "https://example.com/home/page.html and https://cdn.example.com/media/pic.png";
  assert.equal(run(url).text, url);
});

test("relative paths inside the game folder are not personal and stay", () => {
  const line = String.raw`Data\SKSE\Plugins\SomeMod.dll and Data/Meshes/armor/boots.nif`;
  assert.equal(run(line).text, line);
});

// ─── Names ───────────────────────────────────────────────────────────────────

test("this machine's account name is replaced wherever it appears, in any case, with a possessive", () => {
  const { text, report } = run("Saved by JANE DOE. jane's profile belongs to Jane Doe.");
  assert.equal(text, "Saved by REDACTED-USER. REDACTED-USER's profile belongs to REDACTED-USER.");
  assert.equal(report.byKind.user, 3);
});

test("a name inside a longer word is left alone but counted, so the person can look", () => {
  const { text, report } = run("Plugins: JaneArmor.esp and Jane_Armor.esp and Jane");
  assert.equal(text, "Plugins: JaneArmor.esp and REDACTED-USER_Armor.esp and REDACTED-USER");
  assert.equal(report.leftover, 1);
  assert.match(describeRedaction(report), /still appears inside another word/);
});

test("names every machine has are not replaced everywhere, only inside paths", () => {
  const options: RedactOptions = { users: ["deck", "Admin"], machines: ["PC"], ownNames: false };
  const text = "Steam Deck, user deck, Admin panel, PC build";
  assert.equal(redact(text, options).text, text);
  assert.equal(redact("/home/deck/x/y.log", options).text, "REDACTED-PATH/y.log");
});

test("names shorter than three characters are only removed with their path", () => {
  const options: RedactOptions = { users: ["al"], ownNames: false };
  assert.equal(redact("alpha al calls", options).text, "alpha al calls");
  assert.equal(redact(String.raw`C:\Users\al\Desktop\x.log`, options).text, String.raw`REDACTED-PATH\x.log`);
});

test("a name made of regular-expression characters is matched literally", () => {
  const options: RedactOptions = { users: ["j.doe+1(x)"], ownNames: false };
  assert.equal(redact("hello j.doe+1(x) and jxdoe+1(x)", options).text, "hello REDACTED-USER and jxdoe+1(x)");
});

test("a computer name is removed by name, by Windows' default pattern and by its label", () => {
  assert.equal(run("host JANES-PC is up").text, "host REDACTED-MACHINE is up");
  assert.equal(run("on DESKTOP-AB12CD3 today").text, "on REDACTED-MACHINE today");
  assert.equal(run("Computer Name: SOMEBODYS-OTHER-PC").text, "Computer Name: REDACTED-MACHINE");
  assert.equal(run("hostname=other-box").text, "hostname=REDACTED-MACHINE");
  assert.equal(run("MachineName: Studio PC").text, "MachineName: REDACTED-MACHINE");
});

test("a labelled user name is removed even when it is not this machine's", () => {
  assert.equal(run("USERNAME=somebodyelse").text, "USERNAME=REDACTED-USER");
  assert.equal(run("User Name: somebody else").text, "User Name: REDACTED-USER");
  assert.equal(run("logged in as bob").text, "logged in as REDACTED-USER");
});

test("the machine's own names are learned from the environment when none are given", () => {
  const saved = { USERNAME: process.env.USERNAME, USER: process.env.USER, LOGNAME: process.env.LOGNAME, COMPUTERNAME: process.env.COMPUTERNAME };
  try {
    process.env.USERNAME = "Marigold Quine";
    process.env.USER = "marigold";
    process.env.LOGNAME = "marigold";
    process.env.COMPUTERNAME = "QUINE-STUDIO";
    const { text } = redact("Marigold Quine and marigold on QUINE-STUDIO");
    assert.equal(text, "REDACTED-USER and REDACTED-USER on REDACTED-MACHINE");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// ─── Network, contact, identity ──────────────────────────────────────────────

test("private addresses, addresses with a port and addresses named as such are removed", () => {
  const { text, report } = run("Connecting to 203.0.113.5:2456, lan 192.168.1.20, server 198.51.100.7, host 10.0.0.5");
  assert.equal(text, "Connecting to REDACTED-NETWORK, lan REDACTED-NETWORK, server REDACTED-NETWORK, host REDACTED-NETWORK");
  assert.equal(report.byKind.network, 4);
});

test("loopback and version numbers that look like addresses are not touched", () => {
  const line = "listening on 127.0.0.1:2456, game v1.5.97.0 updated from 1.5.97.0 to 1.6.1170.0, OS v10.0.22621, Fallout 4 1.10.163.0";
  assert.equal(run(line).text, line);
});

test("hardware and network identifiers", () => {
  assert.equal(run("adapter 00:1A:2B:3C:4D:5E up").text, "adapter REDACTED-NETWORK up");
  assert.equal(run("v6 2001:0db8:85a3:0000:0000:8a2e:0370:7334 ok").text, "v6 REDACTED-NETWORK ok");
});

test("email addresses", () => {
  assert.equal(run("contact jane.doe+mods@example.co.uk now").text, "contact REDACTED-EMAIL now");
});

test("Steam and Windows account identifiers", () => {
  assert.equal(run("steam 76561198000000000 and [U:1:39734272]").text, "steam REDACTED-ID and REDACTED-ID");
  assert.equal(run("SID S-1-5-21-1234567890-987654321-1122334455-1001").text, "SID REDACTED-ID");
});

// ─── Secrets ─────────────────────────────────────────────────────────────────

test("keys, tokens and passwords in the usual shapes", () => {
  const github = join("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6");
  const openai = join("s", "k-", "abcdefghij0123456789KLMNOP");
  const jwt = join("ey", "JhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "dBjftJeZ4CVPmB92K27uhbUJU1p1r");
  for (const secret of [github, openai, jwt]) {
    const { text, report } = run(`value ${secret} end`);
    assert.equal(text, "value REDACTED-SECRET end", secret.slice(0, 6));
    assert.equal(report.byKind.secret, 1);
  }
});

test("a Thunderstore service-account token goes by its shape, with no label; a look-alike of another length stays", () => {
  // "tss_", 30 letters and digits, and a 6-character checksum: how Thunderstore builds one.
  const token = join("tss", "_", "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1", "xY3zA5");
  const { text, report } = run(`[Info   :Uploader] publishing with ${token} now`);
  assert.equal(text, "[Info   :Uploader] publishing with REDACTED-SECRET now");
  assert.equal(report.byKind.secret, 1);
  for (const near of [join("tss", "_", "short1"), join("tss", "_", "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1", "xY3zA5", "Q")]) {
    assert.equal(run(`value ${near} here`).text, `value ${near} here`, near);
  }
});

test("assignments whose key says it is secret, and authorization headers", () => {
  const value = join("EXAMPLE", "EXAMPLE", "EXAMPLE");
  assert.equal(run(`api_key=${value} x`).text, "api_key=REDACTED-SECRET x");
  assert.equal(run(`Password: ${value}`).text, "Password: REDACTED-SECRET");
  assert.equal(run(`"token": "${value}"`).text, `"token": "REDACTED-SECRET"`);
  assert.equal(run(`Authorization: Bearer ${"a".repeat(30)}`).text, "Authorization: REDACTED-SECRET");
});

test("a quoted value is taken out whole, spaces and all, and what surrounds it is left alone", () => {
  const words = ["correct", "horse", "battery", "staple"].join(" ");
  assert.equal(run(`password = "${words}" ok`).text, `password = "REDACTED-SECRET" ok`);
  assert.equal(run(`password = '${words}' ok`).text, `password = 'REDACTED-SECRET' ok`);
  assert.equal(run(`{"passphrase": "${words}", "id": 5}`).text, `{"passphrase": "REDACTED-SECRET", "id": 5}`);
  assert.equal(run(`"api_key":"${words}"`).text, `"api_key":"REDACTED-SECRET"`);
  // The other kind of quote, and an escaped one, are part of the value and don't end it.
  assert.equal(run(`token = "it's ${words}" end`).text, `token = "REDACTED-SECRET" end`);
  assert.equal(run(`secret = "${words.split(" ")[0]}\\" ${words.split(" ")[1]}" end`).text, `secret = "REDACTED-SECRET" end`);
  // A quote that is never closed takes the rest of the line, because the rest is the value.
  assert.equal(run(`password = "${words}`).text, `password = "REDACTED-SECRET`);
  assert.equal(run(`password = "${words}`).report.byKind.secret, 1);
  // One value is one thing removed.
  assert.equal(run(`password = "${words}"`).report.byKind.secret, 1);
  for (const text of [`password = "${words}"`, `token='${words}'`, `{"secret": "${words}"}`]) {
    for (const word of words.split(" ")) assert.ok(!run(text).text.includes(word), `${word} survived in ${text}`);
  }
});

test("a key that is already taken out isn't taken out twice", () => {
  assert.equal(run(`password = "REDACTED-SECRET"`).report.byKind.secret, 0);
  assert.equal(run(`password = REDACTED-SECRET`).report.byKind.secret, 0);
});

test("an authorization header is taken out whatever scheme it names, or none", () => {
  const basic = ["dXNlcjpw", "YXNzd29yZA=="].join("");
  assert.equal(run(`Authorization: Basic ${basic}`).text, "Authorization: REDACTED-SECRET");
  assert.equal(run(`authorization=${basic}`).text, "authorization=REDACTED-SECRET");
  assert.equal(run(`Authorization: token ${basic.slice(0, 12)}`).text, "Authorization: REDACTED-SECRET");
  assert.equal(run(`Authorization: Basic ${basic}`).report.byKind.secret, 1);
});

test("a bearer token is counted once, not once per rule that notices it", () => {
  const { report } = run(`Authorization: Bearer ${"a".repeat(30)}`);
  assert.equal(report.byKind.secret, 1);
});

test("credentials inside a URL, and a Discord webhook", () => {
  assert.equal(run("clone https://bob:hunter2@example.com/repo.git").text, "clone https://REDACTED-SECRET@example.com/repo.git");
  const hook = join("https://discord.com/api/web", "hooks/123456789012345678/", "abcDEF_ghi-JKL");
  assert.equal(run(`post to ${hook} now`).text, "post to REDACTED-SECRET now");
});

test("a private key block, whole or cut short", () => {
  const begin = join("-----BEGIN RSA PRIVATE", " KEY-----");
  const end = join("-----END RSA PRIVATE", " KEY-----");
  const whole = run(`before\n${begin}\nMIIEowIBAAKCAQEAxHqLmM0vQ9ZJ\nbT7yU3cV8dX1eY6gH5jL0aS9\n${end}\nafter`);
  assert.equal(whole.text, "before\nREDACTED-SECRET\nafter");
  const cut = run(`before\n${begin}\nMIIEowIBAAKCAQEA`);
  assert.ok(!cut.text.includes("PRIVATE"), cut.text);
});

test("a long mixed token (how a Nexus API key looks) goes; a hash and a long plain name stay", () => {
  const key = "aB3".repeat(34);
  assert.equal(run(`key ${key} end`).text, "key REDACTED-SECRET end");
  const sha = "0123456789abcdef".repeat(5);
  assert.equal(run(`sha ${sha}`).text, `sha ${sha}`);
});

test("long .NET names and dotted identifiers are not mistaken for tokens", () => {
  const frame = "at LethalCompanyInputUtils.Api.LethalCompanyInputUtilsInstance.Frobnicate.WithAVeryLongMethodNameIndeed ()";
  assert.equal(run(frame).text, frame);
});

// ─── The report ──────────────────────────────────────────────────────────────

test("the report counts each kind and never records what was removed", () => {
  const { report } = run(String.raw`C:\Users\Jane Doe\a.dll jane@example.com 192.168.0.9 JANES-PC Jane`);
  assert.deepEqual(report.byKind, { user: 1, machine: 1, path: 1, network: 1, contact: 1, secret: 0, id: 0 });
  assert.equal(report.total, 5);
  const serialised = JSON.stringify(report);
  for (const secret of ["Jane", "jane@", "192.168", "JANES-PC"]) assert.ok(!serialised.includes(secret), secret);
  assert.deepEqual(Object.keys(report.byKind).sort(), [...REDACTION_KINDS].sort());
});

test("describeRedaction says what went, in plain words, and doesn't promise a clean result", () => {
  const some = describeRedaction(run(String.raw`C:\Users\Jane Doe\a.dll C:\Users\Jane Doe\b.dll Jane`).report);
  assert.match(some, /Removed 1 user name, 2 folder paths\./);
  // A help post shows "[Christine] Ida Elf Archer.esp" as "(Christine) Ida Elf Archer.esp", so names aren't kept as written there.
  assert.match(some, /names of mods and files are kept, except that a help post changes their brackets, backticks, at signs and runs of spaces\./);
  assert.doesNotMatch(some, /as written/);
  const none = describeRedaction(run("nothing to see here").report);
  assert.match(none, /Nothing personal was recognised/);
  assert.match(none, /isn't a promise/);
});

test("every placeholder is plain text no forum, issue tracker or chat will treat as markup", () => {
  for (const kind of REDACTION_KINDS) assert.match(PLACEHOLDER[kind], /^REDACTED-[A-Z]+$/);
});

// ─── Behaviour that must hold for any input ──────────────────────────────────

const COMBINED = [
  String.raw`Path: C:\Users\Jane Doe\Games\Mod Pack v1.5\Data\Foo.dll`,
  "Contact jane@example.com, steam 76561198000000000, JANES-PC, 10.1.2.3, Jane",
  `token=${"x".repeat(12)} ${join("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6")}`,
  "/home/jane/.local/share/foo/bar.log",
].join("\n");

test("redacting twice changes nothing more", () => {
  const once = run(COMBINED);
  const twice = run(once.text);
  assert.equal(twice.text, once.text);
  assert.equal(twice.report.total, 0);
});

test("none of the identifying text survives, whichever rule caught it", () => {
  const { text } = run(COMBINED);
  for (const needle of ["Jane", "jane", "JANES-PC", "76561198", "10.1.2.3", "example.com", "ghp", "xxxxxxxxxxxx"]) {
    assert.ok(!text.includes(needle), `${needle} survived: ${text}`);
  }
});

test("ordinary crash logs pass through untouched", () => {
  for (const name of ["crash-sse.log", "crash-buffout4.log", "crash-netscriptframework.log", "LogOutput.log"]) {
    const original = fixture(name);
    const { text, report } = redact(original, { ownNames: false });
    assert.equal(text, original, name);
    assert.equal(report.total, 0, name);
  }
});

test("every kind of line break becomes one, and no line is lost or merged", () => {
  const input = "a\r\nC:\\Users\\Jane Doe\\x.dll\r\nb\n\nc\rd";
  assert.equal(run(input).text, "a\nREDACTED-PATH\\x.dll\nb\n\nc\nd");
});

test("an absurdly long line is cut short and counted, not chewed on", () => {
  const long = `C:\\${"folder\\".repeat(5000)}x`;
  const started = Date.now();
  const { text, report } = run(long);
  assert.ok(Date.now() - started < 1500, "took too long");
  assert.equal(report.cutLines, 1);
  assert.ok(text.length < 7000);
});

test("hostile input can't make the rules run away", () => {
  const nasty = [
    "C:\\".repeat(4000),
    `\\\\${"a".repeat(8000)}`,
    `/home/${"x/".repeat(3000)}`,
    `${"1.2.3.".repeat(2000)}4`,
    `Bearer ${"-".repeat(5000)}`,
    `${"a@".repeat(3000)}b.com`,
    "[".repeat(5000),
  ];
  const started = Date.now();
  for (const input of nasty) redact(input, ME);
  assert.ok(Date.now() - started < 4000, `took ${Date.now() - started} ms`);
});

test("scrub returns just the text", () => {
  assert.equal(scrub(String.raw`C:\Users\Jane Doe\a.dll`, ME), String.raw`REDACTED-PATH\a.dll`);
});
