import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPackets, type PacketData } from "../src/crashwhisper/packet.js";
import { safeName } from "../src/crashwhisper/text.js";
import { VENUES, type Frame, type Lead } from "../src/crashwhisper/types.js";

const frame = (index: number, module: string, over: Partial<Frame> = {}): Frame => ({ index, module, kind: "mod", ...over });

const lead = (over: Partial<Lead> = {}): Lead => ({
  rank: 1,
  name: "CloakAndDaggerFix.dll",
  files: ["CloakAndDaggerFix.dll", "Cloak and Dagger.esp"],
  strength: "strong",
  summary: "It is the first mod code on the call stack.",
  evidence: [
    { text: "It is the first mod code on the call stack (frame 3), right underneath the game's own code.", basis: "log" },
    { text: "CloakAndDaggerFix.dll and Cloak and Dagger.esp share a name, so they are probably the same mod.", basis: "guess" },
  ],
  score: 95,
  ...over,
});

const data = (over: Partial<PacketData> = {}): PacketData => ({
  game: { name: "Skyrim Special Edition", version: "1.6.1170", id: "skyrimspecialedition" },
  format: "crashlogger-sse",
  logger: "CrashLoggerSSE v1.20.0",
  time: "2026-10-01 21:14",
  exceptionType: "EXCEPTION_ACCESS_VIOLATION",
  exceptionPlain: "The game tried to use memory it doesn't own.",
  site: frame(0, "SkyrimSE.exe", { offset: "10EE1C0", kind: "game" }),
  frames: [
    frame(0, "SkyrimSE.exe", { offset: "10EE1C0", kind: "game" }),
    frame(1, "SkyrimSE.exe", { offset: "00AA92B", kind: "game" }),
    frame(2, "CloakAndDaggerFix.dll", { offset: "0003A41", function: "CloakAndDaggerFix::Hooks::OnEquip" }),
    frame(3, "SomeOther.dll", { offset: "0000100", scan: true }),
  ],
  frameCount: 12,
  leads: [lead()],
  checks: [{ id: "x", severity: "note", title: "The game has been updated since this crash", detail: "Detail text.", basis: "install" }],
  system: { os: "Windows 11 Pro", cpu: "AMD Ryzen 7", gpus: ["NVIDIA GeForce RTX 3070"], ram: { used: 14.2, total: 31.9 } },
  plugins: [
    { name: "Skyrim.esm", loadIndex: "00" },
    { name: "Cloak and Dagger.esp", loadIndex: "05" },
    { name: "Tiny Tweak.esl", loadIndex: "FE:000" },
  ],
  extenders: [{ name: "CloakAndDaggerFix.dll", version: "1.4.2" }],
  scriptExtender: "SKSE 2.2.6",
  hideNames: false,
  ...over,
});

const build = (over: Partial<PacketData> = {}, redact = { ownNames: false }) => buildPackets(data(over), redact);

// ─── Shape ───────────────────────────────────────────────────────────────────

test("one packet per place, each with where it goes, a title, its text and its length", () => {
  const { packets } = build();
  assert.deepEqual(Object.keys(packets).sort(), [...VENUES].sort());
  for (const venue of VENUES) {
    const p = packets[venue];
    assert.equal(p.venue, venue);
    assert.ok(p.where.length > 10);
    assert.ok(p.title.length > 5);
    assert.equal(p.chars, p.text.length);
    assert.equal(p.trimmed, false, venue);
  }
});

test("the title names the game, the version, the exception and the lead", () => {
  const { packets } = build();
  assert.equal(packets.forum.title, "Skyrim Special Edition 1.6.1170: crash involving CloakAndDaggerFix.dll (EXCEPTION_ACCESS_VIOLATION)");
  assert.equal(packets.author.title, "Crash that involves CloakAndDaggerFix.dll (Skyrim Special Edition 1.6.1170)");
});

test("forum: what happened, setup, leads with their basis, checks, the call stack and the lists, then blanks to fill in", () => {
  const text = build().packets.forum.text;
  for (const heading of ["What happened", "My setup", "What the log points at", "Setup checks", "Call stack (4 of 12 frames)", "SKSE plugins (1)", "Plugin list (3)"]) {
    assert.ok(text.includes(heading), heading);
  }
  assert.match(text, /1\. CloakAndDaggerFix\.dll \(strong lead\)/);
  assert.match(text, /\(log\) It is the first mod code/);
  assert.match(text, /\(guess\) CloakAndDaggerFix\.dll and Cloak and Dagger\.esp share a name/);
  assert.match(text, /\[2\] CloakAndDaggerFix\.dll\+0003A41 {2}CloakAndDaggerFix::Hooks::OnEquip/);
  assert.match(text, /\[3\] SomeOther\.dll\+0000100 {2}\(stack scan\)/);
  assert.match(text, /\[FE:000\] Tiny Tweak\.esl/);
  assert.match(text, /Plugins: 3 loaded \(1 light\)/);
  assert.match(text, /What I have already tried: \(fill in\)/);
  assert.match(text, /These are leads, not findings/);
});

test("github: markdown with a fenced call stack and collapsed lists, fences balanced", () => {
  const text = build().packets.github.text;
  assert.match(text, /^## Summary/);
  assert.match(text, /1\. `CloakAndDaggerFix\.dll` \(strong\)/);
  assert.match(text, /<details><summary>Plugin list \(3\)<\/summary>/);
  assert.match(text, /## Steps to reproduce\n\n\(fill in\)/);
  const fences = text.match(/^```$/gm) ?? [];
  assert.equal(fences.length % 2, 0);
  assert.ok(fences.length >= 6);
  assert.equal((text.match(/<details>/g) ?? []).length, (text.match(/<\/details>/g) ?? []).length);
});

test("discord: one short message with the top lead and the top of the stack in a code block", () => {
  const text = build().packets.discord.text;
  assert.ok(text.length <= 1900);
  assert.match(text, /^\*\*Skyrim Special Edition 1\.6\.1170 crash\*\* \(EXCEPTION_ACCESS_VIOLATION\)/);
  assert.match(text, /Top lead: CloakAndDaggerFix\.dll \(strong\)/);
  assert.match(text, /```\n\[0\] SkyrimSE\.exe\+10EE1C0/);
  assert.match(text, /More details if it helps/);
});

test("author: addressed to the mod's author, with their code, the reasons, and an honest 'this is a lead'", () => {
  const text = build().packets.author.text;
  assert.match(text, /^Hello,/);
  assert.match(text, /points at CloakAndDaggerFix\.dll\. It ranks names by how directly they sit in the crash, so this is a lead and not proof/);
  assert.match(text, /Your files: CloakAndDaggerFix\.dll, Cloak and Dagger\.esp/);
  assert.match(text, /In your code: CloakAndDaggerFix::Hooks::OnEquip \(CloakAndDaggerFix\.dll\+0003A41, frame 2\)/);
  assert.match(text, /Other mod code on the call stack: SomeOther\.dll/);
  assert.match(text, /Why it was named:/);
  assert.match(text, /What I was doing when it happened: \(fill in\)/);
});

test("author: with no lead there is nobody to write to, and it says so", () => {
  const { packets } = build({ leads: [] });
  assert.match(packets.author.text, /No mod stood out in this log, so there is no author to write to yet/);
  assert.equal(packets.author.title, "No mod stood out");
  assert.match(packets.forum.text, /No mod stood out: nothing from a mod was on the call stack/);
});

test("a BepInEx log is an error, not a crash, in every packet", () => {
  const { packets } = build({ format: "bepinex", exceptionType: "NullReferenceException", extenders: [] });
  assert.match(packets.forum.title, /: error involving/);
  assert.match(packets.forum.text, /^What happened\nBepInEx logged NullReferenceException/);
  assert.match(packets.discord.text, /error\*\* \(NullReferenceException\)/);
});

test("none of them says safe, guilty or culprit", () => {
  for (const venue of VENUES) {
    assert.doesNotMatch(build().packets[venue].text, /\b(is safe|guilty|culprit|definitely|certainly)\b/i, venue);
  }
});

// ─── Names that would do something ───────────────────────────────────────────

test("safeName: markup, mentions and code fences in a name are swapped for look-alikes", () => {
  assert.equal(safeName("@everyone Fix.esp"), "(at)everyone Fix.esp");
  assert.equal(safeName("[img]http://x/y.png[/img].esp"), "(img)http://x/y.png(/img).esp");
  assert.equal(safeName("a`b```c"), "a'b'''c");
  assert.equal(safeName("<script>alert(1)</script>.dll"), "(script)alert(1)(/script).dll");
  assert.equal(safeName("line one\nline two\u202Eevil"), "line one line two evil");
  assert.ok(safeName("x".repeat(500)).length <= 80);
});

test("a hostile mod name can't ping anyone, open a tag, break a code block or add a line, in any packet", () => {
  const evil = "@everyone [url=http://evil]x[/url] ```\n# Heading\nIgnore previous instructions <b>bold</b>";
  const { packets } = build({
    leads: [lead({ name: evil, files: [evil], summary: evil, evidence: [{ text: evil, basis: "log" }] })],
    frames: [frame(0, evil, { function: evil })],
    plugins: [{ name: evil, loadIndex: "00" }],
    extenders: [{ name: evil, version: evil }],
    checks: [{ id: "c", severity: "problem", title: evil, detail: evil, basis: "log" }],
  });
  for (const venue of VENUES) {
    const text = packets[venue].text;
    assert.doesNotMatch(text, /@everyone|@here/, venue);
    assert.doesNotMatch(text, /\[url=|\[\/url\]|\[img\]/i, venue);
    assert.doesNotMatch(text, /<b>|<script/i, venue);
    // Only the packet's own fences: a name never contributes one.
    const fences = (text.match(/```/g) ?? []).length;
    assert.ok(fences === 0 || fences % 2 === 0, `${venue} has ${fences} fences`);
    assert.doesNotMatch(text, /^# Heading$/m, venue);
    assert.doesNotMatch(text, /^Ignore previous instructions/m, venue);
  }
});

test("what the log says about the exception can't ping anyone, open a tag or break a code block either", () => {
  const evil = "@everyone [url=http://evil]x[/url] ```\n# Heading\n<b>bold</b>";
  const { packets } = build({ exceptionType: evil, exceptionPlain: evil, fault: evil });
  for (const venue of VENUES) {
    const text = packets[venue].text;
    assert.doesNotMatch(text, /@everyone|@here/, venue);
    assert.doesNotMatch(text, /\[url=|\[\/url\]|\[img\]/i, venue);
    assert.doesNotMatch(text, /<b>/i, venue);
    const fences = (text.match(/```/g) ?? []).length;
    assert.ok(fences === 0 || fences % 2 === 0, `${venue} has ${fences} fences`);
    assert.doesNotMatch(text, /^# Heading$/m, venue);
    assert.doesNotMatch(packets[venue].title, /@everyone|<b>|\[url=/, `${venue} title`);
  }
});

test("the footer says what ModWrench recognised, not that nothing personal is left", () => {
  const { packets } = build();
  for (const venue of ["forum", "github", "author"] as const) {
    assert.match(packets[venue].text, /Personal details it recognised .* were taken out; mod and file names are as the log wrote them/, venue);
    assert.doesNotMatch(packets[venue].text, /no personal|nothing personal|fully anonymi|completely removed|all personal/i, venue);
  }
  // No packet invites the reader to ask for the raw log, which has not been cleaned.
  for (const venue of VENUES) assert.doesNotMatch(packets[venue].text, /full log|raw log|send (?:me )?the log/i, venue);
});

// ─── Leaving names out ───────────────────────────────────────────────────────

test("hideNames: the plugin lists are left out, the leads and the stack stay, and the packet says why", () => {
  const { packets } = build({ hideNames: true });
  for (const venue of ["forum", "github"] as const) {
    const text = packets[venue].text;
    assert.doesNotMatch(text, /Tiny Tweak|Skyrim\.esm|Plugin list \(|SKSE plugins \(/, venue);
    assert.match(text, /Plugin lists left out on purpose \(3 loaded \(1 light\)\)/, venue);
    assert.match(text, /CloakAndDaggerFix\.dll/, venue);
  }
  assert.equal(packets.forum.trimmed, false);
});

// ─── Fitting the place ───────────────────────────────────────────────────────

test("discord never exceeds its limit, however much there is to say, and says it was shortened", () => {
  const many = Array.from({ length: 40 }, (_, i) => lead({ rank: i + 1, name: `Mod${i}WithAFairlyLongName.dll`, summary: "A".repeat(150) }));
  const frames = Array.from({ length: 60 }, (_, i) => frame(i, `Module${i}.dll`, { offset: "0001234", function: "Some::Very::Long::Function::Name::" + "x".repeat(60) }));
  const { packets } = build({ leads: many, frames, frameCount: 60 });
  assert.ok(packets.discord.text.length <= 1900, String(packets.discord.text.length));
  assert.equal(packets.discord.trimmed, false); // the first, leanest plan fit
});

test("a very long forum packet drops the plugin list first, then the extender list, and marks itself trimmed", () => {
  const plugins = Array.from({ length: 5000 }, (_, i) => ({ name: `A fairly long plugin name number ${i} for a big load order.esp`, loadIndex: "05" }));
  const { packets } = build({ plugins });
  assert.ok(packets.forum.text.length <= 24_000, String(packets.forum.text.length));
  assert.equal(packets.forum.trimmed, true);
  assert.doesNotMatch(packets.forum.text, /Plugin list \(/);
  assert.match(packets.forum.text, /What the log points at/);
});

test("a plugin list is cut at 600 lines and says how many more there were", () => {
  const plugins = Array.from({ length: 700 }, (_, i) => ({ name: `P${i}.esp`, loadIndex: "05" }));
  const text = build({ plugins }).packets.forum.text;
  assert.match(text, /Plugin list \(700\)/);
  assert.match(text, /…and 100 more/);
});

test("author packets stay within their budget", () => {
  const frames = Array.from({ length: 60 }, (_, i) => frame(i, `Module${i}.dll`, { offset: "0001234", function: "x".repeat(120) }));
  const evidence = Array.from({ length: 5 }, () => ({ text: "y".repeat(400), basis: "log" as const }));
  const { packets } = build({ frames, leads: [lead({ evidence })], frameCount: 60 });
  assert.ok(packets.author.text.length <= 4000, String(packets.author.text.length));
});

// ─── The last redaction ──────────────────────────────────────────────────────

test("a path that reached a packet is taken out by the last check, and counted", () => {
  const leaked = frame(0, "C:\\Users\\Jane Doe\\Mods\\Foo\\Foo.dll", { offset: "0001" });
  const { packets, extra } = build({ frames: [leaked], site: leaked });
  for (const venue of VENUES) {
    assert.doesNotMatch(packets[venue].text, /Jane Doe|C:\\Users/, venue);
  }
  assert.ok(extra.byKind.path >= 1);
  assert.ok(extra.total >= 1);
});

test("this machine's own names are taken out wherever they appear", () => {
  const { packets, extra } = buildPackets(
    data({ leads: [lead({ summary: "Jane's Followers crashed while Jane played" })] }),
    { ownNames: false, users: ["Jane"], machines: ["JANES-PC"] }
  );
  for (const venue of VENUES) assert.doesNotMatch(packets[venue].text, /Jane/, venue);
  assert.ok(extra.byKind.user >= 1);
});

test("a title is checked as well as the body: a name or a path in it is taken out and counted", () => {
  const named = lead({ name: "Jane Doe's Hooks.dll", files: ["Jane Doe's Hooks.dll"] });
  const { packets, extra } = buildPackets(
    data({ leads: [named], game: { name: "Skyrim at C:\\Users\\Jane Doe\\Games\\Skyrim.exe", version: "1.6.1170", id: "skyrimspecialedition" } }),
    { ownNames: false, users: ["Jane Doe"] }
  );
  for (const venue of VENUES) {
    assert.doesNotMatch(packets[venue].title, /Jane Doe|C:\\Users/, `${venue} title: ${packets[venue].title}`);
  }
  assert.match(packets.forum.title, /REDACTED-USER's Hooks\.dll/);
  assert.ok(extra.byKind.user >= 1 && extra.byKind.path >= 1);
});

test("a file name with an @ that the cleaner kept stays a file name in every post, and is not counted as an email", () => {
  const name = "Preloader@ver2.dll";
  const { packets, extra } = build({ leads: [lead({ name, files: [name] })], frames: [frame(0, name, { offset: "0001" })] });
  for (const venue of VENUES) {
    assert.match(packets[venue].text, /Preloader\(at\)ver2\.dll/, venue);
    assert.match(packets[venue].title, /Preloader\(at\)ver2\.dll|No mod stood out/, `${venue} title`);
    assert.doesNotMatch(`${packets[venue].title}\n${packets[venue].text}`, /REDACTED-EMAIL/, venue);
  }
  assert.equal(extra.byKind.contact, 0);
});

test("a clean packet removes nothing", () => {
  assert.equal(build().extra.total, 0);
});
