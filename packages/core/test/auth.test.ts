import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadCredential } from "../src/auth.js";

// ─── The keychain-only guarantee ─────────────────────────────────────────────
// "ModWrench reads credentials only from your OS credential manager — never
// from a .env file, never from disk" is the most load-bearing sentence in
// TRUST.md, the README, the CLI auth prompt, and the Nexus registration letter.
// Until now it was asserted in four documents and guarded by zero tests.
//
// It is also the claim most likely to be broken later for convenience. Adding
// an env-var fallback is a two-line change that makes someone's setup problem
// go away, and it would silently falsify every one of those documents. These
// tests exist so that change fails the build instead.
//
// The keychain is not stubbed. These use a service name that has no entry, so
// the real getRawSecret path runs and returns null — exactly what a user with
// nothing stored would hit.

const SENTINEL = "sentinel-value-that-must-never-be-returned-8f3a1c";
const ABSENT_SERVICE = "modwrench-test-absent-service-8f3a1c";

const SAVED = new Map<string, string | undefined>();
function setEnv(name: string, value: string): void {
  if (!SAVED.has(name)) SAVED.set(name, process.env[name]);
  process.env[name] = value;
}

afterEach(() => {
  for (const [name, value] of SAVED) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  SAVED.clear();
});

test("loadCredential throws when the keychain has nothing, even with env vars set", () => {
  // Every plausible name someone might reach for if they wanted a shortcut.
  setEnv("NEXUS_API_KEY", SENTINEL);
  setEnv("MODIO_API_KEY", SENTINEL);
  setEnv("MODWRENCH_API_KEY", SENTINEL);
  setEnv("API_KEY", SENTINEL);
  setEnv("MODWRENCH_NEXUS_API_KEY", SENTINEL);

  assert.throws(
    () => loadCredential({ service: ABSENT_SERVICE, authHint: "test hint" }),
    /credential/i,
    "an absent keychain entry must fail loudly, not fall back to the environment"
  );
});

test("loadCredential never returns a value sourced from the environment", () => {
  setEnv("NEXUS_API_KEY", SENTINEL);
  let returned: unknown = null;
  try {
    returned = loadCredential({ service: ABSENT_SERVICE, authHint: "test hint" });
  } catch {
    // Throwing is the correct behaviour; the assertion below covers the case
    // where a future change makes it return something instead.
  }
  assert.equal(
    returned,
    null,
    "loadCredential returned a credential with nothing in the keychain — an env or file fallback was added"
  );
});

test("the failure message does not leak the environment value it ignored", () => {
  setEnv("NEXUS_API_KEY", SENTINEL);
  try {
    loadCredential({ service: ABSENT_SERVICE, authHint: "test hint" });
    assert.fail("expected loadCredential to throw");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(
      !message.includes(SENTINEL),
      "the error message included a credential-shaped env value"
    );
  }
});

test("the failure message tells the user where to put the credential", () => {
  // A hard failure is only acceptable if it is actionable. This asserts the
  // error names the credential manager and passes the caller's hint through,
  // rather than just saying "not found".
  try {
    loadCredential({
      service: ABSENT_SERVICE,
      authHint: "run: modwrench auth key nexus",
    });
    assert.fail("expected loadCredential to throw");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert.match(message, /credential manager/i);
    assert.ok(
      message.includes("modwrench auth key nexus"),
      "the caller's auth hint must reach the user"
    );
  }
});
