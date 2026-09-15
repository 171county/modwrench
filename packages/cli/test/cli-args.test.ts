import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// ─── What the CLI does with an argument a person typed ───────────────────────
// `modwrench --help` used to fall straight through to the MCP boot: the server
// started on stdio, wrote one JSON log line, and then sat silently waiting for
// a client that was never going to speak. The most obvious first command a
// curious person can type made the tool look broken within ten seconds, and
// every other unrecognized argument did the same.
//
// The fix has two halves and BOTH need guarding, because they pull in opposite
// directions:
//
//   1. A present-but-unrecognized argument is a human mistake -> print usage.
//   2. NO arguments at all is an MCP client launching the server -> boot, stay
//      alive, and say nothing on stdout that is not JSON-RPC.
//
// Half 2 is the dangerous one. A future tightening of the unknown-argument
// guard that also catches the no-argument case would break every client that
// runs this, in a way no unit test of the parser alone would notice. So these
// tests spawn the real entry point rather than inspecting the source.

const ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));

type Run = { stdout: string; stderr: string; code: number | null };

function run(args: string[], timeoutMs = 20000): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", ENTRY, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ stdout, stderr, code: null });
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

for (const flag of ["--help", "-h", "help"]) {
  test(`\`${flag}\` prints usage and exits 0`, async () => {
    const { stdout, code } = await run([flag]);
    assert.equal(code, 0, `${flag} exited ${code}; expected a clean exit`);
    assert.match(stdout, /ModWrench \d+\.\d+\.\d+/, "usage does not name the version");
    assert.match(
      stdout,
      /claude mcp add/,
      "usage no longer shows how to install it — that is the reason this text exists"
    );
    // The single most useful sentence for someone who does not know what MCP
    // is. Without it they run the bare command, see nothing, and give up.
    assert.match(
      stdout,
      /You do not run it directly/,
      "usage no longer explains that an AI client starts this — a stranger will " +
        "run the bare command, see nothing happen, and conclude it is broken"
    );
    assert.doesNotMatch(
      stdout,
      /modwrench\.started/,
      `${flag} started the MCP server instead of printing help — that is the original bug`
    );
  });
}

test("an unrecognized argument prints usage and exits non-zero", async () => {
  const { stdout, stderr, code } = await run(["wat"]);
  assert.equal(code, 1, `expected exit 1 for an unknown command, got ${code}`);
  assert.match(stderr, /Unknown command "wat"/, "the unknown argument is not named back");
  assert.match(
    stderr + stdout,
    /claude mcp add/,
    "a typo gets an error with no way forward — usage should follow it"
  );
  assert.doesNotMatch(
    stderr + stdout,
    /modwrench\.started/,
    "an unknown argument still boots the server"
  );
});

test("NO arguments still starts the MCP server — this is how every client launches it", async () => {
  // Deliberately not asserting on exit code: the correct behavior is to stay
  // running. A process that exits here is broken for every user of the tool.
  const child = spawn(process.execPath, ["--import", "tsx", ENTRY], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let exited: number | null | "running" = "running";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  child.on("exit", (c) => (exited = c));

  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "cli-args-test", version: "0" },
      },
    }) + "\n"
  );

  await new Promise((r) => setTimeout(r, 12000));
  child.kill();

  assert.equal(
    exited,
    "running",
    `the server exited (code ${String(exited)}) instead of serving. If the ` +
      `unknown-argument guard was widened to catch the no-argument case, every ` +
      `MCP client that runs this is now broken.`
  );

  const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
  assert.ok(line, `no JSON-RPC response on stdout. stderr was: ${stderr.slice(0, 400)}`);
  const parsed = JSON.parse(line) as { result?: { serverInfo?: { name?: string } } };
  assert.equal(
    parsed.result?.serverInfo?.name,
    "modwrench",
    "the initialize handshake did not come back from the server"
  );

  // Usage text on stdout would corrupt the JSON-RPC stream a client is reading.
  assert.doesNotMatch(stdout, /claude mcp add/, "usage text leaked into the JSON-RPC stream");
});
