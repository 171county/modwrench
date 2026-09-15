import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ─── `auth status modio` must read the credential it actually stored ─────────
// The two mod.io credential commands write different shapes into the same
// keychain entry: `auth key` writes a bare API key via setRawSecret(), and
// `auth login` writes a JSON blob via setStoredToken().
//
// authStatus() used to check for a credential with getStoredToken() alone.
// That reader does JSON.parse(), core swallows the throw and returns null, and
// a raw API key is not JSON — so the parse failed every single time and the
// command printed "Not signed in. Run: modwrench auth login modio" and exited
// 1 on a key that had stored perfectly and would activate the tools on the next
// server start. It then pointed the user at `auth login modio`, which the
// README does not document and which itself needs the key they just stored.
// The natural recovery — logout, re-key — deletes the working credential and
// reproduces the same message.
//
// That made the one verification step the README offers report a working setup
// as broken. @modwrench/nexus already had this right: read the raw string for
// the presence check, then read the shape to pick the auth mechanism.
//
// These guards are written against the specific mistake: a presence check that
// goes through the JSON reader, and a validation call that assumes OAuth.

const AUTH = new URL("../src/auth.ts", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1"
);

function authStatusBody(src: string): string {
  const start = src.indexOf("export async function authStatus");
  assert.ok(start > -1, "authStatus() not found — this guard would pass vacuously");
  const next = src.indexOf("export async function", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

test("authStatus checks for the credential with getRawSecret, not getStoredToken", () => {
  const src = readFileSync(AUTH, "utf8");
  assert.ok(src.length > 0, "auth.ts was not read");
  const body = authStatusBody(src);

  const rawAt = body.indexOf("getRawSecret(SERVICE)");
  const storedAt = body.indexOf("getStoredToken(SERVICE)");

  assert.ok(
    rawAt > -1,
    "authStatus no longer calls getRawSecret — a raw API key will report as not signed in"
  );
  assert.ok(
    rawAt < storedAt || storedAt === -1,
    "authStatus reads getStoredToken before getRawSecret — that is the original bug: " +
      "JSON.parse throws on a raw API key, the throw is swallowed, and a working " +
      "credential reports 'Not signed in'"
  );
});

test("authStatus validates an API key against an endpoint an API key can reach", () => {
  const body = authStatusBody(readFileSync(AUTH, "utf8"));

  // mod.io's /me is user-scoped and OAuth-only: an API key cannot identify a
  // user, so validating a key against /me would fail for a perfectly good key.
  // The key path must use the api_key query parameter, as `auth key` itself does.
  assert.match(
    body,
    /api_key=\$\{encodeURIComponent\(/,
    "authStatus does not validate the API key via the api_key query parameter — " +
      "an API key cannot authenticate against /me"
  );

  assert.match(
    body,
    /viaOAuth/,
    "authStatus no longer branches on credential shape — one of the two credential " +
      "types will be validated against an endpoint it cannot reach"
  );
});

test("authStatus tells the user about both credential routes when nothing is stored", () => {
  const body = authStatusBody(readFileSync(AUTH, "utf8"));
  const notSignedIn = body.slice(0, body.indexOf("process.exit(1)"));

  assert.match(
    notSignedIn,
    /auth key modio/,
    "the not-signed-in message does not mention `auth key modio` — that is the " +
      "self-service route, and sending users to `auth login` first is a dead end " +
      "because the email exchange needs the API key"
  );
});
