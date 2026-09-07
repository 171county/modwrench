#!/usr/bin/env node
// Release-readiness gate.
//
// Catches the two classes of defect that only appear AFTER publishing, because
// npm workspaces resolve every internal package through a local symlink and a
// hoisted node_modules — so both are invisible to a normal build/test run:
//
//   1. Phantom dependencies — a package imports something it never declares,
//      and gets away with it locally because a sibling hoisted it.
//   2. Internal version drift — a package pins a @modwrench/* version that
//      doesn't match the sibling in this repo.
//
// Pass --registry to additionally ask npm whether each package already exists
// at its current version. That call needs network, so it's opt-in and only the
// release workflow turns it on.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const PKG_DIR = join(ROOT, "packages");
const CHECK_REGISTRY = process.argv.includes("--registry");

const NODE_BUILTIN = /^node:/;
const RELATIVE = /^\.{1,2}\//;

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Every .ts file under a directory, excluding tests and build output. */
function sourceFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      sourceFiles(full, acc);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/** Bare module specifiers imported by a source file. */
function importsOf(file) {
  const src = readFileSync(file, "utf8");
  const specs = new Set();
  const patterns = [
    // import ... from "x" / export ... from "x" — anchored on the keyword at
    // the start of a line, so prose containing the word "from" never matches.
    /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g,
    // side-effect import "x"
    /(?:^|\n)\s*import\s+["']([^"']+)["']/g,
    // dynamic import("x") and require("x")
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) specs.add(m[1]);
  }
  // A real module specifier has no whitespace and starts with a package-name
  // character. This guards against a greedy match running from an `export`
  // keyword through a semicolon-free block of string concatenation and
  // capturing prose that merely contains the word "from".
  const VALID_SPEC = /^(?:@[a-z0-9._~-]+\/)?[a-zA-Z0-9._~-][^\s"'+]*$/;
  return [...specs].filter(
    (s) => !NODE_BUILTIN.test(s) && !RELATIVE.test(s) && VALID_SPEC.test(s)
  );
}

/** "@scope/name/sub" -> "@scope/name";  "pkg/sub" -> "pkg" */
function packageNameOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const pkgNames = readdirSync(PKG_DIR).filter((d) => {
  if (d.startsWith("_")) return false; // archived/removed packages
  return existsSync(join(PKG_DIR, d, "package.json"));
});

const manifests = new Map();
for (const dir of pkgNames) {
  const json = readJson(join(PKG_DIR, dir, "package.json"));
  manifests.set(json.name, { dir, json });
}

const errors = [];
const warnings = [];

for (const [name, { dir, json }] of manifests) {
  const declared = new Set([
    ...Object.keys(json.dependencies ?? {}),
    ...Object.keys(json.peerDependencies ?? {}),
    ...Object.keys(json.optionalDependencies ?? {}),
  ]);
  const devDeclared = new Set(Object.keys(json.devDependencies ?? {}));

  // 1. Phantom dependencies in shipped source.
  for (const file of sourceFiles(join(PKG_DIR, dir, "src"))) {
    for (const spec of importsOf(file)) {
      const dep = packageNameOf(spec);
      if (dep === name || declared.has(dep)) continue;
      const where = file.slice(ROOT.length + 1).split(String.fromCharCode(92)).join("/");
      if (devDeclared.has(dep)) {
        errors.push(
          `${name}: imports "${dep}" (${where}) but declares it only as a devDependency — it will be missing for installers`
        );
      } else {
        errors.push(
          `${name}: imports "${dep}" (${where}) but never declares it as a dependency`
        );
      }
    }
  }

  // 2. Internal version drift.
  for (const [dep, range] of Object.entries(json.dependencies ?? {})) {
    const sibling = manifests.get(dep);
    if (!sibling) continue;
    if (range !== sibling.json.version) {
      errors.push(
        `${name}: depends on ${dep}@${range} but this repo builds ${dep}@${sibling.json.version}`
      );
    }
  }

  // 3. Publishing hygiene.
  if (json.private !== true) {
    if (!json.scripts?.prepack && !json.scripts?.prepublishOnly) {
      errors.push(
        `${name}: no prepack/prepublishOnly build hook — dist/ is gitignored, so publishing from a clean checkout would ship an empty tarball`
      );
    }
    if (!json.engines?.node) {
      warnings.push(`${name}: no engines.node declared`);
    }
    if (!existsSync(join(PKG_DIR, dir, "LICENSE"))) {
      warnings.push(`${name}: no LICENSE file in the package directory`);
    }
  }
}

// 4. Registry existence — opt-in, needs network.
if (CHECK_REGISTRY) {
  for (const [name, { json }] of manifests) {
    if (json.private === true) continue;
    let published = null;
    try {
      published = execFileSync(
        "npm",
        ["view", `${name}@${json.version}`, "version"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" }
      ).trim();
    } catch {
      published = null;
    }
    if (!published) {
      warnings.push(
        `${name}@${json.version} is not on npm yet — every package that depends on it must be published in the same release`
      );
    }
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);

if (errors.length) {
  console.error(`\n${errors.length} blocking problem(s) found.`);
  process.exit(1);
}
console.log(
  `\nOK — ${manifests.size} packages checked, no blocking problems${warnings.length ? ` (${warnings.length} warning(s))` : ""}.`
);
