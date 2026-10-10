import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A release from a private repository can't carry npm provenance, and TRUST.md promises that the
// source is public and that every release can be checked against it. These tests pin the step in
// each publishing workflow that stops a release while the repository is private.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(resolve(ROOT, path), "utf8");
const GUARD = "if: ${{ github.event.repository.private }}";

test("release.yml stops in a private repository before it installs or publishes anything", () => {
  const workflow = read(".github/workflows/release.yml");
  const npmJob = workflow.slice(workflow.indexOf("\n  npm:"), workflow.indexOf("\n  mcp-registry:"));
  const guard = npmJob.indexOf(GUARD);
  assert.ok(guard > 0, "the guard is a step of the npm job");
  assert.ok(guard < npmJob.indexOf("actions/checkout"), "it is the first step");
  assert.ok(guard < npmJob.indexOf("npm ci"), "before the install");
  assert.ok(guard < npmJob.indexOf("npm publish"), "before the publish");
  assert.match(npmJob.slice(guard), /^[^\n]*\n\s+run: \|\n\s+echo "::error::This repository is private\.[^\n]*\n\s+exit 1\n/, "it fails the job with a message saying why");
});

test("the registry and GitHub release jobs wait for the npm job, so they stop with it", () => {
  const workflow = read(".github/workflows/release.yml");
  for (const job of ["mcp-registry", "github-release"]) {
    const body = workflow.slice(workflow.indexOf(`\n  ${job}:`));
    assert.match(body, /^\n  [a-z-]+:\n    needs: npm\n/, job);
  }
});

test("publish-mcp.yml stops in a private repository before it publishes", () => {
  const workflow = read(".github/workflows/publish-mcp.yml");
  const guard = workflow.indexOf(GUARD);
  assert.ok(guard > 0);
  assert.ok(guard < workflow.indexOf("mcp-publisher publish"));
});
