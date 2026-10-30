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

// npm trusted publishing lets a release publish without a stored token that expires. npm's docs
// list what it needs: npm 11.5.1 or newer, Node 22.14.0 or newer, the id-token: write permission,
// a GitHub-hosted runner, and a repository.url in each package that matches this repository.
const NPM_FOR_TRUSTED_PUBLISHING = [11, 5, 1];
const atLeast = (have, want) => {
  for (let i = 0; i < want.length; i++) if (have[i] !== want[i]) return have[i] > want[i];
  return true;
};

test("release.yml publishes with what npm trusted publishing needs", () => {
  const workflow = read(".github/workflows/release.yml");
  const npmJob = workflow.slice(workflow.indexOf("\n  npm:"), workflow.indexOf("\n  mcp-registry:"));
  assert.match(npmJob, /^\n  npm:\n    runs-on: (?:ubuntu|windows|macos)-[\w.-]+\n/, "a GitHub-hosted runner");
  assert.match(npmJob, /\n    permissions:\n(?:      [^\n]*\n)*?      id-token: write\b/, "the id-token permission");
  const node = npmJob.match(/\n\s+node-version: (\d+)\n/);
  assert.ok(node && Number(node[1]) >= 22, "Node 22 or newer");
  const install = npmJob.match(/\n\s+run: npm install -g npm@(\d+)\.(\d+)\.(\d+)\n/);
  assert.ok(install, "a pinned npm is installed");
  assert.ok(atLeast(install.slice(1, 4).map(Number), NPM_FOR_TRUSTED_PUBLISHING), "npm 11.5.1 or newer");
  assert.ok(install.index > npmJob.indexOf("actions/setup-node"), "after setup-node, so it replaces the npm the publish runs");
  assert.ok(install.index < npmJob.search(/\n\s+npm publish /), "before the publish");
  assert.match(npmJob, /\n\s+npm publish [^\n]*--provenance/, "the publish asks for provenance");
  // The stored npm token was removed after 0.3.1, so no step may fall back on one.
  const steps = npmJob.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
  assert.doesNotMatch(steps, /NODE_AUTH_TOKEN|NPM_TOKEN/, "no stored npm token to fall back on");
});

test("every package release.yml publishes gives this repository as its repository.url", () => {
  const workflow = read(".github/workflows/release.yml");
  const packages = workflow.match(/\n\s+for pkg in ([a-z ]+); do\n/)[1].split(" ");
  assert.ok(packages.length > 0);
  for (const pkg of packages) {
    const manifest = JSON.parse(read(`packages/${pkg}/package.json`));
    assert.equal(manifest.repository?.url, "git+https://github.com/171county/modwrench.git", manifest.name);
  }
});

// A latest release of a version that a beta run already published moves latest onto it with npm dist-tag, so what
// is released is the very files that were tried. npm runs dist-tag with trusted publishing from 11.21.0 on.
const NPM_FOR_TRUSTED_DIST_TAG = [11, 21, 0];

test("release.yml moves the tag onto a version that is already published, with an npm that can", () => {
  const workflow = read(".github/workflows/release.yml");
  const npmJob = workflow.slice(workflow.indexOf("\n  npm:"), workflow.indexOf("\n  mcp-registry:"));
  const install = npmJob.match(/\n\s+run: npm install -g npm@(\d+)\.(\d+)\.(\d+)\n/);
  assert.ok(atLeast(install.slice(1, 4).map(Number), NPM_FOR_TRUSTED_DIST_TAG), "npm 11.21.0 or newer");
  const published = npmJob.indexOf('if npm view "${name}@${version}" version');
  const tag = npmJob.indexOf('npm dist-tag add "${name}@${version}" "${DIST_TAG}"');
  const publish = npmJob.search(/\n\s+npm publish /);
  assert.ok(published > 0 && tag > published, "an already published version gets the tag");
  assert.ok(tag < publish, "instead of being published again");
  assert.match(npmJob, /\n\s+package-manager-cache: false\n/, "a release build uses no download cache");
});
