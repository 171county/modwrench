import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveText } from "../src/index.js";

test("redactSensitiveText redacts form-encoded credential fields", () => {
  const text =
    "api_key=super-secret&security_code=12345&error=invalid_request";

  const redacted = redactSensitiveText(text);

  assert.ok(redacted.includes("api_key=[redacted]"));
  assert.ok(redacted.includes("security_code=[redacted]"));
  assert.ok(redacted.includes("error=invalid_request"));
  assert.ok(!redacted.includes("super-secret"));
  assert.ok(!redacted.includes("12345"));
});

test("redactSensitiveText redacts JSON credential fields", () => {
  const text =
    '{"access_token":"oauth-secret","refresh_token":"refresh-secret","message":"bad token"}';

  const redacted = redactSensitiveText(text);

  assert.ok(redacted.includes('"access_token":"[redacted]"'));
  assert.ok(redacted.includes('"refresh_token":"[redacted]"'));
  assert.ok(redacted.includes('"message":"bad token"'));
  assert.ok(!redacted.includes("oauth-secret"));
  assert.ok(!redacted.includes("refresh-secret"));
});
