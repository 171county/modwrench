import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyModule,
  describeGame,
  explainException,
  extenderFromFrames,
  faultFromInstruction,
  formatName,
  isOfficialPlugin,
  moduleBase,
  readCppException,
  readSystem,
  splitModule,
} from "../src/crashwhisper/explain.js";
import type { CrashlogParseResult } from "../src/crashlog/types.js";

// ─── Which module is whose ───────────────────────────────────────────────────

test("moduleBase: lower-case, no folders, no offset, no extension", () => {
  assert.equal(moduleBase("SkyrimSE.exe"), "skyrimse");
  assert.equal(moduleBase("C:\\Games\\Skyrim\\Data\\SKSE\\Plugins\\SomeMod.dll"), "somemod");
  assert.equal(moduleBase("/home/x/SomeMod.dll"), "somemod");
  assert.equal(moduleBase("SomeMod.dll+0003A41"), "somemod");
  assert.equal(moduleBase("KERNEL32.DLL"), "kernel32");
});

test("splitModule: a module and its offset come apart; a plain name stays whole", () => {
  assert.deepEqual(splitModule("SomeMod.dll+0003A41"), { name: "SomeMod.dll", offset: "0003A41" });
  assert.deepEqual(splitModule("SkyrimSE.exe+1AA3A3F0"), { name: "SkyrimSE.exe", offset: "1AA3A3F0" });
  assert.deepEqual(splitModule("SomeMod.dll"), { name: "SomeMod.dll" });
  // A plus sign that isn't followed by hex digits is part of the name.
  assert.deepEqual(splitModule("Some+Mod.dll"), { name: "Some+Mod.dll" });
});

test("classifyModule: the game, the script extender, Windows, graphics and overlays are not mods", () => {
  assert.equal(classifyModule("SkyrimSE.exe"), "game");
  assert.equal(classifyModule("Fallout4.exe"), "game");
  assert.equal(classifyModule("skse64_1_6_1170.dll"), "extender");
  assert.equal(classifyModule("f4se_1_10_984.dll"), "extender");
  assert.equal(classifyModule("KERNEL32.DLL"), "system");
  assert.equal(classifyModule("ntdll.dll"), "system");
  assert.equal(classifyModule("nvwgf2umx.dll"), "graphics");
  assert.equal(classifyModule("d3d11.dll"), "graphics");
  assert.equal(classifyModule("GameOverlayRenderer64.dll"), "overlay");
  assert.equal(classifyModule("dinput8.dll"), "overlay");
  assert.equal(classifyModule("UnityEngine.CoreModule"), "framework");
  assert.equal(classifyModule("System.Collections"), "framework");
  assert.equal(classifyModule("0Harmony"), "framework");
});

test("classifyModule: everything not listed is treated as a mod", () => {
  assert.equal(classifyModule("CloakAndDaggerFix.dll"), "mod");
  assert.equal(classifyModule("SomeBrandNewPlugin.dll"), "mod");
  assert.equal(classifyModule("MoreCompany"), "mod");
});

test("classifyModule: C runtimes, audio, other Windows libraries and driver parts seen in real crash logs are not mods", () => {
  // Each is in the MODULES list or on the call stack of public Crash Logger SSE and Buffout 4 logs.
  const system = [
    "MSVCR110.dll", "msvcr120.dll", "MSVCR100.dll", "msvcp_win.dll", "msvcp140_atomic_wait.dll", "msvcp140_codecvt_ids.dll",
    "XAudio2_7.dll", "X3DAudio1_7.dll", "XAudio2_9.dll", "AudioSes.dll", "MMDevAPI.dll", "avrt.dll", "dcomp.dll", "gdiplus.dll",
    "windowscodecs.dll", "Windows.UI.dll", "psapi.dll", "hid.dll", "imagehlp.dll", "wintypes.dll", "winmmbase.dll",
    "schannel.dll", "dpapi.dll", "cryptnet.dll", "uiautomationcore.dll", "msdmo.dll", "resampledmo.dll",
  ];
  for (const name of system) assert.equal(classifyModule(name), "system", name);
  for (const name of ["nvgpucomp64.dll", "nvldumdx.dll", "DirectXDatabaseHelper.dll"]) assert.equal(classifyModule(name), "graphics", name);
  for (const name of ["tier0_s64.dll", "vstdlib_s64.dll", "usvfs_x64.dll"]) assert.equal(classifyModule(name), "overlay", name);
  // Fallout 4 ships these in its own folder.
  for (const name of ["flexRelease_x64.dll", "flexExtRelease_x64.dll", "GFSDK_GodraysLib.x64.dll", "GFSDK_SSAO_D3D11.win64.dll", "cudart64_75.dll", "nvToolsExt64_1.dll"]) {
    assert.equal(classifyModule(name), "game", name);
  }
});

test("classifyModule: no module at all is its own kind", () => {
  assert.equal(classifyModule(""), "unknown");
  assert.equal(classifyModule("(unknown)"), "unknown");
  assert.equal(classifyModule("<Module>"), "framework");
});

test("a module with an offset still classifies by its name", () => {
  assert.equal(classifyModule("SkyrimSE.exe+1AA3A3F0"), "game");
  assert.equal(classifyModule("SomeMod.dll+12345"), "mod");
});

// ─── Exceptions in plain words ───────────────────────────────────────────────

test("explainException: an access violation is the memory a program doesn't own, and says nothing about whose fault", () => {
  const e = explainException("EXCEPTION_ACCESS_VIOLATION");
  assert.ok(e);
  assert.match(e.plain, /memory it doesn't own/);
  assert.match(e.plain, /doesn't say whose fault/);
  assert.equal(e.basis, "rule");
});

test("explainException: a fault just past address 0 is an empty pointer, in words", () => {
  const e = explainException("EXCEPTION_ACCESS_VIOLATION", undefined, { access: "read", address: "0x000000000008" });
  assert.match(e?.plain ?? "", /read from address 0x8, just past 0/);
  assert.match(e?.plain ?? "", /an object that wasn't there/);
});

test("explainException: address 0 itself, and a write", () => {
  assert.match(explainException("EXCEPTION_ACCESS_VIOLATION", undefined, { access: "read", address: "0x0" })?.plain ?? "", /address 0, which means/);
  assert.match(
    explainException("EXCEPTION_ACCESS_VIOLATION", undefined, { access: "write", address: "0x10" })?.plain ?? "",
    /write to address 0x10/
  );
});

test("explainException: a fault at an ordinary address adds nothing it can't know", () => {
  const plain = explainException("EXCEPTION_ACCESS_VIOLATION", undefined, { access: "read", address: "0x00007FF6D0B6E1C0" })?.plain ?? "";
  assert.doesNotMatch(plain, /just past 0/);
  assert.doesNotMatch(plain, /empty pointer/);
});

test("explainException: NetScriptFramework's 'reading address 0x0' wording is understood", () => {
  const e = explainException("AccessViolationException", "AccessViolationException reading address 0x0");
  assert.match(e?.plain ?? "", /address 0/);
});

test("explainException: the common .NET exceptions have a meaning; an unknown one is null, not invented", () => {
  assert.match(explainException("NullReferenceException")?.plain ?? "", /null reference/);
  assert.match(explainException("MissingMethodException")?.plain ?? "", /built for different versions/);
  assert.match(explainException("HarmonyException")?.plain ?? "", /patch the game's code/);
  assert.match(explainException(undefined, "std::bad_alloc")?.plain ?? "", /couldn't get any/);
  assert.equal(explainException("SomeExceptionNobodyHasHeardOf"), null);
  assert.equal(explainException(undefined, undefined), null);
});

test("explainException: nothing in the table assigns blame", () => {
  for (const type of [
    "EXCEPTION_ACCESS_VIOLATION",
    "EXCEPTION_STACK_OVERFLOW",
    "EXCEPTION_ILLEGAL_INSTRUCTION",
    "EXCEPTION_IN_PAGE_ERROR",
    "NullReferenceException",
    "TypeLoadException",
    "HarmonyException",
    "OutOfMemoryException",
  ]) {
    const plain = explainException(type)?.plain ?? "";
    assert.doesNotMatch(plain, /\byour fault\b|\bthe culprit\b|\bguilty\b/i, type);
  }
});

// ─── SYSTEM SPECS ────────────────────────────────────────────────────────────

const SPECS = [
  "\tOS: Windows 11 Pro v10.0.22631",
  "\tCPU: AuthenticAMD AMD Ryzen 7 5800X 8-Core Processor",
  "\tCPU Cores: 16 logical, 8 physical, 1 packages",
  "\tGPU #1: Nvidia NVIDIA GeForce RTX 3070",
  "\tGPU #2: Intel(R) UHD Graphics",
  "\tPHYSICAL MEMORY: 14.20 GB/31.92 GB",
  "\tVIRTUAL MEMORY: 202.39 GB/131072.00 GB",
  "\tGPU MEMORY: 6.20/7.40 GB",
  "\tDetected Virtual Machine: VMware",
].join("\n");

test("readSystem: operating system, processor, graphics cards, system memory and video memory", () => {
  const s = readSystem(SPECS);
  assert.equal(s?.os, "Windows 11 Pro v10.0.22631");
  assert.equal(s?.cpu, "AuthenticAMD AMD Ryzen 7 5800X 8-Core Processor");
  assert.deepEqual(s?.gpus, ["Nvidia NVIDIA GeForce RTX 3070", "Intel(R) UHD Graphics"]);
  assert.deepEqual(s?.ram, { used: 14.2, total: 31.92 });
  assert.deepEqual(s?.vram, { used: 6.2, budget: 7.4 });
});

test("readSystem: VIRTUAL MEMORY is the game's address space, not Windows' commit, so it isn't read as commit", () => {
  // Crash Logger SSE prints infoware's memory(): ullTotalVirtual - ullAvailVirtual over ullTotalVirtual, the 128 TB
  // a 64-bit process can address. Real logs show "202.39 GB/131072.00 GB".
  assert.equal(readSystem(SPECS)?.commit, undefined);
  assert.equal(readSystem("\tVIRTUAL MEMORY: 131000.00 GB/131072.00 GB"), undefined);
});

test("readSystem: fields a logger couldn't determine are left out, and no section is no facts", () => {
  assert.equal(readSystem(undefined), undefined);
  assert.equal(readSystem(""), undefined);
  const s = readSystem("\tOS: Windows 10\n\tGPU MEMORY: Unable to determine\n\tPHYSICAL MEMORY: not a number");
  assert.equal(s?.os, "Windows 10");
  assert.equal(s?.vram, undefined);
  assert.equal(s?.ram, undefined);
});

test("readSystem: a zero total can't make a figure", () => {
  assert.equal(readSystem("PHYSICAL MEMORY: 0.00 GB/0.00 GB"), undefined);
});

// ─── C++ EXCEPTION block ─────────────────────────────────────────────────────

test("readCppException: type, message, where it was thrown and from which module", () => {
  const c = readCppException(
    ["\tType: std::runtime_error", "\tInfo: could not open file", "\tThrow Location: 0x7FF6D0B6E1C0 SomeMod.dll+0001234", "\tModule: SomeMod.dll"].join("\n")
  );
  assert.deepEqual(c, {
    type: "std::runtime_error",
    info: "could not open file",
    throwLocation: "0x7FF6D0B6E1C0 SomeMod.dll+0001234",
    module: "SomeMod.dll",
  });
});

test("readCppException: placeholder values in angle brackets aren't facts", () => {
  assert.equal(readCppException("\tType: <unknown>\n\tInfo: <none>"), undefined);
  assert.equal(readCppException(undefined), undefined);
});

// ─── Plugins that come with the game ─────────────────────────────────────────

test("isOfficialPlugin: the game's own plugins and Creation Club files, not mods", () => {
  for (const name of ["Skyrim.esm", "UPDATE.ESM", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm", "Fallout4.esm", "DLCCoast.esm"]) {
    assert.equal(isOfficialPlugin(name), true, name);
  }
  assert.equal(isOfficialPlugin("ccBGSSSE001-Fish.esm"), true);
  assert.equal(isOfficialPlugin("ccQDRSSE001-SurvivalMode.esl"), true);
  assert.equal(isOfficialPlugin("ccBGSFO4001-PipBoy(Black).esl"), true);
  // The VR masters and Fallout 4's high-resolution texture pack (libloadorder's hardcoded plugins for those games).
  for (const name of ["SkyrimVR.esm", "Fallout4_VR.esm", "DLCUltraHighResolution.esm"]) {
    assert.equal(isOfficialPlugin(name), true, name);
  }
  for (const name of ["Cloak and Dagger.esp", "SkyUI_SE.esp", "Unofficial Skyrim Special Edition Patch.esp", "cool-mod.esl"]) {
    assert.equal(isOfficialPlugin(name), false, name);
  }
});

// ─── The game ────────────────────────────────────────────────────────────────

const parsed = (over: Partial<CrashlogParseResult>): CrashlogParseResult => ({
  detectedType: "crashlogger-sse",
  exception: {},
  callStack: [],
  loadedPlugins: [],
  rawSections: {},
  ...over,
});

test("describeGame: Crash Logger's 'Skyrim SSE v1.6.1170' names the game and the version", () => {
  assert.deepEqual(describeGame(parsed({ gameVersion: "Skyrim SSE v1.6.1170" }), ""), {
    name: "Skyrim Special Edition",
    version: "1.6.1170",
    id: "skyrimspecialedition",
  });
  assert.equal(describeGame(parsed({ gameVersion: "Skyrim VR v1.4.15.0" }), "").id, "skyrimvr");
  assert.equal(describeGame(parsed({ gameVersion: "Fallout 4 v1.10.984" }), "", ).id, "fallout4");
});

test("describeGame: a NetScriptFramework executable name is recognised", () => {
  const g = describeGame(parsed({ detectedType: "netscriptframework", gameVersion: "SkyrimSE.exe v1.5.97.0" }), "");
  assert.equal(g.id, "skyrimspecialedition");
  assert.equal(g.version, "1.5.97.0");
});

test("describeGame: BepInEx's first line names the game", () => {
  const head = "[Message:   BepInEx] BepInEx 5.4.21.0 - Lethal Company (1/15/2024 2:30:00 PM)\n";
  assert.deepEqual(describeGame(parsed({ detectedType: "bepinex" }), head), { name: "Lethal Company", id: "lethalcompany" });
  const other = "[Message:   BepInEx] BepInEx 5.4.21.0 - Some Brand New Game (1/15/2024 2:30:00 PM)\n";
  assert.deepEqual(describeGame(parsed({ detectedType: "bepinex" }), other), { name: "Some Brand New Game" });
});

test("describeGame: a log that names no game still gets a name", () => {
  assert.equal(describeGame(parsed({}), "").name, "an unknown game");
});

test("extenderFromFrames and formatName", () => {
  assert.equal(extenderFromFrames([{ module: "SkyrimSE.exe" }, { module: "skse64_1_6_1170.dll" }]), "skse64_1_6_1170.dll");
  assert.equal(extenderFromFrames([{ module: "SkyrimSE.exe" }]), undefined);
  assert.equal(formatName("crashlogger-sse"), "Crash Logger SSE");
  assert.equal(formatName("buffout4"), "Buffout 4");
  assert.equal(formatName("bepinex"), "BepInEx");
  assert.equal(formatName("unknown"), "an unrecognised crash logger");
});

test("faultFromInstruction: the address an older Crash Logger SSE log doesn't write down is worked out from the instruction and registers", () => {
  // Crash Logger SSE v1.11 (evildarkarchon/crash-logs): neither log has "Tried to read memory at".
  const first = 'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF916FCDAE5 skee64.dll+001DAE5\tmov rcx, [r8+0x20]';
  assert.deepEqual(faultFromInstruction(first, { R8: "0x10" }), { access: "read", address: "0x30", derived: true });
  const second = 'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF91ADEEAB4 skee64.dll+001EAB4\tmov rbx, [rsi+rax*8+0x08]';
  assert.deepEqual(faultFromInstruction(second, { RSI: "0x0", RAX: "0x2" }), { access: "read", address: "0x18", derived: true });
  assert.equal(faultFromInstruction("x\tmov [rax+0x8], rcx", { RAX: "0x0" })?.access, "write");
  // Nothing is guessed: an instruction that touches no memory, or a register the log doesn't give, says nothing.
  assert.equal(faultFromInstruction("x\tlea rcx, [r8+0x20]", { R8: "0x10" }), undefined);
  assert.equal(faultFromInstruction(second, { RSI: "0x0" }), undefined);
  assert.equal(faultFromInstruction("x\trep stosb", { RDI: "0x0" }), undefined);
  // And the plain words say how it was found.
  const plain = explainException("EXCEPTION_ACCESS_VIOLATION", second, faultFromInstruction(second, { RSI: "0x0", RAX: "0x2" }))?.plain ?? "";
  assert.match(plain, /read from address 0x18 \(worked out from the instruction and the registers in the log\), just past 0/);
});
