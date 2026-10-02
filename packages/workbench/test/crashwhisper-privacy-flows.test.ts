import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { whisper } from "../src/crashwhisper/index.js";
import { createSandbox } from "./helpers/world.js";
import {
  API_VALUE,
  BEARER,
  EMAIL,
  GITHUB,
  everythingOut,
  fixture,
  found,
  LAN_IP,
  ok,
  options,
  PEER_IP,
  PERSON,
  PUBLIC_IP,
  STEAM_ID,
  valuesOf,
} from "./helpers/person.js";

// Planting personal details on lines nothing reads is easy to pass: a log's free text never reaches the
// answer. These tests put them where a log's own words DO reach it (the logger's version line, the
// hardware lines, the function names on the call stack, the message of a C++ exception, a BepInEx
// plugin's load error, the game's name) and first prove, with a harmless marker, that each of those
// places really does reach the answer. A place that stops reaching it fails the first test, so the
// second can never quietly stop testing anything.

const sandbox = createSandbox("mw-crashflows-");
before(() => sandbox.start());
afterEach(() => sandbox.isolate());
after(() => sandbox.stop());

const MARK = "FLOWMARK";

type Channel = {
  id: string;
  file: string;
  /** Does it reach what the player is handed outside the help packets, or only the packets? */
  reaches: "answer" | "packets";
  put: (text: string, payload: string) => string;
};

const swap = (from: string | RegExp, to: (p: string) => string) => (text: string, payload: string): string => {
  const out = text.replace(from, () => to(payload));
  assert.notEqual(out, text, `nothing to replace for ${String(from)}`);
  return out;
};

const SSE = "crash-sse-real-format.log";
const BEP = "LogOutput-real-format.log";
const BUF = "crash-buffout4.log";
const NSF = "crash-netscriptframework.log";

const CPP_EXCEPTION = (info: string): string =>
  `C++ EXCEPTION:\n\tType: std::runtime_error\n\tInfo: ${info}\n\tThrow Location: 0x7FFAF1BF3A41 CloakAndDaggerFix.dll+0003A41\n\tModule: CloakAndDaggerFix.dll\n\nPROCESS INFO:`;

const CHANNELS: Channel[] = [
  // Crash Logger SSE
  { id: "sse: the logger's version line", file: SSE, reaches: "answer", put: swap("Feb 10 2026 04:25:35", (p) => `Feb 10 2026 04:25:35 ${p}`) },
  { id: "sse: the operating system", file: SSE, reaches: "answer", put: swap("OS: Windows 11 Pro v10.0.22631", (p) => `OS: Windows 11 Pro v10.0.22631 ${p}`) },
  { id: "sse: the processor", file: SSE, reaches: "answer", put: swap("Ryzen 7 5800X 8-Core Processor", (p) => `Ryzen 7 5800X 8-Core Processor ${p}`) },
  { id: "sse: the graphics card", file: SSE, reaches: "answer", put: swap("NVIDIA GeForce RTX 3070", (p) => `NVIDIA GeForce RTX 3070 ${p}`) },
  { id: "sse: a function name on the call stack", file: SSE, reaches: "answer", put: swap("CloakAndDaggerFix::Hooks::OnEquip", (p) => `CloakAndDaggerFix::Hooks::OnEquip ${p}`) },
  { id: "sse: the exception's name", file: SSE, reaches: "answer", put: swap('"EXCEPTION_ACCESS_VIOLATION"', (p) => `"EXCEPTION_ACCESS_VIOLATION ${p}"`) },
  { id: "sse: the game's name", file: SSE, reaches: "answer", put: swap("Skyrim SSE v1.6.1170", (p) => `Skyrim ${p} v1.6.1170`) },
  {
    id: "sse: the message of a C++ exception",
    file: SSE,
    reaches: "answer",
    put: (text, p) =>
      text
        .replace(/^Unhandled exception.*$/m, 'Unhandled exception "Microsoft C++ Exception (0xE06D7363)" at 0x7FFB5E22A7B0 KERNELBASE.dll+00BE8D')
        .replace("PROCESS INFO:", CPP_EXCEPTION(p)),
  },
  { id: "sse: a plugin's name", file: SSE, reaches: "packets", put: swap("[FE:001] ccBGSSSE001-Fish.esl", (p) => `[FE:001] ${p}.esl`) },
  { id: "sse: a script extender plugin's name", file: SSE, reaches: "packets", put: swap("SomeUnrelatedPlugin.dll v2.0.1", (p) => `SomeUnrelatedPlugin.dll v2.0.1\n\t${p}.dll v1.0`) },

  // BepInEx
  { id: "bepinex: the game's name", file: BEP, reaches: "answer", put: swap("Lethal Company (1/15/2024", (p) => `${p} (1/15/2024`) },
  {
    id: "bepinex: a missing dependency",
    file: BEP,
    reaches: "answer",
    put: swap("missing dependencies: x753.Lethal_Company_Variables (1.0.0).", (p) => `missing dependencies: ${p} (1.0.0).`),
  },
  { id: "bepinex: why a plugin failed to load", file: BEP, reaches: "answer", put: swap("Could not find assembly 0Harmony", (p) => `Could not find assembly ${p}`) },
  { id: "bepinex: the exception's name", file: BEP, reaches: "answer", put: swap("IndexOutOfRangeException:", (p) => `${p}Exception:`) },
  { id: "bepinex: a method on the stack", file: BEP, reaches: "answer", put: swap("LethalConfig.UI.ConfigMenu.Refresh ()", (p) => `LethalConfig.UI.ConfigMenu.Refresh () (at ${p}:42)`) },
  { id: "bepinex: a plugin's name", file: BEP, reaches: "packets", put: swap("Loading [LethalConfig 1.4.2]", (p) => `Loading [${p} 1.4.2]`) },

  // Buffout 4
  { id: "buffout: the logger's version line", file: BUF, reaches: "answer", put: swap("Buffout 4 v1.36.0", (p) => `Buffout 4 v1.36.0 ${p}`) },
  { id: "buffout: the operating system", file: BUF, reaches: "answer", put: swap("OS: Microsoft Windows 11 Pro", (p) => `OS: Microsoft Windows 11 Pro ${p}`) },
  { id: "buffout: a frame on the call stack", file: BUF, reaches: "answer", put: swap("SomeMod.dll+ABCD", (p) => `SomeMod.dll+ABCD ${p}`) },
  { id: "buffout: a plugin's name", file: BUF, reaches: "packets", put: swap("SomeESL.esl", (p) => `${p}.esl`) },

  // NetScriptFramework
  { id: "netscriptframework: the application line", file: NSF, reaches: "answer", put: swap("Application: SkyrimSE.exe", (p) => `Application: SkyrimSE.exe ${p}`) },
  { id: "netscriptframework: a frame on the call stack", file: NSF, reaches: "answer", put: swap("(SomeMod.dll+12345)", (p) => `(SomeMod.dll+12345) ${p}`) },
  { id: "netscriptframework: a plugin's name", file: NSF, reaches: "packets", put: swap("(10) SkyUI.esp", (p) => `(10) ${p}.esp`) },
];

/** What a log might print on a line of its own words. Nothing here has a quote or a bracket, so it can go inside either. */
const PAYLOADS: Array<{ id: string; text: string }> = [
  { id: "a Windows folder", text: `C:\\Users\\${PERSON.name}\\Documents\\My Games\\Skyrim Special Edition\\SecretFolder\\Thing.dll` },
  { id: "a Linux home folder", text: `/home/${PERSON.account}/.local/share/PrivateFolder/Other.dll` },
  { id: "a network share", text: "\\\\NAS-HOME\\Share-Private\\Skyrim\\file.esp" },
  { id: "the account name", text: `by ${PERSON.name} (${PERSON.account})` },
  { id: "the computer name", text: `on ${PERSON.machine}` },
  { id: "an address with a port", text: `connecting to ${PUBLIC_IP}:27015` },
  { id: "addresses after a word", text: `server ${PEER_IP} local ${LAN_IP}` },
  { id: "an email address", text: `reported by ${EMAIL}` },
  { id: "a token", text: `token = ${GITHUB}` },
  { id: "an authorization header", text: `Authorization: Bearer ${BEARER}` },
  { id: "an api key", text: `api_key = ${API_VALUE}` },
  { id: "an account ID", text: `steam ${STEAM_ID}` },
];

const run = (text: string): ReturnType<typeof ok> => ok(whisper({ logContent: text, ...options() }));

for (const channel of CHANNELS) {
  test(`${channel.id}: it really does reach the answer`, () => {
    const report = run(channel.put(fixture(channel.file), MARK));
    const outside = [...valuesOf({ ...report, packets: undefined }), ...valuesOf(everythingOut(report).text)].join("\n");
    const inPackets = Object.values(report.packets).map((p) => p.text).join("\n");
    if (channel.reaches === "answer") {
      assert.ok(outside.includes(MARK), "the marker should come out in the structured answer or the text, not only in a packet");
    } else {
      assert.ok(inPackets.includes(MARK), "the marker should come out in a packet");
    }
  });

  test(`${channel.id}: nothing personal put there comes out`, () => {
    for (const payload of PAYLOADS) {
      const report = run(channel.put(fixture(channel.file), payload.text));
      for (const [where, text] of Object.entries(everythingOut(report))) {
        assert.deepEqual(found(text), [], `${payload.id}: ${where} still carries something personal`);
      }
    }
  });
}

test("the places tested include the ones that go straight to the AI, not only the ones that go into a packet", () => {
  assert.ok(CHANNELS.filter((c) => c.reaches === "answer").length >= 15);
  assert.ok(CHANNELS.filter((c) => c.reaches === "packets").length >= 4);
  assert.deepEqual(new Set(CHANNELS.map((c) => c.file)), new Set([SSE, BEP, BUF, NSF]));
});

test("a name given to the redactor is removed whether it comes with its case changed or not", () => {
  const upper = PERSON.name.toUpperCase();
  const report = run(swap("OS: Windows 11 Pro v10.0.22631", (p) => `OS: Windows 11 Pro v10.0.22631 ${p}`)(fixture(SSE), `${upper} / ${PERSON.machine.toLowerCase()}`));
  for (const [where, text] of Object.entries(everythingOut(report))) {
    assert.ok(!text.toLowerCase().includes(PERSON.name.toLowerCase()), where);
    assert.ok(!text.toLowerCase().includes(PERSON.machine.toLowerCase()), where);
  }
});

test("a very large UTF-16 log: the end of it is read as text, and what is personal there still does not come out", () => {
  const w = sandbox.makeWorld();
  const filler = `[Debug  :MoreCompany] Syncing cosmetics ${"x".repeat(100)}\n`;
  const middle = filler.repeat(Math.ceil((7 * 1024 * 1024) / filler.length)); // 7M characters = 14 MB as UTF-16
  const personal = [
    `C:\\Users\\${PERSON.name}\\Documents\\SecretFolder\\Thing.dll`,
    `/home/${PERSON.account}/.local/share/PrivateFolder/Other.dll`,
    `on ${PERSON.machine} connecting to ${PUBLIC_IP}:27015`,
    `reported by ${EMAIL} token = ${GITHUB}`,
  ].join(" | ");
  const reportFor = (payload: string): ReturnType<typeof ok> => {
    const log = fixture(BEP)
      .replace("[Debug  :MoreCompany] Syncing cosmetics", () => `${middle}[Debug  :MoreCompany] Syncing cosmetics`)
      .replace("LethalConfig.UI.ConfigMenu.Refresh ()", () => `LethalConfig.UI.ConfigMenu.Refresh () (at ${payload}:42)`);
    const path = join(w.root, "big-utf16", "LogOutput.log");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(log, "utf16le")]));
    return ok(whisper({ logPath: path, ...options() }));
  };

  // First prove the place is live: a harmless marker put there comes out, so the file's end was read as text.
  const marked = reportFor(MARK);
  assert.ok(marked.limits.some((l) => /very large \(\d+ MB\), so only its first 3 MB and its last 9 MB were read/.test(l)));
  assert.equal(marked.crash.format, "bepinex");
  assert.ok(valuesOf({ ...marked, packets: undefined }).join("\n").includes(MARK), "the marker should reach the answer");

  const report = reportFor(personal);
  for (const [where, text] of Object.entries(everythingOut(report))) {
    assert.deepEqual(found(text), [], `${where} still carries something personal`);
  }
});

test("the message and the type of a C++ exception can't ping anyone, open a tag or break a code block in a post", () => {
  const evil = "@everyone [url=http://evil]x[/url] <b>bold</b> ```";
  const channel = CHANNELS.find((c) => c.id === "sse: the message of a C++ exception")!;
  const log = channel.put(fixture(channel.file), evil).replace("Type: std::runtime_error", () => `Type: ${evil}`);
  const report = run(log);
  for (const [where, text] of Object.entries(everythingOut(report))) {
    // The packets are what a person posts. (The answer above them is for the AI and quotes the log's words.)
    if (!where.startsWith("packet:") && !where.startsWith("packet title:")) continue;
    assert.doesNotMatch(text, /@everyone|@here/, where);
    assert.doesNotMatch(text, /\[url=|\[\/url\]/, where);
    assert.doesNotMatch(text, /<b>/, where);
  }
  for (const venue of Object.keys(report.packets) as Array<keyof typeof report.packets>) {
    const fences = (report.packets[venue].text.match(/```/g) ?? []).length;
    assert.ok(fences === 0 || fences % 2 === 0, `${venue} has ${fences} fences`);
  }
});
