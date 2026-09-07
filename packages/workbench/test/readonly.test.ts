import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ─── The read-only guarantee, enforced ───────────────────────────────────────
// TRUST.md tells users, as a flat promise:
//
//   "Never modify your load order, your mod files, or your game files. Every
//    local tool opens files read-only. There is not a single filesystem write
//    call in the workbench package."
//
// It even hands them the grep command to check it themselves. This runs that
// check in CI so the build breaks if the claim stops being true, rather than
// leaving a user to be the one who discovers it.
//
// This is the package that touches a modder's actual game install. If anything
// in ModWrench is ever going to destroy someone's 300-hour save, it will be
// code that lives here. The guarantee is worth more than any feature that
// would require breaking it.
//
// Two design notes, both learned by watching an earlier version of this file
// fail to catch a write that was sitting right in front of it:
//
//  1. Only COMMENTS are stripped before scanning, not string literals. Stripping
//     strings with a regex is not safe in JavaScript source: a regex literal
//     containing a quote — os.ts has `.replace(/"/g, "")` — looks exactly like
//     the start of a string, so the stripper swallowed the remainder of the
//     file and the scan silently passed. Comments can be removed reliably;
//     strings cannot, so they are left in. The cost is that a string containing
//     the literal text of a write call would trip this, which is a cost worth
//     paying and easy to work around.
//  2. The scan asserts it actually read files. A scan that finds nothing because
//     it looked in the wrong directory passes vacuously, which is the same
//     as having no guard at all.

const SRC = new URL("../src/", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1"
);

/** Every .ts file under src/, recursively. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (entry.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

/**
 * Remove line and block comments only. See note 1 above for why string literals
 * are deliberately left alone.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const WRITE_CALLS = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "unlink",
  "unlinkSync",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "mkdir",
  "mkdirSync",
  "rename",
  "renameSync",
  "copyFile",
  "copyFileSync",
  "truncate",
  "truncateSync",
  "chmod",
  "chmodSync",
  "utimes",
  "utimesSync",
  "writev",
  "cpSync",
];

/**
 * Match a call to `name`, including through member access (fs.writeFileSync).
 * An earlier version excluded "." here, which made it blind to the single most
 * common way a write is written.
 */
function writeCallPattern(name: string): RegExp {
  return new RegExp("(?:^|[^A-Za-z0-9_$])" + name + "\\s*\\(", "m");
}

test("the read-only scan reads the source files it claims to", () => {
  // Guards against the scan passing because it looked at nothing.
  const files = sourceFiles(SRC);
  assert.ok(
    files.length > 10,
    `expected to scan the workbench sources, found ${files.length} files under ${SRC}`
  );
  assert.ok(
    files.some((f) => f.endsWith("os.ts")),
    "a known source file was missing from the scan"
  );
});

test("the workbench package contains no filesystem write call", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const name of WRITE_CALLS) {
      if (writeCallPattern(name).test(code)) {
        offenders.push(`${relative(SRC, file).replace(/\\/g, "/")} -> ${name}()`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "TRUST.md promises this package never writes to disk. Remove the write, or " +
      "change the promise first — do not edit this test to make the build pass."
  );
});

test("the workbench package imports no write API from node:fs", () => {
  // Catches an aliased import (`writeFileSync as w`) that the call scan misses.
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const raw = readFileSync(file, "utf8");
    const fsImports = raw.match(
      /import\s*\{([^}]*)\}\s*from\s*["']node:fs(?:\/promises)?["']/g
    );
    if (!fsImports) continue;
    for (const stmt of fsImports) {
      for (const name of WRITE_CALLS) {
        if (new RegExp("\\b" + name + "\\b").test(stmt)) {
          offenders.push(
            `${relative(SRC, file).replace(/\\/g, "/")} imports ${name}`
          );
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a write API was imported into the workbench package"
  );
});

// ─── Proving the guard can fail ──────────────────────────────────────────────
// A guard nobody has watched fail is just a passing test.

test("the scan detects a direct write call", () => {
  const hostile = stripComments(
    'import { writeFileSync } from "node:fs";\nwriteFileSync("/tmp/x", "data");\n'
  );
  assert.ok(
    writeCallPattern("writeFileSync").test(hostile),
    "the detector failed to spot an obvious write"
  );
});

test("the scan detects a write reached through require() and member access", () => {
  // Regression. This exact shape slipped past both scans once: the import scan
  // saw no import statement, and the call scan excluded "." before the name.
  const sneaky = stripComments(
    'const fsx = require("node:fs");\nfsx.writeFileSync(p, "oops");\n'
  );
  assert.ok(
    writeCallPattern("writeFileSync").test(sneaky),
    "member-access writes must be detected"
  );
});

test("a regex literal containing a quote does not blind the scanner", () => {
  // Regression for the bug that made this whole file useless: os.ts contains
  // `.replace(/"/g, "")`. A string-stripping pass treated that quote as the
  // start of a string literal and swallowed everything after it, so a write on
  // a later line was never seen. Comments-only stripping has no such hazard.
  const source = stripComments(
    'const id = line.replace(/"/g, "").trim();\nfs.writeFileSync(p, "x");\n'
  );
  assert.ok(
    writeCallPattern("writeFileSync").test(source),
    "a quote inside a regex literal hid a later write from the scanner"
  );
});

test("a write named only inside a comment does not trip the scan", () => {
  const innocent = stripComments(
    "// this module never calls writeFileSync() anywhere\nconst x = 1;\n"
  );
  assert.ok(
    !writeCallPattern("writeFileSync").test(innocent),
    "a comment was misread as a write call"
  );
});
