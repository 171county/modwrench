import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { summarizeCrashWhisper, whisper } from "../src/crashwhisper/index.js";
import { packVersion } from "../src/patchday/skse.js";
import { createSandbox, pinnedTo, put } from "./helpers/world.js";
import { EMAIL, everythingOut, fixture, found, names, NOW, ok, options, PASSWORD, PERSON, personalLines } from "./helpers/person.js";

// The promise: whatever a crash log carries about the person (account name, computer name, folders,
// network addresses, email, keys, account IDs) is gone before anything is worked out from the log, so it
// is in neither the structured answer, the plain-text answer, nor any of the help packets. These tests
// plant every one of those things in each of the four log formats and look for them afterwards.
//
// The planted values are put together at run time: no line of this file looks like a key or an address
// to a secret scanner, and none of it is anyone's.

const sandbox = createSandbox("mw-crashprivacy-");
before(() => sandbox.start());
afterEach(() => sandbox.isolate());
after(() => sandbox.stop());

type Plant = (text: string, lines: string[]) => string;

/** Put `lines` after the first line matching `anchor`, each given `prefix`. */
function after_(anchor: RegExp, prefix = ""): Plant {
  return (text, lines) => {
    const all = text.split("\n");
    const at = all.findIndex((l) => anchor.test(l));
    assert.ok(at >= 0, `anchor ${anchor} not found in the fixture`);
    all.splice(at + 1, 0, ...lines.map((l) => `${prefix}${l}`));
    return all.join("\n");
  };
}

const FORMATS: Array<{ name: string; file: string; plant: Plant; format: string }> = [
  {
    name: "Crash Logger SSE",
    file: "crash-sse-real-format.log",
    format: "crashlogger-sse",
    // Free text where the logger prints process details, plus names of plugins the person's name is in.
    plant: (text, lines) =>
      after_(/^PROCESS INFO:/, "\t")(text, lines)
        .replace("[FE:001] ccBGSSSE001-Fish.esl", `[FE:001] ${PERSON.name}'s Fish.esl\n[FE:002] ${PERSON.machine} Patch.esl`)
        .replace(
          "CloakAndDaggerFix.dll 0x00007FFAF1BF0000",
          `CloakAndDaggerFix.dll 0x00007FFAF1BF0000\n\tC:\\Users\\${PERSON.name}\\Documents\\SecretFolder\\Thing.dll 0x00007FFAF1C00000`
        ),
  },
  {
    name: "BepInEx",
    file: "LogOutput-real-format.log",
    format: "bepinex",
    // The personal lines go in the startup messages; an error whose file name and compiled-in source path are
    // the person's goes in before the log's own last error, and no mod's code is on its stack.
    plant: (text, lines) =>
      after_(/Chainloader startup complete/, "[Info   :   BepInEx] ")(text, lines).replace(
        "[Error  : Unity Log] IndexOutOfRangeException",
        `[Error  : Unity Log] FileNotFoundException: Could not find file "C:\\Users\\${PERSON.name}\\AppData\\LocalLow\\Zeekerss\\Lethal Company\\SecretFolder\\save.json"\nStack trace:\nSystem.IO.File.ReadAllText (System.String path) [0x00012] in C:\\Users\\${PERSON.name}\\source\\repos\\Runtime\\File.cs:line 42\n\n[Error  : Unity Log] IndexOutOfRangeException`
      ),
  },
  {
    name: "Buffout 4",
    file: "crash-buffout4.log",
    format: "buffout4",
    plant: after_(/^SYSTEM SPECS:/),
  },
  {
    name: "NetScriptFramework",
    file: "crash-netscriptframework-real-format.log",
    format: "netscriptframework",
    plant: after_(/^ApplicationName:/),
  },
];

// ─── Four formats, everything planted ────────────────────────────────────────

for (const { name, file, plant, format } of FORMATS) {
  test(`${name}: nothing planted about the person comes out, in the answer, the text or any packet`, () => {
    const planted = plant(fixture(file), personalLines());
    assert.ok(found(planted).length > 10, "the fixture should be carrying the planted things");
    const report = ok(whisper({ logContent: planted, ...options() }));
    assert.equal(report.crash.format, format);
    for (const [where, text] of Object.entries(everythingOut(report))) {
      assert.deepEqual(found(text), [], `${where} still carries something personal`);
    }
  });

  test(`${name}: the log is still read after what was planted is taken out`, () => {
    const clean = ok(whisper({ logContent: fixture(file), ...options() }));
    const planted = ok(whisper({ logContent: plant(fixture(file), personalLines()), ...options() }));
    assert.equal(planted.crash.format, clean.crash.format);
    assert.deepEqual(planted.crash.game, clean.crash.game);
    assert.equal(planted.crash.exception?.type, clean.crash.exception?.type);
    assert.deepEqual(
      planted.leads.map((l) => [l.name, l.strength]),
      clean.leads.map((l) => [l.name, l.strength])
    );
  });

  test(`${name}: every kind of thing planted is counted as removed, and only counted`, () => {
    const report = ok(whisper({ logContent: plant(fixture(file), personalLines()), ...options() }));
    const { byKind, total, summary } = report.redaction;
    for (const kind of ["user", "machine", "path", "network", "contact", "secret", "id"]) {
      assert.ok((byKind[kind] ?? 0) > 0, `${kind} was planted and not counted`);
    }
    assert.ok(total >= 20);
    assert.match(summary, /^Removed \d+ /);
    assert.match(summary, /Read it before you post it/);
    assert.deepEqual(found(summary), []);
  });
}

test("what is left of a folder path is the file name, so a helper can still read it", () => {
  const planted = after_(/^PROCESS INFO:/, "\t")(fixture("crash-sse-real-format.log"), personalLines());
  const report = ok(whisper({ logContent: planted, ...options() }));
  const forum = report.packets.forum.text;
  assert.doesNotMatch(forum, /[A-Za-z]:[\\/]/);
  assert.doesNotMatch(forum, /\/(?:home|Users)\//);
  assert.doesNotMatch(forum, /\\\\[A-Za-z]/);
});

test("none of the answers carries a drive path, a home folder or a network share", () => {
  for (const { file, plant } of FORMATS) {
    const report = ok(whisper({ logContent: plant(fixture(file), personalLines()), ...options() }));
    for (const [where, text] of Object.entries(everythingOut(report))) {
      if (where === "json as written") continue; // its escapes ("named:\\n") look like a drive; the values above are the same text
      assert.doesNotMatch(text, /[A-Za-z]:[\\/][^\s]/, `${where}: a drive path`);
      assert.doesNotMatch(text, /\/(?:home|Users|root|mnt)\/[A-Za-z]/, `${where}: a home folder`);
      assert.doesNotMatch(text, /\\\\[A-Za-z0-9_.$-]+\\/, `${where}: a network share`);
    }
  }
});

// ─── The person's own names, learned from this machine ───────────────────────

function asPerson<T>(fn: () => T): T {
  const keys = ["USERNAME", "USER", "LOGNAME", "COMPUTERNAME", "HOSTNAME", "HOME"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.USERNAME = PERSON.name;
  process.env.USER = PERSON.account;
  process.env.LOGNAME = PERSON.account;
  process.env.COMPUTERNAME = PERSON.machine;
  process.env.HOSTNAME = PERSON.machine;
  process.env.HOME = join(sandbox.root, PERSON.account);
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("with nothing passed in, this machine's own account and computer names are learned and removed", () => {
  for (const { file, plant } of FORMATS) {
    const planted = plant(fixture(file), personalLines());
    const report = asPerson(() => ok(whisper({ logContent: planted, compareRecent: 0, checkInstall: false, now: NOW })));
    for (const [where, text] of Object.entries(everythingOut(report))) {
      const lower = text.toLowerCase();
      for (const f of [PERSON.name, PERSON.account, PERSON.machine]) {
        assert.ok(!lower.includes(f.toLowerCase()), `${where} still has ${f.length} characters of a name`);
      }
    }
  }
});

test("the person's name inside a plugin's name is taken out of it, and nothing else in the name is touched", () => {
  const planted = fixture("crash-sse-real-format.log").replace("[FE:001] ccBGSSSE001-Fish.esl", `[FE:001] ${PERSON.name}'s Fish.esl`);
  const report = ok(whisper({ logContent: planted, ...options() }));
  assert.match(report.packets.forum.text, /REDACTED-USER's Fish\.esl/);
});

test("a name that is only part of a longer word is left alone, and the answer says so", () => {
  const word = `${PERSON.name.replace(" ", "")}Armor.esp`;
  const planted = fixture("crash-sse-real-format.log").replace("[FE:001] ccBGSSSE001-Fish.esl", `[FE:001] ${word}`);
  const report = ok(whisper({ logContent: planted, ...options() }));
  assert.ok(report.redaction.leftover >= 1);
  assert.match(report.redaction.summary, /still appears inside/);
  assert.match(report.packets.forum.text, new RegExp(word.replace(".", "\\.")), "kept as written, because it is someone's file name");
  assert.match(summarizeCrashWhisper(report, { packet: "forum" }), /still appears inside/);
});

test("a joined account name inside a plugin's name is counted when only the name with its space is known, and the answer says so", () => {
  const word = `${PERSON.name.replace(" ", "")}Armor.esl`;
  const planted = fixture("crash-sse-real-format.log").replace("[FE:001] ccBGSSSE001-Fish.esl", `[FE:001] ${word}`);
  const report = ok(whisper({ logContent: planted, ...options({ redactOptions: { users: [PERSON.name], machines: [PERSON.machine], ownNames: false } }) }));
  assert.equal(report.redaction.leftover, 1);
  assert.match(report.redaction.summary, /still appears inside another word/);
  assert.match(report.packets.forum.text, new RegExp(word.replace(".", "\\.")), "kept as written, because it is someone's file name");
});

test("a name inside a longer word is counted once for the log, not once for every place it is shown again", () => {
  const word = `${PERSON.name.replace(" ", "")}Armor.esp`;
  const planted = fixture("crash-sse-real-format.log").replace("[FE:001] ccBGSSSE001-Fish.esl", `[FE:001] ${word}`);
  const report = ok(whisper({ logContent: planted, ...options() }));
  // It is in the log once. The help packets show the plugin list again, and the answer says it once.
  assert.equal(report.redaction.leftover, 1);
  assert.match(report.redaction.summary, /still appears inside another word/);
});

test("a file's own name is cleaned of the person's name too", () => {
  const w = sandbox.makeWorld();
  const path = join(w.root, "Elsewhere", `crash-${PERSON.name}-2026.log`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fixture("crash-sse-real-format.log"));
  const report = ok(whisper({ logPath: path, ...options() }));
  assert.equal(report.crash.fileName, "crash-REDACTED-USER-2026.log");
  for (const [where, text] of Object.entries(everythingOut(report))) assert.deepEqual(found(text), [], where);
});

test("a log that arrives as UTF-16, the way some Windows tools write it, is cleaned the same", () => {
  const w = sandbox.makeWorld();
  const planted = after_(/^PROCESS INFO:/, "\t")(fixture("crash-sse-real-format.log"), personalLines());
  const path = join(w.root, "wide", "crash-wide.log");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(planted, "utf16le")]));
  const report = ok(whisper({ logPath: path, ...options() }));
  assert.equal(report.crash.format, "crashlogger-sse");
  for (const [where, text] of Object.entries(everythingOut(report))) assert.deepEqual(found(text), [], where);
});

test("Windows line endings change nothing", () => {
  const planted = after_(/^PROCESS INFO:/, "\t")(fixture("crash-sse-real-format.log"), personalLines()).replace(/\n/g, "\r\n");
  const report = ok(whisper({ logContent: planted, ...options() }));
  for (const [where, text] of Object.entries(everythingOut(report))) assert.deepEqual(found(text), [], where);
});

test("something personal at the very end of a very long line is cut off with the line, never kept", () => {
  const long = `${"x".repeat(7000)} ${EMAIL} ${PERSON.name}`;
  const planted = after_(/^PROCESS INFO:/, "\t")(fixture("crash-sse-real-format.log"), [long]);
  const report = ok(whisper({ logContent: planted, ...options() }));
  assert.match(report.redaction.summary, /very long line was cut short/);
  for (const [where, text] of Object.entries(everythingOut(report))) assert.deepEqual(found(text), [], where);
});

// ─── What comes from the install, not the log ────────────────────────────────

function mo2(world: { root: string }, modName: string, declaredName = "Cloak and Dagger Fix"): string {
  const instance = join(world.root, "mo2");
  mkdirSync(join(instance, "profiles", "Default"), { recursive: true });
  writeFileSync(join(instance, "ModOrganizer.ini"), "[General]\ngameName=Skyrim Special Edition\nselected_profile=@ByteArray(Default)\n");
  writeFileSync(join(instance, "profiles", "Default", "modlist.txt"), `# This file was automatically generated by Mod Organizer.\n+${modName}\n`);
  put(join(instance, "mods", modName, "SKSE", "Plugins"), "CloakAndDaggerFix.dll", pinnedTo(declaredName, packVersion(1, 5, 97)));
  return instance;
}

test("a long mod folder name, or a plugin's own long name, is cleaned before it is cut, so no part of a name across the cut stays", () => {
  const w = sandbox.makeWorld();
  // 52 characters, then the account name: cut at 60 first, it would read "...Big Jane Do…", which no rule knows as the name.
  const long = `${"Patch ".repeat(8)}Big ${PERSON.name}'s Cloak Fix`;
  const instance = mo2(w, long, long);
  const report = asPerson(() =>
    ok(whisper({ logContent: fixture("crash-sse-real-format.log"), compareRecent: 0, mo2InstancePath: instance, gamePath: w.gameDir, now: NOW }))
  );
  const install = report.leads[0]?.install;
  assert.match(install?.source ?? "", /^MO2 mod "Patch Patch .*Big REDACTE/);
  assert.match(install?.declaredName ?? "", /^Patch Patch .*Big REDACTE/);
  for (const value of [install?.source, install?.declaredName]) assert.doesNotMatch(value ?? "", /jane/i);
});

test("a Mod Organizer folder named after the person is named without them, wherever the mod's file turns up", () => {
  const w = sandbox.makeWorld();
  const instance = mo2(w, `${PERSON.name}'s Cloak Fix`);
  const report = asPerson(() =>
    ok(whisper({ logContent: fixture("crash-sse-real-format.log"), compareRecent: 0, mo2InstancePath: instance, gamePath: w.gameDir, now: NOW }))
  );
  assert.equal(report.install.checked, true);
  assert.equal(report.leads[0]?.install?.source, 'MO2 mod "REDACTED-USER\'s Cloak Fix"');
  for (const [where, text] of Object.entries(everythingOut(report))) {
    const lower = text.toLowerCase();
    for (const f of [PERSON.name, PERSON.account, PERSON.machine]) assert.ok(!lower.includes(f.toLowerCase()), `${where}: ${f.length}-character name`);
    assert.doesNotMatch(text, /mw-crashprivacy|\/tmp\//, `${where}: a folder`);
  }
});

// ─── Writes nothing ──────────────────────────────────────────────────────────

function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      const st = statSync(full);
      out.push(`${full} ${entry.isDirectory() ? "dir" : st.size} ${st.mtimeMs}`);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The test world keeps Documents inside the game's Proton prefix, which is looked in on Linux only, so a test that
 * plants logs there runs as Linux on every machine.
 */
function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const real = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: real, configurable: true });
  }
}

test("the log and the other recent logs share one time allowance: once it is spent the rest are left unread, and the answer says so", () => {
  const w = sandbox.makeWorld();
  const docs = join(w.documents, "My Games", "Skyrim Special Edition", "SKSE");
  // A real crash, then lines that each take the cleaner a long while: each log takes seconds to clean, well past the allowance.
  const slow = Array.from({ length: 600 }, () => "eyJ-".repeat(1500).slice(0, 5999)).join("\n");
  for (const day of ["27", "28", "29"]) {
    put(docs, `crash-2026-09-${day}-10-00-00.log`, `${fixture("crash-sse-real-format.log")}\n${slow}\n`);
    const when = new Date(`2026-09-${day}T10:00:00Z`);
    utimesSync(join(docs, `crash-2026-09-${day}-10-00-00.log`), when, when);
  }
  const call = () =>
    ok(
      withPlatform("linux", () =>
        whisper({ logContent: fixture("crash-sse-real-format.log"), checkInstall: false, now: NOW, redactOptions: { ...names, budgetMs: 1500 } })
      )
    );
  const none = call();
  assert.equal(none.recent.examined, 0);
  assert.ok(none.limits.some((l) => /took too long, so your other recent crash logs were not compared\./.test(l)), none.limits.join("\n"));

  // A quick log, newer than the slow ones, is compared before the time runs out.
  put(docs, "crash-2026-09-30-10-00-00.log", fixture("crash-sse-real-format.log").replace("21:14:03", "10:00:00"));
  const one = call();
  assert.equal(one.recent.examined, 1);
  assert.ok(one.limits.some((l) => /took too long, so only 1 other recent crash log was compared; the rest were left unread\./.test(l)), one.limits.join("\n"));
});

test("other recent logs that each fit in the allowance still share it with the log, so the whole call stops in time", () => {
  const w = sandbox.makeWorld();
  const docs = join(w.documents, "My Games", "Skyrim Special Edition", "SKSE");
  // Four logs of about 670 lines: the cleaner reads the clock every 64 lines, so 11 times for each.
  const padding = Array.from({ length: 600 }, (_, i) => `[Info] line ${i}`).join("\n");
  for (const day of ["25", "26", "27", "28"]) {
    put(docs, `crash-2026-09-${day}-10-00-00.log`, `${fixture("crash-sse-real-format.log")}\n${padding}\n`);
    const when = new Date(`2026-09-${day}T10:00:00Z`);
    utimesSync(join(docs, `crash-2026-09-${day}-10-00-00.log`), when, when);
  }
  // A clock that moves on a millisecond each time it is read, so what is measured is the reading, not this machine's speed.
  const real = performance.now;
  let tick = 0;
  performance.now = () => tick++;
  let report: ReturnType<typeof ok>;
  try {
    report = ok(
      withPlatform("linux", () =>
        whisper({ logContent: fixture("crash-sse-real-format.log"), checkInstall: false, now: NOW, redactOptions: { ...names, budgetMs: 25 } })
      )
    );
  } finally {
    performance.now = real;
  }
  // Each log takes 11 of the 25 on its own, so an allowance for each would let all four through.
  assert.ok(report.recent.examined >= 1 && report.recent.examined < 4, `examined ${report.recent.examined}`);
  assert.ok(report.limits.some((l) => /took too long, so only \d other recent crash logs? (?:was|were) compared; the rest were left unread\./.test(l)), report.limits.join("\n"));
});

test("reading a log, the install and the other recent logs creates, changes and deletes nothing", () => {
  const w = sandbox.makeWorld();
  const docs = join(w.documents, "My Games", "Skyrim Special Edition", "SKSE");
  put(docs, "crash-2026-10-01-21-14-03.log", fixture("crash-sse-real-format.log"));
  put(docs, "crash-2026-09-30-10-00-00.log", fixture("crash-sse-real-format.log").replace("21:14:03", "10:00:00"));
  put(w.plugins, "CloakAndDaggerFix.dll", pinnedTo("Cloak and Dagger Fix", packVersion(1, 5, 97)));
  const before_ = snapshot(sandbox.root);
  const report = ok(withPlatform("linux", () => whisper({ now: NOW, redactOptions: names })));
  assert.equal(report.crash.source, "newest");
  assert.equal(report.install.checked, true);
  assert.deepEqual(snapshot(sandbox.root), before_);
});
