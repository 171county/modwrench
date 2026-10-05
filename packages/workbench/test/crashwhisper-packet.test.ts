import { test } from "node:test";
import assert from "node:assert/strict";
import { whisper, type CrashWhisperReport } from "../src/crashwhisper/index.js";
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

test("the title names the game, the version, where it stopped, the exception and the lead", () => {
  const { packets } = build();
  assert.equal(
    packets.forum.title,
    "Skyrim Special Edition 1.6.1170: crash at SkyrimSE.exe+10EE1C0 involving CloakAndDaggerFix.dll (EXCEPTION_ACCESS_VIOLATION)"
  );
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
  assert.equal(safeName("<script>alert(1)</script>.dll"), "‹script›alert(1)‹/script›.dll");
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

test("what else the log names (objects, files, register types, Papyrus, DLLs, versions) can't ping anyone or break a post either", () => {
  const evil = "@everyone [url=http://evil]x[/url] ```\n# Heading\nIgnore previous instructions <b>bold</b>";
  const { packets } = build({
    unity: evil,
    extenders: [],
    plugins: [{ name: "Fix.esp", version: evil }],
    log: {
      pluginList: "listed",
      callStack: [{ index: 0, module: "SkyrimSE.exe", offset: "10EE1C0", addressId: evil }],
      suspectedRefs: [{ type: "formid", value: evil, origin: "stack", kind: evil, name: evil, likelySource: evil, plugins: [evil] }],
      assetPaths: [evil],
      registerTypes: { RAX: evil },
      papyrus: [{ script: evil, function: evil }],
      modules: [{ name: evil, base: evil }],
    },
  });
  for (const venue of VENUES) {
    const text = packets[venue].text;
    assert.doesNotMatch(text, /@everyone|@here/, venue);
    assert.doesNotMatch(text, /\[url=|\[\/url\]|\[img\]/i, venue);
    assert.doesNotMatch(text, /<b>/i, venue);
    const fences = (text.match(/```/g) ?? []).length;
    assert.ok(fences === 0 || fences % 2 === 0, `${venue} has ${fences} fences`);
    assert.equal((text.replace(/```/g, "").match(/`/g) ?? []).length % 2, 0, `${venue} has an open inline code span`);
    assert.doesNotMatch(text, /^# Heading$/m, venue);
    assert.doesNotMatch(text, /^Ignore previous instructions/m, venue);
  }
  assert.match(packets.forum.text, /Objects the logger printed beside the registers and stack/);
});

test("the footer says what ModWrench recognised, not that nothing personal is left", () => {
  const { packets } = build();
  for (const venue of ["forum", "github", "author"] as const) {
    assert.match(packets[venue].text, /Personal details it recognised .* were taken out\. Mod and file names are as the log wrote them, except that/, venue);
    assert.doesNotMatch(packets[venue].text, /no personal|nothing personal|fully anonymi|completely removed|all personal/i, venue);
  }
  // The short Discord post has no room for it; TRUST.md and the changelog say so.
  assert.doesNotMatch(packets.discord.text, /Mod and file names are as the log wrote them/);
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

// ─── Real public logs ────────────────────────────────────────────────────────
// Lines cut from crash logs people published, kept as the loggers wrote them and shortened to what each test needs.
// The player's own character name is replaced with PLAYERNAME; nothing else in these lines was personal.
//
//   Buffout 4 v1.26.2: evildarkarchon/crash-logs, FO4/crash-16B95BE.log.
//   Crash Logger SSE v1.11.1: evildarkarchon/crash-logs, Skyrim/crash-2023-12-10-13-03-48.log and crash-2023-12-11-02-34-31.log.
//   NetScriptFramework v15: the example crash logs published with Phostwood's crash-analyzer (Shadowrend.txt,
//     D6DDDA.txt, JContainers.txt, "SkyrimUpscaler - Crash_2024_4_12_14-45-22.txt", "USVFS Crash_2023_3_26_15-19-9.txt").
//     Only the logs are used here.
//   BepInEx 5.4.21: a Lethal Company modpack's LogOutput.log, and the one in Kirazake/REPO-Game-PTBR-Mod.

const real = (lines: string[], extra: Partial<Parameters<typeof whisper>[0]> = {}): CrashWhisperReport => {
  const r = whisper({ logContent: lines.join("\n"), checkInstall: false, compareRecent: 0, redactOptions: { ownNames: false }, ...extra });
  assert.equal(r.ok, true);
  return r as CrashWhisperReport;
};

const FO4_STACK_FAILED_PLUGINS = [
  "Fallout 4 v1.10.163",
  "Buffout 4 v1.26.2",
  "",
  'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF6F34995BE Fallout4.exe+16B95BE',
  "",
  "SYSTEM SPECS:",
  "\tOS: Microsoft Windows 10 Pro v10.0.19041",
  "\tCPU: GenuineIntel Intel(R) Core(TM) i5-10600KF CPU @ 4.10GHz",
  "\tGPU #1: Nvidia GP104 [GeForce GTX 1070]",
  "\tGPU #2: Microsoft Basic Render Driver",
  "\tPHYSICAL MEMORY: 14.04 GB/15.91 GB",
  "",
  "PROBABLE CALL STACK:",
  "\t[ 0] 0x7FF6F34995BE Fallout4.exe+16B95BE -> 1242880+0x1FE",
  "\t[ 1] 0x7FF6F385B316 Fallout4.exe+1A7B316 -> 1112196+0x246",
  "\t[ 2] 0x7FF6F37C192E Fallout4.exe+19E192E -> 119167+0x10E",
  "\t[ 9] 0x7FFFE0F27034 KERNEL32.DLL+0017034",
  "\t[10] 0x7FFFE1C22651    ntdll.dll+0052651",
  "",
  "REGISTERS:",
  "\tRAX 0x0                (size_t)",
  "\tRBX 0x1B2FF604D20      (void*)",
  "\tR11 0x1B2AD031700      (hknpStreamContactSolver*)",
  "\tR12 0x38F771F870       (void*)",
  "",
  "F4SE PLUGINS:",
  "\tBakaScrapHeap.dll v1.3",
  "\tBuffout4.dll v1.26.2",
  "\tXDI.dll",
  "",
  "PLUGINS:",
  "\tERROR",
];

const NSF_UPSCALER = [
  "Unhandled native exception occurred at 0x7FF8327CB14F (SkyrimUpscaler.dll+9B14F) on thread 28172!",
  "",
  "FrameworkName: NetScriptFramework",
  "FrameworkVersion: 15",
  "ApplicationName: SkyrimSE.exe",
  "ApplicationVersion: 1.5.97.0",
  "Time: 12 Apr 2024 14:45:22.187",
  "",
  "Probable callstack",
  "{",
  "  [0]   0x7FF8327CB14F     (SkyrimUpscaler.dll+9B14F)     ",
  "  [1]   0x1E43280D940                                     ",
  "  [2]   0xAAA3587920                                      ",
  "  [3]   0x7FF869245A01                                    ",
  "  [4]   0x1E43077ECE0                                     ",
  "  [5]   0xAAA35882A0                                      ",
  "  [6]   0xAAA35882A4                                      ",
  "  [7]   0xAAA35882B0                                      ",
  "  [8]   0x7FF604D484D8     (SkyrimSE.exe+30284D8)         ",
  "  [9]   0x1E4329DE190                                     ",
  "  [10]  0x4F                                              ",
  "  [11]  0x1E400000000                                     ",
  "  [12]  0x7FF83286B570     (SkyrimUpscaler.dll+13B570)    ",
  "}",
  "",
  "Registers",
  "{",
  "  AX:       0x7FF832848C70     (SkyrimUpscaler.dll+118C70) (void*)",
  "}",
  "",
  "Stack",
  "{",
  "  [SP+0]    0x1E43280D940      (void*)",
  "  [SP+8]    0xAAA3587920       (void*)",
  "}",
  "",
  "Modules",
  "{",
  "  SkyrimSE.exe:                                     0x7FF601D20000",
  "  KERNEL32.DLL:                                     0x7FF8D1270000",
  "  MSVCP140.dll:                                     0x7FF8B2B90000",
  "  d3d11.dll:                                        0x180000000",
  "  EngineFixes.dll:                                  0x7FF85B810000",
  "  SkyrimUpscaler.dll:                               0x7FF832730000",
  "  d3d11.dll:                                        0x7FF8CC470000",
  "}",
  "",
  "Plugins (2)",
  "{",
  "  custom_skills",
  "  {",
  '    Name: "Custom Skills"',
  "    Version: 1",
  "  }",
  "}",
];

test("real Buffout 4 log: a plugin list the logger couldn't write is not '0 plugins', and the post asks for the load order", () => {
  const { packets } = real(FO4_STACK_FAILED_PLUGINS);
  for (const venue of ["forum", "github"] as const) {
    assert.doesNotMatch(packets[venue].text, /Plugins: 0 loaded/, venue);
    assert.match(packets[venue].text, /Plugins: Buffout 4 couldn't write the list in this log\. My load order: \(fill in\)/, venue);
  }
  assert.doesNotMatch(packets.discord.text, /\b0 plugins\b/);
  assert.match(packets.discord.text, /the logger couldn't write the plugin list/);
});

test("real NetScriptFramework log with no game plugin list: the posts say it isn't listed, not that nothing is loaded", () => {
  const { packets } = real(NSF_UPSCALER);
  for (const venue of ["forum", "github"] as const) {
    assert.doesNotMatch(packets[venue].text, /Plugins: 0 loaded/, venue);
    assert.match(packets[venue].text, /Plugins: this log doesn't list them/, venue);
  }
  assert.doesNotMatch(packets.discord.text, /\b0 plugins\b/);
  assert.match(packets.discord.text, /no plugin list in the log/);
  const hidden = real(NSF_UPSCALER, { hideNames: true }).packets.forum.text;
  assert.match(hidden, /^Plugin lists left out on purpose\.$/m);
});

test("real Buffout 4 log: Fallout 4's script extender plugins are F4SE plugins, not SKSE plugins", () => {
  const { packets } = real(FO4_STACK_FAILED_PLUGINS);
  assert.match(packets.forum.text, /^F4SE plugins \(3\)$/m);
  assert.match(packets.github.text, /<details><summary>F4SE plugins \(3\)<\/summary>/);
  for (const venue of VENUES) assert.doesNotMatch(packets[venue].text, /SKSE/, venue);
});

test("real Buffout 4 log: a processor's 'CPU @ 4.10GHz' stays in the posts and is not counted as an email address", () => {
  const report = real(FO4_STACK_FAILED_PLUGINS);
  for (const venue of VENUES) {
    assert.doesNotMatch(`${report.packets[venue].title}\n${report.packets[venue].text}`, /REDACTED/, venue);
  }
  assert.match(report.packets.forum.text, /Intel\(R\) Core\(TM\) i5-10600KF CPU \(at\) 4\.10GHz/);
  assert.equal(report.redaction.total, 0);
  assert.doesNotMatch(report.redaction.summary, /email/i);
});

const NSF_SHADOWREND_STACK = [
  "Unhandled native exception occurred at 0x7FF71ED8D780 (SkyrimSE.exe+A0D780) on thread 16404!",
  "",
  "FrameworkName: NetScriptFramework",
  "FrameworkVersion: 15",
  "ApplicationName: SkyrimSE.exe",
  "ApplicationVersion: 1.5.97.0",
  "Time: 12 Jan 2024 01:16:38.295",
  "",
  "Probable callstack",
  "{",
  "  [0]   0x7FF71ED8D780     (SkyrimSE.exe+A0D780)          hkbClipGenerator::unk_A0D770+10",
  "  [1]   0x7FF71ED8E62E     (SkyrimSE.exe+A0E62E)          hkbClipGenerator::unk_A0E620+E",
  "  [2]   0x7FF71ED8E29A     (SkyrimSE.exe+A0E29A)          hkbClipGenerator::unk_A0E210+8A",
  "  [3]   0x7FF71ED8C3BA     (SkyrimSE.exe+A0C3BA)          hkbClipGenerator::unk_A0C270+14A",
  "  [4]   0x7FF71ED70069     (SkyrimSE.exe+9F0069)          hkbBehaviorGraph::unk_9EFCC0+3A9",
  "  [5]   0x7FF71EE6C31C     (SkyrimSE.exe+AEC31C)          BShkbAnimationGraph::unk_AEC270+AC",
  "  [6]   0x7FF71EE6FAAC     (SkyrimSE.exe+AEFAAC)          BShkbAnimationGraph::unk_AEF630+47C",
  "  [7]   0x7FF71EE6205A     (SkyrimSE.exe+AE205A)          BSAnimationGraphManager::unk_AE1F60+FA",
  "  [8]   0x7FF71E871198     (SkyrimSE.exe+4F1198)          IAnimationGraphManagerHolder::unk_4F1140+58",
  "  [9]   0x7FF71EA24E2C     (SkyrimSE.exe+6A4E2C)          PlayerCharacter::UpdateAnimation_6A4D90+9C",
  "  [10]  0x7FFF625C06BE     (TrueDirectionalMovement.dll+406BE)",
  "  [11]  0x7FFF62627A40     (TrueDirectionalMovement.dll+A7A40)",
  "  [12]  0x2                                               ",
  "}",
];

const NSF_SHADOWREND_OBJECTS = [
  "Possible relevant objects (2)",
  "{",
  "  [  11]    TESNPC(Name: `PLAYERNAME`, FormId: 00000007, File: `Skyrim Unbound.esp <- ccbgssse018-shadowrend.esl <- Skyrim.esm`)",
  "  [  11]    PlayerCharacter(FormId: 00000014, BaseForm: TESNPC(Name: `PLAYERNAME`, FormId: 00000007, File: `Skyrim Unbound.esp <- ccbgssse018-shadowrend.esl <- Skyrim.esm`))",
  "}",
  "",
];

const withObjects = (stack: string[], objects: string[]): string[] => [...stack.slice(0, 8), ...objects, ...stack.slice(8)];

test("real NetScriptFramework log: a faint lead is not named as the mod involved, and no author post is addressed to it", () => {
  const report = real(NSF_SHADOWREND_STACK);
  assert.equal(report.leads[0]?.name, "TrueDirectionalMovement.dll");
  assert.equal(report.leads[0]?.strength, "faint");
  const { packets } = report;
  for (const venue of ["forum", "github", "discord"] as const) assert.doesNotMatch(packets[venue].title, /involving/, venue);
  assert.doesNotMatch(packets.author.title, /TrueDirectionalMovement/);
  assert.doesNotMatch(packets.author.text, /^Hello,/);
  assert.match(packets.author.text, /TrueDirectionalMovement\.dll is only a faint lead, so there is no author to write to yet/);
});

const BEPINEX_REPO = [
  "[Message:   BepInEx] BepInEx 5.4.21.0 - REPO (23/05/2025 20:29:54)",
  "[Info   :   BepInEx] Running under Unity v2022.3.21.12519882",
  "[Message:   BepInEx] Chainloader started",
  "[Info   :   BepInEx] 1 plugins to load",
  "[Info   :   BepInEx] Loading [REPO_Translator 1.0]",
  "[Info   :REPO_Translator] Selected Translate: PTBR",
  "[Error  :REPO_Translator] WARNING: YOU HAVE ENABLED DEVMODE TRANSLATOR, DO NOT EDIT THE TRANSLATE FILE BEFORE TURNING OFF THE GAME!!!!",
  "[Error  :REPO_Translator] WARNING: YOU HAVE ENABLED DEVMODE TRANSLATOR, DO NOT EDIT THE TRANSLATE FILE BEFORE TURNING OFF THE GAME!!!!",
  "[Info   :REPO_Translator] Loaded!",
  "[Message:   BepInEx] Chainloader startup complete",
  "[Error  : Unity Log] Material 'TextMeshPro/Mobile/Distance Field (Instance)' with Shader 'TextMeshPro/Mobile/Distance Field' doesn't have a color property '_GlowColor'",
  "[Info   : Unity Log] Cancelling Steam Auth Ticket...",
  "[Info   : Unity Log] Leaving current lobby",
  "[Info   : Unity Log] [2025-05-24T15:52:22] [Info] [PunVoiceClient] [PunVoiceClient(Clone)] PunVoiceClient singleton instance is being reset because destroyed.",
];

test("real BepInEx log with errors but no exception: no post calls it a crash or an exception, and it says the game went on", () => {
  const { packets, leads } = real(BEPINEX_REPO);
  assert.equal(leads[0]?.strength, "faint");
  for (const venue of VENUES) {
    const all = `${packets[venue].title}\n${packets[venue].text}`.replaceAll("Crash Whisperer", "the tool");
    assert.doesNotMatch(all, /\bcrash(?:ed)?\b|My game stopped|unhandled exception/i, venue);
  }
  assert.match(packets.forum.text, /BepInEx logged an error that is not an exception: it names no exception type and has no stack trace\./);
  assert.match(packets.forum.text, /BepInEx wrote 3 more entries after it, so the game went on running past it\./);
  assert.equal(packets.author.title, "No mod stood out");
});

const BEPINEX_LETHAL = [
  "[Message:   BepInEx] BepInEx 5.4.21.0 - Lethal Company (11/23/2023 9:01:25 PM)",
  "[Info   :   BepInEx] Running under Unity v2022.3.9.15351836",
  "[Message:   BepInEx] Chainloader started",
  "[Info   :   BepInEx] 1 plugins to load",
  "[Info   :   BepInEx] Loading [MoreCompany 1.4.1]",
  "[Message:   BepInEx] Chainloader startup complete",
  "[Info   : Unity Log] subcribing to steam callbacks",
  "[Error  : Unity Log] NullReferenceException: Object reference not set to an instance of an object",
  "Stack trace:",
  "MoreCompany.MenuManagerLogoOverridePatch.Postfix (MenuManager __instance) (at <d5bf177559dc4b70b9f919f46304d515>:0)",
  "(wrapper dynamic-method) MenuManager.DMD<MenuManager::Awake>(MenuManager)",
  "",
  "[Info   : Unity Log] Changing gamma",
  "[Info   : Unity Log] Set version num",
  "[Info   : Unity Log] Leaving current lobby",
];

test("real BepInEx log: the author post is about an error BepInEx logged, not a stopped game, and says the game went on", () => {
  const { packets } = real(BEPINEX_LETHAL);
  assert.equal(packets.author.title, "Error that involves MoreCompany (Lethal Company)");
  assert.match(
    packets.author.text,
    /^Hello,\n\nBepInEx logged an error in my game, and a tool that reads logs \(ModWrench's Crash Whisperer\) points at MoreCompany\./
  );
  assert.doesNotMatch(packets.author.text, /My game stopped/);
  assert.match(packets.author.text, /BepInEx wrote 3 more entries after it, so the game went on running past it\./);
});

test("real BepInEx log: the posts give BepInEx's and Unity's versions and each plugin's version", () => {
  const { packets } = real(BEPINEX_LETHAL);
  for (const venue of ["forum", "github"] as const) {
    assert.match(packets[venue].text, /Log written by: BepInEx \(BepInEx 5\.4\.21\.0\)/, venue);
    assert.match(packets[venue].text, /Unity: 2022\.3\.9\.15351836/, venue);
    assert.match(packets[venue].text, /^ *MoreCompany v1\.4\.1$/m, venue);
  }
  assert.match(packets.discord.text, /\b1 plugin\b/);
  assert.doesNotMatch(packets.discord.text, /\b1 plugins\b/);
});

test("real BepInEx log: a symbol's angle brackets are shown as look-alikes that read the same, not as parentheses", () => {
  const { packets } = real(BEPINEX_LETHAL);
  for (const venue of ["forum", "github", "discord"] as const) {
    assert.match(packets[venue].text, /MenuManager\.DMD‹MenuManager::Awake›\(MenuManager\)/, venue);
    // The GitHub post's own <details> tags are the only ones.
    assert.doesNotMatch(packets[venue].text.replace(/<\/?(?:details|summary)>/g, ""), /[<>]/, venue);
  }
});

test("real NetScriptFramework log: the objects the logger lists are in the posts, with their plugins, and the player's name is not", () => {
  const report = real(withObjects(NSF_SHADOWREND_STACK, NSF_SHADOWREND_OBJECTS));
  const { packets } = report;
  // NetScriptFramework's list is every object it found in the registers and stack: at 11, these were on the stack.
  for (const venue of ["forum", "github"] as const) {
    assert.match(packets[venue].text, /Objects the logger printed beside the registers and stack \(weaker/, venue);
    assert.match(packets[venue].text, /0x00000007 TESNPC \(the player, on the stack\): Skyrim\.esm, ccbgssse018-shadowrend\.esl, Skyrim Unbound\.esp/, venue);
    assert.match(packets[venue].text, /0x00000014 PlayerCharacter \(the player, on the stack\)/, venue);
  }
  assert.match(packets.discord.text, /Objects: `0x00000007 TESNPC \(the player, on the stack\)/);
  // The player's own records count for little in the ranking, so no lead here is clear enough to write to an author about.
  assert.equal(report.leads[0]?.strength, "faint");
  assert.equal(packets.author.title, "No mod stood out");
  assert.doesNotMatch(JSON.stringify(report), /PLAYERNAME/);
});

const SSE_V111_STACK_OBJECTS = [
  "Skyrim SSE v1.6.640",
  "CrashLoggerSSE v1-11-1-0 Nov 18 2023 13:56:33",
  "",
  'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF916FCDAE5 skee64.dll+001DAE5\tmov rcx, [r8+0x20]',
  "",
  "PROBABLE CALL STACK:",
  "\t[ 0] 0x7FF916FCDAE5         skee64.dll+001DAE5\tmov rcx, [r8+0x20]",
  "",
  "STACK:",
  "\t[RSP+260] 0x16F1BA23668      (void*)",
  "\t[RSP+268] 0x16F1BA23400      (Character*)",
  "\t\tFlags: 0x00540548 ",
  '\t\tName: "Mariam"',
  "\t\tFormID: 0xFF00B40A",
  "\t\tFormType: ActorCharacter (62)",
  "\t\tObject Reference: ",
  '\t\tFile: "NPC Improvements.esp"',
  "\t\tModified by: YurianaWench.esp -> Buxom Tweaks.esp -> NPC Improvements.esp",
  "\t\tFlags: 0x00400009 kDestructible | kInitialized",
  '\t\tName: "Mariam"',
  '\t\tEditorID: "YW_BuxomWench_ZZ_SubjugatedW14_extraFguard_archer"',
  "\t\tFormID: 0x196DEC6B",
  "\t\tFormType: NPC (43)",
  "\t[RSP+270] 0x7FF74F4D2648     (void* -> SkyrimSE.exe+3092648\tadd [rax], al)",
  "",
];

test("real Crash Logger SSE v1.11 log: objects printed on the stack are in the posts, marked as weaker", () => {
  const { packets } = real(SSE_V111_STACK_OBJECTS);
  assert.match(packets.forum.text, /Objects the logger printed beside the registers and stack \(weaker:/);
  assert.match(packets.forum.text, /0x196DEC6B NPC "Mariam" \(on the stack\): YurianaWench\.esp, Buxom Tweaks\.esp, NPC Improvements\.esp/);
});

test("hideNames leaves the plugin lists out, and what the log names stays: an object with every plugin that changed it", () => {
  // As the hideNames description and TRUST.md say: the check box leaves out the lists, not what the log itself names.
  const text = real(SSE_V111_STACK_OBJECTS, { hideNames: true }).packets.forum.text;
  assert.match(text, /^Plugin lists left out on purpose/m);
  assert.match(text, /0x196DEC6B NPC "Mariam" \(on the stack\): YurianaWench\.esp, Buxom Tweaks\.esp, NPC Improvements\.esp/);
});

const NSF_D6DDDA = [
  "Unhandled native exception occurred at 0x7FF60DB5DDDA (SkyrimSE.exe+D6DDDA) on thread 13752!",
  "",
  "FrameworkName: NetScriptFramework",
  "FrameworkVersion: 15",
  "ApplicationName: SkyrimSE.exe",
  "ApplicationVersion: 1.5.97.0",
  "Time: 22 Jan 2024 22:14:07.013",
  "",
  "Probable callstack",
  "{",
  "  [0]   0x7FF60DB5DDDA     (SkyrimSE.exe+D6DDDA)          unk_D6DD70+6A",
  "  [1]   0x7FF60E1183B5     (SkyrimSE.exe+13283B5)         unk_1328370+45",
  "  [2]   0x7FF60DA58CEF     (SkyrimSE.exe+C68CEF)          unk_C68BA0+14F",
  "  [3]   0x7FF60DB2A58E     (SkyrimSE.exe+D3A58E)          unk_D3A4D0+BE",
  "  [4]   0x7FF60D30E646     (SkyrimSE.exe+51E646)          unk_51E440+206",
  "  [5]   0x7FF60DB29445     (SkyrimSE.exe+D39445)          unk_D392B0+195",
  "  [6]   0x7FF60E085D93     (SkyrimSE.exe+1295D93)         unk_1295C30+163",
  "  [7]   0x7FF60E0D53DE     (SkyrimSE.exe+12E53DE)         BSShaderTextureSet::SetTexture_12E5390+4E",
  "  [8]   0x7FF60E0BF537     (SkyrimSE.exe+12CF537)         BSLightingShaderMaterialBase::OnLoadTextureSet_12CF480+B7",
  "  [9]   0x7FF60E0B4E76     (SkyrimSE.exe+12C4E76)         BSLightingShaderProperty::unk_12C4CC0+1B6",
  "  [10]  0x7FF60DA4BD71     (SkyrimSE.exe+C5BD71)          NiStream::Func15_C5BA80+2F1",
  "  [11]  0x7FF60DA49FBE     (SkyrimSE.exe+C59FBE)          NiStream::Func1_C59F90+2E",
  "  [12]  0x7FF60DB269D8     (SkyrimSE.exe+D369D8)          BSStream::unk_D36950+88",
  "  [13]  0x7FF60D29CEAA     (SkyrimSE.exe+4ACEAA)          LoadBTRMesh_4ACDC0+EA",
  "  [14]  0x7FF60D2A11F8     (SkyrimSE.exe+4B11F8)          unk_4B1030+1C8",
  "  [15]  0x7FF60D2A139A     (SkyrimSE.exe+4B139A)          unk_4B1270+12A",
  "  [16]  0x7FF60D29F030     (SkyrimSE.exe+4AF030)          unk_4AEEE0+150",
  "  [17]  0x7FF60D2A0750     (SkyrimSE.exe+4B0750)          BSResource::EntryDB<BGSBtrDB::DBTraits>::Func3_4B0720+30",
  "  [22]  0x7FF988A57344     (KERNEL32.DLL+17344)           ",
  "  [23]  0x7FF98A9A26B1     (ntdll.dll+526B1)              ",
  "}",
  "",
  "Registers",
  "{",
  "  AX:       0x0                (NULL)",
  "  IP:       0x7FF60DB5DDDA     (SkyrimSE.exe+D6DDDA) (void*)",
  "}",
  "",
  "Stack",
  "{",
  "  [SP+0]    0xFFFFFFFF00000001 (i64):[-4294967295]",
  String.raw`  [SP+198]  0x2DA0E173ED8      (char*) "textures\terrain\tamriel\skyrim.dds"`,
  String.raw`  [SP+1E0]  0x2DA0E173ED8      (char*) "textures\terrain\tamriel\skyrim.dds"`,
  String.raw`  [SP+760]  0x2D97CAF52C8      (char*) "Meshes\Terrain\Tamriel\Tamriel.32.0.0.BTR"`,
  "}",
];

test("real NetScriptFramework log: the game files named on the stack are in the posts", () => {
  const { packets } = real(NSF_D6DDDA);
  for (const venue of ["forum", "github"] as const) {
    assert.match(packets[venue].text, /Game files named in the registers and stack/, venue);
    assert.match(packets[venue].text, /textures\\terrain\\tamriel\\skyrim\.dds/, venue);
    assert.match(packets[venue].text, /Meshes\\Terrain\\Tamriel\\Tamriel\.32\.0\.0\.BTR/, venue);
  }
  assert.match(packets.discord.text, /Files: `textures\\terrain\\tamriel\\skyrim\.dds; /);
});

test("real NetScriptFramework log: the title carries the crash address, and the stack shows 14 frames where the plan allows 14", () => {
  const { packets } = real(NSF_D6DDDA);
  assert.equal(packets.forum.title, "Skyrim Special Edition 1.5.97.0: crash at SkyrimSE.exe+D6DDDA");
  for (const venue of ["forum", "github"] as const) {
    assert.match(packets[venue].text, /Call stack \(14 of 20 frames\)/, venue);
    assert.match(packets[venue].text, /\[13\] SkyrimSE\.exe\+4ACEAA {2}LoadBTRMesh_4ACDC0\+EA/, venue);
  }
});

test("real Buffout 4 log: a game frame keeps its Address Library id in the posts, and the register types name the object", () => {
  const { packets } = real(FO4_STACK_FAILED_PLUGINS);
  for (const venue of ["forum", "github", "discord"] as const) {
    assert.match(packets[venue].text, /\[0\] Fallout4\.exe\+16B95BE -> 1242880\+0x1FE/, venue);
  }
  for (const venue of ["forum", "github"] as const) {
    assert.match(packets[venue].text, /Object types in the registers/, venue);
    assert.match(packets[venue].text, /R11 hknpStreamContactSolver\*/, venue);
    assert.doesNotMatch(packets[venue].text, /size_t|void\*/, venue);
  }
  // A type's "*" sits in code in the Discord message, where it can't start italics.
  assert.match(packets.discord.text, /^Types: `R11 hknpStreamContactSolver\*`$/m);
});

test("real NetScriptFramework log: the Papyrus functions on the stack are in the posts", () => {
  const { packets } = real([
    "Unhandled native exception occurred at 0x7FFDDAACAE45 (JContainers64.dll+10AE45) on thread 10564!",
    "",
    "FrameworkName: NetScriptFramework",
    "FrameworkVersion: 15",
    "ApplicationName: SkyrimSE.exe",
    "ApplicationVersion: 1.5.97.0",
    "",
    "Probable callstack",
    "{",
    "  [0]   0x7FFDDAACAE45     (JContainers64.dll+10AE45)     ",
    "}",
    "",
    "Stack",
    "{",
    "  [SP+4C8]  0x14584E0700       (BSScript::Internal::ScriptFunction*) -> (File: JValue.psc, Type: JValue, Name: GotoState)",
    "  [SP+A98]  0x8627F5C0         (BSScript::Internal::CodeTasklet**) -> (Function: BSScript::Internal::ScriptFunction(File: empdqfbhivdffaoslryamit, Type: metaSkillMenuScript, Name: load_data))",
    "  [SP+C48]  0x8627A580         (BSScript::NativeFunction2<Actor, bool, SpellItem*, bool>**) -> (File: <native>, Type: Actor, Name: AddSpell)",
    "}",
  ]);
  for (const venue of ["forum", "github", "author"] as const) {
    assert.match(packets[venue].text, /Papyrus functions named in the registers and stack/, venue);
    assert.match(packets[venue].text, /metaSkillMenuScript\.load_data/, venue);
    assert.match(packets[venue].text, /Actor\.AddSpell \(native\)/, venue);
  }
  assert.match(packets.discord.text, /^Papyrus: `JValue\.GotoState; metaSkillMenuScript\.load_data; Actor\.AddSpell \(native\)`$/m);
});

test("real NetScriptFramework log: its module list stands in for the SKSE plugin list, without Windows' own libraries", () => {
  const { packets } = real(NSF_UPSCALER);
  assert.match(packets.forum.text, /^DLLs loaded \(5 of 7; the Windows libraries ModWrench knows are left out\)$/m);
  assert.match(packets.forum.text, /^ {4}d3d11\.dll 0x180000000$/m);
  assert.match(packets.forum.text, /^ {4}SkyrimUpscaler\.dll 0x7FF832730000$/m);
  assert.doesNotMatch(packets.forum.text, /KERNEL32|MSVCP140/);
  assert.match(packets.github.text, /<details><summary>DLLs loaded \(5 of 7; the Windows libraries ModWrench knows are left out\)<\/summary>/);
  assert.doesNotMatch(real(NSF_UPSCALER, { hideNames: true }).packets.forum.text, /DLLs loaded|EngineFixes/);
});

test("real NetScriptFramework log: a run of stack values in no module is one row, not a column of '(unknown)'", () => {
  const { packets } = real(NSF_UPSCALER);
  for (const venue of ["forum", "github", "discord"] as const) {
    assert.match(packets[venue].text, /\[1\]-\[7\] \(7 addresses in no module\) {2}\(stack scan\)/, venue);
    assert.doesNotMatch(packets[venue].text, /\(unknown\)/, venue);
  }
});

test("real NetScriptFramework log: square brackets and doubled spaces in plugin names, and the footer says how names are shown", () => {
  const { packets } = real([
    "Unhandled native exception occurred at 0x7FFDDAACAE45 (JContainers64.dll+10AE45) on thread 10564!",
    "",
    "FrameworkName: NetScriptFramework",
    "ApplicationName: SkyrimSE.exe",
    "ApplicationVersion: 1.5.97.0",
    "",
    "Probable callstack",
    "{",
    "  [0]   0x7FFDDAACAE45     (JContainers64.dll+10AE45)     ",
    "}",
    "",
    "Game plugins (3)",
    "{",
    "  [00] Skyrim.esm",
    "  [8A] Deadly Shadows of  Riften.esp",
    "  [FE 0C6] [xPatch] Modpocalypse NPCs (v3) SSE - AI Overhaul.esp",
    "}",
  ]);
  for (const venue of ["forum", "github", "author"] as const) {
    assert.doesNotMatch(packets[venue].text, /as the log wrote them\./, venue);
    assert.match(
      packets[venue].text,
      /Mod and file names are as the log wrote them, except that square brackets are shown as round ones, angle brackets and backticks as look-alikes, the at sign as \(at\), and runs of spaces as one space, so that no name can turn into markup or a ping\./,
      venue
    );
  }
  assert.match(packets.forum.text, /\(xPatch\) Modpocalypse NPCs \(v3\) SSE - AI Overhaul\.esp/);
});

// ─── What the answer knows, in the posts ─────────────────────────────────────

test("real Buffout 4 log with no lead and no objects: the posts don't speak of objects the log never listed", () => {
  const { packets } = real(FO4_STACK_FAILED_PLUGINS);
  for (const venue of ["forum", "github"] as const) {
    assert.match(
      packets[venue].text,
      /No mod stood out: nothing from a mod was on the call stack, and the log lists no objects the game was working with\./,
      venue
    );
    assert.doesNotMatch(packets[venue].text, /among the objects involved/, venue);
  }
});

test("with no lead, objects that come only from the game's own plugins are said to be that", () => {
  // Crash Logger SSE v1.11's "Armature" on the stack, from crash-2023-12-11-02-34-31.log.
  const { packets } = build({
    leads: [],
    log: { callStack: [], suspectedRefs: [{ type: "formid", value: "0x0003CA03", origin: "stack", kind: "Armature", plugins: ["Skyrim.esm"] }] },
  });
  for (const venue of ["forum", "github"] as const) {
    assert.match(
      packets[venue].text,
      /No mod stood out: nothing from a mod was on the call stack, and none of the objects the log lists comes from a mod's plugin\./,
      venue
    );
  }
});

test("a BepInEx log with no lead says no mod that loaded is named, and an error with no type is an error", () => {
  // An error with a stack trace but no exception type in its message.
  const d = data({ format: "bepinex", extenders: [], leads: [], log: { callStack: [], lastError: { exception: true, entriesAfter: 0 } } });
  delete d.exceptionType;
  delete d.exceptionPlain;
  const { packets } = buildPackets(d, { ownNames: false });
  for (const venue of ["forum", "github"] as const) {
    assert.match(packets[venue].text, /No mod stood out: no mod that loaded is named in what BepInEx logged\./, venue);
    assert.doesNotMatch(packets[venue].text, /call stack, or|unhandled exception/, venue);
  }
  assert.match(packets.forum.text, /^What happened\nBepInEx logged an error\./);
});

test("real BepInEx log with no errors in it: the posts don't say BepInEx logged one", () => {
  // The Lethal Company log's start, before its first error.
  const { packets } = real(BEPINEX_LETHAL.slice(0, 7));
  for (const venue of ["forum", "github"] as const) {
    assert.match(packets[venue].text, /This BepInEx log has no errors in it, so it doesn't say why the game closed\./, venue);
    assert.doesNotMatch(packets[venue].text, /BepInEx logged an? /, venue);
  }
});

// Crash Logger SSE v1.11, crash-2023-12-11-02-34-31.log: the game stopped inside RaceMenu's skee64.dll, called by OBody.
const SSE_RACEMENU = [
  "Skyrim SSE v1.6.640",
  "CrashLoggerSSE v1-11-1-0 Nov 18 2023 13:56:33",
  "",
  'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF91ADEEAB4 skee64.dll+001EAB4\tmov rbx, [rsi+rax*8+0x08]',
  "",
  "PROBABLE CALL STACK:",
  "\t[ 0] 0x7FF91ADEEAB4   skee64.dll+001EAB4",
  "\t[ 1] 0x7FF91ADEDA81   skee64.dll+001DA81",
  "\t[ 2] 0x7FF91ADDC3FE   skee64.dll+000C3FE",
  "\t[ 3] 0x7FF91ADDBF38   skee64.dll+000BF38",
  "\t[ 4] 0x7FF91AE4EC67   skee64.dll+007EC67",
  "\t[ 5] 0x7FF91ADD83E2   skee64.dll+00083E2",
  "\t[ 6] 0x7FF929731D32    OBody.dll+0001D32",
  "\t[ 7] 0x7FF92973741E    OBody.dll+000741E",
  "\t[ 8] 0x7FFA371B9363 ucrtbase.dll+0029363",
  "\t[ 9] 0x7FFA3939257D KERNEL32.DLL+001257D",
  "\t[10] 0x7FFA3962AA58    ntdll.dll+005AA58",
  "",
];

test("real Crash Logger SSE log inside RaceMenu: the posts name the mod a well-known DLL comes with", () => {
  const { packets } = real(SSE_RACEMENU);
  assert.match(packets.forum.text, /^1\. skee64\.dll \(RaceMenu\) \(strong lead\): /m);
  assert.match(packets.forum.text, /^2\. OBody\.dll \(OBody\) \(possible lead\): /m);
  assert.match(packets.github.text, /^1\. `skee64\.dll` \(RaceMenu\) \(strong\): /m);
  assert.match(packets.discord.text, /Top lead: skee64\.dll \(RaceMenu\) \(strong\)\. .* Also: OBody\.dll \(OBody\) \(possible\)\./);
});

test("real Crash Logger SSE log inside RaceMenu: the author post says it stopped inside a library others call, and names the mod that called it", () => {
  const { packets } = real(SSE_RACEMENU);
  assert.match(
    packets.author.text,
    /^Hello,\n\nMy game stopped inside skee64\.dll \(RaceMenu\), a library other mods call\. A tool that reads crash logs \(ModWrench's Crash Whisperer\) names OBody\.dll \(OBody\), a possible lead, as the mod that may have called it: a crash inside a library like this can come from what the mod calling it asked of it\./
  );
  assert.doesNotMatch(packets.author.text, /points at skee64\.dll/);
  // With no other mod's code under it, the post says the log doesn't show the caller.
  const alone = real(SSE_RACEMENU.filter((line) => !line.includes("OBody")));
  assert.match(alone.packets.author.text, /My game stopped inside skee64\.dll \(RaceMenu\), a library other mods call\. .*The call stack doesn't show which mod called it\./s);
});

// NetScriptFramework v15, "USVFS Crash_2023_3_26_15-19-9.txt": a jump to a broken address, then Mod Organizer 2's usvfs,
// a run of stack values, a d3d11.dll at 0x180000000 that the module list names twice, then the game's own frames.
const NSF_USVFS = [
  "Unhandled native exception occurred at 0xFFFFFF0024A48D48 on thread 26780!",
  "",
  "FrameworkName: NetScriptFramework",
  "FrameworkVersion: 15",
  "FrameworkArchitecture: x64",
  "GameLibrary: SkyrimSE",
  "GameLibraryVersion: 18",
  "ApplicationName: SkyrimSE.exe",
  "ApplicationVersion: 1.5.97.0",
  "VersionInfo: Successfully loaded",
  "Time: 26 Mar 2023 15:19:09.866",
  "",
  "Probable callstack",
  "{",
  "  [0]   0xFFFFFF0024A48D48                                ",
  "  [1]   0x7FF89674C8AE     (usvfs_x64.dll+4C8AE)          ",
  "  [2]   0x7FF8C000049C                                    ",
  "  [3]   0x27B18B7BE60                                     ",
  "  [4]   0x27B00000000                                     ",
  "  [5]   0x1                                               ",
  "  [6]   0xBA1CEFDFD0                                      ",
  "  [7]   0x5A0058                                          ",
  "  [8]   0x27B18B7BE60                                     ",
  "  [9]   0x1                                               ",
  "  [10]  0x18015EF1E        (d3d11.dll+15EF1E)             ",
  "  [11]  0x18004A15F        (d3d11.dll+4A15F)              ",
  "  [12]  0x18004BC17        (d3d11.dll+4BC17)              ",
  "  [13]  0x1800A424F        (d3d11.dll+A424F)              ",
  "  [14]  0x18005710D        (d3d11.dll+5710D)              ",
  "  [15]  0x180057201        (d3d11.dll+57201)              ",
  "  [16]  0x7FF748BBF870     (SkyrimSE.exe+D6F870)          unk_D6F6E0+190",
  "  [17]  0x7FF74916F89F     (SkyrimSE.exe+131F89F)         BSShader::unk_131F810+8F",
  "  [18]  0x7FF7490E45B0     (SkyrimSE.exe+12945B0)         unk_1294060+550",
  "  [19]  0x7FF7484006F6     (SkyrimSE.exe+5B06F6)          unk_5B05A0+156",
  "  [20]  0x7FF7483FE9E9     (SkyrimSE.exe+5AE9E9)          unk_5AE010+9D9",
  "  [21]  0x7FF7483FCBE7     (SkyrimSE.exe+5ACBE7)          BSGeometryListCullingProcess::unk_5ACBD0+17",
  "  [22]  0x7FF74919B17A     (SkyrimSE.exe+134B17A)         unk_134B05C+11E",
  "  [23]  0x7FF8E62955A0     (KERNEL32.DLL+155A0)           ",
  "  [24]  0x7FF8E818485B     (ntdll.dll+485B)               ",
  "}",
  "",
  "Modules",
  "{",
  "  SkyrimSE.exe:                                     0x7FF747E50000",
  "  d3d11.dll:                                        0x180000000",
  "  usvfs_x64.dll:                                    0x7FF896700000",
  "  d3d11.dll:                                        0x7FF8DE8A0000",
  "}",
];

test("real NetScriptFramework log: a run of frames in no module takes one row, so the game's frames after it still fit", () => {
  const r = real(NSF_USVFS);
  for (const venue of ["forum", "github"] as const) {
    const text = r.packets[venue].text;
    assert.match(text, /Call stack \(19 of 23 frames\)/, venue);
    assert.match(text, /\[2\]-\[8\] \(6 addresses in no module\)/, venue);
    assert.match(text, /\[16\] SkyrimSE\.exe\+D6F870 {2}unk_D6F6E0\+190/, venue);
    assert.match(text, /\[20\] SkyrimSE\.exe\+5AE9E9 {2}unk_5AE010\+9D9/, venue);
    assert.doesNotMatch(text, /\[21\]/, venue);
  }
  // The short plans count rows the same way.
  assert.match(r.packets.discord.text, /\[2\]-\[8\] \(6 addresses in no module\)/);
  assert.equal(r.crash.frames.at(-1)?.index, 20);
});

test("real NetScriptFramework log stopped at a broken address: the posts give the address and the first frame the log can place", () => {
  const { packets } = real(NSF_USVFS);
  for (const venue of ["forum", "github"] as const) {
    assert.match(
      packets[venue].text,
      /It stopped at frame 0, at 0xFFFFFF0024A48D48, an address where no code can be: something jumped to a broken address\. The first frame the log can place is frame 1, usvfs_x64\.dll\+4C8AE \(Mod Organizer 2's virtual file system\)\./,
      venue
    );
    assert.doesNotMatch(packets[venue].text, /It stopped at an address in no module/, venue);
    // On the call stack, the first frame of a module ModWrench knows says what it is, once.
    assert.match(packets[venue].text, /^(?: {4})?\[1\] usvfs_x64\.dll\+4C8AE {2}\(Mod Organizer 2's virtual file system\)$/m, venue);
    assert.match(packets[venue].text, /^(?: {4})?\[10\] d3d11\.dll\+15EF1E {2}\(Windows' own d3d11\.dll or a graphics mod's copy of it: the log lists 2\)$/m, venue);
    assert.match(packets[venue].text, /^(?: {4})?\[11\] d3d11\.dll\+4A15F$/m, venue);
  }
  assert.match(packets.discord.text, /^Stopped at 0xFFFFFF0024A48D48, an address in no module\. No mod stood out\.$/m);
});

// Buffout 4 v1.36.0, FO4/crash-12624.log: the game stopped inside NVIDIA FleX.
const FO4_FLEX = [
  "Fallout 4 v1.10.984",
  "Buffout 4 v1.36.0 Oct 13 2024 01:09:30",
  "",
  'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FFEFDE07AE3 flexRelease_x64.dll+0027AE3\trep stosb',
  "Exception Flags: 0x00000000",
  "Number of Parameters: 2",
  "Access Violation: Tried to write memory at 0x000000000000",
  "",
  "PROBABLE CALL STACK:",
  "\t[0] 0x7FFEFDE07AE3 flexRelease_x64.dll+0027AE3",
  "\t[1] 0x02852D9CBBD0                    ",
  "",
];

test("real Buffout 4 log inside NVIDIA FleX: the posts say what FleX is", () => {
  const { packets } = real(FO4_FLEX);
  for (const venue of ["forum", "github"] as const) {
    assert.match(packets[venue].text, /It stopped at flexRelease_x64\.dll\+0027AE3 \(frame 0\), in NVIDIA FleX, which Fallout 4 uses for its Weapon Debris effect\./, venue);
  }
  assert.match(packets.discord.text, /^\[0\] flexRelease_x64\.dll\+0027AE3 {2}\(NVIDIA FleX, which Fallout 4 uses for its Weapon Debris effect\)$/m);
});

test("the posts name the same game files as the answer: no plugin, which is among the objects, and no piece of a file name", () => {
  // crash-12624.log's stack holds "_msn.DDS", the end of a texture's name, not a file.
  const flex = real([...FO4_FLEX, "STACK:", '\t[RSP+710] 0x285CD58E401      (char*) "_msn.DDS"', ""]);
  for (const venue of VENUES) assert.doesNotMatch(flex.packets[venue].text, /_msn|Game files named|Files:/, venue);
  // crash-2023-12-10-13-03-48.log's stack names a mesh, and a plugin on an object's File line.
  const sse = real([
    "Skyrim SSE v1.6.640",
    "CrashLoggerSSE v1-11-1-0 Nov 18 2023 13:56:33",
    "",
    'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF916FCDAE5 skee64.dll+001DAE5\tmov rcx, [r8+0x20]',
    "",
    "PROBABLE CALL STACK:",
    "\t[ 0] 0x7FF916FCDAE5         skee64.dll+001DAE5\tmov rcx, [r8+0x20]",
    "",
    "STACK:",
    "\t" + String.raw`[RSP+1E8] 0x1719EF2EDB0      (char*) "meshes\armor\yurianawench\nordbootsf.tri"`,
    "\t[RSP+368] 0x16EF2241C00      (TESObjectARMA*)",
    '\t\tFile: "AOS-ISC Patcher.esp"',
    "\t\tFormID: 0xFE1B880A",
    "\t\tFormType: Armature (102)",
    "",
  ]);
  assert.deepEqual(sse.crash.context?.files, [String.raw`meshes\armor\yurianawench\nordbootsf.tri`]);
  assert.match(sse.packets.forum.text, /^Game files named in the registers and stack\n {4}meshes\\armor\\yurianawench\\nordbootsf\.tri\n\n/m);
  assert.match(sse.packets.discord.text, /^Files: `meshes\\armor\\yurianawench\\nordbootsf\.tri`$/m);
});
